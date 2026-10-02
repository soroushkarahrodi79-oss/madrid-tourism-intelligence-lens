# Gate H — Destination Origin Context source contract

**Status:** CLOSED WITH MODIFY  
**Date:** 2 October 2026  
**Issue:** #46  
**Decision:** **H-A DOMESTIC = GO via INE direct workbook · H-B INTERNATIONAL = HOLD / WATCH**

## 1. Purpose

Gate H verifies whether origin evidence can extend the municipality-level Destination Context without inventing local geography, hiding suppression, or mixing incompatible temporal series.

Gate H does **not** authorize barrio-, district- or Lens-circle allocation.

## 2. H-A — Domestic origin context

### Decision

**GO**, with one acquisition change:

- **Originating authority and production source:** Instituto Nacional de Estadística (INE), experimental tourism measurement from mobile-phone positioning.
- **Production acquisition route:** official annual INE workbook, e.g.  
  `https://www.ine.es/experimental/turismo_moviles/exp_tmov_interno_mun_2026.xlsx`
- **Dataestur / API-SEGITTUR role:** documented redistribution/discovery route only until its annual municipality matrix is reproducibly retrievable in CI.

### Why Dataestur is not the production route

The official Dataestur OpenAPI documents:

- endpoint: `/TURISMO_INTERNO_MUN_MUN_DL`
- one required parameter: `año`
- availability since 2019
- CSV response
- meaning: origin and destination of resident tourists who visit a municipality other than their own within Spain.

However, a GitHub Actions verification on 2 October 2026 returned **HTTP 504 Gateway Time-out** for the 2025 annual CSV request. The endpoint contract is valid, but the current retrieval path fails the project's reproducibility requirement.

**Gate consequence:** do not make deployment or artifact generation depend on that API route.

## 3. INE workbook contract verified in CI

The official 2026 INE workbook was downloaded successfully in GitHub Actions.

Observed workbook characteristics:

- file: `exp_tmov_interno_mun_2026.xlsx`
- size in the calibration run: **24,062,490 bytes**
- monthly sheets observed: **2026-01 through 2026-07**
- one information sheet plus one data sheet per published month
- municipality codes follow the standard INE municipality coding system.

The workbook notes state:

1. it reports **tourists resident in Spain who travel to a province different from their province of residence**, disaggregated by origin and destination municipality;
2. to preserve statistical secrecy, **only origin-destination crossings with more than 30 tourists are published**;
3. municipality codes use the INE standard list;
4. province identifiers are included for origin and destination.

### Verified data schema

Each monthly sheet uses the following ten columns:

| Column | Field | Meaning |
|---|---|---|
| A | `mes` | source month |
| B | `mun_orig_cod` | INE origin municipality code |
| C | `mun_orig` | origin municipality name |
| D | `dest_cod` | INE destination municipality code |
| E | `dest` | destination municipality name |
| F | `turistas` | source-reported tourist count for the published crossing |
| G | `prov_orig_cod` | origin province code |
| H | `prov_orig` | origin province name |
| I | `prov_dest_cod` | destination province code |
| J | `prov_dest` | destination province name |

Madrid is directly identifiable as:

- `dest_cod = "28079"`
- `dest = "Madrid"`
- `prov_dest_cod = "28"`
- `prov_dest = "Madrid"`

No name-only join is needed.

A calibration row observed in CI, for example, reported origin `01001` Alegría-Dulantzi → destination `28079` Madrid with `turistas = 50` in 2026-01.

## 4. Unit and interpretation ceiling

The source field is **`turistas`** and the workbook describes the records as resident tourists measured through mobile-phone positioning.

Production language may therefore say:

> source-reported resident tourists from origin municipality X to Madrid municipality in month Y

Production language must **not** silently relabel the measure as:

- unique annual people;
- hotel guests;
- arrivals at a specific attraction or barrio;
- overnight stays;
- expenditure;
- trips inferred to a Lens circle;
- a complete census of every origin-destination movement.

Counts from different months must not be summed and called annual unique tourists unless the source explicitly authorizes that interpretation.

## 5. Suppression, missing and zero semantics

This is a hard constraint.

The workbook only publishes origin-destination crossings with **more than 30 tourists**. Therefore:

- an absent origin-destination row is **not zero**;
- an absent row may mean a suppressed small cell;
- the published origin set is incomplete by design;
- the visible sum of published Madrid origins is **not the complete Madrid total** unless independently verified against a source-published total.

For V1, do not manufacture a residual category and do not calculate a "share of all domestic tourists" using the visible rows as if they were complete.

If a share is later introduced, its denominator must be explicitly source-published or labelled as a share of **published, non-suppressed crossings**.

## 6. Temporal contract

The production unit is monthly even though the source is packaged in an annual workbook.

The artifact must preserve separately:

1. **source month** — the month represented by the sheet/row;
2. **workbook year** — acquisition container, not an observation date;
3. **retrieved_at** — when the project downloaded the workbook;
4. **publisher update state** — latest month actually present in the workbook.

A builder must discover available monthly sheets from the workbook rather than assume all 12 months exist.

## 7. Required H-A production artifact contract

A future builder is authorized only if it:

- downloads the official INE workbook directly;
- verifies the information-sheet suppression statement;
- discovers monthly sheets dynamically;
- requires the exact ten-column schema or fails closed;
- keeps municipality codes as zero-padded strings;
- filters destination strictly by `dest_cod == "28079"`;
- requires `dest == "Madrid"`, `prov_dest_cod == "28"` and `prov_dest == "Madrid"` as corroborating assertions;
- preserves origin municipality code and name;
- accepts only finite, non-negative integer `turistas` values;
- never converts a missing crossing to zero;
- records source URL, workbook year, retrieved_at, latest source month and a structural/schema fingerprint;
- emits no barrio, district or Lens-circle geography.

## 8. Authorized V1 product question

H-A may extend Destination Context to answer:

> **Which published Spanish origin municipalities are represented among resident tourists travelling to Madrid municipality in a selected month?**

It may support a descriptive table or chart of source-published counts by origin municipality.

It may **not** answer:

- which market is "best" or "most valuable";
- where within Madrid those tourists go;
- what they spend;
- how long they stay;
- what caused the origin pattern;
- the complete share of every domestic origin when suppressed cells are absent.

## 9. H-B — International origin context

### Decision

**HOLD / WATCH.**

INE states that the experimental inbound mobile-phone series ends with reference month **December 2025** because inbound measurement is being integrated into FRONTUR. Future municipality-level FRONTUR results will not be comparable with the experimental series.

Therefore H-B must not be presented beside H-A as if both were current, synchronized origin series.

A future H-B reopening requires:

- the new FRONTUR municipality result to be published;
- its unit and geography to be verified;
- its comparability break to be represented explicitly;
- no stitched trend across the experimental/FRONTUR boundary unless the publisher supplies a valid bridge.

## 10. Gate H ruling

**MODIFY → H-A DOMESTIC GO via direct INE workbook. H-B INTERNATIONAL HOLD / WATCH.**

The next authorized implementation is a **Domestic Origin Context v1** inside the existing municipality-level Destination Context.

No international-origin production UI is authorized yet.

## 11. Evidence record

- Dataestur OpenAPI: `https://www.dataestur.es/app/themes/mini-mandrake/apidata/openapi.json`
- Dataestur endpoint: `/TURISMO_INTERNO_MUN_MUN_DL`
- INE domestic workbook: `https://www.ine.es/experimental/turismo_moviles/exp_tmov_interno_mun_2026.xlsx`
- CI workbook verification run: GitHub Actions run `36925080216`
- Dataestur 504 verification run: GitHub Actions run `36987032885`

The runtime UI and production data remain unchanged by Gate H.
