# UX-T1 T-a1 — shared-chrome colour roles

**Verdict: GO for this bounded T-a1 increment.** This is a value-preserving refactor of shared application chrome. The computed-style comparison is exact; screenshot comparison includes one localized five-pixel difference documented below. It does not introduce an Appearance selector or change any scientific, evidence, category, map, focus, or typography-scale contract.

## Source and data identity

- Verified `origin/main` base: `028d0389454b4248180654075022e4397b14fd5b`.
- Shared-chrome implementation commit: `111ce56022542610d9a7ec7eb4a770b078ec0192`.
- `css/app.css` SHA-256: `ca32202595a3ec20b00f8b3b47caec16f6939eac41cc744a303fdfed527f8a9f`.
- Deployed manifest SHA-256: `bdbc5c1c85f9d9f47893b7444b824921a42245dfd3d0be362bb648be39006133`, source commit `028d0389454b4248180654075022e4397b14fd5b`, build state `pass`.
- Production POI snapshot SHA-256: `981449c5b52fac59835a826f89d163eae99d13a042a72acb80bcdc08acb88a70` (1,556 records). It was fetched and hash-checked; the browser comparison served it from memory. No data file was committed or modified.
- Browser: headless Chromium `153.0.8010.12`, device scale 1. Same viewport, locale, deployed runtime configuration, source-data snapshot and interactions on the baseline and candidate sides.

## Production diff

The only production file changed is `css/app.css`. The migrated selector groups are:

- `body`, `.brand`, `.brand-sub`
- `.left`, `.panel`, `.left h3`, `.panel h3`, `.rail-group > summary`, `.map-display`, `.mobile-layers-button` and its expanded state
- map/basemap/language/stay-filter labels and select surfaces
- `.panel-head`, `.mode-nav`, base `.mode-btn`
- generic `.card`, `.card-title`, `.controlbox`, `.controltop` and `.controltop b`
- `.header-tools select`

The new `--chrome-*` properties name the existing values for page/header/panel/card/form surfaces, primary and metadata text, section and control text, borders, dividers, and the mobile Layers control's closed/open surfaces. Their values are recorded in `css/app.css`; none changes the value of an existing token. No broad literal replacement was used.

Tokens introduced and their current dark resolution:

| Token | Resolved value |
|---|---|
| `--chrome-page-background` | `#08101a` (`var(--bg)`) |
| `--chrome-header-surface` | `rgba(6, 12, 21, .90)` |
| `--chrome-panel-surface` | `rgba(8, 16, 27, .92)` (`var(--panel)`) |
| `--chrome-card-surface` / `--chrome-control-group-surface` | `rgba(255,255,255,.02)` / `rgba(255,255,255,.03)` |
| `--chrome-form-surface` | `#0c1826` |
| `--chrome-text-primary` / `--chrome-text-metadata` | `#f3f7ff` / `#9fb1c5` |
| `--chrome-text-brand-subtle` / `--chrome-text-section` | `#94a7bc` / `#788ba2` |
| `--chrome-text-control-label` / `--chrome-text-control-value` | `#6f849b` / `#d9e4ef` |
| `--chrome-text-control-caption` / `--chrome-text-control-strong` / `--chrome-text-card-title` | `#adbdce` / `#fff` / `#aab9ca` |
| `--chrome-border` / `--chrome-divider` | `rgba(255,255,255,.10)` (`var(--line)`) / `rgba(255,255,255,.07)` |
| `--chrome-mobile-control-border` / `--chrome-mobile-control-surface` / `--chrome-mobile-control-text` | `rgba(142,164,187,.36)` / `#0b1a29` / `#e4f2ff` |
| `--chrome-mobile-control-open-border` / `--chrome-mobile-control-open-surface` | `#6fbaff` / `#12304a` |

Evidence and category badges, the Lens A/B palette and SVGs, `LENS_BASEMAP_STYLES`, focus treatments, the evidence drawer, Leaflet/map-specific chrome, and domain-specific hospitality controls remain unchanged. K5 type tokens, font sizes, spacing/radii, DOM, scripts, data and calculations are unchanged.

## Computed-style parity

[`computed-style-parity.json`](computed-style-parity.json) contains baseline and candidate computed values, visibility and boxes for **31 selector groups × 40 properties** across desktop PLACE, desktop COMPARE with visible A/B labels, tablet COMPARE/Dark and mobile Layers/Dark. It also samples protected register badge and Lens A/B selectors. All four states report equal computed values and geometry; each has an empty differences list. This verifies the tested Chromium states, not every possible DOM state or browser.

## Screenshot comparison

[`screenshot-comparison.json`](screenshot-comparison.json) records candidate screenshot hashes and references to the matching T-a0 captures in [PR #104](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/pull/104). Four candidate screenshots are retained here. Exact RGB pixel comparison to the T-a0 PNGs is recorded in [`screenshot-pixel-diff.json`](screenshot-pixel-diff.json): desktop COMPARE, tablet COMPARE/Dark and mobile Layers/Dark are pixel-identical. Desktop PLACE differs at five pixels in a 4×3 px area inside the translucent analytical panel; header and rail crops are exact. The cause of those five pixels cannot be isolated from the screenshot. Computed values and geometry match, and no meaningful visual regression was observed. This is not a claim that screenshot pixels are generally deterministic: map tiles and rasterization can vary.

## Verification performed

- `node --test --test-concurrency=1 tests/*.test.mjs` — **1,011 passed, 0 failed**.
- `node --test --test-concurrency=1 browser-tests/visual-language.browser.mjs browser-tests/information-architecture.browser.mjs browser-tests/ambito-comparison.browser.mjs` — **59 passed, 0 failed**. This includes K5 contrast/type floor, coarse-pointer target, focus, reduced-motion, phase fixture, and responsive states from 360px through 1440px.
- `node --test --test-concurrency=1 browser-tests/radial-halo.browser.mjs` — **69 passed, 0 failed**; Lens and halo identity regression coverage.
- Same-run Chromium comparison against the clean baseline worktree — **31 selector groups × 40 properties equal** across the four named states; zero page errors.
- Screenshot pixel comparison against the committed T-a0 captures: three exact; desktop PLACE has the five-pixel localized difference described above.
- `git diff --check` — passed.

No screenshot or computed-style result establishes WCAG conformance. No Safari/WebKit or real-device checks were run. The work is limited to shared chrome and does not validate T-a2 focus/drawer work, T-a3 evidence/category identities, or T-a4 Leaflet/map chrome. No theme switching or text scaling was implemented.

## Reproduce the browser comparison

From a checkout of the T-a1 branch, install the repository's existing Playwright dependency and Chromium. Create a separate clean worktree at the exact base SHA. Set `TA1_OUTPUT_DIR` to a new empty directory to keep a rerun separate from this checked-in evidence package.

```powershell
git fetch origin main
git worktree add --detach ..\madrid-ta1-base 028d0389454b4248180654075022e4397b14fd5b
npm ci
npx playwright install chromium
$env:TA1_BASE_ROOT = (Resolve-Path ..\madrid-ta1-base).Path
$env:TA1_OUTPUT_DIR = (Join-Path $env:TEMP ("madrid-ta1-comparison-" + [guid]::NewGuid().ToString("N")))
node research/ux_t1_a1_shared_chrome/compare_baseline.mjs
Remove-Item Env:TA1_BASE_ROOT
Remove-Item Env:TA1_OUTPUT_DIR
```

The comparison utility fails closed if the deployment manifest, build state, POI snapshot or baseline worktree SHA differs. It serves the production POI object and live runtime config from memory. Output files are written only to the explicitly supplied output directory.
