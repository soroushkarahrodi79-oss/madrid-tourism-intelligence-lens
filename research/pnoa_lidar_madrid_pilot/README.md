# PNOA-LiDAR Madrid — isolated geospatial pilot

A **research package, not a feature.** One question:

> What territorial evidence does PNOA-LiDAR (3rd coverage) add about urban
> morphology in Madrid, beyond what Madrid Urban Evidence Lens already uses?

Pilot area: barrio **Embajadores (012)**, the area known as Lavapiés, using the
repository's official barrio polygon (`data/geography/madrid_admin.geojson`).

- Source diagnosis: [SOURCE_AUDIT.md](SOURCE_AUDIT.md)
- Where it could fit in Lens, with the integration verdict (production: **NO-GO**): [INTEGRATION_ASSESSMENT.md](INTEGRATION_ASSESSMENT.md)

## Status (2026-11-24)

| Item | State |
|---|---|
| Official source audit | **Done** (live IGN/CNIG pages) |
| Pipeline `run_pilot.py`, `lidar_core.py`, `diagnostics.py` | **Implemented; 18 unit/synthetic tests pass** (15 need numpy+rasterio and skip without them; CI installs neither) |
| Real MDS/MDT sample | **Obtained** (sheet 0559-4-5, downloaded by a person; the CNIG download is behind reCAPTCHA v3 and is not automated) |
| Pilot result on real data | **Run; all 5 acceptance criteria PASS**; byte-identical on rerun. See [RESULTS.md](RESULTS.md). Feasibility demonstration, not validation |
| Integration verdict | **NO-GO for the production viewer**; research line kept (MODIFY). Not validated: see [RESULTS.md](RESULTS.md) and [INTEGRATION_ASSESSMENT.md](INTEGRATION_ASSESSMENT.md) |

The unit tests use *synthetic* arrays and GeoTIFFs. They verify arithmetic and
plumbing; only `results/` and `RESULTS.md` contain observations of Madrid.

## To obtain the data (one person, in a browser, ~160 MB)

From the CNIG Centro de Descargas, product pages
[MDT50 cm – 3ª cobertura](https://centrodedescargas.cnig.es/CentroDescargas/modelo-digital-terreno-mdt50cm) and
[MDS50 cm – 3ª cobertura](https://centrodedescargas.cnig.es/CentroDescargas/modelo-digital-superficies-mds50cm-tercera-cobertura),
filter to Madrid (MTN50 sheet 0559, 1:5 000 sub-sheet 4-5) and download:

- `MDT50CM-ETRS89-H30-0559-4-5-COB3-V1.tif`
- `MDS50CM-ETRS89-H30_0559-4-5-COB3-V1.tif`  (the real file name's separator before `0559` differs between the two products in the CNIG footprint files; use whatever the catalogue serves)

Keep the downloaded licence text. **Do not commit the rasters** (a test fails if
any `.tif/.laz/.las/.zip` appears under this folder).

## Run

```
pip install -r research/pnoa_lidar_madrid_pilot/requirements.txt
python research/pnoa_lidar_madrid_pilot/run_pilot.py --mds <MDS.tif> --mdt <MDT.tif> --retrieved-on 2026-MM-DD
python -m unittest tests.test_pnoa_lidar_pilot
```

`python research/pnoa_lidar_madrid_pilot/diagnostics.py --mds <MDS.tif> --mdt <MDT.tif>`
(optional; `--no-orthophoto` skips the IGN WMS crops) produces
`results/diagnostics.json` and two crop figures: CRS/alignment, cells ≥ 45 m and the
spatial pattern of cells < 0.5 m. The orthophoto crops come from a dynamic IGN
service, so they are a dated visual aid and the one part not reproducible from
this repository; every number is.

`run_pilot.py` writes `results/pilot_report.json` and
`results/figure_mds_minus_mdt.png`. The report records input file names, sizes
and **SHA-256**, raster metadata (CRS, resolution, NoData, dtype, tags), library
versions, the statistics, and the acceptance verdict. Exit codes: `0` all
criteria pass, `2` at least one fails (the report is still written), `1`
unusable input.

Axis order: EPSG:3042 is defined N, E and EPSG:25830 E, N; the files store E, N in
both (see RESULTS § diagnostics). Use `always_xy=True` with pyproj.

Windows note: a machine-wide `PROJ_LIB` (e.g. from PostgreSQL/PostGIS) breaks
EPSG lookups in the rasterio/pyproj wheels; the code drops `PROJ_LIB`,
`PROJ_DATA` and `GDAL_DATA` from its own process environment before importing
them.

## Acceptance criteria (documented, not pre-registered)

Written into `run_pilot.py` before any real sheet was opened (none was on disk);
there is no independent timestamp, so they are *documented*, not pre-registered.

| # | Criterion |
|---|---|
| 1 | Both rasters' declared CRS is numerically equivalent to EPSG:25830 (point test, 1 mm) and cells are 0.5 m. *Amended 2026-11-24 on evidence:* the first real CNIG v1 sheets inspected declare `EPSG:3042` (MDT) and an un-coded WKT (MDS) for the same ETRS89/UTM 30N projection, so an integer-code comparison would have failed on a label, not on data. The declared code is still recorded in the report. |
| 2 | MDS and MDT share a cell-for-cell identical grid over the AOI window |
| 3 | ≥ 95 % of AOI cells have a valid MDS **and** MDT value |
| 4 | Median MDT inside the AOI is within 550–750 m (orthometric; Madrid centre ≈ 600–700 m) |
| 5 | ≤ 1 % of valid cells have MDS − MDT < −0.5 m (the declared 15 cm RMSE per model gives √2·15 ≈ 21 cm if independent; independence is an assumption) |

A FAIL is reported as a result. Criteria are never edited to obtain a PASS.

## What MDS − MDT is, and is not

It is the height of the first-return surface above the interpolated ground
surface. It is **not** building height and is never labelled as such: it
includes trees, vehicles, awnings and v1 (NPC01) misclassification. Separating
buildings from vegetation needs the classified point cloud (NPC02+, published
for Madrid) or independent footprints, neither of which this pilot uses.
No temporal claim joins this 2024 LiDAR to the 2006/2023 orthophotos.

## Isolation

No change to `index.html`, `js/`, `css/`, `package.json` or `data/`; no Python
in the browser runtime; a test asserts no application file references this
package. New dependencies are limited to this folder's `requirements.txt`
(numpy, rasterio, matplotlib are new; pyproj, shapely already pinned in
`scripts/requirements-build.txt`).
