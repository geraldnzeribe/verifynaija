// Unit tests for the risk score and the report validator (no network needed).
import assert from 'node:assert/strict';
import { scoreCheck } from '../api/_lib/scoring.js';
import { cleanReport } from '../api/report.js';

const rec = { name: 'Emzor Paracetamol Tablet', nafdac: '04-0411', holder: 'Emzor Pharmaceutical Industries Limited', status: 'Active', expires: '2028-03-27' };

// Clean pack: registered number, no label issues, close visual match
let r = scoreCheck({ isDrug: true, label: { nafdac_number: '04-0411', read_ok: true, issues: [] },
  greenbook: { status: 'match', record: rec }, visual: { similarity: 91, differences: [] } });
assert.equal(r.level, 'low'); assert.equal(r.flags, 0); assert.equal(r.headline, 'No red flags found');

// Classic fake: unknown number + spelling + different-looking pack
r = scoreCheck({ isDrug: true,
  label: { nafdac_number: '04-9921', issues: [{ title: 'Spelling error on the label', detail: '"Paracetemol"' }] },
  greenbook: { status: 'not_found', suggestion: rec }, visual: { similarity: 42, differences: [{ what: 'Logo typeface differs' }] }, reports: 6 });
assert.equal(r.level, 'high'); assert.equal(r.flags, 3); assert.equal(r.score, 92);
assert.equal(r.reasons[0].level, 'flag');

// Lapsed registration is a caution, not a red flag
r = scoreCheck({ isDrug: true, label: { nafdac_number: '04-0005', read_ok: true, issues: [] },
  greenbook: { status: 'match', record: { ...rec, status: 'Inactive', expires: '2026-10-27' } }, visual: null });
assert.equal(r.flags, 0); assert.equal(r.score, 10);

// Non-drug product: Greenbook not applied
r = scoreCheck({ isDrug: false, label: { read_ok: true, issues: [] }, visual: { similarity: 70, differences: [{ what: 'Cap colour is lighter' }] } });
assert.equal(r.score, 12); assert.equal(r.level, 'low');
assert.ok(r.reasons.some(x => /Not covered by the Greenbook/.test(x.title)));

// Label issues are capped
r = scoreCheck({ isDrug: false, label: { issues: Array(6).fill({ title: 'x', detail: 'y' }) } });
assert.equal(r.score, 36);

// Report validation
const c = cleanReport({ product: ' Lonart DS ', state: 'Anambra', price: '1500.4', photo: 'a'.repeat(64), flags: ['a', 7, 'b'], evil: 'x' });
assert.deepEqual([c.product, c.price, c.photo, c.flags, c.evil], ['Lonart DS', 1500, 'sha256:' + 'a'.repeat(64), ['a', 'b'], undefined]);
assert.throws(() => cleanReport({ product: 'x' }), /state/);

console.log('All scoring and validation tests passed.');
