# Domestic Origin Context v1

This is a compact extension of Destination Context, not a Lens metric or a new dashboard. It reports **published origin municipalities for residents travelling to Madrid municipality (28079) from another Spanish province** in a selected source month. Same-province travel, including travel within Madrid province, is outside the source universe.

The committed runtime artifact is `data/destination/madrid_domestic_origins.json`; its sidecar retains provenance and interpretation limits. Refresh it with:

```text
python scripts/build_domestic_origin_context.py --year 2026
```

The builder retrieves the originating INE annual workbook directly, discovers available `YYYY-MM` worksheets, verifies every sheet year against the declared workbook year, verifies the workbook notes' source-universe and suppression statements, requires the exact ten-column source schema, selects destination code `28079`, corroborates Madrid destination/province labels, and writes only Madrid-destination rows. Review the artifact and sidecar together before committing; the workbook itself is not committed.

INE publishes only origin-destination crossings with **more than 30 tourists**; the builder rejects a Madrid row at or below that threshold. An origin may be absent because it is outside the source universe (including same-province travel), or, within the covered universe, because a small crossing is suppressed. The visible rows are not a complete distribution of domestic tourism, have no residual “other origins” category, and must not be used to calculate all-origin shares. Counts are source-reported `turistas`, not unique people, forecasts, attractiveness scores, or local visitor measures. No barrio, district, coordinate, Lens-circle, or international-origin data is present in this artifact (the map described at the end of this document joins separately sourced municipality reference points at runtime).

## Domestic Origin Dynamics v1

The Domestic Origins section also derives a month-to-month comparison at runtime
from the same committed artifact. It compares a selected **current source
month** only with its exact prior calendar month when that month is actually in
the validated artifact. It never substitutes the nearest older published month:
for example, July cannot be compared with May when June is unavailable. January
may compare with the prior December only when that month is present in the
available artifact history.

The comparison describes the **published-origin set**, not a complete domestic
tourism distribution. It classifies municipality rows as published in both
months, newly present in the published set, or no longer present in the
published set. Appearance or disappearance does not mean tourism began or
ended: only crossings with more than 30 tourists are published, so a municipality
can enter or leave the published set by crossing the publication threshold.

An observed count change (and its percentage) is calculated only for an origin
published in both months. For a newly present row the prior count is unavailable,
and for a no-longer-present row the current count is unavailable; neither is
materialised as zero and neither receives a percentage change. The feature is a
descriptive transformation of official observations, not a new external source,
causal finding, prediction, all-origin share, province aggregation, map layer
or international-origin series. Same-province travel remains outside the source
universe.

## Top published origins chart v1

A horizontal bar chart above the full table shows the ten highest published
origin-municipality counts of the selected source month, taken from the same
validated, sorted model as the table (`buildDomesticOriginRanking`). Each bar is
labelled with the municipality name, its code and the exact source-reported
count; length is count divided by the largest bar shown, on a zero baseline, so
it is linear and never truncated. A month with fewer than ten published origins
shows only those. The chart states that it is not the full origin universe and
that unpublished origins are not zero. No total, share, percentage, "Other"
category, map point or flow line is derived by the chart, and the chart follows the existing
source-month control, including a month restored from a K11 link. It does not
change the K11 export, the URL fields or the stored artifact.

## Top published origins map v1

A Leaflet map below the bar chart places the ten highest published origin
municipalities of the selected source month, or the twenty-five highest through a
local "Origins shown" selector. It takes the same validated, sorted model as the
chart and table: `buildDomesticOriginMapModel` (`js/domestic-origin-map.js`)
receives the output of `buildDomesticOriginContext`. The INE artifact and
`domestic-origin-context.js` still carry and accept no coordinate; positions come
from a separate artifact joined at runtime by the five-digit INE municipality
code.

**Position source.** `data/geography/spain_municipality_points.json` and its
sidecar hold 8,132 municipality reference points from the IGN *Nomenclátor
Geográfico de Municipios y Entidades de Población* (CNIG), edition 2026-03, table
`MUNICIPIOS.csv`. Coordinates are ETRS89 (REGCAN95 in the Canary Islands), both
WGS84-compatible and used as WGS84 for display. The licence is the Orden
FOM/2807/2015 licence of use (compatible with CC BY 4.0; authorship must be
acknowledged), credited in the map's attribution line. The IGN defines the point
as placed as centrally as possible inside the municipality's **main population
nucleus**. It is **not** the centroid of the municipal territory, and the map text
says so. The builder never downloads: the CNIG download form is bot-protected, so
the archive is fetched by a person and passed in:

```text
python scripts/build_municipality_reference_points.py --zip BD_Municipios-Entidades.zip
```

Review both outputs and run the deployment validator. It is a blocking source
(`municipality_reference_points`): it rejects swapped axes, points outside the
declared envelope, a wrong coordinate order, drifted licence or edition, a count
below the floor, a missing Madrid point, and any published origin, in any month,
that has no point.

**Encoding.** One circle per placed origin at its reference point. Circle **area**
is proportional to the source-reported count, relative to the largest circle shown
and from a zero baseline (maximum radius 24 px, `sqrt(count / largest)`); a fixed
colour is used and there is no classification. Madrid municipality is marked once,
as a small distinct destination marker. The map derives and draws **no** flow,
route, line, total, share, percentage, "Other" bucket, province aggregate, density
or heat surface, and unpublished origins are not zero.

**Coverage.** All 2,817 distinct origin codes across the seven committed months
resolve to a point (100 % of rows and of source-reported tourists in every month,
Top 10 and Top 25 included). If an origin ever has no point it is listed in text
as "not placed on the map" and is never dropped silently or drawn at 0,0.

**Behaviour and limits.**

- The map follows the existing source-month control and the document language. The
  Top 10 / Top 25 choice is local view state; it is not part of the K11 URL or
  export.
- Tooltips give rank, name, code and the exact count. The ranked chart and the
  full table on the page carry the same values and are the keyboard- and screen-reader-accessible
  equivalent: circles are mouse/touch tooltips and are not keyboard-focusable.
- If the map module or the points file fails to load, the map stays hidden and the
  chart, table and dynamics are unaffected.
- Scroll-wheel zoom is off so the map never captures page scrolling.

**Governance.** No PASS / HOLD / NO-GO gate is changed. The earlier sentences that
no map point is derived describe the bar chart and the Dynamics comparison, which
remain true of them; this map was added at the product owner's request as a
separate, independently sourced layer. Not yet confirmed: the exact credit formula
the CNIG download page prescribes (its selector is rendered dynamically and was not
captured). The map credits "Instituto Geográfico Nacional (IGN-CNIG), NGMEP 2026-03";
confirm the prescribed wording before any public release.
