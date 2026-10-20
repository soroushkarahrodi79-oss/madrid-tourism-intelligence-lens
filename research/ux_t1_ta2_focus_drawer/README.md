# UX-T1 T-a2 — Evidence drawer and focus tokens

## Identity and scope

- Base: `7f7240ee20f4bc9359df8b639902f2c0558ba185` (`origin/main` after fresh fetch).
- Latest-main Test and GitHub Pages workflows: both succeeded, run `39400080930` and `39400081056` respectively.
- Pages manifest: source SHA matches base, build state `pass`, run `39400081056`, SHA-256 `3fba497bc888312b1fd4333b362751d2edf6a3f466c143730243f2db6c9946b7`.
- Deployed `runtime_poi.json` SHA-256: `dc4f3a0b6a9b678a0d58d491e461ddf3a34375df995876627b0ab14c756308d3`.
- T-a0 minimum evidence and T-a1 shared-chrome evidence were read and reused. The previous T-a0 `#haloToggle` check used real Tab navigation in Chromium and measured `2px solid rgb(155, 213, 255)`, `2px` offset and the existing 1px dark separation shadow. The historical 3px `currentColor` report was not reproduced.

Production changes are limited to `css/app.css`. T-a2 names evidence-drawer surfaces, borders, neutral fills and structural focus colours with `--chrome-*` roles that follow T-a1 ownership. No geometry, typography, opacity, behavior, category identity, A/B identity, map SVG, Leaflet styling, data or scientific content changed.

## Tokens introduced

| Token | Dark resolution |
|---|---|
| `--chrome-drawer-surface` | `#08101a` |
| `--chrome-drawer-border` | `var(--line2)` |
| `--chrome-drawer-divider` | `var(--chrome-border)` |
| `--chrome-drawer-control-surface` | `rgba(255,255,255,.06)` |
| `--chrome-drawer-record-surface` | `rgba(255,255,255,.025)` |
| `--chrome-drawer-neutral-surface` | `rgba(255,255,255,.04)` |
| `--chrome-drawer-share-surface` | `rgba(13,24,39,.55)` |
| `--chrome-focus-ring-color` | `#9bd5ff` |
| `--chrome-focus-separation-color` | `#08101a` |
| `--chrome-focus-ring-subtle-color` | `rgba(87,184,255,.75)` |
| `--chrome-focus-inline-indicator-color` | `rgba(160,180,205,.7)` |

The drawer token roles cover `.evidence-drawer`, `.drawer-head`, drawer controls and reading buttons, record/source/interpretation surfaces, and Share/Export container chrome. Focus roles cover the shared native/custom focus rule, repeated native-control and application-control outlines, switch and wrapped-select focus indicators, skip-link border, and the existing inline metric focus underline.

Explicit exceptions retain their existing owners: Lens A/B and map-owned `.halo-glyph` focus, planning-membership focus using `--planning-neutral`, a `:focus-visible` select reset inside the hospitality wrapper (the wrapper owns its ring), pressed-state text decoration, and link text color. These are not generic focus-ring literals.

## Measured parity

`parity.json` was produced by `compare.mjs` in Chromium `153.0.8010.12`, DPR 1, using the clean base worktree and this candidate against the same verified deployed manifest and runtime snapshot. It samples **24 selector groups × 21 properties** (including box geometry) over six states: desktop 1440×900, tablet 834×1112 and mobile 390×844, each with the drawer closed and open.

- Computed styles, visibility and geometry: exact across all 6 states; no differing selectors.
- Page errors: none in either arm.
- Screenshot pixels: tablet and mobile open/closed are exact. Desktop differs by 5 pixels when closed and 2 when open, maximum channel delta 1. Both differences fall in a 4×3px patch at `(960, 198)` on the panel edge; no changed CSS value or geometry is present. This matches the tiny panel-edge rasterization variance noted in the T-a1 evidence. No intentional visual change was made.
- Candidate screenshots are in `screenshots/`; baseline hashes, pixel deltas and full computed samples are in `parity.json`, avoiding duplicate baseline screenshots.

## Focus and drawer behavior

Keyboard-modality focus samples match baseline for the language header control, PLACE mode button, scope rail button, drawer close button and `#haloToggle`. The first browser Tab stop is the visible skip link. The native dialog receives focus on open, the close button is visible and focus-visible, Escape closes it, and focus returns to the exact rail opener. Existing Playwright IA cases additionally cover per-value evidence open/close and the 360px drawer case. Existing tests cover the visually hidden switch input and wrapper-owned select indicator. The historical actual-Tab `#haloToggle` measurement from T-a0 remains unchanged; this run’s candidate and baseline computed focus values also match.

Chromium `forced-colors: active` emulation maps the focused mode button to the same 2px system outline in both arms and suppresses box-shadow in both. This is an emulated forced-colours inspection, not a claim of WCAG conformance or a physical Windows High Contrast run. No focused target was found obscured by the drawer’s sticky heading in exercised states; the close action remains visible. WCAG 2.2 SC 2.4.11 is not claimed as fully audited by these automated checks.

## Verification

- `node --test --test-concurrency=1 tests/*.test.mjs` — 1,011 passed, 0 failed.
- `npm run test:browser` — 218 passed, 0 failed across the full configured Playwright browser suite, including information architecture/drawer, visual language, radial halo and planning surfaces.
- T-a2 browser comparison: 6 responsive drawer captures, 24×21 computed parity samples, keyboard-focus comparison, drawer Escape/return-focus check, and forced-colours emulation.
- `git diff --check` — passed.
- Safari/WebKit and physical iPad hardware were not tested. Chromium emulation does not substitute for those environments.

To reproduce the T-a2 comparison from this checkout, create a clean detached worktree at the recorded base SHA, install the existing Playwright dependency with `npm ci`, then set `TA2_BASE_ROOT` to that worktree and run `node research/ux_t1_ta2_focus_drawer/compare.mjs`. The script refuses a different base or deployed source/build identity and records only candidate screenshots plus baseline hashes and pixel deltas.

## Recommendation

**GO** for integration review: exact computed dark parity across the sampled states, no drawer/focus regression identified, no intentional appearance change, and the requested automated suites pass. This is not a WCAG compliance certification.
