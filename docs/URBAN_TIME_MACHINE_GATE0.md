# Madrid Urban Time Machine: Gate 0 source audit, Gate 1 and Gate 2 decisions

Checked 2026-11-25. Scope: which official orthophoto coverages can be compared over Madrid in
the existing historical comparator, and whether they work technically. The comparator stays a
**visual reference**, not evidence (see `docs/DATA_PROVENANCE.md`, "Historical PNOA
comparison").

## Method

1. Read the real `GetCapabilities` documents:
   - IGN historical WMS `https://www.ign.es/wms/pnoa-historico` (WMS 1.3.0; 46 layers).
   - Comunidad de Madrid IDEM WMTS
     `https://idem.comunidad.madrid/visor/release/vgcm/statics/capabilities/produccion/srvimagenes2_visorcartografia2.xml`
     (ERDAS APOLLO 2016; 209 `fotosAereas*` layers).
2. Called the IGN `infoVuelos` layer (`GetFeatureInfo`, `text/html`) at each test point. It
   lists the flights the service catalogues there, with year and resolution.
3. Requested a real `GetMap` image for every candidate layer at every test point (EPSG:3857,
   128 × 128 px over about 305 m, `image/png`, `TRANSPARENT=TRUE`) and decoded the pixels. A
   result counts as **imagery** only if more than 98 % of pixels are opaque and the luminance
   standard deviation is above 6. An HTTP 200 alone was never counted.
4. Checked the same flow in a real browser against the live service (see "Gate 1 validation").

Test points (WGS84): Sol 40.4169,-3.7035 · Madrid Río 40.3925,-3.6990 · Valdecarros
40.3440,-3.6150 · Los Berrocales 40.3780,-3.5550 · El Cañaveral 40.4105,-3.5465 · Chamartín
40.4722,-3.6826 · Barajas 40.4919,-3.5937 · Casa de Campo 40.4189,-3.7469 · Getafe
40.3057,-3.7329 (metropolitan) · Alcalá de Henares 40.4818,-3.3640 (metropolitan) · Puerto de
Navacerrada 40.7930,-4.0109 and Peñalara 40.8500,-3.9560 (Sierra de Guadarrama, both on the
Madrid / Castilla y León boundary).

## Availability matrix (IGN `pnoa-historico`)

`img` = decoded imagery · `—` = empty (transparent) image · M = the 8 municipal points ·
G = Getafe · A = Alcalá · S = the two Sierra points. Resolution is the `infoVuelos` value at
Madrid unless stated.

| Layer | Date as documented | Res. | M (8) | G | A | S | Class |
|---|---|---|---|---|---|---|---|
| `AMS_1956-1957` Vuelo Americano serie B | flights Jan 1956 – Nov 1957 | 0.50 m (abstract implies 1 m) | img | img | img | img | **VERIFIED** (resolution uncertain) |
| `Interministerial_1973-1986` | Nov 1976 – Jul 1986 | 0.5 m | — | — | — | img | **PARTIAL** (Sierra edge only; not offered) |
| `Nacional_1981-1986` | 1981 – 1986 | 0.5–1 m | — | — | — | — | **UNAVAILABLE** in Madrid |
| `OLISTAT` | 1997 – 1998 (Sol: 01/98) | 1 m | img | img | img | img | **VERIFIED** |
| `SIGPAC` | 1997 – 2003 (Sol: 08/2002) | 0.50 m | img | img | img | img | **VERIFIED** |
| `PNOA2004`, `PNOA2008`, `PNOA2010` | annual | 0.25–0.5 m | — | — | — | img | **PARTIAL** (Castilla y León side of the Sierra only) |
| `PNOA2005/07/12/13/15/16/18/19/21/22/24` | annual | — | — | — | — | — | **UNAVAILABLE** in Madrid |
| `PNOA2006` | annual mosaic | 0.50 m | img | img | img | img | **VERIFIED** |
| `PNOA2009` | annual mosaic | 0.50 m | img | img | img | img | **VERIFIED** |
| `pnoa10_2009` PNOA10 Madrid | annual | 0.10 m | img | img | — | — | **VERIFIED** for the city area |
| `PNOA2011` | annual mosaic | 0.25 m | img | img | img | img | **VERIFIED** |
| `pnoa10_2013` PNOA10 Madrid | annual | 0.10 m | img | img | — | — | **VERIFIED** for the city area |
| `PNOA2014` | annual mosaic | 0.25 m | img | img | img | img | **VERIFIED** |
| `pnoa10_2016` PNOA10 Madrid | annual | 0.10 m | img | img | — | — | **VERIFIED** for the city area |
| `PNOA2017` | annual mosaic | 0.25 m | img | img | img | img | **VERIFIED** |
| `PNOA2020` | annual mosaic | 0.25 m | img | img | img | img | **VERIFIED** |
| `PNOA2023` | annual mosaic | 0.25 m | img | img | img | img | **VERIFIED** |
| `OrtoExpeditaLIDAR2024` | 2024 LiDAR flight dates | 0.25 m GSD | img | img | img | img | **PARTIAL**: works, but an *expedita* ortho georeferenced by direct orientation; misregistration could look like change. Not offered |
| `OrtoExpeditaLIDAR2023` / `2025` | — | — | — | — | — | — / img | UNAVAILABLE / Sierra only |

Service facts (from the capabilities document): `Fees` "No se aplican condiciones",
`AccessConstraints` "CC BY 4.0 scne.es" (service-wide; not stated layer by layer), EPSG:3857
inherited by every layer, `image/jpeg` and `image/png` GetMap formats, CORS `*`. The PNOA layer
abstracts give year and resolution only. No acquisition day is published, so each PNOA side is
labelled as an annual mosaic. Layer `EX_GeographicBoundingBox` values describe national
extents, not Madrid coverage, which is why coverage was tested point by point.

Inconsistencies found and kept explicit:

- **AMS resolution.** `infoVuelos` gives 0.50 m at every Madrid point. The layer abstract gives
  0.5 m only for Cantabria, País Vasco, La Rioja and parts of Aragón and Castilla-La Mancha, and
  1 m "for the rest". The UI shows 0.50 m with an "uncertain" flag.
- **PNOA10 2016 at Getafe.** A real image was returned, but `infoVuelos` does not list it there.
  The catalogue answer and the image answer can differ at footprint edges, so the comparator
  trusts only the tiles it actually receives.
- **Interministerial at Peñalara.** Imagery was returned even though the Madrid city points
  are empty; the footprint is partial.

## Other sources

| Source | Finding | Class |
|---|---|---|
| Comunidad de Madrid IDEM WMTS (`srvimagenes2/ogc/wmts/visorcartografia2`) | 209 aerial layers, including region-wide orthophotos for 1946, 1956, 1961–67, 1972, 1975, 1980, 1984 (partial), 1991, 1999, 2001, 2003, 2004, 2006, 2007, 2008, 2009, 2011, 2014, 2016, 2017, 2019, 2020, 2021, 2022, 2023, 2024 and 2025, plus Madrid-city 9–10 cm (2010, 2013) and many local flights. Tiles for 1946, 1956, 1975, 1991, 1999 and 2024 decoded as real imagery at Sol, Valdecarros and Peñalara (EPSG3857, z16, CORS `*`). | **PARTIAL**: technically works; **licence UNVERIFIED** |
| IDEM licence | Capabilities `AccessConstraints` "None" (server default). The geoportal legal notice says products are "propiedad de la Comunidad de Madrid" unless stated otherwise and names no open licence. Several historical layers come from third-party archives (US Defense Mapping Agency, CECAF, CETFA, a private aerial-survey archive). Some layers are in ED50 and reprojected. | HOLD: not offered until reuse terms are confirmed in writing |
| IDEE catalogue record `spaignPNOAHISTORICO` | Describes the same IGN `pnoa-historico` service. No additional endpoint. | — |
| CNIG Fototeca (single aerial frames) | Not a georeferenced map service; not usable as a co-registered overlay. | UNVERIFIED for this use |
| Ayuntamiento de Madrid city mosaics (e.g. 1975, 1991 at `servpub.madrid.es`) | Found through datos.gob.es records; endpoint and licence not checked. | UNVERIFIED |
| Flights before 1956 | Not in the IGN service. IDEM has a 1946 orthophoto (licence unverified). | UNVERIFIED |

## Decision

- **Gate 0: GO** for the IGN `pnoa-historico` service as the only source of the comparator.
- **Gate 1: GO** for an independent A/B choice among the **13 VERIFIED** coverages: 1956–57
  (AMS), 1997–98 (OLISTAT), 1997–2003 (SIGPAC), 2006, 2009, 2009 · 10 cm, 2011, 2013 · 10 cm,
  2014, 2016 · 10 cm, 2017, 2020 and 2023. The catalogue lives in `js/historical-url.js`
  (`HIST_COVERAGES`).
- **MODIFY / HOLD:** Interministerial, PNOA 2004/2008/2010, LiDAR *expedita* and IDEM. They are
  not offered, for the reasons in the tables above.
- **NO-GO:** Nacional 1981–86 and the PNOA years with no Madrid imagery.

## Gate 1 validation

- `node --test tests/historical_url.test.mjs`: catalogue invariants, the default pair is
  unchanged (`2006-2023`), any two different verified dates round-trip in either order, and
  unknown, repeated or malformed pairs are refused (never substituted).
- `node --test browser-tests/historical-ortho-compare.browser.mjs`: the 44 existing comparator
  tests plus 7 Time Machine tests (stubbed network): picker contents, per-side requests,
  labels, attribution and notice, rapid stepping (only the final date is requested), step
  limits, an unavailable date named as missing (not as "no change"), a share link restoring the
  pair, and Spanish copy on a phone width with 44 px targets.
- A real browser against the live IGN service: see the PR description for the observations.

## Territorial scope (Gate 2: regional temporal explorer, 2026-11-25)

**Before Gate 2.** The comparator, "Compare here" and the shared link accepted a centre only
inside the historical-view contract's Madrid envelope, lat 40.0–40.9, lon −4.2 to −3.2 (equal to
the evidence contract's `LENS_SPATIAL_BOUNDS`). The map itself has no `maxBounds`, so panning
out while comparing already worked, but the link was then withheld. That envelope left out
Rascafría (40.904 N), Buitrago del Lozoya (40.985 N), San Martín de Valdeiglesias (4.402 W), the
strip south of 40.0 N, the east beyond 3.2 W and all four extremes of the region. Aranjuez,
Navalcarnero, Chinchón and Alcalá de Henares were already inside it.

**Official boundary.** IGN INSPIRE administrative-units WFS
(`https://www.ign.es/wfs-inspire/unidades-administrativas`, `AccessConstraints` "CC BY 4.0
ign.es"), `au:AdministrativeUnit` nationalCode `34130000000` "Comunidad de Madrid" (2nd order).
The geometry has one main polygon (20,888 vertices), one interior ring (a hole near 40.63 N,
3.38 W) and one separate exclave polygon (near 40.65 N, 4.32 W). Its extent, read from the
vertices: **lat 39.884719–41.165845, lon −4.579076 to −3.052983** (south 39.8847,−3.8044;
north 41.1658,−3.5439; west 40.2172,−4.5791; east 40.0994,−3.0530).

**Frame adopted.** The historical-view link accepts any centre in that extent rounded outward to
0.01°: lat 39.88–41.17, lon −4.58 to −3.05 (`HIST_URL_BOUNDS`). This is a rectangle, not the
administrative boundary: its corners take in parts of bordering provinces, and no boundary
geometry is shipped or drawn. It contains the old envelope, so every earlier link restores
unchanged. `LENS_SPATIAL_BOUNDS` is not changed.

**Imagery re-check.** Same method as Gate 0 (decoded 128 × 128 `GetMap` PNG over about 305 m,
EPSG:3857; 35 layers × 12 points). Municipality points from IGN CartoCiudad
(`geocoder/api/geocoder/find`, `type=Municipio`): Aranjuez 40.0323,−3.6022 · Navalcarnero
40.2950,−4.0036 · San Martín de Valdeiglesias 40.3655,−4.4016 · Chinchón 40.1399,−3.4207 ·
Alcalá de Henares 40.4926,−3.3754 · Buitrago del Lozoya 40.9850,−3.6382 · Rascafría
40.9043,−3.8784; plus one point about 1 km inside each extreme, each checked to fall inside the
official polygon: S 39.895,−3.800 · N 41.155,−3.550 · W 40.217,−4.560 · E 40.100,−3.065. Sol
was re-checked; Getafe and the Sierra (Navacerrada, Peñalara) are reused from Gate 0.

| Layer | Aranj. | Navalc. | S. Martín V. | Chinchón | Alcalá | Buitrago | Rascafría | S | N | W | E |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `AMS_1956-1957` | img | img | img | img¹ | img¹ | img | img | img | img | img | img |
| `OLISTAT`, `SIGPAC`, `PNOA2006/2009/2011/2014/2017/2020/2023` | img | img | img | img | img | img | img | img | img | img | img |
| `pnoa10_2009/2013/2016` | — | — | — | — | — | — | — | — | — | — | — |
| `Interministerial_1973-1986` | — | — | img | — | — | img | img | — | img | img | — |
| `PNOA2004` | — | — | img | — | — | — | — | — | img | img | — |
| `PNOA2008`, `PNOA2010` | — | — | — | — | — | — | — | — | img | img | — |
| `PNOA2012`, `PNOA2015` | img | — | — | — | — | — | — | img | img | img | img |
| `PNOA2018`, `PNOA2021`, `PNOA2024` | partial | — | — | — | — | — | — | img | img | — | img |
| `OrtoExpeditaLIDAR2024` | img | img | img | img | img | img | img | img | img | img | img |
| `OrtoExpeditaLIDAR2025` | — | — | img | — | — | — | — | — | img | img | — |
| `Nacional_1981-1986`, `PNOA2005/07/13/16/19/22`, `pnoa10_2007/2008/2018`, `OrtoExpeditaLIDAR2023` | — | — | — | — | — | — | — | — | — | — | — |

¹ The exact 305 m test window at the Chinchón and Alcalá town points returned HTTP 502 on three
attempts; windows 1–2 km away (and the Gate 0 Alcalá point) returned imagery, and the live
comparator showed 1956–57 imagery at Chinchón on its 256 px tile grid. A server error on a tile
is reported by the comparator as a failed tile with retry, never as no change.

**Previously excluded coverages at regional scale (viability only; the catalogue is not
extended in this PR).**

- `Interministerial_1973-1986`: imagery in the west and north (San Martín de Valdeiglesias,
  Buitrago, Rascafría, Sierra) but none in the city, south or east. **MODIFY**: could be offered
  later as an explicitly partial coverage, which the blank-tile detection already reports
  honestly; that needs its own gate (footprint, dates, labelling).
- `PNOA2004/2008/2010`: north-west edge only (likely Castilla y León flights). **NO-GO** as a
  regional date: they do not describe the Comunidad.
- `PNOA2012/2015` and `PNOA2018/2021/2024`: imagery only at the south and east edges and partly
  at Aranjuez, consistent with neighbouring-region flights reaching across the border. **NO-GO**
  as Madrid dates: a reader would see another region's year in a corner of the Comunidad.
- `OrtoExpeditaLIDAR2024`: imagery at every point; still **HOLD** for the Gate 0 reason
  (direct-orientation georeferencing can look like change).
- Nacional 1981–86 and the remaining PNOA and PNOA10 years: no imagery anywhere tested.

**Decision: GO** for regional orthophoto exploration. Every region-wide catalogue date (AMS,
OLISTAT, SIGPAC and the seven annual PNOA mosaics) returned imagery at all 12 regional points,
including the four extremes. PNOA10 stays city-only and outside Madrid city is reported as "no
imagery here". Two scopes stay separate:

- **A. Regional orthophoto exploration** (this comparator): the frame above.
- **B. Lens evidence and indicators**: unchanged coverage (municipal sources, ámbitos, the
  evidence link's Madrid envelope). They stay hidden and inert while comparing, and no Lens
  result is computed from the map viewport, so moving the comparison anywhere in the region
  creates no reading. Leaving returns to the Lens view the reader came from; if the comparison
  ended outside the Lens envelope, a note says Lens readings do not extend to that view.

A compact menu action, *View the whole Comunidad de Madrid*, frames the region (about zoom 9 on a
desktop, about 18 s for two uncached layers in a live check) and is undone by *Back to my view*.
At that zoom the link is withheld with the stated zoom reason (links keep zoom 10–19), and annual
layers show blank areas over neighbouring provinces not flown that year, reported as "partly
outside" the coverage.

## Limits

- The images are served dynamically by IGN and are not reproducible from this repository.
  Live tiles for less-used layers took up to about 45 s on first request.
- Interval flights (AMS, OLISTAT, SIGPAC) have area-dependent dates, so no single date is shown.
- A visual difference can come from resolution, season, sun angle, shadows, orthorectification
  or georeferencing. It is not measured change, says nothing about cause, and is not by itself
  evidence of tourism. No change detection is implemented.
