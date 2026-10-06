# Official edition change detection V1

K7 adds one bounded comparison to the K6 planning evidence surface. It answers:
what differs between two explicitly named official tabular editions for the
selected planning ámbito?

The compared references are **2025-07-01 → 2026-01-01**. Both dates remain
visible beside every comparison. K6's January 2026 current-edition record stays
primary. K7 keeps the two snapshots separately in
`data/planning/madrid_ambito_state.json` under `change_detection.previous`
and `change_detection.current`; it does not turn the K6 record into a merged
before/after object.

## Pinned source editions

Each source edition is selected by its **source-stated reference date plus the
full file SHA-256 fingerprint**. Resource ID, filename and catalogue ordering
are retained as provenance and are never selection criteria. This preserves the
existing regression in which resource IDs are non-chronological.

| Family | Reference | Snapshot identity | Resource identity | SHA-256 | Schema era |
| --- | --- | --- | --- | --- | --- |
| S1 | 2025-07-01 | `S1:2025-07:e1ff3e0e0f63` | `203200-2-desarrollo-ambitos-xls` | `e1ff3e0e0f63fe59dbe64d10b319026917c34d9086f395e9787b6fe3661cf49d` | `S1_FOUR_PHASE_FLAT` |
| S1 | 2026-01-01 | `S1:2026-01:585db074c122` | `203200-15-desarrollo-ambitos` | `585db074c122caec3293137e56742b5c9d77189205050aab328520a2dd1ec677` | `S1_FOUR_PHASE_FLAT` |
| S2 | 2025-07-01 | `S2:2025-07:09f6859a2541` | `203182-10-ambitos-remanente-xls` | `09f6859a2541ea8c31eb3ce47464ca5fbec64d38f57a7b3b435bb65e4a5cb286` | `S2_SPLIT_RESIDENTIAL_FLAT` |
| S2 | 2026-01-01 | `S2:2026-01:326edf48d221` | `203182-14-ambitos-remanente` | `326edf48d2214e73175256777fd5083a3f656a05d0bcf0bec36b63ac6cc899e8` | `S2_SPLIT_RESIDENTIAL_FLAT` |

The pair has a same-era verdict for each family. The current comparable S1 and
S2 eras contain 2025-01, 2025-07 and 2026-01. Editions from 2013–2024 use earlier
schemas and are not treated as compatible editions. A generated
**2024-01 → 2025-01** check returns `NON_COMPARABLE`; it never transforms an
older layout into the current schema.

Each edition record separately includes its full fingerprint, schema
fingerprint, resource URL and identity, reference date, publication provenance,
retrieval timestamp and source metadata. The K2 rail uses the existing
oldest-contributor rule for the K7 surface, so its single mechanical date is
2025-07-01. The comparison itself and the K4 evidence drawer expose both edition
records and both reference dates.

## Identity and classifier

An entity identity is **`{edition}:{exact_code}`**. The exact official code is
unchanged, including `-RP`. A bare code cannot resolve where an edition identity
is required.

`js/ambito-change.js` is a deterministic, DOM-free, fetch-free pure module.
It accepts explicit edition records, emits a frozen result and gives every
classification exactly one of these outcomes:

- `NO_CHANGE`
- `STATE_TRANSITION`
- `NEW_AMBITO`
- `ABSENT_FROM_EDITION`
- `MODIFIED_BY_INSTRUMENT`
- `CAUSE_UNRESOLVED`
- `NON_COMPARABLE`

`NO_CHANGE` is explicit evidence: the compared published evidence object has
no substantive difference between the two named dates. It does not say that
Madrid had no physical change. A transition displays both verbatim source
values and both dates as “Published state changed.” `NEW_AMBITO` means the exact
code is present in the later edition and absent in the earlier one.
`ABSENT_FROM_EDITION` means the reverse publication membership; an
unsupported reason remains unresolved.

Text comparison uses a separate key for case, accents and spacing. Punctuation
is not stripped by the production comparison key. Verbatim source strings remain
in each edition snapshot and in the audit evidence. Cosmetic spelling drift is
not substituted into the source record.

A persistent MPG note is not an instrument event. `MODIFIED_BY_INSTRUMENT`
requires a sourced, applicable planning instrument with an effective date
strictly between the two edition dates and a documented relationship to the
compared entity field. A valid result shows the instrument reference and an
inline caveat that the comparison may not be like-for-like across that
modification. Tests cover an unchanged MPG note and a genuinely dated,
field-relevant instrument fixture.

## Empirical counts

The builder and classifier derive these counts from the four pinned source
records; they are not entered as per-code decisions.

| Audit | NO_CHANGE | STATE_TRANSITION | NEW_AMBITO | ABSENT_FROM_EDITION | MODIFIED_BY_INSTRUMENT | CAUSE_UNRESOLVED | NON_COMPARABLE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| S1 row-preserving production | 655 | 10 | 2 | 0 | 0 | 0 | 0 |
| S2 legacy Gate L audit only | 220 | 9 | 0 | 9 | 0 | 1 | 0 |
| S2 row-preserving production | 212 | 8 | 0 | 9 | 0 | 10 | 0 |

The S1 counts reproduce Gate L exactly. Gate L's older S2 code-level result is
reproduced separately for audit. Its first-source-row choice exists only inside
the `LEGACY_AUDIT_ONLY` function; production never chooses a first, last,
largest or district-preferred row.

Gate L's **54 cosmetic-only S2 observations** are preserved with their
edition-specific source strings and remain outside substantive change counts.
The row-preserving production audit records 53 codes as cosmetic-only. The one
code whose cosmetic-only status becomes a row-structure result is
`UZPp.02.03-RP`: its matched row has accent-only observation drift, while the
later edition also publishes an unmatched second situation row. Production
classifies that full row set as `CAUSE_UNRESOLVED`; it does not force the
legacy cosmetic subtype. All 54 observations remain in the legacy audit input.

## Exact-code reconciliation

The stored reconciliation report enumerates all **9 exact-code outcome
divergences**, with previous/current outcomes, verbatim source rows, matched
situations, unmatched rows, and numeric comparison state.

| Exact code | Legacy Gate L result | Row-preserving result | Row correspondence and buildability |
| --- | --- | --- | --- |
| `APE.21.02` | `NO_CHANGE` | `CAUSE_UNRESOLVED` | Barajas: one earlier row, two later rows with the same published situation. No unique row match; one earlier and two later rows remain unmatched; all 12 per-use-class cells are withheld. |
| `APE.21.05` | `NO_CHANGE` | `CAUSE_UNRESOLVED` | Same duplicated-situation Barajas basis; all 12 numeric cells withheld. |
| `APE.21.06` | `NO_CHANGE` | `CAUSE_UNRESOLVED` | Same duplicated-situation Barajas basis; all 12 numeric cells withheld. |
| `API.21.01` | `NO_CHANGE` | `CAUSE_UNRESOLVED` | Same duplicated-situation Barajas basis; all 12 numeric cells withheld. |
| `APR.21.02` | `NO_CHANGE` | `CAUSE_UNRESOLVED` | Same duplicated-situation Barajas basis; all 12 numeric cells withheld. |
| `APR.21.03` | `NO_CHANGE` | `CAUSE_UNRESOLVED` | Same duplicated-situation Barajas basis; all 12 numeric cells withheld. |
| `UZP.1.01` | `NO_CHANGE` | `CAUSE_UNRESOLVED` | Same duplicated-situation Barajas basis; all 12 numeric cells withheld. |
| `UZPp.02.03-RP` | `NO_CHANGE` (cosmetic-only) | `CAUSE_UNRESOLVED` | One `FASE GESTION Y/O URBANIZACION` row matches uniquely. The later `FASE DE EDIFICACION` row is unmatched; four cells for that unmatched row are withheld. |
| `UZPp.02.04-RP` | `STATE_TRANSITION` | `CAUSE_UNRESOLVED` | The earlier and later `FASE DE EDIFICACION` rows match uniquely. The later `FASE GESTION Y/O URBANIZACION` row is unmatched; four cells for it and one blank use-class comparison are withheld. |

For the seven Barajas codes, the January source carries `COD_DISTRITO` 20 and
21 while both rows name `BARAJAS`. The evidence retains both rows. It does not
correct 20, select 21, delete, sum or average either row. District is not a
change dimension; K6 continues to use S1 for district attribution.

## S2 row matching and numeric evidence

The January 2026 S2 edition has **239 rows across 230 exact codes**. Every row is
retained under its exact code. Row identity remains subordinate to
`{edition}:{exact_code}`. Where a code has multiple rows, a one-to-one match is
allowed only for a unique, stable normalized `SITUACION DEL ÁMBITO` value on
both sides. Row number is reported as provenance and is not an identity. The
classifier never sorts rows and zips them, picks a first row, selects a larger
figure, prefers district 21, sums, averages or merges.

Numeric S2 comparison is per matched row and documented use class. Both
editions must publish numeric values, the exact code and situation must match
defensibly, and no applicable instrument event may make the source fields
non-comparable. A published zero remains numeric evidence. A blank remains
unpublished. A missing row remains a row-absence state. An absent exact code
remains an edition-membership state. No dwelling proxy column is carried into
K7 and no dwelling count is derived.

Example of an allowed result: `US.04.10-RP` has a single uniquely matched
`FASE GESTION Y/O URBANIZACION` row. For collective residential use, the
published values are 212,525 m² (2025-07-01) and 152,346 m² (2026-01-01), an
`OBSERVED_PUBLISHED_DIFFERENCE` of −60,179 m². For single-family residential
use, 0 and 59,126 m² produce +59,126 m². Industrial and tertiary values are
unchanged. These are differences between published values; no cause or physical
activity is inferred.

Example of a withheld result: `APE.02.12` has one matched situation, but three
use classes were numeric zero in July and blank in January. Those three
comparisons are withheld because blank is not zero; the fourth class remains
published as 6,670 m² in both editions. The overall numeric comparison carries
the explicit `WITHHELD_BUILDABILITY_DIFFERENCE` UI state.

## UI, language and limits

K7 is a restrained secondary surface inside the existing PLACE planning
evidence area. K6's January evidence remains above it and primary; the map and
selected planning polygon are unchanged. Citizen text states what published
evidence differs, names both dates, and says what cannot be inferred. The
analyst disclosure exposes edition identities, full fingerprints, schema eras,
row-matching basis, classifier reasons, instrument references, verbatim source
values and the separate comparison key. Both readings project the same frozen
comparison. The existing K4 evidence drawer carries the provenance for both
editions.

K7 authored copy avoids the following English terms and phrases: **progress,
advanced, moved forward, improved, worsened, delayed, accelerated, on track,
stalled, completion, development gained, construction delivered, consumed,
built, expected, projected, trend, rate, velocity, because, due to**. The
Spanish scan covers: **progreso, avanzar, mejorar, empeorar, retrasar, acelerar,
en plazo, estancado, finalización, desarrollo ganado, construcción entregada,
consumido, construido, previsto, proyectado, tendencia, ritmo, velocidad,
porque, debido a, a causa de**. The scan is limited to K7-authored dictionary
copy and rendered K7 labels; official source strings remain verbatim.

K7 compares two dated **tabular** editions only. It has no edition slider,
timeline, trend plot, rate, trajectory, projection, dwelling derivation or
planning-polygon history. Publication membership and planning-state changes are
not statements about physical urban change.
