# Post-K13 product UX validation gate — Madrid Urban Evidence Lens

Status: **research / validation gate only** (issue #91). This pass audited the deployed
product for discoverability, comprehension and safe use after Gate K (K1–K13). It changed
**no production code, data, model, scope, date, withholding rule, abstention, derivation or
interpretation ceiling**, and it does **not** touch HATI. Its sole artifact is this document.

- **Baseline:** `main` after merged PR #90 (K13 evidence registry). Deployed assets confirmed
  against this baseline (see §1).
- **Live application:** <https://soroushkarahrodi79-oss.github.io/madrid-tourism-intelligence-lens/>
- **Audited:** 17 October 2026.
- **Audiences in scope:** Madrid residents (primary), municipal urban planners, tourism analysts.
- **Predecessor:** `docs/POST_K9_PRODUCT_UX_AUDIT.md` (14 Oct 2026). Every actionable item in it
  is reconciled against current reality in §3 — **no already-fixed issue is re-reported as open.**

---

## 1. Reproducible baseline, tools and honest limits of observation

### What was tested, and how

- **Live GitHub Pages deployment** (not a local server), driven in the Claude desktop app's
  **built-in browser pane (Chromium)** with viewport + touch **device emulation** at
  **desktop 1440×900, tablet 834×1112 and phone 375×812**.
- **Source, CSS and DOM reading** on the checked-out tree to measure rendered sizes, offsets,
  reading order, z-order and breakpoints precisely (`getBoundingClientRect`, computed style,
  `scrollHeight`), and to confirm which post-K9 fixes shipped.
- **One automated unit run:** `node --test tests/*.test.mjs` → **927 pass, 0 fail**
  (post-K9 reported 702; the suite has grown with K10–K13). Browser Playwright suites and the
  Python gate suite were **not** independently re-run in this pass.

### Deployed-vs-local reconciliation (Phase 0)

- Deployed script versions include `evidence-registry.js?v=20261017-1` and
  `scope-rail.js?v=20261017-1`. These matching `?v=` asset-version tokens indicate the live site
  is serving the **K13 asset generation** (post-#90), and no material deployed-vs-local behaviour
  difference was observed during interaction. **They do not prove a byte-identical build of
  `main`:** the deployment exposes no immutable fingerprint (no commit hash in a build manifest),
  so deployment identity here is asserted **at the asset-version level, not cryptographically.**
  A future build manifest carrying the `main` SHA would let a later audit establish this exactly.
- Modes present and reachable: **PLACE, COMPARE, CITY**. The K11 URL-state contract is live
  (the address bar carries `m/a/b/be/al/ly/sc/rd/lg` and now `lw/hm/hb/om`); a hand-built
  COMPARE link with unequal radii restored that exact reading (see J3/J5).
- Console on load: no errors surfaced during interaction; every data artifact served.

### Limits of observation — read this before trusting any number below

- **This is expert inspection + browser device-emulation + source reading. It is NOT real
  hardware testing and NOT a human usability study.** Chromium touch/viewport emulation does
  **not** reproduce real iPad/Safari/WebKit behaviour (momentum scroll, Leaflet touch-drag vs
  page-scroll vs pinch-zoom gesture arbitration, `dvh` handling, attribution/zoom overlap under
  a real status bar). Everything about tablet/phone here is **emulation**.
- **Real iPad / Safari / WebKit hardware: NOT TESTED.**
- **Observed human comprehension: NOT TESTED.** No resident, planner or analyst used the product
  in this pass. Claims about what a user "would" understand are expert judgement, flagged as
  hypotheses (H-codes) and routed to the proposed study in §7 — they are not findings.
- Rendered pixel offsets are emulation measurements; treat them as order-of-magnitude, not
  device-exact.

### Keyboard, focus and ES/EN checks (issue #91 explicit requirements)

Issue #91 explicitly asks for keyboard navigation, focus behaviour and ES/EN semantics. These
were assessed by **expert inspection in the emulated browser** (live DOM + real `Tab` presses +
CSS rule inspection). **Screen-reader / assistive-technology behaviour and real-hardware keyboard
are NOT TESTED.** Auditable outcomes:

| Check | Outcome | Evidence | Confidence |
|---|---|---|---|
| Visible focus indicator | **PASS** | `:focus-visible` rules defined; after 3 real `Tab` presses the focused element carried `outline: solid 2px` + a box-shadow ring (live). | Expert / emulation |
| Controls keyboard-reachable | **PASS** | Panel/rail controls are native `<button>/<select>/<input>` (reachable without explicit tabindex). | Expert / emulation |
| Drawer focus management | **PASS** | Native `<dialog>`; Escape closes; browser-managed focus containment (verified J4/J5). | Expert / emulation |
| Tab-order quality | **CAVEAT (not a blocker)** | The Leaflet map contributes **196 focusable marker/cluster elements**; tabbing from the top traverses map markers before reaching some rail/panel controls (live: 3 Tabs → a map cluster marker). This is Leaflet default behaviour; a skip-link or roving-tabindex would help. | Expert / emulation |
| Skip-link / landmark/ARIA roles / SR labels | **NOT TESTED** | No assistive-technology pass was run. | — |
| ES/EN shell + semantics | **PASS** | Switching the language select to Español flips the whole shell, mode tabs ("▦Ciudad"), brand sub ("Desarrollo urbano · Evidencia oficial"), the records pill ("registros") and the planning-absence copy ("Ningún ámbito oficial de planeamiento contiene el centro de la Lente"); EN⇄ES round-trip clean, natural (not machine-literal). | Expert / emulation |
| ES per-surface string coverage; ES on hardware | **NOT TESTED** | Only spot surfaces checked, not every string. | — |

**Scope of the accessibility claim:** where this report later says no "hard accessibility
blocker" was found, that is scoped **to what was assessed above** (DOM touch-target geometry,
visible focus, native-dialog handling, ES/EN shell). **A full WCAG 2.1/2.2 conformance audit and
an assistive-technology pass were NOT conducted** and are routed to the §7 study.

---

## 2. Verdict (summary)

**GO — to a bounded design prototype**, with no change to scientific contracts.

The evidence model is intact and trustworthy on the live deployment: provenance, five-field
freshness, publisher withholding, missing-vs-zero, abstention, units, scope and verbatim
interpretation ceilings all hold and were re-verified across modes. Comparison discipline
(unequal-window withholding, density normalization, "no ordering or recommendation") works
live. **Within what was assessed** — correctness of the evidence model, DOM touch-target
geometry, visible focus, native-dialog handling and ES/EN shell (§1) — no blocker was found that
forces a HOLD. This is **not** a statement that a full WCAG/assistive-technology audit passed:
that audit was not conducted (§1, §7), so the GO below authorizes **design prototyping only**, not
verified production accessibility.

The remaining problems are **information-architecture, interaction and disclosure-placement**
issues, concentrated on small screens and on one comprehension gap that survives from post-K9:

1. **A resident cannot discover *where* planning ámbitos exist** (the lead "urban development"
   object is *absent* at the default central location, with no lattice/list/search). **Unchanged
   since post-K9. This is the top item.**
2. On ≤850px the **K9 licence toggle is still ~693 px down a ~360 px-tall scrollable rail**, and
   the local Lens metrics are still 4th in the PLACE reading order. Post-K9 fixes (#86) improved
   grouping and added a quick-jump, but the underlying small-screen burial persists.

These are exactly the class of problems a bounded, text-first prototype should resolve — so the
gate is **GO**, scoped to the P0/P1 items in §6, not a speculative redesign.

---

## 3. Reconciliation of the post-K9 audit (no fixed issue re-reported)

| Post-K9 item | Post-K9 status | **Current status (this pass)** | Evidence |
|---|---|---|---|
| **D1** Licence record not inspectable (hit target) | Fixed in #86 | **RESOLVED — not re-reported.** `LICENCE_CLICK_TOLERANCE = 6`, applied via `licenceToleranceForZoom` only at zoom ≥ 14 (`js/app.js`). | Source confirmed; zoom-gated tolerance in `licenceRenderer`. |
| **D2** Local Lens metrics ~3.6 screens down on ≤850px | Open (P1) | **PARTIALLY ADDRESSED.** #86 added PLACE quick-jump chips ("▾ Within the Lens" / "▾ Detail"), live on tablet+phone. But the reading order is unchanged — the circle metrics are still **4th** (admin area → planning → licences → within-the-lens). The shortcut mitigates; it does not fix the burial. | Live DOM reading order; chips visible at 375/834px; `css/app.css` `.panel[data-mode="PLACE"] .place-jump{display:flex}` ≤850px. |
| **D3** K9 toggle ~719px down a narrow floating rail | Open (P1) | **STILL OPEN on small screens (improved on desktop).** #86 moved the *Administrative register* group directly under Operational Layers (good on desktop). At 375×812 the rail is **360 px tall with scrollHeight 1912 px**, and the licence toggle sits **~693 px** inside it — not visible without scrolling a short overlay. | Measured live: `aside.left` top 73, height 360, scrollHeight 1912; licence row offset 693, not visible. |
| **D4** Licence points occluded by POI clusters | Open (P2) | **OPEN — not addressed.** `licencePane` z-index **410**; cluster markers render in Leaflet's default `markerPane` (**600**), above it. The source comment explicitly places licence boundaries "below … cluster markers." | `js/app.js` pane z-order. |
| **#5** PLACE caveat density for citizens | Open (P2, hypothesis) | **OPEN (hypothesis H2).** Still multiple inline "what this is / is not" ceilings stacked per PLACE section. Needs a comprehension check, not an expert verdict. | Live PLACE panel. |
| **H1** 10/11px metadata legibility | Hypothesis | **UNRESOLVED — needs hardware.** Not re-litigated here. | — |
| **H3** Real iPad Safari touch behaviour | Hypothesis | **NOT TESTED (hardware).** | — |
| **H4** Attribution/zoom overlap on small screens | Hypothesis (cosmetic) | **CONFIRMED present (emulation), cosmetic.** Leaflet controls are *expected* to overlay the map; the specific issue is that at ≤850px the attribution box (`max-width: min(46vw,220px)`) and the zoom control sit over the map's **upper-right POI/cluster area**, obscuring a few markers there, and in CITY they crowd the lingering lens A·* badges. It does **not** block any panel/provenance content or any control. Cosmetic density only. | Screenshots at 375/834px; CSS `.leaflet-control-attribution`. |

### New surfaces since post-K9 (K11 #88, K13 #90) — first UX assessment

- **K11 share/export (#88) — good.** "Copy shareable link" (`#k11ShareBtn`) and "Export
  evidence" (`#k11ExportBtn`) are **co-located inside the Evidence & limits drawer header**
  ("Copy a link that reproduces this exact reading, or export its evidence, geometry, sources
  and limits for QGIS, GeoLibre or a spreadsheet"). The versioned URL restored a COMPARE reading
  with unequal radii exactly (J5). Two UX risks, both minor: (a) sharing is **discoverable only
  by opening the drawer**; (b) the **reproducible-UI-state vs frozen-historical-dataset**
  distinction is carried only in subtle copy and the "deployment snapshot · not real-time" pill.
- **K13 evidence registry (#90) — correctly invisible.** Design/contract only; it adds no UI
  surface, so there is nothing for a user to misread. This matches the gate's intent.

---

## 4. Task-by-task journey results (Phase 1)

Viewports: D = desktop 1440×900, T = tablet 834×1112 (emulation), P = phone 375×812 (emulation).

### J1 — PLACE cold start: find a point, read the answer, tell an absent ámbito from an unavailable dataset — ⚠️ **comprehension gap persists**

- **Works and is honest:** at the default centre (Los Jerónimos) PLACE leads with OFFICIAL
  BARRIO + LENS CIRCLE A·900 m, and the planning status reads *"The Lens circle touches no
  official planning ámbito"* with the drawer-grade copy *"explicit absence of a containing
  ámbito — not a zero and not the nearest ámbito."* An **absent ámbito** (explicit absence) is
  clearly distinct from an **unavailable dataset** (OFF / UNAVAILABLE copy on the layers). This
  distinction is a genuine strength.
- **Unresolved (same as post-K9):** there is **no PLACE-mode affordance to discover where ámbitos
  exist.** The *Administrative boundaries* overlay offers only **Off / All district outlines /
  All barrio outlines** — **no ámbito lattice, list or search**. So the headline "urban
  development" object is *absent* exactly where a resident most likely starts (the consolidated
  historic centre), and the only way to reach one is to blindly drag the Lens to the periphery.
  **This is the single most important unresolved product-comprehension issue (Register #1).**
- **Distinguish from COMPARE:** this gap is **PLACE-specific spatial discovery.** COMPARE already
  lets a user reference two ámbitos by **exact official code** (`ambitoSelect(slot, code)` with
  known-code validation). But that presumes the user *already knows a code* — it is a selection
  mechanism, not a way to discover *where* ámbitos are on the map. The two must not be conflated.
- **Feasibility caveat for the proposed fix (corrected):** the ámbito **geometry is already
  fetched**, but the live renderer `renderPlanningPolygon(containing)` paints only the **one
  containing feature** — it does **not** draw a lattice. An always-visible "All planning ámbitos"
  overlay therefore needs an **additional renderer over the already-fetched geometries**, not a
  mere `planningPane` toggle. Even then, at the default zoom 14 from the central default centre
  **the nearest ámbito polygons lie outside the visible viewport** (they sit on the periphery),
  **especially on mobile** — so an overlay *alone* would not let a user "see where ámbitos exist"
  without panning/zooming. A realistic fix pairs the overlay with a **user-initiated** overview /
  "locate nearest ámbito" affordance (preserving the no-*automatic*-camera-fly contract) and must
  not imply the polygons are complete **built-development footprints** (they are planning ámbitos;
  m²-only, no dwelling counts per Gate L). **This is a prototype hypothesis to be tested per
  device class, not a demonstrated fix.**
- D/T/P: identical semantics; on T/P the planning status is reachable within the first
  bottom-sheet screen.

### J2 — Administrative licences: discover/activate K9, pick a grant window, inspect a record, understand granted ≠ built — ✓ with two residual frictions

- **Discover/activate:** the *Administrative register* group ("granted ≠ built") sits directly
  under Operational Layers (D3 improvement). On **D** it is immediately visible; on **T/P** it is
  **~693 px down a 360 px rail** → still requires scrolling a short overlay (Register #2).
- **Grant window:** bounded to the published register extent (min 2023-01-13, max 2026-09-30) and
  clamps — carried over correct from post-K9.
- **Inspect a record:** the hit target is **fixed** (D1); a near click opens the per-record popup
  without moving the Lens at zoom ≥ 14. Residual: licence points are **visually subordinate to
  POI clusters inside the Lens** (D4, Register #5).
- **granted ≠ built:** stated in the group label, the section, and the record popup. Clear.

### J3 — COMPARE A/B with unequal radii: interpret B−A, withheld metrics, area normalization, absence of scores — ✓ **strong, verified live**

- A hand-built link (`m=COMPARE`, A 900 m, B 2 km, `be=1`) restored the comparison exactly.
  Decision Insight showed: basis **"Different windows · POI/stay comparator: represented
  records/km² · Overlapping windows · observations are not independent"**; Tourism POIs and
  Hotels normalized to **records/km²** with signed **B−A**; **Mobility "Withheld · different
  window sizes"**; UTCI **OFF**; guard **"Observed comparison only · no ordering or
  recommendation."** The product visibly refuses an incomparable delta. No score/ranking exists.
- D/T/P: the compare table and Decision Insight stack cleanly; Spatial Sensitivity present.

### J4 — CITY / tourism context: read citywide hotel demand; explain it is not a local-circle figure — ✓ **strong**

- CITY reads *"Mode: City. What is the municipality-wide context?"* → **DESTINATION CONTEXT ·
  whole municipality · Madrid · OFFICIAL STATISTICS · August 2026 · PROVISIONAL**: 867k
  travellers (+10.9% vs Aug 2025), 1.7m overnight stays (+5.3%), residence split 37% Spain / 63%
  abroad, with the explicit ceilings **"Whole municipality of Madrid — not the Lens circle.
  Provisional: the source revises the current year's months later."** and **"Hotel
  establishments only — not all tourism, not all accommodation."** Domestic-origins table below.
- **Minor interpretation risk (Register #9):** the map keeps painting the **A·POI / A·STAY /
  A·MOB / A·UTCI** lens-circle badges in CITY mode, next to a citywide panel — a small chance a
  reader conflates the circle badges with the municipality figures.

### J5 — Evidence trust & sharing: from a figure, reach scope/source/5 dates/ceiling/derivation; share/export without confusing a UI state for a dataset — ✓ **excellent, with two minor risks**

- **Provenance (best surface in the product):** one tap on any ⓘ / "Evidence & limits" opens a
  native `<dialog>` showing, per figure, scope, unit, derivation, authority, **reference /
  publication / retrieval dates**, update frequency, source state and a **verbatim interpretation
  ceiling**, with a Citizen/Analyst toggle. On P it is a readable ~82 dvh bottom sheet; Escape
  closes; large Close target.
- **Share/export:** present and reproducible (see K11 above). Risks: discoverability (drawer-only,
  Register #6) and the reproducible-state-vs-dataset distinction (Register #7).

### Journey matrix

| Journey | D | T (emu) | P (emu) | Headline |
|---|---|---|---|---|
| J1 PLACE cold start | ⚠️ | ⚠️ | ⚠️ | Absence honest; **no way to find where ámbitos exist** |
| J2 Licences | ✓ | ⚠️ | ⚠️ | Fixed hit target; K9 toggle still rail-buried on T/P; D4 occlusion |
| J3 COMPARE | ✓ | ✓ | ✓ | Unequal-window withholding + density verified live |
| J4 CITY | ✓ | ✓ | ✓ | "Not the Lens circle / hotels only" explicit; lens badges linger |
| J5 Trust & share | ✓ | ✓ | ✓ | Excellent drawer; share drawer-only; state≠dataset subtle |

---

## 5. Information-architecture assessment (Phase 2)

- **The left rail is the dominant small-screen weakness.** At 375px it is a **360 px floating
  overlay holding a 1912 px control stack** (base map, admin boundaries, Museums, Hotels,
  Accommodation filter, BiciMAD, Metro, Tourist info, Administrative register/K9, Observed
  activity, Context×2, Research/HATI). Only ~19% is visible at once; K9 is off-screen by default.
  This is the root cause of Register #2 and competes with the panel's own quick-jump navigation.
- **PLACE reading order** puts the most direct answer ("what is in the circle?") **4th**. The
  quick-jump chip is a shortcut, not a reorder. A compact circle-summary band near the top on
  narrow widths would answer the first question first without hiding provenance or moving
  controls off the bottom.
- **Caveat density:** PLACE stacks several always-on inline ceilings per section (planning +
  licence ×multiple + area). The discipline is right; the *amount* of inline caveat prose is the
  main citizen-facing load (H2 — route to study).
- **Map vs panel / visual distinction:** Lens A/B read distinctly (hue + B dashed); halo bars,
  outlines and clusters are distinguishable. Two weaknesses: licence points sit **below** cluster
  markers (D4), and **attribution/zoom controls overlap the map** on T/P (H4).
- **Provenance never disappears across widths** — re-confirmed. Progressive disclosure is used,
  but no provenance field is semantically removed at any breakpoint. Good.
- **Keep / simplify / move / group / remove**
  - **Keep:** the 3 modes; the Evidence & limits drawer (and its Citizen/Analyst toggle); the
    explicit-absence copy; the withholding/density discipline; the CITY "not the Lens circle"
    ceilings; the K13 registry's invisibility.
  - **Simplify:** PLACE inline caveat density (one inline ceiling per section; rest to drawer,
    verbatim unchanged).
  - **Move:** a compact circle-summary above the administrative lead on ≤850px; a Share control
    into the panel head (not drawer-only).
  - **Group:** rail groups **collapsed by default** on ≤850px with a **layer-count badge** —
    the *number of layers in the group* (e.g. "Operational layers · 6"), **not** a count of
    administrative records or data points — so each group header, including Administrative
    register (K9), is reachable within one rail screen.
  - **Add (IA only, no new data):** an **"All planning ámbitos"** option to the existing boundary
    overlay select — the J1 fix, reusing already-loaded ámbito geometry.
  - **Remove:** nothing. Adding a mode or feature is **not** assumed to help.
- **Engineering ≠ comprehension.** 927 green unit tests and the IA no-hide contract prove the
  provenance *plumbing*; they say nothing about whether a resident *understands* an absent
  ámbito or a shared-link's snapshot semantics. That requires the §7 study.

---

## 6. Prioritized top-10 issue register

Severity: P0 blocks unguided use for a core audience; P1 materially impairs a core journey on a
major viewport; P2 is a bounded polish/clarity item. "Repro" = how reliably reproduced here.

| # | Pri | Issue | Affected user / task | Evidence & repro | Smallest viable remedy (no scientific change) |
|---|---|---|---|---|---|
| 1 | **P0** | No **PLACE-mode** affordance to discover **where** planning ámbitos exist; lead object is absent at the default centre (distinct from COMPARE official-code entry) | Resident + planner / J1 | Boundary select = Off/district/barrio only; default view shows explicit absence; `renderPlanningPolygon` paints the containing feature only. **Repro: always, default state.** | **Prototype hypothesis:** an "All planning ámbitos" overlay drawn by a **new renderer over already-fetched geometries** (not a `planningPane` toggle), **paired with a user-initiated overview/"locate nearest ámbito" affordance** because the nearest polygons fall outside the default viewport (esp. mobile). Preserve no-*automatic*-camera-fly; must not imply built-development footprints. IA/overlay only, no new data. |
| 2 | **P1** | K9 licence toggle ~693 px down a 360 px scrollable rail on ≤850px | Analyst / J2, T+P | Measured: rail 360 px, scrollHeight 1912 px, licence row offset 693, not visible. **Repro: always ≤850px.** | Collapse rail groups by default on ≤850px (see #3); Administrative register header reachable in first rail screen. |
| 3 | **P1** | Rail is a 1912 px control stack in a 360 px overlay on small screens (root cause of #2) | All / all journeys, T+P | Measured scrollHeight 1912 px; ~19% visible. **Repro: always ≤850px.** | Collapsible groups with count badges + clear scroll affordance; no control removed. |
| 4 | **P1** | PLACE "Within the Lens" metrics are 4th in reading order; quick-jump mitigates but burial remains | Resident / J1, T+P | Live DOM order; chips present but order unchanged. **Repro: always ≤850px.** | Compact circle-summary band (4 figures + radius) above the administrative lead on ≤850px; provenance kept; controls stay last. |
| 5 | **P2** | Licence points occluded by POI clusters inside the Lens | Analyst / J2 | `licencePane` z 410 < `markerPane` 600. **Repro: operational layers on, inside Lens.** | Raise licence pane above cluster bubbles, or add a contrasting ring / larger radius when operational layers overlap. |
| 6 | **P2** | Share/Export discoverable only inside the Evidence drawer | Analyst + planner / J5 | `#k11ShareBtn`/`#k11ExportBtn` live in drawer header only. **Repro: always.** | Surface a compact Share control in the panel head reusing existing handlers. |
| 7 | **P2** | Reproducible-UI-state vs frozen-dataset distinction is subtle | All / J5 | Carried by copy + "deployment snapshot" pill only. **Repro: always.** | One-line clarifier in the share confirmation ("restores this view; underlying data refreshes each deploy"). Verify in study. |
| 8 | **P2** | PLACE inline caveat density (H2) | Resident / J1 | Multiple stacked inline ceilings per section. **Repro: always.** | One inline ceiling per section; move the rest into the drawer, verbatim text unchanged. |
| 9 | **P2** | Attribution/zoom controls overlap the map on ≤850px (H4); CITY lingering lens badges | All / J4, T+P | Screenshots at 375/834px; A·* badges in CITY. **Repro: always ≤850px / CITY.** | Reposition/condense map controls at ≤850px; dim or hide lens badges in CITY. |
| 10 | **P1** | Quick-jump chips 30 px tall — **below the project's own 44 px coarse-pointer target** (though above WCAG 2.5.8's 24 px minimum) | All / J1, P | Measured chip height 30 px; mode buttons and rail switches are 44 px. **Repro: always ≤850px.** | Raise chip min-height to 44 px. **Reprioritized P2→P1:** it is a small-screen touch control that fails the product's own stated target, so it belongs with the P1 small-screen usability work, not cosmetic polish. |

Touch floors otherwise hold on emulation: mode buttons 44 px, rail switches 44×44 px, drawer
controls large. The chip (#10) and the non-DOM licence canvas points are the only sub-floor cases.

---

## 7. Evidence-type split, and the human study that was NOT conducted

| Evidence type | Done here? | Covers |
|---|---|---|
| Expert heuristic inspection | ✅ | IA, reading order, caveat load, journey walkthroughs |
| Browser **device-emulation** (Chromium, in-app pane) | ✅ | Responsive layout, touch-target geometry, live interaction at 3 viewports |
| Source / CSS / DOM measurement | ✅ | z-order, offsets, breakpoints, which post-K9 fixes shipped |
| Keyboard / focus / ES–EN (expert, emulation) | ✅ | Focus-visible, native-dialog handling, tab-order caveat, ES/EN shell (§1 matrix) |
| Automated unit tests | ✅ (one run) | 927 pass / 0 fail — plumbing/contracts, **not** comprehension |
| **Full WCAG 2.1/2.2 + assistive-technology audit** | ❌ **NOT CONDUCTED** | Screen-reader semantics, SR labels, skip-links, roving-tabindex, AT focus order |
| **Real iPad / Safari / WebKit hardware** | ❌ **NOT TESTED** | Touch-drag vs scroll vs pinch, `dvh`, momentum, real overlap |
| **Observed human usability** | ❌ **NOT TESTED** | Whether users actually understand the evidence |

**Proposed small human task study (not yet run — do not treat any claim here as its result).**
6 participants (2 residents, 2 municipal planners, 2 tourism analysts), moderated, ~30 min each,
on real devices incl. one iPad. Run the 5 journeys from fixed start states. Capture task
success, time-on-task, and **4 comprehension probes**: (a) "where can you find a planning
ámbito?" (J1), (b) "does a granted licence mean a built/operating business?" (J2), (c) "is the
CITY figure about your circle?" (J4), (d) "if you share this link and the site updates next week,
what does the recipient see?" (J5). Target: ≥5/6 success per journey; all 4 probes answered
correctly by ≥5/6. This study is the gate for the *design* of the J1/rail fixes, not a
precondition to start the prototype.

---

## 8. Minimal proposed information architecture (text-first wireframe — NO implementation)

Constraints honoured: 3 modes kept; no new data/indicator/score/ranking/prediction/causal claim;
provenance, scope, units, five-field freshness, withholding, abstention, derivations and ceilings
untouched; HATI stays an independent optional ON/OFF layer, unmodified; no framework/MapLibre/3D/
assistant/network change.

**Rail (≤850px):** groups **collapsed by default**, each header shows a **layer-count badge**
(number of layers in the group, e.g. "Operational layers · 6" — never a record/data-point count);
one open at a time; scroll affordance. Order: Base map · Boundaries · Operational layers ·
**Administrative register (K9)** · Observed activity · Context · Research (HATI). Goal: K9
reachable in the first rail screen.

**Boundary overlay select:** `Off · active area only` | `All district outlines` | `All barrio
outlines` | **`All planning ámbitos`** (a **new lattice renderer** over the already-fetched ámbito
geometry — the live `renderPlanningPolygon` draws only the containing feature, so this is new
rendering, not a toggle). Because the nearest polygons lie outside the default viewport,
**pair it with a user-initiated "locate nearest ámbito / show ámbito map" affordance** (no
*automatic* camera fly) and label the overlay as planning ámbitos, **not** built footprints.
This is the J1 prototype hypothesis, to be validated per device class.

**PLACE panel (≤850px), top → bottom:**
1. records pill ("… · deployment snapshot")
2. mode tabs (Place / Compare / City)
3. **compact circle summary** — 4 Lens figures + radius (answers "what's in the circle?" first)
4. quick-jump chips (44 px)
5. status badges: OFFICIAL BARRIO · LENS CIRCLE · PLANNING ÁMBITO (with absence copy)
6. administrative area detail (residents, VUT) — ⓘ on every figure
7. planning ámbito detail — one inline ceiling, rest in drawer
8. granted licences — one inline ceiling, rest in drawer
9. within-the-lens detail cards (category mix, nearest, ámbitos touched)
10. context (pedestrian, hospitality)
11. **controls:** Share · Export · Reset (Share also surfaced in the panel head)

**Desktop:** unchanged except the new boundary option, the panel-head Share control, and the
reduced inline-ceiling density. **Provenance ⓘ remains on every figure at every width.**

**COMPARE / CITY:** unchanged, except (CITY) dim/hide the lens A·* badges to avoid circle-vs-city
confusion.

---

## 9. P0 / P1 / P2 follow-up plan — dependency order & measurable acceptance criteria

Each increment is a narrow PR, audit-review-gated, preserving all Gate K/L/M scientific contracts.

**P0 — J1 ámbito discovery (Register #1).** *No dependency.* First prototype target. **Treat as a
hypothesis: the prototype must demonstrate the discovery path, not assume the overlay suffices.**
- AC1: a **new lattice renderer** draws the ámbito outlines from the already-fetched geometries
  (no new artifact, no new runtime fetch); it is **not** a reuse of `renderPlanningPolygon`
  (which draws only the containing feature) and **not** merely a `planningPane` toggle.
- AC2 (**tested per device class — D, T, P**): from the default centre, a user can reach a state
  that shows **where ámbitos exist and move into one deliberately**. Because the nearest polygons
  fall outside the default zoom-14 viewport (especially mobile), AC2 is satisfied **only** when a
  **user-initiated** overview / "locate nearest ámbito" affordance is present and verified to
  bring at least one ámbito into view on each device class — the overlay alone does **not** pass.
- AC3: the overview/locate action is **user-triggered**; the **no-*automatic*-camera-fly** contract
  is preserved; explicit-absence copy unchanged; IA no-hide contract passes.
- AC4: the overlay is labelled as **planning ámbitos**, and does **not** present the polygons as
  complete built-development footprints (no dwelling counts, m²-only per Gate L).
- AC5: study probe (a) — "where can you find a planning ámbito?" — answered correctly by ≥5/6.

**P1 — small-screen rail + reading order + touch target (Registers #2, #3, #4, #10).** *Depends on
nothing; #2 resolved via #3.*
- AC1: at 375px the Administrative register (K9) header is reachable within one rail screen
  (no ~693 px scroll); each group collapsible with a **layer-count** badge (number of layers).
- AC2: at ≤850px the four Lens-circle figures are reachable within ~1 screen of the panel top
  (compact summary), provenance access intact, controls still last.
- AC3: IA no-hide contract and touch-floor checks still pass; quick-jump preserved.
- AC4 (Register #10): quick-jump chips meet the project's **44 px** coarse-pointer target at
  ≤850px (currently 30 px).

**P2 — polish & clarity (Registers #5–#10).** *After P0/P1; independent of each other.*
- #5: licence points remain visible inside the Lens with all operational layers on.
- #6: a Share control is reachable from the panel head without opening the drawer.
- #7: share confirmation states the restore-view-vs-dataset distinction in one line; probe (d)
  ≥5/6.
- #8: ≤1 inline ceiling per PLACE section; full ceilings still verbatim in the drawer.
- #9: no attribution/zoom overlap of the upper-right POI/cluster area at ≤850px; no lens badges
  painted in CITY. (Cosmetic — no control or provenance content is obstructed.)

*(Register #10, the 30 px quick-jump chip, is reprioritized into P1 above, since it fails the
project's own 44 px coarse-pointer target on small screens.)*

**Ordering rationale:** P0 unblocks the primary audience's lead journey; P1 unblocks tablet/phone
use for every audience; P2 is bounded cleanup. The human study (§7) runs alongside P0/P1 design
and gates their *final* copy/behaviour, not their start.

---

## 10. Gate verdict

**GO — to a bounded design prototype**, scoped to P0 (ámbito discovery) and P1 (small-screen rail
+ reading order), with P2 as follow-on polish and the §7 human study run in parallel to validate
comprehension.

Within what was assessed, no correctness or accessibility blocker was found: the scientific
evidence model, withholding, abstention, units, five-field freshness and verbatim ceilings are
intact and verified live across all three modes; DOM touch floors hold (except the 30 px
quick-jump chip, now P1); visible focus and native-dialog handling pass; ES/EN is clean. **This
GO authorizes design prototyping only — it is not a statement of verified production
accessibility; a full WCAG/AT audit and real-hardware + human testing were not conducted (§1,
§7).** The open items are IA/interaction/disclosure — the right material for a prototype, not a
reason to HOLD. The P0 ámbito-discovery remedy is carried as a **prototype hypothesis** whose
default-viewport discovery path must be demonstrated per device class, not assumed.

**Gate rule respected:** this pass proved what is hard to understand (J1 ámbito discovery;
small-screen rail/K9/metrics burial) first. Design the fixes next, then implement them in narrow,
separately-reviewed PRs. No redesign code, dataset, scientific-contract change or HATI change was
made here.

*No production code, data, model, scope, date, withholding rule, abstention, derivation,
interpretation ceiling or HATI layer was changed by this audit. Tablet/phone evidence is browser
emulation; real iPad/Safari hardware and human usability testing were NOT conducted.*
