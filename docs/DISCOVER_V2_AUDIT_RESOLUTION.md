# Discover V2 audit resolution

## Scope and decision

This update continues Draft PR #113 from `0bd0075ae45ded3d1c07a68a8fc090195f6a117b` and incorporates `main` at `c40d6f5c2810096d7f56c570278d9a453e4ce254`. It does not merge Draft PR #112, alter the root application, or implement issue #114's in-app tutorial.

## Resolved findings

- The conceptual hero now mirrors the shipped legend: Lens A is solid navy and Lens B is dashed cyan. Both remain explicitly non-geographic, non-measurement UI objects.
- PLACE, COMPARE and CITY are described as reading modes. Their copy says that no mode makes circle, barrio, planning area or municipality interchangeable.
- The landing includes the authentic application capture `research/ux_t1_appearance/screenshots/04-desktop-compare-light.png`, with viewport, mode, language, capture date, verified-deployment proxy conditions and live-tile limitation stated beside it. The capture is linked to the real app; it is not a landing-page data claim.
- The isolated browser test now exercises `/discover/` and `/` over real local HTTP at 320, 390, 768 and 1440px. It covers ES/EN labels, keyboard and pointer lens control, reset, tab keyboard operation, reduced motion, optional-CDN blocking, no horizontal overflow and root-route navigation. It is included in `npm run test:browser`, so the existing browser CI job runs it.
- GSAP remains a bounded optional enhancement: no Lenis, React Bits or framework added. The pinned 3.12.5 assets use CDN SRI and cross-origin mode, have a 3.8-second timeout, and fail closed to CSS/IntersectionObserver behavior. Reduced motion prevents loading and clears any existing GSAP work.

## Visual evidence

- `research/ux_t1_appearance/screenshots/04-desktop-compare-light.png` — genuine application capture, 1440 × 900, COMPARE, EN, light appearance.
- `research/ux_t1_appearance/manifest.json` — provenance, SHA-256, capture conditions and limitations.

## Remaining release risk

The application capture is a browser-emulated local run with verified deployment artifacts proxied in memory; it is not a production-hosting assertion and its live tiles are not version-pinned. Touch hardware and assistive-technology user testing remain release checks. This change is suitable for draft review, not automatic merge or deployment.
