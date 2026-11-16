# Madrid Network Accessibility — isolated scientific pilot

A **research package**, not a feature. It asks one measurable question about one
barrio and one facility category, and answers it from official sources plus
OpenStreetMap, with every methodological decision written down and varied.

```
python research/network_accessibility_pilot/run_pilot.py
```

```
python -m unittest tests.test_network_accessibility_pilot
```

Measured findings and the verdict are in [`RESULTS.md`](RESULTS.md); the
machine-readable record is `results/pilot_report.json`.

## Isolation (what this pilot may not touch, and does not)

- **No application change.** Nothing in `index.html`, `js/`, `css/` or
  `package.json` references this package. `tests/test_network_accessibility_pilot.py`
  asserts that, so the isolation is tested rather than claimed in prose.
- **No Python in the application runtime.** The browser reads committed JSON
  artifacts and makes no request to any service. This package is Python, like
  the repository's existing builders and research gates, and is never loaded by
  the page.
- **No new committed data artifact.** Nothing under `data/` is produced or
  mutated. The pilot *reads* the committed official geography
  (`data/geography/madrid_admin.geojson`) and nothing else from `data/`.
- **No branch, PR, merge or deployment**, and no other worktree touched.
- **New dependencies: none.** It uses `requests`, `pyproj` and `shapely`, all
  three already pinned in `scripts/requirements-build.txt` for the official
  builders, plus `matplotlib` for the one figure (the run degrades gracefully
  without it). No OSMnx, no momepy, no City2Graph, no NetworkX, no routing
  engine, no ML, no GNN, no composite index, no web framework — see
  [§ The minimum tooling](#the-minimum-tooling-and-why-the-obvious-libraries-are-not-used).

## The question

> For official address portals in one Madrid barrio, how far does the
> **straight-line** distance to the nearest official municipal basic sports
> facility depart from the **shortest distance along the OpenStreetMap
> pedestrian network**, and does the choice of metric change **which** facility
> is nearest?

Four quantities are reported, because they answer different things:

| Quantity | Definition | What it tells a reader |
|---|---|---|
| **Detour ratio** | network ÷ straight line, **to the same facility** | pure circuity of the walking network |
| **Understatement** | network distance to the network-nearest facility ÷ straight-line distance to the *straight-line*-nearest facility | the error a straight-line tool would actually make |
| **Discordance** | share of origins whose nearest facility differs between the two metrics | whether a straight-line tool names the **wrong facility** |
| **False inclusion** | share of origins inside a "within *X* m" threshold by straight line but outside it by network | whether a straight-line **claim** breaks |

### Hypotheses

- **H0 (null).** Network distance is indistinguishable from straight-line
  distance for this purpose: median detour ratio ≈ 1 and discordance ≈ 0.
- **H1.** Network distance is systematically larger, heterogeneous across
  origins, and the two metrics disagree on which facility is nearest for a
  non-trivial share of origins.

**Unit of analysis:** one official address portal, measured to the nearest
facility access point. Not a barrio, not a grid cell, **not a Lens circle**.

### Acceptance / rejection criteria

These are **documented retrospectively**. They were written into
`run_pilot.py` while the pipeline was built and before its output was examined,
but this package holds **no independent timestamped record** proving that order,
so nothing here is described as pre-registered and no reader should treat it as
such. What is verifiable is weaker, and is all that is claimed: the criteria and
the study-area rule depend only on the sources, so they could not have been
fitted to a result, and the run recomputes them in the open.

| # | Criterion | Threshold |
|---|---|---|
| **A1** | origins that snap to the network within the 30 m baseline tolerance | ≥ 95 % |
| **A2** | measured pairs whose network distance falls **below** the straight line — a geometric impossibility, so a defect indicator | exactly 0 |
| **A3** | origins that cannot be measured at all (not snapped, or outside the largest connected component) | < 5 % |
| **A4** | the direction of the finding survives every sensitivity variant (median detour ratio stays > 1) | all variants |

Failing A1, A2 or A3 means the measurement is not defensible and the verdict is
**HOLD**, whatever the numbers look like. Failing A4 means the finding is an
artefact of a modelling choice and the verdict is **MODIFY** at best.

## Sources, kept categorically distinct

The repository's rule is that official data, OpenStreetMap and derived results
are three different things. They are labelled as such throughout
`results/pilot_report.json`.

### Official (origins) — the current callejero

`213605-0-callejero-oficial-madrid`, resource `213605-4-callejero-oficial-madrid-csv`
(*direcciones vigentes*), Ayuntamiento de Madrid, **CC BY 4.0**. Resolved
through CKAN `package_show` by resource id — the same resource the repository's
own `scripts/build_callejero_ndp_crosswalk.py` already resolves — because the
download filename carries an edition date that changes.

Why this and not an alternative:

- it publishes `UTMX_ETRS`/`UTMY_ETRS` **already in EPSG:25830**, so origins are
  never reprojected and the metric-CRS question does not arise for them;
- `TIPO_NDP = PORTAL` is a street doorway, which is exactly where a walk starts;
- it carries the callejero's own `DISTRITO`/`BARRIO` codes, so area membership
  comes from the publisher rather than from a spatial guess — and the pilot then
  **checks** that membership against the official barrio polygon and reports any
  disagreement instead of fixing it.

Rejected alternatives:

- `data/callejero/madrid_ndp_crosswalk.json`, already committed here, covers
  only the NDPs attached to **granted urban licences**. That is a selection on
  licence activity, so it is a biased origin set.
- A **regular grid**. Reproducible, but its points fall inside building
  footprints and block interiors, which turns the result into an artefact of
  snapping. Official portals are both more defensible and more meaningful.

### Official (facilities) — one category only

`200215-0-instalaciones-deportivas`, resource `200215-1-instalaciones-deportivas-json`
(*Instalaciones Deportivas Básicas Municipales*), Ayuntamiento de Madrid,
**CC BY 4.0**.

Why this category, among those already available:

- it belongs to the **same municipal "Equipamientos" publication family and the
  same CC BY 4.0 instrument** as the museums dataset (`201132`) the application
  already adopts, so the pilot introduces **no new licensing instrument**;
- every record carries published coordinates (0 of 606 missing, checked in the
  run);
- the facilities are free-access, street-entered neighbourhood equipment — the
  ordinary meaning of *equipamiento* — rather than a mobility node or a tourist
  attraction.

Rejections, and why they are rejections rather than preferences:

| Candidate already in the app | Why not used |
|---|---|
| **Parks** (`200761`) | the dataset publishes **one point per park**, not an entrance. A network distance to a large park's single published point measures nothing real — you reach a perimeter, not a centroid. `docs/DATA_PROVENANCE.md` already restricts this layer to cartographic context and forbids reading it as accessibility. |
| **Metro / Cercanías stations** | geometry comes from an ArcGIS service that **asserts attribution but states no licence**; Gate L already returned MODIFY on reuse of exactly that route. Separately, a station point is not a station entrance — on a large interchange the two differ by a few hundred metres, which is the size of the effect being measured. |
| **BiciMAD docks** | physically the cleanest point (a dock on the pavement), but a bike-share dock is mobility infrastructure, not *equipamiento dotacional*, and `docs/CLAIMS_AND_LIMITATIONS.md` already states that a mobility-node count is not an accessibility statement. |
| **Museums** (`201132`) | official and already adopted, but centre-concentrated and not daily-use equipment. The obvious replication candidate; **not run**, because the brief restricts the pilot to one category. |
| **`data/runtime_poi.json`** | git-ignored deployment snapshot. Measuring from an uncommitted local artifact would not be reproducible. |
| **esmadrid accommodation** | already ruled NO-GO as a register (a promotional catalogue), and irrelevant here. |

### Official (study area)

`data/geography/madrid_admin.geojson`, the repository's committed canonical
administrative geography (Ayuntamiento de Madrid / IDEAM, CC BY 4.0). Used for
the barrio boundary, the catchment buffers, and the coherence check against the
callejero's own barrio codes.

### OpenStreetMap (network) — **not** an official source

Retrieved once from the Overpass API. **ODbL 1.0**, attribution *© OpenStreetMap
contributors*.

The licence drives concrete decisions about what is committed. They were
reviewed against the OSMF's published community guidelines, and the conclusions
below are **technical readings, not legal determinations**.

**A Derivative Database exists.** The Overpass query takes *every*
`way[highway]` in a ~22 km² bounding box — 17,665 ways, filtered to 16,715 and
restructured into a 77,399-edge graph. The OSMF *Substantial* guideline calls
extraction of that kind systematic and sets its thresholds far below this scale
("village map OK, town map not OK"), and the *Licence and Legal FAQ* says a
Derivative Database arises where you "adapt, modify, enhance, correct or extend"
the data. Both plainly apply.

Neither the extract nor the graph is **committed to this repository** — both
stay in the git-ignored `cache/`. The **extract** is, however, **published**:
it is deposited on Zenodo under ODbL 1.0 at
[`10.5281/zenodo.24288645`](https://doi.org/10.5281/zenodo.24288645), so a
recipient of these results can be handed the underlying database itself rather
than instructions for approximating it. The derived **graph** is published
nowhere; it is reproducible from the deposit with the code in this package.

**The committed results are Produced Works under the OSMF test**, which asks
whether "the published result of your project is intended for the extraction of
the original data". They are not: they are measurements *about* third-party
points. Supporting this, the withheld network holds 66,181 nodes (132,362
coordinates) plus topology and tags, while the committed artifacts publish about
5,272 OSM-informed scalars — roughly **25× underdetermined on coordinates
alone** — and a shortest-path length is a functional of the whole graph, not a
sample of it.

**That argument is not a conclusion, and the CSV is where the doubt sits.**
`origin_facility_distances.csv` is systematic over the entire portal universe of
the study barrio, one row per official address, each carrying OSM-computed
values. A systematic per-record table is closer to a database *in form* than a
figure or a statistics report is, even when its contents are measurements rather
than map data. The OSMF attribution guideline separately treats a Produced Work
that "extracts, copies, or recreates substantial parts" of the data as a
Derivative Database, and the *Substantial* guideline's tests count extracted
**features** without addressing derived or aggregated outputs at all. This case
falls in a gap the published guidelines do not cover. A reviewer could
reasonably reach a different view, and this pilot does not assert otherwise.

**Section 4.6 and the underlying data.** Classifying the outputs as Produced
Works does not end the matter, and inferring compliance from the absence of OSM
identifiers or geometry would be a mistake. The Produced Work guideline itself
says that "if you publish a produced work, the underlying database has to be
published as well", and the Licence and Legal FAQ says any recipient "can ask
for a copy of both" the OSM data and any Derivative Database used, and that "you
are required to provide these, if requested". The FAQ's shortcut — refer users
to openstreetmap.org when you "haven't changed the OSM data" — does **not**
apply here, because the data was filtered and restructured. What this pilot
offers instead is the FAQ's other route, "the means to create them":
`results/ATTRIBUTION.md` records the extract's SHA-256, byte length, endpoint
and `timestamp_osm_base`, and the exact Overpass query, the filtering rules and
the whole pipeline are published in this package. Whether that discharges a
request when the exact database state is no longer regenerable is **open**, and
is recorded as open rather than resolved.

Nothing here is legal advice — the OSMF's own FAQ says the same of itself — and
adopting any of this into the application should be reviewed by someone
qualified to give it.

### Archiving the extract (assessed, not done)

Archiving the cached Overpass extract separately, under ODbL 1.0 and with its
SHA-256 and provenance, would convert the open question above into a closed one:
a recipient could be handed the actual database rather than instructions for
approximating it, and the pilot's figures would become publicly reproducible
instead of merely publicly re-derivable. It is practical — the extract is
11.71 MiB raw and **1.46 MiB gzipped** — and its identity is already recorded.

Two conditions apply. It must live **outside this repository**, because it is an
ODbL database and this repository is MIT with a documented licensing boundary; a
release asset or a data archive such as Zenodo, referenced by SHA-256, keeps the
two instruments apart. And it must carry the ODbL notice and the OpenStreetMap
attribution in its own right, since redistributing it is distributing OSM data,
not a reading of it.

**Done.** The extract is deposited on Zenodo, open access under ODbL 1.0:

> **Version DOI — cite this one: [`10.5281/zenodo.24288645`](https://doi.org/10.5281/zenodo.24288645)**
> Concept DOI (follows the latest version): `10.5281/zenodo.24288644`
> Published 2026-11-16.

Cite the **version** DOI. A reproducibility claim is about the exact bytes the
pilot measured, and the concept DOI resolves to whatever the newest version
happens to be.

Verified on 2026-11-16, by content rather than by title: the DOI Handle System
returns `responseCode 1` for both DOIs; the Zenodo record API returns a
published, open dataset record at version 1.0.0; and **all three deposited files
match the locally prepared archive on MD5 and byte length**, with the deposited
gzip decompressing to the SHA-256 this package records for the extract.

**One gap, recorded rather than smoothed over.** The Zenodo record carries
neither `metadata.license` nor `metadata.rights`, so a machine reading the
record metadata sees no licence; the ODbL terms and the OpenStreetMap
attribution appear in the record's description text only. That does not change
the licence the data is under — it is OpenStreetMap data and ODbL 1.0 applies
through its source, not through a Zenodo field — but the record metadata should
be corrected on Zenodo so the declared licence is machine-readable. That is a
change to the depositor's Zenodo record, not to this repository, and is not done
here.

OSM is also, substantively, volunteered data of uneven completeness — not a
municipal pavement cadastre — and the results say so.

## Method

### Study-area selection

> Among the official barrios whose centroid lies inside the application's
> documented central-Madrid envelope (40.385–40.455 N, −3.745–−3.645 E), take
> the barrio with the most **distinct** official facility access points; break
> ties by smaller area.

The rule's **inputs** are only the facility register and the official
geography — never a distance, a ratio or any result — so it cannot have been
fitted to an outcome. That is an argument from the inputs, not a claim of
pre-registration. The run recomputes the rule at run time and records whether it
agrees with the barrio declared in the code
(`selection_rule.rule_agrees_with_declaration`), so the choice can be audited
rather than taken on trust. It selects **barrio 113, San Isidro (Carabanchel)**.

The rule selects the *best-served* eligible barrio on the facility count it
ranks by. That is a selection effect and it is recorded as one. This pilot
measured one barrio and therefore has **no evidence** about what a
less-well-served barrio would show; the direction of any such difference is
unknown here, not merely unmeasured.

### Facility identity

The register publishes **one row per sub-installation** (a court, a rink, a
petanca lane), several of which can share one street location. For a
nearest-facility measure the unit is the **access point**, so rows at an
identical published coordinate are collapsed to one, keeping the lowest id, and
the collapse is reported (`records_in_catchment` → `distinct_access_points_in_catchment`).
A record count from this register is therefore **not** a count of installations.

### Edge effects

Facility candidates may lie up to **1 000 m outside** the barrio boundary;
without that, every origin near the boundary would be measured against an
artificially distant facility. The network is extracted wider still
(**1 600 m**), so no path to a candidate is truncated by the edge of the extract.

### OSM extraction rules

One Overpass request retrieves **every** `highway` way in the bounding box plus
its nodes. Filtering then happens locally, in `classify_way`, so the sensitivity
variants re-filter **the same cached bytes** and differ only in the documented
decision — never in the input data.

- **Retained in the baseline:** `primary`, `primary_link`, `secondary`,
  `secondary_link`, `tertiary`, `tertiary_link`, `unclassified`, `residential`,
  `living_street`, `pedestrian`, `footway`, `path`, `steps`, `service`, `track`,
  `road`, `cycleway`. Carriageways are included because Madrid's distributor and
  residential streets carry pavements that OSM does not always map separately;
  excluding them would disconnect the network for reasons of mapping practice
  rather than of reality. The `strict_pedestrian` variant tests exactly that
  choice.
- **Always excluded:** `motorway`, `motorway_link`, `trunk`, `trunk_link`,
  `construction`, `proposed`, `raceway`, `bus_guideway`, `busway`, `escape`,
  `corridor`, `platform`, `rest_area`, `services`, `elevator`.
- **Pedestrian restrictions:** reject `foot ∈ {no, private}`; reject
  `access ∈ {no, private}` unless `foot ∈ {yes, designated, permissive, official}`.
  Reject `indoor=yes`.
- **`area=yes`:** kept as its **closed ring**. That measures walking *around* a
  plaza rather than across it — conservative, never shorter than reality, and it
  avoids silently disconnecting Madrid's pedestrian squares.
- **Direction:** the graph is **undirected**. `oneway` restricts vehicles, not
  pedestrians.

Every rejection is counted by reason in
`s3_osm_extraction` / `network.ways_rejected_by_reason`, so the filter can be
audited rather than trusted.

### Graph construction and simplification: none

The graph is built at **segment level** — one edge per consecutive node pair of
a retained way. There is **no simplification of any kind**: no intersection
consolidation, no geometry generalisation, no collapsing of degree-2 chains.
Each of those operations changes a shortest-path length, and the quantity under
study *is* a shortest-path length. This is a deliberate departure from the usual
OSMnx `simplify=True` / `consolidate_intersections` defaults.

### Snapping

A point is attached to the nearest point **on** the nearest retained segment —
not to the nearest OSM node, which would import an error the size of a block
face. The segment is split at the projection, and the perpendicular offset is
added to the modelled path length and reported separately (`snap_offset_m`).
All projections are computed against the original segment list before any split,
so no point snaps to a sub-segment another point created and the result does not
depend on input order (tested).

That offset is a **modelled straight connector between a published coordinate
and the network**. It is not an observed walk, not a surveyed path, and not
evidence that any way exists along that line. It is included in the reported
metres because omitting it would understate the distance — not because it was
measured on the ground.

A portal further than the tolerance from any retained segment is reported
`NOT_SNAPPED`. It is never attached to a distant street.

### Shortest paths and unreachable cases

One **multi-source Dijkstra**, seeded at every facility's snapped node with that
facility's own offset as the initial cost, yields for every node at once both
the distance to the nearest facility and **which** facility it is. It is exact —
no heuristic, no contraction, no approximation.

Connected components are computed explicitly, on the graph the paths actually
run on (that is, after snapping). A portal outside the largest component is
reported `UNREACHABLE` and given **no** imputed distance.

**Where a path ends.** Every route here terminates at the **coordinate the
facility register publishes**, not at a verified entrance. The register's
geocoding is address-derived, not surveyed — two facilities in this run are
published within 5 mm of a portal's own coordinate, which is what
address-derived geocoding looks like. Where a real entrance sits elsewhere, the
reported distance differs from the walk a person would make by an amount this
pilot cannot bound.

### Ratios need a denominator

A ratio needs a denominator larger than the precision of the coordinates it is
computed from. The facility register publishes WGS84 to 7 decimals (~1.1 cm) and
the callejero publishes UTM to the centimetre, so ratios are reported only for
pairs at least **1 m** apart — the precision bound of the inputs themselves.
Pairs below it are counted (`ratio_denominator_rule`) and kept in full in the
distance-in-metres statistics, where they remain valid.

An earlier draft used a 25 m bound. That is not wrong, but it does more work
than the data justify, and a bound chosen that far above the precision of the
inputs needs a justification the inputs do not supply. The run reports the 25 m
figure alongside as a robustness check, so the choice can be judged rather than
trusted; `RESULTS.md` §3.1 gives the comparison. The median is reported
alongside the mean for the same reason.

### Metric CRS

Every metre is computed in **EPSG:25830** (ETRS89 / UTM zone 30N), the CRS the
callejero publishes its coordinates in and the CRS the repository already
retrieves its planning geometry in. Only WGS84 inputs (OSM, the facility
register) are transformed, once, explicitly, through `pyproj`. A test asserts
the EPSG:25830 ↔ EPSG:4326 round trip is lossless to **1 mm** for a real
published Madrid portal coordinate.

### Sensitivity

Seven runs. Each variant changes **exactly one** documented decision:

| Variant | Decision changed |
|---|---|
| `baseline` | — |
| `strict_pedestrian` | retain only ways tagged as pedestrian space; no carriageways |
| `no_steps` | remove `highway=steps` (a step-free walking proxy) |
| `permissive_access` | ignore `access=no/private` (upper bound on permeability) |
| `snap_15m` | tighten the snapping tolerance to 15 m |
| `snap_50m` | loosen the snapping tolerance to 50 m |
| `facility_buffer_500m` | halve the out-of-barrio facility catchment |

## The minimum tooling, and why the obvious libraries are not used

The brief asked for OSMnx, momepy and City2Graph to be reviewed and for the
**minimum** necessary to be chosen.

- **OSMnx** (Geoff Boeing, MIT-licensed) is the standard, well-maintained way to
  download and analyse OSM street networks, and it would do the retrieval, the
  graph construction and the shortest paths in a few lines. **It is fully
  capable of the measurement this pilot makes.** Its graph builders accept
  `simplify=False`, intersection consolidation is a separate opt-in step rather
  than something applied automatically, and it ships a maintained `"walk"`
  network filter that is exercised by far more users than the hand-written
  filter in this package. An earlier draft of this README said OSMnx was
  disqualified because its default pipeline simplifies the graph. **That was
  wrong** — the default is a default, not a constraint — and the claim is
  withdrawn. (Exact call signatures are not quoted here because this pilot did
  not run OSMnx and should not assert an API it has not exercised; the point is
  only that the capability exists.)

  The actual reasons it is not used here are narrower and are about this
  package, not about the library:

  - it is **not installed** in this environment, so using it would add the
    pilot's only new dependency — and with it NetworkX, GeoPandas and their
    transitive tree — to a repository whose research gates deliberately run on
    the three packages already pinned in `scripts/requirements-build.txt`;
  - the pilot needs the **nearest-facility label**, not just the distance.
    OSMnx/NetworkX can produce it (`nx.multi_source_dijkstra`), so this is a
    convenience, not a capability gap: the twenty-line multi-source Dijkstra
    here returns distance and label in one pass and is covered by tests against
    closed-form grid distances;
  - every modelling choice had to be **visible in this package's own code**,
    since the extraction rule is itself an object of study (see §3.5 of
    `RESULTS.md`). Using a library filter would have moved that rule out of the
    reader's view, which is a reason specific to this pilot and would not apply
    to ordinary analysis.

  **If this work were extended** — more barrios, more categories, routine
  re-runs — OSMnx with `simplify=False` would be the sensible tool, and
  re-deriving these primitives by hand would be the wrong call.
- **momepy** is an urban-morphometrics library (tessellation, form and
  configuration characters). It answers morphology questions, not
  origin–destination distance questions. Out of scope.
- **City2Graph** (BSD-3-Clause, by Yuta Sato; release 0.3.1 of March 2026)
  converts urban geospatial data into spatial and heterogeneous graphs, with
  export to NetworkX and PyTorch Geometric and an explicit graph-neural-network
  orientation. It is not installed here, and its distinctive value — GNN-ready
  heterogeneous graphs — is precisely what the brief rules out. Out of scope.
- **NetworkX** *is* installed and would be a reasonable choice for the
  shortest-path step. A standard-library `heapq` multi-source Dijkstra is used
  instead: it is about twenty lines, it is covered by unit tests against
  closed-form grid distances, it adds no dependency to declare, and it returns
  the nearest-facility **label** in the same pass, which is the thing the pilot
  actually needs.

Net new third-party dependency introduced by this pilot: **none**.

## Outputs

| Path | What it is | Committed |
|---|---|---|
| `results/ATTRIBUTION.md` | the credit covering every file in `results/`, the per-file breakdown of what came from where, and the ODbL 4.6 statement | yes |
| `results/pilot_report.json` | the complete machine-readable record: sources, licences, retrieval fingerprints, extraction rules, every variant's statistics, acceptance checks, interpretation ceiling, plus a top-level `attribution` block and `odbl_4_6_statement` | yes |
| `results/origin_facility_distances.csv` | one row per origin portal: official coordinates, both distances, detour ratio, snap offset, state | yes |
| `results/facility_access_points.geojson` | official facility access points | yes |
| `results/figure_straightline_vs_network.png` | the scientific figure | yes |
| `RESULTS.md` | the findings, the limitations, the verdict, and §7's record of the methodological review that revised them | yes |
| `cache/` | raw callejero CSV, raw facility JSON, raw Overpass JSON, each with a provenance sidecar (first-retrieval timestamp, HTTP validators, byte length, SHA-256) | **no** (git-ignored) |

## Conventions inherited from the existing research gates

- **Raw third-party files are never committed.** Streams land in `cache/` with a
  provenance sidecar; only normalized output is committed. Set `PILOT_CACHE` to
  relocate the cache.
- **A cache hit returns the provenance of the first retrieval**, so re-running
  never weakens or rewrites the recorded origin of a byte stream.
- **A negative result is a valid result.** The verdict may be GO, MODIFY or
  HOLD, per the acceptance criteria above and not per how interesting the
  numbers are.

## What this pilot does not measure

- Travel **time**, perceived walkability, comfort, safety, slope or effort.
- Accessibility for a wheelchair user or a person with reduced mobility. The
  `no_steps` variant is a crude step-free *proxy*, not an accessibility audit.
- Whether a facility is open, usable, in repair, or of any quality.
- Anything about Madrid as a whole, about other barrios, or about other facility
  categories. One barrio, one category — and **no evidence about the direction
  or size of any difference elsewhere**, which is a stronger limit than "not
  generalisable" and is meant as one.
- **Arrival at a facility.** Every path ends at the coordinate the register
  publishes, not at a verified entrance, and the snap offset at each end is a
  modelled connector rather than an observed walk.
- **The Lens observation circle.** A Lens circle is a declared observation
  window over published records; a network distance is a measured property of a
  street network. They are different objects and must never be presented as the
  same one.
