// POST /api/report  — saves a counterfeit report on NEAR.
// The server relays the transaction and pays the gas, so shoppers don't need a crypto wallet.
// The contract stamps the block time; the report body is validated and trimmed here first.
import { connect, keyStores, KeyPair } from 'near-api-js';
import { rateLimit } from './_lib/ratelimit.js';

const NETWORK = process.env.NEAR_NETWORK || 'testnet';
const NODE = process.env.NEAR_RPC || (NETWORK === 'mainnet' ? 'https://rpc.mainnet.near.org' : 'https://rpc.testnet.near.org');
const CATEGORIES = ['drug', 'food', 'personal_care', 'electronics', 'other'];

const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');

export function cleanReport(b = {}) {
  const r = {
    product: str(b.product, 80),
    productKey: str(b.productKey, 80).toLowerCase(),
    category: CATEGORIES.includes(b.category) ? b.category : 'other',
    state: str(b.state, 30),
    area: str(b.area, 50),
    shop: str(b.shop, 80),
    price: Number.isFinite(+b.price) && +b.price > 0 ? Math.min(Math.round(+b.price), 10_000_000) : undefined,
    score: Number.isFinite(+b.score) ? Math.max(0, Math.min(100, Math.round(+b.score))) : undefined,
    flags: Array.isArray(b.flags) ? b.flags.slice(0, 6).map(f => str(f, 60)).filter(Boolean) : [],
    nafdac: str(b.nafdac, 20),
    photo: /^[a-f0-9]{64}$/.test(b.photo || '') ? 'sha256:' + b.photo : undefined,
    note: str(b.note, 200),
  };
  if (!r.product || !r.state) throw new Error('Add the product and the state where you bought it.');
  return r;
}

let accountP = null;
async function relayer() {
  if (!accountP) {
    const id = process.env.NEAR_ACCOUNT_ID, key = process.env.NEAR_PRIVATE_KEY;
    if (!id || !key) throw new Error('NEAR relayer is not configured');
    const ks = new keyStores.InMemoryKeyStore();
    await ks.setKey(NETWORK, id, KeyPair.fromString(key));
    const near = await connect({ networkId: NETWORK, nodeUrl: NODE, keyStore: ks });
    accountP = near.account(id);
  }
  return accountP;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  if (!rateLimit(req, 10)) return res.status(429).json({ error: 'You\'ve sent a lot of reports. Try again in a few minutes.' });
  let report;
  try { report = cleanReport(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    if (globalThis.__vnMockRelay) {            // local mock mode only (tools/mocks.mjs)
      const m = globalThis.__vnMockRelay(JSON.parse(JSON.stringify(report)));
      return res.status(200).json({ ...m, network: 'mock', explorer: '#' });
    }
    const account = await relayer();
    const out = await account.functionCall({
      contractId: process.env.NEAR_CONTRACT_ID || process.env.NEAR_ACCOUNT_ID,
      methodName: 'submit_report',
      args: JSON.parse(JSON.stringify(report)),        // drop undefined fields
      gas: 30_000_000_000_000n,
    });
    const b64 = out.status?.SuccessValue;
    const id = b64 ? Number(Buffer.from(b64, 'base64').toString()) : null;
    res.status(200).json({ id, tx: out.transaction.hash, network: NETWORK,
      explorer: `https://${NETWORK === 'mainnet' ? '' : 'testnet.'}nearblocks.io/txns/${out.transaction.hash}` });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: 'Your report wasn\'t saved. Check your connection and try again.' });
  }
}
