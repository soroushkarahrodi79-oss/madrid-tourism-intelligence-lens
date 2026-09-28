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
- **Study-area boundary:** copied from HATI source file `src/define_study_area.py` at the pinned commit: latitude 40.4040–40.4210, longitude -3.6960–-3.6775, a rectangular Prado–Retiro–Atocha pilot of ≈3.5 km². The UI renders this as a dashed boundary for orientation only. It is not a thermal surface; evidence remains limited to the 14 sampled points.
- **Governance:** HATI's Layer A (release artefacts) is `RELEASE_LOCKED` and Layer B (post Gate-3B research) is `RESEARCH_FROZEN`. This project only reads published, locked evidence and does not extend or re-run the HATI pipeline.

## Tourism & mobility POIs (`data/runtime_poi.json` + packaged fallback)

On GitHub Pages the app is **deployment-snapshot first** so markers render immediately without waiting on third-party browser requests. The deployment snapshot is rebuilt from the public sources during Pages deployment. Per layer:

| Layer | Live source | Fallback |
|---|---|---|
| Museums | [Madrid Open Data — Museos](https://datos.madrid.es/dataset/201132-0-museos) | SNAPSHOT SAMPLE: 4 curated records, captured 2026-09-25 |
| Tourist info | [Madrid Open Data — Información turística](https://datos.madrid.es/dataset/201105-0-informacion-turismo) | SNAPSHOT SAMPLE: 2 curated records |
| Accommodation | [Madrid Destino / esmadrid.com — Alojamientos de la ciudad de Madrid](https://datos.madrid.es/dataset/300032-0-turismo-alojamientos) (Spanish XML feed) | SNAPSHOT SAMPLE: 6 curated records if the deployment feed is unavailable |
| BiciMAD | [EMT Madrid open data](https://datos.emtmadrid.es/) | Deployment snapshot generated from the official station GeoJSON; no hand-placed coordinates |
| Metro & Cercanías | [CRTM Open Data](https://datos.crtm.es/) — M4 Estaciones (Metro) + M5 Estaciones (Cercanías) | Deployment snapshot generated from the official CRTM ArcGIS feature services; no hand-placed coordinates |

The Madrid Destino XML also publishes a categorisation block with accommodation
`Tipo` and `Categoria` fields, documented in Madrid Destino's
[XML structure specification](https://datos.madrid.es/FWProjects/egob/Catalogo/Turismo/ficheros/Estructura_DS_alojamientos.pdf). The deployment builder preserves these fields
as source metadata and maps `Tipo` into a small UI-only family
(`hotel`, `hostal`, `apartment`, `hostel`, `guest`, `residence`,
`camping`, or `other`). This normalisation changes only filtering and labels;
it does not reclassify the source record for analytical claims. If the official
feed is unavailable and the app falls back to older curated records without
type metadata, the type selector is disabled rather than guessing a class.

A **SNAPSHOT SAMPLE** is a small, manually curated subset of the source
dataset for the study area — **not a complete inventory**. A count derived
from a snapshot layer means "records present in this sample," not "total
records that exist at this location." Full snapshot metadata (capture date,
curation method, `exhaustive: false` per layer) is in
[`data/snapshot_provenance.json`](../data/snapshot_provenance.json).

For CRTM rail data, the deployment builder queries the official station feature
layers only inside the app's central-Madrid envelope
(40.385–40.455 N, -3.745–-3.645 E), requests WGS84 output, and preserves
the station mode and line metadata where provided. Metro and Cercanías must
both load successfully for the combined rail layer to be marked available.

Every point returned to the UI carries an explicit provenance state. The
left-hand layer panel distinguishes deployment snapshots, small curated
fallback samples, live-only fallback results, and unavailable layers. The UI
never presents an unavailable layer as a verified numeric zero.


## Observed pedestrian activity (`data/pedestrian_activity.json`)

- **Dataset:** [Madrid Open Data — Aforos de peatones y bicicletas](https://datos.madrid.es/dataset/300321-0-aforos-peatones-bicicletas).
- **Distribution used:** `300321-0-aforos-peatones-bicicletas-csv` — the latest published permanent pedestrian-counter CSV labelled **Aforos peatones. 2024**.
- **Published semantics:** fixed pedestrian-count stations with records by date and hour. The source dataset is updated quarterly and states that the latest published quarter is provisional.
- **Current temporal ceiling:** the portal currently reports dataset coverage through **30 June 2024**. The app therefore treats this as historical observed evidence, not current/live pedestrian activity.
- **Deployment method:** `scripts/build_pedestrian_activity.py` downloads the CSV during GitHub Pages deployment, normalises documented field-name variants, rejects invalid/negative counts, filters to the same central-Madrid envelope used by the app, and writes station-level sufficient statistics. The current 2024 resource serialises WGS84 coordinates with grouped decimal digits (for example `40.417.386` / `-3.707.141`); the builder normalises those source strings deterministically to `40.417386` / `-3.707141` before applying the geographic bounds.
- **Lens metric:** for permanent counters inside the active lens, the app recombines station `meanObserved × observationCount` and reports the resulting mean observed pedestrian count per published hourly record. It also reports the number of counters and raw observations contributing to the value.
- **Spatial ceiling:** values exist only at published counter locations. The app does **not** interpolate a pedestrian surface between counters.
- **Interpretation ceiling:** counters observe pedestrians, not tourist status. This evidence must not be described as tourist flow, visitor demand, crowding, carrying capacity or overtourism.
- **Analytical isolation:** pedestrian-counter records are kept outside `poiPoints`; they do not change tourism POI counts, accommodation counts, mobility-node counts, category mix, or nearest-feature lists.

## Context-only parks layer

- **Dataset:** [Madrid Open Data — Principales parques y jardines municipales](https://datos.madrid.es/dataset/200761-0-parques-jardines)
- **Deployment resource:** official JSON resource `200761-5-parques-jardines-json`.
- **Scope used here:** records with official coordinates inside the app's central-Madrid envelope (40.385–40.455 N, -3.745–-3.645 E).
- **Role:** cartographic context only. Park records are kept in a separate Leaflet group and are never passed to `poiStatsInLens`; they do not affect counts, category mix, nearest-feature lists, or Lens A/B comparison.
- **Completeness ceiling:** the municipal dataset itself describes the principal/significant parks and gardens, not every green space, median, roundabout, traffic island, or small planted area in Madrid.
- **Interpretation ceiling:** the presence of a park record is not used as a proxy for shade, cooling, thermal comfort, biodiversity, accessibility, quality, or tourist attractiveness.

## Base maps

The UI offers three selectable basemaps: CARTO Positron (light, default),
an Esri hybrid satellite view (World Imagery plus the World Transportation
and World Boundaries and Places reference overlays), and CARTO Dark Matter.
CARTO basemaps retain OpenStreetMap/CARTO attribution; the imagery/reference
stack retains Esri/source attribution in the Leaflet attribution control.

## Licensing boundary

This repository's own MIT license (`LICENSE`) covers its original code and
documentation only. It does not relicense the third-party data or software
listed above — see the [README's License section](../README.md#license) for
the specific terms that continue to apply to Leaflet, Madrid Open Data, Madrid Destino / esmadrid.com, EMT Madrid open data, CRTM open data, and HATI-Madrid
evidence.


### Madrid accommodation taxonomy

The Madrid Destino XML taxonomy is read from the source fields documented as
`Tipo`, `Categoria` and `SubCategoria`. In the production feed these may
appear as `<item name="...">` entries inside `<extradata>`.

For filtering, the app uses **Categoria** as the accommodation family (for
example `Hoteles`, `Hostales`, `Apartahoteles`, `Pensiones`,
`Albergues`, `Residencias universitarias` or `Camping`). The generic
`Tipo` value such as `Alojamientos` is preserved as source metadata, while
`SubCategoria` is preserved for the source classification such as star/key
level. Unknown source categories remain explicitly `Other / unclassified`;
they are never inferred from the business name.
