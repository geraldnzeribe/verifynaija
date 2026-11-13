// Local test harness: runs the compiled contract against a mock NEAR runtime.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const bytes = fs.readFileSync(new URL('./verifynaija.wasm', import.meta.url));
const mod = new WebAssembly.Module(bytes);
console.log('imports:', WebAssembly.Module.imports(mod).map(i => `${i.module}.${i.name}`).join(', '));
console.log('exports:', WebAssembly.Module.exports(mod).map(e => e.name).join(', '));

import { createRuntime } from './runtime.mjs';
const { call } = createRuntime();

// --- tests ---
assert.equal(call('get_count', {}).json, 0);
assert.deepEqual(call('get_reports', {}).json, []);

const r1 = { product: 'BrightSmile Pro-Expert 75ml', category: 'care', state: 'Anambra', city: 'Onitsha',
  shop: 'Main Market "stall 14"', price: 1200, flags: ['nafdac_not_found', 'spelling'], photo: 'sha256:abc' };
const s1 = call('submit_report', r1, { caller: 'gerald.testnet', ts: 1763000000000000000n });
assert.equal(s1.json, 1);
assert.match(s1.logs[0], /EVENT_JSON/);
call('submit_report', { product: 'Sunrise milk', state: 'Lagos' }, { caller: 'bola.testnet' });
assert.equal(call('get_count', {}).json, 2);

const list = call('get_reports', { limit: 10 }).json;
assert.equal(list.length, 2);
assert.equal(list[0].id, 2);                       // newest first
assert.equal(list[1].by, 'gerald.testnet');        // reporter stamped by contract
assert.equal(list[1].report.shop, 'Main Market "stall 14"');
assert.equal(list[1].confirms, 0);

assert.equal(call('confirm_report', { id: 1 }, { caller: 'bola.testnet' }).json, 1);
assert.equal(call('confirm_report', { id: 1 }, { caller: 'chidi.testnet' }).json, 2);
assert.throws(() => call('confirm_report', { id: 1 }, { caller: 'chidi.testnet' }), /already confirmed/);
assert.throws(() => call('confirm_report', { id: 9 }), /no such report/);
assert.equal(call('get_report', { id: 1 }).json.confirms, 2);
assert.equal(call('get_report', { id: 7 }).json, null);

assert.throws(() => call('submit_report', '"not an object"'), /JSON object/);
assert.throws(() => call('submit_report', { x: 'y'.repeat(2000) }), /too large/);

// pagination
for (let i = 0; i < 60; i++) call('submit_report', { product: 'p' + i, state: 'Kano' });
const page = call('get_reports', { from: 62, limit: 100 }).json;
assert.equal(page.length, 50);                     // capped at MAX_LIMIT
assert.equal(call('get_reports', { from: 2, limit: 5 }).json.length, 2);

console.log('All contract tests passed.');
