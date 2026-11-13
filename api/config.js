// GET /api/config — public settings the browser needs to read reports straight from NEAR.
export default function handler(req, res) {
  const network = process.env.NEAR_NETWORK || 'testnet';
  res.setHeader('Cache-Control', 's-maxage=300');
  res.status(200).json({
    network,
    contractId: process.env.NEAR_CONTRACT_ID || process.env.NEAR_ACCOUNT_ID || null,
    rpc: process.env.NEAR_RPC_PUBLIC || (network === 'mainnet' ? 'https://rpc.mainnet.near.org' : 'https://rpc.testnet.near.org'),
  });
}
