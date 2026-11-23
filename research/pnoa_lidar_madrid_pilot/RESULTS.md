# Pilot results — Embajadores (Lavapiés), PNOA-LiDAR 3rd coverage v1

Run 2026-11-24 on sheet `0559-4-5` (MDS and MDT), one barrio, one sheet.
Machine-readable record: [`results/pilot_report.json`](results/pilot_report.json)
(input SHA-256, raster metadata, library versions, every number below).
Figure: [`results/figure_mds_minus_mdt.png`](results/figure_mds_minus_mdt.png).

**This is a feasibility demonstration, not a scientific validation.** No
independent reference (cadastral storeys, surveyed heights) was compared.

## Inputs (downloaded by a person from the CNIG Centro de Descargas)

| | MDS | MDT |
|---|---|---|
| File | `MDS50CM-ETRS89-H30_0559-4-5-COB3-V1.tif` | `MDT50CM-ETRS89-H30-0559-4-5-COB3-V1.tif` |
| Size | 97 514 523 B | 73 006 987 B |
| SHA-256 | `1ea16edde94dc4a86a2ad510592b30d0dde9c9515579f3a844faa52202413cf1` | `d7424e33bd6423cf1ea80f25219d04554a1a87ad353657f9ae76b780f1946475` |
| Declared CRS | EPSG:3042 | EPSG:25830 |
| Grid | 7 340 × 4 920 cells, 0.5 m, float32, NoData −32 767, bounds 438060–441730 E / 4471860–4474320 N, tiled, deflate, overviews 2/4/8/16 | identical |

Both sheets are cell-for-cell on the same grid. Unlike the sheet 0599 pair
inspected earlier by mistake (see SOURCE_AUDIT), both 0559 files are tiled and
overviewed, so the "MDS is not a COG" observation is **not general**: it holds
for that one 0599 MDS file only.

## Acceptance criteria — all PASS

| Criterion | Result |
|---|---|
| CRS equivalent to EPSG:25830, cells 0.5 m | PASS (MDS labelled 3042, MDT 25830) |
| Identical grid over the AOI window | PASS |
| ≥ 95 % valid cells in the AOI | **100 %** (4 134 897 of 4 134 897 cells; NoData in AOI: 0 MDS / 0 MDT) |
| MDT median in 550–750 m | **635.5 m** (range 608.0–659.0) |
| ≤ 1 % of cells with MDS − MDT < −0.5 m | **0 %** (minimum −0.26 m) |

AOI = official barrio polygon, 1.034 km². MDS median 649.6 m (range 610.4–702.6).

## MDS − MDT inside the AOI (metres above interpolated ground)

mean 13.65, std 8.14; percentiles p05 0.12 · p25 6.76 · **p50 15.56** · p75 19.19 ·
p90 22.80 · p95 25.35 · p99 32.45 · max 56.48.
Share of cells at or above: 0.5 m 92.0 % · 2 m 85.5 % · 3 m 82.7 % · 6 m 76.6 % ·
12 m 63.7 % · 20 m 20.5 % (denominator: the 4 134 897 AOI cells).

Illustrative 250 m circle on Plaza de Lavapiés (a geometry chosen by the pilot
author, **not** a Lens object): 785 372 cells, 100 % valid, p50 16.24 m, p90 21.00 m,
p99 25.94 m, max 37.43 m. The pipeline can therefore summarise a Lens-style circle
with a stated denominator.

Whole sheet (36.1 M cells, mostly outside the AOI): min −7.70 m, max 78.28 m;
13 419 cells (0.04 %) below −0.5 m, none inside the AOI.

## Reproducibility

A second run produced a byte-identical `pilot_report.json` and figure from the
same inputs (checked with `cmp`). Reproducing from the *source* requires a person
to repeat the CNIG download (reCAPTCHA); the SHA-256 above identifies the files.

## What can and cannot be said

- **Usable and reproducible.** Real data cover the area, align, are unit-coherent
  and pass the pre-stated checks.
- **Interpretable as:** height of the first-return surface above interpolated
  ground, at 0.5 m. The figure shows the street grid near 0, blocks mostly at
  15–25 m, courtyards, and one large complex at the south-east edge of the barrio
  (not identified).
- **Not interpretable as building height.** Anything above ground (trees,
  vehicles, awnings, temporary structures) and any v1 (NPC01) misclassification
  are in the signal. Buildings and vegetation
  were **not** separated, and these two rasters do not allow it defensibly.
- **Not verified:** accuracy against any independent reference; the true
  street/open-space share (see diagnostics: the < 0.5 m cells are not that share);
  ≥ 45 m cells outside the AOI; behaviour outside this barrio and sheet.
- **Epoch.** Flight March–May 2024 at month level; no acquisition day; spring
  phenology affects vegetation. No link to the 2006/2023 orthophotos or to any
  earlier LiDAR is claimed.

## Bounded diagnostics (2026-11-24, `diagnostics.py`, `results/diagnostics.json`)

### 1. EPSG:3042 vs EPSG:25830, and co-registration

- EPSG:3042 *ETRS89 / UTM zone 30N (N-E)* defines axes **N, E**; EPSG:25830
  *ETRS89 / UTM zone 30N* defines **E, N**. pyproj reports them as not equal (strict
  and ignoring axis order) because the definitions differ, but the same point maps
  identically: (E 440000, N 4474000) → (440000, 4474000) with `always_xy` and, for
  3042 in authority order, when given as (N, E). Equivalence was verified at that
  point only, not as a general proof.
- Both files embed a WKT with axes **Easting, Northing** and store the GeoTIFF
  geotransform in E, N metres, so coordinates inside the files are E, N in both. The
  axis-order difference matters only to a client that honours the EPSG:3042
  authority definition (e.g. an OGC request or pyproj without `always_xy`).
- **Co-registration: identical georeferencing.** Geotransform
  (0.5, 0, 438060, 0, −0.5, 4474320), bounds and shape (4 920 × 7 340) are exactly
  equal. IGN states the MDT is interpolated from the ground class and the MDS from
  all classes of the same classified point cloud.
- **A data-level shift test was run and is non-discriminating**: moving the MDT by
  up to ±2 cells changes the share of differences below −0.5 m by 1.2 × 10⁻⁵ and the
  standard deviation by 0.018 m, because the MDT is smooth. It therefore **cannot
  confirm** alignment and is not offered as proof; alignment rests on the
  georeferencing metadata. No registration residual against an independent
  reference was measured.

### 2. Cells with MDS − MDT ≥ 45 m (inside the AOI)

Only **303 cells (0.007 % of AOI cells) in 2 compact clusters**: 60.75 m², max
56.5 m, mean 49.5 m at lon −3.70686 / lat 40.41290; and 15.0 m², max 47.9 m at
lon −3.70559 / lat 40.40958. In the PNOA orthophoto crops
(`figure_cells_ge_45m.png`) each coincides with the centre of a circular domed
roof, and MDS − MDT shows a compact circular peak at the same place. That is
**consistent with an identifiable structure and not with an isolated artefact**;
no building is named, the heights were not compared with any reference, and the
orthophoto is a dynamic service of a different date. Cells ≥ 45 m elsewhere on the
sheet (outside the AOI) were not examined.

### 3. Spatial pattern of the < 0.5 m cells (7.99 % of AOI cells)

330 402 cells in 3 257 connected components (8-connectivity). By component area:
< 10 m² 2 664 components (5.4 % of low area); 10–100 m² 472 (17.9 %); 100–1 000 m²
110 (36.8 %); ≥ 1 000 m² 11 (39.9 %); the largest is 10 732 m² with an equivalent
width (2·area/perimeter) of 5.4 m. 99.3 % of the low area lies in components with
equivalent width < 8 m and none ≥ 20 m. Only 0.005 % of low cells have a difference
of exactly 0.

In `figure_cells_lt_0_5m.png` the low cells trace the street network and a wide
avenue; in the Plaza de Lavapiés crop they cover much of the open surface but are
interleaved with cells ≥ 0.5 m (what those are — trees, furniture, kiosks — was not
established); in the narrow-street crops the band of low cells **looks narrower
than the street visible in the orthophoto** (not measured; cause not established).
**The 8 % must therefore not be read as the share of street or open space.** It is
the share of cells where MDS and MDT agree within 0.5 m in this v1 product.
