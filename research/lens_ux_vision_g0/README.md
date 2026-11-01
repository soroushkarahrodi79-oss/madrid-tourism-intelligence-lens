# LENS-UX-VISION-G0 — cartographic contrast and colour-separability harness

Measurement package behind issues
[#149](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/issues/149),
[#150](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/issues/150) and
[#152](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/issues/152).

Those issues assert that every default operational marker falls below the WCAG 3:1 non-text-contrast floor against the default basemap, and that the shipped palette was tuned for the **dark** basemap. This directory is what makes those claims checkable by someone other than their author, and what makes a proposed fix verifiable rather than argued.

**Read-only.** Nothing here opens an application page, renders a preview, or changes any production asset, dataset, style table or evidence semantic. It measures tiles and arithmetic.

## Pinned inputs

The palette in `results/` was measured against one exact deployed build:

- App and Pages source commit: `913de2766a718b2c64b0419542d5117cc380293b` (PR #148).
- Pages deployment workflow run: `41307637236`, `build_state: "pass"`, generated `2026-11-01T12:41:31.949Z`.
- Deployment manifest SHA-256: `9fc74f9aa660b274bd73cd1d5c6983012ad45ec53a5b85c27a8ab4a0db1b4c0c`.
- Deployment POI snapshot SHA-256: `adc22c52e755a235c28412616b9bebfce0f5a460417939922b931925b83ee333`.
- Basemap: CARTO Positron `light_all`, non-retina, **verified genuinely loading** — 20/20 tiles from `basemaps.cartocdn.com`, no OpenStreetMap fallback.

`sample_positron_tiles.mjs` re-reads and re-pins these on every run, and refuses to measure a deployment whose `build_state` is not `pass`.

## Contents

- [`sample_positron_tiles.mjs`](sample_positron_tiles.mjs) — fetches production basemap tiles, decodes them in headless Chromium, writes the dominant-colour palette and per-tile luminance summary. **Requires `CARTO_BASEMAP_KEY`.**
- [`color_analysis.mjs`](color_analysis.mjs) — composites markers over that palette and reports WCAG contrast, CIEDE2000 separability and simulated colour-vision deficiency, for the shipped palette and two candidates. **No key, no network, no dependencies.**
- [`results/positron_palette_20261101.json`](results/positron_palette_20261101.json) — the measured background: 22 dominant colours covering 86.3% of 1,572,864 pixels from 24 tiles (6 Madrid sites × z12/14/16/17), plus the `dark_all` control sample.
- [`results/color_analysis_20261101.json`](results/color_analysis_20261101.json) — full machine-readable output for the three candidates.
- [`capture_map_evidence.mjs`](capture_map_evidence.mjs) — executable reproduction of the map's **visual** claims: cluster census, viewport coverage, whether two cluster types render identically, and the salience ratio. Opens the public deployment read-only in headless Chromium. Screenshots are opt-in (`--screenshots`) and are **not committed**; captures contain third-party basemap imagery and the attribution requirement travels in the metadata.
- [`results/map_evidence_20261101.json`](results/map_evidence_20261101.json) — that script's output, including its six stated limitations.

## Reproduce

From the repository root. The analysis needs nothing installed:

```bash
node research/lens_ux_vision_g0/color_analysis.mjs
```

To re-measure the basemap itself (needs the CARTO key and Chromium):

```bash
npm ci
npx playwright install chromium
CARTO_BASEMAP_KEY=<key> node research/lens_ux_vision_g0/sample_positron_tiles.mjs
```

Then re-run the analysis against the new palette:

```bash
node research/lens_ux_vision_g0/color_analysis.mjs --palette research/lens_ux_vision_g0/results/<new>.json
```

`--json` emits the full report instead of the table. **Do not pass the key on the command line** — it would be recorded in shell history. The key is read from the environment, used only to build request URLs inside the page, and never written to any file here; the recorded `url_template` is redacted.

## What it reports

Marker compositing mirrors `js/app.js` `addMarker()` exactly: `fillOpacity 0.78`, stroke `opacity 0.95`, `weight 1`, radius 4.2 (2.8 for BiciMAD). The **edge** figure is the detectability-relevant one — it is the boundary a reader has to find against the tile.

Against CARTO Positron `light_all`, shipped palette:

| Category | Hex | Edge contrast (median) | % tile area below 3:1 |
|---|---|---|---|
| Metro & Cercanías | `#ffd166` | **1.28** | **100%** |
| BiciMAD | `#54e2b5` | **1.43** | **100%** |
| Tourist info | `#c79cff` | **1.93** | **100%** |
| Hotels & stays | `#3da8ff` | **2.24** | **100%** |
| Museums | `#9d72ff` | **2.88** | **85.2%** |

### Two estimators, and why the issue text is slightly lower

Issues #149/#150 quote marker contrast from the **full per-pixel sample** (224,712 individual background pixels). This harness uses the **22-colour area-weighted approximation**, because that keeps it dependency-free and runnable with no key. The two agree closely, with the approximation running marginally *more generous*:

| Category | Full per-pixel sample (quoted in #150) | This harness (22-colour weighted) |
|---|---|---|
| Metro & Cercanías | 1.28 | 1.30 |
| BiciMAD | 1.43 | 1.46 |
| Tourist info | 1.88 | 1.93 |
| Hotels & stays | 2.19 | 2.24 |
| Museums | 2.82 | 2.88 |

Maximum divergence across **both** palettes is **0.12** (on `B_contrast_adjusted/info`), always in the optimistic direction, because the long tail the approximation drops is slightly darker than the dominant colours. **The report and issue figures are therefore the conservative ones**, and no conclusion changes under either estimator: all five shipped categories fail the 3:1 floor by a wide margin on both.

`color_analysis.mjs` checks this divergence on every run against a declared tolerance of **0.15**, set just above the 2026-11-01 observed maximum so that a future re-measurement which moves the approximation materially fails the run. The tolerance is a drift detector, not a claim that the estimators agree to 0.15 in general.

The same palette over CARTO `dark_all` scores **4.88 – 11.11** and passes. That control is the evidence that this is a dark-basemap palette inherited by a light-default product, not a palette that was ever wrong in its own terms.

Candidate **C** (shipped hues, opaque `#16222f` outline — the fix recommended in #150) reaches **14.75** median / **11.40** minimum with **0%** of tile area failing, changing no colour identity. Candidate **B** also passes the contrast floor but collapses grayscale separability to 10/10 pairs below ΔE 10 and worsens deuteranopia; it is reported so the trade-off is visible, and is **not recommended**.

## Guard rails

Both scripts are built to fail rather than mislead:

- **`sample_positron_tiles.mjs` verifies the pinned deployment**, it does not merely record it. It compares the live `app_commit`, workflow run, manifest SHA-256, POI SHA-256 and `build_state` against an existing palette (`--expect`) and **exits 3** if the deployment has moved. Re-pinning needs `--accept-new-deployment`, so it is a deliberate act.
- **It refuses a degraded build** (`build_state` other than `pass`).
- **It refuses to run without `CARTO_BASEMAP_KEY`** (exit 2), because a keyless run measures OpenStreetMap and would label it Positron (#155). This is checked *before* output-path validation, so the scientific error is reported ahead of the operational one.
- **Output is constrained to this gate's `results/`** and will not overwrite an existing file without `--force`, so a re-run cannot quietly destroy committed evidence.
- **`capture_map_evidence.mjs` applies the same pin verification and output guards.**

## Exit code

`color_analysis.mjs` enforces **both halves** of #150's criterion — ≥3:1 edge contrast **and** ≥99% of tile area — not the median alone. It exits non-zero if candidate C fails either half on the measured basemap, or if the weighted approximation drifts from the recorded per-pixel pass beyond tolerance. The shipped palette failing is the expected present state and does not fail the run: that is the finding, not a regression.

**Basemap scope.** #150's criterion spans three basemaps. A palette file describes **one**. The harness prints which basemap it evaluated and which are `NOT EVALUATED`, and never reports a criterion-wide pass from a single-basemap run. The `dark_all` block in the palette file is a five-number summary, not a palette, so it does not discharge the dark half. Satisfying the criterion in full needs a measured palette per basemap.

## Limits — read before citing these numbers

- **The contrast figures are a model, not rendered pixels.** They assume uniform alpha compositing over sampled tile colours. Anti-aliasing at a 2.8–4.2px radius is not modelled and will make real markers perform **worse** than reported, never better.
- **Tile imagery is mutable.** CARTO can re-render Positron at any time. These numbers describe tiles served on 2026-11-01 against the pinned commit; a later re-measurement may legitimately differ, which is why the sampler re-pins.
- **The CVD figures are simulations** (Machado, Oliveira & Fernandes 2009, severity 1.0). They screen for risk along dichromat confusion lines. They are **not** evidence of what any person with a colour-vision deficiency perceives, and ΔE2000 models colour-patch difference, not recognition of a 3px mark over textured raster. See #153 for the human-validation gate that would settle this.
- **The background set is 86.3% of sampled area**, not all of it; the remaining long tail is rarer colours, mostly labels and minor road casing.
- **No human has been tested.** Everything here is instrument measurement and standards conformance.

## Related

- [#149](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/issues/149) cluster hierarchy · [#150](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/issues/150) marker contrast · [#151](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/issues/151) typography · [#152](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/issues/152) colour-only discrimination · [#153](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/issues/153) human-validation gate · [#154](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/issues/154) panel height · [#155](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/issues/155) silent basemap fallback
- [`docs/LENS_UX_VISION_G0_AUDIT.md`](../../docs/LENS_UX_VISION_G0_AUDIT.md) — the full audit these measurements belong to: baseline verification, map/panel/typography findings, WCAG results and the decision gates.
- [`docs/VISUAL_LANGUAGE.md`](../../docs/VISUAL_LANGUAGE.md) — the visual contract these findings are measured against.
- [`research/ux_t1_ta3_palette/`](../ux_t1_ta3_palette/) — the earlier T-a3 rendered-palette evidence package, whose unresolved per-pixel gate (`css/app.css`, the `#0098c0` note) is what #150 finally measures.
