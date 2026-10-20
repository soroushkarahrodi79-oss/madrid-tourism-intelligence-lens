# UX-T1 T-a4 — bounded map-chrome evidence

**Decision: HOLD for T-a4 production CSS.** The evidence and token proposal are ready for review; no production CSS or JavaScript is changed here. This is a bounded preparation for [issue #102](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/issues/102), which remains open and unmodified.

## Preflight

- `origin/main` and the deployed application match pinned commit `9a7d2f20debdffce0823bbca81850060069ccb4d`.
- PR [#107](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/pull/107) and [#108](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/pull/108) are merged. No other PRs were open at preflight.
- The post-merge [test workflow](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/actions/runs/39453284177) and [Pages deployment workflow](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/actions/runs/39453284122) succeeded. The [Pages deployment](https://soroushkarahrodi79-oss.github.io/madrid-tourism-intelligence-lens/) reports the pinned source SHA.
- The production manifest SHA-256 is `ee5307fbb9ed31a2ffc440b070b2e60d53861084d37b4194612bb12a8365d071`. The capture harness also verifies the deployed `index.html`, `css/app.css`, `js/app.js`, `assets/leaflet/leaflet.css`, and runtime POI hashes before taking screenshots. Full values and per-image hashes are in [`capture-metadata.json`](../research/ux_t1_ta4_map_chrome/capture-current/capture-metadata.json).
- Read Phase A audit §§2.4, 10 (T-a4), 13 in [UX_T1_APPEARANCE_THEME_AUDIT.md](UX_T1_APPEARANCE_THEME_AUDIT.md); K5 in [VISUAL_LANGUAGE.md](VISUAL_LANGUAGE.md); [T-a0 ownership evidence](../research/ux_t1_ta0_minimum/README.md); and the [T-a3 decision](UX_T1_TA3_DECISION.md), [implementation](UX_T1_TA3_IMPLEMENTATION.md), and [capture evidence](../research/ux_t1_ta3_palette/README.md). T-a0 through T-a3 remain the completed baseline; this note does not repeat the appearance audit.

## Ownership boundary

**T-a4 application-owned chrome:** the `#map` / `.leaflet-container` fallback surface; attribution surface and link colors; zoom-control surface, text, border, hover, and disabled colors; `.leaflet-tooltip` surface/text/border and its app override for the top arrow; `.area-label` A/B map-label surface, text, accent edge, and shadow. Current declarations are concentrated at [app.css:121](../css/app.css#L121) and [app.css:821](../css/app.css#L821).

**Shared focus owner:** the existing global `:focus-visible` treatment at [app.css:1115](../css/app.css#L1115) belongs to T-a2. T-a4 should reuse `--chrome-focus-ring-color` and `--chrome-focus-separation-color`, with the Light values resolved by the appearance implementation. It should not add a second map-specific focus system.

**Leaflet/provider defaults:** attribution link hover/focus underline comes from [Leaflet CSS](../assets/leaflet/leaflet.css#L424). Leaflet supplies tooltip arrows for directions other than `top`; the application only overrides `.leaflet-tooltip-top:before`. Provider attribution strings, tile labels, tile colors, and tile imagery are not application-owned. In the baseline Dark cascade, the application’s `color:#fff!important` on zoom anchors masks Leaflet’s gray disabled color.

**Outside this boundary:** basemap tiles and `LENS_BASEMAP_STYLES`; marker colors, center-marker/SVG-halo roles assigned to T-a3, geometry, panes, and map behavior. Those were not changed or rethemed. The rest of the application remains in its shipped Dark appearance during simulated Light captures.

## Minimum token proposal

Dark values below are the exact shipped values. Light values are candidates injected into the browser page only. Where a candidate misses an acceptance threshold, the table records the observed value and the minimum follow-up needed before implementation.

| Current selector / state | Owner | Existing Dark value | Proposed semantic token(s) | Light candidate | Acceptance check |
|---|---|---|---|---|---|
| `#map, .leaflet-container` fallback | App, T-a4 | `#09111c` | `--map-fallback-surface` | `#f4f6f9` | Verify a missing/transparent tile exposes this fallback without affecting loaded tiles or basemap choice. |
| `.leaflet-control-attribution` surface and text | App styling; provider supplies attribution content | `rgba(5,8,12,.75)` / `#8798ab` | `--map-attribution-surface` / `--map-attribution-text` | `rgba(255,255,255,.92)` / `#445468` | Project normal text must reach 4.5:1 on every supported basemap. Shipped Dark text is only 3.31:1 in the rendered Light-basemap sample; see contrast results. |
| Attribution links, hover, focus | App color; Leaflet underline; T-a2 focus | `#b9c7d7`; hover underlines | `--map-attribution-link`; reuse shared focus tokens | `#0a63c7`; keep underline on hover/focus | Keep link text at 4.5:1 and retain visible hover/focus. Keyboard focus was rendered in English; Spanish UI was also captured. |
| `.leaflet-control-zoom a`, hover, shadow | App overrides Leaflet control styling | `#0b1521` / `#fff` / `#25364a`; `0 8px 24px rgba(0,0,0,.24)`; effective Dark hover stays `#0b1521` | `--map-zoom-surface`, `--map-zoom-text`, `--map-zoom-edge`, `--map-zoom-hover-surface`, `--map-zoom-shadow` | Preview: `#fff` / `#16222f` / `#c7ced7`; hover `#f2f4f7`; `0 8px 24px rgba(16,24,34,.18)`. **Edge follow-up candidate:** `#7b8794`. | Text was 15.56:1 on the sampled rendered control surface. Preview edge is 1.59:1 against white; if the edge is needed to identify the control boundary, use a separate darker edge role and validate ≥3:1 over the rendered control/tile context. `#7b8794` is a swatch calculation (3.66:1 on white), not yet rendered. |
| `.leaflet-control-zoom a.leaflet-disabled` | App override; Leaflet adds disabled class | App’s `#fff!important` remains effective; Leaflet default gray is masked | `--map-zoom-disabled-text` | Preview `#667586` | A real minimum-zoom interaction applied `.leaflet-disabled` and `aria-disabled=true`. The Light candidate is 4.28:1 on the rendered hover surface, below K5’s 4.5:1 text rule; darken and recheck. |
| `.leaflet-tooltip` and top arrow | App surface/text/border; Leaflet positions and draws the arrow | `#09131f` / `#fff` / `#31465d`; `0 10px 28px rgba(0,0,0,.4)` | `--map-tooltip-surface`, `--map-tooltip-text`, `--map-tooltip-edge`, `--map-tooltip-arrow`, `--map-tooltip-shadow` | Preview: `rgba(255,255,255,.96)` / `#16222f` / `#aab6c4`; shadow `0 10px 28px rgba(16,24,34,.18)`. If the arrow’s direction is meaningful, separate candidate `--map-tooltip-arrow:#7b8794`. | Top-directed POI tooltip text sampled at 12.19:1. The preview edge is 2.06:1 against white; if the edge/arrow is an essential non-text cue, use a separately evaluated ≥3:1 role. The darker arrow candidate has not been rendered. Test only top direction here; preserve Leaflet defaults elsewhere until separately owned. |
| `.area-label`, `.area-label-b`, B badge text | App map-label chrome, T-a4; not T-a3 markers | Surface `rgba(9,18,30,.9)`, edge `rgba(178,203,228,.42)`, text `#e8f0fa`, shadow `0 6px 18px rgba(0,0,0,.45)`; B edge `rgba(67,215,255,.45)`, B text `var(--b)` = `#43d7ff` | `--map-label-surface`, `--map-label-edge`, `--map-label-text`, `--map-label-shadow`, `--map-label-b-edge`, `--map-label-b-text` | `rgba(255,255,255,.94)`, `rgba(22,34,47,.30)`, `#16222f`, `0 6px 18px rgba(16,24,34,.16)`; B edge `rgba(0,113,143,.45)`, B text `#00718f` | A B label appeared in the Light/COMPARE view. Its text sampled 5.48:1 against the rendered label-surface crop. Check both labels over each basemap; if a label edge is relied on to separate the surface from imagery, give that edge its own ≥3:1 acceptance. K5 typography and label geometry stay unchanged. |
| App controls `:focus-visible` | Shared app focus role, T-a2 | `2px #9bd5ff` outline, `3px` offset, `1px #08101a` separation | Reuse `--chrome-focus-ring-color` / `--chrome-focus-separation-color` | Preview `2px #0a63c7`, `3px` offset, `1px #f4f6f9` separation | Real zoom and attribution links received keyboard focus. Sampled ring color is 5.35:1 against the Light separation surface; preserve the shared 2px/3px treatment. |

The semantic groups above are the bounded token plan; they do not imply changing the Dark values. Geometry, spacing, control size, map position, and marker roles remain outside the change.

## Rendered validation

The Playwright harness [`capture_map_chrome.mjs`](../research/ux_t1_ta4_map_chrome/capture_map_chrome.mjs) fail-closes if the deployed manifest or pinned application assets differ. It injects only the candidate map-chrome CSS into that browser page. The basemap tiles remain live provider imagery, so each screenshot is a point-in-time tile render.

| Capture | Rendered state and interaction |
|---|---|
| [Dark reference](../research/ux_t1_ta4_map_chrome/capture-current/screenshots/01-dark-reference-desktop-en-light.png) | Desktop 1440×900, English, Light basemap, shipped Dark chrome; no injected CSS. |
| [Simulated Light / Light basemap](../research/ux_t1_ta4_map_chrome/capture-current/screenshots/02-light-desktop-es-light-zoom-tooltip.png) | Desktop 1440×900, Spanish, COMPARE mode; actual Zoom click and POI hover until the top tooltip was fully inside the map. B area label visible. |
| [Simulated Light / Dark basemap](../research/ux_t1_ta4_map_chrome/capture-current/screenshots/03-light-desktop-en-dark-attribution-focus.png) | Desktop 1440×900, English; actual Zoom click and keyboard traversal to the attribution `Leaflet` link. |
| [Simulated Light / Satellite](../research/ux_t1_ta4_map_chrome/capture-current/screenshots/04-light-mobile-es-satellite.png) | Mobile emulation 390×844, Spanish, coarse pointer; actual Layers disclosure and Satellite selection. Zoom targets measured 44×44 CSS px. |

![Dark reference: application-owned chrome on a Light basemap](../research/ux_t1_ta4_map_chrome/capture-current/screenshots/01-dark-reference-desktop-en-light.png)

![Simulated Light map chrome: Spanish desktop, Light basemap, zoomed POI tooltip, and B label](../research/ux_t1_ta4_map_chrome/capture-current/screenshots/02-light-desktop-es-light-zoom-tooltip.png)

The remaining captures above provide the Dark-basemap keyboard-focus state and mobile Satellite state. The metadata includes computed styles and hashes for all four images, plus actual hover/focus and disabled-state observations.

### Contrast samples and limits

K5 calls for 4.5:1 for normal text, 3:1 for large text and essential non-text contrast, and a rendered shared focus indicator. Contrast ratios below use the computed foreground and the modal rendered background pixel in a crop of the actual control/label surface; they are representative samples, not a certification across tile pixels.

| Rendered surface | Sampled pair | Ratio | Reading |
|---|---|---:|---|
| Shipped Dark attribution on Light basemap | `#8798ab` over `#424447` | 3.31:1 | Fails 4.5:1 for normal text. |
| Shipped Dark attribution link on Light basemap | `#b9c7d7` over `#424447` | 5.68:1 | Passes this sample. |
| Light candidate attribution on Light basemap | `#445468` / `#0a63c7` over `#fefefe` | 7.67:1 / 5.75:1 | Passes these samples. |
| Light candidate attribution on Dark basemap | `#445468` / `#0a63c7` over `#edeeef` | 6.66:1 / 4.99:1 | Passes these samples. |
| Light candidate attribution on Satellite | `#445468` / `#0a63c7` over `#fafaf8` | 7.40:1 / 5.55:1 | Passes these samples. |
| Light candidate zoom control | `#16222f` over `#fbfbfb` | 15.56:1 | Text/glyph sample passes. |
| Light candidate top POI tooltip | `#16222f` over `#dfe0e2` | 12.19:1 | Text sample passes. |
| Light candidate B area label | `#00718f` over `#fcfdfd` | 5.48:1 | One rendered B-label sample passes. |
| Light focus ring | `#0a63c7` over `#f4f6f9` | 5.35:1 | Shared focus color sample passes. |

Text colors on rendered control/label surfaces are legible in these captures. This does not establish legibility over every tile or contrast for each border/arrow. In particular, the sampled Light zoom edge and tooltip edge need a separate decision if their outlines are essential non-text cues.

## Known limits and implementation gate

- The shipped Dark attribution text misses K5 on the Light basemap sample. Because this task requires exact Dark-value preservation and appearance must not depend on basemap choice, T-a4 CSS cannot be approved until that constraint is resolved.
- The proposed Light zoom disabled text (`#667586`) measures 4.28:1 on its rendered hover surface. The Light token needs a darker value before implementation.
- The Light zoom edge (`#c7ced7`) and tooltip edge/arrow (`#aab6c4`) are below 3:1 against their Light surfaces. Whether those boundaries are essential must be decided; if essential, use appearance-specific edge/arrow roles and validate them against actual tile contexts. The suggested `#7b8794` is arithmetic-only and must be rendered before adoption.
- Bottom/left/right Leaflet tooltip arrows were not exercised; they remain provider defaults. The B label was captured only once. Live open-data tile imagery may vary between runs. Chromium desktop/mobile emulation is not physical iPad or Safari validation.
- No Phase B appearance × basemap × information-surface Cartesian matrix was run. Reserve that complete matrix for the appearance-activation gate.

**Gate:** GO for this documentation/evidence review. **HOLD for T-a4 production CSS** until the Dark attribution baseline, Light disabled-text value, and essential edge/arrow roles are resolved and rerendered. The smallest next code change should add only the resolved map-chrome semantic tokens, retain every current Dark value, reuse T-a2 focus roles, and leave basemap selection, `LENS_BASEMAP_STYLES`, tiles, markers, geometry, and T-a3 roles untouched.
