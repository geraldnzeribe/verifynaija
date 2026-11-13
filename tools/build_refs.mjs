// Node version of build_refs.py (no Python needed).
//   node tools/build_refs.mjs
// Reads references/<slug>/{meta.json, genuine-*.jpg, fake-*.jpg} and writes:
//   public/refs/<slug>/1.jpg + public/refs/refs.json   (the reference the app compares against)
//   dataset/genuine/<slug>/*  and  dataset/fakes/<slug>/*  (held-out test photos for tools/evaluate.mjs)
// Photos are shrunk to 900px if the optional `sharp` package is installed (npm i -D sharp); otherwise copied as-is.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC = path.join(root, 'references'), OUT = path.join(root, 'public', 'refs'), DATA = path.join(root, 'dataset');
const IMG = /\.(jpe?g|png|webp)$/i;
let sharp = null;
try { sharp = (await import('sharp')).default; } catch { console.log('(sharp not installed: copying photos without resizing)'); }

async function save(src, dst, size) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (sharp) await sharp(src).rotate().resize(size, size, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(dst);
  else fs.copyFileSync(src, dst);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.rmSync(DATA, { recursive: true, force: true });
const refs = [];
for (const slug of fs.readdirSync(SRC).filter(d => fs.statSync(path.join(SRC, d)).isDirectory() && !d.startsWith('_')).sort()) {
  const dir = path.join(SRC, slug);
  if (!fs.existsSync(path.join(dir, 'meta.json'))) { console.log(`skip ${slug}: no meta.json`); continue; }
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const files = fs.readdirSync(dir).filter(f => IMG.test(f)).sort();
  const genuine = files.filter(f => /^genuine/i.test(f)), fakes = files.filter(f => /^fake/i.test(f));
  if (!genuine.length) { console.log(`skip ${slug}: no genuine-*.jpg`); continue; }
  const ext = sharp ? '.jpg' : path.extname(genuine[0]).toLowerCase();
  await save(path.join(dir, genuine[0]), path.join(OUT, slug, '1' + ext), 900);
  for (const [i, f] of genuine.slice(1).entries()) await save(path.join(dir, f), path.join(DATA, 'genuine', slug, `${i + 1}${sharp ? '.jpg' : path.extname(f)}`), 1280);
  for (const [i, f] of fakes.entries()) await save(path.join(dir, f), path.join(DATA, 'fakes', slug, `${i + 1}${sharp ? '.jpg' : path.extname(f)}`), 1280);
  refs.push({ id: slug, name: meta.name, brand: meta.brand || '', keywords: (meta.keywords || []).map(k => k.toLowerCase()),
    category: meta.category || 'other', nafdac: meta.nafdac || '', source: meta.source || '', images: [`/refs/${slug}/1${ext}`] });
  console.log(`${slug}: reference + ${genuine.length - 1} genuine test + ${fakes.length} fake test`);
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'refs.json'), JSON.stringify(refs, null, 1));
console.log(`\n${refs.length} products in public/refs/refs.json. Commit, push and redeploy to use them.`);
