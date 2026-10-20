# UX-T1 T-a3 — bounded identity and palette decision gate

Status: **GO for the bounded T-a3 Draft implementation approved by the project owner on 2026-10-20.** This PR remains documentation-only. The approval records design direction; it does not turn the preview measurements into universal validation, activate an appearance control, or authorize merge/deployment.

Base and deployed source are `216cfbd3549c5d9575da0e89013f8e4a95f7fe5b`; PRs #103–106 are merged. Latest `Test` and `Deploy to GitHub Pages` workflows succeeded on that SHA (runs [39411220819](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/actions/runs/39411220819) and [39411220764](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/actions/runs/39411220764)). The deployed app returned HTTP 200 and its manifest reports `build_state: pass`. Current T-a0/T-a1 ownership and T-a2 drawer/focus baselines were reused. No historical 1,286-record inventory was rebuilt.

## 1. Bounded consumer-ownership ledger

Roles and thresholds below follow the actual consumer. SC 1.4.3 applies to text (4.5:1 normal, 3:1 large); SC 1.4.11 applies at 3:1 only to essential non-text information. A redundant mark beside an explicit label may be decorative. Translucent UI surfaces must be evaluated after compositing. “Candidate may vary” means appearance-owned in principle; it does not authorize a production change.

| Consumer | Source owner and relevant sites | Rendered role and context | Current distinction / criterion | Appearance ownership |
|---|---|---|---|---|
| Evidence badges: register, observed, snapshot, model, statistics, licence, planning scope | `css/app.css` `.badge.register/.observed/.snapshot/.model/.statistics/.licence/.planning-scope-badge` (lines 236, 263, 352, 539, 731, 785–786); corresponding evidence markup in `index.html` (e.g. 197, 212, 273, 422, 458, 702, 713) and generated snapshot state | 10px text over translucent category tint and border, normally inside a panel/card; preview tints were composited over a light card | Evidence wording + distinct tint/border carries state; tint/border is secondary. Text: SC 1.4.3 ≥4.5:1. Border is decorative when wording and tint remain | Text and tint values may vary by appearance; keep semantic badge kind, wording, source state and category assignment fixed |
| Layer/category tokens: museum, info, stay, bike, rail, activity, park/green, hospitality, heat, licence | CSS root tokens and `.dot-*`/`.bar-*` in `css/app.css` (62–63, 131–139); JS `LAYER_COLOR` and `addMarker()` in `js/app.js` (4–13, 2198–2212) | Legend dots/bars next to names; Leaflet point stroke/fill over raster tiles; heat colour is class-derived | Adjacent labels distinguish layer swatches; map points rely more heavily on the layer legend and vary over Light, Satellite and Dark tile pixels. Swatch SC 1.4.11 is not applicable where text fully duplicates it; point marks need visual review and potentially SC 1.4.11 if essential | Category hue is category-owned and may need an appearance-specific mark value; it is **not** Lens A/B. No new universal value proposed. Preserve category mapping and heat classes |
| Lens A panel identity, value labels, active control | `--a` is declared but has no `var(--a)` consumer; hardcoded CSS `.cb-side-a .cb-lens`, `.area-other-lens-a`, `.lensbtn.active.a` (`css/app.css` 509–511, 579); app-rendered labels and buttons in `index.html` 749–750 | 10px normal text on panel/control surface; solid A line and labeled A marker on map | Text SC 1.4.3 ≥4.5:1; essential solid map mark SC 1.4.11 ≥3:1 subject to heterogeneous tiles. Current dark identity is near-white | Panel/button text may vary with appearance. Map boundary itself is basemap-owned and excluded. Marker/halo SVG color is appearance-facing only if independently reviewed over all basemaps |
| Lens B panel identity, value labels, active control | `--b` has three consumers (`.area-other-lens-b`, `.area-label-b b`, `.ambito-metric-focus`); hardcoded B label/button colors in `.cb-side-b .cb-lens`, `.lensbtn.active.b` (`css/app.css` 271, 511, 580, 774, 1175) | 10px normal text on panels/buttons plus dashed B map/halo marks | Text SC 1.4.3 ≥4.5:1; essential graphic SC 1.4.11 ≥3:1. Keep dashed mark and “Lens B” label | Text and graphic roles need separate values in a light appearance; never use a graphic-only value for normal text |
| COMPARE / bridge identifiers and A/B legend | CSS `ac-a`/`ac-b`, `.ambito-pick-tag`, `.ambito-id`, bridge sides, table heads and bars (`css/app.css` 1111–1125, 1191–1192); bridge elements in `index.html` 611–646 | Small text and thin solid A / dashed B edges in comparison panels | A/B words, ordering and solid/dashed styling remain structural. Text SC 1.4.3; only essential edges use SC 1.4.11 | Appearance-facing UI values; distinct from planning states or Lens geometry. Keep the comparator’s A/B assignment and dash contract |
| Map center markers and SVG comparison halos | `.marker-a/.marker-b` and halo styling (`css/app.css` 692–719, 775–776); `HALO_GLYPH_COLORS` injects `--halo-color` inline (`js/app.js` 376, 425–427) | Small marker rings and halo strokes/text over heterogeneous Light, Satellite and Dark maps; halo data labels use dark paint-order outlines | Marker/hall geometry and values are unchanged. SVG text remains text and must meet SC 1.4.3 if not large; essential strokes use SC 1.4.11. Raster backdrop prevents one flat ratio from certifying map legibility | CSS/JS appearance-owned after basemap test; preview overrides SVG colors in-tab only. Keep source values, dash, geometry and states intact |
| Basemap-dependent Lens boundaries and Leaflet controls | `LENS_BASEMAP_STYLES` and `applyLensBasemapStyle()` (`js/app.js` 2128–2161); Leaflet controls/tiles | Basemap-specific map boundaries, tile content, zoom, attribution and tooltips | Excluded from T-a3; no T-a3 contrast result or candidate change | **Basemap-owned / out of scope.** No injected override and no proposed diff |
| Planning source-state marks and unrelated geometry | planning phase tokens and their solid/dashed/dotted line styles (`css/app.css` 340–352; `docs/VISUAL_LANGUAGE.md` Gate L contract) | Published phase/source states with labels; planning geometry uses its own neutral family | Preserve source wording and independent states; no ordinal scale or progress semantics. Any retained essential mark needs 3:1, text needs 4.5:1 | Category/state semantics are source-owned. Keep planning origin/unresolved distinct from Lens identities; geometry/calculations are out of scope |

`LAYER_COLOR` swatches and map points are included in this bounded ownership map because they are real category consumers. Their category meanings stay fixed. The arithmetic candidates in §2 are only graphic screening candidates; their actual three-basemap point contrast remains an open visual review item. POI markers, polygon geometry, Leaflet controls and `LENS_BASEMAP_STYLES` were not recolored in the preview.

## Human design approval — bounded T-a3

The project owner approved the following direction for a separate, bounded T-a3 Draft implementation:

- Lens A light-UI identity: navy `#123b5f`.
- Lens B light-UI text: `#00718f`.
- Lens B light-UI graphics: `#0098c0` only when the particular rendered consumer passes its applicable contrast and map-legibility checks. A failing or unvalidated consumer keeps its shipped behavior and is reported.
- Existing Dark identities remain unchanged. Lens A stays solid and Lens B stays dashed.
- No category-map color candidate is blanket-approved; category hue, mapping and meaning remain as shipped unless a separate consumer-specific decision authorizes a change.

This approval selects the design direction, not a universal use of `#0098c0`. The arithmetic results and limitations in §§3–5 remain the original evidence and are not upgraded by the decision. This PR records the approval only; implementation is tracked separately.

## 2. Rendered comparisons

The compact capture package is [`research/ux_t1_ta3_palette/`](../research/ux_t1_ta3_palette/). Every image with a ribbon is explicitly a **SIMULATED / TEST-ONLY PREVIEW**. The deployed app and pinned runtime snapshot supplied the map, real COMPARE panel, ES/EN labels and live basemap contexts. A temporary review card instantiates the production badge classes for fallback/conditional badge kinds that were not simultaneously present in the current snapshot. Its CSS, markup and candidate variables exist only in Playwright’s page; they are never written to the site.

| Image | What to review |
|---|---|
| [01 · shipped dark, EN, Light basemap](../research/ux_t1_ta3_palette/capture-current/screenshots/01-shipped-dark-reference-en.png) | Current production reference |
| [02 · shipped dark, ES, Light basemap](../research/ux_t1_ta3_palette/capture-current/screenshots/02-shipped-dark-reference-es.png) | Current Spanish reference |
| [03 · simulated Light, navy A, B text `#00718f` / graphic `#0098c0`, EN](../research/ux_t1_ta3_palette/capture-current/screenshots/03-light-navy-b-text-safe-en.png) | Navy candidate, current Light basemap and all seven badge classes |
| [04 · simulated Light, graphite A, same B role split, ES](../research/ux_t1_ta3_palette/capture-current/screenshots/04-light-graphite-b-text-safe-es.png) | Graphite candidate and Spanish labels |
| [05 · simulated Light, navy A, shipped B cyan `#43d7ff`](../research/ux_t1_ta3_palette/capture-current/screenshots/05-light-navy-existing-cyan.png) | Shows why retaining shipped cyan for light-theme normal text is not viable |
| [06 · simulated Light, graphite A, B text/graphic `#00718f`, Satellite](../research/ux_t1_ta3_palette/capture-current/screenshots/06-light-graphite-text-safe-satellite.png) | App markers/halos against actual satellite context |
| [07 · simulated Light, navy A, B graphic `#0098c0`, Dark basemap, ES](../research/ux_t1_ta3_palette/capture-current/screenshots/07-light-navy-graphic-dark-basemap.png) | Same candidate identity over dark tiles; basemap boundary colors stay source-owned |
| [08 · grayscale structural check](../research/ux_t1_ta3_palette/capture-current/screenshots/08-grayscale-a-b-structural-check.png) | Lens labels and solid/dashed cues remain visible when hue is removed |

T-a0/T-a2 set verified the pinned app assets; this preview pins the current Pages manifest (`104bace3…`, SHA-256 in the [capture metadata](../research/ux_t1_ta3_palette/capture-current/capture-metadata.json)) and runtime POI (`a482ba87…`). The simulated overrides apply only to T-a3 appearance-owned badge and Lens identity consumers (including center marker and SVG halo candidate colors). The preview leaves Leaflet attribution, zoom controls and tooltips at their shipped styling; those T-a4 surfaces remain visibly distinct from the simulated light chrome. `LENS_BASEMAP_STYLES`, geometry and basemap tiles are not modified. The basemap tiles themselves are remote and may change. Screenshots are not implemented-theme screenshots, device testing, a comprehensive WCAG audit, or proof that small map text survives every tile.

## 3. Contrast applicability and results

Capture details and exact measurements are in [`capture-metadata.json`](../research/ux_t1_ta3_palette/capture-current/capture-metadata.json). Ratios use WCAG 2.x sRGB luminance arithmetic. The badge result samples browser-computed text and backgrounds after ancestor/tint compositing in the preview. A/B role results composite the browser-computed light panel (`rgba(255,255,255,.94)` over `#f4f6f9`, rendered as `#fefeff`) and each 8% candidate tint. Audit §6 values for the flat background are repeated for context.

| Consumer/value | Flat `#f4f6f9` | Composited panel | Own 8% tint | Criterion and result |
|---|---:|---:|---:|---|
| Lens A navy `#123b5f` | 10.68 | 11.51 | 9.99 | Text 1.4.3: passes; graphic also clears 1.4.11 arithmetic |
| Lens A graphite `#343a40` | 10.63 | 11.45 | 9.98 | Text 1.4.3: passes; graphic also clears 1.4.11 arithmetic |
| Lens B shipped cyan `#43d7ff` | 1.56 | 1.69 | 1.61 | Fails text and essential-graphic screens on light surfaces; **REJECT for light roles** |
| Lens B graphic `#0098c0` | 3.10 | 3.34 | 3.05 | Just clears 3:1 graphic arithmetic; **not valid for ordinary text**; narrow margin |
| Lens B text `#00718f` | 5.16 | 5.56 | 4.97 | Clears 4.5:1 normal text arithmetic on these sampled surfaces |
| Seven preview badge labels (`#16222f`) over their translucent category tints | — | measured per badge | — | Browser-composited results range 14.38–15.15:1; all exceed normal-text 4.5:1 |

These are measured/computed preview surfaces, not a universal AA claim. The B graphic candidate’s 3.05:1 on its own 8% tint has only 0.05 margin and does not establish contrast across varying tile pixels, antialiasing, other overlays or focus states. The real app’s halo text has a dark outline, but that does not let a flat calculation certify visibility. Grayscale supports structural inspection only; it is not accessibility evidence on its own.

## 4. Candidate decisions and trade-offs

| Option | Classification | Reason |
|---|---|---|
| Shipped dark appearance (`A #f7fbff`, `B #43d7ff`) | **ACCEPTABLE CANDIDATE** as the current dark reference | Audit arithmetic reports strong contrast on the shipped near-black surface; retain as the reference arm |
| Navy Lens A `#123b5f` on simulated light | **ACCEPTABLE CANDIDATE** | Strong normal-text/graphic contrast and reuse of the current Light-basemap A hue; A/B remain in related blue families, so review map/UI separation carefully |
| Graphite Lens A `#343a40` on simulated light | **ACCEPTABLE CANDIDATE** | Similar light-surface contrast with more hue separation from cyan B; may weaken A’s established cool-blue identity and read as generic chrome |
| Lens B shipped cyan `#43d7ff` on simulated light | **REJECT** for panel text and essential graphics | Measured panel contrast 1.69:1; the light-surface role is visibly washed out |
| Lens B `#0098c0` | **ACCEPTABLE CANDIDATE** for essential graphics only; **REJECT** for normal text | 3.05:1 even on its simulated 8% tint; the candidate cannot be promoted from 3:1 graphics arithmetic to ordinary text use |
| Lens B `#00718f` | **ACCEPTABLE CANDIDATE** for normal text and graphics on sampled UI surfaces | 4.97:1 on its own tint and 5.56:1 on the panel; darkening reduces grayscale separation from A (about 2.06:1 pairwise), so preserve visible “Lens A/B” labels and solid/dashed distinction |
| Existing category tint fills with shared dark badge text `#16222f` | **ACCEPTABLE CANDIDATE** for review | All seven preview badge classes measured ≥14.38:1 after compositing. Tint, border and explicit wording keep their source-state/category role; review if badge fill alone was carrying information |
| Phase A same-hue category graphic candidates | **REVISE** per real consumer | The audit’s values clear only a flat 3:1 screen. Use only for an essential mark after actual surface and neighboring-category review; keep text label color separately chosen |

The A options have nearly equal luminance and become nearly indistinguishable from each other in grayscale. They are alternatives, not simultaneous categories. A vs. B with the lighter B graphic candidate separates better than A vs. the darker text B, but the retained labels and dash cue prevent the visual system from relying on hue alone.

## 5. Ownership boundaries and source-value shortlist

- **CSS:** `--a` is currently unused; `--b` has only three uses. Multiple live identities bypass tokens (`#eef5fc`, `#e9f1fb`, `#43d7ff`, `#74e3ff`, `#9ccdff`). A future patch needs role tokens for Lens A/B text, graphic strokes, active-button text/border/tint and badge foreground/tint/border, then must migrate each listed selector. Do not alias badge status colors to Lens colors.
- **JS/SVG:** `HALO_GLYPH_COLORS` supplies inline `--halo-color` values to each SVG; `.marker-a/.marker-b` CSS colors map center markers. These are appearance-facing map marks in the T-a3 evidence set. If changed, CSS and JS must share role values; check text/stroke, outline, zero and abstain symbols across all three basemaps. `LAYER_COLOR` separately owns category circle-marker colors; retain each layer’s mapping and heat class semantics. Its light graphic shortlist from audit §6.2 is museum `#9d72ff` (unchanged arithmetic pass), info `#ab6aff`, stay `#028dff`, bike `#1b9e75`, rail `#b98200`, pedestrian `#ff3f79`, park/green `#259f5f`, hospitality `#bd5fff`, heat `#d17500`; licence neutral `#c0794f` also passed the audit’s flat graphic screen. These are **graphic-only candidates**, not validated map values or text colors.
- **Planning:** `--planning-neutral #aeb8c4`, `--planning-origin #c4b8cf` and `--planning-unresolved #bdb7aa` remain separate from Lens identity. If appearance work reaches those rendered marks, audit §6.2’s graphic-only candidates are neutral `#7e8da1`, origin `#9984ac`, unresolved `#958b77`. Keep source words, no-order interpretation, and solid/dashed/dotted structure exactly intact.
- **Basemap:** `LENS_BASEMAP_STYLES` controls Lens boundary/fill appearance for Light, Satellite and Dark. It and Leaflet provider controls, map geometry and unrelated map colors are explicitly excluded from T-a3. A theme may not silently overwrite that owner.

Shortlist by rendered role: current near-white A for shipped dark; navy or graphite A for light UI text; B `#00718f` for normal light-surface text; B `#0098c0` only as an essential-graphic candidate; original category hues on dark; audited same-hue graphic candidates only where the concrete mark’s applicable criterion and appearance are reviewed. No one hex is approved for every consumer.

## 6. Approved bounded T-a3 implementation scope

Keep the separate implementation patch to:

1. `css/app.css`: role tokens for evidence-badge text/neutral background/border; Lens A/B text and UI graphics; and Comparison Bridge A/B identifiers and controls. Migrate only those owned consumers. Store approved Light role values without adding a switch or activating Light. Preserve the shipped Dark computed values exactly.
2. For appearance-facing SVG/halo and center-marker consumers, keep CSS and `HALO_GLYPH_COLORS` on the same role architecture. Apply approved light graphic values only to consumers that pass their own rendered contrast and visibility gates across Light, Dark and Satellite map contexts; unsupported consumers retain their existing values and are listed in the validation report. Do not change halo geometry, calculations, labels, opacity, dash or rendering states.
3. Preserve category assignments and hues, `LENS_BASEMAP_STYLES`, map boundaries/geometry, basemap tiles, Leaflet controls, calculations, evidence states/values, provenance and planning interpretation. Do not add an Appearance switch or activate Light/Dark/System.

The original candidate arithmetic and preview screenshots remain unchanged. The separate implementation must report per-consumer rendered results, retain `#0098c0` only where validated, and keep labels plus Lens A solid / Lens B dashed as redundant identifiers. No T-a4 or appearance-switching work is included.
