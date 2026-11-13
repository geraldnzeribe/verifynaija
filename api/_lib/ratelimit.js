// Best-effort per-IP rate limit (per serverless instance). Enough to stop casual abuse of the demo.
const hits = new Map();
export function rateLimit(req, perTenMinutes) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  const now = Date.now(), win = 10 * 60 * 1000;
  const list = (hits.get(ip) || []).filter(t => now - t < win);
  if (list.length >= perTenMinutes) return false;
  list.push(now); hits.set(ip, list);
  return true;
}
