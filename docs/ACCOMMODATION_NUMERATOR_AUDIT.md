# Accommodation numerator audit — Gate A

**Verdict: NO-GO for building an administrative accommodation-per-registered-resident
indicator from the *current* Madrid Destino / esMADRID `stay` catalogue.**

This is **not** a NO-GO for any accommodation-vs-resident indicator in Madrid.
That question stays open, pending a feasibility gate on an authoritative source
(see *Path forward*). No indicator, ratio, layer, ranking or score is
implemented here.

- **Question examined:** should the application add a first administrative
  tourism-context indicator of the shape *accommodation establishments per 1,000
  registered residents*, at barrio level, joining the accommodation layer to the
  Padrón denominator?
- **Base:** `main` @ `2c7f720` (after PR #27, Area Profile). Test + Deploy green.
- **Gate A audit run:** 30 September 2026.
- **Scope:** methodology, plus one evidence-contract correction (the `stay`
  source label — see *Correction applied in this PR*). No indicator artifact, no
  deployment-gate behaviour change, no UI change; the `stay` layer's data,
  builder and analytical behaviour are untouched.

This is the "numerator coverage and temporal comparability … handled explicitly"
step that [`METHODOLOGY.md` → *What Area Profile does not do*](METHODOLOGY.md)
deferred, and the evidence behind the standing "computes no ratio between them"
line in [`CLAIMS_AND_LIMITATIONS.md`](CLAIMS_AND_LIMITATIONS.md).

## What the numerator is

The `stay` layer is built by `scripts/fill_stays_from_esmadrid.py` from
`https://www.esmadrid.com/opendata/alojamientos_v1_es.xml`.

- **Authority:** Madrid Destino / esMADRID — the Ayuntamiento's **tourism
  *promotion*** company, and esMADRID.com its promotional destination website.
  This is a curated promotional **catalogue**, not an accommodation register.
  The registry already classifies the layer `evidence_type: OBSERVED`, **not**
  `ADMINISTRATIVE_REGISTER` (which is what the Padrón denominator is).
- **Publication state / period:** the XML publishes **no edition or effective
  date**. The honest consequence, already recorded in the registry: *"Register
  state at the moment of retrieval."* There is no source period to align against
  the Padrón's 1 January 2026 reference date.
- **Record semantics:** one XML `<service>` = one promoted **listing**, tagged
  `Tipo = "Alojamientos"`, `Categoria` (Hoteles / Hostales / Pensiones / …),
  `SubCategoria` (star/key rating — **not** capacity). Coordinates present; no
  administrative geography (barrio/district code) is published.
- **Self-definition:** the catalogue does **not** describe itself as the complete
  administrative stock of Madrid accommodation, and its taxonomy does not include
  the licensed tourist-dwelling (VUT) universe at all.

## Gate A audit run — 30 September 2026

These figures are **observations of one audit run against a deployment
snapshot**, not repository invariants and not integrity thresholds.
`data/runtime_poi.json` and `data/deployment_manifest.json` are **generated at
deploy time and git-ignored** (built by `node scripts/build_runtime_poi.mjs` and
`python3 scripts/fill_stays_from_esmadrid.py`, then validated and uploaded as
deployment evidence); they are not committed source data.

**Methodology of the run:**
Madrid Destino XML → deployment builder (`fill_stays_from_esmadrid.py`) →
canonical Madrid geography (`data/geography/madrid_admin.geojson`) → municipality
containment → barrio point-in-polygon reconciliation (`js/geography.js`,
`createGeographyIndex`).

**Observed in that run** (source snapshot of 30 September 2026):

| Observation | Value |
|-------------|-------|
| Generated listings in the snapshot | 613 |
| Unique source IDs | 613 / 613 (clean identity available) |
| Inside Madrid municipality (point-in-polygon) | 606 |
| Outside municipality | 7 (identified, none reassigned) |
| In-municipality listings resolving to a barrio | 606 / 606 (0 unresolved) |
| Barrios represented | 74 / 131 (heavily concentrated in the tourist core) |
| Category mix | Hoteles 302, Hostales 186, Residencias universitarias 64, Apartahoteles 28, Pensiones 12, Albergues 10, Casa de huéspedes 1, Camping 1, blank 2 |

The spatial reconciliation and the unique-ID identity are the reusable results:
when an authoritative numerator arrives, the canonical join is proven to work.

## Why NO-GO (this source)

The disqualifiers are **direct and qualitative** — the source's nature, not a
numeric completeness comparison:

1. **Authority mismatch.** A per-registered-resident ratio is an
   administrative-flavoured measure. Dividing a **tourism-promotion catalogue**
   by an **administrative population register** pairs two incompatible kinds of
   evidence and lends the numerator an authority it does not have.
2. **No temporal contract.** The catalogue is undated; the denominator is a real
   Padrón reference date (1 Jan 2026). A ratio would imply a comparability the
   sources do not have.
3. **Undefined / non-complete universe.** The catalogue does not define itself as
   the complete administrative stock of accommodation, so a "per 1,000 residents"
   figure built on it cannot claim known completeness.
4. **Heterogeneous universe.** It mixes legally distinct objects — hotels and
   hostales alongside **university residences** (student housing) and
   **campsites** — and its taxonomy omits an entire legal accommodation category
   (licensed tourist dwellings / VUT). Counting these as one "establishments"
   class would be misleading.

A precise-looking ratio can always be produced by dividing two numbers; that is
exactly what this project refuses when the numerator cannot bear it. A NO-GO is a
valid outcome — scientific honesty outranks shipping the PR number.

> **On numbers deliberately not used.** An earlier draft compared ~606 catalogue
> listings with a city-wide accommodation-*places* figure (~151,627). That is not
> like-for-like — listings/establishments versus places/capacity, where one
> establishment carries many places — so it is **not** valid evidence of
> completeness and has been removed. The often-cited ~151,627 places / ~29.9% VUT
> figures are an **Exceltur 2022 estimate** (Atlas de Contribución Municipal del
> Turismo), not current municipal Tourism Intelligence System data, and do not
> describe the 2026 supply structure. The NO-GO does not rely on them.

## What remains valid

- The **`stay` layer stays as an operational map layer** — descriptive POIs a
  Lens can tally inside its circle, exactly as today. Nothing about that use is
  affected.
- The **spatial machinery is proven** (this run): canonical point-in-polygon
  joins the catalogue to barrios cleanly and the source carries unique IDs.
- The **abstention model in `js/area-profile.js`** (missing ≠ zero; whole-barrio
  vs. circle kept separate; same-barrio A/B = one statistic) is the correct home
  for any future barrio indicator.

## Correction applied in this PR

The deployed evidence contract previously overstated this source. Corrected in
`data/source_registry.json` (and, by regeneration, the deploy manifest):

- **Display name:** `Official accommodation establishments` →
  `Accommodation listings (Madrid Destino tourism catalogue)`.
- **Interpretation ceiling:** no longer opens "A count of registered
  establishments"; now describes accommodation **listings** from a
  tourism-promotion catalogue (deployment snapshot of the published XML), **not**
  a complete administrative register, **not** capacity/beds/rooms, **not** legal
  status, **not** complete municipal or regional stock.
- `evidence_type` stays `OBSERVED` (a change to the evidence taxonomy would need
  its own analysis). Data, builder and UI analytical behaviour are unchanged.

## Path forward — two candidate tracks (decide at Gate B, not here)

An authoritative indicator needs a register-grade numerator with a defined
universe, an explicit source period, and deterministic reconciliation to
canonical Madrid barrios. **Two current open-data candidates exist. This PR does
not choose between them.**

### Candidate A — municipal licensed VUT · `datos.madrid.es 300694`

*Viviendas de uso turístico con licencia.*

- Licensed VUT only — urban-planning **activity licences** granted in Madrid
  City; responsible body **Agencia de Actividades**; update frequency
  **bimonthly**; **CC BY 4.0**.
- Explicitly **does not** include hotels, hostels, guest houses, pensions,
  aparthotels, etc.
- Could support an indicator named for what it counts, e.g. **"Licensed tourist
  dwellings per 1,000 registered residents"**. It **cannot** support
  "accommodation establishments per 1,000 residents" unless combined with other
  compatible authoritative universes under an explicitly designed methodology.
- The Geoportal publishes an actual data date, so Gate B should examine its
  **source-period semantics** rather than assume it is undated.

### Candidate B — Comunidad de Madrid official accommodation inventory · `datos.comunidad.madrid`

*Alojamientos turísticos de la Comunidad de Madrid* — authority **Dirección
General de Turismo y Hostelería**. Metadata observed during review: updated
**28 September 2026**, **weekly**, CSV + JSON, fields including `alojamiento_tipo`,
`categoria`, `denominacion`, address components, `cdpostal`, `localidad`,
`signatura`.

**A regional publisher does not put a dataset out of municipal scope.** A source
with regional authority and regional coverage can still support a defensible
**Madrid City** analytical subset when locality/municipality is explicit, the
universe is well defined, Madrid City records can be selected deterministically
(e.g. `localidad`), and the records reconcile to canonical Madrid barrios. So
this is a **high-priority** candidate, not out of scope.

It does **not** automatically solve the indicator. It needs its own feasibility
**Gate B**: authoritative semantics; whether records are active administrative
tourism establishments; the exact universe; whether VUT are included and under
what legal status; the identity semantics of `signatura`; Madrid City filtering;
address quality; deterministic geocoding / spatial reconciliation; source-period
semantics; duplicates; completeness; and compatibility with the Padrón
denominator.

## Deferred (not done here, on purpose)

- **Identity by source ID.** The builder deduplicates by name+coordinates; the
  unique `id` attribute is the authoritative key and should replace it when the
  layer is next touched.
- **Gate B** on Candidate A and/or Candidate B, and any indicator that follows.
