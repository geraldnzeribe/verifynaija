// Gemini vision calls: read the label, and compare the pack with a genuine reference photo.
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const URL_ = m => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

async function ask(parts, schema) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  const res = await fetch(URL_(MODEL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: schema },
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const text = j.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '{}';
  return JSON.parse(text);
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

export async function comparePacks(photoB64, refB64, refName) {
  const prompt = `Photo A was taken by a shopper. Photo B is a genuine pack of "${refName}" from the manufacturer or a trusted retailer.
Compare the PACKAGING DESIGN of A against B: logo shape and typeface, colours, layout, text wording and spelling, security features, print quality.
Ignore differences caused only by lighting, camera angle, blur, background or a different pack size/strength.
Give a similarity score from 0 to 100 (100 = identical design). List up to 4 real design differences with their location in photo A.
If A and B are different products altogether, set same_product to false.`;
  return ask([{ text: prompt }, { text: 'Photo A (shopper):' }, img(photoB64), { text: 'Photo B (genuine):' }, img(refB64)], COMPARE_SCHEMA);
}
