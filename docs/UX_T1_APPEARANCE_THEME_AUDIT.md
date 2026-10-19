# UX-T1 — Appearance theme (Light/Dark/System) design & accessibility audit

Status: **design/audit gate only** (issue [#102](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/issues/102)).
Follows the Post-K13 gate convention
(`docs/POST_K13_PRODUCT_UX_VALIDATION.md`, `docs/POST_K13_P0_P1_DESIGN_PROTOTYPE.md`). This
document changes **no production CSS, JS, HTML, test, dataset, model, scope, date, withholding
rule, abstention, derivation or interpretation ceiling**, and it does **not** touch HATI. Its
sole artifact is this document. No implementation is authorized by it.

- **Baseline:** `main` @ `028d038` (merge of PR #100, P1 small-screen IA).
- **Designed:** 19 October 2026. **Reviewed and corrected same day**, before human review: an
  independent re-run of this document's own §9 script against the full evidence/legend token set
  found the original §3/§6.2 undercounted contrast failures (reported 5 of 10; actually 13 of 15),
  missed the existing `LENS_BASEMAP_STYLES` basemap-adaptive Lens-circle mechanism (§2.5), and had
  not yet read the two Node-side test files it flagged as a gap (§11, now closed). All three are
  corrected in place below rather than left as a separate addendum, with the correction itself
  stated inline at point of use (§2.5, §3, §11) so the reasoning is auditable.
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
| Source reading of `css/app.css` (1,196 lines), `index.html` (847 lines), and the theme-relevant parts of `js/app.js` | ✅ | Exact selectors, token declarations, literal colour census, breakpoints, focus rules, existing persistence patterns |
| Confirming no existing theme/appearance-switching code | ✅ | `grep` for `matchMedia`, `prefers-color-scheme`, `data-theme`, theme-related `localStorage` keys across `js/app.js` and `index.html` — **none found** except `prefers-reduced-motion` (unrelated) and the pre-existing `PANEL_SIZE_STORAGE_KEY` (a reusable persistence *pattern*, not a theme) |
| WCAG relative-luminance arithmetic over literal values already shipped | ✅ | Exact, reproducible contrast ratios for the **current, shipped** dark theme (§3, §6) |
| WCAG relative-luminance arithmetic over **candidate** light-theme values | ✅ | A falsifiable prediction for an unbuilt theme — not a measurement of anything rendered |
| Research of WCAG 2.2, Esri Calcite, GitHub Primer, IBM Carbon, Observable Framework | ✅ | External precedent for the token architecture and migration strategy (§4) |
| Rendering anything proposed here in a browser | ❌ | — |
| Running the existing Playwright contrast suite (`browser-tests/visual-language.browser.mjs`) against any proposed change | ❌ | Phase A changes no file the suite reads; it was read, not re-run, to confirm its mechanics (§11) |
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
the "colour is category, never judgement" rule in `docs/VISUAL_LANGUAGE.md` governs. **These 16
tokens must never be redefined to mean something different between themes** — only their
*luminance*, not their *hue family or category membership*, may change to clear contrast on a
different background (§3, §6.2).

### 2.2 Hardcoded colour literals outside the token set

`css/app.css` contains **320 distinct lines** with a raw `#hex` or `rgb(a)` literal not routed
through a custom property — against **26 declared colour tokens**. This is real migration debt:
a literal-colour reskin is not a drop-in `:root` swap. The most frequent literals and their
approximate selector families:

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

**Missing prior art, found during review and material to §5/§6:** `js/app.js:2128–2161` already
defines `LENS_BASEMAP_STYLES` — a `{light, satellite, dark}` table giving the Lens A/B circle its
own `color` (stroke) and `fillColor`/`fillOpacity` **per basemap**, applied by
`applyLensBasemapStyle()` and verified by `tests/lens_contrast.test.mjs` ("lens contrast adapts to
light satellite and dark basemaps"). Concretely, Lens A's stroke is `#123b5f` on the light basemap,
`#ffffff` on satellite, and its *fill* is `#3da8ff` on light — none of which is `var(--a)`
(`#f7fbff`). **This means two things the rest of this document must be read against:**

1. The Lens circle's own rendering is **already basemap-adaptive by design**, independent of any
   `--a`/`--b` CSS custom property. This is a second, pre-existing axis of colour variation (basemap
   choice) that Phase B's new third axis (UI appearance) must compose with, not duplicate. The
   likely-correct design (not decided here) is that `LENS_BASEMAP_STYLES` stays keyed on basemap
   only — because the Lens boundary's legibility need is against the **map tiles**, which an
   "Appearance" (chrome) switch does not change — while `--a`/`--b` (and the rest of §5.2's set)
   separately gain per-appearance light/dark values for **panel-rendered** badges, text and dots.
2. §3's `--a`/`--b` contrast analysis is therefore scoped to the **panel/badge** use of those
   tokens, not to the map-rendered Lens circle, which already has its own light-basemap-safe values
   (`#123b5f`, `#3da8ff`) verified by the existing test. Phase B should check whether those
   existing light-basemap values already satisfy a light-appearance panel badge too, before
   inventing a fourth colour where a verified one already exists.

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

> **Correction (post-draft independent re-verification).** The first version of this document
> computed this section's table for only 7 of the 15 evidence/legend hues and reported "5 of 10
> fail" from that partial sample. An independent re-run of this document's own §9 script, against
> every evidence/legend hue and the exact candidate background cited in §6.1, found the opposite of
> reassuring: **13 of 15 fail**, not 5. The corrected table below replaces the original. This matters
> beyond arithmetic hygiene — the original undercount would have let Phase B treat 8 category
> colours as "already fine," when in fact only 2 are. Nothing downstream of this section (the
> candidate-shape argument, the migration path, the acceptance criteria) changes in kind, but the
> **scale** of the work the candidates in §6.2 represent is much larger than first stated, and one
> token (`--a`, Lens A) turns out to need a materially different treatment, not a lightness tweak
> (see the note after the table).

Fifteen evidence/legend hues were checked (`--a`,`--b`,`--planning-neutral`,`--licence-neutral`,
`--planning-origin`,`--planning-unresolved`,`--museum`,`--info`,`--stay`,`--bike`,`--rail`,
`--activity`,`--park`,`--hospitality`,`--heat`; `--green` is excluded as an exact duplicate hex of
`--park`, `#70dea4`). All fifteen were chosen to clear WCAG's 3:1 non-text/large-text floor against
`#08101a`, and every one of them does, comfortably — several exceed 10:1 (§9, reproducible). **They
were not chosen against any other background, because no other background has existed until now.**

Computing the same ratios against a plausible light-theme background (`#f4f6f9`, a candidate
near-white — §6.1) **with the hue held exactly fixed**, reproduced independently of the shipped
`browser-tests/visual-language.browser.mjs` helper (§9 script, run against every token, not a
sample):

| Token | Ratio vs. `#08101a` (shipped) | Ratio vs. candidate `#f4f6f9`, same hex | AA non-text (3:1)? |
|---|---:|---:|---|
| `--a` (Lens A) | 18.37 | **1.04** | **FAILS — see note below** |
| `--b` (Lens B) | 11.28 | **1.56** | **FAILS** |
| `--planning-neutral` | 9.51 | **1.86** | **FAILS** |
| `--planning-origin` | 10.10 | **1.75** | **FAILS** |
| `--planning-unresolved` | 9.57 | **1.84** | **FAILS** |
| `--info` | 8.76 | **2.01** | **FAILS** |
| `--stay` | 7.50 | **2.35** | **FAILS** |
| `--activity` | 7.78 | **2.27** | **FAILS** |
| `--hospitality` | 8.07 | **2.19** | **FAILS** |
| `--heat` | 10.52 | **1.68** | **FAILS** |
| `--park` | 11.53 | **1.53** | **FAILS** |
| `--bike` | 11.75 | **1.50** | **FAILS** |
| `--rail` | 13.25 | **1.33** | **FAILS** |
| `--licence-neutral` | 5.54 | 3.19 | passes (barely) |
| `--museum` | 5.72 | 3.09 | passes (barely) |

**Only 2 of 15 pass unchanged.** `--licence-neutral` and `--museum` are not representative of the
set; they happen to sit at the low-lightness/high-saturation end of the shipped palette. Treat
every other evidence/legend hue as needing a light-theme value, not as an exception.

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

**Five of ten category hues, held at their exact shipped hex value, fail AA non-text contrast on
a plausible light background.** This is not a cosmetic detail: it means a light theme **cannot**
be "the same colours on a white background" — a literal colour-only inversion would silently make
Lens B, the planning-ámbito neutral, the origin-marker neutral, the hospitality-stay colour and
the Metro/Cercanías colour illegible or non-conformant exactly where K5 says colour alone is never
sufficient *anyway*, compounding an accessibility failure onto a semantic one.

**What must not happen in response:** reassigning any of these hues to a *different* category, or
abandoning the hue family to "whatever is legible." Both would violate K5's "colour is category,
never judgement" contract and the Gate-L neutral-hue separation.

**What the arithmetic supports instead:** each failing hue has a lightness-adjusted variant, same
hue angle and saturation, that clears 3:1 on the candidate background (§6.2, computed in §9):

| Token | Shipped (dark-theme) hex | Candidate light-theme hex (same hue/sat, lower lightness) | Ratio vs. `#f4f6f9` |
|---|---|---|---:|
| `--b` | `#43d7ff` (HSL L 63%) | `#0099c3` (L 38%) | 3.06 |
| `--planning-neutral` | `#aeb8c4` (L 73%) | `#7f8fa2` (L 57%) | 3.05 |
| `--planning-origin` | `#c4b8cf` (L 77%) | `#9984ac` (L 60%) | 3.10 |
| `--stay` | `#3da8ff` (L 62%) | `#058fff` (L 51%) | 3.04 |
| `--rail` | `#ffd166` (L 70%) | `#bd8400` (L 37%) | 3.00 |

This is the shape of the correct solution: **a per-theme lightness variant of each evidence
token, same hue and saturation, each independently meeting the floor for its own use (3:1 for
non-text/large, 4.5:1 if a token is ever used for body text) against its own theme's background.**
It is a prediction to be verified by rendering, not a final palette — the candidate background
itself (§6.1) is not yet reviewed, and real composited surfaces (panel tints, badge backgrounds)
will differ from a flat pairing. But the *shape* of the fix — lightness-only adjustment per theme,
hue and category identity frozen — is the part this audit can already support arithmetically, and
it is the one constraint a safe migration path must hold to.

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

### 5.2 Evidence/legend tokens (frozen category identity; only lightness varies per theme)

The exact 16-token set in §2.1's Evidence/legend column. **Rule, binding on Phase B:** a theme may
supply a different *hex value* for `--stay` or `--planning-neutral`, but the value must (a) stay
within the same hue family (±~10° hue, same relative saturation ordering against its siblings) and
(b) independently clear its own contrast floor against that theme's own background. **No theme may
reassign which token a category uses, merge two categories' tokens, or introduce a theme-only
colour that has no counterpart in the other theme.** This is the direct continuation of K5's
"colour is category, never judgement" and Gate-L's "no theme reassigns a neutral" contracts into a
two-theme world.

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

**Why a "dim-dark" and not only one dark variant:** the task names "dim-dark" explicitly, and
Primer's precedent (§4) is exactly a *second*, lower-contrast dark theme, not a relabeling of the
first. Here it is modelled as a **lift of `--bg` only, a few percent off true black**, which is
the documented reason Primer ships "dark dimmed" as its own stylesheet rather than a filter over
"dark" — very dark, saturated UI chrome against true black can itself cause halation/glare for
some readers, which a "dim" background (not dimmed *text*) mitigates. This candidate is the
smallest change that honours that distinction without inventing a third full theme; **Phase B
must decide whether "System" maps the OS dark preference to this dim variant or keeps the
original near-black as the single dark theme, exposing "dim" only as an explicit manual choice**
— this is an open product decision, not resolved by this document (§12).

### 6.2 Evidence/legend candidates (light theme only shown; dark/dim keep shipped hex — §5.2 rule)

**Corrected per §3.** Only `--licence-neutral` (3.19) and `--museum` (3.09) clear 3:1 unchanged
against the candidate background. **The other 13 evidence/legend tokens all need a light-theme
value.** Same-hue, same-saturation, lightness-only candidates (generated by descending lightness
until the ratio clears 3:1 with a small safety margin, method in §9) are:

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

### 6.3 What this table is not

It is not a statement that these exact hex values ship. It is a statement that **values with this
shape — same hue, independently re-lightened per theme, each clearing its own floor — exist and
are computable**, which is what a "safe migration path" requires: proof the constraint is
satisfiable before committing to build against it.

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
- Appearance changes **CSS custom-property values only**. It must not alter `js/app.js` state,
  evidence computation, or any rendered *geometry* — the map tile layer, Lens circles, licence
  points, planning polygons and HATI layer are drawn by Leaflet/canvas with their own colours
  (`--a`, `--b`, category tokens) which this document treats as Evidence/legend tokens (§5.2),
  resolved the same way chrome tokens are, but never substituted with a chrome colour.

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

All ratios in §3 and §6 were computed with the WCAG 2.x relative-luminance formula
(`(L1+0.05)/(L2+0.05)`, `sRGB→linear` gamma correction), implemented independently of the
product's own test helper (`browser-tests/visual-language.browser.mjs`) for a second, cross-checked
computation path. Reproduce with:

```js
// Save as contrast.mjs, run with: node contrast.mjs
function hexToRgb(hex){hex=hex.replace("#","");if(hex.length===3)hex=hex.split("").map(c=>c+c).join("");const n=parseInt(hex,16);return[(n>>16)&255,(n>>8)&255,n&255];}
function luminance([r,g,b]){const c=[r,g,b].map(v=>{const x=v/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});return .2126*c[0]+.7152*c[1]+.0722*c[2];}
function ratio(a,b){const l1=luminance(hexToRgb(a)),l2=luminance(hexToRgb(b));const[hi,lo]=l1>l2?[l1,l2]:[l2,l1];return(hi+.05)/(lo+.05);}
// e.g. ratio("#43d7ff","#08101a") -> 11.28 ; ratio("#43d7ff","#f4f6f9") -> 1.56
console.log(ratio(process.argv[2], process.argv[3]));
```

All shipped-token hex values quoted are taken verbatim from `css/app.css:1-30` (cited inline
throughout). The candidate light-theme background `#f4f6f9` and the re-lightened category
candidates in §3/§6.2 are this document's own proposals, not sourced from the codebase — every
place they appear is labelled "candidate."

---

## 10. Migration path — bounded increments for Phase B

Each increment independently reviewable, in the spirit of P0-a/P0-b1/P0-b2's separable-increment
structure (`docs/POST_K13_P0_P1_DESIGN_PROTOTYPE.md` §4):

1. **T-a — Token consolidation, no visual change.** Replace the ~320 literal-colour sites (§2.2)
   with references to the *existing* dark-theme token values, 1:1, choosing/adding the UI-chrome
   tokens named in §5.1 where no token exists yet (`--surface-drawer`, `--focus-ring`, the four
   Leaflet-chrome tokens, the badge-text token). **Acceptance: zero visual diff** — this step is
   pure refactor, verifiable by the existing contrast suite passing unchanged and a manual
   before/after screenshot diff at the same breakpoints `browser-tests/visual-language.browser.mjs`
   already audits.
2. **T-b — Dim-dark and light `:root[data-appearance]` blocks**, populated with §6's candidate
   values (verified by rendering, not copied blindly from this document), plus the `data-appearance`
   attribute mechanism and no-flash inline script (§7.2). **No control is exposed to the user yet**
   — this increment is reachable only via a query-string or dev-tools override, so it can be
   reviewed and contrast-tested on the real DOM before anyone can switch themes in production.
3. **T-c — The Appearance control itself** (header UI, System `matchMedia` live-binding,
   persistence), gated on T-b's contrast results holding on the real page.
4. **T-d — Comfortable text size** (§8), independent of T-a/b/c; could ship before, after, or
   alongside.
5. **T-e — `forced-colors` mode check** (§12) and **WCAG 2.4.11 focus-not-obscured check** (§4),
   both audits rather than builds, run once T-b exists to look at.

T-a is the only increment with no user-visible behaviour change and is the safest place to start;
it is also the increment that retires the most risk (the mixed-role badge declarations, the
hardcoded drawer background, the 15-site focus-ring literal) before any theme-dependent value is
introduced.

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
- `node --test tests/*.test.mjs` and `npm run test:browser` were **not run in this pass** — this
  audit added/changed no file either suite reads, so a baseline run was not required to validate
  it, but Phase B's own PR must run both and report pass counts, per repo convention.

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
| `--a` (Lens A) has no same-hue light-theme candidate (§3) — a fresh colour must be chosen and reviewed for hue separation from `--b`'s light-theme value | **Open design decision, not resolved by this document.** |
| Whether the 13 mechanically-derived candidates in §6.2 look acceptable once rendered (same-hue descent can land on an unexpectedly muddy or over-dark value at the extremes, e.g. `--rail`'s and `--bike`'s candidates both land near L36–38%) | **Untested — arithmetic only, not a design review of the resulting colours.** |
| Real iPad/Safari/WebKit hardware rendering of any candidate | **NOT TESTED**, consistent with every prior gate in this repository. |

---

## 13. Acceptance criteria for Phase B

Restated from issue #102, made checkable:

- **AC1 (contrast):** `browser-tests/visual-language.browser.mjs` (extended per §11) passes AA
  (4.5:1 text / 3:1 non-text) for every visible text node and every evidence/legend colour's
  non-text use, independently in Light, Dark and the "dim" dark variant if shipped, at the same six
  widths the suite already audits (360/420/560/850/1100/1440px).
- **AC2 (no flash):** the inline resolution script (§7.2) sets `data-appearance` before first
  paint; a Playwright trace shows no intermediate incorrect-theme frame on cold load for each of
  Light/Dark/System×OS-light/System×OS-dark.
- **AC3 (independence):** changing Appearance never changes the basemap `<select>`'s value or
  vice versa; changing either never alters any evidence value, geometry, or K11 URL-state key.
- **AC4 (category integrity):** every Evidence/legend token (§5.2) keeps its hue family and
  category meaning across both themes; a visual diff review confirms no two categories become
  indistinguishable in either theme and no phase sequence or ordering is introduced (Gate-L
  contract, unchanged).
- **AC5 (keyboard/focus):** `--focus-ring` (or its per-theme value) meets 3:1 non-text contrast
  against its own theme's chrome in both themes; WCAG 2.4.11 check (§4) passes for the drawer and
  any sticky control.
- **AC6 (text resize):** both the existing browser-level 200% zoom (SC 1.4.4) and the in-app
  comfortable-text-size control (§8) reflow without clipping or overlap at the already-audited
  breakpoints.
- **AC7 (reduced motion / forced colors):** any new transition (theme cross-fade, if proposed in
  Phase B) collapses under `prefers-reduced-motion:reduce`, consistent with K5; `forced-colors`
  behaviour is at minimum not worsened by this work, ideally audited and fixed if found broken.
- **AC8 (regression):** `node --test tests/*.test.mjs` and `npm run test:browser` stay green;
  real-device Safari stays explicitly marked **NOT TESTED** until actually run on hardware,
  consistent with every predecessor gate's honesty convention.
- **AC9 (performance):** no measured regression in interaction-to-paint or frame time attributable
  to theme-switching machinery, measured against the method and thresholds in
  `docs/RUNTIME_DECISION_SPIKE.md` on at least the device classes that document already covers.

---

## 14. Gate verdict

**This document is a design/audit artifact only and authorizes no implementation.** Per the task's
own instruction, it is submitted as a **Draft PR containing only this document**, for review
against issue #102, before any Phase B code is written.

Within what this gate establishes: the token architecture (§5), the migration path (§10) and the
Appearance/text-size mechanisms (§7–§8) are internally consistent with K5, Gate L, WCAG 2.2 and
the four researched precedent systems, and the central contrast risk (§3) — category hues tuned
for one background are not safely portable to a second by hue alone — has a demonstrated,
computable resolution shape. What it does **not** establish is covered exhaustively in §12 and must
be closed by Phase B's own implementation PR, re-audited against the real rendered DOM, before any
claim of shipped WCAG 2.2 AA conformance is made.

**Recommended disposition: proceed to Phase B planning on increment T-a only** (§10) — the
zero-visual-diff token consolidation — pending human review of this document, with T-b onward
each separately gated on T-a's review and on real-DOM re-verification of §3's and §6's predicted
values.
