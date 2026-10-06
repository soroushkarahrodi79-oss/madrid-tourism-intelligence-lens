# Gate L research package — official urban-planning source contract

Reproducible evidence behind **Gate L**, the research gate that decides whether
issue #68 (ámbito evidence layer) may ship at all and what issue #69 (edition
change detection) is allowed to call "change". The findings and every figure
quoted in [`docs/URBAN_PLANNING_SOURCE_GATE_L.md`](../../docs/URBAN_PLANNING_SOURCE_GATE_L.md)
are produced by the scripts here. None were typed by hand.

```
python research/urban_planning_gate/audit_l1_editions.py      # L1 edition inventory & snapshot identity
python research/urban_planning_gate/audit_l2_identity.py      # L2 ámbito identity & difference classifier
python research/urban_planning_gate/audit_l3_phases.py        # L3 phase vocabulary & No Necesita
python research/urban_planning_gate/audit_l4_buildability.py  # L4 buildability semantics & dwelling ceiling
python research/urban_planning_gate/audit_l5_geometry.py      # L5 geometry join, CRS, freshness, reuse
python research/urban_planning_gate/audit_l6_nonadopted.py    # L6 sources audited and not adopted
```

Run them in order: L2, L3, L4 and L5 import the edition resolution and schema-era
helpers from `audit_l1_editions.py`, and all of them import the shared catalogue /
fingerprint / OLE2 helpers from `gate_l_common.py`. No script re-runs or mutates
another's committed results.

## The one question this gate answers

> When two official Madrid planning editions differ, is that difference a stable
> change in the same planning entity, or is it frequently creation, modification,
> re-identification, exclusion or an administrative instrument change?

A negative result is a valid, useful result. The gate may conclude GO, MODIFY or
NO-GO per sub-gate, and does: the overall verdict is **GO WITH CONDITIONS**.

## What it audits (first-hand)

| Family | Dataset | Role |
|---|---|---|
| **S1** | `203200-0-desarrollo-ambitos` | Estado de desarrollo — the four phase states |
| **S2** | `203182-0-ambitos-remanente` | Edificabilidad remanente — buildability by use (m²) |
| Geometry | `AMBITOS_PLANEAMIENTO_URBANISTICO` (sigma.madrid.es ArcGIS REST) | polygon geometry + code |
| Docs | `203200-13` / `203200-14` / `203182-7` PDFs | field, vocabulary and "not monitored" definitions |

Editions are resolved **from the CKAN catalogue by their exact human-readable
`description`** (`package_show`), never by the opaque numeric resource id — L1 proves
that id order is not chronological, so selecting by id would be irreproducible.

## The BIFF8 reader

The editions are legacy **BIFF8 `.xls` OLE2 compound documents**, not XLSX and not
CSV. The reader is **`xlrd` (>= 2.0)**: xlrd 2.0 deliberately dropped XLSX/XLSM
support and now reads *only* the legacy BIFF `.xls`, which is exactly what these
files are. `openpyxl` (an Office-Open-XML/ZIP reader) cannot open them. This is a
**research-only** dependency installed into the audit's Python environment; it is
**not** added to the Node `package.json`, and nothing in the application imports it.
Whether a parser becomes a build dependency is #68's decision, not this gate's.

Each file's own publication timestamp is read straight from the **OLE2 directory
root entry** (a FILETIME field), with a pure-stdlib parser in `gate_l_common.py`,
independent of HTTP or catalogue dates.

## Conventions

- **Raw third-party files are never committed.** The audits stream each `.xls`/`.pdf`
  and the ArcGIS geometry into `cache/` (git-ignored), fingerprint them, and keep
  only the compact normalized JSON under `results/`. A JSON sidecar records each
  file's first-retrieval timestamp, HTTP validators, byte size and SHA-256, so a
  cache hit returns the real original provenance and reuse never weakens it. Set
  `GATE_L_CACHE` to relocate the cache.
- **Source values are preserved verbatim, separate from project interpretation** —
  the rule from the hospitality Gate C work. Every result keeps the Spanish source
  label and, separately, the project reading and its ceiling.
- **Cosmetic text drift is distinguished from substantive change.** The publisher
  re-encodes note text between editions (e.g. `AMBITO DE NUEVA CREACION` →
  `ÁMBITO DE NUEVA CREACIÓN`). L2 folds accents/case/whitespace for the equality
  test and counts cosmetic drift in its own bucket, so it never inflates the five
  substantive difference classes; the verbatim strings are always kept.
- **`CAUSE_UNRESOLVED` is a valid, publishable verdict.** No cause is attributed
  that the sources do not state.
- **A phase/situación transition is not a development event.** The project rule
  `STATUS_TRANSITION ≠ BUSINESS_EVENT` applies here as
  `PLANNING_STATE_TRANSITION ≠ PHYSICAL_URBAN_CHANGE`.
- **Counts are observations of one run** against the fingerprinted resources each
  report records, not repository invariants. The tests assert the committed results
  are internally consistent and that the methodological invariants hold.

## Output (`results/`)

| File | Sub-gate |
|---|---|
| `l1_edition_inventory.json`, `l1_summary.json` | L1 — full inventory, OLE2 timestamps, internal reference dates, schema eras, non-chronological-id proof, declared vs observed cadence, snapshot identities |
| `l2_identity.json`, `l2_summary.json` | L2 — decisive-pair five-class distribution, all-pair robustness, cosmetic-drift bucket, entity-identity verdict |
| `l3_phases.json`, `l3_summary.json` | L3 — per-column phase vocabulary, documented-vs-observed drift, PGOUM-marker share, funnel/ordering analysis, `No Necesita` semantics |
| `l4_buildability.json`, `l4_summary.json` | L4 — field semantics/units, `Nº Viviendas = Edif ÷ 100` proof, no-dwelling ceiling, cross-edition comparability |
| `l5_geometry.json`, `l5_summary.json` | L5 — identifier universe, geometry↔table join, CRS/reprojection, vertex/payload cost, freshness absence, reuse basis, `-RP` semantics |
| `l6_nonadopted.json`, `l6_summary.json` | L6 — MCPG denormalisation demo, small-universe services, portal 403s, housing-figure verdict |

Network access to `datos.madrid.es` and `sigma.madrid.es` is required to re-run.
Nothing in `data/`, `scripts/` or the Node `package.json` is touched by this gate.
