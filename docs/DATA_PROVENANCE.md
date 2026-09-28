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

## Tourism & mobility POIs (`data/runtime_poi.json` + packaged fallback)

On GitHub Pages the app is **deployment-snapshot first** so markers render immediately without waiting on third-party browser requests. The deployment snapshot is rebuilt from the public sources during Pages deployment. Per layer:

| Layer | Live source | Fallback |
|---|---|---|
| Museums | [Madrid Open Data — Museos](https://datos.madrid.es/dataset/201132-0-museos) | SNAPSHOT SAMPLE: 4 curated records, captured 2026-09-25 |
| Tourist info | [Madrid Open Data — Información turística](https://datos.madrid.es/dataset/201105-0-informacion-turismo) | SNAPSHOT SAMPLE: 2 curated records |
| Accommodation | [Madrid Destino / esmadrid.com — Alojamientos de la ciudad de Madrid](https://datos.madrid.es/dataset/300032-0-turismo-alojamientos) (Spanish XML feed) | SNAPSHOT SAMPLE: 6 curated records if the deployment feed is unavailable |
| BiciMAD | [EMT Madrid open data](https://datos.emtmadrid.es/) | Deployment snapshot generated from the official station GeoJSON; no hand-placed coordinates |

A **SNAPSHOT SAMPLE** is a small, manually curated subset of the source
dataset for the study area — **not a complete inventory**. A count derived
from a snapshot layer means "records present in this sample," not "total
records that exist at this location." Full snapshot metadata (capture date,
curation method, `exhaustive: false` per layer) is in
[`data/snapshot_provenance.json`](../data/snapshot_provenance.json).

Every point returned to the UI carries an explicit provenance state. The
left-hand layer panel distinguishes deployment snapshots, small curated
fallback samples, live-only fallback results, and unavailable layers. The UI
never presents an unavailable layer as a verified numeric zero.

## Base maps

The UI offers three selectable basemaps: CARTO Positron (light, default),
Esri World Imagery (satellite), and CARTO Dark Matter. CARTO basemaps retain
OpenStreetMap/CARTO attribution; the imagery layer retains Esri/source
attribution in the Leaflet attribution control.

## Licensing boundary

This repository's own MIT license (`LICENSE`) covers its original code and
documentation only. It does not relicense the third-party data or software
listed above — see the [README's License section](../README.md#license) for
the specific terms that continue to apply to Leaflet, Madrid Open Data, Madrid Destino / esmadrid.com, EMT Madrid open data, and HATI-Madrid
evidence.
