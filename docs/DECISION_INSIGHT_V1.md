# Decision Insight V1

**Status:** implemented.
**Depends on:** [`COMPARISON_BRIDGE_V1.md`](COMPARISON_BRIDGE_V1.md) (the
authoritative per-metric comparison model this layer reads) and, through it,
[`radial-halo-v3.md`](radial-halo-v3.md) (the four canonical metrics and their
per-side evidence states). The underlying comparison contract is
[`SPATIAL_COMPARISON_RADIAL_GATE_I.md`](SPATIAL_COMPARISON_RADIAL_GATE_I.md) and
[`INDEPENDENT_RADIUS_COMPARISON_GATE_J.md`](INDEPENDENT_RADIUS_COMPARISON_GATE_J.md);
this document does not restate them.
**Code:** pure model `buildDecisionInsightModel(...)` in `js/radial-halo.js`
(unit-tested in `tests/decision_insight.test.mjs`), rendered by
`renderDecisionInsight()` in `js/app.js`, styled in `css/app.css`
(`.decision-insight`), browser-tested in
`browser-tests/radial-halo.browser.mjs`.

## 1. Purpose

Comparison Mode already answers two questions. Radial Halo V3 answers *what is
locally present around each lens?*, and Comparison Bridge V1 answers *what is
the detailed comparison for **this** metric?*. Decision Insight answers the
third:

> **What are the main OBSERVED contrasts between these two analytical windows?**

Without it, a reader has to read four table rows, reconcile two unequal radii,
remember which metrics carry an evidence limitation, and compose the reading
themselves. Decision Insight does that composition deterministically, as four
short analytical clauses.

It is **concise analytical synthesis, not automated judgment.** It is not a
recommendation, a destination score, a winner selector, a ranking, causal
inference, a policy prescription, a new metric or a composite index.

## 2. Architecture

```
AUTHORITATIVE EVIDENCE   (layer status + per-lens values)
        ↓
comparison states        (countState / utciState / buildCountPairState)
        ↓
buildComparisonBridgeModel(...)      ← per-metric authoritative semantics
        ↓
buildDecisionInsightModel(...)       ← this layer: synthesis, no new arithmetic
        ↓
localized deterministic rendering    (renderDecisionInsight)
```

The Insight **never** scrapes rendered DOM text, and it **never** re-derives a
comparison rule. `buildDecisionInsightModel({ metricModels, radiusMode, radii })`
takes the four `buildComparisonBridgeModel(...)` outputs and reads them through:

| Insight field | Comes from |
| --- | --- |
| `state === "comparable"` | `relationship.comparable` |
| `deltaValue` | `relationship.deltaValue` (identity, not recomputation) |
| `deltaKind` / `basisCode` | `relationship.deltaKind` / `.basisCode` |
| `withheldReasonCode` | `relationship.withheldReasonCode` |
| `aEvidence` / `bEvidence` | `a.evidence` / `b.evidence` |

Because the Bridge delta is itself the table state's `delta`, one number travels
the whole chain: **evidence → state → Bridge → Insight**. Halo, Bridge, Decision
Insight and table therefore cannot develop different interpretations of one
comparison state; test `T` asserts the identity in every state, and the browser
suite asserts four-surface coherence on a live page (§11).

Analytical branching lives in the model. The renderer only turns codes into
localized text: it performs no arithmetic and makes no comparability decision.

## 3. Deterministic, with no runtime LLM

Decision Insight V1 **does not call an LLM or any external generative service at
runtime**, and makes no network request at all. Every sentence is a localization
template filled from one evidence state, so the output is:

- deterministic and reproducible — the same state always yields the same text,
- stable across reloads,
- testable as data (the model returns codes, not prose),
- evidence-traceable — each clause maps to exactly one authoritative state, so
  the project can defend precisely why it was produced.

A unit test scans the renderer for `fetch(`, `XMLHttpRequest`, `WebSocket`,
`EventSource`, dynamic `import(`, provider names and generative vocabulary, so
this property cannot regress silently.

## 4. Canonical metrics and fixed order

Decision Insight uses exactly the four canonical Halo/Bridge metrics, in this
**fixed** order:

1. `tourism`
2. `stays`
3. `mobility`
4. `utci`

The order is never changed, never sorted by magnitude and never sorted by
absolute difference. The four metrics have different units and meanings, so
ordering by |Δ| would falsely suggest cross-metric comparability or importance.
There is deliberately **no "top insight"**: no largest difference, most
important metric, key winner or strongest contrast is selected.

**Pedestrian is excluded.** It is observed-activity evidence with a different
observational contract, has no radial slot, and remains fully visible in the
detailed comparison table. A later version may evaluate panel-only contextual
insights separately; V1 does not broaden into it.

## 5. The B − A convention

Every relationship is reported as **B − A**. A positive number means
`valueB - valueA > 0` and *nothing else*: it carries no claim about quality,
preference, ranking, desirability or success on either side. The copy is
mathematically neutral, the sign is never colour-coded, and no arrow, badge,
trophy or traffic-light hue appears anywhere in the surface.

## 6. Per-metric states

Four descriptive states, kept semantically distinct and never collapsed into one
generic "no data":

| State | Meaning | Rendered as |
| --- | --- | --- |
| `comparable` | the authoritative model authorizes a B − A difference | `B − A +7.4 records/km²` |
| `withheld` | both sides carry real values, but direct comparison is not authorized | `Withheld · <reason>` |
| `unavailable` | at least one side has **no evidence** | `N/A · <reason>` |
| `off` | the layer is intentionally **disabled** | `OFF` |

The withheld clause is produced by the **same** `bridgeWithheldText()` the
Comparison Bridge and the Mobility table cell use, so a withheld Insight line
and the focused Bridge qualifier are literally the same string.

## 7. Equal-radius semantics

When the two windows are equal and the comparison is authorized, Decision
Insight surfaces the authoritative **raw-count** B − A, with the metric's own
unit (`records`, `catalogue records`, `nodes`). It reuses the Bridge's semantic
state verbatim and calculates nothing independently.

## 8. Unequal-radius semantics for Tourism and Stays

When the radii differ, raw-count differences are **not** described as directly
comparable. Where the authoritative model permits represented-record density
comparison inside the Madrid AOI, the Insight reports the density difference:

- Tourism → `B − A +7.4 records/km²`
- Stays → `B − A −3.2 catalogue records/km²`

Where the authoritative model withholds the comparison — circle crosses the
Madrid AOI, circle outside the Madrid AOI, AOI unavailable, or incompatible /
unavailable source states — Decision Insight shows **the same withholding
reason** and invents no normalized comparison.

## 9. Mobility semantics

Mobility's existing semantics are preserved exactly:

- valid evidence + equal radii → the authoritative numeric B − A,
- valid evidence + unequal radii → `Withheld · different window sizes`,
- unavailable / incompatible evidence → the authoritative **evidence** reason,
  which takes precedence over the window mismatch because no valid pair exists.

Mobility is **never** converted into a density comparator, and the halo's
normalized bar magnitude is never surfaced as a Decision Insight delta. The
panel/Bridge comparison state stays authoritative.

## 10. UTCI semantics

Mean UTCI is **model-derived** evidence, so a comparable Celsius difference
always carries that qualifier: `B − A +2.1°C · model-derived`.

V1 stays strictly descriptive. It does not translate a Celsius difference into a
categorical thermal-stress claim, because the project has no separately
validated categorical interpretation for that claim. When the UTCI layer is off,
the evidence is unavailable, the timesteps differ, or the state is incompatible,
the Insight shows the authoritative non-comparable state and reason.

## 11. Zero, N/A, OFF and withheld

- **Observed zero is a valid observed value.** Lens A = 0 against Lens B = 4 at
  equal radius yields `B − A +4`. Zero is never treated as missing evidence, and
  both sides zero yields a real `B − A 0`.
- **N/A** means evidence unavailable.
- **OFF** means the layer is intentionally disabled.
- **WITHHELD** means values may exist on both sides, but direct comparison is
  not authorized.

These four never collapse into one generic state, and none of them is ever
rendered as a zero.

## 12. Overall status

A descriptive, informational status is derived without scoring:

- **available** — at least one canonical metric has a valid comparable
  relationship,
- **limited** — nothing is comparable, but at least one side somewhere in the
  canonical set carries a real observed value (a genuine zero counts),
- **unavailable** — no canonical metric can provide comparative evidence.

The status describes *what comparative evidence exists*. It never rates how
"good" either lens is, and it carries **no number**, so it can never be read as
a confidence score.

## 13. No composite conclusion, no causality

There is **no composite calculation** in V1: no overall difference, overall
intensity, tourism-pressure score, destination performance, attractiveness, risk
score, readiness or quality figure. Metrics are never combined.

Only observed states and differences are described. `Lens B has +4.2 represented
stay records/km² relative to Lens A` is in scope; any "because …" explanation of
*why* is not. A unit test scans the model output, the model code, the renderer,
the markup, the stylesheet and this document for the specific judgment and
causal claim shapes the gate forbids.

## 14. UI location and visual form

Decision Insight sits **inside** the existing Lens A ↔ Lens B panel, in this
hierarchy:

```
comparison radius readout
comparison mode cue
Comparison Bridge
→ Decision Insight          ← here
full comparison table
evidence / provenance
```

It is never placed over the map, between the two geographic circles, in a
floating map popup, or in a large detached dashboard card. The map remains the
dominant spatial view, and the Insight stays compact: a small uppercase heading,
a descriptive status line, four one-line clauses and the guard. No giant KPI
typography, traffic-light colours, winner badges, "best" labels, trophies,
success/failure arrows, recommendation icons or score cards.

## 15. Descriptive guard

A compact, persistent guard sits beneath the items — an interpretation
safeguard, not a warning banner:

- EN: *Observed comparison only · no ordering or recommendation*
- ES: *Comparación observada · sin ordenación ni recomendación*

It is keyed by the model's own `guardCode` (`descriptive-only`), so the copy is
traceable to the model rather than hardcoded in the view.

## 16. Interaction with metric focus

The existing halo and table controls remain authoritative for focus; Decision
Insight is **not** a second metric selector and adds no control of its own. When
a metric is focused or locked:

- no other metric is hidden,
- the matching item receives subtle emphasis (a left accent and slightly
  brighter text),
- the other items are only mildly de-emphasized and stay fully readable.

Focus changes re-apply emphasis only; they never rebuild or reorder the items.

## 17. Localization

All user-visible strings resolve through the shared dictionary-backed
`createI18n` translator the Comparison Bridge introduced, in **EN and ES**. The
Insight deliberately shares the Bridge's dictionary: a withheld reason, a metric
name and a unit resolve through the *same key* on both surfaces, so their
wording cannot drift apart. Decimal formatting, units, the real minus sign in
`B − A`, the signed delta, the withheld terminology, the Madrid AOI wording and
the model-derived wording are all localized; a unit test asserts both languages
define every Insight key, and the browser suite renders both.

Like the Bridge, the Insight follows the **document** language so it stays
coherent with the comparison panel it lives in.

## 18. Accessibility

The surface is fully readable without visual styling:

- a semantic `<h3>` heading, referenced by `aria-labelledby`,
- a real `<ul>`/`<li>` list, one item per metric,
- each item exposes the metric identity and the relationship text as ordinary
  text, including the evidence qualifier and the withheld reason,
- the guard text is ordinary text,
- **no dependence on colour** — every evidence state is carried by words
  (`OFF`, `N/A · …`, `Withheld · …`),
- **no dependence on hover**.

It adds **no tab stop**: there is no button, link or `tabindex` inside it,
because the Insight is informational and the focus controls live on the halo and
the table. Focused emphasis is reflected with `aria-current` on the matching
item and no `aria-live` region, so pointer hover produces no announcement
chatter — the Comparison Bridge already owns the focused-metric announcement.

## 19. Responsive behaviour

Each item is a two-column row (metric identity, relationship clause) that wraps
rather than overflows, with `overflow-wrap: anywhere` on both cells. Tablet
widths get a legibility bump rather than shrunken text, and the narrowest
viewports stack the identity above its relationship clause. Browser regressions
assert no horizontal overflow on iPad landscape and iPad portrait, and the right
panel is not widened, so the map keeps its role as the primary spatial view.

## 20. Relationship to the other surfaces

| Surface | Question it answers |
| --- | --- |
| **Halo** | What is locally present around each lens? |
| **Bridge** | What is the detailed comparison for *this* metric? |
| **Decision Insight** | What are the observed contrasts across the canonical set? |
| **Table** | What is the full analytical inventory? |
| **Evidence** | What supports / limits interpretation? |

These responsibilities stay separate. Decision Insight adds no data, no metric
and no arithmetic of its own — only the synthesis.
