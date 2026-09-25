# Claims and limitations

## What this application does

- Lets you move one or two spatial lenses across central Madrid and see
  **descriptive counts** of tourism POIs, accommodation, and mobility nodes
  inside each lens.
- Shows **HATI-Madrid's bounded, model-derived UTCI evidence** at 14 outdoor
  sample points, for a single historical pilot day (21 August 2023), at three
  modelled times of day.
- Compares two lenses' descriptive statistics side by side.

## What this application does NOT claim or establish

This is a deliberate ceiling, not an oversight. The application does **not**
establish, measure, or infer:

- Tourist pressure or overtourism
- Destination carrying capacity
- Tourist behaviour or preferences
- Safety outcomes of any kind
- Tourism "quality," attractiveness, or competitiveness
- Economic impact
- Causal effects of heat on tourism, health, or behaviour
- Real-time or current thermal conditions
- City-wide HATI coverage — the evidence layer is 14 points in one small
  study area, not a Madrid-wide heat map
- An exhaustive inventory of any POI category — when a layer is running on
  its SNAPSHOT SAMPLE fallback, its count reflects only the records curated
  into that sample, not the true total number of museums, hotels, or tourist
  info points at that location

A POI count is a count, not a quality or pressure indicator. A UTCI mean is
the mean of the HATI samples that happen to fall inside a lens on 21 August
2023 at a chosen hour — not a forecast, not a live reading, and not a
verdict on whether a place is "safe" or "recommended" to visit. Likewise, a
metric such as "Hotels & stays: 6" must never be read as "exactly six
accommodations exist here" if that layer is on its snapshot fallback; it
means six sample records happen to fall inside the lens.

## Evidence states shown in the UI

- **MODEL-DERIVED** — one or more HATI samples fall inside the active lens;
  the app reports their count and mean, both explicitly labelled as
  model-derived.
- **NO EVIDENCE** — no HATI sample falls inside the lens. The app never
  substitutes an interpolated, estimated, or default value in this case.
- **live** — the layer's current data came from a successful runtime fetch
  of its public API this session. It describes how the data was obtained,
  not how frequently the underlying source itself updates.
- **SNAPSHOT SAMPLE** — the live fetch failed (or was not attempted) and the
  layer is running on a small, manually curated fallback dataset committed
  in this repository. Its count is a sample count, not a complete inventory.
- **UNAVAILABLE** — neither a live fetch nor a verified fallback exists for
  this layer right now (currently: BiciMAD). The UI shows "No data" rather
  than a numeric zero, since a zero would be indistinguishable from a
  genuinely empty area.

## Relationship to HATI-Madrid

This project reads a small, explicitly cited slice of HATI-Madrid's locked
evidence (see [DATA_PROVENANCE.md](DATA_PROVENANCE.md)). It does not modify,
extend, reinterpret, or re-run any part of the HATI pipeline, and it does not
carry forward any of HATI's feasibility/recommendation labels (e.g. "FEASIBLE
WITH CONDITIONS") — only the raw UTCI values and the official Bröde et al.
stress category they fall into.
