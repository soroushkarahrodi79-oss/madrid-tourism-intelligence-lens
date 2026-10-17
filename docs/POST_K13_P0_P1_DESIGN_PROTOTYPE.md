# Post-K13 P0/P1 design prototype — Madrid Urban Evidence Lens

Status: **design gate only** (issue #93, UX-D1). This pass produced a decision-ready design
specification for the two items the merged post-K13 audit (#91 / PR #92) raised to P0 and P1.
It changed **no production CSS, JS, HTML, test, dataset, model, scope, date, withholding rule,
abstention, derivation or interpretation ceiling**, and it does **not** touch HATI. Its artifacts
are this document and seven static annotated wireframes under `docs/design/post-k13-p0-p1/`.

- **Baseline:** `main` @ `a4e28d1` (merge of PR #92).
- **Predecessor gate:** `docs/POST_K13_PRODUCT_UX_VALIDATION.md` (17 Oct 2026) — verdict
  *GO to a bounded design prototype*.
- **Designed:** 17 October 2026. **Revised** 17 October 2026 after independent review of
  `64816cb` on PR #94 (see [§16](#16-response-to-the-independent-review-of-64816cb)).
- **Research question (from #93):** how can an unfamiliar resident find an official planning
  ámbito from Madrid's default map view, and how can a tablet/phone user reach the most
  important Lens evidence and the K9 controls without traversing a long, competing overlay?

> **Nothing in this document has been built, rendered in the product, measured on a device or
> tried by a person.** Where a number appears it is either (a) arithmetic or a CPU-only
> measurement over a committed artifact or the shipped stylesheet, (b) a measurement carried
> forward from a named earlier gate, or (c) a labelled placeholder. Each is marked. No claim of
> discoverability, usability, comprehension or accessibility conformance is made or implied.

---

## Contents

1. [What this gate did, and the limits of its evidence](#1-what-this-gate-did-and-the-limits-of-its-evidence)
2. [Correction: the offscreen-only premise is refuted for the modelled default state](#2-correction-the-offscreen-only-premise-is-refuted-for-the-modelled-default-state)
3. [Evidence-to-design traceability](#3-evidence-to-design-traceability)
4. [P0 — three separable increments, and which are conditional](#4-p0--three-separable-increments-and-which-are-conditional)
5. [P0-a — membership disclosure (the one unconditional increment)](#5-p0-a--membership-disclosure-the-one-unconditional-increment)
6. [P0-b — lattice, overview and finder (conditional)](#6-p0-b--lattice-overview-and-finder-conditional)
7. [Camera and Lens-state contract](#7-camera-and-lens-state-contract)
8. [P1 — small-screen information architecture](#8-p1--small-screen-information-architecture)
9. [State inventory](#9-state-inventory)
10. [Microcopy — literal EN/ES strings](#10-microcopy--literal-enes-strings)
11. [Interaction states](#11-interaction-states)
12. [Accessibility considerations, and the limits of that word here](#12-accessibility-considerations-and-the-limits-of-that-word-here)
13. [Reusable small-screen interaction principles](#13-reusable-small-screen-interaction-principles)
14. [Acceptance criteria](#14-acceptance-criteria)
15. [Residual risks and the validation that has not happened](#15-residual-risks-and-the-validation-that-has-not-happened)
16. [Response to the independent review of `64816cb`](#16-response-to-the-independent-review-of-64816cb)
17. [Gate verdict — three separate decisions](#17-gate-verdict--three-separate-decisions)

---

## 1. What this gate did, and the limits of its evidence

### Method

| Activity | Done? | What it can support |
|---|---|---|
| Read the merged #92 audit and issue #93 in full | ✅ | The problem statement, the register, the stated ACs |
| Source reading of `index.html`, `css/app.css`, `js/app.js`, `js/planning-ambito.js`, `js/scope-rail.js`, `js/shell-copy.js` | ✅ | Exact selectors, breakpoints, enum values, render conditions, call sites, shipped copy |
| Execution of the **shipped pure model** (`createPlanningIndex` → `ambitoContaining` / `ambitosIntersecting`) in Node against the committed artifacts | ✅ | What the product's model returns at the default state (§2) |
| **CPU-only timing** of `ambitosIntersecting` in Node on a development laptop | ✅ | Order-of-magnitude cost of the membership query (§5.5). **Not a device measurement.** |
| Web-Mercator viewport arithmetic at zoom 14 for the three device widths | ✅ | Whether ámbito geometry falls inside a *theoretical* viewport rectangle (§2) |
| Reuse of the device-grade K12 runtime measurements (`docs/RUNTIME_DECISION_SPIKE.md` §12) | ✅ | A **precedent** for a related render, not a benchmark of the proposed one (§6.4) |
| Layout arithmetic against the shipped stylesheet | ✅ | Height budgets, which are *predictions* to be verified in implementation |
| Rendering anything proposed here in a browser | ❌ | — |
| Device testing of anything proposed here | ❌ | — |
| Assistive-technology or WCAG assessment of anything proposed here | ❌ | — |
| Any human participant | ❌ | — |

### Reproducibility of the figures in §2 and §5.5

All model figures in this document were produced against these exact committed objects, so a
reviewer can re-derive or refute them:

| Item | Identity |
|---|---|
| Repository state | `main` @ `a4e28d1`; design branch commit under review `64816cb` |
| Geometry artifact | `data/planning/madrid_ambitos.geojson` · git blob `27978f89f0248a287f555b4032f5c54da17ba5df` · last changed in commit `50512caa` (2026-10-06) · SHA-256 begins `0233062c1519…` · 3.33 MB |
| State artifact | `data/planning/madrid_ambito_state.json` (same commit) |
| Model | `js/planning-ambito.js`, unmodified, imported directly |
| Runtime | Node v24.11.0 on a Windows development laptop |

The reproduction command is in the PR description and in §2.4. **An independent reviewer reported
being unable to re-run the 3.33 MB GeoJSON through a connected GitHub reader** (it returned empty
content for a file of that size). These figures are therefore **author-reported model execution**,
reproducible locally by the command given, and they are **not** promoted here to independently
verified or device-rendered observations.

### What is NOT established by this document

- **No real iPad, iPhone, Safari or WebKit hardware was used.** Not in #92 (which was Chromium
  device *emulation*) and not here.
- **No assistive technology was used, and no WCAG 2.1/2.2 conformance is claimed** at any level,
  for the current build or for anything proposed. §12 states precisely what is and is not claimed.
- **No human being has attempted any task described here.** Every statement about what a user
  would find, understand or do is expert judgement. Where this document says a design "lets a
  user" do something, read it as *"is intended to; to be demonstrated in implementation"*.
- **No browser rendered any proposed or current state.** §2's viewport counts are geometry
  arithmetic, not screenshots, and say nothing about occlusion, legibility or discoverability.
- **The height, spacing and fit figures in §8 are arithmetic over the shipped CSS.** They are
  falsifiable predictions, deliberately written so the implementation PR can check them.
- **The timings in §5.5 are a CPU-only proxy on one development machine.** They establish an order
  of magnitude and a relative cost, not a device figure and not an interaction-latency result.

### Scope boundary honoured

No new dataset, indicator, statistical computation, score, ranking, inferred physical urban
change or dwelling count. No MapLibre/framework/3D migration. No runtime LLM, API or dependency.
No change to PLACE/COMPARE/CITY. **HATI is frozen, optional, independent ON/OFF and untouched.**
No production file is edited by this PR.

---

## 2. Correction: the offscreen-only premise is refuted for the modelled default state

This is the most consequential finding of the design gate, so it comes first. §2.5 states
precisely how far it reaches.

### 2.1 What #92 and #93 assert

The merged audit states that at the default centre the nearest ámbito polygons **lie outside the
visible viewport** — *"they sit on the periphery … especially on mobile"* — and concludes that an
overlay alone cannot satisfy discovery, so **AC2 is satisfied only when a user-initiated camera
move brings an ámbito into view on each device class.** Issue #93 repeats this: *"at default
Madrid-centre zoom 14, nearby planning geometries may be off screen, especially on a phone."*

The audit also quotes the live default planning status as *"The Lens circle touches no official
planning ámbito."*

### 2.2 Two different questions, and what the shipped model answers

The product correctly separates two questions at two analytical scopes, and the design must keep
them separate:

| Question | Shipped function | Scope |
|---|---|---|
| Does an official ámbito **contain the Lens centre**? | `ambitoContaining` | `PLANNING_AMBITO` |
| Which ámbitos does the **Lens circle intersect**? | `ambitosIntersecting` | `LENS_INTERSECT_AMBITO` |

Run against the committed artifacts (§1) at the default Lens A centre (`defaults.A` =
40.4149, −3.690, radius 900 m, `js/app.js:263`):

| Question | Result |
|---|---|
| Containment | `outside_all_ambitos` — **no containing ámbito**. The audit is right about this. |
| Membership | **9** intersecting: `APE.01.05/M`, `APE.01.08`, `APE.01.11`, `APE.03.06`, `APE.04.16`, `APR.01.05`, `APR.01.08`, `APR.01.10`, `APR.04.05` |
| Nearest ámbito | `APE.03.06 · JERÓNIMOS` at **51 m — nearest-*vertex* distance** (see §2.3) |

Sensitivity around the default position (the app also resets Lens A to −3.687 at `js/app.js:5036`,
and the map centre is 40.415, −3.692):

| Centre | r = 100 m | r = 400 m | r = 900 m | r = 2000 m |
|---|---|---|---|---|
| `defaults.A` 40.4149, −3.690 | 1 | 1 | **9** | 58 |
| reset position 40.4149, −3.687 | 0 | 1 | **7** | 64 |
| map centre 40.415, −3.692 | 1 | 3 | **10** | 63 |

### 2.3 The 51 m figure is a nearest-*vertex* distance

It was computed as the minimum great-circle distance from the Lens centre to any **coordinate
vertex** in the collection. That is **not** the shortest distance to the ámbito *boundary*: a
point can lie closer to an edge segment than to either of its endpoints, so the true boundary
distance is **≤ 51 m**. It is quoted here only to show that the nearest ámbito is metres away
rather than kilometres — a claim the inequality supports. It must not be used as a measurement,
and §6.3 forbids emitting this class of figure in the interface without a verified algorithm.

### 2.4 Viewport arithmetic — what it is and is not

Web-Mercator arithmetic at zoom 14, centred on the default map centre, counting ámbitos with at
least one **vertex inside a theoretical viewport rectangle**:

| Device class | Visible span | Ámbitos with a vertex in the rectangle |
|---|---|---|
| Desktop, map area ≈ 1000 × 900 | 7.27 × 6.54 km | **229** |
| Desktop, full 1440 × 900 | 10.46 × 6.54 km | **269** |
| Tablet 834 × 1112 | 6.06 × 8.08 km | **235** |
| Phone 375 × 812 | 2.72 × 5.90 km | **91** |

**This is a geometric fact about a rectangle, and nothing more.** It is **not** a screenshot, not
a rendered state, and not evidence that any of those ámbitos would be visible, unoccluded,
legible or discoverable. In particular it does not account for:

- the header, the left rail, the analysis panel and the Leaflet controls, which overlay the map
  and which #92 measured as occluding part of the upper-right area at ≤850 px;
- the fact that the shipped build **draws no ámbito geometry at all** in this state (C1 below),
  so these 91–269 polygons are present in the coordinate space and absent from the screen;
- whether a visible outline would be *understood* as an official planning ámbito.

Reproduce with:

```bash
node -e "(async()=>{const fs=require('fs');const m=await import('file:///C:/workspace/madrid-intelligence-tourism-lens/js/planning-ambito.js');const i=m.createPlanningIndex({geometry:JSON.parse(fs.readFileSync('data/planning/madrid_ambitos.geojson','utf8')),state:JSON.parse(fs.readFileSync('data/planning/madrid_ambito_state.json','utf8'))});const c=i.ambitoContaining(-3.69,40.4149);const t=i.ambitosIntersecting(-3.69,40.4149,900);console.log('containing:',c.state,'| touched:',t.count,t.touched.map(x=>x.ambitoCode).join(' '))})()"
```

### 2.5 What is and is not corrected

**Refuted, for the modelled default state:** the claim that the nearest planning ámbitos lie
outside the default zoom-14 viewport and that a camera move is therefore *necessary* to bring one
into the coordinate space on any device class. Geometry is present in all three rectangles, and
the default circle intersects 7–10 ámbitos.

**Not established, and requiring real browser verification at desktop 1440×900, tablet 834×1112
and phone 375×812 during implementation:** that a user can *see* an ámbito, that nothing occludes
it, that it reads as a planning boundary, or that anyone discovers it. Those are rendering and
human questions, and this gate answered neither. **AC-P0-13 carries this.**

**The copy quotation is corrected outright.** *"The Lens circle touches no official planning
ámbito"* is `planning.touchedNone` (`js/shell-copy.js:170`), which is **not** what renders at the
default state — and which would be **factually false** there, since the circle touches 7–10. The
string that actually renders is `planning.outside` (line 137), which is precise and correct:
*"No official planning ámbito **contains** the Lens centre … an explicit absence of a
**containing** ámbito — not a zero and not the nearest ámbito."* The audit conflated two strings
answering two different questions. **The shipped copy is not the defect.**

### 2.6 The three mechanical causes

Wireframe [01](design/post-k13-p0-p1/01-p0-current-desktop-default.svg).

| # | Cause | Evidence |
|---|---|---|
| **C1** | `renderPlanningPolygon(containing)` paints **only the containing feature**. At the default centre there is none, so the map draws **zero** ámbito geometry. Its own comment says 724 polygons "would be wallpaper, not orientation". | `js/app.js:3790–3837` |
| **C2** | `renderPlanningTouched()` returns early when `#placeDetail` is closed — `card.hidden = !open`, and `<details id="placeDetail">` ships **without** `open`. The touched set is therefore **never computed** at cold start. (This deferral is deliberate and has a cost consequence: §5.5.) | `js/app.js:3742–3756`, `index.html:379`, `index.html:399` |
| **C3** | `planning.outside` correctly answers *containment*, but nothing follows it with the *membership* answer the model can produce. A reader who asks "are there planning areas near me?" receives an accurate answer to a narrower question and reasonably concludes "there are none here". | `js/shell-copy.js:137` |

### 2.7 Consequence for #92 AC2

#92 §9 AC2 requires a user-initiated camera move *because* the nearest polygons were believed to
fall outside the viewport. That rationale does not hold (§2.5). AC2 is therefore **restated** in
§14 around what actually needs demonstrating — that a user can learn ámbitos exist, learn which
the circle touches, and reach a particular one's published evidence — **without presupposing which
interaction achieves it.** This supersedes the geographic premise in #92 §4 (J1), §5, §6 register
#1 and §9 P0/AC2, and disturbs no other finding and no scientific contract.

---

## 3. Evidence-to-design traceability

| #92 item | Audit's statement | This gate's position | Design response |
|---|---|---|---|
| Register **#1** (P0) · no PLACE affordance to discover where ámbitos exist | Correct **as a user-facing outcome**; its stated geographic cause is not established (§2) | Confirmed as a defect; re-attributed to C1/C2/C3 | §4–§7, wireframes 01–03 |
| §9 P0 **AC1** · a new lattice renderer over already-fetched geometry, not `renderPlanningPolygon`, not a pane toggle | Correct where a lattice is built | Adopted — but the lattice is now **conditional** (P0-b), not part of the unconditional increment | §6.2, AC-P0-4 |
| §9 P0 **AC2** · user-initiated overview/locate required because nearest polygons fall outside the default viewport | **Rationale not established** (§2.5) | Restated outcome-first and split per increment; #93 requires an overview **or** locate action, and the lattice control satisfies the overview branch | §4.3, AC-P0-2a/2b |
| §9 P0 **AC3** · user-triggered only; no *automatic* camera fly; absence copy unchanged | Correct; **scope sharpened** — the prohibition is on *new programmatic* camera moves, not on ordinary map interaction | Adopted as a scoped contract | §7, AC-P0-6 |
| §9 P0 **AC4** · labelled as planning ámbitos, never built-development footprints; m² only, no dwelling counts | Correct and adopted verbatim | Adopted, extended into a visual rule as well as a copy rule | §6.5, §10, AC-P0-7 |
| §9 P0 **AC5** · study probe (a) ≥5/6 | Correct; **cannot be met by this gate** | Routed to §15; not claimed | §15 |
| Register **#2** (P1) · K9 toggle ~693 px down a 360 px rail | Carried forward unchanged | Resolved via #3 | §8.2, AC-P1-1 |
| Register **#3** (P1) · 1,912 px stack in a 360 px overlay | Carried forward unchanged | Collapsible groups, one open at a time | §8.2, wireframe 04 |
| Register **#4** (P1) · Lens figures 4th in reading order | Carried forward unchanged | Compact circle summary above the administrative lead at ≤850 px | §8.3, wireframe 05 |
| Register **#10** (P1) · quick-jump chips 30 px vs the project's 44 px target | Carried forward, **with its root cause newly identified** | `.place-jump-chip{min-height:30px}` (line 850) beats the zero-specificity `:where(…)` floor (line 978) | §8.4, AC-P1-4 |
| §1 · 196 focusable Leaflet markers; tab order traverses them first | Carried forward, **with its source newly identified** | Cluster markers use `keyboard: true` (`js/app.js:2091`); no skip link exists. Two skip links proposed; marker behaviour left alone | §12, wireframe 06 |
| §5 · badge must be a **layer** count, never a record count | Correct and adopted | Sharpened to `n of m on`, which also answers "find layer visibility state" from #93 | §8.2, §10 |
| §8 · proposed minimal IA | Adopted, composition verified against the markup (10 toggles, 6 groups) | Adopted | §8.2 |
| Registers **#5–#9** (P2) | Out of scope for this gate | Untouched; remain P2 | §17 |

Review findings of `64816cb` are traced separately in [§16](#16-response-to-the-independent-review-of-64816cb).

---

## 4. P0 — three separable increments, and which are conditional

### 4.1 What P0 must achieve

Decomposed from #93 so each increment can be judged against each outcome:

- **O1 · Know that official planning ámbitos exist near here**, from the default cold-start PLACE
  view, without dragging the map blindly.
- **O2 · Know which ones this Lens circle touches**, distinctly from which one *contains* its centre.
- **O3 · Reach a particular ámbito's published evidence deliberately.**
- **O4 · Do all of the above without concluding that the polygons are construction sites or
  built-development footprints.**

Issue #93 asks for "a user-initiated map overview **or** locate action" — a disjunction. It does
**not** mandate a modal finder, a distance list or a camera move. Any one of the three increments
below that is user-initiated can satisfy that branch of the requirement.

### 4.2 The three increments

| | Increment | What it is | New surfaces |
|---|---|---|---|
| **P0-a** | **Membership disclosure** ([wireframe 02](design/post-k13-p0-p1/02-p0-concept-a-desktop.svg)) | Promote the `ambitosIntersecting` answer out of the closed `Detail` disclosure into the PLACE planning section: a count line and ámbito chips, directly under the unchanged containment line. | 0 |
| **P0-b1** | **Ámbito lattice / overview** | A fourth option on the existing `#boundarySelect`, "All planning ámbitos", drawn by a new stroke-only, non-interactive, viewport-culled renderer over already-fetched geometry. **This is a user-initiated map overview** and satisfies that branch of #93. | 0 new surfaces; 1 select option + 1 renderer |
| **P0-b2** | **Finder / locate action** ([wireframe 03](design/post-k13-p0-p1/03-p0-concept-b-phone.svg)) | A modal list of touched and nearby ámbitos, with a programmatic camera fit and a return path. | 1 modal + 1 panel state + camera state |

These are **not** a package. P0-a stands alone. P0-b1 and P0-b2 are independently gated, and
P0-b2 is the most expensive and least justified of the three.

### 4.3 How far each increment gets

| Outcome | P0-a alone | P0-a + P0-b1 | P0-a + P0-b1 + P0-b2 |
|---|---|---|---|
| **O1** ámbitos exist near here | ✅ stated in the default panel, no action | ✅ + shown on the map on request | ✅ |
| **O2** which the circle touches | ✅ | ✅ named and drawn | ✅ |
| **O3** reach one's published evidence | **⚠️ depends on §5.4** — if a chip can open the existing whole-ámbito reading, ✅; if not, ❌ | same as P0-a | ✅ |
| **O4** not construction | ✅ copy rules | ✅ copy + visual rules + legend | ✅ |
| #93 "overview **or** locate action" | ❌ | ✅ **overview branch satisfied** | ✅ both branches |
| Keyboard route avoiding the 196 marker tab stops | ✅ for O1/O2 | ✅ | ✅ including O3 |
| Works where the user has panned somewhere genuinely uncovered | states the zero case honestly | lattice is correctly empty | ✅ offers nearby ámbitos |

**§5.4 is the hinge.** Whether P0-a alone satisfies O3 turns on whether an ámbito chip can open the
product's existing whole-ámbito evidence surface without a new modal and without a camera move.
That is an open design question with a stated preferred answer, not a settled one.

### 4.4 Trade-off between the two optional increments

| Criterion | P0-b1 lattice/overview | P0-b2 finder/locate |
|---|---|---|
| Satisfies #93's overview-or-locate disjunction | ✅ (overview) | ✅ (locate) |
| New modal surface | none | 1 |
| New camera state | none | save/restore, plus a return control |
| New panel state that could read as a fourth mode | none | real risk (§7.4) |
| Requires a verified distance algorithm | no | **yes, or no distances at all** (§6.3) |
| Rendering-performance exposure | **high** — §6.4 | low |
| Helps where the viewport is genuinely uncovered | no | yes |
| Interaction cost to reach a named ámbito | lower if §5.4 resolves favourably | fixed, 2 actions |

The two are **genuine alternatives in interaction cost**, not two halves of one design. Choosing
both is a decision to be justified by evidence, not a requirement inherited from #93.

### 4.5 Selection

1. **P0-a ships first, alone, as an independently deliverable increment.** It addresses C2 and C3,
   which are the actual causes of the user-facing failure; it needs no new surface, no camera
   state and no new geometry; and it exposes an answer the canonical model already produces.
2. **P0-b1 (lattice) is an independently gated option**, conditional on the direct rendering
   benchmarks and supported-device decision in §6.4. It is the cheaper way to satisfy #93's
   overview branch and carries no camera or modal risk — but it carries the whole performance
   risk.
3. **P0-b2 (finder/locate) is conditional on demonstrated need.** It is justified only if P0-a
   (plus whatever §5.4 resolves) **fails O3 or fails the §15 human testing** — for example if
   participants cannot reach a named ámbito's evidence, or if the genuinely-uncovered case proves
   common in practice. Absent that evidence it is **not** built.
4. **P0-b2 must not ship without P0-a**, because without P0-a the default view still looks empty
   and the user has no reason to open a finder.

**Rejected alternatives**, recorded so they are not re-proposed:

| Rejected | Why |
|---|---|
| Lattice **on by default** | §6.4's device precedent warns of failure on the weak-laptop class, and a permanent 724-polygon wash is the "wallpaper, not orientation" problem `js/app.js:3789` already names. |
| **Automatic** camera fit when the planning status is empty | Violates #92 AC3 and the IA contract test that no mode control performs a camera action. |
| Moving the **Lens** to the nearest ámbito | Destroys every circle reading the user is looking at and changes the shareable URL state. |
| A **fourth mode** ("Plan") | #92 §5 found that adding a mode is not assumed to help; three modes are a settled contract. |
| Reusing **COMPARE**'s code entry for discovery | #92 §4 separates them correctly: code entry presumes the user already knows a code. |
| A **text search** over 724 denominations | A resident does not know ámbito names; this serves the planner case COMPARE already covers. |
| Ordering a "nearest" list **by official code** | An official-code sort is not geographical proximity and must not be presented as one (§6.3). |

---

## 5. P0-a — membership disclosure (the one unconditional increment)

### 5.1 Where it appears in PLACE

The planning section (`#planningAmbito`, `index.html:212`) keeps its position — third, after the
administrative area — and gains a defined internal order:

1. **Containment** — `planning.outside` or the resolved identity. **Verbatim unchanged.**
2. **Membership** *(new)* — the count line and up to three ámbito chips, with a route to the rest.
3. The existing scope ceiling and "What this means" disclosure.

Containment and membership stay visually and verbally separate because they are different
questions at different analytical scopes (`PLANNING_AMBITO` vs `LENS_INTERSECT_AMBITO`). The
design must not merge them into one sentence.

### 5.2 The membership block

- Renders from `index.ambitosIntersecting(centre.lon, centre.lat, radius)` — the **same canonical
  model call** `renderPlanningTouched()` already makes. **No parallel geometry computation is
  introduced.**
- At most three chips inline; the rest behind "See all n", which expands the existing `Detail`
  card (and opens the finder instead, only if P0-b2 is ever built).
- **Zero case:** `planning.touchedNone` is already correct and is reused unchanged.
- **It carries no quantity.** The apportionment refusal the model returns — *"No figure is
  apportioned … into a Lens circle"* — governs; chips carry code and denomination only.
- It does **not** re-render on anything the model does not re-evaluate, and it must never display
  a membership set that does not match the current Lens centre and radius (§5.5, AC-P0-12).

### 5.3 This increment is cheap in *surfaces*, not free at *runtime*

An earlier draft of this document called P0-a "no new computation". That was wrong in the way that
matters, and §5.5 replaces it. The call already exists, but today it **does not run** in the
default state, and promoting it changes when and how often it executes.

### 5.4 Open question: can a chip open the existing whole-ámbito evidence?

**Preferred answer: yes — evaluate this before building any finder.**

The product already renders a complete whole-ámbito reading in `#planningAmbito` for the
*resolved* case: denomination, official code, four independent published phases, characteristic
use, surface, available buildability in m² edificable, the edition reference date and the verbatim
ceiling. It is produced from canonical calls — `index.featureFor(code)`,
`index.developmentState(code)`, `index.availableBuildability(code)` — none of which require the
ámbito to contain the Lens centre.

If a chip can route into that existing surface, **O3 is satisfied inside P0-a** with no modal, no
camera move and no new evidence path. Constraints the implementation must satisfy for this to be
acceptable:

- The reading must be **visually and verbally isolated** from the containment answer, so an opened
  ámbito is never mistaken for one containing the stationary Lens centre — which, at the default
  state, does not exist at all.
- It must reuse the **canonical whole-ámbito models and the existing scope and provenance
  contracts**, not a new path.
- It must not rebind PLACE to an unrelated point, and must not silently introduce a fourth mode.
- Returning to the Lens reading must be one deliberate action.

**Known obstacle, stated honestly:** `#planningAmbito`'s state machine is currently keyed on
`planningContaining()` and memoised through `lastPlanningRenderKey`. Rendering an arbitrary code
is a real change to a scientifically sensitive surface, and the implementation PR must decide
whether it can be done cleanly. **If it cannot, O3 is not met by P0-a**, and that — not #93 — is
what would justify P0-b2.

### 5.5 Membership recomputation: triggers, measured cost and strategy

**The deferral in C2 is deliberate.** Promoting membership to the default view removes it.

**Exact recomputation triggers.** `renderPlanningTouched()` is called unconditionally from
`renderPlanningContext()` (`js/app.js:3173`), which is called from:

| Call site | Trigger | Rate |
|---|---|---|
| `refresh()` → `renderPlanningContext()` (`js/app.js:4945`) | `lenses.A/B.marker.on("drag", …)` (`js/app.js:5001–5002`) | **continuous during a drag** — Leaflet fires `drag`, not `dragend` |
| `refresh()` | `radiusSlider.oninput` (`js/app.js:5079`) | **continuous during a slider drag** |
| `refresh()` | `map.on("click")` in PLACE, which moves the active Lens (`js/app.js:5003–5009`) | per click |
| `refresh()` | lens activation, mode transitions | per action |
| `renderPlanningContext()` (`js/app.js:5108`) | language change | per action |
| `loadPlanningContext()` (`js/app.js:3079`, `3116`) | artifacts settling at load | once |

Today, with `#placeDetail` closed, the function returns **before** calling `ambitosIntersecting`,
so the scan runs **zero** times through all of the above. With P0-a it runs on **every one**.

**Measured cost — CPU-only proxy, one development laptop, Node v24.11.0, not a device:**

| Call | Median | p95 | Max |
|---|---|---|---|
| `ambitosIntersecting`, r = 900 m (default), drag-like jitter | **8.25 ms** | **13.76 ms** | 21.53 ms |
| `ambitosIntersecting`, r = 2000 m | 10.15 ms | 15.83 ms | 23.42 ms |
| `ambitosIntersecting`, r = 5000 m (max radius) | 15.63 ms | 26.18 ms | 40.42 ms |
| `ambitoContaining` (hinted), for comparison | 0.04 ms | 0.09 ms | 0.68 ms |

400 iterations per row (200 at r = 5000), warmed, centre jittered per call to defeat any caching.
724 entries scanned per call. Cross-reference: K12 §4.2 reports ≈5 ms median on a VM CPU for
`licencesInLens` **+** `ambitosIntersecting` combined; these numbers are a different machine and
this call alone, and the two are consistent as order-of-magnitude proxies.

**What this means.** Against the product's own budget (`docs/RUNTIME_DECISION_SPIKE.md` §3.2a:
pan frame p95 target ≤ 16.7 ms, maximum ≤ 33.3 ms), a single membership query at the **default**
radius consumes roughly **half a 60 fps frame on a fast desktop CPU**, and at the **maximum**
radius its p95 **exceeds a 16.7 ms frame on its own** and approaches the 33.3 ms hard ceiling
before any rendering happens. The containing query is ~200× cheaper. A phone or the weak-laptop
class would be materially worse. **This is a real interaction-latency risk, not a rounding error.**

**Strategy — measure first, then apply the minimum that the measurement justifies:**

1. **Measure before optimising.** The implementation PR measures interaction-to-paint and frame
   time on a real device with membership promoted, before adding any machinery.
2. **Identity guard (free, always correct).** Skip the scan when centre and radius are unchanged
   since the last evaluation. This removes the language-change and re-render cases outright; it
   does **not** help a drag, where the centre changes every event.
3. **Coalesce, only if measurement requires it.** Evaluate at most once per animation frame, or on
   `dragend` / slider `change` rather than every `drag` / `input`. **The codebase already
   establishes this pattern**: the K9 licence layer is "rebuilt only when the grant-date window or
   the document language changes — never on a Lens drag" (`js/app.js:3849–3851`).
4. **Freshness is non-negotiable.** Any coalescing must settle to the correct set. A stale
   membership list beside a moved Lens is a false reading, and AC-P0-12 tests exactly that after a
   drag, a radius change and a URL-state restore.
5. **No new geometry code.** Throttling and caching are scheduling concerns. The canonical
   `ambitosIntersecting` remains the only membership computation, and the no-apportionment rules
   are untouched.

---

## 6. P0-b — lattice, overview and finder (conditional)

### 6.1 The lattice renderer

Per #92 AC1: a **new** renderer, **not** a reuse of `renderPlanningPolygon` (which draws one
feature) and **not** a `planningPane` toggle (which would toggle a pane holding one feature). It
draws from `planningModel.index.entries`, which already carries each feature and a **precomputed
bounding box**, so viewport culling needs no new indexing.

- Its own Leaflet canvas renderer on `planningPane` (z-index 360), consistent with the existing
  `L.canvas({ pane: "planningPane" })` pattern.
- **Stroke-only, no fill**, in `--planning-neutral`.
- **`interactive: false`** — for two reasons. It adds **no tab stops**, so it does not worsen the
  196-marker problem of §12; and in PLACE a map click already moves the active Lens
  (`js/app.js:5003–5009`), so an interactive lattice would create a click conflict with an
  authorised existing behaviour.
- **Viewport-culled and zoom-gated** (§6.4).
- The active/containing ámbito keeps its existing renderer and stays visually distinct.
- **No new fetch.** Both planning artifacts are already fetched once at load (`loadPlanningContext`,
  `js/app.js:3072`), and moving a Lens performs an in-memory scan. The lattice preserves that.

### 6.2 The data it would draw

| Quantity | Value |
|---|---|
| Ámbito features | **724**, all `MultiPolygon` |
| Rings | 808 |
| Coordinate vertices | **140,507** |
| Universe extent | ≈ 26.8 × 26.0 km |
| Raw / gzip size | 3.33 MB / 916 KB |

Ámbitos intersecting the phone viewport rectangle by zoom: **306** at z13, **557** at z12,
**721** at z11 — the basis for culling and gating.

### 6.3 The finder, and nearest-ámbito semantics

If P0-b2 is ever justified (§4.5), it is a native `<dialog>` consistent with Evidence & limits,
with **two separately named groups** that are never merged: *Touched by the Lens circle* (from
`ambitosIntersecting`) and a nearby group.

**The nearby group has a hard precondition.** An index entry's precomputed bounding box is useful
for **pruning candidates** and nothing more. Neither bounding-box distance nor nearest-vertex
distance equals the shortest distance to a `MultiPolygon` boundary:

- a point can be nearer an **edge segment** than either of its endpoints, so a nearest-vertex
  figure is an upper bound, not the distance (§2.3);
- **holes** (interior rings) mean a point inside an outer ring may be outside the polygon, with its
  nearest boundary on an inner ring;
- **multipart** geometries mean the nearest part is not necessarily the one whose bounding box is
  nearest;
- bounding-box distance can order two candidates in the opposite order to their true distance.

Therefore, **exactly one of the following**, decided in the implementation PR:

| Option | Requirements |
|---|---|
| **(A) Build it properly** | A defined point-to-segment distance over a stated projection or geodesic, evaluated against **all** rings of **all** parts, with holes handled explicitly; deterministic fixtures covering a hole case, a multipart case, an edge-nearer-than-vertex case and a box-order-inversion case; unit tests asserting both the distance and the ordering. The figure is labelled a locating aid, carries **no analytical scope**, is never combined with a published figure and is never presented as evidence. |
| **(B) Defer it** *(default if (A) is not done)* | **Emit no numeric distance and no "nearest" ordering.** The finder shows the touched group only. The nearby feature is deferred to a later, separately justified increment. An official-code sort is **not** offered as a proximity substitute. |

**No new analytical indicator is created under either option.** This also means the 51 m figure
in §2.3 stays a document-internal argument and never reaches the interface.

### 6.4 Performance: K12 is a precedent, not a benchmark of this renderer

The K12 runtime spike measured a **related** render on physical devices. Its baseline harness
loads `data/planning/madrid_ambitos.geojson` and adds the entire FeatureCollection as one Leaflet
canvas layer (`research/runtime_spike/device_harness/leaflet_baseline.html:69–71`).

**Those results are real and are preserved here:**

| Device | Real-payload Leaflet pan p95, ámbito layer included | Against the ≤ 33.3 ms maximum |
|---|---|---|
| **iPad M3 / Safari** (`DEVICE_VALIDATION`, 38/38) | **≤ 30 ms** across all 12 real-payload pairs | inside |
| **Windows / Intel UHD 620** (partial run, 37/38) | **143–311 ms** | fails, by 4–9× |

Synthetic series, 765 polygons: iPad Leaflet 24 ms, Windows Intel UHD 620 **469 ms**. The MapLibre
trigger (≥ ~2,000 simultaneous polygons) is not crossed by 724.

**But the harness is not the proposed renderer.** The differences are material and all of them
cut in directions that change the cost:

| | K12 harness | Proposed lattice |
|---|---|---|
| Style | filled — `weight: 1`, `fillColor: "#c84"`, `fillOpacity: 0.12` | **stroke-only, no fill**, `--planning-neutral` |
| Interactivity | Leaflet default (**interactive**) | **`interactive: false`** |
| Pane | `ambitoPane`, z-index 420 | `planningPane`, z-index 360 |
| Culling / gating | none — all 724 always | **viewport-culled and zoom-gated** |
| Map centre | 40.4168, −3.7038 | product default 40.415, −3.692 |
| Surrounding UI | bare harness, `zoomControl: false`, no rail/panel/header | full production shell, panel, rail, overlays |
| Layer combinations | separate licence/admin permutations | production layer state, plus P0-a's membership query (§5.5) |
| Base tiles | OSM / Esri direct | CARTO Positron by default |

So K12 establishes that **a** 724-feature Leaflet canvas layer is tractable on a modern tablet and
**not** tractable on the weak integrated-GPU laptop class. It **cannot certify** the proposed
renderer, in either direction — stroke-only and non-interactive should be cheaper; the production
shell and the concurrent membership query are additional load.

**Release conditions for P0-b1.** The lattice ships only if all of the following hold:

1. **Direct baseline-versus-prototype measurement.** Pan frame p95 and interaction-to-paint p95
   measured on the real product, lattice OFF (baseline) versus lattice ON (prototype), using the
   K12 harness methodology and thresholds, at all three viewport classes.
2. **A declared supported-device class**, decided by the owner before the measurement is
   interpreted. K12 §12.4 blocker #2 — whether the weak integrated-GPU laptop class is a hard
   support requirement — is **open and is not closed by this document**.
3. **An acceptable result on every supported class**, with the zoom gate set from the measurement
   rather than guessed.
4. **A responsive fallback**, if any supported class fails: the lattice is withheld below a gate
   while the touched and containing outlines remain drawn, and the user is told the data exists
   and is withheld for rendering (state 6, §9).

**If a supported class cannot be made responsive by culling, gating or the fallback, the lattice
subfeature is HELD or redesigned — it is not shipped with a disclosed failure.** An earlier draft
of AC-P0-9 required only that the weak-laptop result be *recorded*; that was insufficient and has
been replaced (§14).

### 6.5 Keeping planning boundaries distinct from construction

Four rules, applying to any increment that draws or names ámbito geometry:

1. **Colour family.** All ámbito geometry uses `--planning-neutral` (`#aeb8c4`), reserved in
   `css/app.css:20` for exactly this and deliberately separate from the Lens A/B hues. The K9
   granted-licence layer keeps `--licence-neutral` (`#c0794f`).
2. **Stroke, not fill.** At lattice scale, outlines only. Fill appears solely on the containing
   ámbito (the existing 7 %) and lightly on the touched set. A field of filled polygons reads as
   built area; outlines read as a boundary scheme.
3. **A persistent legend while the lattice is on**, on the map itself — not only in the panel,
   which may be scrolled away on a phone.
4. **Vocabulary ban.** No label, legend, tooltip, `aria-label` or option text may use *development*
   (as a noun for the polygons), *projects*, *works*, *sites*, *construction*, *obras*,
   *construcción* or *promociones*. The permitted nouns are *planning ámbito* / *ámbito de
   planeamiento* and *boundary* / *límite*. Gate L's ceilings stand: m² edificable only, no
   dwelling counts, `{edition}:{code}`, no scalar stage.

---

## 7. Camera and Lens-state contract

### 7.1 What is prohibited, and what is not

The prohibition is on **new automatic or programmatic camera operations introduced by this work**.
It is **not** a restriction on how the map behaves today.

**Explicitly unaffected — ordinary, already-authorised behaviour, which continues unchanged:**

- the user panning the map by drag, wheel, pinch or keyboard;
- the Leaflet zoom control and double-click zoom;
- in PLACE, **a map click moving the active Lens** (`js/app.js:5003–5009`) — a pre-existing,
  deliberate behaviour that this work does not touch;
- the existing `zoomend` handlers that rebuild dense layers and update licence click tolerance;
- the K11 URL-state restore and the existing HATI "Show HATI pilot on the map" framing action,
  both already authorised.

### 7.2 New programmatic camera moves (P0-b2 only)

If, and only if, the finder is built, it may move the camera on **exactly two user gestures**:

| Gesture | Effect |
|---|---|
| Opening an ámbito row in the finder | Fit the map to that ámbito's bounds, with padding. Save the previous centre/zoom. |
| "← Back to the Lens" | Restore the saved centre/zoom. |

**No other new programmatic camera move is introduced.** In particular, none of the following may
cause one, restating and scoping #92 AC3:

- ✗ selecting a mode (PLACE/COMPARE/CITY);
- ✗ selecting, moving or resizing a Lens;
- ✗ an empty or absent planning status;
- ✗ turning the lattice on or off;
- ✗ loading, restoring a shared URL, or switching language.

P0-a and P0-b1 introduce **no** programmatic camera move at all.

### 7.3 Lens and shareable state

Any locate action must leave **unchanged**: Lens A and B coordinates, both radii, every evidence
reading, the active lens, and every K11 URL-state key. Locating changes the **viewport only**.
"← Back to the Lens" stays visible for as long as the camera is away from its saved position, so
the return path is never more than one target away.

### 7.4 Isolating an opened ámbito from the Lens

Whether an ámbito is opened by a chip (§5.4) or by the finder, the reading must be unmistakably
about the **whole ámbito**, not about the place the Lens sits:

- it is labelled at `PLANNING_AMBITO` scope with the existing "whole planning ámbito — not the
  Lens circle" ceiling;
- it states explicitly when the opened ámbito does **not** contain the Lens centre — which, at the
  default state, no ámbito does;
- it is visually separated from the containment answer, which remains on screen and unchanged;
- it is sourced through the **canonical whole-ámbito models** and existing scope/provenance
  contracts;
- it does **not** rebind PLACE to an unrelated point, and it is **not** a fourth product mode. If
  the implementation cannot keep that distinction obvious, the opened reading belongs in the
  Evidence & limits drawer instead.

---

## 8. P1 — small-screen information architecture

### 8.1 The geometry being designed against

From `css/app.css`, unchanged by this gate:

| Width | Rail (`.left`) | Panel (`.panel`) |
|---|---|---|
| > 850 px | static sidebar, full height | side panel |
| ≤ 850 px | 174 px wide, `max-height: min(52dvh, 430px)`, `overflow: auto` | bottom sheet, `max-height: 42dvh` |
| ≤ 560 px | 150 px wide, `max-height: min(49dvh, 360px)` | as above |
| ≤ 420 px | 142 px wide | as above |
| ≤ 850 px **and** ≤ 700 px tall | — | `max-height: 44dvh` |

At 375 × 812 that is the audit's measured **360 px window holding a 1,912 px stack**, with the K9
toggle **693 px** inside it.

### 8.2 Collapsible rail groups

Wireframe [04](design/post-k13-p0-p1/04-p1-rail-tablet.svg).

**Six groups, collapsed by default at ≤850 px, one open at a time.** Composition verified against
`index.html` — **10 layer toggles, the same ten that ship today**; nothing is added, removed,
renamed or reordered:

| # | Group | Contents | Layers |
|---|---|---|---|
| 1 | Map display | base map select, administrative boundaries select *(gains the "All planning ámbitos" option only if P0-b1 ships)* | — (2 settings) |
| 2 | Operational layers | Museums, Hotels & stays (+ accommodation category filter), BiciMAD, Metro & Cercanías, Tourist info | 5 |
| 3 | **Administrative register** | Granted urban licences — **K9** | 1 |
| 4 | Observed activity | Pedestrian counters | 1 |
| 5 | Context | Principal parks, Hospitality & commercial context | 2 |
| 6 | Research evidence | HATI · thermal pilot *(frozen, untouched)* | 1 |

**Mechanism:** native `<details name="rail">` / `<summary>`. The product already uses native
`<details>` and `<dialog>` and the audit found focus handling on both to pass, so this inherits
keyboard operation, expanded/collapsed state and find-in-page without hand-rolled ARIA.
`<summary>` is already covered by the coarse-pointer 44 px floor at `css/app.css:978`.
**Fallback:** where exclusive-accordion (`name`) is unsupported, groups stay independently
collapsible and the rail scrolls — degraded, never broken.

**Badge rule.** `n of m on` — how many layers in the group are switched on, over how many the group
contains. Both numbers are properties of the interface.

- ✅ "Operational layers · 5 of 5 on", "Administrative register · 0 of 1 on"
- ❌ "Administrative register · 11,265", "Context · 1,470 premises", "Ámbitos · 724"

A record count on a group header reads as a measurement of the territory. Counts that *are*
evidence stay in the panel with their scope, unit, five dates and ceiling. This form also answers
#93's "find layer visibility state" without expanding anything.

**Height budget**, worst case, assuming the two longest labels wrap at 150 px:
`4 × 44 px + 2 × 48 px = 272 px`, `+ 5 gaps × 6 px = 302 px`, `+ group label 26 px = 328 px`.
Against a 430 px rail at 834 px → **102 px spare**; against a 360 px rail at 375 px → **32 px
spare**. The **K9 header is the third row, ≈192 px down**. *This is arithmetic over the shipped
stylesheet, not a rendered measurement — it is written to be checked, and AC-P1-1 checks it.*

**Desktop > 850 px is unchanged**: groups render expanded, so no desktop user loses a visible
control and the #86 desktop improvement is preserved rather than re-litigated.

### 8.3 Compact circle summary

Wireframe [05](design/post-k13-p0-p1/05-p1-phone-reading-order.svg). At ≤850 px only, a band
directly below the panel head and **above** the administrative lead, carrying the four existing
Lens figures and the radius.

| | Rule |
|---|---|
| **R1** | Four figures and the radius. Nothing else — no fifth number, no total, no average, no combined index. |
| **R2** | Abstention and OFF survive compression. UTCI reads `—` with its state, never `0` and never blank. Missing is never zero. |
| **R3** | Provenance is reachable **from the band itself**: one ⓘ opening Evidence & limits scoped to the Lens-circle surfaces. Per-figure ⓘ stays on the full block. |
| **R4** | The scope label is on the band — "In this Lens circle · ◎ 900 m radius" — so it can never be read as the barrio, the ámbito or the municipality. |
| **R5** | Additive, never a replacement. The full `.metrics` block stays exactly where it is at every width, so the IA no-hide contract still passes. |
| **R6** | The radius shown is the **live** radius. A stale "900 m" beside live figures would be a false reading. |

**It is a projection, not an object.** It renders the same four evidence objects from the same
state in the same render pass as the block it summarises. It introduces no new measurement and
cannot disagree with the block below, because there is one source of truth behind both. It adds
**no** new computation: the four figures are already evaluated once per `refresh()`.

**Everything after step 1 keeps its order.** The administrative area, planning ámbito and licence
sections are not reordered relative to each other, and controls stay last.

**Height cost at 375 × 812:** the sheet is ≈341 px (42dvh); the head grows 14 px (chips 30 → 44 px)
and the band adds 64 px + 8 px margin ≈ **86 px**. Displaced material moves down the same internal
scroll it already lived on; nothing leaves the document. *Open question for implementation: whether
the panel should be allowed ~48dvh at ≤560 px — a map-area-versus-panel-area trade to be decided
against a real device.*

### 8.4 The 44 px quick-jump chip

Root cause: `css/app.css:978` already declares a universal coarse-pointer floor, but through
`:where(button, select, summary, …)`, which has **zero specificity**. The class rule
`.place-jump-chip{min-height:30px}` at line 850 therefore wins.

**The fix is that one declaration**, not a new rule. `tests/responsive.test.mjs` already asserts
the `:where()` floor exists; the implementation PR should add an assertion that no class rule
undercuts it for a coarse-pointer control.

---

## 9. State inventory

Wireframe [07](design/post-k13-p0-p1/07-state-inventory.svg) carries the full matrix. States 5 and
6 arise only if P0-b1 ships.

| # | State | Model value | Map | Panel |
|---|---|---|---|---|
| 1 | **Loading** | `AMBITO_STATE.LOADING` | nothing — **never a placeholder boundary** | loading copy; any lattice option and finder control disabled |
| 2 | **Unavailable** | `AMBITO_STATE.UNAVAILABLE` (index is `null`) | nothing; a lattice option is **disabled, not removed** | unavailable copy — a statement about the *deployment*, saying nothing about whether ámbitos exist here |
| 3 | **No containing ámbito** *(the default)* | `OUTSIDE_ALL_AMBITOS` | today nothing; **with P0-b1:** touched outlines, plus the lattice if on | containment copy verbatim, **then** the membership count (P0-a) |
| 4 | **Resolved** | `AMBITO_STATE.RESOLVED` | containing polygon, dashed neutral + 7 % fill + code label — unchanged | identity, four independent phases, use, surface, buildability, edition date, ceiling — unchanged |
| 5 | **Lattice on** *(P0-b1 only)* | a view option, not a model state | outlines of every ámbito in view, stroke-only, neutral, + legend | panel copy unchanged; the legend carries the planning-≠-construction distinction |
| 6 | **Lattice on, below the zoom gate** *(P0-b1 only)* | a rendering guard, not an evidence state | lattice withheld; touched/containing outlines still drawn | an explicit "zoom in" message — **never** phrased as absence, unavailability or zero |
| 7 | **A layer is OFF** | `"OFF"`, distinct from `"UNAVAILABLE"` | nothing for that layer; badge reads `0 of 1 on` | "Layer off — turn it on in the rail to read it." |

Four facts the product currently keeps apart and that this gate must not collapse: **OFF** (the
user chose not to look), **UNAVAILABLE** (the deployment cannot serve it), an **observed zero**
(the layer is on and genuinely nothing resolves inside the Lens), and **absence from the universe**
(the ámbito universe does not cover this place). Within a resolved ámbito, the four per-field value
states — `PUBLISHED`, `NOT_PUBLISHED`, `NOT_PUBLISHED_NON_NUMERIC`, `NOT_PUBLISHED_IN_EDITION` —
remain untouched.

**Source authority throughout:** Ayuntamiento de Madrid, PGOUM ámbito geometry and dated edition
state, keyed `{edition}:{code}` per Gate L. Buildability is m² edificable for the **whole ámbito**;
no dwelling count is published or derivable; no overall stage, progress, percentage or timeline
exists; no figure is apportioned into the Lens circle.

---

## 10. Microcopy — literal EN/ES strings

Spanish is drafted to match the product's existing institutional register — impersonal,
*"la Lente"*, *"el círculo de Lente"*, not *"tu círculo"*. `n` is a count placeholder. Strings are
grouped by the increment that needs them, so an increment that is never built never adds keys.

Both dictionaries must receive every key: `tests/information_architecture.test.mjs` already asserts
that `SHELL_DICTIONARIES.en` and `.es` have identical key sets with no empty value, and that every
`data-i18n` key in the markup exists in both.

### P0-a — membership disclosure

| Key | EN | ES |
|---|---|---|
| `planning.touchedCount` | The Lens circle touches **n** official planning ámbitos. | El círculo de Lente toca **n** ámbitos oficiales de planeamiento. |
| `planning.touchedCountOne` | The Lens circle touches **1** official planning ámbito. | El círculo de Lente toca **1** ámbito oficial de planeamiento. |
| `planning.touchedNone` *(exists, reused unchanged)* | The Lens circle touches no official planning ámbito. | El círculo de Lente no toca ningún ámbito oficial de planeamiento. |
| `planning.touchedSeeAll` | See all n → | Ver los n → |
| `planning.touchedNotContaining` | This ámbito does not contain the Lens centre. | Este ámbito no contiene el centro de la Lente. |
| `planning.lookingAt` | Looking at | Estás viendo |
| `planning.lookingAtScope` | whole planning ámbito — not the Lens circle | ámbito de planeamiento completo — no el círculo de Lente |
| `planning.backToLensReading` | ← Back to the Lens reading | ← Volver a la lectura de la Lente |

### P0-b1 — lattice / overview

| Key | EN | ES |
|---|---|---|
| `aside.boundaries.ambitos` | All planning ámbitos | Todos los ámbitos de planeamiento |
| `planning.legend.title` | Official planning ámbitos · PGOUM boundaries | Ámbitos oficiales de planeamiento · límites del PGOUM |
| `planning.legend.ceiling` | Planning boundaries — not construction, not built footprints. | Límites de planeamiento — no es construcción, no son huellas de lo edificado. |
| `planning.latticeZoom` | Zoom in to show every planning ámbito. The ones the Lens circle touches stay visible. | Acerca el mapa para ver todos los ámbitos de planeamiento. Los que toca el círculo de Lente siguen visibles. |
| `planning.loading` | Loading official planning ámbitos… | Cargando los ámbitos oficiales de planeamiento… |
| `planning.unavailable` | The official planning-ámbito layer is unavailable in this deployment. | La capa oficial de ámbitos de planeamiento no está disponible en este despliegue. |

### P0-b2 — finder / locate (only if justified per §4.5)

| Key | EN | ES |
|---|---|---|
| `planning.find` | Find planning ámbitos | Buscar ámbitos de planeamiento |
| `planning.findAria` | Find official planning ámbitos near this Lens | Buscar ámbitos oficiales de planeamiento cerca de esta Lente |
| `planning.finder.title` | Find planning ámbitos | Buscar ámbitos de planeamiento |
| `planning.finder.intro` | Official PGOUM planning boundaries. Not construction, not built footprints, and no dwelling count is published or derivable. | Límites oficiales de planeamiento del PGOUM. No es construcción, no son huellas de lo edificado, y no se publica ni se deriva ningún número de viviendas. |
| `planning.finder.touchedGroup` | Touched by the Lens circle | Tocados por el círculo de Lente |
| `planning.finder.openNote` | Opening one moves the map to show that ámbito. The Lens stays where it is and every reading is preserved. | Al abrir uno, el mapa se desplaza para mostrar ese ámbito. La Lente no se mueve y se conservan todas las lecturas. |
| `planning.backToLens` | ← Back to the Lens | ← Volver a la Lente |
| `planning.backToLensAria` | Return the map to the Lens, where it was before | Devolver el mapa a la Lente, donde estaba antes |

*No `nearestGroup` or `distanceNote` key is specified. Those exist only under §6.3 option (A), and
only once the algorithm and its fixtures exist.*

### P1 — rail, summary and skip links

| Key | EN | ES |
|---|---|---|
| `aside.map` / `aside.layers` / `aside.administrative` / `aside.observed` / `aside.context` / `aside.research` *(all exist)* | Map display / Operational layers / Administrative register / Observed activity / Context / Research evidence | Visualización del mapa / Capas operativas / Registro administrativo / Actividad observada / Contexto / Evidencia de investigación |
| `aside.groupBadge` | n of m on | n de m activas |
| `aside.groupBadgeSettings` | n settings | n ajustes |
| `aside.groupAria` | n of m layers in this group are on | n de m capas de este grupo están activas |
| `aside.groupExpandAria` | Show the layers in this group | Mostrar las capas de este grupo |
| `place.circleSummary` | In this Lens circle | En este círculo de Lente |
| `place.circleSummaryRadius` | ◎ n m radius | ◎ n m de radio |
| `place.circleSummaryAria` | Summary of the four readings inside this Lens circle | Resumen de las cuatro lecturas dentro de este círculo de Lente |
| `a11y.skipToPanel` | Skip to the analysis panel | Saltar al panel de análisis |
| `a11y.skipToLayers` | Skip to the map layers | Saltar a las capas del mapa |
| `layer.off` | Layer off — turn it on in the rail to read it. | Capa desactivada — actívala en el panel lateral para leerla. |

### Copy rules

1. **Never** use *development* (as a noun for the polygons), *projects*, *works*, *sites*,
   *construction*, *obras*, *construcción* or *promociones* for a planning ámbito.
2. **Containment and membership are different sentences.** Never merge them.
3. The **zoom-gate** message says the data exists and is withheld for rendering. It is never
   phrased as absence, unavailability or zero.
4. **No distance or proximity wording** unless §6.3 option (A) is implemented and tested.
5. Spanish is designed with the English, not translated after it. The Spanish band label is ~22 %
   longer, so the band **wraps rather than truncates** — a truncated scope label is a lost scope
   label.
6. Every existing verbatim interpretation ceiling stays verbatim. Thinning inline caveat density is
   P2 register #8 and is **not** attempted here.

---

## 11. Interaction states

| Surface | Increment | Default | Hover / focus | Active | Disabled | Error / absent |
|---|---|---|---|---|---|---|
| Membership count line | P0-a | present whenever the planning section renders | — | — | — | zero case → `planning.touchedNone` |
| Membership chip | P0-a | neutral outline, code + denomination | `:focus-visible` outline + ring; the ámbito highlights if drawn | opens the whole-ámbito reading (§5.4) with the not-containing note | — | — |
| "← Back to the Lens reading" | P0-a | visible only while an ámbito reading is open | `:focus-visible` | restores the Lens reading | — | — |
| Boundary select, "All planning ámbitos" | P0-b1 | not selected | `:focus-visible` | lattice drawn, legend shown | disabled while loading or unavailable, with the reason beside it | below the zoom gate → state 6 copy |
| "Find planning ámbitos" | P0-b2 | 44 px button in the planning section | `:focus-visible` | dialog open, focus inside | disabled while loading or unavailable | — |
| Finder row | P0-b2 | code + denomination | row highlight | locate fires; dialog closes; the reading opens | — | — |
| "← Back to the Lens" | P0-b2 | visible only while the camera is away | `:focus-visible` | camera restored; the control disappears | — | — |
| Rail group `<summary>` | P1 | collapsed ≤850 px, ≥44 px tall, badge `n of m on` | `:focus-visible` | expanded; siblings close | — | — |
| Circle summary band | P1 | four figures + live radius + ⓘ | ⓘ `:focus-visible` | ⓘ opens the drawer scoped to Lens-circle surfaces | — | UTCI `—` + state; never `0` |
| Quick-jump chip | P1 | ≥44 px at coarse pointer | `:focus-visible` | scrolls to its section | — | — |

**Progressive disclosure, one sentence per level:** the count line answers *"are there any?"*; the
chips answer *"which?"*; the opened reading answers *"what does the plan publish about it?"*;
Evidence & limits answers *"who published it, when, at what scope, and what may I not conclude?"*
No level removes a provenance field from the level below it.

---

## 12. Accessibility considerations, and the limits of that word here

Wireframe [06](design/post-k13-p0-p1/06-keyboard-focus-path.svg) carries the focus-path diagram.

### What is proposed

- **Two skip links** — "Skip to the analysis panel" and "Skip to the map layers" — as the first two
  focusable elements, `.sr-only` until focused, using the class the product already ships. This
  addresses the audit's tab-order caveat: 196 focusable Leaflet marker/cluster elements, with a
  cluster marker reached on the third Tab. **Source newly identified:** cluster markers are created
  with `keyboard: true` at `js/app.js:2091`, and there is no skip link in `index.html`.
- **Native disclosure and dialog throughout** — `<details>/<summary>` for rail groups, `<dialog>`
  if a finder is ever built. No hand-rolled ARIA accordion, no custom focus trap.
- **Any lattice is `interactive: false`**, so it adds **zero** tab stops.
- **44 px coarse-pointer floor** for every new control, and the one existing control that undercuts
  it is fixed (§8.4).
- **Focus return** to the trigger on Escape or Close.
- **Visible focus**: the existing `:focus-visible` outline + ring applies to all new controls.

### What is deliberately NOT proposed

Setting `keyboard: false` on cluster markers would shorten the tab order by **removing keyboard
access to the clusters**, trading one accessibility problem for another. A roving-tabindex over the
marker layer is the better answer but needs an assistive-technology pass to design responsibly. It
is named as follow-on work and is **out of scope for P1**.

### What is NOT claimed

> This design is **not** asserted to conform to WCAG 2.1 or 2.2 at any level. No screen reader has
> announced any of it. Landmark structure, heading order, group semantics, live-region behaviour
> and AT focus order have not been assessed — not in #92 and not here. No real keyboard on real
> hardware has been used. The skip-link and dialog behaviours described follow from platform
> behaviour the product already relies on and from the DOM facts cited; they are reasoned
> expectations, not test results. A full WCAG/AT audit remains a separate, unscheduled gate.

---

## 13. Reusable small-screen interaction principles

1. **Answer the arriving question first.** A jump shortcut is a mitigation, not a reorder.
2. **A compressed view is a projection of the same object, never a new one.** If a compact surface
   could ever disagree with its full version, it is a second source of truth and is wrong.
3. **Compression may drop detail; it may never drop a state.** OFF, unavailable, withheld,
   abstained and observed-zero all survive into the smallest surface.
4. **Group headers count interface, never data.** `n of m on` is a fact about switches.
5. **Collapse by default only where the collapsed header is itself informative.**
6. **Deferred work has a cost when you undefer it.** Moving a computation from a disclosure into the
   default view changes how often it runs; measure before and after, and never let coalescing leave
   a stale reading beside live state.
7. **The camera is the user's.** No *new* programmatic move except on a gesture whose purpose is to
   move it — and ordinary manual pan and zoom are never restricted.
8. **Any programmatic camera move ships with its way back**, visible while the move is in effect.
9. **Reveal geometry before you move to it.** Showing where things are is cheaper, safer and less
   disorienting than transporting the user.
10. **State a rendering limit; never let it read as an absence.**
11. **Prefer native disclosure primitives.** They bring keyboard behaviour, state semantics and
    find-in-page for free, and they fail gracefully.
12. **Design the second language with the first.** Where Spanish runs ~20 % longer, the layout
    wraps; it never truncates a scope label, a unit or a ceiling.
13. **Nothing visual may imply a claim the evidence model refuses.** A filled polygon implies built
    area; outlines imply a boundary scheme. The colour family is part of the contract.
14. **A derived number is not an indicator unless it is verified.** Do not emit a distance, a rank
    or an ordering whose algorithm has not been defined and tested against fixtures.

---

## 14. Acceptance criteria

Testable in a later implementation PR, grouped by increment so each can be gated independently.
**None of these has been run.**

### P0-a — membership disclosure

| ID | Criterion | How checked |
|---|---|---|
| **AC-P0-1** | At cold start, at the default centre, on each of 1440×900 / 834×1112 / 375×812, PLACE states **both** that no ámbito contains the Lens centre **and** how many official ámbitos the circle touches — without the user opening a disclosure, moving the map or moving the Lens. | DOM assertion on initial render at three viewports |
| **AC-P0-2a** | From that initial state the user can reach **a named individual ámbito's published whole-ámbito evidence in ≤ 2 deliberate actions** — *if* §5.4 resolves favourably. If it does not, this criterion is **explicitly not met by P0-a**, the gap is recorded, and it becomes the justification for considering P0-b2. | Scripted interaction at three viewports; a negative result is a recorded outcome, not a failure to hide |
| **AC-P0-5** | Membership figures come from the canonical `ambitosIntersecting` and carry **no quantity, share or proportion** of any ámbito's published values; the apportionment refusal still holds; no parallel geometry computation exists. | Existing contract tests extended + source assertion |
| **AC-P0-11** | The containment copy (`planning.outside`) is unchanged, byte for byte. | String assertion |
| **AC-P0-12** | **Latency and freshness.** With membership promoted: interaction-to-paint p95 during a Lens drag and a radius drag stays within the product's existing thresholds (≤ 100 ms target, ≤ 150 ms maximum) and pan frame p95 within ≤ 16.7/33.3 ms, measured on each supported device class. The displayed membership set **matches the current Lens centre and radius** after a drag, after a radius change and after a K11 URL-state restore — no stale set, at any coalescing setting used. | Device measurement + state-settlement tests for all three transitions |
| **AC-P0-13** | **Real-browser verification of §2.** At 1440×900, 834×1112 and 375×812 in a real browser, record what is actually rendered and visible at the default state: whether ámbito geometry is drawn, and whether rail, panel and map-control overlays occlude it. §2's viewport arithmetic is treated as refuted-or-confirmed by this, not as settled. | Browser capture at three widths |
| **AC-P0-10** | EN and ES dictionaries carry every new key, non-empty; every `data-i18n` key in the markup exists in both. | `tests/information_architecture.test.mjs` "M" tests, already present |

### P0-b1 — lattice / overview (conditional)

| ID | Criterion | How checked |
|---|---|---|
| **AC-P0-4** | The lattice is drawn by a **new renderer over already-fetched geometry** — not `renderPlanningPolygon`, not a `planningPane` toggle — adds **no runtime fetch**, is stroke-only, `interactive: false`, and adds **no tab stop**. | Source + network + focus-order assertions |
| **AC-P0-2b** | The lattice control is a **user-initiated map overview**, reachable at all three viewport classes, satisfying that branch of #93. | Scripted interaction at three viewports |
| **AC-P0-7** | No label, legend, tooltip, `aria-label` or option text applies *development* / *projects* / *works* / *sites* / *construction* / *obras* / *construcción* / *promociones* to an ámbito. The lattice is stroke-only in `--planning-neutral`, and the legend carries the planning-≠-construction line whenever it is on. | Lint-style assertion over markup + dictionaries; CSS assertion |
| **AC-P0-8** | The seven states of §9 are individually reachable and visually distinct; the zoom-gate message is never phrased as absence, unavailability or zero. | State-by-state DOM assertion |
| **AC-P0-9** | **Direct baseline-versus-prototype measurement**, lattice OFF versus ON, on the real product at all three viewport classes, for pan frame p95 and interaction-to-paint p95, using the K12 methodology and thresholds. **Every declared supported device class must pass**, with the zoom gate set from the measurement. **If a supported class cannot be made to pass by culling, gating or the documented fallback, the lattice is HELD or redesigned — recording the failure is not sufficient.** The supported-device class is declared by the owner *before* the result is interpreted. | Device runs, both arms, per class |

### P0-b2 — finder / locate (conditional, only if §4.5 is satisfied)

| ID | Criterion | How checked |
|---|---|---|
| **AC-P0-3** | A **user-initiated** locate action exists and is reachable **without focusing any map marker** at all three viewport classes. | Keyboard-only traversal from document start |
| **AC-P0-6** | **No new programmatic camera move** exists beyond the two in §7.2. Ordinary manual pan/zoom, the Leaflet zoom control, the PLACE click-moves-Lens behaviour and the existing `zoomend`/K11/HATI actions are **unchanged**. Lens coordinates, radii, readings, active lens and **every K11 URL-state key** are unchanged by a locate. | Behavioural assertion per forbidden trigger; URL + lens-state snapshot before/after; regression test on existing map behaviour |
| **AC-P0-14** | An opened ámbito reading is sourced through the **canonical whole-ámbito models**, is labelled at `PLANNING_AMBITO` scope, states when it does **not** contain the Lens centre, is visually isolated from the containment answer, does not rebind PLACE, and does not present as a fourth mode. | DOM + source assertions |
| **AC-P0-15** | **Either** a defined point-to-segment distance algorithm exists, handling all rings of all parts including holes, with deterministic fixtures covering a hole case, a multipart case, an edge-nearer-than-vertex case and a box-order inversion — **or** no numeric distance and no "nearest" ordering is emitted anywhere, and no official-code sort is presented as proximity (§6.3). | Fixture tests, or an absence assertion over the markup and dictionaries |

### P1 — small-screen IA

| ID | Criterion | How checked |
|---|---|---|
| **AC-P1-1** | At 375×812 **every** group header, including Administrative register (K9), is within the rail's first screen — no scroll, no ~693 px offset. §8.2 predicts ≈192 px for K9 and 32 px spare; the measurement decides. | Rendered geometry at 375×812 |
| **AC-P1-2** | Each group is collapsible, carries an `n of m on` badge, and **no badge anywhere shows a dataset record count**. | DOM + lint-style assertion |
| **AC-P1-3** | At ≤850 px the four Lens-circle figures and the live radius are within ~1 screen of the panel top; provenance is reachable from the band; controls are still last. | Rendered geometry at 834 and 375 |
| **AC-P1-4** | Every coarse-pointer control, quick-jump chips included, meets 44 px; no class rule undercuts the `:where()` floor. | `tests/responsive.test.mjs` extended |
| **AC-P1-5** | The IA no-hide contract still passes: no `@media` block hides a provenance-bearing selector, the rail and drawer are never hidden, and the full `.metrics` block exists at every width. | `tests/information_architecture.test.mjs` "J" tests, already present |
| **AC-P1-6** | Collapsing changes no layer's on/off state, and a collapsed badge never misreports it. | Toggle-state assertion across collapse/expand |
| **AC-P1-7** | The compact band and the full block render identical values in the same pass; UTCI abstention shows `—` with its state, never `0`. | Paired-render assertion incl. the abstention case |
| **AC-P1-8** | Desktop > 850 px layout and reading order are unchanged from `main`. | Rendered-geometry diff at 1440×900 |
| **AC-P1-9** | Two skip links are the first two focusable elements, visible on focus, and reach the panel and the rail without traversing a map marker. | Keyboard traversal from document start |
| **AC-P1-10** | HATI is untouched: same group, same independent ON/OFF, same provenance, same rendering. | File-level assertion that no HATI source changed |

### Not acceptance criteria for implementation

`AC5` of #92 §9 — study probe (a), answered correctly by ≥5/6 participants — is a **study**
outcome. It gates final copy and behaviour, not the merge of an implementation PR, and no amount
of design or code review can meet it.

---

## 15. Residual risks and the validation that has not happened

| # | Risk | Severity | How it would be retired |
|---|---|---|---|
| R1 | **Nobody has tried any of this.** The P0-a premise — that disclosing membership makes the default view comprehensible — is a hypothesis. | **High** | The §15 study: 6 participants, on real devices |
| R2 | **The lattice may fail a supported device class.** K12 measured 143–311 ms real-payload pan on Intel UHD 620 for a *related* render. The gate and fallback may not be enough, and the supported-device floor is an open owner decision (K12 blocker #2). | **High** | AC-P0-9, with HOLD-or-redesign as the stated consequence, not disclosure |
| R3 | **No real iPad/iPhone/Safari hardware** has run any of this; #92's tablet/phone evidence was Chromium emulation. | **High** | Real-device pass in the implementation PR |
| R4 | **No assistive-technology or WCAG assessment** exists for the current build or this design. | **High** | A separate accessibility gate |
| R5 | **Promoting the membership query adds real per-interaction cost** — measured at 8.25 ms median / 13.76 ms p95 at the default radius and 15.63/26.18 ms at maximum radius, CPU-only on a fast development machine, against a 16.7 ms frame target. Device cost is unknown and likely worse. | **High** | AC-P0-12; the §5.5 strategy, applied only as far as measurement justifies |
| R6 | **§2's viewport counts are geometry, not rendering.** They do not establish that any ámbito is visible, unoccluded or discoverable, and the shipped build draws none of them. | Medium | AC-P0-13, plus the §15 study for discoverability |
| R7 | **§5.4 may not resolve favourably.** If `#planningAmbito` cannot cleanly render an arbitrary code, P0-a does not satisfy O3. | Medium | Decided in the P0-a implementation PR; AC-P0-2a records either outcome |
| R8 | **An opened ámbito could be read as containing the Lens centre**, or as a fourth mode. | Medium | AC-P0-14; fall back to opening the reading in the Evidence & limits drawer |
| R9 | The **height budgets in §8 are arithmetic**, not measurements; font metrics, wrapping and safe-area insets could overturn the 32 px margin at 375 px. | Medium | AC-P1-1, AC-P1-3 |
| R10 | **A nearest/distance feature could leak an unverified geometric claim** into the interface. | Medium | AC-P0-15 — build it properly with fixtures, or emit nothing |
| R11 | The **exclusive-accordion `name` attribute** may be unsupported on some target browsers. | Low | Documented graceful fallback (§8.2); verify on reference devices |
| R12 | **≈86 px of a 341 px bottom sheet** is spent on the compact band; a short landscape phone could crowd the panel. | Low | Measure at 375×812 and at a landscape height; the 48dvh question is open |
| R13 | My §2 and §5.5 figures rest on **local model execution**, which an independent reviewer could not re-run through a GitHub file reader (the 3.33 MB artifact returned empty). | Low | §1 gives the artifact identity and the reproduction command; AC-P0-13 renders it |

### The human and hardware validation plan

Adopted from #92 §7 and extended. **It has not been run.**

- **Participants:** 6 — 2 Madrid residents, 2 municipal planners, 2 tourism analysts. Moderated,
  ~30 minutes each, on real devices **including at least one real iPad and one real phone**, and at
  least one weak integrated-GPU laptop for R2.
- **Fixed start state:** the default cold start, PLACE, default Lens, no layers changed.
- **Tasks:** the five journeys of #92, plus *T6: find an official planning ámbito and tell me its
  code*; *T7: on a phone, turn on granted urban licences*.
- **Comprehension probes:** the four from #92, plus *(e)* "does this outline mean something has
  been built there?" and *(f)* "the panel says no ámbito contains the Lens centre, and also that
  the circle touches nine — are those contradictory?"
- **Targets:** ≥5/6 task success per journey; all probes correct by ≥5/6. Probe (e) governs whether
  the planning-vs-construction design works at all. **T6's result on P0-a alone is the evidence
  that decides whether P0-b2 is ever justified.**
- **Separately, and not substitutable:** an assistive-technology pass and a WCAG 2.1/2.2 audit.

---

## 16. Response to the independent review of `64816cb`

| # | Review finding | Resolution |
|---|---|---|
| **1** | B is not literally required by #93; A and B are genuine alternatives; "ship both" is a choice. Recommend A as standalone P0-a, lattice independently gated, B conditional. Evaluate a chip opening existing whole-ámbito evidence. Align AC-P0-2. | §4 rewritten into **three separable increments**. P0-a is standalone and unconditional; P0-b1 (lattice) is independently gated and **satisfies #93's overview branch**; P0-b2 (finder) is **conditional on demonstrated need**, justified only by an O3 or study failure. §5.4 adds the chip-opens-existing-evidence evaluation with its constraints and its known obstacle. AC-P0-2 is split into **AC-P0-2a** (P0-a, with a recorded negative outcome permitted) and **AC-P0-2b** (P0-b1). The claim "required by the gate" is removed from §4 and §17. |
| **2** | "already measured this exact render" is too strong; K12 differs in style, interactivity, pane, centre and layer combinations. Require baseline-vs-prototype measurement and a defined supported class; recording a weak-laptop failure is not sufficient. | §6.4 rewritten. K12 results **preserved verbatim** (iPad ≤ 30 ms; Windows 143–311 ms; synthetic 765-polygon 24 ms / 469 ms) but reframed as a **precedent**, with an eight-row table of the differences. Four **release conditions** added, including a baseline-versus-prototype measurement and an owner-declared supported class. **AC-P0-9 rewritten**: every supported class must pass, and a class that cannot be made responsive means the lattice is **HELD or redesigned**, not shipped with a disclosure. |
| **3** | Refine the geographic correction's certainty; specify artifact/SHA; say whether 51 m is nearest vertex; require browser testing at three widths. | §2 restructured and retitled *"refuted for the modelled default state"*. §1 adds a **reproducibility table** with the blob SHA `27978f89…`, the source commit `50512caa`, the SHA-256 prefix and the runtime, and records that the reviewer could not re-run the 3.33 MB artifact. §2.3 states the 51 m is a **nearest-vertex** distance and an **upper bound** on boundary distance. §2.4 states explicitly that viewport arithmetic is not a screenshot and lists what it does not account for, including overlay occlusion. §2.5 separates what is refuted from what needs browser verification, and **AC-P0-13** requires it at all three widths. |
| **4** | Bounding boxes prune candidates but do not give nearest-boundary distance; holes make it subtler. Either prove the algorithm with fixtures or remove distance and defer. | §6.3 rewritten with the four geometric reasons (edge-nearer-than-vertex, holes, multipart, box-order inversion) and a **binary choice**: build a defined point-to-segment algorithm with four named fixture classes, **or** emit no distance and no ordering and defer the feature. "Sort by official code" is added to the rejected-alternatives table. All `nearestGroup` / `distanceNote` microcopy is **removed** from §10. **AC-P0-15** enforces the choice. New principle 14. |
| **5** | Scope the prohibition to new automatic/programmatic camera operations; ordinary pan/zoom must remain; isolate an opened ámbito from the stationary Lens; do not rebind PLACE. | §7 rewritten as a scoped contract. §7.1 **explicitly exempts** manual pan/wheel/pinch/keyboard, the Leaflet zoom control, the pre-existing **PLACE click-moves-Lens** behaviour (`js/app.js:5003–5009`), the `zoomend` handlers, K11 restore and the HATI framing action. §7.2 limits the two new programmatic moves to P0-b2 and states P0-a/P0-b1 introduce none. §7.4 adds the isolation requirements. **AC-P0-6** now also regression-tests existing map behaviour. §6.1 gives the click-conflict as a second reason for `interactive: false`. |
| **6** | Membership is not zero runtime cost; promoting it changes execution frequency. Add a latency/freshness criterion and a tested throttle/cache if needed. | §5.3 **withdraws** the earlier "no new computation" claim. New **§5.5** tables the exact triggers — `drag` (continuous, not `dragend`), `oninput` (continuous), map click, lens activation, language change, load — and reports a **measured CPU-only cost**: 8.25 ms median / 13.76 ms p95 at r = 900 and 15.63/26.18 ms at r = 5000, against `ambitoContaining`'s 0.04 ms, with the 16.7/33.3 ms frame budget as context. A five-step strategy follows (measure first, identity guard, coalesce only if justified, freshness non-negotiable, no new geometry code), anchored to the existing K9 drag-deferral precedent. **AC-P0-12** adds the latency and non-stale criteria; **R5** is a new High risk; new principle 6. |

Also changed in response: the GO/HOLD verdict is restructured into **three separate decisions**
(§17), and §3 now points here for the review-finding trail.

---

## 17. Gate verdict — three separate decisions

### Decision 1 — **GO** · P0-a, membership disclosure

Build the membership answer into the default PLACE view: the count line and ámbito chips beneath
the unchanged containment line, from the canonical `ambitosIntersecting`.

This addresses C2 and C3, which are the mechanical causes of the user-facing failure. It adds no
surface, no camera state, no geometry and no indicator, and it exposes an answer the product
already produces. It must ship with **measured responsiveness and freshness** (AC-P0-12) and with
the scientific-contract tests (AC-P0-5, AC-P0-11), because §5.5 shows the promotion has a real
per-interaction cost that the current deferral hides. §5.4's chip-opens-existing-evidence question
is decided inside this increment, and either outcome is a recorded result.

### Decision 2 — **CONDITIONAL GO / HOLD** · P0-b, lattice, overview and finder

**P0-b1 (lattice / overview): CONDITIONAL GO.** The design is specified and satisfies #93's
overview branch. It ships **only** on the four release conditions in §6.4 — a direct
baseline-versus-prototype measurement, an owner-declared supported-device class, a pass on every
supported class, and a responsive fallback. **If a supported class cannot be made responsive, this
subfeature is HELD or redesigned.** The owner decision on the weak integrated-GPU laptop floor
(K12 §12.4 blocker #2) is open and is **not** closed here.

**P0-b2 (finder / locate): HOLD.** Not justified by present evidence. #93 requires an overview
**or** a locate action, and P0-b1 satisfies the overview branch. P0-b2 becomes justified only if
P0-a fails O3 (AC-P0-2a records a negative) or the §15 study shows users cannot reach a named
ámbito's evidence. If it is ever built, §6.3's distance requirement and §7's camera contract are
binding, and it must not ship without P0-a.

### Decision 3 — **GO** · P1 design direction

The responsive rail with collapsible groups and `n of m on` layer-visibility badges, the compact
Lens circle summary under its six rules, the 44 px coarse-pointer fix, and the keyboard-navigation
improvements (two skip links) are a sound design direction and may proceed to implementation.

**Implementation remains subject to a separate review.** The height budgets in §8 are arithmetic
and may be falsified by AC-P1-1 and AC-P1-3; the accessibility improvements are reasoned
expectations, not test results (§12); and no claim of WCAG conformance is made.

### What none of these decisions authorizes

- Any claim that an implementation will be discoverable, usable or accessible. R1, R3 and R4 are
  open and **High**.
- Closing the K12 owner decision on the supported device floor.
- P2 work (audit registers #5–#10), which stays queued and untouched.
- Creating implementation issues, merging this PR, or deploying.

### Proposed order — do not create these yet

| Order | Work | Gate | Depends on |
|---|---|---|---|
| **1** | **P0-a** · membership disclosure, with latency/freshness measurement and the §5.4 decision | GO | nothing |
| **1′** | **P1** · small-screen rail, reading order, touch floor, skip links | GO | nothing — **parallel with P0-a** |
| **2** | **P0-b1** · lattice / overview | CONDITIONAL — §6.4 release conditions | P0-a |
| **3** | **Validation** · §15 human study and real-hardware pass | — | P0-a, P1 |
| **4** | **P0-b2** · finder / locate | HOLD — only on a demonstrated O3 or study failure | P0-a, and the validation result |
| later | P2 · audit registers #5–#10 | unchanged | — |

P0-a and P1 touch different surfaces (the planning section versus the rail, panel head and
stylesheet) and can run concurrently.

---

### Compliance with the #93 quality and scope gates

- [x] All changes are **documentation and design assets only**, in **one** Draft PR.
- [x] **No production CSS, JS, HTML, test, data or HATI file is edited.**
- [x] **No claim that a human completed a task or that a real iPad was tested.** §1, §12, §15 and
      every wireframe footer state the opposite explicitly.
- [x] **No assertion that this design passes accessibility standards or P0 discoverability.**
- [x] **An explicit human and real-hardware validation plan** is in §15.
- [x] GO / CONDITIONAL GO / HOLD decisions, residual risks and the proposed order are above. No
      implementation issue is created by this gate.

---

*No production code, data, model, scope, date, withholding rule, abstention, derivation,
interpretation ceiling or HATI layer was changed by this design gate. Every wireframe is a static
sketch. No interactive behaviour described here exists. Real-hardware, assistive-technology and
human usability validation were NOT conducted.*
