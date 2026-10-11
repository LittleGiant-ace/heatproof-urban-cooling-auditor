// Optional UI smoke test: npm i --no-save jsdom && node tests/ui-smoke.js
const { JSDOM } = require('jsdom'), fs = require('fs'), path = require('path'), root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script src="[^"]+"><\/script>/g, '');
const dom = new JSDOM(html, { runScripts: 'outside-only' });
['core.js', 'samples.js', 'app.js'].forEach(f => dom.window.eval(fs.readFileSync(path.join(root, f), 'utf8')));
const $ = id => dom.window.document.getElementById(id), fail = m => { console.error('FAIL', m); process.exit(1); };
for (const s of ['demo_synthetic.csv', 'misleading_synthetic.csv']) {
  $('sample').value = s; $('loadSample').click(); if ($('run').disabled) fail('run disabled ' + s); $('run').click();
  const w = $('warn').textContent; if (!/SYNTHETIC/.test(w)) fail('no synthetic label');
  console.log(s, '| DiD KPI:', $('kpis').children[0].textContent, '| warning:', /comparability/.test(w), '| svg:', !!$('chart').querySelector('svg'), '| rows:', $('tbl').rows.length);
}
$('xj').click === undefined && fail('export'); console.log('UI smoke OK');
