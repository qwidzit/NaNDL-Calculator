# NaNDL Precision Calculator — Project Status

_Last updated: 2026-07-21_

## What this is

A static, dependency-free website that computes the required timing **precision (L\*)**
for a Geometry-Dash-style level, based on the NaNDL probabilistic difficulty model.
See `NaNDL_calculator_spec.md` for the full math + behavior handoff.

## Current status

- ✅ **Refactored into files** — `index.html` + `css/styles.css` + `js/calc.js` (pure
  math) + `js/app.js` (UI). This is the live app.
- ✅ **Regression tests** — `tests/calc.test.js`, Node's built-in runner (`npm test`,
  zero deps). **9/9 pass**: the spec §6 values plus the new `perInputStats`/`sliceRun`
  helpers.
- ✅ **Feature set complete** — URL-shareable state, per-input breakdown, fps presets +
  validation, `.txt` export, run/segment scoring, and offline support (see below).
- ✅ **Verified in a real browser** — headless Chromium confirms the module loads over
  HTTP, share-links restore full state, histogram/manual/run all compute correctly
  (both seconds and %), and every offline asset is served.
- ✅ **Deployment assets added** — `README.md`, SEO metadata (Open Graph + Twitter card +
  JSON-LD), `robots.txt`, `sitemap.xml`, `favicon.svg`, `og-image.png`, a themed `404.html`,
  and Cloudflare `_headers`. Ready to publish.
- ⏳ **Publishing** — the owner is setting up **Cloudflare Pages** at
  `nandl-calculator.pages.dev` (no build step; output dir = repo root). A `.assetsignore`
  excludes `node_modules/` so the build's `wrangler`/`workerd` binary doesn't trip the
  25 MiB per-asset limit ("Asset too large").
- 🗂️ `nandl_calculator_2.html` — the original single-file prototype, kept for reference
  only. **It predates the new features**; the live app is `index.html` + the modules.

---

## Delivered features

| Feature | Where | Notes |
|---|---|---|
| **Refactor** (Step 1) | `index.html`, `css/`, `js/calc.js`, `js/app.js` | Behavior-preserving split; math is an importable ES module. |
| **Regression tests** (Step 2) | `tests/calc.test.js` | `npm test` → 9/9. |
| **URL-shareable state** (Step 4) | `js/app.js` | Whole UI encoded in the `#s=` hash (base64 JSON); **Copy shareable link** button. No browser storage — state lives in the link. |
| **Per-input breakdown** (Step 5) | `perInputStats()` + breakdown table | Each input's `p`/`reach` at L\*, time in **both seconds and %**, weakest inputs flagged & color-coded. |
| **fps presets + validation** (Step 6) | Setup panel | 120 / 240 / 480 quick-select; blocks fps ≤ 0, warns on non-integer fps. |
| **`.txt` import / export** | `parseInputsText()` + Import/Export | Import accepts each line as `time`/`window` separated by a **dash, a tab, or spaces** (so spreadsheet-pasted `0.55⇥3` works alongside `1.5 - 3`); export mirrors the `time - window` form and round-trips. |
| **Run / segment** | `sliceRun()` + Run panel | A range like `23.2 - 81.8` scores only that slice as its own level (inputs re-based to start at 0, length = to − from). Range respects the Seconds/% switch; the hint and breakdown show **both units**. |
| **Clear all + confirm** | manual tools + confirm modal | "Clear all" empties the manual list behind a confirm popup ("This can't be undone", input count shown); Esc/Cancel/backdrop dismiss. |
| **Difficulty profile** | `difficultyProfile()` + SVG chart | Manual mode only: a smooth difficulty curve across the level (Gaussian-kernel over input positions; difficulty = 1/(window·λ), where λ is the enabled modifiers' multiplier — so **modifiers reshape the curve**). Gradient fill, peak marker, hover readout (`x% · difficulty`), active run region shaded, "Modifiers applied" note when any is on. |
| **Smoothing slider** | `#smooth` range | Controls the difficulty curve's kernel bandwidth (0.5–25%, default 4%); persisted in the share link. |
| **Offline** | `sw.js` + `manifest.webmanifest` | Service worker caches all first-party assets; the app runs with no network after first load. "offline-ready" badge appears once cached. |

**Offline & storage note:** the only persistence is the service-worker **asset** cache
(needed for offline). There are still no cookies and no localStorage of user input — the
shareable state is carried in the URL, not stored. To ship updated files after a change,
bump `CACHE` in `sw.js` (cache-first otherwise keeps the cached copy).

---

## File layout

```
/
├── index.html               # markup; links css/ + loads js/app.js as a module
├── css/styles.css           # all presentation
├── js/
│   ├── calc.js              # PURE math ES module: erf, passProb, buildSequence,
│   │                        #   histInputs, localCps, evaluate, solveLstar,
│   │                        #   perInputStats, sliceRun, difficultyProfile, MAXW
│   └── app.js               # UI: input modes, run/segment, breakdown, difficulty
│                            #   chart, clear/confirm, fps presets, import/export,
│                            #   URL state, service-worker registration
├── sw.js                    # offline service worker (cache-first, versioned)
├── manifest.webmanifest     # PWA manifest (offline / installable)
├── tests/calc.test.js       # spec §6 regression + helper tests (`npm test`)
├── package.json             # ESM + test script; no dependencies
├── nandl_calculator_2.html  # original single-file prototype (reference only)
├── STATUS.md
└── NaNDL_calculator_spec.md
```

---

## Deploying (Cloudflare Pages)

The repo is the deployable output as-is — no build step. Pages settings: framework preset
**None**, build command **empty**, output directory **`/`** (repo root). `_headers` and
`404.html` are picked up because they live in the output root. Full steps + the
domain-replacement one-liner are in `README.md`.

After deploy, verify: the live URL reproduces the spec §6 values, a second load works
offline (DevTools → Network → Offline), and the share link round-trips state.

- Service-worker scope is its serving directory; all asset paths are relative, so a
  `pages.dev` subdomain or a custom domain both work without changes.
- Cache-first SW: bump `CACHE` in `sw.js` to ship updated files.

## Reviewed but not built (from spec §7)

- **Larger / dynamic histogram windows (>20f)** — deferred; marginal effect on L\*, adds
  UI complexity.
- **Real modifier calibration (`k_t / k_u / k_c`)** — blocked upstream; NaNDL doesn't
  publish the constants (that's why Fatigue/CPS keep the **BROKEN?** tags). Left editable.
