# UX P2 — audit, implementation and Chromium evidence

Audit date: 21 October 2026. Baseline: `origin/main` at `efc61d9` (merge of PR #120). Implementation branch: `ux/ux-p2-evidence-lens`.

## Preflight

- PR #119 and PR #120 were merged into `main`; the final `Test` and `Deploy to GitHub Pages` runs for `efc61d9` completed successfully.
- PR #113 (Discover V2) was merged. There were no open pull requests at audit time; the open issues were #102 and #114.
- Earlier responsive work (#100/#119/#120), map chrome, PLACE/COMPARE/CITY, evidence drawer, panel resizing, and the six-group layer rail were reviewed before implementation.
- `comparisonBridge` is the shipped Comparison Bridge V1 from PR #58. It is an in-panel focused reading driven by the same authoritative comparison states as the halo and table. PR #58 explicitly excluded a map card and connector line. It was present, not hidden or lost; its direct activation was hard to discover on touch because the available inputs were halo marks or metric buttons inside the collapsed full table.

## Chromium audit

Playwright Chromium was measured at 320×568, 360×800, 390×844, 430×932, 768×1024, 1024×768, 1366×768 and 1440×900. Phone contexts used touch/mobile emulation; 768 used touch; wider viewports used a desktop pointer. The complete measurements are in [`before/measurements.json`](before/measurements.json) and [`after/measurements.json`](after/measurements.json).

Baseline findings:

1. **P2 — Comparison discoverability.** The Bridge model and UI were correct, but a touch user had no direct compact metric picker. The full Bridge was reachable and readable, yet activation depended on discovering halo marks or opening Detail and its full table.
2. **P2 — Cross-mode continuity.** The panel used one shared `scrollTop`. Switching modes after reading deeply could place the next mode at an unrelated vertical offset, hiding its lead answer. Returning also lost the reader's previous position.
3. **P2 — Desktop resize affordance.** Resizing worked with pointer and keyboard, but the handle's hit area was 22×22 px and visually quiet. This undercut the requested 44 px interaction floor for touch-capable laptops and made the capability hard to find.

Healthy baseline behavior retained:

- No document-level horizontal overflow at any audited width.
- Phone map-first layout keeps the complete six-group rail behind a 44 px Layers control; Escape and outside dismissal preserve layer state.
- At 768 px the map remains the main surface and the bottom panel occupies about 42% of the viewport; desktop widths retain independent map, rail and resizable analysis panel columns.
- Leaflet zoom controls and provider attribution remain visible. Attribution links are intentionally exempt from application-wide 44 px sizing so legal credits do not become a large map obstruction.
- The evidence drawer is reachable in COMPARE, modal, scrollable and closable with a 44+ px control.

## Implemented P2 corrections

1. Added an ES/EN, keyboard- and touch-operable four-metric picker to the existing Comparison Bridge. It calls the existing focus/lock function; it adds no value, score, calculation, result or scientific contract.
2. Added independent PLACE, COMPARE and CITY panel scroll memory. First entry starts at the lead answer; returning restores the reader's prior position in that mode.
3. Expanded the desktop resize handle to a 44×44 px target while retaining drag, arrow-key resizing, persistence and double-click/Home reset behavior.

## Before / after evidence

| Viewport | PLACE before | PLACE after | COMPARE before | COMPARE after |
|---|---|---|---|---|
| 320×568 | [before](before/320x568-place.jpg) | [after](after/320x568-place.jpg) | [before](before/320x568-compare.jpg) | [after](after/320x568-compare.jpg) |
| 360×800 | [before](before/360x800-place.jpg) | [after](after/360x800-place.jpg) | [before](before/360x800-compare.jpg) | [after](after/360x800-compare.jpg) |
| 390×844 | [before](before/390x844-place.jpg) | [after](after/390x844-place.jpg) | [before](before/390x844-compare.jpg) | [after](after/390x844-compare.jpg) |
| 430×932 | [before](before/430x932-place.jpg) | [after](after/430x932-place.jpg) | [before](before/430x932-compare.jpg) | [after](after/430x932-compare.jpg) |
| 768×1024 | [before](before/768x1024-place.jpg) | [after](after/768x1024-place.jpg) | [before](before/768x1024-compare.jpg) | [after](after/768x1024-compare.jpg) |
| 1024×768 | [before](before/1024x768-place.jpg) | [after](after/1024x768-place.jpg) | [before](before/1024x768-compare.jpg) | [after](after/1024x768-compare.jpg) |
| 1366×768 | [before](before/1366x768-place.jpg) | [after](after/1366x768-place.jpg) | [before](before/1366x768-compare.jpg) | [after](after/1366x768-compare.jpg) |
| 1440×900 | [before](before/1440x900-place.jpg) | [after](after/1440x900-place.jpg) | [before](before/1440x900-compare.jpg) | [after](after/1440x900-compare.jpg) |

Additional phone evidence includes `*-layers.jpg`; 390×844 also includes `*-evidence.jpg`. The capture runner is [`scripts/ux-p2-capture.mjs`](../../../scripts/ux-p2-capture.mjs).

These are browser-emulation artifacts, not physical-device, human-usability, assistive-technology or WCAG-conformance results.

## Discover V2 integration review

- The published `/madrid-tourism-intelligence-lens/discover/`, root application and a representative shared-query URL returned HTTP 200 during the audit.
- The existing Discover Playwright suites passed at 320, 390, 768 and 1440 px. They verify project-subpath routing, CTA navigation to the root app, root CSS/JS/data requests, hash retention, keyboard lens movement, mobile reading order, reduced motion and no horizontal clipping.
- The landing clearly separates its conceptual illustration from real measurements and routes readers to the application for data, sources and limits.
- No Discover code was changed in this P2.

Discover V3 recommendations:

- Add automated accessibility scanning plus manual screen-reader and zoom/reflow review; current tests are structural, not conformance evidence.
- Measure Core Web Vitals on the published route and decide whether optional GSAP/ScrollTrigger should be self-hosted. Content and interaction already degrade without the CDN, but the external request remains a performance/privacy dependency.
- Validate CTA analytics and comprehension with real institutional/academic users before changing hierarchy or copy.
- Recheck the phrase about how Madrid “changes/transforms” against the exact temporal coverage shown in the app so the landing never implies broader longitudinal evidence than the product provides.

## Validation limits

Local validation on the implementation commit candidate:

- Node: **1,029 / 1,029 passed**.
- Python: **501 executed, OK; 8 skipped**.
- Playwright Chromium: **263 / 263 passed**.
- Discover-focused Chromium subset: **8 / 8 passed**.
- `git diff --check`: clean.

The automated audit used Chromium emulation and the local static tree, plus HTTP checks against GitHub Pages. It does not claim Safari/iOS, Firefox, physical-device touch, human comprehension, screen-reader behavior or full WCAG conformance.
