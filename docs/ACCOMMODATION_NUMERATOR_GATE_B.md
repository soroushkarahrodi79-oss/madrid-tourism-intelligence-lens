# Authoritative accommodation numerator — Gate B

**Verdict: GO for Candidate A** (Madrid City licensed tourist-dwelling activity
licences) **— MODIFY for Candidate B** (Comunidad de Madrid tourism-accommodation
inventory): its barrio geography problem is solved, but it publishes no universe
definition, no record-level period and no uniform unit of analysis, so it is
not admissible as a numerator yet.

This gate qualifies **sources**. It publishes **no indicator, no ratio, no
per-resident figure, no ranking and no UI**. One numerator-only artifact is
created for the candidate that passed; nothing consumes it.

- **Question examined:** can one or more authoritative public sources support a
  defensible barrio-level tourism accommodation supply numerator for Madrid City?
- **Base:** `main` @ `bcf7368` (after PR #28, [Gate A](ACCOMMODATION_NUMERATOR_AUDIT.md)).
  Test + Deploy green.
- **Gate B audit run:** 30 September 2026, against live official sources.
- **Reproducible by:** `python research/accommodation_gate_b/audit_gate_b.py`,
  which writes the three report files quoted throughout this document.

Gate A ruled NO-GO on the Madrid Destino / esMADRID `stay` catalogue as a
numerator. **That decision stands and nothing here reverses it.** The `stay`
layer, its data, its builder and its evidence contract are untouched by this PR.

## Summary of the two candidates

| | **Candidate A** | **Candidate B** |
|---|---|---|
| Dataset | Viviendas de uso turístico con licencia (`datos.madrid.es` 300694) | Alojamientos turísticos de la Comunidad de Madrid (`datos.comunidad.madrid`) |
| Authority | Ayuntamiento de Madrid — Agencia de Actividades | Comunidad de Madrid — D.G. de Turismo y Hostelería |
| Universe published by the source | **Yes**, explicitly, with exclusions named | **No** |
| Record identity | `EXPEDIENTE_LU`, 1025/1025 unique | `signatura`, 8811/8811 unique |
| Unit of analysis | Documented: one granted activity licence | Undocumented; observed to be mixed |
| Madrid City selection | Municipal dataset; verified geometrically | `localidad == "Madrid"`, exact equality |
| Barrio reconciliation | **1025/1025 (100%)** | **6465/6501 (99.45%)** |
| Source period | No declared reference date; grant date per record + observed file state | Current dataset state dated by the portal; **no record-level period, no archive** |
| **Decision** | **GO** | **MODIFY** |

---

# Candidate A — municipal licensed VUT · GO

## Source contract

| Field | Value |
|---|---|
| Dataset | *Viviendas de uso turístico con licencia*, `300694-0-viviendas-turisticas-geoportal` |
| Publisher | Ayuntamiento de Madrid |
| Responsible unit | **Agencia de Actividades** — Subdirección General de Actividades Económicas, Servicio de Licencias y Consultas |
| Licence | CC BY 4.0 |
| Update frequency | Bimonthly |
| Resources | XLSX, SHP (ZIP), **and a PDF structure document** |
| Catalogue metadata modified | 2026-07-24 |
| HTTP `Last-Modified` observed on the XLSX resource | **7 Sep 2026** |

The dataset ships its own **schema documentation** (`estructuradsviviendasusoturistico.pdf`,
version June 2024). That document, not inference from field names, is what settles
the unit of analysis below.

**Four kinds of date exist here and this gate never collapses them into one:**
the portal's catalogue metadata date (2026-07-24); the **HTTP `Last-Modified`
header observed on the resource file** (7 Sep 2026), which is a fact about the
file served and **not** a publisher-declared publication, effective or reference
date; the **per-record grant dates** (`RESOLUCION`); and the builder's own
retrieval clock. The source declares no reference or effective date at all.

## Universe

The publisher states it directly:

> *"las licencias urbanísticas de actividad concedidas en la Ciudad de Madrid
> para la implantación de la actividad de uso hospedaje en la tipología de
> viviendas de uso turístico. **No se incluye ninguna otra modalidad** de
> actividades de hospedaje, como pudieran ser apartamentos turísticos, hostel,
> casas de huéspedes, hotel, pensiones o apartahoteles, etc."*

So the universe is **urban-planning activity licences granted**, for the VUT
typology only. Every one of the 1025 records carries `DECRETO_LU = "Conceder"`:
the extract contains granted licences, with no refused or pending ones mixed in.

These universes must stay separate and are **not** interchangeable:

- municipal **activity licence** (this source),
- regional **responsible declaration** (a different CM dataset, below),
- regional **tourism-accommodation inventory** (Candidate B),
- promotional listing (the `stay` layer, Gate A),
- platform listing (not an official source at all).

**Currency caveat.** The current published extract contains granted
activity-licence records whose grant dates span **2019-03-06 to 2026-09-02**, and
it carries **no revocation, expiry or cessation field**. The source publishes
**no retention policy** describing how revoked, expired or ceased licences are
kept or removed, so this gate does **not** call the extract a *cumulative stock*:
that would assert something the publisher never documented. What can be said is
narrower and still sufficient — the extract answers *"which licences appear as
granted in this published extract"*, never *"which dwellings are operating
today"*. Any wording built on it must say *licensed*, never *operating*.

## Unit of analysis — the decisive question

The structure document defines the columns:

| Column | Publisher's definition |
|---|---|
| `EXPEDIENTE` | *"Número de Expediente de licencia urbanística de actividad"* |
| `Nº VUT` | *"Número de unidades de viviendas de uso turístico **incluidas en cada licencia** urbanística de actividad"* |
| `RESOLUCION` | *"Fecha de la resolución de concesión de la licencia"* |

So **one row is one licence, and one licence can contain many dwelling units.**
The hypothesis flagged at the start of this gate is confirmed by the publisher's
own documentation. Two different numbers exist:

```
vut_licences = COUNT(distinct EXPEDIENTE_LU)  = 1025
vut_units    = SUM(Nº VUT)                    = 1483
```

Both are real, and neither may be given the other's name. The observed
distribution is heavily skewed: 830 licences cover exactly 1 unit, while a single
licence in Valdemarín covers **48**. Reporting `COUNT` as "tourist dwellings"
would understate that barrio by a factor of 48.

`SUM(Nº VUT) = 1483` is confirmed independently three ways: summing the XLSX
column, summing the shapefile's `UNIDADES_V` attribute, and the publisher's own
`SUM()` formula in the workbook footer.

## Two source traps found in the live data

Both would have silently corrupted a naïve numerator, so both are handled in code
and covered by tests.

**1. The workbook has a trailer.** Rows 2–1026 are licences; row 1030 holds the
publisher's `COUNTIF(B2:B1026,"Conceder")` = 1025, `SUM(F2:F1026)` = 1483, and
row 1033 a further `SUMIF`. Counting populated rows gives **1027**, not 1025, and
summing the unit column over the whole sheet double-counts the totals. The builder
identifies a licence row by a non-empty `EXPEDIENTE_LU`.

*(Row 1033's `SUMIF(L30:L1026,"Conceder",F2:F1026)` has mismatched criteria and
sum ranges in the published file. Its value is not used here — another reason to
compute from records rather than trust a trailer.)*

**2. The two resources are in different row orders.** Only **1 of 1025** rows
aligns positionally between XLSX and SHP. Joining by position would mis-assign
almost every geometry. The builder joins by `EXPEDIENTE`. The expediente sets of
the two resources are otherwise **identical**.

## Identity and duplicates

| Check | Result |
|---|---|
| `EXPEDIENTE_LU` rows / unique / blank | 1025 / **1025** / 0 |
| Unique official address codes (`COD_NDP`) | 865 |
| Addresses carrying more than one licence | 110 (max 10 at one address) |
| Unique coordinates | **865** |
| `EXPEDIENTE_LF` (funcionamiento) present / unique | 878 / 854 |

Identity is clean and comes from the source. **Unique coordinates exactly equal
unique address codes**, which shows the geometry is published at official-address
granularity: several licences at one address share one point and are distinct
licences, not duplicates. No deduplication is performed or needed.

The *funcionamiento* (operating) licence expediente is **not** a record identity —
878 present but only 854 distinct, so one operating expediente can cover several
activity licences. It is a different administrative act and is not used here.

## Geography — reconciled three independent ways

The SHP resource publishes one `PointZ` per record in **EPSG:25830** (declared by
the `.prj` and by the shapefile's own metadata, `AUTHORITY["EPSG",25830]`).
Points are reprojected to EPSG:4326 and resolved by containment against
`data/geography/madrid_admin.geojson` (barrio v3.4.1 / district v3.2.1).

| Observation | Value |
|---|---|
| Source records | 1025 |
| Valid point geometries | **1025** (0 null, 0 unsupported) |
| Inside Madrid municipality | **1025** |
| Resolved to a canonical barrio | **1025 / 1025 (100%)** |
| District-only (no barrio) | 0 |
| Outside the municipality | 0 |
| Barrios represented | **106 / 131** |

Three independent implementations agree on **all 1025** assignments:

1. `shapely` point-in-polygon against the canonical geography (this audit);
2. the application's own `createGeographyIndex` in `js/geography.js`;
3. the **official municipal address register** — `COD_NDP` looked up in
   *Callejero oficial* (`datos.madrid.es` 213605, *direcciones vigentes*), which
   publishes its own `DISTRITO`/`BARRIO` codes derived from the address rather
   than from geometry. **1025/1025 resolved, 0 disagreements.**

Path 3 matters because it shares no machinery with path 1: agreement between a
geometric join and an address-code join is real corroboration, not a restatement.

### The source `DISTRITO` column is a label, not a key

It carries **25 distinct spellings for 21 districts** — `Tetuan` (never accented,
127 records), `Chamartin`/`Chamartín`, `Chamberi`/`Chamberí`, `San Blas -
Canillejas`/`San Blas-Canillejas`, `Fuencarral - El Pardo`/`Fuencarral-El Pardo`.
It is never used as a join key.

Compared against the geometry-derived district, **exactly one record disagrees**:

> `500/2020/00137` — CALLE ALAGON 22 — source label *"Distrito de Centro"*,
> geometry resolves to **Barajas / Timón (214)**.

This was **investigated, not overwritten**. The official IGN **CartoCiudad**
geocoder independently places `CALLE ALAGON 22, Madrid` at
`40.47171765490451, -3.587862867064532` — matching the shapefile's reprojected
coordinate to eleven decimal places — in postal code 28042, and the municipal
address register assigns the same record's `COD_NDP` to Barajas. The geometry and
the address code are right; the free-text label is wrong. The record is counted
in Timón, and the disagreement is recorded in the artifact metadata rather than
hidden.

## Temporal contract

The source publishes **no reference-date and no effective-date field**, but unlike
the Gate A catalogue it is not wholly undated:

| Signal | Value | What it is |
|---|---|---|
| Catalogue metadata modified | 2026-07-24 | portal record's own modification date |
| HTTP `Last-Modified` on the XLSX resource | **7 Sep 2026** | state of the file served — **not** a declared publication or reference date |
| Shapefile export stamp (embedded metadata) | 2026-09-07 12:06:16 | the publisher's export run, corroborating the header |
| Per-record grant dates (`RESOLUCION`) | **2019-03-06 → 2026-09-02** | when each licence was granted |
| Grants by year | 2019: 4 · 2020: 56 · 2021: 80 · 2022: 133 · 2023: 371 · 2024: 180 · 2025: 145 · 2026: 56 | |

That supports an honest statement — *"granted activity-licence records in the
resource file whose HTTP `Last-Modified` was observed as 7 Sep 2026, with grant
dates spanning March 2019 to September 2026"* — which cites a real observed file
state rather than a retrieval timestamp dressed up as a publication date. The
build clock is recorded separately as `retrieved_at` and is never presented as
the source date.

**The periods differ from the denominator and must be shown as differing.** The
Padrón denominator has a real reference date, 1 January 2026; this numerator has
no declared period at all, only an observed file state and a span of grant dates.
A future indicator must display both and must not imply they coincide. No
1 January 2026 snapshot can be reconstructed: the resource is overwritten in
place and no archive is published.

## Candidate A decision

**GO.** Two indicators are defensible, and they are different indicators:

> **Licensed tourist-dwelling (VUT) units per 1,000 registered residents**
> — numerator `SUM(Nº VUT)`, the publisher-defined count of dwelling units
> contained in granted activity licences.

> **VUT activity licences per 1,000 registered residents**
> — numerator `COUNT(distinct EXPEDIENTE_LU)`.

Both must carry the word *licensed*, must not be called "accommodation
establishments", and must not be called "tourist dwellings in operation". Neither
ratio is published in this PR.

---

# Candidate B — Comunidad de Madrid inventory · MODIFY

## Source contract

| Field | Value |
|---|---|
| Dataset | *Alojamientos turísticos de la Comunidad de Madrid* |
| Responsible unit | Dirección General de Turismo y Hostelería (Consejería de Cultura, Turismo y Deportes) |
| Licence | CC BY |
| Update frequency | **Weekly** |
| Geographic coverage | TODA la Comunidad de Madrid |
| **Temporal coverage** | **empty** |
| Resource `Last-Modified` | 2026-09-28 |
| Documentation resource | **none published** |
| Self-description | *"Alojamientos turísticos en sus diferentes modalidades y categorias de la Comunidad de Madrid"* (one line, in full) |

CSV and JSON were compared field by field and are **identical** across all 8811
records.

**A regional publisher is not a problem** — the Madrid City subset is well
defined. The problems are elsewhere.

## Madrid City restriction — solved

`localidad == "Madrid"` (exact equality) selects **6501** of 8811 records.

This had to be tested, not assumed. Of the 170 distinct locality values, four
contain the string "madrid":

| Value | Records |
|---|---|
| **Madrid** | **6501** |
| Rivas-Vaciamadrid | 26 |
| Rozas de Madrid, Las | 24 |
| Humanes de Madrid | 7 |

A substring rule would return 6558 and silently absorb **57 records from three
other municipalities**. Exact equality is correct on the observed values.

The weakness: `localidad` is **free text with no INE municipality code**. The
rule is deterministic against today's values but has no source guarantee of
stability, and the inverted form `"Rozas de Madrid, Las"` shows the field carries
a presentation convention rather than an identifier.

## Barrio reconciliation — solved, deterministically, without a geocoder

Candidate B publishes addresses and **no coordinates**. Before reaching for a
geocoder, this gate looked for an official address authority — and found one.

The **Callejero oficial del Ayuntamiento de Madrid** (`datos.madrid.es` 213605,
resource *direcciones vigentes*, CC BY 4.0, updated weekly, file dated
2026-09-27) publishes **214,692 current addresses**, each with an official
`DISTRITO` and `BARRIO` code. Its 131 district/barrio pairs map **exactly** onto
the canonical 131 barrios, with none missing and none extra.

Candidate B addresses are joined to it by street class, street name and number.
The only normalisation is a documented, closed one: the register splits the
particle into its own `VIA_PAR` column (`DE` + `LOS MADRAZO`) while Candidate B
keeps it inline (`de Los Madrazo`), so leading particles and articles are
stripped from both sides, and Candidate B's 16 street-type abbreviations are
mapped to the register's spellings by an explicit table. **No fuzzy matching, no
commercial geocoder, no bounding box, no postal-code approximation.**

| Outcome | Records | Share |
|---|---|---|
| Exact portal match (street class + name + number) | **6437** | 99.02% |
| Portal match ignoring street class | 17 | 0.26% |
| Street lies wholly in one barrio | 11 | 0.17% |
| Street not found in the register | 28 | 0.43% |
| Street spans several barrios | 6 | 0.09% |
| No street name in the source | 2 | 0.03% |
| **Resolved to a single barrio** | **6465 / 6501** | **99.45%** |

119 of 131 barrios are represented. **Geography is not what blocks Candidate B.**

Google Places or any other black-box geocoder was not used and is not needed;
it would have been unacceptable as an administrative join in any case.

## Identity and duplicates

| Check | Result |
|---|---|
| `signatura` rows / unique / blank | 8811 / **8811** / 0 |
| Registry sections | VT 6365 · HM 1715 · TR 343 · AM 286 · HH 82 · CM 20 |
| Madrid records with an identical full structured address | 48 groups |
| Madrid buildings with more than one record | 876 (max 120 at one address) |
| Madrid records with blank `denominacion` | 1260 |

Identity is clean. **Deduplication by address would be wrong**, and this is the
kind of mistake the gate exists to catch: the `puerta` and `escalera` fields are
**truncated by the source** to about six characters, so four genuinely distinct
dwellings at Gran Vía 47 collapse onto the identical structured address
`planta "3", puerta "PTA. 3"` while their `denominacion` still distinguishes them
as *PTA. 38, 39, 30, 31*. Identity must come from `signatura` alone.

A second truncation trap: `alojamiento_tipo` is cut to 20 characters, so the VUT
value is literally `"VIVIENDAS DE USO TU "` — **with a trailing space**. An
equality filter on the full phrase returns zero rows.

## Unit of analysis — not documented, and observed to be mixed

The source says nothing about what a record represents. Observation shows it is
**not uniform**:

- **VT rows (4987 in Madrid)** carry floor and door and describe **individual
  dwellings** — 120 separate records at one building on Calle de Orense.
- **HM / AM rows** describe **whole establishments** — one hotel, one record.

So "registered tourism accommodation **establishments**" would be a false
description of the whole file, and any count mixing the two granularities counts
two different kinds of object. This is the same category error Gate A rejected in
the `stay` catalogue, in a different guise.

## Universe — not published

This is the blocking finding. The dataset declares **no legal universe, no
active/inactive semantics, and no statement that entries are current**. There is
no documentation resource.

The strongest available evidence is **indirect**: the sibling CM dataset
*Declaraciones responsables de actividad de viviendas de uso turístico* describes
itself as VUT that filed a declaration *"**Sin inscripción en el Registro de
Empresas Turísticas** de la Comunidad de Madrid"*, which implies Candidate B is
that registry. Decreto 79/2014 does require inscription in the Registro de
Empresas Turísticas to exercise the activity.

**An implication drawn from a neighbouring dataset is not a source contract.**
Until the publisher states the universe, the word *"registered"* cannot honestly
be used in an indicator name, and neither can any claim that the entries are
active.

## Temporal contract — current state dated, longitudinal semantics missing

| Signal | Value |
|---|---|
| Portal's declared **current dataset state** date (*Última actualización de los datos*) | **28 Sep 2026** |
| Record-level effective / reference date | **none** |
| Declared temporal coverage | **empty** |
| Historical snapshots / archive | **none published** |
| Previous states reconstructable | **no** |
| HTTP `Last-Modified` observed on the JSON resource | 28 Sep 2026 |

**The current published dataset state is dated 28 Sep 2026 by the official
portal**, so the state this audit observed *can* be cited honestly. What is
missing is everything longitudinal: no record carries an effective or reference
period, no temporal coverage is declared, and the file is **overwritten weekly
with no archive**, so a past state cannot be reconstructed or re-verified and a
future audit cannot reproduce today's figures.

That is weaker than a real reference date — the portal's state date describes
when the file was last refreshed, not the period the records describe — but it is
materially better than the Gate A catalogue's complete silence. It is graded
**CONDITIONAL**, not FAIL.

## External reconciliation — municipality control

The control dataset *Número de establecimientos hoteleros por tipo de
establecimiento. Municipios* (D.G. de Turismo y Hostelería, source *Almudena*)
was used because its **stated composition matches Candidate B's taxonomy**:
*"Hotel aparthotel + hoteles + hostales + campamentos + apartamentos + pensiones
+ casas rurales + hosterías + viviendas uso turístico"*. Its latest Madrid
municipality figures are for **2025**; Candidate B is a live 2026-09-28 state, so
the comparison is across different periods by construction.

It is used as **evidence, not as a target**: no Candidate B figure is adjusted
towards it. It is municipality-level and is **never** used to distribute counts
into barrios.

| Type | Candidate B (2026-09-28) | Control (2025) | Difference |
|---|---|---|---|
| Hotels | 340 | 334 | +6 |
| Hostales | 312 | 308 | +4 |
| Pensiones + casas de huéspedes | 546 | 482 | +64 |
| Apartamentos turísticos | 213 | 193 | +20 |
| Hoteles-apartamentos | 27 | 27 | 0 |
| Hosterías | 75 | 76 | −1 |
| Campings | 1 | 1 | 0 |
| **Non-VUT total** | **1514** | **1421** | **+93 (+6.5%)** |
| **VUT** | **4987** | **7065** | **−2078 (−29.4%)** |

**Classification:**

- **Non-VUT — plausibly compatible with temporal evolution; not fully
  reconciled.** +6.5% over roughly nine months, positive, and in the same
  direction as the control's own upward trend across the series (hotels
  324 → 334, pensiones 429 → 482 between 2024 and 2025). The two figures cover
  **different periods by construction**, so this gate cannot show that time alone
  accounts for the difference — only that the difference is small and consistent
  with it. These categories are close; they are not reconciled.
- **VUT — unexplained discrepancy.** Adding the 1117 Madrid records from the
  declarations dataset gives 6104, still 961 short. The control's own Madrid VUT
  series is volatile (12,727 in 2021 → 11,523 in 2024 → 7,065 in 2025), and a CM
  enforcement campaign de-registered around 3,000 dwellings across the region in
  2025, so the direction is contextually understandable — but the residual is not
  reconciled, and context is not evidence.

## The adjacent VUT declarations dataset

Inspected to interpret Candidate B's VUT semantics, **never merged into either
candidate**. It is a distinct legal universe: VUT that filed a responsible
declaration *without* inscription in the Registro de Empresas Turísticas. 1156
records region-wide, 1117 in Madrid, monthly, and — unlike Candidate B — it does
publish a historical archive. It carries **no identifier field at all**, so its
records cannot be deduplicated or tracked.

**Effect on interpretation:** material. It proves that "VUT known to the
Comunidad" is split across at least two legal states, so Candidate B's VUT count
is a *subset* of regionally-known VUT, not the whole. It does not close the gap
to the control.

## Candidate B decision

**MODIFY.** Not admissible as a barrio numerator in its current published state.
It is not a NO-GO: the geography problem — the one expected to be hardest — is
solved at 99.45% deterministically, the portal does date the current dataset
state, and the non-VUT categories come close to an independent official control.

**The decisive blockers are Unit (FAIL) and Universe (FAIL)**, with Madrid
filtering CONDITIONAL. Period is CONDITIONAL rather than FAIL — the current state
is dateable — but that does not lift the decision, because a numerator whose
unit of analysis and legal universe are both undeclared cannot be named honestly
however well it is dated or located.

What would have to change, in order of importance:

1. the publisher states the **legal universe** and whether entries are active;
2. the publisher documents **what one record represents** per section, or the
   subset is restricted to one granularity (e.g. HM/AM establishments only);
3. the publisher exposes a **record-level reference or effective date**, or
   publishes archived snapshots so past states can be reconstructed;
4. a **municipality code** is exposed, or `localidad` is confirmed stable.

If (1) and (2) were satisfied, the defensible name would be
**"Tourism-accommodation inventory entries per 1,000 registered residents
(Comunidad de Madrid inventory, non-VUT sections)"** — and not before.

---

# Hard-gate decision matrix

No score, no weighting. Each criterion is judged on evidence.

| Criterion | Candidate A | Candidate B |
|---|---|---|
| **Authority** — authoritative for the named universe | **PASS** — Agencia de Actividades, named unit, own schema document | **PASS** — D.G. de Turismo y Hostelería |
| **Unit** — is the unit of analysis known? | **PASS** — documented: row = licence; `Nº VUT` = units per licence | **FAIL** — undocumented, and observed to mix dwellings with establishments |
| **Identity** — stable record identity | **PASS** — `EXPEDIENTE_LU` 1025/1025 unique, 0 blank | **PASS** — `signatura` 8811/8811 unique, 0 blank |
| **Universe** — explicitly bounded | **PASS** — stated with exclusions named; all records `Conceder` | **FAIL** — not stated; registry status only inferred from a sibling dataset |
| **Madrid filter** — deterministic selection | **PASS** — municipal dataset, 1025/1025 verified inside the municipality | **CONDITIONAL** — exact `localidad` match is correct today; no municipality code published |
| **Geography** — reproducible to barrio | **PASS** — 1025/1025, agreed by three independent methods | **PASS** — 6465/6501 (99.45%) via the official address register, no geocoder |
| **Period** — representable honestly | **PASS** — observed HTTP `Last-Modified` file state + per-record grant dates; no declared reference date, and none claimed | **CONDITIONAL** — the portal dates the current dataset state (28 Sep 2026), so that state can be cited; but no record-level effective period, empty declared coverage, weekly overwrite, no archive, no reconstructable past state |
| **Completeness** — can state what is in and out | **PASS** — narrow and explicit; no retention policy published, so no stock claim is made | **CONDITIONAL** — non-VUT close but not reconciled (+6.5%, differing periods); VUT unexplained (−29.4%) |
| **Deduplication** — source-based and reproducible | **PASS** — none needed; `EXPEDIENTE` is identity | **PASS** — `signatura` is identity; address-based dedup proven wrong |
| **Indicator naming** — nameable without overstating | **PASS** — two exact names available | **CONDITIONAL** — "registered" and "establishments" both unsupported today |
| **Decision** | **GO** | **MODIFY** |

## Evidence family

Neither candidate was mechanically labelled `ADMINISTRATIVE_REGISTER`. Candidate A
is an **administrative licence** record — a granted urban-planning act — which is
not the same kind of object as the Padrón (a population register) even though
both are administrative. The current registry vocabulary
(`ADMINISTRATIVE_REGISTER` / `OBSERVED` / `REFERENCE` / `MODEL-DERIVED`) does not
distinguish *register* from *licence* from *declaration*.

**This gate does not redesign that taxonomy**, and deliberately adds no registry
entry (see below). Recorded as a decision for the indicator PR: a
`ADMINISTRATIVE_LICENSE` family, distinct from `ADMINISTRATIVE_REGISTER`, is
likely needed before this source is declared in `data/source_registry.json`.

---

# What this PR creates

## Numerator-only artifact (Candidate A)

`data/accommodation/madrid_vut_licences.json` + `.meta.json`, built by
`scripts/build_vut_licence_numerator.py`.

It carries, for all 131 canonical barrios plus derived district and municipality
totals:

- official geography ID and parent ID,
- `vut_licences` (COUNT) **and** `vut_units` (SUM), kept as separate fields,
- provenance, resource fingerprints, source state and grant-date span,
- the explicit universe, its exclusions and the currency caveat,
- the geography join outcome, including the one district-label disagreement.

Observed totals: **1025 licences, 1483 VUT units, 106 of 131 barrios covered.**

It contains **no ratio, no population, no rate, no density and no score** — a
test asserts those words do not appear anywhere in the artifact.

**Zero is a real zero here — within this source extract and its source state.**
This is the one place where this project's "missing is not zero" rule does not
apply: the extract enumerates granted activity-licence records across the whole
municipality, so a barrio with no matched source record receives **zero published
granted-licence records and zero source-reported VUT units**, rather than absent
data. It is **not** an assertion that no tourist-dwelling activity has ever
existed, or exists today, in that barrio. The scope and the reason are both
recorded in the artifact metadata.

**It is deliberately not declared in `data/source_registry.json`.** That registry
declares deployment roles, and this artifact has none: nothing builds it at deploy
time, nothing reads it, and no UI shows it. Registering it belongs to the PR that
introduces the indicator, together with the evidence-family decision above.

> **Superseded by the indicator PR, as planned.** The Area Profile now shows
> licensed VUT context, so the artifact is declared in the registry as
> `vut_licences`, evidence family `ADMINISTRATIVE_LICENSE`, and it blocks
> deployment. The two paragraphs above record what *this* gate decided and are
> left as written; see [`DATA_PROVENANCE.md`](DATA_PROVENANCE.md#licensed-tourist-dwelling-numerator-dataaccommodationmadrid_vut_licencesjson)
> and [`METHODOLOGY.md`](METHODOLOGY.md#licensed-vut-context--the-first-administrative-supply-indicator)
> for the current contract.

## Research package

`research/accommodation_gate_b/` — `audit_gate_b.py` plus the three JSON reports
it generates. Every count in this document comes from that script; none were
typed by hand. Raw upstream downloads are held in memory and not committed.

## Tests

`tests/test_vut_licence_numerator.py` — 35 network-free tests covering the
workbook trailer, unit parsing and its refusal to assume 1, district-label
folding, grant-date summarising, barrio aggregation, the DBF/SHP/XLSX readers,
and the committed artifact's contract (canonical coverage, exact aggregation,
source-derived period, and the absence of any ratio or population field).

# What this PR deliberately does not do

- **No UI.** No Area Profile metric, choropleth, radial chart, ranking,
  comparison delta or Lens metric.
- **No ratio.** No accommodation-per-resident figure is computed or published.
- **No tourism-pressure claim.** Not pressure, overtourism, carrying capacity,
  saturation, displacement, intensity, burden, impact or attractiveness. A
  supply-per-resident ratio would be descriptive context, not an outcome.
- **No population interpolation.** No population is touched, and nothing is
  spatially distributed into a Lens circle.
- **No change to the `stay` layer.** Madrid Destino listings, their builder,
  `runtime_poi.json` and their evidence contract are untouched. These are
  separate evidence families and are not merged.

# Remaining uncertainty

1. **Candidate A cannot say "operating," and cannot describe its own stock.**
   No revocation or expiry field exists and no retention policy is published, so
   licences granted in 2019 that have since ceased are indistinguishable from
   live ones — and it is unknown whether such licences are removed from the
   extract at all. The universe wording compensates by claiming only what the
   extract contains; the data cannot settle it.
2. **No reconstructable history for either source.** Both are overwritten in
   place with no archive. A 1 January 2026 numerator matching the Padrón
   reference date cannot be built, so any indicator must display two different
   periods — and neither source declares a reference period of its own.
3. **Candidate A has no external control.** The municipality control covers the
   regional inventory's categories, not municipal activity licences, so Candidate
   A's 1025/1483 is unreconciled against any independent total. Comparing it with
   Candidate B's 4987 Madrid VUT would be meaningless — different legal universes.
4. **Candidate B's VUT gap is unexplained** (−29.4% against the 2025 control,
   still −961 after adding declarations).
5. **`localidad` stability** in Candidate B is unguaranteed by the source.
6. **The evidence taxonomy** does not yet distinguish licence from register from
   declaration.

# Path forward

- **Candidate A → indicator PR.** Freeze the numerator contract, choose which of
  the two indicator names to publish (they are different indicators), add the
  `ADMINISTRATIVE_LICENSE` evidence family, declare the artifact in the source
  registry, and only then build UI — with both periods visible and the word
  *licensed* in the name.
- **Candidate B → revisit.** Re-audit if the publisher documents the universe or
  exposes a period. The reconciliation machinery built here is reusable as-is.
- **The address register is a reusable asset.** `datos.madrid.es` 213605 turns
  any address-only municipal dataset into a barrio-joinable one, deterministically
  and without a commercial geocoder.
