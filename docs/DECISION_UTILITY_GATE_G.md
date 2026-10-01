# Gate G — Decision utility and next evidence increment

**Status:** CLOSED  
**Decision:** **GO TO GATE H — DESTINATION ORIGIN CONTEXT SOURCE CONTRACT**  
**Issue:** #43  
**Date:** 1 October 2026

## 1. Purpose

Lens already contains several evidence surfaces. Gate G asks a different question from the previous data gates:

> **What management questions can the product answer now, and what is the smallest next evidence increment that materially improves those questions without overstating the evidence?**

This gate adds no dataset, indicator, score, ranking, causal claim or policy recommendation.

## 2. The three analytical scales already in the product

The product now has three deliberately separate spatial objects.

| Surface | Spatial object | What it can describe |
|---|---|---|
| Within the Lens | adjustable circle, 100 m to 5 km | POIs, accommodation catalogue records, mobility nodes, observed pedestrian-counter evidence where available, and bounded HATI samples where available |
| Administrative context | whole official barrio containing a selected location | registered residents, granted licensed-VUT counts, and Gate-F Hospitality & Commercial Context |
| Destination Context | whole municipality of Madrid | monthly hotel travellers and overnight stays, residence composition, same-month-previous-year comparison and a bounded trend |

These objects must not be collapsed into one denominator, one score or one implied geography.

## 3. Decision questions supported now

### Q1. How do two candidate local areas differ in the evidence currently represented inside the same spatial window?

**Supported.**

Lens A/B can compare the same-radius circles using descriptive counts for represented tourism POIs, accommodation catalogue records and mobility nodes. Observed pedestrian activity can also be compared where both circles contain valid counter evidence. HATI can contribute only where the locked pilot has sampled evidence.

**Legitimate management use:** shortlist areas for closer inspection, fieldwork or a more specific analysis because their represented local context differs.

**Not authorized:** calling one area better, more attractive, more accessible, more crowded, more successful or more suitable overall. The represented layers are not a complete model of any of those concepts.

### Q2. What administrative tourism and commercial context characterizes the barrio containing a candidate location?

**Supported, with strict scope.**

The Area Profile and Hospitality & Commercial Context can describe the whole official barrio using registered residents, municipal licensed-VUT evidence and the five Gate-F indicators.

**Legitimate management use:** understand the administrative context around a candidate area and identify where closer regulatory, commercial or field investigation may be warranted.

**Not authorized:** tourism pressure, resident burden, overtourism, operating-business counts, carrying capacity, displacement, commercial vitality, tourism intensity or a barrio ranking.

### Q3. How is hotel demand in Madrid changing over time?

**Supported at municipality level.**

Destination Context can report the latest published hotel travellers and overnight stays, residence composition, same-month-previous-year change and the committed 24-month trend.

**Legitimate management use:** monitor the direction and composition of official hotel-sector demand and provide citywide context for planning discussions.

**Not authorized:** total tourism demand, reasons for change, economic impact, spend, tourist pressure, or allocation of the municipality series to any district, barrio or Lens circle.

## 4. Questions that remain unsupported

The following questions are important but the current evidence does not answer them:

1. **Where are tourists actually moving inside Madrid?** Permanent pedestrian counters are not tourist-specific.
2. **Which barrio is under the most tourism pressure?** No pressure construct is authorized, and the current sources have incompatible universes.
3. **Which local area should receive investment, restrictions or promotion?** The product has no validated outcome model and no decision weights.
4. **Are hospitality premises currently operating?** The Censo de Locales evidence is administrative, not verified live operation.
5. **What caused a change in hotel demand?** The temporal series is descriptive.
6. **What is the economic impact of tourism in a barrio?** The product has no local expenditure, turnover or causal economic model.
7. **Can citywide hotel demand be distributed to barrios?** No. The source contains no defensible sub-municipal allocation.

A missing answer must remain missing. Adding more variables does not by itself make any of these claims valid.

## 5. The highest-value missing question

The current Destination Context answers:

> **How much hotel demand is Madrid recording, and how is it changing?**

It does **not** yet answer:

> **Where does that demand come from?**

Gate C0 already identified two non-redundant source candidates as **USE**:

- `TURISMO_INTERNO_MUN_MUN_DL`: Spanish municipality of origin → municipality of destination.
- `TURISMO_RECEPTOR_MUN_PAIS_DL`: country of origin → municipality-level destination.

Both belong in **Destination Context**, not on the barrio map.

Adding origin evidence extends an existing management question instead of creating another isolated layer. It can support source-market monitoring and changes in origin mix while preserving the municipality-level geography.

## 6. Why origin context is next

### Chosen before vegetation and ICU

The Summer 2025 vegetation layer and the 2024 Urban Heat Island layer remain legitimate Gate-C0 `USE` candidates, but they introduce new raster/overlay semantics and would expand a map that already contains several spatial layers. HATI already provides a bounded thermal research surface.

Origin context instead:

- extends an existing Destination Context surface;
- answers a distinct destination-management question;
- requires no invented barrio allocation;
- has lower expected implementation effort than new raster infrastructure;
- adds information not already represented by the current POI, administrative or HATI layers.

### Chosen before another accommodation source

INE experimental VUT and regional accommodation/VUT sources remain different universes from the municipal licensed-VUT evidence. They require a dedicated reconciliation design before comparison. Origin evidence does not require merging incompatible housing or licence universes.

## 7. Gate H authorization

Gate G authorizes **Gate H only**. Gate H is a source-contract and acquisition gate for Destination Origin Context. It does **not** pre-authorize a production UI.

Gate H must settle, independently for domestic and international origin evidence:

1. originating authority and retrieval route;
2. exact destination geography for Madrid;
3. source unit and whether it represents trips, tourists, movements or another published concept;
4. temporal granularity, available period and revision semantics;
5. origin identifier stability and naming;
6. suppressed, missing and zero-value semantics;
7. whether totals and origin components are source-published or derived;
8. reproducible source identity and schema fingerprint;
9. a bounded production candidate that does not expose raw microdata unnecessarily;
10. an interpretation ceiling.

### Stop conditions

Gate H must stop or return MODIFY/NO-GO if:

- Madrid cannot be resolved unambiguously to the municipality;
- the unit cannot be established from source documentation/payload;
- domestic and international sources use materially incompatible temporal semantics that the proposed UI would hide;
- missing/suppressed values cannot be distinguished from zero;
- the retrieval route cannot be reproduced or pinned sufficiently for a committed artifact;
- a proposed implementation would require allocating origin evidence to barrios or Lens circles.

## 8. Production shape, if Gate H passes

A later production PR may extend the existing **Destination Context** with a bounded Origin section. The likely information architecture is:

- domestic origin: a compact source-published distribution by Spanish origin geography;
- international origin: a compact source-published distribution by origin country;
- explicit observation period;
- source unit shown in the UI;
- no local map allocation;
- no ranking language such as “best market” or “most valuable origin”;
- no assumption that origin share explains local spatial patterns.

Exact metrics, number of origins shown, comparison logic and trend treatment are **not decided by Gate G**. They depend on the verified Gate-H payload.

## 9. Product sequencing after Gate H

If Gate H passes, the next implementation should be **Destination Origin Context v1**.

If Gate H fails, the fallback is not “pick another dataset automatically.” The failure should be recorded, then Gate C0 candidates should be reconsidered against the same decision-question test.

## 10. Gate G ruling

**GO TO GATE H — DESTINATION ORIGIN CONTEXT SOURCE CONTRACT.**

The current product already has enough layers to demonstrate spatial exploration. The next useful increment is not another generic map overlay. It is a bounded extension of an existing destination-management question: from **how demand is changing** to **where the measured demand originates**, at the same municipality-level evidence ceiling.
