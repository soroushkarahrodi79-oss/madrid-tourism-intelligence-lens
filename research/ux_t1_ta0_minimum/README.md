# UX-T1 T-a0 — Minimum visual baseline

Status: **GO for the bounded shared-chrome baseline; this is not the lost historical 1,286-consumer package.** Prepared as evidence for issue [#102](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/issues/102). The original T-a0 CSV/JSON, capture harness, computed-style report and 27 screenshots were unavailable. No historical measurements were recreated.

## Baseline identity

- Application source: `028d0389454b4248180654075022e4397b14fd5b` (`origin/main`).
- Deployed source: same SHA; the passing production manifest was generated `2026-10-19T22:33:23.154Z`, workflow run `39335736493`.
- Production POI snapshot: [deployment runtime_poi.json](https://soroushkarahrodi79-oss.github.io/madrid-tourism-intelligence-lens/data/runtime_poi.json), SHA-256 `981449c5b52fac59835a826f89d163eae99d13a042a72acb80bcdc08acb88a70`, 390,017 bytes. The current published manifest is [deployment_manifest.json](https://soroushkarahrodi79-oss.github.io/madrid-tourism-intelligence-lens/data/deployment_manifest.json), SHA-256 `bdbc5c1c85f9d9f47893b7444b824921a42245dfd3d0be362bb648be39006133`.
- The POI snapshot has six layers and 1,556 records total; 1,470 are operational-layer records and 86 are park context. It was generated in the deployment workflow and is deliberately Git-ignored. The capture script checks both the manifest and POI digest before writing it to `data/runtime_poi.json`; it does not add that generated file to Git.
- The Pages artifact URLs are mutable and may be replaced by a later deployment. The workflow audit artifact is retained for 30 days; it is not the durable copy of this package. The committed screenshots, manifest, computed styles and script below are durable in this repository.

## Captures

Nine full-viewport PNGs are in [`screenshots/`](screenshots/), totalling approximately 7.9 MiB. `screenshot-manifest.json` records each SHA-256, viewport, device scale, UI language, mode, basemap, data label, relevant controls and interaction sequence.

1. Desktop PLACE, Light basemap, English.
2. Desktop COMPARE, Light basemap, English; opens Detail and selects a metric so both Lens A/B labels are rendered in view.
3. Desktop Evidence & limits drawer, Spanish; language and disclosure reached through their visible controls.
4. Tablet COMPARE, Dark basemap, English.
5. Mobile PLACE, Light basemap, English.
6. Mobile Layers expanded; Dark basemap selected in the visible Layers UI.
7. Desktop Satellite, operational markers, district outlines and Principal parks context enabled.
8. Keyboard focus on the native Comparison halo checkbox after Tab navigation from COMPARE; no script `focus()` call.
9. PLACE with Lens A dragged through the visible draggable marker to an interior point of official `APE.03.06 / JERÓNIMOS` geometry. The application rendered the resolved planning state.

The basemap imagery/labels are served by live OSM/CARTO/Esri tile providers and are not version-pinned. The app source and POI data are pinned and checked; tile pixels can change independently.

## Computed styles and ownership

[`computed-styles.json`](computed-styles.json) contains browser-computed values separated from screenshot pixels. It covers body, header surface, rail, analysis panel, native evidence drawer and backdrop, Lens A/B labels, representative register badge, and the keyboard-focused halo checkbox. `.badge.snapshot` is absent because the production deployment snapshot loaded successfully; no fallback was forced into view. A hidden `.badge.observed` node is recorded as not visible in the selected COMPARE state.

[`consumer-ownership.json`](consumer-ownership.json) is a bounded source-derived ownership map for the T-a1 decision. Shared page chrome, evidence badges/identity, basemap-aware marks and focus treatments remain separate owners. It does not claim to replace the unavailable full colour-consumer inventory.

No screenshot or computed value claims WCAG conformance. Screenshot similarity, computed-style parity and accessibility conformance are separate checks.

## Focus finding

**HISTORICAL ANOMALY — NOT REPRODUCED.** In headless Chromium `153.0.8010.12`, with the isolated source at the baseline SHA and the deployed runtime configuration proxied in memory, real Tab navigation from the COMPARE mode control reached `#haloToggle`. It matched `:focus-visible`; computed outline was `2px solid rgb(155, 213, 255)`, offset `2px`, with the authored 1px box-shadow ring. No styles were injected. The earlier 3px `currentColor` observation remains unexplained because its original target and harness are lost. Broader browser and native-control investigation belongs to T-a2; cross-browser follow-up is deferred to T-a2 (and T-a2’s broader matrix remains separately gated).

## Reproduction

Run the utility from a checkout of the T-a0 evidence branch, while serving the application from a separate, clean worktree at the pinned baseline SHA. The script itself is not present at the application baseline SHA. `npm ci` and Playwright run in the evidence-branch checkout; `TA0_APP_ROOT` points the server at the baseline application worktree. The utility verifies the application worktree `HEAD` and rejects tracked changes, then checks the deployment manifest and POI hashes before staging any replacement evidence. It proxies the public runtime configuration in memory without printing or storing it. All screenshots and JSON outputs are written to a fresh staging directory and replace the current package only after every capture succeeds; promotion uses same-directory renames with rollback on failure. Existing generated POI data is reused only when its digest matches, otherwise it is preserved and the run stops.

```powershell
git fetch origin main
git worktree add --detach ..\madrid-ta0-source 028d0389454b4248180654075022e4397b14fd5b
npm ci
npx playwright install chromium
$env:TA0_APP_ROOT = (Resolve-Path ..\madrid-ta0-source).Path
node research/ux_t1_ta0_minimum/capture_baseline.mjs
Remove-Item Env:TA0_APP_ROOT
```

Run these commands from the checkout of the T-a0 evidence branch. If the named baseline worktree already exists, verify its exact SHA and clean tracked state, then reuse its path rather than replacing it. The capture command fails closed if the deployed source SHA, deployment-manifest hash, build state, or POI hash changes. A later Pages deployment may therefore require a newly reviewed baseline rather than silently substituting data. The generated `data/runtime_poi.json` is written only to the ignored baseline-worktree path and must not be committed.

To verify the checked-in screenshot hashes without recapturing:

```powershell
node --input-type=module -e "import fs from 'node:fs';import crypto from 'node:crypto';const m=JSON.parse(fs.readFileSync('research/ux_t1_ta0_minimum/screenshot-manifest.json'));for(const s of m.screenshots){const b=fs.readFileSync('research/ux_t1_ta0_minimum/'+s.file);const h=crypto.createHash('sha256').update(b).digest('hex');if(h!==s.sha256)throw Error('hash mismatch: '+s.file)}console.log(m.screenshots.length+' screenshot hashes verified')"
```

## Gate

**Verified for T-a1 shared chrome:** desktop/page chrome, rail, panels, generic surface styling, Lens A/B identities as observed, a real data snapshot and exact source/build match. The T-a1 scope follows the Phase A audit §10: header, rail/panels, generic cards/surfaces, generic typography, borders and form chrome, preserving the existing dark computed values.

**Not authorized or established here:** theme implementation; WCAG conformance; Safari/WebKit or real-device behavior; every responsive state; fallback-only badges; all 1,286 historical color consumers; every map overlay or evidence disclosure. Per the audit, the evidence drawer and focus-token migration are T-a2, badge and Lens identity migration is T-a3, and Leaflet/map chrome is T-a4. T-a1 must stay within its stated shared-chrome scope.

T-a0 acceptance: **GO for this minimum package and the bounded T-a1 shared-chrome scope.** T-a1 shared chrome: **GO**, conditional on its own dark computed-style parity checks and reviewer approval of its selector diff. No later phase may treat absent fallback states, unrendered evidence badges, or the unexplained historical focus result as validated.
