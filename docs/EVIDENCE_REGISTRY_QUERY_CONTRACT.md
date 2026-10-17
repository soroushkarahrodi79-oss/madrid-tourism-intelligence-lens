# Evidence Registry Query Contract (K13, #75)

**Status: implemented as a pure, deterministic query layer. Design and contract
only — the product contains no AI assistant.**

This document specifies the query layer added in `js/evidence-registry.js`. The
layer answers a **closed set of registered question shapes** from the evidence the
product already ships, returns **provenance alongside every result**, and
**abstains** — as a first-class, correct outcome — whenever the evidence does not
support the claim.

It is the architectural precondition Gate K §15 requires to exist **first**, so
that any future assistant has nothing left to invent. It is useful on its own: the
evidence drawer and the export bundle both read through it.

> **There is no AI assistant in this product.** No LLM, no model call, no API key,
> no network request, no prompt, no embedding, no vector store, no conversational
> surface, and no natural-language generation of any kind. `classifyIntent` is a
> deterministic keyword-and-pattern matcher and nothing more. If a language model
> is ever placed at that one seam, it may return a **registered shape name and
> nothing else**; every subsequent step stays deterministic, and the layer below
> is unchanged.

---

## 1. The evidence object contract

Every factual answer is a frozen evidence object with exactly these fields; a
missing field is a contract violation, never defaulted:

```
{ value, scope, unit, sourceId, freshness{ 5 fields }, ceiling, derivation }
```

| Field | Meaning |
|---|---|
| `value` | The deterministic model's own result (a number, a frozen record, a membership list). The layer does **not** recompute it. |
| `scope` | One analytical scope id from the closed enum in `js/evidence-scope.js`. |
| `unit` | The unit / copy key of the value (never blank). |
| `sourceId` | The source identity the value traces to (never blank); every public resolver authenticates it against the registry. |
| `freshness` | The five-field freshness record — `reference_date`, `published_at`, `retrieved_at`, `update_frequency`, `source_state` — preserving explicit nulls. |
| `ceiling` | The verbatim interpretation ceiling of the source, never softened. |
| `derivation` | `SOURCE_FACT`, or a **named deterministic transformation**. |

`makeEvidence(fields)` is the structural constructor of a factual answer. It
validates every field and returns a deep-frozen object, or throws. It refuses a
blank `sourceId`, but it has no registry input and does not by itself authenticate
an identity or date. Public query results go through `evidenceFromSource` and
`sourceProvenance`, which require the source identity and freshness to come from
the supplied committed registry. A directly constructed object is therefore not
equivalent to an authenticated public-query result.

### `derivation` — source fact vs named transformation (gate §15.3)

| `derivation` | Applied by |
|---|---|
| `SOURCE_FACT` | One value the publisher published, carried through unchanged (ámbito phases and buildability). |
| `POINT_IN_POLYGON` | Which official ámbito contains a point. |
| `CIRCLE_INTERSECT_POLYGON` | Which ámbitos a Lens circle touches — **membership only**, no quantity. |
| `IN_CIRCLE_FILTER` | A count of located records inside a Lens circle, by family and grant-date window. |
| `REGISTRY_LOOKUP` | The provenance of a registered source. |
| `EDITION_DIFF` | An edition-to-edition classification of one ámbito's published state. |
| `SAME_SCOPE_COMPARISON` | A same-scope comparison of two evidence objects (never cross-scope). |
| `AREA_PROFILE_ASSEMBLY` | Point-in-polygon barrio membership assembled with the registered barrio population (and optional licence context). The contained population value remains a publisher fact; the profile object is not. |
| `DESTINATION_CONTEXT_ASSEMBLY` | Published municipal hotel observations assembled with deterministic year-on-year differences, residence shares, trend range and display projections. The observations remain publisher facts; the view model is not. |

A derived value **always names its transformation**; the distinction survives into
the answer.

---

## 2. The closed set of registered question shapes

Adding a shape is a code change with tests, never a configuration value. Each shape
names the §5 user question it serves, its analytical scope, and the shipped
artifact / model it reads.

| Shape | §5 question it serves | Scope | Resolver (existing model) |
|---|---|---|---|
| `AMBITO_AT_POINT` | "What planning area is this?" | `PLANNING_AMBITO` | point-in-polygon (#68) |
| `AMBITO_PHASES` | "What planning stage is this area in?" | `PLANNING_AMBITO` | state lookup by code (#68) |
| `AMBITO_BUILDABILITY` | "What can still be built here?" (m² only) | `PLANNING_AMBITO` | state lookup by code (#68) |
| `AMBITOS_IN_LENS` | "What is being developed near here?" | `LENS_INTERSECT_AMBITO` | circle ∩ polygon (#68) |
| `AMBITO_EDITION_DIFF` | "What changed since the previous official snapshot?" | `PLANNING_AMBITO` | two-edition classifier (#69), guarded by the union of codes in both committed editions |
| `LICENCES_IN_LENS` | "Show urban licences granted within N m during the last year." | `ADDRESS_POINT` | in-circle filter by family and date window (#71) |
| `AMBITO_COMPARE` | "Compare these two development areas." | two same-scope objects | canonical K6/K7 inputs resolved from exact official codes and registered snapshot identities, then the #72 comparison model |
| `SOURCE_PROVENANCE` | "What supports this value, when was it updated, what does it not permit?" (Q11–Q13) | per source | registry lookup |
| `AREA_PROFILE_AT_POINT` | "Which official barrio is this, and what does its register say?" | `OFFICIAL_BARRIO` | the area-profile model |
| `CITY_HOTEL_DEMAND` | "What is the city's latest published hotel demand?" | `MUNICIPALITY` | the destination model |

An **unregistered** shape returns `abstain(UNREGISTERED_SHAPE)` — it is refused, not
approximated. A registered shape whose model was not wired in (its artifact did not
load) abstains with `NO_EVIDENCE_FOR_SCOPE`; it never crashes.

---

## 3. Resolution order

`query(shape, params)` follows one fixed order, enforced by the registry rather than
by the individual resolver:

```
question
  → shape validation             (unregistered → abstain(UNREGISTERED_SHAPE))
  → prohibition screen           (a §4-prohibited intent is refused before any lookup)
  → scope resolution             (ambiguous → abstain(AMBIGUOUS_SCOPE))
  → the applicable evidence ceiling is enforced
  → the existing deterministic model / artifact lookup runs
  → the result is returned WITH its provenance attached
  → abstention if any step is unsupported
```

No cross-scope arithmetic is performed without an explicitly registered, documented
basis (`crossScopeArithmeticAllowed` in `js/evidence-scope.js`); geometric overlap is
not a basis.

---

## 4. The abstention vocabulary (closed)

`abstain(reason, detail?)` is a first-class, frozen return value — never an
exception, never a zero, never a nearest match. The reason is one of exactly eight:

| Reason | Reached when |
|---|---|
| `UNREGISTERED_SHAPE` | The shape is not in the closed set (or the classifier matched nothing). |
| `AMBIGUOUS_SCOPE` | The scope could not be resolved to exactly one object (no code, no point). |
| `NO_EVIDENCE_FOR_SCOPE` | The scope resolved but the source holds no evidence for it (no ámbito at the point; a known code whose field is blank — *missing is not zero*; a model not wired in). |
| `CROSS_SCOPE_WITHOUT_BASIS` | Two different-scope values were asked to be combined without a documented basis. |
| `OUTSIDE_SOURCE_UNIVERSE` | The object is outside the source's universe (unknown source id, unknown ámbito code, point outside the municipality). |
| `OUTSIDE_TEMPORAL_COVERAGE` | The requested period is outside the source's coverage. **Not** snapped to a nearest match. |
| `WITHHELD_BY_PUBLISHER` | The publisher declared the value withheld (`source_state`), or the model withheld a comparison. The provenance of a withheld source is still disclosable. |
| `CEILING_PROHIBITS` | The interpretation ceiling forbids the **kind** of claim (dwelling count, apportionment, completion/projection, ranking, causal, legal). The specific §4 clause is named in the abstention's `prohibition` field. |

Every reason is independently reachable and is demonstrated by a test in
`tests/evidence_registry.test.mjs`.

---

## 5. The prohibition layer (§4, enforced structurally)

Eight prohibitions are enforced by code paths a caller cannot bypass. Each refusal
names its clause in the abstention's `prohibition` field.

| # | Prohibition clause | Reason returned |
|---|---|---|
| 1 | `UNTRACEABLE_TOKEN` — a factual token with no registered source | blank identity refused at `makeEvidence`; public identity authenticated by `sourceProvenance` |
| 2 | `CROSS_SCOPE_COMBINATION` — combine scopes without a documented basis | `CROSS_SCOPE_WITHOUT_BASIS` |
| 3 | `WHOLE_TO_PART_APPORTIONMENT` — apportion a whole-object quantity to a part | `CEILING_PROHIBITS` |
| 4 | `DWELLING_COUNT` — any dwelling or protected-dwelling count | `CEILING_PROHIBITS` |
| 5 | `COMPLETION_OR_PROJECTION` — a completion date, timeline or projection | `CEILING_PROHIBITS` |
| 6 | `RANKING_OR_RECOMMENDATION` — a ranking, score, ordering or recommendation | `CEILING_PROHIBITS` |
| 7 | `CAUSAL_CLAIM` — a causal claim | `CEILING_PROHIBITS` |
| 8 | `LEGAL_INTERPRETATION` — a legal or regulatory interpretation | `CEILING_PROHIBITS` |

A `query` whose parameters declare a prohibited intent (for example a flag asking
for a dwelling count, a ranking or a completion date) is refused **before** any
resolver runs, so no resolver can be coaxed into a prohibited claim by a crafted
parameter. A dwelling-count request is always `abstain(CEILING_PROHIBITS)` with
`prohibition = DWELLING_COUNT`.

---

## 6. The classifier seam

```
classifyIntent(text) → { shape, confidence } | abstain(UNREGISTERED_SHAPE)
```

`classifyIntent` is a deterministic keyword-and-pattern matcher. It returns a
**registered shape name** and a fixed confidence mark, or it abstains. It never
returns factual content, a value, a date or a scope. It cannot select a shape
outside the closed set — there is no entry for one — so it can never route to a
prohibited operation.

This is the single seam where a language model could later sit. Its interface is
defined so that swapping it changes nothing downstream: the model would return a
shape name and nothing else, and every subsequent step would remain deterministic.
A test asserts the classifier's output is consumed **only** as a shape selector and
never as answer content — two differently-worded questions that select the same
shape yield identical evidence, because the answer comes from the resolver, not from
the words.

The same text always yields the same shape. There is no network, no key, no request
string, and no learned weights — only the fixed patterns, matched in a fixed order,
with Spanish and English keywords routing to the same shape.

---

## 7. Immediate non-assistant consumers

The layer is exercised by shipping surfaces, not left on paper:

- **The evidence drawer** (`js/scope-rail.js`, #66) builds each source's
  provenance **through** `evidence-registry.sourceProvenance()` — the single
  SOURCE_PROVENANCE assembly — instead of hand-assembling the same fields. A
  refactor-equivalence test asserts the rendered content is byte-identical, because
  the resolver reads the same registry entry the drawer used to read directly.
- **The export bundle** (`js/evidence-export.js`, #73) resolves every contributing
  source **through** the same SOURCE_PROVENANCE resolver as the single gatekeeper;
  `sources.json` still emits the documented export fields verbatim, so the bundle is
  unchanged.

`sourceProvenance` may substitute a reference date only for the registered K7
oldest-contributing-edition disclosure. A merely well-formed ISO date is not
enough: it must equal the `planning_ambito_state.change_detection` date committed
in the registry. Other sources, unknown identities and caller-selected dates
cannot acquire publisher provenance through this path.

---

## 8. Gate §15.5 worked examples

Each worked example from the gate brief, and the behaviour this contract requires.
These run as integration tests against the committed artifacts.

| Question | Shape(s) | Required behaviour |
|---|---|---|
| "What is being developed near Valdecarros?" | `AMBITOS_IN_LENS` | Resolve to `LENS_INTERSECT_AMBITO`; list the ámbitos touched (membership only); **no apportioned quantity** (`quantitiesProvided: false`). Read each ámbito's phases at ámbito scope via `AMBITO_PHASES`. |
| "What planning stage is this area in?" | `AMBITO_PHASES` | Return the four published states verbatim (`No Necesita` preserved); provenance carries the edition and `source_state`. A known code with no published state abstains `NO_EVIDENCE_FOR_SCOPE` — never a zero. |
| "What changed here since the previous official snapshot?" | `AMBITO_EDITION_DIFF` | Classify the two-edition difference; **never** call it progress. The code must exist in the union of the two committed edition universes; this preserves real appearances/disappearances and rejects unknown codes. If that universe is unavailable, abstain. |
| "Show urban licences granted within 500 m during the last year." | `LICENCES_IN_LENS` | In-circle filter by family and grant-date window; per-family counts only, never one collapsed total; a window outside the register abstains `OUTSIDE_TEMPORAL_COVERAGE`, never a nearest match. |
| "Compare these two development areas." | `AMBITO_COMPARE` | Same-scope selectors only. Each side supplies an exact official code and optional registered S1/S2 snapshot identities; the adapter resolves the values from committed evidence. Caller-supplied values and stale identities are refused. Cross-edition withholding remains the #72 model's rule. |
| "How many homes will be built at Valdecarros?" | any ámbito shape with `wantsDwellingCount` | **Abstain** `CEILING_PROHIBITS` (`prohibition = DWELLING_COUNT`). No audited machine-readable official source publishes dwelling counts; remaining buildability is in m² only. |

---

## 9. What this layer does not do (non-goals)

No LLM, no model call, no API key, no network request, no prompt, no token. No
assistant UI — no chat, no input box, no conversational surface, no "Ask Madrid". No
natural-language generation. No question shape not already backed by a shipped
artifact. No vector store, no embeddings, no retrieval index. No telemetry, no
question logging. No new dependency. No change to any analytical semantics.
