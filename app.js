(function(){'use strict';
const $=id=>document.getElementById(id);let rows=null,res=null,meta=null;
function el(tag,txt,cls){const e=document.createElement(tag);if(txt!=null)e.textContent=txt;if(cls)e.className=cls;return e}
function banner(parent,level,txt){parent.appendChild(el('div',txt,'banner b-'+level))}
function ingest(text,label){const p=HP.parseCSV(text);rows=p.rows;res=null;const v=$('valid');v.replaceChildren();
 p.issues.forEach(i=>banner(v,i.level==='error'?'bad':'warn',i.msg));
 const fatal=p.issues.some(i=>['EMPTY','MISSING_COLUMN'].includes(i.code))||!rows.length;
 $('msg').className='banner '+(fatal?'b-bad':'b-info');
 if(fatal){$('msg').textContent='Could not load data. Fix the errors in step 3 and try again.';$('run').disabled=true;rows=null;return}
 const q=HP.validate(rows);q.findings.forEach(f=>banner(v,f.level==='error'?'bad':f.level==='warn'?'warn':'info',f.msg));
 $('msg').textContent=`Loaded ${rows.length} rows from ${new Set(rows.map(r=>r.site)).size} sites (${label}). Review step 3, then analyze.`;
 $('run').disabled=q.findings.some(f=>f.level==='error')}
$('file').onchange=e=>{const f=e.target.files[0];if(!f)return;if(f.size>5e6){$('msg').textContent='File too large (>5 MB).';return}const r=new FileReader();r.onload=()=>{$('synthetic').checked=false;ingest(r.result,f.name)};r.readAsText(f)};
$('loadSample').onclick=()=>{const n=$('sample').value;$('synthetic').checked=true;$('source').value='HeatProof synthetic generator (seeded)';$('rationale').value=n.startsWith('mis')?'Chosen without checking pre-trends (deliberately flawed)':'Similar land cover and orientation (synthetic)';$('name').value=n.startsWith('mis')?'Misleading synthetic example':'Ward 7 tree-planting audit (synthetic)';ingest(HP_SAMPLES[n],n+' — SYNTHETIC')};
$('run').onclick=()=>{try{meta={name:$('name').value,type:$('type').value,source:$('source').value,sourceUrl:$('sourceUrl').value,controlRationale:$('rationale').value,synthetic:$('synthetic').checked,rows,date:$('date').value};res=HP.analyze(rows,meta);render()}catch(e){$('msg').className='banner b-bad';$('msg').textContent=e.message}};
const f=(x,d=2)=>Number.isFinite(x)?(x>0?'+':'')+x.toFixed(d):'n/a';
function render(){['s4','s5','s6'].forEach(i=>$(i).classList.remove('hide'));const w=$('warn');w.replaceChildren();
 if(meta.synthetic)banner(w,'warn','SYNTHETIC DEMO DATA — illustrative only, not real-world evidence.');
 if(res.error){banner(w,'bad',res.error);$('kpis').replaceChildren();$('interp').textContent='';$('chart').replaceChildren();$('tbl').replaceChildren();analystUI();return}
 if(res.pretrend&&res.pretrend.diverging)banner(w,'bad','Control-site comparability warning: the treatment–control gap was already trending before the intervention. The estimate below may not reflect the intervention.');
 if(res.placebo&&res.placebo.comparable_to_real)banner(w,'warn','Placebo check: a fake intervention date in the pre-period gives an effect comparable to the real one.');
 const k=$('kpis');k.replaceChildren();const add=(l,v,s)=>{const d=el('div',null,'kpi');d.append(el('span',l),el('b',v),el('span',s));k.appendChild(d)};
 add('Difference-in-differences',f(res.did)+' °C','negative = relatively cooler treatment');
 add('Treatment change',f(res.treatment_change)+' °C',`${res.n_pre} pre → ${res.n_post} post dates`);add('Control change',f(res.control_change)+' °C','same windows');
 add('95% interval',res.inference.type==='interval'?`${f(res.inference.lo)} to ${f(res.inference.hi)}`:'not estimable',res.inference.type==='interval'?'dates treated as independent':'descriptive estimate only');
 add('Evidence completeness',res.evidence.score+' / 100',res.evidence.label);
 $('interp').textContent=res.analyst.observed.join(' ');chart();table();analystUI()}
function table(){const t=$('tbl');t.replaceChildren();const h=el('tr');['Date','Treatment °C','Control °C','Gap (T−C)','Period'].forEach(x=>h.appendChild(el('th',x)));t.appendChild(h);
 res.series.forEach(s=>{const r=el('tr');[s.date,s.treatment.toFixed(2),s.control.toFixed(2),f(s.gap),s.date<res.intervention_date?'before':'after'].forEach(x=>r.appendChild(el('td',x)));t.appendChild(r)})}
function chart(){const S=res.series,W=900,H=300,m={l:44,r:12,t:14,b:26},NS='http://www.w3.org/2000/svg';const mk=(n,a)=>{const e=document.createElementNS(NS,n);for(const k in a)e.setAttribute(k,a[k]);return e};
 const svg=mk('svg',{viewBox:`0 0 ${W} ${H}`,width:'100%'});const v=S.flatMap(s=>[s.treatment,s.control]),lo=Math.floor(Math.min(...v)),hi=Math.ceil(Math.max(...v));
 const X=i=>m.l+i*(W-m.l-m.r)/Math.max(1,S.length-1),Y=y=>H-m.b-(y-lo)/(hi-lo||1)*(H-m.t-m.b);
 for(let y=lo;y<=hi;y+=Math.max(1,Math.round((hi-lo)/5))){svg.appendChild(mk('line',{x1:m.l,x2:W-m.r,y1:Y(y),y2:Y(y),stroke:'currentColor','stroke-opacity':.15}));const t=mk('text',{x:4,y:Y(y)+4});t.textContent=y+'°';svg.appendChild(t)}
 const ix=S.findIndex(s=>s.date>=res.intervention_date);if(ix>0){const x=(X(ix)+X(ix-1))/2;svg.appendChild(mk('line',{x1:x,x2:x,y1:m.t,y2:H-m.b,stroke:'#a12a2a','stroke-dasharray':'5 4','stroke-width':2}));const t=mk('text',{x:x+4,y:m.t+10});t.textContent='intervention '+res.intervention_date;svg.appendChild(t)}
 [['treatment','var(--t)','Treatment mean'],['control','var(--c)','Control mean']].forEach(([key,col,name],li)=>{svg.appendChild(mk('polyline',{points:S.map((s,i)=>X(i)+','+Y(s[key])).join(' '),fill:'none',stroke:col,'stroke-width':2.5,'stroke-dasharray':key==='control'?'6 3':''}));
  S.forEach((s,i)=>{const c=mk('circle',{cx:X(i),cy:Y(s[key]),r:3.5,fill:col});const t=mk('title',{});t.textContent=`${name} ${s.date}: ${s[key].toFixed(2)} °C`;c.appendChild(t);svg.appendChild(c)});
  const lt=mk('text',{x:W-190+li*100,y:H-8});lt.textContent=(key==='control'?'- - ':'—— ')+name.split(' ')[0];svg.appendChild(lt)});
 [0,S.length-1].forEach(i=>{const t=mk('text',{x:X(i)-(i?60:0),y:H-8});t.textContent=S[i].date;svg.appendChild(t)});$('chart').replaceChildren(svg)}
function analystUI(){const e=res.evidence,box=$('ev');box.replaceChildren();const h=el('p');h.append(el('strong',`Evidence completeness: ${e.score}/100 — ${e.label}`));box.appendChild(h);box.appendChild(el('p',e.disclaimer,'small'));
 e.components.forEach(c=>{const d=el('div');d.appendChild(el('span',`${c.name}: ${Math.round(c.value*100)}% `));d.appendChild(el('span','('+c.rule+')','small'));const b=el('div',null,'bar');const i=document.createElement('i');i.style.width=c.value*100+'%';b.appendChild(i);d.appendChild(b);box.appendChild(d)});
 if(e.unscored.length)box.appendChild(el('p','Not scored (insufficient data): '+e.unscored.join('; '),'small'));
 const rob=$('rob');rob.replaceChildren();if(res.sensitivity){const ul=el('ul');res.sensitivity.forEach(s=>ul.appendChild(el('li',`Dropping ${s.trim} date(s) nearest the intervention: DiD ${f(s.did)} °C`)));
  if(res.pretrend)ul.appendChild(el('li',`Pre-intervention gap trend: ${f(res.pretrend.slope_per_week)} °C/week (95% CI ${f(res.pretrend.lo)} to ${f(res.pretrend.hi)})${res.pretrend.diverging?' — DIVERGING':''}`));else ul.appendChild(el('li','Pre-trend check needs ≥4 pre-intervention dates.'));
  if(res.placebo)ul.appendChild(el('li',`Placebo date ${res.placebo.fake_date} (pre-period only): ${f(res.placebo.did)} °C`));rob.appendChild(ul)}
 const a=$('analyst');a.replaceChildren();[['Observed','observed'],['Uncertainty & warnings','uncertainty'],['Hypotheses (not findings)','hypotheses'],['Suggested next evidence','next']].forEach(([t,k])=>{if(!res.analyst[k].length)return;a.appendChild(el('strong',t));const ul=el('ul');res.analyst[k].forEach(x=>ul.appendChild(el('li',x)));a.appendChild(ul)})}
function dl(n,t,m){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([t],{type:m}));a.download=n;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1e3)}
const tag=()=>meta.synthetic?'SYNTHETIC_':'';
$('xj').onclick=()=>res&&dl(`heatproof_${tag()}report.json`,JSON.stringify(HP.reportJSON(res,meta),null,2),'application/json');
$('xc').onclick=()=>res&&dl(`heatproof_${tag()}report.csv`,HP.reportCSV(res,meta),'text/csv');
$('xp').onclick=()=>{document.body.classList.add('print');window.print()};
})();
