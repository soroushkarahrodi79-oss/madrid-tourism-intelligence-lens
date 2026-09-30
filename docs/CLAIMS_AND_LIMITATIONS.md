# Claims and limitations

## What this application does

- Lets you move one or two spatial lenses across central Madrid and see
  **descriptive counts** of tourism POIs, accommodation, and mobility nodes
  inside each lens.
- Shows **HATI-Madrid's bounded, model-derived UTCI evidence** at 14 outdoor
  sample points, for a single historical pilot day (21 August 2023), at three
  modelled times of day.
- Compares two lenses' descriptive statistics side by side.
- Names the **official barrio and district** containing the active lens's
  centre, and reports that barrio's **registered residents** from the municipal
  Padrón, with its reference date (1 January 2026).

## What this application does NOT claim or establish

This is a deliberate ceiling, not an oversight. The application does **not**
establish, measure, or infer:

- Tourist pressure or overtourism
- Destination carrying capacity
- Tourist behaviour or preferences
- Tourist-specific footfall or visitor flow from the pedestrian counters
- Safety outcomes of any kind
- Tourism "quality," attractiveness, or competitiveness
- Economic impact
- Causal effects of heat on tourism, health, or behaviour
- Real-time or current thermal conditions
- City-wide HATI coverage — the evidence layer is 14 points in one small
  study area, not a Madrid-wide heat map. The dashed study-area rectangle in
  the UI shows the original pilot boundary only; it does not imply continuous
  thermal evidence inside that rectangle
- An exhaustive inventory of any POI category — when a layer is running on
  its SNAPSHOT SAMPLE fallback, its count reflects only the records curated
  into that sample, not the true total number of museums, hotels, or tourist
  info points at that location
- A continuous pedestrian-flow surface between permanent counters
- Current/live pedestrian conditions — the activity layer is a historical
  deployment snapshot of the latest published permanent-counter distribution
- Complete green-space coverage — the optional Principal parks layer reflects
  the municipality's published list of principal/significant parks and gardens,
  not every green space in Madrid
- Any inference that a mapped park is cooler, shadier, healthier, more
  biodiverse, more accessible, higher quality, or more attractive to tourists
- The number of people inside a lens circle — the Area Profile's resident
  figure describes the **whole official barrio** containing the lens centre,
  never the part of it the circle happens to cover, and is never scaled,
  weighted or interpolated into the circle
- Any accommodation-per-resident, hotels-per-1,000-residents, tourism-density
  or tourism-pressure figure — the application holds both an accommodation
  layer and a resident denominator, and deliberately computes no ratio between
  them. A Gate A audit examined adding exactly this and ruled NO-GO: the
  accommodation layer is a tourism-promotion catalogue, not an administrative
  register, and cannot carry a per-resident ratio
  ([ACCOMMODATION_NUMERATOR_AUDIT.md](ACCOMMODATION_NUMERATOR_AUDIT.md)).
  A follow-up Gate B qualified an authoritative **numerator** — granted
  municipal VUT activity licences — and built it as a standalone artifact, but
  **still publishes no ratio**: nothing in the application reads that artifact,
  and the numerator's source state and the Padrón's 1 January 2026 reference
  date are different periods
  ([ACCOMMODATION_NUMERATOR_GATE_B.md](ACCOMMODATION_NUMERATOR_GATE_B.md))
- Daytime, present, working or visiting population — registered residents are
  persons on the municipal register at the reference date, not people at a
  place at a moment

Observed pedestrian counts describe people passing fixed municipal counters.
They do not identify tourists, trip purpose or destination demand. A lens with
no counter returns **no sensor evidence** rather than an interpolated estimate.
Lens A/B pedestrian differences compare only the published observations at
counters that fall inside each lens.

A mobility-node count is descriptive infrastructure presence, not service
frequency, capacity, accessibility, travel time, or connectivity quality.
Metro and Cercanías station records may represent different modes at the same
interchange and are not deduplicated into a single multimodal hub.

Accommodation type filters are descriptive source classifications. They do
not imply quality, price, legal status, availability, occupancy, or suitability.
Records without source type metadata remain unclassified rather than being
guessed from their names.

A POI count is a count, not a quality or pressure indicator. A UTCI mean is
the mean of the HATI samples that happen to fall inside a lens on 21 August
2023 at a chosen hour — not a forecast, not a live reading, and not a
verdict on whether a place is "safe" or "recommended" to visit. Likewise, a
metric such as "Hotels & stays: 6" must never be read as "exactly six
accommodations exist here" if that layer is on its snapshot fallback; it
means six sample records happen to fall inside the lens.

A barrio's registered-resident count and a lens's circle measurements have
**different geometries** and are presented as separate sections for that reason.
When two lenses fall in the same barrio they point at **one** administrative
statistic, and the interface says so rather than repeating the figure. When no
official area contains the centre, or no population record exists for an area,
the interface abstains explicitly — it never shows `0`.

Datasets keep their own periods and are never implied to be synchronised:
administrative geography carries no effective date (only a published dataset
version), registered residents are dated 1 January 2026, the HATI pilot is
21 August 2023, and the pedestrian counters are a 2024 published period. The
application has no global time control, because there is nothing to align.

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
- **UNAVAILABLE** — neither a live fetch nor a verified packaged source exists
  for a layer right now. The UI shows "No data" rather
  than a numeric zero, since a zero would be indistinguishable from a
  genuinely empty area.

## Relationship to HATI-Madrid

This project reads a small, explicitly cited slice of HATI-Madrid's locked
evidence (see [DATA_PROVENANCE.md](DATA_PROVENANCE.md)). It does not modify,
extend, reinterpret, or re-run any part of the HATI pipeline, and it does not
carry forward any of HATI's feasibility/recommendation labels (e.g. "FEASIBLE
WITH CONDITIONS") — only the raw UTCI values and the official Bröde et al.
stress category they fall into.
