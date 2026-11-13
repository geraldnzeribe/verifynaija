// Genuine reference packs: public/refs/refs.json + images in public/refs/<id>/.
// Built by tools/build_refs.py from the references/ folder.
import fs from 'node:fs';
import path from 'node:path';

let refs = null;
export function loadRefs() {
  if (!refs) {
    try { refs = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'refs', 'refs.json'), 'utf8')); }
    catch { refs = []; }
  }
  return refs;
}

const words = s => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2);

/** Pick the reference product that best matches what the label says. */
export function findRef(label) {
  const seen = new Set([...words(label.brand), ...words(label.product_name), ...words(label.manufacturer)]);
  const norm = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  let best = null, bestScore = 0;
  for (const r of loadRefs()) {
    let s = 0;
    for (const k of r.keywords || []) if (seen.has(k.toLowerCase())) s += 2;
    if (r.brand && seen.has(r.brand.toLowerCase())) s += 3;
    if (r.nafdac && label.nafdac_number && norm(r.nafdac) === norm(label.nafdac_number)) s += 4;
    if (s > bestScore) { best = r; bestScore = s; }
  }
  return bestScore >= 3 ? best : null;
}

export function refImageB64(ref) {
  const rel = (ref.images || [])[0];
  if (!rel) return null;
  return fs.readFileSync(path.join(process.cwd(), 'public', rel.replace(/^\//, ''))).toString('base64');
}
