# Unified geographic search V1 (M1)

One entry point for finding an **official geographic entity** in Madrid Urban
Evidence Lens, so a resident, a planner or a researcher can reach a place
without first knowing which dataset or which planning vocabulary holds it.

This document states what the feature **is**, what it deliberately **is not**,
and which capabilities are **withheld** and why. It records decisions; the
contracts it defers to are [`PRODUCT_SEMANTICS.md`](PRODUCT_SEMANTICS.md),
[`GATE_K_URBAN_DECISION_WORKSPACE.md`](GATE_K_URBAN_DECISION_WORKSPACE.md) and
[`URBAN_PLANNING_SOURCE_GATE_L.md`](URBAN_PLANNING_SOURCE_GATE_L.md).

## 1. What a search result is

A result is **entity discovery**. It carries exactly four things:

| Field | Source |
|---|---|
| entity type | which official universe the entity belongs to |
| official identifier | the source's own code, verbatim |
| official denomination | the source's own name, verbatim |
| parent area | **only** where the authoritative source states one |

A result carries **no** quantity, state, phase, date, edition, density, surface,
population or score. The search module never reads those fields; this is
enforced by a test that greps its own source.

Result **order** reflects how the text matched, and nothing else. It is not a
ranking of places, not a relevance score about the place itself, and not a
recommendation. The ordering comparator may read only the match kind, the
declared type order and the stable identifier — also enforced by a test.

## 2. The searchable universes

| Type | Count | Artifact |
|---|---|---|
| Municipality | 1 | `data/geography/madrid_admin.geojson` |
| Official district | 21 | `data/geography/madrid_admin.geojson` |
| Official barrio | 131 | `data/geography/madrid_admin.geojson` |
| Planning ámbito | 724 | `data/planning/madrid_ambitos.geojson` |

877 entities in total. **No new data source is introduced.** The index is built
over the indices `js/geography.js` and `js/planning-ambito.js` already construct
for the analytical surfaces, so search cannot disagree with the evidence about
what an entity is or where it is. Nothing is fetched for search and no geometry
is parsed a second time.

The barrio and district universe is the **current 131-barrio era**. The
era-aware identity rules in the hospitality geography gate are unchanged and are
not re-litigated here: this surface searches the committed current artifact only.

### Absent universes are named, never implied to be empty

Each universe loads independently. If one fails to load, search answers over the
other and **says so**, in place:

> Planning ámbitos are not loaded, so they were not searched. This is an absent
> source, not an absence of ámbitos.

A query that matches nothing is therefore always readable together with what was
actually searched. Both outage paths are covered by browser tests that fail the
real network request rather than setting a flag.

## 3. Matching

Deterministic and textual only. There is **no** fuzzy distance, **no** synonym or
alias table and **no** spelling correction: none could be justified against an
official register without inventing an identity the source does not publish.

Five match kinds, best first:

1. `EXACT_CODE` — the exact official identifier (raw first, then case-folded)
2. `EXACT_NAME` — the exact official denomination, accent- and case-folded
3. `CODE_PREFIX`
4. `NAME_PREFIX`
5. `NAME_CONTAINS`

Folding is NFD decomposition, combining-mark removal, lower case and whitespace
collapse. `Pacífico`/`pacifico`, `Argüelles`/`arguelles` and `Niño Jesús`/`nino
jesus` all match. Folding is used for **matching only** — every displayed value
is the official value, accented and cased exactly as the source publishes it.

Ties are broken by the declared type order and then by the stable identifier.
That order is **presentation stability, not importance**.

## 4. Shared names are never presented as a unique identification

16 folded names in the committed register are carried by more than one entity.
**12 of those are carried by entities of different types** — for example the
official barrio *Ciudad Universitaria* (093) and the planning ámbito *CIUDAD
UNIVERSITARIA* (AOE.00.07); likewise *Casa de Campo*, *Alameda de Osuna*,
*Carabanchel*, *Adelfas*, *Entrevías*, *Valdebernardo* and others.

Every entity carrying a shared name is returned, each row shows its type and its
official code, each row is badged, and the selected-entity card states:

> More than one official place carries this name. The official code above is
> what identifies this one; the name alone does not.

Both numbers (16 and 12) are asserted by a test, so a change in the register
forces this surface to be re-read rather than silently presenting one entity as
uniquely identified.

## 5. The two explicit actions

Typing changes the result list and nothing else: no Lens moves, no camera moves,
no radius changes, no mode changes and no layer is toggled. Selecting a result
draws the official outline in its own non-interactive Leaflet pane, below the
Lens pane and above the administrative boundary pane, and does nothing else.

### View on map

Frames the official geometry with `fitBounds`, the same camera semantics the
planning-ámbito explorer already uses. It moves no Lens, changes no radius and
switches no layer, and says so after it acts.

### Analyze with Lens

Moves the **active** Lens to a **verified interior point** of the official
geometry, by the identical code path a map click takes
(`marker.setLatLng` → `refresh()`). Radius A, radius B, the active-Lens
identity, the mode and every layer are untouched; Lens B keeps its own radius
and its own position throughout.

Every use of the action states, in words:

> The Lens circle remains its own analytical entity: it is **not** equivalent to
> the complete official boundary, so a figure the Lens reports is never a figure
> for the whole area.

**The action is withheld, with the reason stated in place, when it cannot be
performed honestly:**

* **The municipality.** The Lens radius is bounded at 5 km, far below the city's
  extent. Positioning a Lens at an interior point of Madrid would read as a
  whole-city analysis it cannot be, so the action is not offered.
* **No verifiable interior point.** Nothing is placed at an unverified
  coordinate (see §6).

## 6. The interior point is verified, never assumed

A polygon's geometric centroid is **not** assumed to lie inside it. Madrid's
official planning geometry is entirely `MultiPolygon`, and concave, ring-shaped
and multi-part ámbitos are common, so a centroid frequently falls outside the
entity it names.

The method in `js/geo-search.js`:

1. try the envelope centre;
2. otherwise scan a fixed 33-line horizontal ladder across the envelope and
   collect interior span midpoints by the even-odd rule;
3. verify candidates, widest span first, with `pointInGeometry` from
   `js/geography.js` — the project's single containment implementation — and
   return the first that containment **confirms**.

Step 3 verifies every candidate in turn rather than only the widest, because the
two rules genuinely disagree on one real shape: **10 of the 724 ámbitos pack a
second, disjoint ring into a single polygon**, which `pointInPolygonRings` treats
as a hole (its interior is outside the entity) while an even-odd scan reads it as
inside. Containment is the authority; the scan only proposes.

Measured over the whole committed register: **877 of 877 entities yield a
verified interior point** (783 envelope centre, 94 widest interior span), worst
single case 0.99 ms. Where no candidate verifies, the function returns `null` and
the capability is withheld — there is no centroid fallback and no bounding-box
fallback.

## 7. Placement is measured, not assumed

The finder opens as an overlay anchored under the institutional header, outside
the header's own flex/grid flow, so opening it can never widen the header or
displace the appearance, language and help controls at any viewport.

Where it sits is **measured at runtime**, because the analysis panel is
resizable by the reader and a static breakpoint cannot decide this:

* when the live corridor between the Layers rail and the analysis panel is at
  least 300 px wide, the finder sits **in that corridor** — the rail and the
  panel both stay fully visible and operable, so a reader can change mode or
  toggle a layer mid-search without dismissing anything;
* otherwise (a phone, a tablet where the panel spans the width, or a desktop
  panel the reader has widened) it is an explicit transient overlay, dismissed
  with `Escape` or the close control.

Measured corridor with the default panel: 368 px at 1024×768, 442 px at
1180×820, 628 px at 1366×768, 702 px at 1440×900. Below 1024 there is no
corridor and the overlay form is used.

## 8. Keyboard, assistive technology and touch

* `/` opens the finder from anywhere that is not a field or editable content, so
  it can never swallow a character; it adds no modifier combination the browser
  or the application already owns.
* The trigger is a native button with `aria-expanded` / `aria-controls`.
* Opening focuses the field. `ArrowDown` enters the result list, `ArrowDown` /
  `ArrowUp` move within it, `ArrowUp` from the first result returns to the field,
  `Enter` activates the focused result, `Escape` dismisses and returns focus to
  the trigger.
* Results are native `<button>` elements in a plain list — no invented ARIA
  roles, matching the planning explorer's established pattern. Status is an
  `aria-live="polite"` region.
* A focused result keeps focus through a Lens move and through a language
  change.
* Dismissing clears the query **and** the selection, so no outline is left on the
  map that nothing on screen explains.
* Every interactive target is at least 44 × 44 px, verified at 320 px with touch
  emulation.

## 9. Deferred capabilities

### Street-address search — deferred, with a stated reason

Arbitrary address geocoding is **not** implemented and is stated on the surface:

> Street addresses are not searchable. No verified municipal address locator is
> available to this surface.

`data/callejero/madrid_ndp_crosswalk.json` exists, but it was gated
([`CALLEJERO_NDP_CROSSWALK_GATE_M.md`](CALLEJERO_NDP_CROSSWALK_GATE_M.md)) as the
crosswalk that resolves **urban-licence records** to official address points. It
was never assessed as a complete municipal address register, and the licence
surface itself reports a resolved subset with explicitly unresolved rows. Using
it as a general address locator would present a partial, purpose-built crosswalk
as an exhaustive address index.

A future increment needs, before any address box is offered:

1. a provenance and licensing gate on an official address register in its own
   right, with its publication date and edition identity;
2. a measured coverage statement — which addresses the register contains and
   which it does not — so "no result" can be distinguished from "not covered";
3. a decision on historical versus current callejero identity, since the licence
   work already found rows recoverable only from the historical callejero;
4. a defensible answer for an address that resolves to a point but whose barrio
   attribution disagrees between the text and the NDP identity.

### Points of interest — deferred, with a stated reason

Museums, tourist-information points and stays are **not** searchable.
`data/snapshot_provenance.json` declares them a manually curated **snapshot
sample** — four museums and two information points, explicitly `exhaustive:
false`. A reader searching for any other museum would be told "no official place
matches", which would falsely imply it does not exist.

POI search becomes admissible when a source covers the claimed searchable
universe, each record has a valid location and unambiguous identity, and the
surface can state the catalogue's declared coverage. None of that holds today.

### Not in scope at all

The search surface does not infer construction progress, predict completion,
convert buildability into dwelling counts, apportion whole-ámbito figures to a
partial Lens overlap, infer tourist pressure or causality, rank areas by
desirability, treat a granted licence as completed construction, treat missing
data as zero, or suppress a source limitation.

## 10. Known limitations

1. **A reader who widens the analysis panel beyond the 300 px corridor
   threshold** moves the finder to its overlay form, where it covers part of the
   panel while open. It is dismissible with `Escape` and the close control, and
   the placement is re-measured on every resize.
2. **The ámbito district attribution** shown on a selected ámbito is the
   development-state edition's own attribution, labelled as such, and is
   available for **666 of 724** ámbitos. The remaining 58 say so explicitly. It
   is never derived from geometry, so it may differ from which district the
   polygon falls in.
3. **The selected-entity card repeats** the identity shown in the highlighted
   result row. This mirrors the planning explorer's list-plus-card pattern and
   was kept for consistency rather than diverging from it.
4. **Physical-device validation was not performed.** All responsive evidence
   comes from browser emulation at the ten specified viewports.
