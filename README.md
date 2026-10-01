# Madrid Tourism Intelligence Lens

A spatial-lens web app for exploring **Tourism × Mobility × Urban Climate**
in central Madrid: move a draggable lens across the map and watch local
tourism POIs, mobility nodes, observed pedestrian activity, and bounded thermal evidence recalculate.

## 1. What is this?

A small, static, portfolio-grade geospatial web app. Move a circular "lens"
over central Madrid; it recalculates local counts of museums, tourist
information points, accommodation, BiciMAD stations, and Metro/Cercanías
stations; it can also opt into observed pedestrian-counter evidence and — where
HATI evidence exists — the mean UTCI (a thermal-stress index) from a bounded
research dataset.

## 2. What problem does the spatial lens solve?

Static maps and dashboards force you to look at a whole city at once, or at
one predefined zone. The lens lets you ask a **local, comparative** question
— "what is represented within this exact spatial window, given the evidence
currently loaded?" — and move that question around the map interactively,
including comparing two places at once.

## 3. What can the user explore?

- Move **Lens A** (always on) by dragging it or clicking the map.
- Enable **Lens B** to compare two locations side by side.
- Adjust the lens **radius** (100 m – 5 km).
- Toggle each operational data layer on/off.
- Opt into **observed pedestrian activity** from Madrid's permanent counters;
  the lens reports the mean published hourly count for counters inside the
  lens, explicitly labelled as pedestrian rather than tourist activity.
- Optionally show the official **Principal parks** context layer; it is map context only and never enters lens metrics.
- Opt into **Hospitality & Commercial Context** as one administrative
  choropleth over the 131 official barrios, and switch among the five exact
  Gate F indicators. It remains separate from the Lens circle and A/B compare.
- Opt into the bounded HATI research-evidence layer, then switch its modelled time-of-day (12:00 / 15:00 / 18:00).
- Filter the accommodation layer by accommodation type where the
  Madrid Destino catalogue provides that classification.
- Read descriptive counts, category mix, and the 5 nearest features inside
  the active lens.
- Read the **Area Profile**: the official barrio and district containing the
  active lens's centre, and that barrio's registered residents with their
  Padrón reference date. The barrio is a different geometry from the circle,
  and the interface keeps the two apart — the resident figure describes the
  whole barrio, never the part of it the circle covers.
- Read the **licensed VUT context** for that same whole barrio: the licensed
  tourist-dwelling **units** the Ayuntamiento's Agencia de Actividades
  documents there, the **granted activity licences** they come from, and a
  descriptive **per 1,000 registered residents** figure shown only alongside
  both raw counts. These are licences **granted**, not dwellings in operation,
  and the figure is descriptive administrative supply context — never a
  pressure, saturation or capacity reading, and never ranked or scored.
- Read the **Destination Context**: how hotel demand in the **whole city** is
  changing month by month — hotel travellers and overnight stays for the latest
  published month, their residence composition, a **same-month-previous-year**
  comparison and a 24-month trend. This surface is deliberately **independent of
  the Lens**: it describes the municipality of Madrid, and moving either Lens
  cannot change a single figure on it. Hotel demand is **not** total tourism
  demand.
- Optionally overlay the full lattice of **district** or **barrio** outlines;
  the containing barrio is always outlined, the lattice defaults to off.

## 4. Which datasets are used?

- **Museums** and **tourist information** — Madrid Open Data
- **Accommodation** — Madrid Destino / esmadrid.com accommodation catalogue
  (tourism listings, not an administrative register),
  including its published accommodation type/category fields when present
- **BiciMAD** — EMT Madrid open data
- **Metro & Cercanías stations** — CRTM open data (M4 and M5 station layers)
- **Permanent pedestrian counters** — Madrid Open Data, observed activity evidence
- **Principal municipal parks and gardens** — Madrid Open Data, context only
- **HATI-Madrid outdoor UTCI samples** — a bounded research evidence layer (see below)
- **Administrative geography** (21 districts, 131 barrios) — Ayuntamiento de
  Madrid / IDEAM, the canonical join target for administrative context
- **Registered residents per barrio** — Ayuntamiento de Madrid, Subdirección
  General de Estadística (Padrón Municipal), reference date 1 January 2026
- **Hospitality & Commercial Context** — Ayuntamiento de Madrid, *Censo de
  Locales*, pinned Locales and Actividades snapshots for September 2026. The
  production sidecar contains only municipality/district/barrio aggregates for
  the four Gate F production candidates and the one conditional per-resident
  candidate. These are administratively documented premises, not verified
  operating businesses; the conditional indicator keeps the separate 1 January
  2026 Padrón date visible and is not a tourism-pressure measure. Full contract:
  [`docs/HOSPITALITY_COMMERCIAL_METHOD_GATE.md`](docs/HOSPITALITY_COMMERCIAL_METHOD_GATE.md).
- **Licensed tourist-dwelling (VUT) activity licences per barrio** —
  Ayuntamiento de Madrid, Agencia de Actividades (dataset 300694). A committed
  administrative snapshot of **granted** licences: 1,025 licences covering
  1,483 tourist-dwelling units across the 131 barrios. The source declares no
  reference date, so the interface reports the resource file's observed state
  (September 2026) and never calls it a reference date
- **Monthly hotel demand for the city of Madrid** — Instituto Nacional de
  Estadística, *Encuesta de Ocupación Hotelera* (statistical operation 238), read
  through INE's Tempus3 API. A committed statistical snapshot: 104 contiguous
  months, **2018-01 to 2026-08**, of travellers and overnight stays with their
  residence split. The source unit is the official **punto turístico** `Madrid`,
  which INE defines as a municipality and publishes under municipality code
  **28079** — the same code as the canonical geography

On GitHub Pages, operational POI layers are **deployment-snapshot first** so
the map renders immediately and does not wait on cross-origin APIs. The latest
successful public-source snapshot is generated during the Pages build. A small
curated repository sample is the final packaged fallback where a deployment
source is unavailable. Direct live requests are only attempted when no packaged
data exists. No coordinates are invented. See
[`docs/DATA_PROVENANCE.md`](docs/DATA_PROVENANCE.md).

## 5. What is HATI's role?

[HATI-Madrid](https://github.com/soroushkarahrodi79-oss/heat-adaptive-tourism-madrid)
is a separate, independent research repository studying heat exposure at 28
tourism-relevant assets in central Madrid. This project **reads** 14 of its
outdoor assets' UTCI values (one modelled pilot day, three times of day) in a
read-only, provenance-labelled way — it never modifies HATI, never
extrapolates its values beyond the sampled points, and never carries forward
HATI's own feasibility/recommendation labels. Full extraction details,
including the exact source commit, are in
[`data/hati_provenance.json`](data/hati_provenance.json).

## 6. What does the project NOT claim?

It does not establish tourist pressure, overtourism, carrying capacity,
tourist behaviour, tourist-specific footfall, safety outcomes, tourism quality,
economic impact, causal heat effects, real-time conditions, city-wide HATI
coverage, or a complete inventory of Madrid green space. The hotel-demand series
is **not** total tourism demand, **not** all accommodation and **not** a count of
unique visitors, and nothing explains **why** a figure moved. Full list in
[`docs/CLAIMS_AND_LIMITATIONS.md`](docs/CLAIMS_AND_LIMITATIONS.md).

## 7. How do I run it locally?

No build step, no dependencies. Any static file server works:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## 8. How do I deploy it?

A GitHub Actions workflow (`.github/workflows/deploy-pages.yml`) deploys the
static site to GitHub Pages on every push to `main`. **GitHub Pages must
first be enabled in the repository settings** (Settings → Pages → Source:
GitHub Actions) — this is an admin action the repository owner needs to take
once; it is not done automatically by this PR.

The CARTO basemap key is injected at deploy time from the repository secret
`CARTO_BASEMAP_KEY`; the key is not committed to git. Because this is a
browser-side static app, the deployed key is still visible to visitors, so
restrict it in the CARTO Basemaps dashboard to the GitHub Pages host
`soroushkarahrodi79-oss.github.io`.

## 9. What is the evidence status?

- Museums, tourist information, BiciMAD, Metro/Cercanías and accommodation: live public data
  where the browser can reach it; otherwise a labelled deployment snapshot
  generated during the latest GitHub Pages build. The small curated sample is
  only the last-resort fallback.
- Observed pedestrian activity: **off by default** and explicitly opt-in. It is
  a deployment snapshot aggregated from Madrid's latest published permanent
  pedestrian-counter CSV (2024 published period); it is not real-time and is
  not tourism-specific. No interpolation is performed between counters.
- HATI thermal layer: **off by default** and explicitly opt-in. When enabled,
  it shows locked, model-derived evidence from a single historical pilot day.
  Lenses with zero HATI samples inside them show **"No evidence"**, never a
  fabricated value.
- Destination Context (monthly hotel demand): a **committed statistical
  snapshot** verified at the deployment gate. Each observation carries the
  publisher's own **definitive/provisional** status, and months the publisher
  withheld stay withheld — shown as unavailable, never as zero, and never
  interpolated across. The browser never calls the publisher's API at runtime.
  This surface fails **independently**: if it is unavailable, the Area Profile,
  the Lens metrics, licensed VUT and HATI are untouched.
- Administrative geography, registered residents and licensed VUT: **committed
  artifacts**, not rebuilt when the site deploys, each verified at the
  deployment gate. Each keeps its own period or state and they are never shown
  as one: the geography publishes only a dataset version, the residents a real
  1 January 2026 reference date, and the licensed-VUT source **no reference date
  at all** — for which the interface reports the resource file's observed state
  rather than inventing one. The hotel-demand series is the only temporal
  evidence, and it owns its own period: there is still **no global time
  control**, and no other surface became time-aware.

## 10. Decision utility

Gate G formalizes what the current product can and cannot support as a management aid. Today Lens can support three bounded descriptive questions: same-radius local comparison, whole-barrio administrative context, and municipality-wide hotel-demand monitoring. It cannot rank barrios, measure tourism pressure, infer causality, allocate citywide demand to local areas, or recommend investment/restriction/promotion from the current evidence.

See [Gate G — Decision utility and next evidence increment](docs/DECISION_UTILITY_GATE_G.md).

## 11. What is next?

**Next authorized gate: Gate H — Destination Origin Context source contract.** Gate C0 already marked domestic municipality→Madrid and international country→Madrid origin evidence as USE candidates. Gate H must verify the exact source unit, Madrid geography, temporal semantics, missing/zero handling, origin identifiers and reproducible retrieval before any production UI is authorized.

- After Gate H, continue hardening reproducible AOI snapshots for operational POI layers and verify exact BiciMAD coordinates against the official EMT Madrid source before any BiciMAD fallback is reintroduced.
- Add automated visual regression checks for the map UI.
- Decide, explicitly and separately, whether the **Madrid Destino accommodation
  catalogue** can ever carry a per-resident measure. It still cannot: Gate A
  ruled NO-GO on it, and the licensed-VUT figure that now exists uses a
  different, separately qualified administrative source. A catalogue-based
  ratio remains deliberately absent.
- Decide, as its own design and methodology question, whether the licensed-VUT
  figure should ever be mapped. It is deliberately a panel figure today: a
  choropleth would import normalisation choices, class breaks, legends and
  ranking implications that need their own explicit decision.
- Extend the temporal axis beyond hotels, only where a source can preserve the
  same discipline. The Destination Context now answers "how is hotel demand
  changing", which is deliberately narrower than "how is tourism changing";
  closing that gap needs the tourist-apartment survey, the INE experimental VUT
  series or an origin/destination source, each with its own gate.

## 12. Project structure

```
index.html            entry point
css/app.css            styling
js/lens.js             pure lens geometry + POI statistics (tested)
js/evidence.js          pure HATI evidence statistics (tested)
js/geography.js         pure administrative containment / point-in-polygon (tested)
js/area-profile.js      pure Area Profile model: place, residents, licensed VUT, states (tested)
js/destination-context.js  pure citywide hotel-demand model: period, YoY, trend, states (tested)
js/data.js              deployment-snapshot-first + bounded live fallback loading
js/app.js               Leaflet map + UI wiring
data/                   HATI evidence extract + POI snapshot + provenance
scripts/                source builders (geography, population, VUT, destination) + deployment validator
docs/                   methodology, data provenance, claims & limitations
tests/                  Node built-in test runner, no framework
```

## 13. License

The MIT license in [LICENSE](LICENSE) covers **this repository's original
code and documentation only**. It does not relicense any third-party data or
software this project reads or bundles:

- **Leaflet** (vendored in `assets/leaflet/`) keeps its own upstream license
  — see `assets/leaflet/LICENSE`.
- **OpenStreetMap-derived references** cited in HATI's own asset records remain
  subject to the [ODbL](https://opendatacommons.org/licenses/odbl/) and its
  attribution requirement.
- **Madrid Open Data** (museums, tourist information, administrative geography,
  registered residents, licensed VUT activity licences), **Madrid Destino /
  esmadrid.com** (accommodation), **EMT Madrid open data** (BiciMAD),
  **CRTM open data** (Metro/Cercanías), and **Instituto Nacional de Estadística**
  (Encuesta de Ocupación Hotelera — monthly hotel demand)
  remain subject to the reuse terms published by their respective portals —
  see [datos.madrid.es](https://datos.madrid.es/),
  [esmadrid.com](https://www.esmadrid.com/),
  [datos.emtmadrid.es](https://datos.emtmadrid.es/), and
  [datos.crtm.es](https://datos.crtm.es/) directly; this project
  does not restate or assume a specific license text for them.
- **HATI-Madrid evidence** (`data/hati_assets.json`, `data/hati_provenance.json`)
  remains subject to the source repository's own terms and governance
  (`RELEASE_LOCKED` / `RESEARCH_FROZEN` layers) — see
  [DATA_PROVENANCE.md](docs/DATA_PROVENANCE.md).
