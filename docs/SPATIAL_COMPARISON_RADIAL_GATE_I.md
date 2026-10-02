# Gate I — Spatial Comparison & Radial Encoding Contract

**Status:** CLOSED — **GO TO RADIAL COMPARATIVE HALO V1, subject to this contract**  
**Scope:** Methodology and product contract only. No production halo or radius behavior is authorized here.  
**Audited baseline:** `origin/main` at `6ae2b6769bfa6a6331edba8d10510baedb4206c1` (2 October 2026)

## 1. Status and ruling

The existing evidence supports a compact, descriptive radial comparison with at most five candidates: Tourism POIs, Stays, Mobility, Pedestrian activity and UTCI. They are **not five components of one score**. Each must retain its evidence family, unit, geography, period and availability state. Halo marks are a locator and rapid pattern cue; the adjacent panel remains authoritative for exact values and qualifications.

Gate I admits the five only conditionally and per metric as specified below. Tourism POIs, Stays and Mobility are source-record/node presence measures. Their unequal-radius comparison may use represented units per circle km², but only if the two side-specific source states and coverage are comparable; raw counts must remain visible. Pedestrian activity is a counter-observation mean, with counter and observation coverage; it has no circle-area density. UTCI is a same-timestep model-sample mean and a neutral °C difference; it has no percentage encoding. Category Mix, area-profile statistics, Hospitality context, parks, hotel demand and domestic origins are excluded from the halo.

This is not a permission to implement independent radii, a Madrid benchmark, a time comparison, or production UI. The next authorized implementation is **PR 1: halo v1 on the current shared-radius behavior**.

## 2. Why this gate exists

Raw counts answer “how many represented records/nodes fall in this window?” They do not answer “how concentrated is the represented point evidence?” A larger circle normally captures more points. Once radii can differ, counts alone cannot distinguish window size from point concentration. Even a mathematically valid area rate remains a rate of the *loaded represented records*, not a census of actual local supply or activity.

## 3. Current Compare behavior

At the audited baseline, `js/lens.js` declares one shared radius (100 m–5 km, 50 m step, default 900 m). `js/app.js` uses it for A and B. Compare displays B minus A for POIs, Stays and Mobility, with combined layer status annotations (`sample` / `deploy`) and an unavailable dash. Pedestrian comparison is shown only when opted in and both windows have observed counter evidence; it subtracts rounded means. UTCI comparison is shown only when HATI is on and both windows contain model-derived samples; it shows the mean difference in degrees. HATI evidence states are separately shown. This is direct comparison, not area normalization, benchmark comparison, or temporal comparison.

The current deployment data contract says operational layers are deployment-snapshot-first; a curated repository sample may be a non-exhaustive fallback. Stays are Madrid Destino catalogue records, one per listing, and their feed includes Madrid and surroundings. Pedestrian data is optional and can be unavailable. The currently committed pedestrian artifact is explicitly `available: false`; deployment acquisition is not proof of local coverage. HATI is a committed, locked historical pilot: 14 sampled outdoor assets, one day (21 August 2023), with 12:00/15:00/18:00 modelled UTCI values.

## 4. Analytical objects

| Object | Geography | Eligible evidence | Halo ruling |
|---|---|---|---|
| Within the Lens | Exact circular window around a Lens centre | Tourism POIs, Madrid Destino stays, BiciMAD and rail node records, pedestrian counter observations, bounded HATI samples | Only eligible object for this halo |
| Administrative context | Whole official barrio containing a Lens centre | Registered residents; granted VUT licences/units; Hospitality & Commercial Context | Excluded: not circle evidence; never allocate by overlap |
| Destination Context | Whole municipality of Madrid | INE hotel demand; domestic-origin crossings | Excluded: no Lens geography; never distribute locally |

The parks layer is map context only. It is excluded from counts, category mix, nearest features and comparisons. The circle and containing barrio remain separate throughout.

## 5. Candidate metric audit

| Metric | Raw value | Geometry | Equal-radius comparator | Unequal-radius comparator | Halo encoding | Required context | Abstention rule |
|---|---|---|---|---|---|---|---|
| Tourism POIs (museums + tourist information) | Count of represented register records | Point records within circle; two source layers combined | B−A counts, if both component sources have comparable states/coverage | Represented records/km² for each side and their neutral difference/ratio only when data states are comparable; keep both counts | Shared-scale paired count mark at equal radii; area-rate mark at unequal radii | Museum and info source states, total records and radius; explain two layers and catalogue/register incompleteness | Either required source unavailable/incompatible, or sample/deployment status differs materially: withhold comparison and show states; never turn missing into zero |
| Stays / accommodation | Count of Madrid Destino catalogue listing records | Point records within circle; feed includes city and surroundings | B−A represented listing counts only when both use comparable feed/status | **Represented catalogue records/km²**, not accommodation density; retain raw counts | Same as above | Catalogue source state, represented count, radius, one-record-per-listing unit, city-and-surroundings scope | Abstain if source states differ (e.g. curated sample vs deployment snapshot) or either unavailable; no exhaustive-stock claim |
| Mobility | BiciMAD station records + Metro/Cercanías station records | Point/node records; mode records may duplicate interchanges and rail access points | B−A node-record count under comparable states | Optionally represented node records/km² under comparable source state; **MODIFY: do not make density a default halo metric** because node density visually suggests access/service despite being mere record presence | Exclude from V1 halo by default; may admit as small neutral raw paired glyph only at equal radii; unequal radii use explicit counts in panel pending a legibility/interpretation review | Split BiciMAD / Metro / Cercanías counts where available, source states and radius; disclose infrastructure presence only | Any component unavailable/incompatible; no inference from absent feed to zero; do not call access, connectivity, frequency, capacity or service |
| Pedestrian activity | Observation-weighted mean published pedestrians per hourly record | Fixed counter points; not a continuous surface | Difference of unrounded means only when both sides have observed records with comparable source period/semantics | Same direct counter-mean comparison; **never divide by circle area** | Paired means with neutral °? no: pedestrian/hour unit; coverage-state badge; not a spatial density bar | Counter count, observation count, record date min/max on each side, source period/status; explicitly “observed pedestrians, not tourists” | Either side has no counter observations, unavailable layer, incompatible periods/semantics, or mismatched measurement coverage that invalidates comparison: no delta, no interpolation |
| UTCI / HATI | Mean of sampled `utci_mean_10m` values in °C for selected timestep | Discrete sampled outdoor assets inside circle; not a surface | A °C, B °C, Δ °C only for same selected timestep | Same direct sample-mean comparison; radii disclosed; sample count alongside both values. No area normalization | A/B paired neutral temperature marks, shared °C scale; never percentage | Timestep, 21 Aug 2023 pilot, sample count per side, model-derived badge, bounded study-area and sample limitations | If HATI off, timestep differs, or either side has no sample: suppress numeric Δ and show NONE/OFF state; no interpolation |
| Category Mix | Shares among known displayed point categories (Museum, Stay, Bike, Info) | Heterogeneous record categories and nonuniform source universes | Not admitted | Not admitted | No pie, donut, composition ring, or halo segment | Current panel caveats do not create a coherent statistical universe | Exclude entirely from halo and A/B radial comparison |
| Evidence state | Categorical source state, not a magnitude | Per source/layer and per side | Compare state labels, not numbers | Compare state labels, not numbers | Small neutral textual/shape qualifier, never numerical segment | Live / deployment snapshot / sample / unavailable; define source-specific state | If state cannot be established, mark unavailable; never imply zero |

**Decision on Mobility:** It is mathematically possible to divide node records by circle area, but that output would add little defensible interpretation while encouraging a service-access reading. Mobility is therefore **MODIFY**: equal-radius descriptive raw comparison can be shown; no unequal-radius radial density in V1. A future design gate may reconsider a text-only represented-node rate with prominent context, but not call it accessibility.

**Decision on five-metric hypothesis:** Five candidates are audited, but V1 radial marks should be capped at four quantitative families unless a later visual test demonstrates that Mobility can be rendered without crowding or access implications. At current shared radius the admissible candidate set is Tourism POIs, Stays, Pedestrian activity and UTCI; Mobility stays available in the panel. Optional evidence may result in fewer visible marks. The cap is five slots including Mobility only if its contract is respected; the recommended V1 is four.

## 6. Equal-radius comparison

For equal radii, the descriptive difference `B − A` in raw records is legitimate for comparable source semantics and comparable evidence state. Preserve each raw side value. Use an explicit A/B order and signed numeric difference in the panel; on the map use paired lengths that share the same metric scale. For pedestrian and UTCI, use the metric-specific contracts above. Equal geometry does not repair incomplete or mismatched source coverage.

## 7. Unequal-radius comparison

For point-record metrics, retain the raw count and calculate a represented-record rate using each exact circle area only where the source states are comparable:

```text
area_km2 = π × (radius_m / 1000)^2
represented_records_per_km2 = raw_record_count / area_km2
```

Do not compare A’s raw count against B’s density, or mix two comparison modes within one mark. In density mode the primary paired comparator is side-specific represented records/km² on a shared scale; the panel shows each raw count and exact radius beside it. This is eligible for Tourism POIs and Stays, subject to the stops in the table. Mobility density is mathematically defined but not admitted for V1. Pedestrian and UTCI are not area-normalized.

The circle has no valid population denominator. Never infer circle population, allocate barrio residents by area/overlap, or divide circle evidence by whole-barrio or citywide values.

## 8. Valid denominators

The only area denominator admitted for the limited point-record density is the geometric area of the exact circle (assuming the documented circular window on the map; no clipping to municipal or barrio boundaries). Name the result explicitly as **represented records/km²**. It describes point records included in the loaded source within the circle. It is not an estimate of complete real-world supply, attractiveness, intensity, service, pressure or quality.

For Pedestrian, the valid support context is counter/observation coverage and date range, not area. For UTCI, the valid denominator is the number of sampled assets contributing to the mean, not area. Neither is a population rate.

## 9. Invalid denominators

Do not use barrio residents, city population, number of visitors, accommodation beds/rooms, POI totals across all categories, whole-city hotel demand, observed counter count as a proxy for area, or category totals as denominators for unrelated families. Do not allocate any administrative or municipal measure to a Lens. Do not describe catalogue entries/km² as total accommodation density.

## 10. Pedestrian evidence contract

The measure is a weighted mean over published fixed-counter hourly records inside the circle. Counters are spatially discrete and unevenly placed; their catchments are not the circle and there is no interpolation between them. It measures observed pedestrians passing those counters, not tourist activity, continuous pedestrian flow, crowding, current conditions or demand.

Comparison requires valid evidence in both circles and compatible source-period/record semantics. Always show per-side counter count, observation count and observed date range (or clear source-period label). Use unrounded means for subtraction and display rounding consistently. A visible circle with no counters is **no evidence**, not zero passages. Because the bundled data currently declares itself unavailable until a deployment snapshot exists, a halo may omit this mark entirely.

## 11. UTCI comparison contract

Only compare means for the same selected HATI model timestep. Show A °C, B °C and `Δ °C = B − A`; never percent change. Show contributing sample counts, “model-derived,” and the historical pilot date/timestep. The mean applies only to sampled outdoor HATI assets that happen to fall in each Lens. It does not indicate city-wide heat coverage, surface conditions or safety. Missing samples are `NO EVIDENCE`; no interpolation or filling is allowed.

## 12. Category-mix ruling

**Rejected for halo (NO-GO).** Museum records, Madrid Destino accommodation listings, BiciMAD nodes and tourist-information registers are heterogeneous categories with different source universes, completeness and source states. A “share of mapped records” is a descriptive panel calculation among known selected categories only, not a natural composition of Madrid tourism supply. It is not an appropriate radial composition; a pie/donut/ring would overstate a common universe. Keep the existing category-mix card and its missing-category/sample caveats separate from the halo.

## 13. Neutral direction semantics

Use **Lens A**, **Lens B**, metric name, unit, and signed `B − A` in text. Positive means only that B’s displayed measurement is numerically higher; negative means lower. On the map, encode paired magnitudes with a consistent legend and optional small neutral connector/Δ label; do not encode “winner.” Use one neutral palette with separate A/B outlines/positions, never red/green performance semantics. Avoid “up/down” arrows unless the caption explicitly states numerical direction, since a higher value has no universal desirability.

Prohibit better/worse, positive/negative outcome, success/failure, opportunity/problem, good/bad, pressure, hotspot, attractiveness and quality interpretations. Pedestrian and UTCI deltas retain native units; signed mathematics never carries an evaluation.

## 14. Radial encoding contract

- Maximum five metric slots; recommended first implementation: **four** (POIs, Stays, observed Pedestrian, UTCI); Mobility remains panel-only unless separately admitted through a design review.
- Fixed clockwise order from 12 o’clock: **Tourism POIs, Stays, Mobility (if admitted), Pedestrian, UTCI**. A missing metric leaves a labelled gap/state; do not rotate remaining metrics, since order is part of the legend.
- Each segment/glyph encodes one metric’s value only, never an aggregate score. For compare mode, each mark uses A and B paired values and the same scale.
- Exact values, units, radii, denominators, sample counts, source states, timestep and periods remain in the side panel or accessible tooltip/description. The map halo may show compact abbreviated values only if legible without zoom-dependent false precision.
- A and B use a single shared scale per metric. Never scale each Lens independently.
- Equal-radius vs unequal-radius changes are explicit and global for point counts: count mode at equal radii, represented-records/km² mode at unequal radii (POIs/Stays only). Do not animate/interpolate in a way that implies a temporal trend.
- Unavailable or no-evidence slots are outlined/hatched or labelled `—`/`No evidence` without a zero-length value bar. Off is explicitly `Off`, not unavailable. Partial sample/deployment states carry a visible neutral qualifier and remain out of direct comparison if states are incompatible.
- Active Lens may have a stronger outline and interaction handles; inactive Lens remains distinguishable by a second neutral outline/dash. Metric colors and scale never change with active focus.
- At 100 m, halo must not obscure the selected area or other marks; at 5 km, it must not engulf the window or suggest the circumference itself is a measurement boundary for linear values. If minimum readable map-screen radius is not met, collapse marks to a compact badge/leader or hide them with a panel cue; do not stretch the halo away from its Lens without clear linkage.
- Keep zoom behavior stable: no value changes due to zoom; any screen-size adaptation preserves A/B scale, labels and mark order. No basemap-dependent semantic colors.
- Overlapping Lens halos must remain independently attributable (A/B tags, distinct outlines, leader/offset only if unambiguous); when attribution cannot be maintained, suppress halo marks and retain the panel comparison.
- No Chart.js/D3/ECharts is needed for the small fixed glyph set. Avoid gridlines, gradients, shadows, decorative tick marks and other chart junk.

## 15. Shared scaling contract

For A/B in one comparison, choose a documented shared scale per metric. The preferred V1 map scale is **max(A,B)-normalized length** with a visible scale cue and identical mapping for both sides. It supports local pattern comparison but is comparison-local: the same length in two different A/B comparisons may represent different quantities. Therefore exact values stay in the panel and halo length must never be read across separate comparisons.

An explicit per-metric fixed domain would allow across-session comparisons but requires an evidence-backed domain and risks saturation across a 100 m–5 km range; none is established in the current sources. A documented Madrid reference domain is a future research option only. A percentile domain is not available and is not authorized. Zero handling: an observed zero count may map to zero length only when the source is present, comparable and complete enough for that zero to be observed; missing/unavailable is a distinct state, never a zero.

## 16. No-data and abstention states

Keep states distinct: layer off; source unavailable; source present but no points in the circle; partial/sample evidence; deployment snapshot; published observation; model-derived sample. A/ B numerical comparison requires both values and compatible source semantics. Otherwise show no delta and state why, and keep any valid individual side value labelled. Never infer zero from a failed fetch, missing source category, suppressed value, absent HATI sample, counter absence or absent domestic-origin municipality.

## 17. Accessibility and mobile constraints

The halo is supplementary. Provide a screen-reader-readable list in fixed metric order with A value, B value, unit, comparator mode, evidence qualifier and concise interpretation ceiling; do not rely on color, radial position or hover. Preserve keyboard access to Lens controls and all exact values. Touch targets and drag handles must remain separate from small glyphs. On iPad/touch, tap/press-and-hold or an equivalent accessible control must expose the same details without requiring hover. When overlap or available screen area makes reading ambiguous, hide/collapse map glyphs while leaving the full panel summary available. Validate contrast against light, dark and satellite basemaps; use outlines/texture and text labels as well as color.

## 18. Future Madrid-reference benchmark

**Not authorized by Gate I.** A future benchmark gate would need to define the eligible municipal sampling frame; comparable same-radius circle placement and edge clipping; source snapshot/date and completeness harmonization; spatial sampling density and dependence; exclusions/water/municipal boundary treatment; metric-specific distributions; minimum sample size and uncertainty; reproducible artifact/versioning; and wording that does not rank or imply “normality.” Percentiles require a justified reference population and are not an aesthetic scale. No benchmark distribution exists today.

## 19. Future temporal comparison

**No local Lens time series is authorized by current evidence.** POI and accommodation feeds are snapshots/register states without exposed comparable source periods; mobility nodes are current network presence snapshots. Pedestrian data is a published counter record period (currently 2024) and a future time comparison would need repeated, comparable periods with stable counter identity, hour/date aggregation, revision and coverage rules—not the current aggregate snapshot alone. HATI covers one historical pilot day at three modelled times, not repeated comparable days; selected timestep is not a time series. Therefore no local line/trend chart and no fabricated history.

INE hotel demand has a legitimate monthly series but is municipality-wide Destination Context and must not appear on the local halo. Domestic origin context is also municipality-level and thresholded. Censo de Locales history may be studied separately for future administrative-area research; it does not currently authorize circle time series or halo marks.

## 20. Explicit prohibitions

No composite score, ranking, “good/bad” or red/green semantics, tourism-pressure index, attractiveness/service-quality claim, completeness claim for catalogues, density based on population, barrio-to-circle allocation, city-to-circle allocation, category-mix donut, mobility accessibility interpretation, pedestrian area normalization, UTCI percentage change, municipal benchmark/percentile, local trend line from snapshots, cross-source time alignment invented by the interface, or missing-as-zero behavior. Administrative VUT/population and Hospitality context stay on the whole-barrio surface. Destination Context and domestic origins stay municipal.

## 21. Implementation authorization

Gate I authorizes only preparation of a future specification-based **Radial Comparative Halo v1** implementation, with the current shared radius, no new data/library, no score, no radius change, and no independent A/B radius. Implement only after the next PR reviews this document and the actual runtime states; do not force unavailable Pedestrian/HATI marks to appear. V1 should favor the four admitted metric families; Mobility remains panel-only pending explicit review.

## 22. Next step

1. **PR 1 (next authorized):** implement the bounded halo for the current shared-radius Compare mode, using only available compatible circle evidence; exact values and evidence states stay in the panel/accessibility text.
2. **PR 2:** independent Lens A/B radii, as a separate interaction change.
3. **PR 3:** switch eligible point-record marks (POIs and Stays) to represented-records/km² when radii differ, while retaining counts. Keep Mobility raw-only unless a further gate admits its rate.
4. **Future research gate:** define and validate a Madrid same-radius reference distribution before any benchmark/percentile interface.

No item after PR 1 is authorized for implementation by this document; each remains subject to its own review and evidence-state contract.
