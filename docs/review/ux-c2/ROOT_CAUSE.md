# UX-C2 — Panel card containment & responsive geometry

Baseline: `origin/main` @ `94d3612` (PR #138 / UX-C1 merged, UX-C1 contrast corrections present).
Branch: `fix/ux-c2-panel-content-containment`. Scope: `css/app.css` only (plus tests/CI).
No JavaScript, data, geography, calculation or evidence-semantics change.

## 1. What was reproduced, and what was not

Reproduction scenario (as requested): PLACE, Detail open, Lens A at Los Jerónimos / Retiro
(`40.4141,-3.6912`, 900 m), Light via System, English, viewport **1180×820 @ DPR 2**
(the iPad-landscape CSS size). Chromium 1243 (headless). **Real WebKit / the physical iPad
were not available in this session**; WebKit coverage runs in CI (`ux-c2-webkit` job).

Measured at 1180×820 (before the fix):

| Element | Measurement | Meaning |
|---|---|---|
| `#analysisPanel` | border-box 480 px, `clientWidth` 478, `scrollWidth` 478, padding 16/16, border 1/1 | no horizontal overflow of the panel itself |
| `#placeDetail` | 446 px wide, inner 444 | children inset 8 px each side by `.detail-disclosure>*:not(summary)` |
| `.mix` | 428 px, columns `210px 210px` | **Category mix and Nearest cards are symmetric and inside the disclosure** (L 8 / R 8) |
| `#planningTouchedCard` | 428 px, content box 402 px | |
| `#planningTouchedList` | 402 px (`scrollbar-gutter:stable`, `padding-right:4px`, 15 px gutter reserved) | |
| `#planningTouchedList > li` | **383 px**; inset **0 px left / 19 px right** inside the card | the reported visual defect |

Classification of the reported symptom against the A–E list:

* **A (genuine horizontal overflow)** — *not* present at ≥ 1024 px. It **is** present at phone
  widths (see D2 below) — a different defect from the iPad one.
* **B (grid minimum sizing)** — present, but only at ≤ ~480 px (D2, D3).
* **C (asymmetric / insufficient internal spacing)** — **this is what reproduces on the iPad scenario**:
  the ámbitos list rows are inset 0 px on the left and 19 px on the right (D1). On a device with
  overlay scrollbars (iPadOS) `scrollbar-gutter:stable` reserves nothing, so the remaining asymmetry is
  the 4 px `padding-right`; the 15 px figure is what Chromium measured. I could not measure iPadOS itself.
* **D (intentional internal scrolling)** — the ámbitos list is a designed vertical scroller
  (`max-height:15rem`, `overflow-y:auto`); it stays. It is *not* a horizontal scroller.
* **E (border / alignment only)** — the cut-off last row (APE.01.10) in the screenshots is the
  designed vertical scroll region, not a border defect.

**Not reproduced:** a misaligned Category mix / Nearest card at 1180×820. Those two cards only break
below ~480 px (phone widths, and any iPad Split View / Slide Over narrower than that). I am therefore
reporting what I measured, not the original screenshot's exact pixels: if the owner's iPad shows the two
cards too close to the edge at landscape width, that is **not** explained by anything measurable here and
needs the physical device / the WebKit CI artifacts to confirm.

## 2. Confirmed defects and root causes

| # | Defect | Where / when | Root cause (measured) | Fix |
|---|---|---|---|---|
| D1 | Ámbitos rows unevenly inset (0 L / 19 R on Chromium, 0 / 4 on overlay-scrollbar devices) | `#planningTouchedList` at every viewport | `scrollbar-gutter:stable` + `padding-right:var(--s-1)` reserve space on the right only | removed both; a real scrollbar now takes space only when the list actually scrolls |
| D2 | **Nearest card leaves the panel**, bars collapse to 0 px, `#planningTouchedCard` 341 px in a 296–326 px box (**45 px past its container and 23 px past the panel's outer edge at 360 px**) | PLACE Detail, ≤ ~480 px | `.mix{grid-template-columns:1fr 1fr}` — `1fr` is `minmax(auto,1fr)`; the `white-space:nowrap` Nearest rows give the track a 208 px min-content, so the grid grows past its container | `repeat(auto-fit,minmax(min(100%,max(10rem,calc(50% - 4px))),1fr))`: 2 columns whenever two ≥ 10 rem cards fit, otherwise one stacked column. No new breakpoint, desktop/iPad layout unchanged (still 2 × 210 px) |
| D3 | CITY panel scrolls horizontally (`scrollWidth` 383 > `clientWidth` 338–368); “Newly present / No longer present” disclosures 12–57 px past the edge, focus ring clipped | CITY, ≤ ~480 px | `.domestic-origin-dynamics-transitions{display:grid}` has an implicit `auto` column whose min-content is the table | `grid-template-columns:minmax(0,1fr)` |
| D4 | Nearest names ellipsized (“Museo Thyssen-Born…”) at narrow card widths; essential name/qualifier concealed | Nearest card whenever the card is narrower than the name | `.nearest li{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}` | wraps (`overflow-wrap:anywhere`); the distance (`em`) stays unbreakable so “406 m” never splits |
| D5 | Category-mix label spills its 55 px column in Spanish (“Alojamientos” 61 px, “Información” 56 px) | PLACE Detail, ES, every viewport | fixed `55px` first track | `6.5em` track (scales with the type size) + `min-width:0;overflow-wrap:anywhere` on the label; value/bar columns use `minmax(0,1fr)` |
| D6 | Radius slider 2 px wider than its box on each side (4 px total, inside the 12 px card padding) | Lens controls, every viewport (56 of the audited states) | UA default `margin:2px` on `input[type=range]` combined with `width:100%` | `margin-inline:0` |
| D7 | Evidence & limits drawer scrolls horizontally by ~16 px | drawer, ≤ ~400 px | registry “interpretation ceiling” text carries `docs/ACCOMMODATION_NUMERATOR_AUDIT.md` (37 unbreakable chars) | `.drawer-ceiling{overflow-wrap:anywhere}` |
| D8 | Membership chip name ellipsized with no title (official ámbito denomination concealed) | PLACE membership block (P0-a, staging flag) when the denomination is long | `.planning-membership-chip-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}` | wraps (`overflow-wrap:anywhere`); only reachable with the long-content fixture on real data (no real denomination was clipped) |
| D9 | Urban-licences section header overflows: scope hint and evidence button pushed out of the panel (panel `scrollWidth` 399 > 368) | PLACE with the licences layer on, **Spanish**, ≤ 1024 px | `.section-head small{white-space:nowrap}` in a non-wrapping flex row | wrapping allowed (`overflow-wrap:anywhere;min-width:0;text-align:right`); the scope hint stays fully readable (it is a scope label) |

D5, D8 and D9 were found with Spanish text, the long-content fixtures and the layer-on tests respectively (see §4).
Default grids that still use bare `1fr` elsewhere (`.metrics`, `.row-controls`, `.mode-nav`, `.ambito-identities`,
`.hospitality-meta-grid`, `.cb-grid`) were measured at every viewport in both languages and with the
long-content fixture and **did not exhibit a defect**, so they were deliberately left unchanged.

## 3. Components exercised

Exercised by the audit in PLACE, COMPARE and CITY (all sections that render with real data, every
`<details>` opened, panel scrolled and unscrolled): header and mode navigation, scope rail, Lens
summary and metric cards, Area Profile, Planning Ámbito (+ results), planning membership (staging flag),
Planning touched list, Category mix, Nearest, urban-licence block, hospitality context, pedestrian activity,
Lens A/B controls, Comparison Bridge, Decision Insight, Spatial Window Sensitivity, comparison tables,
Planning Ámbito comparison, City statistical cards, tourism/accommodation, domestic-origin dynamics
(including its tables and expandable descriptions) and the Evidence & limits drawer.

The audit measures every visible element under the root, so a block is covered by construction **if it
renders in the loaded state**. Blocks that depend on data not present in this checkout's committed
snapshot (e.g. a populated pedestrian-activity series, licence results with the layer toggled on, the
Planning explorer with a search term entered) were exercised only in the empty / "not available" state
they render here; their populated states were **not** exercised. That is stated rather than assumed.

Unaffected (zero findings before and after, all viewports × languages): header, mode navigation, scope rail,
metric cards (`.metrics`), Area Profile, Planning Ámbito, urban licences (`.lic-families`),
hospitality meta grid, Comparison Bridge (`.cb-grid`), tables (designed horizontal scroll inside their own
wrapper), domestic-origin summary (`repeat(5,minmax(0,1fr))`).

## 4. Method

`browser-tests/panel-containment-audit.mjs` walks every visible element under `#analysisPanel` (or
`#evidenceDrawer`) and compares its `getBoundingClientRect()` with the **content box of its layout
parent** (border, padding and a visible scrollbar removed). Finding classes: `escape`, `spill`, `clip`
(real text hidden by `overflow`/ellipsis), `hscroll`, `asymmetry` (a box stretched by a block/grid parent
whose left and right inset against the card the reader sees differ by > 3 px — a visible scrollbar is
subtracted, not counted as padding), and `focus-clip` (a focused control's outline cut horizontally).
Vertical scrolling is never a finding; horizontal scrollers are listed in `DESIGNED_HSCROLL`
(comparison tables, ámbito quantity table, domestic-origin tables, analyst data block) and are
reported separately, not dropped.

`browser-tests/panel-containment-ux-c2.browser.mjs` ({{NTESTS}} tests):

* real data, Light/EN, all 10 required viewports × Place/Compare/City × Detail open/closed × scrolled/unscrolled;
* Light/Dark/System-light × EN/ES on 1440×900, 1180×820, 1024×768, 820×1180, 390×844;
* panel at the minimum and maximum allowed desktop width (1440, 1366, 1180, 1024);
* classic (space-taking) scrollbars on 1440/1180/1024 — headless Chromium hides scrollbars by default, which
  would hide the very gutter under test;
* long-content stress fixtures (`applyStress`: 90-character official names, a 58-character unbroken token,
  7-character figures) at 8 viewports × EN/ES — **fixtures overwrite text only, never data used by a calculation,
  and are never applied in the real-data tests**;
* Evidence & limits drawer at 5 viewports × EN/ES;
* licences + hospitality layers switched on through the production paths, 5 viewports × EN/ES;
* the reported iPad scenario asserted on its own, the ámbitos list still scrolling vertically (and never
  horizontally), and Detail not moving the controls above it.

The shell-level assertion also requires `|minInsetLeft − minInsetRight| ≤ 1.5 px` for every painted box.

### Before / after

| | `origin/main` | this branch |
|---|---|---|
| Suite result (Chromium) | 8 pass / **67 fail** / 1 skipped (76) | **75 pass / 0 fail** / 1 skipped (76) |
| Distinct findings, real data, 10 viewports × EN/ES × 3 modes × scrollbars | **11** (`matrix/defect-inventory-before.json`) | **0** (`matrix/defect-inventory-after.json`) |
| Audited states recorded | 78 (tests stop at the first finding) | 404 (`matrix/containment-matrix-after-chromium.json`) |

The skipped test is the screenshot capture (requires `UXC2_CAPTURE_DIR`).

Screenshots (`screenshots/before`, `screenshots/after`, Chromium, System-light, EN, DPR 2):
iPad landscape 1180×820, 1024×768, phones 390×844 and 360×800 — PLACE Detail and the bottom of CITY.
The most telling pair is `phone-360x800-place-detail.png`: before, the Nearest card runs off the panel and the
bars are 0 px wide; after, both cards stack, are fully inside the panel and the bars are readable. On
`ipad-landscape-1180x820-place-detail.png` the ámbitos rows go from a 19 px right gap (0 px left) to flush with the card on both sides.

Containment matrix summary (after; every audited state has `clientWidth = scrollWidth` and zero findings):

{{MATRIX}}

`min inset 0.0 / 0.0` means the outermost painted boxes sit exactly on the panel's padded content edge on both
sides: left and right are equal, nothing crosses the edge.

## 5. Validation status

| Check | Result |
|---|---|
| UX-C2 suite, Chromium (local) | 75 pass / 0 fail / 1 skipped |
| UX-C2 suite on `origin/main` | 67 fail (expected: the suite detects the defects) |
| `node --test` | 1123 / 1123 pass |
| `python -m unittest discover -s tests -p "test_*.py"` | 501 tests OK (8 skipped) |
| `npm run test:browser` (all existing browser suites + UX-C2, Chromium) | {{BROWSER_ALL}} |
| UX-C1 Light/Dark contrast suite | included in `npm run test:browser` (colour rules untouched; only layout declarations changed) |
| **WebKit** (`ux-c2-webkit` CI job) | **pending CI — not run locally** |

## 6. Known limitations

1. **No physical iPad / real WebKit measurement.** Everything above is Chromium. The same assertions run on
   WebKit in CI; until that job is green the WebKit result is unverified. iPadOS uses overlay scrollbars, so the
   exact gutter figure on the owner's device differs from Chromium's (the fix removes the gutter altogether, so the
   outcome should be the same).
2. **Panel resize is ignored at ≤ 1100 px.** The `@media(max-width:1100px) and (min-width:851px)` rule hard-sets
   `.panel{width:min(420px,…)}` without `var(--analysis-panel-width)`, so dragging the grip (or a stored size) changes
   only the height there. Observed, not changed: it is a resize-persistence behaviour, not a containment defect, and
   enabling it would put a 340–680 px panel on tablets nobody has validated. Min/max width is therefore asserted only for
   viewports > 1100 px; the narrower ones are audited at their fixed 420 px.
3. Opening Detail still shifts content below the scope rail by ~45 px: Detail adds a "Lens ∩ ámbito" row to the
   scope rail (intentional provenance disclosure, K4 "no breakpoint may hide a scope"). The rail, header and panel
   width do not move; the test asserts exactly that.
4. Populated states of data not present in this checkout (see §3) were not exercised.
5. The audit's `asymmetry` class only applies to boxes stretched by block/grid parents; flex/inline items size to
   their content and are covered by `escape`/`spill`/`clip` instead.
6. Outside this task's scope, observed in the 360×800 screenshots: the header's "Appearance" label is squeezed to a
   dot next to the selects (UX-H1 territory). Not touched.

## 7. Rollback

All product changes are in `css/app.css` (the rules listed in §2). Either `git revert <merge commit>` or,
to roll back selectively, restore the previous value of one rule:

* `.mix` → `grid-template-columns:1fr 1fr`; `.mixrow` → `55px 1fr 28px`; remove `.mixrow>span{…}`
* `.nearest li` → `white-space:nowrap;overflow:hidden;text-overflow:ellipsis`; `.nearest em` drop `white-space:nowrap`
* `#planningTouchedList` → re-add `scrollbar-gutter:stable;padding-right:var(--s-1)`
* `.domestic-origin-dynamics-transitions` → drop `grid-template-columns:minmax(0,1fr)`
* `input[type=range]` → drop `margin-inline:0`
* `.drawer-ceiling` → drop `overflow-wrap:anywhere`
* `.planning-membership-chip-name` → `overflow:hidden;text-overflow:ellipsis;white-space:nowrap`

The test/CI additions (`browser-tests/panel-containment-*.mjs`, the `package.json` entry, the `ux-c2-webkit` job and
the Chromium capture step in `.github/workflows/test.yml`) are independent of the CSS and can be reverted separately.
