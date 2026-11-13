// Minimal mock NEAR runtime: runs the compiled contract with an in-memory key/value store.
// Used by the contract tests and by the local mock dev server.
import fs from 'node:fs';

export function createRuntime(wasmPath = new URL('./verifynaija.wasm', import.meta.url)) {
  const mod = new WebAssembly.Module(fs.readFileSync(wasmPath));
  const storage = new Map();
  const enc = new TextEncoder(), dec = new TextDecoder();

  function call(method, args, { caller = 'alice.testnet', ts = BigInt(Date.now()) * 1_000_000n } = {}) {
    const regs = new Map(); let ret = null; const logs = []; let mem;
    const view = () => new Uint8Array(mem.buffer);
    const rd = (ptr, len) => view().slice(Number(ptr), Number(ptr) + Number(len));
    const env = {
      read_register: (id, ptr) => view().set(regs.get(id), Number(ptr)),
      register_len: id => regs.has(id) ? BigInt(regs.get(id).length) : 0xffffffffffffffffn,
      input: id => regs.set(id, enc.encode(typeof args === 'string' ? args : JSON.stringify(args))),
      predecessor_account_id: id => regs.set(id, enc.encode(caller)),
      block_timestamp: () => ts,
      value_return: (len, ptr) => { ret = dec.decode(rd(ptr, len)); },
      storage_write: (kl, kp, vl, vp, id) => { const k = dec.decode(rd(kp, kl)); const had = storage.has(k); if (had) regs.set(id, storage.get(k)); storage.set(k, rd(vp, vl)); return had ? 1n : 0n; },
      storage_read: (kl, kp, id) => { const k = dec.decode(rd(kp, kl)); if (!storage.has(k)) return 0n; regs.set(id, storage.get(k)); return 1n; },
      panic_utf8: (len, ptr) => { throw new Error('PANIC: ' + dec.decode(rd(ptr, len))); },
      log_utf8: (len, ptr) => logs.push(dec.decode(rd(ptr, len))),
    };
    const inst = new WebAssembly.Instance(mod, { env });
    mem = inst.exports.memory;
    inst.exports[method]();
    return { ret, logs, json: ret == null ? null : JSON.parse(ret) };
  }
  return { call, storage, module: mod };
}
