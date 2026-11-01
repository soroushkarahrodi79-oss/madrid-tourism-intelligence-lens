# Proposed amendment to issue #149 (PROPOSAL — the issue text is not edited)

**Why:** two original criteria are jointly unsatisfiable (chip ≥ 3:1 and cluster:marker ≤ 2:1 cannot both hold while the weakest marker is ~1.15–1.22:1; the marker is #150's subject and #150 is blocked by #149), and the relative-salience ratio is not a perceptual model.

## A. Cluster-owned criteria (independently testable in #149)
| id | criterion | status on PR #157 (V2) |
|---|---|---|
| A1 | Cluster chrome resolves through appearance tokens; no Dark-only literal in Light | **Met** (test-asserted) |
| A2 | Count ≥ 4.5:1 against its rendered chip fill, per basemap × appearance × Lens state, on real tiles | **Met** (p05 ≥ 16:1 in-Lens, ≥ 4.8:1 out-of-Lens; strongest-core-pixel measure) |
| A3 | Categories differ without colour, and the difference is recognisable at the rendered 11 px glyph size | **Met on screening** (computed mask differs; 100 % mask-correlation recognition); human validation → #153 |
| A4 | Keyboard: focusable, Enter/Space zoom, accessible name with category + count, EN and ES at render and on language switch | **Met** (Chromium, WebKit CI) |
| A5 | Boundary: at ≥ 95 % of boundary samples at least one of two opposite-tone rings ≥ 3:1 against the adjacent basemap (rendered, per ring reported separately), with the cluster-level bootstrap 95 % upper bound of the failing share ≤ 5 %, over ≥ 30 unique clusters from ≥ 2 independent Lens contexts; dashed out-of-Lens chips evaluated on inked samples with the gap share disclosed | **Not established** — 11 clusters, 1 Lens context; in-Lens Light upper bounds 5.5–6.5 %; Dark appearance 5.0–6.1 % |
| A6 | A5 verified on real CARTO Positron, Dark Matter and Esri, both appearances | **Measured, A5 open**; focus-indicator contrast on real tiles **not measured** |

A5 replaces "chip ≥ 3:1 non-text contrast". It is a project heuristic for variable backgrounds, **not** a claim of WCAG 2.2 SC 1.4.11 conformance; whether the outline is "required to identify" the component is an owner/accessibility decision.

## B. Dependency moved out of #149
* ~~Cluster-to-marker salience ratio ≤ 2:1~~ → **withdrawn from #149.** After #150 changes marker contrast, relative whole-map salience is assessed under #153 with a perceptual/human protocol. #149 makes no relative-salience claim.

## C. Explicitly unchanged
No `LAYER_COLOR` change; no clustering-threshold change; no basemap, halo, Lens, search or panel change.
