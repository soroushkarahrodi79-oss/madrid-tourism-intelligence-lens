# #149 — proposed acceptance-criteria update (PROPOSAL; issue text NOT edited)

Status vocabulary: **MET** (measured, with the stated method), **NOT MET** (measured, fails), **OPEN** (not yet measurable / not measured), **DEFERRED** (moved to a named issue, still unresolved there).

## Why the salience criterion must change
Criterion 1 requires cluster:marker salience ≤ 2:1 *and* criterion 2 requires cluster contrast ≥ 3:1, both over the same Positron background.
With the weakest marker at M = 1.15 (G0 edge minimum; 1.22 recomputed for the rail stroke on #ededed), any chip at C ≥ 3 gives C/M ≥ 3/1.15 = 2.61 (2.46). The ≤ 2 target needs M ≥ 1.5. M is the subject of #150, which #149 blocks. The two criteria are jointly unsatisfiable and circular. A ratio of two WCAG contrast ratios is also not a validated model of perceived prominence.

## Proposed replacement set

| # | Original criterion | Proposed wording | Status on PR #157 |
|---|---|---|---|
| 1 | Cluster:marker salience ≤ 2:1 | **Remove from #149; move whole-map relative salience to #150 (after weak-marker contrast changes) and #153 (human validation)**, measured with a perceptual protocol rather than a ratio of contrasts. | DEFERRED, **unresolved** |
| 2 | Chip ≥ 3:1 non-text contrast | "The chip's outermost boundary (the single outermost drawn ring) has ≥ 3:1 against ≥ 95 % of sampled adjacent basemap pixels, measured on rendered pixels per basemap × appearance × Lens state (in-Lens solid / out-of-Lens dashed at its shipped opacity). Dual-tone best-of-two is reported but is not a pass." | **NOT MET** on Esri satellite: 52 real-tile captures; outermost halo < 3:1 for 55–66 % of ring samples, border < 3:1 for 30–72 %, best-of-two < 3:1 for 30–54 % (before: 37–56 %). CARTO OPEN (no key) |
| 3 | Count ≥ 4.5:1 vs chip surface | unchanged; measured on rendered text-core pixel vs rendered fill | MET on Esri satellite: rendered text-core vs fill p05 ≥ 16:1 in-Lens, ≥ 5.8:1 out-of-Lens, 0 % of chips < 4.5:1; CARTO OPEN |
| 4 | Types distinguishable without colour alone | "…differ in a non-colour **rendered** property that survives 11 px, in grayscale, with the glyph ≥ 3:1 against the chip fill; computed-style assertion plus rendered-pixel coverage" | MET (glyph mask differs; rendered glyph ≥ 3:1 on 41–47 % of its 11 px box, max-pixel p05 ≥ 4.7:1 (min over captures)) — screening only, no human validation |
| 5 | Chrome resolves through appearance tokens | unchanged | MET (`--map-cluster-*`, no Dark literal; test-asserted) |
| 6 | Verified on all three basemaps × both appearances | unchanged, with "real tiles" explicit; synthetic flat tiles do not count | **OPEN**: Esri measured; CARTO Positron/Dark Matter require `CARTO_BASEMAP_KEY` |
| — | (new) Keyboard + name | Focusable cluster activates on Enter and Space; has an accessible name with category and count; focus indicator ≥ 2 px | MET (Chromium; WebKit via new CI job) |
| — | (new) State coverage | Hover, focus, out-of-Lens and EN/ES keep glyph and count unclipped | MET (Chromium) |

## Honest wording for the salience row
Row 1 is not satisfied by this PR and is not satisfied by "removing" it: it is **moved**, with its blocker stated (#150 raises weak-marker contrast; #153 supplies human validation). #149 should close only when rows 2 and 6 are MET or explicitly waived by the owner with the satellite boundary failure recorded.

## Findings that the original criteria did not anticipate
* Most visible chips are **out-of-Lens**: dashed border at opacity 0.72 (app design, unchanged). Boundary and count must be judged per state.
* Chips overlap one another and are covered by the side panels in the default view; per-chip content is occluded for many chips (pre-existing, not changed here).
* "191 chips / 21.4 % coverage" counts chips outside the viewport; visible chips at 1440×900 z14 are ~130 and some are under panels.
* Clusters do not exist at z ≥ 16 (clustering off), so z17 captures show individual markers only.
