# PNOA-LiDAR 3rd coverage — official source audit (Madrid)

Audited 2026-11-24 against the live IGN / CNIG pages listed under each fact.
Nothing here is inferred from memory. Where a fact could not be verified it is
marked **UNVERIFIED**.

## What exists for the Comunidad de Madrid, and what state it is in

| Product | Madrid state | Source & date |
|---|---|---|
| Flight (3rd coverage) | **March 2024 – May 2024** (month-level table; no per-day record found) | [PNOA "Tercera cobertura"](https://pnoa.ign.es/pnoa-lidar/tercera-cobertura), table "Estado actual (septiembre 2026)" |
| Classified point cloud **NPC02+** | Published 2026-04-08 ("revisada de manera interactiva", more minority classes) | [CNIG novedades](https://centrodedescargas.cnig.es/CentroDescargas/novedades) |
| NPC01 / NPC03 | Not published for Madrid (table: `-`) | same PNOA table |
| **MDT 50 cm v1** (catalogue series `MDT01`) | Published 2026-04-14; **provisional, interpolated from the ground class of NPC01** | CNIG novedades; [product page](https://centrodedescargas.cnig.es/CentroDescargas/modelo-digital-terreno-mdt50cm) |
| **MDS 50 cm v1** | Published 2026-08-25; **provisional, interpolated from NPC01** | CNIG novedades; [product page](https://centrodedescargas.cnig.es/CentroDescargas/modelo-digital-superficies-mds50cm-tercera-cobertura) |
| MDT/MDS **v2** (from NPC02/NPC03) | **Not published for Madrid**; forecast 2nd half 2026. A 2026-11-16 MDT v2 release lists five other regions, not Madrid | PNOA table; CNIG novedades |
| Derived products (e.g. **normalised building models**) | **Forecast 1st half 2027** for Madrid | PNOA table; [IDEE blog](https://blog.idee.es/archivo/-/blogs/nuevos-productos-lidar-de-la-3-cobertura-del-pnoa) |
| Express orthophotos from the LiDAR flight | Published 2026-08-26 (COG, 1:5 000 sheets) | CNIG novedades |

Naming trap, resolved: the 2026-04-14 notice says "MDT01 / MDT1", but `MDT01` is
the catalogue series id of the product titled "MDT50 cm – 3ª cobertura"; the
Madrid sheet files are named `MDT50CM-ETRS89-H30-0559-4-5-COB3-V1.tif`.
The 2nd-coverage MDT (2 m, Madrid flown 2016) is a different product served by
the IGN WCS/WMS; it is **not** the 50 cm model.

## Per-source facts

### MDS50cm and MDT50cm (the two products the pilot uses)

- **Mechanism.** Per-sheet download from the CNIG Centro de Descargas. The
  download is gated by **reCAPTCHA v3** (`preAutorizarDescarga`, a honeypot field
  and a navigation signature in the page's download form). The pilot therefore
  does **not** automate it: a person downloads the two sheets in a browser. No
  open WCS/WMS/ATOM route to the 50 cm models was found: the IGN `wcs-inspire/mdt`
  and `wms-inspire/mdt` services describe themselves as the 2nd-coverage 2 m MDT.
- **Unit and format.** 1:5 000 sheets (each MTN50 sheet split 8×8), **COG**
  (Cloud Optimized GeoTIFF). Madrid footprint shapefiles (CNIG "Información
  auxiliar") list **1 137 MDT sheets and 1 136 MDS sheets**, attribute
  `FECHA = 2024` (year only). The sheet over Embajadores/Lavapiés is
  `0559-4-5` (footprint ≈ 3.7 km × 2.5 km, EPSG:25830 bounds
  438060–441730 E, 4471860–4474320 N). Barrio Embajadores (012) lies wholly
  inside it (verified by intersecting the repository's official barrio polygon
  with the CNIG footprint).
- **Size.** Per-sheet sizes shown in the catalogue for other sheets: MDT ≈ 13–25 MB,
  MDS ≈ 137 MB. Size of sheet `0559-4-5` itself: **UNVERIFIED** (the listing is
  JavaScript-driven and sits behind the same gate).
- **Resolution and accuracy (declared).** Grid 0.5 m × 0.5 m. RMSE Z of the point
  cloud ≤ 10 cm; **RMSE Z of the 0.5 m model ≤ 15 cm**; estimated planimetric
  accuracy of the model ≤ 50 cm; point density 5 pts/m²
  ([especificaciones técnicas](https://pnoa.ign.es/pnoa-lidar/especificaciones-tecnicas)).
  These are **contractual specifications, not measured values for Madrid**; the
  provisional v1 models carry an automated, un-reviewed classification, and no
  v1-specific accuracy statement was found.
- **Horizontal CRS.** ETRS89 / UTM 30N (EPSG:25830) for Madrid (CNIG footprint `.prj`
  is ETRS-TM30); WGS84 geographic coordinates are also offered nationally.
- **Vertical reference.** Orthometric heights, geoid EGM08 (spec table). Both
  models share the reference, so MDS − MDT is independent of it.
- **Semantics.** MDT: interpolation of the *ground* class. MDS: interpolation of
  *all* classes, i.e. "terrain, vegetation, buildings and other elements". Water
  surfaces: sparse returns, interpolated/edited, lower reliability. The MDS page
  states v2 "incorporates improved classification of vegetation and buildings",
  implying **v1 is weaker precisely on the vegetation/building distinction**.
- **Licence.** CC BY 4.0, attribution to IGN (and the autonomous community)
  ([IDEE blog](https://blog.idee.es/archivo/-/blogs/nuevos-productos-lidar-de-la-3-cobertura-del-pnoa));
  product pages link the IGN licence conditions and BOE-A-2015-14129. The IGN licence conditions
  (Orden FOM/2807/2015, art. 4; `Condiciones_licenciaUso_IGN.pdf`, read
  2026-11-24) require a visible mention of origin; for a derived work the form is
  «Obra derivada de <producto> <fecha> CC-BY 4.0 <atribución de productores>», with
  the three fields taken from the product table at scne.es/productos.html (an
  interactive search form that could not be read non-interactively). The exact
  field values for these products are therefore **UNVERIFIED**; see
  `results/ATTRIBUTION.md`.
- **Local processing, no paid services.** Yes: GDAL/rasterio read COG directly;
  nothing in the pilot needs a cloud service.

### Classified point cloud (NPC02+) — not used

LAZ/LAS 1.4 format 8, 1 × 1 km tiles, ≥ 13 semantic classes (building, high
vegetation, …) per the spec table. It is the only source that could support a
defensible building-vs-vegetation split from LiDAR alone, but it is a much
larger download and needs a point-cloud reader the repository does not have.
Per the brief it is requested **only if** the pilot shows it is necessary.

## Temporal and methodological limits already established

- Acquisition is month-level (Mar–May 2024) at best; **no acquisition day** is
  published with the models. Tree phenology in spring 2024 is therefore uncertain
  (leaf-off to leaf-on), which directly affects MDS over vegetation.
- The models are interpolations; narrow Lavapiés streets and façades are
  sampled from an airborne scan at a nominal 5 pts/m², so urban canyons,
  balconies, overhangs and under-canopy ground are the *expected* weak spots
  (an expectation from the method, not a measurement for Madrid).
- The 2006 and 2023 PNOA orthophotos already in Lens are a different instrument
  and epoch; **no temporal claim may join them to this 2024 LiDAR**.

## Observations from the first real sheets (2026-11-24) — NOT the pilot area

A person downloaded `MDS50CM-ETRS89-H30-0599-4-5-COB3-V1.tif` and the matching MDT
by mistake (MTN50 sheet **0599**, near lon −5.73 / lat 40.07, outside the Madrid
flight; Madrid is **0559**). `run_pilot.py` refused them (AOI not covered, exit 1),
as designed; no statistic was computed. They are still useful as format evidence
for the product family, from one sheet only:

- Both: 7 480 × 5 060 cells, 0.5 m, float32, **NoData = −32767**, identical origin
  and grid (267 180 E, 4 440 630 N), `AREA_OR_POINT=Point`.
- **CRS labelling differs**: MDT declares `EPSG:3042`; MDS carries a WKT for the
  same ETRS89 / UTM 30N projection that does not resolve to an EPSG code. Neither
  says 25830. Equivalence to EPSG:25830 must be tested numerically (it is).
- **Sheet size differs from the catalogue samples**: MDT 96 MB (deflate, tiled,
  overviews 2/4/8/16); MDS 151 MB.
- **That MDS file is not a Cloud Optimized GeoTIFF** (not tiled, no overviews,
  no compression), although the product page says COG. The Madrid 0559 MDS later
  obtained **is** tiled/deflate/overviewed, so this is inconsistent *between
  sheets of the same product*: do not assume COG layout for any given sheet.

## Observations from the Madrid sheet 0559-4-5 (2026-11-24) — the pilot area

- Sizes: MDS 97.5 MB, MDT 73.0 MB (earlier "UNVERIFIED" size now known for this sheet).
- 7 340 × 4 920 cells, 0.5 m, float32, NoData −32 767, tiled, deflate, overviews
  2/4/8/16; bounds 438060–441730 E, 4471860–4474320 N: exactly the CNIG footprint.
- CRS label: MDS `EPSG:3042`, MDT `EPSG:25830` (same projection).
- No dataset-level tags beyond `AREA_OR_POINT=Point`: **no acquisition date, no
  version, no licence text is embedded in the files**. The year `2024` comes only
  from the CNIG footprint attribute and the PNOA table.
