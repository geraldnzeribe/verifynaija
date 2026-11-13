import { env } from './env.js';
// Gemini vision calls: read the label, and compare the pack with a genuine reference photo.
// Model names change over time; fall back to Google's "latest" alias if the configured one is gone.
const MODELS = [...new Set([env('GEMINI_MODEL', 'gemini-flash-latest'), 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest'])];
const URL_ = m => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
let workingModel = null;
let noThinkingOk = null;   // null = untested, false = model rejected thinkingConfig
const post = (m, key, body) => fetch(URL_(m), {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body,
  signal: AbortSignal.timeout(55000),
});

async function ask(parts, schema) {
  const key = env('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  // Reading a label doesn't need the model to "think" first; turning that off cuts response time a lot.
  // Not every model accepts the setting, so fall back to a request without it on a 400.
  const makeBody = fast => JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: schema,
      ...(fast ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
  });
  let lastErr;
  const started = Date.now();
  // Try the model that worked last time first, then the others. Busy (429/5xx) or missing (404) models are skipped.
  const order = workingModel ? [workingModel, ...MODELS.filter(m => m !== workingModel)] : MODELS;
  for (const m of order) {
    if (Date.now() - started > 40000) break;           // stay inside the 60 s function limit
    let res = await post(m, key, makeBody(noThinkingOk !== false));
    if (res.status === 400 && noThinkingOk !== false) {
      const t = await res.text();
      if (/thinking/i.test(t)) { noThinkingOk = false; res = await post(m, key, makeBody(false)); }
      else res = new Response(t, { status: 400 });
    }
    if (res.status === 503 || res.status === 429) {     // busy: one quick retry on the same model
      await new Promise(r => setTimeout(r, 700));
      res = await post(m, key, makeBody(noThinkingOk !== false));
    }
    if (res.ok) {
      workingModel = m;
      const j = await res.json();
      const text = j.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '{}';
      return JSON.parse(text);
    }
    const msg = (await res.text()).replace(/\s+/g, ' ').slice(0, 300);
    lastErr = new Error(`Gemini ${res.status} (${m}): ${msg}`);
    if (workingModel === m) workingModel = null;
    if (![404, 429, 500, 502, 503, 504].includes(res.status)) break;   // e.g. bad key: other models won't help
  }
  throw lastErr;
}

const img = (b64, mime = 'image/jpeg') => ({ inline_data: { mime_type: mime, data: b64 } });

const LABEL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_product_photo: { type: 'BOOLEAN' },
    read_ok: { type: 'BOOLEAN', description: 'true if the label text was legible enough to check' },
    category: { type: 'STRING', enum: ['drug', 'food', 'personal_care', 'electronics', 'other'] },
    brand: { type: 'STRING' },
    product_name: { type: 'STRING' },
    manufacturer: { type: 'STRING' },
    nafdac_number: { type: 'STRING', description: 'exactly as printed, e.g. 04-0411 or A4-1234; empty if none visible' },
    batch_number: { type: 'STRING' },
    expiry_date: { type: 'STRING' },
    issues: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { title: { type: 'STRING' }, detail: { type: 'STRING' } },
        required: ['title', 'detail'],
      },
    },
  },
  required: ['is_product_photo', 'read_ok', 'category', 'issues'],
};

export async function readLabel(photoB64) {
  const prompt = `You are checking a photo of a product pack bought in Nigeria for signs of counterfeiting.
Read the label and fill in the fields. Copy text exactly as printed; leave a field empty if it isn't visible.
In "issues", list ONLY concrete, visible problems a careful pharmacist would point out, such as:
- misspelled words or brand names (quote the wrong and the right spelling)
- blurry, smudged, misaligned or low-quality printing
- missing batch number, manufacture date or expiry date (only if the part of the pack that should show them is visible)
- an expiry date that has already passed (today is ${new Date().toISOString().slice(0, 10)})
- inconsistent information (different strengths, names or numbers in different places)
Each issue: a short title (max 7 words) and one sentence of detail written for an ordinary shopper.
Do not list an issue just because you are unsure. Do not guess whether the product is fake overall.`;
  return ask([{ text: prompt }, img(photoB64)], LABEL_SCHEMA);
}

const COMPARE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    same_product: { type: 'BOOLEAN', description: 'false if the photos show different products entirely' },
    similarity: { type: 'INTEGER', description: '0-100, how closely the pack in photo A matches the genuine pack in photo B' },
    differences: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          what: { type: 'STRING', description: 'one short sentence, e.g. "Logo uses a different typeface"' },
          box: { type: 'ARRAY', items: { type: 'INTEGER' }, description: '[ymin, xmin, ymax, xmax] in photo A, 0-1000' },
        },
        required: ['what'],
      },
    },
  },
  required: ['same_product', 'similarity', 'differences'],
};

export async function comparePacks(photoB64, refB64, refName, refMime = 'image/jpeg') {
  const prompt = `Photo A was taken by a shopper. Photo B is a genuine pack of "${refName}" from the manufacturer or a trusted retailer.
Compare the PACKAGING DESIGN of A against B: logo shape and typeface, colours, layout, text wording and spelling, security features, print quality.
Ignore differences caused only by lighting, camera angle, blur, background or a different pack size/strength.
Give a similarity score from 0 to 100 (100 = identical design). List up to 4 real design differences with their location in photo A.
If A and B are different products altogether, set same_product to false.`;
  return ask([{ text: prompt }, { text: 'Photo A (shopper):' }, img(photoB64), { text: 'Photo B (genuine):' }, img(refB64, refMime)], COMPARE_SCHEMA);
}
