// GET /api/greenbook?q=<NAFDAC number or product name>
import { searchGreenbook } from './_lib/greenbook.js';
import { rateLimit } from './_lib/ratelimit.js';

export default async function handler(req, res) {
  const q = String(req.query.q || '').trim().slice(0, 60);
  if (q.length < 3) return res.status(400).json({ error: 'Type at least 3 characters.' });
  if (!rateLimit(req, 60)) return res.status(429).json({ error: 'Too many searches. Try again in a few minutes.' });
  res.setHeader('Cache-Control', 's-maxage=3600');
  res.status(200).json(await searchGreenbook(q));
}
