# Gate A/B research package — hospitality & commercial premises identity and taxonomy

Reproducible evidence behind the **Gate A — Unit & Identity** and **Gate B —
Activity Taxonomy** sections of
[`docs/HOSPITALITY_COMMERCIAL_METHOD_GATE.md`](../../docs/HOSPITALITY_COMMERCIAL_METHOD_GATE.md).

Every count quoted in those sections is produced by the scripts here. None were
typed by hand.

```
python research/hospitality_commercial_gate/audit_identity.py   # Gate A
python research/hospitality_commercial_gate/audit_taxonomy.py   # Gate B
```

Standard library only. Requires network access to `datos.madrid.es`.
`audit_taxonomy.py` imports the Gate A helpers (catalogue resolution, streamed
fingerprinting, dialect detection) from `audit_identity.py`, so both gates read the
same upstream the same way; it does not re-run or modify Gate A.

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
- Nothing in the application imports this package, and it is not part of the test
  suite. It is run on demand.
