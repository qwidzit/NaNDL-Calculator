"use strict";

// ============================================================================
// NaNDL precision math — pure, framework-free, no DOM access.
// See NaNDL_calculator_spec.md §2 (math model) and §4 (code map).
// evaluate()/solveLstar() are a verbatim lift from the original prototype, so
// the spec §6 regression values still hold. perInputStats() and sliceRun() are
// additive helpers for the per-input breakdown and run/segment features.
// ============================================================================

// Largest frame-window size the histogram grid supports (1f … 20f).
export const MAXW = 20;

// Calibrated modifier constants, taken from the official NaNDL calculator
// (nandl.pages.dev) — these replace the earlier placeholder guesses.
// Note: upstream still labels the CPS multiplier "WIP, unreliable".
export const NANDL_CONSTANTS = Object.freeze({
  nerve:   0.0016520833717346,   // k_t
  fatigue: 0.0002727763242154,   // k_u
  cps:     0.2784421686721826,   // k_c
});

// Error function approximation (Numerical Recipes erfcc, |error| < 1.2e-7).
// JS has no Math.erf, so this is implemented directly. Anchor: erf(1) ≈ 0.8427.
export function erf(x){
  const z = Math.abs(x);
  const t = 1/(1+0.5*z);
  const ans = t*Math.exp(-z*z - 1.26551223 + t*(1.00002368 + t*(0.37409196 +
    t*(0.09678418 + t*(-0.18628806 + t*(0.27886807 + t*(-1.13520398 +
    t*(1.48851587 + t*(-0.82215223 + t*0.17087277)))))))));
  const erfc = x>=0 ? ans : 2-ans;
  return 1-erfc;
}

// Pass probability for a sigma value s: P(|Z| ≤ s) = erf(s/√2), clamped to (0,1).
export function passProb(s){
  if(s<=0) return 0;
  return Math.min(Math.max(erf(s/Math.SQRT2),0), 1-1e-15);
}

// Evenly interleave a histogram (obj window->count) into a sequence of window
// sizes — repeatedly place the window most "behind" its fair share (no clustering).
export function buildSequence(counts){
  const windows = Object.keys(counts).map(Number).filter(k=>counts[k]>0).sort((a,b)=>a-b);
  const total = windows.reduce((s,k)=>s+counts[k],0);
  const used = {}; windows.forEach(k=>used[k]=0);
  const seq = [];
  for(let j=0;j<total;j++){
    let best=null,br=Infinity;
    for(const k of windows){
      if(used[k]>=counts[k]) continue;
      const ratio=(used[k]+0.5)/counts[k];
      if(ratio<br){br=ratio;best=k;}
    }
    seq.push(best); used[best]++;
  }
  return seq;
}

// Histogram -> inputs [{t,k}] via even spacing across the level length T.
export function histInputs(counts,T){
  const seq=buildSequence(counts);
  const M=seq.length;
  const dt=M>0?T/M:0;
  return seq.map((k,j)=>({t:(j+0.5)*dt,k}));
}

// Input number of row j (official notation `i`, 1-based). Falls back to the row
// position when a list carries no explicit numbers.
export function inputNumber(inputs,j){
  const n = inputs[j] && inputs[j].n;
  return (typeof n==='number' && isFinite(n)) ? n : (j+1);
}

// Local clicks/sec at input j — official: c_i = (i − i′)/(t_i − t_i′), where i′ is
// the previous input. The numerator counts the clicks since that input (which is
// why it uses input numbers, not 1), so skipped/ignored numbering widens the gap.
// Consecutively numbered inputs reduce to the familiar 1/gap.
export function localCps(inputs,j,T){
  const n=inputs.length;
  if(n===1) return T>0?1/T:0;
  const a = j===0 ? 0 : j-1, b = j===0 ? 1 : j;
  let gap = inputs[b].t - inputs[a].t;
  if(!(gap>0)) gap=1e-6;
  let dn = inputNumber(inputs,b) - inputNumber(inputs,a);
  if(!(dn>0)) dn=1;
  return dn/gap;
}

// Effective frame window for input j. A row with an ignored/default window
// (k null/"-") passes automatically — unless CPS is on, where the official
// calculator substitutes one more than the run's largest numeric window.
// Returns null to mean "always passes".
export function effectiveWindow(inputs,j,mods){
  const k = inputs[j] && inputs[j].k;
  if(typeof k==='number' && isFinite(k) && k>0) return k;
  if(!(mods && mods.cps && mods.cps.on)) return null;
  let max=0;
  for(const inp of inputs){ if(typeof inp.k==='number' && isFinite(inp.k) && inp.k>max) max=inp.k; }
  return max+1;
}

// Per-input effective pass probabilities with modifiers applied. Shared by
// evaluate() and perInputStats() so the modifier math lives in exactly one place.
function passProbs(L,cfg){
  const {inputs,f,T,mods}=cfg;
  const M=inputs.length;
  const ps=new Array(M);
  for(let j=0;j<M;j++){
    const inp=inputs[j];
    const k=effectiveWindow(inputs,j,mods);
    if(k===null){ ps[j]=1; continue; }          // ignored window -> always passes
    let s=0.5*(k/f)*L;
    if(mods.nerve.on)   s*=Math.exp(-mods.nerve.k*inp.t);
    if(mods.fatigue.on) s*=Math.exp(-mods.fatigue.k*inputNumber(inputs,j));
    if(mods.cps.on){ const c=localCps(inputs,j,T); s*=Math.pow(4/Math.max(1,2*c),mods.cps.k); }
    ps[j]=passProb(s);
  }
  return ps;
}

// Compute E[T_C] (expected time to complete) and P(C) for a precision L.
// inputs must be sorted ascending by t. cfg = { inputs:[{t,k}], f, T, mods }.
// Respawn time R is added to every attempt. Adding it to each time position is
// equivalent, since Σ rᵢqᵢ + P(C) = 1, so it contributes exactly R per attempt.
export function evaluate(L,cfg){
  const {inputs,T,respawn=0}=cfg;
  const M=inputs.length;
  if(M===0) return {ETC:Infinity,PC:0,ETA:respawn,attempts:Infinity};
  const tn=Math.max(T, inputs[M-1].t);
  const ps=passProbs(L,cfg);
  let logPC=0; for(let j=0;j<M;j++) logPC+=Math.log(ps[j]);
  const PC=Math.exp(logPC);
  let r=1,sumFail=0;
  for(let j=0;j<M;j++){ sumFail+=inputs[j].t*r*(1-ps[j]); r*=ps[j]; }
  const ETA=tn*PC+sumFail+respawn;
  return {ETC: PC>0?ETA/PC:Infinity, PC, ETA, attempts: PC>0?1/PC:Infinity};
}

// Per-input breakdown at precision L: for each input, its pass prob p, reach
// prob r = ∏_{l<j} p_l (prob of arriving at it alive), and q = 1 - p. The arrays
// evaluate() computes internally and discards — surfaced for the breakdown table.
export function perInputStats(L,cfg){
  const {inputs,mods}=cfg;
  const M=inputs.length;
  const ps=passProbs(L,cfg);
  const out=new Array(M);
  let r=1;
  for(let j=0;j<M;j++){
    const kEff=effectiveWindow(inputs,j,mods);
    out[j]={t:inputs[j].t, k:inputs[j].k, kEff, ignored:!(inputs[j].k>0),
            n:inputNumber(inputs,j), p:ps[j], r, q:1-ps[j]};
    r*=ps[j];
  }
  return out;
}

// Grind entropy — the information content of one clean run at precision L:
//
//     G = −log₂ P(C) = Σᵢ −log₂ pᵢ        (bits)
//
// Physically: how many bits of "luck" a completion costs, so expected attempts
// ≈ 2^G and one extra bit means twice the grind. Unlike L*, G is EXACTLY
// additive — G(A then B) = G(A) + G(B) — because it lives in log space, which
// makes segments and back-to-back levels simply add up. Each input carries its
// own gᵢ, so the total decomposes per input.
//
// G is defined at a reference precision L, which must be supplied (that is what
// buys the additivity). Respawn time does not affect G: it changes how long an
// attempt costs, not how improbable one is.
export function grindEntropy(L,cfg){
  const ps=passProbs(L,cfg);
  const per=new Array(ps.length);
  let bits=0;
  for(let j=0;j<ps.length;j++){
    const b = ps[j]>0 ? -Math.log2(ps[j]) : Infinity;
    per[j]=b; bits+=b;
  }
  return {bits, per, attempts: Math.pow(2,bits)};
}

// Bisection for L* where E[T_C] == targetSec. Expands the upper bracket first.
export function solveLstar(cfg,targetSec){
  if(cfg.inputs.length===0) return null;
  let lo=0,hi=1,guard=0;
  while(evaluate(hi,cfg).ETC>targetSec){ hi*=2; if(++guard>300) break; }
  for(let i=0;i<200;i++){
    const mid=0.5*(lo+hi);
    if(evaluate(mid,cfg).ETC>targetSec) lo=mid; else hi=mid;
  }
  return 0.5*(lo+hi);
}

// Extract a run/segment: keep inputs whose absolute time lies in [startSec,endSec]
// (endpoints inclusive) and re-base them so the segment starts at 0, turning a
// slice of the level into its own self-contained level. Returns a new sorted
// array; the segment's level length is (endSec - startSec), computed by the caller.
export function sliceRun(inputs,startSec,endSec){
  const lo=Math.min(startSec,endSec), hi=Math.max(startSec,endSec);
  const eps=1e-9;
  return inputs
    .filter(inp=> inp.t>=lo-eps && inp.t<=hi+eps)
    .map(inp=>({t: inp.t-lo, k: inp.k, n: inp.n}))
    .sort((a,b)=>a.t-b.t);
}

// Estimate a smooth "difficulty across the level" curve (for manual mode).
// Each input contributes difficulty d = 1/(window · λ) at its position x% = t/T,
// where λ is the product of the enabled modifier multipliers (same λ evaluate()
// applies to the sigma value) — so a modifier that tightens the effective window
// (λ < 1) raises that input's difficulty. The curve at each sampled x is a
// Gaussian-kernel sum of those contributions, so it rises where windows are tight
// and/or inputs are clustered, and falls to ~0 in empty stretches. `bandwidthPct`
// (from the smoothness slider) is the kernel width in % units — larger = smoother.
// ys are normalized to [0,1]. fps cancels under normalization, so it isn't needed.
// `inputs` must be sorted ascending by t (fatigue/CPS depend on index & gaps).
export function difficultyProfile(inputs, T, mods, opts={}){
  const samples = opts.samples || 240;
  const h = Math.max(0.3, opts.bandwidthPct || 4);   // % bandwidth, floored
  const m = mods || { nerve:{on:false}, fatigue:{on:false}, cps:{on:false} };
  const pts = [];
  if(T>0) for(let i=0;i<inputs.length;i++){
    const inp=inputs[i];
    const k=effectiveWindow(inputs,i,m);
    if(k===null) continue;                  // ignored window contributes no difficulty
    let lambda=1;
    if(m.nerve   && m.nerve.on)   lambda *= Math.exp(-m.nerve.k*inp.t);
    if(m.fatigue && m.fatigue.on) lambda *= Math.exp(-m.fatigue.k*inputNumber(inputs,i));
    if(m.cps     && m.cps.on){ const c=localCps(inputs,i,T); lambda *= Math.pow(4/Math.max(1,2*c), m.cps.k); }
    if(!(lambda>0)) lambda=1e-9;
    pts.push({x: inp.t/T*100, d: (1/k)/lambda});
  }
  const xmax = Math.max(100, ...pts.map(p=>p.x), 0);
  const xs = new Array(samples+1), ys = new Array(samples+1);
  const norm = 1/(h*Math.sqrt(2*Math.PI));
  let maxAbs = 0, peakX = 0;
  for(let j=0;j<=samples;j++){
    const x = xmax*j/samples;
    let g = 0;
    for(const p of pts){ const z=(x-p.x)/h; g += p.d*norm*Math.exp(-0.5*z*z); }
    xs[j]=x; ys[j]=g;
    if(g>maxAbs){ maxAbs=g; peakX=x; }
  }
  const inv = maxAbs>0 ? 1/maxAbs : 0;
  for(let j=0;j<=samples;j++) ys[j]*=inv;
  return { xs, ys, xmax, peakXPct: peakX, maxAbs, count: pts.length };
}

// Parse a pasted/imported list into [[time, window], …]. Each line is a number
// pair separated by a dash (spaces optional) OR by a tab / spaces — so "1.5 - 3",
// spreadsheet-style "0.55\t3", and "10 4" all work. An optional unit label on
// either number is ignored, so "35.29 - 5f" (5 frames) and "35.29s - 5 frames"
// read as [35.29, 5]. Blank/garbage lines (no valid number pair) are skipped.
export function parseInputsText(text){
  const out=[];
  String(text).split(/\r?\n/).forEach(line=>{
    const m=line.match(/(-?\d*\.?\d+)[a-zA-Z%]*(?:\s*-\s*|\s+)(\d*\.?\d+)/);
    if(m){ const t=parseFloat(m[1]), w=parseFloat(m[2]); if(!isNaN(t)&&!isNaN(w)) out.push([t,w]); }
  });
  return out;
}

// Tally how many inputs use each frame-window size. Integer sizes from 1 up to
// the largest one present are all included (zero-count ones too) so the spread
// reads as a histogram rather than a sparse list; any non-integer sizes that
// occur are folded in at their sorted position. Rows with an ignored window are
// counted separately rather than bucketed. The zero-fill is capped so a stray
// huge window can't spray thousands of empty buckets into the DOM.
export function windowCounts(inputs, fillLimit=400){
  const map=new Map();
  let max=0, ignored=0, total=0;
  for(const inp of (inputs||[])){
    const k=inp && inp.k;
    if(typeof k==='number' && isFinite(k) && k>0){
      map.set(k,(map.get(k)||0)+1);
      if(k>max) max=k;
      total++;
    } else ignored++;
  }
  const keys=new Set(map.keys());
  const filled = max<=fillLimit;
  if(filled) for(let i=1;i<=Math.floor(max);i++) keys.add(i);
  const rows=[...keys].sort((a,b)=>a-b).map(k=>({k, count: map.get(k)||0}));
  return {rows, max, total, ignored, distinct: map.size, filled};
}

/* ============================ JSON interchange ============================
 * The official NaNDL calculator exchanges runs as JSON containing the
 * frame-window rows, Game FPS, Window FPS, respawn time, and whether time
 * positions are seconds or frame numbers. Key spellings are matched
 * case/format-insensitively (gameFps == game_fps == "Game FPS") so an export
 * from either tool imports here.
 * ======================================================================== */

// Normalize a key for lookup: lowercase, strip anything non-alphanumeric.
const normKey = k => String(k).toLowerCase().replace(/[^a-z0-9]/g,'');

// Find the first present key from `names` in a plain object (format-insensitive).
function pick(obj, names){
  if(!obj || typeof obj!=='object') return undefined;
  const map = new Map(Object.keys(obj).map(k=>[normKey(k), obj[k]]));
  for(const n of names){ const v=map.get(normKey(n)); if(v!==undefined && v!==null) return v; }
  return undefined;
}
function pickNum(obj, names){
  const v = pick(obj, names);
  if(v===undefined) return undefined;
  const n = typeof v==='number' ? v : parseFloat(String(v));
  return isNaN(n) ? undefined : n;
}
function pickBool(obj, names){
  const v = pick(obj, names);
  if(v===undefined) return undefined;
  if(typeof v==='boolean') return v;
  const s = String(v).trim().toLowerCase();
  if(['true','1','yes','frames','frame'].includes(s)) return true;
  if(['false','0','no','seconds','second','sec'].includes(s)) return false;
  return undefined;
}

const ROW_KEYS    = ['inputs','rows','inputRows','frameWindows','windows','data','entries','list'];
const TIME_KEYS   = ['timePosition','time','t','position','frameNumber','framePosition','frame','seconds'];
const WINDOW_KEYS = ['frameWindow','window','frames','windowFrames','w','n'];
const NUM_KEYS    = ['inputNumber','number','index','i','id'];

// Parse a calculator JSON document into a normalized shape:
//   { ok:true, gameFps, windowFps, respawnTime, useFrames,
//     inputs:[{t,k}] (t in SECONDS), ignored, rowCount }
// `inputs` excludes rows with an ignored/default window ("-"), counted in `ignored`.
// Returns { ok:false, error } when the document has no usable rows.
export function parseCalculatorJson(text){
  let doc;
  try{ doc = typeof text==='string' ? JSON.parse(text) : text; }
  catch(e){ return {ok:false, error:'Not valid JSON.'}; }
  if(!doc || typeof doc!=='object') return {ok:false, error:'JSON root must be an object or array.'};

  // rows may be the root array, a known key, or the first array-of-objects present
  let rows = Array.isArray(doc) ? doc : pick(doc, ROW_KEYS);
  if(!Array.isArray(rows)){
    const arr = Object.values(doc).find(v=>Array.isArray(v) && v.length && typeof v[0]==='object');
    if(Array.isArray(arr)) rows = arr;
  }
  if(!Array.isArray(rows)) return {ok:false, error:'No input rows found in the JSON.'};

  const root = Array.isArray(doc) ? {} : doc;
  const gameFps    = pickNum(root, ['gameFps','gameFramerate','gameFrameRate','fpsGame']) ?? 240;
  const windowFps  = pickNum(root, ['windowFps','windowFramerate','fps','frameRate','framerate']) ?? 240;
  const respawn    = pickNum(root, ['respawnTime','respawn','respawnSeconds']) ?? 0;
  const useFrames  = pickBool(root, ['useFrames','useFrameNumbers','framePositions','framesAsTime']) ?? false;

  const inputs=[]; let ignored=0;
  for(const row of rows){
    // rows may be objects, or bare [time, window] pairs
    let tRaw, kRaw;
    if(Array.isArray(row)){ tRaw=row[0]; kRaw=row[1]; }
    else if(row && typeof row==='object'){ tRaw=pick(row,TIME_KEYS); kRaw=pick(row,WINDOW_KEYS); }
    else continue;

    const t = typeof tRaw==='number' ? tRaw : parseFloat(String(tRaw));
    if(!isFinite(t)) continue;

    // "-" / "" / null mark an ignored (default) frame window upstream
    const kStr = kRaw===undefined || kRaw===null ? '' : String(kRaw).trim();
    const kNum = kStr==='' || kStr==='-' ? NaN : parseFloat(kStr);
    const isIgnored = !isFinite(kNum) || kNum<=0;
    if(isIgnored) ignored++;

    // frame-number positions convert to seconds via Game FPS
    const tSec = useFrames && gameFps>0 ? t/gameFps : t;
    if(tSec<0) continue;
    const nRaw = Array.isArray(row) ? row[2] : pick(row, NUM_KEYS);
    const n = nRaw===undefined ? undefined : parseFloat(String(nRaw));
    inputs.push({t:tSec, k: isIgnored ? null : kNum, n: isFinite(n)?n:undefined});
  }
  if(inputs.length===0) return {ok:false, error:'No usable inputs (rows had no valid time position).'};
  inputs.sort((a,b)=>a.t-b.t);
  return {ok:true, gameFps, windowFps, respawnTime:respawn, useFrames, inputs, ignored, rowCount:rows.length};
}

// Build a calculator JSON document from our state. Times are written in
// seconds (useFrames:false), which the official format supports directly.
export function buildCalculatorJson({inputs, fps, respawnTime=0}={}){
  const list = Array.isArray(inputs)?inputs:[];
  return {
    gameFps: fps,
    windowFps: fps,
    respawnTime,
    useFrames: false,
    inputs: list.map((inp,i)=>({
      inputNumber: (typeof inp.n==='number' && isFinite(inp.n)) ? inp.n : i+1,
      timePosition: inp.t,
      frameWindow: (typeof inp.k==='number' && isFinite(inp.k) && inp.k>0) ? inp.k : '-',
    })),
  };
}
