// POST /api/analyze  { image: <base64 jpeg>, reports?: number }
// Reads the label, checks the Greenbook, compares with the genuine pack, and scores it.
import { readLabel, comparePacks } from './_lib/gemini.js';
import { checkGreenbook } from './_lib/greenbook.js';
import { findRef, refImageB64, refImageMime } from './_lib/references.js';
import { scoreCheck } from './_lib/scoring.js';
import { rateLimit } from './_lib/ratelimit.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  if (!rateLimit(req, 30)) return res.status(429).json({ error: 'Too many checks from this network. Try again in a few minutes.' });

  const { image, reports = 0, nafdac, name } = req.body || {};
  // Up to 3 photos of the same pack (front, back/side, another angle). `image` is kept for older clients.
  const images = (Array.isArray(req.body?.images) ? req.body.images : [image])
    .filter(x => typeof x === 'string' && x.length >= 1000).slice(0, 3);

  // Number-only check: no photo, just the NAFDAC number (and optionally the product name)
  if (!images.length && typeof nafdac === 'string' && nafdac.trim().length >= 4) {
    const label = { nafdac_number: nafdac.trim().slice(0, 20), product_name: String(name || '').slice(0, 80), issues: [] };
    const greenbook = await checkGreenbook(label);
    const result = scoreCheck({ label, greenbook, visual: undefined, reports: Number(reports) || 0, isDrug: true });
    result.reasons = result.reasons.filter(r => !/genuine pack to compare/.test(r.title));
    return res.status(200).json({ ...result, label, greenbook, visual: null, reference: null, numberOnly: true,
      productKey: (greenbook?.record?.name || name || nafdac).toLowerCase() });
  }
  if (!images.length) return res.status(400).json({ error: 'Send a photo of the pack.' });
  if (images.reduce((n, x) => n + x.length, 0) > 4_000_000) return res.status(413).json({ error: 'Those photos are too large. Try again with fewer or smaller ones.' });

  try {
    const label = await readLabel(images);
    if (!label.is_product_photo) {
      return res.status(422).json({ error: 'We couldn\'t see a product pack in that photo. Fill the frame with the front of the pack and try again.' });
    }
    const isDrug = label.category === 'drug';
    const ref = findRef(label);

    const [greenbook, visual] = await Promise.all([
      isDrug ? checkGreenbook(label) : Promise.resolve(null),
      ref ? comparePacks(images[0], refImageB64(ref), ref.name, refImageMime(ref)).catch(() => null) : Promise.resolve(null),
    ]);
    const vis = visual && visual.same_product === false ? null : visual;

    const result = scoreCheck({ label, greenbook, visual: vis, reports: Number(reports) || 0, isDrug });
    res.status(200).json({
      ...result,
      label,
      greenbook,
      visual: vis,
      photosUsed: images.length,
      reference: ref ? { id: ref.id, name: ref.name, image: ref.images[0], source: ref.source } : null,
      productKey: ref?.id || [label.brand, label.product_name].filter(Boolean).join(' ').toLowerCase().trim() || 'unknown',
    });
  } catch (e) {
    console.error(e);
    // Safe diagnostic: Gemini's own error text (never contains the API key)
    const detail = /^(Gemini|GEMINI)/.test(e.message) ? e.message.slice(0, 240) : undefined;
    res.status(502).json({ error: 'The check didn\'t finish. Try again in a moment.', detail });
  }
}
