const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path');
const HP = require('../core.js');
const mk = (t, c, dates) => { const rows = []; dates.forEach((d, i) => { rows.push({ site: 'T', date: d, group: 'treatment', temp: t[i] }); rows.push({ site: 'C', date: d, group: 'control', temp: c[i] }); }); return rows; };
const D = ['2025-01-01', '2025-01-08', '2025-01-15', '2025-01-22', '2025-02-01', '2025-02-08', '2025-02-15', '2025-02-22'];
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

test('known negative DiD (hand-computed): T 10→8, C 10→10 ⇒ −2', () => {
  const a = HP.analyze(mk([10, 10, 10, 10, 8, 8, 8, 8], Array(8).fill(10), D), { date: '2025-02-01' }); near(a.did, -2); near(a.treatment_change, -2); near(a.control_change, 0);
});
test('known positive DiD: T 10→12, C 10→11 ⇒ +1', () => {
  const a = HP.analyze(mk([10, 10, 10, 10, 12, 12, 12, 12], [10, 10, 10, 10, 11, 11, 11, 11], D), { date: '2025-02-01' }); near(a.did, 1);
});
test('shared warming cancels out: no relative change ⇒ 0', () => {
  const a = HP.analyze(mk([10, 10, 10, 10, 13, 13, 13, 13], [20, 20, 20, 20, 23, 23, 23, 23], D), { date: '2025-02-01' }); near(a.did, 0);
});
test('independently computed DiD with noise', () => { // T pre 9,11,10,10 (10) post 8,9,9,10 (9); C pre 10,10,10,10 post 10,11,10,11 (10.5) ⇒ (9−10)−(10.5−10)=−1.5
  const a = HP.analyze(mk([9, 11, 10, 10, 8, 9, 9, 10], [10, 10, 10, 10, 10, 11, 10, 11], D), { date: '2025-02-01' }); near(a.did, -1.5);
  assert.equal(a.inference.type, 'interval');
});
test('insufficient data ⇒ descriptive only, no interval; error if no post period', () => {
  const a = HP.analyze(mk([10, 10, 8], [10, 10, 10], D.slice(0, 3)), { date: '2025-01-15' }); assert.equal(a.inference.type, 'descriptive');
  const b = HP.analyze(mk([10, 10], [10, 10], D.slice(0, 2)), { date: '2026-01-01' }); assert.ok(b.error);
});
test('missing values are excluded, not zero-filled', () => {
  const rows = mk([10, 10, 10, 10, 8, 8, 8, 8], Array(8).fill(10), D); rows[0].temp = null;
  const a = HP.analyze(rows, { date: '2025-02-01' }); near(a.did, -2); assert.equal(a.n_pre, 3);
});
test('duplicates are flagged and averaged', () => {
  const rows = mk([10, 10, 10, 10, 8, 8, 8, 8], Array(8).fill(10), D); rows.push({ site: 'T', date: D[0], group: 'treatment', temp: 12 });
  const v = HP.validate(rows); assert.ok(v.findings.some(f => f.code === 'DUPLICATES'));
  near(HP.buildSeries(rows)[0].treatment, 11);
});
test('invalid dates, temps, groups, units rejected with messages', () => {
  const p = HP.parseCSV('site,date,group,surface_temp_c,unit\nA,2025-02-30,treatment,30,C\nA,2025-02-01,treatmnt,30,C\nA,2025-02-01,treatment,abc,C\nA,2025-02-01,treatment,86,F\nA,2025-02-01,treatment,30,C\n');
  assert.equal(p.rows.length, 1); const codes = p.issues.map(i => i.code); ['BAD_DATE', 'BAD_GROUP', 'BAD_TEMP', 'BAD_UNIT'].forEach(c => assert.ok(codes.includes(c), c));
});
test('missing required column and quoted CSV fields', () => {
  assert.equal(HP.parseCSV('site,date,group\nA,2025-01-01,control').issues[0].code, 'MISSING_COLUMN');
  const p = HP.parseCSV('site,date,group,surface_temp_c\n"Park, North",2025-01-01,treatment,31.5'); assert.equal(p.rows[0].site, 'Park, North');
});
test('uneven group sizes reported; outliers flagged not removed', () => {
  const rows = mk([10, 10.1, 9.9, 10, 8, 8, 8, 8], Array(8).fill(10), D); rows.push({ site: 'T2', date: D[0], group: 'treatment', temp: 10 });
  assert.ok(HP.validate(rows).findings.some(f => f.code === 'UNEVEN_SITES'));
  const o = mk([10, 10.1, 9.9, 10, 10.05, 9.95, 10, 30], Array(8).fill(10), D); const v = HP.validate(o);
  assert.equal(v.outliers.length, 1); assert.equal(o.length, 16);
});
test('misleading dataset: pre-existing divergence is detected and warned', () => {
  const p = HP.parseCSV(fs.readFileSync(path.join(__dirname, '../data/misleading_synthetic.csv'), 'utf8'));
  const a = HP.analyze(p.rows, { date: '2025-05-01', rows: p.rows, synthetic: true });
  assert.ok(a.did < 0, 'naive DiD looks like cooling'); assert.equal(a.pretrend.diverging, true);
  assert.ok(a.analyst.uncertainty.some(t => t.startsWith('WARNING')));
  assert.ok(a.evidence.components.find(c => c.name.startsWith('Pre-period')).value <= 0.2);
});
test('demo dataset: clear effect, flags outlier + gaps, pre-trend OK', () => {
  const p = HP.parseCSV(fs.readFileSync(path.join(__dirname, '../data/demo_synthetic.csv'), 'utf8'));
  const a = HP.analyze(p.rows, { date: '2025-05-01', rows: p.rows, synthetic: true });
  assert.ok(a.did < -0.8 && a.did > -1.6); assert.equal(a.pretrend.diverging, false); assert.ok(a.validation.findings.some(f => f.code === 'OUTLIERS'));
});
test('evidence score: bounded, explained, lowers with poor metadata/data', () => {
  const p = HP.parseCSV(fs.readFileSync(path.join(__dirname, '../data/demo_synthetic.csv'), 'utf8'));
  const base = { date: '2025-05-01', rows: p.rows }, lo = HP.analyze(p.rows, base).evidence.score, hi = HP.analyze(p.rows, { ...base, source: 'x', sourceUrl: 'y', controlRationale: 'z' }).evidence.score;
  assert.ok(hi > lo && hi <= 100 && lo >= 0); assert.match(HP.analyze(p.rows, base).evidence.disclaimer, /not a statistical confidence/);
});
test('exports: JSON/CSV match results, label synthetic data, no AI claim', () => {
  const rows = mk([10, 10, 10, 10, 8, 8, 8, 8], Array(8).fill(10), D), meta = { date: '2025-02-01', rows, synthetic: true, name: 'P' };
  const a = HP.analyze(rows, meta), j = HP.reportJSON(a, meta), c = HP.reportCSV(a, meta);
  assert.equal(j.results.did_c, -2); assert.equal(j.synthetic_data, true); assert.match(j.analyst_engine, /no AI model/); assert.match(c, /"did_c","-2"/); assert.match(c, /"synthetic_data","true"/);
});
