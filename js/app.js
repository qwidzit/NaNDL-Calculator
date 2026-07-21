// ============================================================================
// UI layer — all DOM access lives here. Imports the pure math from calc.js.
// Builds the histogram grid + manual rows, handles the mode/unit toggles and
// the .txt import + guide modal, and runs recompute() on every input/change.
// ============================================================================

import { MAXW, histInputs, evaluate, solveLstar } from "./calc.js";

let mode="hist";
let unit="sec";

// build histogram grid
const grid=document.getElementById('grid');
for(let k=1;k<=MAXW;k++){
  const cell=document.createElement('div');
  cell.className='cell';
  cell.innerHTML=`<label><span class="win">${k}f</span> <span class="ms" id="ms${k}"></span></label>
    <input type="number" min="0" step="1" value="0" data-w="${k}">`;
  grid.appendChild(cell);
}

// manual rows
const manualBody=document.getElementById('manualBody');
function addRow(time,frames){
  const tr=document.createElement('tr');
  tr.innerHTML=`
    <td><input type="number" class="mTime" step="0.01" min="0" value="${time??''}"></td>
    <td><input type="number" class="mWin" step="1" min="1" value="${frames??''}"></td>
    <td class="mMs" style="font-size:11px;color:#5b6675">—</td>
    <td><button class="del">&times;</button></td>`;
  tr.querySelector('.del').addEventListener('click',()=>{tr.remove(); recompute();});
  manualBody.appendChild(tr);
}
// seed with the example
[[1.9,2],[2.3,6],[2.4,19]].forEach(r=>addRow(r[0],r[1]));
document.getElementById('addRow').addEventListener('click',()=>{addRow('', ''); recompute();});

// mode toggle
document.getElementById('modeSeg').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b) return;
  mode=b.dataset.mode;
  document.querySelectorAll('#modeSeg button').forEach(x=>x.classList.toggle('active',x===b));
  document.getElementById('histPanel').classList.toggle('hidden',mode!=='hist');
  document.getElementById('manualPanel').classList.toggle('hidden',mode!=='manual');
  recompute();
});

// unit toggle (converts existing values so real times stay fixed)
document.getElementById('unitSeg').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b || b.dataset.unit===unit) return;
  const newUnit=b.dataset.unit;
  const T=num('tlen');
  if(T>0){
    document.querySelectorAll('#manualBody .mTime').forEach(inp=>{
      const v=parseFloat(inp.value);
      if(!isNaN(v)){
        inp.value = newUnit==='pct' ? +( (v/T*100).toFixed(4) ) : +( (v/100*T).toFixed(4) );
      }
    });
  }
  unit=newUnit;
  document.querySelectorAll('#unitSeg button').forEach(x=>x.classList.toggle('active',x===b));
  document.getElementById('unitLabelHead').textContent = unit==='pct' ? '%' : 's';
  recompute();
});

// import .txt + format guide
const fileInput=document.getElementById('fileInput');
document.getElementById('importBtn').addEventListener('click',()=>fileInput.click());
fileInput.addEventListener('change',e=>{
  const file=e.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=ev=>importText(String(ev.target.result));
  reader.readAsText(file);
  fileInput.value='';
});
function importText(text){
  const status=document.getElementById('imStatus');
  const parsed=[];
  text.split(/\r?\n/).forEach(line=>{
    const m=line.match(/(-?\d*\.?\d+)\s*-\s*(\d*\.?\d+)/);
    if(m){ const t=parseFloat(m[1]), w=parseFloat(m[2]); if(!isNaN(t)&&!isNaN(w)) parsed.push([t,w]); }
  });
  if(parsed.length===0){
    status.style.color='var(--warn)';
    status.textContent='No valid "time - window" lines found — see the format guide.';
    document.getElementById('guideModal').classList.add('show');
    return;
  }
  manualBody.innerHTML='';
  parsed.forEach(r=>addRow(r[0],r[1]));
  status.style.color='var(--good)';
  status.textContent=`Imported ${parsed.length} input${parsed.length>1?'s':''} (read as ${unit==='pct'?'%':'seconds'}).`;
  recompute();
}
const guideModal=document.getElementById('guideModal');
document.getElementById('guideBtn').addEventListener('click',()=>guideModal.classList.add('show'));
document.getElementById('guideClose').addEventListener('click',()=>guideModal.classList.remove('show'));
guideModal.addEventListener('click',e=>{ if(e.target===guideModal) guideModal.classList.remove('show'); });

function num(id){const v=parseFloat(document.getElementById(id).value); return isNaN(v)?0:v;}

function readManual(T){
  const rows=[...document.querySelectorAll('#manualBody tr')];
  const inputs=[];
  rows.forEach(tr=>{
    const tv=parseFloat(tr.querySelector('.mTime').value);
    const kv=parseFloat(tr.querySelector('.mWin').value);
    const msCell=tr.querySelector('.mMs');
    if(!isNaN(kv) && kv>=1 && !isNaN(tv) && tv>=0){
      const tSec = unit==='pct' ? (tv/100*T) : tv;
      inputs.push({t:tSec,k:kv});
      msCell.textContent = (num('fps')>0)?(1000*kv/num('fps')).toFixed(2)+'ms':'—';
    } else {
      msCell.textContent='—';
    }
  });
  inputs.sort((a,b)=>a.t-b.t);
  return inputs;
}

function recompute(){
  const f=num('fps')||240;
  const T=num('tlen');
  const targetH=num('target');

  // histogram ms labels
  for(let k=1;k<=MAXW;k++){
    const el=document.getElementById('ms'+k);
    if(el) el.textContent = f>0 ? (1000*k/f).toFixed(2)+'ms' : '';
  }

  let inputs=[];
  if(mode==='hist'){
    const counts={}; let total=0;
    document.querySelectorAll('#grid input').forEach(inp=>{
      const w=+inp.dataset.w; const c=Math.max(0,Math.floor(parseFloat(inp.value)||0));
      if(c>0){counts[w]=c; total+=c;}
    });
    document.getElementById('histTotal').textContent=total;
    if(total>0 && T>0) inputs=histInputs(counts,T);
  } else {
    inputs=readManual(T);
    document.getElementById('manTotal').textContent=inputs.length;
  }

  const stats=document.getElementById('stats');
  const big=document.getElementById('lstar');
  const rsub=document.getElementById('rsub');
  const show=(msg)=>{big.textContent='—'; rsub.className='rsub msg'; rsub.textContent=msg; stats.style.display='none';};

  if(!(T>0)) return show('Enter a level length greater than 0.');
  if(inputs.length===0) return show('Add at least one input.');
  if(!(targetH>0)) return show('Enter a target time greater than 0.');

  const mods={
    nerve:{on:document.getElementById('nerveOn').checked, k:num('nerveK')},
    fatigue:{on:document.getElementById('fatigueOn').checked, k:num('fatigueK')},
    cps:{on:document.getElementById('cpsOn').checked, k:num('cpsK')},
  };
  const cfg={inputs, f, T, mods};
  const targetSec=targetH*3600;
  const Lstar=solveLstar(cfg,targetSec);
  const chk=evaluate(Lstar,cfg);

  big.textContent=Lstar.toLocaleString(undefined,{maximumFractionDigits:1});
  rsub.className='rsub';
  rsub.innerHTML=`Precision required to average a <b>${targetH}-hour</b> completion of this ${inputs.length}-input level.`;
  stats.style.display='flex';
  document.getElementById('sigma').textContent=(1000/Lstar).toFixed(2)+' ms';
  document.getElementById('pc').textContent=chk.PC<1e-4?chk.PC.toExponential(2):(chk.PC*100).toFixed(3)+'%';
  document.getElementById('etc').textContent=(chk.ETC/3600).toFixed(2)+' h';
}

document.addEventListener('input',recompute);
document.addEventListener('change',recompute);
recompute();
