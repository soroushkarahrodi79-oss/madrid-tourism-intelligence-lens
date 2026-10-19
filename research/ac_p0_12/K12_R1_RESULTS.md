# K12-R1 — Intel UHD 620 Leaflet pan remediation: measured outcomes (issue #97)

**Separate branch `k12-r1-leaflet-pan` (off `origin/main`); separate Draft PR. Does
NOT touch PR #96, HATI, data builders, scientific models, `ambitosIntersecting`, or
map scope/interpretation.** The bounded optimizations are implemented **test-only,
behind a gated `?k12opt=` flag** (loopback/private-LAN host only, absent in normal
use and on the public deploy), so nothing is a silent production default; each is
A/B-measured first.

> **`hardware_automated`, not a device PASS.** All numbers below are scripted
> Playwright mouse-drag pans on real hardware Chrome (Intel UHD 620, dpr 2, map
> 1036×650), **not** human gestures and **never** `device_grade`. The automated
> 3-loop drag is more aggressive than the owner's single physical gesture, so
> absolute values are not comparable to the owner's 66.8 ms; the **paired
> candidate−baseline delta** on one build is the signal. Physical UHD 620 p95 ≤ 33.3
> and physical iPad/iPhone Safari remain the release gates automation cannot issue.

## First gate — a trustworthy production-default POI-ON comparator

The earlier confound (unequal POI-cluster marker counts, 195 vs 110) was a **partial
data-load** artifact: `js/clustering.js` is a deterministic pixel-grid bucketing (no
randomness), so once **both arms fully load the same POI data at the same centre/zoom,
the clusters are identical**. The harness now waits for the whole render state to
stabilise and the comparability guard **requires equal rendered counts**
(`{tiles,canvases,markers,paths}`). Every A/B below ran **POI layers ON** with both
arms verified equal: **`{tiles:20, canvases:3, markers:195, paths:3}`**. A same-build
POI-ON control (`--self=pr --layers=on`) and the near-zero `idle` result confirm the
harness is unbiased at the (noisier) POI-ON workload.

## Second gate — ranked A/B (POI-ON, 6 warmed ABBA pairs, drift < 0.0001°)

Candidate = optimization ON (`?k12opt=…`), baseline = OFF, **same build**. Negative Δ
= faster (improvement). Raw JSON in `results/auto_compare_55fa0c70_*.json`.

| Lever | baseline pan p95 | candidate pan p95 | **paired Δ p95** | Δ p50 | pairs faster | CDP Δ task/pan | Verdict |
|---|---|---|---|---|---|---|---|
| **`thin`** — hide POI cluster icons only *while actively dragging* the map (restored on release) | 316.6 ms | **83.4 ms** | **−233.1 ms (−74%)** | −150.4 | 6/6 | −206 ms | **GO (pending explicit UX sign-off)** |
| **`thin` (hardened, drag-gated)** re-measure | 350.1 ms | **116.4 ms** | **−199.5 ms (−57%)** | −133.8 | 6/6 | −317 ms | win holds after UX hardening |
| `idle` — `updateWhenIdle:true` + `updateWhenZooming:false` on raster tiles | 233.5 ms | 233.4 ms | **+0.1 ms** | −0.1 | 6/6 (≈0) | −24 ms | marginal — within noise; keep behind flag |
| `idle,thin` combined | 250 ms | **67.2 ms** | −166.1 ms | −133.3 | 6/6 | −170 ms | win, dominated by `thin` |
| `noretina` — 1× CARTO tiles at dpr 2 | — | — | not locally measurable (local basemap is keyless OSM, already 1×) | — | — | — | implemented; needs a **keyed CARTO deploy** to measure |

## Reading

- **`thin` is the only high-impact bounded lever**: it cuts POI-ON pan p95 from
  **316.6 → 83.4 ms (−74%)**, 6/6 pairs, by not re-laying-out/painting the ~195 DOM
  cluster markers during the drag. The cluster icons **reappear the instant panning
  stops** — no evidence is permanently removed, and individual clusters are not read
  mid-drag. This is the issue's explicitly-allowed *"temporary dense POI
  render-thinning while actively panning, with an explicit UX decision"* lever.
- **`idle` does not produce a demonstrated frame-time improvement** at this workload
  (paired p95 ≈ 0; a small CDP task reduction only). Per *"implement only changes
  with demonstrated improvements"* it is **not** adopted; kept behind the flag.
- **`noretina`** halves basemap tile pixels at dpr 2 but cannot be measured on the
  keyless local OSM basemap; it is implemented and must be measured on a keyed CARTO
  deploy before adoption.
- **Even with `thin`, the aggressive automated pan is 83–116 ms p95 — still above
  33.3 ms.** The automated 3-loop drag is far heavier than a single physical gesture,
  so this does not establish the physical result; a −74%/−57% reduction is very likely
  sufficient for a real single-gesture pan, but only a **physical UHD 620
  re-measure** can confirm (release gate). A −74% automated reduction is **not**
  extrapolated to a predicted device PASS.

## UX hardening, acceptance tests & visual review (review 5571780753)

The reviewer's blocking condition was that `movestart` is **not** synonymous with a
human drag, and that a naive hide could strand the map in a thinned state or hide a
focused element. The implementation was tightened accordingly, and an acceptance
contract (`browser-tests/k12-r1-thin.browser.mjs`, 7 tests, all pass) now defends it:

- **Activation is drag-only.** `thin` turns on for `dragstart` (a user map drag) and
  **not** for zoom, programmatic camera moves, or dragging a Lens marker. *(tests:
  drag hides/restores; zoom does not thin; marker-drag does not thin.)*
- **Restoration on every termination path.** Cleared on `dragend`, `moveend`
  (covers inertia/programmatic settle), `zoomstart`, window `blur`,
  `visibilitychange`, and `pointercancel`/`touchcancel`. The map is **never** left in
  `k12-panning`. *(test: blur mid-drag with pointer still down restores clusters.)*
- **Focus/keyboard/SR safety.** The hide rule is
  `.k12-panning .poi-cluster-icon:not(:focus)` — a **focused** cluster is never
  `display:none`, so keyboard/screen-reader focus is never dropped on a hidden node.
  *(test: focused cluster stays displayed during a drag.)*
- **Identity preserved.** Clusters are deterministic (pixel-grid bucketing); after the
  gesture the DOM count and `{screen-pos:count-text}` signature are restored. Geometry,
  labels, the Lens circle and panels are untouched. *(test: ES + satellite restore.)*
- **Professional reinstatement.** Icons fade back over 0.18 s
  (`@keyframes k12ClusterFade`), suppressed under `prefers-reduced-motion`, so the
  return reads as a settle rather than a pop.

**Visual review (6 PNGs, desktop 1200×860 + tablet 834×1112, before/during/after a
pan at the ~195-cluster scene):** during the active drag the heavy DOM **cluster
count-circles are hidden, but the lightweight POI dots, the admin-boundary lattice,
the Lens circle and the panel all remain painted** — so spatial orientation is
maintained throughout the gesture (it is **not** an abrupt blanking of the map). On
release the clusters fade back at their new positions with no popping or missing
nodes. This is a materially better outcome than "icons blink out", and it is what the
measured win costs visually.

## Final UX decision: CONDITIONAL GO (candidate), HOLD (production default / release)

- **CONDITIONAL GO — keep `thin` as the preferred candidate, still behind the flag.**
  It is a measured −74% / −57% pan-p95 win across two independent POI-ON runs (6/6
  pairs both times), now hardened to drag-only activation with all-path restoration,
  focus/SR safety, and a reduced-motion-aware fade-in, and defended by a 7-test
  acceptance contract plus a before/during/after visual review. It preserves geometry,
  evidence semantics, both basemaps, and ES/EN. Per the owner's instruction it is **not
  enabled as the production default** in this PR — it stays gated (`?k12opt=thin`,
  loopback/private-LAN only) pending the owner's explicit UX sign-off.
- **HOLD — production default, READY, and merge.** Making `thin` the default requires
  the owner's explicit approval of the during-drag simplification. The release gate is
  **not** met: automated pan is still 83–116 ms p95 (> 33.3 ms), and the physical UHD
  620 FAIL (66.8 ms) stands until a physical re-measure. No failed-gate merge.
- **Not adopted:** `idle` (no demonstrated win), `noretina` (unmeasured locally —
  needs a keyed CARTO deploy). **No MapLibre** proposed; `thin` addresses the dominant
  DOM-marker cost within Leaflet.
- **Release gates unchanged:** physical UHD 620 pan p95 ≤ 33.3 ms and physical
  iPad/iPhone Safari marker/radius/pan+freshness. Automation cannot self-issue PASS;
  the −74% is not extrapolated to a device PASS. AC-P0-12 thresholds unchanged; UHD
  620 retained as a supported class.

## Remaining route to physical p95 ≤ 33.3 ms on UHD 620

1. **Physical UHD 620 re-measure with `thin` on** (`?k12opt=thin`) — the decisive
   step. A single physical gesture is far lighter than the automated 3-loop drag; a
   −57%/−74% reduction on the dominant cost makes 66.8 → ≤ 33.3 ms plausible, but only
   a device run confirms it. This is the next release-gating measurement.
2. **If still above 33.3 ms, stack the measured-cheap tile levers on a keyed deploy:**
   `noretina` (1× CARTO at dpr 2, halves basemap tile pixels — must be measured on a
   keyed CARTO basemap, not the local keyless OSM) and `idle`, A/B'd physically.
3. **Only if (1)+(2) remain insufficient** does a separately-authorized MapLibre
   vector spike become the next architectural decision — not before.

## One concrete next decision for the owner

**Approve the hardened `thin` interaction** (during an active map drag, the POI
cluster count-circles hide while the POI dots, boundary lattice and Lens stay visible;
they fade back on release)? If **yes**, I promote it to the production default (remove
the flag gate) and request the physical UHD 620 + iPad/iPhone Safari re-measure. If
**no**, this track reports NO-GO within bounded Leaflet for 33.3 ms on UHD 620 and the
next step is the keyed-deploy `noretina` measurement and/or a MapLibre spike.

## PR #96 integration compatibility

PR #96 (AC-P0-12 device runner) and this PR both edit `js/app.js`, but the K12-R1
changes are **purely additive and gated**: a `k12PanOpts` reader, `k12TileOptions()`,
`k12CartoRetina()`, and the `thin` listener block, all no-ops unless
`?k12opt=…` is present on a loopback/private-LAN host. They do not touch the
`__HALO_REGRESSION__` seam, membership/halo rendering, or any PR #96 measurement path.
The acceptance test boots the real app through `?haloRegressionTest=1` and confirms
membership/halo markers still render. On merge order, whichever lands second rebases
the additive block; no semantic conflict is expected.
