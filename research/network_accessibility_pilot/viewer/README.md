# Madrid Network Accessibility Explorer — V0.1

A standalone, static, interactive map of the committed Madrid Network
Accessibility pilot (San Isidro, barrio 113). It visualises results that already
exist; it computes no new science. The experiment itself is documented in
`../README.md` and `../RESULTS.md`, which this file does not duplicate or replace.

**It is not part of the Madrid Urban Evidence Lens.** It shares no state, no
module and no stylesheet with the application, and touches nothing in `js/`,
`css/`, `data/` or the root `index.html`. The only thing it borrows is the
vendored Leaflet build in `assets/leaflet/`.

## Run it

From the **repository root**:

```bash
python -m http.server 8899 --bind 127.0.0.1
```

Then open:

```
http://127.0.0.1:8899/research/network_accessibility_pilot/viewer/index.html
```

The server must be rooted at the repository root, because the page reads the
pilot's published results at `../results/` and Leaflet at `../../../assets/`.
Opening `index.html` as a `file://` URL will not work: `fetch()` refuses
cross-origin local reads, and the page says so if you try.

## What you can do

| Control | Behaviour |
|---|---|
| **A · Distance understatement** | Colours each measured portal by `network_nearest_m − euclid_nearest_m`, in metres. Sequential ColorBrewer YlOrRd, breaks at 25 / 50 / 100 / 200 m. |
| **B · Detour ratio** | Colours by the published `detour_ratio` — circuity to *one and the same* facility. Sequential ColorBrewer Purples, breaks at 1.1 / 1.25 / 1.5 / 2.0. The 2 portals where the ratio is not defined are drawn as N/A, not as a class. |
| **C · Nearest-facility disagreement** | Two categories: the methods name the same facility, or they do not. 555 of 2,636 measured portals disagree (21.05%). |
| Facility toggle | Shows/hides the 38 facility access points. Filled triangle = inside the barrio (10); hollow = within the 1,000 m catchment (28). |
| Barrio toggle | Shows/hides the official San Isidro polygon. |
| Reset map extent | Refits to the barrio boundary. |
| Click a portal | Opens the inspector: address, `COD_NDP`, both nearest-facility identities, all four published distances, both ratios, agreement, and the measurement state. |

Thresholds are a presentation choice, declared in `CLASS_BREAKS` in `viewer.js`
and restated under the legend in the UI. They are round numbers fixed in advance
and are not fitted to the data.

### The two indicators are not interchangeable

- `understatement_m` = shortest modelled **network** distance − straight-line
  distance to the **nearest** facility. The two methods may be pointing at
  *different* facilities, so this is not circuity.
- `detour_ratio` = `network_nearest_m ÷ euclid_to_network_nearest_m`, both to the
  **same** facility. This is circuity, and nothing else. It is not a general
  neighbourhood accessibility score.

### Missing observations

The pilot publishes an empty field for "not observed". The viewer maps that to
`null` and renders **N/A**. It never becomes `0`. A published `0.0` — two portals
sit at a facility's own published coordinate — stays a real zero. 15 portals have
no network answer at all (9 `NOT_SNAPPED`, 6 `UNREACHABLE`); they are drawn as
neutral grey diamonds in every view, and their straight-line figures are still
shown because those were observed.

### No route geometry — deliberately

The pilot publishes distances, facility coordinates and the OSM extract, but
**no per-origin route geometry**. So this viewer draws no path, no connector and
no polyline between a portal and a facility. Anything it drew would be invented.
The smoke test asserts that no open polyline exists in the overlay pane.

## Build step

`index.html` needs geographic coordinates; the pilot publishes projected ones.
`build_viewer_data.py` converts them once, at build time:

```bash
cd research/network_accessibility_pilot/viewer
python build_viewer_data.py
```

It writes three files into `data/`:

| File | Contents |
|---|---|
| `portal_coordinates.csv` | `cod_ndp,lon,lat` — official coordinates only, EPSG:25830 → EPSG:4326. Carries **no** OSM-derived value. The browser joins it to `../results/origin_facility_distances.csv` on `cod_ndp`. |
| `study_barrio.geojson` | The one official San Isidro polygon, copied unmodified out of `data/geography/madrid_admin.geojson`. |
| `build_manifest.json` | Counts, bounds, transform residuals and SHA-256 of all four inputs — the baseline the in-browser integrity check runs against. |

The script fails closed on a duplicate or empty `cod_ndp`, a coordinate outside
Madrid, a pyproj round-trip residual above 1 µm, output quantisation above 1 cm,
or a `madrid_admin.geojson` that does not contain exactly one barrio `113`.
Observed on the committed inputs: transform residual **1.9 × 10⁻⁹ m**,
quantisation **0.0056 m** (the 7-decimal rounding grid, as expected).

**Python is a build-time dependency only.** The viewer is static HTML, CSS and
vanilla JS; it never calls Python.

## Test

```bash
node --test research/network_accessibility_pilot/viewer/tests/viewer_smoke.browser.mjs
```

Five tests: map rendering and record counts, view switching and legend
re-labelling, portal selection and the N/A rule, absence of route geometry plus
the layer controls, and the interpretation limits, attribution and mobile layout.
Basemap tiles are stubbed with a transparent PNG so the run is hermetic.

The test deliberately lives here and not in `browser-tests/`:
`scripts/browser-test-shards.mjs:verifyInventory()` fails closed on any
`browser-tests/*.browser.mjs` not assigned to a shard, so putting it there would
force a change to the production Lens CI configuration.

## Basemap

OpenStreetMap standard raster tiles, desaturated in CSS for legibility. CARTO's
`light_all` endpoints — including the one the Lens app uses — now answer every
request with an "API KEY REQUIRED" placeholder tile, so they are not usable
without a key. OSM standard is keyless and already a basemap this repository
uses. The desaturation is a presentation filter on the raster only.

## Interpretation ceiling

The viewer renders the pilot's own `interpretation_ceiling` verbatim from
`pilot_report.json`, so it cannot drift from the research record. In short: one
barrio, one facility category, an OpenStreetMap-derived network rather than
surveyed pedestrian infrastructure, facility coordinates that are **published
register points and not verified entrances**, distance and not travel time,
safety, comfort or wheelchair accessibility, and no generalisation to Madrid.
The scientific verdict is **MODIFY**.

**This is not the Lens observation circle.** The Lens circle is a declared
observation window over published records; a network distance is a measured
property of a street network. The two must never be presented as the same thing.

## Attribution

- Origen de los datos: Ayuntamiento de Madrid (callejero oficial, CC BY 4.0).
- Origen de los datos: Ayuntamiento de Madrid (Instalaciones Deportivas Basicas
  Municipales, dataset 200215, CC BY 4.0).
- Contains information from OpenStreetMap, available under the Open Database
  License (ODbL) 1.0. © OpenStreetMap contributors.
- OSM pedestrian-network extract, ODbL 1.0, **version DOI
  [10.5281/zenodo.24288645](https://doi.org/10.5281/zenodo.24288645)**. Cite the
  version DOI, not the concept DOI.

Per-file breakdowns: `../results/ATTRIBUTION.md` for the pilot results and the
ODbL §4.6 statement, `data/ATTRIBUTION.md` for the two generated files.

## Known limitations of V0.1

1. **Individual portal points are not keyboard-focusable.** The 2,636 measured
   portals are drawn on a single `<canvas>` for performance, so they have no DOM
   node to focus. Every *control* is keyboard-operable, and the 38 facilities and
   15 unmeasured portals are real focusable markers. A keyboard-navigable portal
   list is the obvious V0.2 fix.
2. **No deep-linking.** Selecting a portal does not change the URL, so a specific
   portal cannot be shared as a link.
3. **No search, export, time slider or routing** — out of scope for V0.1 by
   design.
4. **The basemap is a live third-party raster.** Offline, the data layers still
   render correctly over an empty background.
