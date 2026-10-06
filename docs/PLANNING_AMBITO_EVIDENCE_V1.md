# Planning-ámbito evidence V1 — K6

Status: implemented by **K6 (#68)**, the first production increment that brings
official urban-planning evidence into the product. It ships under the source
contract [Gate L](URBAN_PLANNING_SOURCE_GATE_L.md) established and adds nothing
Gate L did not authorise.

Related: [Product semantics](PRODUCT_SEMANTICS.md),
[Information architecture V2](INFORMATION_ARCHITECTURE_V2.md),
[Visual language](VISUAL_LANGUAGE.md), [Methodology](METHODOLOGY.md),
[Data provenance](DATA_PROVENANCE.md),
[Claims and limitations](CLAIMS_AND_LIMITATIONS.md).
Code: `scripts/build_planning_ambitos.py`,
`scripts/build_ambito_development_state.py`, `js/planning-ambito.js`.

---

## 1. The question this answers, and the question it does not

For a place in Madrid, K6 answers exactly five things:

1. **Which official planning ámbito contains this point?** — its official
   denomination and its exact official code.
2. **What four published development-state values are associated with it?** —
   verbatim, as four independent fields.
3. **What available buildability does the latest authorised edition publish for
   it, by use class?** — in m² edificable.
4. **What is the reference date?** — the date the selected edition states about
   itself, shown with the figures.
5. **What does the evidence not allow the reader to infer?** — §12.

It answers nothing else. There is no overall stage, no progress, no change
between editions, no dwelling count, no parcel-level evidence, no licence
linkage and no apportionment of any figure into a Lens circle.

## 2. Source families

| Role | Source | Licence |
|---|---|---|
| **Geometry + identifier** | `Ámbitos Ordenación`, from the Geoportal-catalogued planning service (§6) | Ayuntamiento de Madrid general reuse conditions, with attribution |
| **S1 — development state** | `datos.madrid.es` **203200** *PGOUM 97. Estado de desarrollo de los ámbitos* | CC BY 4.0 |
| **S2 — available buildability** | `datos.madrid.es` **203182** *PGOUM 97. Edificabilidad remanente en ámbitos* | CC BY 4.0 |

**The split is binding.** Geometry and identifiers come from the catalogued
planning service; **every quantity and every state comes from the dated CC BY 4.0
editions.** No figure is ever taken from the undated geometry service, and no
figure is ever derived from a polygon's area.

Both artifacts are **committed and fingerprinted**. The browser makes no request
to `geoportal.madrid.es`, `sigma.madrid.es` or `datos.madrid.es` — a browser
regression observes every request the page makes and fails if one appears.

## 3. The current comparable era, and the boundary

Both families publish 15 dated editions from 2013 to 2026, but they are **not one
comparable series** (Gate L §6). The schema that K6 needs exists only in the
three most recent editions:

| Family | Current era | Editions in it | Superseded eras |
|---|---|---|---|
| **S1** | `S1_FOUR_PHASE_FLAT` | 2025-01, 2025-07, 2026-01 | `S1_SINGLE_STATE_PER_DISTRICT` (2013–2024): one `Estado de Desarrollo` column across 21 district sheets |
| **S2** | `S2_SPLIT_RESIDENTIAL_FLAT` | 2025-01, 2025-07, 2026-01 | `S2_VAC_CODORD` (2013–2014), `S2_SINGLE_RESIDENTIAL` (2015–2019), `S2_COLECTIVA_UNIFAMILIAR` (2020–2024) |

The builder selects **within the current era only** and refuses an out-of-era
edition rather than parsing it as equivalent evidence. A cross-era edition is not
"older data about the same thing": it is a different table about a differently
structured universe, and differencing across the boundary is barred.

The selected editions at the time of writing are both **1 January 2026**:
`S1:2026-01:585db074c122` and `S2:2026-01:326edf48d221`.

## 4. Edition selection

> **"Latest" is the newest *stated reference date* within the current schema
> era — never the highest resource id, never the resource name, never the
> filename and never the catalogue position.**

The reference date is read **from inside the file**: the
`Estado del desarrollo a fecha` column, an Excel serial converted with the
workbook's own datemode, which the publisher's structure document confirms is the
*Fecha recogida de los datos*. The publisher states a calendar day, so the day is
kept: the precision is the publisher's, not ours.

**Why this matters.** Gate L §6 proved the resource-id order is *not*
chronological — S1 shows 72 id/date inversions and S2 shows 42. `203200-15` is
Enero 2026 while `203200-16` is Enero 2025. The discredited "latest = highest id"
heuristic therefore returns the **earliest** current-era edition. The builder
records what that heuristic would have chosen
(`edition_selection.resource_id_heuristic_would_select`), and a regression test in
both suites asserts that it disagrees with the reference-date rule and would pick
an earlier edition. This can never silently regress to the original Gate K
assumption.

**Snapshot identity** is `family : reference_date : sha256[:12]`. A resource id is
not identity, a filename is not identity and a month label is not identity.

**Schema drift fails the build.** The selected edition's header must equal the
pinned column tuple exactly, in order, with exactly one sheet. There is no fuzzy
header matching, no index shifting and no silently dropped field: a column that
moves, disappears or changes incompatibly stops the build so a reviewer sees it.

## 5. The four published phase fields

| Key | Publisher's column |
|---|---|
| `planeamiento` | `Estado de desarrollo. Planeamiento` |
| `gestion` | `Estado de desarrollo. Gestión` |
| `urbanizacion_proyecto` | `Estado de desarrollo.Urbanización. Proyecto` |
| `urbanizacion_obras` | `Estado de desarrollo. Urbanización. Obras` |

### 5.1 Four fields, not one stage — binding

Gate L §12 measured the four columns as **multi-dimensional and empirically
non-funnel**: a "later" phase is advanced while an "earlier" one is not in nine
cases, and the publisher's structure document documents **no ordering at all**.
The verdict is `MULTI_DIMENSIONAL_NO_SCALAR_STAGE`.

Therefore **nothing in this product derives** an overall stage, a stage number, a
progression, a percentage, a completion figure, advancement, delay, a timeline, a
progress bar or an overall status. The field order above is the publisher's column
order and carries **no rank**; no function indexes into it to find a "current" or
"furthest" phase. The artifact, the pure model and the interface are each tested
for the absence of such a key, and the interface is tested for the absence of a
`<progress>` element, an `aria-valuenow`, a percent sign, an ordinal number and a
sequence arrow.

No single badge summarises the four. Each renders as its own labelled row.

### 5.2 Documented vs observed vocabulary

| Value | Documented by the structure PDF (v. Nov 2025)? | Kind |
|---|---|---|
| `Sin Iniciar` | yes | phase value |
| `En tramitación` | yes (as `En Tramitación`) | phase value |
| `Finalizado` | yes | phase value |
| `En Ejecución` | **no — observed only** | phase value |
| `No Necesita` | yes (as `No necesita`) | **unresolved meaning** (§5.3) |
| `PGOUM-85` | yes (as `PGOUM 85`) | **plan-of-origin marker** (§5.4) |
| `PGOUM-97` | yes (as `PGOUM 97`) | **plan-of-origin marker** |

Values are carried **verbatim**. Observed spelling and punctuation drift —
`En  Tramitación`, `Finalizada`, `Finalizadas`, `FinalizadaS`, the `PGOUM-85`
hyphen — is recognised as a *variant of a documented value* for presentation
metadata only; the verbatim `source_value` is always what the artifact stores and
the interface shows. `En Ejecución` is labelled
`SOURCE_OBSERVED_NOT_DOCUMENTED` and the interface says so beside it, rather than
quietly promoting it to documented vocabulary.

### 5.3 `No Necesita` — meaning unresolved

The publisher **lists** `No Necesita` as an expected value but **never defines
it** (Gate L §13). Its status is therefore
`SOURCE_OBSERVED_INTERPRETATION_UNRESOLVED`, and:

- it is carried **verbatim** and kept structurally distinct from `Sin Iniciar`;
- it is **never** rendered as, mapped to, or equated with **"no aplica"**, "not
  applicable", `Sin Iniciar`, **zero**, unavailable, "complete" or "skipped";
- the interface adds only a neutral product explanation: *"the publisher lists
  this as a distinct state; its precise meaning is not defined in the audited
  documentation."*

This **corrects** the pre-Gate-L issue text, which proposed rendering it as
"no aplica". A test asserts the phrase appears nowhere in the product.

### 5.4 `PGOUM-85` / `PGOUM-97`

These are **plan-of-origin markers occupying phase cells** — 42.4 % of all phase
cells (Gate L §11). They are not progress states, not ordered states and not
errors. They survive verbatim and receive the reserved neutral origin-marker
treatment with a distinct structural mark.

### 5.5 Visual treatment (K5)

Neutral categorical distinction only. The three reserved planning hues
(`--planning-neutral`, `--planning-origin`, `--planning-unresolved`) never reuse a
Lens identity colour, and each is **paired with a border style and a text label**,
so no distinction rests on colour alone:

| Kind | Rule style | Label |
|---|---|---|
| phase value | solid | the verbatim value |
| `UNRESOLVED_MEANING` | **dashed** | verbatim value + the unresolved-meaning note |
| `PLAN_ORIGIN_MARKER` | **dotted** | verbatim value + the marker note |

No light-to-dark, red/amber/green, cold-to-warm or progressively heavier
sequence; no ordinal number; no arrow; no completion bar.

## 6. Geometry: source, reuse route and the STOP condition

Gate L §20 returned **MODIFY** on geometry reuse: the audited ArcGIS layer
`AMBITOS_PLANEAMIENTO_URBANISTICO` asserts an attribution string but **no licence
and no reuse statement**, and public reachability is not a reuse grant
([Product semantics §6](PRODUCT_SEMANTICS.md)).

K6 therefore verified the **catalogued** route before committing anything.

### 6.1 Catalogue identity

| Field | Value |
|---|---|
| Catalogue | Geoportal del Ayuntamiento de Madrid (IDEAM) |
| Record | *Planeamiento Urbanístico. Modificaciones y desarrollos del PGOUM de 1997.* |
| Record URL | `geoportal.madrid.es/IDEAM_WBGEOPORTAL/dataset.iam?id=ca62bee0-8ce1-11e9-90e1-dc4a3e81fab6` |
| Metadata contact | Ayuntamiento de Madrid. A.G. Urbanismo, Medio Ambiente y Movilidad. SG de Innovación e Información Urbana |
| Resource contact | …Dirección General de Planeamiento |
| Declared CRS | EPSG:25830 |
| Reuse limitation field | links to the Ayuntamiento's general reuse conditions |
| Download service | OGC **WFS 2.0.0**, feature type `PLANEAMIENTO_URBANISTICO:Ámbitos_Ordenación` |
| Visualisation service | ESRI REST, layer 2 of the same planning service |

### 6.2 Route equivalence — measured, not assumed

The builder compares the catalogued WFS download against the Gate-L-audited
service on **every** axis the issue requires, and **fails the build** rather than
substituting one for the other:

| Compared | Result |
|---|---|
| Identifier fields | `AMB_TX_ETIQ` / `AMB_TX_DENOM` (REST) = `Etiqueta` / `Denominación` (WFS aliases) |
| Feature count | 765 = 765 |
| Distinct codes | 765 = 765 |
| Code + denomination set | identical |
| Vertices | 291,407 = 291,407 |
| Per-code vertex sets | identical to 1 mm on every code |
| `-RP` codes | 20 = 20, identical sets |
| Valdecarros pair | `UZP.3.01` absent and `UZPp.03.01-RP` present in both |
| Exact S1 join | 666 / 667 on both |
| Exact S2 join | 230 / 230 on both |
| Encoding | WFS emits `MultiPolygon` for every feature; REST emits `Polygon` for a single-part feature. A GeoJSON encoding difference, **not** a geometry difference, and the vertex-set comparison is insensitive to it. |

**Verdict: `AUTHORITATIVE_EQUIVALENCE_ESTABLISHED`.** The catalogued route is the
same authoritative geometry, so preferring it is not a substitution.

If the routes had differed, the builder would have stopped with
*"STOP — geometry provenance/reuse unresolved"* and committed nothing. The
deployment validator independently refuses any geometry artifact whose sidecar
does not record `route_equivalence.equivalent: true`.

### 6.3 Reuse basis and attribution

The Geoportal record's *Limitaciones de acceso público* field points to the
[Ayuntamiento's general reuse conditions](https://datos.madrid.es/pages/condiciones-generales-ayuntamiento-de-madrid),
which expressly authorise reuse — copying, dissemination, modification,
adaptation, extraction, reordering and combination — for commercial and
non-commercial purposes. The obligations, and how K6 meets each:

| Obligation | How it is met |
|---|---|
| Cite the source | `Origen de los datos: Ayuntamiento de Madrid` (with the resource authority) in the artifact metadata and the source registry |
| State the last-update date where the original carries one | the publisher declares **none** for this geometry, recorded as an explicit null rather than back-filled |
| Do not distort the meaning | geometry and identifier only; no quantity and no state is read from this service |
| Do not imply municipal endorsement | nothing in the product does |
| Preserve update-date and reuse-condition metadata | carried in `madrid_ambitos.meta.json` and in `data/source_registry.json` |

**One recorded observation, not corrected:** the WFS capabilities document's own
`ows:AccessConstraints` URL (`datos.madrid.es/egob/catalogo/aviso-legal`) returned
**HTTP 404** when checked on 6 October 2026. The Geoportal catalogue record's
reuse-conditions link resolves, and is therefore the authoritative reuse pointer
used here. The dead link is recorded in the artifact metadata.

### 6.4 Freshness

The layer exposes **no `editingInfo`, no `lastEditDate`, no cadence**. Geometry
therefore carries `reference_date: null`, `published_at: null`,
`update_frequency: NONE_DECLARED` and
`source_state: NOT_DECLARED_BY_PUBLISHER`. The null is **known absence** and is
never back-filled from the HTTP `Last-Modified` header, the catalogue record's own
*Fecha Creación* (2026-03-05, which dates the **metadata record**, not the
geometry) or the retrieval clock. The HTTP validators and the response SHA-256 are
recorded as an `observed_resource_state`, which describes the file **as served**
and must never be presented as a reference date.

The interface therefore shows **no date for the geometry at all**. The date it
shows belongs to the XLS editions, which are a different source with different
temporal semantics.

## 7. The mixed universe, and the authorised filter

The service serves **765 features and is not "765 ámbitos"** — that phrasing is
prohibited. It mixes planning ámbitos with land-classification records. The
builder classifies **every** record by its exact official code:

| Class | Count | Rule | Disposition |
|---|---:|---|---|
| `PLANNING_AMBITO` | **724** | a documented ámbito code family (`APE`, `API`, `APR`, `AOE`, `AOD`, `AE`, `UZP`, `UZPp`, `UZI`, `UNP`, `UNS`, `US`) anchored at a dotted separator | **included** |
| `NORMA_ZONAL_GRADE` | 34 | purely numeric dotted code, optionally with a level letter (`4`, `1.1`, `3.1.b`, `7.2.e`) | excluded — a zoning grade applied across the city, not an ámbito; no edition publishes a row for one |
| `NON_DEVELOPABLE_LAND_CLASS` | 7 | `NUC`, `NUP.1` … `NUP.6` | excluded — a land classification, not an ámbito |
| `UNCLASSIFIED_SOURCE_RECORD` | **0** | anything else | **FAILS THE BUILD** |

724 + 34 + 7 = 765. Every excluded record's **code, count and reason** is recorded
in `madrid_ambitos.meta.json`. Nothing is discarded silently and nothing is
admitted silently: a code the builder cannot classify stops the build.

**A correction to Gate L.** Gate L §17 reported a provisional 723 / 18 / 24 split.
Its prefix regex omitted the `US` family, so `US.04.10-RP` (SOLANA DE VALDEBEBAS)
fell into "other" — although the S1 estado edition publishes a **full row** for
that code (district 16 Hortaleza, Residencial, 1,096,164 m², four phase values).
It is a planning ámbito on the publisher's own evidence and is included. The 41
excluded records are all land-classification records.

**Why the universe is the 724 ámbito-like features and not "the codes present in
an edition":** 58 of them have geometry but no S1 row — the published annex
*Ámbitos del PGOUM que no son objeto de seguimiento* names court annulment,
instrument re-ordering, cession to other municipalities, deadline prescription and
historic colonies as reasons. They are **real published ámbitos**. Excluding them
would make the product answer "no planning ámbito here" for a place that *is*
inside one — a false negative about the geometry source. Instead they are included
with an explicit `NOT_PUBLISHED_IN_EDITION` state (§9).

### 7.1 Payload

The raw response is ~10.4 MB / 291,407 vertices. Filtering to the ámbito-like
universe removes **52 % of all vertices** (the zoning grades are large multi-part
polygons covering whole zones): the committed artifact is **3.49 MB / 140,507
vertices**. **No geometry is simplified** — `simplification: NONE`,
`vertices_removed: 0` — so topological containment is provably unchanged.
Coordinates are rounded to 7 decimal places (~1.1 cm), a precision policy that
removes no vertex, identical to `scripts/build_madrid_geography.py`.

## 8. CRS

| | |
|---|---|
| Source | **EPSG:25830** (ETRS89 / UTM zone 30N) |
| Confirmed from | the WFS capabilities `DefaultCRS`, the GetFeature response's own declared CRS, the REST service metadata `spatialReference.wkid`, and the Geoportal record's CRS field |
| Target | **EPSG:4326** |
| Transformation | `pyproj` `Transformer.from_crs("EPSG:25830", "EPSG:4326", always_xy=True)` — explicit, client-side, deterministic |
| **Verification** | the builder fetches the same features with `outSR=4326` from the catalogued REST layer — the **publisher's own server-side transform** — and compares every vertex. Observed maximum deviation: **1.0 × 10⁻⁹ degrees** over 140,507 vertices, against a 1 × 10⁻⁶ tolerance. |

The builder **fails** if the response declares a CRS other than EPSG:25830, and
**fails** if its own transform disagrees with the publisher's beyond tolerance. No
CRS is ever guessed and no datum disagreement is rounded away.

## 9. Available buildability

**Terminology.** The dataset is titled *edificabilidad remanente*, but the
publisher's structure document defines the quantity as *edificabilidad
**disponible***: *"edificabilidad disponible para los usos lucrativos Residencial,
Servicios Terciarios e Industrial en los ámbitos de ordenación vigentes … según la
situación del ámbito."* The product therefore says **available buildability /
edificabilidad disponible**, and never "remaining to be built", "yet to be
constructed", "construction remaining" or "development remaining".

| Use class | Publisher's column | Unit |
|---|---|---|
| `colectiva_residencial` | `Colectiva. Edif. Residencial` | m² edificable |
| `unifamiliar_residencial` | `Unifamiliar. Edif. Residencial` | m² edificable |
| `industrial` | `Edif. Industrial` | m² edificable |
| `terciario` | `Edif. Terciario` | m² edificable |

**Every figure carries its unit, its whole-ámbito scope and the edition's
reference date.** The unit lives in the same object as the value, so there is no
shape in the artifact or the model that can hold a bare number.

### 9.1 Zero, blank and absent are three different facts

| Source | Artifact state | Interface |
|---|---|---|
| a published `0` | `PUBLISHED`, `value: 0` | `0 m² edificable` |
| a **blank** cell | `NOT_PUBLISHED`, `value: null` | **"not published"** — never `0` |
| non-numeric text | `NOT_PUBLISHED_NON_NUMERIC`, the text kept verbatim | "not published" |
| **no row for the ámbito** | `availability: NOT_PUBLISHED_IN_EDITION` | an explicit sentence, never `0` |

Nothing falls back to `0`, and no empty string is ever an evidence state. The
edition itself distinguishes blank from zero, and so does the product.

**One recorded observation:** the 2026-01 and 2025-01 editions publish **blank**
cells where the 2025-07 edition publishes `0`, within the same schema era. This is
recorded as an observed publisher difference with cause unresolved; it is **not**
normalised away.

### 9.2 Several published rows for one ámbito

The publisher reports buildability *según la situación del ámbito*, and the
selected edition does publish **more than one row** for some codes (239 rows
across 230 distinct codes). Every row is preserved separately with its own
`SITUACION DEL ÁMBITO`, and the rows are **never summed, averaged, reconciled or
otherwise combined** — an ámbito total across published rows is a derived quantity
the sources do not state. The multiplicity is classified:

| Class | Meaning |
|---|---|
| `SINGLE_PUBLISHED_ROW` | one published row |
| `MULTIPLE_PUBLISHED_ROWS_NOT_COMBINED` + `DISTINCT_PUBLISHED_SITUACION` | the rows differ by situación, which the publisher documents as the reporting dimension |
| `MULTIPLE_PUBLISHED_ROWS_NOT_COMBINED` + `CAUSE_UNRESOLVED` | the rows are not distinguished by situación, and the source states no cause |

**A finding beyond Gate L.** Gate L measured the S2 join as a code *set*, which
hid the duplication. The 2026-01 S2 edition publishes **seven Barajas ámbitos
twice**, once with `COD_DISTRITO` 20 and once with 21, while naming the district
`BARAJAS` in both (Barajas is official district 21), and some of those row pairs
**disagree numerically** — `UZP.1.01` publishes 4,510 m² industrial in one row and
8,280 m² in the other. `CAUSE_UNRESOLVED` is a valid publishable verdict: both
rows are shown verbatim, no row is preferred, merged or corrected, and no single
figure is published for the code. District attribution is read from **S1 only**,
which carries no such anomaly.

### 9.3 No dwelling count — binding and permanent

S2 **does** publish `Colectiva. Nº Viviendas` and `Unifamiliar. Nº Viviendas`,
documented as *"Nº de viviendas disponibles … en unidades"*. Gate L §16 measured
their values as exactly **residential buildability ÷ 100**, at a match rate of
1.0 across every row, and **fractional** (163.167, 2,115.35, 42.222). They are a
mechanical m²/100 proxy at an assumed 100 m² per dwelling, **not a count of
dwelling units**. No protected-housing count column exists at all.

The builder **reads and counts** those columns — so the exclusion is an observed
fact in the build record — and then **drops them by name**. Buildability ships in
**m² only**. Nothing in the artifact, the model or the interface shows homes,
housing units, dwellings or protected dwellings, no key is named for one, and the
builder contains no `÷ 100` divisor through which one could be reconstructed.
Tests in all three suites enforce this.

## 10. Identifiers and joins

> **Exact official code, always. No normalisation, ever.**

No case folding, no padding, no trimming, and above all **no stripping of a `-RP`
suffix**. Gate L §21 established that `-RP` marks a distinct **Revisión Parcial**
ámbito: `UZP.3.01` (Valdecarros) is listed by the structure annex as **annulled by
court sentence**, while `UZPp.03.01-RP` is its **active replacement**. Merging them
would attach an annulled ámbito's identity to its successor. Gate L also measured
that normalising codes **reduces** S1 exact matches by 2, so normalisation is
rejected on evidence, not only on principle.

| Join | Table codes | Matched | Rate | Table-only | Geometry-only |
|---|---:|---:|---:|---:|---:|
| **S1** (2026-01) | 667 | **666** | 99.85 % | 1 (`APE.21.10`, Recinto Ferial) | 58 |
| **S2** (2026-01) | 230 | **230** | 100 % | 0 | 494 |

This reproduces the Gate L §17 baseline exactly. **Nothing disappears silently:**

- **table-only** codes are named in the join report. They are *not* in the
  production universe, because the geometry carries no polygon for them, so they
  cannot be rendered as a place at all.
- **geometry-only** ámbitos stay in the production universe with an explicit
  `NOT_PUBLISHED_IN_EDITION` state (§7).

The deployment validator refuses a join that is not `EXACT`/`NONE`, that falls
below the registry's expected match counts, or that does not list its unmatched
records.

## 11. Scope, and the no-apportionment guarantee

Two scopes, never merged and never carried by one value:

| Scope | What it describes |
|---|---|
`PLANNING_AMBITO` | **one whole ámbito.** Every published state, the surface and every buildability figure. |
`LENS_INTERSECT_AMBITO` | **membership only:** *which* ámbitos a Lens circle touches. |

`LENS_INTERSECT_AMBITO` may answer *"which ámbitos does this Lens circle
touch?"*. It may **not** answer *"what share of the buildability lies inside the
circle?"* — there is no proportional, area-weighted or population-weighted
allocation, and no quantity apportionment of any kind.

**This is guaranteed structurally, not by convention** (`js/planning-ambito.js`):

1. `ambitosIntersecting` returns, per touched ámbito, only its code, its
   denomination and a boolean — **no overlap area, no fraction, no weight, no
   quantity**. The only numbers in the whole result are the circle's own centre,
   its radius and the count of touched areas, all properties of the circle. A
   test enumerates every numeric leaf and asserts exactly that set.
2. The quantity readers `developmentState(code, artifact)` and
   `availableBuildability(code, artifact)` accept **no geometry parameter at
   all**, and **throw** if handed an object carrying a radius, a centre or a
   coordinate. Extra positional arguments are ignored.
3. `geometryIntersectsCircle` in `js/geography.js` — the shared predicate — returns
   a **boolean**, never a measure, so no caller can obtain an overlap from it.
4. No exported name matches apportion / allocate / distribute / weight / share /
   proportion / fraction / density / per-area / overlap / total / sum, and the
   module contains no such arithmetic.
5. `crossScopeArithmeticAllowed` (K2) refuses to combine the two scopes without a
   documented basis, and geometric overlap is explicitly not a basis.

A developer would have to **add a new function** to introduce apportionment.

Containment itself reuses `pointInGeometry` and `geometryIntersectsCircle` from
`js/geography.js`: there is deliberately **no second point-in-polygon or
circle-intersection implementation** in the project, and a test asserts
`js/planning-ambito.js` contains no ray-casting or distance maths of its own.

## 12. Interpretation ceilings

Carried verbatim on every value, in both readings, in both languages:

1. **Published planning state is not proof of physical construction progress.**
   `PLANNING_STATE_TRANSITION ≠ PHYSICAL_URBAN_CHANGE`. A phase value is an
   administrative state.
2. **Available buildability is not an estimate of what will necessarily be
   built.** It is what the plan makes available, for currently-valid ámbitos,
   according to situación.
3. **The four phase values do not form one overall completion stage.** They are
   multi-dimensional; no stage, progression, percentage, completion or timeline
   exists.
4. **No dwelling count is inferred.** Buildability is m² only.
5. **No Lens-circle apportionment is performed.** Every figure describes the whole
   ámbito.
6. **Geometry and dated quantities come through distinct official source
   routes**, with different licences and different temporal semantics; the two
   are never presented as one shared period.
7. **`No Necesita` has no official definition** and is never equated with
   anything.
8. **`PGOUM-85` / `PGOUM-97` are plan-of-origin markers**, not progress states.
9. **One edition only.** No edition-to-edition difference, trend or change is
   published here; that is #69's work, and only within one schema era.
10. **The geometry's currency is unknown**, because the publisher declares no date
    for it, and it is never inferred from a retrieval time, a catalogue date or an
    HTTP header.

## 13. Artifacts, builders and gates

| File | Produced by | Contents |
|---|---|---|
| `data/planning/madrid_ambitos.geojson` | `scripts/build_planning_ambitos.py` | 724 ámbito polygons in EPSG:4326, each with its exact official code, denomination and record class |
| `data/planning/madrid_ambitos.meta.json` | same | catalogue identity, retrieval route, reuse basis and obligations, freshness, CRS and its verification, route equivalence, universe and exclusions, identifier contract, fingerprint, ceiling |
| `data/planning/madrid_ambito_state.json` | `scripts/build_ambito_development_state.py` | per ámbito: four phase values, characteristic use, surface, available buildability by use class, plus both edition identities |
| `data/planning/madrid_ambito_state.meta.json` | same | edition selection and the resource-id counter-example, schema assertion, phase vocabulary, buildability semantics, the dwelling-proxy exclusion, aggregate-row guard, joins, baselines, fingerprint, ceiling |

Both builders are deterministic: a rebuild produces a **byte-identical** artifact
(features sorted by exact code; canonical JSON for every fingerprint; integral
values stored as integers so a fingerprint computed in Python verifies in Node).

**Build dependencies** are pinned in `scripts/requirements-build.txt`
(`requests`, `xlrd==2.0.2`, `pyproj`, `shapely`) and imported **lazily**, so both
builders stay importable — and their pure logic stays testable — with the standard
library alone. None is a runtime or test dependency, and none is in `package.json`.

**Aggregate `Total` rows.** A `Total` row never enters the artifact. The current
editions carry **none** — the guard found nothing to exclude — and the guard is
kept and tested anyway, because an aggregate row in a per-ámbito artifact would
publish a city total as one place's figure.

`scripts/validate_deployment.mjs` gates both artifacts at publication time and
fails on: a missing or empty artifact, a count below the ingestion guardrail, a
collapsed ring, a projection leak, a non-`PLANNING_AMBITO` record, a duplicate
code, a missing sidecar field, a **recomputed fingerprint mismatch**, an
unestablished route equivalence, an unverified reprojection, a recorded
simplification, an unclassified source record, a back-filled reference date, a
scope mismatch, a cross-era edition, a missing stated reference date, a drifted
edition identity, a phase count other than four, a bare buildability number, an
unpublished cell carrying a value, an aggregate `Total` row, a forbidden
stage/dwelling key, and a join collapse.

## 14. The product surface

Inside K4's PLACE mode, as a **second lead-level evidence object** below the
administrative area — the map stays primary and the reading order is unchanged:

- **Identity:** the official denomination and the **exact official code**, under
  an explicit *Planning ámbito* label and the sentence *"An official planning
  area. It is not the barrio, not the district and not the Lens circle."* The
  ámbito, the barrio, the district and the Lens circle stay four distinct
  geometries and are never concatenated into one place string.
- **The edition reference date**, visible **with** the evidence — a reader never
  has to open a dialog to learn which dated edition the states come from.
- **The four phase fields**, as four independent labelled rows (§5).
- **Characteristic use, published surface and the edition's district**, as named
  fields.
- **Available buildability** by use class, each figure with its unit and a
  whole-ámbito scope chip reading *"Whole planning ámbito — not the Lens circle."*
- **A citizen reading** (`What this means`) that foregrounds without changing a
  value, a unit, a state, a scope or a ceiling, and that states what cannot be
  concluded in the same breath as what can.
- **The interpretation ceiling**, always visible, never the first thing hidden.
- **Lens ∩ ámbito**, inside PLACE's existing Detail disclosure: a membership
  list, computed only while the disclosure is open, carrying no quantity.

**The rail** shows the real planning scope and the ámbito's own code — or the
explicit absence — and adds `LENS_INTERSECT_AMBITO` only while that surface is on
screen. **The evidence drawer** is the existing registry-driven K4 one: there is
no second planning provenance modal, and both planning sources' ceilings appear
verbatim in the citizen and the analyst readings.

**The map** draws **only the containing ámbito**, on its own `planningPane`, in
the reserved neutral planning family with a dashed stroke and a very light fill.
It never reuses a Lens identity colour and the stroke never encodes a phase: the
polygon supports orientation, scope recognition and selection, not evaluation.
724 polygons at once would be wallpaper, not orientation.

**Language.** All product-authored planning copy exists in EN and ES. Official and
publisher-controlled values — the code, the denomination, every phase value, every
situación, the unit `m² edificable` — sit under `data-verbatim` and are identical
in both languages. `No Necesita` is never translated into an inferred meaning.

**Rounding.** Displayed buildability keeps at most two decimal places and a
displayed surface is shown in whole m²; the figures are labelled as rounded and
each published value is carried in full in the artifact and reachable through
Evidence & limits. No precision is invented and no missing value becomes a number.

## 15. Out of scope for K6

No change detection (#69), no urban-licence or address linkage (#70/#71), no
parcel-level evidence (`MCPG_Madrid_Crece` remains NOT YET per Gate L §22), no
public works, no execution units, no development-stage polygons, no ranking,
scoring or ordering of ámbitos, and no runtime-stack migration (#74 owns that).
