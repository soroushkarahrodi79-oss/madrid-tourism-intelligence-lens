# Gate K — Madrid Urban Decision Workspace

**Status:** CLOSED
**Decision:** **GO — OPTION B (BOUNDED)**. Reposition the product as an *urban development evidence lens* for Madrid; retain tourism as one documented domain rather than the organising frame.
**Date:** 5 October 2026
**`origin/main` inspected:** `42773bc69bcb8ff98b1019884f4ac7692abac937`
**Repository state at gate open:** 0 open pull requests, 0 open issues, 60 merged pull requests, latest merge PR #60 (Spatial Window Sensitivity V1). Node suite: 522 tests, 522 passing.

This gate adds no dataset, no production dependency, no indicator, no score, no ranking and no
production UI. It is a product-boundary and sequencing decision, plus the research contract that
the next gate must close before any urban-planning evidence reaches production.

---

## 1. Current product diagnosis

The project is no longer short of defensible evidence. It is short of a **coherent reading order**.

### 1.1 What is genuinely strong

- **Source discipline is the project's real asset.** `data/source_registry.json` (contract 1.0.0,
  15 sources) already declares, per source: authority, dataset URL, builder, artifact,
  `role`, `provenance_state`, `evidence_type`, `expected_spatial_scope`,
  `source_period_exposed_by_source`, `source_period_semantics`, `integrity_guardrail` and an
  explicit `interpretation_ceiling`. `data/deployment_manifest.json` records `generated_at`,
  `commit`, `build_state`, per-layer `state`, `record_count`, `source_period` and
  `source_period_known`, and a blocking validator (`scripts/validate_deployment.mjs`) stands
  between a degraded build and the public site.
- **Scale separation is already explicit and already tested.** Three analytical objects are kept
  apart by construction: the Lens circle, the whole official barrio, and the whole municipality.
  `js/destination-context.js` has no parameter through which a coordinate could reach it — the
  separation is structural, not a label.
- **The comparison machinery is domain-neutral.** Radial Halo V3, Comparison Bridge, Decision
  Insight and Spatial Window Sensitivity all read one authoritative comparison state, abstain
  rather than guess, keep `0` / `N/A` / `OFF` / `withheld` distinct, and carry no score, ranking
  or recommendation. None of this logic is about tourism.
- **Prior gates produced reusable methodology**, not just decisions: era-aware geography keys
  (`{era}:{code}`), snapshot identity as *family + period + fingerprint*, status ≠ taxonomy,
  `STATUS_TRANSITION ≠ BUSINESS_EVENT`, and "cause-UNRESOLVED" as a publishable state.

### 1.2 What is genuinely broken

**(a) The navigation lies about the product's structure.**
`index.html:20` renders `<button class="active">Explore</button>` with **no `id` and no handler
anywhere** — it is permanently highlighted chrome that does nothing. `navCompare`
(`js/app.js:3411`) toggles Lens B. `navEvidence` (`js/app.js:3412`) switches on the HATI layer and
flies the camera to the pilot bounding box. So a control that reads as a three-mode information
architecture is in fact one dead button and two unrelated actions. Every mode decision in this
gate has to start by admitting that the product has **no mode system at all**.

**(b) One scroll column carries eleven competing surfaces.**
The right panel stacks, in order: status badge, lens A/B bar, pedestrian card, Administrative area
(with a nested licensed-VUT block and a compact "other lens" block), Hospitality & Commercial
Context (with its own metric selector and scale), "Within the Lens" metrics, the radius/time/reset
control box, Category mix + Nearest list, the Lens A↔B block (radius readout, mode cue, Comparison
Bridge, Decision Insight, Spatial Sensitivity, halo toggle, halo legend, comparison table,
evidence line), Destination Context (metrics, composition, ceiling, Domestic origins with a month
selector and a table, Monthly origin dynamics with a summary, a shared table and two `<details>`
transition tables), and a source footer. Controls and results interleave throughout: the radius
slider sits *between* the lens metrics and the category mix, so changing the analytical window
requires scrolling past the result it changes.

**(c) Provenance is the first thing deleted on small screens.**
Under `@media(max-width:850px)` — which includes iPad portrait — `css/app.css` hides
`.mix`, `.source`, `.area-source-toggle`, `.area-source-details`,
`.hospitality-methodology-link`, `.evidence-note`, `.layer-source-note`, `.metric-foot` and
`.nav`; under 560px it also hides `.heat-scale` and `.scale-labels`. The panel is capped at
`42dvh` (`44dvh` on short screens). The net effect is that on a phone or an iPad in portrait the
reader loses the source footer, the "Source & interpretation" disclosures, the methodology link,
the HATI evidence ceiling, the per-metric scope hints **and** the Compare/Evidence entry points,
while keeping every number. For a product whose whole claim is that the ceiling is part of the
claim, this is a methodological defect, not a cosmetic one.

**(d) There is no typographic system.**
`css/app.css` contains roughly **55 distinct `font-size` values**, including 6.6, 6.8, 7, 7.2,
7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 8, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 9, 9.3, 9.4 and 9.5 px.
Differences of 0.1–0.2 px cannot encode hierarchy; they only record the order in which features
were added. Most secondary and qualifying text — exactly the text that carries the interpretation
ceiling — sits between 7 and 8.6 px.

**(e) Language is split mid-panel.**
`js/i18n.js` defaults to `es`; the Hospitality & Commercial Context renders in Spanish
("Contexto administrativo", "Métrica", "Periodo de referencia") inside an otherwise English
panel, while the Comparison Bridge deliberately follows the document language rather than
`languageSelect`. One surface is bilingual, the rest is not.

**(f) Monolithic wiring.**
`js/app.js` is 3,752 lines with a single dynamic `import()` (`i18n.js`) and otherwise global
script loading with manual cache-busting query strings (`?v=20261005-53`). The pure models are
properly separated and tested; the view layer is not modular. This is the main cost driver for
any new surface.

### 1.3 The diagnosis in one sentence

The product has excellent *evidence semantics* and no *reading architecture* — and the frame it
is named for (tourism) is no longer where its strongest evidence lies.

---

## 2. Current architecture inventory

| Element | State at `42773bc` |
|---|---|
| Runtime | Static site, no build step. Vendored **Leaflet 1.9.4** (`assets/leaflet/`), `preferCanvas: true`, dedicated `L.canvas()` renderers per pane (admin lattice, active area, hospitality). No framework, no bundler. |
| Entry | `index.html` (412 lines), `css/app.css` (624 lines), 15 files in `js/` (7,487 lines total; `app.js` 3,752). |
| Pure tested models | `lens.js` (geometry/stats), `radial-halo.js` (1,162 lines), `evidence.js`, `geography.js`, `area-profile.js` (667), `destination-context.js` (568), `domestic-origin-context.js`, `domestic-origin-dynamics.js`, `hospitality-context.js`, `clustering.js`, `i18n.js`. |
| Evidence registry | `data/source_registry.json` — contract 1.0.0, 15 sources, 3 declared `spatial_scopes`, ~60 distinct declared fields. |
| Deployment audit | `data/deployment_manifest.json` — contract 1.0.0, `generated_at`, `commit`, `build_state`, `validation`, `totals`, per-layer records. Written by `scripts/validate_deployment.mjs`; non-zero exit blocks Pages. |
| Builders | 9 Python + 1 Node builder in `scripts/` (geography, population, VUT licences, destination, domestic origins, hospitality, pedestrian, HATI extract, runtime POI). |
| Data footprint | **6.6 MB total.** `destination/madrid_domestic_origins.json` 3.71 MB (tabular), `geography/madrid_admin.geojson` 2.53 MB (**153 features, 31,648 vertices**), `runtime_poi.json` 384 KB (1,470 operational records), `hospitality-commercial-context.json` 68 KB, `source_registry.json` 52 KB. |
| Tests | **522 Node tests** (`node --test`, no framework) + Python `unittest` suite + one Playwright browser suite (`browser-tests/radial-halo.browser.mjs`). CI matrix: ubuntu + windows. |
| Docs | 16 documents, 6,980 lines, including Gates C0, G, H, I, J and the hospitality Gates A–F. |
| Production surfaces | Lens A / Lens B circles (100 m – 5 km, independent radii), Radial Halo V3, Comparison Bridge, Decision Insight, Spatial Window Sensitivity, Area Profile (+ licensed VUT), Hospitality & Commercial Context choropleth, Destination Context (+ Domestic Origins + Dynamics), pedestrian opt-in, parks context, HATI research opt-in, admin boundary lattice. |
| Analytical geometries in use | Lens circle · official barrio (131, current era) · district (21) · municipality (28079) · point/sensor · bounded HATI study rectangle. |
| Temporal state | Exactly one time-aware surface (monthly hotel demand, 2018-01 → 2026-08) plus a source-month selector on domestic origins. **No global time control.** |

---

## 3. Product-boundary decision

### 3.1 The three options, scored

Scores are `+` favourable, `0` neutral, `−` unfavourable, judged against this repository as it
actually exists.

| Criterion | A — Tourism Lens, planning as bounded context | B — Urban evidence lens, tourism as one domain | C — Sibling product + shared components |
|---|---|---|---|
| Clarity of user purpose | **−** "Tourism lens that also shows what can be built" has no single question | **+** One question: what is officially documented about this place and its change | **0** Two clear products, two identities to explain |
| Value for Madrid residents | **−** Residents do not arrive with a tourism question | **+** "What is planned around my home" is the strongest resident question available | **+** Equivalent, but split across two front doors |
| Value for planners / researchers | **0** Planning evidence stays subordinate | **+** Edition-to-edition change detection is of direct professional use | **+** Equivalent |
| Academic defensibility | **0** Framing mismatch invites "why is this a tourism product" | **+** Evidence observatory framing matches the actual method | **+** Equivalent |
| Reuse of current work | **+** Nothing moves | **+** Lens geometry, scope discipline, registry, Bridge, Insight, Sensitivity are all domain-neutral and transfer unchanged | **−** Requires extracting shared components out of a 3,752-line view layer first |
| Migration cost | **+** Near zero | **0** Repositioning + IA rebuild; no framework change, no data migration | **−** Highest: extraction refactor delivering nothing user-visible |
| Scope-creep risk | **0** Low, but by exclusion | **0** Real, and must be bounded explicitly (see §3.3) | **−** Two products drift independently |
| Maintainability | **+** One surface set | **0** One surface set, re-ordered | **−** Two deployments, two test suites, two doc sets |
| Reproducibility | **+** Unchanged | **+** Unchanged; the registry extends naturally | **0** Registry must be shared or duplicated |
| Deployment complexity | **+** Unchanged (Pages) | **+** Unchanged (Pages) | **−** Second Pages target, second validator |
| Portfolio value | **0** A tourism demo among many | **+** A distinctive, defensible civic instrument | **0** Two half-told stories |
| Uniqueness vs existing Madrid tools | **−** Nothing new | **+** Geoportal/VEDA are expert tools; no official surface answers these questions in citizen-readable, provenance-honest form | **+** Equivalent |
| Institutional presentation potential | **0** | **+** Presentable to a planning or statistics unit as an observatory | **0** |

### 3.2 Decision

**OPTION B, in its bounded reading.** Recommended product definition:

> **Madrid Urban Evidence Lens** — a citizen-first, professionally defensible geospatial
> workspace that answers, for any place in Madrid, what official sources document about urban
> development there, what stage that development has reached, what changed since the previous
> official snapshot, and what the evidence does not permit anyone to conclude.

Option A is rejected because it fails the test the gate itself set — *smallest coherent boundary
that creates **distinctive decision utility***. Twelve of the gate's candidate user questions are
not tourism questions. Under A they would be answered badly or not at all, so A buys coherence by
giving up the utility. Option C is rejected because its only advantage is architectural purity,
purchased with the single most expensive refactor available (extracting shared components from the
current view layer) and paid for before any user sees anything.

### 3.3 The boundary, stated as a limit rather than an ambition

Option B is adopted **only** in this bounded form. The product is explicitly *not* becoming a
"Madrid Urban Intelligence platform where tourism is one domain among planning, mobility, climate
and urban activity" — that reading is rejected as the scope creep this gate exists to prevent.

| Status | Domain |
|---|---|
| **Organising domain** | Urban development evidence: planning ámbitos, development stage, buildability, planning instruments, urban licences, public works |
| **Retained documented domains** | Resident register, hospitality & commercial premises, licensed VUT, hotel demand and origins, observed pedestrian activity, bounded thermal research — each keeps its existing scope and ceiling, none is promoted to a pillar |
| **Frozen, not extended** | Mobility (the existing node layers stay as they are; no mobility analytics), urban climate (HATI stays a bounded research opt-in) |
| **Out of boundary** | Air quality, noise, waste, lighting, crime, education, health, elections, budget execution, traffic counts, anything requiring a new domain vocabulary |

The repository name need not change. The *product* name and the README framing do.

---

## 4. Target users

| Priority | User | What they arrive with | What they must never be forced to do |
|---|---|---|---|
| **1 — primary** | A Madrid resident or local stakeholder (neighbour, association member, local journalist, small developer) | A place, and a question about what is coming | Learn PGOUM vocabulary before understanding the place |
| **2** | A planner, analyst or urban researcher | An identifier, a boundary or a comparison | Accept a number without its source, unit, geometry and date |
| **3** | An academic reviewer or assessor | A methodology question | Take a claim on trust, or find the limitation only in a doc |

The primary user is deliberately **not** the professional planner. Madrid already serves planners
well through the Geoportal, the SIT viewer and VEDA. The unserved reader is the resident, and
serving the resident honestly is harder than serving the expert, because the expert supplies their
own interpretation ceiling and the resident does not.

---

## 5. Core user questions

Derived questions, each tagged with the evidence that can answer it today and the scope it
describes. This table — not a dataset list — is the input to the information architecture.

| # | Question | Answerable now from official evidence? | Scope of the answer |
|---|---|---|---|
| Q1 | Which urban-development area am I looking at? | **Yes** — `AMBITOS_PLANEAMIENTO_URBANISTICO`, 765 polygons, code + denomination | planning ámbito |
| Q2 | What stage is that development in? | **Yes** — four published phase columns (Planeamiento / Gestión / Urbanización·Proyecto / Urbanización·Obras), controlled vocabulary | planning ámbito |
| Q3 | What can be built there according to published evidence? | **Yes, as m² of remaining buildability by use** — `Edificabilidad remanente en ámbitos` | planning ámbito |
| Q4 | Which uses and quantities are documented? | **Partly** — characteristic use and buildability m² by use class. **Dwelling counts are not published** (see §6.6) | planning ámbito |
| Q5 | What has changed since the previous official snapshot? | **Yes** — 15 dated editions, 2013 → January 2026, for both ámbito files | planning ámbito, edition to edition |
| Q6 | What planning changes affect this area? | **Partly** — `Información pública` (SHP) gives current public-consultation instruments; the ámbito files record MPG creation/modification in free-text notes | instrument geometry |
| Q7 | Which urban licences have recently been granted? | **Blocked** — 11,498 granted licences 2023-01 → 2026-09, but **no coordinates**; geocoding requires an NDP ↔ callejero crosswalk that does not exist in this repository | address point, after crosswalk |
| Q8 | Which public works are planned or under execution? | **Weakly** — `OBRAS/OBRA_PUBLICA` returns **17 features**, one directorate only; not a city-wide universe | work geometry, partial |
| Q9 | What is planned *around* this place? | **Yes, once Q1–Q3 land** — the existing Lens circle intersected with ámbito geometry | Lens circle ∩ ámbito |
| Q10 | How does this area compare with another? | **Yes** — existing Bridge / Insight / Sensitivity machinery, extended to the new scope | two selected objects |
| Q11 | Which source supports this statement? | **Yes** — registry already carries authority, URL, builder, ceiling | per value |
| Q12 | When was that source last updated? | **Partly** — the registry records `source_period_semantics` but has no uniform freshness quadruple (§7) | per source |
| Q13 | What does the evidence *not* allow us to conclude? | **Yes** — `interpretation_ceiling` per source, but it is the first thing hidden on small screens (§1.2c) | per value |

---

## 6. Official-source landscape

Audited 5 October 2026. The existing Gate C0 source landscape
(`docs/MADRID_TOURISM_INTELLIGENCE_SOURCE_LANDSCAPE.md`, 15 candidates, 7 families) contains
**no urban-planning sources at all**, so this audit is additive, not a revision.

Two retrieval routes exist, and they differ fundamentally.

### 6.1 Route 1 — `datos.madrid.es` (documented, licensed, dated, edition-versioned)

Catalogue retrieved as `https://datos.madrid.es/catalog/dataset.csv` (674 datasets, 251 KB,
semicolon-delimited, latin-1). Every record carries `Frecuencia de actualización`,
`Fecha de actualización`, `Fecha de obtención de datos desde/hasta`,
`Responsable del conjunto de datos` and `Licencia`.

#### S1 · `PGOUM 97. Estado de desarrollo de los ámbitos` → **STRONGEST CANDIDATE**

| Field | Value |
|---|---|
| Publisher / unit | Ayuntamiento de Madrid · **Dirección General de Planificación Estratégica** |
| URL | `https://datos.madrid.es/dataset/203200-0-desarrollo-ambitos` |
| Machine-readable | **Partly.** 15 editions as legacy **BIFF8 `.xls`** (OLE2 compound documents) + 2 PDF documentation files. No CSV, no JSON, no geometry. |
| Description (verbatim) | "Datos sobre el desarrollo del Plan General de Ordenación Urbana de Madrid desde 1997, distinguiendo fases del desarrollo urbanístico - **Planeamiento, Gestión, Urbanización y Edificación**" |
| Geometry | **None.** Tabular only; joins to geometry via ámbito code. |
| Identifiers | `Codigo` (e.g. `UZPp.03.01-RP`, `APE.xx.xx`, `API.xx.xx`, `APR.xx.xx`, `AOE.xx`, `UZI.x`, `UNP.x`) + `Ámbito` denomination + `Distrito` |
| Published columns (observed) | `Distrito`, `Codigo`, `Ámbito`, `Uso Característico`, `Superficie (m²)`, `Estado de desarrollo. Planeamiento`, `Estado de desarrollo. Gestión`, `Estado de desarrollo. Urbanización. Proyecto`, `Estado de desarrollo. Urbanización. Obras`, `Total` (aggregate row — must be excluded) |
| Controlled vocabulary (observed) | `Sin Iniciar` · `En tramitación` · `En Ejecución` · `Finalizado` · **`No Necesita`** |
| Use classes (observed) | `Residencial`, `Terciario`, `Dotacional`, `Industrial`, and combinations (`Residencial / Terciario`, `Industrial / Terciario`) |
| Plan of origin (observed) | `PGOUM-97` and `PGOUM-85` — ámbitos do not all originate in the same general plan |
| Temporal coverage | Catalogue declares 2013-01-01 → 2025-07-01; **the resource list actually reaches January 2026** |
| Editions | **15**: 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, Julio 2025, Enero 2025, **Enero 2026** |
| Declared cadence | `Semestral` |
| Observed cadence | Annual 2013–2024, then semestral from 2025. The declared cadence is correct only for the recent period. |
| Reference date | **Published inside the file** — a column headed `Estado del desarrollo a fecha …` |
| Publication / file date | Latest edition's OLE2 creation timestamp: **9 April 2026** |
| Catalogue last-update | 23 July 2026 |
| Licence | **CC BY 4.0** |
| Suppression / missing semantics | `No Necesita` means the phase does not apply — categorically distinct from `Sin Iniciar`. Treating them alike would be a fabrication. |
| Historical snapshots | **Yes, 15 of them, each separately addressable.** |
| Change detection reproducible | **Yes**, subject to the identity caveat in §6.6. |
| Citizen-facing appropriate | **Yes** — five plain states across four named phases is directly legible. |
| Can support | Which ámbito contains a place; its four phase states; its characteristic use; its surface; how each state changed between two dated editions. |
| **Cannot support** | Dwelling counts; completion dates; timelines; what *will* happen; whether anything is built; any ranking of ámbitos; any causal attribution of a state change. |

#### S2 · `PGOUM 97. Edificabilidad remanente en ámbitos` → **STRONGEST CANDIDATE (pair with S1)**

| Field | Value |
|---|---|
| URL | `https://datos.madrid.es/dataset/203182-0-ambitos-remanente` |
| Publisher / unit | Same as S1 |
| Machine-readable | **Partly** — 15 BIFF8 `.xls` editions, latest **Enero 2026** |
| Observed columns | `DISTRITO`, `AMBITO`, **`SITUACION DEL ÁMBITO`**, `Unifamiliar. Edif. Residencial`, `Colectiva. Edif. Residencial`, `Edif. Terciario`, `Edif. Industrial`, `DOTACIONAL`, `ESTADO DEL DESARROLLO A FECHA …`, plus free-text lifecycle notes |
| Lifecycle notes (observed, verbatim) | `ÁMBITO DE NUEVA CREACIÓN POR LA MPG.09.316`, `AMBITO MODIFICADO POR LA MPG.09.316`, `SE CAMBIA DE SITUACIÓN CON FECHA 19/07/13. EJECUCIÓN SIMULTANEA` |
| Licence / cadence / editions | CC BY 4.0 · declared `Semestral` · 15 editions, 2013 → Enero 2026 |
| Can support | Remaining buildability in m², split residential (single-family / collective), tertiary, industrial, dotacional, per ámbito, per dated edition. |
| **Cannot support** | Dwelling counts. Protected-housing counts. What is physically built. Market value. Any implication that remaining buildability will be consumed. |

#### S3 · `Licencias urbanísticas otorgadas` → **STRONG, BLOCKED ON GEOCODING**

| Field | Value |
|---|---|
| URL | `https://datos.madrid.es/dataset/640505-0-licencias-urbanisticas-otorgadas` |
| Publisher / unit | DG de Edificación · Agencia de Actividades · DG de Coordinación Territorial y Desconcentración |
| Machine-readable | **Yes** — CSV (UTF-8 with BOM, `;`-delimited, 2.92 MB) and XLSX, plus a published structure PDF |
| Rows retrieved | **11,498** |
| Coverage | 2023-01-01 → 2026-09-30 · declared cadence **`Mensual`** · catalogue updated 5 October 2026 |
| Licence | **CC BY 4.0** |
| Columns (21) | `Nº_EXPEDIENTE`, `TIPO`, `ORGANO_COMPETENTE`, `NORMA_ZONAL`, `NIVEL_PROTECCION`, `PERSONA_INTERESADA`, `FECHA_ALTA` (+ derived year/quarter/month/day), `VIA`, `DIRECCION`, `Nº`, **`NDP`**, `RESOLUCION`, `FECHA_FIRMA_RESOLUCION` (+ derived parts) |
| **Geometry** | **None.** The dataset is *not* coordinate-bearing, contrary to its own catalogue description. Location is an official address plus **`NDP` (Número de Policía / Domiciliario Postal)**, which is **100 % populated (0 of 11,498 empty)**. |
| `RESOLUCION` | **Exactly 1 distinct value: `Conceder`.** Genuinely a granted-licence register — it contains no refusals, no withdrawals, no applications. |
| `TIPO` (9 values) | `Licencia urbanística residencial` 5,538 · `Licencia urbanística de actividad` 3,372 · `Licencia de funcionamiento de actividad` 1,918 · `Licencia básica residencial` 195 · `Licencia de 1ª ocupación y funcionamiento` 193 · `Licencias para actividades temporales` 175 · `Licencia básica actividad` 95 · two `Ley 3/2024` variants 12. **Two universes are mixed: construction/building licences and activity licences.** |
| `ORGANO_COMPETENTE` (23 values) | **Not a usable district field.** `AGENCIA DE ACTIVIDADES` 7,111 (61.8 %) and `DIRECCION GENERAL DE LA EDIFICACION` 830 are central bodies with no district; only ~31 % of rows carry a district name. District geography is therefore *not* free — geocoding is mandatory, not optional. |
| `NIVEL_PROTECCION` (29 values) | Three distinct absence semantics: **empty 2,507 (21.8 %)**, `Sin Catalogar` 5,340, `Sin protección` 1,040. These are not interchangeable. |
| `NORMA_ZONAL` | Empty in 2,505 rows (21.8 %) — almost exactly the `NIVEL_PROTECCION` empty set, suggesting a systematic subset rather than random loss. |
| Date format | Spanish long form, e.g. `jueves, 23 de mayo de 2024`. Not ISO; requires a deterministic Spanish month/weekday map. |
| Can support | Counts of **granted** licences by official address, type, zonal norm, protection level and signature date — once NDP is resolved to a coordinate and a barrio. |
| **Cannot support** | Refusal or approval rates. Applications. Construction activity, completion or occupancy. Investment volume. Anything about licences before 2023. Conflation of building and activity licences into one "urban licences" figure. |

#### S4 · `Declaraciones responsables urbanísticas`
`https://datos.madrid.es/dataset/133556-0-declaraciones-responsables` — same publisher, same
cadence (`Mensual`), same coverage (2023-01-01 → 2026-09-30), CSV/XLSX, CC BY 4.0. The companion
instrument to S3: a *declaration* regime, not a granted licence. **Must never be summed with S3** —
different legal instrument, different universe.

#### S5 · `Planeamiento Urbanístico. Modificaciones y desarrollos del PGOUM de 1997`
`https://datos.madrid.es/dataset/300489-0-planeamiento-desarrollos-pgoum` — DG de Planificación
Estratégica, **SHP in a zip**, geometry present, CC BY 4.0, catalogue updated 15 June 2026.
**Cadence declared `Sin definir`; a single resource with no edition label, so no snapshot history
and no change detection.** Geometry for plan modifications and developments.

#### S6 · `Planeamiento Urbanístico. Información pública`
`https://datos.madrid.es/dataset/300487-0-planeamiento-informacion-publica` — SHP in a zip, single
resource, `Sin definir` cadence. Answers "what planning change is currently open to public
consultation", but with **no reference date and no history**, so it can only ever be presented as
*state at retrieval*, never as "as of" a date.

#### S7 · `Obras públicas planificadas y en ejecución` → **WEAK**
`https://datos.madrid.es/dataset/300538-0-obras-planificadas-ejecucion` — DG del Espacio Público,
Obras e Infraestructuras. Formats csv / xls / kmz / zip, 4 unlabelled resources,
cadence **`Sin definir`**, catalogue updated 22 July 2026. The ArcGIS twin
(`OBRAS/OBRA_PUBLICA`) exposes **17 features** with `ESTADO`, `FECHA_INICIO`, `FECHA_FINAL`,
`PRESUPUESTO_ADJUDICADO`, `EMPRESA`, `PLAZO_EJECUCION_MESES` and a free-text `DISTRITO_S`.
Seventeen works for a city of 3.4 million is one directorate's portfolio, not Madrid's public
works. **Verdict: not a city-wide universe. Do not present as "public works in Madrid".**

#### S8 · `Callejero oficial del Ayuntamiento de Madrid` → **REQUIRED INFRASTRUCTURE**
CSV, cadence **`Semanal`**, catalogue updated 5 October 2026, CC BY 4.0 (dataset 213605,
*direcciones vigentes*; a real-time web service also exists, dataset 300274). Gate C0 already
classified the callejero as **USE (infrastructure)** and recommended promoting it to "shared
reconciliation infrastructure" — that recommendation was never implemented. It is the single
blocker for S3/S4. Note that the existing VUT source needed no crosswalk because the publisher
ships `COD_NDP` already resolved to a barrio; the licence files do not.

#### S9 · Supporting datasets found and deliberately not pursued now
`Urbanismo. Destino urbanístico del suelo` (300744, **WMS only** — display, not analysis) ·
`PGOUM 97. Plano de ordenación` (300132) and `Condiciones de la edificación` (300136) (SHP;
coverage ends **17 April 1997** while the catalogue says updated 29 July 2026 — see §7.1) ·
`Catálogo de edificios protegidos` (300158, `Diaria`) · `Planeamiento urbanístico. Expedientes
tramitados` (300119, `Diaria`, PDF + zip) · `Inspecciones urbanísticas` (300373) ·
`Sanciones firmes … sobre inmuebles` (300234) · `Edificios declarados en ruina` (300378) ·
`Órdenes de ejecución … conservación y rehabilitación` (300377) ·
`Inventario / Enajenaciones del patrimonio municipal del suelo` (300041 / 300191) ·
`Impuesto ICIO. Autoliquidaciones` (204285) ·
`Modelo tridimensional de edificaciones` (300722) and `MDS 2023` (300731).

### 6.2 Route 2 — `sigma.madrid.es` ArcGIS REST (rich, live, undocumented, unlicensed)

Root: `https://sigma.madrid.es/hosted/rest/services?f=json` — **40 folders**. All services probed
report `capabilities: Map,Query,Data`, `maxRecordCount: 2000`, **EPSG:25830**, and support
`/query` with `f=geojson`.

| Service | Layer | Features | What it adds |
|---|---|---|---|
| `DESARROLLO_URBANO_ACTUALIZADO/AMBITOS_PLANEAMIENTO_URBANISTICO` | 0 `Ámbitos Ordenación` | **765** polygons | **The ámbito geometry universe.** Fields: `AMB_TX_ETIQ` (code), `AMB_TX_DENOM` (denomination), `SHAPE.STArea()`. Service description: "todos los Planeamientos de Ordenación aprobados, en desarrollo, en ejecución o desarrollados desde el PG97". Copyright: "Ayuntamiento de Madrid. Área de Desarrollo Urbano Sostenible. SG de Innovación e Información Urbanística". |
| `GESTION_URBANA/MCPG_Madrid_Crece` | 55 | **5,675** polygons, **74 fields** | **The register behind Madrid Crece / VEDA, at parcel level.** `COD_AMBITO`/`DESC_AMBITO`, `COD_DIS`/`DESC_DIS`, **`COD_BAR`/`DESC_BAR`**, `UE` (execution unit), `USO`/`DESC_USO`, `LUCRATIVA`, `EDIF_R`/`EDIF_RP`/`EDIF_I`/`EDIF_TER`/`EDIF_C`/`EDIF_O`/`EDIF_OH`/`EDIF_DPR`/`EDIF_DPU`/`EDIF_TOTAL`, `EDIF_AMBITO`, `SUP_AMBITO`, `RED`/`TIPO_RED`, `EJEC_PLAN`, `FASE_UR`, `EJEC_UR`, `ESTADO_G`, `N_EXP_GE`/`DES_EXP_GE`, `F_ALTA_G`/`F_BAJA_G`/`F_ALTA_J`/`F_BAJA_J`, `PCAT1`/`PCAT2`/`PAR_CAT`, `FUENTE`. |
| `URBANISMO/ETAPAS_DESARROLLOS_DEL_SURESTE` | 0 | **46** polygons | "Programación por fases y etapas de los desarrollos del Sureste". Fields `AMB_ETIQ`, `AMB_DENOM`, `ETAPA` (integer). Copyright: "Área de Desarrollo Urbano. Departamento de Cartografía". |
| `DESARROLLO_URBANO_ACTUALIZADO/FASES_RECEPCION_URBANIZACION` | 5 | **3** features | Effectively empty. `FECHA` is typed **String**, not Date. **Not a usable universe.** |
| `OBRAS/OBRA_PUBLICA` | 0 | **17** features | See S7. |
| `VIVIENDA/PLAN_18000` | 0 | **21** parcels | Has `COD_DISTRITO`/`COD_BARRIO`. **No dwelling-count field.** |
| Also present | — | — | `EXPEDIENTES_PLANEAMIENTO_AD` (FeatureServer), `EXPEDIENTES_INFORMACION_PUBLICA`, `SEGUIMIENTO_EXPEDIENTES`, `NORMAS_ZONALES`, `USOS_SUELO`, `PLANEAMIENTO_URBANISTICO`, `EDIFICIOS_PROTEGIDOS_VIGENTE`, `GESTION_URBANA/SIG_SIGGU_*`, `VIVIENDA/VIVIENDAS_TURISTICAS` |

**The join key is confirmed.** `AMB_TX_ETIQ` (geometry) = `AMB_ETIQ` (stages) = `COD_AMBITO`
(parcels) = `Codigo` (the XLS editions). Verified sample: `UZPp.03.01-RP` →
`DESARROLLO DEL ESTE - VALDECARROS`, 15,049,164 m²; `UZPp.02.04-RP` →
`DESARROLLO DEL ESTE - LOS BERROCALES`, 7,810,077 m².

**Route 2's disqualifying weaknesses, stated plainly:**

1. **No freshness metadata of any kind.** Every probed layer returns **no `editingInfo`** — no
   `lastEditDate`, no `dataLastEditDate`, no `schemaLastEditDate`. There is no reference date, no
   publication date and no declared cadence anywhere in the service.
2. **No licence or reuse statement.** The metadata record for a sibling service points only to
   `datos.madrid.es/pages/condiciones-generales-ayuntamiento-de-madrid`; the services themselves
   assert nothing.
3. **No field documentation.** 74 field names, no data dictionary. `FASE_UR` returns the bare
   string `"6"`; what phase 6 of what sequence means is undocumented.
4. **Sentinel values in date fields.** The Valdecarros sample returns `F_BAJA_G: "9999-09-09"` —
   a "currently valid" sentinel, not a date. `F_ALTA_G` is `null`.
5. **Denormalised ámbito totals.** `EDIF_AMBITO` (7,686,472.9 m² for Valdecarros) is repeated
   on **every parcel row** of the ámbito. Summing it would multiply the city's buildability by
   the parcel count. `SUP_AMBITO` was `null` on the sampled rows.
6. **No snapshot history.** The service exposes one live state. Change detection is impossible.
7. **No stability guarantee.** An undocumented internal service can be renamed or restructured
   without notice.

### 6.3 Route 3 — the viewer portals: not a retrieval route at all

| Portal | `curl` plain | `curl` + browser UA |
|---|---|---|
| `https://madridcrece.madrid.es/` | **403** | **403** |
| `https://gemelo.madrid.es/es/evd-urbanismo` | **403** | **403** |
| `https://datos.madrid.es/` | 200 | 200 |
| `https://sigma.madrid.es/hosted/rest/services?f=json` | 200 | 200 |

**Madrid Crece and the Gemelo Digital portal refuse all automated retrieval.** They are
human-facing communication and visualisation surfaces, not sources. Madrid Crece occupies exactly
the position that `esmadrid.com` occupies for accommodation — the position this project already
ruled **NO-GO at Gate A**: a promotional presentation of a register, not the register. The
register is Route 1 (dated, licensed editions) plus Route 2 (geometry). The dwelling figures that
appear in Madrid Crece pages and in the press (51,000 at Valdecarros, 22,285 at Los Berrocales)
are **not retrievable from any machine-readable official source audited here** (§6.6).

### 6.4 Comunidad de Madrid and national sources

Not pursued in this gate, and deliberately so. The municipal sources above are the authority for
municipal planning; the regional SIT viewer and the IDEM ATOM download service duplicate
municipal planning for non-Madrid municipalities. Gate C0 already holds the regional
accommodation/VUT candidates at `WATCH`. Catastro and IGN/PNOA remain `WATCH`. Adding a regional
layer would import a second administrative universe for no new question.

### 6.5 Madrid's Digital Twin

`gemelo.madrid.es` exists (Madrid Capital Digital 2023–2027; a federated "Gemelo de Gemelos";
a 2026 photogrammetric flight with UltraCam Osprey 4.2 at 7 cm and high-density LiDAR, stated as
destined for free publication through the municipal Geoportal and Remote Sensing portal). It is
**403 to all automated clients today**, publishes no third-party API, 3D Tiles endpoint or
embedding route that this gate could verify, and exposes no reference date or terms. The
municipal 3D building model and MDS 2023 *are* published on `datos.madrid.es` (300722, 300731)
as zip/KML.

**Verdict: WATCH.** It is a reason to keep a 3D door open in the architecture, and no reason
whatsoever to build 3D now.

### 6.6 The three hardest findings

**(1) The authoritative universe is ~700 ámbitos citywide, not ten mega-developments.**
Distinct code families counted in the January 2026 edition: `API.*` 256, `APE.*` 246, `APR.*` 124,
`UZP*` 13, `UZI*` 9, `AOE*` 9, `AE.*` 7, `UNP*` 2 — consistent with 765 polygons in the geometry
service. Every one of the gate's example developments appears **except "Madrid Nuevo Norte"**,
which is present under its official denomination containing **CHAMARTÍN**. The marketing name is
not the register's name. This is why the gate was right to forbid hard-coding the list — and it
changes the product design: the first use case must be *"which ámbito contains this point and
what stage is it at"*, applicable anywhere in Madrid, not a curated tour of ten famous projects.

**(2) Dwelling counts are not published in any machine-readable official source audited.**
`MCPG_Madrid_Crece` has 74 fields and no dwelling-count field; `PLAN_18000` has none; the two XLS
families publish **m² of buildability**, including `EDIF_RP` / `Colectiva. Edif. Residencial` for
protected and collective residential — all in square metres. The "51,000 viviendas" class of
figure comes from narrative sources. Therefore: **the product may publish buildability in m² by
use, and must not publish housing or protected-housing unit counts** — this is the direct
analogue of the Gate A accommodation NO-GO and of the Gate B finding that *licences and
dwelling-units are different indicators*.

**(3) Ámbito code equality across editions is not entity identity.**
The remanente files document, in their own notes, that ámbitos are **created, modified and
reclassified by MPG (Modificación del Plan General) instruments, with dates**:
`ÁMBITO DE NUEVA CREACIÓN POR LA MPG.09.316`, `AMBITO MODIFICADO POR LA MPG.09.316`,
`SE CAMBIA DE SITUACIÓN CON FECHA 19/07/13`. Ámbitos also originate in different general plans
(`PGOUM-97`, `PGOUM-85`). This is structurally the same problem this project already solved for
barrios, where the 2017 reorganisation forced the key `{era}:{code}` because historical 192
(Ambroz) ≠ current 192 (Valdebernardo). The planning equivalent must therefore key on
**`{edition}:{code}`**, and an edition-to-edition difference must be classified as
`NEW_AMBITO` / `MODIFIED_BY_INSTRUMENT` / `STATE_TRANSITION` / `ABSENT_FROM_EDITION` —
never as "progress".

---

## 7. Source freshness model

### 7.1 Why the current model is insufficient

The registry records `source_period_exposed_by_source` and a prose `source_period_semantics`; the
manifest records `generated_at`, `source_period` and `source_period_known`. That covers *reference
date* and *retrieval date* for the current sources. It does **not** separate **publication date**
from **reference date**, and it carries **no machine-readable update cadence** and **no source
state**.

The audit makes the gap concrete. For the January 2026 ámbito edition, **four different dates are
all true at once**:

| Date | Value | Meaning |
|---|---|---|
| `reference_date` | **January 2026** | the state the data describes (`Estado del desarrollo a fecha …`, inside the file) |
| `published_at` | **9 April 2026** | the edition file's own creation timestamp |
| `catalogue_updated_at` | **23 July 2026** | when the portal record last changed |
| `retrieved_at` | **5 October 2026** | when this gate fetched it |

Collapsing these into one "updated" field is how "current" silently becomes "real time". The
portal's own `Fecha de actualización` is a **catalogue-record** date, not a data date, and the
audit found a decisive proof: `PGOUM 97. Plano de ordenación` reports
`Fecha de actualización = 29/07/2026` with a temporal coverage ending **17 April 1997**.
**The portal's "updated" date must never be surfaced as data currency.**

### 7.2 The required contract

Every production source must declare all five, with no silent defaults. The vocabulary is
deliberately closed so a renderer can be tested against it.

```
reference_date        ISO date | ISO month | null
                      The period the data describes. null ONLY where the publisher
                      declares none — and then observed_resource_state is mandatory.
published_at          ISO date | null
                      When the publisher issued this edition. Never inferred from
                      reference_date, and never from the catalogue record date.
retrieved_at          ISO datetime
                      When this project fetched it. Always known.
update_frequency      DAILY | WEEKLY | MONTHLY | BIMONTHLY | QUARTERLY | SEMESTRAL
                      | ANNUAL | IRREGULAR | DECLARED_UNDEFINED | NONE_DECLARED
                      DECLARED_UNDEFINED = publisher says "Sin definir".
                      NONE_DECLARED     = publisher says nothing at all.
                      Never DAILY or REALTIME for a committed snapshot.
source_state          DEFINITIVE | PROVISIONAL | WITHHELD_BY_PUBLISHER
                      | NOT_DECLARED_BY_PUBLISHER
observed_cadence      Optional. The cadence actually observed across editions, where
                      it differs from the declared one. S1 declares SEMESTRAL and was
                      annual 2013-2024 — both facts are published, neither is corrected.
```

### 7.3 Binding rules

1. **"Current" never renders as "now".** Every value carries its own `reference_date`, or an
   `observed_resource_state` where the publisher declares none — the rule the licensed-VUT
   surface already follows.
2. **A missing date is a publishable fact**, not a blank. `NONE_DECLARED` and
   `DECLARED_UNDEFINED` are rendered, not hidden.
3. **No source inherits another's date.** The gate found four co-existing dates on one file; a
   combined surface shows every contributing date or shows none of them.
4. **Freshness is not a quality score.** An annual register is not "worse" than a daily one.
5. **Stale is stated, never styled.** No red/green freshness traffic light, ever — that would be
   an unsupported composite judgement.
6. **The declared cadence and the observed cadence are both published** where they disagree.

---

## 8. Spatial-scope model

Every analytical value must know which geometry it describes, and the reader must be able to see
that without reading prose. The scope enum is closed and extends the registry's existing
`spatial_scopes`.

| Scope id | Geometry | Source of truth | Status |
|---|---|---|---|
| `LENS_CIRCLE` | user-positioned circle, 100 m – 5 km | user state | existing |
| `OFFICIAL_BARRIO` | 131 current-era barrio polygons | `madrid_admin.geojson` | existing |
| `OFFICIAL_DISTRICT` | 21 district polygons | `madrid_admin.geojson` | existing |
| `MUNICIPALITY` | Madrid, code 28079 | `madrid_admin.geojson` | existing |
| `POINT_OBSERVATION` | counter / sensor / asset point | per source | existing |
| `BOUNDED_STUDY_AREA` | HATI ≈3.5 km² rectangle | `hati_provenance.json` | existing |
| `PLANNING_AMBITO` | 765 ámbito polygons | `AMBITOS_PLANEAMIENTO_URBANISTICO` | **new, Gate L** |
| `EXECUTION_UNIT` | `UE` sub-areas | `MCPG_Madrid_Crece` | **deferred** |
| `DEVELOPMENT_STAGE_AREA` | 46 SE stage polygons | `ETAPAS_DESARROLLOS_DEL_SURESTE` | **deferred** |
| `PARCEL` | 5,675 parcel polygons | `MCPG_Madrid_Crece` | **deferred — triggers §11B/D** |
| `ADDRESS_POINT` | NDP-resolved address | callejero crosswalk | **blocked on Gate M** |
| `WORK_GEOMETRY` | public-work polygon | `OBRA_PUBLICA` | **not adopted (17 features)** |
| `LENS_INTERSECT_AMBITO` | circle ∩ ámbito | derived | **new, derived** |

### 8.1 Binding rules

1. **Every rendered value carries exactly one scope.** No value is scope-ambiguous.
2. **No cross-scope arithmetic without an explicit, documented basis.** A `LENS_CIRCLE` count
   and a `PLANNING_AMBITO` m² figure are never differenced, ratioed or combined.
3. **No whole-object value is attributed to a part of it.** An ámbito's remaining buildability
   describes the whole ámbito, exactly as a barrio's resident count describes the whole barrio —
   the rule `area-profile.js` already enforces.
4. **`LENS_INTERSECT_AMBITO` reports which ámbitos a circle touches and never apportions their
   quantities by area.** Buildability is not uniformly distributed, so areal apportionment would
   be fabrication.
5. **A scope change invalidates a frozen comparison baseline**, consistent with the existing
   centre-move invalidation in Spatial Window Sensitivity.

### 8.2 The persistent scope / freshness rail

One compact, always-visible element — not a per-card badge, which is what produced the current
repetition. Proposed content, in reading order:

```
┌──────────────────────────────────────────────────────────────┐
│  ◎ LENS A · 900 m          ▣ AMBITO UZPp.03.01-RP            │
│  ⬡ BARRIO 181              ◷ ámbito state · Jan 2026 · defin. │
└──────────────────────────────────────────────────────────────┘
```

- A distinct **glyph plus a distinct label** per scope — never colour alone.
- The **oldest contributing reference date** for whatever is currently on screen, plus its
  `source_state`.
- Tapping any element opens the evidence drawer (§9) filtered to that scope or that source.
- It is the **one element that must never be hidden at any breakpoint**, at any screen size.

---

## 9. Proposed information architecture

### 9.1 Modes, derived from §5 rather than assumed

The gate's suggested names (`EXPLORE / COMPARE / PLANNING / MADRID`) do not survive the question
list. `EXPLORE` is not a user intent — it is the absence of one. `PLANNING` names a dataset
family, not a question. And "what changed" is never a mode: it is always a question *about
something already selected*.

**Three modes and two cross-cutting rails.**

| Mode | Questions served | Primary scope |
|---|---|---|
| **PLACE** | Q1 Q2 Q3 Q4 Q5 Q6 Q9 | `LENS_CIRCLE`, `PLANNING_AMBITO`, `OFFICIAL_BARRIO` |
| **COMPARE** | Q10, and Q1–Q5 for two objects | two selected objects of the **same** scope |
| **CITY** | municipal context: hotel demand, origins, citywide aggregates | `MUNICIPALITY` |

| Rail | Role | Visibility |
|---|---|---|
| **Scope & freshness rail** (§8.2) | which geometry, which date, which state | **always, every breakpoint** |
| **Evidence drawer** | which source, which unit, which transformation, what cannot be concluded | reachable from **any** value, in every mode |

**Time is a control inside PLACE and CITY, not a mode.** In PLACE it selects the official edition
of the ámbito files (2013 → Jan 2026) and renders the edition-to-edition transition. In CITY it
selects the published month. It is never global, and a surface with no temporal axis never grows
one — the discipline the README already states.

### 9.2 Two readings, one evidence object

Both readings render from the **same** evidence object. They differ in projection, never in
substance. There is no "simplified" number and no "real" number.

**CITIZEN READING** (default) answers, in plain Spanish, in this fixed order:

1. **What** — "Este punto está dentro del ámbito *Desarrollo del Este – Valdecarros*."
2. **Where** — the ámbito, and the barrio and district containing it, as distinct geometries.
3. **Stage** — the four official phases as four plain states, with `No Necesita` rendered as
   "no aplica", never as "sin empezar".
4. **Latest known change** — what differs from the previous official edition, with both dates.
5. **Why it matters** — one factual sentence, no evaluation.
6. **Source date** — reference date and source state, inline, never only in a footer.

**ANALYST READING** (one toggle, same object) adds the original terminology
(`Estado de desarrollo. Gestión`), the identifiers (`Codigo`, `UE`, `N_EXP_GE`), units
(m² edificable, not "size"), the geometry and its CRS (EPSG:25830 → EPSG:4326), the exact
retrieval route, the four dates of §7.1, the transformation applied, and the interpretation
ceiling verbatim.

**Guarantees, to be test-enforced:**

- Both readings derive from one frozen model. Neither recomputes.
- Every citizen phrase maps to exactly one analyst field; a test asserts the mapping is total.
- The citizen reading may **omit** detail; it may never **round, merge, soften or reorder** a
  state.
- The interpretation ceiling appears in **both** readings. It is never analyst-only.

### 9.3 Progressive disclosure — what moves where

| Surface today | Disposition |
|---|---|
| Nav `Explore` (dead button) | **Delete.** Replace with the real three-mode switch. |
| Nav `Evidence` (camera fly + layer on) | **Re-home.** The camera action belongs to the HATI layer; the word "Evidence" belongs to the drawer. |
| Category mix, Nearest-in-lens | **Into a PLACE detail disclosure.** Currently deleted entirely under 850 px. |
| Hospitality & Commercial Context selector + scale | **Into a layer-scoped panel**, opened from the layer, not permanently resident. |
| Domestic Origins + Monthly Dynamics (2 tables + 2 `<details>`) | **Into CITY, behind one disclosure.** Three nested tables must not be the panel's default tail. |
| Halo legend (long prose block) | **Into the evidence drawer**, keyed from the halo. |
| Source footer (one long paragraph) | **Into the evidence drawer**, per source. Currently deleted under 850 px. |
| Radius slider / HATI time / reset | **Into a controls region separated from results**, not interleaved between them. |
| "Source & interpretation" toggles | **Promote into the drawer** and make them reachable at **every** breakpoint. |
| Spatial Sensitivity, Decision Insight, Comparison Bridge | **Keep in COMPARE**, unchanged in semantics. They are the product's strongest surfaces. |

### 9.4 The map stays the instrument

The panel explains the map; it never competes with it. Concretely: the panel does not grow past
its current share of the viewport, the halo stays the map's own compact quantitative display, and
no new surface is added to the panel without something leaving it.

---

## 10. External repository evaluation

Verified against the GitHub API on 5 October 2026.

| Repository | Stars | Licence | Last push | Verdict |
|---|---|---|---|---|
| `paper-design/liquid-logo` | 1,221 | **PolyForm Shield 1.0.0** | 2026-04-20 | **REJECT FOR THIS PRODUCT** |
| `ruucm/shadergradient` | 2,714 | **NONE — no licence file** | 2026-09-23 | **REJECT FOR THIS PRODUCT** |
| `dashersw/liquid-glass-js` | 1,290 | MIT | **2025-06-12** | **REJECT FOR THIS PRODUCT** |
| `pmndrs/react-three-fiber` | 32,734 | MIT | 2026-10-05 | **REFERENCE** |
| `opengeos/GeoLibre` | 7,810 | MIT | 2026-10-05 | **REFERENCE** (+ export interop) |
| `pyrosm/pyrosm` | 440 | MIT | 2026-10-02 | **REJECT FOR THIS PRODUCT** |

### 10.1 `paper-design/liquid-logo` → REJECT

Turns a logo into animated liquid metal via Paper Shaders (WebGL/GLSL), TypeScript, 976 KB.
**It is not open source.** The `LICENSE` file is **PolyForm Shield License 1.0.0**, a
source-available licence whose whole purpose is a non-compete restriction on use. This repository
ships MIT and is a portfolio and academic artifact; importing a non-compete-restricted dependency
into it is a licence-compatibility problem before it is an aesthetic one. Functionally it is also
pure decoration with zero analytical utility, requires a React/WebGL context, and the one place it
could plausibly sit (a landing identity) is not a surface this product has. **Rejected on licence
grounds alone.**

### 10.2 `ruucm/shadergradient` → REJECT

Animated Three.js gradient meshes for Framer, Figma and React. 2,714 stars, 96 MB repository,
actively pushed. **It has no licence file at all** — default copyright, all rights reserved, no
grant to reuse. That is dispositive. Beyond it: React + Three.js runtime, continuous GPU
animation competing with map rendering for the same frame budget, and no analytical utility. The
project's existing `backdrop-filter: blur()` chrome already achieves depth at near-zero cost.
**Rejected on licence grounds alone.**

### 10.3 `dashersw/liquid-glass-js` → REJECT (reference the idea, not the code)

Apple-style glass refraction in vanilla JS — the only candidate that would not require a
framework, and genuinely MIT. Two disqualifiers:

1. **It has exactly one commit, dated 2025-06-11, and has never been touched since.** 1,290 stars
   on a single commit. There is no maintenance to depend on.
2. **Its core effect is backdrop distortion and refraction, applied behind content.** The gate's
   own rule — never put distortion, refraction or animated shader effects behind dense analytical
   text — rules out the only thing it does. A product whose smallest qualifying text currently sits
   at 7 px cannot afford to refract what is behind it.

Keep as a visual **reference** for the *idea* of layered, depth-cued chrome. The implementation is
already covered by `backdrop-filter`.

### 10.4 `pmndrs/react-three-fiber` → REFERENCE

Mature, MIT, 32.7k stars, pushed the day of this audit, 14 open issues on a project of that size —
a genuinely well-run library. It is also **a React renderer**, so adopting it means adopting React,
which means rewriting the view layer and re-establishing 522 tests' worth of DOM assumptions.

The gate's bar is a *defensible analytical use case first*. Testing the candidates against the
audited evidence:

- **Urban massing / building context** — the official 3D building model exists (300722, MDS 300731),
  but it answers no question in §5.
- **Development-volume comparison** — the strongest candidate, and it fails on inspection: the
  published quantity is **m² of buildability by use class**. That is a set of numbers, and numbers
  are read better as numbers and bars than as extruded volumes. Rendering m² as 3D mass would also
  imply a built form that the source does not publish.
- **Shadow / exposure context** — would need a solar model the project does not have, and HATI
  already occupies the bounded thermal role.
- **Digital Twin / 3D Tiles** — Madrid's twin is 403 to automated clients with no third-party
  endpoint (§6.5).

**No use case passes. 3D is STOP for this phase**, and R3F is REFERENCE: the right library *if*
an analytical use case ever qualifies.

### 10.5 `opengeos/GeoLibre` → REFERENCE, plus export interoperability

MIT, 7,810 stars, pushed the day of this audit, `CITATION.cff` present (academically citable).
But inspection of the repository root shows what it actually is: `apps/`, `backend/`, `packages/`,
`extensions/`, `python/`, `Dockerfile`, `docker-compose.yml`, Rust checks, Tauri desktop builds,
MSIX/portable packaging, JupyterLite builds, SSO e2e tests — **version 3.3.0 of a full
cloud-native GIS platform with a server**, stack MapLibre + Cesium + DuckDB + Tauri.

It therefore cannot be "adopted" into a static GitHub Pages site under any reading, and the gate
is explicit that it must not be rebuilt inside Lens. Note also that it was **created 2026-05-27** —
about four months old. High star velocity is not maturity.

Correct roles:

1. **Architectural reference** — it is the clearest working example of the exact stack question in
   §11: MapLibre + PMTiles + DuckDB-WASM in a browser. Read it before deciding §11B/C/D.
2. **Power-user external analysis environment, via export** — the product publishes a documented
   GeoJSON/CSV bundle with its provenance; GeoLibre (or QGIS) is where a power user takes it. One
   export contract serves every external tool, so nothing is GeoLibre-specific.

**Not embedded. Not a dependency. Not rebuilt.**

### 10.6 `pyrosm/pyrosm` → REJECT FOR THIS PRODUCT (superseded, not deficient)

A well-run library: MIT, v0.15.0 released 2026-10-01, CPython 3.10–3.14 wheels via cibuildwheel,
Cython + cykhash, reads `.osm.pbf` into GeoDataFrames. As an offline tool it is exactly what the
gate describes, and the project already runs Python builders, so it would install cleanly.

It is rejected for a different reason: **the same results are available from an authoritative
municipal source this project has already identified.** The candidate uses were streets,
walkability/network structure, buildings, land use and POIs. Madrid publishes
`Callejero oficial. Viales vigentes` and `Subviales vigentes` (daily), `Ancho medio de viario`,
`Número de carriles por calles`, `Cartografía actualizada. Manzanero`, the 3D building model,
`Urbanismo. Destino urbanístico del suelo` and `Accesibilidad y movilidad en aceras y calzadas` —
all official, all dated, all licensed. Adopting pyrosm would introduce a **second-class evidence
tier** (OSM is not authoritative for Madrid planning, as the gate states) into a product whose
entire claim is official-source provenance, in exchange for data the authoritative route already
provides.

Revisit only if the product ever needs a city **without** an official callejero. For Madrid:
REJECT.

---

## 11. Technology decision matrix

| # | Hypothesis | Verdict | Grounds |
|---|---|---|---|
| **A** | Current stack supports the next phase without a rewrite | **GO** | Leaflet **1.9.4** (current stable) already with `preferCanvas: true` and per-pane `L.canvas()` renderers. Today's load: **153 features / 31,648 vertices / 2.53 MB** GeoJSON and 1,470 POIs. The authorised increment adds **765 ámbito polygons** plus ~700 tabular rows per edition. No rewrite is needed, and none is justified. |
| **B** | MapLibre GL JS materially improves the product | **NOT YET** — with a named trigger | There is no vector-tile-scale workload. MapLibre's real wins (vector tiles, data-driven styling, extrusion, PMTiles) all presuppose payloads this product does not have. **Trigger:** adopt only if `PARCEL` scope (5,675 polygons × multiple editions) or building extrusion becomes a *proven* requirement, **and** the §11 spike measures a material gain on the real payload. Migrating a 3,752-line Leaflet view layer and one Playwright suite is a large cost to pay speculatively. |
| **C** | DuckDB-WASM spatial enables useful browser-local analysis | **NO-GO for now** | The honest workload: ~700 ámbito rows × 15 editions ≈ **10,500 rows**, and **11,498** licence rows. Both are trivial in plain JavaScript, and the project's pure-model-plus-tests pattern already handles them deterministically. Adding a WASM analytical engine would add megabytes and a second query semantics for no query the product cannot already answer. **Revisit only if** parcel-level geometry, multi-year licence history and arbitrary user-drawn polygons land *together*. |
| **D** | GeoParquet / PMTiles reduce payload and preprocessing | **NO-GO (GeoParquet) · NOT YET (PMTiles)** | GeoParquet has no browser consumer here without (C), which is NO-GO; the Python builders already emit small artifacts. PMTiles is tied to (B): it is the right answer *if* MapLibre is adopted and *only* then. Note the real payload problem is not spatial at all — it is `madrid_domestic_origins.json` at **3.71 MB of tabular data**, which neither format addresses and which plain partitioning would fix. |
| **E** | GeoLibre's role | **REFERENCE + export interop** | §10.5. Architectural reference for the B/C/D decision; export target for power users. Never embedded, never rebuilt. |
| **F** | pyrosm as offline OSM prep | **REJECT** | §10.6. Superseded by the official municipal callejero and cartography; would create a second-class evidence tier. |
| **G** | React Three Fiber / 3D | **STOP** (R3F = REFERENCE) | §10.4. No analytical use case survives contact with the evidence: the publishable quantity is m² by use class, which bars and numbers convey better and which 3D would over-claim. No React migration for 3D. |
| **H** | Shader / liquid-glass effects | **STOP as dependencies** | All three candidates fail before aesthetics: PolyForm Shield non-compete (liquid-logo), **no licence at all** (shadergradient), **one commit ever** (liquid-glass-js). The product's own rule forbids the one effect the viable-licence candidate provides. Depth stays `backdrop-filter`, already in use. |
| **I** | Keep vanilla JS / no framework | **GO** | 522 passing tests, zero runtime dependencies, no build step. This is an asset for reproducibility and for academic defensibility, not a limitation to escape. |
| **J** | Modularise the view layer incrementally | **GO, bounded** | `app.js` at 3,752 lines is the real cost driver. Extract **only** what a Gate K issue needs, as that issue needs it. No speculative refactor, no framework, no bundler. |

---

## 12. UI/UX direction

### 12.1 Panel V2 architecture

```
┌─ HEADER ────────────────────────────────────────────────────────────┐
│  Madrid Urban Evidence Lens        [ PLACE | COMPARE | CITY ]       │
└─────────────────────────────────────────────────────────────────────┘
┌─ SCOPE & FRESHNESS RAIL  (never hidden, any breakpoint) ───────────┐
│  ◎ Lens A · 900 m   ▣ Ámbito UZPp.03.01-RP   ◷ Ene 2026 · definitivo│
└─────────────────────────────────────────────────────────────────────┘
┌─ PANEL ─────────────────────────┐
│  LEAD ANSWER                    │   one headline answer to the
│    place · stage · latest change│   mode's question, nothing else
│ ─────────────────────────────── │
│  SUPPORTING EVIDENCE            │   at most 4 figures, each with
│    ≤ 4 figures, each scoped     │   its own scope glyph
│ ─────────────────────────────── │
│  ▸ Detail            (closed)   │   mix, nearest, tables, origins
│  ▸ Evidence & limits (closed)   │   source, dates, units, ceiling
└─────────────────────────────────┘
┌─ CONTROLS  (separated from results, never between them) ───────────┐
│  radius · edition / month · layers · reading: citizen | analyst     │
└─────────────────────────────────────────────────────────────────────┘
```

Rules:

- **One lead answer per mode.** If a mode needs two lead answers, it is two modes.
- **At most four supporting figures** visible by default. The fifth goes into Detail.
- **Controls never sit between results.** The radius slider moves out of the result stack.
- **Nothing is added without something leaving.** A new surface must name its displaced one.
- **Evidence & limits is a disclosure, not a deletion**, and it exists at every breakpoint.

### 12.2 Mobile and iPad: reverse the current priority

The current responsive strategy deletes provenance first (§1.2c). V2 inverts it:

| Priority | Behaviour at every breakpoint |
|---|---|
| **1 — never hidden** | Scope & freshness rail; lead answer; the route into Evidence & limits |
| **2 — collapses, never deletes** | Supporting figures (reflow to fewer columns); detail tables (into disclosures) |
| **3 — may be hidden** | Decorative dividers, legends whose content lives in the drawer, long explanatory prose that is duplicated in the drawer |

No breakpoint may hide a source, a date, a unit or an interpretation ceiling. A test should assert
this against the stylesheet, in the spirit of the existing
"the sensitivity stylesheet encodes no judgment colour" test.

---

## 13. Visual language

### 13.1 Direction: *urban instrument*

Restrained, dense-but-legible, with the authority of official cartography rather than the gloss of
a product demo. The current dark navy base (`--bg:#08101a`) and translucent panels are a sound
starting point and are kept. What changes is **discipline**, not palette taste.

Explicitly not: gaming UI, crypto dashboard, Apple demo clone, sci-fi control room, generic
startup analytics, decorative glass everywhere.

### 13.2 The type scale (replacing ~55 ad-hoc sizes)

A seven-step scale. Nothing outside it. Steps are far enough apart to encode hierarchy — a 0.1 px
difference cannot, and 23 of the current sizes differ from a neighbour by ≤ 0.2 px.

| Token | Size | Role |
|---|---|---|
| `--t-display` | 28 px | the lead answer's figure |
| `--t-title` | 20 px | lead answer headline |
| `--t-figure` | 16 px | supporting figures |
| `--t-body` | 14 px | prose, table cells |
| `--t-label` | 12 px | field labels, units |
| `--t-meta` | 11 px | dates, scope text, source state |
| `--t-micro` | 10 px | **floor.** Nothing smaller ships, at any breakpoint. |

A 10 px floor is a substantial change: the current stylesheet puts most qualifying text — the text
that carries the ceiling — between 7 and 8.6 px. Raising the floor costs vertical space, which is
precisely what §12.1's disclosures buy back.

### 13.3 Colour and encoding rules

1. **Never colour alone.** Scope and state always carry a glyph or a label too.
2. **No judgement colour.** No red/amber/green on a phase state, a freshness value or a change.
   `Finalizado` is not "good"; `Sin Iniciar` is not "bad"; an older edition is not "stale".
3. **Development phase uses neutral, ordered, non-evaluative tints** plus an explicit distinct
   treatment for `No Necesita` — which is not a point on the sequence at all.
4. **A/B continue to differ by hue *and* structure** (B dashed), as Radial Halo V3 already does.
5. **Lens A/B hues stay reserved**; planning geometry takes its own family and never borrows them.

### 13.4 Effects

`backdrop-filter: blur()` on chrome stays — it is already in use, costs nothing measurable and
degrades gracefully. No shader library becomes a dependency (§11H). No animated or refractive
effect ever renders behind analytical text. Any future chrome-only effect must degrade to a flat
surface with no loss of information, and must be removable in one commit.

---

## 14. Accessibility and performance constraints

**Binding, and testable:**

1. **10 px minimum type**, every breakpoint (§13.2).
2. **Nothing conveyed by colour alone** (§13.3).
3. **44 px minimum touch target** wherever `pointer: coarse` — already partly honoured
   (`.layer`, `.switch`, `.ss-button`) and to be made universal.
4. **Keyboard parity.** Every focus/lock interaction reachable by keyboard, as the Comparison
   Bridge already is. New surfaces inherit this, not re-invent it.
5. **`aria-live` for recomputation**, as the panel already uses for area, destination and
   sensitivity.
6. **WCAG AA contrast** for all text, including the 10–12 px steps against translucent panels —
   the hardest case and the one most likely to fail today.
7. **No provenance hidden at any breakpoint** (§12.2).
8. **Graceful degradation per artifact, not per bundle** — the rule the Area Profile already
   follows ("degrade the Area Profile per artifact, not as one bundle").
9. **Static-site reproducibility preserved**: no build step, no runtime framework, no runtime LLM.
10. **Performance budget**: interaction-to-paint on a Lens drag must not regress against
    `42773bc`. Any new layer that regresses it is deferred, not optimised speculatively.
11. **No runtime cross-origin dependency for planning evidence.** Route 2 is undocumented and
    unlicensed (§6.2); it is a **build-time** source only, committed as a fingerprinted artifact —
    the pattern the hospitality and VUT artifacts already use.

---

## 15. Future AI-assistant contract — design only

Nothing in this section is implemented in this gate, and no issue created by this gate implements
an LLM. The purpose is to fix the architecture now so that the feature, if it ever ships, cannot
become an oracle.

### 15.1 Architectural precondition

An assistant may only be built on top of an **Evidence Registry query contract**: a
machine-readable description of every evidence object — its scope, its five freshness fields, its
unit, its identifiers, its permitted operations and its interpretation ceiling. `source_registry.json`
is already two-thirds of this. The assistant is a **query front-end over that registry**, never a
reasoner over raw data and never a text generator over rendered output.

### 15.2 Resolution order — deterministic first, always

```
question
  → intent classification            (which registered question shape, §5)
  → scope resolution                 (which geometry; refuse if ambiguous)
  → deterministic spatial/db query   (point-in-polygon, edition diff, filter)
  → answer assembled FROM the result, with its provenance attached
  → abstention if any step is unsupported
```

The language model's only permitted roles are **classifying the question** and **phrasing an
answer whose every factual token came from a query result**. It never computes a number, never
chooses a date, never decides a scope, and never fills a gap.

### 15.3 Hard requirements

Every answer must state: the **exact source**, its **reference date** and `source_state`, the
**applied spatial filter**, and whether each element is an **official source fact** or a **derived
analysis** (and if derived, which transformation).

### 15.4 Hard prohibitions

The assistant must never: give legal or planning advice; interpret regulation; infer a completion
date or timeline that no official source publishes; rank, score or recommend; apportion a
whole-object quantity to a part; combine scopes without a documented basis; present a dwelling
count (§6.6); or answer at all where the evidence does not support it. **Abstention is a correct
answer and must be a first-class, tested outcome** — exactly as `withheld` already is in the
Comparison Bridge.

### 15.5 Worked examples

| Question | Required behaviour |
|---|---|
| "What is being developed near Valdecarros?" | Resolve to `PLANNING_AMBITO` ∩ `LENS_CIRCLE`; list ámbitos touched with their four phase states; state the edition date; **do not** apportion quantities. |
| "What planning stage is this area in?" | Return the four published states verbatim, `No Necesita` preserved; cite edition and `source_state`. |
| "What changed here since the previous official snapshot?" | Diff two named editions; classify as `STATE_TRANSITION` / `NEW_AMBITO` / `MODIFIED_BY_INSTRUMENT` / `ABSENT_FROM_EDITION`; **never** call it progress. |
| "Show urban licences granted within 500 m during the last year." | Available **only** after the NDP crosswalk exists; must state that the register contains granted licences only (`RESOLUCION` has one value) and that building and activity licences are different universes. |
| "Compare these two development areas." | Same-scope objects only; reuse the existing Bridge/Insight contracts; withhold rather than invent a basis. |
| "How many homes will be built at Valdecarros?" | **Abstain.** No audited machine-readable official source publishes dwelling counts; report remaining buildability in m² instead and say why. |

---

## 16. Academic and professional positioning

### 16.1 What the system could defensibly be called

**"Urban-planning evidence observatory"** — defensible, **conditional** on the §7 freshness
contract and the §8 scope contract being enforced in code and covered by tests. Without them the
honest description is "a map of several planning datasets".

**"Urban decision-support demonstrator"** — defensible **only** in the bounded Gate G sense: it
supports *descriptive* questions that inform a decision. It supports no decision rule, no weighting
and no recommendation, and the documentation must keep saying so.

**"Citizen-facing urban intelligence platform"** — the word *intelligence* is the risk. Defensible
if it means *evidence made legible*; indefensible if it is read as inference. Prefer
**"urban evidence lens"**, which is what it is.

### 16.2 Standards this gate requires

Reproducible acquisition (every artifact rebuildable from a documented route by a committed
builder) · explicit provenance per value · spatial-scale discipline (§8) · temporal-scale
discipline (§7) · deterministic transformations (pure, tested models — the existing pattern) ·
interpretation ceilings per source, visible at every breakpoint · no causal language without causal
evidence · **no composite score, no ranking, no index** · no AI insight without a traceable query
result · reproducible comparison states · testable transformations.

### 16.3 Potential academic novelty — stated conservatively

Putting several public datasets on one map is not novel, and this gate does not claim it is. Two
narrower claims are defensible:

1. **Edition-aware identity and change detection on a municipal planning register.**
   The ámbito files publish **15 dated editions (2013 → January 2026)** while documenting, in their
   own notes, that ámbitos are created and modified by MPG instruments. Treating
   `{edition}:{code}` as the identity key and classifying edition-to-edition differences into
   `STATE_TRANSITION` / `NEW_AMBITO` / `MODIFIED_BY_INSTRUMENT` / `ABSENT_FROM_EDITION` — rather
   than reporting "progress" — is a transferable method for official registers whose entities are
   mutable. It is the direct generalisation of the era-aware barrio key this project already
   developed for the 2017 reorganisation.
2. **Machine-checked interpretation ceilings across a dual citizen/analyst reading.**
   One frozen evidence object projected into two readings, with tests asserting that the citizen
   projection omits detail without ever rounding, merging or reordering a state, and that the
   ceiling appears in both. The usual failure mode of citizen-facing data products is a simplified
   view that quietly becomes a different claim; enforcing the absence of that divergence in CI is
   the contribution.

Both are **method** claims, demonstrated on a case. Neither is a claim about Madrid.

---

## 17. Explicit non-goals

This product will not become, and no issue from this gate may move it toward:

- a generic Smart City dashboard;
- a clone of Madrid's Geoportal, SIT viewer or VEDA;
- a clone or re-implementation of GeoLibre;
- a clone of Madrid's Digital Twin;
- a data catalogue or dataset browser;
- a collection of WebGL effects;
- an unsupported planning recommendation engine;
- a legal or urban-planning adviser;
- a predictive "AI city oracle";
- a ranking of barrios, districts or ámbitos;
- an overtourism, pressure, saturation, desirability or vitality score;
- a real-time anything;
- a publisher of dwelling or protected-dwelling counts (§6.6);
- a product that apportions whole-area quantities to parts of areas;
- a product that merges granted licences with responsible declarations, or building licences with
  activity licences;
- a general "everything about Madrid" platform (§3.3).

---

## 18. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Scope creep via Option B.** "One domain among many" becomes five domains. | **High** | §3.3 boundary table is binding; every issue names the question it serves from §5 or it is not created. |
| R2 | **Route 2 is undocumented and unlicensed.** Field meanings unknown (`FASE_UR = "6"`), sentinel dates (`9999-09-09`), denormalised totals (`EDIF_AMBITO`), no reference date, no stability guarantee. | **High** | Gate L must resolve each before production. Use **geometry and identifiers only** from Route 2; take every **quantity and state** from the dated, CC BY 4.0 Route 1 editions. |
| R3 | **BIFF8 `.xls` parsing.** The authoritative quantities ship only as legacy OLE2 workbooks. | **Medium** | Build-time Python parse with a pinned library, committed fingerprinted artifact, structure asserted against the publisher's own structure PDF, and a test that fails on schema drift — the hospitality-snapshot pattern. |
| R4 | **Ámbito identity drift across editions** (MPG creation/modification, `PGOUM-85` vs `-97`). | **High** | `{edition}:{code}` keying and the four-way transition classification (§6.6, §16.3). Never report a difference as progress. |
| R5 | **Licence layer blocked on the NDP crosswalk**, which does not exist. | **Medium** | Separate research gate (Gate M) before the implementation issue. NDP is 100 % populated, so the join is viable; the crosswalk is the work. |
| R6 | **Freshness misread as real time.** Four co-existing dates; the portal's "updated" field is a catalogue date. | **High** | §7 five-field contract, enforced in the registry and rendered in the rail. The `Plano de ordenación` case (updated 2026, coverage 1997) is the regression test. |
| R7 | **Users read the ~700-ámbito universe as the ten famous developments** (or look for "Madrid Nuevo Norte" and find `CHAMARTÍN`). | **Medium** | Citizen reading leads with the official denomination and code; no curated project list ships; a documented name-to-official-denomination note, not a rename. |
| R8 | **Public works oversold.** 17 features presented as "Madrid's public works". | **Medium** | Not adopted in this phase. If adopted, label the publishing directorate and the partial universe on the surface itself. |
| R9 | **Panel V2 regresses existing surfaces.** Bridge, Insight and Sensitivity are the strongest assets and are tightly DOM-coupled. | **Medium** | IA change must preserve their semantics exactly; the existing 522 tests plus the Playwright suite are the contract, and must stay green through the restructure. |
| R10 | **Monolithic `app.js` makes every new surface expensive.** | **Medium** | Extract only what each issue needs (§11J). No speculative refactor. |
| R11 | **Accessibility regression from density.** A 10 px floor plus more evidence in less space. | **Medium** | Progressive disclosure buys the space; contrast and target-size checks are acceptance criteria, not follow-ups. |
| R12 | **Mixed-language panel worsens as surfaces grow.** | **Low–Medium** | Decide language policy in the IA issue: one document language with a complete switch, or Spanish-first throughout. Not a per-surface choice. |
| R13 | **Portal 403s.** Madrid Crece and the twin refuse automated clients; others may follow. | **Low** | Never depend on a viewer portal. Routes 1 and 2 only, both verified accessible. |
| R14 | **Premature stack migration.** MapLibre/DuckDB/3D adopted for their own sake. | **Medium** | §11 verdicts carry explicit triggers; the spike issue must measure before anything migrates. |

---

## 19. Ordered implementation roadmap

Ordering follows §15 of the gate brief: **product semantics → information architecture → evidence
registry → first planning use case → interaction/comparison → sharing → runtime evaluation →
optional advanced visualisation → optional AI.** Nothing visual, three-dimensional or
conversational precedes the evidence architecture.

```
K1  Product boundary & semantic contract                  (docs)
     │
     ├── K2  Spatial-scope & source-freshness contract v1  (registry + rail spec)
     │        │
     │        ├── K3  [RESEARCH · Gate L]  Planning source contract
     │        │        │
     │        │        └── K6  Ámbito evidence layer v1  ◄── first production increment
     │        │                 │
     │        │                 ├── K7  Official-edition change detection
     │        │                 ├── K10 Comparison & sensitivity for ámbito scope
     │        │                 │        └── K11 Shareable evidence state & export
     │        │                 └── K12 [SPIKE] Runtime decision: MapLibre / PMTiles / DuckDB
     │        │
     │        └── K8  [RESEARCH · Gate M]  Official callejero NDP crosswalk
     │                 └── K9  Urban licences granted layer
     │
     └── K4  Information architecture V2: modes & disclosure
              └── K5  Visual language, type scale & accessibility floor
```

**Dependency order (linearised):**
`K1 → K2 → {K3, K8, K4} → {K6 (needs K3+K2+K4), K5 (needs K4)} → {K7, K10, K12 (need K6); K9 (needs K8+K6)} → K11 (needs K10) → K13 (needs K2+K6)`

| # | Issue | Kind | Blocked by |
|---|---|---|---|
| K0 | **Gate K — Madrid Urban Decision Workspace** | umbrella | — |
| K1 | Product boundary and semantic contract | docs | — |
| K2 | Spatial-scope and source-freshness contract v1 | contract + tests | K1 |
| K3 | **[RESEARCH]** Gate L — official urban-planning source contract | research | K2 |
| K4 | Information architecture V2 — modes and progressive disclosure | UI architecture | K1, K2 |
| K5 | Visual language, type scale and accessibility floor | UI system | K4 |
| K6 | Ámbito evidence layer v1 — geometry, four-phase state, remaining buildability | production | K3, K2, K4 |
| K7 | Official-edition change detection for ámbito evidence | production | K6 |
| K8 | **[RESEARCH]** Gate M — official callejero NDP crosswalk | research | K2 |
| K9 | Urban licences granted layer | production | K8, K6 |
| K10 | Comparison and sensitivity extension to `PLANNING_AMBITO` | production | K6 |
| K11 | Shareable evidence state and documented export | production | K10 |
| K12 | **[SPIKE]** Runtime decision — MapLibre / PMTiles / DuckDB-WASM | spike | K6 |
| K13 | Evidence Registry query contract for a future assistant (design only) | contract | K2, K6 |

**Delivery status**

- **K1 — delivered.** Product boundary and semantic contract. Product renamed to
  *Madrid Urban Evidence Lens* in the README H1, the `index.html` `<title>` and
  the header brand block; `docs/PRODUCT_SEMANTICS.md` added, defining the seven
  terms and copying the §3.3 boundary table verbatim; the two permanent urban
  ceilings recorded in `docs/CLAIMS_AND_LIMITATIONS.md`. Docs and product wording
  only — no dataset, no production JS, no CSS, no dependency.

---

## 20. GO / MODIFY / STOP decisions

| Idea | Decision | Condition or reason |
|---|---|---|
| Option A — tourism product, planning as context | **STOP** | Fails the distinctive-decision-utility test; 12 of 13 core questions are not tourism questions. |
| **Option B (bounded) — urban evidence lens** | **GO** | §3. Bounded by the §3.3 table. |
| Option B (broad) — "urban intelligence platform" | **STOP** | This is the scope creep the gate exists to prevent. |
| Option C — sibling product + extracted components | **STOP** | Highest cost, earliest, with nothing user-visible delivered. |
| Retain tourism surfaces unchanged | **GO** | Scopes and ceilings unchanged; not promoted, not removed. |
| Spatial-scope contract (§8) | **GO** | Prerequisite for all planning evidence. |
| Five-field freshness contract (§7) | **GO** | Prerequisite; the audit found four co-existing dates on one file. |
| Persistent scope/freshness rail | **GO** | The one element never hidden at any breakpoint. |
| Three modes PLACE / COMPARE / CITY | **GO** | Derived from §5; replaces a nav whose first button is dead. |
| `EXPLORE` as a mode | **STOP** | Not a user intent. |
| `PLANNING` as a mode | **STOP** | Names a dataset family, not a question. |
| `CHANGE` as a mode | **MODIFY → time control inside PLACE and CITY** | "What changed" is always about something already selected. |
| Dual citizen / analyst reading over one object | **GO** | §9.2, test-enforced. |
| Ámbito evidence layer, **ámbito scope only** | **GO** after Gate L | S1 + S2 + `AMBITOS_PLANEAMIENTO_URBANISTICO`. |
| Official-edition change detection | **GO** after K6 | 15 dated editions make it reproducible. |
| Parcel-level (`MCPG_Madrid_Crece`) evidence | **NOT YET** | Undocumented fields, sentinel dates, denormalised totals, no licence, no history, 5,675 polygons. Gate L decides. |
| Urban licences layer | **GO** after Gate M | Blocked only on NDP geocoding; NDP is 100 % populated. |
| Responsible declarations alongside licences | **MODIFY** | Separate instrument, separate universe; never summed with licences. |
| Public works layer | **NO-GO for now** | 17 features from one directorate is not a city-wide universe. |
| Dwelling / protected-dwelling counts | **STOP — permanently, on current evidence** | Not published in any audited machine-readable official source. Buildability m² only. |
| Madrid Crece as a source | **NO-GO** | 403 to all automated clients; promotional presentation, not a register — the Gate A precedent. |
| Madrid Digital Twin integration | **WATCH** | No verifiable third-party endpoint, no terms, 403 today. |
| Comunidad de Madrid planning duplication | **NO-GO for now** | Duplicates municipal authority; imports a second universe for no new question. |
| Current stack (Leaflet 1.9.4, vanilla JS, static) | **GO** | Measured against the real payload. |
| MapLibre migration | **NOT YET** | Named trigger + K12 measurement first. |
| PMTiles | **NOT YET** | Tied to the MapLibre decision. |
| DuckDB-WASM | **NO-GO for now** | ~10.5k + 11.5k rows is trivial in plain JS. |
| GeoParquet | **NO-GO** | No browser consumer without DuckDB-WASM. |
| React migration | **STOP** | No qualifying use case; would re-establish 522 tests' DOM assumptions. |
| 3D / building extrusion | **STOP** | The published quantity is m² by use class; 3D would over-claim built form. |
| `react-three-fiber` | **REFERENCE** | The right library if a use case ever qualifies. |
| `GeoLibre` | **REFERENCE + export interop** | Architectural reference; export target. Not embedded, not rebuilt. |
| `pyrosm` | **REJECT** | Superseded by the official callejero and municipal cartography. |
| `liquid-logo` | **REJECT** | PolyForm Shield 1.0.0 — non-compete, not open source. |
| `shadergradient` | **REJECT** | No licence file at all. |
| `liquid-glass-js` | **REJECT** | One commit ever; its core effect is the one the gate forbids. |
| Shader/glass as a runtime dependency | **STOP** | §11H. `backdrop-filter` stays. |
| 10 px type floor + seven-step scale | **GO** | Replaces ~55 ad-hoc sizes. |
| Hiding provenance at any breakpoint | **STOP** | Current behaviour; to be reversed and test-guarded. |
| Freshness traffic lights / staleness colour | **STOP** | An unsupported composite judgement. |
| Any composite score, index or ranking | **STOP** | Unchanged from Gate G. |
| `Ask Madrid` implementation | **STOP for this phase** | Design only (§15); K13 defines the contract, implements nothing. |
| Evidence Registry query contract | **GO** | Prerequisite for any future assistant; useful on its own. |

---

## 21. Gate K verdict

**GO — Option B (bounded).**

The product becomes the **Madrid Urban Evidence Lens**: a place-first reading of what official
sources document about urban development in Madrid, what stage it has reached, what changed since
the previous official edition, and what the evidence does not permit. Tourism is retained as a
documented domain and demoted from the organising frame.

The first production increment is the **ámbito evidence layer at ámbito scope** — official
geometry (765 polygons), the four published development phases, and remaining buildability in m²
by use class, from 15 dated CC BY 4.0 editions spanning 2013 to January 2026 — gated behind the
Gate L source contract and the scope and freshness contracts that precede it.

Nothing visual, three-dimensional or conversational is authorised. Five of the six audited
external repositories are rejected or reference-only, three of them on licence or maintenance
grounds that hold regardless of design taste. MapLibre, PMTiles, DuckDB-WASM and GeoParquet are
all deferred behind measured triggers rather than adopted on expectation.

### 21.1 Biggest remaining uncertainty

**Whether the four published phase states are stable enough, edition to edition, to support
honest change detection — or whether most apparent change is instrument-driven re-identification
rather than development progress.**

The sources themselves raise the doubt: the remanente files record
`ÁMBITO DE NUEVA CREACIÓN POR LA MPG.xx.xxx`, `AMBITO MODIFICADO POR LA MPG.09.316` and
`SE CAMBIA DE SITUACIÓN CON FECHA 19/07/13`, and ámbitos originate in two different general plans.
If a large share of edition-to-edition differences turn out to be creations, modifications and
reclassifications rather than state transitions, then "what changed since the previous official
snapshot" — the product's most distinctive promise — becomes a claim about **administrative
re-identification**, not about development. That would not invalidate the product, but it would
substantially change what the change surface is allowed to say.

**This is exactly what Gate L (issue K3) must measure, by differencing real editions, before K6
ships and long before K7 is designed.** Until it is measured, no change language is authorised.
