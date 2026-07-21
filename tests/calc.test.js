// Regression tests for the pure math module, from NaNDL_calculator_spec.md §6.
// Run with: npm test   (a.k.a. `node --test`) — no dependencies.

import { test } from "node:test";
import assert from "node:assert/strict";
import { erf, passProb, histInputs, evaluate, solveLstar } from "../js/calc.js";

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
  const err = Math.abs(actual - expected) / Math.abs(expected);
  assert.ok(
    err <= relTol,
    `${label}: expected ~${expected}, got ${actual} (rel err ${err.toExponential(2)} > ${relTol})`
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
