# Gate L — Official urban-planning source contract

**Status:** closed. **Type:** research gate (no production data, no production UI, no
runtime dependency). **Issue:** #65 (K3), part of #62. **Branch at open:**
`origin/main` `3fa3843e55dbab6cdd1f4a8528a9179dff1b4b5a` (post-K2 / PR #77).

Every figure below is produced by the reproducible audits in
[`research/urban_planning_gate/`](../research/urban_planning_gate/) and committed as
JSON under `results/`. Source values are quoted verbatim and kept separate from the
project reading, with the ceiling stated explicitly. Counts are observations of the
run whose fingerprints the results record, not repository invariants.

---

## 1. Executive verdict

**Overall: GO WITH CONDITIONS.** #68 may ship an ámbito evidence layer **at ámbito
scope**, drawing geometry and identifiers from the ArcGIS service (under attribution)
and **every quantity and state from the dated CC BY 4.0 editions**, subject to the
binding ceilings in §23. #69 may build an **edition-to-edition change surface, but
only within a single schema era, keyed `{edition}:{code}`, using the five published
change labels in §25 and never the word "progress".**

The decisive question — *when two editions differ, is that a stable change in the
same entity, or administrative re-identification?* — is answered by measurement, not
assertion: **entity continuity is high within a schema era** (S1 2025-07 → 2026-01:
653 of 665 shared ámbitos identical; 12 substantive differences), so apparent change
is **not** mostly re-identification. **But** three findings bound what may be built:

1. There is **no single comparable 2013 → 2026 series.** S1 has two schema eras and
   S2 has four; the four-phase structure exists only in the three most recent
   editions. Cross-era differencing is barred.
2. The four phase columns are **not a scalar "stage".** They are multi-dimensional
   (empirically non-funnel), and plan-of-origin markers (`PGOUM 85` / `PGOUM 97`)
   occupy **42.4 %** of phase cells. No single "development stage" is defensible.
3. **No usable dwelling count exists.** A column labelled `Nº Viviendas` is published,
   but its values are exactly `Edif. Residencial ÷ 100` and fractional — a mechanical
   m²/100 proxy, not a count. Buildability ships in **m² only**.

Per-sub-gate: **L1 GO · L2 MODIFY · L3 MODIFY · L4 GO (with a binding ceiling) · L5
MODIFY · L6 exclusions recorded.**

### Source fact vs project interpretation — the discipline used throughout

> **SOURCE FACT:** `URBANIZACIÓN. OBRAS = En Ejecución` is an official published
> phase value. **PROJECT INTERPRETATION:** it is an administrative state, not a
> measurement of physical construction. **NOT PERMITTED:** "construction is 60 %
> complete". `PLANNING_STATE_TRANSITION ≠ PHYSICAL_URBAN_CHANGE`.

---

## 2. Sources and retrieval method

| Family | Dataset | Catalogue |
|---|---|---|
| **S1** Estado de desarrollo | `203200-0-desarrollo-ambitos` | datos.madrid.es, CC BY 4.0 |
| **S2** Edificabilidad remanente | `203182-0-ambitos-remanente` | datos.madrid.es, CC BY 4.0 |
| Geometry | `AMBITOS_PLANEAMIENTO_URBANISTICO/MapServer/0` | sigma.madrid.es ArcGIS REST |
| Docs | `203200-13`, `203200-14`, `203182-7` (PDF) | datos.madrid.es |

Resources are resolved from the CKAN `package_show` action by their exact
human-readable `description` (family + edition label), which is unique per resource.
The opaque numeric resource id is recorded but **never** used to select or order — §6
proves it is non-chronological. The ArcGIS layer is queried read-only.

## 3. Reproducibility and fingerprints

The audits are deterministic and re-runnable (`research/urban_planning_gate/README.md`).
Each `.xls`/`.pdf` and the geometry are streamed into a git-ignored cache,
fingerprinted (SHA-256, byte size, HTTP `Last-Modified`/`ETag`, retrieval timestamp)
into a JSON sidecar, parsed, and never committed. Only the compact normalized JSON
under `results/` is committed. The **BIFF8 reader is `xlrd` 2.0.2**: xlrd 2.0 reads
only legacy BIFF `.xls` OLE2 compound documents — exactly these files; `openpyxl`
cannot read them. It is a research-only dependency, absent from `package.json`.
Each edition's own publication date is read from the **OLE2 root-entry FILETIME**.

---

## 4. L1 — Edition inventory  ·  **GO**

Both families publish **15 dated XLS editions**. The complete inventory, with each
edition's resource id, URL, byte size, SHA-256, OLE2 created/modified timestamps and
own stated reference date, is in `results/l1_edition_inventory.json`.

- **S1 (203200):** editions 2013-01 … 2024-01 (annual), then 2025-01, 2025-07,
  2026-01. License CC BY 4.0. Each edition's reference date is read from inside the
  file — the `Estado del desarrollo a fecha` column (an Excel serial; `46023` =
  2026-01-01), confirmed by the structure PDF as *"Fecha recogida de los datos"*.
- **S2 (203182):** the same 15 reference dates.

## 5. Snapshot identity contract

A resource id is not identity; a filename is not identity; a month label is not
identity. **Snapshot identity = `family : reference_date : sha256[:12]`** (e.g.
`S1:2026-01:585db074c122`). All 15 identities per family are unique
(`l1_summary.json → snapshot_identities_unique = true`). #68 must select "latest" by
reference date within a schema era, never by resource id or name.

## 6. Declared vs observed cadence

Both recorded, neither corrected. **Declared:** the catalogue's machine-readable
`frequency = ANNUAL_2` (EU authority = twice a year), i.e. the portal's prose
*"Semestral"* and the structure PDF's *"semestral … a final del primer trimestre y a
mediados del cuarto trimestre"*. **Observed:** annual (12-month gaps) 2013 → 2024,
then semestral (6-month gaps) from 2025. The declared cadence is correct only for the
recent period.

**Resource-id order is not chronological** (`l1_summary → non_chronological_proof`):
S1 shows **72** id/date inversions, S2 shows **42**. Worked examples: `203200-2` =
Julio 2025, `203200-15` = Enero 2026, `203200-16` = Enero 2025. Selecting "latest"
by id would return the wrong edition.

### The schema-era finding (why there is no single series)

The 15 editions are **not one comparable series**. Classified by header fingerprint:

| Family | Schema era | Editions |
|---|---|---|
| **S1** | `S1_SINGLE_STATE_PER_DISTRICT` (one `Estado de Desarrollo` column, 21 district sheets) | 2013 … 2024 |
| **S1** | `S1_FOUR_PHASE_FLAT` (flat, four phase columns) | 2025-01, 2025-07, 2026-01 |
| **S2** | `S2_VAC_CODORD` (`CODORD`, `VACRES/VACIND/VACTER`) | 2013, 2014 |
| **S2** | `S2_SINGLE_RESIDENTIAL` (single `Edif. Residencial`) | 2015 … 2019 |
| **S2** | `S2_COLECTIVA_UNIFAMILIAR` | 2020 … 2024 |
| **S2** | `S2_SPLIT_RESIDENTIAL_FLAT` (current 13-column schema) | 2025-01, 2025-07, 2026-01 |

The four-phase vocabulary that #68/#69 need exists **only in the three most recent S1
editions**. Cross-era differencing is barred.

---

## 7. L2 — Ámbito identity & difference classifier  ·  **MODIFY** *(the decisive sub-gate)*

Every difference between two editions is classified into exactly one of five classes,
with deterministic precedence and **no silent fallback and no `OTHER`**:

1. `NEW_AMBITO` — code absent earlier, present later
2. `ABSENT_FROM_EDITION` — code present earlier, absent later
3. `MODIFIED_BY_INSTRUMENT` — present in both, later notes record an MPG modification
4. `STATE_TRANSITION` — present in both, a phase/situación value changed, no documented instrument
5. `CAUSE_UNRESOLVED` — present in both, another field changed and the source states no cause

Two non-difference buckets keep the five classes honest: `IDENTICAL` and
`COSMETIC_TEXT_DRIFT`. The publisher re-encodes note text between editions (adding
accents: `AMBITO DE NUEVA CREACION` → `ÁMBITO DE NUEVA CREACIÓN`); folding
accents/case/whitespace for the equality test keeps that out of the substantive
classes while the verbatim strings are preserved. **Not doing this inflated the S2
unresolved rate from 5 % to 75 % — the exact fabrication this gate exists to prevent.**

### 8. Decisive-pair results — 2025-07 → 2026-01 (chosen from the inventory as the latest within-era consecutive pair)

| Class | S1 count | S1 share | S2 count | S2 share |
|---|---|---|---|---|
| NEW_AMBITO | 2 | 16.7 % | 0 | 0 % |
| ABSENT_FROM_EDITION | 0 | 0 % | 9 | 47.4 % |
| MODIFIED_BY_INSTRUMENT | 0 | 0 % | 0 | 0 % |
| STATE_TRANSITION | 10 | 83.3 % | 9 | 47.4 % |
| CAUSE_UNRESOLVED | 0 | 0 % | 1 | 5.3 % |
| **substantive differences** | **12** | of 665 shared | **19** | of 230 shared |
| cosmetic text drift (excluded) | 0 | | 54 | |

`MODIFIED_BY_INSTRUMENT = 0` is a real observation, not a regex miss: the MPG notes
(`ÁMBITO DE NUEVA CREACIÓN POR LA MPG.02.317`) are **persistent provenance** present
in both editions for the same code, not inter-edition change events. Absence is
documented by the published annex `Ámbitos del PGOUM que no son objeto de seguimiento`
(court annulment, MPG re-ordering, cession to other municipalities, deadline
prescription, historic colonies).

### 9. All-pair robustness

`l2_identity.json → all_consecutive_pairs` classifies every consecutive pair.
Cross-era pairs are reported `NON_COMPARABLE` and never differenced; within-era pairs
are compared. The decisive pair is representative of its era (high continuity, no
unresolved explosion once cosmetic drift is folded).

### Entity-identity verdict

Entity continuity within a schema era is **high** (S1: 653/665 identical). Change is
**not** mostly re-identification. **But** identity across editions is only safe under
`{edition}:{code}` keying (the planning analogue of the barrio `{era}:{code}` rule),
cosmetic-drift folding, and the schema-era boundary. Hence **MODIFY**: a change
surface is defensible with those conditions, not as a naive delta.

### 10. Change-language ceiling

`STATE_TRANSITION` and `ABSENT_FROM_EDITION` are administrative facts. None may be
rendered as "progress", "advanced", "improved", "works completed" or physical change.

---

## 11. L3 — Phase vocabulary  ·  **MODIFY**

The four phase columns (`Planeamiento`, `Gestión`, `Urbanización. Proyecto`,
`Urbanización. Obras`) exist only in the three recent S1 editions.

**Observed values:** `Sin Iniciar`, `En tramitación`, `En Ejecución`, `Finalizado`,
`No Necesita`, `PGOUM-85`, `PGOUM-97` — plus spelling variants (`En  Tramitación`,
`Finalizada`, `Finalizadas`, `FinalizadaS`).
**Documented by the structure PDF (v. Nov 2025):** `En Tramitación`, `Finalizado`,
`No necesita`, `PGOUM 85`, `PGOUM 97`, `Sin Iniciar`.

- **`En Ejecución` is observed but NOT documented** — a live phase value the PDF omits.
- `Finalizada` / `Finalizadas` are number/gender spelling drift of `Finalizado`.
- `PGOUM-85` / `PGOUM-97` are documented (as `PGOUM 85` / `PGOUM 97`) — punctuation
  drift — and are **plan-of-origin markers occupying phase cells, 42.4 % of all phase
  cells**, not progress states. The vocabulary is therefore **partly source-documented,
  partly source-observed, and drifts across editions.**

### 12. Phase-ordering analysis — multi-dimensional, no scalar stage

Empirically, a "later" phase is advanced while an "earlier" phase is not advanced in
**9** cases (`l3_phases.json → ordering_analysis`, PGOUM markers and `No Necesita`
excluded). The four phases are **independent administrative dimensions, not a funnel**;
the structure PDF describes four separate states and documents no ordering. **Verdict:
`MULTI_DIMENSIONAL_NO_SCALAR_STAGE` — no single derived "overall stage" is defensible.**

### 13. `No Necesita`

Listed by the structure PDF as an expected value, but its **meaning is never defined**
by the publisher. Per the gate rule, the project reading "the phase does not apply" is
**SOURCE-OBSERVED, not SOURCE-DOCUMENTED** → `SOURCE_OBSERVED_INTERPRETATION_UNRESOLVED`.
Structurally, `No Necesita` and `Sin Iniciar` are distinct listed values and **must
never collapse** to one internal state.

---

## 14. L4 — Buildability semantics  ·  **GO** (with a binding ceiling)

The structure PDF (v. Nov 2025) defines the dataset verbatim: *"edificabilidad
**disponible** para los usos lucrativos Residencial, Servicios Terciarios e Industrial
en los ámbitos de ordenación **vigentes** … según la situación del ámbito."*

| Field (verbatim) | Meaning (PDF) | Unit |
|---|---|---|
| `Colectiva. Edif. Residencial` | available collective-residential buildability | **m²** |
| `Unifamiliar. Edif. Residencial` | available single-family buildability | **m²** |
| `Edif. Industrial` | available industrial buildability | **m²** |
| `Edif. Terciario` | available tertiary buildability | **m²** |

**Meaning of "remanente":** the publisher's word is *disponible* (available) under the
plan, for currently-valid ámbitos, according to situación. It does **not** mean
"remaining to be physically built", "remaining unallocated", or "will be consumed".
Supported claim: **available/remaining buildability (m²) under the plan, by use.**

### 15. Cross-edition buildability comparability

Buildability fields change across schema eras (`VACRES/VACIND/VACTER` → single
`Edif. Residencial` → `Colectiva`/`Unifamiliar` split), so **cross-era deltas are
barred**. Even within the recent era a city total shifts because ámbitos enter/leave
and situación rebases the universe, so an edition-to-edition difference is at most an
**`OBSERVED PUBLISHED DIFFERENCE` with cause unresolved**, never construction.

### 16. No-dwelling-count ceiling — **BINDING**

S2 **does** publish `Colectiva. Nº Viviendas` / `Unifamiliar. Nº Viviendas`, documented
as *"Nº de viviendas disponibles … en unidades"* — which **corrects Gate K §6.6's claim
that no dwelling-count field exists.** But the published values equal
`Edif. Residencial ÷ 100` at a **match rate of 1.0** across every row, and are
**fractional** (e.g. 163.167; 113 of 132 collective rows, 40 of 41 single-family rows).
They are a **mechanical m²/100 proxy at an assumed 100 m²/dwelling, not a count of real
dwelling units.** No protected-housing count column exists. Therefore the product
publishes **buildability in m² only** and must never present `Nº Viviendas`, any
`m² ÷ assumed size`, or any extrapolated protected-housing figure as a dwelling count.

---

## 17. L5 — Geometry join  ·  **MODIFY**

The ArcGIS layer serves **765 features**, but is a **mixed universe**, not "765
ámbitos": 723 ámbito-like codes, **18 Norma Zonal grades** (e.g. `1.1` = "ZONA 1 GRADO
1º") and 24 other — correcting Gate K. The join `AMB_TX_ETIQ` = edition `Codigo`:

| Against | Table codes | Exact matched | Rate | Unmatched in geometry | Unmatched in table |
|---|---|---|---|---|---|
| **S1** (2026-01) | 667 | 666 | **99.85 %** | 99 | 1 |
| **S2** (2026-01) | 230 | 230 | **100 %** | 535 | 0 |

Geometry-only residuals are the zonal grades, "not monitored" ámbitos (which have
geometry but no estado row) and the extra non-ámbito codes — each classified in
`l5_geometry.json`. A **normalised** match hypothesis (strip `-RP`/padding/case)
*reduces* S1 matches by 2 — it merges distinct codes — so **exact matching is the
default** and normalisation is rejected.

### 18. Geometry CRS / reprojection

Service CRS **EPSG:25830** (confirmed from `spatialReference.wkid`). Deterministic
reprojection to **EPSG:4326** via pyproj for browser rendering (sample: 25830
`[440461.02, 4475228.89]` → 4326 `[-3.701881, 40.425564]`, central Madrid). Cost for
#74: **765 polygons, 291,407 vertices, ~11.2 MB** raw GeoJSON at 25830. No runtime
migration decision is made here.

### 19. Geometry freshness

The layer exposes **no `editingInfo`** — no `lastEditDate`, no reference date, no
cadence. Geometry therefore carries **`reference_date: null`** and
**`source_state: NOT_DECLARED_BY_PUBLISHER`** with an observed resource state. It must
be retrieved at build time, committed as a fingerprinted artifact, and **never called
at runtime**. Currency is never inferred from server response, catalogue date or
retrieval time.

### 20. Geometry reuse basis — **MODIFY**

The layer `copyrightText` is empty; the service asserts *"Ayuntamiento de Madrid. Área
de Desarrollo Urbano Sostenible…"* as attribution but **no licence or reuse statement**
(`licenseInfo` absent). Reuse is therefore defensible only under the municipal
open-data general conditions **with attribution** — a MODIFY, not a GO. The
authoritative quantities and states come from the CC BY 4.0 editions; the service
supplies geometry and identifier only.

### 21. `-RP` suffix semantics

The structure annex `203200-14` defines `(*)` as *"Ámbito creado por la Revisión
Parcial del PGOUM85 y Modificación del PGOUM97"*. `-RP` = **Revisión Parcial**, a
distinct planning instrument. `UZP.3.01` (Valdecarros) is listed there as **annulled
by court sentence**, while `UZPp.03.01-RP` is its **active replacement** in the
geometry. **Verdict: `-RP` is a distinct ámbito; match on the exact identifier and
never strip the suffix** — doing so would merge an annulled ámbito with its replacement.

---

## 22. L6 — Sources audited and not adopted

| Source | Measurement | Verdict |
|---|---|---|
| `MCPG_Madrid_Crece` | 5,675 parcels, 74 fields; `EDIF_AMBITO` 7,686,472.9 m² repeated on all **2,003** Valdecarros parcel rows → naive sum 15.4 **billion** m²; `FASE_UR` undocumented; `F_BAJA_G = 9999-09-09` sentinel; `F_ALTA_G`/`SUP_AMBITO` null; no licence | **NOT YET** |
| `FASES_RECEPCION_URBANIZACION` | 3 features; `FECHA` typed String | not a usable universe |
| `OBRA_PUBLICA` | 17 features, one directorate | not a city-wide universe |
| `ETAPAS_DESARROLLOS_DEL_SURESTE` | 46 polygons, `ETAPA` integer, no reference date | defer (needs a date and a city-wide universe) |
| `PLAN_18000` | 21 parcels, no dwelling-count field | not adopted |
| `madridcrece.madrid.es`, `gemelo.madrid.es` | **403** to automated clients with and without a browser UA (recorded, never bypassed) | not a retrieval route — presentation surfaces (the Gate A esmadrid precedent) |
| "51,000 viviendas" class of figure | not retrievable from any audited machine-readable official source | **PRESENTATION SURFACE / NOT A REPRODUCIBLE RETRIEVAL ROUTE** — not publishable |

MCPG revisit conditions: `FASE_UR` documented, sentinel/null date semantics published,
the `EDIF_AMBITO` denormalisation resolved, and an explicit reuse statement.

---

## 23. Implications for #68 — the production contract

#68 should not need to reinterpret the source. It is authorised to ship, with:

- **Source family:** S1 `203200` (estado) + S2 `203182` (remanente), paired by code.
- **Accepted edition identity:** `family : reference_date : sha256[:12]`.
- **Latest-selection algorithm:** newest `reference_date` **within the current schema
  era** (`S1_FOUR_PHASE_FLAT` / `S2_SPLIT_RESIDENTIAL_FLAT`); never by resource id or name.
- **Join key:** exact `AMB_TX_ETIQ` = `Codigo`; never strip `-RP`.
- **Geometry source:** `AMBITOS_PLANEAMIENTO_URBANISTICO` (ArcGIS), filtered to
  ámbito-like codes present in the edition (the mixed universe is not the ámbito set).
- **Geometry reuse basis:** municipal general conditions **with attribution** (MODIFY);
  geometry committed as a fingerprinted build artifact, reprojected 25830 → 4326,
  never called at runtime.
- **Analytical scope:** `PLANNING_AMBITO`; `LENS_INTERSECT_AMBITO` for the circle∩ámbito
  reading, which never apportions an ámbito's whole-object quantities.
- **Freshness fields:** editions carry `reference_date`, `published_at` (OLE2),
  `retrieved_at`, `update_frequency = SEMESTRAL` (declared) with `observed_cadence`,
  `source_state = DEFINITIVE`; geometry carries `reference_date: null`,
  `source_state: NOT_DECLARED_BY_PUBLISHER`.
- **Phase fields allowed:** the four S1 phase columns, each as an independent state,
  verbatim (`No Necesita` preserved and kept distinct from `Sin Iniciar`); **no derived
  scalar stage**; render `PGOUM 85`/`PGOUM 97` as plain plan-of-origin markers.
- **Buildability fields allowed:** `Colectiva`/`Unifamiliar. Edif. Residencial`,
  `Edif. Industrial`, `Edif. Terciario`, **unit m²**; `SITUACION DEL ÁMBITO` (S2)
  verbatim with its documented definitions.
- **Null semantics:** an explicit null reference date (geometry) is known absence, kept,
  never back-filled.
- **Interpretation ceiling:** administrative states only; no physical-progress or
  timeline claim; no ranking; no causal attribution of a change.
- **Prohibited derived quantities:** dwelling counts, `Nº Viviendas` as a count,
  `m² ÷ assumed size`, protected-housing counts, household capacity, a scalar stage,
  any cross-era delta.

## 24. Implications for #69

#69 may build an edition-to-edition change surface **only within one schema era**,
keyed `{edition}:{code}`, with cosmetic text drift folded, classifying each difference
into exactly one of the five L2 classes, and surfacing counts per class per pair. It
must present a `NON_COMPARABLE` state across schema-era boundaries rather than a delta.

## 25. Permitted change language for #69

Allowed (and only these): **`Published state changed`** (STATE_TRANSITION),
**`New in this edition`** (NEW_AMBITO), **`Absent from this edition`**
(ABSENT_FROM_EDITION), **`Modified by planning instrument`** (MODIFIED_BY_INSTRUMENT),
**`Cause unresolved`** (CAUSE_UNRESOLVED). Each must cite the two editions' reference
dates. **Forbidden:** `progress`, `advanced`, `improved`, `construction completed`,
and any physical-change phrasing.

## 26. Overall Gate L verdict

**GO WITH CONDITIONS.** The official editions and geometry are a reproducible,
licence-defensible basis for an ámbito evidence layer and a within-era change surface,
provided every ceiling in §23–§25 holds. L1 GO · L2 MODIFY · L3 MODIFY · L4 GO (binding
no-dwelling ceiling) · L5 MODIFY · L6 exclusions recorded. No production data, no
production script, no UI change and no runtime dependency is introduced by this gate.
