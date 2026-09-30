# Madrid tourism-intelligence source landscape — Gate C0

**Audit date: 30 September 2026.** Every count, size, dataset state and
availability statement below is an **observation of that date**, not a timeless
constant. Anything re-read later may legitimately differ, and a difference is a
finding rather than a fault.

This gate maps and prioritises the public data that could materially improve
Lens as a destination-intelligence product. It **implements nothing**. No map
layer, card, Area Profile change, indicator, choropleth, runtime API call or
registry semantic is added or altered by the pull request that carries it.

---

## How this gate was verified — two separate pieces of evidence

This report rests on two findings that must never be collapsed into one
another. Both are preserved deliberately.

### 1. The Claude Code environment probe was BLOCKED

The repository contains a feasibility-probe harness
(`research/source_landscape/probe_sources.py`). It was run on
**2026-09-30T13:03:25Z** against 14 targets covering all seven source families.

**Result: 0 of 14 ok.** Every target returned HTTP `403 Forbidden` from the
session's egress proxy.

All three *control* targets failed too — URL forms already proven by this
repository's own production builders (`package_show` on `datos.madrid.es`, the
Sigma `LIMITES_ADMINISTRATIVOS` MapServer path) and by Gate B's completed live
audit (`package_show` on `datos.comunidad.madrid`). That is what makes the
diagnosis unambiguous:

> The 0/14 result is evidence about **that environment's network policy**. It
> is **not** evidence about any source's availability, quality or correctness,
> and must never be reinterpreted as a source failure.

`research/source_landscape/probe_report.json` is retained unmodified as the
record of that blocked attempt. **No probe from the Claude Code environment
succeeded on 30 September 2026**, and nothing in this report should be read as
claiming otherwise.

### 2. Official-source verification was completed independently, outside that environment

The source verification this gate requires — official dataset pages, official
metadata, official methodology and schema, machine-readable specifications —
was **completed separately by the project maintainer on 30 September 2026**,
outside the restricted environment, against current official public sources:

- the **API-SEGITTUR OpenAPI 3.0.1 specification, API version 2.0** (Dataestur)
- **Madrid Open Data** dataset and resource pages
- **Geoportal Madrid / IDEAM** dataset metadata and methodology reports
- **CNIG / PNOA** technical specifications
- **Comunidad de Madrid** portal metadata
- **Inside Airbnb's** own data page, assumptions and data policy

Every `verified_at: 2026-09-30` in `source_catalog.json` refers to **this
external verification**, and each record carries
`verification_method: external_official_documentation` so the provenance is
machine-readable and cannot later be misread as a successful in-environment
probe.

**Both facts stand together.** The probe harness remains in the repository and
remains the right instrument; it simply could not run where it was executed.

---

## Evaluation method

No weighted score. No `82/100`. A single number would hide *which dimension
actually decided the call*, which is the only part worth reviewing. Each
candidate is judged on explicit dimensions — decision value, source authority,
spatial fit, temporal fit, reproducibility, semantic clarity, implementation
effort, uniqueness — and then given exactly one recommendation.

| Recommendation | Meaning |
|---|---|
| **USE** | Strong candidate for near-term integration: clear decision question, trustworthy source, usable geography, understandable period, reproducible access, manageable cost, and information not already present. |
| **WATCH** | Potentially valuable but blocked. Every WATCH record states its **blocker** and its **exact unblock condition**. |
| **REJECT** | Not appropriate for Lens now. **Not a quality criticism** — each REJECT records whether it is a sequencing decision that can be revisited. |

Implementation effort uses `LOW / LOW_MEDIUM / MEDIUM / MEDIUM_HIGH / HIGH`.
Compound values are kept rather than forced to a single step, because inventing
precision the evidence does not support is the error this gate exists to avoid.

### The decision-question test

Every candidate had to complete this sentence, or it did not belong:

> A destination manager could use this evidence to understand / compare /
> monitor ______ in order to decide ______.

"This dataset contains trees" fails. "Tree-cover context could help identify
high-footfall areas where heat-adaptation infrastructure deserves closer
investigation" passes — and notably does **not** claim to prove the management
outcome.

### Placement — not everything belongs on the map

| Placement | Scope |
|---|---|
| **Area Profile** | Whole-barrio administrative context |
| **Within Lens** | Circle-based spatial evidence |
| **Destination Context** | Municipality / citywide temporal indicators — **never** a barrio layer |
| **Map overlay** | Only where spatial visualisation adds real value |
| **Comparison / trend panel** | Temporal series |
| **Infrastructure** | Internal pipeline capability, not a user-visible module |

This classification carries real weight below: **municipal hotel occupancy must
never become a barrio layer.**

---

## Result

**15 candidates across 7 source families: 8 USE, 5 WATCH, 2 REJECT.**

| # | Candidate | Family | Placement | Effort | Ruling |
|---|---|---|---|---|---|
| 1 | Hotel occupancy by tourist point (`EOH_PUNT_TUR_DL`) | A | Destination Context | LOW_MEDIUM | **USE** |
| 2 | Domestic origin→destination (`TURISMO_INTERNO_MUN_MUN_DL`) | A | Destination Context | LOW_MEDIUM | **USE** |
| 3 | International origin country (`TURISMO_RECEPTOR_MUN_PAIS_DL`) | A | Destination Context | LOW_MEDIUM | **USE** |
| 4 | Censo de locales, actividades y terrazas | B | Area Profile | MEDIUM | **USE** |
| 5 | Callejero oficial (reconciliation infrastructure) | C | Infrastructure | MEDIUM | **USE** |
| 6 | Zonas verdes — Verano 2025 | C | Within Lens | MEDIUM_HIGH | **USE** |
| 7 | Mapa de Isla de Calor Urbano 2024 | C | Map overlay | MEDIUM_HIGH | **USE** |
| 8 | Inside Airbnb Madrid snapshot | F | Area Profile | MEDIUM_HIGH | **USE** *(conditional on Gate C1)* |
| 9 | INE experimental VUT (`VIVIENDA_TURISTICA_INE_MUN_DL`) | A | Destination Context | LOW | WATCH |
| 10 | Alojamientos turísticos CM | E | Area Profile | MEDIUM | WATCH |
| 11 | VUT declaraciones responsables CM | E | Area Profile | MEDIUM | WATCH |
| 12 | PNOA-LiDAR 3rd coverage | D | Map overlay | HIGH | WATCH |
| 13 | Arbolado de la ciudad de Madrid | C | Map overlay | MEDIUM | WATCH |
| 14 | AEMET OpenData | G | — | MEDIUM | REJECT *(for now)* |
| 15 | Additional generic cultural-POI inventories | B | — | LOW | REJECT *(for now)* |

Full machine-readable detail, including every interpretation ceiling and
unblock condition, is in `research/source_landscape/source_catalog.json`.

---

## Family A — Dataestur / SEGITTUR

Dataestur exposes **API-SEGITTUR**, whose **OpenAPI 3.0.1** specification
(**API version 2.0**) declares the downloadable endpoint families directly.
That specification is what makes these candidates reproducible: the endpoints
and parameters are *declared*, not inferred from a portal's behaviour.

### A1 · `EOH_PUNT_TUR_DL` — hotel occupancy by tourist point → **USE**

Hotel-accommodation occupancy by official *punto turístico*. **Madrid is
explicitly present in the official tourist-point enumeration.** Available from
**2012-01**, with date-range parameters and a residence dimension separating
**total / residents in Spain / residents abroad**. Output is **XLSX**.

**Decision question.** How is Madrid's hotel demand evolving through time, and
how does its domestic/international composition change?

**Placement: Destination Context. Do NOT map it to barrios.** This is a
citywide series; distributing it into barrios would manufacture spatial detail
the source does not contain.

**Interpretation ceiling.** Hotel-sector demand as the official occupancy
survey measures it. Not all tourism, not all accommodation, not tourist
pressure, not carrying capacity. "Travellers" is a survey count of arrivals,
not unique persons. It says nothing about any barrio and nothing about
non-hotel supply such as VUT.

**Open before implementation.** The exact geography the "Madrid" tourist point
represents must be confirmed against the source's own definition and stated in
the UI. Whether average stay, ADR or RevPAR are actually exposed must be read
off the returned workbook — **not assumed because those concepts exist
elsewhere in Dataestur.**

### A2 · `TURISMO_INTERNO_MUN_MUN_DL` — domestic origin→destination → **USE**

Origin and destination of resident tourists visiting another Spanish
municipality. **Municipality → municipality**, available **since 2019**, year
parameter, **CSV**.

**Decision question.** Which Spanish municipalities do resident tourists to
Madrid come from, and how is that mix changing?

**Ceiling.** Estimated flows as the series measures them — not devices, not
individuals, not arrivals at any place *inside* Madrid, not spending. The unit
must be reported exactly as the source names it and never silently relabelled
"tourists" if the source says trips. **Do not distribute to barrios.**

### A3 · `TURISMO_RECEPTOR_MUN_PAIS_DL` — international origin → **USE**

Origin country of foreign tourists, at **municipality-level destination**.
Available from **2019-07**, **CSV**. A later extension of the same Destination
Context module rather than a separate product.

### A4 · `VIVIENDA_TURISTICA_INE_MUN_DL` — INE experimental VUT → **WATCH**

Municipality-level, available from **2020-08**, **CSV**. Dataestur's own VUT
documentation records the INE series as **experimental**, **semestral**, with
**latest observation May 2026** and **updated July 2026**.

**Blocker.** This is **not the same universe** as the municipal *Viviendas de
uso turístico con licencia* source already in Lens. It is also semestral and
municipality-only, so it cannot inform the barrio scale where the existing
licensed-VUT indicator lives. **Never merge the values.**

**Unblock.** Promote when (a) the INE experimental methodology has been read
and each universe can be stated in one sentence, and (b) a reconciliation
module exists that is *designed to compare distinct universes rather than merge
them* — i.e. after the official/platform comparison gate, not before.

---

## Family B — Madrid Open Data

### B1 · Censo de locales, actividades y terrazas → **USE**

Dataset **`209548-0-censo-locales-histórico`**: municipal microdata covering
premises, activity, access type, situation (open/closed), economic activity,
registered hospitality terraces, and associated licence information.

Historical monthly resources verified present **through September 2026**, in
four families. Approximate September 2026 sizes:

| Resource | Size |
|---|---|
| Actividades CSV | ~119 MB |
| Locales CSV | ~85 MB |
| Locales con información de licencia CSV | ~108 MB |
| Terrazas CSV | ~5 MB |

Crucially, the resource pages expose the **CKAN Data API** — `datastore_search`
and `datastore_search_sql`. A future integration therefore **does not
necessarily require downloading 100+ MB files on every run**, which changes the
effort calculus substantially.

**Decision questions.** What hospitality and commercial activity is
administratively documented in this barrio? How is that mix changing over time?

**Placement: Area Profile** (whole barrio), with optional map context later. A
premises point layer is not the primary deliverable.

**Explicitly NOT yet implemented:** any "hospitality pressure" construct, and
**no automatic division by residents.** Per km², raw count, per-activity
breakdown and change-over-time are all defensible for different questions; the
denominator stays **deliberately open** until the taxonomy is fixed.

**Ceiling.** A count of administratively documented premises. Not economic
vitality, not turnover, not quality, not visitor demand, not tourism pressure,
and not evidence that a documented premises is trading today. A terrace record
is an *authorised* terrace, not observed use of public space.

**A dedicated activity-taxonomy and methodology gate must complete first**,
resolving: activity-code taxonomy; stable premises identity across monthly
snapshots; open/closed status semantics; historical comparability and schema
breaks; aggregation geography; and the denominator question.

---

## Family C — Geoportal Madrid / IDEAM

### C1 · Callejero oficial. Numeración Vigente e Histórica → **USE** (infrastructure)

Identifier `9be44652-2490-11e9-a99c-ecb1d752b636`. **Dataset state verified 29
September 2026**, continuously maintained with daily publication mechanics.
Interfaces: **ESRI REST, WMS, WFS, OGC API Features, SHP, CSV, municipal REST
geocoding, SCN geolocator**. **EPSG:25830**, **CC BY 4.0**.

Note the date discipline: the portal dates the **current state of the
dataset**. That is a dataset-state date, **not** a record-level effective
period, and must not be promoted into one.

**This is not a user-visible module.** It is likely canonical infrastructure
for reconciling future administrative datasets to official Madrid geography.
Gate B already proved the approach, reconciling 6 465 / 6 501 (99.45%) regional
records to barrio **without a geocoder**.

**Deliberately not built here.** No generic abstraction is created in Gate C0.
Promote it to shared infrastructure **when a second dataset actually needs
it** — building the abstraction before a second caller exists would be
speculative architecture.

### C2 · Zonas verdes. Verano 2025 → **USE**

Identifier `SPA_28079_ESTRATOS_VEGETALES_VR2025`, **source date 2 July 2025**.
High-resolution vegetation-cover raster from **WorldView-3**, classified into
**tree vegetation / grass-garden / shrub** via **NDVI, RVI and automated
land-cover classification**. **WMS** plus downloadable **TIFF**,
**EPSG:32630**.

**Source-selection note — this matters.** Spring 2025 also exists, but **its
own metadata states that cloud cover produced non-optimal classifications and
can overestimate tree vegetation in affected areas.** Summer 2025 is therefore
preferred for a first production experiment. Spring is appropriate only when
seasonal comparison is the explicit research question — and then the caveat
must travel with the figure.

**Ceiling — four distinct things, and this measures only the first.**
Vegetation **cover** ≠ **shade** ≠ **thermal comfort** ≠ **park
accessibility**. This product must never be used to claim shade, cooling,
biodiversity quality or accessibility.

Requires a dedicated **raster methodology gate** before implementation.

### C3 · Mapa de Isla de Calor Urbano. Año 2024 → **USE**

Identifier `SPA_28079_ICU_2024`. Analytical urban-climate map built from
**Landsat 8 TIRS** observations in an approximately **12:00–13:00** acquisition
window, as a **whole-year analysis covering four seasons**, generated through
**multicriteria evaluation**. **EPSG:32630**, **WMS**, downloadable ICU TIFF,
downloadable input-variable TIFFs, and an **official methodology report**.

The source itself warns that **comparison with years lacking equivalent source
dates is not valid** — so no casual multi-year trend.

> ### This is NOT HATI. ICU ≠ UTCI.
>
> The ICU product and HATI's SOLWEIG-derived UTCI are different variables, from
> different methods, at different scales, for different periods. They may sit
> side by side as **independent context**. They may **never** be merged into one
> metric, differenced, or used to "validate" one another without a dedicated
> methodological study that first establishes commensurability.

Requires its own gate, whose first job is to state precisely what the ICU
variable represents.

### C4 · Arbolado de la ciudad de Madrid → **WATCH**

Alignment trees, interblock trees, historic parks, nurseries. **ESRI REST,
WMS, SHP**, **EPSG:25830**.

**Blocker: redundancy, not quality.** Its immediate decision question overlaps
the vegetation-cover product, which is the better instrument for "how green is
this area" — a tree *count* is not a cover *share*.

**Unblock.** When a question genuinely requires **individual assets** rather
than cover — street-level shade infrastructure along a named route, or
per-asset management context — *and* the vegetation module has shown it cannot
answer it.

---

## Family D — IGN / CNIG / PNOA → **WATCH**

PNOA-LiDAR **third coverage**, verified technical specification: flight years
**2022–2025**; minimum density **5 points/m²**; at least **13 core semantic
classes**; expected vertical **RMSE ≤ 10 cm** for the point cloud; **1 × 1 km**
files; **MDE grid step 0.5 m**. Products include point clouds, MDS 0.5 m for
the third coverage, and derived elevation products.

**Blocker.** Engineering cost is **HIGH** and Lens has **no sufficiently
bounded decision question** that requires point-cloud or sub-metre elevation
evidence. The resolution is genuinely impressive — which is precisely the trap.
**Do not confuse technical sophistication with product value.** No decision
currently improves because this is processed.

**Unblock.** When a *specific bounded question* needs it that cheaper evidence
cannot answer — for example shade-potential analysis for a named set of
visitor-facing streets, where vegetation cover and the ICU product have already
been shown insufficient. **The question must come first, and must name the
tiles it needs.**

Note also that acquisition epoch varies by tile across 2022–2025; a single
national "date" does not exist and must not be asserted.

**No LiDAR was processed in this gate.**

---

## Family E — Comunidad de Madrid

**Gate B remains authoritative and is not reversed here.**

### E1 · Alojamientos turísticos de la Comunidad de Madrid → **WATCH**

Verified current metadata: dataset-state update **28 September 2026**,
**weekly** update, whole Comunidad de Madrid, **temporal coverage field empty**,
Dirección General de Turismo y Hostelería.

**Gate B ruled this candidate MODIFY, and that ruling stands.** Geography is
*not* the blocker — Gate B reconciled it to barrio deterministically. The two
open blockers are unchanged:

1. the source **universe is not explicitly published**;
2. the **unit of analysis is undocumented** and was *observed to mix dwellings
   with establishments*.

Without those, no indicator can be named without overstating it. Weekly
overwrite with no archive is a third, softer blocker for longitudinal use.

**Unblock.** Re-evaluate **only** when **new official documentation** resolves
unit-of-analysis and universe — for example a published structure document
defining the row unit and stating inclusion/exclusion rules. **Nothing verified
on 30 September 2026 constitutes such a document**, so Gate B is not reopened.

### E2 · Declaraciones responsables de actividad de VUT → **WATCH**

**Monthly**, historical **ZIP** available, whole Comunidad, updated **11
September 2026**. The source states explicitly that these are VUT that
submitted a responsible declaration **without inscription in the Comunidad de
Madrid tourism-companies register**.

**This is a DISTINCT LEGAL UNIVERSE** — neither the regional inventory nor the
municipal licence set. Merging it with the municipal licensed-VUT numerator
would fabricate a total that exists in no legal framework. **Do not merge.**

**Unblock.** Only inside a dedicated legal-universe reconciliation module whose
explicit purpose is to hold three universes apart and describe their
differences — municipal activity licence, regional inscription, regional
responsible declaration — **never to sum them**. That module is LATER work.

---

## Family F — Inside Airbnb → **USE**, conditional on Gate C1

Current Madrid snapshot: **20 June 2026**. File families: `listings.csv.gz`,
`calendar.csv.gz`, `reviews.csv.gz`, `listings.csv`, `reviews.csv`,
`neighbourhoods.csv`, `neighbourhoods.geojson`.

**Evidence class: PLATFORM-OBSERVED.** Not official accommodation stock, not an
administrative register, not legal status, not an operating census.

### Data policy — binding on the architecture

Inside Airbnb's current policy: take only the data needed; **do not scrape
repeatedly**; **download once** for analysis; **DO NOT REPUBLISH THE DATA**;
attribute and cite Inside Airbnb.

The architecture follows directly:

```
raw local research snapshot
   → validated derived aggregates
   → provenance
   → Lens
```

**Raw microdata must never be committed to this repository.** The repo
publishes derived aggregates and provenance only.

### Documented assumptions that constrain every claim

- Listing coordinates are **anonymised by Airbnb**; location may be **displaced
  by roughly 0–150 m**.
- **"Calendar unavailable" does NOT distinguish booked from host-blocked.**
  Booked nights may not be inferred from it.
- Listings are **snapshots**.
- Occupancy and income analyses are **MODEL-derived** and carry the model's
  assumptions.

### Geography

Use the **canonical official 131 barrios**, not the source's own
128-neighbourhood geometry. Because coordinates are displaced up to ~150 m, a
listing near a barrio boundary can be assigned to the wrong barrio — **boundary
uncertainty must be handled and quantified explicitly**, not ignored.

### Prohibited inferences

Never infer legality, operating status, booked nights from unavailable
calendar, or official accommodation stock. **An unmatched listing is not
evidence of illegality.**

This is the highest-portfolio-value candidate in the landscape *and* the
highest methodological risk. The two are inseparable, which is why it needs its
own **Gate C1** before any production work.

---

## Family G — AEMET → **REJECT (for now)**

AEMET OpenData is authoritative and machine-readable. However, the API
**requires a key**, and under the **2026 policy change new keys expire after
three months, with legacy non-expiring keys ceasing to work from 15 October
2026.**

**Reject reason.** That imposes a recurring secret-rotation obligation on a
project whose deployment currently ships **no credentials at all**, in exchange
for environmental context Lens already approaches through HATI, the municipal
ICU product and Dataestur's own climatological endpoint families.

**This is a sequencing decision, not a quality criticism.** Revisit if a
question emerges that genuinely requires observed meteorological series and
cannot be served by existing environmental evidence.

**No credential may be committed to this repository under any circumstances.**

---

## Redundancy rejection — additional generic cultural-POI inventories → **REJECT (for now)**

Lens already carries museums, tourist information points and the Madrid Destino
catalogue.

**Reject reason: insufficient information gain.** Another POI inventory adds
layer count, not decision support — and each additional *overlapping* register
increases the risk that a user reads two partially-overlapping inventories as
one authoritative total. **Low implementation effort is not a reason to
integrate; the test is information gain.**

Revisit only if a specific question needs an attribute the existing layers
genuinely lack — documented opening hours, accessibility attributes — in which
case **the candidate is that attribute, not another inventory.**

---

## Cross-source opportunities

For each combination, geography / period / universe compatibility is stated
before any relationship is entertained. **No causality is inferred anywhere.**

| Combination | Geography | Period | Universe | Verdict |
|---|---|---|---|---|
| Licensed VUT + registered population | compatible (barrio) | different, disclosed | different but both administrative | **already implemented** |
| Hospitality activity + population | compatible (barrio) | compatible (monthly vs annual Padrón — disclose) | different | candidate, **after taxonomy gate** |
| Platform-visible supply + licensed VUT | compatible **only after** boundary-uncertainty handling | different snapshot dates | **fundamentally different** | candidate, **Gate C1 then reconciliation gate** |
| Pedestrian observations + hospitality/terraces | compatible (point/barrio) | different | different | candidate — **juxtaposition only** |
| Vegetation + HATI | compatible (circle) | different epochs | **different methods** | contextual **juxtaposition only** |
| ICU + HATI | compatible spatially | different | **different variables** | **side-by-side only, never merged** |
| Destination demand + accommodation supply | municipality vs barrio — **incompatible scales** | compatible | different | citywide context **only**, never joined at barrio |

The last row is the one most likely to be got wrong: hotel demand is a
municipal series and accommodation supply is documented at barrio. They can sit
in the same product; they cannot sit in the same ratio.

---

## The hard questions

**1. What is the biggest evidence gap in Lens today?**
**Temporal destination demand.** Lens has strong territorial, context and
supply evidence — geography, population, licensed VUT, POIs, mobility nodes,
pedestrian observations, bounded thermal evidence. It has almost **no citywide
tourism-demand evolution**. It can describe *where things are* far better than
*how demand is moving*.

**2. Highest decision value for the lowest implementation cost?**
**Dataestur `EOH_PUNT_TUR_DL`.** A declared endpoint in an official OpenAPI
spec, Madrid explicitly present, monthly series back to 2012-01, a residence
dimension, `LOW_MEDIUM` effort. Nothing else in the landscape offers this
value-to-cost ratio.

**3. Highest potential long-term differentiation?**
A rigorously separated comparison of **administrative licensed supply ↔
platform-visible supply ↔ external experimental VUT context ↔ resident
geography** — *without equating their universes*. Most public work either
conflates these or refuses to compare them. Doing it with explicit universe
separation is the genuinely distinctive capability.

**4. Which attractive source should we NOT integrate?**
**PNOA-LiDAR as an immediate feature.** 5 points/m², 13 semantic classes,
sub-metre elevation — technically the most impressive source audited, and the
easiest to be seduced by. No current Lens decision improves because it is
processed. Powerful source, wrong sequencing.

**5. Which source most improves Lens for an Ayuntamiento / Madrid Destino audience?**
**Dataestur Destination Context**, later combined with the municipal
hospitality census. Destination managers already work with occupancy and
origin-market series; presenting them with explicit provenance and honest
ceilings speaks directly to that audience.

**6. Which most improves Lens for hospitality / tourism-tech employers?**
The **destination-demand series**, then the **official ↔ platform accommodation
comparison**. The first demonstrates temporal pipeline work; the second
demonstrates the harder skill — reconciling sources that disagree, without
pretending they measure the same thing.

**7. Which most strengthens scientific / research credibility?**
The **official environmental rasters** — vegetation cover and municipal ICU —
kept methodologically separate from HATI, with explicit provenance and
uncertainty. Their value here is precisely that their *limits are documented
and quotable*: the Spring-2025 cloud-cover caveat and the ICU year-comparison
warning are the kind of constraint that demonstrates rigour.

**8. Which next feature should become the next implementation PR?**
**Madrid Destination Context v1**, from `EOH_PUNT_TUR_DL`. Reasoning in the
roadmap below.

---

## Roadmap

### NOW — the next 1–2 PRs

#### Next PR · Madrid Destination Context v1

| | |
|---|---|
| **Working name** | Madrid Destination Context |
| **Decision question** | How is hotel demand in Madrid changing through time? |
| **Source** | Dataestur `EOH_PUNT_TUR_DL` (API-SEGITTUR, OpenAPI 3.0.1 / API v2.0) |
| **Geography** | Madrid official tourist point — **municipality scale, never barrio** |
| **Period** | Monthly series available from 2012-01 |
| **UI placement** | **Destination Context** — not Area Profile, not a barrio map |
| **Evidence type** | Official statistical series |
| **Effort** | LOW_MEDIUM |
| **Gate needed first** | None blocking. Metrics chosen only after inspecting the returned workbook schema |

**Start bounded. Do not implement every Dataestur endpoint.** Likely relevant
concepts include travellers, overnight stays, occupancy, domestic/international
residence, and average stay *if the source actually exposes it*. **Do not
invent a metric merely because it exists elsewhere in Dataestur.**

Confirm and state in the UI what geography the "Madrid" tourist point
represents.

**Why this before the alternatives.** It closes the single biggest evidence gap
(#1) at the lowest cost (#2). It needs no methodology gate, unlike the
hospitality census (taxonomy), vegetation and ICU (raster methodology) and
Inside Airbnb (Gate C1). It establishes the **Destination Context surface**
itself, which three later modules reuse — so building it first converts a
one-off into shared product architecture. And it introduces a *temporal* axis
the product currently lacks entirely, which every subsequent trend module
depends on.

#### The PR after that · Hospitality & Commercial Context — methodology gate

A **gate, not an implementation**. Resolve, in order: activity-code taxonomy;
stable premises identity across monthly snapshots; open/closed status
semantics; historical comparability; aggregation geography; and the denominator
question. Only then does an indicator get named.

### NEXT — 3–5 meaningful modules

1. **Gate C1 — Platform Accommodation Evidence** (Inside Airbnb): snapshot
   architecture, boundary-uncertainty handling, publishable-aggregate
   definition under the data policy.
2. **Official Vegetation Context** (Zonas verdes Verano 2025), after its raster
   methodology gate.
3. **Municipal Urban Heat Context** (ICU 2024), after its own gate, kept
   strictly separate from HATI.
4. **Destination-origin extension**: `TURISMO_INTERNO_MUN_MUN_DL` and
   `TURISMO_RECEPTOR_MUN_PAIS_DL` onto the existing Destination Context
   surface.
5. **Promote the official Callejero into shared reconciliation infrastructure**
   — *when a second dataset actually needs it*, not before.

### LATER — valuable but not yet justified

- **Official ↔ platform ↔ INE VUT reconciliation.** The highest-differentiation
  capability (#3), and the one with the most ways to go wrong. Needs C1 and the
  hospitality gate done first.
- **PNOA-LiDAR morphology / shade potential** — only once a bounded question
  names the tiles it needs.
- **Individual-tree analysis** — only once cover is shown insufficient.
- **Candidate B re-evaluation** — **only** if new official documentation
  resolves the Gate B unit-of-analysis and universe blockers.

---

## What this gate deliberately did not do

No map layer, card, Area Profile change, choropleth, runtime API call, registry
semantic change, indicator change or HATI change. No Dataestur or Airbnb
runtime calls. No LiDAR processed, no vegetation raster added, no large
upstream dataset committed, no credential anywhere.

The evidence-class vocabulary used in `source_catalog.json`
(`OFFICIAL_STATISTICAL_SERIES`, `ADMINISTRATIVE_DECLARATION`,
`PLATFORM_OBSERVED`, `MODEL_DERIVED_PUBLIC_PRODUCT`, …) is **descriptive for
this gate only**. It is a *proposal* for how the runtime registry enum might
later grow; **Gate C0 does not implement any taxonomy change**, exactly as Gate
B recorded but did not implement `ADMINISTRATIVE_LICENSE`.
