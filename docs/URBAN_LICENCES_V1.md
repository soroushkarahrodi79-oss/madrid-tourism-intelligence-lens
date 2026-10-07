# Granted urban licences V1 (K9, #71)

The official **granted urban-licence** layer: which administrative urban licences
the Ayuntamiento de Madrid granted, resolved to an official address point through
the Callejero Oficial, readable inside a Lens circle by **licence family** and
**grant-date window**.

It is an **administrative-record layer, not a construction-progress layer**, and
every part of it — the artifacts, the model, the validator — is built so it cannot
imply otherwise.

This document is the standing record of the V1 data layer, model and deployment
guardrails shipped by #71 on top of the Gate M (#70) research
([`docs/CALLEJERO_NDP_CROSSWALK_GATE_M.md`](CALLEJERO_NDP_CROSSWALK_GATE_M.md)).

## 1. Source universe

| Role | Dataset | Resource | Rows (pinned) | Licence | Cadence |
|---|---|---|---:|---|---|
| Granted licences | `640505-0-licencias-urbanisticas-otorgadas` | `640505-1` | 11,498 | CC BY 4.0 | MONTHLY |
| Current callejero | `213605-0-callejero-oficial-madrid` | `213605-4` | 214,697 | CC BY 4.0 | WEEKLY |
| Historical callejero | `213605-0-callejero-oficial-madrid` | `213605-1` | 379,297 | CC BY 4.0 | WEEKLY |

All official-source retrieval happens at **build time**. The committed artifacts
are fingerprinted (SHA-256) and the browser never calls `datos.madrid.es` or
`geoportal.madrid.es` for K9 evidence. No third-party geocoder (no Google, OSM /
Nominatim or Mapbox) and no fallback coordinate estimation is used anywhere.

## 2. The granted-only ceiling (absolute)

`RESOLUCION = Conceder` for all 11,498 / 11,498 pinned rows. A granted licence
means **an administrative grant was recorded**. It does **not** mean work started,
construction occurred, construction completed, occupancy happened, the permitted
quantity was built, the project is active or the project is finished.

Because the register is granted-only there is **no denominator of
applications/refusals**, so the layer structurally forbids — and the deployment
validator rejects — any approval rate, rejection rate, refusal count, success rate
or processing-performance rate.

## 3. Three licence families, never one total

Every `TIPO` maps to exactly **one** of three families through a **closed
taxonomy**. An unseen `TIPO` **fails the build**; nothing is silently mapped to
`OTHER`.

| Family | Rows (pinned) |
|---|---:|
| `BUILDING_URBANISTIC_LICENCE_FAMILY` | 5,938 |
| `ACTIVITY_LICENCE_FAMILY` | 5,385 |
| `TEMPORARY_ACTIVITY_FAMILY` | 175 |
| unclassified | 0 |

Temporary activity is never collapsed into general activity. The three families
are **never summed into one cross-family total** — the model exports no
`totalUrbanLicences()` / `allLicenceTotal()` / `overallLicenceCount()` and a
structural test (`tests/urban_licences.test.mjs`) asserts none is ever added.

### TIPO → family map

| `TIPO` | Family |
|---|---|
| Licencia básica actividad | ACTIVITY |
| Licencia básica residencial | BUILDING |
| Licencia básica urbanística residencial sujeta a Ley 3/2024 | BUILDING |
| Licencia de 1ª ocupación y funcionamiento | BUILDING |
| Licencia de funcionamiento de actividad | ACTIVITY |
| Licencia urbanística de actividad | ACTIVITY |
| Licencia urbanística residencial | BUILDING |
| Licencia urbanística residencial sujeta a Ley 3/2024 | BUILDING |
| Licencias para actividades temporales | TEMPORARY |

## 4. Current + historical NDP crosswalk

The join is exact licence `NDP` → callejero `COD_NDP` as **decoded source text**:
no integer coercion, no zero-stripping, no rewriting of identifiers.

* **Current.** An exact `COD_NDP` resolves a licence only when the current match is
  **unique**. A duplicated current key withholds geometry
  (`AMBIGUOUS_NDP_MULTI_MATCH`). In the pinned edition the current file has 76
  duplicated NDPs across 472 rows, and **zero** licence NDPs intersect them — but
  the rule is enforced for any future duplication: never choose the first.
* **Historical.** When no unique current record exists, the builder attempts the
  official historical file. Bare NDP is insufficient (81,885 NDPs have multiple
  historical versions). The version is selected by the licence grant date against
  `FECHA_DE_ALTA` / `FECHA_DE_BAJA`, and geometry is published only when **exactly
  one** dated version is active.

### Historical active-version rule

A historical record is eligible when `FECHA_DE_ALTA <= grant_date` **and**
(`FECHA_DE_BAJA` is empty **or** `grant_date <= FECHA_DE_BAJA`). If zero versions
are active → `CAUSE_UNRESOLVED`; if more than one → `AMBIGUOUS_NDP_MULTI_MATCH`.
Never first/last/arbitrary.

### Historical version identity

`{callejero_resource_sha256}:{COD_NDP}:{FECHA_DE_ALTA}:{FECHA_DE_BAJA}`. Versions
are never collapsed by bare NDP.

### Licence date

The licence date for historical selection is **`FECHA_FIRMA_RESOLUCION`** (the
signature date). `FECHA_ALTA` (the expediente registry-entry date) is never
substituted. A missing signature date is `DATE_UNAVAILABLE`, with no automatic
fallback.

### Crosswalk states

Observed in Gate M: `RESOLVED`, `ADDRESS_TEXT_DISAGREEMENT`,
`NDP_FOUND_HISTORICAL_ONLY`, `CAUSE_UNRESOLVED`, `NDP_ABSENT_CURRENT_CALLEJERO`.
Guarded for a future edition and produced only when observed:
`AMBIGUOUS_NDP_MULTI_MATCH`, `NDP_PRESENT_NO_COORDINATE`, `NDP_PRESENT_NO_BARRIO`,
`MALFORMED_NDP`, `DATE_UNAVAILABLE`. No state collapses into a generic `N/A`.

## 5. Pinned coverage — 97.97%

| Measure | Pinned value |
|---|---:|
| Licence rows | 11,498 |
| Distinct licence NDPs | 7,938 |
| Resolved rows | 11,265 |
| Resolved distinct NDPs | 7,795 |
| Unresolved rows | 233 |
| Unresolved distinct NDPs | 143 |
| Current-only resolved rows | 11,179 |
| Historical-only recovered rows | 86 |
| Row match rate | 97.97% |
| Distinct-NDP match rate | 98.20% |

These are reproduced from the pinned source edition by the builders, not hardcoded
as permanent truths; `tests/test_urban_licences_builders.py` asserts them and
records them as the Gate M baseline. The coverage percentage shown anywhere is
**artifact-derived**, never a hardcoded 97.97, and the layer never claims complete
coverage.

### The 233 unresolved rows are evidence, not zero

The 233 unresolved rows survive in the crosswalk records (with their residual
state and no geometry) and in both artifacts' coverage metadata, per family and
per year. They are **withheld from the map** — never geocoded externally or
approximated — but they are never dropped from the denominator. The mapped layer
is the **resolved subset** of a known register.

### Address-text disagreement

517 resolved rows carry a structured address-text disagreement between the licence
file and the current callejero. Exact NDP identity remains authoritative:
`ADDRESS_TEXT_DISAGREEMENT` is retained as a quality/provenance state, no
coordinate is moved to make the text agree, and nothing is re-geocoded from text.

## 6. Barrio / district provenance — current vs historical

A current-resolved row's barrio and district are the callejero's own official
codes (`OFFICIAL_CURRENT_CALLEJERO_BARRIO`). The historical file publishes no
barrio, so a historical-only row's barrio is derived from the official historical
coordinate against the project's canonical barrio polygons
(`POLYGON_DERIVED_FROM_OFFICIAL_HISTORICAL_COORDINATE`). The two provenances are
**kept distinct** and never presented as identical. The current callejero
publishes exactly the canonical 131-barrio set (asserted at build time, fail-closed).

## 7. Coordinates

The stored coordinate is the official ETRS89 / UTM (`UTMX_ETRS` / `UTMY_ETRS`,
EPSG:25830) reprojected to EPSG:4326 with the explicit, deterministic pyproj
pipeline the repository already uses and verifies for the planning geometry. The
same UTM coordinate drives the historical barrio containment, so one official
coordinate source is used for both.

## 8. Date semantics

The grant date is parsed by a **deterministic** Spanish parser (explicit weekday
and month maps, the exact observed grammar, no machine locale, no fuzzy parser).
In the pinned data all 11,498 `FECHA_FIRMA_RESOLUCION` values parse and every
publisher year/month/day component agrees; drift fails the build. The register's
grant-date extent (2023-01-13 … 2026-09-30 at calibration) is **derived** from the
records and bounds the date window; it is never a publication date and
`2026-09-30` is never assumed.

## 9. Three NIVEL_PROTECCION states, and NORMA_ZONAL missingness

`NIVEL_PROTECCION` carries 29 distinct values: the three absence-like states plus
26 real protection grades. The three absence-like states are **kept distinct** and
never merged (empty is stored as `null`; the two named states keep their verbatim
value):

| State | Pinned count |
|---|---:|
| empty (stored as `null`) | 2,507 |
| `Sin Catalogar` | 5,340 |
| `Sin protección` | 1,040 |

`NORMA_ZONAL` is preserved verbatim; empty is missing/not-published (`null`), with
no cause inferred. Pinned missingness: missing 2,505; both protection and norm
missing 2,505; only protection missing 2; only norm missing 0. These are
provenance checks, not user-facing causal claims.

## 10. No responsible declarations

Dataset `133556-0-declaraciones-responsables` (declarations **presented** — a
distinct legal instrument) is **not** implemented in K9 V1: no artifact, UI, count
or layer. The licence builder records the excluded dataset id only so a guard can
assert it is never an ingested source, and both the Python suite and the
deployment validator reject its appearance. A future issue may add it as a
separate, clearly labelled evidence family; it is never joined or summed with
granted licences.

## 11. No overlap summation

Licence records may concern places also present in Censo de Locales, licensed VUT
or hospitality/activity evidence. Gate M established no deterministic entity link,
so these administrative universes are **never summed as unique businesses, sites
or tourism supply**.

## 12. Model (`js/urban-licences.js`)

A pure ES module — committed artifact in, frozen view out; no DOM, Leaflet, fetch
or clock. `licencesInLens(lensCircle, records, filters)` returns the matched
records, a **per-family** count object (each family separately quantified), the
applied window and the granted-only ceiling. It exposes no cross-family total.
Point-in-lens is the **inclusive** great-circle rule of `js/lens.js`
(`distance <= radiusM`). `clampWindow` bounds any user window to the real register
extent (before / after / reversed / same-day). The layer states are distinct:
`OFF` (disabled), `UNAVAILABLE` (artifact missing), `NO_MATCHES` (enabled, valid
window, zero matches — a real zero, not unavailable) and `AVAILABLE`.

## 13. Artifacts

| File | What it is |
|---|---|
| `data/callejero/madrid_ndp_crosswalk.json` | One resolution record per licence row (keyed by `licence_index`): exact NDP, grant date, crosswalk state, coordinate (EPSG:4326) + barrio/district for resolved rows, current/historical provenance, historical version identity, callejero resource identity + fingerprint. |
| `data/callejero/madrid_ndp_crosswalk.meta.json` | Source identities + SHA-256s, coverage (counts, match rate, residual taxonomy), barrio-provenance contract, guardrails, artifact fingerprint, runtime policy, interpretation ceiling. |
| `data/planning/madrid_urban_licences.json` | The resolved licence records (minimised fields), the three families, the date extent, the coverage block (per-family and per-year resolved/unresolved), and the granted-only ceiling. |
| `data/planning/madrid_urban_licences.meta.json` | Source provenance, crosswalk dependency + fingerprint, closed TIPO taxonomy + family counts, the three NIVEL_PROTECCION states, NORMA_ZONAL missingness, excluded dataset 133556, overlap ceiling, artifact fingerprint. |

## 14. Deployment guardrails

`scripts/validate_deployment.mjs` fails a deployment when, for either artifact:
the artifact or meta is missing; the crosswalk source fingerprint is missing; the
licence schema drifts (field creep outside the minimised allow-list); a TIPO is
unclassified; a family count collapses below its floor; the resolved count
collapses; the row match rate falls below the **0.90** floor (calibrated from the
pinned 97.97% to catch material collapse while allowing a small source update);
the date extent is missing; all rows become unresolved; the three
NIVEL_PROTECCION absence states merge; the historical recovery disappears (floor
20, baseline 86 — a separate guard against the historical route silently stopping);
residual counts fail to reconcile; a cross-family total or approval-rate key
appears; or dataset 133556 is ingested. `tests/urban_licences_validator.test.mjs`
proves each guard fires.

## 15. Rebuilding

```
python scripts/build_callejero_ndp_crosswalk.py     # downloads ~99 MB in memory; or --cache-dir <dir>
python scripts/build_urban_licences.py              # reads the committed crosswalk + the licence register
node scripts/validate_deployment.mjs
```

## 16. What this layer is not

Granted ≠ built. No approval/rejection rate. No cross-family total. Not a density,
heatmap, choropleth, kernel surface or per-area intensity. Not a barrio or district
ranking. Counts are `ADDRESS_POINT` records inside a Lens circle and are never
converted into a barrio-level figure or compared with a barrio total without an
explicit, separate scope.
