# Radial Halo V3 — Quantitative Perimeter Bars

**Status:** implemented.
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

Fixed clockwise angular layout (never reordered by magnitude):

| Clock | Slot | Metric | Definition (exact) | Unit printed |
|------|------|--------|--------------------|--------------|
| 12 | north | **Tourism POIs** | Count of `museum` + `info` records inside the Lens circle (`poiStatsInLens.tourism`). | integer (`POIs`) |
| 3 | east | **Hotels & stays** | Count of `stay` records inside the circle, honouring the active accommodation-category filter (`poiStatsInLens.stay`). Madrid Destino catalogue listings, one per record. | integer (`stays`) |
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

## 4. Bar-length semantics (normalization)

> **BAR LENGTHS ARE COMPARABLE WITHIN THE SAME METRIC, NOT ACROSS DIFFERENT
> METRICS.**

The four metrics have different units, so their raw values are never mapped onto
one common physical scale. Instead each bar length is a **within-metric
magnitude**:

```
magnitude = clamp(rawValue / reference[metric], 0, 1)
barLength  = fullTrackPx * magnitude
```

### 4.1 Count reference (Tourism POIs, Hotels & stays, Mobility nodes)

`reference[metric]` is the **p95 of per-feature local density** for that metric
over a fixed reference window, computed once from the loaded dataset
(`computeHaloReferenceScales`):

1. take every feature of the metric (e.g. every stay record);
2. for each feature, count how many same-metric features lie within the
   reference radius (default **900 m**);
3. the reference is the **95th-percentile** of those neighbour counts, floored
   at 1 (so a bar never divides by zero).

Interpretation: a bar is "this lens's count as a share of a busy Madrid
neighbourhood (p95 local density, 900 m) for this metric." On the committed
dataset this yields references of roughly **tourism ≈ 20, stays ≈ 277,
mobility ≈ 50**.

This method is:

- **within-metric** — each metric has its own reference;
- **shared across A and B** — the same reference divides both lenses, so a larger
  valid raw value never yields a shorter bar than a smaller one;
- **radius-independent** — the reference is computed at a fixed reference radius,
  not the live Lens radius, so bar *scale semantics* do not change when the
  geographic radius changes (the raw value may, of course);
- **single-lens capable** — a bar needs only its own raw value and the reference,
  so it renders with or without Lens B;
- **deterministic** — alignment-free (windows centre on real features), fixed
  quantile, dependency-free nearest-rank quantile;
- **honest about missing data** — `null`/unavailable never enters as `0`.

### 4.2 UTCI reference

UTCI is a bounded physical quantity, so its bar maps a robust Celsius band to
`0..1` (`deriveHaloUtciBand`): `min = p05`, `max = p95` of the HATI assets'
model-derived UTCI values (≈ **33.7–45.0 °C** on the committed pilot), with a
documented fallback band `{min: 26, max: 46}` when assets are missing.

```
magnitude = clamp((mean - band.min) / (band.max - band.min), 0, 1)
```

### 4.3 Rendering safety

Magnitudes are clamped to `[0, 1]`; a raw value above the reference saturates to
a full bar (the raw number is still printed). A degenerate reference (`≤ 0` or
missing) abstains to no bar rather than dividing.

## 5. Compare-mode semantics

Both lenses render their four bars **simultaneously** whenever Compare is on:

- same metric → same reference on both lenses, so lengths are directly
  comparable (Lens A visibly longer than Lens B ⇒ Lens A has more);
- both lenses print their own raw numbers;
- switching the active lens changes emphasis/opacity and panel content but
  **never removes the other lens's bars**;
- A and B are distinguished by **hue and structure** — Lens A fill is solid
  warm-white, Lens B fill is dashed cyan — so colour is never the only cue;
- when the two lenses' bars would collide, or a bar would cross the analysis
  panel or the viewport edge, the ambiguous slot(s) are suppressed and the panel
  note explains why; the full comparison stays in the panel.

In single-lens mode (Compare off) the halo renders Lens A's four bars on the same
reference scale.

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

- Bars are screen-space SVG attached to Leaflet markers on a dedicated
  pointer-transparent pane; they follow the Lens through pan, zoom, resize, Lens
  move, radius change, active-lens switch and Compare interaction, always sitting
  a fixed 5 px beyond the **projected** circle edge.
- Each lens uses its own radius; unequal A/B radii remain correctly projected.
- A very small on-screen Lens drops to a compact layout (bars + numbers, captions
  omitted) and, below a threshold, hides the slots; the numeric value is never
  hidden merely to fit a tablet viewport. Verified on desktop, laptop and iPad
  landscape/portrait widths.

## 8. Known limitations

- The count references are derived from the **currently loaded dataset**; if the
  underlying POI feed changes materially, the references (and therefore bar
  *lengths*, not the printed raw values) shift accordingly. This is intentional
  (the reference tracks the data) but means bar lengths are not comparable across
  dataset versions.
- Stays are Madrid Destino **catalogue listings** (one record per listing, city
  and surroundings), not an exhaustive accommodation census; the bar reflects
  represented records, not operating-stock density.
- UTCI is a **bounded research pilot** (14 assets, one day); its bar and band are
  model-derived, not measured comfort, and carry the MODEL evidence marker.
- Mobility counts BiciMAD docks + rail/metro stations (node presence), not trips
  or ridership.
- The halo is a locator and magnitude cue. **Exact values, provenance and
  caveats remain panel-authoritative.** No bar is a score, ranking, percentage or
  Madrid benchmark.
