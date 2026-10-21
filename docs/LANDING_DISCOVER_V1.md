# Discover V1 — isolated landing prototype

## Intent
An institutional, bilingual editorial entry point for Madrid Urban Evidence Lens. The analysis application remains authoritative.

- **New route when deployed:** `/madrid-tourism-intelligence-lens/discover/`.
- **Existing map:** the current GitHub Pages root is unchanged. CTAs inside Discover use `../` to navigate to that map.
- **No dataset changes or real computed metrics:** the A/B circles are explicitly a **concept illustration**, not a geographic measurement.
- **Spanish and English**, PLUS keyboard-usable PLACE / COMPARE / CITY tabs.
- **No new runtime dependencies:** deliberate first prototype. GSAP, Lenis or React Bits may be considered only after product/UX review and performance measurements.

## Design references
- [Apple Design Skill](https://github.com/naplesblue/apple-design-skill) — typography, restrained material surfaces, hierarchy.
- [GeoLibre](https://github.com/opengeos/GeoLibre) — geospatial-workspace vocabulary and interaction discipline.

These are references, not imported code or dependencies.

## Verified QA in the local prototype
- `node --check` passed for inline JavaScript.
- In-memory Chromium render at desktop 1440×900 and mobile 390×844: no JavaScript exceptions or horizontal overflow.
- Tab switch and locale switch interacted successfully in both viewports.
- Static HTTP server returned 200 for `/discover/`.

## Outstanding gates
- Browser navigation to localhost was blocked by an administrator rule in the test runtime. In-memory rendering is not a substitute for a full HTTP-hosted smoke test.
- GitHub Pages deployment, real devices, WCAG review, screen-reader audit, load/performance metrics and cross-browser testing: **not yet verified**.
- A visual review of mobile/desktop content and messages is required before this PR can be merged.
- PR #111 (appearance theme) is an unrelated open Draft PR. Do not modify or assume its integration.

## Mandatory merge conditions
1. Verify `/discover/` under a suitable preview/static host.
2. Verify original application root and share/export URLs still work.
3. Check focus order, reduced motion, semantic headings, accessibility contrast, and internationalization.
4. No invalid interpretations: planning ámbito, barrio, circle and city-wide evidence remain distinct.
5. Only merge after explicit owner approval.


---

## Discover V2 — Cinematic concept prototype (2026-10-21)

V2 evolves **only** `discover/index.html`. All evidence models, map controls, data, sharing/export contracts, and main application routing remain unchanged. This landing is NOT a geospatial-analysis engine.

### Implemented

- Concept map has two keyboard and pointer-draggable Lens A/B controls. Relative screen positions only; never geocoordinates. Controls are clamped to their map window, visibly selected, keyboard-accessible with arrow keys, and have a reset action plus live status for assistive technology.
- Three editorial scroll chapters (PLACE / COMPARE / CITY) with a persistent illustrative visual on desktop and a compact mobile treatment. IntersectionObserver selects the displayed concept phase.
- Optional GSAP 3.12.5 and ScrollTrigger progressive enhancements: timed hero entrance, shallow map parallax and scroll chapter activation. Motion code loads from cdnjs only when motion is allowed, with timeout and silent nonanimated fallback. CDN policy/privacy and any required vendoring must be reviewed prior to publication.
- Full ES/EN copy for newly added sections and controls. The interface works without GSAP, React Bits or Lenis. Importing a second scrolling library would add complexity without a demonstrated benefit; React Bits has not been vendored.
- Reduced-motion styling, keyboard focus, mobile interaction, visible scientific non-measurement labels, and no fictional numeric results.

### Local validation actually performed

| Check | Result |
|---|---|
| Standalone inline JS syntax (`node --check`) | PASS |
| Chromium `page.set_content` at 1440, 768, 390 and 320 px | PASS |
| Horizontal overflow at those widths | NONE |
| Pointer drag / arrow movement / reset / active lens state | PASS |
| ES/EN switch including drag-control accessible labels | PASS |
| Roving keyboard tabs / Compare panel visibility | PASS |
| Simulated `prefers-reduced-motion: reduce` | PASS |
| Page errors with CDN network request explicitly aborted | NONE |
| Full HTTP browser navigation via localhost | BLOCKED_BY_ADMINISTRATOR (not PASS) |
| Real hardware, production hosting, visual human review, cross-browser, formal screen-reader accessibility | NOT TESTED |

### Acceptance criteria / remaining HOLD

1. Review the desktop/mobile visuals and confirm institutional tone, mobile scroll overlap and legibility.
2. Test loading the actual `/discover/` static route under a trusted preview; verify all `../` app CTAs and original deep-link state restoration.
3. Audit accessibility (keyboard, focus, voice, contrast), battery/GPU motion cost, and offline/no-CDN behavior on real devices.
4. Explicitly approve a CDN/vendor policy or ship motion locally after licence review.
5. Obtain owner approval before merge/deployment. **Current PR remains Draft.**

