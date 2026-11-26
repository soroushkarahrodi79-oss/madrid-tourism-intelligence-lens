# Gate 4D — visual quality review (MODIFY), 2026-11-26

The owner rejected the visual quality of the first 3D pilot (melted buildings, stretched facades,
jagged edges). The 1080p final render was stopped at frame ~300/462 and its partial output renamed
`temporal-renders/madrid-rio-gate4d/ABORTED-final-1080p-stopped-by-review` (not a deliverable).
No further final render until the owner approves a representation. Gate 4C / 4C.1 untouched.

## 1. Diagnosis: what causes the look, measured on the rendered MDS grid

| Factor | Measured | Implementation problem or intrinsic? |
|---|---|---|
| Effective MDS resolution | source 0.5 m → **averaged to 1.82 m** (texture lattice): ~13 source cells per vertex | **Implementation choice.** Averaging turns every wall into a ramp: **42 %** of cells next to a > 10 m step hold intermediate heights (20–80 % of the step). |
| Steep faces | **24.5 %** of triangles > 60°, and they are **50.9 % of the visible 3D surface area**; only 8.8 % > 75° (walls are slopes, not verticals) | Consequence of the averaging + regular grid. |
| Texture on steep faces | orthophoto pixels stretched **3.2× (median), 6.5× (p90)** along steep faces | **Intrinsic to draping a nadir photo:** an orthophoto has no facade information. Any facade textured from it looks invented. |
| Triangulation | regular grid, fixed diagonal, 1.82 m cells; Madrid blocks run ~30–45° to the grid | Implementation: staircase / sawtooth along every oblique building edge. |
| Pixel ↔ vertex correspondence, UV | vertices at texture pixel centres; nadir render = texture exactly (MAD 13.80 = flat) | **Correct.** Not a cause. |
| Normals / lighting | smooth vertex normals averaged across roof/wall ramps | Implementation: roof edges shade like rounded, molten forms. |
| Horizontal / vertical proportion | 1×, ground metres both ways (residual 0.17 %) | **Correct.** Not a cause (an exaggeration would make it worse). |
| Camera | 56–58° tilt, FOV 30°, close distances | Amplifies the problem: it shows facades, i.e. the stretched part, more than roofs. |
| What an MDS is | one continuous surface over buildings, trees, cars, bridges; v1 classification provisional; conventional ortho (roof lean) | **Intrinsic.** Even at native resolution an MDS is not a set of buildings: trees and roofs merge, walls are interpolated, overhangs do not exist. |

Conclusion: half the problem is the implementation (averaging, smooth normals, grid, camera), and the
other half is intrinsic (a nadir photo on vertical faces; an MDS is not an urban model). Fixing only the
implementation (alternative A) removes the melting but not the intrinsic part.

## 2. Alternatives, same crop / same cameras / same light

Crop: texture columns 380–700, rows 250–507 (≈ 580 × 470 m: blocks south of the river, the
Puente de Toledo roundabout, the park). Same texture (PNOA 2023), vertical scale 1×, same illustrative
light (NW, 30°; horizontal faces keep the photo's tones exactly; facades neutral where used).
Sheets: `temporal-renders/madrid-rio-gate4d/review/stills/compare_oblique.png`, `compare_close.png`
(single frames beside them). Reproduce: `prep_review.py` → `render_review.mjs` → `compose_review.py`
(this folder); inputs and their SHA-256 in `temporal-renders/madrid-rio-gate4d/review/data/SHA256SUMS`.

| | Representation | Geometry status | Look | Cost (build in browser, crop) |
|---|---|---|---|---|
| Current | MDS mean on 1.82 m lattice, photo on all faces, smooth normals | derived surface | melted walls, stretched facades | 72 ms, 0.16 M triangles |
| **A** | MDS on ~0.45 m lattice by nearest (unmodified 0.5 m source values), flat shading, faces > 60° neutral | observed surface (source values), simplified rendering | no melting, but fragmented roofs, grey walls everywhere, trees as grey spikes: a broken-looking surface | 0.66 s, 2.6 M triangles |
| **B** | MDT terrain + every cell with MDS − MDT ≥ 2.5 m as a vertical prism (flat top at MDS, neutral walls) | derived objects, no classification | staircase / moiré walls, trees and buildings alike as blocks: the worst | 2.0 s, ≈ 5.6 M triangles |
| **C** | Catastro building parts extruded (LoD1) on MDT terrain; roof = median MDS inside the footprint shrunk 0.75 m; base = min MDT; neutral walls; roof cap textured from the orthophoto | footprint **observed** (official cadastral survey), height **derived** (LiDAR), LoD1 block **simplified** | clean blocks, legible streets and courtyards; trees only as photo on terrain | 0.71 s, 1 724 parts (+ terrain) |

### C — data and checks

- Footprints: Catastro INSPIRE WFS `BU:BuildingPart`, bbox EPSG:25830 438 912, 4 471 852, 439 539, 4 472 362
  (`http://ovc.catastro.meh.es/INSPIRE/wfsBU.aspx`, queried 2026-11-26); 2 126 parts returned, 1 724 used
  (375 centroid outside the crop, 19 with MDS − MDT < 2 m, 8 without cells). GML sha256 `519ebc11…`.
- **Licence: CC BY 4.0 DG Catastro**, verified in the official INSPIRE metadata record `ES_SDGC_BU`
  (IDEE CSW, `otherConstraints`, dateStamp 2025-01-28; "No conditions apply"). The licence PDF on the
  Catastro site could not be read as text; the WFS capabilities declare no access constraints.
- Plausibility (not validation): LiDAR height / Catastro floors above ground gives **2.5–4.5 m per floor
  for 85.2 % of the built area**; 10 % of the area (366 small parts, median 11 m², mostly registered as
  1 floor) is > 6 m per floor — the LiDAR median there probably catches a taller neighbour, a canopy or
  roof structures. Reported, not corrected; heights are never taken from floor counts.
- Roof shape: 12.4 % of parts have an MDS interquartile range > 3 m inside the footprint (pitched roofs,
  mixed parts): LoD1 flattens them to the median.
- Three dates: texture Jul–Aug 2023, LiDAR Mar–May 2024, Catastro footprints current at query time
  (updated twice a year). A building changed in between can disagree locally.

## 3. Recommendation

**C**, as the 3D urban representation of Gate 4D, with three explicit layers on screen and in the manifest:

1. **Terrain** — MDT 2024 (derived from the LiDAR ground class), textured with PNOA 2023 (observed photo).
2. **Buildings** — LoD1 blocks: official Catastro footprint (observed) × LiDAR height (derived) =
   simplified representation; neutral facades (never photo facades); roof caps from the orthophoto
   seen from above (roof lean of a conventional ortho noted).
3. **Not modelled** — vegetation, bridges, street furniture: they stay as the photo on the terrain.

Keep the MDS surface as an **experimental scientific mode** ("superficie LiDAR", rendered like A:
native values, no averaging, steep faces neutral), never presented as an urban model. Reject B.
Retire the averaged MDS draping for the film.

C is the only option where every visible element has a clear status (observed / derived / simplified);
it is cheap (sub-second build per crop, far fewer triangles than A/B), and it adds one official source
with a verified open licence. Cost of adopting it: tiled WFS fetches for the full window (~7× this crop),
a footprint→height materializer step with its manifest, and LoD1 meshes in the renderer. Next render
only after the owner's visual approval.
