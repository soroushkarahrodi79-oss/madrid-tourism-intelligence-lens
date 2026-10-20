# UX-T1 T-a3 — approved identity implementation

Status: **GO for review as a bounded Draft PR.** This implements the owner-approved Light UI identity roles without activating Light, adding an appearance switch, or changing the shipped Dark appearance. The conditional map graphics remain on their current values pending per-consumer tile validation.

Canonical issue: [#102](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/issues/102). The human decision is recorded in the documentation-only Draft [PR #107](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/pull/107), head `a17884afbd721cddde843884ab04cce20508db28`. Implementation base: `216cfbd3549c5d9575da0e89013f8e4a95f7fe5b`.

## Approved roles and consumers

| Role | Prepared Light value | Consumers |
|---|---|---|
| Evidence badge text | `#16222f` | Seven evidence badge kinds |
| Evidence badge neutral surface / border | `#f2f4f7` / `#c7ced7` | Same badge kinds; their source wording and status remain unchanged |
| Lens A text / UI graphic | `#123b5f` | Lens labels, active control, A identifiers and comparison bars |
| Lens B text | `#00718f` | Lens labels, active control, B identifiers |
| Lens B UI graphic | `#0098c0` | Comparison identifiers, borders and bars after UI-surface contrast checks |

Lens A uses a solid identity and Lens B a dashed identity in the prepared controls and comparison identifiers. Default Dark role values retain the exact existing per-consumer colors. The production document does not set `data-appearance`; the browser test sets it only inside its isolated page to exercise the dormant Light roles.

## Production diff

- [`css/app.css`](../css/app.css): introduces T-a3 role variables for each existing dark badge value, neutral Light badge roles, Lens A/B text and control roles, comparison A/B graphics, and separate map center/halo roles. Migrates the owned badge, Lens UI and comparison selectors. The Light selector prepares only these roles; it does not style the rest of the application as a theme.
- [`js/app.js`](../js/app.js): removes `HALO_GLYPH_COLORS` and the inline `--halo-color` injection. SVG halo color now resolves from CSS-owned map role variables, so JS cannot override the role architecture. Geometry and the inline thickness value are unchanged.
- [`package.json`](../package.json) and [`browser-tests/ta3-identity.browser.mjs`](../browser-tests/ta3-identity.browser.mjs): register the bounded identity regression in the existing Playwright suite.

The diff does not change `LENS_BASEMAP_STYLES`, `LAYER_COLOR`, category assignments, POI markers, map boundaries/geometry, halo calculations/bar lengths/opacity/render states, data or provenance. No `index.html` theme control or production appearance state was added.

## Validation

| Check | Result |
|---|---|
| Dark screenshot parity against current main | Exact pixel equality (0 changed pixels) for desktop COMPARE EN 1440×900, tablet COMPARE ES 768×900, and mobile PLACE EN 390×760. The controlled comparison blocked remote tile requests in both arms; it checks application rendering, not changing raster pixels. |
| Simulated Light role matrix | 18 combinations: 390/768/1440 px × EN/ES × Light/Dark/Satellite basemap selection. The UI roles and A-solid/B-dashed structure pass; map center and halo values remain shipped in all contexts. |
| Text contrast arithmetic on simulated surfaces | A `#123b5f` on white: 11.56:1; B `#00718f` on white: 5.59:1; badge `#16222f` on `#f2f4f7`: 14.62:1. Each exceeds the 4.5:1 normal-text screen. |
| Essential UI graphic arithmetic | A `#123b5f` on white: 11.56:1; B `#0098c0` on white: 3.36:1. Both exceed the 3:1 screen on the tested UI surface. The B result does not certify every border, focus state or background. |
| Grayscale A/B distinction | Relative-luminance separation is 0.0971; explicit A/B labels remain, with A solid and B dashed. This is a structural check, not conformance evidence. |
| Map graphics | **Blocked / unchanged.** `#0098c0` was not applied to Lens center markers or radial halo SVGs. Their Light-role tokens keep the shipped center-marker white/cyan and halo `#f7fbff`/`#43d7ff` values because the existing evidence does not establish their contrast over every Light, Satellite and Dark tile pixel. `HALO_GLYPH_COLORS` is removed so any later candidate must come through CSS roles. |
| Automated suites | `node --test`: 1,011 passed, 0 failed. `npm run test:browser`: 219 passed, 0 failed, including the radial-halo regression and the new T-a3 role matrix. |

Automated contrast arithmetic does not establish WCAG conformance. Existing T-a0/T-a1/T-a2 evidence and the bounded T-a3 preview remain the basis; this patch adds no new palette audit or screenshot package.

## Gate

**GO** for this bounded implementation Draft. **HOLD** on applying `#0098c0` to map marks, on any category recoloring, and on activating or merging an appearance theme. No T-a4 or deployment work is part of this increment.
