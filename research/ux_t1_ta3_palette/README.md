# UX-T1 T-a3 rendered palette evidence

Bounded evidence package for issue [#102](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/issues/102). The screenshots are **SIMULATED DESIGN PREVIEWS**. The capture script adds review-only CSS and sample badge markup to the deployed page in one Playwright tab; it changes no repository production asset, page state, data or saved browser preference. It refuses a different Pages commit, deployment-manifest digest or POI digest.

## Pinned inputs

- App and Pages source commit: `216cfbd3549c5d9575da0e89013f8e4a95f7fe5b`.
- Deployment manifest SHA-256: `104bace30bc747f1dd9eb9d4c2bfa8ac060fc411a3fedd33f727e8208e7f61e2`.
- Deployment POI snapshot SHA-256: `a482ba871adcfd195167bde82a0609b62377c82cd69c59bf7a3366687c10a68b` (`deployment-snapshot`).
- Preview CSS leaves the `LENS_BASEMAP_STYLES` runtime table unchanged.

## Contents

- [`capture_preview.mjs`](capture_preview.mjs) — pin checks, Playwright rendering, badge composite sampling and metadata output.
- [`capture-current/capture-metadata.json`](capture-current/capture-metadata.json) — exact input hashes, per-image SHA-256/dimensions, browser-computed panel surfaces, candidate contrast arithmetic and seven preview-badge measurements.
- [`capture-current/screenshots/`](capture-current/screenshots/) — eight compact reference/candidate images: two shipped-dark references, four palette/map-context comparisons and one grayscale A/B check.
- [`docs/UX_T1_TA3_DECISION.md`](../../docs/UX_T1_TA3_DECISION.md) — ownership ledger and design-gate recommendation.

## Reproduce

From the repository root in the PR #107 checkout (`codex/ux-t1-ta3-decision-gate`):

```powershell
npm ci
npx playwright install chromium
node research/ux_t1_ta3_palette/capture_preview.mjs
```

The script verifies the published source commit, build state, exact manifest SHA-256 and exact POI SHA-256 before it launches the browser. It stages a full package in a fresh `.capture-stage-*` folder, copies the two unchanged dark references, and recaptures only simulated images 03–08. It verifies all eight PNG signatures, dimensions, sizes and hashes plus the package metadata before promoting. The previous `capture-current/` remains untouched if fetching, rendering or validation fails. Promotion keeps a recoverable backup; if interrupted between renames, the next run restores that backup before proceeding. Stale staging folders are removed only after the current package validates.

The Pages artifact URL is mutable; a later deployment requires a deliberately reviewed update to the pins and new captures. Screenshots include live third-party basemap tiles, so tile imagery can change even when application/data pins still match. The simulated overrides cover T-a3 identity consumers only. Leaflet attribution, zoom and tooltip styling remain exactly as shipped and are not overridden; the `LENS_BASEMAP_STYLES` table and geometry remain unchanged.
