# Product semantics

The binding vocabulary for the **Madrid Urban Evidence Lens**. It is written
once, here, so that the issues that follow Gate K (#64 onward) share one set of
words for *evidence object*, *scope*, *edition*, *reading*, *interpretation
ceiling*, *ámbito* and *instrument* rather than inventing one each.

This document defines meaning and boundary only. It implements nothing: the
scope enumeration is #64's, the mode system is #66's, and the first planning
evidence is gated behind Gate L.

## 1. What the product is

A citizen-first, professionally defensible geospatial workspace for reading what
official sources **document** about urban development in Madrid: which area a
place belongs to, what official sources record about it, how it compares with
another place at a window the reader controls, which source supports each
statement, and what that evidence does **not** permit.

Tourism is a **retained evidence domain**. It is no longer the organising frame.

The product is deliberately **not**:

- a generic urban-intelligence platform;
- a Smart City dashboard;
- a planning recommendation engine;
- a legal adviser;
- a real-time system;
- a Digital Twin;
- a prediction platform.

The word **evidence** is preferred over **intelligence** wherever the latter
could be read as inference. The system makes official records legible; it does
not infer, score, rank or recommend. (Gate K §16.1: *prefer "urban evidence
lens", which is what it is*.)

## 2. Audience contract

The semantics must support two readings of the **same** evidence, never two
evidence models:

| Reading | Reader | What they arrive with |
|---|---|---|
| **Primary interaction** | A Madrid resident or local stakeholder | A place, and a question about what it is and what is coming |
| **Secondary verification** | A planner, researcher or analyst | An identifier, a boundary or a comparison, and the need to check the source, unit, geometry and date |

A citizen reading **may omit detail**. It may **never create a different
claim**. The product does not simplify by changing a fact, a unit, a state or a
scope; it simplifies only by choosing what to foreground. This is the
single-interpretation invariant the comparison surfaces already enforce, raised
to a product-level rule.

## 3. Vocabulary

Each term is defined once and cites an existing file in this repository that
already exhibits the concept. Where a term names something not yet implemented
(the unified evidence object, the citizen/analyst projection, the ámbito), the
citation is the nearest existing instance of the discipline, and the gap to
implementation is stated rather than hidden.

### Evidence object

A **frozen analytical object** carrying a value together with its interpretation
constraints: *value + scope + freshness + unit + interpretation ceiling*. It is
not a UI card. The card is a *reading* of it (below). An evidence object is
immutable once produced, so the same inputs always yield the same object and the
same object is safe to compare, freeze as a baseline, or project to either
audience.

*Citation.* The discipline already exists as the repository's pure-model
convention: `js/area-profile.js` takes a coordinate's official containment plus
canonical barrio figures and returns a deterministic view-model that carries the
value (residents, licensed VUT), its scope caveat, its reference date and unit,
with "no interpolation, no share-of-barrio weighting" enforced in the module
itself; `js/destination-context.js` does the same for citywide hotel demand. K1
only *names* the object; its unified typed form is formalized by #64 (scope
enum) and the #64/K2 evidence-registry work, not here.

### Scope

The **geometry a value describes** — and therefore the geometry a value must not
be read as describing. A resident count whose scope is a whole barrio is not a
statement about a lens circle that happens to sit inside that barrio. Scope is
the property that makes apportionment (§6) a detectable error rather than a
judgement call.

*Citation.* `js/area-profile.js` exports
`SCOPE_CAVEAT = "Whole official barrio — not the Lens circle."` and the module's
header comment states that the statistic "belongs to the WHOLE official barrio"
and that the module "never mixes the two". The enumerated set of scope values
(e.g. `PLANNING_AMBITO`, `LENS_CIRCLE`, `MUNICIPALITY`) is **#64's** work and is
not defined here.

### Edition

**One dated publication of a source.** An edition is a publisher state at a
point in time; it is **not** a retrieval. Re-fetching the same publication does
not create a new edition, and the moment a file was downloaded is not the date
the publisher stands behind. Distinguishing the two is what lets "what changed
since the previous official snapshot" mean a change in the *published record*
rather than a change in *when we looked*.

*Citation.* `data/source_registry.json` already separates the two in prose: the
`source_period_semantics` field records, for the register layers, "state of the
municipal register **at the moment of retrieval** … no period field is
published", and the licensed-VUT source reports an HTTP `Last-Modified` **source
file state** that `docs/CLAIMS_AND_LIMITATIONS.md` forbids presenting as a
reference date. The uniform freshness quadruple that will make editions
first-class is **K2's** (#64) contract, not this document's.

### Reading

A **presentation (projection) of one evidence object** for one audience — the
citizen reading or the analyst reading. A reading chooses what to foreground and
in what language; it does not hold its own facts. The citizen and analyst
readings of one object are **not separate truths**: they resolve to the same
value, scope, unit, date and ceiling.

*Citation.* `js/area-profile.js` already produces, from a single model, both a
plain-language headline ("the Lens centre is in barrio X; barrio X has Y
registered residents at reference date P") and the exact provenance, scope and
date a verifier needs — one object, two projections. Gate K §9.2 ("two readings,
one evidence object") specifies this; the explicit citizen/analyst mode system
that renders it is **#66's** work.

### Interpretation ceiling

A **structural limit on what a value may be used to claim** — not merely a
disclaimer appended to a figure, but a property of the evidence that travels
with it and is visible at every breakpoint. A ceiling says what the number is
*not*: a licence count is not a count of operating dwellings; a hotel-demand
series is not total tourism demand.

*Citation.* `data/source_registry.json` carries an `interpretation_ceiling`
string on every source (e.g. museums: "a count of register entries, not a
measure of cultural provision, visitor numbers or attractiveness"), and
`docs/CLAIMS_AND_LIMITATIONS.md` elaborates each into a methodological rule. The
ceiling is already per-value; Gate K requires it never be the first thing hidden
on a small screen.

### Ámbito

An **official Madrid planning area** — the unit in which the municipal plan
records development stage and remaining buildability. Its official code families
are preserved verbatim and never translated or normalized away:

`APE.*`, `API.*`, `APR.*`, `UZP*`, `UZI*`, `AOE*`, `AE.*`, `UNP*`.

*Citation.* Gate K §5–§6 audits the source
(`AMBITOS_PLANEAMIENTO_URBANISTICO`, 765 polygons, code + denomination) and
records its four published development phases. **No ámbito layer is shipped
today**; this entry reserves the word and its code families for #64 (K2), Gate L
(#65) and K6 (#68), which will implement them.

### Instrument

The **planning modification or act** that can create or alter an ámbito — a
*Modificación Puntual del Plan General* (MPG) or equivalent. The distinction
matters because an instrument is an administrative event:

> administrative modification ≠ physical urban development.

A new or modified ámbito in a later edition may record an instrument, not a
building.

*Citation.* Gate K §21.1 quotes the ámbito files' own free-text notes —
`ÁMBITO DE NUEVA CREACIÓN POR LA MPG.xx.xxx`,
`AMBITO MODIFICADO POR LA MPG.09.316`, `SE CAMBIA DE SITUACIÓN CON FECHA
19/07/13` — as the evidence that edition-to-edition difference can be
instrument-driven re-identification rather than development. Resolving which is
which is Gate L's (#65/K3) measurement; no change language is authorized until
it does.

## 4. Product boundary (binding)

The following table is copied **verbatim** from Gate K §3.3. It is the binding
scope limit of the product. Changing it requires a new gate, not an edit here.

| Status | Domain |
|---|---|
| **Organising domain** | Urban development evidence: planning ámbitos, development stage, buildability, planning instruments, urban licences, public works |
| **Retained documented domains** | Resident register, hospitality & commercial premises, licensed VUT, hotel demand and origins, observed pedestrian activity, bounded thermal research — each keeps its existing scope and ceiling, none is promoted to a pillar |
| **Frozen, not extended** | Mobility (the existing node layers stay as they are; no mobility analytics), urban climate (HATI stays a bounded research opt-in) |
| **Out of boundary** | Air quality, noise, waste, lighting, crime, education, health, elections, budget execution, traffic counts, anything requiring a new domain vocabulary |

## 5. Change-language guardrail

Gate K's biggest remaining uncertainty (§21.1) is whether the four published
phase states are stable enough, edition to edition, to support honest change
detection — or whether most apparent change is instrument-driven
re-identification. Edition-to-edition differences may therefore reflect a phase
transition, the **creation** of a new ámbito, a **modification** by a planning
instrument, a **re-identification**, a **disappearance** from an edition, or
another administrative change.

Until Gate L (#65) resolves identity stability, the product must **not** promise:

- "urban development progress";
- "how construction progressed";
- "what physically changed";

or any equivalent. The safe product-level formulation is:

> **what official editions document and, where methodologically supported, how
> those documented states differ.**

Any stronger change semantics belong to #65 (Gate L) and #69 (K7), not to K1 and
not to any surface that ships before Gate L closes.

## 6. Source-licence discipline (permanent)

**Public accessibility is not equivalent to established reuse authority.** A
dataset being reachable — including the `sigma.madrid.es` ArcGIS REST planning
geometry identified in Gate K §6.2 — grants it no licence and no place in this
product. Nothing in this document, or in the product wording it governs, confers
an implied licence on any such source. The source and reuse decision is **Gate
L's** (#65) to make; this is the Gate A precedent restated as a permanent
principle.

## 7. Navigation status (documentation only)

**Resolved by K4 (#66).** Historical record: the header carried three nav
buttons, `Explore`, `Compare`, `Evidence`. As of K1 the
**`Explore` button is inert** — it was marked active in the markup but wired to no
handler (K1 touched no markup and no handler). K4 deleted it. `Compare` and `Evidence` were not
modes either: one toggled Lens B, the other enabled the HATI layer and flew the
camera.

The three-mode information architecture that replaces this nav —
**PLACE / COMPARE / CITY**, derived from the user questions rather than from
dataset families — now exists as explicit application state (`js/modes.js`), and no
mode button performs a camera, dataset or layer action. The HATI framing action
moved to the HATI layer control. `EXPLORE`, `PLANNING`, `EVIDENCE` and `CHANGE`
were all rejected as modes (not a user intent; a dataset name; a camera action
whose word is now the evidence drawer; and a time control inside PLACE/CITY
respectively). See [Information architecture V2](INFORMATION_ARCHITECTURE_V2.md).

## 8. Relationship to the boundary issues

| Owned here (K1) | Deferred, with owner |
|---|---|
| The seven terms and their meaning | Scope **enumeration** → #64 (K2) |
| The §3.3 boundary table as binding | Source/reuse authority → #65 (Gate L / K3) |
| The change-language guardrail | Ámbito **evidence layer** → #68 (K6) |
| The source-licence principle | **Mode system** (PLACE/COMPARE/CITY) → #66 (K4) |
| Recording the inert `Explore` nav | Edition **change detection** → #69 (K7) |

K1 adds no dataset, no source-registry entry, no production JavaScript, no CSS
and no dependency. It changes product wording and this vocabulary only.
