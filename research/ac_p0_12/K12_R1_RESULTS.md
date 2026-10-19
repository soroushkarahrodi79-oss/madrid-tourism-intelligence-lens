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
| **`thin`** — hide POI cluster icons only *while actively panning* (restored on `moveend`) | 316.6 ms | **83.4 ms** | **−233.1 ms (−74%)** | −150.4 | 6/6 | −206 ms | **GO (pending explicit UX sign-off)** |
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
- **Even with `thin`, the aggressive automated pan is 83 ms p95 — still above 33.3
  ms.** The automated 3-loop drag is far heavier than a single physical gesture, so
  this does not establish the physical result; a −74% reduction is very likely
  sufficient for a real single-gesture pan, but only a **physical UHD 620
  re-measure** can confirm (release gate).

## GO / HOLD

- **GO (engineering), pending UX sign-off:** adopt **`thin`** as the remediation. It
  is a measured −74% pan-p95 win that preserves geometry, data (restored on
  `moveend`), accessibility (pointer/touch unchanged), both basemaps and all evidence
  semantics. It requires the owner's **explicit UX decision** (cluster icons blink out
  only during an active drag) before it becomes a production default — so it stays
  **behind the flag in this PR**, not silently defaulted.
- **HOLD / not adopted:** `idle` (no demonstrated win), `noretina` (unmeasured
  locally — needs keyed deploy).
- **No MapLibre:** not required or proposed. `thin` addresses the dominant DOM-marker
  cost within Leaflet; a MapLibre migration/spike remains separately authorized only
  if a physical re-measure shows `thin` (± a keyed-deploy `noretina`) is insufficient.
- **Release gates unchanged:** physical UHD 620 pan p95 ≤ 33.3 ms and physical
  iPad/iPhone Safari marker/radius/pan+freshness. Automation cannot self-issue PASS.
  AC-P0-12 thresholds unchanged; UHD 620 retained as a supported class.

## One concrete next decision for the owner

**Approve the `thin` interaction (cluster icons hidden only during an active drag,
restored instantly on release)?** If **yes**, I make it the production default (remove
the flag gate), add a WCAG/interaction check and ES/EN + light/satellite coverage
tests, and request a physical UHD 620 re-measure. If **no**, this track reports
**NO-GO within bounded Leaflet** for reaching 33.3 ms on UHD 620, and the next step is
a separately-authorized `noretina` keyed-deploy measurement and/or a MapLibre spike.
