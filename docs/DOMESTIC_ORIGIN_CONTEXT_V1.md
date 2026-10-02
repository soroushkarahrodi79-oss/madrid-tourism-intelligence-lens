# Domestic Origin Context v1

This is a compact extension of Destination Context, not a Lens metric or a new dashboard. It reports which **published Spanish origin municipalities** INE records among resident tourists travelling to **Madrid municipality (28079)** in a selected source month.

The committed runtime artifact is `data/destination/madrid_domestic_origins.json`; its sidecar retains provenance and interpretation limits. Refresh it with:

```text
python scripts/build_domestic_origin_context.py --year 2026
```

The builder retrieves the originating INE annual workbook directly, discovers available `YYYY-MM` worksheets, verifies the workbook notes' suppression statement, requires the exact ten-column source schema, selects destination code `28079`, corroborates Madrid destination/province labels, and writes only Madrid-destination rows. Review the artifact and sidecar together before committing; the workbook itself is not committed.

INE publishes only origin-destination crossings with **more than 30 tourists**. An origin absent from a selected month is not zero and may be suppressed. The visible rows are not a complete distribution of domestic tourism, have no residual “other origins” category, and must not be used to calculate all-origin shares. Counts are source-reported `turistas`, not unique people, forecasts, attractiveness scores, or local visitor measures. No barrio, district, coordinate, Lens-circle, or international-origin data is present.
