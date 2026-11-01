# #149 — proposed acceptance-criteria update (PROPOSAL; issue text NOT edited)

Status vocabulary: **MET** (measured, with the stated method), **NOT MET** (measured, fails), **OPEN** (not yet measurable / not measured), **DEFERRED** (moved to a named issue, still unresolved there).

## Why the salience criterion must change
Criterion 1 requires cluster:marker salience ≤ 2:1 *and* criterion 2 requires cluster contrast ≥ 3:1, both over the same Positron background.
With the weakest marker at M = 1.15 (G0 edge minimum; 1.22 recomputed for the rail stroke on #ededed), any chip at C ≥ 3 gives C/M ≥ 3/1.15 = 2.61 (2.46). The ≤ 2 target needs M ≥ 1.5. M is the subject of #150, which #149 blocks. The two criteria are jointly unsatisfiable and circular. A ratio of two WCAG contrast ratios is also not a validated model of perceived prominence.

## Proposed replacement set

| # | Original criterion | Proposed wording | Status on PR #157 |
|---|---|---|---|
| 1 | Cluster:marker salience ≤ 2:1 | **Remove from #149; move whole-map relative salience to #150 (after weak-marker contrast changes) and #153 (human validation)**, measured with a perceptual protocol rather than a ratio of contrasts. | DEFERRED, **unresolved** |
| 2 | Chip ≥ 3:1 non-text contrast | "On rendered pixels, per basemap × appearance × Lens state (in-Lens solid / out-of-Lens dashed at its shipped opacity), at least one of the chip's edge rings (outer halo or border) reaches ≥ 3:1 against ≥ 95 % of the adjacent basemap pixels; both rings are reported separately and a best-of-two is never substituted for a per-ring result." | **NOT DEMONSTRATED**. Optimistic band metric (strongest pixel in each ring's own radial band), % of samples < 3:1, in-Lens: Positron+Light border 6–15 %; Dark Matter+Light halo 10–17 %; Positron+Dark border 89 %, halo 16 %; Dark Matter+Dark border 9 %; Esri halo 35–41 % / border 51 %. Strict fixed-radius metric is 20–95 % worse. Only out-of-Lens chips on CARTO reach ≥ 95 % (0–8 % below) under the band metric. Satellite fails; no in-Lens configuration reaches 95 %. |
| 3 | Count ≥ 4.5:1 vs chip surface | unchanged; measured on rendered text-core pixel vs rendered fill | **MET** on real CARTO Positron, Dark Matter and Esri: p05 ≥ 16:1 in-Lens, ≥ 4.8:1 out-of-Lens (min over captures), 0 % of chips < 4.5:1 |
| 4 | Types distinguishable without colour alone | "…differ in a non-colour **rendered** property that survives 11 px, in grayscale, with the glyph ≥ 3:1 against the chip fill; computed-style assertion plus rendered-pixel coverage" | MET (glyph mask differs; rendered glyph ≥ 3:1 on 41–47 % of its 11 px box, max-pixel p05 ≥ 4.4:1 (min over captures; real CARTO and Esri)) — screening only, no human validation |
| 5 | Chrome resolves through appearance tokens | unchanged | MET (`--map-cluster-*`, no Dark literal; test-asserted) |
| 6 | Verified on all three basemaps × both appearances | unchanged, with "real tiles" explicit; synthetic flat tiles do not count | **MEASURED** on real CARTO Positron + Dark Matter (production-page interception, 104 captures) and Esri (52); Dark appearance only at 1 view per basemap (n = 1 chip pair). Criterion 2 is not demonstrated, so this row is not closed. |
| — | (new) Keyboard + name | Focusable cluster activates on Enter and Space; has an accessible name with category and count; focus indicator ≥ 2 px | MET (Chromium; WebKit via new CI job) |
| — | (new) State coverage | Hover, focus, out-of-Lens and EN/ES keep glyph and count unclipped | MET (Chromium) |

## Honest wording for the salience row
Row 1 is not satisfied by this PR and is not satisfied by "removing" it: it is **moved**, with its blocker stated (#150 raises weak-marker contrast; #153 supplies human validation). #149 should close only when rows 2 and 6 are MET or explicitly waived by the owner with the satellite boundary failure recorded.

## Findings that the original criteria did not anticipate
* Most visible chips are **out-of-Lens**: dashed border at opacity 0.72 (app design, unchanged). Boundary and count must be judged per state.
* Chips overlap one another and are covered by the side panels in the default view; per-chip content is occluded for many chips (pre-existing, not changed here).
* "191 chips / 21.4 % coverage" counts chips outside the viewport; visible chips at 1440×900 z14 are ~130 and some are under panels.
* Clusters do not exist at z ≥ 16 (clustering off), so z17 captures show individual markers only.

## Edge-treatment experiment (control vs V1 casing / V2 extremal tones / V3 widths) — result
Real CARTO Positron, CARTO Dark Matter and Esri imagery via production-page interception; results in `results/edge_variants_20261101.json`, summarised by `summarise_edge.cjs`.

**Is a single-ring ≥ 95 % requirement feasible?** Measured on the actual adjacent basemap pixels (relative luminance of the sample just outside each chip): the best single ring tone clears ≥ 3:1 for — Positron 96.9 % (in-Lens) / 99.6 % (out-of-Lens) with a near-black ring; Dark Matter 92.2 % / 98.3 % with a white ring; **Esri 70.7 % / 74.4 % with the best possible tone, i.e. a single-ring ≥ 95 % requirement is mathematically infeasible on satellite** (a pure-black ring plus a pure-white ring would clear ~100 %). A ring tone clears 3:1 only for backgrounds ≤ (Lr+0.05)/3−0.05 or ≥ 3(Lr+0.05)−0.05, so no single luminance spans a wide-range basemap.

**Proposed multi-tone boundary criterion (not an automatic pass):** for each basemap × appearance × Lens state, on rendered pixels, at ≥ 95 % of boundary samples at least one of the two opposite-tone edge rings reaches ≥ 3:1 against the adjacent basemap pixel; each ring is also reported separately and a ring is never credited with samples it did not pass. Out-of-Lens chips are dashed by design: evaluate ink samples (classified by rendered colour) and disclose the gaps as a structural cue, not a pass.

**V2 (adopted in css/app.css: edge #0b1220 / halo #fff in Light, #fff / #04080e in Dark; geometry unchanged), % of boundary samples below 3:1 on either ring (multi-tone), in-Lens, Light appearance, 22 chips / 512 samples:** Positron 1.6 %, Dark Matter 2.3 %, Esri 1.6 % → criterion met in this sample (control: 3.1 / 3.9 / 10.5 %). **Not met / unresolved:** Dark appearance in-Lens (11 chips, 256 samples) Positron 5.5 %, Esri 5.1 % (marginal, tiny n); out-of-Lens inked samples, Light: Positron 5.1 %, Esri 8.4 %; Dark Matter 1.1 % met. V1 (casing) and V3 (widths) gave no meaningful gain and were rejected (V1 also reads as a busy triple ring).
Glyph recognition at the rendered 11 px size (correlation of the rendered box with each category's own mask, correct if own > other): 100 % of 4–205 chips per cell, mean own-mask r 0.91–0.99 vs other-mask ≈ 0.5 — a screening result, not human validation. Count/glyph contrast unchanged by V2.
