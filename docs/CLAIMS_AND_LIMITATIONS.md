# Claims and limitations

## What this application does

- Lets you move one or two spatial lenses across central Madrid and see
  **descriptive counts** of tourism POIs, accommodation, and mobility nodes
  inside each lens.
- Shows **HATI-Madrid's bounded, model-derived UTCI evidence** at 14 outdoor
  sample points, for a single historical pilot day (21 August 2023), at three
  modelled times of day.
- Compares two lenses' descriptive statistics side by side.
- In equal-radius Compare mode, shows an optional supplementary halo for
  Tourism POIs, represented stays, observed pedestrian activity and same-time
  HATI UTCI. Lens A, Lens B and B−A values remain in the panel; Mobility is
  panel-only.
- Keeps Lens A and Lens B radii independent with one active-Lens slider. First
  enable of B copies A's radius; later re-enables preserve B. Equal-radius
  Tourism POI/stay comparisons use raw represented counts. Unequal-radius
  comparisons retain raw counts and use represented records/km² only when both
  complete circles fit inside Madrid's canonical municipality polygon and
  evidence states are compatible. Mobility deltas are withheld for unequal
  radii; pedestrian and UTCI remain in native units.
- Names the **official barrio and district** containing the active lens's
  centre, and reports that barrio's **registered residents** from the municipal
  Padrón, with its reference date (1 January 2026).
- Reports, for that same **whole official barrio**, the **licensed
  tourist-dwelling (VUT) units** and the **granted VUT activity licences** the
  Ayuntamiento's Agencia de Actividades documents there, with a descriptive
  **licensed VUT units per 1,000 registered residents** figure and both raw
  counts always shown beside it.
- Reports, for the **whole municipality of Madrid** and separately from anything
  about the Lens, the **hotel travellers** and **overnight stays** the official
  INE hotel occupancy survey published for the latest available month, their
  **residence composition**, a **same-month-previous-year** comparison, and a
  24-month trend.

## What this application does NOT claim or establish

This is a deliberate ceiling, not an oversight. The application does **not**
establish, measure, or infer:

- Tourist pressure or overtourism
- Destination carrying capacity
- Tourist behaviour or preferences
- Tourist-specific footfall or visitor flow from the pedestrian counters
- Safety outcomes of any kind
- Tourism "quality," attractiveness, or competitiveness
- A winner, ranking, composite score, or Madrid benchmark from the halo. Its
  count-bar scale is normalized only to the largest valid value in the current
  A/B comparison and resets for another pair. It is not a percentage or target.
- A zero value from absent or incompatible evidence. The halo distinguishes
  OFF, UNAVAILABLE, NO EVIDENCE and a valid observed zero; Pedestrian and HATI
  comparisons abstain unless both Lenses have compatible evidence.
- A complete POI or accommodation inventory from a represented-record rate.
  Unequal-radius rates are normalized to the full geometric circle area only
  inside the canonical Madrid municipality AOI; they are not population
  denominators, census coverage, accommodation density, or supply density.
- Independent observations from overlapping or nested windows. Records and
  sampled assets may be shared between Lenses.
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
  or tourism-pressure figure. The application holds a Madrid Destino
  accommodation layer and a resident denominator and deliberately computes **no
  ratio between them**: a Gate A audit examined exactly that division and ruled
  NO-GO, because that layer is a tourism-promotion catalogue, not an
  administrative register
  ([ACCOMMODATION_NUMERATOR_AUDIT.md](ACCOMMODATION_NUMERATOR_AUDIT.md)). The
  one per-resident figure the application does publish uses a **different,
  separately qualified source** — granted municipal VUT activity licences,
  admitted at Gate B
  ([ACCOMMODATION_NUMERATOR_GATE_B.md](ACCOMMODATION_NUMERATOR_GATE_B.md)) — and
  is bounded by everything in the section below
- That the licensed VUT dwellings are **currently operating**. The source
  records licences **granted**; it carries no revocation, expiry or cessation
  field and publishes no retention policy, so nothing in the application says
  *active*, *operating* or *current* tourist dwellings, and the extract is not
  described as a cumulative stock
- That the licensed VUT figures are **all** tourist dwellings or **all**
  accommodation. Regional VUT responsible declarations, the Comunidad de Madrid
  inventory and online platform listings are all outside the source, and the
  publisher names tourist apartments, hostels, guest houses, hotels, pensions
  and aparthotels as excluded modalities
- The **legality** of any platform listing. The application makes no
  correspondence between a licence record and any advertised accommodation
- That a licence is a dwelling. One granted licence can contain many
  tourist-dwelling units — up to 48 in the current extract — so the licence
  count and the unit count are different figures and are never substituted for
  one another
- A **share of homes or households**. The per-1,000 denominator is registered
  **residents**, so the figure is never "X% of homes are tourist apartments"
- A **rank, band, percentile, hotspot, score or choropleth** of licensed VUT.
  The figure is presented identically at every value: a barrio with more
  licensed units is not styled, coloured or worded as a problem
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

A barrio's administrative statistics — its registered-resident count and its
licensed VUT figures alike — and a lens's circle measurements have **different
geometries**, and are presented as separate sections for that reason. When two
lenses fall in the same barrio they point at **one** set of administrative
statistics, and the interface says so rather than repeating the figures. When no
official area contains the centre, when the centre is outside Madrid, or when a
record is absent or incoherent, the interface abstains explicitly — it never
shows `0`.

One `0` in the interface is real, and it is scoped: a barrio for which the
committed licensed-VUT extract reports no granted licence genuinely shows `0`,
because that extract enumerates licence records across the whole municipality,
so absence within it is an observation. This is the single documented exception
to the project's "missing is not zero" rule, and it never applies to a load or
validation **failure**, which reads *unavailable*. A barrio with a genuinely
small non-zero figure displays `<0.1` rather than a rounded `0.0`, so a real
figure is never printed as nothing.

Datasets keep their own periods and are never implied to be synchronised:
administrative geography carries no effective date (only a published dataset
version), registered residents are dated 1 January 2026, the HATI pilot is
21 August 2023, and the pedestrian counters are a 2024 published period. The
application has no global time control, because there is nothing to align.

The licensed-VUT numerator is the sharpest case. Its source declares **no
reference date and no effective date at all**, so the application reports a
**source file state** — the HTTP `Last-Modified` header observed on the resource
file, September 2026 — and says in its disclosure that this describes the file
served and is **not** a publisher-declared publication, effective or reference
date. The per-1,000 figure therefore combines two sides with **different
temporal semantics**, which the interface shows separately: *Reference 1 Jan
2026* for the residents, *source file state Sep 2026* for the licences. A shared
label such as "VUT & population — 2026" is forbidden, and so is presenting the
HTTP header as a VUT reference date.

The licensed-VUT artifact is a **committed administrative snapshot**. It is not
rebuilt when the site deploys: deployment validation verifies the committed
file, so a successful deployment does not mean the upstream source was
re-fetched. Refreshing it requires re-running the builder and reviewing the
diff. Nothing about this layer is live data.

### Destination Context — hotel demand

The Destination Context surface reports **hotel-sector demand in the
municipality of Madrid** from the official INE *Encuesta de Ocupación Hotelera*.

**It does not establish:**

- **Total tourism demand.** The survey covers **hotel establishments only**. It
  excludes tourist apartments, tourist dwellings (VUT), campsites, rural
  accommodation, day visitors and everyone staying in unpaid or private
  accommodation. Hotel demand is a **part** of tourism, never a proxy for it.
- **How many people visited Madrid.** *Travellers* counts arrivals **per
  establishment**: one person staying in two hotels is counted twice. It is not
  a count of unique people.
- **Anything about any barrio, district or Lens circle.** This is a single
  citywide figure. The artifact carries no coordinates and no sub-municipal
  identifier, so it cannot be distributed into a smaller area even by accident.
  Dragging a Lens never changes it.
- **Domestic versus international tourists.** The composition is the publisher's
  own **place of residence** split (*Residentes en España* / *Residentes en el
  extranjero*). Residence is not nationality, not trip purpose and not a
  domestic/international tourist classification.
- **Tourism pressure, overtourism, saturation, carrying capacity, intensity or
  attractiveness.** The figures are never ranked, banded, scored or mapped.
- **Why a figure changed.** The product reports the observation. It offers no
  attribution to events, weather, prices, policy or anything else, and uses no
  evaluative language — no *strong*, *weak*, *boom*, *crisis*, *success*,
  *failure*, *surge* or *record*.
- **Hotel profitability.** ADR and RevPAR exist in the publisher's catalogue but
  come from a **different statistical operation** and are deliberately excluded.

**What it does carry honestly:**

- The **source geography is stated, not hidden.** The compact card shows
  *Madrid* with *whole municipality* beside it; the source disclosure states the
  publisher's own term (*punto turístico* `Madrid`) together with municipality
  code **28079**. INE defines a *punto turístico* as a municipality and publishes
  this one under that code.
- **Provisional data is labelled.** The current statistical year is published
  provisional and revised later, so a same-month-previous-year comparison
  routinely compares a provisional figure with a definitive one. That is stated
  rather than smoothed over.
- **A withheld month stays withheld.** Where the publisher published nothing
  (May and June 2020), the product shows nothing and the trend line breaks. It
  is never rendered as a zero and never interpolated. April 2020 — a **real
  published zero** — is kept distinct from those.

The hotel-demand artifact is a **committed statistical snapshot**. It is not
rebuilt when the site deploys, and the browser never calls the publisher's API
at runtime. Refreshing it requires re-running the builder and reviewing the diff.

### Destination Context — domestic origins

The same municipality-level surface also reports published **origin
municipalities** for residents travelling to Madrid municipality **from another
Spanish province** in a selected source month. Same-province travel, including
travel within Madrid province, is outside the source universe. It uses INE's
direct internal-tourism workbook and destination code **28079**, corroborated
by the workbook's Madrid destination and province fields.

**It does not establish:** a Lens, barrio or district origin; a complete
distribution of domestic tourism; an all-origin share; unique people; market
attractiveness; causality; or a forecast. INE publishes only origin-destination
crossings with **more than 30 tourists**. An origin absent from the published
table may therefore be outside the source universe or, within that universe,
suppressed; it is **not zero** and no residual “other origins” category is
made. The source-reported `turistas` count remains a count for that published
crossing in that month.

The artifact is a committed, Madrid-only snapshot. Its source month, workbook
year, retrieval time and latest actually published month are stored separately;
moving a Lens cannot alter any origin value.

Domestic Origin Dynamics compares a selected source month only with the exact
prior calendar month when it is present in the committed artifact. It describes
published municipality sets: published in both months, newly present in the
published set, and no longer present in the published set. A row entering or
leaving that set does **not** establish that tourism started or stopped, because
the source publishes only crossings above 30 tourists. An absent value is never
converted to zero. Observed count changes and percentages are shown only where
the source publishes both monthly values. This is descriptive, not causal or
predictive, and it does not establish visitor retention, all-origin shares,
province totals, international origins or any geography within Madrid.

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
- **Official register** — a figure read from an administrative register that
  enumerates a universe at a published reference date. The registered-resident
  count carries this state (`ADMINISTRATIVE_REGISTER`).
- **Administrative licence** — a figure read from records of administrative acts
  that were **granted**, with no declared reference date and no revocation field.
  The licensed-VUT figures carry this state (`ADMINISTRATIVE_LICENSE`). It is
  deliberately a different state from *Official register*: a granted act is not
  an enumerated universe, and neither inherits the other's ceiling.
- **Official statistics** — a figure read from a **sample-based estimate**
  produced by an official statistical operation, carrying the publisher's own
  revision status (*definitive* or *provisional*) and its own statistical
  confidentiality. The hotel-demand figures carry this state
  (`OFFICIAL_STATISTICAL_SERIES`). It is deliberately distinct from the three
  above: nobody is enumerated as in a register, nothing is a record of a granted
  act, and it is an estimate rather than an observation — but it is also not
  *model-derived*, because it comes from a statutory survey of real
  establishments rather than a simulation.

## Relationship to HATI-Madrid

This project reads a small, explicitly cited slice of HATI-Madrid's locked
evidence (see [DATA_PROVENANCE.md](DATA_PROVENANCE.md)). It does not modify,
extend, reinterpret, or re-run any part of the HATI pipeline, and it does not
carry forward any of HATI's feasibility/recommendation labels (e.g. "FEASIBLE
WITH CONDITIONS") — only the raw UTCI values and the official Bröde et al.
stress category they fall into.
