# Attribution — results derived from IGN PNOA-LiDAR

## What is attributed, and how it was verified

`pilot_report.json`, `diagnostics.json` and the three `figure_*.png` are **derived
works** of the IGN products *MDS 50 cm* and *MDT 50 cm*, 3rd coverage PNOA-LiDAR
(v1, flight 2024), used under CC BY 4.0 (Orden FOM/2807/2015; IGN licence
conditions `Condiciones_licenciaUso_IGN.pdf`).

The IGN rule (read 2026-11-24): the mention must be shown visibly next to the data
(on the figure footer, or in the credits), and for a derived work it takes the form
«Obra derivada de <identificador> <fecha> CC-BY 4.0 <atribución de productores>».
The three values were **copied from the official product table**
(`http://www.scne.es/tablaProductos.php`, the data behind scne.es/productos.html),
2026-11-24:

| Product | Identifier | Date | Producers (short form) |
|---|---|---|---|
| Modelo Digital de Superficies 3ª cobertura | `MDS50cm-cob3` | `2022-2025` | `scne.es` |
| MDT50 cm – 3ª Cobertura | `MDT50cm-cob3` | `2022-2025` | `scne.es` |

The string used (in every figure footer and in the `attribution` field of every
report, including REJECTED ones) is:

> Obra derivada de MDS50cm-cob3 2022-2025 CC-BY 4.0 scne.es y de MDT50cm-cob3 2022-2025 CC-BY 4.0 scne.es

Joining two products with "y de" is this package's reading of the rule («de uno o
varios productos»); each product's own string is exactly the official one. The date
`2022-2025` is the product's coverage range in the table, not the Madrid flight
(March–May 2024).

## Orthophoto crops: removed

An earlier revision of this package also committed two figures with 90 m crops of
the IGN PNOA orthophoto fetched from the dynamic WMS `https://www.ign.es/wms-inspire/pnoa-ma`
(layer `OI.OrthoimageCoverage`, which declares "CC BY 4.0 scne.es" service-wide).
The official table lists orthophotos only as annual `PNOA <año>` rows (and other
named products); it has **no row for that dynamic mosaic**, and the year of the
crops that were retrieved was never established. The required
«identificador fecha» therefore could not be composed, so the attribution could not
be verified sufficiently and **the crops were removed**. The package no longer
fetches or stores any third-party imagery (a test enforces it). Only numerical
evidence and MDS − MDT crops remain. Any conclusion that depended on the removed
crops is marked unverified in `RESULTS.md`.

## Classified point cloud

Not used. If it ever is, the official string is
`LiDAR-PNOA-cob3 2022-2025 CC-BY 4.0 scne.es` (same table).

## Limits of this verification

Verified: the product-table rows and the licence text, read live on 2026-11-24.
Not verified: whether IGN prefers a different producer variant for a derived work
that covers only the Comunidad de Madrid (the table lists a longer producers list
and the short form `scne.es`; the short form is the one the licence allows).
Questions: `consulta@cnig.es` (address given in the licence).
