# Data provenance

This document lists every dataset used by Madrid Tourism Intelligence Lens,
its origin, and how it reaches the application.

## HATI-Madrid thermal evidence (`data/hati_assets.json`)

- **Source repository:** [heat-adaptive-tourism-madrid](https://github.com/soroushkarahrodi79-oss/heat-adaptive-tourism-madrid) (read-only; this project never modifies it)
- **Source commit:** `f02f5f6b6c5645adde94ae658bccbf9829e727e2`
- **Source files:** `data/processed/pilot_assets.csv`, `data/processed/phase2_asset_thermal_exposure.csv`
- **Extraction method:** `scripts/extract_hati_evidence.py`, run against a local checkout of that commit. The script is deterministic and re-runnable; it filters to `indoor_outdoor == "outdoor"` (14 assets) and copies `utci_mean_10m` and `utci_category` verbatim for the three modelled timesteps (12:00 / 15:00 / 18:00) of the single pilot day, 21 August 2023. **No spatial or temporal interpolation is performed.**
- **Full machine-readable record:** [`data/hati_provenance.json`](../data/hati_provenance.json)
- **UTCI stress categories:** official Bröde et al. (2012, *International Journal of Biometeorology*) bands, reused as-is from HATI's own `docs/PHASE2_UTCI_METHOD.md` — not invented for this project.
- **Governance:** HATI's Layer A (release artefacts) is `RELEASE_LOCKED` and Layer B (post Gate-3B research) is `RESEARCH_FROZEN`. This project only reads published, locked evidence and does not extend or re-run the HATI pipeline.

## Tourism & mobility POIs (`data/snapshot_poi.json` + live APIs)

The app is **live-first with a repository-snapshot fallback** (see [METHODOLOGY.md](METHODOLOGY.md#data-resilience-strategy) for why). Per layer:

| Layer | Live source | Fallback snapshot |
|---|---|---|
| Museums | [Madrid Open Data — Museos](https://datos.madrid.es/dataset/201132-0-museos) | 4 curated records, captured 2026-09-25 |
| Tourist info | [Madrid Open Data — Información turística](https://datos.madrid.es/dataset/201105-0-informacion-turismo) | 2 curated records |
| Accommodation | [OpenStreetMap](https://www.openstreetmap.org/) via Overpass API (ODbL) | 6 curated records |
| BiciMAD | [EMT Madrid open data](https://datos.emtmadrid.es/) | 6 approximate station records |

Full snapshot metadata (capture date, curation method) is in
[`data/snapshot_provenance.json`](../data/snapshot_provenance.json). Every
point returned to the UI carries a `provenance: "live" | "snapshot"` field,
and the left-hand layer panel shows, per layer, which source is actually
active in the current session — the UI never blends a live count with a
snapshot count under a single unlabelled number.

## Base map

© OpenStreetMap contributors, © CARTO (dark basemap tiles).
