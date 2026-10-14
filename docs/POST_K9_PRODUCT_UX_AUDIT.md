# Post-K9 product UX audit — Madrid Urban Evidence Lens

Status: product-validation gate (not a development sprint). This pass audited the
deployed product for real decision-support usability after K9. It changed **no
production code, model, scope, date, withholding rule or interpretation ceiling**.

- **Baseline:** `main` @ `7640eac54851c54eb22a03d59ce1e18e8d751cfa` (after merged PR #85).
- **Live application:** <https://soroushkarahrodi79-oss.github.io/madrid-tourism-intelligence-lens/>
- **Audited:** 14 October 2026.
- **Audiences in scope:** Madrid residents (primary), municipal urban planners, tourism analysts.

> **Update — Post-K9 UX Hardening V1** (branch `feat/post-k9-ux-hardening-v1`, 14 Oct 2026).
> Two claims below were independently re-tested against the real map and the
> existing browser regression `K9 15`, and **reconciled**. Clicking a licence
> point is *functionally correct*: an exact **or near** click opens the record
> popup and does **not** move the active Lens (Leaflet stops that click; verified
> with `lensMoved === false`). The audit's earlier "clicking a point moves the
> Lens, no popup" was a **too-small hit target** (≈4px radius) being missed at a
> normal zoom — not a functional break. The hardening pass therefore (1) extends
> the licence click tolerance to ≈24px diameter, (2) raises the Administrative-
> register group in the layer rail, and (3) adds a mobile quick-jump to the Lens
> metrics. **D1 is reclassified below** from "broken" to "hit-target/
> discoverability." Everything here remains **browser device-emulation**, not
> real-hardware testing.

---

## 1. Verdict

**MODIFY.** The product is **trustworthy** and, on desktop, largely **self-explanatory**;
its provenance, interpretation-ceiling and comparison-withholding discipline are
exemplary and hold on the live deployment. But three confirmed issues block an
*unguided* external demonstration, especially on a tablet or phone: (a) an individual
granted-licence record cannot be inspected — clicking a point moves the Lens instead;
(b) on narrow screens the actual local Lens evidence is buried ~3.6 panel-screens below
the administrative/planning lead; (c) the K9 layer that this gate is named for is hard to
find on small screens. None is a scientific-integrity failure; all are interaction/IA
issues with small, safe fixes.

### The decision question, answered

> *"Is Madrid Lens currently understandable and trustworthy enough to demonstrate to a
> municipal planning or tourism professional without its developer explaining every
> interaction?"*

**On a desktop, with a prepared starting location: yes.** A professional can switch
Place/Compare/City, read every figure, and reach full provenance and limits in one click
without help. **On a tablet/phone, or starting cold on the default view: not yet** — an
unguided user would not discover the K9 layer, would scroll past the local evidence to
find it, and would fail to inspect a licence record. Fix P0 + P1 below and the answer
becomes "yes" across devices.

---

## 2. Method and honest scope

- **Real browser against the live GitHub Pages deployment** (not a local server). Pages
  tested at **desktop 1440×900, tablet 834×1112, and mobile 375×812**.
- The browser was **Chromium via device emulation** (viewport + touch emulation: mobile/
  tablet presets emulate a touch device with coarse pointer). **This is expert device-
  emulation, not real-iPad/WebKit hardware testing.** Real-device Safari/WebKit behaviour
  (momentum scroll, Leaflet touch-drag latency, `dvh` handling, pinch-zoom vs Lens-drag
  gesture conflicts) is **not** covered here and should be confirmed on hardware before an
  iPad-led demo.
- These are **expert walkthroughs**, not observed human usability sessions. No user
  research was conducted or is claimed.
- Evidence is from live interaction, live console/network inspection, and source/stylesheet
  reading. Rendered sizes and offsets were measured via `getComputedStyle` /
  `getBoundingClientRect` on the live DOM.

---

## 3. Preflight (Phase 1) — all green

| Check | Result |
|---|---|
| Branch / baseline | `main` fast-forwarded to `7640eac` (PR #85) ✓ |
| Open PRs | none |
| Live deployment reachable | yes — renders with real data |
| Console errors on load | **0** |
| Network | every asset `200` (HTML, CSS, JS, all `data/*` artifacts) |
| Node unit tests (`tests/*.test.mjs`) | **702 pass, 0 fail** |
| Python gate tests (`tests/`) | **453 pass, 7 skipped** |
| `scripts/validate_deployment.mjs` | **build_state=pass**, 0 errors, 1 allowed warning (pedestrian snapshot not built in this checkout; opt-in/off-by-default; present on the live build) |
| Licence artifact | validator confirms 11,265 resolved address points |

Deployed vs local behaviour: **no material difference** (Phase 4.8). The only build-level
difference is the pedestrian snapshot (absent in the local checkout, present live); it is
opt-in, off by default, and excluded from metrics, so it is not user-facing on the live
site.

---

## 4. Journey results (Phase 3)

| Journey | Completed? | Actions | Headline finding |
|---|---|---|---|
| **J1** Resident reads official planning evidence for a location | ⚠️ With difficulty | many (blind lens-moves) | Default + 3 central barrios have **no planning ámbito** ("explicit absence"); no way to discover *where* ámbitos are; renders fully once inside one |
| **J2** Analyst: recent licences in radius, change window, inspect a record | ⚠️ 2 of 3 | enable (1), window (2), inspect (∞) | Enable ✓, window-change ✓; **inspecting an individual record fails** — clicking a point moves the Lens |
| **J3** Tourism analyst compares two areas + understands limits | ✅ Yes | ~3 | Compare auto-enables Lens B; Decision Insight + unequal-window **density/withholding** work; strong |
| **J4** Non-technical user finds source / reference date / ceiling of a figure | ✅ Yes | 1 | Evidence drawer one click from every figure; scope, authority, 5 dates, state, **verbatim ceiling**, Citizen/Analyst — excellent |
| **J5** iPad/mobile: navigate, change radius, activate a layer, read evidence | ⚠️ With difficulty | high (scrolling) | Controls meet 44px; drawer is a great bottom sheet; but K9 toggle buried, metrics buried, map overlapped |

### J1 — planning evidence for a location (resident)

- At the **default** centre (Los Jerónimos) and at two other central barrios reached by
  moving the Lens (Acacias, Ibiza), the Planning ámbito section showed:
  *"No official planning ámbito contains the Lens centre. The ámbito universe does not
  cover the whole municipality, so this is an explicit absence of a containing ámbito —
  not a zero and not the nearest ámbito."* This copy is honest and correct.
- **Problem:** the product's headline frame is "urban development · official evidence", yet
  the consolidated historic city — where most residents live and most visitors go — is
  outside the 724-polygon ámbito universe, so the lead urban-development object is *absent*
  exactly where a citizen most likely starts. There is **no affordance to discover where
  ámbitos exist** (no ámbito lattice overlay, no list, no search). I could only reach one
  by zooming out and clicking the periphery.
- Once inside an ámbito it renders correctly: moving the Lens to the south-east periphery
  landed in **Ensanche de Vallecas (UZP.1.03)**, showing the edition date
  ("Published state at 1 Jan 2026 · official edition"), the four independent phase values
  (all `Finalizado`), the kind/code distinction, and the ámbito polygon outlined on the map
  with **no camera fly** (correct per the IA contract).

### J2 — granted licences in a radius (analyst) — **confirmed defect on "inspect a record"**

- **Enable** (1 action): toggling *Granted urban licences* loads ~11.3k points and the PLACE
  licence section. At the default trailing-12-month window (1 Oct 2025–30 Sep 2026) the
  default centre resolved **46 building / 77 activity / 2 temporary**; counts, the applied
  window, resolved coverage ("Mapped from 97.97% … 11,265 of 11,498"), and the residual
  classes render inline, not drawer-only. Good.
- **Change the window** (2 actions): widening *From* to the register start (13 Jan 2023)
  raised counts (e.g. 83 / 140 / 8 at the then-centre) and updated the applied-window
  text; the inputs are correctly bounded to the register extent (min 2023-01-13, max
  2026-09-30) and clamp. Good.
- **Inspect an individual record — hard to hit (reconciled; see the Update above).**
  A per-record popup (`licencePopupHtml`: family + grant date + verbatim TIPO + provenance
  + "not built" caveat) exists, is well-designed, and **works** — a direct or near click
  opens it and does **not** move the Lens. The defect is the **hit target**: the points are
  3.5px canvas markers whose clickable radius was ≈4px (8px diameter), far below the 24px
  WCAG 2.5.8 and the app's own 44px coarse-pointer minimum, so at a normal zoom a reader
  usually misses and clicks empty map — which correctly moves the Lens, making it *look* as
  if selection is broken. The hardening pass extends the clickable radius to ≈12px (24px
  diameter) via the canvas renderer's `tolerance`, which I validated live: clicks within
  12px select the record (Lens unchanged), clicks ≥15px still move the Lens.

### J3 — compare two areas (tourism analyst) — strong

- Entering **Compare** auto-enables Lens B and reads "How do two Lens circles read against
  each other?". Decision Insight lists the four canonical metrics with signed **B−A** deltas
  and the guard *"Observed comparison only · no ordering or recommendation."*
- The scientific-honesty behaviour works live: setting Lens B to 2 km against Lens A 900 m
  switched the basis cue to *"Different windows · POI/stay comparator: represented
  records/km²"*, recomputed POI/stay as density (+3.7, +31.0 records/km²), and **withheld
  Mobility** (*"Withheld · different window sizes"*). The product visibly refuses an
  incomparable delta — exactly the trust property the docs promise.

### J4 — source, date, ceiling of a figure (non-technical) — excellent

- Every figure carries an unobtrusive ⓘ and the lead carries "Evidence & limits". One click
  opens the drawer showing, for *Registered residents*: scope (official barrio), unit,
  derivation, authority (Padrón), reference date `2026-01-01`, publication date `not
  published`, retrieval date, update frequency, source state `Definitive`, and a long
  **verbatim interpretation ceiling**, with a **Citizen/Analyst** toggle. On mobile the
  drawer is a near-fullscreen (82% viewport), very readable bottom sheet. This is the
  best-executed surface in the product.

### J5 — iPad/mobile — completes, but with heavy friction (see §5 responsive)

---

## 5. Focused UX risk analysis (Phase 4)

1. **Is K9 discoverable despite being off by default?** *Partially.* On desktop it is a
   labelled row under an "Administrative register / granted ≠ built" divider — reasonable.
   On mobile/tablet the left layer rail is a **142px-wide floating box showing ~360px of a
   1928px stack**, and the licence toggle sits **~719px down** — not visible without
   scrolling a small overlay. Poor on small screens.
2. **Does the long planning/administrative section obscure more useful local evidence?**
   *Yes — confirmed.* In PLACE the reading order is Administrative area → Planning ámbito →
   Granted licences → the four Lens-circle metrics. On mobile (375px) the **"Within the
   Lens" metrics sit 1,225px deep — ~3.6 panel-screens** below the top of a 339px bottom
   sheet (panel content total ≈1,823px). The circle measurement — the most direct answer to
   "what is here?" — is the hardest thing to see.
3. **Is 10px/11px metadata/disclosure type readable on tablet/mobile?** *Borderline, by
   design.* Badges render at **10px**, provenance/freshness at **11px** at 375px. These sit
   at or just above the stated 10px floor and are legible, but small for a general-citizen
   audience on a phone. Defensible as a deliberate contract, not a defect.
4. **Are map circles, halo bars, licence points and admin geometry distinguishable?**
   *Mostly, with one weakness.* Lens A/B differ by hue and structure (B dashed); halo bars,
   outlines and clusters read distinctly. But the small orange **licence points are
   occluded by the larger teal POI clusters** inside the Lens when operational layers are
   on — distinguishable by colour but visually subordinate, compounding J2.
5. **Are Spanish and English copy natural, consistent and understandable?** *Yes — a
   strength.* A single control switches the whole shell, rail, drawer, modes, hospitality
   and licence surfaces; the ES copy is natural ("Barrio oficial completo, no el círculo de
   la Lente", "otorgada ≠ construida", "Licencias urbanísticas otorgadas"); surfaces that
   are Spanish in static HTML correctly render English under EN, and the EN⇄ES round-trip is
   clean.
6. **Does the README / visible framing reflect the completed Gate K increments?** *Largely
   accurate and unusually thorough.* The product title, meta and in-app brand are all
   "Madrid Urban Evidence Lens", and §11 correctly records K-series status. Minor friction:
   the repository name and live-URL path remain `madrid-tourism-intelligence-lens`, and
   README §2 still *leads* with the tourism "currently shipped" inventory before the urban
   reframing — a slightly mixed public identity, not an inaccuracy.
7. **Is scope/provenance/unavailability/temporality clear without overwhelming a citizen?**
   Provenance and unavailability are *excellent* (distinct OFF / N/A / observed-zero;
   explicit absence copy; the drawer). The risk is the **opposite of hiding — density**: the
   licence section alone stacks four inline "what this is / is not" ceilings plus two
   disclosures, on top of the planning ceiling and the area notes. For a citizen this is a
   wall of caveats. The discipline is right; the *amount* of always-on caveat prose is the
   main citizen-facing load.
8. **Deployed vs local differences?** None material (see §3).

---

## 6. Confirmed defects vs hypotheses

**Confirmed (reproduced on the live deployment):**

- **D1 — Licence record inspection has a too-small hit target (reclassified).** The popup
  is functionally correct (exact/near click opens it; Lens does not move), but the ≈4px
  clickable radius makes it impractical to hit at a normal zoom, so a reader usually hits
  empty map and moves the Lens instead. Not a functional break. *Fixed in this pass*
  (tolerance → ≈24px diameter; regression `K9 16`). (J2)
- **D2 — On ≤850px the local Lens metrics are ~3.6 screens below the fold** (1,225px into a
  339px sheet), behind the administrative/planning lead. (Phase 4.2 / J5)
- **D3 — K9 toggle is ~719px down a 142px floating rail on small screens** → effectively
  undiscoverable without deliberate scrolling. (Phase 4.1 / J5)
- **D4 — Licence points are occluded by POI clusters inside the Lens.** (Phase 4.4)

**Hypotheses (plausible, not proven as defects here):**

- **H1 — 10px/11px metadata is uncomfortably small for citizens on phones.** At the floor,
  by design; needs real-device confirmation.
- **H2 — Caveat density in PLACE overwhelms a citizen.** Expert judgement; warrants a quick
  comprehension check with real readers.
- **H3 — Real iPad Safari touch behaviour** (Lens-drag vs page-scroll, pinch-zoom,
  attribution overlap) may differ from emulation. Not tested on hardware.
- **H4 — Attribution/zoom controls overlapping the map centre** on small screens look
  cluttered; cosmetic, worth a design pass.

---

## 7. Accessibility & responsive findings

- **Touch floor holds** where it is DOM-based: at 375px with coarse pointer, mode buttons
  (44h), layer switches (44×44), licence toggle (44×44), radius slider (44h), ⓘ links
  (44×44), language select (44h), reset (44h) all meet 44px. **Exception:** licence canvas
  points (7px) — not DOM, so the floor does not apply (see D1).
- **Provenance is never hidden by a breakpoint** (verified against the IA contract and live
  DOM): source, date, unit, scope and interpretation-ceiling access survive every width.
- **Drawer accessibility** is sound: native `<dialog>`, Escape closes, large Close target,
  Citizen/Analyst toggle, readable bottom sheet on mobile.
- **Tablet = phone layout:** iPad portrait (768/834px) is below the 850px breakpoint, so it
  gets the floating-rail + bottom-sheet layout, inheriting D2/D3. A minor horizontal
  scrollbar appears on the left rail at 834px (cosmetic).
- **Reading order on narrow screens** inverts the product's own intent: the circle metric
  (most immediate) is last among the PLACE evidence objects.

---

## 8. Top 5 prioritized improvements

| # | Pri | Improvement | Smallest safe fix | Regression test | Complexity |
|---|---|---|---|---|---|
| 1 | **P0** | Make a licence record inspectable without moving the Lens | In the map `click` handler, ignore the event when it originated on a licence marker (guard on the canvas hit / `originalEvent` target-layer), and let the marker's existing popup open; optionally widen licence hit-tolerance | Clicking a licence marker opens its popup **and leaves the active Lens centre unchanged**; clicking empty map still moves the Lens | Small (event guard + 1 browser test) |
| 2 | **P1** | Stop burying the local Lens metrics on ≤850px | Reorder PLACE on narrow widths so the four circle figures sit directly under the rail (or add a compact circle-summary above the administrative lead); collapse the planning/licence *ceiling prose* into its disclosure by default on mobile | At ≤850px the four metrics are reachable within ~1 screen; provenance/ceiling access remains present (IA no-hide contract still passes) | Medium (CSS/IA order; must preserve "controls last" + "never hide provenance") |
| 3 | **P1** | Make the K9 layer discoverable on small screens | Give the floating left rail a clear scroll affordance / section anchors, or surface the "Administrative register" group without a 700px scroll (e.g. collapsible groups) | On 375px the licence toggle is reachable within one rail screen or via a visible group control | Small–Medium |
| 4 | **P2** | Keep licence points legible against POI clusters | Raise the licence pane above cluster bubbles or add a thin contrasting ring / slightly larger radius when operational layers overlap | Licence points remain visible inside the Lens with all operational layers on | Small |
| 5 | **P2** | Reduce citizen caveat density in PLACE | Keep **one** inline ceiling per section; move the remaining "what this is not" lines into the already-excellent drawer | Each PLACE section shows ≤1 inline ceiling; full ceilings still verbatim in the drawer | Small–Medium (copy/IA; verbatim text unchanged) |

All five preserve the Gate K/L/M scientific constraints: no model, scope, date, rounding,
withholding rule or interpretation-ceiling change — they are interaction, layout and
disclosure-placement changes only.

---

## 9. Readiness recommendation

- **Ready now:** a **desktop, developer-or-analyst-led** institutional demonstration, with
  a prepared starting location inside a planning ámbito. The evidence model, provenance,
  comparison discipline and language handling will stand up to a planner's or analyst's
  scrutiny.
- **Not ready yet:** an **unguided** external demo, or one led on an **iPad/phone**. Ship
  **P0 (D1)** and **P1 (D2, D3)** first, and confirm iPad Safari behaviour on real hardware
  (H3), before putting the product in a municipal professional's hands without a guide.

*No production code was changed, and no feature PR was opened, by this audit.*
