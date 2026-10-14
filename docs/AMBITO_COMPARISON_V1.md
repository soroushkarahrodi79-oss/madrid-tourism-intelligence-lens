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
  `buildAmbitoEditionSensitivity`.
- Reads the K6 readers in [`js/planning-ambito.js`](../js/planning-ambito.js)
  (`developmentState`, `availableBuildability`) and, for edition sensitivity,
  the two dated editions K7 keeps in `data/planning/madrid_ambito_state.json`
  (`change_detection.previous` / `.current`) through
  [`js/ambito-change.js`](../js/ambito-change.js).
- Tests: [`tests/ambito_comparison.test.mjs`](../tests/ambito_comparison.test.mjs).

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
put in play — the comparison is **withheld by default**: every quantity reports
`withheldReasonCode: CROSS_EDITION` and every phase relation becomes
`INDETERMINATE` with `indeterminateReasonCode: CROSS_EDITION`. Both ámbitos are
still shown, each with **its own stated reference date**, exactly as mobility is
withheld (but both values shown) under unequal windows today. A cross-edition
comparison proceeds **only** when an explicit `documentedEditionBasis` string is
supplied.

## 7. `MODIFIED_BY_INSTRUMENT` is withheld, never compared

When either side carries a documented instrument barrier (`modifiedByInstrument`,
a K7 `MODIFIED_BY_INSTRUMENT` relationship), every quantity is withheld
`MODIFIED_BY_INSTRUMENT` and every phase relation is `INDETERMINATE` with that
reason. A pair that is not like-for-like across a planning-instrument
modification is never compared as if it were.

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

`buildAmbitoEditionSensitivity(current, previous)` asks: does the A ↔ B
relationship hold under the **previous** official edition? The varied parameter
is the **edition**, not the radius. `current` and `previous` are each a full
comparison model — A and B both read at the current edition, and A and B both
read at the previous edition. It reports one transition per canonical metric, in
fixed order, using the **same transition vocabulary** as Spatial Window
Sensitivity:

| Kind | Transition codes |
|---|---|
| quantity | `UNCHANGED_COMPARABLE`, `DIRECTION_CHANGED`, `BASIS_CHANGED`, `BECAME_WITHHELD`, `BECAME_COMPARABLE`, `WITHHELD_UNCHANGED`, `WITHHELD_REASON_CHANGED` |
| categorical | `RELATION_UNCHANGED`, `RELATION_CHANGED`, `RELATION_INDETERMINATE` (no direction, ever) |

The **basis is checked before any direction claim** (Spatial Window Sensitivity
V1 §12). Each side keeps its **own stated reference date**. A
`MODIFIED_BY_INSTRUMENT` metric in either edition reading reports a withheld
state rather than a change.

## 9. What K10 does not add

No score, index, ranking, ordering, "better ámbito" or composite across the four
phases. No phase delta. No cross-scope comparison. No apportionment of any
quantity into area or overlap. No radius sensitivity for ámbito scope. No
multi-ámbito comparison (two objects, as today). No citywide aggregate. No new
dataset and no new dependency. No change to any existing comparison semantics:
every current value, delta, basis, withholding rule and boundary stays exactly as
merged in PRs #56–#60.

## 10. Status (increment 1 of K10)

This document and `js/ambito-comparison.js` land the **authoritative pure model**
and its full Node test coverage. The COMPARE-mode A/B selection UI, the view-layer
wiring of the three comparison surfaces to this model, the map treatment of the
two official polygons, and the browser (Playwright) regressions are the **next
increment** on the same PR — see the PR description for the acceptance-criteria
matrix and what remains open.
