# Natural-Language Spatial Command V1 (Gate 2)

Status: **implemented — visible, bounded, deterministic.** Lens command
initiative, Gate 2. It sits on the Gate 1 core (`docs/SPATIAL_COMMAND_V1.md`) and
changes none of its contract.

## 1. Purpose and the product-contract distinction

A person can type one short instruction in Spanish or English, **see the
interpreted geographic operation**, and execute it through the existing Spatial
Command Core. Nothing else is added.

This gate authorizes exactly one new class of feature and keeps every other
prohibition of `docs/CLAIMS_AND_LIMITATIONS.md` ("No AI assistant") in force:

| Permitted (this gate) | Still prohibited |
|---|---|
| **Deterministic natural-language application controls**: a fixed grammar that turns a typed instruction into a `version: 1` command of the four existing actions, shown to the person before anything changes | **AI-generated scientific answers** — any sentence about evidence that a model or the parser composes |
| A visible, dismissible command panel with an interpretation preview, explicit candidate choice and an explicit Execute | A **conversational assistant**: chat, memory of a conversation, follow-up questions, "Ask Madrid" |
| Localized, template-filled feedback taken from the plan the core produced | Any **language model, embedding, prompt, vector store or API key** |
| Official-index entity resolution by exact folded name | **External model calls**, any network request, any backend or telemetry |
| | **Microphone, speech recognition, push-to-talk, voice placeholder** |
| | **Unsupported analytical claims**: answering "which district is better", "how many…", ranking, scoring, recommending, causal or legal statements |
| | Arbitrary JavaScript, a global command API, or any second GIS engine |

The parser is a **control**, like a menu: it maps a supported sentence to an
operation the application already performs by hand and refuses everything else.
It reads no evidence and writes no evidence. Scientific restrictions and
provenance requirements are unchanged; a future assistant remains constrained by
`docs/EVIDENCE_REGISTRY_QUERY_CONTRACT.md` and needs its own authorization.

## 2. Architecture

```
text (≤ 200 characters)
  → parseNaturalCommand()            js/nl-command.js   pure: fixed grammar, no model
  → official entity resolution       js/geo-search.js   the SAME index, exact folded names only
  → structured command v1            validated by validateSpatialCommand() (Gate 1, unchanged)
  → prepareSpatialCommandNow()       js/app.js          read-only plan against the CURRENT state
  → interpretation preview           js/app.js          text built from the PLAN, not from the typed words
  → explicit Execute                 js/app.js          the only caller of the adapter from the product
  → revalidate + fingerprint check   js/app.js          stale preview ⇒ not executed
  → executeSpatialCommand()          js/app.js          Gate 1 adapter: verify, roll back, receipt
```

`js/nl-command.js` is pure (no DOM, Leaflet, fetch, clock or `window`) and never
calls a GIS operation. Geography reaches it only through an injected
`search(query, limit)`. Nothing is exposed on `window`; the Gate 1 test seam stays
behind `?haloRegressionTest=1` on a loopback host.

## 3. Supported sentence shapes (closed grammar)

Matching is accent- and case-insensitive; surrounding courtesy words
("por favor", "please") are ignored. Each family maps to one existing action.

| Action | Spanish (examples) | English (examples) |
|---|---|---|
| `navigate_to_location` | Ve a Barajas · Muéstrame el distrito de Hortaleza · Llévame a Chamartín | Go to Barajas · Show me the Hortaleza district · Navigate to Chamartín |
| `set_lens_location` | Coloca Lens A en Chamartín · Pon la lente B en Barajas · Centra Lens B en Hortaleza | Set Lens A to Hortaleza · Move Lens B to Barajas |
| `set_lens_radius` | Cambia el radio de Lens B a 800 metros · Pon el radio de Lens A en 1,5 km | Change the radius of Lens B to 750 meters · Set Lens A radius to 1 km |
| `compare_locations` | Compara dos círculos de 500 metros en Barajas y Hortaleza · Compara un círculo de 500 metros en Barajas con otro de 1 km en Chamartín | Compare 500-meter circles in Barajas and Hortaleza · Compare a 500 m circle in Barajas with a 1 km circle in Chamartín |

Every example above is a row of the declared test corpus
(`tests/nl_command.test.mjs`) and parses to the structured object stated there.
Nothing else is claimed to work.

### Radii

`m`, `metro(s)`, `metre(s)`, `meter(s)`, `km`, `kilómetro(s)`, `kilometre(s)`,
`kilometer(s)`; a decimal comma or point (`1,5 km`, `0.75 km`); `500-meter`.
Kilometres are converted to metres by exact decimal arithmetic. **Nothing is
rounded or clamped here**: the radius goes to the Gate 1 validator, which accepts
only `[100, 5000]` m on the 50 m grid, and its refusal (`RADIUS_OFF_STEP`,
`RADIUS_OUT_OF_RANGE`) is reported as `INVALID_RADIUS`. A separator followed by
exactly three digits (`1.500`, `1,250`) is `AMBIGUOUS_NUMBER` — it could be 1500 or
1.5 — and is refused. A number without a unit is `MISSING_UNIT`; no unit is assumed.

## 4. Entity resolution

- A place resolves only when its folded text **equals** an official
  denomination in the loaded index (or an exact official ámbito code such as
  `APR.02.09`). There is no alias table, no fuzzy distance and no geocoder.
- A type word in the sentence (`distrito`, `barrio`, `ámbito`, `district`,
  `planning area`, `municipio`) restricts the type; it is the person's own
  disambiguation.
- A denomination beginning with an article (`El Pardo`) is matched as typed first,
  then without the article.
- **A name carried by more than one official entity is a choice**: the panel lists
  every candidate with its geographic type, official code, official name and parent
  where the source states one, and **never picks the first**. Enter cannot bypass it.
- **Informal names** (Lavapiés, Malasaña, Chueca…) are unresolved
  (`UNKNOWN_ENTITY`) because no official denomination equals them. Official
  denominations that merely *contain* the text are listed as read-only
  suggestions; they are never selected, and no equivalence is stated.
- A universe that is not loaded is `GEOGRAPHY_NOT_READY`, never "unknown": absence
  of a source is not absence of the entity.

## 5. Scientific semantics

The panel states these distinctions on screen, taken from the plan, not from the
typed words:

| Operation | What it is |
|---|---|
| Navigate to an official area | Camera framing identical to **View on map**; no analysis |
| Place a Lens in an area | A **circle** on a verified interior point of the area. The `LENS_CIRCLE_NOT_AREA` warning is shown in the preview **and after execution**; no whole-area figure applies |
| Compare two Lenses | Two **circular spatial windows** (`scope: LENS`) |
| Compare whole administrative boundaries | **Not supported** (`UNSUPPORTED_GEOMETRY`) |
| Compare official planning areas | **Not a command** in V1 |

**"Compara Barajas y Hortaleza" is semantically incomplete.** It is never read as a
district comparison or silently as a circle comparison. The panel says what is
missing, states that only circles can be compared, and offers the supported
reading as an explicit button; only after the person adopts it does a preview (and
then Execute) exist. An omitted radius stays omitted: the contract keeps each
Lens's own radius, and the preview shows the radius it will have.

No new scientific claim is introduced. No indicator, reading or provenance
semantics changed; every reading is recomputed by the app after execution.

## 6. Interface

A header button (`Command` / `Comando`, icon-only below 681 px, 44 px target) opens
a small dismissible overlay panel that shares the place finder's corner, chrome
tokens, field, action and result classes. Opening one closes the other. It is
closed by default and has **no microphone, no chat history and no permanent sidebar**.

- Labelled field (`<label for>`), supported examples that fill the field, and an
  **Interpret** submit. **Enter interprets; it never executes.**
- Interpretation preview (a polite live region), candidate buttons with
  type/code/name/parent and `aria-label`s, clarification with an explicit adopt
  button, localized refusal messages in a `role="status"` line.
- **Execute** exists only while a validated interpretation is shown; **Cancel**
  clears it; **Close** and **Escape** close the panel, discard any interpretation
  and return focus to the opener. Editing the text discards the interpretation, so
  what is executed is always what was interpreted from the field.
- Spanish and English follow the page language (`js/shell-copy.js`, `cmd.*` keys);
  a language change re-renders the same state and never re-executes.

## 7. Revalidation and failure semantics

1. Interpretation and preview are pure reads (`prepareSpatialCommand`); a refusal
   at any stage changes **no** application state.
2. At Execute the complete command is prepared again against the current state. A
   fingerprint of the prepared meaning (command, resolved areas, target radii,
   notes, whether anything changes) is compared with the one the person was shown;
   if it differs, **nothing is executed**, the updated interpretation is shown with
   a notice, and a renewed confirmation is required.
3. Execution is the Gate 1 adapter: verify, roll back on fault, structured receipt.
   The panel reports `applied`, `no_change`, a refusal code or a failed command with
   whether the previous state was restored and verified.
4. No mode is switched and no polygon replaced except as the Gate 1 contract
   states; `COMPARE_SCOPE_AMBITO`, `HISTORICAL_COMPARISON_ACTIVE`,
   `GEOMETRY_NOT_CIRCLE`, `GEOMETRY_EDIT_IN_PROGRESS`, `MODE_NOT_SUPPORTED`,
   `LENS_B_NOT_ENABLED` and `GEOGRAPHY_NOT_READY` are reported, not worked around.

## 8. Refusal reasons

Parser: `EMPTY_INPUT`, `INPUT_TOO_LONG` (> 200 characters), `UNSUPPORTED_INSTRUCTION`
(including any compound instruction), `UNSUPPORTED_GEOMETRY`, `UNKNOWN_ENTITY`,
`AMBIGUOUS_ENTITY` (a choice), `GEOGRAPHY_NOT_READY`, `MISSING_PLACE`,
`MISSING_RADIUS`, `MISSING_UNIT`, `MISSING_LENS`, `AMBIGUOUS_NUMBER`,
`INVALID_RADIUS`, `CONTRADICTORY_PARAMETERS` (several radii or Lenses, or the same
place and radius on both sides), `COMPARE_KIND_UNSPECIFIED` (a clarification).
Core: every code of `docs/SPATIAL_COMMAND_V1.md` §6.

## 9. Validation

- `tests/nl_command.test.mjs` — A intent (22 accepted, 17 refused), B parameters
  (17 valid, 17 refused), C entity resolution against the **real** official
  indices, D structured commands, E validation/preparation against the Gate 1
  planner, bounded-time and 3 000-sample fuzz, purity.
- `browser-tests/nl-command.browser.mjs` — F execution and equivalence with the
  structured command on a separate page (state, readings, view, slider), refusals
  without change, ambiguity, clarification, stale preview, Spanish; G keyboard,
  labels, live regions, focus, phone layout (375 px, 44 px targets, no horizontal
  scroll).
- `browser-tests/spatial-command.browser.mjs` — updated guard: no microphone,
  voice, chat or assistant element, the typed panel is the only command field, and
  no parser or executor exists on `window`.

**The corpus is hand-designed. It shows that the declared shapes parse to the
declared commands and that the declared invalid inputs are refused. It is not a
measurement of accuracy on natural language in general, and no such claim is made.**

## 10. Known limitations

- A closed grammar: paraphrases outside the declared shapes are refused, never
  guessed. Compound instructions are refused rather than split.
- A place name that itself contains the words ` y `/` and ` (or ` en `/` in `) can
  be mis-split in a comparison; the parser prefers the split whose two halves both
  resolve in the official index, and otherwise refuses, but it was not exercised
  against every one of the 724 ámbito denominations.
- Exact names only: `Moncloa-Aravaca` (no spaces) does not match
  `Moncloa - Aravaca`.
- Coordinates cannot be typed; comparison of whole boundaries, planning-ámbito
  comparison, layers, language, PNOA and export are not commands.
- English/Spanish only. No Persian or mixed-language grammar.
- No usage logging: the product cannot report how often an instruction is refused.

## 11. Recommended Gate 3 scope (not started)

Read-only and reversible first: (1) an **undo of the last executed command**
(the Gate 1 snapshot already exists); (2) a separately designed, explicitly
scoped **ámbito-comparison command**, after a product-semantics review of what the
preview must state; (3) a corpus review by people who did not write the grammar.
Voice, a language model or any external service require their own owner decision
and an update of the no-assistant contract first.
