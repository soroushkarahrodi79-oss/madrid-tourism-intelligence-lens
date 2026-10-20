# Landing V1 — isolated review gate (20 Oct 2026)

## Decision
Review a self-contained bilingual ES/EN landing at `/discover/` without replacing the existing `/index.html` Lens application or changing the underlying scientific contracts.

## Verified inspiration
- `naplesblue/apple-design-skill`: cohesive surfaces, restrained glass, typography and whitespace. It is a design skill, **not** a runtime component dependency.
- `opengeos/GeoLibre`: inspiration for map storytelling and spatial hierarchy, **not** an instruction to import GeoLibre or replace the current Leaflet runtime.
- React Bits, GSAP and Lenis are optional later experiments after design and performance approval. None is claimed to be installed in this prototype.

## Current draft
- `discover/index.html`: standalone static HTML/CSS/JS, no external assets or JS dependencies.
- Independent navigation, working bilingual ES/EN copy controls and keyboard-operable PLACE / COMPARE / CITY tabs.
- Conceptual A/B map graphic; **not a real Madrid basemap, live dataset, measurement or screenshot from the app**.
- Explains geography, comparability, provenance and what the official evidence cannot establish.
- CTA links relatively to `../`, preserving GitHub Pages subpath compatibility.
- Existing app, shareable URLs and evidence export are unmodified.

## Required review before merge
1. Actual desktop and mobile browser screenshots at 1440px, 768px and 390px; check overflow, contrast, type and usable touch targets.
2. Check nav, CTA, ES/EN switching, three tabs, keyboard arrows/Home/End, and screen-reader labels.
3. Verify every product statement against README, current app and scientific contracts; do not add invented data.
4. Test slow network / reduced-motion / low-power device. Only experiment with GSAP, Lenis and React Bits behind a separate performance gate; avoid unnecessary JS.
5. Confirm GitHub Pages /discover/ routing on staging and preserve root app + all stateful exported/share links.
6. Independently reconcile PR #111 (Light/Dark/System) before considering a common theme layer.
7. Explicit user approval of visual concept and home-route strategy before changing root navigation.

## QA evidence so far
- XML/HTML parsing and JS syntax checks pass locally.
- Browser-based screenshots and interactions **not verified**: container Chromium blocked both file:// and localhost HTTP with ERR_BLOCKED_BY_ADMINISTRATOR.
- This is therefore a **DRAFT / HOLD for merge**, not a production-ready landing.
