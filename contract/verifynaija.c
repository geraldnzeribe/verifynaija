/*
 * VerifyNaija — NEAR smart contract (C, compiled to wasm32 with zig cc).
 *
 * Stores counterfeit-product reports so they can't be quietly edited or deleted.
 * The contract stamps every report with the reporter's account and the block time,
 * so those two fields can't be faked by the client.
 *
 * Methods (JSON in, JSON out):
 *   submit_report({...report fields...})        -> id (number)
 *   confirm_report({"id": N})                   -> confirmations (number), one per account
 *   get_count({})                               -> total reports (number)
 *   get_reports({"from": N, "limit": M})        -> [ {id, by, ts, confirms, report}, ... ]
 *   get_report({"id": N})                       -> {id, by, ts, confirms, report} or null
 *
 * Storage layout:
 *   "n"              -> u64 report count (8 bytes, little endian)
 *   "r:<id>"         -> stored report JSON {"id":..,"by":"..","ts":..,"report":{...}}
 *   "v:<id>"         -> u64 confirmation count
 *   "cv:<id>:<acct>" -> 1 byte marker: this account already confirmed this report
 */

typedef unsigned long long u64;
typedef unsigned int u32;
typedef unsigned char u8;

/* ---- NEAR host functions ---- */
__attribute__((import_module("env"), import_name("read_register"))) extern void read_register(u64 register_id, u64 ptr);
__attribute__((import_module("env"), import_name("register_len"))) extern u64  register_len(u64 register_id);
__attribute__((import_module("env"), import_name("input"))) extern void input(u64 register_id);
__attribute__((import_module("env"), import_name("predecessor_account_id"))) extern void predecessor_account_id(u64 register_id);
__attribute__((import_module("env"), import_name("block_timestamp"))) extern u64  block_timestamp(void);
__attribute__((import_module("env"), import_name("value_return"))) extern void value_return(u64 value_len, u64 value_ptr);
__attribute__((import_module("env"), import_name("storage_write"))) extern u64  storage_write(u64 key_len, u64 key_ptr, u64 value_len, u64 value_ptr, u64 register_id);
__attribute__((import_module("env"), import_name("storage_read"))) extern u64  storage_read(u64 key_len, u64 key_ptr, u64 register_id);
__attribute__((import_module("env"), import_name("panic_utf8"))) extern void panic_utf8(u64 len, u64 ptr);
__attribute__((import_module("env"), import_name("log_utf8"))) extern void log_utf8(u64 len, u64 ptr);

/* ---- tiny libc replacements (the compiler may emit calls to these) ---- */
void *memcpy(void *d, const void *s, unsigned long n) { u8 *a = d; const u8 *b = s; while (n--) *a++ = *b++; return d; }
void *memset(void *d, int c, unsigned long n) { u8 *a = d; while (n--) *a++ = (u8)c; return d; }

#define MAX_REPORT 1500           /* max bytes of a client report */
#define MAX_ACCT   64             /* NEAR account ids are <= 64 chars */
#define MAX_LIMIT  50             /* max reports per page */

static u8 in_buf[MAX_REPORT + 64];
static u8 acct[MAX_ACCT + 1];
static u8 out[MAX_LIMIT * (MAX_REPORT + 256) + 16];
static u8 key[128];
static u8 val[MAX_REPORT + 256];

static u32 slen(const char *s) { u32 n = 0; while (s[n]) n++; return n; }

static void fail(const char *msg) { panic_utf8(slen(msg), (u64)(u32)msg); }

/* append helpers */
static u32 put(u8 *dst, u32 at, const void *src, u32 n) { memcpy(dst + at, src, n); return at + n; }
static u32 puts_(u8 *dst, u32 at, const char *s) { return put(dst, at, s, slen(s)); }
static u32 putu(u8 *dst, u32 at, u64 v) {
    u8 tmp[24]; u32 n = 0;
    if (v == 0) tmp[n++] = '0';
    while (v) { tmp[n++] = (u8)('0' + v % 10); v /= 10; }
    while (n) dst[at++] = tmp[--n];
    return at;
}

/* read the method's input into in_buf; returns length */
static u32 read_input(u32 max) {
    input(0);
    u64 len = register_len(0);
    if (len == (u64)-1) return 0;
    if (len > max) fail("input too large");
    read_register(0, (u64)(u32)in_buf);
    return (u32)len;
}

static u32 read_acct(void) {
    predecessor_account_id(0);
    u64 len = register_len(0);
    if (len > MAX_ACCT) fail("account id too long");
    read_register(0, (u64)(u32)acct);
    return (u32)len;
}

/* find  "name":  and parse the unsigned integer after it; returns def if absent */
static u64 json_u64(const u8 *s, u32 n, const char *name, u64 def) {
    u32 k = slen(name);
    for (u32 i = 0; i + k + 2 < n; i++) {
        if (s[i] != '"') continue;
        u32 j = 0;
        while (j < k && s[i + 1 + j] == (u8)name[j]) j++;
        if (j != k || s[i + 1 + k] != '"') continue;
        u32 p = i + 2 + k;
        while (p < n && (s[p] == ' ' || s[p] == ':')) p++;
        u64 v = 0; int any = 0;
        while (p < n && s[p] >= '0' && s[p] <= '9') { v = v * 10 + (s[p] - '0'); p++; any = 1; }
        return any ? v : def;
    }
    return def;
}

/* storage helpers */
static u64 read_u64_key(const u8 *k, u32 klen) {
    if (storage_read(klen, (u64)(u32)k, 1) == 0) return 0;
    u64 v = 0; read_register(1, (u64)(u32)&v); return v;
}
static void write_u64_key(const u8 *k, u32 klen, u64 v) {
    storage_write(klen, (u64)(u32)k, 8, (u64)(u32)&v, 2);
}
static u32 report_key(u64 id) { u32 n = puts_(key, 0, "r:"); return putu(key, n, id); }
static u32 votes_key(u64 id)  { u32 n = puts_(key, 0, "v:"); return putu(key, n, id); }

/* basic sanity check: a JSON object with balanced braces outside strings, no control chars */
static int looks_like_object(const u8 *s, u32 n) {
    if (n < 2 || s[0] != '{' || s[n - 1] != '}') return 0;
    int depth = 0, in_str = 0;
    for (u32 i = 0; i < n; i++) {
        u8 c = s[i];
        if (c < 0x20) return 0;
        if (in_str) { if (c == '\\') { i++; continue; } if (c == '"') in_str = 0; continue; }
        if (c == '"') in_str = 1;
        else if (c == '{' || c == '[') depth++;
        else if (c == '}' || c == ']') { if (--depth < 0) return 0; }
    }
    return depth == 0 && !in_str;
}

/* append one stored report (with live confirmation count) to out at position at */
static u32 append_report(u32 at, u64 id) {
    u32 kl = report_key(id);
    if (storage_read(kl, (u64)(u32)key, 1) == 0) return puts_(out, at, "null");
    u64 len = register_len(1);
    read_register(1, (u64)(u32)val);
    /* stored value ends with '}' — splice confirms in before it */
    at = put(out, at, val, (u32)len - 1);
    u32 vk = votes_key(id);
    at = puts_(out, at, ",\"confirms\":");
    at = putu(out, at, read_u64_key(key, vk));
    return puts_(out, at, "}");
}

/* ---- public methods ---- */

__attribute__((export_name("submit_report")))
void submit_report(void) {
    u32 n = read_input(MAX_REPORT);
    if (!looks_like_object(in_buf, n)) fail("report must be a JSON object");
    u32 an = read_acct();

    u64 count = read_u64_key((const u8 *)"n", 1);
    u64 id = count + 1;

    u32 at = puts_(val, 0, "{\"id\":");
    at = putu(val, at, id);
    at = puts_(val, at, ",\"by\":\"");
    at = put(val, at, acct, an);
    at = puts_(val, at, "\",\"ts\":");
    at = putu(val, at, block_timestamp());
    at = puts_(val, at, ",\"report\":");
    at = put(val, at, in_buf, n);
    at = puts_(val, at, "}");

    u32 kl = report_key(id);
    storage_write(kl, (u64)(u32)key, at, (u64)(u32)val, 2);
    write_u64_key((const u8 *)"n", 1, id);

    u32 ln = puts_(out, 0, "EVENT_JSON:{\"standard\":\"verifynaija\",\"event\":\"report\",\"data\":{\"id\":");
    ln = putu(out, ln, id);
    ln = puts_(out, ln, "}}");
    log_utf8(ln, (u64)(u32)out);

    u32 rn = putu(out, 0, id);
    value_return(rn, (u64)(u32)out);
}

__attribute__((export_name("confirm_report")))
void confirm_report(void) {
    u32 n = read_input(256);
    u64 id = json_u64(in_buf, n, "id", 0);
    u64 count = read_u64_key((const u8 *)"n", 1);
    if (id == 0 || id > count) fail("no such report");
    u32 an = read_acct();

    u32 k = puts_(key, 0, "cv:");
    k = putu(key, k, id);
    k = puts_(key, k, ":");
    k = put(key, k, acct, an);
    if (storage_read(k, (u64)(u32)key, 1) == 1) fail("you already confirmed this report");
    u8 one = 1;
    storage_write(k, (u64)(u32)key, 1, (u64)(u32)&one, 2);

    u32 vk = votes_key(id);
    u64 v = read_u64_key(key, vk) + 1;
    vk = votes_key(id);
    write_u64_key(key, vk, v);

    u32 rn = putu(out, 0, v);
    value_return(rn, (u64)(u32)out);
}

__attribute__((export_name("get_count")))
void get_count(void) {
    u64 count = read_u64_key((const u8 *)"n", 1);
    u32 rn = putu(out, 0, count);
    value_return(rn, (u64)(u32)out);
}

__attribute__((export_name("get_report")))
void get_report(void) {
    u32 n = read_input(256);
    u64 id = json_u64(in_buf, n, "id", 0);
    u32 at = append_report(0, id);
    value_return(at, (u64)(u32)out);
}

/* newest first by default: from = count, walking down */
__attribute__((export_name("get_reports")))
void get_reports(void) {
    u32 n = read_input(256);
    u64 count = read_u64_key((const u8 *)"n", 1);
    u64 from = json_u64(in_buf, n, "from", count);
    u64 limit = json_u64(in_buf, n, "limit", 20);
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;
    if (from > count) from = count;

    u32 at = puts_(out, 0, "[");
    u64 got = 0;
    for (u64 id = from; id >= 1 && got < limit; id--, got++) {
        if (got) at = puts_(out, at, ",");
        at = append_report(at, id);
    }
    at = puts_(out, at, "]");
    value_return(at, (u64)(u32)out);
}
