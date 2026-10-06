# Gate M — official callejero NDP crosswalk

**Overall verdict: GO WITH CONDITIONS. Recommendation: #71 GO WITH CONDITIONS.**

Madrid's official callejero can provide a defensible, reproducible crosswalk for
**11,265 / 11,498 granted-licence rows (97.97%)** and **7,795 / 7,938 distinct
licence NDPs (98.20%)**. The result requires both the pinned current and historical
official files, a licence-date-aware historical rule, explicit withholding of 233
unresolved rows, and visible separation of licence families. [M3](../research/callejero_gate/results/m3_match.json)

This is a research gate. It creates no production data, source-registry entry,
builder, runtime dependency, JavaScript module, layer, or UI.

## M1 — source · GO

### Register of record and reproducible routes

The register of record is the Ayuntamiento de Madrid's CADMA / *Callejero Oficial*.
The bulk dataset `213605-0-callejero-oficial-madrid` provides the two resources the
crosswalk needs: `213605-4-callejero-oficial-madrid-csv` for current identity,
coordinates, district and barrio; and `213605-1-callejero-oficial-madrid-csv` for
historical identity, coordinates and dated validity. The current file is the best
reproducible route for official administrative codes; the historical file is the
necessary companion for retired/superseded current identities. [M1](../research/callejero_gate/results/m1_source.json)

The Geoportal service `9be44652-2490-11e9-a99c-ecb1d752b636` is the official
current-and-historical map distribution and exposes ESRI REST, WMS, WFS, OGC API
Features, SHP and CSV. It states EPSG:25830, CC BY 4.0, continuous CADMA maintenance
and a daily database load. Its displayed `Fecha datos` was 2026-10-06; that dates
the service state, not an individual address's validity. Dataset 300274 is a
continuous-update SOAP change feed; it is useful for change monitoring but is not
the bulk crosswalk route. [M1](../research/callejero_gate/results/m1_source.json)

### Pinned source contract

| Source | Identity / route | Rows | Format | Encoding | Cadence | Licence | Freshness |
|---|---|---:|---|---|---|---|---|
| Granted licences | dataset `640505-0`, resource `640505-1`, `licencias.csv` | 11,498 | CSV, `;` | UTF-8 BOM | MONTHLY | CC BY 4.0 | `reference_date=null`; `published_at=null`; retrieved `2026-10-06T20:31:36Z`; source state not declared |
| Current callejero | dataset `213605-0`, resource `213605-4`, dated file `direccionesvigentes_20261004.csv` | 214,697 | CSV, `;` | Windows-1252 | WEEKLY | CC BY 4.0 | `reference_date=null`; `published_at=null`; retrieved `2026-10-06T20:31:36Z`; source state not declared |
| Historical callejero | dataset `213605-0`, resource `213605-1`, dated file `direccionesevolucionhistorica_20261004.csv` | 379,297 | CSV, `;` | Windows-1252 | WEEKLY | CC BY 4.0 | same five-field treatment as current |

The retrieval times above are provenance, not source dates. The weekly declaration
and dated filename are retained in `observed_resource_state`; neither is silently
promoted into a reference date. The Geoportal's separately published service-state
date is retained only for that service. Full schemas and HTTP metadata are in M1.
[M1](../research/callejero_gate/results/m1_source.json)

| Artifact | SHA-256 | Bytes | HTTP Last-Modified |
|---|---|---:|---|
| Granted licences | `0f1009e3cfab7f3d02e180d9bda07e50b5539ffdccae70b941672f1046d0a8a0` | 2,921,075 | Mon, 05 Oct 2026 10:40:14 GMT |
| Current callejero | `28b2ca7db810e23c0d5921ea2d3f79dceab3cad2d8d3947743476068960fbb28` | 34,712,120 | Mon, 05 Oct 2026 08:21:32 GMT |
| Historical callejero | `5e67975fdf066f76521308e702bab98620122b497133eda72526eaed80bebea5` | 62,676,776 | Mon, 05 Oct 2026 08:24:35 GMT |

[M1](../research/callejero_gate/results/m1_source.json)

The publisher's licence structure document states that one row is one administrative
expediente and that the data are aggregated/anonymised without personal data. The
callejero structure document states that `COD_NDP` uniquely identifies an address,
but also warns that historical digitisation is incomplete and continuing. The audit
therefore treats observed duplicates and historical gaps as evidence, not as errors
to erase. [M1](../research/callejero_gate/results/m1_source.json)

## M2 — key semantics · GO WITH CONDITIONS

The exact join is licence `NDP` → callejero `COD_NDP`. Both were decoded and kept
as source text; no integer coercion is used. In the pinned files all current codes
are eight-digit text, none begins with zero, and neither source has a null licence
key. That observed formatting does not authorise future numeric coercion.
[M2](../research/callejero_gate/results/m2_ndp.json)

The current file is not empirically one-row-per-NDP: 214,697 rows contain 214,301
distinct non-empty NDPs; 76 NDPs occupy 472 rows and have differing address
signatures. Crucially, **zero licence NDPs** intersect those 76 duplicated current
keys, so no licence geometry was selected from an ambiguous current multi-match.
[M2](../research/callejero_gate/results/m2_ndp.json)

The historical file has 258,481 distinct NDPs in 379,297 rows. It contains 81,885
NDPs with multiple versions, and 81,664 map to multiple address signatures. Bare
NDP is therefore not sufficient historical identity. Historical records carry
`FECHA_DE_ALTA` and `FECHA_DE_BAJA`; the defensible version key is the pinned
callejero resource fingerprint plus `COD_NDP`, start and end validity. The licence's
signature date selects a version only when exactly one dated version is active;
otherwise geometry is withheld. [M2](../research/callejero_gate/results/m2_ndp.json)

Of 7,938 distinct licence NDPs, 196 are absent from the current file; those account
for 319 licence rows. The current file alone is therefore insufficient.
[M2](../research/callejero_gate/results/m2_ndp.json)

## M3 — measured matching · GO WITH CONDITIONS

### Full join

| Measure | Result |
|---|---:|
| Licence rows / distinct NDPs | 11,498 / 7,938 |
| Matched rows / unmatched rows | 11,265 / 233 |
| Row match rate | 97.97% |
| Matched / unmatched distinct NDPs | 7,795 / 143 |
| Distinct-NDP match rate | 98.20% |
| Current-only matched rows | 11,179 |
| Historical-only recovered rows | 86 |
| Still unresolved rows | 233 |

[M3](../research/callejero_gate/results/m3_match.json)

Historical recovery is operationally material: it restores 86 rows and 53 distinct
NDPs that the current file cannot resolve. The remaining 233 rows are withheld, not
geocoded externally or approximated. The overall rate is acceptable for a layer
only because every non-resolution remains explicit and the product must not imply
complete coverage. [M3](../research/callejero_gate/results/m3_match.json)

### Per-year result

| Resolution year | Rows | Matched | Unmatched | Match rate |
|---|---:|---:|---:|---:|
| 2023 | 1,944 | 1,892 | 52 | 97.33% |
| 2024 | 3,173 | 3,128 | 45 | 98.58% |
| 2025 | 3,473 | 3,395 | 78 | 97.75% |
| 2026 | 2,908 | 2,850 | 58 | 98.01% |

[M3](../research/callejero_gate/results/m3_match.json)

The result does not support a monotonic claim that older licences are necessarily
less matchable: 2023 is lower than 2024, but 2025 is also lower than 2026.

### Per-`TIPO` result

| Source value | Rows | Matched | Unmatched | Match rate |
|---|---:|---:|---:|---:|
| Licencia básica actividad | 95 | 92 | 3 | 96.84% |
| Licencia básica residencial | 195 | 181 | 14 | 92.82% |
| Licencia básica urbanística residencial sujeta a Ley 3/2024 | 4 | 4 | 0 | 100.00% |
| Licencia de 1ª ocupación y funcionamiento | 193 | 191 | 2 | 98.96% |
| Licencia de funcionamiento de actividad | 1,918 | 1,890 | 28 | 98.54% |
| Licencia urbanística de actividad | 3,372 | 3,311 | 61 | 98.19% |
| Licencia urbanística residencial | 5,538 | 5,430 | 108 | 98.05% |
| Licencia urbanística residencial sujeta a Ley 3/2024 | 8 | 6 | 2 | 75.00% |
| Licencias para actividades temporales | 175 | 160 | 15 | 91.43% |

[M3](../research/callejero_gate/results/m3_match.json)

### Exhaustive states and address relationship

| Exclusive row state | Rows | Meaning |
|---|---:|---|
| `RESOLVED` | 10,662 | Exact current NDP, coordinate and official barrio; address text agrees |
| `ADDRESS_TEXT_DISAGREEMENT` | 517 | Exact current NDP resolved, but one or more structured address components disagree |
| `NDP_FOUND_HISTORICAL_ONLY` | 86 | Current absent; exactly one historical version valid on the licence date, with official coordinate and canonical polygon barrio |
| `CAUSE_UNRESOLVED` | 117 | NDP appears historically but no unique version is valid on the licence signature date |
| `NDP_ABSENT_CURRENT_CALLEJERO` | 116 | NDP absent from both usable current and historical resolution |

These states sum to all 11,498 rows. No observed row needed
`MALFORMED_NDP`, `AMBIGUOUS_NDP_MULTI_MATCH`, `NDP_PRESENT_NO_COORDINATE`,
`NDP_PRESENT_NO_BARRIO`, or `DATE_UNRESOLVED`; those remain guarded rules, not
fabricated observed counts. [M3](../research/callejero_gate/results/m3_match.json)

Among exact current NDP joins, address-text comparison found 5 street-type, 44
street-name, and 479 number/qualifier disagreements, combining to 517 rows. The
closed 16-value licence street-type abbreviation map is committed in M3. A text
disagreement never overrides exact NDP identity. [M3](../research/callejero_gate/results/m3_match.json)

### Coordinate and administrative geography quality

All 11,265 resolved rows have coordinates and a barrio result. For 11,179 current
matches, barrio is the callejero's official code. For the 86 historical-only rows,
the historical file has no barrio field, so the barrio is derived from the official
historical coordinate against the project's canonical official polygon; that
derivation must be labelled and must not masquerade as a historical source code.
[M3](../research/callejero_gate/results/m3_match.json)

Those rows occupy 7,795 distinct official coordinate pairs; 2,313 pairs are shared
by more than one licence row, covering 5,783 rows. This is consistent with several
administrative licences at one exact NDP and is not deduplicated. No resolved point
falls outside the municipality. [M3](../research/callejero_gate/results/m3_match.json)

The current callejero publishes exactly the canonical current set of 131 barrio
codes, with no unknown or missing code. It publishes codes, not barrio names, so a
name/rename comparison is not applicable and no name normalisation is performed.
All 11,179 current matched rows have a
district consistent with the canonical barrio→district hierarchy. Diagnostic
containment agrees with the official barrio for all 11,179; none is outside Madrid,
within the one-metre near-boundary class, or in a conflicting polygon. The check
does not overwrite the official code and makes no claim beyond the publisher's
coordinate precision. [M3](../research/callejero_gate/results/m3_match.json)

## M4 — licence universe · GO WITH CONDITIONS

`RESOLUCION` contains exactly `Conceder` in all 11,498 rows. This is a
granted-record universe, not applications, refusals, withdrawals, or a denominator
for approval, rejection, success, or processing-performance rates.
[M4](../research/callejero_gate/results/m4_universe.json)

| `TIPO` | Rows | Family |
|---|---:|---|
| Licencia básica actividad | 95 | Activity licence |
| Licencia básica residencial | 195 | Building / urbanistic |
| Licencia básica urbanística residencial sujeta a Ley 3/2024 | 4 | Building / urbanistic |
| Licencia de 1ª ocupación y funcionamiento | 193 | Building / urbanistic |
| Licencia de funcionamiento de actividad | 1,918 | Activity licence |
| Licencia urbanística de actividad | 3,372 | Activity licence |
| Licencia urbanística residencial | 5,538 | Building / urbanistic |
| Licencia urbanística residencial sujeta a Ley 3/2024 | 8 | Building / urbanistic |
| Licencias para actividades temporales | 175 | Temporary activity |

All rows classify: building/urbanistic 5,938; activity 5,385; temporary activity
175; unclassified 0. Recommendation C is evidence-driven: #71 may expose an
explicit categorical union only when these families have separate labels, filters
and counts. It must never silently sum them into one analytical universe.
[M4](../research/callejero_gate/results/m4_universe.json)

`NIVEL_PROTECCION` preserves three different source states: empty 2,507,
`Sin Catalogar` 5,340, and `Sin protección` 1,040. `NORMA_ZONAL` is empty in
2,505 rows: 2,505 have both fields missing, 2 have only protection missing, zero
have only norm missing, and 8,991 have neither missing. No cause is inferred.
[M4](../research/callejero_gate/results/m4_universe.json)

Dataset `133556-0-declaraciones-responsables` describes declarations **presented**,
a distinct legal instrument. #71 should exclude it; a later feature may expose it
only as a separately labelled evidence family. It must never be joined or summed
with granted licences. [M4](../research/callejero_gate/results/m4_universe.json)

Licence rows may concern places also represented in Censo de Locales, licensed VUT,
or hospitality/activity evidence. Gate M established no deterministic entity link,
so users must never sum these administrative universes as unique places, businesses,
or tourism supply. A granted urban licence is also not evidence that work started,
construction occurred or completed, occupancy happened, or the permitted quantity
was built. [M4](../research/callejero_gate/results/m4_universe.json)

The source structure document says the register is anonymised; the observed
`PERSONA_INTERESADA` field is a type category rather than a name. A future artifact
must nevertheless minimise fields and exclude it because it is unnecessary for the
location layer. [M4](../research/callejero_gate/results/m4_universe.json)

## M5 — date semantics · GO

The deterministic parser contains explicit Monday–Sunday and January–December
Spanish maps and accepts only the observed grammar `<weekday>, <day> de <month> de
<year>`. It uses no machine locale and no fuzzy parsing. All 11,498 non-empty
`FECHA_ALTA` values and all 11,498 non-empty `FECHA_FIRMA_RESOLUCION` values parse;
weekday validation has zero failures, and publisher year/month/day cross-checking
has zero failures. Both fields have zero missing values in the pinned file.
[M5](../research/callejero_gate/results/m5_dates.json)

The licence date for #71 is `FECHA_FIRMA_RESOLUCION`, because the publisher defines
it as the date the resolution was signed. `FECHA_ALTA` is the expediente's registry
entry date and is not a grant-date substitute. If a later edition lacks a signature
date, the state is `DATE_UNAVAILABLE`; there is no automatic fallback.
[M5](../research/callejero_gate/results/m5_dates.json)

## Future #71 crosswalk contract

If #71 proceeds, its minimum research-authorised record shape is: exact NDP;
official coordinate and CRS; barrio and district code; crosswalk state; address
identity provenance; licence date; and callejero source identity. Current official
barrio and historical polygon-derived barrio must remain distinguishable.
[Summary](../research/callejero_gate/results/summary.json)

Observed future states are `RESOLVED`, `ADDRESS_TEXT_DISAGREEMENT`,
`NDP_FOUND_HISTORICAL_ONLY`, `CAUSE_UNRESOLVED`, and
`NDP_ABSENT_CURRENT_CALLEJERO`. The implementation must also withhold rather than
guess when a later run observes ambiguity, missing coordinates/barrio, malformed
NDP, or an unavailable date. No state becomes `N/A`.
[M3](../research/callejero_gate/results/m3_match.json)

## Overall verdict

**GO WITH CONDITIONS for an official urban-licence location layer.** The official
infrastructure resolves 97.97% of rows with a measured, auditable identity path.
The unresolved 2.03%, incomplete historical digitisation, multi-version history,
and mixed legal/analytical families prohibit a completeness claim or a single
undifferentiated total. Those are binding product conditions, not post-launch
cleanup.

**#71 GO WITH CONDITIONS.**
