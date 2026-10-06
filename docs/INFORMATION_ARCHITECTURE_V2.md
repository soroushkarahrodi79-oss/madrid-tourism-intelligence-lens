# Information architecture V2 — modes and progressive disclosure

Status: implemented by **K4 (#66)**. This document records the reading
architecture of the panel. It changes **how existing evidence is read**; it
changes no number, state, unit, withholding rule or interpretation ceiling.

**K4 itself shipped no planning evidence** — it only created the place for it.
That place is now filled: **K6 (#68)** added the ámbito evidence object to PLACE
with no further IA rewrite, exactly as [§11](#11-where-planning-evidence-went)
anticipated. See
[Planning-ámbito evidence V1](PLANNING_AMBITO_EVIDENCE_V1.md).

Related: [Gate K](GATE_K_URBAN_DECISION_WORKSPACE.md) §9 and §12,
[Product semantics](PRODUCT_SEMANTICS.md), [Gate L](URBAN_PLANNING_SOURCE_GATE_L.md),
[Methodology](METHODOLOGY.md), `js/modes.js`, `js/scope-rail.js`,
`js/evidence-scope.js`, `js/shell-copy.js`.

## 1. Why the old navigation was not an information architecture

The header carried `Explore`, `Compare` and `Evidence`.

- `Explore` was `<button class="active">` with no `id` and no handler anywhere in
  the codebase: permanently highlighted and inert.
- `Compare` toggled Lens B. That is a feature switch, not a reading intent.
- `Evidence` enabled the HATI layer and flew the camera to the pilot rectangle.
  That is a layer action wearing a navigation label.
- Under `max-width:850px` the whole nav was hidden, and the stylesheet also hid
  `.mix`, `.source`, `.area-source-toggle`, `.area-source-details`,
  `.hospitality-methodology-link`, `.evidence-note`, `.layer-source-note` and
  `.metric-foot`: **provenance was the first thing deleted while every number
  was kept** — the inverse of what the product claims.
- One scroll column carried eleven competing surfaces with controls interleaved
  between results (the radius slider sat between the lens metrics and the
  category mix it changes).

K4 replaces this with three real modes, a persistent scope-and-freshness rail,
one evidence drawer and a fixed reading order.

## 2. The three modes

A mode is a **user intent held as application state**, not a CSS tab and not an
`active` class. It lives in `js/modes.js` (pure: no DOM, no Leaflet, no clock) and
is testable without a browser: `currentMode()`, `setMode(mode)`,
`enterMode(mode, state)`, `subscribe(listener)`, plus `planModeTransition(from, to,
{ lensBEnabled })`, a frozen side-effect-free plan.

| Mode | Question it answers | Primary scope(s) | Owns |
|---|---|---|---|
| **PLACE** | What does the evidence say about this place? | `LENS_CIRCLE`, `OFFICIAL_BARRIO` (and, when #68 ships, `PLANNING_AMBITO`) | Lens-circle metrics, the Area Profile (barrio residents, licensed VUT), pedestrian reading, hospitality context, HATI bounded evidence, category mix, nearest |
| **COMPARE** | How do two Lens circles read against each other? | `LENS_CIRCLE` × 2 (same scope only) | Lens A/B workflow: independent radii, the radial halo, the Comparison Bridge, Decision Insight, Spatial Window Sensitivity, the comparison table |
| **CITY** | What is the municipality-wide context? | `MUNICIPALITY` | Hotel demand, Domestic Origin Context, Domestic Origin Dynamics |

**Transitions** (`planModeTransition`) request only the *existing* Lens B path:

- entering COMPARE with Lens B off → `enableLensB` (the existing activation);
- leaving COMPARE with Lens B on → `disableLensB` (the existing cleanup, which
  still clears the focused/locked halo metric);
- every other transition → nothing.

A plan never contains a Lens position or a radius (`preservesLensState: true`),
so entering COMPARE does not reset Lens A, independent radii survive every
transition, and moving a Lens never silently changes mode. If applying a plan
throws, the mode is **not** committed: state can never claim a mode whose side
effects did not happen.

**No mode button flies the camera, enables a dataset or mutates a layer.** The old
`Evidence` camera action moved to the HATI layer control
(`#hatiFrameButton` in the layer panel): it enables the layer first, then frames
the pilot rectangle, exactly as before.

### Rejected mode names

| Name | Reason |
|---|---|
| `EXPLORE` | Not a user intent — the absence of one; the old button was inert. |
| `PLANNING` | Names a dataset family, not a question the reader asks. |
| `EVIDENCE` | The word is freed for the evidence drawer; a camera action is not a mode. |
| `CHANGE` | Never a mode — always a question about something already selected, so it becomes a time control inside PLACE and CITY. |

`REJECTED_MODES` in `js/modes.js` records these as data, and a test asserts none
of them is a mode.

## 3. Panel reading order

Exactly one mode section is visible at a time. Every mode reads in the same
order:

```
[ MODE CONTROL ]                       PLACE · COMPARE · CITY   (aria-pressed / aria-current)
[ SCOPE & FRESHNESS RAIL ]             what the visible evidence describes, how old
─────────────────────────────────────
LEAD ANSWER                            one headline answer to the mode's question
SUPPORTING EVIDENCE                    at most four figures
▸ Detail            (closed)           one disclosure
▸ Evidence & limits (route)            opens the evidence drawer
─────────────────────────────────────
CONTROLS                               last, never between results
```

| | PLACE | COMPARE | CITY |
|---|---|---|---|
| **Lead** | Administrative area: the barrio the Lens centre sits in, registered residents, licensed VUT (the barrio's official figures) | Comparison Bridge (focused metric reading) | Destination context: hotel demand for the municipality |
| **Supporting (≤ 4)** | Four Lens-circle figures: Tourism POIs, Hotels & stays, Mobility nodes, Mean UTCI | Decision Insight (four canonical metrics, fixed order) | Destination metrics |
| **Detail** | Category mix, Nearest, pedestrian reading, hospitality context | Each lens's barrio, Spatial Sensitivity, comparison table, evidence line | Domestic Origins, Monthly origin dynamics (tables and sub-disclosures) |
| **Controls** | Lens A/B, radius, HATI time, reset | Lens A/B, radius, HATI time, reset, comparison halo toggle | Source-month selector |

PLACE derives its lead **from existing evidence only**. There is no placeholder
and no planning wording; nothing that resembles real planning data is rendered.

### Re-homing table

| Surface | From | To |
|---|---|---|
| Category mix, Nearest | permanent scroll column (hidden < 850px) | PLACE → Detail (visible at every width once opened) |
| Pedestrian reading, hospitality context | permanent scroll column | PLACE → Detail (a layer switched on opens it) |
| Hospitality metric selector and scale | inside the result flow | layer-scoped panel under the hospitality layer |
| HATI framing | `Evidence` nav button | HATI layer control |
| Domestic Origins, Monthly Dynamics, their tables and `<details>` | foot of the panel | CITY → Detail |
| Source-month selector | inside the origins block | CITY controls |
| Radius, HATI time, Lens A/B, reset | between metrics and category mix | the controls region, last |
| Comparison halo toggle | between sensitivity and the table | COMPARE controls |
| Long halo legend | permanent paragraph (hidden < 850px) | evidence drawer |
| Source footer paragraph | permanent paragraph (hidden < 850px) | evidence drawer |
| "Source & interpretation" toggles | inline (hidden < 850px) | still a control in the lead; opens the drawer, where the generated provenance lines now live at every breakpoint |
| HATI evidence note and layer source note | hidden < 850px / < 700px high | visible at every size in the layer panel |

No surface was removed. Surfaces moved.

## 4. The scope and freshness rail

An always-visible strip in the sticky panel head (static, still unhidden, at
≤ 850px). It states what the evidence **currently on screen** describes.

- **Entries** are derived, not hand-listed: one per *distinct analytical scope*
  among the surfaces visible in the current mode (`railModel` over
  `SURFACES` in `js/scope-rail.js`). Real scopes shipped today:
  `LENS_CIRCLE`, `OFFICIAL_BARRIO`, `MUNICIPALITY`, `POINT_OBSERVATION`,
  `BOUNDED_STUDY_AREA`. The architecture already supports `PLANNING_AMBITO` and
  the other planning scopes; **K4 invents no ámbito value**.
- **Every entry is a glyph plus a text label.** Glyphs are distinct per scope,
  `aria-hidden`, and never carry meaning alone; the state of the current mode is
  also never colour-only (filled state, rule, check glyph, `aria-pressed`).
- **Freshness** uses the K2 helpers only: `oldestReferenceDate(...)` over the
  registry sources contributing to the visible surfaces.
  - Result is the **oldest** date at its **original precision** (a month stays a
    month).
  - If **any** contributor has `reference_date: null`, the rail shows
    `Reference · not published`. It never manufactures a common date.
  - It never says "updated today": that concept does not exist in the registry.
  - The publisher's `source_state` values are listed descriptively. They are
    **never** mapped to green/yellow/red, a fresh/stale score, a grade or a
    confidence figure.
- Every entry and the freshness line open the evidence drawer (filtered to that
  scope, or to the whole mode).
- Fits 360px without horizontal scroll (entries wrap).

## 5. The evidence drawer

One reusable native `<dialog>` that replaces the scattered provenance footers,
source toggles and the long halo legend.

- **Reachable from any supported value**: the rail, a per-section ⓘ control on
  the residents/lead, the four metrics, the comparison, and the city lead, the
  Evidence & limits route in every mode, and the two "Source & interpretation"
  openers.
- **Fields per record** (from `data/source_registry.json` plus the surface table;
  no second provenance store): source name; authority; analytical scope (and,
  in the analyst reading, its definition); unit; reference date; publication
  date; retrieval date; update frequency; source state; derivation where already
  known; retrieval route (analyst); and the **interpretation ceiling verbatim**.
  A null date is stated as "not published" (or, for retrieval, "not recorded in
  the registry"), never blank and never back-filled.
- It is **not** the K13 Evidence Registry query architecture: it only formats
  existing registry metadata for the surfaces on screen.
- Also holds the generated area / destination provenance lines, the halo legend
  (COMPARE only) and the sources paragraph.
- **Behaviour**: opens by keyboard; Escape closes; focus returns to the opener
  (or the rail's freshness control if the opener was re-rendered); visible Close
  control; backdrop click closes; native modal focus containment; ≥ 44px targets
  on `pointer: coarse`; a bottom sheet on narrow screens.

## 6. Responsive priority (reversed)

| Priority | Behaviour at every breakpoint |
|---|---|
| **Never hidden** | the mode control; the rail; the lead answer; the route into Evidence & limits; source, date, unit and interpretation-ceiling access |
| **Collapses, never deletes** | supporting figures; tables; secondary detail (`<details>`) |
| **May be hidden** | decorative duplication; legend prose already available in the drawer |

The old rules that hid `.mix`, `.source`, `.area-source-toggle`,
`.area-source-details`, `.hospitality-methodology-link`, `.evidence-note`,
`.layer-source-note`, `.metric-foot` and `.activity-card-note` were removed. A
stylesheet test parses every `@media` block and fails if any hides a
provenance-bearing selector. The panel's viewport share is unchanged.

## 7. Language policy

**One active document language at a time, switched by one control**
(`#languageSelect`, in the header). **English is the default**; Spanish-first is
not required. The invariant is:

> With EN selected, all **product-authored** interface copy is English. With ES
> selected, all product-authored interface copy is Spanish. This covers visible
> labels **and** accessibility copy (`aria-label`, `aria-description`, `title`,
> live-region announcements, dialog labels, screen-reader-only text).

The switch sets `document.documentElement.lang` and there is one translation path
in three layers, none of which holds a second language state:

1. **Dictionaries through the shared `createI18n`** (`js/i18n.js`) for the
   surfaces that own their copy: the shell dictionaries in `js/shell-copy.js`
   (mode control, rail, drawer, section structure, layer-scoped controls), the
   Bridge / Decision Insight / Spatial Sensitivity dictionaries, Hospitality &
   Commercial Context and Domestic Origins / Dynamics.
2. **The product-copy catalogue** (`js/legacy-copy.js`) for the surfaces that
   predate the shared layer and build English sentences inside pure, tested model
   modules whose English output is a contract of its own: Area Profile (headline,
   scope and context prose, resident / VUT notes), Destination Context (cards,
   footnotes, states, scope notes), the four metric footers, Nearest, pedestrian
   activity, the comparison table, captions and screen-reader summaries, the map
   tooltips, the layer panel (headings, dividers, select labels and options,
   notes), the Lens and halo controls, and every loading / unavailable / empty
   state. It maps each English source phrase to its Spanish rendering (phrases
   with `{a}` placeholders are patterns; numbers, units and symbols are carried
   through untouched). English is the source text and is never altered.
3. **One applier** (`applyCopyLanguage` in `js/app.js`) is the only place the
   catalogue meets the DOM. It walks the document and observes mutations, so
   freshly rendered copy is localised too, for text **and** for
   `aria-label` / `aria-description` / `title` / `placeholder` / `alt`. Every
   translated node remembers its English source, so switching back restores it
   exactly (a browser test round-trips ES → EN).

No render function branches on the language; new surfaces read dictionary keys.

### Verbatim evidence language

The product distinguishes **UI language** from **verbatim evidence language**.

- Official / publisher values stay verbatim: barrio, district and municipality
  names, source terms, registry authority strings, registry
  `interpretation_ceiling`, `source_period_semantics` and date provenance, the
  canonical licence caveat the claims document requires verbatim, and
  publisher-defined survey definitions. They are never translated to make the
  screen look monolingual.
- Such content sits under `data-verbatim`, so the applier never touches it, and is
  annotated with its real language (`lang="en"`) where it is English prose: drawer
  ceilings, scope definitions and period semantics, and provenance lines the
  catalogue leaves alone. Sentences we author (for example "Reference date …")
  are translated and carry no English tag.
- Our own labels around such content (field names, units, derivations, registry
  *display* names) are product-authored and do localise.
- A phrase is never half-translated: a placeholder never spans a sentence break
  and a prose sentence with no catalogue entry is left whole.
- Digit grouping and decimal marks are left as published (a number's
  presentation is not rewritten by a language switch).

`en` and `es` shell dictionaries must have identical keys, every catalogue entry
has a Spanish rendering with the same placeholders, and no registry wording is
ever matched by the catalogue (all tested).

## 8. Citizen and analyst readings

Both readings are **projections of one frozen record**
(`buildEvidenceRecords` → `projectReading`). Neither recomputes.

- The citizen reading may **omit** fields (retrieval route, scope definition,
  period semantics, date provenance, observed cadence).
- It may **not** change a numeric value, reorder or merge a state, soften a
  ceiling, resolve an unresolved meaning or change a unit.
- **Both** readings carry the five freshness fields and the verbatim
  interpretation ceiling — the ceiling is never analyst-only.
- A test asserts the citizen projection is a field-subset of the analyst
  projection with identical values and identical source order.

## 9. Scope discipline

Every displayed value resolves to exactly one analytical scope through `scopeOf`
(`SURFACES` declares it; an undeclared or out-of-enum scope throws). The scope of
a displayed value is its *analytical meaning*: a count inside a Lens circle is
`LENS_CIRCLE` even though its source records are points. COMPARE operates on
`LENS_CIRCLE` readings only; a municipality or barrio figure is never arithmetic
with a Lens figure (`crossScopeArithmeticAllowed`). No existing surface lacked a
defensible scope.

## 10. Accessibility

Mode control: native buttons, keyboard-operable, `aria-pressed` and
`aria-current`, a check glyph and a rule as the non-colour cue, a polite live
region announcing mode changes. Hidden mode sections are `display:none`, so no
hidden control is tabbable. Drawer: native dialog semantics, `aria-labelledby`,
Escape, focus return, visible close. Touch: ≥ 44px on `pointer: coarse` for the
mode buttons, rail items, evidence controls, disclosures, layer action, drawer
controls and the language select.

## 11. Where planning evidence went

K4 created the place; **K6 (#68) filled it**, and the architecture held:

- PLACE's lead was produced by a lead block over existing evidence; #68 added an
  ámbito evidence object **below** it as a second lead-level object, with no
  further IA rewrite and no change to the reading order.
- `PLANNING_AMBITO` and `LENS_INTERSECT_AMBITO` already existed in the scope enum
  with glyphs and labels in both languages, and the rail derives its entries from
  the surfaces on screen — so the ámbito scope appeared in the rail by declaring
  `SURFACES` entries, and `LENS_INTERSECT_AMBITO` appears only while the Lens∩ámbito
  membership surface is actually open.
- The evidence drawer needed no second provenance store: the two planning sources
  were registered in `data/source_registry.json` and the existing registry-driven
  drawer renders their full provenance and verbatim ceilings in both readings.
- Nothing encodes an assumption Gate L rejected: no scalar planning stage, no
  "progress" direction, no dwelling counts, no "remaining to be built", no
  equating 765 polygons with 765 ámbitos, and no reading of `No Necesita` as "not
  applicable".

## 12. Out of scope (for K4)

K4 itself added no new dataset, ámbito layer, buildability, licences, change
detection, MapLibre, PMTiles, DuckDB, React, 3D, shader/glass, AI,
recommendation, score, ranking or analytical metric; typography, colour and
visual polish were #67's. The ámbito layer and buildability arrived with #68
under the Gate L contract; licences, change detection and any runtime-stack
decision remain out of scope for both.
