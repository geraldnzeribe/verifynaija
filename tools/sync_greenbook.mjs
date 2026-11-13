// Copy the whole NAFDAC Greenbook (about 8,800 registered products) into data/greenbook_full.json,
// so number checks are instant and keep working when NAFDAC's site is slow or down.
//   node tools/sync_greenbook.mjs
// Uses the same search endpoint as greenbook.nafdac.gov.ng (its robots.txt allows all), one page
// at a time with a pause between requests. Takes a few minutes. Re-run now and then to refresh.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const COLS = ['product_name', 'ingredient.ingredient_name', 'product_category.name', 'product_category_id',
  'ingredient.synonym', 'NAFDAC', 'form.name', 'route.name', 'strength', 'applicant.name', 'approval_date', 'status'];
const clean = s => (s || '').replace(/\s*\(.*?\)\s*$/, '').replace(/[*#_]+\s*$/, '').trim();

async function page(start, length) {
  const u = new URL('https://greenbook.nafdac.gov.ng/');
  u.searchParams.set('draw', '1');
  COLS.forEach((c, i) => {
    u.searchParams.set(`columns[${i}][data]`, c); u.searchParams.set(`columns[${i}][name]`, c);
    u.searchParams.set(`columns[${i}][searchable]`, 'true'); u.searchParams.set(`columns[${i}][orderable]`, 'true');
    u.searchParams.set(`columns[${i}][search][value]`, ''); u.searchParams.set(`columns[${i}][search][regex]`, 'false');
  });
  for (const [k, v] of [['order[0][column]', '0'], ['order[0][dir]', 'asc'], ['start', start], ['length', length], ['search[value]', ''], ['search[regex]', 'false']]) u.searchParams.set(k, String(v));
  const res = await fetch(u, { headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json', 'User-Agent': 'VerifyNaija/0.1 (counterfeit checker; +https://github.com/geraldnzeribe/verifynaija)' } });
  if (!res.ok) throw new Error('Greenbook answered ' + res.status);
  return res.json();
}

const rows = []; let total = Infinity, start = 0;
while (start < total) {
  let j;
  for (let attempt = 1; ; attempt++) {
    try { j = await page(start, 100); break; }
    catch (e) { if (attempt === 4) throw e; console.log(`  retry ${attempt}: ${e.message}`); await new Promise(r => setTimeout(r, 5000 * attempt)); }
  }
  total = j.recordsTotal;
  if (!j.data?.length) break;
  for (const r of j.data) rows.push({ name: clean(r.product_name), nafdac: r.NAFDAC, holder: r.applicant?.name || '', form: r.form?.name || '',
    strength: (r.strength || '').trim(), status: r.status, approved: r.approval_date, expires: r.expiry_date, ingredients: r.ingredient?.ingredient_name || '' });
  start += j.data.length;
  console.log(`${rows.length} / ${total}`);
  await new Promise(r => setTimeout(r, 1200));
}
if (rows.length < 1000) { console.log('Got far fewer records than expected; not saving.'); process.exit(1); }
fs.writeFileSync(path.join(root, 'data', 'greenbook_full.json'),
  JSON.stringify({ source: 'NAFDAC Greenbook (greenbook.nafdac.gov.ng)', fetched: new Date().toISOString().slice(0, 10), rows }));
console.log(`Saved ${rows.length} products to data/greenbook_full.json. Commit, push and redeploy to use it.`);
