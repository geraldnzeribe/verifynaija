// POST /api/analyze  { image: <base64 jpeg>, reports?: number }
// Reads the label, checks the Greenbook, compares with the genuine pack, and scores it.
import { readLabel, comparePacks } from './_lib/gemini.js';
import { checkGreenbook } from './_lib/greenbook.js';
import { findRef, refImageB64 } from './_lib/references.js';
import { scoreCheck } from './_lib/scoring.js';
import { rateLimit } from './_lib/ratelimit.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  if (!rateLimit(req, 30)) return res.status(429).json({ error: 'Too many checks from this network. Try again in a few minutes.' });

  const { image, reports = 0, nafdac, name } = req.body || {};

  // Number-only check: no photo, just the NAFDAC number (and optionally the product name)
  if (!image && typeof nafdac === 'string' && nafdac.trim().length >= 4) {
    const label = { nafdac_number: nafdac.trim().slice(0, 20), product_name: String(name || '').slice(0, 80), issues: [] };
    const greenbook = await checkGreenbook(label);
    const result = scoreCheck({ label, greenbook, visual: undefined, reports: Number(reports) || 0, isDrug: true });
    result.reasons = result.reasons.filter(r => !/genuine pack to compare/.test(r.title));
    return res.status(200).json({ ...result, label, greenbook, visual: null, reference: null, numberOnly: true,
      productKey: (greenbook?.record?.name || name || nafdac).toLowerCase() });
  }
  if (typeof image !== 'string' || image.length < 1000) return res.status(400).json({ error: 'Send a photo of the pack.' });
  if (image.length > 6_000_000) return res.status(413).json({ error: 'That photo is too large. Try again with a smaller one.' });

  try {
    const label = await readLabel(image);
    if (!label.is_product_photo) {
      return res.status(422).json({ error: 'We couldn\'t see a product pack in that photo. Fill the frame with the front of the pack and try again.' });
    }
    const isDrug = label.category === 'drug';
    const ref = findRef(label);

    const [greenbook, visual] = await Promise.all([
      isDrug ? checkGreenbook(label) : Promise.resolve(null),
      ref ? comparePacks(image, refImageB64(ref), ref.name).catch(() => null) : Promise.resolve(null),
    ]);
    const vis = visual && visual.same_product === false ? null : visual;

    const result = scoreCheck({ label, greenbook, visual: vis, reports: Number(reports) || 0, isDrug });
    res.status(200).json({
      ...result,
      label,
      greenbook,
      visual: vis,
      reference: ref ? { id: ref.id, name: ref.name, image: ref.images[0], source: ref.source } : null,
      productKey: ref?.id || [label.brand, label.product_name].filter(Boolean).join(' ').toLowerCase().trim() || 'unknown',
    });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: 'The check didn\'t finish. Try again in a moment.' });
  }
}
