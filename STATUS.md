# NaNDL Precision Calculator — Project Status

_Last updated: 2026-07-21_

## What this is

A static, dependency-free website that computes the required timing **precision (L\*)**
for a Geometry-Dash-style level, based on the NaNDL probabilistic difficulty model.
See `NaNDL_calculator_spec.md` for the full math + behavior handoff.

## Current status

- ✅ **Working prototype** — `nandl_calculator_2.html`, the original self-contained
  single file. Kept in the repo as the reference/source of truth.
- ✅ **Refactored into files** (Step 1) — split into `index.html` + `css/styles.css` +
  `js/calc.js` (pure math) + `js/app.js` (UI). Behavior is a verbatim lift; verified the
  DOM ids/asset paths all wire up and that the page loads + runs as an ES module over HTTP.
- ✅ **Regression tests** (Step 2) — `tests/calc.test.js` runs the spec §6 known-good
  values with Node's built-in runner (`npm test`, zero dependencies). **7/7 pass**,
  matching every anchor within 0.1%.
- ✅ **Spec / handoff doc** — `NaNDL_calculator_spec.md`.
- ⏳ **Not deployed** (Step 3) — no hosting configured yet.

The app is **functionally deployment-ready**. What's left is shipping it (Step 3) and an
optional, prioritized feature roadmap (below).

---

## Plan to deployment

### Step 1 — Refactor into separate files ✅ DONE
Split the monolith along its natural seams (markup / style / pure math / DOM wiring).
Pure math is now an importable ES module. No behavior change.

### Step 2 — Lock the math with regression tests ✅ DONE
Ported spec §6 values into `tests/calc.test.js`. Guards `erf(1)=0.8427`,
`passProb(1)=0.6827`/`(2)=0.9545`, histogram L\*=175.543 (+mods 485.318), manual-seconds
L\*=2.763 (+mods 10.941), import-sample L\*=19.161 (seconds) / 17.749 (%). `npm test` → 7/7.

### Step 3 — Deploy as a static site ⏳ NEXT
Point hosting at `index.html`. GitHub Pages is the natural fit (enable Pages on `main`,
or add a Pages Actions workflow). Add a short `README.md`, page `<meta>`/favicon, then
verify the live URL reproduces the regression values in a browser.

---

## Current file layout

```
/
├── index.html               # markup only; links css/ + loads js/app.js as a module
├── css/styles.css           # all presentation (was the inline <style>)
├── js/
│   ├── calc.js              # PURE math ES module, no DOM: MAXW, erf, passProb,
│   │                        #   buildSequence, histInputs, localCps, evaluate, solveLstar
│   └── app.js               # UI layer: grid + manual rows, mode/unit toggles,
│                            #   .txt import + guide modal, recompute(); imports calc.js
├── tests/calc.test.js       # spec §6 regression values (`npm test`)
├── package.json             # marks ESM ("type":"module") + the test script; no deps
├── nandl_calculator_2.html  # original single-file prototype (reference)
├── STATUS.md
└── NaNDL_calculator_spec.md
```

---

## Roadmap after deployment — review of the spec §7 ideas

My take on each suggestion the spec floated, and whether it's worth building.

### Recommended next (high value, low cost) — Steps 4–6

**Step 4 — Shareable state in the URL.** Encode the histogram / manual list / settings
into the URL hash so a specific level can be linked and reopened. This is the single
biggest "tool → website" upgrade: a calculator people share is far more useful than one
they can't. Cheap, no dependency, and it keeps the no-storage property (state lives in
the link, not the browser). **Worth it.**

**Step 5 — Per-input breakdown.** Surface a small table of each input's `pⱼ` (pass prob)
and `rⱼ` (reach prob) and highlight the weakest inputs. The data is *already computed and
then discarded* inside `evaluate()` — we just return the arrays and render them. Turns a
single opaque number into "here's *where* the level is hard," which is the actual insight
users want. High value, low cost. **Worth it.**

**Step 6 — fps validation + presets.** Add 60/120/240/480 quick-select buttons and
validate fps (reject 0 / negative / non-integer with a clear message instead of the
silent `||240` fallback). Presets are minor polish; the validation is real robustness.
Cheap. **Worth it** (prioritize the validation).

### Optional / lower priority

**Manual-list export (`.txt`).** A matching export to the existing import format closes
an obvious loop and is nearly free. **Worth it if time allows** — bundle with Step 4/5.
JSON export is a nice-to-have, not needed.

**Larger / dynamic histogram windows (>20f).** Deferred. The fixed 1f–20f range already
covers the hard inputs that dominate L\*; windows above ~20f are easy inputs that barely
move the result, and dynamic rows add UI complexity for marginal gain. Revisit only if
users actually hit the ceiling. **Skip for now.**

### Not actionable / won't do

**Real modifier calibration (`k_t / k_u / k_c`).** Blocked externally — the NaNDL site
does not publish its calibrated constants (spec §2.4, §5), which is exactly why Fatigue
and CPS carry the **BROKEN?** tags. Keep the constants editable and the tags in place
until upstream publishes real values; there's nothing to calibrate against today.
**Don't remove the tags.**

**"Preserve no-storage / no-deps."** Not a task — it's a constraint we're already
honoring and should keep honoring in every step above.
