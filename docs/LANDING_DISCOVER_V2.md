# Discover V2 — interactive and editorial motion (Draft)

## Purpose and scope

Discover is an **editorial experience**, not the Lens analysis engine. This update lives inside the original Draft PR #113 and changes only the independent `/discover/` entry. It does not change application root, shared evidence URLs, source registries, numerical models, scope contracts, scientific comparisons or analytical basemaps.

### V2 improvements

- A and B **conceptual lenses** in the hero can be dragged with pointer/touch, selected by buttons or moved 12 CSS pixels per arrow key. A reset action restores the initial composition. Positions are UI coordinates and **never geospatial observations or simulated scientific values**.
- A dashed visual connection follows both circles, and a brief instruction explicitly says the interaction is not based on real measurements.
- A three-chapter **PLACE → COMPARE → CITY** editorial story demonstrates why spatial units and source limits must remain distinguishable. On desktop the explanatory illustration stays sticky while the reader scrolls; on mobile the illustration is compact and sticky.
- GSAP v3.12.5 and ScrollTrigger are **optional asynchronous CDN-based progressive enhancements**: hero entry and scene parallax, chapter transitions. If the CDN is absent, blocked or slow, native CSS + IntersectionObserver provide the full accessible content and the A/B controls still work. Native browser smooth scrolling is used; **Lenis is not included**, to avoid adding latency and complexity before user validation.
- English and Spanish are available across new explanatory content and draggable-lens labels. Native buttons provide keyboard focus and `aria-pressed` states, with an announcement on movement completion and reset.
- The old cut-off map status text is corrected.
- Reduced motion preference disables transitions and GSAP initialization. Motion preference changes after load stop ongoing GSAP motion.

## Scientific guardrails

The hero and storytelling diagram are labeled as **illustrations / no measurements**. No numbers, predictive models, change scores, simulated source records or real Madrid spatial positions are derived by this page. `PLACE`, `COMPARE` and `CITY` descriptions must not imply that a barrio, planning ámbito, circle or municipality are interchangeable. No licence implies building completion, and no descriptive comparison implies causation.

## Source/provenance and security

- Inspiration only: [Apple Design Skill](https://github.com/naplesblue/apple-design-skill) and [GeoLibre](https://github.com/opengeos/GeoLibre). Their source is not copied or bundled.
- Motion optional dependency: `https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js` and `.../ScrollTrigger.min.js`. The design must remain usable without them; the final shipping choice must review third-party script loading / integrity / vendor policy before merge.
- No analytics, data transfer, basemap fetches, framework migration, or Lenis added in Discover V2.

## Local reproducible QA

1. Run `node --check` on the extracted inline script to check JavaScript syntax.
2. In the repository root: `node --test discover/interaction.browser.mjs` (requires repository Playwright dev dependency and installed Chromium).
3. Separately test real hosting path `/discover/`, including the `../` CTA returning to the original map and preserving share/export URL states.
4. Test language toggles, keyboard activation, arrow movement, pointer/touch capture and reset at 320/390/768/1440px, then perform cross-browser and real-device reviews.
5. Verify `prefers-reduced-motion`, focus visibility, color contrast and reading order. WCAG certification is **not claimed**.

## Verified during this implementation

- Chromium in-memory browser tests at widths 320/390/768/1440: PASS for scrolling overflow, A/B dragging, keyboard movement, reset, locale changes, tab keyboard navigation, and zero JavaScript page errors, **with all external requests blocked**.
- Reduced-motion browser context: PASS.
- Hero and scrollytelling captured visually in Chromium on desktop/mobile.
- Browser-visible scroll chapter switching to COMPARE: PASS.

## HOLD before merging

- CI test execution in the repository environment remains to be verified.
- Live HTTP route / GitHub Pages preview, third-party GSAP load, network/privacy policy, actual touch hardware, keyboard/screen-reader user audits, visual contrast audit, and performance budget are **not yet independently validated**.
- Draft PR #111 remains a separate theme feature; V2 does not depend on it.

**Verdict: GO for design review, HOLD for merge/deployment.**