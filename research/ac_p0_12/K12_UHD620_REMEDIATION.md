# K12 performance remediation assessment — Intel UHD 620 map pan

**Scope: assessment only. Nothing here is implemented in PR #96.** This is the
evidence-led "minimal Leaflet tuning **before** proposing MapLibre" the owner and
review 5564383172 asked for, to be authorized as its own track **if** the owner
declares Intel UHD 620 a supported floor (decision in
`BASELINE_AND_PAN_INVESTIGATION.md` §9). It does **not** weaken AC-P0-12 thresholds,
exclude the UHD 620 class, change scientific contracts or touch HATI.

## The problem, measured

On Intel UHD 620 the map pan fails the 33.3 ms p95 ceiling by ~4× on **both** clean
`main` and PR #96 — a **pre-existing Leaflet cost**, not a P0-a defect (physical
owner run 66.8 ms p95; `hardware_automated` warmed ≈ 150–233 ms p95 at dpr 2). What
repaints during a pan (unchanged by P0-a):

- **basemap raster tiles** — at dpr 2 the CARTO `{r}` retina tiles are 4× pixels;
- **~1,400 default POI canvas markers** — `stay` (613) + `bike` (631) dominate
  (`DENSE_LAYER_TYPES`), plus museum/info/rail;
- **the admin lattice** — 153 features / **31,648 vertices**;
- all scaled by **devicePixelRatio²** on a weak integrated GPU.

The 724 ámbitos are **not** drawn (query-only), so they are not a pan cost here.

## Minimal Leaflet tuning candidates — ranked (impact × low risk), to validate first

Each can be A/B-measured by the existing harness against clean `main` on UHD 620
(the harness already A/B's variants in a throwaway baseline), **before** any
adoption. None requires a renderer swap.

| # | Lever | Expected impact | Risk / cost | How to validate |
|---|---|---|---|---|
| 1 | **Render the overlay canvas at dpr ≤ 1.5** (cap the vector renderers' backing scale while keeping the basemap crisp) | **High** — overlay fill ∝ dpr²; dropping 2→1.5 is ~−44 % overlay pixels | slightly softer vector markers; medium effort (override the canvas renderer scale) | harness A/B: pan p95 with capped overlay dpr vs default |
| 2 | **Thin the dense POI layers during active pan** (hide `stay`+`bike` on `movestart`, restore on `moveend`) — ~1,244 of ~1,400 markers | **High** — removes the bulk of overlay redraw during the gesture | markers briefly absent while panning (interaction simplification) — a UX/product call | harness A/B: pan p95 with dense layers hidden vs shown |
| 3 | **`updateWhenIdle:true` + `updateWhenZooming:false`** on the raster tile layers | Medium — fewer mid-pan tile reflows | very low; a few Leaflet options | harness A/B before/after the option |
| 4 | **Serve non-retina (1×) basemap tiles on weak/dpr-2 devices** (drop `{r}`) | Medium — halves basemap tile pixels | basemap slightly softer on HiDPI | harness A/B with `{r}` removed |
| 5 | **Pre-simplify the admin lattice for display** (Douglas–Peucker at display zoom, or a simplified display geometry) — cut from 31,648 vertices | Medium — fewer vertices per redraw | data/build change; low visual risk for a context layer; keep analytical geometry intact | harness A/B with a simplified lattice |
| 6 | **Tune the Leaflet canvas `padding`** (and prune empty canvas panes) | Low–Medium | very low | harness sweep of `padding` |

**Method:** adopt only levers that the harness shows move UHD 620 pan p95 toward
33.3 ms, stacking the cheapest/lowest-risk first (3, 4, 6), then the higher-impact
UX-affecting ones (1, 2, 5) only as needed and with explicit product sign-off
(especially #2, which changes what is visible mid-pan). **Re-run the physical device
measurement** to confirm; automation is directional only.

## The separate P0-a overhead (~50 ms) — not a Leaflet lever

The detected P0-a-over-`main` pan overhead (`BASELINE_AND_PAN_INVESTIGATION.md` §4)
is **not** in the Leaflet render path and not in any DOM; it tracks the larger PR
`js/app.js` + the always-on membership computation retaining the 724-ámbito index.
If UHD 620 is a supported floor, the candidate there is to **reduce that retained
footprint** (e.g. build the ámbito spatial index lazily / release it when PLACE is
not active, or compute membership without holding the full index), investigated and
measured on its own — again, not a speculative edit inside PR #96. It is immaterial
to the UHD 620 gate (both arms already fail by ~4×) but could matter on a
near-threshold device, which the physical iPad/iPhone runs will show.

## Escalation to MapLibre — only if minimal tuning is insufficient

MapLibre is **not** asserted as the only solution. It is the **escalation** if the
stacked minimal Leaflet levers above cannot bring UHD 620 pan p95 under 33.3 ms at
dpr 2 — decided on measured evidence, under the K12 renderer authorization (its own
migration cost, `docs/RUNTIME_DECISION_SPIKE.md` §6.2), never inside PR #96.

## Recommendation

1. Get the §9 support-floor decision first — if UHD 620 is below the floor, no
   remediation is required for PR #96.
2. If it is a floor: authorize this assessment as a separate track; A/B levers 3/4/6
   then 1/2/5 on the harness + a physical re-measure; escalate to MapLibre only on
   evidence. Keep AC-P0-12 thresholds and the UHD 620 support status intact.
