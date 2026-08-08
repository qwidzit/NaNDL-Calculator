// ============================================================================
// UI layer — all DOM access lives here. Imports the pure math from calc.js.
// Features: histogram/manual input, run/segment slicing, per-input breakdown,
// fps presets + validation, .txt import/export, URL-shareable state, and an
// offline service worker. No browser storage — sharable state lives in the URL.
// ============================================================================

import { MAXW, histInputs, evaluate, solveLstar, perInputStats, sliceRun, difficultyProfile,
         parseInputsText, parseCalculatorJson, buildCalculatorJson, grindEntropy,
         windowCounts } from "./calc.js";

let mode="hist";
let unit="sec";
let calcMode="solve";
let restoring=false;   // true while applying URL state, to suppress hash writes
let lastProfile=null;  // latest difficulty-curve samples, for hover readout

const $ = id => document.getElementById(id);
function num(id){const v=parseFloat($(id).value); return isNaN(v)?0:v;}

// Time-unit conversion. Seconds are the canonical internal unit; % is a share of
// the level length and Frames is a game-frame index converted via Game FPS.
function toSec(v,u,T){
  if(u==='pct')    return T>0 ? v/100*T : 0;
  if(u==='frames'){ const g=num('gameFps'); return g>0 ? v/g : 0; }
  return v;
}
function fromSec(v,u,T){
  if(u==='pct')    return T>0 ? v/T*100 : 0;
  if(u==='frames'){ const g=num('gameFps'); return v*g; }
  return v;
}
const unitLabel = u => u==='pct' ? '%' : (u==='frames' ? 'f' : 's');

// ---- histogram grid --------------------------------------------------------
const grid=$('grid');
for(let k=1;k<=MAXW;k++){
  const cell=document.createElement('div');
  cell.className='cell';
  cell.innerHTML=`<label><span class="win">${k}f</span> <span class="ms" id="ms${k}"></span></label>
    <input type="number" min="0" step="1" value="0" data-w="${k}">`;
  grid.appendChild(cell);
}

// ---- manual rows -----------------------------------------------------------
const manualBody=$('manualBody');
function addRow(time,frames,number){
  const tr=document.createElement('tr');
  const n = number ?? (manualBody.children.length+1);
  tr.innerHTML=`
    <td><input type="number" class="mNum" step="1" min="1" value="${n}"></td>
    <td><input type="number" class="mTime" step="0.01" min="0" value="${time??''}"></td>
    <td><input type="text" class="mWin" inputmode="decimal" placeholder="- = ignored" value="${frames??''}"></td>
    <td class="mMs" style="font-size:11px;color:#5b6675">—</td>
    <td><button class="del">&times;</button></td>`;
  tr.querySelector('.del').addEventListener('click',()=>{tr.remove(); recompute();});
  manualBody.appendChild(tr);
}
$('addRow').addEventListener('click',()=>{addRow('', ''); recompute();});

// ---- mode + unit toggles ---------------------------------------------------
function applyModeUI(m){
  mode=m;
  document.querySelectorAll('#modeSeg button').forEach(x=>x.classList.toggle('active',x.dataset.mode===m));
  $('histPanel').classList.toggle('hidden',m!=='hist');
  $('manualPanel').classList.toggle('hidden',m!=='manual');
}
function applyUnitUI(u){
  unit=u;
  document.querySelectorAll('#unitSeg button').forEach(x=>x.classList.toggle('active',x.dataset.unit===u));
  const label = unitLabel(u);
  $('unitLabelHead').textContent=label;
  document.querySelectorAll('.unitLabel').forEach(el=>el.textContent=label);
}
$('modeSeg').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b) return;
  applyModeUI(b.dataset.mode);
  recompute();
});
$('unitSeg').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b || b.dataset.unit===unit) return;
  const newUnit=b.dataset.unit;
  const T=num('tlen');
  const conv = v => +fromSec(toSec(v,unit,T), newUnit, T).toFixed(4);
  // convert manual row times so the real times stay fixed
  document.querySelectorAll('#manualBody .mTime').forEach(inp=>{
    const v=parseFloat(inp.value); if(!isNaN(v)) inp.value=conv(v);
  });
  // convert the run range's two numbers too
  const rng=parseRange($('runRange').value);
  if(rng) $('runRange').value = `${conv(rng[0])} - ${conv(rng[1])}`;
  applyUnitUI(newUnit);
  recompute();
});

// calculation mode: solve for L*, or report stats at a fixed precision
$('calcSeg').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b) return;
  applyCalcUI(b.dataset.calc);
  recompute();
});
function applyCalcUI(m){
  calcMode = m==='fixed' ? 'fixed' : 'solve';
  document.querySelectorAll('#calcSeg button').forEach(x=>x.classList.toggle('active',x.dataset.calc===calcMode));
  $('targetField').classList.toggle('hidden', calcMode!=='solve');
  $('skillField').classList.toggle('hidden', calcMode!=='fixed');
}

// ---- fps presets + validation ----------------------------------------------
$('fpsPresets').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b) return;
  $('fps').value=b.dataset.fps;
  recompute();
});
function updateFpsUI(f){
  const raw=$('fps').value;
  document.querySelectorAll('#fpsPresets button').forEach(x=>x.classList.toggle('active',x.dataset.fps===String(parseFloat(raw))));
  const hint=$('fpsHint');
  if(!(f>0)){ hint.className='hint warn'; hint.textContent='Frame rate must be greater than 0.'; }
  else if(!Number.isInteger(parseFloat(raw))){ hint.className='hint warn'; hint.textContent='Non-integer fps — frames are usually whole numbers (still computed).'; }
  else { hint.className='hint'; hint.textContent='1 frame = 1/fps seconds'; }
}

// ---- .txt import / export --------------------------------------------------
const fileInput=$('fileInput');
$('importBtn').addEventListener('click',()=>fileInput.click());
fileInput.addEventListener('change',e=>{
  const file=e.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=ev=>importText(String(ev.target.result));
  reader.readAsText(file);
  fileInput.value='';
});
function importText(text){
  const status=$('imStatus');
  const parsed=parseInputsText(text);
  if(parsed.length===0){
    status.style.color='var(--warn)';
    status.textContent='No valid "time - window" lines found — see the format guide.';
    $('guideModal').classList.add('show');
    return;
  }
  manualBody.innerHTML='';
  parsed.forEach(r=>addRow(r[0],r[1]));
  status.style.color='var(--good)';
  status.textContent=`Imported ${parsed.length} input${parsed.length>1?'s':''} (read as ${unit==='pct'?'%':'seconds'}).`;
  recompute();
}
$('exportBtn').addEventListener('click',()=>{
  const rows=[...document.querySelectorAll('#manualBody tr')];
  const lines=[`# NaNDL inputs (time in ${unit==='pct'?'%':'seconds'})`];
  rows.forEach(tr=>{
    const t=tr.querySelector('.mTime').value.trim();
    const w=tr.querySelector('.mWin').value.trim();
    if(t!=='' && w!=='') lines.push(`${t} - ${w}`);
  });
  const status=$('imStatus');
  if(lines.length===1){ status.style.color='var(--warn)'; status.textContent='Nothing to export — add some inputs first.'; return; }
  download(lines.join('\n')+'\n','text/plain','nandl-inputs.txt');
  status.style.color='var(--good)'; status.textContent=`Exported ${lines.length-1} input${lines.length-1>1?'s':''}.`;
});
function download(text,type,name){
  const url=URL.createObjectURL(new Blob([text],{type}));
  const a=document.createElement('a');
  a.href=url; a.download=name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ---- JSON interchange with the official NaNDL calculator -------------------
const jsonInput=$('jsonInput');
$('importJsonBtn').addEventListener('click',()=>jsonInput.click());
jsonInput.addEventListener('change',e=>{
  const file=e.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=ev=>importJson(String(ev.target.result));
  reader.readAsText(file);
  jsonInput.value='';
});
function importJson(text){
  const status=$('imStatus');
  const res=parseCalculatorJson(text);
  if(!res.ok){
    status.style.color='var(--warn)';
    status.textContent=`JSON import failed — ${res.error}`;
    return;
  }
  // window FPS is the timing-window rate = our fps
  if(res.windowFps>0) $('fps').value=res.windowFps;
  if(res.gameFps>0) $('gameFps').value=res.gameFps;
  $('respawn').value=res.respawnTime||0;
  // the official model's t_n is the last input time; match it as our level length
  const last=res.inputs[res.inputs.length-1].t;
  if(last>0) $('tlen').value=+last.toFixed(6);
  // rows are written in seconds; switch the unit control to match
  applyUnitUI('sec');
  manualBody.innerHTML='';
  res.inputs.forEach((inp,i)=>addRow(+inp.t.toFixed(6), inp.k==null?'-':inp.k, inp.n??(i+1)));
  applyModeUI('manual');

  const notes=[];
  if(res.ignored>0) notes.push(`${res.ignored} ignored window${res.ignored>1?'s':''}`);
  if(res.respawnTime>0) notes.push(`respawn ${res.respawnTime}s`);
  if(res.useFrames) notes.push(`frame positions read at ${res.gameFps} fps`);
  status.style.color='var(--good)';
  status.textContent=`Imported ${res.inputs.length} input${res.inputs.length>1?'s':''} from JSON`+
    (notes.length?` (${notes.join('; ')}).`:'.');
  recompute();
}
$('exportJsonBtn').addEventListener('click',()=>{
  const status=$('imStatus');
  const inputs=readManual(num('tlen'));
  if(inputs.length===0){
    status.style.color='var(--warn)'; status.textContent='Nothing to export — add some inputs first.';
    return;
  }
  const doc=buildCalculatorJson({inputs, fps:num('fps')||240, respawnTime:Math.max(0,num('respawn'))});
  download(JSON.stringify(doc,null,2),'application/json','nandl-run.json');
  status.style.color='var(--good)';
  status.textContent=`Exported ${inputs.length} input${inputs.length>1?'s':''} as JSON.`;
});

// ---- format guide modal ----------------------------------------------------
const guideModal=$('guideModal');
$('guideBtn').addEventListener('click',()=>guideModal.classList.add('show'));
$('guideClose').addEventListener('click',()=>guideModal.classList.remove('show'));
guideModal.addEventListener('click',e=>{ if(e.target===guideModal) guideModal.classList.remove('show'); });

// ---- collapse the manual list (long lists shouldn't force scrolling) -------
let listHidden=false;
function applyListUI(hide){
  listHidden=!!hide;
  $('listWrap').classList.toggle('hidden',listHidden);
  $('listHidden').classList.toggle('hidden',!listHidden);
  $('toggleList').innerHTML = listHidden ? '&#9660; Show list' : '&#9650; Hide list';
}
$('toggleList').addEventListener('click',()=>applyListUI(!listHidden));

// ---- back to top -----------------------------------------------------------
{
  const btn=$('toTop');
  btn.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
  const sync=()=>btn.classList.toggle('show', window.scrollY>320);
  window.addEventListener('scroll',sync,{passive:true});
  sync();
}

// ---- clear all (with confirm popup) ----------------------------------------
const confirmModal=$('confirmModal');
$('clearBtn').addEventListener('click',()=>{
  const n=document.querySelectorAll('#manualBody tr').length;
  const status=$('imStatus');
  if(n===0){ status.style.color='var(--muted)'; status.textContent='List is already empty.'; return; }
  $('confirmCount').textContent=n;
  confirmModal.classList.add('show');
});
$('confirmCancel').addEventListener('click',()=>confirmModal.classList.remove('show'));
confirmModal.addEventListener('click',e=>{ if(e.target===confirmModal) confirmModal.classList.remove('show'); });
$('confirmClear').addEventListener('click',()=>{
  manualBody.innerHTML='';
  confirmModal.classList.remove('show');
  const status=$('imStatus'); status.style.color='var(--good)'; status.textContent='Cleared all inputs.';
  recompute();
});
// Esc closes any open modal
document.addEventListener('keydown',e=>{
  if(e.key==='Escape') document.querySelectorAll('.overlay.show').forEach(o=>o.classList.remove('show'));
});

// ---- helpers ---------------------------------------------------------------
function parseRange(str){
  const m=String(str).match(/(-?\d*\.?\d+)\s*-\s*(-?\d*\.?\d+)/);
  if(!m) return null;
  const a=parseFloat(m[1]), b=parseFloat(m[2]);
  return (isNaN(a)||isNaN(b)) ? null : [a,b];
}
function readMods(){
  return {
    nerve:{on:$('nerveOn').checked, k:num('nerveK')},
    fatigue:{on:$('fatigueOn').checked, k:num('fatigueK')},
    cps:{on:$('cpsOn').checked, k:num('cpsK')},
  };
}
function anyModOn(m){ return m.nerve.on || m.fatigue.on || m.cps.on; }
function readManual(T){
  const rows=[...document.querySelectorAll('#manualBody tr')];
  const inputs=[];
  const f=num('fps');
  rows.forEach(tr=>{
    const tv=parseFloat(tr.querySelector('.mTime').value);
    const wRaw=tr.querySelector('.mWin').value.trim();
    const nv=parseFloat(tr.querySelector('.mNum').value);
    const msCell=tr.querySelector('.mMs');
    if(isNaN(tv) || tv<0 || wRaw===''){ msCell.textContent='—'; return; }
    const ignored = wRaw==='-';
    const kv = ignored ? NaN : parseFloat(wRaw);
    if(!ignored && (isNaN(kv) || kv<=0)){ msCell.textContent='—'; return; }
    inputs.push({t: toSec(tv,unit,T), k: ignored?null:kv, n: isNaN(nv)?undefined:nv});
    msCell.textContent = ignored ? 'ignored' : (f>0 ? (1000*kv/f).toFixed(2)+'ms' : '—');
  });
  inputs.sort((a,b)=>a.t-b.t);
  return inputs;
}

// ---- per-input breakdown ---------------------------------------------------
function fmtProb(v){ return v<1e-4 ? v.toExponential(1) : (v*100).toFixed(2)+'%'; }
function fmtHours(h){
  if(!isFinite(h)) return '∞';
  if(h>=1e6) return h.toExponential(2)+' h';
  if(h<0.01) return (h*3600).toFixed(1)+' s';
  return h.toFixed(2)+' h';
}
function fmtCount(v){
  if(!isFinite(v)) return '∞';
  return v>=1e5 ? v.toExponential(2) : Math.round(v).toLocaleString();
}
// ---- window-size tally -----------------------------------------------------
function renderWindowCounts(inputs,runActive,rangeLabel){
  const panel=$('wcPanel'), grid=$('wcGrid'), note=$('wcNote');
  const w=windowCounts(inputs);
  if(w.rows.length===0){ panel.classList.add('hidden'); return; }
  const f=num('fps');
  const peak=Math.max(...w.rows.map(r=>r.count));
  grid.innerHTML=w.rows.map(r=>{
    const pct = peak>0 ? Math.round(r.count/peak*100) : 0;
    const cls = `wccell${r.count===0?' empty':''}${r.count===peak&&peak>0?' peak':''}`;
    const ms = f>0 ? (1000*r.k/f).toFixed(2)+'ms' : '';
    return `<div class="${cls}"><div class="wk">${r.k}f</div>`+
           `<div class="wn">${r.count}</div>`+
           `<div class="wms">${ms}</div>`+
           `<div class="wbar" style="width:${pct}%"></div></div>`;
  }).join('');
  const what = runActive ? `run (${rangeLabel})` : 'level';
  const bits=[`<b>${w.total}</b> timed input${w.total===1?'':'s'} across <b>${w.distinct}</b> distinct window size${w.distinct===1?'':'s'} in this ${what}`];
  if(w.ignored>0) bits.push(`<b>${w.ignored}</b> ignored`);
  if(!w.filled) bits.push(`gaps not filled (largest window is ${w.max}f)`);
  note.innerHTML=bits.join(' &nbsp;·&nbsp; ')+'.';
  panel.classList.remove('hidden');
}

function renderG(g,refL,count,runActive,rangeLabel){
  const note=$('gnote');
  if(!g || !(refL>0)){
    $('gbits').textContent='—'; $('gattempts').textContent='—';
    $('gref').textContent='—'; $('gper').textContent='—';
    note.innerHTML='<span style="color:var(--warn)">Enter a reference precision greater than 0.</span>';
    return;
  }
  const bits=g.bits;
  $('gbits').textContent = isFinite(bits)
    ? (bits>=1000 ? bits.toExponential(3) : bits.toFixed(2))
    : '∞';
  $('gattempts').textContent = isFinite(g.attempts)
    ? (g.attempts>=1e5 ? g.attempts.toExponential(2) : Math.round(g.attempts).toLocaleString())
    : '∞';
  $('gref').textContent = refL.toLocaleString(undefined,{maximumFractionDigits:2});
  $('gper').textContent = (isFinite(bits)&&count>0) ? (bits/count).toFixed(3) : '—';
  const what = runActive ? `this run (${rangeLabel})` : 'this level';
  note.innerHTML = `Bits of luck one clean completion of ${what} costs a player at precision `+
    `<b>${refL.toLocaleString(undefined,{maximumFractionDigits:2})}</b>. `+
    `One extra bit = twice the grind, and segments <b>add</b>: G(A then B) = G(A) + G(B).`;
}

function renderBreakdown(Lstar,cfg,Teff,runActive,rangeLabel,g){
  const bd=$('breakdown'), body=$('bdBody');
  const per=perInputStats(Lstar,cfg);
  body.innerHTML='';
  if(per.length===0){ bd.classList.add('hidden'); return; }
  const f=num('fps');
  const real=per.filter(s=>!s.ignored);
  const minP=real.length?Math.min(...real.map(s=>s.p)):1;
  const weakCut=minP*1.02;   // within 2% of the hardest input
  per.forEach((s,i)=>{
    const tr=document.createElement('tr');
    const pctPos=Teff>0 ? (s.t/Teff*100).toFixed(1)+'%' : '—';
    const kShown = s.ignored ? (s.kEff===null?'—':s.kEff) : s.k;
    const ms=(f>0 && kShown!=='—') ? (1000*kShown/f).toFixed(2) : '—';
    const pClass=s.p>=0.9?'':(s.p>=0.5?'low':'vlow');
    const weak=s.p<=weakCut && !s.ignored;
    if(weak) tr.className='weak';
    tr.innerHTML=`<td>${s.n}</td>
      <td>${s.t.toFixed(2)}</td>
      <td>${pctPos}</td>
      <td>${s.ignored?`<span style="color:var(--muted)">${kShown==='—'?'ignored':kShown+'f*'}</span>`:kShown+'f'}</td>
      <td>${ms}</td>
      <td class="pbar ${pClass}">${fmtProb(s.p)}${weak?' <span class="weak-tag">weak</span>':''}</td>
      <td>${fmtProb(s.r)}</td>
      <td class="bits">${g&&isFinite(g.per[i])?(g.per[i]<0.001?g.per[i].toExponential(1):g.per[i].toFixed(3)):'—'}</td>`;
    body.appendChild(tr);
  });
  $('bdCount').textContent=`— ${per.length} input${per.length>1?'s':''}${runActive?` in run ${rangeLabel}`:''}`;
  bd.classList.remove('hidden');
}

// ---- difficulty profile (manual mode) --------------------------------------
function renderDifficulty(inputs,T,run){
  const panel=$('diffPanel');
  if(mode!=='manual' || !(T>0) || inputs.length===0){ panel.classList.add('hidden'); lastProfile=null; return; }
  const h=parseFloat($('smooth').value)||1.5;
  $('smoothVal').textContent=h.toFixed(1)+'%';
  const mods=readMods();
  const prof=difficultyProfile(inputs,T,mods,{bandwidthPct:h,samples:240});
  panel.classList.remove('hidden');

  const W=1000,H=200,padL=6,padR=6,padT=10,padB=6;
  const plotW=W-padL-padR, plotH=H-padT-padB, baseY=H-padB;
  const X=x=> padL + (x/prof.xmax)*plotW;
  const Y=v=> padT + (1-v)*plotH;

  let area=`M ${X(0).toFixed(1)} ${baseY}`, line='';
  for(let j=0;j<prof.xs.length;j++){
    const px=X(prof.xs[j]).toFixed(1), py=Y(prof.ys[j]).toFixed(1);
    area+=` L ${px} ${py}`;
    line+=(j===0?`M ${px} ${py}`:` L ${px} ${py}`);
  }
  area+=` L ${X(prof.xmax).toFixed(1)} ${baseY} Z`;

  let grid='';
  for(const gx of [0,25,50,75,100]){
    if(gx>prof.xmax) continue;
    const px=X(gx).toFixed(1);
    grid+=`<line x1="${px}" y1="${padT}" x2="${px}" y2="${baseY}" class="gl"/>`;
  }
  let runrect='';
  if(run && run.active){
    const rx1=X(Math.max(0,run.loPct)), rx2=X(Math.min(prof.xmax,run.hiPct));
    if(rx2>rx1) runrect=`<rect x="${rx1.toFixed(1)}" y="${padT}" width="${(rx2-rx1).toFixed(1)}" height="${plotH}" class="runband"/>`;
  }
  const peak=`<circle cx="${X(prof.peakXPct).toFixed(1)}" cy="${Y(1).toFixed(1)}" r="3.5" class="peakdot"/>`;

  $('diffSvg').innerHTML=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Difficulty across the level">
    <defs><linearGradient id="dg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ff6b6b" stop-opacity="0.85"/>
      <stop offset="45%" stop-color="#f0a35e" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#5ed0c6" stop-opacity="0.10"/>
    </linearGradient></defs>
    ${grid}${runrect}
    <path d="${area}" fill="url(#dg)"/>
    <path d="${line}" fill="none" stroke="#7aa2ff" stroke-width="2" vector-effect="non-scaling-stroke"/>
    ${peak}
  </svg>`;

  // axis labels as HTML (avoids SVG text distortion under preserveAspectRatio=none)
  let axis='';
  for(const gx of [0,25,50,75,100]){
    if(gx>prof.xmax) continue;
    const leftPct=gx/prof.xmax*100;
    const pos = gx===0 ? 'left:3px' : gx===100 ? `left:${leftPct}%;transform:translateX(-100%)` : `left:${leftPct}%;transform:translateX(-50%)`;
    axis+=`<span style="${pos}">${gx}%</span>`;
  }
  $('diffAxis').innerHTML=axis;

  // ignored rows have no window of their own — exclude them from "tightest"
  const real=inputs.filter(i=>i.k>0);
  const tight=real.length?real.reduce((a,b)=> b.k<a.k?b:a):null;
  const f=num('fps');
  const tightTxt = tight
    ? `tightest window <b>${tight.k}f</b> (~${f>0?(1000*tight.k/f).toFixed(1)+' ms':'—'})`
    : 'no timed windows';
  const modNote=anyModOn(mods) ? ` <span style="color:var(--accent)">Modifiers applied.</span>` : '';
  $('diffCaption').innerHTML=`Relative difficulty across the level — higher = tighter windows and/or denser inputs. `+
    `Hardest around <b>${prof.peakXPct.toFixed(0)}%</b>; ${tightTxt}.${modNote}`;

  lastProfile={xs:prof.xs, ys:prof.ys, xmax:prof.xmax};
}
// hover readout on the chart (attached once; reads the latest lastProfile)
{
  const chart=$('diffChart'), cur=$('diffCursor'), tip=$('diffTip');
  chart.addEventListener('mousemove',e=>{
    if(!lastProfile) return;
    const rect=chart.getBoundingClientRect();
    let frac=(e.clientX-rect.left)/rect.width; frac=Math.min(1,Math.max(0,frac));
    const xPct=frac*lastProfile.xmax;
    const y=lastProfile.ys[Math.round(frac*(lastProfile.ys.length-1))]||0;
    const leftPx=frac*rect.width;
    cur.style.left=leftPx+'px'; cur.style.opacity='1';
    tip.style.left=Math.min(rect.width-4,Math.max(4,leftPx))+'px'; tip.style.opacity='1';
    tip.textContent=`${xPct.toFixed(0)}%  ·  difficulty ${(y*100).toFixed(0)}%`;
  });
  chart.addEventListener('mouseleave',()=>{ cur.style.opacity='0'; tip.style.opacity='0'; });
}

// ---- main recompute --------------------------------------------------------
function recompute(){
  if(!restoring) updateHash();

  const f=num('fps');
  const T=num('tlen');
  const targetH=num('target');
  updateFpsUI(f);

  // histogram ms labels
  for(let k=1;k<=MAXW;k++){
    const el=$('ms'+k);
    if(el) el.textContent = f>0 ? (1000*k/f).toFixed(2)+'ms' : '';
  }

  // build the full-level input list
  let inputs=[];
  if(mode==='hist'){
    const counts={}; let total=0;
    document.querySelectorAll('#grid input').forEach(inp=>{
      const w=+inp.dataset.w; const c=Math.max(0,Math.floor(parseFloat(inp.value)||0));
      if(c>0){counts[w]=c; total+=c;}
    });
    $('histTotal').textContent=total;
    if(total>0 && T>0) inputs=histInputs(counts,T);
  } else {
    inputs=readManual(T);
    $('manTotal').textContent=inputs.length;
  }
  // keep the full (pre-slice) manual list for the difficulty profile
  const fullInputs = mode==='manual' ? inputs.slice() : [];

  // apply run / segment slice
  let Teff=T, runActive=false, runValid=true, rangeLabel='', runLoPct=0, runHiPct=0;
  const runHint=$('runHint');
  if($('runOn').checked){
    const rng=parseRange($('runRange').value);
    if(rng && T>0){
      const aSec = unit==='pct' ? rng[0]/100*T : rng[0];
      const bSec = unit==='pct' ? rng[1]/100*T : rng[1];
      const lo=Math.min(aSec,bSec), hi=Math.max(aSec,bSec);
      if(hi>lo){
        inputs=sliceRun(inputs,lo,hi);
        Teff=hi-lo; runActive=true;
        runLoPct=lo/T*100; runHiPct=hi/T*100;
        rangeLabel=`${lo.toFixed(2)}–${hi.toFixed(2)}s`;
        const loP=(lo/T*100), hiP=(hi/T*100);
        runHint.className='totline';
        runHint.innerHTML=`Run <b>${lo.toFixed(2)} – ${hi.toFixed(2)} s</b> `+
          `(<b>${loP.toFixed(1)}% – ${hiP.toFixed(1)}%</b>) &nbsp;·&nbsp; length <b>${Teff.toFixed(2)} s</b> `+
          `&nbsp;·&nbsp; <b>${inputs.length}</b> input${inputs.length===1?'':'s'} scored`;
      } else runValid=false;
    } else runValid=false;
    if(!runValid){ runHint.className='totline'; runHint.innerHTML=`<span style="color:var(--warn)">Enter a valid run range like <code>23.2 - 81.8</code>.</span>`; }
  } else {
    runHint.className='totline'; runHint.textContent='Off — the whole level is scored.';
  }

  // difficulty profile reflects the whole level (manual mode), independent of target/fps validity
  renderDifficulty(fullInputs, T, {active:runActive, loPct:runLoPct, hiPct:runHiPct});

  const stats=$('stats'), big=$('lstar'), rsub=$('rsub');
  const show=(msg)=>{big.textContent='—'; rsub.className='rsub msg'; rsub.textContent=msg; stats.style.display='none';
    $('breakdown').classList.add('hidden'); $('gPanel').classList.add('hidden');
    $('wcPanel').classList.add('hidden');};

  if(!(T>0)) return show('Enter a level length greater than 0.');
  if(!(f>0)) return show('Enter a frame rate greater than 0.');
  if($('runOn').checked && !runValid) return show('Enter a valid run range like "23.2 - 81.8".');
  if(inputs.length===0) return show(runActive?'No inputs fall inside the run range.':'Add at least one input.');

  const mods=readMods();
  const cfg={inputs, f, T:Teff, mods, respawn:Math.max(0,num('respawn'))};
  const what = runActive ? `run (${rangeLabel})` : 'level';

  let L, chk;
  if(calcMode==='fixed'){
    L=num('skill');
    if(!(L>0)) return show('Enter a precision greater than 0.');
    chk=evaluate(L,cfg);
    $('rlabel').textContent='Expected time to complete';
    $('sigmaLabel').innerHTML='timing window &sigma; = 1/L';
    big.textContent = isFinite(chk.ETC) ? fmtHours(chk.ETC/3600) : '∞';
    rsub.className='rsub';
    rsub.innerHTML=`At precision <b>${L.toLocaleString(undefined,{maximumFractionDigits:2})}</b> on this `+
      `${inputs.length}-input ${what}.`;
  } else {
    const targetH=num('target');
    if(!(targetH>0)) return show('Enter a target time greater than 0.');
    L=solveLstar(cfg,targetH*3600);
    chk=evaluate(L,cfg);
    $('rlabel').innerHTML='Required Precision &nbsp;L*';
    $('sigmaLabel').innerHTML='timing window &sigma; = 1/L*';
    big.textContent=L.toLocaleString(undefined,{maximumFractionDigits:1});
    rsub.className='rsub';
    rsub.innerHTML=`Precision required to average a <b>${targetH}-hour</b> completion of this ${inputs.length}-input ${what}.`;
  }

  stats.style.display='flex';
  $('sigma').textContent=(1000/L).toFixed(2)+' ms';
  $('pc').textContent=chk.PC<1e-4?chk.PC.toExponential(2):(chk.PC*100).toFixed(3)+'%';
  $('attempts').textContent=isFinite(chk.attempts)?fmtCount(chk.attempts):'∞';
  $('eta').textContent=chk.ETA.toFixed(2)+' s';
  $('etc').textContent=isFinite(chk.ETC)?fmtHours(chk.ETC/3600):'∞';

  // Grind entropy at the user's reference precision — independent of the mode
  // above, so it stays comparable across levels and adds across segments.
  $('gPanel').classList.remove('hidden');
  const refL=num('refL');
  const g = refL>0 ? grindEntropy(refL,cfg) : null;
  renderG(g,refL,inputs.length,runActive,rangeLabel);

  renderBreakdown(L,cfg,Teff,runActive,rangeLabel,g);
  renderWindowCounts(inputs,runActive,rangeLabel);
}

// ---- URL-shareable state (no browser storage — state lives in the hash) ----
function serialize(){
  const hist={};
  document.querySelectorAll('#grid input').forEach(inp=>{
    const c=Math.floor(parseFloat(inp.value)||0);
    if(c>0) hist[inp.dataset.w]=c;
  });
  const rows=[];
  document.querySelectorAll('#manualBody tr').forEach(tr=>{
    const t=tr.querySelector('.mTime').value, w=tr.querySelector('.mWin').value,
          n=tr.querySelector('.mNum').value;
    if(t!=='' || w!=='') rows.push([t,w,n]);
  });
  return {
    m:mode, u:unit,
    f:$('fps').value, t:$('tlen').value, g:$('target').value,
    n:[$('nerveOn').checked?1:0, $('nerveK').value],
    fa:[$('fatigueOn').checked?1:0, $('fatigueK').value],
    c:[$('cpsOn').checked?1:0, $('cpsK').value],
    h:hist, r:rows,
    run:[$('runOn').checked?1:0, $('runRange').value],
    sm:$('smooth').value,
    gf:$('gameFps').value, rs:$('respawn').value,
    cm:calcMode, sk:$('skill').value, rl:$('refL').value, lh:listHidden?1:0,
  };
}
function updateHash(){
  try{
    const b64=btoa(unescape(encodeURIComponent(JSON.stringify(serialize()))));
    history.replaceState(null,'','#s='+b64);
  }catch(_){/* non-fatal */}
}
function restore(){
  const h=location.hash;
  if(!h.startsWith('#s=')) return false;
  let st;
  try{ st=JSON.parse(decodeURIComponent(escape(atob(h.slice(3))))); }
  catch(_){ return false; }
  restoring=true;
  try{
    if(st.f!=null) $('fps').value=st.f;
    if(st.t!=null) $('tlen').value=st.t;
    if(st.g!=null) $('target').value=st.g;
    const setMod=(pre,arr)=>{ if(arr){ $(pre+'On').checked=!!arr[0]; if(arr[1]!=null) $(pre+'K').value=arr[1]; } };
    setMod('nerve',st.n); setMod('fatigue',st.fa); setMod('cps',st.c);
    // histogram
    document.querySelectorAll('#grid input').forEach(inp=>{ inp.value = (st.h&&st.h[inp.dataset.w]!=null)?st.h[inp.dataset.w]:0; });
    // manual rows
    manualBody.innerHTML='';
    (st.r||[]).forEach(([t,w,n],i)=>addRow(t,w,n??(i+1)));
    if(st.gf!=null) $('gameFps').value=st.gf;
    if(st.rs!=null) $('respawn').value=st.rs;
    if(st.sk!=null) $('skill').value=st.sk;
    if(st.rl!=null) $('refL').value=st.rl;
    applyListUI(!!st.lh);
    // run
    if(st.run){ $('runOn').checked=!!st.run[0]; $('runRange').value=st.run[1]??''; }
    if(st.sm!=null) $('smooth').value=st.sm;
    // apply unit + mode UI directly (no value conversion — values are stored as displayed)
    applyUnitUI(['pct','frames'].includes(st.u)?st.u:'sec');
    applyModeUI(st.m==='manual'?'manual':'hist');
    applyCalcUI(st.cm==='fixed'?'fixed':'solve');
  } finally { restoring=false; }
  return true;
}

// ---- copy shareable link ---------------------------------------------------
$('copyLink').addEventListener('click',async()=>{
  updateHash();
  const status=$('copyStatus');
  try{
    await navigator.clipboard.writeText(location.href);
    status.style.color='var(--good)'; status.textContent='Link copied to clipboard.';
  }catch(_){
    status.style.color='var(--warn)'; status.textContent='Copy failed — copy the URL from the address bar.';
  }
  setTimeout(()=>{status.textContent='';},2600);
});

// ---- offline service worker ------------------------------------------------
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{});
    navigator.serviceWorker.ready.then(()=>$('offlineBadge').classList.add('show')).catch(()=>{});
  });
}

// ---- init ------------------------------------------------------------------
document.addEventListener('input',recompute);
document.addEventListener('change',recompute);

if(!restore()){
  // seed with the example only when there's no shared state to restore
  [[1.9,2],[2.3,6],[2.4,19]].forEach(r=>addRow(r[0],r[1]));
}
recompute();
