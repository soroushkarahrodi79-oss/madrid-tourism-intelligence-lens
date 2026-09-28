# Madrid Tourism Intelligence Lens

A spatial-lens web app for exploring **Tourism × Mobility × Urban Climate**
in central Madrid: move a draggable lens across the map and watch local
tourism POIs, mobility nodes, and bounded thermal evidence recalculate.

## 1. What is this?

A small, static, portfolio-grade geospatial web app. Move a circular "lens"
over central Madrid; it recalculates local counts of museums, tourist
information points, accommodation, BiciMAD stations, and Metro/Cercanías
stations, and — where evidence exists — the mean UTCI (a thermal-stress index) from a bounded
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
- Adjust the lens **radius** (250 m – 1.8 km).
- Toggle each data layer on/off.
- Opt into the bounded HATI research-evidence layer, then switch its modelled time-of-day (12:00 / 15:00 / 18:00).
- Filter the official accommodation layer by accommodation type where the
  Madrid Destino feed provides that classification.
- Read descriptive counts, category mix, and the 5 nearest features inside
  the active lens.

## 4. Which datasets are used?

- **Museums** and **tourist information** — Madrid Open Data
- **Accommodation** — Madrid Destino / esmadrid.com official accommodation feed,
  including its published accommodation type/category fields when present
- **BiciMAD** — EMT Madrid open data
- **Metro & Cercanías stations** — CRTM open data (M4 and M5 station layers)
- **HATI-Madrid outdoor UTCI samples** — a bounded research evidence layer (see below)

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
tourist behaviour, safety outcomes, tourism quality, economic impact, causal
heat effects, real-time conditions, or city-wide HATI coverage. Full list in
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
- HATI thermal layer: **off by default** and explicitly opt-in. When enabled,
  it shows locked, model-derived evidence from a single historical pilot day.
  Lenses with zero HATI samples inside them show **"No evidence"**, never a
  fabricated value.

## 10. What is next?

- Build a reproducible, sufficiently complete AOI snapshot per POI layer
  (ideally scripted like `scripts/extract_hati_evidence.py`) so counts stay
  interpretable even when live APIs fail, and verify exact BiciMAD station
  coordinates against the official EMT Madrid dataset before reintroducing
  a BiciMAD fallback.
- Add automated visual regression checks for the map UI.
- Consider a second bounded evidence layer if/when HATI or another source
  publishes one with the same provenance rigor.

## Project structure

```
index.html            entry point
css/app.css            styling
js/lens.js             pure lens geometry + POI statistics (tested)
js/evidence.js          pure HATI evidence statistics (tested)
js/data.js              deployment-snapshot-first + bounded live fallback loading
js/app.js               Leaflet map + UI wiring
data/                   HATI evidence extract + POI snapshot + provenance
scripts/                HATI extraction script
docs/                   methodology, data provenance, claims & limitations
tests/                  Node built-in test runner, no framework
```

## License

The MIT license in [LICENSE](LICENSE) covers **this repository's original
code and documentation only**. It does not relicense any third-party data or
software this project reads or bundles:

- **Leaflet** (vendored in `assets/leaflet/`) keeps its own upstream license
  — see `assets/leaflet/LICENSE`.
- **OpenStreetMap-derived references** cited in HATI's own asset records remain
  subject to the [ODbL](https://opendatacommons.org/licenses/odbl/) and its
  attribution requirement.
- **Madrid Open Data** (museums, tourist information), **Madrid Destino /
  esmadrid.com** (accommodation), **EMT Madrid open data** (BiciMAD), and
  **CRTM open data** (Metro/Cercanías)
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
