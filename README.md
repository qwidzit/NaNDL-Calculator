# NaNDL Precision Calculator

Estimate the timing **precision** (`L*`) a player needs to complete a Geometry-Dash-style
level, using the [NaNDL](https://nandl.pages.dev/#calculations) probabilistic difficulty
model. Bigger `L*` = harder level.

A static, dependency-free, offline-capable web app. No build step, no framework, no server,
no accounts. Shareable state lives in the URL; the only persistence is an offline asset cache.

> Full math, assumptions, and regression values: [`NaNDL_calculator_spec.md`](NaNDL_calculator_spec.md).

## Features

- **Two input modes** — a frame-window **histogram** (counts per window size), or a
  **manual list** of exact `time → window` inputs. Times read as **seconds or %** of the level.
- **Run / segment scoring** — a range like `23.2 - 81.8` scores just that slice as its own
  level (inputs re-based to start at 0). Works in both seconds and %.
- **Per-input breakdown** — each input's pass probability `p` and reach probability at `L*`,
  with times shown in both seconds and %, and the weakest inputs flagged.
- **Modifiers** — optional Nerve / Fatigue / CPS multipliers (off by default; the constants
  are editable placeholders — Fatigue and CPS are tagged `BROKEN?` because NaNDL doesn't
  publish calibrated values).
- **fps presets** 120 / 240 / 480 + validation.
- **`.txt` import / export** of the manual list.
- **Shareable links** — the whole UI state is encoded in the URL hash (no storage).
- **Offline** — a service worker caches all assets, so it runs with no network after first load.

## Run locally

ES modules require HTTP (not `file://`), so serve the folder with any static server:

```bash
# Python
python3 -m http.server 8000
# or Node
npx serve .
```

Then open <http://localhost:8000/>.

## Tests

Pure-math regression tests (spec §6 values + helpers) via Node's built-in runner — no deps:

```bash
npm test
```

## Deploy to Cloudflare Pages

This repo is the deployable output as-is (no build step).

1. **Create a Pages project** and connect this GitHub repo (or drag-and-drop the folder).
2. **Build settings:**
   - Framework preset: **None**
   - Build command: **(leave empty)**
   - Build output directory: **`/`** (the repo root — where `index.html` lives)
3. Deploy. `_headers` (security + service-worker caching) and `404.html` are picked up
   automatically because they sit in the output root.

Because the output directory is the repo root, [`.assetsignore`](.assetsignore) excludes
`node_modules/` (the build installs `wrangler`, whose `workerd` binary is >25 MiB and would
otherwise fail the upload with *"Asset too large"*) plus the dev-only files (docs, prototype,
tests). The deployed site is just the app assets.

### Domain

The site's origin is `https://nandl-calculator.pages.dev`, wired into `index.html`
(canonical, Open Graph, JSON-LD), `robots.txt`, and `sitemap.xml`. If you move to a
different/custom domain, update it everywhere:

```bash
# from the repo root — swap in your real origin (no trailing slash)
grep -rl 'nandl-calculator.pages.dev' index.html robots.txt sitemap.xml \
  | xargs sed -i 's#https://nandl-calculator.pages.dev#https://YOUR-DOMAIN#g'
```

Then update `<lastmod>` in `sitemap.xml` when you make meaningful changes, and (optionally)
submit the sitemap in Google Search Console / Bing Webmaster Tools.

### Shipping updates

The service worker is **cache-first**, so bump `CACHE` in [`sw.js`](sw.js) (e.g. `nandl-v2`
→ `nandl-v3`) whenever you change `index.html`, the CSS, or the JS — otherwise returning
visitors keep the cached version until then. `_headers` already tells browsers never to
hold a stale `sw.js`, so the new worker is detected on the next visit.

## Project structure

```
index.html              markup; links css/ + loads js/app.js as a module
css/styles.css          all presentation
js/calc.js              pure math ES module (erf, evaluate, solveLstar, perInputStats, sliceRun, …)
js/app.js               UI: input modes, run/segment, breakdown, import/export, URL state, SW registration
sw.js                   offline service worker (cache-first, versioned)
manifest.webmanifest    PWA manifest
tests/calc.test.js      regression tests (npm test)
robots.txt, sitemap.xml SEO / crawler config
_headers                Cloudflare Pages response headers
.assetsignore           files excluded from the Cloudflare assets upload (node_modules, dev files)
404.html                themed not-found page
favicon.svg, og-image.png   icon + social preview
nandl_calculator_2.html original single-file prototype (reference only)
STATUS.md               project status & history
```

## Credits

Difficulty model: [NaNDL](https://nandl.pages.dev/). This tool is an independent calculator
built on that model's published math.
