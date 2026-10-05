# Spatial Window Sensitivity V1

A sensitivity check on the **analytical method**, not another view of the values.

- Pure model: [`js/radial-halo.js`](../js/radial-halo.js) — `buildSpatialSensitivityModel`,
  `captureSpatialSensitivityBaseline`, `spatialBaselineCenterChanged`,
  `spatialBasisCompatible`
- View layer: [`js/app.js`](../js/app.js) — `renderSpatialSensitivity`,
  `captureSpatialBaseline`, `resetSpatialBaseline`,
  `enforceSpatialBaselineValidity`, `spatialEvidenceKey`
- Markup: `#spatialSensitivity` in [`index.html`](../index.html)
- Tests: [`tests/spatial_sensitivity.test.mjs`](../tests/spatial_sensitivity.test.mjs),
  `SS *` blocks in [`browser-tests/radial-halo.browser.mjs`](../browser-tests/radial-halo.browser.mjs)

Related: [Comparison Bridge V1](COMPARISON_BRIDGE_V1.md) ·
[Decision Insight V1](DECISION_INSIGHT_V1.md) · [Radial Halo V3](radial-halo-v3.md)

---

## 1. Purpose

Every other comparison surface answers a question about **one** analytical window
pair:

| Surface | Question |
| --- | --- |
| Radial Halo V3 | What is locally present around each Lens? |
| Comparison Bridge V1 | What is the detailed A ↔ B reading for *this* metric? |
| Decision Insight V1 | What are the observed contrasts across the canonical set? |
| Comparison table | What is the full current inventory? |
| **Spatial Window Sensitivity V1** | **If I change the spatial windows, does that reading still hold?** |

The user freezes the current configuration as the **baseline window**, then
deliberately changes the Lens radii. The live configuration becomes the
**scenario window**. The layer reports, per canonical metric, how the *existing
authoritative reading* responded: it stayed the same, changed B − A direction,
changed comparison basis, became withheld, or became available.

## 2. Why spatial-window sensitivity matters

Every lens count is a function of an arbitrary analyst choice: the radius. A
comparison that reverses when the radius moves 200 m is a different kind of
finding from one that holds across windows — but nothing in the stack previously
made that distinction visible. A reader could take "Lens B has 8 more tourism
POIs" as a property of Madrid when it was partly a property of the chosen circle.

This layer makes the method's own fragility legible, in the same panel as the
reading it qualifies.

## 3. Scientific interpretation — the central distinction

**Changing a radius changes which geography, and therefore which records, each
Lens includes. It does not change Madrid.**

So a different result under another radius does **not** mean the destination
changed. It means:

> the interpretation is sensitive to the chosen spatial window.

This is why no transition is ever phrased as an impact, an effect or a cause. The
radius change did not make records exist; it changed what was counted.

Allowed: *"Observed B − A changed from +6 to +11 records under the scenario
window."*

Not allowed: *"Increasing the radius adds 5 tourism POIs."*

## 4. What this is NOT

Not a forecast, prediction, projection, expected or future state, simulation of
future tourism, policy scenario, intervention estimate, causal model,
recommendation engine, composite score, robustness percentage, ranking of Lens A
against Lens B, or an LLM-generated narrative.

The scenario is **an alternative analytical window configuration over the same
evidence** — never an alternative future Madrid. There is no runtime LLM, no
generative service and no network call anywhere on this path; every state is
deterministic and traceable to one evidence state.

## 5. Baseline vs scenario

A captured **baseline** stores, immutably:

| Field | Meaning |
| --- | --- |
| `radii` | `{A, B}` at capture time |
| `centers` | both Lens centres at capture time |
| `radiusMode` | `EQUAL_RADIUS` / `UNEQUAL_RADIUS` at capture time |
| `evidenceKey` | fingerprint of the evidence contract (§8) |
| `items` | the authoritative per-metric interpretation, one `decisionInsightItem` per canonical metric |

The **scenario** is always the live state, built from the same
`buildBridgeMetricModels()` the Bridge and Decision Insight consume.

### Immutability

The snapshot is deep-frozen at capture. It must never drift with the live state:
a baseline that followed the radius slider would make the whole comparison
meaningless. Moving a radius, moving a lens or recomputing leaves it untouched.

### Structured state, never text

The baseline stores **model state**, not rendered strings. Text is rendering; the
model is truth. Storing `"Tourism POIs: +8"` and parsing it back would make the
baseline reading depend on the view, so it is forbidden — as is reading
Bridge/Insight/table `textContent` anywhere on the production model path. Browser
tests may inspect the DOM; production logic may not.

## 6. V1 scope — radii only

V1 changes **only** Lens A radius and Lens B radius. There are deliberately no
scenario controls for lens centres, dataset toggles, UTCI timestep, accommodation
category, destination context, pedestrian data, source availability, filters,
administrative geography or dates.

That narrowness is what makes the reading interpretable: every transition has
exactly one possible cause — the spatial window.

## 7. Centre-change invalidation

A Lens **centre** move is a *different place*, not radius sensitivity. If either
centre moves materially (> 1 m, a tolerance that absorbs floating-point jitter
only) while a baseline exists, the baseline is **invalidated** and the panel says:

> Baseline invalidated · Lens location changed

The alternative — silently comparing two different locations as though only the
radius had changed — would be wrong, so it is not offered. The user captures a
new baseline when ready.

**Map pan and zoom never invalidate**, because they do not change the analytical
geography. Neither does switching the active lens.

## 8. Evidence-configuration invalidation

This is a spatial-window scenario, not an evidence-configuration scenario. A
change to the evidence contract behind the canonical metrics would otherwise be
silently read as radius sensitivity.

`spatialEvidenceKey()` fingerprints: HATI enabled state and timestep, the
accommodation category filter, the three count metrics' source statuses, and the
regression-seam evidence override. Lens radii and centres are deliberately
**absent** — the radius *is* the scenario, and the centre has its own rule above.

**V1 policy is to invalidate**, not to mark the scenario incompatible:

> Baseline invalidated · evidence configuration changed

Turning Lens B off also drops the baseline, since the A ↔ B comparison it
described no longer exists.

The accommodation-category transition lives in a single production helper,
`setStayKindFilter(nextKind)`, which the real `#stayKindFilter` handler and the
gated regression seam both call. That matters for testability: the `<select>` is
correctly **disabled** whenever the packaged fallback carries no accommodation
type metadata (true of a clean CI checkout), so a regression driving the control
would assert the deployment's data shape rather than the invalidation contract.
Routing both through one helper lets the test exercise the real state transition
— evidence key, layer rebuild and re-render — while bypassing only the disabled
control. The production availability rule is untouched, and source-guard tests
pin that the handler and the seam share that one helper and that the seam stays
query-gated and localhost-only.

The pure model keeps `EVIDENCE_CHANGED` as a second line of defence: if it is
ever handed two snapshots with differing evidence keys it refuses every numeric
change rather than presenting the difference as spatial sensitivity. Under the UI
policy that state is normally unreachable.

## 9. Authoritative model architecture

```
evidence
  ↓
countState / utciState / buildCountPairState      (comparison states)
  ↓
buildComparisonBridgeModel(...)                   (authoritative reading)
  ↓
decisionInsightItem(...)                          (authoritative interpretation)
  ↓                           ↓
buildDecisionInsightModel   buildSpatialSensitivityModel
     (current)                (baseline snapshot vs current)
```

The sensitivity layer **compares two snapshots of the authoritative
interpretation**. It does not reimplement comparability, delta calculation,
density normalization, the Mobility withholding rule, the UTCI timestep contract
or the AOI conditions — all are read through.

Consequence: the scenario side is the *same object* Decision Insight renders, so
it can never become an independent fifth interpretation of the current state.
The five-surface coherence regressions pin this.

## 10. Transition taxonomy

Deliberately small. Each code answers "what happened to the analytical reading?",
never "what happened to Madrid?".

| Code | Condition |
| --- | --- |
| `UNCHANGED_COMPARABLE` | both comparable, same basis, same B − A direction |
| `DIRECTION_CHANGED` | both comparable, same basis, B − A sign changed |
| `BASIS_CHANGED` | both comparable, but the comparison basis differs |
| `BECAME_WITHHELD` | baseline comparable, scenario not comparable |
| `BECAME_COMPARABLE` | baseline not comparable, scenario comparable |
| `WITHHELD_UNCHANGED` | neither comparable, equivalent authoritative reason |
| `WITHHELD_REASON_CHANGED` | neither comparable, authoritative reason changed |
| `EVIDENCE_CHANGED` | the evidence contract itself differs (§8) |

Basis is checked **before** direction: when the basis differs the two signs
describe different quantities, so "direction changed" would be a false reading of
an incomparable pair.

Two non-comparable states are *equivalent* only when both the descriptive state
and the reason match, so `off` never reads as `unavailable`.

## 11. Direction semantics

Direction is **only** the arithmetic sign of B − A: positive, negative or zero. It
is never a winner, leader, better, worse, improvement or decline. A change from
positive to negative is reported as "B − A direction changed", never as "Lens A
overtook Lens B". Direction is exposed as a data attribute for traceability and is
never styled — a sign is not success or failure.

## 12. Basis compatibility — the central abstention

`scenarioDelta − baselineDelta` is computed **only** when the two differences mean
the same thing. All of these must hold:

- baseline comparable **and** scenario comparable
- same metric
- same `deltaKind`
- same `basisCode`
- same evidence contract

| Transition | Numerically comparable? |
| --- | --- |
| raw counts → raw counts | yes |
| density → density | yes |
| Celsius → Celsius | yes (the timestep contract is read through) |
| **raw counts → density** | **no → `BASIS_CHANGED`, `deltaChange = null`** |

Units are **never** converted to force a comparison. Where the basis differs the
panel names both bases and says the numeric change is withheld:

> Basis changed
> raw represented counts → represented-record density · numeric change withheld · different comparison bases

### Raw-count vs density incompatibility

Under equal windows the authorized Tourism/Stays relationship is a **raw
represented count** difference. Under unequal windows it is a
**represented-record density** difference (records/km²). These are different
quantities: `+8 records` and `+5.2 records/km²` cannot be subtracted, and showing
`−2.8` would be meaningless. This is the most common and most important
transition the layer surfaces.

### When a numeric change IS shown

Only as *the change in the observed comparison under the alternative window*,
with the unit the shared basis requires:

> Observed comparison changed by +3 records

A zero change prints nothing: the transition label and the two side-by-side
readings already say it.

## 13. Per-metric rules (all inherited, none redefined)

**Tourism / Stays.** Equal radii use the authorized raw-count relationship;
unequal radii use represented-record density where the current contract
authorizes it. Equal → unequal therefore yields `BASIS_CHANGED`. The scenario
layer alters none of this.

**Mobility.** The existing contract is preserved exactly. Equal radii + valid
evidence → a numeric comparison. Unequal radii + valid evidence → withheld,
*different window sizes*. Unavailable evidence → the authoritative evidence
reason, which outranks the window mismatch (with no valid pair there is nothing
for the window rule to withhold). Mobility **never** converts to a density under
any window change. The most useful state this layer exposes is therefore
baseline *comparable* → scenario *withheld · different window sizes*.

**UTCI.** Remains model-derived Celsius and is radius-independent, so changing the
radii does not change its basis the way it does for the count metrics. Two valid
Celsius readings under the same timestep contract compare, carrying the
`model-derived` limitation. Differing timesteps stay incomparable. If a lens loses
its sample under the scenario radius the comparison becomes non-comparable — no
value is manufactured. A Celsius change is descriptive, never a thermal impact.

**Pedestrian** remains excluded: it is a panel-only observational comparison and
is absent from the canonical set.

## 14. Zero / N/A / OFF / withheld

All four existing distinctions are preserved end to end:

| State | Meaning |
| --- | --- |
| observed zero | **valid evidence**, and it participates in a comparison |
| N/A | evidence unavailable — never zero |
| OFF | layer intentionally disabled — never zero, never N/A |
| withheld | comparison disallowed despite relevant evidence |

So `VALID → ZERO` may still be comparable; `VALID → N/A` is not; `OFF → N/A` is a
reason change, not an equivalent state. An unavailable or disabled side never
collapses into a zero value or a zero direction.

## 15. Fixed order, no ranking

The four canonical metrics always render in the fixed order **tourism, stays,
mobility, utci**, and are never sorted by magnitude, change size, importance or
availability: they have different units and meanings, so any ordering would
falsely imply cross-metric comparability. There is no "top sensitivity".

## 16. Overall summary — categorical, never a score

| Status | Condition |
| --- | --- |
| `STABLE` | at least one metric comparable in **both** windows, and no metric changed state, direction, basis or reason |
| `MIXED` | at least one metric comparable in both windows, and something changed |
| `LIMITED` | no metric comparable in both windows — stability cannot be assessed |
| `EVIDENCE_CHANGED` | the evidence contract differs (§8) |

There is deliberately **no number**: no robustness percentage, confidence value,
stability score or sensitivity index. The project defines no statistical
robustness test, so a number here would invite exactly that misreading.

Note that a **magnitude** change with unchanged direction and basis stays
`STABLE` — see §17.

## 17. Language

The copy claims only what was observed between the two selected windows.

- "Stable under this window change" — **not** "robust". There is no statistical
  robustness test in this project, so no robustness claim is made.
- "Sensitive to window choice" — used strictly in this defined sense:
  *the qualitative comparison state or B − A direction changes between these two
  selected analytical windows.* A change in magnitude alone is **not**
  sensitivity in this sense; it is reported per metric as the observed change.

The shipped guard states the boundary directly:

> Alternative analytical window · not a forecast and not a causal effect

## 18. UI location and behaviour

Inside the Lens A ↔ Lens B panel, in this hierarchy:

```
Lens A ↔ Lens B
  radius / mode cue
  Comparison Bridge        → current focused metric
  Decision Insight         → current comparison synthesis
  Spatial Sensitivity      → baseline vs current analytical window
  comparison table         → current full inventory
  evidence / provenance
```

Decision Insight remains about the **current** scenario state and is never
replaced by baseline values. The separation of layers is deliberate and is pinned
by test.

**No modal, no second dashboard, no map widget.** The map still shows only the
current/scenario Lens A and Lens B: V1 draws **no ghost baseline circles**, which
would mean four circles plus halos. The baseline lives in the panel, as text and
values.

**Controls.** `Capture current comparison` → once captured, `Capture current as
new baseline` plus `Reset baseline`.

**Reset** removes the stored baseline and nothing else: it does not move the
lenses, reset the radii, change layers, change the active lens, or touch the
Comparison Bridge or Decision Insight.

**Replacing the baseline is always explicit.** It never moves on its own after a
radius change — that would destroy the purpose of the comparison.

**Focus.** When a canonical metric is focused through the halo, the Bridge or the
table, the matching sensitivity item gets subtle emphasis via the existing shared
focus state. No item is ever hidden and none is interactive: this section is
informational, not a second metric selector.

## 19. Accessibility

- A real `<h3>` section heading, with `aria-labelledby`.
- Exactly two tab stops: the capture and reset buttons, both with text labels.
- Baseline and scenario radii are readable as text, as are both sides of every
  metric and its transition.
- No state depends on colour: every state is carried by words (Relationship
  unchanged, Basis changed, Comparison became withheld, Withheld · reason, N/A,
  OFF). No traffic-light hues, no winner badges, no arrows, and no styling keyed
  on B − A direction or on a transition code.
- No pointer-only behaviour and no manufactured tab stops.
- **Restrained announcements.** A single `aria-live="polite"` region is written
  *only* on the discrete capture and reset actions. Per-metric values stay
  visually live but are never announced, so dragging the radius slider cannot
  flood assistive technology with partial readings.

## 20. Responsive

Verified with no horizontal overflow on desktop, laptop, iPad landscape and iPad
portrait. Each metric **stacks** baseline → scenario → transition in that fixed
reading order at every width, rather than squeezing three narrow columns.
Typography scales up on touch/tablet widths and the controls reach a 44 px target
wherever the pointer is coarse.

## 21. Persistence

**Session / UI state only.** There is no backend persistence, no account and no
storage infrastructure. A page reload clears the baseline, as does disabling
Lens B. This is deliberate for V1.

## 22. Frozen contracts this feature does not touch

Radial Halo V3 geometry (`HALO_METRIC_SLOT_ANGLES`, `RADIAL_GAP`,
`MAX_BAR_LENGTH`, `BAR_THICKNESS`, `LABEL_GAP`, `CAPTION_GAP`), halo
normalization, the fixed label rail, the Comparison Bridge focus architecture,
Decision Insight semantics, the zero/N/A/OFF rules, the Mobility unequal-radius
semantics, the UTCI comparison contract and the regression seam gating are all
unchanged.
