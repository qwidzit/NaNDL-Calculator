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

// Local clicks/sec at input j (1/gap to the previous input; first uses the next).
export function localCps(inputs,j,T){
  const n=inputs.length;
  if(n===1) return T>0?1/T:0;
  let gap = j===0 ? (inputs[1].t-inputs[0].t) : (inputs[j].t-inputs[j-1].t);
  if(!(gap>0)) gap=1e-6;
  return 1/gap;
}

// Per-input effective pass probabilities with modifiers applied. Shared by
// evaluate() and perInputStats() so the modifier math lives in exactly one place.
function passProbs(L,cfg){
  const {inputs,f,T,mods}=cfg;
  const M=inputs.length;
  const ps=new Array(M);
  for(let j=0;j<M;j++){
    const inp=inputs[j];
    let s=0.5*(inp.k/f)*L;
    if(mods.nerve.on)   s*=Math.exp(-mods.nerve.k*inp.t);
    if(mods.fatigue.on) s*=Math.exp(-mods.fatigue.k*(j+1));
    if(mods.cps.on){ const c=localCps(inputs,j,T); s*=Math.pow(4/Math.max(1,2*c),mods.cps.k); }
    ps[j]=passProb(s);
  }
  return ps;
}

// Compute E[T_C] (expected time to complete) and P(C) for a precision L.
// inputs must be sorted ascending by t. cfg = { inputs:[{t,k}], f, T, mods }.
export function evaluate(L,cfg){
  const {inputs,T}=cfg;
  const M=inputs.length;
  if(M===0) return {ETC:Infinity,PC:0};
  const tn=Math.max(T, inputs[M-1].t);
  const ps=passProbs(L,cfg);
  let logPC=0; for(let j=0;j<M;j++) logPC+=Math.log(ps[j]);
  const PC=Math.exp(logPC);
  let r=1,sumFail=0;
  for(let j=0;j<M;j++){ sumFail+=inputs[j].t*r*(1-ps[j]); r*=ps[j]; }
  const ETA=tn*PC+sumFail;
  return {ETC: PC>0?ETA/PC:Infinity, PC};
}

// Per-input breakdown at precision L: for each input, its pass prob p, reach
// prob r = ∏_{l<j} p_l (prob of arriving at it alive), and q = 1 - p. The arrays
// evaluate() computes internally and discards — surfaced for the breakdown table.
export function perInputStats(L,cfg){
  const {inputs}=cfg;
  const M=inputs.length;
  const ps=passProbs(L,cfg);
  const out=new Array(M);
  let r=1;
  for(let j=0;j<M;j++){
    out[j]={t:inputs[j].t, k:inputs[j].k, p:ps[j], r, q:1-ps[j]};
    r*=ps[j];
  }
  return out;
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
    .map(inp=>({t: inp.t-lo, k: inp.k}))
    .sort((a,b)=>a.t-b.t);
}

// Estimate a smooth "difficulty across the level" curve (for manual mode).
// Each input contributes difficulty d = 1/window (tighter window = harder) at its
// position x% = t/T. The curve at each sampled x is a Gaussian-kernel sum of those
// contributions, so it rises where windows are tight and/or inputs are clustered,
// and falls to ~0 in empty stretches. `bandwidthPct` (from the smoothness slider)
// is the kernel width in % units — larger = smoother. ys are normalized to [0,1].
// fps is irrelevant to the shape (a global constant), so it isn't needed here.
export function difficultyProfile(inputs, T, opts={}){
  const samples = opts.samples || 240;
  const h = Math.max(0.3, opts.bandwidthPct || 4);   // % bandwidth, floored
  const pts = [];
  if(T>0) for(const i of inputs){ if(i.k>0) pts.push({x: i.t/T*100, d: 1/i.k}); }
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
