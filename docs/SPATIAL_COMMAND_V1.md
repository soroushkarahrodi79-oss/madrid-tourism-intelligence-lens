# Spatial Command Core V1 (Gate 1)

Status: **implemented, internal only.** Lens command initiative, Gate 1.

## 1. Purpose and scope

A closed, versioned, strictly validated protocol for four Lens operations the
application **already supports by hand**, plus a minimal adapter that executes
them through the same controls a person uses. It is the deterministic core a
future input modality could sit on.

**What Gate 1 does NOT provide:** no voice control, no speech recognition, no
natural-language parsing, no language model, no assistant, no chat, and no
visible input of any kind (no text box, no microphone, no button). Nothing in
the product calls the adapter. It is reachable only through a test seam that
requires `?haloRegressionTest=1` **and** a loopback / private-LAN host (the same
gate as every other seam in `js/app.js`). The no-assistant statements in
`docs/CLAIMS_AND_LIMITATIONS.md` and `docs/EVIDENCE_REGISTRY_QUERY_CONTRACT.md`
remain true and unchanged.

| Implemented (Gate 1) | Not implemented (future, separately authorized) |
|---|---|
| Command contract `js/spatial-command.js` (pure) | Any input surface (text, microphone, push-to-talk) |
| Execution adapter in `js/app.js` (internal) | Speech-to-text, any provider |
| Structured execution receipts | Natural-language → command parsing (ES / EN / FA / mixed) |
| Unit + browser equivalence tests | District / barrio comparison, layers, PNOA, export commands |

## 2. Command contract (`version: 1`)

Every command is a plain JSON object. Field sets are **exact**: a missing field
is `MISSING_FIELD`, any extra field (at any level) is `UNKNOWN_FIELD`. Nothing is
coerced: `"750"`, `120` or `6000` are rejected, never parsed, snapped or clamped.

| `action` | Fields | Meaning (manual equivalent) |
|---|---|---|
| `navigate_to_location` | `location`, `zoom?` | Camera only. `official_area` → same framing as **View on map** (`fitBounds`, 32 px padding, max zoom 15). `coordinates` → `setView`, `zoom` optional integer within the map's zoom range (defaults to the current zoom). `zoom` with an area is `UNSUPPORTED_FIELD_COMBINATION`. |
| `set_lens_location` | `lens`, `location` | Moves one Lens **centre**; radius unchanged; the Lens becomes active (every manual Lens action — drag, map click — acts on the active Lens). From `official_area` → the **verified interior point** the geographic search computes (**Analyze with Lens**). |
| `set_lens_radius` | `lens`, `radiusM` | Sets one Lens radius (radius slider); the Lens becomes active. |
| `compare_locations` | `a: {location, radiusM?}`, `b: {location, radiusM?}` | Enters COMPARE, places Lens A then Lens B as **circles**, ends with Lens B active — the manual sequence. Omitted `radiusM`: A keeps its radius; B keeps its own, or — the first time B is ever enabled — starts at A's radius (the app's `initializeLensBRadius`), stated as note `LENS_B_RADIUS_FROM_LENS_A`. |

`lens`: `"A"` or `"B"`. `radiusM`: a number in `[LENS_RADIUS.minM, maxM]` =
`[100, 5000]` on the `stepM` = 50 m grid, read from `js/lens.js` (not restated).

`location` is one of:

```json
{ "type": "coordinates", "lat": 40.4169, "lon": -3.7035 }
{ "type": "official_area", "id": "DISTRICT:16" }
```

- Coordinates are WGS84 decimal degrees, finite numbers inside
  `LENS_SPATIAL_BOUNDS` (`js/evidence-url.js`: lat 40.0–40.9, lon −4.2 to −3.2),
  passed through exactly.
- `official_area.id` is the geographic search's own typed id
  `TYPE:code` with `TYPE ∈ {MUNICIPALITY, DISTRICT, BARRIO, AMBITO}`. It is an
  identifier, never a name: `"Lavapiés"` or `"Hortaleza"` is `INVALID_AREA_ID`.
  There is no alias table and no geocoder. `MUNICIPALITY` may be framed but not
  used as a Lens location (`AREA_TYPE_NOT_SUPPORTED`), as in the manual action.

### Examples

Valid:

```json
{ "version": 1, "action": "set_lens_radius", "lens": "B", "radiusM": 750 }
{ "version": 1, "action": "compare_locations",
  "a": { "location": { "type": "official_area", "id": "DISTRICT:16" }, "radiusM": 1000 },
  "b": { "location": { "type": "official_area", "id": "DISTRICT:05" }, "radiusM": 750 } }
```

Rejected:

| Command | Code |
|---|---|
| `{ "version": 2, … }` | `UNSUPPORTED_VERSION` |
| `{ "version": 1, "action": "compare_administrative_areas", … }` | `UNKNOWN_ACTION` |
| `{ …, "radiusM": 900, "unit": "m" }` | `UNKNOWN_FIELD` |
| `{ …, "radiusM": 120 }` / `6000` / `"750"` | `RADIUS_OFF_STEP` / `RADIUS_OUT_OF_RANGE` / `INVALID_RADIUS` |
| `location: { "type": "official_area", "id": "Lavapiés" }` | `INVALID_AREA_ID` |
| `location: { "type": "coordinates", "lat": 0, "lon": 0 }` | `COORDINATES_OUT_OF_BOUNDS` |
| `set_lens_radius` on `"B"` in PLACE | `LENS_B_NOT_ENABLED` |

## 3. Integration architecture

```
command (plain object)
  → validateSpatialCommand()          js/spatial-command.js  pure: structure, types, limits
  → planSpatialCommand(cmd, context)  js/spatial-command.js  pure: preconditions, area resolution, full target
        context = read-only snapshot built by app.js + resolveArea() (geo-search index, interior point, bounds)
  → executeSpatialCommand()           js/app.js              mode controller, marker/circle placement,
                                                              setLensRadius(), activateLens() → refresh()
  → verify target, else roll back     js/app.js
  → receipt
```

**Why not the share-link restore (`k11ApplyState`)?** It was evaluated and
rejected for commands. It re-applies language, layers (firing their handlers),
time step, stay filter, reading and metric focus; replaces both polygon
workspaces whenever a geometry field is present (dropping drafts); and swallows
per-Lens failures by design (`k11ApplyLensRestore`). Each is right for restoring
a whole reading and wrong for a small command. The adapter instead calls only
the primitives the matching manual control calls, so unrelated state (layers,
language, basemap, metric focus, polygons, drafts, ámbito selection, search
surface) is never touched.

## 4. Atomicity and failure semantics

1. **Prepare cannot mutate.** Validation and planning are pure over a read-only
   snapshot; every side of `compare_locations` is resolved before any target
   exists. A refused B never changes A.
2. **Execution is synchronous** (no `await` between steps), so no repaint or
   user input can interleave.
3. **Verification + rollback.** After execution the live mode, active Lens,
   Lens B state, centres and radii are compared with the plan's target. An
   exception or any difference restores the snapshot taken before execution
   through the same primitives and reports `status: "failed"` with
   `rolledBack: true|false` (true only when the restored state was itself
   verified). This is tested by injecting an exception mid-command.
4. **Always re-prepared.** `execute` re-validates against the current state; a
   plan is never applied to a map that changed after it was made.
5. **Idempotent.** A command whose target equals the current state returns
   `no_change` and does nothing. Operation notes (`MODE_CHANGED`,
   `CENTRE_MOVED`, …) are dropped because nothing changed, but the scope
   warning `LENS_CIRCLE_NOT_AREA` is kept: a Lens placed from an official area
   is still a circle, not the area.

Camera commands are not verified against a target (the framed view depends on
the viewport); on an exception the previous view is restored.

## 5. Receipt

```json
{ "version": 1, "action": "set_lens_radius", "status": "applied",
  "command": { "version": 1, "action": "set_lens_radius", "lens": "B", "radiusM": 750 },
  "resolved": {}, "error": null, "notes": ["ACTIVE_LENS_CHANGED"],
  "state": { "mode": "COMPARE", "activeLens": "B", "lensBEnabled": true,
             "lensA": { "lat": …, "lon": …, "radiusM": 900, "geometry": "CIRCLE" },
             "lensB": { "lat": …, "lon": …, "radiusM": 750, "geometry": "CIRCLE" },
             "camera": { "lat": …, "lon": …, "zoom": 14 } } }
```

`status`: `applied | no_change | rejected | failed`. `command` is the normalized
command (null when invalid — an invalid command is never echoed as if valid).
`state` is read back from the app. **A receipt never carries a reading, count or
any analytical value**; readings are recomputed by the app's own `refresh()`.
Notes: `LENS_CIRCLE_NOT_AREA`, `MODE_CHANGED`, `ACTIVE_LENS_CHANGED`,
`LENS_B_RADIUS_FROM_LENS_A`, `CENTRE_MOVED`. No telemetry, logging or storage.

## 6. Error codes

Structure: `INVALID_COMMAND`, `MISSING_FIELD`, `UNKNOWN_FIELD`, `INVALID_TYPE`,
`UNSUPPORTED_VERSION`, `UNKNOWN_ACTION`, `INVALID_LENS`, `INVALID_LOCATION_TYPE`,
`INVALID_COORDINATES`, `COORDINATES_OUT_OF_BOUNDS`, `INVALID_AREA_ID`,
`INVALID_RADIUS`, `RADIUS_OUT_OF_RANGE`, `RADIUS_OFF_STEP`, `INVALID_ZOOM`,
`UNSUPPORTED_FIELD_COMBINATION`.
Application state: `ZOOM_OUT_OF_RANGE`, `GEOGRAPHY_NOT_READY`, `AREA_NOT_FOUND`,
`AREA_TYPE_NOT_SUPPORTED`, `AREA_INTERIOR_POINT_UNAVAILABLE`,
`MODE_NOT_SUPPORTED` (Lens commands in CITY), `LENS_B_NOT_ENABLED`,
`COMPARE_SCOPE_AMBITO`, `HISTORICAL_COMPARISON_ACTIVE`, `GEOMETRY_NOT_CIRCLE`
(a confirmed polygon is never overwritten), `GEOMETRY_EDIT_IN_PROGRESS` (nor a
draft or vertex edit).
Execution: `EXECUTION_FAILED`, `EXECUTION_STATE_MISMATCH`.

## 7. Scientific invariants

- No indicator, membership rule, calculation or provenance semantics changed.
  The module computes no distance, containment or reading.
- A Lens placed from an official area is a **circle on a verified interior
  point**, not the area (`LENS_CIRCLE_NOT_AREA`); no whole-area figure is
  attributed to it (`CLAIMS_AND_LIMITATIONS.md`).
- `compare_locations` compares two **circles** in `scope: LENS`. There is **no
  district or barrio comparison** in Lens, and none is emulated. Planning-ámbito
  comparison is not a command in V1.
- Zero / unavailable / no-sample / withheld distinctions are untouched: they are
  produced by the app after execution, and the equivalence tests compare
  readings by value **and** status.

## 8. Validation

- `tests/spatial_command.test.mjs` — contract: valid commands, versions,
  unknown actions/fields, missing fields, coordinates, radii, lens targets,
  non-finite values, malformed input, preparation without mutation, compound
  validation, polygon/draft protection, receipts, module purity.
- `browser-tests/spatial-command.browser.mjs` — each expected state is produced
  on a **separate page by the manual controls** and compared with the command
  result on `k11State`, URL, per-Lens readings, planning membership, Decision
  Insight model, slider and radius label: map click, Analyze with Lens on Lens
  B, radius slider on active and inactive Lens, the full manual comparison
  sequence, View on map; plus rejection without change, failed B side,
  polygon/draft protection, idempotence, injected-failure rollback, and absence
  of any visible input/microphone surface.

## 9. Known limitations

- Polygons cannot be created, moved or resized by command; Lenses holding one
  refuse location/radius commands.
- No command switches comparison scope, layers, language, PNOA or export.
- Area commands need the geographic-search module and indices loaded
  (`GEOGRAPHY_NOT_READY` otherwise; nothing is queued).
- Rollback restores mode, Lens B state, centres, radii, active Lens and a
  captured radius-sensitivity baseline (with its invalidation notice). The app
  drops that baseline on any centre change, as it does by hand; the immutable
  snapshot taken before execution is put back with the centres. `rolledBack:
  true` is reported only if mode, active Lens, Lens B state and initialization,
  centres, radii **and** the baseline all match the pre-command state. Metric
  focus is not snapshotted: no command sets or clears it (no demonstrated loss).
- Execution runs several `refresh()` passes (as the manual sequence does); they
  are synchronous, so no intermediate state is painted.

## 10. Future integration boundary

A later, separately authorized input layer (text, speech, any provider) must
produce a `version: 1` command object and call the adapter; it must not reach
around it. It may never supply coordinates it did not receive from a person or
an official index, nor an area id it did not obtain from the official index.
Any such layer requires an explicit owner decision and an update of the
no-assistant contract first.
