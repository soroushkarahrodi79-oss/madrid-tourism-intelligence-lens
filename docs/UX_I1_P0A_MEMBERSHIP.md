# UX-I1 / P0-a — planning ámbito membership disclosure in PLACE

**Issue:** #95 · **Authority:** UX-D1 (#93), merged PR #94 (`55fa0c7`) · **Scope:** the one
unconditional P0-a increment only. No P0-b1 lattice, no P0-b2 finder, no P1 responsive redesign,
no P2 polish, no HATI change, no new dataset, no scientific-model or interpretation-ceiling change.

This note is the methodology disclosure the issue asks for: the AC-P0-2a decision, the
recomputation strategy, the measurements (and what they do and do not establish), and the
acceptance-criteria outcomes.

---

## 1. What shipped

The product answers two different official-geography questions that UX-D1 §2.2 keeps apart:

| Question | Model call | Scope |
|---|---|---|
| Does an official planning ámbito **contain** the Lens centre? | `ambitoContaining` | `PLANNING_AMBITO` |
| Which planning ámbitos does the Lens **circle intersect**? | `index.ambitosIntersecting` | `LENS_INTERSECT_AMBITO` |

At the modelled default centre, containment returns `outside_all_ambitos` while the default Lens
*does* intersect ámbitos. Before this increment the circle-intersection answer was computed only
while the closed `#placeDetail` disclosure was open, so a reader saw the truthful containment
absence but never the nearby circle membership.

P0-a promotes the **canonical** membership answer into the always-visible PLACE planning section,
directly beneath the unchanged containment reading (`index.html` `#planningMembership`):

- a **count line** (`planning.touchedCount` / `planning.touchedCountOne` / the unchanged zero case
  `planning.touchedNone`);
- up to **three identity-only chips** — official code + denomination, plus the existing
  "contains the Lens centre" mark where the centre also sits inside that ámbito — carrying **no
  number**;
- **"See all n"** when more than three ámbitos are touched, which opens and scrolls to the
  existing `Detail` full list (bounded navigation — no camera move, no Lens rebind, no mode change).

Containment and membership stay visually and verbally separate (own ruled block, own scope). The
reading reuses `index.ambitosIntersecting` exclusively — no new geometry, no overlap ratio, no
apportionment. `planning.outside` is byte-identical. New EN/ES keys are documented in UX-D1 §10
(`planning.touchedCount`, `planning.touchedCountOne`, `planning.touchedSeeAll`) plus one honest
pending-state key this increment adds, `planning.touchedUpdating`.

Because the membership surface is now always on screen in PLACE, the scope-&-freshness rail names
`LENS_INTERSECT_AMBITO` whenever the planning artifacts have loaded (flag renamed
`planningDetail` → `planningMembership`), not only while `Detail` is open.

---

## 2. AC-P0-2a — can a chip open the existing whole-ámbito evidence? **NOT MET by P0-a (recorded, deferred)**

UX-D1 §5.4 asked to evaluate, before building any finder, whether a chip could open the existing
whole-ámbito reading in `#planningAmbito`.

**Decision: it cannot be done safely within P0-a, so AC-P0-2a is explicitly NOT MET, and the gap is
recorded as the justification for later considering P0-b2 — not improvised here.**

The `#planningAmbito` surface is a containment-keyed state machine:

- `renderPlanningContext()` renders the ámbito returned by `planningContaining()` and is memoised
  through `lastPlanningRenderKey` (keyed on the **containing** code + state);
- it draws the containing polygon via `renderPlanningPolygon(containing)`;
- it captures the K11 PLACE export from the **containing** ámbito (`k11.placePlanningModel`);
- it computes the K7 edition comparison for the **containing** code; and
- the rail's `PLANNING_AMBITO` instance is the containing code.

Rendering an arbitrary non-containing code through that surface would corrupt the memo key, the
drawn polygon, the K11 export and the rail instance — i.e. it would conflate a selected ámbito with
the containing área, exactly what the issue forbids. Doing it cleanly would require a **separate
render target / second product surface**, which is out of scope for P0-a ("without expanding into
an unreviewed second product surface"). So chips remain **bounded disclosure** (identity only, not
interactive controls that pretend to open a reading), and the route to the complete membership list
is the unchanged `Detail` card. O3 ("reach one's published evidence") is therefore **not satisfied
by P0-a alone**; this is the recorded negative outcome that AC-P0-2a permits, and the stated
justification for judging P0-b2 later from demonstrated need — not from speculation.

---

## 3. Recomputation strategy — measure first, then the minimum justified

Promoting the query removes UX-D1 §2.6's C2 deferral: `ambitosIntersecting` would otherwise run on
every continuous `marker drag` and `radiusSlider` input, where before it ran zero times.

**Measured first (see §4), then applied — the smallest safe strategy:**

1. **Identity guard (free, always correct).** `evaluatePlanningMembership()` caches the last scan
   keyed on `active|lon|lat|radiusM`. A re-render at unchanged geometry (language switch, mode
   re-render, re-activation, a second reader of the same set) reuses the frozen result and never
   re-scans. The promoted block and the `Detail` full list share this one evaluation, so there is
   never a double scan.
2. **Coalescing on the interaction paths.** While a Lens marker is dragged (`dragstart`→`dragend`)
   or the radius slider is slid (`input`→`change`), the scan is **deferred** and the surface shows
   an explicit **"Updating…"** pending state (`aria-busy`), never a stale set. On `dragend`, slider
   `change`, a PLACE map-click move and a K11 URL-state restore it **settles to the exact canonical
   membership** for the current centre and radius. This mirrors the existing K9 licence-layer
   drag-deferral precedent (`js/app.js`).
3. **No new geometry code.** `ambitosIntersecting` stays the only membership computation; the above
   are scheduling concerns. The no-apportionment rules are untouched.

Freshness is enforced by test (PA 23): pending while moving, then the rendered chips equal the
model's `ambitosIntersecting` read right now after a drag **and** after a radius change.

---

## 4. Measurements

`node scripts/benchmark_ambito_membership.mjs` (reproducible; `--cpu-only` for Arm 1 alone,
`--json` for machine-readable output). 724 ámbitos, committed artifacts.

### Arm 1 — CPU-only proxy of one `ambitosIntersecting` scan (NOT a device, NOT interaction-to-paint)

| Call | Median | p95 | Max |
|---|---|---|---|
| `ambitosIntersecting`, r = 900 m (default) | 3.13 ms | 4.50 ms | 6.47 ms |
| `ambitosIntersecting`, r = 2000 m | 3.70 ms | 6.34 ms | 9.15 ms |
| `ambitosIntersecting`, r = 5000 m (max) | 5.94 ms | 7.02 ms | 9.87 ms |
| `ambitoContaining` (contrast) | 0.01 ms | 0.03 ms | — |

(This development laptop, Node v24.11.0, machine otherwise idle. Under concurrent load the same
run measured ~9.7 ms median at r=900 — i.e. the figure is load-sensitive and should be read as an
order of magnitude, not a fixed number.) Order-of-magnitude consistent with UX-D1 §5.5 (8.25 ms
median / 13.76 ms p95 at r=900; 15.63/26.18 at r=5000). This is the **baseline cost of the scan** the promotion adds to each
interaction if nothing coalesces it: roughly half a 16.7 ms frame at the default radius and a full
frame at the maximum. The containing query is ~200× cheaper, confirming the coalescing is aimed at
the right call.

### Arm 2 — scripted Lens movement, script + layout proxy, headless Chromium 1440×900 (NOT a pointer/touch drag, NOT rendering FPS, NOT a device)

This arm is **not an actual pointer or touch drag**: it runs 120 synchronous
`__HALO_REGRESSION__.moveLens()` calls through the production `refresh()` in one `page.evaluate()`,
forces a layout flush each move, and averages over seven warmed runs with `--disable-gpu`. It is a
DOM/layout proxy for comparing scheduling strategies on the same build — not a frame-rate and not
drag-event timing.

| Arm | Median | p95 |
|---|---|---|
| PROMOTED, no coalescing (scan every move) | 9.53 ms | 13.20 ms |
| PROMOTED, coalesced (shipped) | 6.38 ms | 7.45 ms |
| settle scan on release (coalesced arm) | 3.70 ms (once) | — |
| **marginal per-interaction removed by coalescing** | **3.15 ms** | — |

The naive promotion (scan every move) carries the Arm-1 cost per interaction; the shipped
coalescing removes it from the drag entirely (~3.15 ms/interaction here, more at larger radii) and
pays it once on release as a single settle scan, at the cost of the honest pending state while
moving. Per-interaction cost returns to the baseline `refresh()` level during the drag.

### Device-grade latency and pan-frame (AC-P0-12 / AC-P0-13 physical devices)

**NOT TESTED — release-validation pending.** No owner-declared supported device (desktop class,
tablet Safari, phone Safari) was available in this execution environment (a Windows development
laptop running Node and headless Chromium only). The two arms above are a CPU-only proxy and a
headless script+layout proxy respectively; neither is interaction-to-paint, rendered frame-rate, or
a physical device, and **no device-grade pass is claimed or invented**.

**What *was* measured, precisely:** (Arm 1) the wall-clock cost of one `ambitosIntersecting` call
in Node on this laptop; (Arm 2) the script+layout cost of a scripted `moveLens` sweep in headless
Chromium at 1440×900 with the GPU disabled. **What was NOT measured:** interaction-to-paint latency,
pan-frame p95, pointer/touch drag, or any behaviour on tablet or phone Safari.

**Required release-gate procedure (owner, before production merge/release):**
1. The owner declares the supported-device floor **before** the result is interpreted (the open
   K12 decision), e.g. {a desktop class, a tablet Safari model, a phone Safari model}.
2. On each declared device, with membership promoted, measure **interaction-to-paint p95** during a
   real Lens drag and a radius drag (target ≤ 100 ms, maximum ≤ 150 ms) and **pan-frame p95**
   (target ≤ 16.7 ms, maximum ≤ 33.3 ms), using the K12 methodology (`docs/RUNTIME_DECISION_SPIKE.md`).
3. Confirm **freshness** on-device: after a drag, a radius change and a K11 URL-state restore, the
   displayed membership set equals the canonical `ambitosIntersecting` set (covered functionally by
   PA 23 / PA 25; re-confirm no stale paint on-device).
4. **Pass/fail consequence:** every declared supported class must pass. **A class that cannot be
   made to pass → HOLD rollout / redesign — recording the failure is not sufficient.** Do not weaken
   the thresholds and do not substitute the proxy numbers above for a device pass.

**Tooling for this gate (`research/ac_p0_12/`).** A temporary, LAN-accessible runner measures the
real app on Windows Chrome / iPad Safari / iPhone Safari without a Mac. Its measurement semantics are
**scoped per interaction** (independent review 5563658339): a **marker drag** and a **radius drag**
are graded on interaction-to-paint p95 (≤ 150 ms) plus settled membership freshness; a **map pan** is
graded on frame-time p95 (≤ 33.3 ms) measured **only** over the verified active-pan interval. The
33.3 ms pan ceiling is **never** applied to a drag/radius window (whole-window frames there are a
labelled, non-graded diagnostic). Every sample is attributed to a genuine Lens/radius/map change; a
PASS requires **all three** actual-gesture scenarios; a clean-`main` baseline runs the same measures
with freshness `N/A`. The first Windows observation (commit `fe85fa9`) is preserved and reclassified,
**not** relabelled PASS — see `research/ac_p0_12/results/README.md`. The owner steps are in
`research/ac_p0_12/README.md`.

**Functional vs release readiness:** the implementation is **GO on functional checks** (correctness,
freshness, scientific contracts, CI — see §5) **once F1's boundary-crossing regression passes**;
it is **HOLD for production merge/release until this device gate is satisfied** or the owner
documents a non-production staging path that keeps the gate effective.

---

## 5. Acceptance criteria outcomes

| Criterion | Outcome |
|---|---|
| **AC-P0-1** containment + membership as different questions, no forced move/disclosure, 3 widths | **MET** — PA 22 (1440×900 / 834×1112 / 375×812), PA 21. The block renders on initial PLACE render with no forced disclosure or map/Lens move; it sits **below the initial fold** at all three widths (§6), reachable by ordinary panel scroll — unscrolled discoverability is not claimed. |
| **AC-P0-2a** named ámbito's whole-ámbito evidence in ≤2 actions | **NOT MET, recorded & deferred** — §2; chips are bounded disclosure; route to the complete list is the `Detail` card |
| **AC-P0-5** only canonical membership, no share/quantity apportionment; tests | **MET** — pure-model guard (`tests/planning_ambito.test.mjs`), `tests/planning_membership.test.mjs`, PA 21 |
| **AC-P0-10** new EN/ES keys present, non-empty, documented | **MET** — `tests/planning_membership.test.mjs`, IA "M", PA 24 |
| **AC-P0-11** `planning.outside` byte-identical | **MET** — `tests/planning_membership.test.mjs` |
| **AC-P0-12** latency + freshness after drag/radius/URL-restore; no stale display | **freshness MET** (PA 23 **and PA 25**: boundary-crossing with an unchanged code set updates the `containsCentre` marks — no stale containment claim; URL restore settles via `refresh()`); **device latency NOT TESTED** — §4 |
| **AC-P0-13** real-browser render of the default state at three widths | **DOM-visible at three emulated widths** — PA 22 renders and asserts DOM/CSS visibility and no horizontal overflow at 1440×900 / 834×1112 / 375×812, and records whether the block is inside the **unscrolled** panel viewport (see §6). **Unscrolled user discovery is not independently established**, and this is browser **emulation**, not physical-device Safari. |

**Non-goals honoured:** no lattice, no finder, no fourth `boundarySelect`, no nearest/distance
algorithm, no new programmatic camera move, no P1/P2 work, no HATI change, no dataset/score/model
change.

---

## 6. Cold-start viewport (F3b)

PA 22 measures, at each width and with the panel **unscrolled** (`scrollTop === 0`), whether the
promoted membership block's top sits inside the panel's visible region
(`block.top < panel.top + panel.clientHeight`). `isVisible()` alone proves DOM/CSS visibility, not
that a user sees the block without scrolling, so the fold position is measured and reported rather
than assumed:

| Width | panel unscrolled | block top | panel visible bottom | within initial viewport? |
|---|---|---|---|---|
| 1440 × 900 (desktop) | yes (`scrollTop = 0`) | 848 px | 808 px | **no — below the fold** |
| 834 × 1112 (tablet) | yes | 1284 px | 1100 px | **no — below the fold** |
| 375 × 812 (phone) | yes | 1304 px | 800 px | **no — below the fold** |

(Headless Chromium emulation, cold start, default centre.) **Honest result: at all three emulated
widths the membership block renders unconditionally but sits *below the initial fold* — the reader
reaches it by the panel's ordinary vertical scroll, which is not a disclosure and not a map/Lens
move.** So AC-P0-1 ("shown on initial render, no forced disclosure or map/Lens move") holds, but
**immediate unscrolled discoverability is NOT established** and is not claimed. The block is third
in the planning section, which is itself the third PLACE section, so the administrative area and the
containing-ámbito reading precede it — exactly the reading order UX-D1 §5.1 specifies.

Making the block reliably above the fold at the narrow widths is the **P1 responsive-IA track**
(register #3, the 1,912 px stack in a 360 px overlay) and is explicitly **out of scope** for P0-a.
This increment states the fold position honestly; it does not claim immediate unscrolled
discoverability it has not established.

---

## 7. Corrections round (independent review of `fd298f7`)

| Finding | Resolution |
|---|---|
| **F1** (blocking) stale `containsCentre` — DOM signature ignored the per-entry containment bit | Both renderers' signatures now encode `code:containsCentre`; a boundary crossing with an unchanged code set re-renders the marks. New regression **PA 25** (both directions, EN + ES, consistency with `planningContaining`, not only code equality); **PA 23** strengthened to compare `containsCentre`. |
| **F2** (blocking for production) device gate still unverified | Stated explicitly as **GO on functional checks / HOLD release pending AC-P0-12 hardware**; §4 adds the required owner measurement procedure, supported-device decision and pass/fail consequence. No device pass invented. |
| **F3a** benchmark "REAL DRAG" misnamed | Renamed to **scripted Lens movement (script + layout proxy)** in the script, this doc and the PR; numbers and caveats preserved. |
| **F3b** cold-start visibility over-claimed | AC-P0-13 reworded to "DOM-visible at three emulated widths; unscrolled discovery not established"; §6 measures and reports the fold position per width. |

### Verdict

**GO on functional correctness** — F1 regression passes, scientific contracts hold, freshness is
enforced, CI is green. **HOLD for production merge/release** until the AC-P0-12 device gate (§4) is
satisfied on the owner-declared supported-device floor, or the owner documents a non-production
staging path that keeps the gate effective. AC-P0-2a remains a recorded, deferred negative (§2),
not a blocker for P0-a.
