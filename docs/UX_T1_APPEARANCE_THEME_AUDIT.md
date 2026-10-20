# UX-T1 — Appearance theme (Light/Dark/System) design & accessibility audit

Status: **design/audit gate only** (issue [#102](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/issues/102)).
Follows the Post-K13 gate convention
(`docs/POST_K13_PRODUCT_UX_VALIDATION.md`, `docs/POST_K13_P0_P1_DESIGN_PROTOTYPE.md`). This
document changes **no production CSS, JS, HTML, test, dataset, model, scope, date, withholding
rule, abstention, derivation or interpretation ceiling**, and it does **not** touch HATI. Its
sole artifact is this document. No implementation is authorized by it.

- **Baseline:** `main` @ `028d038` (merge of PR #100, P1 small-screen IA).
- **Designed:** 19 October 2026. **Independently corrected:** 20 October 2026 against PR #103 head
  `7d138fa` and `origin/main` `028d0389454b4248180654075022e4397b14fd5b`. The correction
  preserves the 13/15 arithmetic result but withdraws the earlier implication that all 13 are
  established WCAG failures; inventories the separate A/B colour owners; evaluates text and
  graphics candidates; replaces the broad T-a refactor with bounded future increments; and makes
  the calculation and Phase B matrix reproducible. PR #103 had two commits and only this document
  changed when the correction began; no review had been submitted and all three checks were green.
- **Research question (from #102):** can the product gain a Light/Dark/System appearance theme
  and a comfortable-text-size control that meet WCAG 2.2 AA, without weakening or renaming any
  evidence/legend colour's category meaning, and without colliding with the existing "Light/Dark"
  basemap wording?

> **Nothing in this document has been rendered in a browser, measured on a device, or tried by a
> person.** Every colour pair below is either (a) a WCAG relative-luminance arithmetic result
> computed from the literal values already shipped in `css/app.css` (reproducible, see §9), or
> (b) a labelled candidate value for the unbuilt light theme, whose ratio is likewise computed
> arithmetically against a candidate background — not rendered, not composited through real DOM
> layers, not device-tested. No claim of shipped accessibility conformance is made.

---

## Contents

1. [What this gate did, and the limits of its evidence](#1-what-this-gate-did-and-the-limits-of-its-evidence)
2. [Current-state inventory](#2-current-state-inventory)
3. [The central finding: category colour, tuned for one near-black background, is not theme-portable by hue alone](#3-the-central-finding-category-colour-tuned-for-one-near-black-background-is-not-theme-portable-by-hue-alone)
4. [Research grounding](#4-research-grounding)
5. [Token architecture: UI-chrome vs. evidence/legend, kept strictly separate](#5-token-architecture-ui-chrome-vs-evidencelegend-kept-strictly-separate)
6. [Proposed tokens — light and dim-dark](#6-proposed-tokens--light-and-dim-dark)
7. [The "Appearance" control, System detection and the no-flash contract](#7-the-appearance-control-system-detection-and-the-no-flash-contract)
8. [Comfortable text size — an amendment to K5, not a silent override](#8-comfortable-text-size--an-amendment-to-k5-not-a-silent-override)
9. [Reproducibility of every figure in this document](#9-reproducibility-of-every-figure-in-this-document)
10. [Migration path — bounded increments for Phase B](#10-migration-path--bounded-increments-for-phase-b)
11. [Test-suite implications](#11-test-suite-implications)
12. [Residual risks and what remains untested](#12-residual-risks-and-what-remains-untested)
13. [Acceptance criteria for Phase B](#13-acceptance-criteria-for-phase-b)
14. [Gate verdict](#14-gate-verdict)

---

## 1. What this gate did, and the limits of its evidence

| Activity | Done? | What it can support |
|---|---|---|
| Source reading of `css/app.css` (1,196 lines), `index.html` (847 lines), and the theme-relevant parts of `js/app.js` | ✅ | Exact selectors, token declarations, literal colour census, breakpoints, focus rules, existing persistence patterns and independent A/B renderers |
| Confirming no existing theme/appearance-switching code | ✅ | `grep` for `matchMedia`, `prefers-color-scheme`, `data-theme`, theme-related `localStorage` keys across `js/app.js` and `index.html` — **none found** except `prefers-reduced-motion` (unrelated) and the pre-existing `PANEL_SIZE_STORAGE_KEY` (a reusable persistence *pattern*, not a theme) |
| WCAG relative-luminance arithmetic over literal values already shipped | ✅ | Exact, reproducible contrast ratios for the **current, shipped** dark theme (§3, §6) |
| WCAG relative-luminance arithmetic over **candidate** light-theme values | ✅ | A falsifiable prediction for an unbuilt theme — not a measurement of anything rendered |
| Research of WCAG 2.2, Esri Calcite, GitHub Primer, IBM Carbon, Observable Framework | ✅ | External precedent for the token architecture and migration strategy (§4) |
| Rendering anything proposed here in a browser | ❌ | — |
| Running the existing browser contrast suite against a proposed light theme | ❌ | No light theme exists. The current dark baseline was run (10/10 pass), but it cannot validate unimplemented candidates (§11). |
| Device testing, assistive-technology testing, or any human participant | ❌ | — |

### What is NOT established by this document

- No real browser compositing of the proposed light-theme colours over real translucent DOM
  layers (`--panel`, `--panel2`, badge backgrounds, `backdrop-filter` surfaces) has been done.
  Every light-theme ratio in §6 uses a **flat candidate background**, exactly as the shipped
  dark-theme equivalent token values are flat `:root` declarations — but the *rendered*,
  *composited* result (what `browser-tests/visual-language.browser.mjs` actually checks) can
  differ, as it already does for the current theme once backdrop blur and layered translucency are
  involved. Phase B must re-run that composite audit against the real DOM, not trust this
  document's arithmetic as a substitute.
- No performance measurement of toggling `backdrop-filter` or swapping a stylesheet / custom
  properties at runtime has been taken. Precedent exists only for an *unrelated* render (K12's
  Leaflet canvas layer, `docs/RUNTIME_DECISION_SPIKE.md`), not for this change.
- No ES/EN string audit for new "Appearance" / text-size copy has been written as shipped copy —
  draft strings appear in §7–§8 labelled as drafts, not as `js/shell-copy.js` entries.

---

## 2. Current-state inventory

### 2.1 Token inventory (`css/app.css:1–30`)

| Token | Value | Role | Category |
|---|---:|---|---|
| `--t-display` … `--t-micro` (7 tokens) | 28px … 10px | Type scale (K5) | Structural |
| `--s-1` … `--s-4` | 4/8/12/16px | Spacing (K5) | Structural |
| `--r-small`, `--r-large` | 8/16px | Radius (K5) | Structural |
| `--bg` | `#08101a` | Page/map fallback background | **UI-chrome** |
| `--panel` | `rgba(8,16,27,.92)` | Panel surface | **UI-chrome** |
| `--panel2` | `rgba(13,24,39,.90)` | Secondary panel surface | **UI-chrome** |
| `--line`, `--line2` | `rgba(255,255,255,.10)`/`.18` | Hairline borders | **UI-chrome** |
| `--text` | `#f3f7ff` | Primary text | **UI-chrome** |
| `--muted` | `#a9bbcf` | Secondary text | **UI-chrome** |
| `--text-meta` | `#9fb1c5` | Metadata text | **UI-chrome** |
| `--a` | `#f7fbff` | **Lens A identity** | **Evidence/legend** |
| `--b` | `#43d7ff` | **Lens B identity** (also structurally dashed, K5) | **Evidence/legend** |
| `--planning-neutral` | `#aeb8c4` | Gate-L planning ámbito geometry/phase neutral | **Evidence/legend** |
| `--licence-neutral` | `#c0794f` | K9 granted-licence category | **Evidence/legend** |
| `--planning-origin` | `#c4b8cf` | PGOUM-85/97 origin-marker category | **Evidence/legend** |
| `--planning-unresolved` | `#bdb7aa` | `No Necesita` unresolved category | **Evidence/legend** |
| `--museum`,`--info`,`--stay`,`--bike`,`--rail`,`--activity`,`--park`,`--hospitality`,`--heat`,`--green` (10 tokens) | — | Operational-layer category dots/bars | **Evidence/legend** |
| `--safe-top/right/bottom/left` | `env(safe-area-inset-*,0px)` | Device safe-area | Structural |

**K5's rule carries forward unchanged by this audit:** the Evidence/legend row is the exact set
the "colour is category, never judgement" rule governs. There are 16 token names but only 15
distinct shipped values because `--park` and `--green` are both `#70dea4`; §3 and §9 screen the
15 distinct values and report the duplicate explicitly. A future theme must not silently change
category meaning. Luminance adjustment is one option, not an automatic requirement: the rendered
role, text/graphic threshold, non-colour cues and any SC 1.4.11 exemption must first be established.

### 2.2 Hardcoded colour literals outside the token set

The earlier draft called this "320 distinct lines". Re-running a comment-stripped, line-based
census on the PR head finds **415 source lines containing a raw `#hex` or `rgb(a)` literal**, of
which **406 are outside the opening `:root` block**, and **314 distinct literal strings**. These
figures are deliberately described as census indicators, not as 406 independent consumers or
refactor sites: minified multi-declaration lines, repeated values, pseudo-elements, map renderers,
and paired foreground/background declarations make line count a poor work estimate. T-a0 must
produce a selector/property/owner inventory before any migration scope is approved.

| Literal family (representative hex) | Approx. occurrences | Selector family | UI-chrome or Evidence? |
|---|---:|---|---|
| `#a9bbcf`, `#8ba0b7`, `#9fb1c5`, `#8195ab`, `#a4b7cb`, `#9aaec4`, `#8296ac`, `#95a9be`, `#7d92a9`, `#6f849b` (muted-text greys) | ~100 | Panel body copy, metric foot notes, badge text, planning/licence detail prose | UI-chrome (should route to `--muted`/`--text-meta` family) |
| `#9bd5ff` | 15 | `:focus-visible` outline colour (every interactive control, `css/app.css:106,131,160,238,401,426,456,521,630,639,657,874,883,1177`) | **UI-chrome, but safety-critical** — a single literal repeated 15× rather than a token is itself a defect independent of theming |
| `#fff`/`#ffffff` | 12 | Leaflet zoom-control icon colour, misc. high-contrast text | UI-chrome |
| `#cfe0f0`,`#d9e4ef`,`#eaf2fb`,`#f2f8ff`,`#edf3f9`,`#e9f1fb`,`#e3ecf6`,`#dfecf8`,`#9ccdff`,`#d4dde7`,`#c9d9e9`,`#c2d3e4` (near-white panel/figure text variants) | ~45 | Metric values, panel headings, planning phase values (`.planning-phase-value`, `css/app.css:295`), domestic-origin headings | UI-chrome (should consolidate toward `--text`) |
| `#ffc570`,`#ff9abb`,`#d99a6e`,`#cdb79f`,`#71e9bf` (badge-tinted text colours) | ~17 | `.badge.*` text colours (`.badge.model` `#ffc36d` at `css/app.css:747`, `.badge.observed` `#ff9abb` at `css/app.css:501`, etc.) | **Mixed in one declaration** — each badge pairs a translucent `rgba(...)` background *derived from* a category hue with a near-white text literal; see §2.4 |
| `#08101a`,`#0c1826`,`#050c15`,`#09111c`,`#09131f`,`#0b1521` (near-black surfaces) | ~20 | Map background, Leaflet tooltip background, drawer background, mobile-layers button | UI-chrome |

**Migration risk flagged explicitly (point 2 of the audit's scope):** the `.badge.*` family (and
the `.dot-*`/`.bar-*` family at `css/app.css:93–101`) each hard-codes a background **derived from**
a category colour (e.g. `.badge.observed{background:rgba(255,122,162,.08)}` is `--activity` at low
alpha) next to a **separately chosen** near-white text literal (`#ff9abb`). These are two different
kinds of thing sharing one CSS rule: the background tint is Evidence/legend (it *is* the category
colour, diluted), and the text literal is a readability choice layered on top. Phase B must split
these into `background: color-mix(in srgb, var(--category) <alpha>%, transparent)` (or an explicit
per-theme tint token) plus a separately resolved **UI-chrome** text colour — never one value
serving both roles, or a theme swap will either wash out the category tint or break text contrast.

### 2.3 Translucent / `backdrop-filter` surfaces (composited over the hardcoded `#08101a` fallback today)

| Selector | Alpha | Backdrop filter |
|---|---|---|
| `--panel` | `rgba(8,16,27,.92)` | — |
| `--panel2` | `rgba(13,24,39,.90)` | — |
| `--line` / `--line2` | `rgba(255,255,255,.10)` / `.18` | — |
| `css/app.css:53–54` (drawer-class surface) | `rgba(6,12,21,.90)` | `blur(20px)` |
| `css/app.css:65` (panel surface) | `var(--panel)` | `blur(18px)` |
| `.leaflet-control-attribution` (`css/app.css:37`) | `rgba(5,8,12,.75)` | — |
| `.evidence-drawer::backdrop` (`css/app.css:939`) | `rgba(2,6,12,.5)` | — |
| `.rail-group>summary` (`css/app.css:764`) | `rgba(255,255,255,.025)` | — |
| `.place-jump-chip` (`css/app.css:897`) | `rgba(255,255,255,.05)` | — |
| `.rail-group-badge` (`css/app.css:78`) | `rgba(142,164,187,.07)` | — |
| Badge family (§2.2) | 0.08–0.26 alpha tints of category hues | — |

Every one of these is a surface the existing contrast test
(`browser-tests/visual-language.browser.mjs`, `background()` function) composites, ancestor by
ancestor, over a **single hardcoded fallback `[8,16,26,1]`** (`#08101a`). That fallback is the
dark theme's `--bg`. **A light theme needs its own fallback constant in that test function, or
the test will keep compositing light-theme translucent surfaces over a near-black floor and
silently pass or fail for the wrong reason** (§11).

### 2.4 Leaflet-owned vs. application-owned map chrome

Overridden in `app.css` (application-owned, must theme): `.leaflet-container` background
(`:36`), `.leaflet-control-attribution` background/text/link colour (`:37–38,43,811,1039`),
`.leaflet-control-zoom` box-shadow and button background/colour/border (`:39–40,820`),
`.leaflet-tooltip` background/border/colour/shadow (`:44`), `.leaflet-tooltip-top:before` border
colour (`:45`).

**Not overridden — plain Leaflet defaults, positioning only:** the zoom control's hover state, the
attribution box's internal link underline behaviour, and any Leaflet-internal classes not listed
above. **These will not theme automatically.** A light theme that only swaps `--bg`/`--text` will
leave Leaflet's unstyled defaults exactly as they are today; because every Leaflet surface *is*
already explicitly overridden in the list above, this is a bounded, enumerable set to re-theme —
but it is not implicit.

### 2.5 Badge / phase / provenance component inventory

| Component | DOM | Colour declared at |
|---|---|---|
| Gate-L phase rows | `#planningPhases` (`index.html:262`) → `.planning-phases>li[data-kind=...]` | `css/app.css:292–302` — border-left colour/style keyed to `--planning-neutral`/`--planning-unresolved`/`--planning-origin`, **never** an ordered hue (K5 contract, unchanged) |
| Lens A/B identity | `--a`/`--b` custom properties for panel badges/text/dots; **the map-rendered Lens circle itself does not read these tokens** (see note below) | `css/app.css:17` |
| Evidence & limits drawer | `<dialog id="evidenceDrawer" class="evidence-drawer">` (`index.html:786`) | `css/app.css:938–940,1022` — currently a **hardcoded** `background:#08101a` (not `var(--bg)` or `var(--panel)`) — a second migration risk: this literal must be tokenised before it can theme at all |
| Register/licence/model/observed/statistics/snapshot badges | `.badge.register/.licence/.model/.observed/.statistics/.snapshot` | `css/app.css:198,225,314,501,693,746–748` |
| Category dots/bars | `.dot-museum`,`.dot-stay`,`.dot-bike`,`.dot-rail`,`.dot-info`,`.dot-pedestrian`,`.dot-park`,`.dot-heat`,`.dot-licence` | `css/app.css:93–101` — already correctly routed through the category custom properties |

#### A/B colour ownership — four independent systems

Source verification shows that "Lens colour" is not one token path:

1. **Appearance-dependent UI chrome.** `--bg`, panels, generic text, borders and focus treatment
   belong to the appearance theme and carry no A/B identity.
2. **Panel A/B labels and legends.** CSS declares `--a:#f7fbff`, but there are **zero**
   `var(--a)` consumers. CSS declares `--b:#43d7ff` and has three consumers:
   `.area-other-lens-b`, `.area-label-b b`, and the active underline of
   `.ambito-metric-focus`. Other panel representations bypass both tokens: `.cb-side-a .cb-lens`
   is `#eef5fc`, `.cb-side-b .cb-lens` is `#43d7ff`, active Lens buttons use white/`#74e3ff`
   plus hardcoded borders/tints, and ámbito comparison tags/borders/bars use `#9ccdff` for A and
   `#43d7ff` for B. These are appearance-facing consumers and require explicit ownership in T-a3.
3. **Basemap-dependent Lens boundaries.** `js/app.js:2128–2161` defines
   `LENS_BASEMAP_STYLES` for Light, Satellite and Dark tiles, applied by
   `applyLensBasemapStyle()`. Light uses A stroke/fill `#123b5f`/`#3da8ff` and B
   `#00768f`/`#43d7ff`; Satellite and Dark use white A strokes and `#64f0ff` B strokes with
   separate fills/opacities. `tests/lens_contrast.test.mjs` protects the adaptive table and call
   path, but does not calculate rendered tile contrast. Appearance must not overwrite this
   basemap-owned decision.
4. **Map markers and SVG halo colours.** `.marker-a`/`.marker-b` hardcode white/`#43d7ff`.
   `HALO_GLYPH_COLORS` independently hardcodes A `#f7fbff` and B `#43d7ff`, injecting them into
   each SVG as `--halo-color`; halo values, strokes and state marks then consume that local
   property. Application-owned ámbito polygons also hardcode A/B strokes/fills in `js/app.js`.
   These marks sit over map content, have dark paint-order outlines or structural dash cues, and
   cannot be validated by pairing their source hex with a panel background.

Therefore changing `--a` or `--b` does **not** automatically update every A/B representation.
Conversely, changing `LENS_BASEMAP_STYLES` would affect boundaries but not panels or halos. T-a0
must record each consumer, visual background, semantic owner and structural cue before any shared
token is proposed.

### 2.6 Focus-visible and 44px interaction floor

- Fourteen separate `:focus-visible` rules repeat the **same literal** `#9bd5ff` (listed in
  §2.2) rather than a token; one generic rule exists at `css/app.css:1027`
  (`:where(button,select,input,summary,a[href],[role="button"]):focus-visible`), and several more
  specific rules duplicate it per component rather than relying on the generic one. **This is a
  pre-existing duplication the theme work will touch regardless of theming**, because every one of
  these 15 literals needs a token reference to vary by theme at all.
- The 44×44px coarse-pointer floor (K5) is implemented via `min-height`/`min-width:44px` at ~15
  sites, gated almost entirely under `@media(pointer:coarse)` and the ≤850px breakpoints
  (`css/app.css:68,343,764,815,824,897,982,995–997,1034–1045,1127–1130,1194`). None of this is
  colour-dependent; theming does not touch it, but Phase B's acceptance criteria (§13) must
  re-confirm it is undisturbed.

### 2.7 Existing responsive breakpoints (unchanged by this gate, listed for reference)

`480px` (mobile licence-filter grid), `420px` (×3, destination metrics / rail width / drawer
margins), `520px`, `560px` (×3), `850px` (×2, the P1 rail/panel breakpoint), `1100px`∩`851px`
(desktop-narrow band), `700px` height (×2, short-viewport panel clamp), `360px` (smallest rail
width step), plus `pointer:coarse` and `prefers-reduced-motion:reduce` media features. These are
P0/P1 contract, not altered here.

### 2.8 Confirmed: no existing theme-switching code

`grep` across `js/app.js` and `index.html` for `matchMedia`, `prefers-color-scheme`, `data-theme`,
and any theme-named `localStorage` key returns **zero matches** for anything theme-related. The
only `matchMedia` calls are `prefers-reduced-motion` (`js/app.js:5408,5428`) and the P1 rail
breakpoints (`js/app.js:5617,5655`, plain `max-width` queries, not colour-scheme). The only
existing `localStorage` usage is `PANEL_SIZE_STORAGE_KEY` (`js/app.js:6312,6322,6335`) — a
**precedent persistence pattern** (read-on-load, write-on-change, explicit reset) worth reusing
for the Appearance preference, not a theme mechanism itself. **This confirms the premise: Phase B
is new surface, not an extension of partially-built theming.**

---

## 3. The central finding: category colour, tuned for one near-black background, is not theme-portable by hue alone

This is the most consequential result of this audit, so it is stated before any proposal.

> **Correction (post-draft independent re-verification).** The first version reported "5 of 10"
> without enumerating a complete reproducible set. The full §9 script now enumerates all 15
> distinct shipped values and finds **13 of 15 below the 3:1 screening threshold** against the
> hypothetical flat light background. That is a colour-pair triage result, not 13 established WCAG
> violations. The earlier count and every remaining "five of ten" conclusion are withdrawn.

Fifteen distinct evidence/legend values were checked (`--a`,`--b`,`--planning-neutral`,`--licence-neutral`,
`--planning-origin`,`--planning-unresolved`,`--museum`,`--info`,`--stay`,`--bike`,`--rail`,
`--activity`,`--park`,`--hospitality`,`--heat`; `--green` is excluded as an exact duplicate hex of
`--park`, `#70dea4`). Each pair happens to exceed 3:1 against `#08101a`; that arithmetic does not
establish that every use is governed by 3:1 or that the values were originally selected through a
WCAG conformance process.

Computing the same ratios against a plausible light-theme background (`#f4f6f9`, a candidate
near-white — §6.1) **with the hue held exactly fixed**, reproduced independently of the shipped
`browser-tests/visual-language.browser.mjs` helper (§9 script, run against every token, not a
sample):

| Token | Ratio vs. `#08101a` (shipped) | Ratio vs. candidate `#f4f6f9`, same hex | 3:1 flat-pair screen |
|---|---:|---:|---|
| `--a` (Lens A) | 18.37 | **1.04** | **BELOW — see note below** |
| `--b` (Lens B) | 11.28 | **1.56** | **BELOW** |
| `--planning-neutral` | 9.51 | **1.86** | **BELOW** |
| `--planning-origin` | 10.10 | **1.75** | **BELOW** |
| `--planning-unresolved` | 9.57 | **1.84** | **BELOW** |
| `--info` | 8.76 | **2.01** | **BELOW** |
| `--stay` | 7.50 | **2.35** | **BELOW** |
| `--activity` | 7.78 | **2.27** | **BELOW** |
| `--hospitality` | 8.07 | **2.19** | **BELOW** |
| `--heat` | 10.52 | **1.68** | **BELOW** |
| `--park` | 11.53 | **1.53** | **BELOW** |
| `--bike` | 11.75 | **1.50** | **BELOW** |
| `--rail` | 13.25 | **1.33** | **BELOW** |
| `--licence-neutral` | 5.54 | 3.19 | MEETS (barely) |
| `--museum` | 5.72 | 3.09 | MEETS (barely) |

**Screening result: only 2 of 15 distinct source values reach 3:1 in this hypothetical flat pair.**
This is a useful triage result, not 13 established WCAG violations and not proof that the two
passing pairs conform in their components.

WCAG interpretation is use-specific:

- **[SC 1.4.3 Text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)**
  applies when a colour renders text. Normal-sized text requires
  4.5:1; 3:1 applies only to WCAG-large text. Lens B is used as 10px label text today, so a
  3.10:1 candidate cannot be approved for that use.
- **[SC 1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)**
  applies at 3:1 to the visual information needed to identify a
  user-interface component or to understand an essential graphical object, against adjacent
  colours. The adjacent colour is the rendered local surface or map content, not automatically
  `--bg`.
- A coloured mark can still be in scope even when labels, shapes, patterns or line styles also
  encode its identity; those redundant cues reduce colour-only dependence but do not erase a
  contrast requirement when the coloured boundary/mark itself is needed to perceive the object.
  Conversely, a purely decorative tint, glow, redundant fill, disabled control treatment, or
  incidental mark may be exempt from SC 1.4.11. Applicability must be documented per consumer.
- Labels, Lens B's dashed halo/boundary/ámbito treatments, Lens A's solid counterparts, phase-row
  border styles and glyphs, and explicit state words satisfy K5's structural redundancy rule.
  They do not convert this flat-pair screen into a browser accessibility validation.

**`--a` (Lens A) is a different kind of problem, not just the worst number in the table.** Its
shipped value, `#f7fbff`, is HSL(210°, 100%, 98%) — functionally white with a one-degree blue
tinge. It was not designed as "a saturated blue, happened to render very light"; it was designed to
read as the **brightest, most neutral identity** against a near-black background, which is a choice
that has no equivalent on a light background by definition (white-on-near-white has no contrast,
whatever the background's own candidate hue is). A same-hue lightness-only descent (§6.2) still
technically satisfies the arithmetic, but the result — a mid-blue at L55% — is a **different visual
identity**, not a dimmed version of the same one, and that identity now sits much closer to `--b`'s
hue family (193° vs. 210°) than it does today, risking exactly the A/B confusion K5 prohibits. This
is flagged here as an **open design decision for Phase B, not a solved case**: Lens A likely needs a
deliberately chosen light-theme colour, reviewed for hue separation from the light-theme `--b`, not
a mechanically derived one.

The consistent statement is therefore **13 of 15 screened pairs are below 3:1**. A light theme
cannot safely assume the shipped values remain suitable on light surfaces, but each actual
consumer must be classified and measured before it is called a failure or changed.

**What must not happen in response:** reassigning any of these hues to a *different* category, or
abandoning the hue family to "whatever is legible." Both would violate K5's "colour is category,
never judgement" contract and the Gate-L neutral-hue separation.

The arithmetic supports candidate exploration, not a universal lightness-only prescription.
Candidates must be selected to the strictest rendered role they serve, then checked on actual
composited surfaces, in grayscale, alongside neighbouring categories and with the existing
label/shape/pattern/line-style cues intact. §6 applies that discipline to Lens A/B.

---

## 4. Research grounding

| System | What was checked | What is adopted here, and why |
|---|---|---|
| **WCAG 2.2** | Full criteria set, with particular attention to the two added in 2.2: **2.4.11 Focus Not Obscured (Minimum, AA)** — a focused element must not be entirely hidden by author content (sticky headers, floating panels); **2.5.8 Target Size (Minimum, AA)** — pointer targets ≥24×24px, with a spacing exception. | The product's existing 44×44px floor (K5) already exceeds 2.5.8's 24px AA minimum — this audit does not relax it. 2.4.11 is a **new constraint for Phase B**: the evidence drawer (`position:fixed`, `z-index:2000`) and any sticky rail/header must be checked so a focused control is never fully covered by a theme-toggle control or the drawer itself — not previously audited because the drawer predates WCAG 2.2 adoption here. Flagged as a Phase B acceptance item (§13), not fixed by this document. |
| **Esri Calcite Design System** (`developers.arcgis.com/calcite-design-system`) | Its tokened light/dark surface and text scale (`--calcite-color-surface-1/2/3`, `--calcite-color-text-1`, each with an explicit light and dark hex) | Confirms the pattern of **numbered surface tiers** (a map-adjacent product's own precedent, since Calcite is also a GIS/map UI system) rather than a single flat background — relevant because this product already has `--bg`/`--panel`/`--panel2` as an informal three-tier surface stack; Phase B should make that tiering explicit and symmetric between themes rather than inventing a new tier scheme. |
| **GitHub Primer** (`primer.style/foundations/color`, `@primer/primitives`) | The `data-color-mode` / `data-light-theme` / `data-dark-theme` attribute pattern, and token values that *reference* a mode rather than being redefined ad hoc; a "dark dimmed" variant shipped as a distinct stylesheet | Directly informs §7's control mechanism: a single `data-appearance` attribute on `<html>` with values `light`/`dark`/`system`, resolved at parse time before paint (no-flash, §7.3) — Primer's exact attribute shape, renamed to avoid implying this product has Primer's nine-theme matrix (it has two). |
| **IBM Carbon Design System** (`carbondesignsystem.com/elements/themes`) | Four fixed themes (White, Gray 10, Gray 90, Gray 100) where tokens are **role-based identifiers that stay constant across themes**, each theme supplying different literal values | The single clearest precedent for §5's split: a token name (e.g. `--ui-bg`) is a *role*, never redefined to mean something else; only the *value a theme supplies* changes. This is the architecture adopted in §5 and is also exactly how K5's `--a`/`--b`/category tokens already work for the *one* theme that exists today — Phase B extends the same discipline, it does not introduce a new one. |
| **Observable Framework** (`observablehq.com/framework/themes`) | Paired light/dark theme sets resolved via `prefers-color-scheme`, with a documented caveat that chart marks default to `currentColor` and need an explicit background variable (`--plot-background`) rather than inheriting | Directly relevant to this product's **map/legend marks**, which are the Leaflet/SVG equivalent of Observable's Plot marks: §5 explicitly keeps evidence/legend tokens as **their own resolved values per theme**, never `currentColor` or an inherited chrome colour, for exactly the reason Observable's own caveat names — a chart/map mark silently inheriting a text colour is a latent breakage the first time chrome text colour changes for an unrelated reason. |

**Pattern common to all four precedent systems, adopted here:** color is exposed as **named,
role-stable custom properties**; a theme is **a set of values for those names**, never a
different *set of names*; and no system reviewed collapses its data/chart/map-mark palette into
its UI chrome palette — every one of them keeps a separate data-colour scale from its UI scale,
which is the same separation K5 already established and this audit is not inventing.

---

## 5. Token architecture: UI-chrome vs. evidence/legend, kept strictly separate

Two token families, extending (not replacing) §2.1's existing set:

### 5.1 UI-chrome tokens (free to redefine per theme; carry no category meaning)

`--bg`, `--panel`, `--panel2`, `--line`, `--line2`, `--text`, `--muted`, `--text-meta`, plus **new**
tokens needed to close the gaps §2 found: `--surface-drawer` (replacing the evidence drawer's
hardcoded `#08101a`, §2.5), `--focus-ring` (replacing the 15-site literal `#9bd5ff`, §2.6),
`--leaflet-tooltip-bg`/`--leaflet-tooltip-border`/`--leaflet-attribution-bg`/`--leaflet-zoom-bg`
(replacing the Leaflet-chrome literals in §2.4), and a **badge-text** token separated from each
badge's category-tint background (closing the mixed-role defect in §2.2).

### 5.2 Evidence/legend tokens (frozen category meaning; rendered role governs the value)

The exact 16-token-name set in §2.1's Evidence/legend column. A theme may supply a different
literal value, but it must preserve category meaning, avoid judgement or implied ordering, and be
reviewed with sibling categories and redundant structural cues. Same-hue lightness adjustment is
a useful starting constraint for most categories, not an absolute rule: Lens A is currently
near-white and cannot retain that identity on near-white chrome, while map-boundary colours are
owned by the basemap palette rather than appearance. **No theme may silently reassign which token
a category uses or merge categories.** The applicable contrast threshold is determined from the
rendered consumer—4.5:1 normal text, 3:1 WCAG-large text or applicable essential graphics—not
from the token name.

### 5.3 What is explicitly NOT a token in either family

Spacing, radius and type-scale tokens (§2.1 Structural row) are untouched — they are not colour
and this gate does not touch K5's fixed pixel scale (§8 handles comfortable text size separately,
as a transform of the whole scale, not a per-token change).

---

## 6. Proposed tokens — light and dim-dark

### 6.1 Candidates (predictions, not final — §1, §12)

| Token | Current (dark, shipped) | Candidate — Dark (dim) | Candidate — Light |
|---|---|---|---|
| `--bg` | `#08101a` | `#0c1620` (slightly lifted off near-black, Primer's "dark dimmed" precedent, §4) | `#f4f6f9` |
| `--panel` | `rgba(8,16,27,.92)` | `rgba(16,26,38,.92)` | `rgba(255,255,255,.92)` |
| `--panel2` | `rgba(13,24,39,.90)` | `rgba(22,34,48,.90)` | `rgba(244,246,249,.92)` |
| `--line` / `--line2` | `rgba(255,255,255,.10)/.18` | unchanged | `rgba(16,24,34,.12)/.22` |
| `--text` | `#f3f7ff` | unchanged | `#16222f` |
| `--muted` | `#a9bbcf` | unchanged | `#445468` |
| `--text-meta` | `#9fb1c5` | unchanged | `#54657a` |
| `--surface-drawer` *(new)* | `#08101a` (currently hardcoded) | `#0c1620` | `#ffffff` |
| `--focus-ring` *(new)* | `#9bd5ff` | unchanged | `#0a63c7` |

**Why the earlier draft included a "dim-dark" candidate:** Primer provides precedent for a
distinct dimmed-dark token set. That does not make it a requirement for this product, whose issue
names only Light/Dark/System. The row is retained solely as an unapproved comparison. Phase B must
either justify and separately scope it or remove it; System must resolve to one documented Dark
appearance, not silently introduce an unreviewed fourth user-visible choice.

### 6.2 Evidence/legend candidates (light theme only shown; dark/dim keep shipped hex — §5.2 rule)

**Corrected per §3.** Only `--licence-neutral` (3.19) and `--museum` (3.09) clear the 3:1
flat-pair screening threshold unchanged. The other 13 require consumer-level investigation; a
new value is required only where the rendered use is in scope and fails its applicable threshold.
The following same-hue candidates show that a 3:1 essential-graphic option is arithmetically
possible for 12 of them; they are not text candidates or approvals:

| Token | Shipped (H / S / L) | Candidate light-theme hex | Candidate L | Ratio vs. `#f4f6f9` |
|---|---|---|---:|---:|
| `--b` | 193° / 100% / 63% | `#0098c0` | 38% | 3.10 |
| `--planning-neutral` | 213° / 16% / 73% | `#7e8da1` | 56% | 3.12 |
| `--planning-origin` | 271° / 19% / 77% | `#9984ac` | 60% | 3.10 |
| `--planning-unresolved` | 41° / 13% / 70% | `#958b77` | 53% | 3.11 |
| `--info` | 266° / 100% / 81% | `#ab6aff` | 71% | 3.11 |
| `--stay` | 207° / 100% / 62% | `#028dff` | 50% | 3.10 |
| `--activity` | 342° / 100% / 74% | `#ff3f79` | 62% | 3.11 |
| `--hospitality` | 275° / 100% / 77% | `#bd5fff` | 69% | 3.11 |
| `--heat` | 34° / 100% / 65% | `#d17500` | 41% | 3.10 |
| `--park` (and `--green`, identical hex) | 148° / 63% / 65% | `#259f5f` | 38% | 3.13 |
| `--bike` | 161° / 71% / 61% | `#1b9e75` | 36% | 3.13 |
| `--rail` | 42° / 100% / 70% | `#b98200` | 36% | 3.10 |
| `--a` (Lens A) | 210° / 100% / 98% | **not mechanically derived — see §3's note** | — | — |

**What this table is, concretely:** proof that a same-hue descent exists and clears the floor for
every token except `--a`. It is **not** a palette ready to ship — every value here is a flat pair
against a flat candidate background, unverified against real composited surfaces (§1, §12), and the
candidate background itself (`#f4f6f9`) is not yet reviewed. `--a` is excluded from the mechanical
method entirely and requires its own design decision (§3).

### 6.3 Lens B candidate evaluation

Method: WCAG 2.x sRGB relative luminance, without rounding before the final ratio. The flat light
background is `#f4f6f9`. A representative primary panel is `rgba(255,255,255,.92)` composited
over it (`rgb(254.12,254.28,254.52)`); the secondary panel candidate composites back to
`#f4f6f9`. The final column uses an 8% tint derived from the same candidate over the primary
panel, representing the current active-button/badge pattern. These are modelled surfaces, not DOM
measurements.

| Lens B value | Flat `#f4f6f9` | Primary panel | Secondary panel | Own 8% tint | Appropriate interpretation |
|---|---:|---:|---:|---:|---|
| shipped `#43d7ff` | 1.564 | 1.683 | 1.564 | 1.607 | Fails both text and applicable essential-graphic thresholds on these light surfaces. |
| audit candidate `#0098c0` | 3.102 | 3.338 | 3.102 | 3.048 | Candidate for essential non-text marks with margin risk; **not** normal text. |
| alternative `#00718f` | 5.161 | 5.552 | 5.161 | 4.958 | Clears normal-text arithmetic on these modelled surfaces; still not automatically approved. |

`#0098c0` is insufficient wherever Lens B is normal-sized text, including the current 10px
comparison label. `#00718f` provides numerical margin for text and graphics, but darkening B also
makes its grayscale luminance more similar to the Lens A candidates below and may make thin marks
less salient over heterogeneous map imagery. Rendering, local compositing, font weight,
anti-aliasing, map-tile backgrounds and category-neighbour comparisons remain unresolved. A
single B token may therefore be the wrong architecture: text, panel graphics and map/SVG marks
may need role-specific values under a shared Lens B identity.

### 6.4 Lens A conceptual options

Lens A's shipped `#f7fbff` is functionally white and has no useful light-chrome equivalent.
Two defensible concepts are carried forward, without selecting a production palette:

| Concept | Value | Flat light ratio | Primary-panel ratio | Relation to B `#0098c0` / `#00718f` | Assessment |
|---|---:|---:|---:|---:|---|
| Existing light-basemap navy | `#123b5f` | 10.678 | 11.488 | pairwise 3.442 / 2.069 | Strong light-surface text/graphic contrast and architectural reuse; both A and B remain blue-family, so rendered identity and map/UI ownership need review. |
| Neutral graphite | `#343a40` | 10.627 | 11.433 | pairwise 3.425 / 2.059 | Strong UI legibility and hue separation from cyan B; risks weakening A's established cool identity and looking like generic chrome rather than evidence identity. |

The navy and graphite have almost identical relative luminance (0.04083 and 0.04126), so they are
effectively indistinguishable from each other in grayscale; that is acceptable because they are
alternatives, not simultaneous categories. Against `#0098c0`, each has about a 3.4:1 luminance
separation; against darker text-safe `#00718f`, separation falls to about 2.06:1. The A/B system
must therefore retain explicit "Lens A"/"Lens B" labels and its existing solid-versus-dashed
structure. K5 permits category colour but forbids colour-only meaning and reserves B's dashed
distinction; both concepts can be compatible only if those contracts remain. Neither option is
approved until rendered across panel surfaces, halos, markers and every basemap, including a
grayscale review.

### 6.5 What these tables are not

They do not select production hex values or prove a complete palette. They establish only that
same-hue graphic candidates can be computed for most categories, that Lens B needs a darker value
for normal text than for a 3:1 graphic screen, and that Lens A has at least two defensible concept
directions with different identity risks. Rendered evidence—not arithmetic alone—must decide.

---

## 7. The "Appearance" control, System detection and the no-flash contract

### 7.1 Naming (settled per issue #102)

A new control labelled **"Appearance"** (ES: *"Apariencia"*), with three states **Light / Dark /
System** (ES: *Claro / Oscuro / Sistema*), placed in the header tools area alongside — not
replacing or relabeling — the existing base-map `<select>` (`index.html:39-41`, unchanged
wording "Light · CARTO Positron" / "Dark · CARTO Dark Matter"). The two controls must be visually
and spatially distinct enough that a screen-reader user and a sighted user both encounter them as
unrelated settings; a shared visual grouping (e.g. both inside one "Map" fieldset) would recreate
the naming collision at the layout level even with different words.

### 7.2 Mechanism (design only — not implemented here)

- A single attribute, `data-appearance="light|dark"` on `<html>`, is what CSS actually reads (two
  concrete values only — "system" is resolved to one of these two before the attribute is set, it
  is never a third CSS branch).
- **Resolution order:** an explicit stored preference (new key, e.g. `APPEARANCE_STORAGE_KEY`,
  same read/write/reset pattern as `PANEL_SIZE_STORAGE_KEY`, §2.8) overrides; absent that,
  `window.matchMedia("(prefers-color-scheme: dark)").matches` decides; a live `change` listener on
  that media query updates the resolved attribute **only while the user's choice is "System"** —
  switching the OS theme must not silently override an explicit manual Light/Dark choice.
- **No-flash-of-incorrect-theme:** the attribute must be set by a small, synchronous, inline
  `<script>` in `<head>`, before any stylesheet paints, reading only `localStorage` and
  `matchMedia` (no network, no dependency on `js/app.js` having loaded) — the standard pattern
  used by every system in §4 that supports System detection. This is a Phase B implementation
  requirement, stated here so the draft PR's review checklist includes it; no such script exists
  today (§2.8).

### 7.3 What is independent, and what must stay independent

- Appearance and the base-map `<select>` are **read and written independently**; selecting a
  basemap must never change `data-appearance`, and vice versa.
- Appearance must not alter evidence computation, rendered geometry, basemap selection or HATI.
  It may resolve CSS values for panel consumers, but Lens boundaries remain basemap-owned and
  SVG halos/markers/application overlays require explicit consumer decisions (§2.5); they do not
  inherit `--a`/`--b` automatically and must never be substituted with a generic chrome colour.

---

## 8. Comfortable text size — an amendment to K5, not a silent override

K5 (`docs/VISUAL_LANGUAGE.md`) states the 7 type tokens are fixed pixel values, with a 10px floor,
and that "nothing may render below 10px at any viewport." A user-selectable comfortable size
necessarily varies rendered px, so this document proposes resolving the tension by scope, not by
breaking the rule silently:

- **Mechanism:** a user-chosen **scale multiplier**, applied once at the root (e.g. `html{
  font-size: calc(100% * var(--text-scale-multiplier))}`), with every `--t-*` token redefined in
  `rem` rather than `px` so they all move together. **Token roles, relative hierarchy and the
  10px-floor *intent* are preserved**; what changes is which absolute px that floor and every
  other step correspond to, for a user who has asked for larger text.
- **Bounded steps**, not a continuous slider (keeps it testable and keeps the floor meaningful at
  every step): candidates **100% / 112% / 125%**, which is deliberately modest — three fixed steps
  rather than open-ended scaling, so `--t-micro` at the largest step (10px × 1.25 = 12.5px) still
  reads as the same *role* (lowest-priority metadata), not a redesign of the hierarchy.
- **This is a documented amendment to K5's "fixed pixel values" clause**, not an exception quietly
  taken. If reviewed and accepted, K5 should be updated in the same PR that implements it to say
  the seven tokens are fixed **relative to the user's chosen text-size step**, with the floor
  restated as 10px at the 100% step.
- **Independent of WCAG 2.2's 200%-resize requirement** (Success Criterion 1.4.4, carried from
  WCAG 2.1, re-confirmed in scope for 2.2): browser-level 200% zoom/text-resize is a *different*,
  mandatory baseline the product must already support (or fix if it does not) regardless of
  whether this optional in-app control ships. **This document does not establish whether 200%
  browser zoom currently reflows correctly** — that is an existing, unaudited gap, flagged for
  Phase B's acceptance criteria (§13), not something this control substitutes for.

---

## 9. Reproducibility of every figure in this document

The following self-contained script enumerates all 15 distinct shipped evidence/legend values,
states the hypothetical light background, implements the WCAG sRGB-to-linear transfer and
relative-luminance formula, reports every pair, and makes the `--park`/`--green` duplicate
explicit. Save it as `contrast.mjs` and run `node contrast.mjs`:

```js
const PAIRS = Object.freeze({
  "--a": "#f7fbff", "--b": "#43d7ff", "--planning-neutral": "#aeb8c4",
  "--licence-neutral": "#c0794f", "--planning-origin": "#c4b8cf",
  "--planning-unresolved": "#bdb7aa", "--museum": "#9d72ff", "--info": "#c79cff",
  "--stay": "#3da8ff", "--bike": "#54e2b5", "--rail": "#ffd166",
  "--activity": "#ff7aa2", "--park (--green duplicate)": "#70dea4",
  "--hospitality": "#d08cff", "--heat": "#ffb04a"
});
const DARK = "#08101a";
const LIGHT = "#f4f6f9"; // hypothetical flat light background, not rendered UI
function rgb(hex) {
  const value = hex.replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(value)) throw new Error(`bad hex ${hex}`);
  const n = Number.parseInt(value, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function relativeLuminance(hex) {
  const [r, g, b] = rgb(hex).map((value) => {
    const srgb = value / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
let below = 0;
console.log(`hypothetical light background: ${LIGHT}; shipped dark background: ${DARK}`);
for (const [name, value] of Object.entries(PAIRS)) {
  const dark = contrast(value, DARK);
  const light = contrast(value, LIGHT);
  if (light < 3) below += 1;
  console.log(`${name.padEnd(28)} ${value} dark=${dark.toFixed(2)} light=${light.toFixed(2)} screen=${light < 3 ? "BELOW" : "MEETS"}`);
}
console.log(`summary: ${below}/${Object.keys(PAIRS).length} distinct pairs below 3:1 on ${LIGHT}`);
console.log("duplicate: --green is #70dea4, identical to --park, so it is not counted twice");
for (const value of ["#43d7ff", "#0098c0", "#00718f"])
  console.log(`Lens B ${value} vs ${LIGHT} = ${contrast(value, LIGHT).toFixed(3)}`);
```

Executed output on Node v24.11.0:

```text
hypothetical light background: #f4f6f9; shipped dark background: #08101a
--a                          #f7fbff dark=18.37 light=1.04 screen=BELOW
--b                          #43d7ff dark=11.28 light=1.56 screen=BELOW
--planning-neutral           #aeb8c4 dark=9.51 light=1.86 screen=BELOW
--licence-neutral            #c0794f dark=5.54 light=3.19 screen=MEETS
--planning-origin            #c4b8cf dark=10.10 light=1.75 screen=BELOW
--planning-unresolved        #bdb7aa dark=9.57 light=1.84 screen=BELOW
--museum                     #9d72ff dark=5.72 light=3.09 screen=MEETS
--info                       #c79cff dark=8.76 light=2.01 screen=BELOW
--stay                       #3da8ff dark=7.50 light=2.35 screen=BELOW
--bike                       #54e2b5 dark=11.75 light=1.50 screen=BELOW
--rail                       #ffd166 dark=13.25 light=1.33 screen=BELOW
--activity                   #ff7aa2 dark=7.78 light=2.27 screen=BELOW
--park (--green duplicate)   #70dea4 dark=11.53 light=1.53 screen=BELOW
--hospitality                #d08cff dark=8.07 light=2.19 screen=BELOW
--heat                       #ffb04a dark=10.52 light=1.68 screen=BELOW
summary: 13/15 distinct pairs below 3:1 on #f4f6f9
duplicate: --green is #70dea4, identical to --park, so it is not counted twice
Lens B #43d7ff vs #f4f6f9 = 1.564
Lens B #0098c0 vs #f4f6f9 = 3.102
Lens B #00718f vs #f4f6f9 = 5.161
```

The 13/15 result is **numerical reproduction only**. It neither resolves SC 1.4.11 applicability
nor measures rendered text, alpha compositing, anti-aliasing, SVG paint order, map tiles or
browser forced-colours behaviour. Browser accessibility validation requires actual components,
computed styles, adjacent rendered colours and interaction states across the §13 matrix.

---

## 10. Migration path — bounded increments for Phase B

The earlier single T-a proposal treated hundreds of literal-bearing lines as one low-risk refactor.
That is not defensible. The following are **future implementation proposals only**; this gate
implements none of them. Each increment is separately reviewable and must preserve exact computed
dark-theme styles unless its own approved scope says otherwise.

### T-a0 — inventory and visual baselines (documentation only)

- **Scope:** produce a machine-readable selector/property/value inventory; classify each consumer
  as chrome, panel A/B identity, basemap boundary, marker/SVG/map overlay, or third-party Leaflet;
  record shared literals, inheritance, alpha layers, pseudo-elements and high-risk selectors.
  Capture reproducible baseline screenshots and computed-style assertions for all §13 surfaces,
  appearances currently possible (dark only), basemaps, widths, languages and interaction states.
- **Dependencies:** the exact accepted Phase A document and a pinned `main` SHA.
- **Exclusions:** no CSS/HTML/JS/test change, token creation, palette selection or visual change.
- **Risks:** incomplete dynamic states, nondeterministic map tiles/fonts, and false equivalence
  between a literal count and a consumer count.
- **Acceptance:** every source literal maps to at least one owner or an explicit third-party/out-of-
  scope classification; baseline commands, viewport, data state and artifact names reproduce;
  A/B and focus consumers have computed-style assertions in addition to screenshots.
- **Rollback:** documentation-only commit can be reverted with no production effect.
- **Advance condition:** reviewer approves inventory completeness and baseline reproducibility;
  unresolved ownership blocks T-a1 rather than being guessed.

### T-a1 — shared UI chrome

- **Scope:** header, rail/panels, generic cards/surfaces, generic typography, borders and form
  chrome only; introduce role tokens while preserving current dark computed values exactly.
- **Dependencies:** accepted T-a0 inventory/baselines and stable K5 tests.
- **Exclusions:** evidence drawer/focus, category badges, A/B identity, SVG/map marks, Leaflet
  chrome, appearance switching and text scaling.
- **Risks:** inheritance changes, alpha-order differences, selector-specific overrides and
  accidental changes to provenance/admin/licence text.
- **Acceptance:** scoped computed styles equal baseline; pixel diffs are either zero or explained
  rendering noise; Node and relevant browser suites pass; no out-of-scope selector changes.
- **Rollback:** one isolated commit reverting only T-a1 token declarations/usages.
- **Advance condition:** dark baseline parity and reviewer-confirmed diff scope; otherwise hold.

### T-a2 — evidence drawer and focus

- **Scope:** drawer/backdrop/sticky heading/provenance surfaces plus every application-owned
  `:focus-visible` treatment; introduce drawer/focus role tokens with current dark output preserved.
- **Dependencies:** T-a1 surface tokens and T-a0 focused/open-drawer baselines.
- **Exclusions:** evidence badge identities, A/B palette, Leaflet/SVG focus, theme control and
  scientific content.
- **Risks:** modal stacking/compositing, sticky content obscuring focus, inconsistent separation
  rings and forced-colours suppression.
- **Acceptance:** keyboard path and focus visibility on every drawer/control state; SC 2.4.11
  focus-not-obscured check; forced-colours inspection; computed drawer surfaces match baseline;
  no focus literal remains without an explicit exception.
- **Rollback:** revert the isolated drawer/focus commit; prior generic chrome remains valid.
- **Advance condition:** focus and modal checks pass in both languages at responsive widths.

### T-a3 — evidence badges and Lens identities

- **Scope:** category badge foreground/tint/border roles, panel labels/legends, A/B buttons and
  relevant application SVG/halo consumers; preserve category meaning and structural distinctions.
- **Dependencies:** approved consumer ownership from T-a0, stable surfaces from T-a1/T-a2, and
  rendered palette evidence for §6 candidates.
- **Exclusions:** `LENS_BASEMAP_STYLES`, basemap tiles, Leaflet controls, geometry, calculations,
  category reassignment and final light-theme activation.
- **Risks:** text and graphics sharing an under-strength token, alpha tints collapsing identity,
  A/B convergence in grayscale, and JS-injected SVG colours drifting from CSS.
- **Acceptance:** per-consumer SC 1.4.3/1.4.11 applicability ledger; correct thresholds on rendered
  surfaces; labels plus solid/dashed/pattern cues persist; A/B and category screenshots/computed
  styles pass in ES/EN; no scientific meaning changes.
- **Rollback:** revert T-a3 as one identity-layer commit without reverting chrome foundations.
- **Advance condition:** human visual review plus automated rendered checks approve all identity
  consumers; unresolved A/B palette keeps T-a3 and later appearance work on hold.

### T-a4 — Leaflet/application map chrome

- **Scope:** application overrides for zoom, tooltip, attribution and application-owned map
  overlays/labels; establish explicit ownership boundaries with basemap-dependent boundaries.
- **Dependencies:** T-a0 map-state baselines and accepted T-a1–T-a3 role separation.
- **Exclusions:** tile providers, geometry, pane order, interaction, `LENS_BASEMAP_STYLES` values
  unless separately authorized, HATI and third-party internals not overridden by the app.
- **Risks:** heterogeneous tile contrast, excluded selectors in the current browser audit,
  tooltip arrows/hover states, attribution legibility and appearance/basemap coupling.
- **Acceptance:** all three basemaps at required appearance states; zoom/tooltip/attribution and
  owned overlays explicitly tested; no appearance action changes basemap or geometry; tile/API
  requests and map state remain unchanged.
- **Rollback:** isolated map-chrome commit; restore exact prior overrides without touching T-a1–3.
- **Advance condition:** the full §13 appearance×basemap×surface matrix passes and a reviewer
  confirms no theme/basemap coupling. Only then may a separate Appearance implementation be
  planned.

---

## 11. Test-suite implications

The existing Playwright contrast audit (`browser-tests/visual-language.browser.mjs`) composites
every translucent ancestor over **one hardcoded fallback**, `[8, 16, 26, 1]` (`#08101a`), read
directly from its `background()` function. This fallback **is** the dark theme's `--bg` value,
hardcoded rather than read from the page. For Phase B:

- The fallback must become **theme-aware** — either read `getComputedStyle(document.documentElement)
  .getPropertyValue("--bg")` at audit time, or run the whole audit twice, once per
  `data-appearance` value, with its own correct fallback each time.
- **Resolved on review:** `tests/lens_contrast.test.mjs` (42 lines) and `tests/visual_language.test.mjs`
  (158 lines) have now been read in full. Neither hardcodes a `#08101a`-style background fallback —
  `lens_contrast.test.mjs` asserts against literal stroke/fill hex values in `js/app.js`'s
  `LENS_BASEMAP_STYLES` (§2.5's new note), not against a composited background, and
  `visual_language.test.mjs` asserts token/structure rules (exactly 7 type tokens, 4 spacing + 2
  radius tokens, no literal font-size, no judgement-coded colour words) with no background
  compositing at all. **The hardcoded-fallback gap is confirmed isolated to
  `browser-tests/visual-language.browser.mjs`'s `background()` function**, as originally stated —
  this is a correction from "not yet read" to "read and confirmed," not a change in the conclusion.
  One consequence found in `visual_language.test.mjs:67-74` worth flagging for Phase B: it already
  forbids colour-adjacent words `success|error|warning|danger|positive|negative|good|bad|stale|
  fresh|ahead|behind|delayed|complete` inside any selector touching phase/freshness/change/edition
  rules — an "Appearance" implementation must not introduce a rule matching those selectors with a
  judgement word in its declarations (e.g. a hypothetical `.phase.success{color:var(--text-dark)}`
  would fail this existing test, which is correct and must stay that way).
- The existing suite's `excluded` selector list (`svg,svg *,.leaflet-control,.leaflet-control *,
  .leaflet-tooltip,.leaflet-tooltip *,option,script,style,.sr-only,.sr-only *`) must be re-examined
  once Leaflet chrome is explicitly themed (§2.4) — excluding `.leaflet-control` was reasonable when
  only one theme existed and Leaflet defaults were visually subordinate; a themed `.leaflet-control`
  with wrong-theme colours would currently pass this test by being excluded from it.
- Verification for this correction: `node --test tests/lens_contrast.test.mjs
  tests/visual_language.test.mjs` → **15 pass, 0 fail**; `node --test tests/*.test.mjs` →
  **1,011 pass, 0 fail**; focused `node --test --test-concurrency=1
  browser-tests/visual-language.browser.mjs` → **10 pass, 0 fail** across its six widths and
  interaction/focus/motion/phase checks. The full multi-file `npm run test:browser` suite was not
  run because this is a one-document correction and the focused visual-language browser baseline
  is the relevant rendered regression. No proposed light theme exists for either suite to test.

---

## 12. Residual risks and what remains untested

| Risk | Status |
|---|---|
| Real composited contrast of candidate light-theme values over actual translucent layers (not flat pairs) | **Untested.** §1, §9. Phase B's implementation PR must re-run (or extend) `browser-tests/visual-language.browser.mjs` against the built theme before claiming AA. |
| Runtime cost of swapping ~15+ custom-property values and toggling `data-appearance` | **Untested.** No measurement taken; expected cheap (CSS custom-property changes trigger style recalculation, not layout, for color-only properties) but not verified against the product's own frame budget (`docs/RUNTIME_DECISION_SPIKE.md`). |
| `forced-colors` (Windows High Contrast) mode | **Not audited.** The task's acceptance list names it explicitly; this document does not establish current behaviour, which may already be broken independent of this theme work (category colours and custom borders are exactly what `forced-colors` typically overrides). Route to Phase B's acceptance checklist (§13), not assumed fixed by it. |
| WCAG 2.4.11 Focus Not Obscured, evidence drawer vs. sticky chrome | **Not audited** beyond the architectural note in §4/§7. |
| Whether "System" should resolve dark preference to the original near-black or the new "dim" variant | **Open product decision**, not resolved here (§6.1). |
| ES/EN strings for "Appearance"/"Apariencia" and text-size control labels | **Draft only** (§7.1); not yet entries in `js/shell-copy.js`, not reviewed for the natural, non-machine-literal quality the post-K13 audit praised in existing ES copy. |
| Lens A has no useful same-hue light-theme equivalent; §6.4's navy and graphite concepts have not been rendered with either Lens B candidate | **Open design decision; concepts evaluated arithmetically, not approved.** |
| Whether the 12 mechanically-derived candidates in §6.2 look acceptable once rendered (same-hue descent can land on an unexpectedly muddy or over-dark value at the extremes, e.g. `--rail` and `--bike` near L36–38%) | **Untested — arithmetic only, not a design review of the resulting colours.** |
| Real iPad/Safari/WebKit hardware rendering of any candidate | **NOT TESTED**, consistent with every prior gate in this repository. |

---

## 13. Acceptance criteria for Phase B

Phase B must execute and report the Cartesian matrix below; sampling one convenient combination
does not satisfy the gate.

| Axis | Required values |
|---|---|
| Appearance | Light; Dark; System resolved to Light; System resolved to Dark |
| Basemap | Light; Dark; Satellite |
| Information surface | PLACE; COMPARE; CITY; Evidence & limits drawer; Lens A/B labels; SVG halo metrics; source/provenance disclosures; administrative planning and licence surfaces |

At every relevant matrix cell and at responsive widths (including 360, 420, 560, 850, 1100 and
1440px), the following are acceptance requirements:

- **Correct WCAG 2.2 AA interpretation:** normal text ≥4.5:1, WCAG-large text ≥3:1, and essential
  graphical objects/UI component indicators ≥3:1 where SC 1.4.11 applies. Decorative/exempt uses
  are identified with rationale; passing a source-hex screen is not accepted as component proof.
- **Keyboard and focus:** complete keyboard operation; visible focus against each adjacent surface;
  focus not entirely obscured by sticky/fixed content (SC 2.4.11); dialog open/close and return
  focus verified.
- **Resize and layout:** browser zoom at 200% independently passes; each optional comfortable
  text-size setting also passes at 100% and 200% browser zoom without lost content, clipping,
  overlap or two-dimensional scrolling except where WCAG permits it.
- **Forced colours and motion:** usable focus, boundaries, controls and state distinctions under
  `forced-colors: active`; no required meaning depends on author colour; any new motion collapses
  under `prefers-reduced-motion: reduce`.
- **Responsive and localized behaviour:** ES and EN labels, wrapping and control names pass at all
  responsive layouts; category meaning and provenance remain complete.
- **A/B and category integrity:** explicit labels and solid/dashed/shape/pattern cues remain;
  grayscale review does not collapse the structural interpretation; Gate-L neutrals acquire no
  ordering or judgement.
- **Independence:** appearance choice never changes basemap and basemap never changes appearance.
  System resolution only follows the OS while System is selected. Cold-load traces show no
  incorrect-theme frame for all four appearance cases.
- **Scientific regression:** no evidence calculation, state, scope, date, rounding, withholding,
  abstention, geometry, provenance, export, URL-state meaning, interpretation ceiling or HATI
  behaviour changes. Node and browser suites remain green, and network/data requests are stable.
- **Performance:** theme/text controls introduce no measured interaction-to-paint or frame-time
  regression against the repository's declared device classes and runtime method.

Chromium viewport/touch emulation is useful matrix coverage but **does not equal validation on a
real iPad running Safari/WebKit**. Real iPad/Safari hardware remains explicitly NOT TESTED until a
physical-device run is reported; emulation must never be used to close that gap.

---

## 14. Gate verdict

**This document is a design/audit artifact only and authorizes no implementation.** Per the task's
own instruction, it is submitted as a **Draft PR containing only this document**, for review
against issue #102, before any Phase B code is written.

Within its evidence limits, the corrected audit is suitable for Phase A review: it reports a
reproducible 13/15 **screening** result without converting it into 13 WCAG violations; records the
separate A/B ownership paths; carries text-safe and graphic-only candidates with their trade-offs;
and makes later work conditional on rendered evidence. No candidate is a production decision and
no shipped-conformance claim is made.

**Phase A audit acceptance recommendation: GO**, subject to human review of this corrected Draft
PR. **Future T-a0 planning recommendation: GO** for the documentation-only inventory and baseline
work in §10. **T-a1 and all later implementation remain HOLD** until T-a0 is reviewed and explicit
authorization is given. This verdict does not authorize Phase B, a new issue/PR, merge or deploy.
