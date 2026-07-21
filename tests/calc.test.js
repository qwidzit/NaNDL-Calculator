// Regression tests for the pure math module, from NaNDL_calculator_spec.md §6.
// Run with: npm test   (a.k.a. `node --test`) — no dependencies.

import { test } from "node:test";
import assert from "node:assert/strict";
import { erf, passProb, histInputs, evaluate, solveLstar, perInputStats, sliceRun, difficultyProfile, parseInputsText } from "../js/calc.js";

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
