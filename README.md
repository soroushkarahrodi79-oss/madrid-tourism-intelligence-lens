# Madrid Tourism Intelligence Lens

A spatial-lens web app for exploring **Tourism × Mobility × Urban Climate**
in central Madrid: move a draggable lens across the map and watch local
tourism POIs, mobility nodes, and bounded thermal evidence recalculate.

## 1. What is this?

A small, static, portfolio-grade geospatial web app. Move a circular "lens"
over central Madrid; it recalculates local counts of museums, tourist
information points, accommodation, and BiciMAD stations, and — where
evidence exists — the mean UTCI (a thermal-stress index) from a bounded
research dataset.

## 2. What problem does the spatial lens solve?

Static maps and dashboards force you to look at a whole city at once, or at
one predefined zone. The lens lets you ask a **local, comparative** question
— "what's actually here, in this exact 900 m radius, right now?" — and move
that question around the map interactively, including comparing two places
at once.

## 3. What can the user explore?

- Move **Lens A** (always on) by dragging it or clicking the map.
- Enable **Lens B** to compare two locations side by side.
- Adjust the lens **radius** (250 m – 1.8 km).
- Toggle each data layer on/off.
- Switch the HATI evidence time-of-day (12:00 / 15:00 / 18:00).
- Read descriptive counts, category mix, and the 5 nearest features inside
  the active lens.

## 4. Which datasets are used?

- **Museums** and **tourist information** — Madrid Open Data
- **Accommodation** — OpenStreetMap (via Overpass API)
- **BiciMAD** — EMT Madrid open data
- **HATI-Madrid outdoor UTCI samples** — a bounded research evidence layer (see below)

All four public-API layers are **live-first with a repository-snapshot
fallback**: if a live source is unreachable from the browser, the app falls
back to a small, clearly labelled static snapshot rather than showing
nothing or silently guessing. See [`docs/DATA_PROVENANCE.md`](docs/DATA_PROVENANCE.md).

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

## 9. What is the evidence status?

- Tourism/mobility layers: live public data where reachable, repository
  snapshot otherwise — labelled per layer in the UI.
- HATI thermal layer: locked, model-derived evidence from a single historical
  pilot day. Lenses with zero HATI samples inside them show **"No evidence"**,
  never a fabricated value.

## 10. What is next?

- Expand the curated POI snapshot beyond the current small sample.
- Add automated visual regression checks for the map UI.
- Consider a second bounded evidence layer if/when HATI or another source
  publishes one with the same provenance rigor.

## Project structure

```
index.html            entry point
css/app.css            styling
js/lens.js             pure lens geometry + POI statistics (tested)
js/evidence.js          pure HATI evidence statistics (tested)
js/data.js              live-first + snapshot-fallback data loading
js/app.js               Leaflet map + UI wiring
data/                   HATI evidence extract + POI snapshot + provenance
scripts/                HATI extraction script
docs/                   methodology, data provenance, claims & limitations
tests/                  Node built-in test runner, no framework
```

## License

MIT — see [LICENSE](LICENSE).
