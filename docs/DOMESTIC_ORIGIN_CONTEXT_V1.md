# Domestic Origin Context v1

This is a compact extension of Destination Context, not a Lens metric or a new dashboard. It reports **published origin municipalities for residents travelling to Madrid municipality (28079) from another Spanish province** in a selected source month. Same-province travel, including travel within Madrid province, is outside the source universe.

The committed runtime artifact is `data/destination/madrid_domestic_origins.json`; its sidecar retains provenance and interpretation limits. Refresh it with:

```text
python scripts/build_domestic_origin_context.py --year 2026
```

The builder retrieves the originating INE annual workbook directly, discovers available `YYYY-MM` worksheets, verifies every sheet year against the declared workbook year, verifies the workbook notes' source-universe and suppression statements, requires the exact ten-column source schema, selects destination code `28079`, corroborates Madrid destination/province labels, and writes only Madrid-destination rows. Review the artifact and sidecar together before committing; the workbook itself is not committed.

INE publishes only origin-destination crossings with **more than 30 tourists**; the builder rejects a Madrid row at or below that threshold. An origin may be absent because it is outside the source universe (including same-province travel), or, within the covered universe, because a small crossing is suppressed. The visible rows are not a complete distribution of domestic tourism, have no residual “other origins” category, and must not be used to calculate all-origin shares. Counts are source-reported `turistas`, not unique people, forecasts, attractiveness scores, or local visitor measures. No barrio, district, coordinate, Lens-circle, or international-origin data is present.
