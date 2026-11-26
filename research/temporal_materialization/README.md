# Temporal frame materialization (Madrid Urban Time Machine, Gate 4B)

Turns a [Gate 4A temporal manifest](../../docs/TEMPORAL_MANIFEST.md) into a folder of the images
the IGN service actually returned, georeferenced, checked and hashed. A standalone command-line
tool: no backend, no database, and nothing in the Lens web app imports it.

## Run

```powershell
python -m pip install -r research/temporal_materialization/requirements.txt
```

```powershell
python research/temporal_materialization/materialize.py --manifest manifest.json --output C:\data\package
```

```powershell
python research/temporal_materialization/materialize.py --verify C:\data\package
```

Keep packages **outside the repository**: imagery is never committed. Running the same command
again resumes: verified files are reused without any request, failed frames are asked for again.

| Exit code | Meaning |
|---|---|
| 0 | Every frame is a valid image (read the coverage warnings) / package intact |
| 2 | Manifest or output directory refused; nothing downloaded |
| 3 | Incomplete: at least one frame has no valid image |
| 4 | Integrity failure: a file differs from its record. No existing image, sidecar or recorded hash is replaced |

Before a resume writes anything, every existing listed file and the two JSON records are checked
against `checksums.sha256` and the materialized manifest. One altered byte ends the run with exit
4 and the package untouched. To recover, restore the file or choose a new `--output`. An altered
image or sidecar, or the validation report, can also be moved out of the package so that it is
fetched or regenerated; `materialized-manifest.json` and `checksums.sha256` cannot.
A recorded image that is missing is downloaded again; its record keeps the earlier hash and date
under `superseded`, and the report says whether the bytes differ.

## What it refuses

- A manifest whose version is not `1.0.0`, that breaks the JSON schema, or whose bbox, geographic
  bbox, centre, image size, resolution, identifiers or date order disagree. Nothing is repaired,
  and the input file is only read.
- Any request other than a GetMap on `https://www.ign.es/wms/pnoa-historico` whose parameters
  equal the manifest's. Redirects are not followed.
- An output directory that holds anything else, or a package of a different manifest.

Requests are sequential, one per distinct URL, one second apart, with a 90 s timeout and at most
3 attempts for network errors, 429, 500, 502, 503 and 504. A `Retry-After` of up to 60 s is
honoured; a longer or unreadable one is not waited for, and a 429 that stays ends the run.

## Package

```
package/
  source-manifest.json        byte copy of the input
  materialized-manifest.json  order, extent, per-frame provenance, hashes, coverage state
  validation-report.json      statuses, warnings, heuristic parameters, last run's requests
  checksums.sha256            sha256sum format, covers all of the above and every frame file
  frames/ref_2006.jpg         the received bytes, never re-encoded
         ref_2006.jgw         world file (pixel centres)
         ref_2006.prj         EPSG:3857, ESRI WKT
         ref_2006.jpg.aux.xml EPSG:3857 for GDAL / QGIS
         f01_ams1956.jpg ...  sequence order
```

[`example-materialized-manifest.json`](example-materialized-manifest.json) is an abridged,
real one.

A consumer needs only `materialized-manifest.json`: `order.sequence` (frame order),
`frames[].file`, `spatial` (extent, CRS, geotransform), `frames[].date` (year or flight
interval, as published), `frames[].coverage.state`, `frames[].attribution` and
`frames[].sha256`. Use only frames whose `status` is `VALID_IMAGE`, and check `complete`.

GeoTIFF is not produced. With GDAL installed:

```powershell
gdal_translate -of GTiff -co COMPRESS=DEFLATE frames/ref_2006.jpg ref_2006.tif
```

## Georeferencing

The WMS bbox is the outer edge of the edge pixels. The world file therefore places pixel
(0, 0) at `minE + px/2, maxN - px_y/2`. Units are Web Mercator metres, not ground metres;
`approx_ground_m_per_pixel_at_centre` gives the ground spacing of the *requested* pixels, which
is not the product's resolution (`nominal_resolution_m`).

## Coverage diagnosis

Outside a coverage the service answers HTTP 200 with a white JPEG, so a decoded image is not
evidence of coverage. "Near-white" means the darkest channel is 250 or more; fully transparent
pixels count too. A 16 × 16 block is flat white only if all its pixels are near-white.

| `coverage.state` | Rule | Means |
|---|---|---|
| `EMPTY_BLANK` | at least 99.9 % of pixels near-white | No imagery visible by this rule |
| `SUSPECTED_PARTIAL` | flat-white blocks connected to the image border are 0.5 % of blocks or more | Possibly outside the coverage in part |
| `COVERAGE_UNVERIFIED` | anything else | No blank region detected. **Not** a statement that coverage is complete |
| `NOT_ASSESSED` | no valid image | Download or decoding failed (see `status`) |

Limits, all unquantified against ground truth:

- False positives: snow, large white roofs, salt, cloud or overexposure touching the border.
- False negatives: a blank sliver under the threshold; missing data that is not white (black
  or grey fill); holes enclosed by imagery (only flagged `INTERIOR_FLAT_WHITE`).
- `near_white_pixel_fraction` is a share of pixels, **not** a share of area without coverage.
- Nothing is filled in or interpolated.

## What reproducibility means here

| Property | Holds? |
|---|---|
| The request can be repeated | Yes: `request_url` per frame |
| The stored files can be checked | Yes, offline: `--verify` or `sha256sum -c checksums.sha256` |
| The provider will return the same pixels | **No guarantee** |

Hashes detect later change or corruption. They are not signatures: whoever edits a file can
also rewrite the manifest and `checksums.sha256` so that they agree.

**Keep packages unaltered.** Every listed file is compared byte for byte, with no exceptions.
GDAL and QGIS can write statistics into `.aux.xml` when a raster is opened, which `--verify`
then reports as altered: open a copy. A run killed while saving can also fail `--verify` until it
is resumed.

## Pilot (2026-11-26)

Manifest exported in a headless Chromium from the public site (deployment `baea600`): Madrid Río
by the Puente de Toledo, centre 40.397, −3.714, zoom 16, 1280 × 800, reference 2006.

- 10 requests, 10 valid images, 3.4 MB, all 1280 × 800 on one extent, no retries. Every frame
  `COVERAGE_UNVERIFIED`. Intervals 1956–57, 1997–98 and 1997–2003 preserved.
- A second full download of the same manifest minutes later returned identical bytes for all 10
  frames. That is one observation, not a guarantee.
- Visually: the riverside road in 1997–98, works in 2006–2011, the park from 2017. This is a
  visual reading, not a measured change.
- Rerun with the HTTP proxy pointed at a closed port: 10 reused, 0 requests. The manifest file's
  hash was unchanged (checked on the earlier Valdecarros run).
- GDAL 3.12.1 (rasterio 1.5.0) opens each frame as EPSG:3857; bounds equal `view.bbox`
  (< 1e-8 Mercator m) and match `bbox_geographic` within 5e-8°.
- Pixel convention against the live service: a separately requested 400 × 300 inner window of
  the 2023 frame matched best at zero shift (mean absolute grey difference 19.3; 22.9–29.8 at
  1 px; 42 at 4 px). The difference is not zero and is lower towards one side, so allow for
  sub-pixel differences between separate requests; their cause was not established.
- A first run at the Valdecarros test point (40.344, −3.615; 10/10 valid) showed farmland in
  every date including 2023, so it was not used as the main pilot.

Live edge cases (one small request each): PNOA10 2016 at Aranjuez → `EMPTY_BLANK` (100 %
near-white); PNOA 2011 over the whole verified frame → `SUSPECTED_PARTIAL` (48.7 % near-white);
an unknown layer → HTTP 200 `text/xml`, classified `SERVICE_EXCEPTION`.

HTTP errors, interruption, resume and altered files are tested with local fixtures in
[`tests/test_temporal_materialization.py`](../../tests/test_temporal_materialization.py).

Not verified: PNG output against the live service, requests near 4096 px, the 10 cm city layers
through this tool, and opening a package in QGIS or ArcGIS.

## Licence and limits

Imagery: Instituto Geográfico Nacional de España, `CC BY 4.0 scne.es`, declared service-wide
(not verified layer by layer). Keep each frame's `attribution` with any use. The frames are 2D
orthophotos: do not drape them over contemporary LiDAR geometry without an explicit warning,
and read no difference between dates as measured change.
