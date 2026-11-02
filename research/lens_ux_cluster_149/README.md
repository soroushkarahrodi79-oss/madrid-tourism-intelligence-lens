# UX-V1 (#149) — cluster chip experiment and evidence

Selected: **Candidate B — category glyph + count**, appearance-aware surface, dual-tone edge.
Scratch candidates A (appearance-aware only), B (glyph) and C (circle vs rounded square) are in `candidates.css`.

## Reproduce
```bash
npm ci && npx playwright install chromium
curl -sSL -o /tmp/runtime_poi.json https://soroushkarahrodi79-oss.github.io/madrid-tourism-intelligence-lens/data/runtime_poi.json
node research/lens_ux_cluster_149/experiment.mjs --poi /tmp/runtime_poi.json --out out.json --cand BASE,A,B,C   # candidates
node research/lens_ux_cluster_149/experiment.mjs --poi /tmp/runtime_poi.json --out out.json --cand PROD        # shipped CSS
node research/lens_ux_cluster_149/perf.mjs --poi /tmp/runtime_poi.json --root . --out perf.json
```
`BASE` = the CSS of the checkout you run it on; to measure the pre-change CSS, run from a checkout of `origin/main` (c3d73ed).

## What the numbers are — and are not
* **light / dark basemaps are SYNTHETIC flat tiles** (#ededed, #262626) served for the CARTO URL pattern with a placeholder key. They are not CARTO Positron / Dark Matter imagery; the production key is never read. Satellite is real Esri imagery fetched live (attribution in the JSON).
* Boundary contrast = per-sample best of {outer ring, border, chip fill} against the chip-hidden background, sampled just outside the chip. It is a detectability proxy, not a WCAG conformance verdict; anti-aliasing is not modelled beyond the screenshot.
* Grayscale/CVD figures are luminance screening on a same-count chip pair. The category inset ring tint also shifts luminance, so the pixel figures overstate glyph-only distinction; the non-colour evidence is the differing `::before` mask (computed style).
* Perf ran in headless software rendering (pan: ~119/120 long frames for BOTH roots, so pan is uninformative). `performance.memory` is coarse/bucketed; its 24.8 → 42.6 MB step is not explained by this change (no JS-side allocation added) and is reported unattributed.
* The deployment moved to c3d73ed since the G0 pin; its JS/CSS are byte-identical to the pinned 913de27 (`git diff 913de27 c3d73ed -- js css index.html` is empty). Re-pin is in `research/lens_ux_vision_g0/results/map_evidence_20261101_rerun_149.json` (191 chips, 86/105, 21.4 %, 11.2×).

## Salience criterion (≤ 2:1) is unsatisfiable under #149's own definition
Chip contrast C ≥ 3 (SC 1.4.11) and weakest marker M give C/M ≥ 3/M. With M = 1.15 (G0 edge min) → 2.61; with M = 1.22 (rail stroke on #ededed, recomputed) → 2.46. ≤ 2 needs M ≥ 1.5. The weakest marker is #150's subject, which is blocked by #149 in the issue graph — a circular dependency. A ratio of two WCAG contrast ratios is also not a validated perceptual-salience model.
Proposed revision (not applied): close #149 on absolute criteria (≥ 3:1 findable, ≥ 4.5:1 count, non-colour identity, tokens), and move the relative-salience criterion to #150 / #153 (human validation), evaluated after markers change.

## Rendered-imagery validation (validate.mjs) — added after review
`validate.mjs` replaces the synthetic-tile experiment as the evidence of record. It measures **rendered pixels** per component (outer halo, border, fill, count text core, glyph) against the same view with chips hidden, separately for in-Lens (solid, opacity 1) and out-of-Lens (dashed, opacity .72) chips, excluding chips outside the viewport, covered by panels, or occluded by neighbouring chips. The earlier max(border,halo,fill) figure is kept only as a labelled non-verdict.
Run it in short segments (one viewport per call; a fresh browser per capture; it writes after every capture):
```bash
CARTO_BASEMAP_KEY=<from your secret store> node research/lens_ux_cluster_149/validate.mjs --poi poi.json --before <origin/main checkout> --after . --shots <dir outside repo> --out out.json --basemaps satellite,light,dark --part vp:1440x900
```
Without `CARTO_BASEMAP_KEY`, light/dark rows are recorded as `notMeasured` — never substituted. Results: `results/validate_esri_satellite_20261101.json` (52 captures, Esri live; screenshots not committed: third-party imagery, hashes in the JSON). Proposal for the criteria: `ACCEPTANCE_CRITERIA_PROPOSAL.md`.

## Production-page comparison (no local key) — `validate.mjs --prod`
BEFORE = the live Pages site untouched; AFTER = the same live page with only `css/app.css` and `js/app.js` answered from this checkout by Playwright route interception inside the isolated browser context (the deployed site is never modified). The page supplies its own runtime config and CARTO key; this script never reads, logs, stores or records it (tile records keep host and style path only; error strings are scrubbed of `key=`). Integrity checks run on every row: tile host/style path = `basemaps.cartocdn.com/rastertiles/light_all|dark_all` (or Esri), all tiles loaded, identical runtime_poi SHA-256 on every row, identical visible-chip count before vs after, zero console errors. Results: `results/validate_prod_carto_positron_darkmatter_20261101.json` (104 captures), `results/validate_prod_esri_satellite_20261101.json` (52). Ring contrast is reported two ways: a strict fixed-radius sample (pessimistic: a 2 px ring can be missed by rounding) and a band metric (strongest pixel in the ring's radial band; optimistic). The truth lies between them; neither is a WCAG conformance verdict.
