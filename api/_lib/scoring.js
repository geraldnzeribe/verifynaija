// Turns the individual checks into one risk score with plain-language reasons.
// Pure function: no network, so it is easy to test (tools/test_scoring.mjs).
//
// The score is a warning level, not a verdict. We never tell anyone a product is genuine.

const W = {
  nafdacNotFound: 35,     // number printed on a drug pack is not in the Greenbook
  nafdacMismatch: 30,     // number exists but belongs to a different product or holder
  nafdacMissing: 20,      // a medicine with no NAFDAC number visible
  regLapsed: 10,          // registration marked inactive / expired in the Greenbook
  labelIssue: 12,         // each label problem (spelling, blurry print, missing batch/expiry)
  labelIssueCap: 36,
  visualLow: 30,          // pack looks clearly different from the genuine pack
  visualMid: 12,          // some visual differences
  reportsSome: 8,         // 1-4 reports of this product in the last 30 days
  reportsMany: 15,        // 5+ reports
};

export function scoreCheck({ label = {}, greenbook = null, visual = null, reports = 0, isDrug = false }) {
  const reasons = [];
  let score = 0;
  const add = (pts, level, title, detail) => { score += pts; reasons.push({ level, title, detail }); };

  // 1. NAFDAC Greenbook
  if (isDrug) {
    if (!label.nafdac_number) {
      add(W.nafdacMissing, 'flag', 'No NAFDAC number on the pack',
        'Every medicine sold in Nigeria must show one. We couldn\'t find it in your photo. Try a clearer photo of the back of the pack.');
    } else if (greenbook && greenbook.status === 'not_found') {
      add(W.nafdacNotFound, 'flag', 'NAFDAC number not in the Greenbook',
        `${label.nafdac_number} isn't a registered number.` + (greenbook.suggestion ? ` The registered ${greenbook.suggestion.name} uses ${greenbook.suggestion.nafdac}.` : ''));
    } else if (greenbook && greenbook.status === 'mismatch') {
      add(W.nafdacMismatch, 'flag', 'NAFDAC number belongs to a different product',
        `${label.nafdac_number} is registered to "${greenbook.record.name}" by ${greenbook.record.holder}, not to what's on this pack.`);
    } else if (greenbook && greenbook.status === 'match') {
      if (greenbook.record.status !== 'Active') {
        add(W.regLapsed, 'warn', 'Registration has lapsed',
          `NAFDAC lists ${greenbook.record.name} as ${greenbook.record.status.toLowerCase()} (expired ${greenbook.record.expires}). It may be under renewal, so ask the seller.`);
      } else {
        reasons.push({ level: 'ok', title: 'NAFDAC number is registered', detail: `${label.nafdac_number} matches ${greenbook.record.name} by ${greenbook.record.holder}.` });
      }
    } else if (greenbook && greenbook.status === 'unavailable') {
      reasons.push({ level: 'info', title: 'Couldn\'t reach the Greenbook', detail: 'Check the number yourself at greenbook.nafdac.gov.ng.' });
    }
  } else {
    reasons.push({ level: 'info', title: 'Not covered by the Greenbook',
      detail: 'The Greenbook lists medicines. For other products we rely on the label, the photo comparison and buyer reports.' });
  }

  // 2. Label problems found by the AI
  const issues = (label.issues || []).filter(i => i && i.title);
  let labelPts = 0;
  for (const i of issues) {
    const pts = Math.min(W.labelIssue, W.labelIssueCap - labelPts);
    labelPts += pts;
    add(pts, 'flag', i.title, i.detail || '');
  }
  if (!issues.length && label.read_ok) {
    reasons.push({ level: 'ok', title: 'No label errors found', detail: 'No spelling mistakes, missing details or poor print spotted.' });
  }

  // 3. Visual comparison with the genuine pack
  if (visual && typeof visual.similarity === 'number') {
    const s = visual.similarity;
    const diffs = (visual.differences || []).map(d => d.what).filter(Boolean).slice(0, 3).join('; ');
    if (s < 60) add(W.visualLow, 'flag', 'Doesn\'t look like the genuine pack', diffs || `Only a ${s}% visual match.`);
    else if (s < 80) add(W.visualMid, 'warn', 'Some differences from the genuine pack', diffs || `${s}% visual match.`);
    else reasons.push({ level: 'ok', title: 'Looks like the genuine pack', detail: `${s}% visual match.` });
  } else {
    reasons.push({ level: 'info', title: 'No genuine pack to compare with yet', detail: 'We don\'t have reference photos for this product. Reporting it helps us add them.' });
  }

  // 4. Reports from other buyers (read from NEAR by the browser)
  if (reports >= 5) add(W.reportsMany, 'warn', `${reports} reports of this product`, 'Other buyers reported it as fake in the last 30 days.');
  else if (reports > 0) add(W.reportsSome, 'warn', `${reports} report${reports > 1 ? 's' : ''} of this product`, 'Another buyer reported it as fake recently.');

  score = Math.max(0, Math.min(100, score));
  const flags = reasons.filter(r => r.level === 'flag').length;
  const level = score >= 50 ? 'high' : score >= 20 ? 'medium' : 'low';
  const headline = flags ? `${flags} red flag${flags > 1 ? 's' : ''} on this pack`
    : level === 'medium' ? 'A few things to check' : 'No red flags found';
  const order = { flag: 0, warn: 1, info: 2, ok: 3 };
  reasons.sort((a, b) => order[a.level] - order[b.level]);
  return { score, level, headline, flags, reasons };
}
