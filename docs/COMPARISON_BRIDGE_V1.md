# Comparison Bridge V1

**Status:** implemented.
**Depends on:** [`radial-halo-v3.md`](radial-halo-v3.md) (the four canonical
metrics, their fixed radial slots, and the per-side evidence states) and the
analytical comparison contract in
[`SPATIAL_COMPARISON_RADIAL_GATE_I.md`](SPATIAL_COMPARISON_RADIAL_GATE_I.md) and
[`INDEPENDENT_RADIUS_COMPARISON_GATE_J.md`](INDEPENDENT_RADIUS_COMPARISON_GATE_J.md).
**Code:** pure model `buildComparisonBridgeModel(...)` in `js/radial-halo.js`
(unit-tested in `tests/comparison_bridge.test.mjs`), rendered by
`renderComparisonBridge()` in `js/app.js`, styled in `css/app.css`
(`.comparison-bridge`), browser-tested in
`browser-tests/radial-halo.browser.mjs`.

## 1. What it is

The Comparison Bridge is the **focused reading of one metric** inside the
Lens A ↔ Lens B panel. Radial Halo V3 makes each lens quantitative on the map,
and the panel table is the full compact inventory; the Bridge sits between them
so that, for one chosen metric, a user can answer in a few seconds:

1. which metric is being compared,
2. what Lens A contains and what Lens B contains,
3. whether a direct comparison is valid,
4. the observed **B − A** difference when it is, or exactly **why it is
   withheld** when it is not,
5. the two lens radii, and
6. the evidence limitation that applies.

It does this without the user having to read two halo bars, hunt for the
matching table row, and mentally reconcile unequal windows. The Bridge is a
compact analytical instrument, not a KPI card: no gauges, trophies, arrows,
score badges or traffic-light colours.

## 2. One authoritative interpretation

The Bridge never scrapes rendered table text and never re-implements the
comparison arithmetic. `buildComparisonBridgeModel({ metricId, state, radiusMode,
radii })` reads the **same authoritative state object** the table renders:

- `tourism`, `stays`, `utci` → the metric states from `buildHaloComparison(...)`,
- `mobility` → the panel pair-state from `buildCountPairState(...)` (which
  withholds the delta under unequal windows — see §5).

So the difference it shows **is** `state.delta`, its comparability **is**
`state.comparable`, and its withheld reason is derived from the state's own
`id`/`qualifier`. Halo, Bridge and table therefore cannot develop three
different interpretations of one metric; a browser regression asserts all three
agree simultaneously.

The model is deliberately free of display language: it returns neutral codes
(per-side evidence, a numeric delta, a delta kind, a basis code, a withheld
reason code) and the view layer localizes them.

## 3. Canonical metrics; Pedestrian stays panel-only

The Bridge is synchronized with exactly the four canonical halo metrics:
`tourism`, `stays`, `mobility`, `utci`. **Pedestrian activity remains panel
only** — it is observed-activity evidence, not a POI count, has no radial slot,
and has no Bridge focus control, so it can never target a nonexistent halo mark.
Its comparison row stays fully functional in the table.

## 4. Temporary focus vs locked selection

The Bridge reuses the existing halo focus machinery (`focusedHaloMetric`,
`selectedHaloMetric`, `setHaloMetricFocus(...)`), so there is no competing
selection system:

- **Hover / keyboard focus** (on a halo mark or a panel metric control) is a
  *temporary preview*: the Bridge shows that metric, both of its A/B halo marks
  are emphasized and unrelated metrics are de-emphasized but still visible.
- **Click / Enter / Space** *locks* the metric. A locked metric keeps its A/B
  halo emphasis, its highlighted table row and its Bridge reading even as values
  refresh from normal interactions (radius change, lens move, pan, zoom, active
  lens switch, data refresh). `renderCompare()` never resets the selection.
- Hovering a different metric while one is locked **previews** the hovered metric
  and returns to the locked one when hover/focus leaves.
- Clicking the locked metric again **toggles it off** (it stays previewed until
  focus leaves). **Escape** clears the lock and returns the Bridge to its neutral
  prompt.

With nothing focused, the Bridge shows a neutral prompt ("Focus a halo metric to
compare Lens A and Lens B") and never invents a comparison or auto-selects a
metric.

## 5. B − A semantics by metric

The Bridge respects the comparison contracts already in force; it does not add a
generic subtraction rule. A positive **B − A is arithmetic direction only** — it
never means Lens B is "better".

- **Tourism / Stays.** Equal radii: the authorized direct comparison of raw
  represented counts (`Observed B−A` as a count). Unequal radii, when the Madrid
  AOI condition is met: the authorized **represented-record density** comparison
  (`records/km²`), with each lens's raw count *and* density shown so unequal
  windows are never read as directly equivalent. Unequal radii when the AOI
  condition fails: the delta is **withheld** with the reason (circle crosses /
  outside the Madrid AOI, AOI unavailable, or source states incompatible).
- **Mobility.** Equal radii: raw-count difference. Unequal radii: **withheld ·
  different window sizes** — mobility is never silently converted to a density.
- **UTCI.** A Celsius difference only when the layer is on, both lenses have a
  model-derived sample and the timesteps match; otherwise withheld. UTCI keeps
  its model-derived evidence qualification.

## 6. Zero / N/A / OFF

The Bridge mirrors the same evidence state as the halo and the table:

- a genuine observed **zero** is shown as `0` and still participates in a delta;
- **N/A** (unavailable / no evidence) is shown as `N/A`;
- **OFF** (layer disabled) is shown as `OFF`.

A delta is never computed from an N/A or OFF side, and N/A/OFF are never
converted into zero.

## 7. Radii and evidence

Both lens radii are always shown in the focused Bridge, so a comparison across
unequal windows can never be misread. The Bridge carries only a short qualifier
(e.g. *Comparable · represented-record density*, *Withheld · different window
sizes*); the existing evidence/provenance area remains authoritative for the
full source detail.

## 8. Localization

All Bridge strings are dictionary-backed through the shared `createI18n`
mechanism (`BRIDGE_DICTIONARIES`, EN + ES). The Bridge follows the **document
language** so it stays coherent with the English comparison panel it lives in;
the Spanish dictionary exists and is exercised by the unit tests, ready if the
document language changes.

## 9. Non-goals

No new scoring system, index, ranking, recommendation or causal claim; no
winner/loser, better/worse or green/red judgement; no new halo slot (Pedestrian
is not promoted); no card on the map and no connector line between the two
circles ("Bridge" is the comparison interface, not a geographic path).
