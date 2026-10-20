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
