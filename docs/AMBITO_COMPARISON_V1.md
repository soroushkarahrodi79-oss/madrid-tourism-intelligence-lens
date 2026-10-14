# Ámbito Comparison V1 — K10

K10 extends the comparison surfaces to a second analytical scope:
`PLANNING_AMBITO`. It answers **Q10** ("How does this area compare with
another?") and **Q2/Q3** for two official planning ámbitos side by side, by
reusing the comparison discipline the circle-scope surfaces already enforce —
**not** by inventing a second comparison vocabulary.

- Pure model: [`js/ambito-comparison.js`](../js/ambito-comparison.js) —
  `buildAmbitoComparisonModel`, the one-state projections
  (`ambitoBridgeReading`, `ambitoDecisionInsightItems`, `ambitoComparisonRows`,
  `ambitoComparisonStatus`), `ambitoRadiusSensitivityStatus`,
  `editionContinuityFromOutcome`, `buildAmbitoEditionSensitivity`.
- Input assembly: [`js/ambito-comparison-adapter.js`](../js/ambito-comparison-adapter.js)
  turns the committed K6/K7 evidence into model inputs and derives edition
  continuity through the real K7 classifier; it computes no comparison itself.
- COMPARE UI: the ámbito scope switch, A/B selection (exact code + map polygon
  click) and the comparison surfaces in [`index.html`](../index.html),
  [`js/app.js`](../js/app.js) and [`css/app.css`](../css/app.css).
- Reads the K6 readers in [`js/planning-ambito.js`](../js/planning-ambito.js)
  (`developmentState`, `availableBuildability`) and, for edition sensitivity,
  the two dated editions K7 keeps in `data/planning/madrid_ambito_state.json`
  (`change_detection.previous` / `.current`) through
  [`js/ambito-change.js`](../js/ambito-change.js).
- Tests: [`tests/ambito_comparison.test.mjs`](../tests/ambito_comparison.test.mjs)
  (model), [`tests/ambito_comparison_integration.test.mjs`](../tests/ambito_comparison_integration.test.mjs)
  (real committed artifacts), [`browser-tests/ambito-comparison.browser.mjs`](../browser-tests/ambito-comparison.browser.mjs)
  (the real render path).

Related, with their existing contracts unchanged:
[Planning-ámbito evidence V1](PLANNING_AMBITO_EVIDENCE_V1.md) ·
[Official edition change detection V1](AMBITO_CHANGE_DETECTION_V1.md) ·
[Comparison Bridge V1](COMPARISON_BRIDGE_V1.md) ·
[Decision Insight V1](DECISION_INSIGHT_V1.md) ·
[Spatial Window Sensitivity V1](SPATIAL_WINDOW_SENSITIVITY_V1.md) ·
[Gate K workspace](GATE_K_URBAN_DECISION_WORKSPACE.md).

---

## 1. One authoritative comparison state

`buildAmbitoComparisonModel(a, b)` returns **one frozen object**. The Comparison
Bridge, Decision Insight, the comparison table and the sensitivity panel all
read that object; none recomputes a relation or a difference. This is the "one
interpretation invariant" of Radial Halo V3 / Comparison Bridge V1 / Decision
Insight V1 / Spatial Window Sensitivity V1, raised to the planning scope. The
projections `ambitoComparisonRows`, `ambitoDecisionInsightItems` and
`ambitoBridgeReading` only *read* the model's metric array — a test asserts the
table rows **are** that array and that the delta travels unchanged from model to
Insight to Bridge.

The model returns neutral codes; the view layer localizes them from
`AMBITO_COMPARISON_DICTIONARIES` (EN + ES).

## 2. The nine canonical metrics

In **fixed canonical order**, never sorted by magnitude and never a composite:

| # | Metric | Kind | Basis | Unit |
|---|---|---|---|---|
| 1 | `phase_planeamiento` | categorical | state equality | — |
| 2 | `phase_gestion` | categorical | state equality | — |
| 3 | `phase_urbanizacion_proyecto` | categorical | state equality | — |
| 4 | `phase_urbanizacion_obras` | categorical | state equality | — |
| 5 | `buildability_residential_collective` | quantity | m² | m² edificable |
| 6 | `buildability_residential_single_family` | quantity | m² | m² edificable |
| 7 | `buildability_tertiary` | quantity | m² | m² edificable |
| 8 | `buildability_industrial` | quantity | m² | m² edificable |
| 9 | `ambito_surface` | quantity | m² | m² |

Each metric carries its own `kind`, `basis` and (for quantities) `unit`. The
four phases are the K6 development-state fields; the four buildability metrics
are the K6 use classes; surface is the K6 published surface. No metric is
derived from polygon overlap or geometry area.

## 3. Categorical metrics produce no delta — ever

A phase comparison reports the **two verbatim published states** and a single
relation — `SAME`, `DIFFERENT`, or `INDETERMINATE` when a side carries no
published state. It never produces a numeric difference, a direction, a sign or
an implied ordering of the five phase values (`Sin Iniciar`, `En tramitación`,
`En Ejecución`, `Finalizado`, `No Necesita`).

- `No Necesita` compared against `Sin Iniciar` is **`DIFFERENT`**, not "behind".
  The five values are a vocabulary, not a scale (K6 §5.1,
  `MULTI_DIMENSIONAL_NO_SCALAR_STAGE`).
- A categorical metric object carries **no** `delta`, `deltaValue`, `direction`,
  `sign`, `rank`, `order` or `score` key, by construction. A test enumerates
  every leaf of every categorical object and asserts none is a number.
- The relation is computed on a cosmetic-insensitive key (case, accents,
  run-of-spaces) mirroring K7's `cosmeticComparisonKey`, so `En  Tramitación`
  and `En Tramitación` read `SAME` while the verbatim strings are preserved for
  display.

## 4. Quantity metrics: B − A in published units

A quantity metric is **comparable** — a `deltaValue` of `B − A` with
`deltaKind: "M2_DIFFERENCE"` — only when, on both sides:

- both editions are like-for-like (§6),
- there is no modification barrier (§7),
- buildability publishes a **single** row (multiple published rows are never
  summed, averaged or reconciled — K6 §9.2), and
- the cell is `PUBLISHED`.

`B − A` is **arithmetic direction only** — it never means B is "better". A
published `0` is a real value and participates in the difference. A blank cell is
`NOT_PUBLISHED` and never becomes `0`. When any condition fails the metric is
**withheld** with a first-class reason: `MULTIPLE_ROWS_NOT_COMBINED`,
`VALUE_NOT_PUBLISHED`, `CROSS_EDITION` or `MODIFIED_BY_INSTRUMENT`.

## 5. Cross-scope refusal

Selecting one ámbito and one Lens circle is **refused**, not approximated. The
mechanism is `crossScopeArithmeticAllowed` from #64: two different analytical
scopes are never combined without a documented basis, and geometric overlap is
explicitly **not** a basis. The refused model is `comparable: false` with a
`refusal: { code: "CROSS_SCOPE" }` and an **empty** metric array — there is no
fallback path that coerces the pair into a comparison, and a missing scope is
never defaulted to `PLANNING_AMBITO`.

## 6. Cross-edition withholding

Two ámbitos are like-for-like only when each family's edition snapshot identity
matches on both sides. Where they differ — possible when K7's second edition is
put in play — the comparison is **withheld**: every quantity reports
`withheldReasonCode: CROSS_EDITION` and every phase relation becomes
`INDETERMINATE` with `indeterminateReasonCode: CROSS_EDITION`. Both ámbitos are
still shown, each with **its own stated reference date**, exactly as mobility is
withheld (but both values shown) under unequal windows today.

**There is no override.** An early draft carried a `documentedEditionBasis`
string that let any non-empty value authorise a cross-edition comparison; that is
insufficient evidence — there is no defensible general basis for comparing ámbito
A at one edition against ámbito B at another — so it was removed. The controlled,
documented way to look across editions is §8.2 edition sensitivity, which varies
the edition for the **same** pair and derives identity continuity from K7.

## 7. Identity continuity is derived from K7, not asserted

Across an edition step, an entity's identity is continuous only when the K7
change-detection outcome for that exact code is `NO_CHANGE` or
`STATE_TRANSITION`. `NEW_AMBITO`, `ABSENT_FROM_EDITION`, `MODIFIED_BY_INSTRUMENT`,
`CAUSE_UNRESOLVED` and `NON_COMPARABLE` all mean the identity cannot be carried
across the step as a like-for-like entity. `editionContinuityFromOutcome` maps
each K7 outcome to an `{ established, reasonCode }` record; a missing or unknown
outcome is treated as **not established**, never as silently continuous. The
barrier is therefore derived from the documented K7 contract, **not** from an
application-supplied boolean. This matters only for edition sensitivity (§8.2):
within one edition, two distinct ámbitos are each themselves, so no instrument
barrier applies.

## 8. Sensitivity — an explicit decision, not an analogy

### 8.1 Radius sensitivity does not apply

Ámbito geometries are fixed and official; the reader cannot adjust them, so the
radius-sensitivity surface **does not apply** in ámbito scope.
`ambitoRadiusSensitivityStatus()` returns `applicable: false`,
`reasonCode: "FIXED_OFFICIAL_GEOMETRY"` and, critically,
`retainsBaseline: false` — a scope switch leaves **no stale Lens baseline**
behind. The view states this non-applicability explicitly rather than hiding the
panel or silently keeping a circle baseline.

### 8.2 Edition sensitivity replaces it

`buildAmbitoEditionSensitivity(current, previous, continuity)` asks: does the
A ↔ B relationship hold under the **previous** official edition? The varied
parameter is the **edition**, not the radius. `current` and `previous` are each a
full comparison model — A and B both read at the current edition, and A and B
both read at the previous edition. `continuity` is `{ a, b }`, each the K7-derived
`editionContinuityFromOutcome` record for that code (§7).

**Identity is checked first.** If either A or B is not identity-continuous across
the editions, **every** metric is withheld `WITHHELD_NON_CONTINUOUS` with the
governing reason: two editions of different objects are never compared as the
same object. Only when both sides are continuous is a per-metric transition
classified, using the **same transition vocabulary** as Spatial Window
Sensitivity:

| Kind | Transition codes |
|---|---|
| quantity | `UNCHANGED_COMPARABLE`, `DIRECTION_CHANGED`, `BASIS_CHANGED`, `BECAME_WITHHELD`, `BECAME_COMPARABLE`, `WITHHELD_UNCHANGED`, `WITHHELD_REASON_CHANGED` |
| categorical | `RELATION_UNCHANGED`, `RELATION_CHANGED`, `RELATION_INDETERMINATE` (no direction, ever) |
| identity | `WITHHELD_NON_CONTINUOUS` |

The **basis is checked before any direction claim** (Spatial Window Sensitivity
V1 §12). Each metric carries the baseline/scenario reference date **from its own
source family** — S1 development-state dates for phase and surface metrics, S2
available-buildability dates for buildability metrics — never one family's date
substituted for another's.

## 9. Halo

The Radial Halo is a Lens-circle display and its contract is unchanged: bar
lengths compare **within a metric only**, never across metrics, and nothing in
K10 touches `js/radial-halo.js` or the circle halo. K10 does **not** encode the
ámbito m² quantities as halo bars and does **not** encode the categorical phases
as quantitative bars. A halo for two fixed official polygons would need a
separate, defensible within-metric m² reference per metric; rather than invent a
benchmark the sources do not state, the ámbito quantities render as a labelled
table (value + unit, with B − A), which reads a set of m² figures as what they
are. If a defensible m² halo reference is ever warranted it can be added as a
separate within-metric scale that never shares an axis with a count metric; that
is deferred, not worked around.

## 10. What K10 does not add

No score, index, ranking, ordering, "better ámbito" or composite across the four
phases. No phase delta. No cross-scope comparison. No apportionment of any
quantity into area or overlap. No radius sensitivity for ámbito scope. No
multi-ámbito comparison (two objects, as today). No citywide aggregate. No new
dataset and no new dependency. No change to any existing comparison semantics:
every current value, delta, basis, withholding rule and boundary stays exactly as
merged in PRs #56–#60.

## 11. Surface and interaction

In COMPARE a scope switch chooses **Lens circles** (default, unchanged) or
**Planning ámbitos**. The two surface sets are gated by
`#compareLine[data-compare-scope]` and never show at once, so an ámbito
comparison cannot be read as a Lens one; switching to the ámbito scope also
invalidates any captured Lens-circle baseline. A and B are chosen by **exact
official code** (an `<input>` backed by a datalist of the committed codes; only an
exact code is accepted — the `-RP` discipline forbids near matches) or by
**clicking an official polygon** on the map, which selects A then B instead of
moving a Lens; outside the ámbito scope the click path is untouched. The two
selected geometries are drawn as official polygons (A solid, B dashed) on the
planning pane, distinct from the adjustable Lens circles.

The identity header shows both codes, denominations and edition reference dates;
the categorical phases render as same/different chips with no arrow, sign or
direction colour; the quantities render as a B − A table or a withheld reason;
the radius-sensitivity line states its non-applicability; and edition sensitivity
sits behind a disclosure. All copy follows the document language (EN/ES) and
official values stay verbatim.

### Status

K10 lands across two reviewable increments on PR #87: increment 1 the
authoritative model, docs and model tests; increment 2 the hardened scientific
contracts (no cross-edition override, K7-derived continuity, per-family dates),
the real-artifact integration tests, the COMPARE interaction and the Playwright
coverage. See the PR description for the full acceptance-criteria matrix and any
remaining map/halo polish.
