/* HeatProof core v2.0.0 — pure functions, no DOM. Works in browser (window.HP) and Node. */
(function (root) {
'use strict';
const VERSION = '2.0.0';
const T975 = [0,12.706,4.303,3.182,2.776,2.571,2.447,2.365,2.306,2.262,2.228,2.201,2.179,2.160,2.145,2.131,2.120,2.110,2.101,2.093,2.086,2.080,2.074,2.069,2.064,2.060,2.056,2.052,2.048,2.045,2.042];
const tcrit = df => df < 1 ? NaN : df <= 30 ? T975[Math.floor(df)] : 1.96;
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const vari = a => { if (a.length < 2) return NaN; const m = mean(a); return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1); };
const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const r = (x, d = 3) => Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null;

function splitCSVLine(line) { // RFC4180-style: quoted fields, "" escapes
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  out.push(cur.trim()); return out;
}
function validDate(s) { // calendar dates only (YYYY-MM-DD); no time zone conversion is ever applied
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z'); return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
const dayNum = s => Date.parse(s + 'T00:00:00Z') / 864e5;

/** Parse + validate. Never silently fixes values: every problem becomes an issue. */
function parseCSV(text) {
  const issues = [], rows = [];
  const add = (level, code, msg) => issues.push({ level, code, msg });
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) { add('error', 'EMPTY', 'File is empty.'); return { rows, issues }; }
  const head = splitCSVLine(lines[0]).map(h => h.toLowerCase());
  for (const k of ['site', 'date', 'group', 'surface_temp_c']) if (!head.includes(k)) add('error', 'MISSING_COLUMN', `Missing required column "${k}".`);
  if (issues.length) return { rows, issues };
  let bad = 0, missing = 0;
  lines.slice(1).forEach((line, i) => {
    const v = splitCSVLine(line), o = {}; head.forEach((h, j) => o[h] = (v[j] || '').trim());
    const ln = i + 2, g = o.group.toLowerCase();
    if (!o.site) { add('error', 'NO_SITE', `Row ${ln}: empty site.`); bad++; return; }
    if (!validDate(o.date)) { add('error', 'BAD_DATE', `Row ${ln}: invalid date "${o.date}" (use YYYY-MM-DD).`); bad++; return; }
    if (g !== 'treatment' && g !== 'control') { add('error', 'BAD_GROUP', `Row ${ln}: group must be "treatment" or "control", got "${o.group}".`); bad++; return; }
    if (o.unit && !/^(c|°c|celsius)$/i.test(o.unit)) { add('error', 'BAD_UNIT', `Row ${ln}: unit "${o.unit}" not supported; only Celsius (surface_temp_c).`); bad++; return; }
    if (o.surface_temp_c === '') { missing++; rows.push({ site: o.site, date: o.date, group: g, temp: null, meta: o }); return; }
    const t = Number(o.surface_temp_c);
    if (!Number.isFinite(t) || t < -60 || t > 90) { add('error', 'BAD_TEMP', `Row ${ln}: temperature "${o.surface_temp_c}" is not a plausible °C value (−60 to 90).`); bad++; return; }
    rows.push({ site: o.site, date: o.date, group: g, temp: t, meta: o });
  });
  if (missing) add('warn', 'MISSING_VALUES', `${missing} row(s) have an empty temperature; they are kept as missing and excluded from means.`);
  if (bad) add('warn', 'ROWS_REJECTED', `${bad} row(s) rejected and NOT used in analysis.`);
  return { rows, issues };
}

/** Data-quality scan. Outliers use the modified z-score (Iglewicz & Hoaglin; |M|>3.5) per site; flagged only, never removed. */
function validate(rows) {
  const f = [], add = (level, code, msg) => f.push({ level, code, msg });
  const seen = new Map();
  rows.forEach(x => { const k = `${x.site}|${x.date}`; seen.set(k, (seen.get(k) || 0) + 1); });
  const dups = [...seen.entries()].filter(([, n]) => n > 1);
  if (dups.length) add('warn', 'DUPLICATES', `${dups.length} site/date pair(s) have duplicate records (e.g. ${dups[0][0].replace('|', ' on ')}); duplicates are averaged.`);
  const outliers = [];
  for (const site of new Set(rows.map(x => x.site))) {
    const rs = rows.filter(x => x.site === site && x.temp !== null), vals = rs.map(x => x.temp);
    if (vals.length < 5) continue;
    const med = median(vals), mad = median(vals.map(x => Math.abs(x - med)));
    if (mad === 0) continue;
    rs.forEach(x => { if (Math.abs(0.6745 * (x.temp - med) / mad) > 3.5) outliers.push(x); });
  }
  if (outliers.length) add('warn', 'OUTLIERS', `${outliers.length} possible outlier(s) flagged for investigation (not removed): ` + outliers.slice(0, 3).map(o => `${o.site} ${o.date} ${o.temp}°C`).join('; ') + '.');
  const sites = {}; rows.forEach(x => (sites[x.group] = sites[x.group] || new Set()).add(x.site));
  const nT = (sites.treatment || new Set()).size, nC = (sites.control || new Set()).size;
  if (!nT || !nC) add('error', 'MISSING_GROUP', 'Both a treatment and a control group are required.');
  else if (nT !== nC) add('info', 'UNEVEN_SITES', `Uneven groups: ${nT} treatment vs ${nC} control site(s).`);
  const dates = [...new Set(rows.map(x => x.date))].sort();
  if (dates.length > 2) { const gaps = dates.slice(1).map((d, i) => dayNum(d) - dayNum(dates[i])), m = median(gaps);
    const big = gaps.filter(g => g > 2 * m).length; if (big) add('warn', 'DATE_GAPS', `${big} gap(s) in the observation calendar are more than twice the median interval (${m} days).`); }
  const miss = rows.filter(x => x.temp === null).length;
  return { findings: f, outliers, siteCounts: { treatment: nT, control: nC }, missing: miss };
}

/** Collapse to a per-date series: mean over sites (duplicates averaged within site first). */
function buildSeries(rows) {
  const cell = {};
  rows.filter(x => x.temp !== null).forEach(x => { ((cell[x.date] = cell[x.date] || {})[x.group] = cell[x.date][x.group] || {})[x.site] = (cell[x.date][x.group][x.site] || []).concat(x.temp); });
  return Object.keys(cell).sort().map(date => {
    const g = k => { const s = cell[date][k]; return s ? mean(Object.values(s).map(mean)) : NaN; };
    const t = g('treatment'), c = g('control');
    return { date, treatment: t, control: c, gap: t - c, nT: Object.keys(cell[date].treatment || {}).length, nC: Object.keys(cell[date].control || {}).length };
  });
}

function welchDiff(a, b) { // mean(b)-mean(a) with 95% CI; NaN if too few
  const d = mean(b) - mean(a), se = Math.sqrt(vari(a) / a.length + vari(b) / b.length);
  if (!Number.isFinite(se) || a.length < 2 || b.length < 2) return { est: d, lo: NaN, hi: NaN, se: NaN };
  const va = vari(a) / a.length, vb = vari(b) / b.length, df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1));
  const t = tcrit(df); return { est: d, lo: d - t * se, hi: d + t * se, se, df };
}
function slope(xs, ys) {
  const n = xs.length, mx = mean(xs), my = mean(ys);
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0), b = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / sxx;
  if (n < 4 || !sxx) return { b, lo: NaN, hi: NaN };
  const res = ys.reduce((s, y, i) => s + (y - my - b * (xs[i] - mx)) ** 2, 0), se = Math.sqrt(res / (n - 2) / sxx), t = tcrit(n - 2);
  return { b, lo: b - t * se, hi: b + t * se };
}

const MIN_PERIOD = 4; // dates per period required before an interval is reported

/**
 * Difference-in-differences on the per-date treatment−control gap series:
 * DiD = mean(gap_post) − mean(gap_pre) = (T_post−T_pre) − (C_post−C_pre). Dates on/after the intervention date are "post".
 * Uncertainty: Welch 95% CI across dates (assumes roughly independent dates; autocorrelation makes it optimistic).
 */
function analyze(rows, opts) {
  const meta = opts || {}, date = meta.date;
  if (!validDate(date || '')) throw new Error('A valid intervention date (YYYY-MM-DD) is required.');
  const val = validate(rows), series = buildSeries(rows).filter(s => Number.isFinite(s.gap));
  const pre = series.filter(s => s.date < date), post = series.filter(s => s.date >= date);
  const out = { version: VERSION, intervention_date: date, validation: val, series, n_pre: pre.length, n_post: post.length };
  if (pre.length < 1 || post.length < 1) { out.error = 'Need at least one date with both groups observed before AND on/after the intervention date.'; out.evidence = scoreEvidence(out, meta); out.analyst = explain(out, meta); return out; }
  const m = k => ({ before: mean(pre.map(s => s[k])), after: mean(post.map(s => s[k])) });
  const T = m('treatment'), C = m('control');
  out.means = { treatment: T, control: C };
  out.treatment_change = T.after - T.before; out.control_change = C.after - C.before;
  out.did = out.treatment_change - out.control_change;
  const w = welchDiff(pre.map(s => s.gap), post.map(s => s.gap));
  out.inference = pre.length >= MIN_PERIOD && post.length >= MIN_PERIOD && Number.isFinite(w.lo)
    ? { type: 'interval', lo: w.lo, hi: w.hi, excludes_zero: w.lo > 0 || w.hi < 0 } : { type: 'descriptive', reason: `Fewer than ${MIN_PERIOD} dates in the pre or post period; no interval is reported.` };
  // Pre-trend of the gap
  if (pre.length >= MIN_PERIOD) { const s = slope(pre.map(p => dayNum(p.date)), pre.map(p => p.gap)); out.pretrend = { slope_per_week: s.b * 7, lo: s.lo * 7, hi: s.hi * 7, diverging: s.lo > 0 || s.hi < 0 }; } else out.pretrend = null;
  // Placebo: pretend the intervention happened at the middle of the pre-period (pre-data only)
  if (pre.length >= 2 * 2 && pre.length >= 4) { const h = Math.floor(pre.length / 2), p = mean(pre.slice(h).map(s => s.gap)) - mean(pre.slice(0, h).map(s => s.gap));
    out.placebo = { did: p, fake_date: pre[h].date, comparable_to_real: Math.abs(p) >= 0.5 * Math.abs(out.did) && Math.abs(out.did) > 0 }; } else out.placebo = null;
  // Sensitivity: drop k dates nearest the intervention on each side
  out.sensitivity = [0, 1, 2].map(k => { const a = pre.slice(0, pre.length - k), b = post.slice(k); if (!a.length || !b.length) return null; return { trim: k, did: mean(b.map(s => s.gap)) - mean(a.map(s => s.gap)) }; }).filter(Boolean);
  out.sign_stable = out.sensitivity.every(s => Math.sign(s.did) === Math.sign(out.did));
  out.evidence = scoreEvidence(out, meta); out.analyst = explain(out, meta);
  return out;
}

/**
 * Evidence-completeness score (0–100). NOT a statistical confidence and NOT the probability that the intervention worked.
 * Each component is 0–1 with a documented rule; the score is their equal-weight mean (a transparent heuristic, not a validated metric).
 * Components that cannot be computed are listed as "unscored" instead of guessed.
 */
function scoreEvidence(a, meta) {
  const c = [], un = [], v = a.validation;
  c.push({ name: 'Observation dates', value: Math.min(1, (Math.min(a.n_pre, 8) + Math.min(a.n_post, 8)) / 16), rule: 'min(pre,8)+min(post,8) over 16' });
  const s = v.siteCounts; c.push({ name: 'Site coverage', value: Math.min(1, Math.min(s.treatment, s.control, 3) / 3), rule: 'smallest group size, capped at 3 sites' });
  const rows = (meta.rows || []), sites = new Set(rows.map(x => x.site)).size, dates = new Set(rows.map(x => x.date)).size;
  if (rows.length && sites && dates) c.push({ name: 'Completeness', value: Math.min(1, rows.filter(x => x.temp !== null).length / (sites * dates)), rule: 'valid site-date cells over full site×date grid' });
  else un.push('Completeness');
  const dq = 1 - Math.min(1, (v.findings.filter(f => f.level === 'warn').length) / 4);
  c.push({ name: 'Data-quality flags', value: dq, rule: '1 − (warnings/4), floor 0' });
  if (a.pretrend) c.push({ name: 'Pre-period comparability', value: a.pretrend.diverging ? 0.2 : (a.placebo && a.placebo.comparable_to_real ? 0.5 : 1), rule: 'gap slope CI excludes 0 → 0.2; placebo as large as half the estimate → 0.5; else 1' }); else un.push('Pre-period comparability (needs ≥4 pre dates)');
  const md = [meta.source, meta.sourceUrl, meta.controlRationale].filter(Boolean).length; c.push({ name: 'Provenance metadata', value: md / 3, rule: 'source name, source URL, control rationale provided (1/3 each)' });
  const score = Math.round(100 * mean(c.map(x => x.value)));
  return { score, label: score >= 75 ? 'Stronger evidence base' : score >= 50 ? 'Moderate evidence base' : 'Weak evidence base', components: c.map(x => ({ ...x, value: r(x.value, 2) })), unscored: un,
    disclaimer: 'Evidence-completeness score only. It is not a statistical confidence level or the probability that the intervention worked.' };
}

/** Deterministic, rule-based explanation. No AI model, no network, no external data. */
function explain(a, meta) {
  const L = { observed: [], hypotheses: [], uncertainty: [], next: [] }, f = x => r(x, 2);
  if (a.error) { L.observed.push(a.error); return L; }
  const dir = a.did < 0 ? 'fell more (or rose less)' : a.did > 0 ? 'rose more (or fell less)' : 'changed by the same amount';
  L.observed.push(`Relative to control, treatment surface temperature ${dir}: DiD = ${f(a.did)} °C (treatment ${f(a.treatment_change)} °C, control ${f(a.control_change)} °C; ${a.n_pre} pre / ${a.n_post} post dates).`);
  if (a.inference.type === 'interval') L.observed.push(`95% interval for DiD: ${f(a.inference.lo)} to ${f(a.inference.hi)} °C (${a.inference.excludes_zero ? 'excludes' : 'includes'} zero).`);
  else L.uncertainty.push(a.inference.reason + ' Treat the estimate as descriptive.');
  if (a.pretrend && a.pretrend.diverging) { L.uncertainty.push(`WARNING: treatment and control were already diverging before the intervention (gap slope ${f(a.pretrend.slope_per_week)} °C/week, 95% CI ${f(a.pretrend.lo)} to ${f(a.pretrend.hi)}). The parallel-trends assumption looks violated, so the DiD estimate may reflect that pre-existing drift rather than the intervention.`); L.next.push('Choose a different or additional control site with a matching pre-intervention trend and re-run.'); }
  if (a.placebo && a.placebo.comparable_to_real) L.uncertainty.push(`A placebo test at ${a.placebo.fake_date} (before the real intervention) produced a ${f(a.placebo.did)} °C "effect" comparable to the real estimate, so the result is not distinguishable from background change.`);
  if (!a.sign_stable) L.uncertainty.push('The sign of the estimate changes when dates nearest the intervention are dropped; the result is sensitive to the chosen window.');
  a.validation.findings.filter(x => x.level !== 'info').forEach(x => L.uncertainty.push(x.msg));
  L.hypotheses.push('If the comparison is valid, the intervention (e.g. shade, vegetation, reflective surfaces) may have contributed to the relative cooling. This is a hypothesis, not a finding.');
  L.hypotheses.push('Alternative explanations: weather or cloud differences on specific dates, different land-cover change near the control, sensor or processing changes, or seasonal differences in how the two areas warm.');
  L.next.push('Add more observation dates in the same season in prior years, and more treatment/control sites.', 'Record weather and any construction or land-cover changes near both areas.', 'Remember: surface temperature is not air temperature, heat index, or human heat exposure.');
  if (meta.synthetic) L.observed.unshift('SYNTHETIC DEMO DATA — these numbers illustrate the method and are not real-world evidence.');
  return L;
}

function reportJSON(a, meta) {
  return { app: 'HeatProof', app_version: VERSION, generated_at: new Date().toISOString(), synthetic_data: !!meta.synthetic, project: { name: meta.name || '', intervention_type: meta.type || '', intervention_date: a.intervention_date },
    provenance: { source: meta.source || '', source_url: meta.sourceUrl || '', control_rationale: meta.controlRationale || '', variable: 'surface temperature (°C); not air temperature or heat exposure', date_handling: 'calendar dates (YYYY-MM-DD), no time-zone conversion', dataset_label: meta.synthetic ? 'SYNTHETIC' : 'user-declared observed' },
    method: 'Difference-in-differences on the per-date treatment−control gap; Welch 95% CI across dates when ≥4 pre and ≥4 post dates', results: { did_c: r(a.did), treatment_change_c: r(a.treatment_change), control_change_c: r(a.control_change), means: a.means, n_pre: a.n_pre, n_post: a.n_post, inference: a.inference, pretrend: a.pretrend, placebo: a.placebo, sensitivity: a.sensitivity },
    evidence_assessment: a.evidence, data_validation: a.validation.findings, analyst_notes: a.analyst, analyst_engine: 'deterministic rule-based (no AI model used)', series: a.series };
}
function reportCSV(a, meta) {
  const q = s => '"' + String(s ?? '').replace(/"/g, '""') + '"', R = [['field', 'value']];
  const j = reportJSON(a, meta);
  [['app_version', VERSION], ['synthetic_data', j.synthetic_data], ['intervention_date', a.intervention_date], ['did_c', j.results.did_c], ['treatment_change_c', j.results.treatment_change_c], ['control_change_c', j.results.control_change_c], ['n_pre_dates', a.n_pre], ['n_post_dates', a.n_post], ['inference', a.inference.type === 'interval' ? `${r(a.inference.lo)} to ${r(a.inference.hi)}` : 'descriptive only'], ['evidence_completeness_score', a.evidence.score], ['source', meta.source || ''], ['generated_at', j.generated_at]].forEach(x => R.push(x));
  a.validation.findings.forEach(x => R.push(['validation_' + x.code, x.msg]));
  return R.map(x => x.map(q).join(',')).join('\n');
}

const HP = { VERSION, parseCSV, validate, buildSeries, analyze, scoreEvidence, explain, reportJSON, reportCSV, validDate };
if (typeof module !== 'undefined' && module.exports) module.exports = HP; else root.HP = HP;
})(typeof window !== 'undefined' ? window : globalThis);
