# AC-P0-12 map-pan investigation — pre-existing failure; the "P0-a overhead" was a measurement confound

**PR #96 · investigated at head `90d579a` · test-only.** The owner's valid physical
Windows 11 / Chrome / **Intel UHD 620** AC-P0-12 run (commit `ab1f650`): marker drag
**PASS** (p95 136.6 ms, 61 samples, fresh), radius drag **PASS** (p95 144.9 ms, 56
samples, fresh), **map pan FAIL** (p95 66.8 ms, 273 samples, vs 33.3 ms), at
**viewport 1036×518, devicePixelRatio 2**. Overall **FAIL for this device class**.
(Owner-reported summary; the raw device JSON stays with the owner and its **FAIL is
preserved unchanged**.)

**Question:** is the map-pan failure pre-existing, or a regression from PR #96?

**Answer — two findings, now with hardened guards and trace evidence:**
1. **Pre-existing absolute failure — CONFIRMED.** Clean `origin/main` also fails the
   33.3 ms pan ceiling on this hardware — even with the heavy POI layers **off**
   (p95 ≈ 50–67 ms; basemap + admin lattice + lens at dpr 2 alone).
2. **Incremental P0-a overhead — DISPROVEN as a build regression; it was a
   measurement confound.** The earlier "+50–66 ms" gap came from **unequal POI-cluster
   rendering** between the two separately-loaded app instances (not a P0-a code
   change). With the render state controlled to be **deterministic and equal**, PR ≈
   `main` across repeated runs and both null controls, and Chrome tracing shows equal
   per-pan Script/Layout/RecalcStyle/heap/nodes. See §3–§4.

> **Measurement classes stay separate.** The owner's `ab1f650` run is a **physical
> actual-gesture device** result. Everything below is **`hardware_automated`**:
> scripted Playwright mouse drags on real hardware Chrome (Intel UHD 620, not
> SwiftShader). These are **not** human gestures and **never** `device_grade`; they do
> not substitute for physical iPad/iPhone Safari validation. The automated drag
> (circle at 1036×650) is **not** the owner's physical 1036×518 trajectory, so
> absolute values are not conflated.

---

## 1. The harness is now trustworthy (reviews 5564383172 H1–H3, 5567748806 R1–R2)

`auto_compare.mjs` (one command) + pure guards in `auto_compare_guards.mjs`,
unit-tested in `tests/ac_p0_12_auto_compare.test.mjs` (20 cases incl. synthetic fail
conditions):

- **H1 fail-closed hardware GPU** — software/SwiftShader/llvmpipe/NO_WEBGL/unknown/
  missing on **either** arm → `COMPARISON UNAVAILABLE`.
- **H2/R1 sample validity** — each pan must be error-free with a **real post-warm raw
  array** (`n === raw.length`, all samples finite), statistics that **independently
  recompute from raw** (no fabricated `{n:48}`), and **genuine movement**
  (≥48 active-pan frames).
- **H2/R2 comparability** — PR/main must match map rect, zoom, DPR, initial centre,
  data-readiness **AND rendered state (canvas/marker/path counts; tiles within a
  small tolerance)**; missing/NaN fields are a mismatch (the `Math.abs(NaN)` pitfall
  is closed). **This is the guard that caught the confound (§3).**
- **H2/R1 drift** — re-centre to default before every pan (calibrated corrective
  drag); a **non-empty** start-centre set must stay within a **strict** tolerance
  (`DRIFT_TOL_DEG = 2e-4`); re-centring failure fails closed. (A drift breach and a
  render-mismatch breach are both retained as `results/..._UNAVAILABLE_*.json`.)
- **H3 teardown** — browser/servers **awaited** closed; a **uniquely-named**
  disposable worktree removed with retries; failure reported (non-zero exit), never
  silent; unrelated worktrees untouched; repeat-run idempotent.
- **Null controls** — `--self=pr` and `--self=main` serve the **same** build on both
  arms → paired delta ≈ 0 (no arm/port/page bias).
- **R3 CDP profiling** — Chrome `Performance.getMetrics` deltas per pan localise the
  cost to a category rather than assuming GC/JIT.

## 2. Diff-level: PR #96 adds no map-pan code path

`git diff origin/main..HEAD` adds **no** map `move`/`drag`/pan handlers, **no**
rAF/observer/timer, **no** expensive CSS. A pan is a drag, not a click, so `refresh()`
(the only membership-render path) never runs during a pan; the 724 ámbitos are not
drawn; the only P0-a listeners are marker `dragstart`/`dragend` + a `See all` click.
P0-a touches **no POI/clustering/marker code.**

## 3. The confound — unequal POI-cluster rendering (R2 was correct)

The default POI layers (museum/info/stay/bike/rail) render through **clustering**,
whose DOM marker **count is non-deterministic** across two separately-loaded
instances (load order / settle timing). The hardened comparability guard caught it:

```
COMPARISON UNAVAILABLE — H2 PR/main environment not comparable:
  map canvases 3 vs 1; overlay markers 195 vs 1     (first catch)
  overlay markers 195 vs 110                         (after longer readiness)
```

Inspection: the ~195 markers are **POI cluster icons** (`poi-cluster-icon`), not
anything P0-a adds. So the earlier "+66 ms PR-over-main" was PR happening to render
**more POI clusters than `main` at measurement time** — a heavier pan workload on one
arm, i.e. a **data/layer-readiness confound**, exactly as review 5567748806 R2
warned. It explains every prior observation: removing the membership DOM did nothing
(the cost was clusters, not the block); no per-frame code differs; the self-PR null
was ≈ 0 (same clustering both arms).

## 4. Controlled, equal-render comparison — PR ≈ main (trace-backed)

Disabling the POI layers on **both** arms gives a **deterministic, equal** render
state (verified identical: `{tiles:20, canvases:3, markers:4, paths:3}` on both),
isolating any true P0-a overhead. `hardware_automated`, Intel UHD 620, dpr 2, map
1036×650, warm, drift < 0.0001°, SHA `90d579a`:

| run | main p50 | PR p50 | paired PR−main p50 | PR slower in | CDP Δ script (ms) |
|---|---|---|---|---|---|
| PR-vs-main #1 (`…07-32`) | 49.8 | 33.5 | **−0.3** | 1/4 | +2.1 |
| PR-vs-main #2 (`…07-37`) | 33.6 | 33.5 | **−0.1** | 1/4 | +6.6 |
| null `--self=pr` (`…07-41`) | 33.6 | 33.5 | **0.0** | 1/4 | +2.3 |
| null `--self=main` (`…07-45`) | 33.5 | 49.9 | **+0.3** | 3/4 | −2.0 |

Paired PR−main is **within one-frame noise (±16.7 ms)** every run; PR is as often
faster as slower; the null controls match. Chrome tracing: per-pan **Script Δ ≈ ±2–7
ms, Layout 0, RecalcStyle Δ ≈ ±2–5 ms, JS heap 20.7 vs 21.5 MB, DOM nodes 39595 vs
39634** — equivalent within noise. **There is no material P0-a pan overhead.** This is
a disproof by controlled measurement + trace, **not** a "both already fail so it's
immaterial" dismissal.

## 5. The real target is the pre-existing Leaflet cost — K12 (separate track)

Even with POI layers off, **both** arms fail the 33.3 ms p95 ceiling (≈ 50–67 ms) —
basemap raster + the 31,648-vertex admin lattice at dpr 2 on a weak integrated GPU.
With POI layers on the automated pan is far heavier. The route to the UHD 620
requirement is the pre-existing-cost reduction assessed in
[`K12_UHD620_REMEDIATION.md`](K12_UHD620_REMEDIATION.md) — **minimal Leaflet tuning
before MapLibre**, none implemented in PR #96.

## 6. Evidence reproducibility (review 5567748806 R4)

Tested SHA is **`90d579a`** (the harness ran against the PR at this head; the
baseline is `origin/main` 55fa0c7). **Four** reproducible equal-render raw JSONs are
retained (two PR-vs-main, two null controls), plus two fail-closed `UNAVAILABLE`
samples (a render-mismatch catch and a drift catch). The earlier confounded JSONs
(measured on unequal render state, pre-R2-hardening) are **removed** as superseded —
git history retains them; this directory keeps only confound-controlled evidence.

## 7. GO / HOLD

- **Functional correctness: GO** (P0-a correctness, freshness, scientific and
  accessibility contracts, CI — unaffected).
- **No P0-a pan regression**: disproven under equal render state with trace evidence.
- **Map-pan FAIL on Intel UHD 620 is PRE-EXISTING** (clean `main` fails even POI-off).
- **AC-P0-12 device gate: FAIL for the Intel UHD 620 class → HOLD for that class.**
  Threshold **not** weakened; UHD 620 kept as the **working support-floor target**.
  Automation does not satisfy the physical Safari gate.

## 8. One concrete next technical decision (not an indefinite policy loop)

**Authorize the K12 minimal-Leaflet pan remediation (`K12_UHD620_REMEDIATION.md`) as
its own bounded track** — the harness is ready to A/B each lever on UHD 620. The
first cheap levers to measure: `updateWhenIdle:true` on the raster tiles, non-retina
(1×) basemap tiles at dpr 2, and simplifying the 31,648-vertex admin lattice for
display. If those do not bring POI-off pan p95 under 33.3 ms, measure capping the
overlay-canvas backing DPR and thinning the dense POI layers during active pan; only
then consider MapLibre. In parallel, the **physical iPad/iPhone Safari actual-gesture
runs** remain the device-grade gate that automation cannot replace.

**PR #96 stays Draft and unmerged; no deploy; no HATI change; no threshold weakening;
no speculative renderer change inside PR #96.**
