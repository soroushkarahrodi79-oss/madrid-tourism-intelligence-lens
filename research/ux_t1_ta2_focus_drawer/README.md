# UX-T1 T-a2 â€” Evidence drawer and focus tokens

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
| `--chrome-drawer-backdrop` | `rgba(2,6,12,.5)` |
| `--chrome-drawer-provenance-divider` | `rgba(255,255,255,.08)` |
| `--chrome-drawer-edition-border` | `rgba(183,197,212,.14)` |
| `--chrome-focus-ring-color` | `#9bd5ff` |
| `--chrome-focus-separation-color` | `#08101a` |
| `--chrome-focus-ring-subtle-color` | `rgba(87,184,255,.75)` |
| `--chrome-focus-inline-indicator-color` | `rgba(160,180,205,.7)` |

The drawer token roles cover `.evidence-drawer`, `.drawer-head`, drawer controls and reading buttons, record/source/interpretation surfaces, and Share/Export container chrome. Focus roles cover the shared native/custom focus rule, repeated native-control and application-control outlines, switch and wrapped-select focus indicators, skip-link border, and the existing inline metric focus underline.

Explicit exceptions retain their existing owners: Lens A/B and map-owned `.halo-glyph` focus, planning-membership focus using `--planning-neutral`, a `:focus-visible` select reset inside the hospitality wrapper (the wrapper owns its ring), pressed-state text decoration, and link text color. These are not generic focus-ring literals.

## Measured parity

The committed `parity.json` and six PNGs preserve the original T-a2 evidence run at the initial PR head (`9a1af5bf75cf0933196528582b96becad32cc580`): 24 selector groups × 21 properties, with exact computed styles and the small panel-edge rasterization differences recorded there. They are retained as historical evidence and are not overwritten by reruns.

The final-correction rerun used a clean pinned base worktree and a committed candidate. Its report was written outside both source worktrees. It sampled **26 selector groups × 21 properties** over desktop 1440×900, tablet 834×1112 and mobile 390×844, with the drawer closed and open. It also opened the K7 change-provenance drawer using the existing loopback regression seam and sampled the provenance section and all three edition blocks.

- Computed styles, visibility and geometry: exact across all six responsive states and the K7 provenance drawer; no differing sampled selectors.
- Screenshot pixels: exact in all six responsive states in the final-correction run; zero changed pixels.
- Page errors: none in either arm.
- Candidate CSS SHA-256: `746d6db831f52355d9069da3e53ed59e2aadaaba5a85343ca69f7046ad4b2eb0`.
- Candidate screenshots and fresh `parity.json` are generated only in the selected external output directory. The committed original baseline images and JSON remain untouched.

## Focus and drawer behavior

The comparison separates genuine Tab traversal from isolated programmatic focus. Its `actualTabTraversal` evidence records the first real page Tab stop, the drawer's initial focus after Enter from an isolated programmatic opener, real forward Tab and reverse Shift+Tab within the drawer, Escape return to that opener, and real Tab traversal from COMPARE activation to the native `#haloToggle` checkbox. Header, PLACE mode and rail computed rings are reported under `programmaticFocusAfterKeyboardInput` with `reachedByTab: false`; these controls were focused with Playwright `.focus()` after keyboard modality had been established, so those samples validate their rendered `:focus-visible` styles rather than a Tab path to each control. Existing Playwright IA cases cover evidence open/close, and existing tests cover the visually hidden switch input and wrapper-owned select indicator.

The historical T-a0 `#haloToggle` measurement did use real Tab traversal from COMPARE and remains the separately pinned historical evidence; it is not presented as traversal performed by the T-a2 comparison. The historical 3px `currentColor` report was not reproduced. Chromium `forced-colors: active` emulation maps the focused mode button to the same 2px system outline in both arms and suppresses box-shadow in both. This is an emulated forced-colours inspection, not a physical Windows High Contrast run or WCAG conformance claim. The exercised drawer focus path returns to its opener and remains visible around the sticky heading; SC 2.4.11 was not comprehensively audited across every state.

## Verification

- `node --test --test-concurrency=1 tests/*.test.mjs` â€” 1,011 passed, 0 failed.
- `npm run test:browser` â€” 218 passed, 0 failed across the full configured Playwright browser suite, including information architecture/drawer, visual language, radial halo and planning surfaces.
- T-a2 browser comparison: 6 responsive drawer captures, 24Ã—21 computed parity samples, keyboard-focus comparison, drawer Escape/return-focus check, and forced-colours emulation.
- `git diff --check` â€” passed.
- Safari/WebKit and physical iPad hardware were not tested. Chromium emulation does not substitute for those environments.

## Reproduction

Run from a clean, committed T-a2 candidate checkout. Create or reuse a separate clean worktree at the pinned baseline SHA and install Playwright dependencies in the candidate checkout. `TA2_CANDIDATE_SHA` pins the actual candidate commit (it must equal candidate `HEAD`); the script verifies that it descends from the pinned base, that the only production change is `css/app.css`, that research changes stay inside this evidence package, and that the candidate CSS bytes match the committed CSS SHA-256. The baseline worktree must be exactly the pinned base and clean. The live Pages manifest must still identify that same source/build.

Fresh screenshots and `parity.json` are written to a new external output directory. By default this is a timestamped directory under the system temporary folder; set `TA2_OUTPUT_DIR` to another new empty location outside both worktrees to choose where. The committed screenshots and original `parity.json` are never overwritten by a reproduction run.

```powershell
# From the T-a2 candidate checkout, after committing all candidate changes:
$env:TA2_BASE_ROOT = (Resolve-Path ..\madrid-ta2-base).Path
$env:TA2_CANDIDATE_SHA = (git rev-parse HEAD).Trim()
$env:TA2_OUTPUT_DIR = Join-Path $env:TEMP ("madrid-ta2-repro-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
node research/ux_t1_ta2_focus_drawer/compare.mjs
Remove-Item Env:TA2_BASE_ROOT,Env:TA2_CANDIDATE_SHA,Env:TA2_OUTPUT_DIR
```

The script refuses a dirty source worktree, a wrong baseline, an unexpected file scope, a CSS mismatch, or a changed deployed source/build identity. It prints the candidate SHA, committed CSS SHA-256, output directory, computed-style parity, screenshot pixel deltas, page errors, explicit Tab-traversal evidence, programmatic focus samples and Chromium forced-colours results.

## Recommendation

**GO** for integration review: exact computed dark parity across the sampled states, no drawer/focus regression identified, no intentional appearance change, and the requested automated suites pass. This is not a WCAG compliance certification.
