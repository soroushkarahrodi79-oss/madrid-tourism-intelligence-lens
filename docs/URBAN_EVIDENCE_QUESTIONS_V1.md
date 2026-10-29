# Urban evidence questions V1 (M2)

A closed menu of six questions over the **existing Evidence Registry (K13)**, so a
resident, a planner or a researcher can ask what the official evidence says about a
place — and be told, in the same place, where it comes from, what it cannot show,
and when it says nothing at all.

This document records what the feature **is**, what it deliberately **is not**, and
the evidence behind each decision. The contracts it defers to are
[`EVIDENCE_REGISTRY_QUERY_CONTRACT.md`](EVIDENCE_REGISTRY_QUERY_CONTRACT.md),
[`GATE_K_URBAN_DECISION_WORKSPACE.md`](GATE_K_URBAN_DECISION_WORKSPACE.md),
[`UNIFIED_GEOGRAPHIC_SEARCH_V1.md`](UNIFIED_GEOGRAPHIC_SEARCH_V1.md) and
[`PRODUCT_SEMANTICS.md`](PRODUCT_SEMANTICS.md).

> **There is no AI in this feature.** No language model, no API key, no network call,
> no embedding, no free-text input, no storage and no generated prose about the world.
> Every factual token on an answer is copied from a registry result. §9 states the one
> seam where a model could later sit and everything it would not be allowed to touch.

## 1. Verified preflight inventory

Baseline: `origin/main` @ `1c685bd` (PR #142 merged; #141 and #140 present). Working
tree clean. `node --test`: **1,152 / 1,152 pass** before any change.

### 1.1 What can be queried

The registry registers ten shapes (`js/evidence-registry.js`, closed set):
`AMBITO_AT_POINT`, `AMBITO_PHASES`, `AMBITO_BUILDABILITY`, `AMBITOS_IN_LENS`,
`AMBITO_EDITION_DIFF`, `LICENCES_IN_LENS`, `AMBITO_COMPARE`, `SOURCE_PROVENANCE`,
`AREA_PROFILE_AT_POINT`, `CITY_HOTEL_DEMAND`; eight abstention reasons; eight
prohibitions.

### 1.2 The finding that shaped the milestone

**The public application never instantiated the registry.** `createEvidenceRegistry`
was exercised only by `tests/evidence_registry.test.mjs`. The shipped app used one
function of the module — `sourceProvenance`, through the Evidence & limits drawer
and the export bundle. The query layer was real, tested and unused. M2 therefore
builds the integration path before any interface, and the integration is the point.

### 1.3 Integration path, shape by shape

"Executable" means the dependency the resolver needs is **already held by the
running page** (or is fetched by an existing lazy loader) and the integration was
exercised in a real browser.

| Shape | Dependency | In the live page | Verdict for V1 |
|---|---|---|---|
| `AMBITO_AT_POINT` | planning index | loaded at start | **exposed** |
| `AMBITO_PHASES` | planning index | loaded at start | **exposed** |
| `AMBITO_EDITION_DIFF` | K7 change module + `change_detection` + edition-code universe (`ambito-comparison-adapter.js`) | module and pair at start; adapter on first use (`ensureAmbitoAdapter`) | **exposed** |
| `AMBITOS_IN_LENS` | planning index | loaded at start | **exposed** |
| `LICENCES_IN_LENS` | licence index | **lazy**, 5.2 MB, on first need (`loadLicenceContext`) | **exposed**, with an explicit loading state |
| `SOURCE_PROVENANCE` | registry JSON | loaded at start | **exposed** |
| `AMBITO_BUILDABILITY` | planning index | loaded at start | not exposed — the PLACE planning block and the planning explorer already show the same m² rows |
| `AMBITO_COMPARE` | comparison model + canonical resolver | built by the COMPARE mode on its own path, not through the registry | not exposed — duplicates COMPARE mode; the registry path was not demonstrated in the live page |
| `AREA_PROFILE_AT_POINT` | area-profile builder over lazily loaded geography and population | built per Lens by the app, not through the registry | not exposed — duplicates the Administrative area card |
| `CITY_HOTEL_DEMAND` | destination model | built by the CITY surface, not through the registry | not exposed — duplicates CITY mode |

The three non-exposed shapes with no live integration are still evaluated against
the real artifacts at registry level (§11), so the decision not to expose them is
recorded with evidence and can be revisited.

### 1.4 Who each question serves

| Question | Resident | Planner | Researcher | Public-sector support |
|---|---|---|---|---|
| Which ámbito contains the Lens centre? | “is my street inside a development area?” | orientation | reproducible spatial lookup | scope recognition |
| What does the source publish about its development state? | the four published fields, in plain words | exact verbatim phase strings and their source columns | edition date and field vocabulary | defensible citation |
| What changed between the two editions? | “did the published status move?” | per-family outcome and the values that differ | the K7 outcome vocabulary, unchanged | audit of a status change |
| Which ámbitos does the Lens circle touch? | “what is near here?” | membership without quantity | — | catchment orientation |
| Which licences were granted inside the Lens? | counts by kind, with what a grant is not | per-family counts, window, unlocated rows | coverage statement and ceiling | — |
| Which source supports the latest answer? | who published it and when | five freshness fields, authority, URL | verbatim ceiling | provenance for a report |

### 1.5 What would have duplicated an existing surface

A second place search; a PLACE-mode planning panel; a COMPARE-mode comparison; a
CITY-mode hotel card; a chat input. None was built. The explorer adds **no header
control, no panel, no analysis-panel height and no input field**.

### 1.6 Scientific limits, per query

Stated on every answer (§5) and asserted by tests: see the `limits` block of each
question in `js/question-explorer.js` and §7.

## 2. The journey

> Find a place → select a question → resolve evidence → interpret the result →
> verify the source.

1. **Find a place** with the M1 finder (unchanged). Typing moves nothing.
2. **Select a question.** The *Explore questions* section sits at the foot of the
   finder panel. Each question names its subject before it is asked (*Lens centre*,
   *Planning ámbito*, *Lens circle*, *Lens circle · licence dates*, *Latest answer*).
3. **Resolve.** The registry is queried with parameters built from an explicit
   context (§3). Nothing else is consulted.
4. **Interpret.** The answer card: question · result · scope · evidence · what this
   cannot show · verification, in a citizen or analyst reading.
5. **Verify.** *Open Evidence & limits* opens the existing drawer on the answer's
   scope; *Which source supports this?* runs `SOURCE_PROVENANCE` for the answer's
   source and shows all five freshness fields and the verbatim ceiling.

Opening the finder is the entry point; the finder is unchanged for anyone who never
scrolls to the questions.

## 3. Context and scope

An answer is bound to an **explicit analytical context**, read only from validated
application state:

| Part of the context | Source |
|---|---|
| active Lens (A or B), centre, radius | `centerOf(active)`, `radiusFor(active)` — Lens A and B keep independent radii |
| finder selection | `geoSearchSelectedEntry()` |
| licence grant-date window | the window the application already applied and clamped (`licenceWindow`), the same one its own controls show |
| readiness of planning, licences, editions | the loaders' own states |

Rules:

* **No silent substitution.** An ámbito-scoped question uses (1) the exact code of a
  planning ámbito selected in the finder, else (2) the ámbito the registry says
  contains the active Lens centre — and the answer **names which**. A selected
  barrio, district or municipality is never turned into an ámbito: the card says it
  was not used. If neither source establishes one ámbito, no code is passed and the
  registry itself abstains `AMBIGUOUS_SCOPE`; the reader is told how to establish a
  subject.
* **Barrio values are never Lens values.** There is no question that reads a barrio.
* **No inferred window.** The licence window is the applied one. A phrase such as
  “recently” is never converted; an unset window is declared as the model's
  documented default.
* **No camera, Lens, radius, mode or layer movement.** Asking changes none of them;
  a browser test compares the whole world before and after.

## 4. How the registry is reached

`questionRegistry()` in `js/app.js` builds `createEvidenceRegistry(deps)` from models
the page already holds and rebuilds it only when one of them is replaced. A model
that is not loaded is passed as absent, so its shape abstains **by itself** with
`NO_EVIDENCE_FOR_SCOPE`; nothing is special-cased. A dependency that is merely still
arriving is **not** an abstention: the card says *loading* and never reaches the
registry. Arrival re-enters through the application's existing render path.

No spatial calculation, phase rule, edition comparison or licence aggregation was
reimplemented. `askQuestion` returns the registry's frozen result untouched; a test
asserts `outcome.result` deep-equals a direct `registry.query(shape, params)`.

## 5. The answer

Every factual answer preserves the registry's seven fields: **value, scope, unit,
sourceId, freshness (all five), ceiling, derivation**. The card shows:

| Block | Content |
|---|---|
| Question | the selected wording |
| Result | a one-line headline and the facts, copied from the resolver; official strings are `data-verbatim` and are never translated |
| Scope | the analytical scope, and the instance it was computed for (e.g. *Lens A · 900 m · centre 40.40095, −3.71463*) |
| Evidence | source name, reference date (or **“not declared by the publisher”**), how the value was obtained; *Source record* discloses all five freshness fields and the ceiling verbatim |
| What this cannot show | fixed, per-question limits |
| Verification | the existing drawer; the provenance question |

**Citizen and analyst readings use the drawer's own preference** (`shell.reading`,
one preference, one URL parameter). They carry the same facts, scope, evidence and
limits; the analyst reading adds the shape, parameters and subject trace and the
source columns. A test compares them for every answered question in both languages.

Dates are shown as the registry states them. The committed geometry and the licence
register declare **no reference date**; the card says so instead of showing a blank
or borrowing one.

## 6. Abstention is a result

All eight registry reasons are shown with their **machine-readable identity**, a
plain explanation in both languages and, for a prohibition, the clause. The
registry's own message is kept, verbatim, behind a disclosure. An abstention carries
no figure; it is drawn with a dashed border and a text status, never as an error.

| Reason | Reached in the interface by |
|---|---|
| `UNREGISTERED_SHAPE` | the *tourist pressure* ask |
| `AMBIGUOUS_SCOPE` | an ámbito question with no ámbito established; *which source* before any answer |
| `NO_EVIDENCE_FOR_SCOPE` | a Lens centre outside every ámbito; an ámbito with no published state; a model that is not loaded |
| `OUTSIDE_SOURCE_UNIVERSE` | an ámbito the boundary file holds but the dated editions do not list |
| `OUTSIDE_TEMPORAL_COVERAGE` | a licence window wholly outside the register (unreachable from the controls, which clamp; asserted at registry level) |
| `WITHHELD_BY_PUBLISHER` | a source declared withheld (asserted with a derived registry) |
| `CEILING_PROHIBITS` | the refused asks |
| `CROSS_SCOPE_WITHOUT_BASIS` | not reachable from the six questions (it belongs to `AMBITO_COMPARE`); asserted at registry level |

The last four rows are stated honestly: the interface has no path that produces them
except the registry-level fixtures, and the tests say so.

## 7. Prohibited claims

There is no free-text input, so there is no way to *type* a prohibited claim. The
boundary is shown instead: a collapsed section, *What this tool will not answer*,
lists seven asks — dwelling count, completion date, ranking, cause, legal
interpretation, share of an ámbito inside the Lens, tourist pressure. Activating one
sends it to the **real registry**, which refuses it before any resolver runs; the
card shows the refusal and the named clause. The screen refuses nothing itself.

The answers themselves state, and tests assert: the four published phase fields are
independent and form no stage; a difference between editions is not progress and not
explained; a granted licence is not proof of construction; counts are per family and
never summed; no area, share or quantity of an ámbito is attributed to the Lens.

## 8. An answer is never current for a context it was not computed for

Each outcome records the context key it was computed for (Lens A/B, centre, radius,
selection, window, readiness). The application calls `notify()` from the existing
render path on every change that could alter it. When the key differs the card is
marked **out of date in the same task as the change** (`data-stale`, `aria-busy`, a
visible banner and badge) and a coalesced recompute follows 140 ms after the context
settles. A real-browser test samples every animation frame of a real marker drag and
asserts that whenever the card does not claim to be out of date, its key equals the
key of the Lens on screen.

* A held answer keeps describing **its own** Lens, not the one now active.
* A change made while the finder is closed is noticed on reopening.
* A *loading* card is never shown as out of date.
* The question itself is **not** part of the shared URL. A reloaded link restores the
  Lens and shows **no** answer; the reader asks again. This is a limitation, chosen
  over extending the versioned K11 state.

## 9. Preparing for GeoAI, without AI

The future route:

```
user language → validated question shape → deterministic resolver → verified result → grounded presentation
```

The only seam is **choosing one of the six `QUESTIONS`** (or none) from the user's
words — the registry's `classifyIntent` seam. A model there would return an id from
a closed list and nothing else. It would never see or produce a value, a scope, a
date, a code or a sentence about the world; everything from `askQuestion` to
`presentOutcome` is unchanged and would stay so.

M2 adds nothing for that future: no scaffolding, no dependency, no endpoint, no
prompt. A test greps both new modules for `fetch`, `XMLHttpRequest`, `WebSocket`,
`sendBeacon`, storage, `api key`, model/vendor names, `<input>`, `innerHTML`,
`Math.random` and clocks. The feature has full value without a model.

## 10. Layout decision

Alternatives considered against the real interface:

| Option | Rejected because |
|---|---|
| New header control | the header is a measured, tested 320 px layout; a sixth control costs it |
| A section in the PLACE analysis panel | that panel is already the longest scroll in the product, and it is the surface the questions would duplicate |
| A floating chat-like panel | the brief forbids it, and it would compete with the finder |
| **A section at the foot of the finder panel** | the finder is already the place-finding surface, already measured against the rail and the analysis panel, already an overlay with an Escape contract; the questions inherit all of it |

Consequences, each tested: the finder panel is taller when a question is answered, so
its height is capped to **leave the map attribution uncovered** and it scrolls
internally; in the desktop corridor it now also starts **clear of the zoom control**,
which the M1 panel covered (a pre-existing M1 occlusion, fixed here because the brief
forbids obstructing map controls). On a phone the finder is, as before, a transient
overlay dismissed with Escape or its close control.

## 11. Validation

`tests/question_explorer.test.mjs` — the evaluation set, against the committed
artifacts, wired as the app wires them. Every case also compares the outcome with a
**direct registry call**.

| # | Case | Result asserted |
|---|---|---|
| E01 | valid planning point | `APR.02.09`, `POINT_IN_POLYGON`, source `planning_ambito_geometry` |
| E02 | point outside every ámbito | `NO_EVIDENCE_FOR_SCOPE`, no fact |
| E03 | exact official code | four phases equal `developmentState(code)` verbatim |
| E04a | known ámbito, no published state | `NO_EVIDENCE_FOR_SCOPE`, never a zero |
| E04b | a blanked phase and surface cell (derived fixture; no committed record has one) | “not published” in both languages, never blank or 0 |
| E05 | registered edition comparison | equals `buildAmbitoComparison`; both dates; never “progress”; a one-edition code is kept |
| E06 | invalid identity | unknown code → `OUTSIDE_SOURCE_UNIVERSE`; stale edition → `OUTSIDE_TEMPORAL_COVERAGE` (registry level) |
| E07 | current active Lens | equals `ambitosIntersecting`; no area, share or quantity |
| E08 | unequal radii A/B | each answers for its own centre and radius; a held answer keeps its Lens |
| E09 | no licence records | `NO_MATCHES` statement with the unlocated rows disclosed |
| E10 | licence window | malformed → `AMBIGUOUS_SCOPE`; outside → `OUTSIDE_TEMPORAL_COVERAGE`; partly outside → clamped and said so |
| E11 | dwelling count | `CEILING_PROHIBITS` / `DWELLING_COUNT` |
| E12 | legal interpretation | `LEGAL_INTERPRETATION` |
| E13 | ambiguous scope | `AMBIGUOUS_SCOPE`; a barrio selection reported as not used |
| E14 | missing runtime dependency | registry abstains; a loading dependency never reaches it |
| E15 | unavailable / withheld source | `OUTSIDE_SOURCE_UNIVERSE`; `WITHHELD_BY_PUBLISHER`, provenance still disclosable |
| E16 | CITY municipality evidence | resolves at registry level; deliberately not exposed |

Plus: the catalogue is exactly six registered shapes; all eight reasons present in
EN and ES in both readings; every refused ask refused by the real registry with its
clause; every verbatim fact exists in the resolver output; all seven contract fields
present; citizen/analyst/EN/ES parity; the context key changes with every part of the
context and with nothing else; no model/network/storage/free-text path.

Mutation checks (run once, reverted): removing the registry window guard fails E10;
upper-casing a phase value in the presenter fails E03 and the verbatim-trace test.

`browser-tests/question-explorer.browser.mjs` — real Chromium: wiring, load
deferral, the journey, subject naming, no-movement, stale marking (radius, real drag,
A/B switch, licence window, closed finder), rapid switching, repeated activation,
language and reading, refused asks, failed licence / registry / planning artifacts,
shared-link reload, keyboard operation, five viewports, corridor clearance, Light and
Dark contrast, Spanish coverage.

## 12. Findings from the audit (all corrected)

| # | Finding | Fix |
|---|---|---|
| F1 | `LICENCES_IN_LENS` read a **present-but-malformed** window (`{from: 20250101}`, `{}`, `"2025"`) as “no bound” and silently answered for the **whole register** | the resolver now abstains `AMBIGUOUS_SCOPE`; an absent window keeps its documented, disclosed default; registry and explorer tests |
| F2 | a licence-window **restore from a shared link** changed `licenceWindow` without any notification, which would leave an answered licence question showing the old window as current | `renderUrbanLicences` — the one exit of every window change — now notifies |
| F3 | Escape from a control inside the explorer did nothing (the M1 Escape contract covered only the field and the result list) | Escape inside the explorer dismisses the finder |
| F4 | an open finder in the desktop corridor covered the zoom control (pre-existing in M1) and, once an answer made it tall, the map attribution | corridor starts clear of the zoom control; panel height leaves the attribution clear |
| F5 | rebuilding the card on a language/reading/recompute change would drop open disclosures and keyboard focus | both are captured and restored |
| F6 | a “loading” card that later received its data would flash as out of date | a loading outcome is recomputed directly, never staled |

## 13. Measured cost

**Initial payload** (threshold carried over from M1: ≤ 25 KB raw critical path, code
only; the M1 exception is not reused). Measured against `origin/main` @ `1c685bd`:

| | raw | gzip -9 |
|---|---|---|
| `index.html` | +88 B | +30 B |
| `css/app.css` | +6,335 B | +944 B |
| `js/app.js` | +7,489 B | +2,039 B |
| `js/evidence-registry.js` (window guard) | +1,281 B | +474 B |
| `js/shell-copy.js` | 0 | 0 |
| **Critical path** | **+15,193 B** | **+3,487 B** |
| Deferred, fetched after `load` (`question-explorer.js` + `-view.js`) | +78,176 B | +21,577 B |

The critical path is within the 25 KB threshold, so no exception is requested. The
deferral is asserted from resource timing by a browser test.

**Runtime** (headless Chromium, software rendering, medians of 7 loads, base vs this
branch, three alternating rounds; spread between rounds is as large as any
difference and the sign flips between rounds, so no regression is claimed or
excluded beyond that):

| | base | M2 |
|---|---|---|
| DOMContentLoaded (ms) | 217 / 361 / 353 / 272 | 289 / 396 / 252 |
| data ready (ms) | 774 / 1180 / 1294 / 918 | 1141 / 1324 / 909 |
| p95 frame during a 60-step Lens drag (ms) | 167 / 200 / 200 / 183 | 183 / 200 / 200 |
| 21 radius inputs (ms) | 47 / 70 / 81 / 71 | 87 / 90 / 64 |
| geographic search, 6 keystrokes (ms) | 12.6 / 15.8 | 16.9 |

With the finder closed and no question asked, `notify()` returns after one boolean
check, so the Lens-drag and radius paths gain no measurable work.

## 14. Verification record

* `node --test`: **1,190 / 1,190** (1,152 base + 40 new), 0 failed, 0 skipped.
* Chromium, 33 browser tests in `question-explorer.browser.mjs` (1 capture test
  skipped without an output directory); all three Chromium shards, both WebKit
  UX-C1 / UX-C2 jobs and Node on Linux and Windows are green in CI on the head
  commit. The new browser file runs on Chromium only; WebKit coverage of the
  explorer is **not** claimed.
* Accessibility evidence: keyboard-only operation, `role="status"` announcement,
  44 px targets at five viewports from 320 px, 4.5:1 contrast on question, answer
  and abstention text in Light and Dark, forced-colours rule, Escape contract.
  Not validated: a screen reader, a physical device.
* Screenshots: `docs/review/m2-question-explorer/` (before = M1 finder at base;
  after = explorer at desktop, dark, tablet, phone, 320 px).

### 14.1 Release-readiness additions

* **Sharing semantics.** The drawer's *Share & export* text says it "reproduces this
  exact reading". After an M2 answer that could be read as including the question.
  Every answer card now says that *Copy shareable link* and *Export evidence*
  reproduce the Lens, radius, dates and reading and **not** the question or its
  answer. The K11 URL schema and the export model are unchanged; carrying the
  question is recorded for M3.
* **Licence dates.** The answer already stated the applied window; it now also says
  where it comes from and how to change it (switch on *Granted urban licences*, edit
  *From*/*To*) and that asking does not switch the layer on. A test asserts the
  layer stays off.
* **WebKit.** A `qx-webkit-smoke` CI job runs ten of the existing M2 browser tests
  (journey, sharing note, language, refusal, failed source, shared-link reload,
  keyboard, 390×844 and 768×1024, Spanish coverage) with `QX_BROWSER=webkit`. The
  authoring environment cannot download WebKit (network allowlist), so its result
  comes from CI only. Emulated viewports are not physical-device validation.

## 15. Known limitations

1. The question is not in the shared URL (§8). The Lens, radii, mode and reading are
   restored; the answer is not.
2. The licence question loads a **5.2 MB** register the first time it is asked if the
   licence layer was never enabled; the card says so while it loads.
3. The licence window is changed in the existing *Granted urban licences* controls,
   which are visible only when that layer is on. The answer says where the dates come
   from.
4. Four of the eight abstention reasons are not reachable by clicking; they are
   asserted at registry level (§6).
5. Edition comparison reasons from the K7 model are English model text; they are
   shown with `lang="en"` and flagged, not translated.
6. The question card is not part of the evidence export in V1.
7. The explorer's own browser tests run on Chromium only (WebKit could not be
   installed in the authoring environment, and the CI job for WebKit covers other
   suites).
8. No physical-device validation; all responsive evidence is browser emulation.

## 16. Deferred

Natural-language question routing (§9); exposing `AMBITO_COMPARE`,
`AREA_PROFILE_AT_POINT`, `CITY_HOTEL_DEMAND` or `AMBITO_BUILDABILITY` only if a live
integration through the registry is demonstrated *and* the surface does not
duplicate an existing mode; putting the question in the shared URL; including the
answer in the evidence export.
