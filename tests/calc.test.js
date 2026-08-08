// Regression tests for the pure math module, from NaNDL_calculator_spec.md §6.
// Run with: npm test   (a.k.a. `node --test`) — no dependencies.

import { test } from "node:test";
import assert from "node:assert/strict";
import { erf, passProb, histInputs, evaluate, solveLstar, perInputStats, sliceRun, difficultyProfile,
         parseInputsText, NANDL_CONSTANTS, parseCalculatorJson, buildCalculatorJson,
         localCps, grindEntropy, windowCounts, grindTime } from "../js/calc.js";

// Shared setup from spec §6: f=240, T=60s, target=24h, modifiers off unless noted.
const F = 240;
const T = 60;
const TARGET_SEC = 24 * 3600;

const modsOff = {
  nerve:   { on: false, k: 0.0015 },
  fatigue: { on: false, k: 0.00075 },
  cps:     { on: false, k: 2 },
};
const modsOn = {
  nerve:   { on: true, k: 0.0015 },
  fatigue: { on: true, k: 0.00075 },
  cps:     { on: true, k: 2 },
};

// Assert |actual - expected| / |expected| <= relTol (3 sig figs => ~5e-3 is plenty;
// the math is a verbatim lift so it matches far tighter, but bisection has a floor).
function approxRel(actual, expected, relTol, label) {
  // Fall back to absolute error when the expected value is 0 (relative is undefined).
  const err = expected === 0
    ? Math.abs(actual - expected)
    : Math.abs(actual - expected) / Math.abs(expected);
  assert.ok(
    err <= relTol,
    `${label}: expected ~${expected}, got ${actual} (err ${err.toExponential(2)} > ${relTol})`
  );
}

function lstarOf(inputs, mods) {
  return solveLstar({ inputs, f: F, T, mods }, TARGET_SEC);
}

test("erf / passProb anchors", () => {
  approxRel(erf(1), 0.8427, 1e-3, "erf(1)");
  approxRel(passProb(1), 0.6827, 1e-3, "passProb(1)");
  approxRel(passProb(2), 0.9545, 1e-3, "passProb(2)");
});

test("histogram, modifiers off -> L* = 175.543", () => {
  const counts = { 1: 1, 2: 3, 3: 10, 4: 15, 6: 20, 8: 30, 12: 40, 20: 68 };
  const inputs = histInputs(counts, T);
  assert.equal(inputs.length, 187, "187 synthesized inputs");

  const L = lstarOf(inputs, modsOff);
  approxRel(L, 175.543, 1e-3, "histogram L*");

  // E[T_C] should land on the 24h target, and P(C) ~ 9.05e-5.
  const chk = evaluate(L, { inputs, f: F, T, mods: modsOff });
  approxRel(chk.ETC / 3600, 24.0, 1e-3, "histogram E[T_C] (h)");
  approxRel(chk.PC, 9.05e-5, 2e-2, "histogram P(C)");
});

test("histogram, all modifiers on -> L* = 485.318", () => {
  const counts = { 1: 1, 2: 3, 3: 10, 4: 15, 6: 20, 8: 30, 12: 40, 20: 68 };
  const inputs = histInputs(counts, T);
  const L = lstarOf(inputs, modsOn);
  approxRel(L, 485.318, 1e-3, "histogram+mods L*");
});

test("manual (seconds), modifiers off -> L* = 2.763", () => {
  const inputs = [ { t: 1.9, k: 2 }, { t: 2.3, k: 6 }, { t: 2.4, k: 19 } ];
  const L = lstarOf(inputs, modsOff);
  approxRel(L, 2.763, 1e-3, "manual L*");
});

test("manual (seconds), all modifiers on -> L* = 10.941", () => {
  const inputs = [ { t: 1.9, k: 2 }, { t: 2.3, k: 6 }, { t: 2.4, k: 19 } ];
  const L = lstarOf(inputs, modsOn);
  approxRel(L, 10.941, 1e-3, "manual+mods L*");
});

test("import sample read as seconds -> L* = 19.161", () => {
  const inputs = [
    { t: 1.5, k: 3 }, { t: 2.1, k: 5 }, { t: 2.9, k: 15 }, { t: 5.1, k: 8 },
    { t: 5.5, k: 8 }, { t: 8.1, k: 11 }, { t: 10, k: 4 },
  ];
  const L = lstarOf(inputs, modsOff);
  approxRel(L, 19.161, 1e-3, "import-seconds L*");

  const chk = evaluate(L, { inputs, f: F, T, mods: modsOff });
  approxRel(chk.ETC / 3600, 24.0, 1e-3, "import-seconds E[T_C] (h)");
});

test("import sample read as % of 60s -> L* = 17.749", () => {
  // Same 7 numbers, but the time column is read as a percentage of the level.
  const raw = [ [1.5, 3], [2.1, 5], [2.9, 15], [5.1, 8], [5.5, 8], [8.1, 11], [10, 4] ];
  const inputs = raw
    .map(([pct, k]) => ({ t: (pct / 100) * T, k }))
    .sort((a, b) => a.t - b.t);
  const L = lstarOf(inputs, modsOff);
  approxRel(L, 17.749, 1e-3, "import-percent L*");
});

// --- additive helpers (per-input breakdown + run/segment) --------------------

test("perInputStats: p/r consistent with evaluate's P(C)", () => {
  const inputs = [ { t: 1.9, k: 2 }, { t: 2.3, k: 6 }, { t: 2.4, k: 19 } ];
  const cfg = { inputs, f: F, T, mods: modsOff };
  const L = 5;
  const per = perInputStats(L, cfg);
  assert.equal(per.length, 3);
  // reach of the first input is 1 (you always arrive at it)
  approxRel(per[0].r, 1, 1e-12, "first reach");
  // P(C) == product of all pass probs == last reach * last p
  const prodP = per.reduce((a, s) => a * s.p, 1);
  approxRel(prodP, evaluate(L, cfg).PC, 1e-9, "prod(p) == P(C)");
  // reach[j] == product of p for l < j
  approxRel(per[2].r, per[0].p * per[1].p, 1e-12, "reach[2]");
  // q == 1 - p
  for (const s of per) approxRel(s.q, 1 - s.p, 1e-12, "q");
});

test("sliceRun: filters to [start,end] and re-bases to 0", () => {
  const inputs = [
    { t: 10, k: 3 }, { t: 23.2, k: 5 }, { t: 50, k: 8 }, { t: 81.8, k: 4 }, { t: 90, k: 6 },
  ];
  const seg = sliceRun(inputs, 23.2, 81.8); // e.g. a "23.2-81.8" run
  assert.equal(seg.length, 3, "endpoints inclusive, outside dropped");
  approxRel(seg[0].t, 0, 1e-9, "segment starts at 0");
  approxRel(seg[1].t, 50 - 23.2, 1e-9, "middle re-based");
  approxRel(seg[2].t, 81.8 - 23.2, 1e-9, "end re-based");
  assert.deepEqual(seg.map(s => s.k), [5, 8, 4], "windows preserved, sorted by time");
  // order-independent of start/end argument order
  assert.deepEqual(sliceRun(inputs, 81.8, 23.2).map(s => s.t), seg.map(s => s.t));
});

test("difficultyProfile: peak sits at the tightest input, normalized to 1", () => {
  const inputs = [ { t: 20, k: 2 }, { t: 80, k: 20 } ]; // T=100 -> positions 20%, 80%
  const p = difficultyProfile(inputs, 100, null, { bandwidthPct: 3, samples: 200 });
  assert.ok(Math.abs(p.peakXPct - 20) <= 4, `peak ~20%, got ${p.peakXPct}`);
  approxRel(Math.max(...p.ys), 1, 1e-9, "normalized to 1");
  assert.ok(p.ys.every(v => v >= 0 && v <= 1 + 1e-9), "ys in [0,1]");
});

test("difficultyProfile: more smoothing spreads difficulty outward", () => {
  const inputs = [ { t: 20, k: 2 } ]; // single tight spike at 20%
  const at = (p, x) => p.ys[Math.round(x / p.xmax * 200)];
  const sharp  = difficultyProfile(inputs, 100, null, { bandwidthPct: 2,  samples: 200 });
  const smooth = difficultyProfile(inputs, 100, null, { bandwidthPct: 15, samples: 200 });
  assert.ok(at(smooth, 60) > at(sharp, 60),
    `smooth@60 (${at(smooth,60)}) should exceed sharp@60 (${at(sharp,60)})`);
});

test("difficultyProfile: an enabled modifier reshapes the curve", () => {
  const inputs = [ { t: 10, k: 5 }, { t: 90, k: 5 } ]; // equal windows at 10% and 90%
  const off   = { nerve:{on:false}, fatigue:{on:false}, cps:{on:false} };
  const nerve = { nerve:{on:true, k:0.05}, fatigue:{on:false}, cps:{on:false} };
  const pOff = difficultyProfile(inputs, 100, off,   { bandwidthPct: 4, samples: 200 });
  const pOn  = difficultyProfile(inputs, 100, nerve, { bandwidthPct: 4, samples: 200 });
  // Off: equal windows -> earlier peak wins the tie. Nerve makes later inputs
  // harder (smaller lambda -> higher difficulty), so the peak jumps to the late one.
  assert.ok(pOff.peakXPct < 50, `off peak should be early, got ${pOff.peakXPct}`);
  assert.ok(pOn.peakXPct  > 50, `nerve on should push peak late, got ${pOn.peakXPct}`);
});

test("parseInputsText: accepts dash, tab, and space separators", () => {
  // the user's tab-separated block
  const tabbed = "0.55\t3\n0.68\t6\n1.26\t9\n1.33\t4\n1.42\t8\n1.52\t8\n1.92\t6\n1.99\t6\n2.5\t3";
  const t = parseInputsText(tabbed);
  assert.equal(t.length, 9, "9 tab-separated rows");
  assert.deepEqual(t[0], [0.55, 3]);
  assert.deepEqual(t[8], [2.5, 3]);

  // dash format still works (with and without spaces)
  assert.deepEqual(parseInputsText("1.5 - 3\n2.1-5"), [[1.5, 3], [2.1, 5]]);
  // plain-space and multi-space separators
  assert.deepEqual(parseInputsText("10 4\n2.9   15"), [[10, 4], [2.9, 15]]);
  // blank / header / garbage lines are skipped
  assert.deepEqual(parseInputsText("time window\n\n0.55\t3\n---"), [[0.55, 3]]);
});

test("parseInputsText: ignores unit labels like a frames suffix", () => {
  assert.deepEqual(parseInputsText("35.29 - 5f"), [[35.29, 5]]);          // the asked format
  assert.deepEqual(parseInputsText("35.29-5f\n0.55\t3f\n2.4 19f"),
    [[35.29, 5], [0.55, 3], [2.4, 19]]);                                   // f suffix, all separators
  assert.deepEqual(parseInputsText("35.29 - 5 frames"), [[35.29, 5]]);    // word unit
  assert.deepEqual(parseInputsText("35.29s - 5f"), [[35.29, 5]]);         // unit on the time too
});

/* ===================== parity with the official calculator =====================
 * The official NaNDL calculator (nandl.pages.dev) publishes these equations:
 *   w_i = N_i/f            s_i = ½·w_i·L        s_i(Λ) = s_i·∏λ
 *   λ_t,i = e^(−k_t·t_i)   λ_u,i = e^(−k_u·i)
 *   c_i = (i−i')/(t_i−t_i')          λ_c,i = (4/max(1,2c_i))^k_c
 *   p_i = P(|X|≤s_i)  q_i = 1−p_i    r_i = ∏_{j<i} p_j     P(C) = ∏ p_i
 *   E[T_A] = t_n·P(C) + Σ t_i·r_i·q_i     E[T_C] = E[T_A]/P(C)
 *   L* = { L : E[T_C(L)] = 24h }
 * The reference below is written straight from those equations, independently of
 * js/calc.js, and must agree with evaluate() for consecutively-numbered inputs.
 * ========================================================================== */

// Independent reference implementation of the official model.
function officialETC(L, inputs, f, mods) {
  const n = inputs.length;
  const p = [];
  for (let idx = 0; idx < n; idx++) {
    const i = idx + 1;                       // official inputs are 1-based
    const w = inputs[idx].k / f;
    let s = 0.5 * w * L;
    if (mods.kt != null) s *= Math.exp(-mods.kt * inputs[idx].t);
    if (mods.ku != null) s *= Math.exp(-mods.ku * i);
    if (mods.kc != null) {
      // c_i = (i − i')/(t_i − t_i'); consecutive inputs => i − i' = 1
      const prev = idx === 0 ? 1 : idx;      // first input: fall back to next gap
      const dt = idx === 0 ? (inputs[1].t - inputs[0].t) : (inputs[idx].t - inputs[idx - 1].t);
      const c = (idx === 0 ? 1 : (i - prev)) / dt;
      s *= Math.pow(4 / Math.max(1, 2 * c), mods.kc);
    }
    p.push(erf(s / Math.SQRT2));
  }
  const PC = p.reduce((a, v) => a * v, 1);
  let r = 1, sum = 0;
  for (let idx = 0; idx < n; idx++) { sum += inputs[idx].t * r * (1 - p[idx]); r *= p[idx]; }
  const tn = inputs[n - 1].t;
  return (tn * PC + sum) / PC;
}

test("official constants are the published values", () => {
  assert.equal(NANDL_CONSTANTS.nerve,   0.0016520833717346);
  assert.equal(NANDL_CONSTANTS.fatigue, 0.0002727763242154);
  assert.equal(NANDL_CONSTANTS.cps,     0.2784421686721826);
});

test("parity: our evaluate() matches the official equations", () => {
  const inputs = [ { t: 1.9, k: 2 }, { t: 2.3, k: 6 }, { t: 2.4, k: 19 }, { t: 5.0, k: 4 } ];
  const T = inputs[inputs.length - 1].t;   // official t_n = last input time
  const K = NANDL_CONSTANTS;

  const scenarios = [
    ["no modifiers", {}, { nerve:{on:false,k:K.nerve}, fatigue:{on:false,k:K.fatigue}, cps:{on:false,k:K.cps} }],
    ["nerve",   { kt:K.nerve },   { nerve:{on:true,k:K.nerve},  fatigue:{on:false,k:K.fatigue}, cps:{on:false,k:K.cps} }],
    ["fatigue", { ku:K.fatigue }, { nerve:{on:false,k:K.nerve}, fatigue:{on:true,k:K.fatigue},  cps:{on:false,k:K.cps} }],
    ["cps",     { kc:K.cps },     { nerve:{on:false,k:K.nerve}, fatigue:{on:false,k:K.fatigue}, cps:{on:true,k:K.cps} }],
    ["all", { kt:K.nerve, ku:K.fatigue, kc:K.cps },
            { nerve:{on:true,k:K.nerve}, fatigue:{on:true,k:K.fatigue}, cps:{on:true,k:K.cps} }],
  ];

  for (const [label, refMods, ourMods] of scenarios) {
    for (const L of [5, 50, 200]) {
      const ours = evaluate(L, { inputs, f: 240, T, mods: ourMods }).ETC;
      const ref  = officialETC(L, inputs, 240, refMods);
      approxRel(ours, ref, 1e-9, `E[T_C] (${label}, L=${L})`);
    }
    // and the solved precision agrees too
    const ourL = solveLstar({ inputs, f: 240, T, mods: ourMods }, 24 * 3600);
    approxRel(officialETC(ourL, inputs, 240, refMods) / 3600, 24, 1e-6, `L* solves to 24h (${label})`);
  }
});

test("parseCalculatorJson: reads the official field set", () => {
  const doc = {
    gameFps: 240, windowFps: 240, respawnTime: 0.5, useFrames: false,
    inputs: [
      { inputNumber: 1, timePosition: 1.9, frameWindow: 2 },
      { inputNumber: 2, timePosition: 2.3, frameWindow: 6 },
    ],
  };
  const r = parseCalculatorJson(JSON.stringify(doc));
  assert.equal(r.ok, true);
  assert.equal(r.windowFps, 240);
  assert.equal(r.respawnTime, 0.5);
  assert.deepEqual(r.inputs, [{ t: 1.9, k: 2, n: 1 }, { t: 2.3, k: 6, n: 2 }]);
});

test("parseCalculatorJson: frame-number positions convert via Game FPS", () => {
  const doc = { gameFps: 100, windowFps: 240, useFrames: true,
    inputs: [{ timePosition: 250, frameWindow: 5 }] };
  const r = parseCalculatorJson(JSON.stringify(doc));
  assert.equal(r.ok, true);
  approxRel(r.inputs[0].t, 2.5, 1e-12, "250 frames @100fps = 2.5s");
});

test("parseCalculatorJson: tolerates key spellings, bare pairs, and ignored windows", () => {
  // snake_case + alternate row key + '-' ignored window
  const snake = { game_fps: 240, window_fps: 240, use_frames: false,
    rows: [ { time: 1, window: 3 }, { time: 2, window: "-" }, { time: 3, window: 4 } ] };
  const a = parseCalculatorJson(JSON.stringify(snake));
  assert.equal(a.ok, true);
  assert.equal(a.ignored, 1, "one ignored row counted");
  // ignored rows are KEPT (k:null) — their time position still shapes attempt timing
  assert.equal(a.inputs.length, 3);
  assert.equal(a.inputs[1].k, null, "'-' window becomes an ignored input");

  // bare array of [time, window] pairs
  const b = parseCalculatorJson(JSON.stringify([[1.5, 3], [2.1, 5]]));
  assert.equal(b.ok, true);
  assert.deepEqual(b.inputs.map(i => [i.t, i.k]), [[1.5, 3], [2.1, 5]]);

  // failures are reported, not thrown
  assert.equal(parseCalculatorJson("not json").ok, false);
  assert.equal(parseCalculatorJson(JSON.stringify({ inputs: [] })).ok, false);
});

test("buildCalculatorJson round-trips through parseCalculatorJson", () => {
  const inputs = [{ t: 1.9, k: 2 }, { t: 2.3, k: 6 }, { t: 2.4, k: 19 }];
  const doc = buildCalculatorJson({ inputs, fps: 240 });
  assert.equal(doc.useFrames, false);
  assert.equal(doc.windowFps, 240);
  assert.deepEqual(doc.inputs[0], { inputNumber: 1, timePosition: 1.9, frameWindow: 2 });

  const back = parseCalculatorJson(JSON.stringify(doc));
  assert.equal(back.ok, true);
  assert.deepEqual(back.inputs.map(i => ({ t: i.t, k: i.k })), inputs);
});

/* ===================== features matching the official calculator ============ */

test("respawn time adds exactly R to every attempt", () => {
  const inputs = [ { t: 1.9, k: 2 }, { t: 2.3, k: 6 }, { t: 2.4, k: 19 } ];
  const base = { inputs, f: F, T, mods: modsOff };
  const L = 5;
  const a = evaluate(L, base);
  const b = evaluate(L, { ...base, respawn: 1.5 });
  // Σ rᵢqᵢ + P(C) = 1, so respawn contributes exactly R per attempt
  approxRel(b.ETA, a.ETA + 1.5, 1e-12, "E[T_A] + R");
  approxRel(b.ETC, (a.ETA + 1.5) / a.PC, 1e-12, "E[T_C] scales with it");
  approxRel(b.PC, a.PC, 1e-12, "P(C) unchanged");
  // more respawn => more precision needed to hit the same target
  const L0 = solveLstar(base, TARGET_SEC);
  const L1 = solveLstar({ ...base, respawn: 5 }, TARGET_SEC);
  assert.ok(L1 > L0, `respawn should raise L* (${L0} -> ${L1})`);
});

test("ignored windows pass for free, or become maxWindow+1 under CPS", () => {
  const inputs = [ { t: 1, k: 4 }, { t: 2, k: null }, { t: 3, k: 9 } ];
  const L = 30;

  // CPS off: the ignored input has p = 1 exactly
  const off = perInputStats(L, { inputs, f: F, T, mods: modsOff });
  assert.equal(off[1].p, 1, "ignored input always passes");
  assert.equal(off[1].kEff, null, "no effective window");
  assert.equal(off[1].ignored, true);
  // ...so P(C) equals the product over the two real inputs
  const only = evaluate(L, { inputs: [inputs[0], inputs[2]], f: F, T, mods: modsOff });
  approxRel(evaluate(L, { inputs, f: F, T, mods: modsOff }).PC, only.PC, 1e-12, "P(C) ignores it");

  // CPS on: it takes one more than the largest numeric window (9 -> 10)
  const cpsOn = { nerve:{on:false,k:0}, fatigue:{on:false,k:0}, cps:{on:true,k:NANDL_CONSTANTS.cps} };
  const on = perInputStats(L, { inputs, f: F, T, mods: cpsOn });
  assert.equal(on[1].kEff, 10, "maxWindow + 1");
  assert.ok(on[1].p < 1, "now it can be missed");
});

test("input numbers drive fatigue and local CPS", () => {
  // same times/windows, but the middle input is numbered 5 instead of 2
  const plain   = [ { t: 1, k: 4, n: 1 }, { t: 2, k: 4, n: 2 }, { t: 3, k: 4, n: 3 } ];
  const skipped = [ { t: 1, k: 4, n: 1 }, { t: 2, k: 4, n: 5 }, { t: 3, k: 4, n: 6 } ];
  const L = 40;

  const fat = { nerve:{on:false,k:0}, fatigue:{on:true,k:0.2}, cps:{on:false,k:0} };
  const pPlain = perInputStats(L, { inputs: plain,   f: F, T, mods: fat });
  const pSkip  = perInputStats(L, { inputs: skipped, f: F, T, mods: fat });
  assert.ok(pSkip[1].p < pPlain[1].p, "higher input number => more fatigue => lower p");

  // local CPS uses (i − i′)/(t_i − t_i′): numbering gaps raise the click rate
  assert.equal(localCps(plain, 1, T), 1, "consecutive numbers => 1/gap");
  assert.equal(localCps(skipped, 1, T), 4, "(5−1)/(2−1) = 4 clicks/sec");
});

test("evaluate exposes attempt stats for fixed-precision mode", () => {
  const inputs = [ { t: 1.9, k: 2 }, { t: 2.3, k: 6 } ];
  const r = evaluate(10, { inputs, f: F, T, mods: modsOff });
  approxRel(r.attempts, 1 / r.PC, 1e-12, "attempts = 1/P(C)");
  approxRel(r.ETC, r.ETA / r.PC, 1e-12, "E[T_C] = E[T_A]/P(C)");
});

/* ===================== grind entropy (G) =================================== */

test("grindEntropy: G = -log2 P(C) and attempts = 2^G", () => {
  const inputs = [ { t: 1.9, k: 2 }, { t: 2.3, k: 6 }, { t: 2.4, k: 19 } ];
  const cfg = { inputs, f: F, T, mods: modsOff };
  const L = 40;
  const g = grindEntropy(L, cfg);
  const PC = evaluate(L, cfg).PC;
  approxRel(g.bits, -Math.log2(PC), 1e-9, "G = -log2 P(C)");
  approxRel(g.attempts, 1 / PC, 1e-6, "2^G = 1/P(C) = expected attempts");
  approxRel(g.per.reduce((a, b) => a + b, 0), g.bits, 1e-9, "per-input bits sum to G");
});

test("grindEntropy is exactly additive across concatenated segments", () => {
  // The property L* lacks: two levels played back to back simply add.
  const a = [ { t: 1.0, k: 3 }, { t: 2.0, k: 5 } ];
  const b = [ { t: 1.0, k: 2 }, { t: 3.0, k: 8 } ];
  const L = 60;
  const mk = inputs => ({ inputs, f: F, T: inputs[inputs.length - 1].t, mods: modsOff });
  // concatenate: shift b after a (modifiers off => positions don't affect p)
  const joined = [...a, ...b.map(i => ({ t: i.t + 10, k: i.k }))];

  const gA = grindEntropy(L, mk(a)).bits;
  const gB = grindEntropy(L, mk(b)).bits;
  const gJ = grindEntropy(L, mk(joined)).bits;
  approxRel(gJ, gA + gB, 1e-9, "G(A+B) = G(A) + G(B)");

  // ...and L* is demonstrably NOT additive, which is the whole reason G exists.
  // (The error has no fixed direction — it depends on where each level sits on
  // the erf tail — so we assert only that adding L* is wrong.)
  const lA = solveLstar(mk(a), TARGET_SEC);
  const lB = solveLstar(mk(b), TARGET_SEC);
  const lJ = solveLstar(mk(joined), TARGET_SEC);
  const relErr = Math.abs(lJ - (lA + lB)) / lJ;
  assert.ok(relErr > 0.05,
    `L* must not be additive: L*(A+B)=${lJ} vs L*(A)+L*(B)=${lA + lB}`);
});

test("grindEntropy: independent of respawn, monotonically falls as precision rises", () => {
  const inputs = [ { t: 1.9, k: 2 }, { t: 2.3, k: 6 } ];
  const base = { inputs, f: F, T, mods: modsOff };
  // respawn changes attempt cost, not attempt improbability
  approxRel(grindEntropy(50, { ...base, respawn: 9 }).bits,
            grindEntropy(50, base).bits, 1e-12, "respawn does not move G");
  // sharper player => fewer bits of luck required
  assert.ok(grindEntropy(200, base).bits < grindEntropy(50, base).bits, "G falls with precision");
  // ignored windows are free (p = 1 => 0 bits)
  const withIgnored = { ...base, inputs: [...inputs, { t: 3, k: null }] };
  approxRel(grindEntropy(50, withIgnored).bits, grindEntropy(50, base).bits, 1e-12,
            "ignored input costs 0 bits");
});

/* ===================== window-size tally =================================== */

test("windowCounts: tallies sizes and fills the gaps with zeros", () => {
  const inputs = [
    { t: 1, k: 2 }, { t: 2, k: 2 }, { t: 3, k: 5 }, { t: 4, k: 1 }, { t: 5, k: 5 }, { t: 6, k: 5 },
  ];
  const w = windowCounts(inputs);
  assert.equal(w.max, 5);
  assert.equal(w.total, 6, "all six counted");
  assert.equal(w.distinct, 3, "1f, 2f, 5f");
  // every integer 1..max present, including the empty 3f and 4f buckets
  assert.deepEqual(w.rows, [
    { k: 1, count: 1 }, { k: 2, count: 2 }, { k: 3, count: 0 },
    { k: 4, count: 0 }, { k: 5, count: 3 },
  ]);
  // counts sum back to the number of timed inputs
  assert.equal(w.rows.reduce((a, r) => a + r.count, 0), w.total);
});

test("windowCounts: ignored windows counted apart, decimals kept in order", () => {
  const inputs = [ { t: 1, k: 3 }, { t: 2, k: null }, { t: 3, k: 1.5 }, { t: 4, k: 3 } ];
  const w = windowCounts(inputs);
  assert.equal(w.ignored, 1, "ignored row not bucketed");
  assert.equal(w.total, 3);
  assert.deepEqual(w.rows.map(r => r.k), [1, 1.5, 2, 3], "decimal slots into sorted position");
  assert.equal(w.rows.find(r => r.k === 1.5).count, 1);
  assert.equal(w.rows.find(r => r.k === 3).count, 2);
});

test("windowCounts: huge windows skip the zero-fill", () => {
  const w = windowCounts([{ t: 1, k: 5 }, { t: 2, k: 100000 }], 400);
  assert.equal(w.filled, false, "fill suppressed past the limit");
  assert.deepEqual(w.rows.map(r => r.k), [5, 100000], "only present sizes listed");
  assert.equal(windowCounts([]).rows.length, 0, "empty input -> no rows");
});

/* ===================== grind time (T) ===================================== */

const REF_T = 200;   // reference precision the UI defaults to for T

test("grindTime: decomposition sums to the total, and matches evaluate", () => {
  const inputs = [ { t: 2, k: 3 }, { t: 5, k: 2 }, { t: 9, k: 4 } ];
  const cfg = { inputs, f: F, T: 9, mods: modsOff, respawn: 0.7 };
  const g = grindTime(REF_T, cfg);

  // agrees with the headline calculation
  approxRel(g.seconds, evaluate(REF_T, cfg).ETC, 1e-9, "T == E[T_C]");
  approxRel(g.attempts, 1 / g.PC, 1e-9, "attempts = 1/P(C)");

  // E[T_C] = t_n + respawn/P(C) + Σ costᵢ
  const total = g.clearTime + g.respawnCost + g.per.reduce((a, b) => a + b, 0);
  approxRel(total, g.seconds, 1e-9, "per-input costs + clear + respawn = total");
});

test("grindTime is position-sensitive: a late tight window costs far more", () => {
  // Same windows, same P(C) — only the ORDER of the tight 1f input differs.
  const early = [ { t: 1, k: 1 }, { t: 20, k: 6 }, { t: 40, k: 6 }, { t: 60, k: 6 } ];
  const late  = [ { t: 1, k: 6 }, { t: 20, k: 6 }, { t: 40, k: 6 }, { t: 60, k: 1 } ];
  const mk = inputs => ({ inputs, f: F, T: 60, mods: modsOff });

  const a = grindTime(REF_T, mk(early));
  const b = grindTime(REF_T, mk(late));

  // P(C) is a product, so it is identical — G would score these the same...
  approxRel(b.PC, a.PC, 1e-12, "same completion probability");
  approxRel(grindEntropy(REF_T, mk(late)).bits, grindEntropy(REF_T, mk(early)).bits,
            1e-12, "G cannot tell them apart");
  // ...but the grind time can, and says the late one is much worse.
  assert.ok(b.seconds > a.seconds * 2,
    `late 1f should cost far more time (${a.seconds.toFixed(1)}s -> ${b.seconds.toFixed(1)}s)`);

  // The effect is starkest per-input: totals carry a fixed floor (the winning
  // run still takes t_n), which damps the ratio. The 1f window itself goes from
  // a couple of seconds of retries to over a hundred purely by moving late.
  const tightEarly = a.per[0], tightLate = b.per[3];
  assert.ok(tightLate > tightEarly * 20,
    `the same 1f window should cost far more late (${tightEarly.toFixed(1)}s -> ${tightLate.toFixed(1)}s)`);

  // and the cost is attributed to the right input
  assert.equal(a.per.indexOf(Math.max(...a.per)), 0, "early case: first input dominates");
  assert.equal(b.per.indexOf(Math.max(...b.per)), 3, "late case: last input dominates");
});

test("grindTime: respawn and precision move it the expected way", () => {
  const inputs = [ { t: 2, k: 2 }, { t: 6, k: 3 } ];
  const base = { inputs, f: F, T: 6, mods: modsOff };
  assert.ok(grindTime(REF_T, { ...base, respawn: 3 }).seconds > grindTime(REF_T, base).seconds,
    "respawn adds time");
  assert.ok(grindTime(400, base).seconds < grindTime(REF_T, base).seconds,
    "a sharper player finishes sooner");
  // an ignored window is free: it never costs a retry
  const withIgnored = { ...base, inputs: [...inputs, { t: 7, k: null }] };
  const gi = grindTime(REF_T, withIgnored);
  approxRel(gi.per[2], 0, 1e-12, "ignored input costs no time");
});
