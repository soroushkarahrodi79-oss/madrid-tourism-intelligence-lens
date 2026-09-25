# Methodology

## The core interaction

Every feature in this app exists to answer one question:

> **What changes in the local tourism, mobility and thermal evidence when I move this lens across Madrid?**

A lens (a draggable circle of adjustable radius) defines a local area. Moving
it recomputes a small set of **descriptive** statistics over whatever data
falls inside it. Nothing here ranks locations, scores "quality," or predicts
behaviour — it answers "what is here" and "what does the evidence actually
support here," nothing more.

## Lens statistics

For a lens (center, radius) and the set of points that fall within that
radius (great-circle distance, `js/lens.js:haversineMeters`):

- **Counts** per category (museums, tourist info, accommodation, BiciMAD) — a
  plain tally, not an index.
- **Category mix** — each count as a share of the total POIs in the lens.
- **Nearest features** — the 5 closest points inside the lens, by distance.
- **HATI evidence** — see below.

All of this is computed by pure functions (`js/lens.js`, `js/evidence.js`)
with no hidden state, so the same lens position and radius always produce the
same numbers (see `tests/`).

## HATI evidence layer

HATI-Madrid's outdoor UTCI samples are a **bounded, model-derived evidence
layer**, not a live thermal sensor network and not a city-wide surface. This
project enforces that boundary in code:

- `hatiStatsInLens()` only ever counts and averages the HATI sample points
  that literally fall inside the current lens at the selected timestep.
- If **zero** samples fall inside the lens, the function returns
  `{ evidence: "NONE", mean: null }` — the UI shows **"No evidence"**, never a
  zero, an average of zero, or an interpolated guess.
- There is no code path that estimates a UTCI value for a location without a
  direct HATI sample. Interpolating across the study area would require a new,
  explicitly justified methodology — deliberately out of scope for v0.1.

### UTCI thermal-stress categories

The colour scale (32 / 38 / 46 °C) is the **official published Bröde et al.
(2012)** UTCI stress-category scale, reused unchanged from HATI's own
`docs/PHASE2_UTCI_METHOD.md`:

| UTCI range | Category |
|---|---|
| 9–26 °C | No thermal stress |
| 26–32 °C | Moderate heat stress |
| 32–38 °C | Strong heat stress |
| 38–46 °C | Very strong heat stress |
| > 46 °C | Extreme heat stress |

These are physiological stress categories describing strain on a standardised
human body model — not a tourism recommendation, safety verdict, or
real-time hazard alert.

## Comparison mode (Lens A vs Lens B)

When Lens B is enabled, the app reports the same descriptive metrics for both
lenses side by side, plus a signed delta (`B − A`) for POI counts and — only
when **both** lenses have HATI evidence — a UTCI delta. There is no composite
"winner," overall score, or ranking between the two lenses: a difference in
POI count or UTCI is reported as a fact, not an evaluation. If a layer is
`UNAVAILABLE` (currently: BiciMAD when its live fetch fails), its comparison
delta is shown as "—" rather than a computed difference, since both sides
would otherwise show a meaningless "0 vs 0."

## Data resilience strategy

Public APIs (Madrid Open Data, EMT Madrid, Overpass) can fail from a static
GitHub Pages origin due to CORS, rate limits, or downtime. The app is
**live-first with a repository-snapshot fallback** (Option C) for museums,
tourist info and accommodation: it attempts a live fetch for each layer
independently, and only falls back to a small, explicitly-labelled
**SNAPSHOT SAMPLE** committed in `data/snapshot_poi.json` if that layer's
live fetch fails or returns no data. A snapshot count is always presented as
a sample count, never as if it were a complete, live-verified inventory —
see [DATA_PROVENANCE.md](DATA_PROVENANCE.md).

BiciMAD has no snapshot fallback: an earlier draft included hand-placed,
approximate station coordinates, and these were removed because they could
not be verified against the official EMT Madrid dataset — this project does
not invent or approximate analytical geospatial points. If the live BiciMAD
fetch fails, the layer is reported as **UNAVAILABLE** and the "Mobility
nodes" metric shows "No data" rather than a numeric zero.

HATI evidence is always loaded from the repository (`data/hati_assets.json`);
it is locked historical evidence, not a live feed, so there is no "live"
variant to fall back from.
