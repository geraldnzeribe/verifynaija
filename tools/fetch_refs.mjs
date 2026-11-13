// Turn official product pages into genuine reference photos.
//
//   1. List product pages in references/links.txt, one per line:
//        slug | page URL | category | keywords
//      e.g.
//        emzor-paracetamol-500 | https://emzorpharma.com/product/emzor-paracetamol/ | drug | emzor, paracetamol
//        peak-milk-400g        | https://www.jumia.com.ng/peak-....html              | food | peak, milk
//      Use OFFICIAL sources only: the maker's own site, or the brand's official store.
//      A slug can appear on several lines to collect more than one genuine photo.
//   2. node tools/fetch_refs.mjs
//   3. Check each references/<slug>/meta.json (fix the name/brand/NAFDAC number if needed)
//   4. node tools/build_refs.mjs
//
// The script is deliberately polite: it checks robots.txt, waits between requests,
// identifies itself, and only downloads the page's main product image.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const refDir = path.join(root, 'references');
const UA = 'VerifyNaija-reference-collector/0.1 (+https://github.com/geraldnzeribe/verifynaija)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const robotsCache = new Map();
async function allowed(url) {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    let rules = [];
    try {
      const txt = await (await fetch(u.origin + '/robots.txt', { headers: { 'User-Agent': UA } })).text();
      let applies = false;
      for (const raw of txt.split('\n')) {
        const line = raw.split('#')[0].trim();
        const [k, ...rest] = line.split(':'); const v = rest.join(':').trim();
        if (/^user-agent$/i.test(k)) applies = v === '*';
        else if (applies && /^disallow$/i.test(k) && v) rules.push(v);
      }
    } catch { /* no robots.txt: allowed */ }
    robotsCache.set(u.origin, rules);
  }
  return !robotsCache.get(u.origin).some(r => u.pathname.startsWith(r));
}

function pick(html, base) {
  const meta = (attr, name) => html.match(new RegExp(`<meta[^>]+${attr}=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i'))?.[1]
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*${attr}=["']${name}["']`, 'i'))?.[1];
  let image = meta('property', 'og:image') || meta('name', 'twitter:image');
  let title = meta('property', 'og:title') || html.match(/<title>([^<]+)<\/title>/i)?.[1];
  // JSON-LD Product data, if the page has it
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const items = [JSON.parse(m[1])].flat().flatMap(x => x['@graph'] || [x]);
      const p = items.find(x => /Product/i.test(x['@type']));
      if (p) { image = [p.image].flat()[0]?.url || [p.image].flat()[0] || image; title = p.name || title; }
    } catch { /* ignore broken JSON-LD */ }
  }
  return { image: image && new URL(image.replace(/&amp;/g, '&'), base).href, title: title?.replace(/\s+/g, ' ').trim() };
}

const listFile = path.join(refDir, 'links.txt');
if (!fs.existsSync(listFile)) { console.log('Create references/links.txt first (see the top of this file).'); process.exit(1); }
const lines = fs.readFileSync(listFile, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
const csv = path.join(refDir, 'sources.csv');
if (!fs.existsSync(csv)) fs.writeFileSync(csv, 'file,source_url,label,notes\n');

for (const line of lines) {
  const [slug, url, category = 'other', keywords = ''] = line.split('|').map(s => s.trim());
  if (!slug || !/^https?:/.test(url || '')) { console.log('skip (bad line):', line); continue; }
  try {
    if (!(await allowed(url))) { console.log(`skip ${slug}: robots.txt disallows ${url}`); continue; }
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
    if (!res.ok) throw new Error('page ' + res.status);
    const { image, title } = pick(await res.text(), url);
    if (!image) throw new Error('no product image found on the page');
    await sleep(2000);
    const img = await fetch(image, { headers: { 'User-Agent': UA } });
    if (!img.ok) throw new Error('image ' + img.status);
    const type = img.headers.get('content-type') || '';
    const ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : '.jpg';
    const dir = path.join(refDir, slug); fs.mkdirSync(dir, { recursive: true });
    let n = 1; while (fs.readdirSync(dir).some(f => f.startsWith(`genuine-${n}.`))) n++;
    const file = path.join(dir, `genuine-${n}${ext}`);
    fs.writeFileSync(file, Buffer.from(await img.arrayBuffer()));
    const metaPath = path.join(dir, 'meta.json');
    if (!fs.existsSync(metaPath)) {
      const kw = keywords.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      fs.writeFileSync(metaPath, JSON.stringify({ name: title || slug, brand: kw[0] || '', keywords: kw, category, nafdac: '', source: new URL(url).hostname }, null, 1));
    }
    fs.appendFileSync(csv, `${slug}/genuine-${n}${ext},${url},genuine,"${(title || '').replace(/"/g, "'")}"\n`);
    console.log(`ok   ${slug}/genuine-${n}${ext}  ← ${title || url}`);
  } catch (e) {
    console.log(`fail ${slug}: ${e.message}  (save the photo by hand into references/${slug}/genuine-1.jpg instead)`);
  }
  await sleep(3000);
}
console.log('\nNow check each meta.json, then run: node tools/build_refs.mjs');
