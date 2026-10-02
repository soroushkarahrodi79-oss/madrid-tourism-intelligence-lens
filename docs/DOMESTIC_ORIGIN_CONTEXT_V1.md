# Domestic Origin Context v1

This is a compact extension of Destination Context, not a Lens metric or a new dashboard. It reports **published origin municipalities for residents travelling to Madrid municipality (28079) from another Spanish province** in a selected source month. Same-province travel, including travel within Madrid province, is outside the source universe.

The committed runtime artifact is `data/destination/madrid_domestic_origins.json`; its sidecar retains provenance and interpretation limits. Refresh it with:

```text
python scripts/build_domestic_origin_context.py --year 2026
```

The builder retrieves the originating INE annual workbook directly, discovers available `YYYY-MM` worksheets, verifies every sheet year against the declared workbook year, verifies the workbook notes' source-universe and suppression statements, requires the exact ten-column source schema, selects destination code `28079`, corroborates Madrid destination/province labels, and writes only Madrid-destination rows. Review the artifact and sidecar together before committing; the workbook itself is not committed.

INE publishes only origin-destination crossings with **more than 30 tourists**; the builder rejects a Madrid row at or below that threshold. An origin may be absent because it is outside the source universe (including same-province travel), or, within the covered universe, because a small crossing is suppressed. The visible rows are not a complete distribution of domestic tourism, have no residual “other origins” category, and must not be used to calculate all-origin shares. Counts are source-reported `turistas`, not unique people, forecasts, attractiveness scores, or local visitor measures. No barrio, district, coordinate, Lens-circle, or international-origin data is present.

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
