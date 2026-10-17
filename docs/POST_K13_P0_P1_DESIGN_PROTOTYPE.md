# Post-K13 P0/P1 design prototype — Madrid Urban Evidence Lens

Status: **design gate only** (issue #93, UX-D1). This pass produced a decision-ready design
specification for the two items the merged post-K13 audit (#91 / PR #92) raised to P0 and P1.
It changed **no production CSS, JS, HTML, test, dataset, model, scope, date, withholding rule,
abstention, derivation or interpretation ceiling**, and it does **not** touch HATI. Its artifacts
are this document and seven static annotated wireframes under `docs/design/post-k13-p0-p1/`.

- **Baseline:** `main` @ `a4e28d1` (merge of PR #92).
- **Predecessor gate:** `docs/POST_K13_PRODUCT_UX_VALIDATION.md` (17 Oct 2026) — verdict
  *GO to a bounded design prototype*.
- **Designed:** 17 October 2026.
- **Research question (from #93):** how can an unfamiliar resident find an official planning
  ámbito from Madrid's default map view, and how can a tablet/phone user reach the most
  important Lens evidence and the K9 controls without traversing a long, competing overlay?

> **Nothing in this document has been built, rendered, measured on a device or tried by a
> person.** Where a number appears it is either (a) arithmetic over a committed artifact or the
> shipped stylesheet, (b) a measurement carried forward from a named earlier gate, or (c) a
> labelled placeholder. Each is marked. No claim of discoverability, usability, comprehension or
> accessibility conformance is made or implied.

---

## Contents

1. [What this gate did, and the limits of its evidence](#1-what-this-gate-did-and-the-limits-of-its-evidence)
2. [Correction: the P0 premise in #92 is wrong, and the correction makes P0 cheaper](#2-correction-the-p0-premise-in-92-is-wrong-and-the-correction-makes-p0-cheaper)
3. [Evidence-to-design traceability](#3-evidence-to-design-traceability)
4. [P0 — two concepts, trade-off and selection](#4-p0--two-concepts-trade-off-and-selection)
5. [P0 — the selected design](#5-p0--the-selected-design)
6. [P0 — map action contract, rendering and performance](#6-p0--map-action-contract-rendering-and-performance)
7. [P1 — small-screen information architecture](#7-p1--small-screen-information-architecture)
8. [State inventory](#8-state-inventory)
9. [Microcopy — literal EN/ES strings](#9-microcopy--literal-enes-strings)
10. [Interaction states](#10-interaction-states)
11. [Accessibility considerations, and the limits of that word here](#11-accessibility-considerations-and-the-limits-of-that-word-here)
12. [Reusable small-screen interaction principles](#12-reusable-small-screen-interaction-principles)
13. [Acceptance criteria](#13-acceptance-criteria)
14. [Residual risks and the validation that has not happened](#14-residual-risks-and-the-validation-that-has-not-happened)
15. [Gate verdict — GO / HOLD](#15-gate-verdict--go--hold)

---

## 1. What this gate did, and the limits of its evidence

### Method

| Activity | Done? | What it can support |
|---|---|---|
| Read the merged #92 audit and issue #93 in full | ✅ | The problem statement, the register, the stated ACs |
| Source reading of `index.html`, `css/app.css`, `js/app.js`, `js/planning-ambito.js`, `js/scope-rail.js`, `js/shell-copy.js` | ✅ | Exact selectors, breakpoints, enum values, render conditions, shipped copy |
| Arithmetic over the committed planning artifacts, and execution of the **shipped pure model** (`createPlanningIndex` → `ambitoContaining` / `ambitosIntersecting`) in Node | ✅ | What the product's own model returns at the default state (§2) |
| Web-Mercator viewport arithmetic at zoom 14 for the three device widths | ✅ | Whether ámbito geometry falls inside the default viewport (§2) |
| Reuse of the device-grade K12 runtime measurements (`docs/RUNTIME_DECISION_SPIKE.md` §12) | ✅ | A measured precedent for rendering the full ámbito layer (§6.4) |
| Layout arithmetic against the shipped stylesheet | ✅ | Height budgets, which are *predictions* to be verified in implementation |
| Rendering anything proposed here | ❌ | — |
| Device testing of anything proposed here | ❌ | — |
| Assistive-technology or WCAG assessment of anything proposed here | ❌ | — |
| Any human participant | ❌ | — |

### What is NOT established by this document

- **No real iPad, iPhone, Safari or WebKit hardware was used.** Not in #92 (which was Chromium
  device *emulation*) and not here.
- **No assistive technology was used, and no WCAG 2.1/2.2 conformance is claimed** at any level,
  for the current build or for anything proposed. §11 states precisely what is and is not claimed.
- **No human being has attempted any task described here.** Every statement about what a user
  would find, understand or do is expert judgement. Where this document says a design "lets a
  user" do something, read it as *"is intended to; to be demonstrated in implementation"*.
- **The height, spacing and fit figures in §7 are arithmetic over the shipped CSS, not rendered
  measurements.** They are falsifiable predictions, deliberately written so the implementation PR
  can check them.

### Scope boundary honoured

No new dataset, indicator, statistical computation, score, ranking, inferred physical urban
change or dwelling count. No MapLibre/framework/3D migration. No runtime LLM, API or dependency.
No change to PLACE/COMPARE/CITY. **HATI is frozen, optional, independent ON/OFF and untouched.**
No production file is edited by this PR.

---

## 2. Correction: the P0 premise in #92 is wrong, and the correction makes P0 cheaper

This is the most consequential finding of the design gate, so it comes first.

### 2.1 What #92 and #93 assert

The merged audit states that at the default centre the nearest ámbito polygons **lie outside the
visible viewport** — *"they sit on the periphery … especially on mobile"* — and concludes that an
overlay alone cannot satisfy discovery, so **AC2 is satisfied only when a user-initiated camera
move brings an ámbito into view on each device class.** Issue #93 repeats this: *"at default
Madrid-centre zoom 14, nearby planning geometries may be off screen, especially on a phone."*

The audit also quotes the live default planning status as *"The Lens circle touches no official
planning ámbito."*

### 2.2 What the artifacts and the shipped model actually say

Running the product's own pure model over the committed artifacts, at the default Lens A centre
(`defaults.A` = 40.4149, −3.690, radius 900 m, `js/app.js:263`):

| Question | Shipped function | Result |
|---|---|---|
| Does an ámbito **contain** the Lens centre? | `index.ambitoContaining(lon, lat)` | `outside_all_ambitos` — **no**. The audit is right about this. |
| Which ámbitos does the 900 m circle **intersect**? | `index.ambitosIntersecting(lon, lat, 900)` | **9**: `APE.01.05/M`, `APE.01.08`, `APE.01.11`, `APE.03.06`, `APE.04.16`, `APR.01.05`, `APR.01.08`, `APR.01.10`, `APR.04.05` |
| How far is the nearest ámbito? | nearest-vertex over `madrid_ambitos.geojson` | **51 m** — `APE.03.06 · JERÓNIMOS` |

Sensitivity around the default position (the app also resets Lens A to −3.687 at `js/app.js:5036`,
and the map centre is 40.415, −3.692):

| Centre | r = 100 m | r = 400 m | r = 900 m | r = 2000 m |
|---|---|---|---|---|
| `defaults.A` 40.4149, −3.690 | 1 | 1 | **9** | 58 |
| reset position 40.4149, −3.687 | 0 | 1 | **7** | 64 |
| map centre 40.415, −3.692 | 1 | 3 | **10** | 63 |

And Web-Mercator viewport arithmetic at zoom 14, centred on the default map centre — how many of
the 724 ámbitos have geometry inside the visible rectangle:

| Device class | Visible span | Ámbitos with vertices in the viewport |
|---|---|---|
| Desktop, map area ≈ 1000 × 900 | 7.27 × 6.54 km | **229** |
| Desktop, full 1440 × 900 | 10.46 × 6.54 km | **269** |
| Tablet 834 × 1112 | 6.06 × 8.08 km | **235** |
| Phone 375 × 812 | 2.72 × 5.90 km | **91** |

### 2.3 Consequences

1. **The ámbitos are not remote. They are already on screen, on every device class, including
   the phone.** The historic centre is densely covered by `APE.*` / `APR.*` ámbitos. The
   "periphery" framing is incorrect.
2. **The quoted copy is the wrong string.** *"The Lens circle touches no official planning
   ámbito"* is `planning.touchedNone` (`js/shell-copy.js:170`), which is **not** what renders at
   the default state — and which would be **factually false** there, since the circle touches
   7–10. The string that actually renders is `planning.outside` (line 137), which is precise and
   correct: *"No official planning ámbito **contains** the Lens centre … an explicit absence of a
   **containing** ámbito — not a zero and not the nearest ámbito."* The audit conflated two
   strings that answer two different questions. **The shipped copy is not the defect.**
3. **The real failure is disclosure and rendering, in three mechanical parts** (wireframe
   [01](design/post-k13-p0-p1/01-p0-current-desktop-default.svg)):

   | # | Cause | Evidence |
   |---|---|---|
   | **C1** | `renderPlanningPolygon(containing)` paints **only the containing feature**. At the default centre there is none, so the map draws **zero** ámbito geometry while 91–229 sit in frame. Its own comment says 724 polygons "would be wallpaper, not orientation". | `js/app.js:3790–3837` |
   | **C2** | `renderPlanningTouched()` sets `card.hidden = !open`, where `open` is `#placeDetail.open` — and `<details id="placeDetail">` ships **without** `open`. The 7–10 touched ámbitos are not merely hidden: at cold start they are **never computed**. | `js/app.js:3742–3756`, `index.html:379`, `index.html:399` |
   | **C3** | `planning.outside` correctly answers *containment*, but nothing follows it with the *membership* answer the model already has. A reader who asks "are there planning areas near me?" receives an accurate answer to a narrower question and reasonably concludes "there are none here". | `js/shell-copy.js:137` |

4. **AC2 as written in #92 is unsatisfiable as stated and should be restated.** It requires a
   user-initiated camera move to "bring at least one ámbito into view on each device class", but
   ámbitos are already in view on each device class. §13 restates it around what actually needs
   demonstrating.
5. **P0 gets cheaper and more certain.** Fixing C2 and C3 is disclosure work over data and
   functions that already exist and already run. It needs no camera movement, no new artifact and
   no new computation. The lattice (C1) and the locate action remain valuable — the lattice for
   orientation, the locate action for the genuinely-uncovered case and for a keyboard-first route
   — but neither is load-bearing for the default-view comprehension fix.

> **This correction supersedes the geographic premise in #92 §4 (J1), §5, §6 register #1 and §9
> P0/AC2.** It does not disturb any other finding in that audit, and it does not disturb any
> scientific contract: the containment copy, the membership scope and the apportionment refusal
> all stay exactly as they are.

---

## 3. Evidence-to-design traceability

Each row names the audit item, what this gate concluded, and where the design answer lives.

| #92 item | Audit's statement | This gate's position | Design response |
|---|---|---|---|
| Register **#1** (P0) · no PLACE affordance to discover where ámbitos exist | Correct **as a user-facing outcome**; its stated geographic cause is wrong (§2) | Confirmed as a defect; re-attributed to C1/C2/C3 | §4–§6, wireframes 01–03 |
| §9 P0 **AC1** · a new lattice renderer over already-fetched geometry, not `renderPlanningPolygon`, not a pane toggle | Correct and adopted verbatim | Adopted | §6.2, AC-P0-4 |
| §9 P0 **AC2** · user-initiated overview/locate required because nearest polygons fall outside the default viewport | **Premise refuted** (§2.2) | Restated: the locate action is retained because #93 requires it and because it serves the uncovered case and the keyboard route — not because the ámbitos are off screen | §4.4, AC-P0-2, AC-P0-3 |
| §9 P0 **AC3** · user-triggered only; no *automatic* camera fly; absence copy unchanged | Correct and adopted verbatim | Adopted, and tightened into an explicit two-gesture contract | §6.1, AC-P0-6 |
| §9 P0 **AC4** · labelled as planning ámbitos, never built-development footprints; m² only, no dwelling counts | Correct and adopted verbatim | Adopted, and extended into a visual rule as well as a copy rule | §5.4, §9, AC-P0-7 |
| §9 P0 **AC5** · study probe (a) ≥5/6 | Correct; **cannot be met by this gate** | Routed to §14; not claimed | §14 |
| Register **#2** (P1) · K9 toggle ~693 px down a 360 px rail | Carried forward unchanged | Resolved via #3 | §7.2, AC-P1-1 |
| Register **#3** (P1) · 1,912 px stack in a 360 px overlay | Carried forward unchanged | Collapsible groups, one open at a time | §7.2, wireframe 04 |
| Register **#4** (P1) · Lens figures 4th in reading order | Carried forward unchanged | Compact circle summary above the administrative lead at ≤850 px | §7.3, wireframe 05 |
| Register **#10** (P1) · quick-jump chips 30 px vs the project's 44 px target | Carried forward, **with its root cause newly identified** | `.place-jump-chip{min-height:30px}` (line 850) beats the zero-specificity `:where(…)` floor (line 978). The fix is that one declaration | §7.4, AC-P1-4 |
| §1 · 196 focusable Leaflet markers; tab order traverses them first | Carried forward, **with its source newly identified** | Cluster markers are created with `keyboard: true` (`js/app.js:2091`); no skip link exists. Two skip links proposed; marker behaviour left alone | §11, wireframe 06 |
| §5 · badge must be a **layer** count, never a record count | Correct and adopted | Adopted and sharpened to `n of m on`, which also answers "find layer visibility state" from #93 | §7.2, §9 |
| §8 · proposed minimal IA | Adopted, with the group composition verified against the markup (10 toggles, 6 groups) | Adopted | §7.2 |
| Registers **#5–#9** (P2) | Out of scope for this gate | Untouched; remain P2 | §15 |
| §1 · deployment identity asserted at asset-version level, not cryptographically | Noted; unchanged by this gate | No design dependency | — |

---

## 4. P0 — two concepts, trade-off and selection

### 4.1 What P0 must actually achieve

Decomposed from #93 into four separable outcomes, so a concept can be judged against each:

- **O1 · Know that official planning ámbitos exist near here**, from the default cold-start PLACE
  view, without dragging the map blindly.
- **O2 · Know which ones this Lens circle touches**, distinctly from which one *contains* its centre.
- **O3 · Reach a particular ámbito deliberately** and read its published evidence.
- **O4 · Do all of the above without concluding that the polygons are construction sites or
  built-development footprints.**

### 4.2 Concept A — "Touched first, lattice on demand"

Wireframe [02](design/post-k13-p0-p1/02-p0-concept-a-desktop.svg). Disclosure-led.

- The membership answer that the model already computes is **promoted out of the closed `Detail`
  disclosure** and rendered directly beneath the containment line in the planning section: a count
  line, up to three ámbito chips, and a "See all n" link into the full list.
- The existing `#boundarySelect` gains a **fourth option, "All planning ámbitos"**, drawn by a new
  stroke-only lattice renderer over `planningIndex.entries` — geometry already fetched at load.
- Focusing or hovering a chip highlights that ámbito on the map. **The camera never moves.**

**Satisfies:** O1, O2, O4. **Does not satisfy:** O3 fully, and nothing in it is a "user-initiated
map overview or locate action", which #93 requires explicitly.

### 4.3 Concept B — "Ámbito finder"

Wireframe [03](design/post-k13-p0-p1/03-p0-concept-b-phone.svg). Action-led.

- A single explicit control in the planning section: **"Find planning ámbitos"**.
- It opens a bounded native `<dialog>` with two **separately named** groups — *Touched by the Lens
  circle* and *Nearest, not touched* — each row carrying code, denomination and a distance, plus a
  switch that turns the lattice on.
- Opening a row **moves the camera** to fit that ámbito. The **Lens does not move**; every reading
  is preserved; a persistent "← Back to the Lens" restores the previous camera.

**Satisfies:** O1, O2, O3, O4, plus the explicit #93 locate requirement and a keyboard route that
never touches a map marker. **Costs:** a new modal surface and its EN/ES copy, a new pure
`nearestAmbitos()` over the bounding boxes the index already precomputes, camera save/restore
state, and a "you are looking at" panel state that must not read as a fourth product mode.

### 4.4 Trade-off

| Criterion | Concept A | Concept B |
|---|---|---|
| O1 · ámbitos exist near here | ✅ at default view, no action needed | ⚠️ requires opening the finder first |
| O2 · which ones the circle touches | ✅ in the default panel | ✅ inside the finder |
| O3 · reach one deliberately | ⚠️ highlight only; no route when none is in view | ✅ |
| O4 · not construction | ✅ visual + copy rules | ✅ same rules, plus an explicit sheet header |
| Satisfies #93's "user-initiated overview or locate action" | ❌ | ✅ |
| Works when the user has panned somewhere genuinely uncovered | ❌ lattice is simply empty | ✅ "Nearest, not touched" still answers |
| Keyboard route that avoids the 196 marker tab stops | ⚠️ partial | ✅ complete |
| New surfaces introduced | 0 (one select option, one panel block) | 1 modal + 1 panel state |
| New pure functions | 0 | 1 (`nearestAmbitos`) |
| Camera contract risk | none — camera never moves | real — must be bounded to exactly two gestures |
| Fails safe if the artifact is unavailable | ✅ existing unavailable copy | ✅ control disabled with the same copy |
| Cost | low | moderate |

### 4.5 Selection

**Ship both, A first, as two sequenced increments of one P0 track.** They are not competing
designs; they fix different halves of the problem, and the trade-off above shows neither covers
all four outcomes alone.

- **A is the mandatory half.** It is what makes the default cold-start view stop looking empty, and
  it does so by disclosing an answer the product already computes. **If only one thing ships, it
  is A** — it is cheap, it carries the least risk, and it addresses C2 and C3, which are the actual
  causes of the user-facing failure.
- **B is required by the gate** (#93 asks in terms for a user-initiated overview or locate action),
  and it is what delivers O3, the uncovered case, and the keyboard-first route.
- **B must not ship without A**, because without A the default view still looks empty and the user
  has no reason to press "Find planning ámbitos" in the first place.

**Rejected alternatives**, recorded so they are not re-proposed:

| Rejected | Why |
|---|---|
| Lattice **on by default** | Device-measured performance (§6.4) fails on the weak-laptop class, and a permanent 724-polygon wash is the "wallpaper, not orientation" problem `js/app.js:3789` already names. |
| **Automatic** camera fit when the planning status is empty | Violates the no-automatic-camera contract in #92 AC3 and the IA contract test that no mode control performs a camera action. |
| Moving the **Lens** to the nearest ámbito | Destroys every circle reading the user is looking at and silently changes the URL state. |
| A **fourth mode** ("Plan") | #92 §5 explicitly found that adding a mode is not assumed to help; three modes are a settled contract. |
| Reusing **COMPARE**'s code entry for discovery | #92 §4 separates them correctly: code entry presumes the user already knows a code. It is selection, not discovery. |
| A **text search** over 724 denominations | A resident does not know ámbito names. It helps a planner who already knows one, which is the COMPARE case, already served. |

---

## 5. P0 — the selected design

### 5.1 Where it appears in PLACE

The planning section (`#planningAmbito`, `index.html:212`) keeps its position — third, after the
administrative area — and gains a defined internal order:

1. **Containment** — `planning.outside` or the resolved identity. **Verbatim unchanged.**
2. **Membership** *(new)* — the count line, up to three chips, "See all n".
3. **Locate** *(new)* — the "Find planning ámbitos" button.
4. The existing scope ceiling and "What this means" disclosure.

Containment and membership stay visually and verbally separate because they are different
questions at different analytical scopes (`PLANNING_AMBITO` vs `LENS_INTERSECT_AMBITO`), and the
product's own scope machinery already keeps them apart. The design must not merge them into one
sentence.

### 5.2 The membership block

- Renders from `index.ambitosIntersecting(centre.lon, centre.lat, radius)` — the same call
  `renderPlanningTouched()` already makes, moved out from behind `#placeDetail.open`.
- It re-renders on Lens move and radius change, exactly as the model already recomputes. The
  existing signature check that avoids touching the DOM when the set is unchanged applies here too.
- At most three chips inline; the rest behind "See all n", which opens the finder (B) once B ships,
  and expands the existing `Detail` card until then.
- **Zero case:** `planning.touchedNone` is already correct and is reused unchanged.
- **It carries no quantity.** The apportionment refusal the model already returns
  (`"No figure is apportioned … into a Lens circle"`) is the governing rule; the chips carry code
  and denomination only.

### 5.3 The finder

- A native `<dialog>`, consistent with Evidence & limits — Escape closes, focus is contained by the
  browser, focus returns to the trigger.
- **Two named groups**, never merged: *Touched by the Lens circle* (from `ambitosIntersecting`) and
  *Nearest, not touched* (from a new pure `nearestAmbitos()`).
- **Distance is a locating aid, explicitly labelled as such.** It is straight-line metres from the
  Lens centre to the ámbito boundary, derived geometry that carries **no analytical scope**, is
  never combined with a published figure, and is never presented as evidence. It is not a new
  indicator. If this cannot be held cleanly in review, drop the distance and order the list by
  official code instead — the design does not depend on it.
- Opening a row triggers the locate action (§6.1) and sets the panel's "you are looking at" state,
  which shows that ámbito's published evidence **at whole-ámbito scope**, with the same verbatim
  ceilings the resolved state already uses.

### 5.4 Keeping planning boundaries distinct from construction

Four rules, all of which the implementation must hold:

1. **Colour family.** The lattice and all ámbito geometry use `--planning-neutral` (`#aeb8c4`),
   already reserved in `css/app.css:20` for exactly this and deliberately separate from the Lens
   A/B hues. The K9 granted-licence layer keeps `--licence-neutral` (`#c0794f`). A reader must
   never have to work out which neutral means what.
2. **Stroke, not fill.** At lattice scale the ámbitos are **outlines only**. Fill appears solely on
   the containing ámbito (the existing 7 %) and lightly on the touched set. A field of filled
   polygons reads as built area; a field of outlines reads as a boundary scheme.
3. **A persistent legend while the lattice is on**, carrying the distinction on the map itself —
   not only in the panel, which may be scrolled away on a phone.
4. **Vocabulary ban.** No label, legend, tooltip, aria-label or option text may use *development*
   (as a noun for the polygons), *projects*, *works*, *sites*, *construction*, *obras*,
   *construcción* or *promociones*. The permitted nouns are *planning ámbito* / *ámbito de
   planeamiento* and *boundary* / *límite*. Gate L's ceilings stand: m² edificable only, no
   dwelling counts, `{edition}:{code}`, no scalar stage.

---

## 6. P0 — map action contract, rendering and performance

### 6.1 The camera contract

**The camera moves on exactly two user gestures, and on nothing else:**

| Gesture | Effect |
|---|---|
| Opening an ámbito row in the finder | Fit the map to that ámbito's bounds, with padding. Save the previous centre/zoom. |
| "← Back to the Lens" | Restore the saved centre/zoom. |

Everything else is explicitly forbidden, restating and extending #92 AC3:

- ✗ Selecting a mode (PLACE/COMPARE/CITY) never moves the camera.
- ✗ Selecting, moving or resizing a Lens never moves the camera.
- ✗ An empty or absent planning status never moves the camera.
- ✗ Turning the lattice on or off never moves the camera.
- ✗ Loading, restoring a shared URL or switching language never moves the camera.

**The Lens never moves, in any of these.** Locating changes the viewport only, so every circle
reading survives and no URL-state key changes. "← Back to the Lens" stays visible for as long as
the camera is away from its saved position, so the way back is never more than one target away.

### 6.2 The lattice renderer

Per #92 AC1, adopted verbatim: a **new** renderer, **not** a reuse of `renderPlanningPolygon`
(which draws one feature) and **not** a `planningPane` toggle (which would toggle a pane holding
one feature). It draws from `planningModel.index.entries`, which already carries each feature and
a **precomputed bounding box** — so viewport culling needs no new indexing.

- Its own Leaflet canvas renderer on `planningPane` (z-index 360), consistent with the existing
  `L.canvas({ pane: "planningPane" })` pattern.
- `interactive: false` at lattice scale, so it adds **no tab stops** and does not worsen the
  196-marker problem of §11.
- The active/containing ámbito keeps its existing renderer and stays visually distinct from the
  lattice, per #93.
- **No new fetch.** Both planning artifacts are already fetched once at load
  (`loadPlanningContext`, `js/app.js:3072`), and the module comment there states that moving a Lens
  performs an in-memory scan and never a fetch. The lattice must preserve that property.

### 6.3 The data it draws

| Quantity | Value | Source |
|---|---|---|
| Ámbito features | **724** | `data/planning/madrid_ambitos.geojson` |
| Geometry type | all `MultiPolygon` | same |
| Rings | 808 | same |
| Coordinate vertices | **140,507** | same |
| Universe extent | ≈ 26.8 × 26.0 km | same |
| Raw / gzip size | 3.33 MB / 916 KB | `docs/RUNTIME_DECISION_SPIKE.md` §2.2 |

### 6.4 Performance — a measured precedent, not a guess

The K12 runtime spike **already measured this exact render**. Its baseline harness loads
`data/planning/madrid_ambitos.geojson` and adds **the entire FeatureCollection** as one Leaflet
canvas layer (`research/runtime_spike/device_harness/leaflet_baseline.html:69–71`) — which is what
the P0 lattice does. Against the product's own thresholds (pan frame p95 ≤ 16.7 ms target,
≤ 33.3 ms maximum):

| Device | Real-payload Leaflet pan p95, ámbito layer included | Verdict |
|---|---|---|
| **iPad M3 / Safari** (`DEVICE_VALIDATION`, 38/38) | **≤ 30 ms** across all 12 real-payload pairs | **inside** the 33.3 ms maximum |
| **Windows / Intel UHD 620** (partial run, 37/38) | **143–311 ms** | **fails**, by 4–9× |

The synthetic series agrees: at 765 polygons, iPad Leaflet pan p95 is 24 ms and Windows Intel UHD
620 is 469 ms. The MapLibre trigger (≥ ~2,000 simultaneous polygons) is **not** crossed by 724.

**What this means for the design.** The full-lattice render is device-measured feasible on a modern
tablet and device-measured *infeasible* on the weak integrated-GPU laptop class. The design
therefore:

- keeps the lattice **opt-in and OFF by default**;
- **zoom-gates** it, so the number of polygons actually rendered is bounded — at zoom 13 on a phone
  viewport, 306 ámbitos intersect the view, versus 557 at zoom 12 and 721 at zoom 11;
- states the gate to the user honestly rather than failing silently (state 6, §8);
- keeps the touched/containing outlines drawn **below** the gate, so the ámbitos that matter at
  this location are never hidden by a performance guard.

Three honest caveats: the 469 ms synthetic figure used *generated* geometry of comparable count,
not the real ámbito vertices; the real-payload runs did not isolate lattice-only cost from the
licence and admin layers; and the exact zoom gate **must be set against a device in the
implementation PR, not guessed here**. §14 carries this as a residual risk, and the weak-laptop
support floor is already open decision blocker #2 in the K12 spike — this design does not close it.

---

## 7. P1 — small-screen information architecture

### 7.1 The geometry being designed against

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

### 7.2 Collapsible rail groups

Wireframe [04](design/post-k13-p0-p1/04-p1-rail-tablet.svg).

**Six groups, collapsed by default at ≤850 px, one open at a time.** Composition verified against
`index.html` — **10 layer toggles, the same ten that ship today**; nothing is added, removed,
renamed or reordered:

| # | Group | Contents | Layers |
|---|---|---|---|
| 1 | Map display | base map select, administrative boundaries select *(gains the P0 "All planning ámbitos" option)* | — (2 settings) |
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
#93's "find layer visibility state" without expanding anything — which a bare layer count would
not.

**Height budget**, worst case, assuming the two longest labels wrap at 150 px:
`4 × 44 px + 2 × 48 px = 272 px`, `+ 5 gaps × 6 px = 302 px`, `+ group label 26 px = 328 px`.
Against a 430 px rail at 834 px → **102 px spare**; against a 360 px rail at 375 px → **32 px
spare**. The **K9 header is the third row, ≈192 px down**. *This is arithmetic over the shipped
stylesheet, not a rendered measurement — it is written to be checked, and AC-P1-1 checks it.*

**Desktop > 850 px is unchanged**: groups render expanded, so no desktop user loses a visible
control and the #86 desktop improvement is preserved rather than re-litigated.

### 7.3 Compact circle summary

Wireframe [05](design/post-k13-p0-p1/05-p1-phone-reading-order.svg). At ≤850 px only, a band
directly below the panel head and **above** the administrative lead, carrying the four existing
Lens figures and the radius.

Six rules:

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
cannot disagree with the block below, because there is one source of truth behind both.

**Everything after step 1 keeps its order.** The administrative area, planning ámbito and licence
sections are not reordered relative to each other, and controls stay last.

**Height cost at 375 × 812:** the sheet is ≈341 px (42dvh); the head grows 14 px (chips 30 → 44 px)
and the band adds 64 px + 8 px margin ≈ **86 px**, spent buying the answer the user arrived with.
Displaced material moves down the same internal scroll it already lived on; nothing leaves the
document. *Open question for implementation: whether the panel should be allowed ~48dvh at
≤560 px. That trades map area for panel area and should be decided against a real device.*

### 7.4 The 44 px quick-jump chip

Root cause, newly identified: `css/app.css:978` already declares a universal coarse-pointer floor,
but through `:where(button, select, summary, …)`, which has **zero specificity**. The class rule
`.place-jump-chip{min-height:30px}` at line 850 therefore wins.

**The fix is that one declaration**, not a new rule. `tests/responsive.test.mjs` already asserts
the `:where()` floor exists; the implementation PR should add an assertion that no class rule
undercuts it for a coarse-pointer control.

---

## 8. State inventory

Wireframe [07](design/post-k13-p0-p1/07-state-inventory.svg) carries the full matrix. Summary:

| # | State | Model value | Map | Panel |
|---|---|---|---|---|
| 1 | **Loading** | `AMBITO_STATE.LOADING` | nothing — **never a placeholder boundary** | loading copy; lattice option and finder disabled |
| 2 | **Unavailable** | `AMBITO_STATE.UNAVAILABLE` (index is `null`) | nothing; the lattice option is **disabled, not removed** | unavailable copy — a statement about the *deployment*, saying nothing about whether ámbitos exist here |
| 3 | **No containing ámbito** *(the default)* | `OUTSIDE_ALL_AMBITOS` | today nothing; **proposed:** touched outlines, plus the lattice if on | containment copy verbatim, **then** the membership count |
| 4 | **Resolved** | `AMBITO_STATE.RESOLVED` | containing polygon, dashed neutral + 7 % fill + code label — unchanged | identity, four independent phases, use, surface, buildability, edition date, ceiling — unchanged |
| 5 | **Lattice on** *(new)* | a view option, not a model state | outlines of every ámbito in view, stroke-only, neutral, + legend | panel copy unchanged; the legend carries the planning-≠-construction distinction |
| 6 | **Lattice on, below the zoom gate** *(new)* | a rendering guard, not an evidence state | lattice withheld; touched/containing outlines still drawn | an explicit "zoom in" message — **never** phrased as absence, unavailability or zero |
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

## 9. Microcopy — literal EN/ES strings

Proposed additions. Spanish is drafted to match the product's existing institutional register —
impersonal, *"la Lente"*, *"el círculo de Lente"*, not *"tu círculo"*. `n` is a count placeholder.

Both dictionaries must receive every key: `tests/information_architecture.test.mjs` already asserts
that `SHELL_DICTIONARIES.en` and `.es` have identical key sets with no empty value, and that every
`data-i18n` key in the markup exists in both.

### P0 — planning discovery

| Key | EN | ES |
|---|---|---|
| `planning.touchedCount` | The Lens circle touches **n** official planning ámbitos. | El círculo de Lente toca **n** ámbitos oficiales de planeamiento. |
| `planning.touchedCountOne` | The Lens circle touches **1** official planning ámbito. | El círculo de Lente toca **1** ámbito oficial de planeamiento. |
| `planning.touchedNone` *(exists, reused unchanged)* | The Lens circle touches no official planning ámbito. | El círculo de Lente no toca ningún ámbito oficial de planeamiento. |
| `planning.touchedSeeAll` | See all n → | Ver los n → |
| `planning.find` | Find planning ámbitos | Buscar ámbitos de planeamiento |
| `planning.findAria` | Find official planning ámbitos near this Lens | Buscar ámbitos oficiales de planeamiento cerca de esta Lente |
| `planning.finder.title` | Find planning ámbitos | Buscar ámbitos de planeamiento |
| `planning.finder.intro` | Official PGOUM planning boundaries. Not construction, not built footprints, and no dwelling count is published or derivable. | Límites oficiales de planeamiento del PGOUM. No es construcción, no son huellas de lo edificado, y no se publica ni se deriva ningún número de viviendas. |
| `planning.finder.touchedGroup` | Touched by the Lens circle | Tocados por el círculo de Lente |
| `planning.finder.nearestGroup` | Nearest, not touched | Más cercanos, no tocados |
| `planning.finder.distanceNote` | Straight-line distance from the Lens centre to the ámbito boundary. A locating aid, not published evidence. | Distancia en línea recta desde el centro de la Lente hasta el límite del ámbito. Es una ayuda para localizar, no evidencia publicada. |
| `planning.finder.openNote` | Opening one moves the map to show that ámbito. The Lens stays where it is and every reading is preserved. | Al abrir uno, el mapa se desplaza para mostrar ese ámbito. La Lente no se mueve y se conservan todas las lecturas. |
| `planning.finder.empty` | No official planning ámbito lies near this Lens. The ámbito universe does not cover the whole municipality. | Ningún ámbito oficial de planeamiento se encuentra cerca de esta Lente. El universo de ámbitos no cubre todo el municipio. |
| `planning.backToLens` | ← Back to the Lens | ← Volver a la Lente |
| `planning.backToLensAria` | Return the map to the Lens, where it was before | Devolver el mapa a la Lente, donde estaba antes |
| `planning.lookingAt` | Looking at | Estás viendo |
| `planning.lookingAtScope` | whole planning ámbito — not the Lens circle | ámbito de planeamiento completo — no el círculo de Lente |

### P0 — the lattice

| Key | EN | ES |
|---|---|---|
| `aside.boundaries.ambitos` | All planning ámbitos | Todos los ámbitos de planeamiento |
| `planning.legend.title` | Official planning ámbitos · PGOUM boundaries | Ámbitos oficiales de planeamiento · límites del PGOUM |
| `planning.legend.ceiling` | Planning boundaries — not construction, not built footprints. | Límites de planeamiento — no es construcción, no son huellas de lo edificado. |
| `planning.latticeZoom` | Zoom in to show every planning ámbito. The ones the Lens circle touches stay visible. | Acerca el mapa para ver todos los ámbitos de planeamiento. Los que toca el círculo de Lente siguen visibles. |
| `planning.loading` | Loading official planning ámbitos… | Cargando los ámbitos oficiales de planeamiento… |
| `planning.unavailable` | The official planning-ámbito layer is unavailable in this deployment. | La capa oficial de ámbitos de planeamiento no está disponible en este despliegue. |

### P1 — rail, summary and skip links

| Key | EN | ES |
|---|---|---|
| `aside.map` *(exists)* | Map display | Visualización del mapa |
| `aside.layers` *(exists)* | Operational layers | Capas operativas |
| `aside.administrative` *(exists)* | Administrative register | Registro administrativo |
| `aside.observed` *(exists)* | Observed activity | Actividad observada |
| `aside.context` *(exists)* | Context | Contexto |
| `aside.research` *(exists)* | Research evidence | Evidencia de investigación |
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
4. Spanish is designed with the English, not translated after it. The Spanish band label is ~22 %
   longer, so the band **wraps rather than truncates** — a truncated scope label is a lost scope
   label.
5. Every existing verbatim interpretation ceiling stays verbatim. Thinning inline caveat density is
   P2 register #8 and is **not** attempted here.

---

## 10. Interaction states

| Surface | Default | Hover / focus | Active | Disabled | Error / absent |
|---|---|---|---|---|---|
| Boundary select, "All planning ámbitos" | not selected | `:focus-visible` outline + ring (existing) | lattice drawn, legend shown | disabled while loading or unavailable, with the reason beside it | — |
| Membership chip | neutral outline, code + denomination | that ámbito highlighted on the map; **camera does not move** | — | — | zero case → `planning.touchedNone` |
| "Find planning ámbitos" | 44 px button in the planning section | `:focus-visible` outline + ring | dialog open, focus inside, trigger marked | disabled while loading or unavailable | `planning.finder.empty` if nothing is near |
| Finder row | code + denomination + distance | row highlight; the ámbito highlights on the map | locate fires; dialog closes; panel enters "looking at" | — | — |
| "← Back to the Lens" | visible only while the camera is away | `:focus-visible` outline + ring | camera restored; the control disappears | — | — |
| Rail group `<summary>` | collapsed ≤850 px, ≥44 px tall, badge `n of m on` | `:focus-visible` outline + ring | expanded; siblings close | — | — |
| Circle summary band | four figures + live radius + ⓘ | ⓘ `:focus-visible` | ⓘ opens the drawer scoped to Lens-circle surfaces | — | UTCI `—` + state; never `0` |
| Quick-jump chip | ≥44 px at coarse pointer | `:focus-visible` outline + ring | scrolls to its section | — | — |

**Progressive disclosure, in one sentence per level:** the count line answers *"are there any?"*;
the three chips answer *"which, roughly?"*; the finder answers *"all of them, and how do I get to
one?"*; the resolved panel answers *"what does the plan publish about it?"*; Evidence & limits
answers *"who published it, when, at what scope, and what may I not conclude?"* No level removes a
provenance field from the level below it.

---

## 11. Accessibility considerations, and the limits of that word here

### What is proposed

- **Two skip links** — "Skip to the analysis panel" and "Skip to the map layers" — as the first two
  focusable elements, `.sr-only` until focused, using the class the product already ships. This
  addresses the audit's tab-order caveat: 196 focusable Leaflet marker/cluster elements, with a
  cluster marker reached on the third Tab.
  **Source of those tab stops, newly identified:** cluster markers are created with
  `keyboard: true` at `js/app.js:2091`, and there is no skip link anywhere in `index.html`.
- **Native disclosure and dialog throughout.** `<details>/<summary>` for rail groups,
  `<dialog>` for the finder — the same primitives whose focus handling the audit found to pass.
  No hand-rolled ARIA accordion, no custom focus trap.
- **The lattice is `interactive: false`**, so it adds **zero** tab stops.
- **44 px coarse-pointer floor** honoured for every new control, and the one existing control that
  undercuts it is fixed (§7.4).
- **Focus return**: Escape or Close returns focus to "Find planning ámbitos".
- **Visible focus**: the existing `:focus-visible` outline + ring applies to all new controls.

### What is deliberately NOT proposed

Setting `keyboard: false` on cluster markers would shorten the tab order by **removing keyboard
access to the clusters**, trading one accessibility problem for another. A roving-tabindex over the
marker layer — one tab stop into the map, then arrow keys between markers — is the better answer,
but designing it responsibly needs an assistive-technology pass. It is named as follow-on work and
is **out of scope for P1**.

### What is NOT claimed

> This design is **not** asserted to conform to WCAG 2.1 or 2.2 at any level. No screen reader has
> announced any of it. Landmark structure, heading order, group semantics, live-region behaviour
> and AT focus order have not been assessed — not in #92 and not here. No real keyboard on real
> hardware has been used. The skip-link and dialog behaviours described follow from platform
> behaviour the product already relies on and from the DOM facts cited; they are reasoned
> expectations, not test results. A full WCAG/AT audit remains a separate, unscheduled gate.

---

## 12. Reusable small-screen interaction principles

Extracted so later surfaces inherit them instead of re-deriving them.

1. **Answer the arriving question first.** The reading order should lead with what the user came
   for. A jump shortcut is a mitigation, not a reorder.
2. **A compressed view is a projection of the same object, never a new one.** If a compact surface
   could ever disagree with its full version, it is a second source of truth and is wrong.
3. **Compression may drop detail; it may never drop a state.** OFF, unavailable, withheld,
   abstained and observed-zero all survive into the smallest surface.
4. **Group headers count interface, never data.** `n of m on` is a fact about switches. A record
   count on a chrome element reads as a measurement of the territory.
5. **Collapse by default only where the collapsed header is itself informative.** A header with a
   visibility badge earns its collapse; a bare label does not.
6. **The camera is the user's.** It moves on a gesture whose purpose is to move it, and never as a
   side effect of selecting, loading, restoring or switching anything.
7. **Any camera move ships with its way back**, visible for as long as the move is in effect.
8. **Reveal geometry before you move to it.** Showing where things are is cheaper, safer and less
   disorienting than transporting the user.
9. **State a rendering limit; never let it read as an absence.** "Zoom in to show every ámbito" and
   "there are none here" must never be confusable.
10. **Prefer native disclosure primitives.** They bring keyboard behaviour, state semantics and
    find-in-page for free, and they fail gracefully.
11. **Design the second language with the first.** Where Spanish runs ~20 % longer, the layout
    wraps; it never truncates a scope label, a unit or a ceiling.
12. **Nothing visual may imply a claim the evidence model refuses.** A filled polygon implies
    built area; outlines imply a boundary scheme. The colour family is part of the contract.

---

## 13. Acceptance criteria

Testable in a later implementation PR. Each names how it is checked. **None of these has been run.**

### P0

| ID | Criterion | How checked |
|---|---|---|
| **AC-P0-1** | At cold start, at the default centre, on each of 1440×900 / 834×1112 / 375×812, PLACE states **both** that no ámbito contains the Lens centre **and** how many official ámbitos the circle touches — without the user opening a disclosure, moving the map or moving the Lens. | DOM assertion on initial render at three viewports |
| **AC-P0-2** | From that initial state the user can reach a named individual ámbito and its published evidence in **≤ 2 deliberate actions**, on each device class. | Scripted interaction at three viewports |
| **AC-P0-3** | A **user-initiated** overview/locate action exists and is reachable **without focusing any map marker**, on each device class. | Keyboard-only traversal from document start |
| **AC-P0-4** | The lattice is drawn by a **new renderer over already-fetched geometry** — not `renderPlanningPolygon`, not a `planningPane` toggle — and adds **no runtime fetch** and no new artifact. | Source assertion + network assertion on Lens move |
| **AC-P0-5** | Membership figures come from `ambitosIntersecting` and carry **no quantity, share or proportion** of any ámbito's published values; the apportionment refusal still holds. | Existing contract tests extended |
| **AC-P0-6** | The camera moves on **exactly two** gestures (open an ámbito, back to the Lens). It does not move on mode change, Lens change, radius change, empty status, lattice toggle, load, URL restore or language switch. **The Lens never moves** and **no URL-state key changes** as a result of a locate. | Behavioural assertions, one per forbidden trigger; URL snapshot before/after |
| **AC-P0-7** | No label, legend, tooltip, `aria-label` or option text applies *development* / *projects* / *works* / *sites* / *construction* / *obras* / *construcción* / *promociones* to an ámbito. The lattice is stroke-only, in `--planning-neutral`, and the legend carries the planning-≠-construction line whenever it is on. | Lint-style assertion over markup + dictionaries; CSS assertion |
| **AC-P0-8** | The seven states of §8 are individually reachable and visually distinct; the zoom-gate message is never phrased as absence, unavailability or zero. | State-by-state DOM assertion |
| **AC-P0-9** | With the lattice on, pan frame p95 stays within the product's **33.3 ms** maximum on the reference tablet, and the zoom gate is set from that measurement. On the weak-laptop class, the measured result is **recorded, not assumed** — a failure there is reported, not hidden. | Device run reusing the K12 harness methodology |
| **AC-P0-10** | EN and ES dictionaries carry every new key, non-empty; every `data-i18n` key in the markup exists in both. | `tests/information_architecture.test.mjs` "M" tests, already present |
| **AC-P0-11** | The containment copy (`planning.outside`) is unchanged, byte for byte. | String assertion |

### P1

| ID | Criterion | How checked |
|---|---|---|
| **AC-P1-1** | At 375×812 **every** group header, including Administrative register (K9), is within the rail's first screen — no scroll, no ~693 px offset. The arithmetic in §7.2 predicts ≈192 px for K9 and 32 px spare; the measurement decides. | Rendered geometry at 375×812 |
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

`AC5` of #92 §9 — study probe (a), "where can you find a planning ámbito?", answered correctly by
≥5/6 participants — is a **study** outcome. It gates the final copy and behaviour, not the merge of
the implementation PR, and it cannot be met by any amount of design or code review.

---

## 14. Residual risks and the validation that has not happened

| # | Risk | Severity | How it would be retired |
|---|---|---|---|
| R1 | **Nobody has tried any of this.** The whole P0 premise — that disclosing membership makes the default view comprehensible — is a hypothesis. | **High** | The §7 study of #92: 6 participants, 5 journeys, 4 comprehension probes, on real devices |
| R2 | **The weak-laptop class fails the lattice**, measured (§6.4). The zoom gate mitigates but does not fix it, and the support floor is an open owner decision (K12 blocker #2). | **High** | Set the gate on a device during implementation; record the weak-laptop result honestly; the owner decides the support floor |
| R3 | **No real iPad/iPhone/Safari hardware** has run any of this, and the audit's tablet/phone evidence was Chromium emulation. Touch-drag vs scroll vs pinch arbitration, `dvh`, momentum and real overlap are all unverified. | **High** | A real-device pass in the implementation PR |
| R4 | **No assistive-technology or WCAG assessment** exists for the current build or for this design. | **High** | A separate accessibility gate |
| R5 | The **height budgets in §7 are arithmetic**, not measurements. Font metrics, wrapping and safe-area insets could overturn the 32 px margin at 375 px. | Medium | AC-P1-1, AC-P1-3 |
| R6 | **The distance figure in the finder could be misread as evidence** despite its label. | Medium | Probe it in the study; the fallback is to drop distance and order by official code |
| R7 | The **"looking at" panel state could read as a fourth mode**, undermining the settled three-mode contract. | Medium | Visual and copy separation; probe in the study; fall back to opening the resolved ámbito in a drawer |
| R8 | The **exclusive-accordion `name` attribute** may be unsupported on some target browsers. | Low | Documented graceful fallback (§7.2); verify on the reference devices |
| R9 | **≈86 px of a 341 px bottom sheet** is spent on the compact band; on a short phone in landscape that could crowd the panel. | Low | Measure at 375×812 and at a landscape height; the 48dvh question is open |
| R10 | My §2 correction rests on **arithmetic and model execution, not on a rendered screenshot**. If the deployed build differed from `main`, the counts could differ. | Low | The implementation PR renders it; note that #92 could only assert deployment identity at asset-version level, not cryptographically |

### The human and hardware validation plan

Adopted from #92 §7 and extended for the P0/P1 designs. **It has not been run.**

- **Participants:** 6 — 2 Madrid residents, 2 municipal planners, 2 tourism analysts. Moderated,
  ~30 minutes each, on real devices **including at least one real iPad and one real phone**, and
  at least one weak integrated-GPU laptop for R2.
- **Fixed start state:** the default cold start, PLACE, default Lens, no layers changed.
- **Tasks:** the five journeys of #92, plus two new ones — *T6: find an official planning ámbito
  and tell me its code*; *T7: on a phone, turn on granted urban licences*.
- **Comprehension probes:** the four from #92, plus two: *(e)* "does this outline mean something
  has been built there?" and *(f)* "the panel says no ámbito contains your Lens centre, and also
  that your circle touches nine — are those contradictory?"
- **Targets:** ≥5/6 task success per journey; all probes answered correctly by ≥5/6. Probe (e) is
  the one that governs whether the planning-vs-construction design works at all.
- **Separately, and not substitutable:** an assistive-technology pass and a WCAG 2.1/2.2 audit.

---

## 15. Gate verdict — GO / HOLD

### **GO** — to **two independent, separately gated implementation PRs**, P0 first, then P1.

The design work is complete and the two tracks are independently implementable. The P0 premise was
materially wrong in the audit, and correcting it (§2) **reduces** the risk and cost of the P0
implementation rather than increasing it: the primary fix is disclosure of an answer the product
already computes, over data it already holds, needing no camera movement, no new artifact and no
new computation. The scientific contracts are untouched throughout — containment and membership
stay separate scopes, the apportionment refusal stands, Gate L's m²-only and no-dwelling-count
ceilings stand, every verbatim interpretation ceiling stands, and HATI is untouched.

**The GO is bounded, and the bounds are the point:**

- It authorizes **implementation**, not a claim that the implementation will be discoverable,
  usable or accessible. R1, R3 and R4 are all open and all **High**.
- It carries **one real engineering unknown**, R2: the lattice is device-measured to fail on the
  weak integrated-GPU laptop class. P0's implementation must set the zoom gate against a device
  and **report the weak-laptop result honestly even if it fails**. That is AC-P0-9, and it is the
  single criterion most likely to come back negative.
- It does **not** authorize P2 (registers #5–#10 of the audit), which stay queued and untouched.
- It does **not** close the K12 owner decision on the target device floor.

### Why not HOLD

A HOLD would be right if the design depended on an unverified premise, or if a scientific contract
were at risk. Neither holds. The premise that needed checking was checked and corrected, against
the product's own model; the contracts are untouched; and the one measured performance risk is
bounded by an opt-in default, a zoom gate and an honest message, with a measured precedent on the
reference tablet rather than a guess.

### Proposed order — do not create these yet

| Order | Issue | Scope | Depends on |
|---|---|---|---|
| **1** | **P0-a · Planning ámbito membership disclosure** | §5.1, §5.2: promote the membership answer out of `#placeDetail`; the count line, chips and "See all n"; copy keys; AC-P0-1, -5, -10, -11 | nothing |
| **2** | **P0-b · Ámbito lattice and finder** | §5.3, §6: the new lattice renderer and the fourth boundary option; the finder dialog; `nearestAmbitos()`; the camera contract; the zoom gate and its device measurement; AC-P0-2, -3, -4, -6, -7, -8, -9 | P0-a |
| **3** | **P1 · Small-screen rail, reading order and touch floor** | §7: collapsible groups with `n of m on`; the compact circle summary; the 44 px chip; the two skip links; AC-P1-1 … -10 | nothing — **can run in parallel with P0** |
| **4** | **Validation** | §14: the human study and the real-hardware pass, gating final copy and behaviour | P0-a, P0-b, P1 |
| later | P2 | Audit registers #5–#10, unchanged | — |

P0-a and P1 touch different surfaces (the planning section vs the rail, the panel head and the
stylesheet) and could run concurrently; P0-b should wait for P0-a because it reuses its membership
rendering and its copy keys.

---

### Compliance with the #93 quality and scope gates

- [x] All changes are **documentation and design assets only**, in **one** Draft PR.
- [x] **No production CSS, JS, HTML, test, data or HATI file is edited.** `git diff --stat` against
      `main` touches only `docs/POST_K13_P0_P1_DESIGN_PROTOTYPE.md` and
      `docs/design/post-k13-p0-p1/*.svg`.
- [x] **No claim that a human completed a task or that a real iPad was tested.** §1, §11, §14 and
      every wireframe footer state the opposite explicitly.
- [x] **No assertion that this design passes accessibility standards or P0 discoverability.** §11
      states what is and is not claimed; §13 routes both to criteria that have not been run.
- [x] **An explicit human and real-hardware validation plan** is in §14.
- [x] A GO/HOLD verdict, residual risks and the proposed P0-then-P1 order are above. No
      implementation issue is created by this gate.

---

*No production code, data, model, scope, date, withholding rule, abstention, derivation,
interpretation ceiling or HATI layer was changed by this design gate. Every wireframe is a static
sketch. No interactive behaviour described here exists. Real-hardware, assistive-technology and
human usability validation were NOT conducted.*
