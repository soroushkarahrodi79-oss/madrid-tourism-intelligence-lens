# Shareable evidence state & documented export (K11)

This document is the interoperability contract for two capabilities added in K11
(issue #73):

1. **A shareable URL state** that reproduces a reading of the workspace.
2. **A documented, client-side evidence export** — a five-file bundle any
   external tool can read, so a reading becomes a traceable, citable evidence
   object rather than a temporary configuration of a map.

There is **no backend, no database, no account, no URL shortener, no zip
dependency and no GeoLibre-specific code**. The URL is plain
`history.replaceState` + `URLSearchParams`; the bundle is plain `Blob`
downloads. One export contract serves QGIS, GeoLibre and a spreadsheet equally.

---

## 1. The URL state

### 1.1 Schema and version policy

The reading is encoded as the page's query string, always beginning with the
schema version `v=1`. The pure contract lives in `js/evidence-url.js`; the app
wiring lives in the K11 block of `js/app.js`.

| key  | meaning | example |
|------|---------|---------|
| `v`  | schema version (required) | `1` |
| `s`  | evidence-snapshot identity | `20261015-1` |
| `m`  | mode | `PLACE` · `COMPARE` · `CITY` |
| `a`  | Lens A centre + radius `lat,lon,r` (metres) | `40.41490,-3.69000,900` |
| `b`  | Lens B centre + radius | `40.42240,-3.70370,1200` |
| `be` | Lens B enabled | `1` / `0` |
| `al` | active Lens | `A` / `B` |
| `ly` | enabled operational layers, `.`-joined | `museum.stay.pedestrian.licences` |
| `ts` | heat (HATI) timestep | `15:00` |
| `sk` | accommodation (stay-kind) filter | `hotel` |
| `sc` | comparison scope | `LENS` · `AMBITO` |
| `aa` | ámbito A — exact official code | `AOE.00.01` |
| `ab` | ámbito B — exact official code | `API.03.11` |
| `fm` | focused/locked metric id | `ambito_surface` |
| `fl` | metric is locked (not just focused) | `1` / `0` |
| `rd` | reading preference | `citizen` · `analyst` |
| `lg` | document language | `es` · `en` |
| `bl` | sensitivity baseline `radiusA,radiusB,radiusMode` | `900,1200,UNEQUAL_RADIUS` |
| `bk` | baseline evidence-contract identity | `hati:15:00\|stay:all\|…` |

Keys are emitted in a fixed canonical order, so one reading maps to exactly one
string. Only keys that carry meaning for the reading are present (`aa`/`ab` only
in `AMBITO` scope; `bl`/`bk` only when a baseline is captured).

**There is deliberately no `edition` key.** The official edition is a property
of the committed artifact — it is shown in the interface but never *chosen* by
the user, so a URL cannot select one. The edition travels instead in the
evidence-snapshot identity (`s`) and in the export's `sources.json`.

A link whose `v` is missing or is not `1` is **refused**: the workspace loads in
its default reading and says, in a visible notice, that the link could not be
restored. An old schema is never silently reinterpreted into a different reading.

### 1.2 Exact, partial and refused restoration

Every dimension is validated on read. A value that is out of range, unknown or
malformed does **not** clamp into a different-but-plausible reading — it degrades
with a reason code, and the rest of the reading still restores:

| reason code | cause |
|-------------|-------|
| `VERSION_MISSING` / `VERSION_UNSUPPORTED` | missing or unsupported `v` → whole link refused |
| `INVALID_COORDINATES` | a Lens centre outside the Madrid envelope |
| `INVALID_RADIUS` | a Lens radius outside 100–5000 m |
| `RADIUS_NOT_ON_STEP` | a Lens (or baseline) radius in range but off the 50 m step — the app would snap it, so it is never claimed as an exact restoration |
| `UNKNOWN_AMBITO` | an ámbito code not in the committed official universe |
| `UNKNOWN_LAYER` | an operational-layer id the app does not define |
| `UNKNOWN_METRIC` | a metric not valid in the current scope |
| `INVALID_SCOPE` / `INVALID_MODE` / `INVALID_READING` / `INVALID_LANGUAGE` | an unsupported enum value |
| `INVALID_BASELINE` / `INVALID_TIMESTEP` / `INVALID_STAY_KIND` | an invalid sub-state |
| `SNAPSHOT_MISMATCH` | the committed evidence snapshot has moved since the link was made |

Three outcomes result: **EXACT** (every dimension restored), **PARTIAL** (some
dimensions degraded, each named in a dismissible notice) and **REFUSED** (the
version is unsupported).

Restoration respects the real initialisation order. Interface dimensions (mode,
lenses, layers, language, reading, metric) restore once the map and operational
layers are ready; the ámbito comparison and the sensitivity baseline restore once
the planning index has loaded **or failed**, so an ámbito code is never rejected
merely because its official geometry was still loading. Ordinary interaction uses
`history.replaceState`, so dragging a Lens never pushes a browser-history entry.

### 1.3 Interface vs evidence-snapshot reproducibility

A URL restores the **interface** exactly. It does **not** freeze the underlying
evidence. The committed artifacts behind the workspace can be redeployed, and a
redeployment can publish different values. The link therefore carries a snapshot
identity (`s`).

**What `s` is, and is not.** `s` is the **deployment build** identity
(`AREA_ASSET_VERSION`, a cache-busting asset version) — it is *not* a
cryptographic fingerprint of the data, and a matching `s` is therefore **not** a
proof that the underlying data is byte-for-byte unchanged. The authoritative
per-artifact identities are the **editions and snapshot fingerprints** the
registry declares (e.g. the planning `change_detection` `sha256`), which travel
in `sources.json`. When `s` differs from the running deployment, the workspace
shows a visible **"different deployment build"** warning: the interface restored,
but the link was made on a different build that *may* have republished different
values — never a claim that a newly rendered value is identical to the historical
one. No silent substitution.

---

## 2. The evidence export

One **Export evidence** button in the *Evidence & limits* drawer writes a
five-file bundle describing **exactly what is on screen** for the current
reading. The bundle is generated client-side from the same frozen models the
surfaces render (`js/evidence-export.js`); it never recomputes a value and never
contains a value not shown. Filenames carry the retrieval date
(`reading-YYYYMMDD-HHMM.json`) so two exports are distinguishable. Because some
browsers block several automatic downloads, a clickable fallback link for every
file is rendered after the export runs, and the status never claims a download
succeeded that it cannot confirm.

### 2.0 The export follows the visible reading

The bundle transcribes the reading **currently on screen**, selected by the live
mode — never a selection left in memory. The value set is:

| visible reading | values transcribed | value scope |
|---|---|---|
| **PLACE** | the active Lens metric panel (tourism, stays, mobility, and UTCI / pedestrian when their layer is on) | `LENS_CIRCLE` |
| **COMPARE · Lens** | the four Halo comparison metrics | `LENS_CIRCLE` |
| **COMPARE · ámbito** | the nine planning comparison metrics (S1 development-state vs S2 available-buildability named per value) | `PLANNING_AMBITO` |
| **CITY** | the destination-context metrics (hotel demand) and the domestic-origin rows | `MUNICIPALITY` |

Switching from COMPARE to PLACE or CITY drops the retained Lens/ámbito comparison
from the export, and the geometry follows the same rule (PLACE: the active Lens
circle(s) + the containing barrio; COMPARE·ámbito: the official ámbito polygons;
CITY: no Lens geometry). Every **other** surface shown in the mode (area
residents, VUT, PLACE planning context, category mix, nearest, hospitality,
licences, domestic dynamics) is carried in `evidence_surfaces` with complete
provenance — scope, unit, the five freshness fields and the verbatim ceiling.

### 2.1 `reading.json`

A machine-readable transcript of the displayed reading. Each value is
**independently interpretable**: it carries its own `provenance` (the five
freshness fields and verbatim ceiling of every contributing source, resolved
from the registry), its `source_ids` and — for planning metrics — its
`source_family` (`S1_DEVELOPMENT_STATE` or `S2_AVAILABLE_BUILDABILITY`).

```json
{
  "export_contract_version": 1,
  "generated_at": "2026-10-15T09:30:00.000Z",
  "reading": { "mode": "COMPARE", "comparison_scope": "LENS",
               "reading_preference": "analyst", "language": "en" },
  "evidence_snapshot": { "snapshot_id": "20261015-1",
                         "registry_contract_version": "…",
                         "note": "deployment build identity, not a data fingerprint; see §1.3" },
  "state_url": "https://…/?v=1&m=COMPARE&…",
  "values": [
    { "id": "tourism", "label": "Tourism POIs", "scope": "LENS_CIRCLE",
      "unit": "POIs", "source_family": null, "a_value": 5, "b_value": 10, "delta": 5,
      "state": "VALID", "comparison_basis": "RAW_COUNT",
      "source_ids": ["museum", "info"],
      "provenance": [
        { "id": "museum", "display_name": "Museums", "authority": "Ayuntamiento de Madrid",
          "freshness": { "reference_date": null, "published_at": null, "retrieved_at": "2026-09-29",
                         "update_frequency": "NONE_DECLARED", "source_state": "NOT_DECLARED_BY_PUBLISHER" },
          "interpretation_ceiling": "Counts of museum POIs inside the Lens circle…" }
      ] },
    { "id": "mobility", "scope": "LENS_CIRCLE", "unit": "nodes", "source_family": null,
      "a_value": null, "b_value": null, "delta": null,
      "state": "WITHHELD", "withheld_reason": "different window sizes",
      "source_ids": ["bike", "rail"], "provenance": [ "…" ] }
  ],
  "evidence_surfaces": [
    { "surface": "compare.tourism", "scope": "LENS_CIRCLE", "unit": "unit.poi",
      "sources": [
        { "id": "museum", "display_name": "Museums",
          "freshness": { "reference_date": null, "published_at": null,
                         "retrieved_at": "2026-09-29",
                         "update_frequency": "NONE_DECLARED",
                         "source_state": "NOT_DECLARED_BY_PUBLISHER" },
          "interpretation_ceiling": "Counts of museum POIs inside the Lens circle…" }
      ] }
  ]
}
```

Each displayed **value** carries its analytical scope, unit, state and (where it
is a comparison) its basis; a withheld value keeps its reason. Each **evidence
surface** carries, per contributing source, the five mandatory freshness fields
(`reference_date`, `published_at`, `retrieved_at`, `update_frequency`,
`source_state`) and the verbatim interpretation ceiling.

Value states are first-class and never collapsed:

- `VALID` with a numeric value — including a **published zero**, which is a real
  zero, not a missing value;
- `WITHHELD` — a comparison the model declined, with `withheld_reason` (e.g.
  different window sizes, cross-edition, multiple rows not combined);
- `UNAVAILABLE` — a source that could not be read;
- `INDETERMINATE` — a categorical pair where a side publishes no state.

### 2.2 `sources.json`

Only the registry entries for the **contributing** sources, never the whole
registry. Each entry carries, where the registry declares it: `display_name`,
`authority` (publisher), `dataset_url` / `retrieval_route`, the relevant official
`editions`, the `change_detection` snapshot fingerprints, `license` +
`license_url` + `attribution`, and the five freshness fields.

### 2.3 `geometry.geojson`

A valid `EPSG:4326` `FeatureCollection` of the geometries the reading actually
used. Each feature is tagged in its `properties` with:

- `scope` — `LENS_CIRCLE`, `PLANNING_AMBITO` or `ADMIN_BARRIO`;
- `role` — `lensA`, `lensB`, `ambitoA`, `ambitoB` or `barrio`;
- `identity` — the Lens letter, the exact ámbito code, or the barrio name;
- `geometry_kind` — `generated_analytical_window` or `official_boundary`.

A Lens circle is a **generated analytical window** (a 64-point polygon around the
centre), explicitly not an official boundary. An official ámbito polygon is the
publisher's **own geometry**, never replaced by its bounding box, and it carries
the publisher's declared state (which may be `NOT_DECLARED_BY_PUBLISHER`). No
fake precision and no attributes inferred from geometric overlap are introduced.

### 2.4 `README.txt`

The reading in plain text: the selected analytical objects, the retrieval date,
each contributing source's freshness, licence and verbatim interpretation
ceiling, an **ATTRIBUTION** block naming every CC BY 4.0 source as the licence
requires, the geometry conventions, and the limits of reproducibility.

### 2.5 `state.url`

The canonical shareable URL for the **same** reading. The URL in `state.url` and
the `state_url` field inside `reading.json` are identical and describe the reading
that produced the bundle — they are captured together, so a later change to the
selection cannot make them disagree.

---

## 3. Worked example — QGIS

Target: inspect the exported ámbito comparison alongside its evidence in QGIS
(tested conceptually against QGIS 3.x; nothing QGIS-specific is in the bundle).

1. **Load the geometry.** `Layer ▸ Add Layer ▸ Add Vector Layer…` and choose
   `geometry-YYYYMMDD-HHMM.geojson`. QGIS reads the declared `EPSG:4326` CRS; if
   your project CRS differs, QGIS reprojects on the fly — the file itself stays
   WGS-84 lon/lat.
2. **Read the identities.** Open the layer's attribute table. Each feature shows
   `scope`, `role`, `identity` and `geometry_kind`. Filter
   `"geometry_kind" = 'official_boundary'` to isolate the official ámbito
   polygons from the generated Lens circles.
3. **Join the evidence.** Open `reading-*.json` in a text editor (or
   `Layer ▸ Add Layer ▸ Add Vector Layer` with the GeoJSON driver if you prefer
   a table view of the values). Match a feature's `identity` (e.g. `AOE.00.01`)
   to the ámbito values in `reading.json`; the `scope` of each value
   (`PLANNING_AMBITO`) tells you it describes the whole official ámbito, not the
   Lens circle.
4. **Keep the provenance with the map.** `sources.json` and `README.txt` are the
   provenance of every value you now see. The CC BY 4.0 attribution in
   `README.txt` must travel with any derived map you publish.

What QGIS must **not** be used to do with this bundle: do not treat a Lens-circle
polygon as an official boundary, and do not apportion a `PLANNING_AMBITO` value
into a Lens circle or a barrio — the scope tag says the value describes the whole
ámbito.

---

## 4. Worked example — GeoLibre

GeoLibre is a full cloud-native platform (v3.3.0, with its own backend, Docker
and server). K11 does **not** embed, integrate or plugin GeoLibre; it emits a
generic export that GeoLibre reads like any other GeoJSON source.

1. **Import the geometry.** In GeoLibre, create or open a project and import
   `geometry-YYYYMMDD-HHMM.geojson` as a vector dataset. It is standard
   `EPSG:4326` GeoJSON, so it imports without a projection step.
2. **Style by scope, not by value.** Use the `scope` / `geometry_kind`
   properties to distinguish the official ámbito polygons from the generated Lens
   windows. Do not build a graduated/ranked symbology from the geometry — the
   bundle publishes no rank, stage or score, and the geometry carries none.
3. **Attach the evidence and provenance.** Load `reading.json` and
   `sources.json` as attribute tables and relate them to the geometry by
   `identity`. Each value keeps its scope, unit, state and freshness, so a
   withheld comparison stays withheld in GeoLibre too.
4. **Carry the licence.** Reproduce the `README.txt` attribution block wherever
   you publish a GeoLibre view derived from this bundle; the CC BY 4.0 sources
   and the official geometry's publisher copyright must remain visible.

---

## 5. Known limitations

- The URL restores the interface; it does **not** freeze the underlying data. A
  snapshot-id mismatch is surfaced as a warning, not papered over.
- The bundle is a transcript of one reading. It contains no coordinate, value or
  record the product does not already ship, and no raw upstream dataset.
- A withheld comparison is withheld in the bundle, with its reason — it is never a
  zero and never a missing value, and the two are kept distinct from a real
  published zero.
- No stage, rank, percentage, score or composite is published or derivable, in
  the product or in the bundle.
- Multiple-file delivery depends on the browser allowing several downloads; the
  rendered fallback links are the reliable path when it does not.
