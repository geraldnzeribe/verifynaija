// VerifyNaija front end. No build step: plain ES module.
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Security-print rosette (the one decorative element) ---------- */
(function rosette() {
  const gcd = (a, b) => b ? gcd(b, a % b) : a; let out = '';
  [{ R: 118, r: 41, d: 62, w: .7, o: .9 }, { R: 96, r: 23, d: 44, w: .6, o: .7 }, { R: 132, r: 57, d: 20, w: .5, o: .5 }].forEach(L => {
    let p = ''; const k = (L.R - L.r) / L.r;
    for (let t = 0; t <= Math.PI * 2 * L.r / gcd(L.R, L.r) + 0.01; t += 0.02) {
      const x = 150 + (L.R - L.r) * Math.cos(t) + L.d * Math.cos(k * t), y = 150 + (L.R - L.r) * Math.sin(t) - L.d * Math.sin(k * t);
      p += (p ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    out += `<path d="${p}" fill="none" stroke="url(#holo)" stroke-width="${L.w}" opacity="${L.o}"/>`;
  });
  $('#rosette').innerHTML = out;
})();
function sealSVG() {
  const id = 'h' + Math.random().toString(36).slice(2, 7);
  return $('.hero svg.rose').outerHTML.replace('class="rose"', 'style="width:100%;height:100%"')
    .replace('id="holo"', `id="${id}"`).replaceAll('url(#holo)', `url(#${id})`);
}

/* ---------- Navigation ---------- */
function go(id) {
  $$('.screen').forEach(s => s.classList.remove('on'));
  $('#s-' + id).classList.add('on'); window.scrollTo(0, 0);
  const tab = { home: 'home', shots: 'home', nafdac: 'home', scan: 'home', result: 'home', map: 'map', mine: 'mine' }[id];
  $$('nav.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  if (id === 'map') showMap();
  if (id === 'mine') showMine();
}
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go);
  const t = e.target.closest('[data-tab]'); if (t) go(t.dataset.tab);
  const s = e.target.closest('[data-sample]'); if (s) runSample(s.dataset.sample);
});
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 2600); }
function showErr(el, msg) { el.textContent = msg; el.hidden = !msg; }

/* ---------- Config + reading reports straight from NEAR ---------- */
let CFG = { network: 'testnet', contractId: null, rpc: 'https://rpc.testnet.near.org' };
const cfgReady = fetch('/api/config').then(r => r.ok ? r.json() : CFG).then(c => {
  CFG = c;
  const chip = $('#netChip');
  chip.textContent = 'NEAR ' + c.network;
  if (c.contractId) chip.href = `https://${c.network === 'mainnet' ? '' : 'testnet.'}nearblocks.io/address/${c.contractId}`;
  if (c.contractId && $('#sideContract')) $('#sideContract').href = chip.href;
}).catch(() => {});
cfgReady.then(() => view('get_count')).then(n => { if ($('#statReports')) $('#statReports').textContent = n.toLocaleString(); }).catch(() => {});

async function view(method, args = {}) {
  await cfgReady;
  if (!CFG.contractId) throw new Error('no contract');
  const res = await fetch(CFG.rpc, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'vn', method: 'query', params: {
      request_type: 'call_function', finality: 'optimistic', account_id: CFG.contractId,
      method_name: method, args_base64: btoa(JSON.stringify(args)) } }),
  });
  const j = await res.json();
  if (j.error || j.result?.error) throw new Error(JSON.stringify(j.error || j.result.error));
  return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result)));
}

let reportsCache = null, reportsAt = 0;
async function loadReports(force) {
  if (!force && reportsCache && Date.now() - reportsAt < 60_000) return reportsCache;
  const count = await view('get_count');
  const all = [];
  for (let from = count; from >= 1 && all.length < 300; from -= 50) {
    all.push(...(await view('get_reports', { from, limit: 50 })).filter(Boolean));
  }
  reportsCache = all; reportsAt = Date.now();
  return all;
}
const DAY = 86400e9; // block timestamps are in nanoseconds
const recent = (r, days = 30) => (BigInt(Date.now()) * 1_000_000n - BigInt(r.ts)) < BigInt(days * DAY);

/* ---------- Photo handling ---------- */
async function prepPhoto(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL('image/jpeg', 0.8);
  const b64 = dataUrl.split(',')[1];
  const bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  return { dataUrl, b64, hash };
}

/* ---------- Scan flow ---------- */
let current = null;
const SLOTS = [['Front', 'Brand and product name'], ['Back or side', 'NAFDAC number'], ['Another angle', 'Batch and expiry date']];
let shots = [null, null, null], slot = 0;
function drawShots() {
  $('#shots').innerHTML = SLOTS.map(([t, hint], i) => `<div class="shot ${shots[i] ? 'filled' : ''}">
    <button class="frame" data-slot="${i}" aria-label="${shots[i] ? 'Retake' : 'Take'} photo: ${t}">
      ${shots[i] ? `<img src="${shots[i].dataUrl}" alt="">` : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'}
    </button>
    ${shots[i] ? `<button class="rm" data-rm="${i}" aria-label="Remove photo: ${t}">×</button>` : ''}
    <b>${t}${i === 0 ? '' : ' <span>(optional)</span>'}</b><span>${hint}</span></div>`).join('');
  const n = shots.filter(Boolean).length;
  $('#btnCheck').disabled = !n;
  $('#btnCheck').textContent = n > 1 ? `Check this product with ${n} photos` : 'Check this product';
}
function pick(i) { slot = i; $('#file').click(); }
$('#btnPhoto').onclick = () => { shots = [null, null, null]; showErr($('#shotErr'), ''); drawShots(); go('shots'); pick(0); };
$('#shots').onclick = e => {
  const rm = e.target.closest('[data-rm]'); if (rm) { shots[+rm.dataset.rm] = null; drawShots(); return; }
  const fr = e.target.closest('[data-slot]'); if (fr) pick(+fr.dataset.slot);
};
$('#file').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  showErr($('#shotErr'), '');
  try { shots[slot] = await prepPhoto(f); drawShots(); }
  catch { showErr($('#shotErr'), 'We couldn\'t open that photo. Try taking it again.'); }
};
$('#btnCheck').onclick = () => { const list = shots.filter(Boolean); if (list.length) runCheck(list); };
$('#nafdacForm').onsubmit = e => {
  e.preventDefault();
  runCheck(null, { nafdac: $('#regno').value.trim(), name: $('#pname').value.trim() });
};

function stepper(fast) {
  const li = $$('#steps li'); li.forEach(l => l.className = '');
  let i = 0, stopped = false;
  const tick = async () => {
    while (!stopped && i < li.length - 1) {
      if (i > 0) li[i - 1].className = 'done';
      li[i].className = 'now'; i++;
      await sleep(fast ? 300 : 2200);
    }
  };
  tick();
  return async () => {           // finish: tick remaining steps quickly
    stopped = true;
    for (let k = 0; k < li.length; k++) { if (li[k].className !== 'done') { li[k].className = 'now'; await sleep(160); li[k].className = 'done'; } }
  };
}

async function runCheck(photos, number) {
  const photo = photos?.[0];
  current = { photo, photos, number };
  $('#scanImg').innerHTML = photo ? `<img src="${photo.dataUrl}" alt="Your photo">`
    : `<div class="ph" style="display:grid;place-items:center;color:#cfe;font-size:28px;font-weight:800">${esc(number.nafdac)}</div>`;
  go('scan');
  const finish = stepper(!photo);
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(photo ? { images: photos.map(p => p.b64) } : number),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'The check didn\'t finish. Try again.');
    await addChainReports(data);
    await finish();
    current.result = data;
    showResult(data, photo?.dataUrl);
  } catch (err) {
    await finish();
    go(photo ? 'shots' : 'nafdac');
    showErr(photo ? $('#shotErr') : $('#numErr'), err.message === 'Failed to fetch' ? 'You seem to be offline. Check your connection and try again.' : err.message);
  }
}

// Count reports of the same product on NEAR and fold them into the score
async function addChainReports(data) {
  let n = 0;
  try {
    const key = (data.productKey || '').toLowerCase();
    n = (await loadReports()).filter(r => recent(r) && (r.report.productKey || '').toLowerCase() === key).length;
  } catch { return; }
  if (!n) return;
  const pts = n >= 5 ? 15 : 8;
  data.score = Math.min(100, data.score + pts);
  data.reasons.splice(data.reasons.filter(r => r.level === 'flag').length, 0,
    { level: 'warn', title: `${n} report${n > 1 ? 's' : ''} of this product`, detail: 'Other buyers reported it as fake in the last 30 days.' });
  data.level = data.score >= 40 ? 'high' : data.score >= 15 ? 'medium' : 'low';
  if (!data.flags) data.headline = data.level === 'low' ? 'No red flags found' : 'A few things to check';
}

/* ---------- Result ---------- */
const LV = { high: ['risk-high', 'var(--flag)', 'Don\'t use it until you\'ve confirmed with the seller or NAFDAC.'],
  medium: ['risk-mid', 'var(--caution)', 'Look closely at the points below before you use it.'],
  low: ['risk-low', 'var(--clear)', 'This checks the label and records. It can\'t prove a pack is genuine.'] };
const ICON = { flag: '!', warn: '?', ok: '✓', info: 'i' };

function showResult(d, photoUrl) {
  const [cls, color, sub] = LV[d.level]; const C = 2 * Math.PI * 50;
  const g = d.greenbook, rec = g?.record || g?.suggestion;
  const boxes = (d.visual?.differences || []).filter(x => Array.isArray(x.box) && x.box.length === 4).slice(0, 4)
    .map((x, i) => { const [y0, x0, y1, x1] = x.box.map(v => v / 10); return `<div class="mark" style="left:${x0}%;top:${y0}%;width:${x1 - x0}%;height:${y1 - y0}%"><i>${i + 1}</i></div>`; }).join('');
  const yours = photoUrl ? `<img src="${photoUrl}" alt="">` : (d.sampleSvg?.yours || '');
  const refImg = d.reference ? (d.sampleSvg?.ref || `<img src="${esc(d.reference.image)}" alt="">`) : '';

  $('#s-result').innerHTML = `
   <button class="back" data-go="home">‹ New check</button>
   <div class="verdict">
     <div class="ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" stroke="#D5DDD6" stroke-width="10" fill="none"/>
       <circle id="arc" cx="60" cy="60" r="50" stroke="${color}" stroke-width="10" fill="none" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}" style="transition:stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1)"/></svg>
       <div class="num"><b class="${cls}" id="scoreNum">0</b><span>risk score</span></div></div>
     <div><h2 class="${cls}">${esc(d.headline)}</h2><p>${sub}</p></div>
   </div>
   ${d.label?.product_name || d.label?.brand ? `<p class="muted" style="margin-top:14px">We read: <b style="color:var(--text)">${esc([d.label.brand, d.label.product_name].filter(Boolean).join(' · '))}</b>${d.label.nafdac_number ? ` · NAFDAC ${esc(d.label.nafdac_number)}` : ''}</p>` : ''}
   ${current?.photos?.length > 1 ? `<div class="strip">${current.photos.map(p => `<img src="${p.dataUrl}" alt="">`).join('')}</div>` : ''}
   <div class="sec"><h2>Why we scored it this way</h2>
     ${d.reasons.map(r => `<div class="reason"><span class="ic ${r.level === 'flag' ? 'flag' : r.level === 'warn' ? 'warn' : r.level === 'ok' ? 'ok' : 'info'}">${ICON[r.level]}</span><div><b>${esc(r.title)}</b><span>${esc(r.detail)}</span></div></div>`).join('')}
   </div>
   ${d.reference ? `<div class="sec"><h2>Your photo next to the genuine pack</h2>
     <div class="compare">
       <figure><div class="imgbox">${yours}${boxes}</div><figcaption>Your photo</figcaption></figure>
       <figure><div class="imgbox">${refImg}</div><figcaption>Genuine ${esc(d.reference.name)}${d.reference.source ? `, from ${esc(d.reference.source)}` : ''}</figcaption></figure>
     </div>
     ${d.visual ? `<div class="match"><span>Visual match</span><b class="${cls}">${d.visual.similarity}%</b></div>
     <div class="bar"><div id="mbar" style="width:0;background:${color}"></div></div>` : ''}
   </div>` : ''}
   ${rec ? `<div class="sec"><h2>${g.status === 'match' || g.status === 'mismatch' ? 'NAFDAC Greenbook record' : 'Registered product with this name'}</h2>
     <dl class="record">${[['Registered name', rec.name], ['Holder', rec.holder], ['NAFDAC No.', rec.nafdac], ['Strength', rec.strength], ['Status', rec.status], ['Registration expires', rec.expires]]
       .filter(x => x[1]).map(x => `<div><dt>${x[0]}</dt><dd>${esc(x[1])}</dd></div>`).join('')}</dl>
     <p class="mapnote">${g.source === 'snapshot' ? 'From our saved copy of the Greenbook.' : 'Live from greenbook.nafdac.gov.ng.'}</p>
   </div>` : ''}
   ${(d.label?.category === 'drug' || d.greenbook) ? `<div class="tip"><b>Does the pack have a scratch-off panel?</b>Many medicines carry one. Scratch it and text the code to the number printed beside it. The reply tells you if that exact pack is genuine.</div>` : ''}
   <div class="actions">
     ${d.level !== 'low' ? '<button class="btn danger" id="btnReport">Report this as fake</button>' : '<button class="btn ghost" id="btnReport">Report a problem anyway</button>'}
     <a class="share" href="https://wa.me/?text=${encodeURIComponent(shareText(d))}" target="_blank" rel="noopener">Warn others on WhatsApp</a>
     <button class="btn ghost" data-go="home">Check another product</button>
   </div>
   <p class="note">VerifyNaija flags warning signs. It never confirms a product is genuine. If you're unsure about a medicine, ask a pharmacist or call NAFDAC on 0800-162-3322.</p>`;
  go('result');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $('#arc').style.strokeDashoffset = C * (1 - d.score / 100);
    if ($('#mbar')) $('#mbar').style.width = d.visual.similarity + '%';
    let n = 0; const t = setInterval(() => { n += Math.max(1, Math.ceil(d.score / 20)); if (n >= d.score) { n = d.score; clearInterval(t); } $('#scoreNum').textContent = n; }, 45);
  }));
  $('#btnReport').onclick = () => openReport(d);
}

function shareText(d) {
  const what = [d.label?.brand, d.label?.product_name].filter(Boolean).join(' ') || 'this product';
  const top = d.reasons.filter(r => r.level === 'flag').slice(0, 2).map(r => '• ' + r.title).join('\n');
  return d.level === 'low'
    ? `I checked ${what} on VerifyNaija: no red flags found. Check your products before you buy: ${location.origin}`
    : `⚠️ VerifyNaija flagged ${what} (risk score ${d.score}/100)\n${top}\nCheck your products before you buy: ${location.origin}`;
}

/* ---------- Samples (work offline; fictional brands) ---------- */
function packSVG(kind, variant) {
  if (kind === 'clean') return `<svg viewBox="0 0 200 200" style="width:100%;height:100%"><rect width="200" height="200" fill="#F6EED8"/>
    <rect x="55" y="40" width="90" height="130" rx="10" fill="#E9B526"/><rect x="62" y="28" width="76" height="18" rx="5" fill="#1d3d8f"/>
    <circle cx="100" cy="100" r="26" fill="#fff"/><text x="100" y="106" text-anchor="middle" font-size="16" font-weight="800" fill="#1d3d8f" font-family="sans-serif">MILK</text></svg>`;
  const fake = variant === 'yours';
  return `<svg viewBox="0 0 200 200" style="width:100%;height:100%"><rect width="200" height="200" fill="${fake ? '#E2E6EC' : '#EAF1FB'}"/>
    <g transform="rotate(${fake ? -4 : 0} 100 100)"><rect x="20" y="70" width="150" height="62" rx="14" fill="${fake ? '#2C67B8' : '#1F5FBF'}"/>
    <rect x="165" y="84" width="22" height="34" rx="5" fill="#dfe6f1"/>
    <text x="40" y="100" font-size="${fake ? 15 : 16}" font-weight="800" fill="#fff" font-family="${fake ? 'serif' : 'sans-serif'}">${fake ? 'Bright smile' : 'BrightSmile'}</text>
    <text x="40" y="119" font-size="11" fill="#cfe0fa" font-family="sans-serif">${fake ? 'PRO-EXPART' : 'PRO-EXPERT'}</text>
    <circle cx="140" cy="100" r="${fake ? 9 : 11}" fill="${fake ? '#E04848' : '#E53935'}"/></g></svg>`;
}
const SAMPLES = {
  fake: { score: 74, level: 'high', flags: 3, headline: '3 red flags on this pack', productKey: 'sample-brightsmile',
    label: { brand: 'Bright smile', product_name: 'Pro-Expart toothpaste', category: 'personal_care' },
    reasons: [
      { level: 'flag', title: 'Spelling error on the label', detail: '"PRO-EXPART" should read "PRO-EXPERT".' },
      { level: 'flag', title: 'Brand name split in two', detail: 'The genuine pack prints "BrightSmile" as one word.' },
      { level: 'flag', title: 'Doesn\'t look like the genuine pack', detail: 'Logo uses a different typeface; tube colour is lighter.' },
      { level: 'info', title: 'Not covered by the Greenbook', detail: 'The Greenbook lists medicines. For other products we rely on the label, the photo comparison and buyer reports.' }],
    visual: { similarity: 41, differences: [{ what: 'Logo typeface differs', box: [450, 170, 560, 600] }, { what: 'Misspelt product line', box: [560, 170, 640, 560] }] },
    reference: { name: 'BrightSmile Pro-Expert (sample)', source: 'the maker\'s site' } },
  clean: { score: 4, level: 'low', flags: 0, headline: 'No red flags found', productKey: 'sample-sunrise-milk',
    label: { brand: 'Sunrise', product_name: 'Evaporated milk 160g', category: 'food' },
    reasons: [
      { level: 'ok', title: 'No label errors found', detail: 'No spelling mistakes, missing details or poor print spotted.' },
      { level: 'ok', title: 'Looks like the genuine pack', detail: '92% visual match.' },
      { level: 'info', title: 'Not covered by the Greenbook', detail: 'The Greenbook lists medicines. For other products we rely on the label, the photo comparison and buyer reports.' }],
    visual: { similarity: 92, differences: [] }, reference: { name: 'Sunrise milk (sample)', source: 'the maker\'s site' } },
};
async function runSample(kind) {
  const d = structuredClone(SAMPLES[kind]);
  d.sampleSvg = { yours: packSVG(kind, 'yours'), ref: packSVG(kind, 'ref') };
  $('#scanImg').innerHTML = `<div class="ph">${d.sampleSvg.yours}</div>`;
  go('scan'); const finish = stepper(true); await sleep(900); await finish();
  current = { result: d, sample: true };
  showResult(d);
}

/* ---------- Report drawer ---------- */
const STATES = { 'Abia': [5.45, 7.52], 'Adamawa': [9.33, 12.4], 'Akwa Ibom': [5.0, 7.85], 'Anambra': [6.21, 6.94], 'Bauchi': [10.31, 9.84], 'Bayelsa': [4.77, 6.07],
  'Benue': [7.34, 8.74], 'Borno': [11.83, 13.15], 'Cross River': [5.87, 8.6], 'Delta': [5.7, 6.0], 'Ebonyi': [6.26, 8.01], 'Edo': [6.63, 5.93], 'Ekiti': [7.72, 5.31],
  'Enugu': [6.54, 7.43], 'FCT Abuja': [8.89, 7.18], 'Gombe': [10.29, 11.17], 'Imo': [5.57, 7.06], 'Jigawa': [12.23, 9.56], 'Kaduna': [10.38, 7.71], 'Kano': [11.75, 8.52],
  'Katsina': [12.37, 7.6], 'Kebbi': [11.5, 4.2], 'Kogi': [7.73, 6.69], 'Kwara': [8.97, 4.39], 'Lagos': [6.52, 3.38], 'Nasarawa': [8.54, 8.32], 'Niger': [9.93, 5.6],
  'Ogun': [6.99, 3.47], 'Ondo': [7.1, 4.84], 'Osun': [7.56, 4.52], 'Oyo': [8.16, 3.61], 'Plateau': [9.22, 9.52], 'Rivers': [4.84, 6.92], 'Sokoto': [13.06, 5.24],
  'Taraba': [7.99, 10.77], 'Yobe': [12.29, 11.44], 'Zamfara': [12.12, 6.22] };
let lastState = '';
try { lastState = localStorage.getItem('vn.state') || ''; } catch {}

function openReport(d) {
  const dr = $('#drawer');
  const product = [d.label?.brand, d.label?.product_name].filter(Boolean).join(' ') || d.greenbook?.record?.name || '';
  dr.innerHTML = `<div class="grab"></div><h3 id="dtitle">Report this product</h3>
   <form id="rform">
    <label class="f" for="rprod">Product</label>
    <input class="input" id="rprod" value="${esc(product)}" required maxlength="80">
    <div class="row">
      <div style="flex:1"><label class="f" for="rstate">State</label>
        <select class="input" id="rstate" required><option value="">Choose…</option>${Object.keys(STATES).map(s => `<option ${s === lastState ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div style="flex:1"><label class="f" for="rarea">Town or area</label><input class="input" id="rarea" placeholder="e.g. Onitsha" maxlength="50"></div>
    </div>
    <label class="f" for="rshop">Where did you buy it?</label>
    <input class="input" id="rshop" placeholder="e.g. Main Market, stall 14" maxlength="80">
    <label class="f" for="rprice">Price paid (₦) <span class="muted" style="font-weight:400">(optional)</span></label>
    <input class="input" id="rprice" inputmode="numeric" placeholder="1,200">
    <label class="f" for="rnote">Anything else? <span class="muted" style="font-weight:400">(optional)</span></label>
    <textarea class="input" id="rnote" rows="2" maxlength="200" placeholder="Taste, smell, packaging, how it was sold"></textarea>
    <p class="note">Your report is stored publicly on NEAR with the product, place and a fingerprint of your photo. Your name and phone number are never stored.</p>
    <div style="height:14px"></div>
    <button class="btn danger" type="submit">Submit report</button>
    <p class="err" id="rErr" role="alert" hidden></p>
   </form>`;
  $('#ov').classList.add('on'); dr.classList.add('on');
  $('#rform').onsubmit = e => { e.preventDefault(); submitReport(d); };
}
function closeDrawer() { $('#ov').classList.remove('on'); $('#drawer').classList.remove('on'); }
$('#ov').onclick = closeDrawer;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

async function submitReport(d) {
  const body = {
    product: $('#rprod').value, productKey: d.productKey, category: d.label?.category || (d.greenbook ? 'drug' : 'other'),
    state: $('#rstate').value, area: $('#rarea').value, shop: $('#rshop').value,
    price: $('#rprice').value.replace(/[^\d]/g, ''), note: $('#rnote').value, score: d.score,
    flags: d.reasons.filter(r => r.level === 'flag').map(r => r.title), nafdac: d.label?.nafdac_number || '',
    photo: current?.photo?.hash,
  };
  try { localStorage.setItem('vn.state', body.state); } catch {}
  lastState = body.state;
  const btn = $('#rform button[type=submit]'); btn.disabled = true; btn.textContent = 'Saving to NEAR…';
  try {
    if (current?.sample) throw new Error('Sample checks can\'t be reported. Check a real product first.');
    const res = await fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error);
    saveMine({ ...out, product: body.product, state: body.state, area: body.area, at: Date.now() });
    reportsCache = null;
    $('#drawer').innerHTML = `<div class="grab"></div><div class="receipt">
      <div class="seal">${sealSVG()}</div>
      <h3>Report saved</h3>
      <p class="muted" style="margin-top:6px">Report #${out.id ?? ''} is now on NEAR and counts towards the ${esc(body.state)} hotspot.</p>
      <code>Transaction ${esc(out.tx)}</code>
      <a class="chainlink" href="${esc(out.explorer)}" target="_blank" rel="noopener">View it on the NEAR explorer</a>
      <div style="height:14px"></div>
      <button class="btn primary" id="seeMap">See hotspots</button></div>`;
    $('#seeMap').onclick = () => { closeDrawer(); go('map'); };
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Submit report';
    showErr($('#rErr'), err.message === 'Failed to fetch' ? 'You seem to be offline. Try again when you\'re connected.' : err.message);
  }
}

function getMine() { try { return JSON.parse(localStorage.getItem('vn.mine') || '[]'); } catch { return []; } }
function saveMine(r) { try { localStorage.setItem('vn.mine', JSON.stringify([r, ...getMine()].slice(0, 50))); } catch {} }
function showMine() {
  const m = getMine();
  $('#mine').innerHTML = m.length ? m.map(r => `<div class="reason"><span class="ic flag">!</span><div><b>${esc(r.product)}</b>
    <span>${esc([r.area, r.state].filter(Boolean).join(', '))} · ${new Date(r.at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })} ·
    <a class="chainlink" href="${esc(r.explorer)}" target="_blank" rel="noopener">report #${esc(r.id)}</a></span></div></div>`).join('')
    : '<p class="empty">You haven\'t reported anything yet. When a check flags a product, tap "Report this as fake".</p>';
}

/* ---------- Hotspot map ---------- */
const BORDER = [[2.69, 6.37], [2.72, 9.0], [3.6, 10.3], [3.6, 11.7], [4.1, 13.5], [5.4, 13.9], [6.4, 13.6], [7.8, 13.3], [9.0, 12.8], [10.6, 13.3], [12.3, 13.1], [13.6, 13.7], [14.2, 12.4], [14.6, 11.5], [13.8, 10.4], [13.2, 9.5], [12.4, 8.4], [11.7, 7.0], [10.6, 7.0], [9.8, 6.2], [8.5, 4.6], [7.0, 4.4], [5.9, 4.3], [5.0, 5.6], [4.3, 6.3]];
const P = (lon, lat) => [20 + (lon - 2.5) / (14.8 - 2.5) * 320, 285 - (lat - 4.1) / (14.0 - 4.1) * 270];
function inPoly(x, y, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c; } return c; }
let dots = null, filter = 'all';
function baseDots() {
  if (dots) return dots;
  const poly = BORDER.map(([lo, la]) => P(lo, la)); let s = '';
  for (let x = 14; x < 350; x += 7) for (let y = 10; y < 292; y += 7) if (inPoly(x, y, poly)) s += `<circle cx="${x}" cy="${y}" r="1.6" fill="#C9D4CC"/>`;
  return dots = s;
}
$('#filters').onclick = e => { const b = e.target.closest('button'); if (!b) return; filter = b.dataset.f; $$('#filters button').forEach(x => x.classList.toggle('on', x === b)); showMap(); };

async function showMap() {
  $('#map').innerHTML = baseDots();
  $('#mapNote').textContent = 'Loading reports from NEAR…';
  let reps;
  try { reps = await loadReports(); }
  catch { $('#mapNote').textContent = 'Couldn\'t load reports from NEAR right now.'; $('#hotlist').innerHTML = ''; $('#latest').innerHTML = ''; return; }
  const rows = reps.filter(r => recent(r) && (filter === 'all' || r.report.category === filter));
  const by = {};
  for (const r of rows) { const s = r.report.state; if (!STATES[s]) continue; (by[s] ||= { n: 0, areas: {} }).n++; const a = r.report.area; if (a) by[s].areas[a] = (by[s].areas[a] || 0) + 1; }
  const list = Object.entries(by).map(([s, v]) => ({ s, n: v.n, area: Object.entries(v.areas).sort((a, b) => b[1] - a[1])[0]?.[0] })).sort((a, b) => b.n - a.n);
  let svg = baseDots();
  list.slice().reverse().forEach(({ s, n }, i) => {
    const [lat, lon] = STATES[s]; const [x, y] = P(lon, lat); const r = 4 + Math.sqrt(n) * 2.6;
    svg += `<circle class="hot" cx="${x}" cy="${y}" r="${r}" fill="#D23A3A"/><circle cx="${x}" cy="${y}" r="${r}" fill="#D23A3A" fill-opacity=".85" stroke="#fff" stroke-width="1.5"/>`;
  });
  list.slice(0, 3).forEach(({ s, n }) => { const [lat, lon] = STATES[s]; const [x, y] = P(lon, lat); svg += `<text x="${x + 6 + Math.sqrt(n) * 2.6}" y="${y + 4}" font-size="11" font-weight="700" fill="#16231D">${esc(s)}</text>`; });
  $('#map').innerHTML = svg;
  $('#mapNote').textContent = `${rows.length} report${rows.length === 1 ? '' : 's'} in the last 30 days, read live from contract ${CFG.contractId}.`;
  $('#hotlist').innerHTML = list.slice(0, 6).map(r => `<div class="it"><div><b>${esc(r.s)}</b><span>${esc(r.area || '')}</span></div><span class="n">${r.n}</span></div>`).join('')
    || '<p class="empty">No reports here yet. Be the first: check a product and report it if it\'s flagged.</p>';
  $('#latest').innerHTML = rows.slice(0, 8).map(r => `<div class="reason"><span class="ic flag">!</span><div><b>${esc(r.report.product)}</b>
    <span>${esc([r.report.area, r.report.state].filter(Boolean).join(', '))} · ${new Date(Number(BigInt(r.ts) / 1_000_000n)).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}${r.report.flags?.length ? ' · ' + esc(r.report.flags[0]) : ''}</span></div></div>`).join('');
}
