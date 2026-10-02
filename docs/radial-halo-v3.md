# Radial Halo V3 — Quantitative Perimeter Bars

**Status:** implemented; fixed shared radial slots.
**Supersedes:** the V1/V2 presentation of the comparison halo. The analytical
gate contract in [`SPATIAL_COMPARISON_RADIAL_GATE_I.md`](SPATIAL_COMPARISON_RADIAL_GATE_I.md)
still governs *what* may be encoded; this document describes the V3 *rendering
and normalization* that make the Lens itself quantitative.
**Code:** `js/radial-halo.js` (pure model, unit-tested in
`tests/radial_halo.test.mjs`), rendered by `js/app.js`, styled in `css/app.css`,
browser-tested in `browser-tests/radial-halo.browser.mjs`.

## 1. Purpose

V1/V2 drew the data as tiny ticks: the dashed circle dominated and the actual
numbers lived only in the right-hand panel. V3 turns the circumference into a
compact quantitative display so that **a user looking only at the map** can read:

- which Lens has more tourism POIs,
- which Lens has more accommodation,
- which Lens has a stronger mobility presence,
- which Lens is hotter (UTCI),

and the **actual raw numbers** behind each, without opening the panel. The panel
remains authoritative for provenance, administrative context and interpretation.

## 2. The four perimeter metrics

The canonical metric IDs in `HALO_METRICS` map to stable clock positions. Slot
angles are keyed by metric ID, not registry iteration or DOM order, and never
reorder by value:

| Clock | Slot | Metric | Definition (exact) | Unit printed |
|------|------|--------|--------------------|--------------|
| 12 | north | **Tourism POIs** | Count of `museum` + `info` records inside the Lens circle (`poiStatsInLens.tourism`). | integer (`POIs`) |
| 2 | east | **Hotels & stays** | Count of `stay` records inside the circle, honouring the active accommodation-category filter (`poiStatsInLens.stay`). Madrid Destino catalogue listings, one per record. | integer (`stays`) |
| 6 | south | **Mobility nodes** | Count of `bike` (BiciMAD docking stations) + `rail` (Metro & Cercanías stations) inside the circle (`poiStatsInLens.mobility`). | integer (`nodes`) |
| 9 | west | **Mean UTCI** | Mean of the model-derived UTCI values of the HATI assets inside the circle at the selected timestep (`hatiStatsInLens`). Bounded research pilot: 14 outdoor assets, 21 Aug 2023. | `°C` (one decimal) |

**Pedestrian activity is deliberately NOT a perimeter bar.** It is observed
counter evidence (a rate, not a count), and remains a panel-only analytical
comparison (`js/radial-halo.js: activityState`). Category mix, administrative
statistics, hospitality context, hotel demand and domestic origins are excluded,
per Gate I.

## 3. Raw-value semantics

Every bar prints its own raw value beside it, always:

- counts are printed as grouped integers: `12`, `1,284`;
- UTCI is printed as `31.6°C` (one decimal);
- **unavailable** data prints `N/A` (never `0`);
- a layer that is **off** prints `OFF`;
- a **genuine zero** prints `0` with a small zero mark (no bar).

The caption beside each bar carries the lens letter and a short metric id
(`A·POI`, `B·STAY`, …) so the two lenses are labelled explicitly.

## 3.1 Fixed outward geometry

The radial geometry is defined in screen coordinates (`x` right, `y` down;
positive angle clockwise): tourism `−90°` (12 o'clock), stays `−30°` (2),
mobility `90°` (6), and UTCI `180°` (9). The same canonical metric angle is
used on both lenses. For projected Lens center `C`, its actual projected radius
`r`, slot angle `θ`, unit vector `u = (cos θ, sin θ)`, radial gap `g = 5 px`,
maximum bar length `M = 32 px`, and normalized magnitude `m`:

```
P0 = C + u × (r + g)           // bar origin just outside this Lens boundary
L  = M × clamp(m, 0, 1)       // only quantitative dimension
P1 = P0 + u × L               // bar endpoint grows directly outward
label = P1 + u × 7 px          // upright text, hemisphere-aligned
```

Bar thickness is a constant `2.6 px`. Lens A and B calculate `P0` from their
own currently projected radius; slot angle and data meaning remain shared.
Pan, zoom, resize, reposition and radius changes all recompute from Leaflet's
current projection. Labels remain upright and outside their bar tips.

## 4. Bar-length semantics (normalization)

> **BAR LENGTHS ARE COMPARABLE WITHIN THE SAME METRIC, NOT ACROSS DIFFERENT
> METRICS. THEY ARE NOT SCORES, RANKINGS, TARGETS OR PERCENTAGES.**

Two concepts are kept explicitly separate:

- **RAW VALUE** — what is physically inside the selected Lens. This is the number
  printed on the map, always the raw count (or the mean UTCI for the thermal bar).
- **BAR MAGNITUDE** — the spatial intensity used for visual comparison. For the
  three count metrics this is a **density** (records/km² or nodes/km²), so that a
  larger sampling window does not by itself buy a longer bar.

### 4.1 Count metrics — density bar (Tourism POIs, Hotels & stays, Mobility nodes)

```
density    = rawCount / circleAreaKm2(lensRadius)        // records/km² or nodes/km²
magnitude  = clamp(density / referenceDensity[metric], 0, 1)
barLength  = fullTrackPx * magnitude
```

`referenceDensity[metric]` is a **fixed, deterministic Madrid reference density**
computed from the loaded dataset (`computeHaloReferenceScales`):

1. take every feature of the metric (e.g. every stay record);
2. for each feature, compute its **local density** = (same-metric neighbours
   within the reference radius, default **900 m**) ÷ the area of that reference
   window;
3. the reference density is the **95th-percentile (p95)** of those per-feature
   local densities, floored at `1 / windowArea` so a bar never divides by zero.

Note the terminology precisely: step 2 divides a neighbour *count* by an *area*,
so the reference is a true **density**, not a raw neighbour count. On the
committed deploy dataset (p95, 900 m window ≈ 2.545 km²) the reference densities
are roughly **tourism ≈ 7.9 /km², stays ≈ 108.9 /km², mobility ≈ 19.7 /km²**.

Because the bar encodes density rather than a raw count, and the reference is
shared by both lenses, the encoding is:

- **radius-compatible** — the same raw count in a smaller Lens produces a longer
  bar (it is denser), and two Lenses whose counts scale with their areas produce
  equal bars. Unequal A/B radii therefore stay directly comparable, matching the
  panel's density treatment and never over-claiming.
- **within-metric** — each metric has its own reference density;
- **shared across A and B** — the same reference divides both lenses, so bars
  never normalize independently and a larger valid density never yields a shorter
  bar;
- **radius-independent in its scale** — the reference is computed at a fixed
  reference radius, not the live Lens radius, so the bar's *scale semantics* do
  not change when the geographic radius changes (the raw count and the density
  do, of course);
- **identical in every mode** — the same density rule drives single-lens,
  equal-radius Compare and unequal-radius Compare; the visual language never
  switches meaning by mode;
- **single-lens capable** — a bar needs only its own raw count, its radius and
  the reference, so it renders with or without Lens B;
- **deterministic** — alignment-free (windows centre on real features), fixed
  quantile, dependency-free nearest-rank quantile;
- **honest about missing data** — `null`/unavailable never enters as `0`.

### 4.2 UTCI — Celsius-band bar (never area-normalized)

UTCI is a bounded physical quantity, not a count, so its bar is **not**
area-normalized. It maps the mean UTCI to a robust Celsius band
(`deriveHaloUtciBand`): `min = p05`, `max = p95` of the HATI assets' model-derived
UTCI values (≈ **33.7–45.0 °C** on the committed pilot), with a documented
fallback band `{min: 26, max: 46}` when assets are missing.

```
magnitude = clamp((mean - band.min) / (band.max - band.min), 0, 1)
```

The UTCI bar length therefore depends only on temperature, never on the Lens
radius.

### 4.3 Saturation

A p95 reference means densities above the 95th percentile **saturate**: the bar
clamps to full length while the printed raw number keeps the real magnitude. The
glyph carries `data-saturated="true"` (a subtle glow on the fill) and the
accessible summary states which lens is "at or above reference", so a full bar is
never read as an exact density equality.

### 4.4 Rendering safety

Magnitudes are clamped to `[0, 1]`. A degenerate reference (`≤ 0` or missing) or
an invalid radius abstains to no bar rather than dividing; the raw number is still
printed.

### 4.5 Accommodation filter and the reference population

The raw stay count honours the active accommodation-category filter. To keep the
numerator and the reference describing the *same* metric, the stay reference
density is computed from the **same filtered population** (both the counts and
`computeHaloReferenceScales` run over `visiblePoiPoints()`), and is cached per
filter key. Filtering to "hotels only" therefore compares hotel density against a
hotel-density reference, not against an all-accommodation reference.

## 5. Compare-mode semantics

Both lenses render their four bars **simultaneously** whenever Compare is on:

- same metric → same reference **density** on both lenses, so lengths are directly
  comparable even at unequal radii (Lens A visibly longer than Lens B ⇒ Lens A is
  denser in that metric);
- both lenses print their own raw counts;
- switching the active lens changes emphasis/opacity and panel content but
  **never removes the other lens's bars**;
- A and B are distinguished by **hue and structure** — Lens A fill is solid
  warm-white, Lens B fill is dashed cyan — so colour is never the only cue;
- when the two lenses' bars would collide, or a bar would cross the analysis
  panel or the viewport edge, the ambiguous slot(s) are suppressed and the panel
  note explains why; the full comparison stays in the panel.

In single-lens mode (Compare off) the halo renders Lens A's four bars on the same
reference scale.

Focusing, hovering, or selecting a slot highlights that canonical metric on both
lenses and its matching comparison-table row. Keyboard users can tab to a metric,
activate it with Enter/Space, and clear focus with Escape. Other metrics remain
visible at reduced emphasis. The event `halo:metricfocus` exposes the metric ID,
source lens and selection state to another comparison consumer.

## 6. Unavailable vs zero

These are never conflated:

| State | When | Bar | Printed |
|-------|------|-----|---------|
| numeric | valid raw value `> 0` | data bar at its magnitude | the number |
| zero | valid raw value `== 0` | no bar, small zero mark | `0` |
| unavailable | source unavailable / no raw value | no bar, abstain mark | `N/A` |
| off | layer toggled off (UTCI) | no bar, abstain mark | `OFF` |
| no-evidence | enabled but no sample (UTCI) | no bar, abstain mark | `N/A` |

## 7. Projection, radius and responsiveness

- Bars are screen-space SVG attached to Leaflet markers on a dedicated pane; they
  follow the Lens through pan, zoom, resize, Lens move, radius change, active-lens
  switch and Compare interaction, always sitting a fixed 5 px beyond the
  **projected** circle edge.
- Each lens uses its own radius; unequal A/B radii remain correctly projected.
- A very small on-screen Lens drops to a compact layout (bars + numbers, captions
  omitted) and, below a threshold, hides the slots; the numeric value is never
  hidden merely to fit a tablet viewport. Verified on desktop, laptop and iPad
  landscape/portrait widths.

## 8. Known limitations

- The reference **densities** are derived from the **currently loaded dataset**
  (`data/runtime_poi.json` is a deploy-time artifact, not committed; a plain
  checkout serves the committed snapshot and layers it lacks — e.g. mobility —
  read `N/A`). If the underlying feed changes materially, the reference densities
  (and therefore bar *lengths*, not the printed raw counts) shift accordingly.
  This is intentional (the reference tracks the data) but means bar lengths are
  not comparable across dataset versions.
- Provenance and the raw-count-vs-density distinction are carried in the panel and
  the halo's accessible summary; each metric has an accessible name and keyboard
  focus. The summary states, per metric, the raw count and that the bar is
  represented density relative to the Madrid reference.
- Stays are Madrid Destino **catalogue listings** (one record per listing, city
  and surroundings), not an exhaustive accommodation census; the bar reflects
  represented records, not operating-stock density.
- UTCI is a **bounded research pilot** (14 assets, one day); its bar and band are
  model-derived, not measured comfort, and carry the MODEL evidence marker.
- Mobility counts BiciMAD docks + rail/metro stations (node presence), not trips
  or ridership. The halo mobility bar shows node **density**; this is a separate
  concept from the right-hand panel's analytical mobility B−A delta, which remains
  **withheld under unequal radii** by its own contract. Halo intensity and panel
  delta are deliberately distinct.
- The halo is a locator and magnitude cue. **Exact values, provenance and
  caveats remain panel-authoritative.** No bar is a score, ranking, percentage or
  Madrid benchmark.
