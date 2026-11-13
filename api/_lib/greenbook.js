// NAFDAC Greenbook lookup.
// Queries the same search endpoint the Greenbook website uses (robots.txt allows all),
// with a small offline snapshot as a fallback when the site can't be reached.
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://greenbook.nafdac.gov.ng/';
const COLS = ['product_name', 'ingredient.ingredient_name', 'product_category.name', 'product_category_id',
  'ingredient.synonym', 'NAFDAC', 'form.name', 'route.name', 'strength', 'applicant.name', 'approval_date', 'status'];

let snapshot = null;
function loadSnapshot() {
  if (!snapshot) {
    const p = path.join(process.cwd(), 'data', 'greenbook_sample.json');
    snapshot = JSON.parse(fs.readFileSync(p, 'utf8')).rows;
  }
  return snapshot;
}

export const normNafdac = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const clean = s => (s || '').replace(/\s*\(.*?\)\s*$/, '').replace(/[*#_]+\s*$/, '').trim();
const words = s => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2);

function trim(r) {
  return {
    name: clean(r.product_name), nafdac: r.NAFDAC, holder: r.applicant?.name || '',
    form: r.form?.name || '', strength: (r.strength || '').trim(), status: r.status,
    approved: r.approval_date, expires: r.expiry_date, ingredients: r.ingredient?.ingredient_name || '',
  };
}

async function query(field, value, length = 10) {
  const u = new URL(BASE);
  u.searchParams.set('draw', '1');
  COLS.forEach((c, i) => {
    u.searchParams.set(`columns[${i}][data]`, c);
    u.searchParams.set(`columns[${i}][name]`, c);
    u.searchParams.set(`columns[${i}][searchable]`, 'true');
    u.searchParams.set(`columns[${i}][orderable]`, 'true');
    u.searchParams.set(`columns[${i}][search][value]`, c === field ? value : '');
    u.searchParams.set(`columns[${i}][search][regex]`, 'false');
  });
  u.searchParams.set('order[0][column]', '0');
  u.searchParams.set('order[0][dir]', 'asc');
  u.searchParams.set('start', '0');
  u.searchParams.set('length', String(length));
  u.searchParams.set('search[value]', '');
  u.searchParams.set('search[regex]', 'false');
  const res = await fetch(u, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json', 'User-Agent': 'VerifyNaija/0.1 (counterfeit checker; hackathon project)' },
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) throw new Error('greenbook ' + res.status);
  const j = await res.json();
  return (j.data || []).map(trim);
}

/** Does the product on the pack plausibly match the registered record? */
function namesMatch(record, label) {
  const rec = new Set([...words(record.name), ...words(record.holder), ...words(record.ingredients)]);
  const seen = [...words(label.product_name), ...words(label.brand), ...words(label.manufacturer)];
  if (!seen.length) return true;               // nothing to compare against: don't accuse
  return seen.some(w => rec.has(w));
}

/**
 * Check a label against the Greenbook.
 * Returns { status: 'match'|'mismatch'|'not_found'|'unavailable', record?, suggestion?, source }
 */
export async function checkGreenbook(label) {
  const num = normNafdac(label.nafdac_number);
  if (!num) return null;
  let rows, source = 'live';
  try {
    rows = await query('NAFDAC', label.nafdac_number.trim(), 25);
  } catch {
    source = 'snapshot';
    rows = loadSnapshot();
  }
  const hits = rows.filter(r => normNafdac(r.nafdac) === num);
  if (hits.length) {
    const best = hits.find(r => namesMatch(r, label)) || null;
    // prefer an Active record if several share the number
    const pick = best && (hits.filter(r => namesMatch(r, label)).find(r => r.status === 'Active') || best);
    if (pick) return { status: 'match', record: pick, source };
    return { status: 'mismatch', record: hits[0], source };
  }
  if (source === 'snapshot' && !loadSnapshot().length) return { status: 'unavailable', source };
  // Not found: try to suggest the registered product with the same name
  let suggestion = null;
  const name = label.brand || label.product_name;
  if (name) {
    try {
      const byName = source === 'live' ? await query('product_name', name.split(/[\s-]+/)[0], 10)
        : loadSnapshot().filter(r => words(r.name).some(w => words(name).includes(w)));
      suggestion = byName.find(r => r.status === 'Active') || byName[0] || null;
    } catch { /* suggestion is optional */ }
  }
  if (source === 'snapshot') {
    // The snapshot only covers demo products, so "not in snapshot" is not proof of anything.
    return { status: 'unavailable', source, suggestion };
  }
  return { status: 'not_found', source, suggestion };
}

export async function searchGreenbook(q) {
  try { return { source: 'live', rows: await query(/^[A-Z]?\d/i.test(q) ? 'NAFDAC' : 'product_name', q, 10) }; }
  catch { return { source: 'snapshot', rows: loadSnapshot().filter(r => (r.name + r.nafdac).toLowerCase().includes(q.toLowerCase())) }; }
}
