// Mock mode for local testing without network access: canned Gemini replies, a fake Greenbook
// that answers from the snapshot, and the real contract wasm running in memory.
import fs from 'node:fs';
import { createRuntime } from '../contract/runtime.mjs';

const rt = createRuntime();
let txn = 0;

export function install() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('generativelanguage.googleapis.com')) {
      const body = JSON.parse(opts.body);
      const isCompare = /Photo A was taken/.test(body.contents[0].parts[0].text);
      const out = isCompare
        ? { same_product: true, similarity: 47, differences: [{ what: 'Logo typeface is thinner', box: [80, 120, 260, 820] }, { what: 'Blue band is a lighter shade', box: [600, 0, 760, 1000] }] }
        : { is_product_photo: true, read_ok: true, category: 'drug', brand: 'Emzor', product_name: 'Paracetamol Tablets 500mg', manufacturer: 'Emzor Pharmaceutical Industries Ltd',
            nafdac_number: '04-0412', batch_number: '', expiry_date: '2027-01',
            issues: [{ title: 'Spelling error on the label', detail: '"Paracetamoll" should read "Paracetamol".' }, { title: 'No batch number', detail: 'The side of the pack where the batch number should be is blank.' }] };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }), { status: 200 });
    }
    if (u.includes('greenbook.nafdac.gov.ng')) throw new Error('offline (mock)');   // forces snapshot fallback
    return realFetch(url, opts);
  };
  process.env.GEMINI_API_KEY ||= 'mock';
  globalThis.__vnMockRelay = report => {
    const { json: id } = rt.call('submit_report', report, { caller: 'verifynaija.testnet' });
    return { id, tx: 'MOCK' + (++txn).toString().padStart(40, '0') };
  };
  // seed a few reports so the map has something on it
  const seed = [['Lonart DS Tablets', 'Anambra', 'Onitsha', 'drug'], ['Lonart DS Tablets', 'Anambra', 'Onitsha', 'drug'], ['Emzor Paracetamol', 'Lagos', 'Idumota', 'drug'],
    ['Peak milk 400g', 'Lagos', 'Oshodi', 'food'], ['Phone charger 20W', 'Lagos', 'Computer Village', 'electronics'], ['Body cream', 'Abia', 'Aba', 'personal_care'], ['Coartem', 'Kano', 'Sabon Gari', 'drug']];
  for (const [product, state, area, category] of seed) rt.call('submit_report', { product, productKey: product.toLowerCase(), state, area, category, flags: ['Seed data for local testing'] }, { caller: 'verifynaija.testnet' });
}

export function rpc(req) {
  const p = req.params;
  const args = JSON.parse(Buffer.from(p.args_base64, 'base64').toString() || '{}');
  try {
    const { ret } = rt.call(p.method_name, args);
    return { jsonrpc: '2.0', id: req.id, result: { result: [...Buffer.from(ret)], logs: [] } };
  } catch (e) { return { jsonrpc: '2.0', id: req.id, error: { message: e.message } }; }
}
