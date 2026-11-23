# Integration assessment — PNOA-LiDAR in Madrid Urban Evidence Lens

**Status (updated 2026-11-24 after the data run).** The pilot ran on the real
Madrid sheet 0559-4-5: the data are **technically usable** (full coverage, aligned,
plausible, reproducible; [RESULTS.md](RESULTS.md)). That settles *feasibility* only.
Whether the indicator is **reliable and worth integrating** is not shown by the
run: there was no independent validation, building and vegetation were not
separated, and the models are provisional v1. The verdict below therefore rests on
the sources, on Lens's content and on those limits, not on a validated result.

## What Lens already has that this would be compared to

- A 2-D Leaflet map; A/B comparison over **independent user-drawn geometries**;
  barrio / ámbito evidence with explicit denominators (Padrón, VUT licences,
  hospitality census, planning ámbitos). The planning source is explicitly
  **m² only, no dwelling counts** (Gate L), and no height or storey count exists
  anywhere in the product.
- The historical PNOA 2006 | 2023 orthophoto divider, documented as a **visual
  aid, not evidence**, with no count, indicator or export reading it.

## Applications

| | **A. Urban morphology** | **B. A/B spatial summary** | **C. 3-D context** |
|---|---|---|---|
| Scientific question | How does height of the surface above ground vary within and between barrios / ámbitos? | Can an existing A/B geometry be summarised by a LiDAR-derived indicator with a stated denominator? | Does a 3-D relief/surface view tell a reader something a 2-D layer cannot? |
| Data needed | MDS + MDT (v1 now, v2 later); for *building* height additionally building footprints (Catastro) or the NPC02+ class "building" | Same rasters, held so that **arbitrary polygons** can be summarised | MDT (relief) and/or MDS (surface), plus a renderer |
| Real feasibility | Descriptive surface-height statistics: **feasible** (pilot). Building height: **not defensible from MDS − MDT alone** (vegetation, vehicles, awnings are included; v1 classification is the weak point). IGN lists *normalised building models* for Madrid for **1st half 2027** | **Hard in a static page.** Arbitrary polygons need the raster in the browser (HTTP-range COG reads + a new library) or a pre-aggregated grid, which changes the geometry's meaning. Per-barrio/ámbito precomputed summaries are feasible offline | Madrid's relief is gentle; extruded surfaces need WebGL/Cesium/Three.js (explicitly **not** to be added without proven substantial advantage). A hillshade tile layer would be 2-D anyway |
| Limits | Provisional v1; month-level epoch (Mar–May 2024, no day); spring phenology; interpolation in narrow streets; declared RMSE ≤ 15 cm is a spec, not a Madrid measurement | Denominator = valid cells (not area of the drawn shape); edge cells; NoData over water; false precision at 0.5 m for a hand-drawn polygon | No evidence claim possible from a visual; reproducibility lost if served live |
| Benefit for Lens | A **new dimension** (vertical) absent from the product; but no current Lens question (tourism pressure, housing, planning) is answered by surface height | Would let Lens say something about built form near a drawn area, but only as a context figure | Interpretive/atmospheric; no analytical gain demonstrated |
| Maintenance cost | Static per-barrio/ámbito JSON regenerated per IGN release (v1→v2→derived, three releases in ~12 months) — moderate | **High**: new runtime dependency, large data hosting, provenance per release | **High**: new rendering engine |

## Recommendation (after the data run; judgement, not validation)

- **A (research only): MODIFY — continue as an isolated research line**, not a
  product feature. Wait for IGN v2 / normalised building models (forecast
  2027) before deriving anything that could be read as building height.
- **B: NO-GO for now.** The only route needs a new client library or a changed
  geometry semantics; no Lens question needs it yet.
- **C: NO-GO.** No demonstrated interpretive gain; the cost is a new rendering
  engine, which the brief rules out without a substantial proven advantage.
- **Overall integration verdict: NO-GO for the production viewer at this time**,
  with the research pilot kept (MODIFY). The run did **not** overturn it: the
  data are usable, but no Lens question is yet answered by surface height, the
  building/vegetation split is unavailable in v1, and IGN's own normalised
  building models are forecast for 1H 2027. It would be revisited if (a) v2 or
  the IGN normalised models are published and (b) an independent check (e.g.
  cadastral storeys) validates a height indicator. It must not be quoted as
  "validated".

## Hard constraints that hold whatever the data show

- No claim of *change over time* may join this 2024 LiDAR to the 2006/2023
  orthophotos or to the 2016 second-coverage LiDAR without comparable sources
  and independent validation (different sensors, densities, accuracy, season).
- MDS − MDT is **never** labelled "building height".
- The pilot reads no file under `data/` except the committed official barrio
  geography, and no application file references it (tested).
