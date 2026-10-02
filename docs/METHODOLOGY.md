# Methodology

## The core interaction

Every feature in this app exists to answer one question:

> **What changes in the local tourism, mobility and thermal evidence when I move this lens across Madrid?**

A lens (a draggable circle with an independently stored radius for A and B)
defines a local area. One slider edits the active Lens. Moving it recomputes a small set of **descriptive** statistics over whatever data
falls inside it. Nothing here ranks locations, scores "quality," or predicts
behaviour — it answers "what is here" and "what does the evidence actually
support here," nothing more.

## Radial Comparative Halo V2

The optional halo is active only in Compare mode and draws one halo around each
Lens. It is a supplementary pattern cue; the panel gives the authoritative
Lens A value, Lens B value and signed B−A difference, including units, source
state and evidence qualifications. In Compare mode, both radii remain visible.
The first enable of Lens B copies Lens A's current radius; later re-enables
preserve B's radius. Reset remains position-only.

Comparison switches automatically on exact clamped integer metre values:
equal radii use eligible raw represented POI/stay counts, while unequal radii
use represented records per full geometric circle km² only when both circles
are wholly inside the canonical Madrid municipality AOI and source states are
compatible. Raw counts remain visible; a failed AOI or source check withholds
the normalized delta without substituting a raw delta. Stays use the exact
wording **represented catalogue records/km²**, never accommodation density.
Area is `Math.PI * Math.pow(radiusM / 1000, 2)` and is not rounded before
division. Mobility retains side counts but withholds unequal-window deltas.
Pedestrian means and UTCI remain native-unit comparisons with per-side radius
and coverage context.

The municipality polygon is the canonical artifact's derived union of the 21
official district polygons. Whole-circle eligibility first requires the centre
to be inside that polygon, then computes distance to every potentially nearby
exterior and hole boundary segment in a local azimuthal-equidistant plane. The
point-to-segment distance is conservative; a 2 m guard band makes tangent and
near-tangent cases abstain. No boundary circumference sampling, clipping,
bounding-envelope inference, or alternate denominator is used. The edge index
is built with the canonical geography once and reused. If it is unavailable,
only unequal-radius POI/stay normalization abstains.

The four fixed slots proceed clockwise: Tourism POIs at 12 o'clock, Stays at
3, Pedestrian activity at 6, and UTCI at 9. V2 makes these fixed positions
readable as labelled radial spokes (`POI`, `STAY`, `PED`, `UTCI`) attached five
screen pixels outside the projected circle boundary. Empty or abstaining slots
do not rotate the order. Mobility stays in the comparison table only. No
Category Mix, administrative-area, destination, hospitality, parks, or
hotel-demand measure enters the halo.

For Tourism POIs and Stays, both comparable source states are required. Equal
windows scale raw counts; eligible unequal windows scale rates after both
counts are divided by their own full-circle areas. A=5 and B=10 in equal mode
share a 0.5/1.0 scale. The largest bar is only the maximum within the current
same-unit A/B pair; it is not a Madrid benchmark, percent, target, score, or
ranking. V2 uses a 44 px maximum, 8 px-thick screen-space spoke with a rounded
outer end; it points away from (rather than extends) the analytical circle.
AOI/source abstentions show nonnumeric marks, never raw bars or zero.

Pedestrian bars use the observed fixed-counter hourly means, with one shared
local A/B maximum only when both Lenses have observed records and compatible
published-period semantics. The panel and accessible summary retain counter
count, observation count, and available date range. No counter is no evidence,
not zero pedestrians; pedestrian evidence is not tourist-specific and is never
divided by circle area.

UTCI does not use a zero-origin count bar or a percentage. For two same-timestep
HATI sample means, V2 uses a short west-facing radial temperature track with an
identifiable centre tick; each neutral marker remains relative to their shared
pair midpoint, at 2 screen pixels per 1°C. This preserves the sign and magnitude
of B−A in the two marks without making 0°C a baseline or defining a thermal
threshold. The pixel-per-degree conversion is local display geometry, not a
heat score or performance scale. UTCI remains a mean of model-derived samples
from the bounded 21 August 2023 pilot; it is not live, citywide, interpolated,
or a safety or recommendation signal.

OFF, UNAVAILABLE, NO EVIDENCE, and withheld/incompatible comparison states use
distinct non-numeric spoke marks; they are never zero-length value bars. A real
zero retains the normal track and a Lens-side origin circle. Snapshot and
deployment qualifiers remain in the panel and accessible A/B summary. The
screen-reader summary follows the fixed metric order and reports A, B, B−A or
the reason comparison was withheld. The keyboard/touch toggle controls only
the map marks. At a projected Lens radius of 42 px or more, full spokes and
labels show; from 30–41.9 px compact unlabeled spokes show; under 30 px they
hide. Control, map-edge, and A/B collisions suppress only their ambiguous slot
where possible, with the panel remaining authoritative. The marks are
screen-space decorations and do not change the circle boundary or geographic
radius.

## Area Profile — the administrative area of the Lens centre

### The circle and the administrative area are different analytical objects

This is the load-bearing rule of the feature, not a caveat about it.

- The **Lens circle** measures what genuinely falls inside it: the POIs,
  accommodation records, mobility nodes and sampled evidence at those
  coordinates.
- The **barrio** is an official administrative area. Its registered population
  is a statistic about the *whole* barrio.

The application therefore never computes anything of the form
`barrio population × share of the barrio covered by the circle`, and never
says "N people live inside this Lens". It says: *the Lens centre is in barrio X,
and barrio X has Y registered residents at reference date Z.* The panel makes
this visible by separating **Administrative area** (official barrio) from
**Within the Lens** (the *R* m circle), each labelled with its own geometry.

### How the area is resolved

1. The Lens centre `(lon, lat)` is passed to `js/geography.js:resolve()`, a
   pure even-odd ray-casting containment test over the canonical
   `data/geography/madrid_admin.geojson` (21 districts, 131 barrios).
2. The matching **barrio** determines the place. Its declared `parent_id` gives
   the **district** — the build validates with `shapely.covers()` that every
   barrio lies inside its declared parent, so the pair is always coherent.
   Resolving each level independently could disagree on a shared boundary.
3. The barrio's `official_id` is joined to
   `data/population/madrid_population.json` **by code only** — never by name,
   never fuzzily, never spatially redistributed.

The canonical artifacts are fetched and indexed **once** per session, after the
operational layers have painted, and the index is reused for every Lens move.
The barrio matched at the previous position is tested first, which is a pure
performance hint: a miss falls through to the ordinary scan, so the answer is
identical with or without it.

### States, and what each one refuses to do

| Situation | What is shown |
|---|---|
| Lens centre inside a barrio, population present | Barrio, district, registered residents, reference date |
| Lens centre outside the municipality | *Outside Madrid City* — no area, **no zero** |
| Barrio known, no population record | The place, and *residents: Unavailable* — **never 0** |
| Inside Madrid, inside no barrio polygon | The district only, and residents unavailable |
| Population artifact failed to load | The place, boundaries and highlight, *residents: Unavailable*, raw licensed VUT counts, and the ratio abstaining |
| Licensed-VUT artifact failed to load | The place and the resident figure in full; *licensed VUT: Unavailable* |
| Canonical geography failed to load | *Administrative context unavailable*; the Lens keeps working |

### The three artifacts fail independently

The browser tracks the geography, the population and the licensed-VUT numerator
as **three runtime states**, because they are three different kinds of thing:

- The **canonical geography is a dependency.** Without it there is no barrio, no
  district, no containing-area highlight and no boundary layer, so the boundary
  selector is disabled and the profile says *administrative context
  unavailable*. A population artifact cannot stand in: a resident count carries
  no geometry, so no place is ever inferred from it.
- The **population is a value attached to a barrio already resolved.** If only
  it fails, the place, its official codes, the highlight and the boundary
  selector all stay exactly as they are; the figure alone abstains with
  *"Residential population unavailable for this administrative area."* — no
  zero, and no reference date, because there is no figure to date.
- The **licensed-VUT numerator is a second value attached to the same resolved
  barrio.** If only it fails, the place and the resident figure are untouched
  and only the licensed-VUT block reads *unavailable*. If the **population**
  fails instead, the raw licensed counts survive and only the **ratio** abstains
  — one failed source never erases unrelated valid evidence.

A payload that parses but carries no administrative division is treated as an
unavailable geography, not as a valid one: resolving against it would report
every coordinate as outside Madrid.

This is **runtime degradation only**, and it deliberately does not soften the
deployment contract. All three artifacts are `blocks_deployment: true`: a
browser may lose one on the wire, but a published build must never *ship* a
broken one.
Deployment integrity and graceful degradation are separate concerns and both are
kept.

### Where the source disclosure comes from

The disclosure is presented as **two named groups**, *Registered residents* and
*Licensed VUT units*, because the numerator and the denominator are different
sources with different universes and different temporal semantics; the headings
are what stop a reader carrying the Padrón's reference date across to a source
that declares none.

Every line is read from the committed sidecar
metadata — dataset, authority, reference date, the published geography versions,
and the artifact's own `interpretation_ceiling`, surfaced as its
opening sentences rather than restated in the application or dumped whole into
the panel. Nothing in the disclosure is authored here, so it cannot drift from
the artifacts; a field that cannot be read is left out, and a disclosure with no
readable metadata at all is not offered rather than filled in.

### Lens A and Lens B

The active Lens's profile is shown in full; the other Lens's area is one compact
line beneath it. When **both centres fall in the same barrio**, that is stated in
words — *"A · B share the same administrative-area statistics, not two
observations"* — and each figure is printed once.
The barrio is also outlined and labelled **once** on the map, tagged `A·B`. Two
outlines on one shape, or the same number twice, would imply two independent
population observations.

No difference between two barrio populations is computed anywhere. The Lens A ↔
Lens B comparison grid remains what it always was: deltas of **circle**
measurements only.

### Administrative boundaries on the map

Administrative geometry has its own visual grammar, deliberately unlike the
Lens: **solid** reference outlines with a barely-there fill, against the Lens's
**dashed** analytical circle. The containing barrio is always outlined; the full
lattice of district or barrio outlines is an opt-in selector that defaults to
off, so the default map stays clean. Stroke colours are chosen per basemap
(light / satellite / dark) and the area carries a contrast halo, as the Lens
does. Only the highlighted areas are labelled — never all 131 barrios.

## Licensed VUT context — the first administrative supply indicator

The Area Profile carries a **second administrative figure for the same whole
barrio**: the licensed tourist-dwelling (VUT) supply that the municipality has
documented there.

### The formula

    licensed VUT units per 1,000 registered residents
      = vut_units / registered_residents × 1000

where, **for the whole official barrio and for nothing smaller**:

| Term | Meaning | Source |
|---|---|---|
| `vut_units` | SUM of the source column `Nº VUT` — the number of tourist-dwelling units included in each granted activity licence | Agencia de Actividades, dataset 300694 |
| `vut_licences` | COUNT of distinct `EXPEDIENTE_LU` — granted urban-planning activity licences | the same dataset |
| `registered_residents` | persons registered in the Padrón Municipal | Subdirección General de Estadística |

The ratio is **never shown on its own**. The interface always displays the unit
count and the licence count beside it, so the figure can be read back to its
components rather than taken as an index.

### The two universes, and why they are not the same kind of fact

- **Numerator universe.** Urban-planning activity licences **granted** in the
  city of Madrid for *hospedaje* use in the tourist-dwelling typology. The
  publisher names every other modality as excluded: tourist apartments, hostels,
  guest houses, hotels, pensions and aparthotels. Evidence family
  `ADMINISTRATIVE_LICENSE` — a set of **granted administrative acts**.
- **Denominator universe.** Persons **registered** in the municipal population
  register at a published reference date. Evidence family
  `ADMINISTRATIVE_REGISTER` — an **enumerated universe**.

Both are administrative; they are not the same kind of object, and the registry
vocabulary was extended by exactly one family so neither inherits the other's
interpretation ceiling. A licence is **not** a dwelling: in the committed
extract one licence covers up to 48 units, so the two counts are always named
separately and the primary user-facing quantity is **units**.

### The period mismatch — the delicate part

The two sides **do not share a period**, and the interface never implies that
they do.

| Side | What can honestly be stated |
|---|---|
| Registered residents | **Reference 1 Jan 2026** — a real Padrón reference date, published by the source |
| Licensed VUT | **Source file state Sep 2026** — the HTTP `Last-Modified` header observed on the resource file when the builder fetched it |

The HTTP header describes **the state of the file served**. It is *not* a
publisher-declared publication, effective or reference date, and the source
declares none of those at all. So the product says *"source file state"*, never
*"reference"*; the compact card shows the month, and the disclosure spells out
the exact provenance and states that the source declares no reference date.
Four different dates exist around this artifact — the portal's catalogue
metadata date, the HTTP header, the span of per-record licence grant dates
(6 Mar 2019 → 2 Sep 2026) and the builder's clock — and they are never collapsed
into one. A label of the form *"VUT & population — 2026"* is forbidden, and a
test asserts it cannot appear.

### Whole-barrio scope

The counts belong to the **whole official barrio**, exactly as the resident
figure does. Nothing is distributed into the Lens circle, weighted by overlap or
combined with a circle measurement. The licensed-VUT row states
*"whole official barrio"* in its own always-visible state line, because the
full disclosure is collapsed away in the mobile drawer.

### Zero, and the one exception to "missing is not zero"

A barrio with no matched licence record is emitted as `0`, **scoped to this
published extract**: the extract enumerates granted licence records across the
whole municipality, so absence within it is an observation rather than a
coverage gap. 25 of the 131 barrios carry such a zero. It is **not** an
assertion that no tourist-dwelling activity has ever existed or exists today
there.

A **failure is never a zero.** A missing, unreachable or incoherent artifact
makes the block read *unavailable*; a record whose two counts are not coherent
non-negative integers is dropped, costing that barrio its figure rather than
giving every barrio a false one.

### Number formatting

One decimal is enough for a figure whose city-wide value is 0.42, and an
integer-valued ratio is not padded with `.0`. One case gets special handling:
six barrios hold one to three licensed units among tens of thousands of
residents, and rounding those to `0.0` would print a zero for an area that
genuinely has licensed supply. Those display **`<0.1`**. A real zero displays
`0`.

### Independent failure of three sources

| Geography | Population | Licensed VUT | Result |
|---|---|---|---|
| ✓ | ✓ | ✓ | full indicator: units, licences, ratio |
| ✓ | ✓ | ✗ | place and residents stand; licensed VUT reads *unavailable* |
| ✓ | ✗ | ✓ | units and licences stand; the **ratio abstains** and says the resident figure is missing |
| ✗ | — | — | no administrative area can be resolved, so no barrio statistic of any kind |

Outside the municipality there is **no licensed-VUT indicator**: no
nearest-barrio fallback, no inferred value, and no district total standing in
for a barrio — the artifact's district totals exist and are deliberately not
used, because this is a whole-barrio statistic.

### Lens A and Lens B for the licensed-VUT figure

One barrio is one administrative area. When both Lens centres are in it, the
interface says *"A · B share the same administrative-area statistics, not two
observations"* rather than printing the same figures twice. In different
barrios, each barrio's figures are stated as **two independent descriptive
values** — no delta, no winner, no ranking, no percentage advantage.

### What the licensed-VUT indicator does not do

It is **descriptive administrative supply context**, and nothing else.

- It does **not** establish that the dwellings are **currently operating**. The
  source carries no revocation, expiry or cessation field and publishes no
  retention policy, so nothing may call these *active*, *operating* or *current*
  tourist dwellings, and the extract is not described as a cumulative stock.
- It is **not** all VUT (regional responsible declarations and the Comunidad de
  Madrid inventory are outside it), **not** all accommodation, **not** beds,
  rooms or places, **not** platform listings, and **not** evidence about the
  legality of any platform listing.
- It is **not** tourism pressure, overtourism, saturation, carrying capacity,
  tourism intensity, displacement, burden, impact or attractiveness.
- The denominator is **registered residents, never homes or households**, so the
  figure is **not** "a percentage of homes that are tourist apartments".
- There is **no ranking, no classification band, no city percentile, no
  hotspot, no red/amber/green scoring and no choropleth.** The block is styled
  identically at every value; a barrio with more licensed units is not styled as
  a problem.
- There is **no global year or date selector.** Each source keeps its own period
  or state.

### What Area Profile still does not do

It computes no density, no rank and no composite score, and it does **not**
divide the Madrid Destino accommodation catalogue by residents. A Gate A audit
of exactly that division ruled **NO-GO** on that source — a tourism-promotion
catalogue, not an administrative register — and records what an authoritative
indicator would need instead: see
[ACCOMMODATION_NUMERATOR_AUDIT.md](ACCOMMODATION_NUMERATOR_AUDIT.md). The
licensed-VUT numerator above is a *different* source, qualified separately at
[Gate B](ACCOMMODATION_NUMERATOR_GATE_B.md); the stay layer is untouched and its
count remains a catalogue count of the circle.

## Destination Context — the city, over time

This is the third analytical object in the panel, and the only one that is **not
about the Lens at all**.

| Surface | Question it answers | Geometry |
|---|---|---|
| Administrative area | Where is this Lens centre, and what does the register say about that **whole barrio**? | official barrio |
| Within the Lens | What falls **inside the circle**? | the circle |
| **Destination Context** | How is **hotel demand in the city** changing month by month? | the **whole municipality** |

### It cannot react to the Lens

This is structural, not a convention:

- `js/destination-context.js` has **no parameter** through which a coordinate,
  radius, barrio or lens could arrive. A test asserts the exported signatures
  stay that way.
- `renderDestinationContext()` is called **only** from its own loader. It is not
  reachable from `refresh()`, `updateAreaContext()`, `renderAreaProfile()` or
  `setBoundaryMode()`, and a test asserts each of those function bodies never
  mentions it.

Dragging either Lens anywhere in Madrid therefore cannot change a single figure
on this surface.

### It fails on its own

The Destination Context module, artifact and sidecar load in their own function
with their own state variable, separate from the area context's three. A failure
costs **this block and nothing else**: the Area Profile, the resident figure,
licensed VUT, the Lens metrics and HATI all stand, and the block says it is
unavailable rather than showing a zero.

### The comparison

Tourism is seasonal, so the only comparison offered is **the same month one year
earlier** — August against August, never August against July. There is no
month-over-month fallback hiding behind that label: when the prior year is
missing the model **abstains and says which side was missing**, because
substituting a different comparison under the same words would make the sentence
untrue.

```
change % = (current month − same month previous year) / same month previous year × 100
```

It abstains in four distinct, separately reported cases:

| State | When |
|---|---|
| `NO_PRIOR_PERIOD` | the series does not reach back a year (e.g. 2018-01) |
| `PRIOR_UNAVAILABLE` | the publisher withheld that month (e.g. May 2020) |
| `CURRENT_UNAVAILABLE` | the publisher withheld the current month |
| `PRIOR_IS_ZERO` | the prior year is a real zero (April 2020), so a percentage change is undefined |

The last is not hypothetical: **April 2020 is a published zero**, and dividing by
it would print an infinity. The product says *"No comparison: the source
published zero for Apr 2020"* instead.

A comparison also routinely puts a **provisional** figure against a
**definitive** one, because the current statistical year is published provisional
and revised later. The provisional status is shown, never hidden.

### What the product is allowed to say

Allowed, because each is directly computed from comparable published
observations:

> Madrid recorded 867,449 hotel travellers in August 2026.

> Overnight stays were 5.3% higher than in the same month one year earlier.

Not allowed, and asserted against by tests that scan the shipped page and
scripts: *tourists in this barrio*, *tourists inside the Lens*, *visitor
pressure*, *overtourism*, *tourism pressure*, *carrying capacity*, *tourism
intensity*, *total tourism demand*, and every evaluative or causal word —
*strong performance*, *weak demand*, *boom*, *crisis*, *success*, *failure*,
*surge*, *slump*, *record-breaking*. The product reports the observation. It
never explains **why** a figure moved, because it has no evidence that would
support an attribution to events, weather, prices or policy.

### Hotel demand is not tourism

The survey covers **hotel establishments only**. It excludes tourist apartments,
tourist dwellings (VUT), campsites, rural accommodation, day visitors and
everyone staying in unpaid or private accommodation. And *travellers* counts
**arrivals per establishment**, not unique people: one person staying in two
hotels is counted twice. The sentence *"Hotel establishments only — not all
tourism, not all accommodation."* is shown with the figures at every viewport,
not hidden behind the collapsed disclosure.

### The trend graphic

A 24-month sparkline per metric, drawn as inline SVG rather than with a charting
dependency — it is one polyline in a vanilla app. It plots **raw published
points** with no smoothing, indexing or rebasing; it uses a neutral stroke with
**no red/green performance semantics**; and it **breaks the line across a month
the publisher withheld** rather than drawing through it, because a continuous
line there would assert demand that was never measured. Each graphic carries an
accessible summary naming the range, the endpoints and any gap.

### Number formatting

The compact headline abbreviates only where a full count would not fit
(`1.7m` for overnight stays, `867k` for travellers); the exact count sits
directly beneath it, and the accessible summary always uses exact figures, so
the abbreviation hides nothing. Group separators follow the application's `en-GB`
convention, as everywhere else in the product.

## Lens statistics

For a lens (center, radius) and the set of points that fall within that
radius (great-circle distance, `js/lens.js:haversineMeters`):

- **Counts** per category (museums, tourist info, accommodation, BiciMAD) — a
  plain tally, not an index.
- **Category mix** — each count as a share of the total POIs in the lens.
- **Nearest features** — the 5 closest points inside the lens, by distance.
- **HATI evidence** — see below.

All of this is computed by pure functions (`js/lens.js`, `js/evidence.js`)
with no hidden state, so the same lens position and radius always produce the
same numbers (see `tests/`).

## HATI evidence layer

HATI-Madrid's outdoor UTCI samples are a **bounded, model-derived evidence
layer**, not a live thermal sensor network and not a city-wide surface. This
project enforces that boundary in code:

- `hatiStatsInLens()` only ever counts and averages the HATI sample points
  that literally fall inside the current lens at the selected timestep.
- If **zero** samples fall inside the lens, the function returns
  `{ evidence: "NONE", mean: null }` — the UI shows **"No evidence"**, never a
  zero, an average of zero, or an interpolated guess.
- There is no code path that estimates a UTCI value for a location without a
  direct HATI sample. Interpolating across the study area would require a new,
  explicitly justified methodology — deliberately out of scope for v0.1.

### UTCI thermal-stress categories

The colour scale (32 / 38 / 46 °C) is the **official published Bröde et al.
(2012)** UTCI stress-category scale, reused unchanged from HATI's own
`docs/PHASE2_UTCI_METHOD.md`:

| UTCI range | Category |
|---|---|
| 9–26 °C | No thermal stress |
| 26–32 °C | Moderate heat stress |
| 32–38 °C | Strong heat stress |
| 38–46 °C | Very strong heat stress |
| > 46 °C | Extreme heat stress |

These are physiological stress categories describing strain on a standardised
human body model — not a tourism recommendation, safety verdict, or
real-time hazard alert.

## Comparison mode (Lens A vs Lens B)

When Lens B is enabled, the app reports the same descriptive metrics for both
lenses side by side, plus a signed delta (`B − A`) for POI counts and — only
when **both** lenses have HATI evidence — a UTCI delta. There is no composite
"winner," overall score, or ranking between the two lenses: a difference in
POI count or UTCI is reported as a fact, not an evaluation. If a layer is
`UNAVAILABLE` (currently: BiciMAD when its live fetch fails), its comparison
delta is shown as "—" rather than a computed difference, since both sides
would otherwise show a meaningless "0 vs 0."

## Data resilience strategy

Public APIs (Madrid Open Data, EMT Madrid, Overpass) can fail from a static
GitHub Pages origin due to CORS, rate limits, or downtime. The app is
**live-first with a repository-snapshot fallback** (Option C) for museums,
tourist info and accommodation: it attempts a live fetch for each layer
independently, and only falls back to a small, explicitly-labelled
**SNAPSHOT SAMPLE** committed in `data/snapshot_poi.json` if that layer's
live fetch fails or returns no data. A snapshot count is always presented as
a sample count, never as if it were a complete, live-verified inventory —
see [DATA_PROVENANCE.md](DATA_PROVENANCE.md).

BiciMAD has no snapshot fallback: an earlier draft included hand-placed,
approximate station coordinates, and these were removed because they could
not be verified against the official EMT Madrid dataset — this project does
not invent or approximate analytical geospatial points. If the live BiciMAD
fetch fails, the layer is reported as **UNAVAILABLE** and the "Mobility
nodes" metric shows "No data" rather than a numeric zero.

HATI evidence is always loaded from the repository (`data/hati_assets.json`);
it is locked historical evidence, not a live feed, so there is no "live"
variant to fall back from.
