# Temporal manifest (Madrid Urban Time Machine, Gate 4A)

A JSON file that describes the comparator's current temporal sequence as **WMS requests**, so
that Python, GIS tools or a future rendering pipeline can repeat them.

- Export: historical comparator → **Date playback** panel → **Download temporal manifest** /
  **Descargar manifiesto temporal**. It is built in the browser; there is no backend.
- Schema: [`schemas/temporal-manifest.v1.schema.json`](schemas/temporal-manifest.v1.schema.json)
- Real example (exported by Lens from a local checkout, 2026-11-25, Madrid Río, zoom 17,
  1280 × 800): [`examples/temporal-manifest.example.json`](examples/temporal-manifest.example.json)
- Builder: [`../js/temporal-manifest.js`](../js/temporal-manifest.js) (pure; no DOM or network)

## What it is not

It holds no imagery and no image hashes. It is not an archive and not materialised cartographic
evidence. A URL does **not** mean imagery exists. It describes no 3D reconstruction, no
interpolation between dates and no measured change, and it is not equivalent to contemporary
LiDAR geometry. No Lens indicator or evidence record reads it, and it carries no Lens state.

**Reproducibility ceiling.** The manifest lets the same request be repeated. It cannot
guarantee that the remote service will return the same pixels later.

## Three kinds of content

| Kind | Fields | Meaning |
|---|---|---|
| Visualisation parameters | `view`, `image`, `display` | What the reader had configured |
| Documented metadata | `service`, `reference`, `sequence`, `limitations` | From the Lens catalogue and the IGN capabilities document |
| Observed states | `observed` | Tile states of the images **on screen** at export time, for this view only |

`volatile_fields` lists the top-level keys that may differ between two exports of the same
configuration: `generated_at`, `generator` and `observed`. Everything else is deterministic for
the same centre, zoom, viewport size, reference coverage, side, dwell, divider and 10 cm choice.

## Fields

- `schema.id`, `schema.version`: currently `1.0.0`. The schema is closed
  (`additionalProperties: false`): any added field needs a new schema file and version.
- `generator.asset_version`: the page's asset label. `deployment_commit` comes from
  `build-identity.json`, written only by the Pages deploy; otherwise `null`. It identifies the
  deployment answering at export time, which a long-open or cached tab may predate.
- `view.bbox`: `[minE, minN, maxE, maxN]` in `view.crs` = EPSG:3857, **easting then northing**,
  in Web Mercator metres (not ground metres). It is computed from the published centre, zoom and
  viewport size on the 256 px Web Mercator grid.
- `view.bbox_geographic`, `view.centre`: CRS:84, **longitude then latitude**. If you build your
  own WMS 1.3.0 request in EPSG:4326, the axis order is latitude, longitude.
- `view.verified_frame`: the rectangle the imagery checks and shared links cover (lat
  39.88–41.17, lon −4.58 to −3.05; not the administrative boundary). `contains_bbox: false`
  means part of the extent was never checked.
- `image.width`, `image.height`: the map's size in CSS pixels, scaled down on the same extent if
  either side exceeds 4096. `requested_ground_m_per_pixel` is the ground spacing of the
  **requested** pixels at the centre latitude.
- `nominal_resolution_m` (per coverage): the **product's** resolution at Madrid as documented
  (`URBAN_TIME_MACHINE_GATE0.md`). It is not the effective resolution of the returned image.
  `REQUEST_FINER_THAN_NOMINAL_RESOLUTION` marks a request that can only upsample.
- `display.reference_side` / `varying_side`: the reference is the fixed coverage.
- `sequence.frames`: the order Play follows (`histSeries`, `js/historical-url.js`), without the
  reference, with or without the 10 cm city coverages. It does not depend on which frame is on
  screen.
- `date`: `annual_mosaic` (a year; no acquisition day is published) or `multi_year_flight` (a
  first and last year; the date varies by area).
- `observed.visible`: what each side names. A `tile_state` of `loading` means the image has not
  arrived. `pending_next` is the frame playback has requested invisibly; it is **not** on
  screen. States: `ok`, `edge` (partly blank), `nocover` (all blank), `partial`, `error`,
  `loading`, `idle`.

## IGN service contract (checked 2026-11-25)

From `https://www.ign.es/wms/pnoa-historico?service=WMS&request=GetCapabilities&version=1.3.0`:

| Item | Value |
|---|---|
| Version | WMS 1.3.0 |
| CRS inherited by every layer | EPSG:3857, 4326, 4258, 4230, 25828–25831, 32628–32631, 4080–4083, CRS:84 |
| GetMap formats | png, png 8-bit, jpeg, gif, tiff, svg+xml, pdf |
| MaxWidth / MaxHeight | 4096 / 4096 |
| Scale limits on the 13 layers | none declared |
| Fees / AccessConstraints | "No se aplican condiciones" / "CC BY 4.0 scne.es" (service-wide) |

The manifest requests what the comparator requests: `image/jpeg`, EPSG:3857, default style, not
transparent. **Outside a coverage the service answers HTTP 200 with a solid white JPEG**, so a
consumer must decode each image and treat blank areas as missing data. The URLs are not the
comparator's 256 px tiles: each is one image of the whole extent, so resampling and colour can
differ slightly from the screen.

## Verification against the live service (2026-11-25, Chromium)

- Zoom 17, 1280 × 800: all 10 requests (reference + 9 frames) decoded at exactly 1280 × 800
  with 0 % blank pixels.
- Extent against Leaflet's own bounds: within 0.21 px (zoom 17) and 0.15 px (zoom 9).
- Pixel alignment, 2006 request against the screen: mean absolute difference 8.2 at zero shift,
  14.8–19.1 at a 1 px shift, 33.9–34.1 at 4 px.
- Zoom 9 whole-region view: all 10 requests decoded at the requested size, but blank shares of
  0–67 % of the extent (2011: 67 % of the extent, 48 % of the verified frame's rectangle). By
  eye, the annual mosaics stop along the region's outline; this was not checked against the
  boundary geometry. A successful request is not coverage of the whole extent.
- 10 cm city layers (2009, 2013, 2016): manifest URLs at zoom 19, Madrid Río, 1280 × 800 decoded
  at the requested size with 0 % blank pixels.
- Not verified: other formats or CRS, and requests near the 4096 px limit.

## Consuming it (Python, standard library only)

```python
import json

m = json.load(open("temporal-manifest.json", encoding="utf-8"))
assert m["schema"]["id"] == "urn:madrid-urban-evidence-lens:temporal-manifest"
assert m["schema"]["version"].startswith("1.")
minx, miny, maxx, maxy = m["view"]["bbox"]          # EPSG:3857, easting/northing
width, height = m["image"]["width"], m["image"]["height"]
# World file (.jgw) lines that georeference any returned image:
px, py = (maxx - minx) / width, (maxy - miny) / height
worldfile = [px, 0, 0, -py, minx + px / 2, maxy - py / 2]
for frame in [m["reference"], *m["sequence"]["frames"]]:
    print(frame["date"]["label"], frame["layer"], frame["getmap_url"])
```

A consumer that downloads images should keep each frame's attribution with them, record the
retrieval time and its own hashes, check for blank areas, and request only what it needs.
