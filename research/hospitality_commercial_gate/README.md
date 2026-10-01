# Gate A/B/C/D/E/F research package — hospitality & commercial premises methodology

Reproducible evidence behind the **Gate A — Unit & Identity**, **Gate B — Activity
Taxonomy**, **Gate C — Status Semantics**, **Gate D — Temporal Comparability**,
**Gate E — Geographic Reconciliation** and **Gate F — Denominator Construction &
Indicator Admissibility**
sections of
[`docs/HOSPITALITY_COMMERCIAL_METHOD_GATE.md`](../../docs/HOSPITALITY_COMMERCIAL_METHOD_GATE.md).

Every count quoted in those sections is produced by the scripts here. None were
typed by hand.

```
python research/hospitality_commercial_gate/audit_identity.py    # Gate A
python research/hospitality_commercial_gate/audit_taxonomy.py    # Gate B
python research/hospitality_commercial_gate/audit_status.py      # Gate C
python research/hospitality_commercial_gate/audit_temporal.py    # Gate D
python research/hospitality_commercial_gate/audit_geography.py   # Gate E
python research/hospitality_commercial_gate/audit_denominator.py # Gate F
python research/hospitality_commercial_gate/audit_denominator.py --rebuild-approved-semantics # Gate F, offline semantics only
```

Standard library for A–D; Gate E additionally uses **shapely**, **pyproj** and
**geopandas** for point-in-polygon validation, CRS transformation and reading the
official historical (1987) barrio shapefile. Requires network access to
`datos.madrid.es` and `geoportal.madrid.es`. `audit_taxonomy.py` imports the Gate A helpers (catalogue
resolution, streamed fingerprinting, dialect detection) from `audit_identity.py`;
`audit_status.py` imports both the Gate A helpers and the Gate B classification
(`classify`, the CNAE section/division class map) from `audit_taxonomy.py`;
`audit_temporal.py` imports the Gate A source contract and the Gate B classification;
`audit_geography.py` imports the Gate A source contract and the Gate D inventory /
sentinel helpers; `audit_denominator.py` imports the Gate A source contract, Gate B
classifier, Gate C exclusion constants and Gate E current-geography decoder. So all
gates read the same upstream the same way; later scripts do not re-run or modify
earlier gates.

`audit_geography.py` honours an optional `GATE_E_CACHE` environment variable: set it
to a directory to cache the downloaded sentinels (reused only when the file's MD5
matches the catalogue-declared MD5, so cache use never weakens reproducibility). Unset,
it downloads each sentinel to a temp file and deletes it.

`audit_temporal.py` adds a `--rebuild-summary` flag that regenerates
`gate_d_temporal_summary.json` (and its ruling blocks) **network-free** from the
already-committed, fingerprinted artifacts, for deterministic verification without
re-downloading the sentinels.

## The one question this gate answers

> Can the same local/premises and its associated activities be tracked between
> consecutive monthly snapshots using a stable, source-native identifier — without
> relying on names, addresses, coordinates or fuzzy matching?

Nothing else. Not the activity taxonomy (Gate B), not status semantics (Gate C),
not comparability across the whole 2014→2026 history (Gate D), not geographic
reconciliation (Gate E), not a denominator (Gate F).

## What it audits

Ayuntamiento de Madrid — *Censo de locales, sus actividades y terrazas de
hostelería y restauración — histórico*
(`datos.madrid.es` `209548-0-censo-locales-historico`).

| Family | Role | Months compared |
|---|---|---|
| **Locales** | one row = one premises | Sep 2026, Aug 2026, Sep 2025 |
| **Actividades** | one row = one premises × activity epigraph | Sep 2026, Aug 2026, Sep 2025 |

The **Terrazas** and **Locales con información de licencia** families are out of
scope for Gate A and are not fetched.

Resources are **resolved deterministically from the catalogue by their exact
`description`** (e.g. `"Locales. Septiembre 2026"`), which is the only field that
carries family + month and is unique per resource. The opaque numeric resource
ids are recorded in the report, never used to select — selecting by id would not
be reproducible if the catalogue re-numbered.

## Output

`results/gate_a_identity_summary.json` — one compact report carrying, per
resource: URL, HTTP `Last-Modified`, `ETag`, byte length and SHA-256, so a later
reviewer can tell whether they are looking at the same upstream files this audit
saw; and per snapshot: row/unit counts, identity uniqueness, the observed CSV
dialect, situación and access-type distributions, negative controls, source-native
geography counts, and the Aug→Sep 2026 and Sep 2025→Sep 2026 persistence tests.

`results/gate_b_taxonomy.json` — the Gate B report: the observed Sección → División
→ Epígrafe hierarchy read live from Sep 2026, a per-epigraph classification (all 453
populated epigraphs, each with its CNAE parent, assigned class, rationale, status,
row count and distinct-premises count), the full blank-epigraph profile
(`UNCLASSIFIED_SOURCE_ACTIVITY`), the Sep 2025 → Sep 2026 taxonomy-drift comparison,
the scoped Gate B ruling and the product-name recommendation. The classification is
made on the official CNAE section/division the file carries, never on the epigraph
description text. `results/gate_b_taxonomy_summary.json` is a compact digest of the
same run. Gate B fetches only the Sep 2026 and Sep 2025 Actividades resources.

`results/gate_c_status.json` — the Gate C report: the observed `id_situacion_local`
and `id_tipo_acceso_local` universes (each code with its official description, source
semantics, empirical observation and interpretation ceiling kept in **separate**
fields), the status × taxonomy-record-state cross-tab, the per-Gate-B-class status
composition, the impact of the source's own explicit total-count exclusion rules
(situación 8/9 and access 12, with overlaps handled so PC Asociado is not
double-subtracted), the `Abierto`/`Cerrado`/`Baja`/`Baja R`/access deep-dives, the
Sep 2025 → Sep 2026 status-mutability control, and the scoped Gate C ruling.
`results/gate_c_status_summary.json` is a compact digest. Gate C fetches the Sep 2026
Locales + Actividades resources and the Sep 2025 Locales control only; it downloads
no history (that is Gate D). The report keeps **source semantics**, **empirical
observation** and **project handling / interpretation ceiling** as distinct fields
and never encodes a project analytical rule as official source metadata.

`results/gate_d_resource_manifest.json` — the deterministic catalogue inventory of all
141 Locales and 139 Actividades monthly resources (Mar 2014 → Sep 2026), each with its
resource id, URL, URL cut timestamp, catalogue size, catalogue-declared MD5,
`created`/`issued`/`last_modified` and observed `schema_signature`, plus per-family
coverage (missing/duplicate months). `results/gate_d_schema_eras.json` — the contiguous
per-family schema eras and the version-aware snapshot-identity model.
`results/gate_d_temporal_compatibility.json` — the 10 sentinel reports (identity,
status/access code AND text vocabulary, CNAE taxonomy vocabulary + Gate B class
projection, source geography) and the cross-era `id_local` identity intersections.
`results/gate_d_temporal_summary.json` — the full report: catalogue inventory,
continuity, snapshot-identity model, schema eras, sentinel evidence, the format-vs-
semantic **drift classification**, revision/capture protocol, question types, the
**temporal tiers** (A direct / B normalise / C segment / D no-go), the per-dimension
**earliest defensible windows** (each with evidence + caveat), the monthly-transition
ruling, the interpretation ceiling and the scoped Gate D ruling. Gate D uses staged
network discipline: one catalogue call, a 64 KiB Range header scan of every
Locales/Actividades resource, and full downloads of 10 sentinels only (≈769 MB) — the
full history is never downloaded and no raw CSV is committed.

`results/gate_e_geography_summary.json` — the Gate E report: the four separated
geographic evidence layers, the authoritative CURRENT (IDEAM, district v3.2.1 / barrio
v3.4.1, 131 barrios) **and** HISTORICAL (official 1987 restructuring, 128 barrios)
geography provenance, the **documented 2017 administrative reorganisation** (Vicálvaro +
barrio 171 rename, BOAM 8034) with the Censo implementation breakpoints, the entity-
relationship classification (SAME/NAME_CHANGE/BOUNDARY_CHANGED/NEW/REPLACED/LEGACY), the
current-era reconciliation (131/131 EXACT_CODE_MATCH), the current-era point-in-polygon,
the evidence-backed 128→131 explanation (`DOCUMENTED_ADMINISTRATIVE_REORGANISATION_2017`),
the boundary-history finding (three distinct dates), the population-geography **key**
joinability (no denominator), the interpretation ceiling and the scoped Gate E ruling.
`results/gate_e_geography_crosswalk.json` — the **era-aware** code/entity crosswalk (one
row per era × source barrio; key = `{geography_era}:{code}`), **not** a per-premises
export. `results/gate_e_geography_quality.json` — per-sentinel geographic quality and the
point-in-polygon classification. `results/gate_e_geography_eras.json` — the geography eras
(HISTORICAL_128 / TRANSITIONAL_129 / CURRENT_131), the breakpoints and the entity
relationships. Gate E reconciles by `id_barrio_local` decoded under each file's width
scheme (2014 `d*10+seq`, 2015+ `d*100+seq`) to the **era-appropriate** target geography
(historical 1987 for pre-2017 snapshots, current for post-reorg), so numeric code equality
across the 2017 break never establishes entity identity (historical `192 Ambroz` ≠ current
`192 Valdebernardo`). It downloads the 1.1 MB official historical-divisions shapefile and
nine Locales sentinels (one per schema era + the four 2017/2018 breakpoint snapshots); no
raw CSV is committed. An optional MD5-verified `GATE_E_CACHE` directory speeds re-runs.

`results/gate_f_denominator_audit.json` — Gate F's compact evidence: U0–U6 premises
universes, exclusion union/overlap, blank-taxonomy and Interior effects, non-exclusive
class overlap, population provenance/alignment/anomalies, coordinate-vs-code
completeness, area-denominator findings and denominator-sensitivity diagnostics. No
ordered barrio list is emitted. `results/gate_f_indicator_registry.json` — one contract
per candidate indicator (definition, ruling, release status, risk matrix, metadata and
interpretation ceiling). `results/gate_f_summary.json` — the scoped Gate F ruling and
exact later production-candidate set. Gate F reads the current Sep-2026 Locales and
Actividades revisions and committed population/geography assets. `GATE_F_CACHE` may
point to an external cache directory; cached CSVs are accepted only when the
catalogue-declared MD5 still matches and the cache is refused inside the repository.
The `--rebuild-approved-semantics` mode is explicitly offline: it regenerates the
registry/summary vocabulary and readiness contracts from the already approved compact
Gate F evidence without fetching sources or recomputing any count or coefficient.

## Conventions

- **Raw upstream files are never committed.** Each ~85–125 MB CSV is streamed to a
  temporary file, fingerprinted, parsed, and deleted. Only the compact report is
  kept. No `.gitignore` change is needed because no raw file is ever written into
  the working tree.
- **The CSV dialect is observed, not assumed.** The published structure document
  (version mar/2022) states a `|` delimiter; the 2025–2026 files actually use `;`,
  the 2026 files quote every field and the 2025 file does not. The script detects
  delimiter, BOM and quoting per file and records what it found.
- **Counts are observations of one run**, not repository invariants and not
  integrity thresholds. The reports carry the fingerprints that say which upstream
  state was observed.
- Nothing in the application imports this package. The network audits run on demand;
  focused tests validate the contracts of their committed compact reports without
  downloading live source files.
