# Gate 4D — Real geospatial 3D surface V0.1 (Madrid Río)

Extends the Gate 4C cinematic engine with an **optional elevation surface** materialized from
official PNOA-LiDAR models. The flat plane stays the default; nothing changes unless
`render.mjs --geometry <dir>` is given and a storyboard has `surface` shots.

```
PNOA-LiDAR MDS/MDT 50 cm (CNIG sheet, downloaded by a person)
  → materialize_geometry.py: pair checks → window on the texture lattice → GDAL average reprojection
    → validation (range, nDSM, source points, texture correspondence) → geometry package
  → render.mjs --geometry: verified grid → Three.js mesh (UV = texture pixel centres) → video + render manifest
```

**What it is:** one orthophoto on the LiDAR terrain (MDT) with **LoD1 buildings** — official Catastro
footprints (observed) extruded to LiDAR heights (derived), as flat-roofed blocks with neutral facades
(simplified representation) — at true vertical scale.
**What it is not:** an architectural model, a facade model, or a historical 3D scene.

> **Visual review (2026-11-26): the first version draped the photo on the MDS surface and was
> rejected (melted buildings, stretched facades).** Diagnosis, the A/B/C comparison and the decision
> are in [review/REVIEW_4D.md](review/REVIEW_4D.md). The owner adopted **alternative C (LoD1)**; §8
> describes it. The MDS surface remains available as an experimental mode (`surface: "mds"`) and is
> not used in the film. Sections 1–6 below are the original audit and pipeline, still valid.

## 1. Source audit (Gate 4D.0)

Re-checked 2026-11-26 against the official pages (the merged PNOA-LiDAR pilot's
[SOURCE_AUDIT.md](../../pnoa_lidar_madrid_pilot/SOURCE_AUDIT.md), 2026-11-24, is the base; only
deltas and re-confirmations are listed here).

| Product | Acquisition | Published | Resolution / density | Horizontal CRS | Vertical | Format | Licence | Notes |
|---|---|---|---|---|---|---|---|---|
| **MDS 50 cm, 3rd coverage, v1** | Mar–May 2024 (month level) ¹ | 2026-08-25 (CNIG novedades) | 0.5 m grid | ETRS89 / UTM 30N (file declares EPSG:3042; numerically = 25830) | orthometric, EGM08 ² | COG, 1:5 000 sheets | CC BY 4.0 (IGN, Orden FOM/2807/2015) | provisional, interpolated from NPC01 (automatic classification); "all classes" surface |
| **MDT 50 cm, 3rd coverage, v1** | same flight | 2026-04-14 | 0.5 m grid | EPSG:25830 | orthometric, EGM08 ² | COG | CC BY 4.0 | provisional, ground class of NPC01 |
| MDT/MDS v2 | — | **not published for Madrid** (forecast 2nd half 2026; the 2026-11-16 v2 release lists five other regions; no Madrid entry in novedades up to 2026-11-26) | | | | | | would carry the NPC02 reviewed classification |
| Classified point cloud NPC02+ | same flight | 2026-04-08 | ≥ 5 pts/m² nominal, RMSE Z ≤ 10 cm | EPSG:25830 | EGM08 | LAZ 1×1 km | CC BY 4.0 | **not used**: the official rasters already exist and meet the need |
| **PNOA 2023 orthophoto** (texture) | **2023-07-28 → 2023-08-04** (Madrid flight, pnoa.ign.es "Estado del proyecto") | annual mosaic 2023 in WMS `pnoa-historico` | flight GSD 0.22 m, ortho 0.25 m; **package texture 1.82 m/px** | requested EPSG:3857 | — | JPEG via WMS (Gate 4B package) | CC BY 4.0 scne.es (service-wide) | conventional orthophoto (not true-ortho); per-pixel date of the mosaic not published |

¹ The per-region table of pnoa.ign.es/pnoa-lidar/tercera-cobertura ("Estado actual (septiembre 2026)")
gives mar-24 → may-24 for Madrid. CNIG novedades of 2026-08-26 says the Madrid flight took place
"entre los años 2023 y 2024". The table is used; the conflict is recorded in the geometry manifest.
² The technical specification table (pnoa.ign.es/pnoa-lidar/especificaciones-tecnicas) states
orthometric altitudes with geoid EGM08; the product pages say only "alturas ortométricas".
Declared accuracy of the 0.5 m models: RMSE Z ≤ 15 cm, planimetric ≤ 50 cm — contractual
specifications, not values measured for this sheet.

Files embed no acquisition date, version or licence (only `AREA_OR_POINT=Point`); the dates above come
from the catalogue pages. Acquisition, publication and update dates are kept apart in the manifest.

### Temporal and spatial compatibility

| Pair | Spatial | Temporal | Use |
|---|---|---|---|
| MDS v1 ↔ MDT v1 (sheet 0559-4-5) | identical 0.5 m lattice, same bounds (verified by the pilot code) | same flight | nDSM diagnostic; mode B / mode C |
| LiDAR sheet ↔ Gate 4B bbox | sheet covers 438 060–441 730 E, 4 471 860–4 474 320 N; the bbox reaches 4 471 331 N → **north 63.4 % of the texture covered**, south strip not | — | window = largest block of whole texture pixels inside the sheet (2 m margin) |
| PNOA 2023 ↔ LiDAR 2024 | same lattice after reprojection | **≈ 7–10 months** (published years 1 apart) | **mode C** (the film) |
| AMS 1956 … PNOA 2020 ↔ LiDAR 2024 | same lattice | 4 to 67 years | refused by the renderer unless a shot carries an on-screen `temporal_warning` |

### Pilot area decision

**Madrid Río, Puente de Toledo** (first preference) is kept: the LiDAR sheet already downloaded for the
Embajadores pilot (0559-4-5) also covers the north 507 of the 800 texture rows of the existing Gate 4B
package, Puente de Toledo included. No new download was needed. The south strip stays flat-only;
covering it needs the adjacent sheet, which a person must download (CNIG reCAPTCHA).

## 2. Three modes and the temporal rule

| Mode | Texture | Geometry | In this gate |
|---|---|---|---|
| A — Flat historical | any date | none (plane) | unchanged Gate 4C/4C.1 behaviour (verified byte-identical, §6) |
| B — Terrain context | PNOA 2023 | MDT v1 2024 | in the film (one comparison shot), labelled "contexto topográfico" |
| C — Surface 3D | PNOA 2023 | MDS v1 2024 | the film's main shots |

Rule (enforced by `resolveTimeline`, tested): a texture may be draped on a surface only if its
published years are within **2 years** of the geometry's acquisition years; otherwise the storyboard
is refused unless the shot has a `temporal_warning`, which is drawn on screen. Every surface frame shows
texture date, geometry date, their gap, the vertical scale and (if used) the synthetic-shading notice,
and the label/texture sync check covers the geometry label (`surface:<id>`) too.

Madrid Río is a place where the ground itself changed (M-30 tunnelled 2004–2007, park opened 2011):
the 2024 MDT is the 2024 ground, not the ground of any earlier date.

## 3. Geometry materialization (`materialize_geometry.py`)

- **Inputs:** the Gate 4B package record, the two sheets, a points file. Reuses the merged pilot's
  `inspect_raster`, `metadata_problems`, `grid_problems`, `isolate_proj_environment`.
- **Window:** whole texture pixels whose four corners (transformed EPSG:3857 → 25830) lie ≥ 2 m inside
  the sheet: columns 0–1280, rows 0–507.
- **Reprojection:** `rasterio.warp.reproject`, **`Resampling.average`**, source 0.5 m (EPSG:25830) →
  the texture's own lattice (2.38866 EPSG:3857 units ≈ 1.82 m on the ground). Each value is the mean
  elevation over one texture pixel footprint (~13 source cells). Consequences: roof, tree and wall
  edges become ramps about one cell wide; features under ~2 m are smoothed; area means are kept.
  The UTM grid is rotated ≈ 0.47° from the Web Mercator grid here; the warp accounts for it.
- **NoData:** any non-finite value in the window refuses the run (0 found). Nothing is filled.
- **Output** (outside the repo): `surface_mds.f32`, `surface_mdt.f32` (float32 LE, row 0 = north),
  `geometry-manifest.json`, `checksums.sha256`. Example manifest:
  [example-geometry-manifest.json](example-geometry-manifest.json).

Command (Python venv with `research/pnoa_lidar_madrid_pilot/requirements.txt`; clear any machine-wide
`PROJ_LIB`, the script also drops it):

```powershell
python -X utf8 research/geospatial_cinematic/geometry/materialize_geometry.py `
  --package C:\workspace\temporal-packages\madrid-rio-z16-final `
  --mds <Downloads>\MDS50CM-ETRS89-H30_0559-4-5-COB3-V1.tif --mdt <Downloads>\MDT50CM-ETRS89-H30-0559-4-5-COB3-V1.tif `
  --points research/geospatial_cinematic/geometry/madrid-rio-points.json `
  --out C:\workspace\temporal-geometry\madrid-rio-lidar2024-v1
```

### Scene coordinates (Gate 4C frame, unchanged)

- origin = centre of the package bbox in EPSG:3857; +x east, +y grid north, +z up; 1 horizontal unit =
  1 Web Mercator metre.
- vertices at texture pixel centres; UV = that pixel centre's texture coordinate (tested equal to the
  flat plane's mapping, so texture and elevation cannot drift apart).
- **z = (H − 584.1 m) × 1.31296 × exaggeration**, H orthometric metres. 1.31296 = 1/√(k_EW·k_NS),
  the ground-metres-per-Mercator-metre factors at the centre (40.397° N). This keeps a ground metre
  up equal to a ground metre across (residual anisotropy 0.17 %). Using z = H directly would flatten
  relief by cos φ, about 24 %. 584.1 m = median MDT of the window (documented base).
- vertical exaggeration **1× by default**, configurable 1–3× per shot, drawn on screen and recorded.

## 4. Measured results (geometry, 2026-11-26)

| | |
|---|---|
| Sources | `MDS50CM-ETRS89-H30_0559-4-5-COB3-V1.tif` sha256 `1ea16edd…13cf1`; `MDT50CM-ETRS89-H30-0559-4-5-COB3-V1.tif` sha256 `d7424e33…46475` (same files as the pilot) |
| Grid | 507 × 1 280 = **648 960 vertices, 1 294 348 triangles** per surface; 2.6 MB per grid |
| MDS | 566.77–651.66 m (p50 594.99) · MDT 562.61–621.14 m (p50 584.15) · 0 cells outside 520–760 m |
| nDSM (MDS − MDT) | −2.43 … 61.51 m, p50 5.32, p95 27.29; **13 cells (0.002 %) below −0.5 m**; ≥ 2 m: 63.9 %, ≥ 20 m: 15.7 % |
| Time | 7.6 s materialization |
| Reproducibility | second run: grids **byte-identical** (sha256 `fe6a9aaf…` MDS, `e9516349…` MDT); manifest identical except timestamps |

### Elevation fidelity to the source raster (9 points)

Independent value = unweighted mean of the 0.5 m source cells whose centres fall in the pixel footprint
(computed without GDAL warp). Tolerance = 0.05 m + 0.15 × source range inside the footprint.
Categories are a visual reading of the 2023 texture with the nDSM, not surveyed land cover.

| Point | Category | MDS grid | independent | Δ (m) | tol. | cells | Δ vs nearest cell | MDT grid | Δ MDT | MDS−MDT |
|---|---|---|---|---|---|---|---|---|---|---|
| street_w | street | 611.08 | 611.08 | −0.001 | 0.06 | 16 | 0.01 | 611.00 | −0.001 | 0.08 |
| roof_curved_block | roof | 602.10 | 602.08 | 0.025 | 0.10 | 12 | 0.09 | 576.65 | 0.002 | 25.45 |
| roof_large_se | roof | 616.04 | 616.08 | −0.039 | 0.19 | 12 | 0.07 | 574.03 | 0.023 | 42.01 |
| sports_field | open space | 575.82 | 575.82 | 0.000 | 0.05 | 16 | 0.00 | 575.76 | −0.001 | 0.06 |
| sandy_ground_w | open space | 613.88 | 613.88 | 0.000 | 0.05 | 12 | −0.00 | 613.85 | −0.001 | 0.04 |
| trees_park | vegetation | 604.44 | 604.45 | −0.013 | 0.25 | 12 | 0.16 | 579.96 | −0.003 | 24.48 |
| trees_west | vegetation | 623.68 | 623.68 | 0.000 | 0.21 | 12 | −0.00 | 603.36 | 0.001 | 20.32 |
| river_e | river | 569.45 | 569.45 | 0.001 | 0.05 | 12 | 0.01 | 569.43 | −0.001 | 0.02 |
| river_w | river | 571.16 | 571.15 | 0.003 | 0.06 | 16 | −0.01 | 571.08 | −0.001 | 0.08 |

9/9 pass; max |Δ| 0.039 m. This shows the grid is faithful to the source raster; it says nothing
about real-world accuracy (no field data). On water, MDS ≈ MDT: both are interpolated over the channel.
Bridges were not used as probes: around Puente de Toledo the nDSM is ≈ 0, i.e. the v1 MDT appears to
include bridge decks in its ground surface (an observation on this sheet, not a documented rule).

### Texture ↔ elevation correspondence

NCC of gradient magnitude (texture luminance vs nDSM) over integer shifts ±6 px: peak at **(+1, 0)**
(0.176) next to (0, 0) (0.166); 3 px away 0.057; mirrored nDSM controls −0.004 / −0.001. Parabolic
refinement: texture edges sit ≈ **0.66 px (≈ 1.2 m) west and 0.47 px (≈ 0.9 m) north** of nDSM edges.
Criterion (peak within 1 px, zero-shift NCC > 2× every mirror control): PASS. The sub-pixel offset is
within the combined planimetric tolerances (model ≤ 0.5 m, texture pixel 1.82 m) plus relief
displacement and shadows of a conventional orthophoto; its cause is not determined and nothing was
shifted to "correct" it.

## 5. Renderer integration

- `lib/surface.mjs` (pure): surface frame, UVs, triangles, z transform. `lib/geometry.mjs` (Node):
  geometry package contract (hashes, PASS status, same `materialized-manifest.json` hash as the texture
  package, same lattice, no NaN).
- `scene.js`: if and only if `cfg.surface` is present, builds three meshes on one layout (MDS, MDT and
  a flat z = 0 copy for the 0× comparison). Same server, sandbox, network block, camera maths, timeline,
  frame capture, FFmpeg and manifest.
- Storyboard shot kinds `surface` and `surface_closing` (`surface: mds|mdt|flat`,
  `vertical_exaggeration`, `shading: none|illustrative`, optional `temporal_warning`). Surface shots may
  tilt to 60° (flat shots keep 45°), heading ≤ 30°.
- **Illustrative shading:** Lambert, one directional light from the NW at 45° + ambient, scaled so a
  horizontal surface gets factor exactly 1 (flat ground keeps the photo's tones; verified: lit flat =
  unlit flat, MAD 13.80 = 13.80). No cast shadows. Labelled on every frame as synthetic, not observed.

### Render-time checks added (in every render manifest with `--geometry`)

- `surface_texture_alignment`: each surface the film uses, rendered unlit straight down with an
  orthographic camera fitted to the window, must reproduce the texture window crop: the right image
  best among all 10 package images by the 0.5 margin, mirrors and 1 px shifts worse, nothing outside the
  window. (Unlit because the illustrative shading changes slope tones by design; the lit probe is
  recorded for information. The first smoke run probed the lit picture and failed the margin, 15.07 vs
  14.4: that FAIL record is kept at `temporal-renders/madrid-rio-gate4d/smoke-1`.) Result: the MDS nadir
  render matches the texture exactly as well as the flat plane (MAD 13.80 vs 13.80 at 640 × 360) — the
  geometry moves no texture horizontally.
- `surface_elevation_roundtrip`: GPU vertex z at the 9 points → metres = grid file = manifest (≤ 1 mm).
- `geometry_unchanged_after_render`, `temporal_compatibility`.
- `mp4_cut_sync` lists **continuous boundaries** (same kind, texture, surface and an exactly
  continuing camera pose, e.g. rise → orbit) separately: they have no cut to land and are checked by
  seek PSNR. The first preview flagged that boundary as a failed cut (identical frames on both sides).

## 6. Regression of the flat mode

With the Gate 4C/4C.1 code of `main` (ca5b917) and this branch, same package, same storyboards:

| Storyboard | Size | main | this branch | bytes |
|---|---|---|---|---|
| `smoke.json` (hard cut) | 640 × 360 | PASS | PASS | video + 12 key frames **identical** |
| `smoke-dissolve.json` | 960 × 540 | PASS | PASS | video + key frames **identical** |
| `smoke-dissolve.json` | 640 × 360 | FAIL (image_alignment) | FAIL (same) | identical — pre-existing, resolution-dependent; Gate 4C.1 documents this storyboard at 960 × 540 |
| `--interactive` opacity preview | 960 × 540 | — | works (screenshot) | — |

No historical 1080p film was re-rendered.

## 7. Limitations

- Provisional v1 models (automatic NPC01 classification); v2 not published for Madrid.
- A surface derived from elevation: buildings, trees, bridges, vehicles and artefacts are one surface;
  façades carry stretched roof/ground pixels; no building is modelled or invented.
- Texture is a conventional orthophoto at 1.82 m/px: tall buildings lean, so roof texture can fall on
  walls or streets; video resolution adds no spatial detail.
- Only 63.4 % of the Gate 4B extent has elevation (one sheet). `AREA_OR_POINT=Point` vs area
  conventions leave a possible 0.25 m half-cell ambiguity, far below the 1.82 m texture pixel.
- Fidelity is shown to the source raster only; real-world accuracy is not measured.
- 7–10 months separate texture and geometry; changes in that interval (e.g. construction on the former
  Calderón site) can make texture and surface disagree locally.

## 8. LoD1 buildings (alternative C, adopted after the visual review)

| Element | Source | Status |
|---|---|---|
| Terrain | MDT 50 cm v1 (mar–may 2024) on the texture lattice, PNOA 2023 texture | derived surface + observed photo |
| Building footprints | Catastro INSPIRE `BU:BuildingPart` WFS, retrieved 2026-11-26 in 8 tiles ([fetch_catastro.py](fetch_catastro.py)); **CC BY 4.0 DG Catastro** (IDEE CSW record `ES_SDGC_BU`, `otherConstraints`, dateStamp 2025-01-28) | **observed** (cadastral survey) |
| Building height | median MDS inside the footprint shrunk 0.75 m minus median MDT inside it; base = lowest MDT cell | **derived** |
| Block | flat roof at the median MDS, vertical walls, roof cap textured from the orthophoto seen from above, **neutral facades** | **simplified representation** |
| Vegetation, bridges, furniture | not modelled; they remain the photo on the terrain | — |

Materialization: `materialize_geometry.py ... --catastro <fetch dir>` writes `buildings.json` into the same
geometry package (v2) and a `buildings` section in its manifest (source tiles with SHA-256, rules,
counts, summary, attribution, limitations). Without `--catastro` the v1 package is reproduced unchanged
(verified: same grid bytes, same manifest apart from timestamps).

Measured (window 1280 × 507 texture pixels):

| | |
|---|---|
| Parts returned / used | 11 007 returned by 8 tiles; 965 duplicates across tiles (7 with differing geometry: first kept), 7 invalid, 2 326 not wholly inside the window, 30 without cells, 113 below 2 m → **7 566 parts** |
| Height above ground | p05 6.2 m · p50 22.9 m · p95 33.2 m · max 58.2 m |
| Plausibility (not validation) | LiDAR height / Catastro floors above ground: median **3.64 m per floor**; **83 % of the built area within 2.5–4.5 m/floor**; 10.9 % of the area (1 364 parts, mostly small, registered with one floor) above 6 m/floor — reported, never corrected; floor counts never set a height |
| Roof shape | 19.8 % of the area has an MDS interquartile range > 3 m inside the footprint (pitched or mixed roofs): flattened to the median |
| Reproducibility | second run: `buildings.json` byte-identical (sha256 `a377f139…`) |
| Mesh | 64 622 roof + 157 984 wall triangles; built in 0.7 s in the page |

Renderer: `surface: "lod1"` shows the MDT terrain plus the blocks (roof caps share the terrain's
texture mapping; walls neutral, Lambert-lit by the same illustrative light; bottom caps dropped).
Labels add the Catastro attribution and the fixed note "Bloques simplificados: fachadas neutras, no
fotografiadas · vegetación y puentes no modelados". Light for surface shots: NW, 30°, directional 0.8,
ambient 0.6 — horizontal faces still get factor exactly 1, facades get contrast.

Checks added: the LoD1 nadir render must reproduce the texture like the flat plane (smoke 640 × 360:
MAD 13.79 vs 13.80 flat, all rivals ≥ 28.1, 1 px shifts ≥ 24.8); `lod1_roofs` round trip: GPU roof
height of the 10 tallest parts and every 500th part = `roof_m` (26/26, max error 2·10⁻⁶ m).

Limitations specific to LoD1: flat roofs; neutral facades are a representation, not an observation;
footprints are 2026 data on a 2023 photo and 2024 LiDAR (e.g. the former Calderón site); a conventional
orthophoto puts some facade/ground pixels on roof caps of tall buildings.
