// Measure how well the checker separates fakes from genuine packs.
//   node tools/evaluate.mjs https://your-app.vercel.app
// Reads dataset/fakes/<product>/*.jpg and dataset/genuine/<product>/*.jpg (made by tools/build_refs.py),
// sends each to /api/analyze, and reports how many were flagged (score >= 40) or cautioned (>= 15).
import fs from 'node:fs';
import path from 'node:path';

const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dataset');
const sets = { fake: path.join(root, 'fakes'), genuine: path.join(root, 'genuine') };
const rows = [];

for (const [truth, dir] of Object.entries(sets)) {
  if (!fs.existsSync(dir)) continue;
  for (const prod of fs.readdirSync(dir)) {
    for (const f of fs.readdirSync(path.join(dir, prod))) {
      const image = fs.readFileSync(path.join(dir, prod, f)).toString('base64');
      const res = await fetch(base + '/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }) });
      const d = await res.json();
      rows.push({ truth, prod, f, score: d.score ?? null, level: d.level ?? d.error, top: d.reasons?.[0]?.title || '' });
      console.log(`${truth.padEnd(7)} ${prod}/${f}`.padEnd(48), String(d.score ?? '-').padStart(3), d.level || d.error, '|', d.reasons?.[0]?.title || '');
      await new Promise(r => setTimeout(r, 1500));   // stay well inside API rate limits
    }
  }
}
const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : 'n/a';
const fakes = rows.filter(r => r.truth === 'fake'), gen = rows.filter(r => r.truth === 'genuine');
console.log('\nFakes flagged high risk:   ', pct(fakes.filter(r => r.score >= 40).length, fakes.length), `of ${fakes.length}`);
console.log('Fakes at least cautioned:  ', pct(fakes.filter(r => r.score >= 15).length, fakes.length));
console.log('Genuine wrongly flagged:   ', pct(gen.filter(r => r.score >= 40).length, gen.length), `of ${gen.length}`);
fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify(rows, null, 1));
