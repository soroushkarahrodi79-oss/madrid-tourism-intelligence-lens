# Gate B research package — accommodation numerator feasibility

Reproducible evidence behind [`docs/ACCOMMODATION_NUMERATOR_GATE_B.md`](../../docs/ACCOMMODATION_NUMERATOR_GATE_B.md).

Every count quoted in that document is produced by the script here. None were
typed by hand.

```
python research/accommodation_gate_b/audit_gate_b.py
```

Requires network access, plus `shapely` and `pyproj` for Candidate A's geometry
(the same builder-only dependencies as `scripts/build_madrid_geography.py`).

## What it audits

| | Source | Role |
|---|---|---|
| **Candidate A** | Ayuntamiento de Madrid — *Viviendas de uso turístico con licencia* (`datos.madrid.es` 300694) | Municipal urban-planning activity licences |
| **Candidate B** | Comunidad de Madrid — *Alojamientos turísticos de la Comunidad de Madrid* | Regional tourism-accommodation inventory |
| Address register | Ayuntamiento de Madrid — *Callejero oficial*, resource *direcciones vigentes* (`datos.madrid.es` 213605) | Official barrio code per address. Cross-checks Candidate A's geometric join; reconciles Candidate B, which publishes no coordinates |
| Control | Comunidad de Madrid — *Número de establecimientos hoteleros por tipo. Municipios* | Municipality-level external reconciliation only. **Never** used to distribute counts into barrios |
| Adjacent | Comunidad de Madrid — *Declaraciones responsables de actividad de VUT* | A **different legal universe**, inspected for interpretation only. **Never** merged into either candidate |

## Output

`report_candidate_a.json`, `report_candidate_b.json`, `report_control.json`.

Each carries the retrieval timestamps and, for every resource, its URL, HTTP
`Last-Modified`, `ETag`, byte length and SHA-256 — so a later reviewer can tell
whether they are looking at the same upstream file this audit saw.

## Conventions

- **Raw upstream files are never committed.** They are fetched into memory,
  summarised, and discarded. Only the compact reports are kept.
- **Counts are observations of one run**, not repository invariants and not
  integrity thresholds. The sources change; the reports carry the fingerprints
  that say which state was observed.
- Nothing in the application imports this package, and it is not part of the test
  suite. It is run on demand.
