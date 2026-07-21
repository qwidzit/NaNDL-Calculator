# NaNDL Precision Calculator — Project Status

_Last updated: 2026-07-21_

## What this is

A static, dependency-free website that computes the required timing **precision (L\*)**
for a Geometry-Dash-style level, based on the NaNDL probabilistic difficulty model.
See `NaNDL_calculator_spec.md` for the full math + behavior handoff.

## Current status

- ✅ **Working prototype** — `nandl_calculator_2.html` is a complete, self-contained
  single file (inline CSS + vanilla JS, no build step, no dependencies, no network,
  no storage). It recomputes live and matches the regression values in the spec.
- ✅ **Spec / handoff doc** — `NaNDL_calculator_spec.md` documents the math, code map,
  assumptions, and known-good regression numbers.
- ⏳ **Not yet split into files** — everything is one HTML file. Fine for a prototype,
  harder to read/maintain/test.
- ⏳ **No tests** — the spec ships regression values (§6) but they aren't automated.
- ⏳ **Not deployed** — no hosting configured yet.

The prototype is **functionally deployment-ready as-is** (it's already a valid static
page). The remaining work is about maintainability and shipping, not fixing behavior.

---

## 3-step plan to deployment

### Step 1 — Refactor into separate files (readability)
Split the monolith into the layout below. Pure math becomes an importable ES module so
it can be tested in isolation. No behavior changes — the page must render and compute
identically.

### Step 2 — Lock the math with regression tests
Port the spec's §6 known-good values into a tiny test file (Node's built-in
`node --test`, zero dependencies). Run it to prove the Step-1 refactor didn't move any
numbers. Anchor values to guard: `erf(1)=0.8427`, `passProb(1)=0.6827`, histogram
L\*=175.543, manual-seconds L\*=2.763, import-sample L\*=19.161.

### Step 3 — Deploy as a static site
Point hosting at `index.html`. GitHub Pages is the natural fit for this repo (enable
Pages on `main`, or add a Pages Actions workflow). Add a short `README.md`, page
`<meta>`/favicon, then verify the live URL computes the regression values in a browser.

---

## Proposed file division

Extract along the seams that already exist in the single file (markup / style / pure
math / DOM wiring):

```
/
├── index.html          # markup only (renamed from nandl_calculator_2.html)
├── css/
│   └── styles.css      # everything currently in <style> (lines 7–109)
├── js/
│   ├── calc.js         # PURE math ES module — no DOM. Exports:
│   │                   #   MAXW, erf, passProb, buildSequence,
│   │                   #   histInputs, localCps, evaluate, solveLstar
│   └── app.js          # UI layer: builds grid + manual rows, mode/unit toggles,
│                       #   .txt import + guide modal, recompute(), event wiring.
│                       #   imports from calc.js
├── tests/
│   └── calc.test.js    # regression values from spec §6, run with `node --test`
├── STATUS.md
└── NaNDL_calculator_spec.md
```

**Why this split**
- `calc.js` is already pure and framework-free (spec §4/§7) — it lifts out cleanly and
  is the only part worth unit-testing.
- `app.js` holds all `document.*` access and the two module-level UI state vars
  (`mode`, `unit`), keeping side-effects in one place.
- `styles.css` is pure presentation with zero JS coupling — a straight cut.
- `index.html` shrinks to structure + `<link>`/`<script type="module">` tags.

**Wiring notes**
- Load app as `<script type="module" src="js/app.js">`; `calc.js` uses ES `export`,
  `app.js` uses `import`. Served over HTTP this is fine (needed for deployment anyway).
- Keep the no-dependency / no-storage / no-network property (spec §5, §7).

---

## Deferred / optional (post-deploy, from spec §7)
Not blocking deployment — parking here so they aren't lost:
- Shareable state encoded in the URL (hash/query).
- Per-input breakdown table/chart (expose the `pⱼ`/`rⱼ` arrays `evaluate` already computes).
- Real modifier calibration for `k_t / k_u / k_c` (removes the BROKEN? tags on Fatigue/CPS).
- Dynamic/larger histogram windows (currently fixed 1f–20f), fps presets + validation.
- Matching `.txt` / JSON export of the manual list.
