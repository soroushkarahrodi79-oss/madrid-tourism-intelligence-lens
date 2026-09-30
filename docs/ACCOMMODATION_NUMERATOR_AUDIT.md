# Accommodation numerator audit — Gate A

**Verdict: NO-GO.** The current accommodation source cannot support a defensible
barrio-level *accommodation-per-registered-resident* indicator. No such ratio is
implemented. This document records why, what stays valid, and what an
authoritative indicator would need.

- **Question examined:** should the application add a first administrative
  tourism-context indicator of the shape
  *registered accommodation establishments per 1,000 registered residents*, at
  barrio level, joining the accommodation layer to the Padrón denominator?
- **Base:** `main` @ `2c7f720` (after PR #27, Area Profile). Test + Deploy green.
- **Date of audit:** 30 September 2026.
- **Scope:** methodology only. This audit writes no indicator artifact, changes
  no deployment gate, and leaves the accommodation (`stay`) layer exactly as it
  is: an operational map layer.

This is the "numerator coverage and temporal comparability … handled
explicitly" step that
[`METHODOLOGY.md` → *What Area Profile does not do*](METHODOLOGY.md) deferred,
and the evidence behind the standing "computes no ratio between them" line in
[`CLAIMS_AND_LIMITATIONS.md`](CLAIMS_AND_LIMITATIONS.md).

## What the numerator actually is

The `stay` layer is built by `scripts/fill_stays_from_esmadrid.py` from
`https://www.esmadrid.com/opendata/alojamientos_v1_es.xml`.

- **Authority:** Madrid Destino / esMADRID — the Ayuntamiento's **tourism
  *promotion*** company, and esMADRID.com its promotional destination website.
  The registry already classifies this layer `evidence_type: OBSERVED`, **not**
  `ADMINISTRATIVE_REGISTER` (which is what the Padrón denominator is), and its
  interpretation ceiling already states the feed is *"neither a strictly
  municipal register nor a Comunidad de Madrid one."* It is a curated
  promotional catalogue, not an accommodation register.
- **Publication state / period:** the XML publishes **no edition or effective
  date**. The registry records the honest consequence: *"Register state at the
  moment of retrieval."* There is no source period to align against the Padrón.
- **Record semantics:** one XML `<service>` = one promoted establishment
  listing, tagged `Tipo = "Alojamientos"`, `Categoria` (Hoteles / Hostales /
  Pensiones / …), `SubCategoria` (star/key rating). Coordinates present; no
  administrative geography (no barrio/district code) is published.

## Evidence — the eight conditions

Reconciliation and identity **pass**; authority, completeness, semantics and
period **fail**. The failing rows are the disqualifying ones.

| # | Condition | Finding | Result |
|---|-----------|---------|--------|
| 1 | Numerator sufficiently authoritative | Tourism-**promotion** catalogue, `OBSERVED`, self-described as not a register | **FAIL** |
| 2 | Belongs to Madrid municipality | 606 / 613 inside; 7 outside (excludable by canonical point-in-polygon) | pass (after filter) |
| 3 | Geography reconcilable to canonical barrios | 606 / 606 in-municipality records join to a barrio; **0 ambiguous / unjoined** | **pass** |
| 4 | Each record understood | Understood, but the universe is **heterogeneous** — includes 64 *Residencias universitarias* (student housing, not tourist lodging) and camping | **FAIL (mixed objects)** |
| 5 | Duplicates do not invalidate counts | **613 / 613 unique source IDs**; a clean authoritative identity rule is available | **pass** |
| 6 | Source period / publication state explicit | No edition date; undated snapshot | **FAIL** |
| 7 | Numerator + denominator presentable without implying temporal identity | Possible only with both periods shown; the undated numerator cannot claim 1 Jan 2026 | conditional |
| 8 | Nameable without implying tourism pressure | A descriptive name is possible | pass |

### Empirical reconciliation (canonical point-in-polygon, `js/geography.js`)

Run against the committed `data/runtime_poi.json` (613 records) and
`data/geography/madrid_admin.geojson` (1 municipality, 21 districts, 131
barrios):

- **Inside municipality:** 606. **Outside (excluded):** 7 — e.g. *AC Coslada
  Aeropuerto*, *Apartahotel TH Las Rozas*, *Hotel Las Gacelas*, and a
  Toledo-province attraction at 39.94 N. None silently reassigned.
- **Barrio join:** 606 / 606 joined, **0** inside-municipality-but-no-barrio.
- **Coverage:** **74 of 131 barrios** carry ≥1 record; 57 carry none. Heavily
  concentrated in the tourist core — **89** records in one Centro barrio.
- **Category mix (in-municipality):** Hoteles 302, Hostales 186, Residencias
  universitarias 64, Apartahoteles 28, Pensiones 12, Albergues 10, Casa de
  huéspedes 1, Camping 1, unclassified 2. A tourist-lodging-only subset (drop
  the 64 residences, 1 camping, 2 blank) would be ~539.

## Why NO-GO

1. **Authority mismatch.** A per-registered-resident ratio is an
   administrative-flavoured measure. Dividing a **tourism-promotion catalogue**
   by an **administrative population register** pairs two incompatible kinds of
   evidence and lends the numerator an authority it does not have.
2. **Non-representative coverage.** The feed lists ~606 establishments. Madrid's
   actual accommodation supply is on the order of **~151,627 tourist places**
   (municipal Tourism Intelligence System), and the feed omits the **entire
   tourist-dwelling (VUT) segment (~30% of supply)** — of which the municipality
   separately licenses ~1,000. A "per 1,000 residents" figure built on this
   would understate supply wherever it is VUT-dominated and would largely track
   Madrid Destino's *promotion* choices, not accommodation stock. Dividing it by
   residents manufactures a precise-looking ratio from a non-representative
   numerator — the pattern this project refuses ("a ratio is not useful merely
   because two numbers can be divided").
3. **No temporal contract.** The numerator is undated; the denominator is a real
   Padrón reference date (1 Jan 2026). A ratio would imply a comparability the
   sources do not have.
4. **Heterogeneous universe.** Counting hotels, student residences and campsites
   as one "establishments" class mixes legally distinct objects.

A NO-GO is a valid outcome. Scientific honesty here outranks shipping the PR
number.

## What remains valid

- The **`stay` layer stays as an operational map layer** — descriptive POIs a
  Lens can tally inside its circle, exactly as today. Nothing about that use is
  affected by this audit.
- The **spatial machinery is proven**: canonical point-in-polygon joins the feed
  to barrios cleanly (606/606, 0 ambiguous) and the source carries unique IDs.
  When an authoritative numerator arrives, the join is ready.
- The **abstention model in `js/area-profile.js`** (missing ≠ zero; whole-barrio
  vs. circle kept separate; same-barrio A/B = one statistic) is the correct
  home for any future barrio indicator.

## What an authoritative indicator would need next

- **A register-grade numerator.** The strongest municipal candidate is
  `datos.madrid.es` dataset **300694 — *Viviendas turísticas (geoportal)***: the
  Ayuntamiento's licensed tourist-dwelling register (CC BY 4.0, geolocated), a
  genuine `ADMINISTRATIVE_REGISTER` with a defined universe. It is narrower than
  "all accommodation" (VUT only), so the indicator it supports must be named for
  what it counts. A hotel/hostal register would come from the Comunidad de
  Madrid's tourism registry (REAT) — **out of municipal scope and not pursued
  here.**
- **An explicit source period** on the numerator, shown separately from the
  1 Jan 2026 denominator.
- **A named, bounded universe** (e.g. "licensed tourist dwellings"), never a
  blended "accommodation establishments" count across legally distinct objects.
- Only then: reconcile → restrict to municipality → join to canonical barrios →
  derive a transparent ratio that always exposes its numerator, denominator and
  both periods, with abstention (not zero) on a missing/zero denominator and no
  arbitrary minimum-denominator threshold.

## Deferred (not done here, on purpose)

- **Relabel the `stay` source.** `display_name: "Official accommodation
  establishments"` overstates authority given the promotional origin; a truer
  label is e.g. *"Accommodation listings (Madrid Destino tourism catalogue)"*.
  This edits a deployment-gated contract (`data/source_registry.json`, its
  manifest and pinned tests) and belongs in its own reviewed change, not a
  documentation PR.
- **Identity by source ID.** The builder deduplicates by name+coordinates; the
  unique `id` attribute is the authoritative key and should replace it when the
  layer is next touched.
- Any indicator built on the **VUT register (300694)**, per the section above.
