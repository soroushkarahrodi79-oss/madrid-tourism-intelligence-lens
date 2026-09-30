# Data provenance

This document lists every dataset used by Madrid Tourism Intelligence Lens,
its origin, and how it reaches the application.

## Build-time evidence validation

A deployment is not published unless its evidence passes an explicit gate. The
GitHub Pages workflow runs:

```
SOURCE → BUILD → VALIDATE → AUDIT MANIFEST → DEPLOY
```

**Where the rules live.** [`data/source_registry.json`](../data/source_registry.json)
is the single machine-readable registry of the sources a deployment builds or
ships. For each one it declares the authority, the builder, the evidence type,
the expected spatial scope, what its period means, its interpretation ceiling,
and whether it blocks deployment. It holds no map records.

**What enforces them.** [`scripts/validate_deployment.mjs`](../scripts/validate_deployment.mjs)
reads that registry plus the artifacts the builders produced, and checks that
declared counts equal actual record counts, that layer and status names agree,
that identifiers are present and unique, that coordinates are finite and inside
the declared scope, and that each source's own integrity rules hold — that the
combined rail layer still contains both Metro and Cercanías, that accommodation
came from the authoritative Madrid Destino feed and still carries its published
taxonomy, and that the pedestrian layer is internally coherent. It runs locally
(`node scripts/validate_deployment.mjs`, after the builders) and in CI, and has
no dependencies.

**Which sources block a deployment.** The five layers that feed the lens's
operational metrics — museums, tourist information, BiciMAD, Metro/Cercanías and
the accommodation catalogue — block deployment, because a collapse in any of them
makes a displayed number wrong while it still looks authoritative. The committed
HATI evidence and the packaged fallback sample block too, since they can only
change through a commit. Principal parks and the pedestrian counters do **not**
block: parks are map context that is excluded from every metric in code, and
pedestrian activity is opt-in, off by default, and already has a first-class
unavailable state that shows "No data" rather than a number. Withholding the
whole site because an optional evidence layer was unreachable would reduce
availability without improving honesty. Their *internal coherence* is still
enforced as a hard failure: an "unavailable" pedestrian layer that still carries
station counts, observation totals or a date range fails the build, because that
is fabricated evidence rather than a missing one.

**Guardrails against silent collapse.** A non-empty response is not automatically
valid evidence: a truncated download or an upstream schema change can produce
parseable JSON that is analytically degraded. Each source therefore declares a
`min_count` floor set far below the count observed at calibration, recorded
alongside that baseline, the calibration date and a rationale. These are
**engineering guardrails against an ingestion collapse — not tourism indicators,
and not claims about how many museums, stations or hotels Madrid has.** Changing
one is a visible diff that has to be justified in the pull request that changes
it. There is no upper bound: a source that grows is not degraded.

**What a failure does.** The validator exits non-zero, which fails the job before
`actions/deploy-pages` runs. Nothing is published and GitHub Pages keeps serving
the previous good deployment. The public site does not disappear; it simply does
not advance to a degraded build.

**What happens when the *build* fails.** The validation step carries
`if: ${{ !cancelled() }}`, so it runs even after the build step failed —
otherwise GitHub Actions would skip it and there would be no manifest explaining
why the deployment stopped. The build step's outcome is passed in as
`DEPLOYMENT_BUILD_OUTCOME`, and any outcome other than `success` is itself a
validation error. That matters because a build can fail *after* writing
complete-looking artifacts: the artifacts are never allowed to vouch for the
build. `continue-on-error` is deliberately not used anywhere — it would mark a
failed build successful. The publishing steps carry no condition at all, so once
the job is failing they are skipped, and a failed build cannot become a
deployable state.

**The precise auditability guarantee.** A **data-build failure or an
evidence-validation failure** produces `data/deployment_manifest.json` with
`build_state: "fail"`, uploaded as the `deployment-evidence-audit` workflow
artifact. This is not a claim that every conceivable workflow failure yields a
manifest: a failure before the repository is checked out or before Node is
available (runner or infrastructure failure), or a cancelled run, happens before
the validator can execute and leaves no manifest. Those are visible in the
workflow run itself rather than in an artifact.

**The audit manifest.** It records, per layer: what was built, from which
authority, by which builder, its provenance state, for what scope and period, how
many records, whether the layer was available, its interpretation ceiling, and
the validation verdict with any warnings. On a successful deployment it ships
with the site and can be inspected at `<site>/data/deployment_manifest.json`. It
contains no secrets — the CARTO key is injected in a later step, after the audit
artifact has been collected.

`provenance_state` distinguishes a `deployment_snapshot` (rebuilt from its
authority during this deploy) from `committed_research_evidence` (HATI) and from
the `packaged_sample` fallback, so no consumer of the manifest can mistake the
curated fallback for current authoritative evidence.

`generated_at` (when this build ran) and `source_period` (what the evidence
describes) are deliberately separate fields. A source that publishes no period
records `source_period: null` and `source_period_known: false` rather than being
backfilled with the build timestamp. Only the pedestrian counters (whose records
carry their own dates) and HATI (a fixed modelled pilot day) report a period.

## HATI-Madrid thermal evidence (`data/hati_assets.json`)

- **Source repository:** [heat-adaptive-tourism-madrid](https://github.com/soroushkarahrodi79-oss/heat-adaptive-tourism-madrid) (read-only; this project never modifies it)
- **Source commit:** `f02f5f6b6c5645adde94ae658bccbf9829e727e2`
- **Source files:** `data/processed/pilot_assets.csv`, `data/processed/phase2_asset_thermal_exposure.csv`
- **Extraction method:** `scripts/extract_hati_evidence.py`, run against a local checkout of that commit. The script is deterministic and re-runnable; it filters to `indoor_outdoor == "outdoor"` (14 assets) and copies `utci_mean_10m` and `utci_category` verbatim for the three modelled timesteps (12:00 / 15:00 / 18:00) of the single pilot day, 21 August 2023. **No spatial or temporal interpolation is performed.**
- **Full machine-readable record:** [`data/hati_provenance.json`](../data/hati_provenance.json)
- **UTCI stress categories:** official Bröde et al. (2012, *International Journal of Biometeorology*) bands, reused as-is from HATI's own `docs/PHASE2_UTCI_METHOD.md` — not invented for this project.
- **Study-area boundary:** copied from HATI source file `src/define_study_area.py` at the pinned commit: latitude 40.4040–40.4210, longitude -3.6960–-3.6775, a rectangular Prado–Retiro–Atocha pilot of ≈3.5 km². The UI renders this as a dashed boundary for orientation only. It is not a thermal surface; evidence remains limited to the 14 sampled points.
- **Governance:** HATI's Layer A (release artefacts) is `RELEASE_LOCKED` and Layer B (post Gate-3B research) is `RESEARCH_FROZEN`. This project only reads published, locked evidence and does not extend or re-run the HATI pipeline.

## Canonical administrative geography (`data/geography/madrid_admin.geojson`)

The territorial backbone every future Madrid City dataset joins against
(Padrón, accommodation, VUT, restaurants, housing, socioeconomic and
environmental indicators). It is **reference geography, not an analytical
metric**, and is kept clearly separate from the circular-Lens measurements.

- **Authority:** Ayuntamiento de Madrid — IDEAM (Infraestructura de Datos
  Espaciales del Ayuntamiento de Madrid), served through the official ArcGIS
  map service `sigma.madrid.es/.../CARTOGRAFIA/LIMITES_ADMINISTRATIVOS/MapServer`
  and catalogued on datos.madrid.es as *Distritos municipales de Madrid*
  (dataset 300497) and *Barrios municipales de Madrid* (dataset 300496).
  OSM, Google, hand-drawn or scraped boundaries are deliberately **not** used.
- **Hierarchy:** municipality → 21 districts → 131 barrios (verified against the
  authority on 2026-09-29). Official identifiers are preserved: districts use
  `COD_DIS_TX` (zero-padded, `01`–`21`); barrios use the 3-digit `COD_BAR`,
  prefixed by their parent district code. Names are never used as identifiers,
  and no numeric ids are invented. Each barrio declares its parent district in
  `parent_id`; the attribute hierarchy is cross-checked against geometry
  (every barrio's interior point falls inside its parent district).
- **CRS:** the source publishes EPSG:25830 (ETRS89 / UTM zone 30N); the builder
  requests `outSR=4326`, so the map server reprojects to WGS84 (CRS84, lon/lat)
  server-side. No client-side reprojection.
- **Geometry validity:** at build time every rounded district and barrio is
  checked for real `shapely` validity (non-empty, polygonal, `is_valid`); the
  build **fails** on any invalid feature rather than silently repairing the
  official geometry. Every barrio is additionally required to be exactly
  `covers()`-contained by its declared parent district (no tolerance). The
  attribute hierarchy stays authoritative; geometry is the consistency check.
- **Municipality boundary:** the service's *término municipal* layer is a
  polyline, so there is no published municipality polygon. The municipality is
  therefore **derived** as the topological union of the 21 official district
  polygons (`shapely unary_union`) and flagged
  `DERIVED_FROM_OFFICIAL_GEOMETRY`; the districts remain the authoritative
  source geometry. The union is required to be valid and is coherent (districts
  tile the municipality with no overlaps or gaps, relative area difference
  ~1e-15).
- **Build method:** `scripts/build_madrid_geography.py`, deterministic and
  re-runnable. Coordinates are rounded to **7 decimal places (~1.1 cm)** to keep
  diffs stable — rounding only, no vertices removed, no simplification. (6 dp was
  tried first but collapsed near-coincident vertices in three official features
  into ring self-intersections; the builder caught it, and the precision policy
  was moved to 7 dp at which every official feature stays valid — a documented
  policy change, not a repair.) Like the HATI evidence it is **committed, not
  rebuilt at deploy time**: administrative boundaries are not "live" and are
  never made to look fresh because the builder ran.
- **Version vs catalogue date vs build time (three separate concepts):** the
  authority publishes a dataset **version** — *Distritos* **v3.2.1**, *Barrios*
  **v3.4.1** (from the official "Versión de los datos" description) — recorded as
  `source_version.datasets[*].published_version`. The CKAN catalogue's
  metadata-modified date is recorded separately as `catalog_metadata_modified`
  and is **not** the geometry's edition or effective date. The builder's
  retrieval time is `retrieved_at`. No effective date of the geometry is
  published, so the geography carries **no source period** (`source_period` is
  null); a future join cites the version, e.g. "Padrón period X joined to Madrid
  barrio geography **v3.4.1**", never a catalogue timestamp.
- **Full machine-readable record:** [`data/geography/madrid_admin.meta.json`](../data/geography/madrid_admin.meta.json).
- **Licence:** CC BY 4.0 (© Ayuntamiento de Madrid) — see the licensing boundary below.
- **Point-in-polygon:** `js/geography.js` provides a pure, tested containment
  layer (barrio/district for a coordinate, `null` outside Madrid). `resolve()`
  is the hierarchy-coherent lookup the interface uses: it matches the barrio and
  then reads the district from that barrio's own declared parent, so a profile
  can never pair a barrio with a district it does not belong to.
- **Consumed by:** the **Area Profile** (see `docs/METHODOLOGY.md`). Each Lens
  centre is resolved to its official barrio and district, and the containing
  barrio is outlined on the map as administrative reference geometry.
- **Deployment gate:** **blocking**. A broken or truncated geography would
  publish confident wrong place names, so the site is withheld rather than
  degraded. The Node and Python suites enforce the same structural contract on
  every push.
- **Interpretation ceiling:** administrative reference for spatial joins and
  containment only — never a denominator on its own, and administrative-area
  statistics must never be spatially distributed into a Lens or any sub-area.
  This municipal geography is **not** Comunidad de Madrid geography.

## Residential population denominator (`data/population/madrid_population.json`)

The authoritative, period-explicit resident-population denominator for every
canonical barrio, with deterministic district and municipality totals. It is a
**denominator only** — this layer defines no tourism indicator, ratio, density or
composite score.

- **Authority / source:** Ayuntamiento de Madrid — Subdirección General de
  Estadística, dataset *"Población por distrito y barrio a 1 de enero"*
  (datos.madrid.es dataset 300557), whose own description names the underlying
  register as the *Padrón Municipal de habitantes*. CC BY 4.0. Chosen over the
  monthly *Padrón municipal* (200076) because it has an explicit 1-January
  reference date, is published at exactly district and barrio level, and exposes
  `num_personas` as the barrio total (no sex/age aggregation, so no
  double-counting risk).
- **Population concept:** persons registered in the municipal Padrón for the
  reference date.
- **Reference period:** the source's own **1 January** date (e.g. `2026-01-01`),
  recorded as `source_period.reference_date`. The builder selects the latest
  annual reference date whose barrio coverage exactly matches the canonical
  geography, so a partial year is treated as incomplete rather than "latest". The
  period is source-derived and **never** the build time; the builder's retrieval
  time is recorded separately as `retrieved_at` in the meta. Pass `--period YYYY`
  to pin a historical year.
- **Dimensions:** the source has one row per (barrio, reference date) and one
  total column; no aggregation over sex or age is performed. Sex/age breakdowns
  are out of scope for this denominator.
- **Join to canonical geography:** by **official code only**, never by name and
  never fuzzy. Source `cod_distrito`/`cod_barrio` are zero-padded (`1`→`01`,
  `11`→`011`) to the canonical `official_id`s and then checked exactly against
  the geography; a wrong mapping fails the build. All **131** canonical barrios
  reconcile with no missing, extra, duplicate or parent mismatch.
- **Aggregation:** district totals are the exact sums of their barrios and the
  municipality total is the exact sum of the 131 barrios, both flagged
  `DERIVED_FROM_BARRIO_POPULATION`; barrio counts are `SOURCE_REPORTED`. This
  dataset publishes no independent district/municipality total at the same
  period/semantics, so there is nothing to cross-check the derived totals against
  and none is invented.
- **Geography-version linkage:** the meta records the geography versions this
  joins against (barrio **v3.4.1**, district **v3.2.1**), distinct from the
  population period, so an audit can state "population period `2026-01-01` joined
  to Madrid barrio geography **v3.4.1**".
- **Evidence type / gate:** `ADMINISTRATIVE_REGISTER`, role `reference`,
  committed (not rebuilt at deploy). **Blocking**, because the Area Profile now
  shows a barrio's registered residents with its reference date. The UI abstains
  when a single figure is absent, but an artifact already broken at build time
  must not reach the public site at all. A broken committed artifact still fails
  the Node and Python suites on every push.
- **Consumed by:** the **Area Profile**, joined by official barrio code to the
  canonical geography. The interface calls it *registered residents* and labels
  its evidence *official register*; the internal enum stays
  `ADMINISTRATIVE_REGISTER`.
- **Full machine-readable record:** [`data/population/madrid_population.meta.json`](../data/population/madrid_population.meta.json).
- **Interpretation ceiling:** registered residents are **not** people physically
  present at a moment, daytime population, tourists, workers present, unique
  mobile-device users, households or housing units. A barrio population belongs to
  the whole official barrio and must **never** be spatially distributed into a
  circular Lens: a Lens may say "the centre is in barrio X, which has Y registered
  residents for period Z", where Y stays a barrio statistic — never the population
  "inside the circle". This is municipal population, not Comunidad de Madrid.

## Licensed tourist-dwelling numerator (`data/accommodation/madrid_vut_licences.json`)

A **numerator only**, admitted by the [Gate B source
audit](ACCOMMODATION_NUMERATOR_GATE_B.md). It computes no ratio, no per-resident
figure and no score, and **nothing in the application reads it**: it is not
declared in `data/source_registry.json`, because that registry declares
deployment roles and this artifact has none yet.

- **Authority / source:** Ayuntamiento de Madrid — **Agencia de Actividades**
  (Subdirección General de Actividades Económicas, Servicio de Licencias y
  Consultas), dataset *"Viviendas de uso turístico con licencia"*
  (datos.madrid.es dataset 300694), CC BY 4.0, updated bimonthly. The dataset
  publishes its own structure document, which is what fixes the semantics below.
- **Universe:** urban-planning **activity licences granted** in the city of
  Madrid for hospedaje use in the tourist-dwelling (VUT) typology. The publisher
  states that **no other hospedaje modality** is included — not tourist
  apartments, hostels, guest houses, hotels, pensions or aparthotels. Every
  record in the audited extract carries `DECRETO_LU = "Conceder"`.
- **Unit of analysis:** one row is one granted licence (`EXPEDIENTE_LU`). The
  source column `Nº VUT` is defined by the publisher as *"the number of
  tourist-dwelling units included in each activity licence"*, so one licence can
  contain many dwellings. The artifact therefore carries **two separate fields** —
  `vut_licences` (COUNT) and `vut_units` (SUM) — which are different indicators
  and must never be given each other's name. Observed: 1025 licences, 1483 units,
  with a single licence covering 48 units.
- **Geography:** the source's own PointZ geometry in EPSG:25830, reprojected to
  EPSG:4326 and resolved by containment against the canonical geography
  (barrio v3.4.1 / district v3.2.1). All 1025 records resolved to a barrio, agreed
  independently by `shapely`, by the application's `createGeographyIndex`, and by
  the official municipal address register (datos.madrid.es 213605) via `COD_NDP`.
  The source `DISTRITO` column is free text (25 spellings for 21 districts) and is
  never a join key; its one disagreement with the geometry is recorded, not
  overwritten.
- **Period:** the source publishes no reference-date field. Recorded instead are
  the resource's publication timestamp and the span of per-record licence grant
  dates (2019-03-06 → 2026-09-02). The build clock is recorded separately as
  `retrieved_at` and is never presented as the source date. **This is not the
  Padrón's 1 January 2026 reference date**, and any future indicator must show
  both periods rather than imply they coincide.
- **Zero semantics:** a barrio with no licence is emitted as `0`, not as missing.
  The source enumerates granted licences for the whole municipality, so absence is
  an observation. This is the one place where the project's "missing is not zero"
  rule does not apply, and the reason is recorded in the sidecar metadata.
- **Full machine-readable record:** [`data/accommodation/madrid_vut_licences.meta.json`](../data/accommodation/madrid_vut_licences.meta.json).
- **Interpretation ceiling:** a count of **granted licences** and of the dwelling
  units they contain. It is **not** all accommodation, **not** all tourist
  dwellings in operation (the extract is cumulative and carries no revocation or
  expiry field), **not** beds, rooms or places, **not** the Comunidad de Madrid
  regional inventory, **not** VUT responsible declarations, **not** platform
  listings, and **not** a measure of tourism pressure, overtourism, saturation,
  carrying capacity, intensity, displacement, burden, impact or attractiveness.
  Counts belong to the whole official barrio and must never be spatially
  distributed into a circular Lens.

## Tourism & mobility POIs (`data/runtime_poi.json` + packaged fallback)

On GitHub Pages the app is **deployment-snapshot first** so markers render immediately without waiting on third-party browser requests. The deployment snapshot is rebuilt from the public sources during Pages deployment. Per layer:

| Layer | Live source | Fallback |
|---|---|---|
| Museums | [Madrid Open Data — Museos](https://datos.madrid.es/dataset/201132-0-museos) | SNAPSHOT SAMPLE: 4 curated records, captured 2026-09-25 |
| Tourist info | [Madrid Open Data — Información turística](https://datos.madrid.es/dataset/201105-0-informacion-turismo) | SNAPSHOT SAMPLE: 2 curated records |
| Accommodation | [Madrid Destino / esmadrid.com — Alojamientos de la ciudad de Madrid](https://datos.madrid.es/dataset/300032-0-turismo-alojamientos) (Spanish XML feed) | SNAPSHOT SAMPLE: 6 curated records if the deployment feed is unavailable |
| BiciMAD | [EMT Madrid open data](https://datos.emtmadrid.es/) | Deployment snapshot generated from the official station GeoJSON; no hand-placed coordinates |
| Metro & Cercanías | [CRTM Open Data](https://datos.crtm.es/) — M4 Estaciones (Metro) + M5 Estaciones (Cercanías) | Deployment snapshot generated from the official CRTM ArcGIS feature services; no hand-placed coordinates |

The Madrid Destino XML also publishes a categorisation block with accommodation
`Tipo` and `Categoria` fields, documented in Madrid Destino's
[XML structure specification](https://datos.madrid.es/FWProjects/egob/Catalogo/Turismo/ficheros/Estructura_DS_alojamientos.pdf). The deployment builder preserves these fields
as source metadata and maps `Tipo` into a small UI-only family
(`hotel`, `hostal`, `apartment`, `hostel`, `guest`, `residence`,
`camping`, or `other`). This normalisation changes only filtering and labels;
it does not reclassify the source record for analytical claims. If the official
feed is unavailable and the app falls back to older curated records without
type metadata, the type selector is disabled rather than guessing a class.

A **SNAPSHOT SAMPLE** is a small, manually curated subset for the study area —
**not a complete inventory**. A count derived from a snapshot layer means
"records present in this sample," not "total records that exist at this
location." Full snapshot metadata (capture date, curation method,
`exhaustive: false` per layer) is in
[`data/snapshot_provenance.json`](../data/snapshot_provenance.json), which is the
authoritative description of where each fallback record came from.

The packaged fallback is **multi-source**, and its upstream sources are not the
same set of authorities the deployment sources use. The museum and tourist
information records were curated from Madrid Open Data, but the **accommodation
records are OpenStreetMap-derived (ODbL, via Overpass), not Madrid Destino /
esmadrid records.** So a fallback accommodation count is not official Madrid
accommodation evidence, must not be read as the authoritative register, and must
not be compared with a deployment-snapshot accommodation count. The deployment
manifest marks this layer `provenance_state: "packaged_sample"` so it cannot be
mistaken for current authoritative evidence. Retiring the OpenStreetMap-derived
accommodation fallback is a separate, separately-reviewable behaviour change.

### Accommodation feed coverage

The accommodation feed is published as **"Alojamientos de la ciudad de Madrid"**,
and its specification describes the content as accommodation of **"la ciudad de
Madrid y alrededores"** — the city of Madrid and its surroundings. It is
therefore neither a strictly municipal register nor a regional one.

The validator checks its coordinates against
`madrid_city_and_surroundings_feed_area`, which is an **integrity envelope only**
(`is_coverage_contract: false`): deliberately loose enough that a record in the
surroundings does not fail the build, while a null-island coordinate, a swapped
lat/lon or a different country still does. Records falling outside the narrower
`madrid_city_area` box are reported as a manifest warning — 4 of 613 on
2026-09-29, the furthest at 40.711 N / −3.994 E — and are **not** filtered,
because narrowing the layer would be an analytical semantics change rather than an
integrity fix.

This envelope must never be read as Comunidad de Madrid coverage. A future
Comunidad de Madrid level will require its own authoritative regional datasets and
must not inherit this feed as a proxy for them.

For CRTM rail data, the deployment builder queries the official station feature
layers only inside the app's central-Madrid envelope
(40.385–40.455 N, -3.745–-3.645 E), requests WGS84 output, and preserves
the station mode and line metadata where provided. Metro and Cercanías must
both load successfully for the combined rail layer to be marked available.

Every point returned to the UI carries an explicit provenance state. The
left-hand layer panel distinguishes deployment snapshots, small curated
fallback samples, live-only fallback results, and unavailable layers. The UI
never presents an unavailable layer as a verified numeric zero.


## Observed pedestrian activity (`data/pedestrian_activity.json`)

- **Dataset:** [Madrid Open Data — Aforos de peatones y bicicletas](https://datos.madrid.es/dataset/300321-0-aforos-peatones-bicicletas).
- **Distribution used:** `300321-0-aforos-peatones-bicicletas-csv` — the latest published permanent pedestrian-counter CSV labelled **Aforos peatones. 2024**.
- **Published semantics:** fixed pedestrian-count stations with records by date and hour. The source dataset is updated quarterly and states that the latest published quarter is provisional.
- **Current temporal ceiling:** the portal currently reports dataset coverage through **30 June 2024**. The app therefore treats this as historical observed evidence, not current/live pedestrian activity.
- **Deployment method:** `scripts/build_pedestrian_activity.py` downloads the CSV during GitHub Pages deployment, normalises documented field-name variants, rejects invalid/negative counts, filters to the same central-Madrid envelope used by the app, and writes station-level sufficient statistics. The current 2024 resource serialises WGS84 coordinates with grouped decimal digits (for example `40.417.386` / `-3.707.141`); the builder normalises those source strings deterministically to `40.417386` / `-3.707141` before applying the geographic bounds.
- **Lens metric:** for permanent counters inside the active lens, the app recombines station `meanObserved × observationCount` and reports the resulting mean observed pedestrian count per published hourly record. It also reports the number of counters and raw observations contributing to the value.
- **Spatial ceiling:** values exist only at published counter locations. The app does **not** interpolate a pedestrian surface between counters.
- **Interpretation ceiling:** counters observe pedestrians, not tourist status. This evidence must not be described as tourist flow, visitor demand, crowding, carrying capacity or overtourism.
- **Analytical isolation:** pedestrian-counter records are kept outside `poiPoints`; they do not change tourism POI counts, accommodation counts, mobility-node counts, category mix, or nearest-feature lists.

## Context-only parks layer

- **Dataset:** [Madrid Open Data — Principales parques y jardines municipales](https://datos.madrid.es/dataset/200761-0-parques-jardines)
- **Deployment resource:** official JSON resource `200761-5-parques-jardines-json`.
- **Scope used here:** records with official coordinates inside the app's central-Madrid envelope (40.385–40.455 N, -3.745–-3.645 E).
- **Role:** cartographic context only. Park records are kept in a separate Leaflet group and are never passed to `poiStatsInLens`; they do not affect counts, category mix, nearest-feature lists, or Lens A/B comparison.
- **Completeness ceiling:** the municipal dataset itself describes the principal/significant parks and gardens, not every green space, median, roundabout, traffic island, or small planted area in Madrid.
- **Interpretation ceiling:** the presence of a park record is not used as a proxy for shade, cooling, thermal comfort, biodiversity, accessibility, quality, or tourist attractiveness.

## Base maps

The UI offers three selectable basemaps: CARTO Positron (light, default),
an Esri hybrid satellite view (World Imagery plus the World Transportation
and World Boundaries and Places reference overlays), and CARTO Dark Matter.
CARTO basemaps retain OpenStreetMap/CARTO attribution; the imagery/reference
stack retains Esri/source attribution in the Leaflet attribution control.

## Licensing boundary

This repository's own MIT license (`LICENSE`) covers its original code and
documentation only. It does not relicense the third-party data or software
listed above — see the [README's License section](../README.md#license) for
the specific terms that continue to apply to Leaflet, Madrid Open Data, Madrid Destino / esmadrid.com, EMT Madrid open data, CRTM open data, and HATI-Madrid
evidence. The canonical administrative geography is published by the Ayuntamiento
de Madrid (IDEAM) under **CC BY 4.0** and its attribution (© Ayuntamiento de
Madrid) is retained in `data/geography/madrid_admin.meta.json`. The residential
population denominator is published by the Ayuntamiento de Madrid (Subdirección
General de Estadística) under **CC BY 4.0**, with attribution retained in
`data/population/madrid_population.meta.json`.


### Madrid accommodation taxonomy

The Madrid Destino XML taxonomy is read from the source fields documented as
`Tipo`, `Categoria` and `SubCategoria`. In the production feed these may
appear as `<item name="...">` entries inside `<extradata>`.

For filtering, the app uses **Categoria** as the accommodation family (for
example `Hoteles`, `Hostales`, `Apartahoteles`, `Pensiones`,
`Albergues`, `Residencias universitarias` or `Camping`). The generic
`Tipo` value such as `Alojamientos` is preserved as source metadata, while
`SubCategoria` is preserved for the source classification such as star/key
level. Unknown source categories remain explicitly `Other / unclassified`;
they are never inferred from the business name.
