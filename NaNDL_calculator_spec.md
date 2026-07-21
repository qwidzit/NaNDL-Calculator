# NaNDL Precision Calculator — Technical Handoff

This document describes the single-file prototype `nandl_calculator.html` so another
developer/agent can turn it into a full website. It covers what the tool computes, the
exact math, the code structure, the assumptions baked in, and known-good numbers you can
use as regression tests.

The prototype is one self-contained HTML file (inline CSS + vanilla JS, no dependencies,
no build step, no network calls, no browser storage). Everything below lives in that file.

---

## 1. Purpose

The calculator estimates how much timing **precision** a player needs to clear a level
whose difficulty is defined by a set of frame-perfect inputs. It is based on the NaNDL
model published at https://nandl.pages.dev/#calculations (a probabilistic difficulty model
for click-timing games — the layout and vocabulary are Geometry-Dash-like: "frames",
"windows", "CPS").

The headline output is **L\*** — the precision value at which the *expected* time to
complete the level equals a target time (24 hours by default). Bigger L\* = harder level.
The tool also reports the implied timing standard deviation `σ = 1/L*` (in ms), the
single-attempt completion probability `P(C)`, and the expected time to complete.

---

## 2. The math model

### 2.1 Per-input pass probability

Each input `i` has a window of `Nᵢ` frames. At frame rate `f` (fps) its duration in
seconds is:

```
wᵢ = Nᵢ / f
```

A player is modeled as having Gaussian timing error with standard deviation `σ` seconds.
Precision is defined as `L = 1/σ` (larger L = sharper). The input is cleared if the timing
error lands within the half-window, giving a "sigma value" (number of standard deviations
of headroom):

```
sᵢ = ½ · wᵢ · L
```

and a pass probability equal to the probability a standard normal lands in `[-sᵢ, sᵢ]`:

```
pᵢ = P(|Z| ≤ sᵢ) = erf( sᵢ / √2 )
```

`erf` is implemented directly (Numerical Recipes `erfcc`, |error| < 1.2e-7) because JS has
no `Math.erf`. Sanity anchors: `erf(1) ≈ 0.8427`, `pᵢ(s=1) ≈ 0.6827`, `pᵢ(s=2) ≈ 0.9545`.

### 2.2 Level-wide metrics

With `qᵢ = 1 − pᵢ`:

```
P(C)   = ∏ pᵢ                         (clear the whole level in one attempt)
rⱼ     = ∏_{l<j} pₗ                   (reach input j without dying earlier)
E[T_A] = t_n · P(C) + Σ tⱼ · rⱼ · qⱼ  (expected time of one attempt, incl. failures)
E[T_C] = E[T_A] / P(C)                (expected total time, since you retry until you win)
```

`tⱼ` is the input's time position (seconds) and `t_n` is the level's clear time. In code
`t_n = max(levelLength, lastInputTime)`.

### 2.3 The precision score L\*

`E[T_C]` is strictly decreasing in `L` (more precise → higher `P(C)` → fewer retries). The
tool bisects on `L` to find `L*` where `E[T_C] = targetSeconds` (default `24·3600`). The
result panel then shows `σ = 1/L*` in ms, `P(C)` at `L*`, and confirms `E[T_C] ≈ target`.

### 2.4 Modifiers (optional, all OFF by default)

Each enabled modifier multiplies an input's sigma value before the probability is taken
(`sᵢ ← sᵢ · ∏λ`):

| Modifier | Formula | Depends on | Default constant | UI note |
|---|---|---|---|---|
| Nerve   | `λ = e^(−k_t · tᵢ)` | time position `tᵢ` (s) | `k_t = 0.0015` | — |
| Fatigue | `λ = e^(−k_u · i)`  | input index `i` (1-based) | `k_u = 0.00075` | tagged **BROKEN?** |
| CPS     | `λ = (4 / max(1, 2c))^{k_c}` | local clicks/sec `c` | `k_c = 2` | tagged **BROKEN?** |

`c` (local CPS) is `1 / gap`, where `gap` is the time to the previous input (for the first
input, to the next; for a single input, `1/levelLength`). These constants are **placeholders**
— the real NaNDL site does not publish its calibrated values, so they are exposed as editable
fields. The "BROKEN?" tags on Fatigue and CPS were requested by the product owner to flag them
as not-yet-trusted.

Note: because Nerve/Fatigue/CPS depend on ordering and timing, they only affect the result
in ways that depend on input order. With all modifiers off, order is irrelevant to `P(C)`.

---

## 3. Input modes

There are two ways to describe a level; both feed the same math via a normalized array
`inputs = [{ t, k }, …]` (seconds, frames), sorted ascending by `t`.

### 3.1 Histogram mode

The user enters **counts per frame-window size** for windows 1f…20f (a difficulty
histogram). Because a histogram carries no ordering or timing, the tool synthesizes an
input list by assuming inputs are:

- **evenly spaced** in time across the level length (`tⱼ = (j + ½) · levelLength / M`), and
- **evenly interleaved** by window size (no clustering of hard inputs) via
  `buildSequence()`, an apportionment loop that repeatedly places the window that is most
  "behind" its fair share.

With modifiers off, this makes L\* depend only on the histogram, level length, and target.

### 3.2 Manual list mode

The user enters each input's **exact time and window**, so ordering, gaps, and positions
come straight from the data (nothing is scattered evenly). Rows can be added/removed. A
**Seconds / %** switch controls how the time column is read:

- **Seconds** — the number is an absolute time in seconds.
- **%** — the number is a percentage of the level length that grows evenly across the
  level, converted as `t = pct/100 · levelLength` (50% = halfway in time).

Toggling the switch converts existing row values so the *real* times stay fixed (e.g. 1.9 s
in a 60 s level becomes 3.17 %).

### 3.3 .txt import (manual mode)

An **Import .txt** button loads a plain-text file, one input per line, formatted as
`time - window` (a dash separator, spaces optional). Parsing is a permissive regex
`/(-?\d*\.?\d+)\s*-\s*(\d*\.?\d+)/` per line; blank/header/garbage lines are skipped.
Imported times are read in **whatever the Seconds/% switch is currently set to**, so the
same file loads as seconds or percentages depending on the mode. Import **replaces** the
current list. A **Format guide** popup documents the format and shows the sample; it also
auto-opens if a file yields zero valid lines.

Example import file:

```
1.5 - 3
2.1 - 5
2.9 - 15
5.1 - 8
5.5 - 8
8.1 - 11
10 - 4
```

---

## 4. Code map (functions to preserve)

All logic is pure and framework-free — easy to lift into a module.

| Function | Signature | Role |
|---|---|---|
| `erf(x)` | `number → number` | Error function approximation |
| `passProb(s)` | `number → number` | `erf(s/√2)`, clamped to `(0, 1)` |
| `buildSequence(counts)` | `{window:count} → number[]` | Even-interleave a histogram into a window-size sequence |
| `histInputs(counts, T)` | `→ [{t,k}]` | Histogram → evenly-spaced input list |
| `localCps(inputs, j, T)` | `→ number` | Local clicks/sec at input `j` |
| `evaluate(L, cfg)` | `→ {ETC, PC}` | Compute `E[T_C]` and `P(C)` for a precision `L` |
| `solveLstar(cfg, targetSec)` | `→ number` | Bisection for `L*` (200 iterations; expands the upper bracket first) |

`cfg = { inputs:[{t,k}], f, T, mods }` where
`mods = { nerve:{on,k}, fatigue:{on,k}, cps:{on,k} }`.

The UI layer (below `/* ===== UI ===== */`) builds the histogram grid, manages manual rows,
handles the mode/unit toggles, wires the import + guide modal, and calls `recompute()` on
every `input`/`change` event. `recompute()` reads the DOM, builds `inputs`, validates, runs
`solveLstar`, and writes the result panel. Validation messages fire when: level length ≤ 0,
no inputs, or target ≤ 0.

---

## 5. Assumptions & known limitations

- **Histogram ordering is synthetic.** Even spacing + even interleave is a neutral guess;
  it only matters once a modifier is enabled. A real level's clustering of hard inputs is
  not captured in histogram mode — manual mode is the accurate path.
- **Modifier constants are unverified.** Defaults are placeholders; Fatigue and CPS are
  flagged BROKEN?. Do not present them as authoritative.
- **`σ` is a timing standard deviation in seconds**, and `L = 1/σ`. The "precision" number
  is unitless-ish (1/s); the ms readout is the more intuitive form.
- **Target time** is user-editable (default 24 h) even though the NaNDL definition fixes it
  at 24 h.
- No persistence, no accounts, no server — purely client-side computation.

---

## 6. Regression values (use these as tests)

Frame rate `f = 240`, level length `T = 60 s`, target = 24 h, **modifiers off** unless noted.

| Scenario | Input | Expected L\* | Notes |
|---|---|---|---|
| erf/prob anchors | — | — | `erf(1)=0.8427`, `passProb(1)=0.6827`, `passProb(2)=0.9545` |
| Histogram | `{1:1, 2:3, 3:10, 4:15, 6:20, 8:30, 12:40, 20:68}` (187 inputs) | **175.543** | `E[T_C]=24.0000 h`, `P(C)=9.05e-5` |
| Histogram + all mods on | same, defaults `0.0015 / 0.00075 / 2` | **485.318** | mods raise required precision |
| Manual (seconds) | `1.9→2f, 2.3→6f, 2.4→19f` | **2.763** | tiny level → low precision |
| Manual + all mods on | same | **10.941** | — |
| Import sample (seconds) | the 7-line file in §3.3 | **19.161** | `E[T_C]=24 h` |
| Import sample (%) | same 7 numbers read as % of 60 s | **17.749** | different because positions differ |

Any rebuild should reproduce these to ~3 significant figures (bisection converges to well
under 0.1% of `L*`).

---

## 7. Suggestions for the full website

These are optional ideas, not requirements:

- **Extract the pure math** (`erf`, `passProb`, `buildSequence`, `histInputs`, `localCps`,
  `evaluate`, `solveLstar`) into a standalone ES module and cover it with the §6 values as
  unit tests before touching the UI.
- **Shareable state**: encode the histogram / manual list / settings into the URL (query or
  hash) so levels can be linked. Avoid putting anything sensitive in the URL (there isn't
  any here, but keep it clean).
- **Per-input breakdown**: a table or chart of `pⱼ`, `rⱼ`, and the weakest inputs would help
  users see *where* a level is hard — the data is already computed inside `evaluate` (expose
  it instead of discarding the arrays).
- **Real modifier calibration**: if the true `k_t / k_u / k_c` become known, replace the
  placeholder defaults and remove the BROKEN? tags. Keep them editable for power users.
- **Larger windows / dynamic rows** in histogram mode (currently fixed 1f–20f).
- **Frame rate presets** (60/120/240/480) and validation for non-integer or zero fps.
- **Import/export parity**: add a matching `.txt`/JSON export of the current manual list.
- Preserve the no-storage / no-external-deps property if it must run as a static page or
  sandboxed artifact.

---

## 8. File

- `nandl_calculator.html` — the working prototype (open in any browser; recomputes live).
