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

A POI count is a count, not a quality or pressure indicator. A UTCI mean is
the mean of the HATI samples that happen to fall inside a lens on 21 August
2023 at a chosen hour — not a forecast, not a live reading, and not a
verdict on whether a place is "safe" or "recommended" to visit.

## Evidence states shown in the UI

- **MODEL-DERIVED** — one or more HATI samples fall inside the active lens;
  the app reports their count and mean, both explicitly labelled as
  model-derived.
- **NO EVIDENCE** — no HATI sample falls inside the lens. The app never
  substitutes an interpolated, estimated, or default value in this case.
- **live / repository snapshot** — shown per POI layer, indicating whether
  the current session's data for that layer came from a live public API or
  from a static fallback snapshot committed in this repository.

## Relationship to HATI-Madrid

This project reads a small, explicitly cited slice of HATI-Madrid's locked
evidence (see [DATA_PROVENANCE.md](DATA_PROVENANCE.md)). It does not modify,
extend, reinterpret, or re-run any part of the HATI pipeline, and it does not
carry forward any of HATI's feasibility/recommendation labels (e.g. "FEASIBLE
WITH CONDITIONS") — only the raw UTCI values and the official Bröde et al.
stress category they fall into.
