# Gate J — Independent Lens Radii & Comparison Transition

**Status:** CLOSED — **GO to one integrated implementation PR, subject to the AOI and evidence eligibility rules in this contract.**
**Scope:** Methodology, interaction, state, and implementation contract only. No production radius, statistics, panel, or halo behavior is changed here.
**Audited baseline:** `origin/main` at `6cb7aedc67717c00bfbfd9b7a45ad7d757baea8f` (2 October 2026). PR #51, Radial Comparative Halo V1, is merged.

## 1. Status and ruling

Authorize Lens A and Lens B to have independently adjustable radii in a single future production change. Equality is tested on the clamped integer-metre values. The application has two explicit modes:

- **Equal windows:** raw represented POI and stay record counts are the primary comparators; a raw `B − A` is allowed when the contributing evidence is comparable.
- **Different windows:** represented POI and stay records per geometric circle km² are the primary comparators only when both whole circles lie inside the common authorized Madrid municipality AOI and evidence is comparable. Keep the two raw counts visible. If either circle crosses that AOI, withhold the normalized comparator and its delta; retain any valid side counts descriptively.

The AOI rule resolves the municipal-edge problem without clipping the circle or pretending the available sources cover an undefined area outside Madrid. It defines a narrow represented-record rate, not a complete inventory rate. The Madrid Destino catalogue remains a promotion catalogue with city-and-surroundings scope, not an accommodation census. Its represented-listing rate must never be labelled accommodation density.

For unequal radii, withhold the Mobility `B − A`: show valid per-Lens node counts descriptively and do not substitute node density. Pedestrian means and HATI UTCI means may still be compared in their native units when their evidence-specific conditions are met. Both radii and each metric's evidence coverage remain visible.

Use one radius slider bound to the active Lens, with both radii continuously visible in Compare mode. First enable of Lens B copies Lens A's radius; later disable/re-enable within the session preserves B's radius. Keep Reset active Lens position-only, as it is today.

This gate authorizes no production code. Independent radii, the automatic mode transition, eligible area rates, abstentions, and the corresponding halo/panel state must ship together in one implementation PR (Strategy 2).

## 2. Why independent radii matter

Tourism-management questions can intentionally compare different spatial scales, such as a 500 m local window and a 1.5 km district-scale window. A larger circle usually includes more points. Raw counts alone therefore cannot serve as an equivalent A/B comparison when circle sizes differ.

Independent radii define two different spatial windows. They do not create independent observations: circles can overlap, and a nested larger circle includes the smaller circle's point records.

## 3. Current shared-radius architecture

At the audited baseline, `js/lens.js` defines radius bounds of 100–5,000 m in 50 m steps and a 900 m default. `js/app.js` has one `radius` variable; both Leaflet circle geometries, `statsFor()`, `heatStatsFor()`, and `pedestrianStatsFor()` use it. Compare activates Lens B but does not change the shared radius. The existing reset handler moves the active marker to its default position and pans the map; it does not change radius.

Current Compare rows are Metric / Lens A / Lens B / B−A. The table includes Tourism POIs, Stays, Mobility, Pedestrian, and UTCI. PR #51 adds the four-slot halo (Tourism POIs, Stays, Pedestrian, UTCI); Mobility stays panel-only. The halo positions are screen-space Leaflet markers and currently derive from the shared circle radius. Accommodation filtering rebuilds the stay layer and calls `refresh()`.

## 4. Radius state model

Use one explicit state object, preferably `radii = { A: 900, B: 900 }`, with integer metre values. Do not keep a second hidden shared `radius` global. Define pure, testable helpers for clamping/stepping and the mode:

```text
radiusA = clampLensRadius(radii.A)
radiusB = clampLensRadius(radii.B)
mode = radiusA === radiusB ? EQUAL_RADIUS : UNEQUAL_RADIUS
```

Use the existing inclusive bounds and step: minimum 100 m, maximum 5,000 m, step 50 m, default 900 m. Clamp deterministically, then store an integer metre value. Do not use approximate equality. All geometry and analytics for a Lens must receive the same side-specific radius. A's reset or slider event must never mutate B's radius.

Lens-specific call sites include:

- each Lens circle's `setRadius()` and geometry;
- `statsFor(which)` and point inclusion, including filtered stays;
- `heatStatsFor(which)` and HATI sample membership;
- `pedestrianStatsFor(which)` and counter membership;
- halo screen-space anchor from that Lens's projected circle radius;
- the comparison model's radius/mode/AOI eligibility;
- active slider value, label, and accessible name;
- both visible radius labels and per-side evidence text;
- reset, enable/disable, active-Lens selection, map movement/click, marker drag, zoom, and radius refresh paths.

The circle, count/sample inclusion, halo anchor, comparison denominator, and displayed radius must agree for every Lens at all times.

## 5. UI control contract

Use **one slider controlling the active Lens**. This matches the current A/B active-selection model, limits panel height on iPad, and avoids two competing large range controls. Switching the active Lens updates the same slider to that Lens's stored value; the label and accessible name identify the target, for example “Lens B radius”.

In Compare mode, show both radii at all times in a compact, non-color-only readout, for example **“Lens A · 500 m | Lens B · 1.5 km”**. Do not make users select each Lens merely to discover its radius. The active control may sit beside or below this readout and displays only the active Lens's current radius.

The slider must remain keyboard-operable and touch-operable, with a usable touch target and no hover-only explanation. Tapping Lens A or B selects it; the slider never edits the inactive Lens. Its panel placement must not compete with map dragging. A compact readout plus the active slider is preferable to two simultaneous sliders because both values remain visible while editing remains unambiguous.

## 6. Initial Lens B radius

On the first Lens B enable in a session, copy A's current clamped radius into B before showing B. The two-window comparison therefore begins in `EQUAL_RADIUS`, where existing raw-count semantics still apply. If B is disabled and then re-enabled in that session, preserve B's last radius. This requires an explicit first-enable/session state; do not infer “first” only from the current enabled flag.

## 7. Reset semantics

The audited Reset active Lens action resets **position only**: it restores that Lens's default centre and pans to it. Preserve this behavior. It must not change either radius. Reset A never changes B; reset B never changes A. If a future product asks to reset radius, add a distinct, clearly labelled radius reset or explicitly revise this contract in a separate decision. No surprise radius reset is authorized here.

## 8. Equal-radius comparison mode

When the two clamped integer radii are exactly equal, use `EQUAL_RADIUS`. Show each metric's side values and allow the metric-specific raw/native-unit `B − A` only when its source/evidence compatibility conditions are met. For Tourism POIs and Stays, preserve existing raw represented count comparison semantics. This does not make partial sources complete, align different source snapshots, or turn missing evidence into zero.

The mode label may be compact: **“Equal windows · raw represented counts”**. Mobility's equal-radius raw delta is allowed subject to comparable component source states. Pedestrian and UTCI follow their evidence-specific rules below.

## 9. Unequal-radius comparison mode

When the clamped radii differ, use `UNEQUAL_RADIUS`. For Tourism POIs and Stays, the primary comparator changes to represented records per geometric circle km², but only if both circles are wholly inside the authorized AOI and each side's source evidence is eligible and comparable. Keep raw counts, radii, and density values visible together. Do not mix a raw count on one side with a density on the other.

If the AOI or evidence rule fails, retain available A/B raw counts as descriptive per-window values, but withhold the point-record normalized comparison and its delta. The UI must state why (for example, “circle crosses Madrid AOI” or “source states incompatible”). Mobility keeps per-window raw counts but withholds `B − A`. Pedestrian and UTCI continue under their native-unit contracts; changing radius alone does not invalidate them.

Show a concise mode cue: **“Different windows · POI/stay comparator: represented records/km²”**. The cue must distinguish an available density comparator from an abstained one and must not imply population normalization.

## 10. POI comparator

The Tourism POI family combines represented museum and tourist-information register records. In equal mode, show raw A and B represented-record counts and raw `B − A` if both component sources have compatible states. In unequal mode, show both raw counts and each eligible side's `represented tourism POI records/km²`; the primary delta is density `B − A`, not raw-count delta. No density comparator is eligible if either circle is not wholly inside the AOI, either required source is unavailable/incompatible, or the source states are not comparable. Preserve valid raw per-Lens values even when the delta is withheld.

The measure is only represented records in the loaded source. It is not complete POI density, cultural provision, tourism intensity, attractiveness, pressure, quality, population-normalized provision, or a municipal benchmark.

## 11. Stays comparator

In equal mode, show raw represented Madrid Destino listing counts and raw `B − A` only for comparable source states. In unequal mode, show each raw count and eligible `represented Madrid Destino catalogue records/km²`, with the density difference as the primary comparator. The existing accommodation type filter applies to both numerators; the denominator remains each full circle's geometric area. Recompute both filtered counts, rates, delta, and halo from the current filter state on every filter change. No cached density may survive a filter change.

Call this a **filtered represented catalogue-record rate**, not accommodation density or supply density. The catalogue counts one record per listing, is not an administrative census, has heterogeneous listing types, and does not describe beds, rooms, occupancy, legality, complete municipal stock, or regional stock.

## 12. Mobility ruling

Equal radii: show A/B raw represented node-record counts and allow raw `B − A` only when the BiciMAD and rail source states are comparable. Preserve the component provenance and the ceiling that nodes can duplicate interchanges/access points.

Unequal radii: show each valid raw count as descriptive context but **withhold the numerical A↔B delta**. No node-density replacement is authorized. Unequal circles capture different amounts of space, while dividing by area would imply service/access/connectivity meaning that Gate I did not admit. Mobility remains panel-only in the halo. Never label counts as accessibility, connectivity, service, capacity, frequency, or coverage.

## 13. Pedestrian ruling

Pedestrian activity remains an observation-weighted mean of published hourly records at fixed counters, in native observed pedestrians/hour units. No area density, interpolation, tourist-flow claim, or population denominator is allowed.

Show A/B means and `B − A` only when both Lenses have valid observations and the source period and measurement semantics are compatible. In Compare mode disclose both radii, counter count, observation count, and date coverage (or exact source period) per Lens. This is a set of counters that happen to lie inside each circle, not continuous pedestrian coverage. Different counter sets are expected when the radius changes and do not by themselves prohibit the descriptive mean comparison. No counters/observations is `NO EVIDENCE`, never zero; unavailable or incompatible source evidence withholds the delta while valid side values remain labelled.

## 14. UTCI / HATI ruling

HATI remains the mean of sampled outdoor `utci_mean_10m` values in native °C. In unequal mode, show A mean, B mean, and `B − A` only when the same selected model timestep is used and each Lens contains at least one valid sample. Disclose each radius and contributing sample count, plus the model-derived status and the 21 August 2023 pilot/timestep context. No area normalization, percent difference, interpolation, continuous heat surface, threshold, or performance interpretation is allowed.

Unequal sample counts alone do **not** trigger abstention. They trigger a visible coverage qualifier that gives `nA` and `nB` and says the means summarize different sampled assets/windows. No statistical independence or population representativeness is implied. With a sample on only one side, show the valid one-sided mean and `NO EVIDENCE` on the other; withhold delta. HATI off or mismatched timesteps also withhold the numeric comparison.

## 15. Area denominator

For an eligible side, use the full geometric area of its exact circle:

```text
area_km2 = π × (radius_m / 1000)^2
represented_records_per_km2 = represented_count / area_km2
```

Do not round the radius or area before calculation; format the displayed rate consistently and retain enough precision for a stable difference. No population or source-count denominator is involved. The common AOI eligibility test is a containment test, not a clipped-area denominator. If the circle is not fully contained, do not divide by a partial or full circle to claim a comparable density.

## 16. Source-coverage / municipal-edge problem

The repository source registry describes museums and tourist-information points as municipal registers. Its `madrid_city_area` bounding box is explicitly a loose **integrity envelope**, not an administrative coverage polygon. The repository also carries an official-derived Madrid municipality polygon in `data/geography/madrid_admin.geojson`. The Madrid Destino accommodation source is described as “city and surroundings”; its registry explicitly says its broad coordinate envelope is **not** a coverage contract, four of the 613 observed records were outside Madrid municipality at calibration, and the feed has no defined surroundings polygon. Thus neither the broad envelope nor the listed out-of-bound examples establishes coverage outside Madrid.

**Ruling: use a common authorized AOI equal to the official Madrid municipality polygon for unequal-radius POI and Stays rates.** Both complete circles must be wholly contained in that polygon. This gives a defensible geometric denominator within the stated municipal target geography without clipping. A circle touching or crossing the boundary fails containment and its POI/Stays normalized comparator is withheld. Raw source records inside it may still be shown descriptively. Circles outside source coverage are not repaired by a full-circle denominator.

This is an AOI restriction, not a claim that sources are complete within Madrid. Rates still mean represented source records/km², and the source-state compatibility tests still apply. Do not fabricate a Madrid Destino coverage polygon, infer one from its integrity envelope, extrapolate coverage, or use the entire full-circle area when source coverage is materially outside/unknown. A future change to another AOI or a clipped denominator requires a separate evidence-backed gate; polygon clipping is not implemented or authorized here.

## 17. Halo transition

Keep the current four fixed halo slots. In equal mode, Tourism POI and Stays bars encode raw represented counts. In unequal mode, they encode the eligible represented-records/km² values. Normalize the pair only **after** both values have been converted to the same eligible quantity and pass source/AOI checks; use a shared A/B scale. Never scale raw A against density B. A withheld point metric gets a nonnumeric abstention state, not a zero-length bar.

Carry one compact visible mode cue in the Compare panel and include the active quantity/unit and AOI/evidence abstention reason in the halo's accessible summary. Do not crowd every map slot with `/km²`; do not silently change the denominator. Pedestrian and UTCI slots retain native units and their existing evidence rules. Mobility remains excluded. If overlap, panel-edge, map-edge, or scale collisions make marks ambiguous, suppress the affected halo marks and leave the Compare panel authoritative. Halo position must derive independently from A's or B's circle radius.

## 18. Comparison panel transition

Keep the existing compact Metric / Lens A / Lens B / B−A table; do not add a second large analytical table. Both Lens cells should carry short stacked content where needed:

```text
Lens A: 8 records · 10.2 represented records/km² · r 500 m
Lens B: 21 records · 3.0 represented records/km² · r 1.5 km
B−A: −7.2 represented records/km²
```

The mode cue states the active comparator and the AOI eligibility at a glance. Use side-by-side columns on iPad with compact line wrapping; avoid nested scroll in the table where possible. Raw counts never disappear in density mode. If density comparison is withheld, preserve raw values and use a short textual reason in the delta cell/evidence note. A small qualifier can explain nested/overlapping windows. Exact values, units, radii, statuses and coverage counts remain readable without hover.

## 19. Nested and overlapping windows

Overlapping circles are valid analytical windows. Equal or unequal radii do not create independent samples. Same-centre/different-radius comparison is explicitly supported as a nested-window question: point records in the smaller circle are also present in the larger circle, so the measurements are dependent. Do not describe a density/count difference as a comparison of independent areas or samples.

The panel may show a compact **“overlapping windows”** or **“nested windows; records may be shared”** disclosure when applicable. Do not suppress a comparison merely because circles overlap or share a centre. Halo attribution is a separate screen-space issue: if the two halo marks cannot be unambiguously attached to their own circle boundaries, suppress/offset them under existing collision rules while keeping both circles and the panel comparison valid.

## 20. Accessibility / iPad

The accessible Compare summary must state both radii, equal/different mode, each metric's active unit/comparator, raw side values as context, source/AOI qualification, and every withheld delta with its reason. It must not rely on color, position, hover, or a hidden tooltip. For example, in valid POI density mode: “Lens A radius 500 metres; Lens B radius 1.5 kilometres. Different-size windows. Tourism POIs: Lens A 8 represented records, 10.2 represented records per square kilometre; Lens B 21 represented records, 3.0 represented records per square kilometre. Difference minus 7.2 represented records per square kilometre.”

Both radius values stay visible; tapping A/B selects the slider target; the slider name/value follows active Lens; keyboard and touch can operate all controls. Preserve comfortable touch targets and separate map drag from slider interaction. Do not require hover. If a comparison is withheld, the reason is spoken in the summary.

## 21. Performance architecture

The current `refresh()` redraws both circles, active-Lens metrics, Compare metrics, halo layout, area context, and marker shading. Implement side-specific radii with correctness first. Then keep updates scoped where practical:

- changing A's radius updates A geometry, A's point/pedestrian/HATI selection, both-side comparison derivation that depends on A, A halo anchor, active labels, and needed marker shading;
- changing B's radius does the corresponding B work plus comparison derivation;
- map movement updates only geometry/anchors and location-dependent evidence that actually changed;
- zoom/layout updates halo projection/collision only;
- stay-filter changes rebuild the filtered stay points and invalidate/recompute both stay counts, densities, comparison, and halo;
- source/timestep changes invalidate only their dependent statistics and renderers.

Do not rebuild unrelated source/map layers, recreate halo markers, or attach duplicate listeners for each radius. Do not let cache keys omit Lens identity, radius, or stay filter. Avoid premature micro-optimization if it complicates consistent geometry and evidence state.

## 22. Abstention states

Keep states distinct: `OFF`; source `UNAVAILABLE`; source present but no records (`0` only when the source makes that zero observable); partial/sample or deployment snapshot; incompatible source states; circle outside/crossing the normalized-comparison AOI; pedestrian `NO EVIDENCE`; HATI `NO EVIDENCE`; and halo visually suppressed. A valid raw side count may remain visible when a comparison is withheld. A valid HATI/pedestrian side mean may remain visible when the other side is absent. A valid denominator never repairs missing or incompatible source evidence.

## 23. Explicit prohibitions

No circle population; no POIs, Stays, or Mobility per resident; no proportional allocation of barrio population by circle overlap; no use of whole-barrio or whole-city population as a circle denominator; no clipping or fabricated outside-coverage polygon in this gate; no density for Mobility; no pedestrian or UTCI area normalization; no tourist-flow claim; no continuous counter or heat surface; no completeness, capacity, attractiveness, quality, accessibility, pressure, intensity, benchmark, ranking, good/bad, or performance claim; no missing-as-zero; no raw-count delta for POI/Stays in unequal mode; no numerical Mobility delta in unequal mode; no independent-sample language for overlapping/nested windows; and no silent halo unit switch.

## 24. Implementation sequence

Choose **Strategy 2: one integrated production PR**. Independent radii without the automatic comparison transition would create a knowingly incomplete mode and risk showing raw POI/Stays or Mobility deltas for differently sized circles. Ship the two radius states and active slider, exact equal/unequal mode, AOI/source-aware POI and Stays comparator, Mobility unequal-radius delta abstention, native-unit Pedestrian/UTCI behavior, panel/accessibility transition, radius-specific halo anchoring and density cues together. Add pure tests for radius clamping/mode, areas/rates, AOI containment eligibility, source states, stay filter invalidation, comparisons, and halo inputs. Visual review should cover 100 m A / 5 km B, same centre/nested circles, overlaps, map edges, panel collision, zoom, and iPad touch/keyboard operation.

This gate is documentation-only. The next implementation PR must not precede review of this contract and must not ship an intermediate independent-radius state with invalid deltas.

## 25. Canonical comparison table

| Metric | Equal radius | Unequal radius | Raw value retained? | Primary comparator | Delta allowed? | Halo behavior | Abstention condition |
|---|---|---|---|---|---|---|---|
| Tourism POIs | A/B represented record counts | Represented tourism POI records/km² only when both circles are fully inside Madrid AOI and sources are compatible | Yes, both counts | Raw records at equal radii; represented records/km² at unequal radii | Yes, matching mode only; no unequal raw-count delta | Count bars equal; density bars unequal; shared A/B scale after conversion; show mode cue | Source unavailable/incompatible, unequal circles outside AOI, or required count absent |
| Stays | A/B represented Madrid Destino listing counts | Filtered represented catalogue records/km² only when both circles are fully inside Madrid AOI and sources are compatible | Yes, both filtered counts | Raw listings at equal radii; represented catalogue records/km² at unequal radii | Yes, matching mode only; no unequal raw-count delta | Count bars equal; density bars unequal; filter and mode update together | Source unavailable/incompatible, unequal circles outside AOI, or required count absent |
| Mobility | A/B represented node-record counts | Side counts descriptive only; no normalized comparator | Yes | Raw represented node count; unequal-radius primary comparison withheld | Equal radii only, with comparable component states; never unequal | Excluded, panel-only | Component unavailable/incompatible; unequal-radius delta withheld |
| Pedestrian | Native observed pedestrians/hour means | Same native means; different counter sets are disclosed | Yes, means plus counter/observation counts and dates/period | Observed counter mean in pedestrians/hour | If both sides have valid observations and compatible period/semantics | Existing paired native-unit marks only when both valid | Off/unavailable/no observations/incompatible evidence; withhold delta, not valid side mean |
| UTCI | Same-timestep sampled mean °C | Same-timestep sampled mean °C; disclose radii and each sample count | Yes, means plus sample counts | Mean UTCI °C for the selected timestep | If HATI is on, timestep matches, and both sides have ≥1 sample | Existing native °C markers; visible unequal-n qualifier; no area scaling | HATI off, timestep mismatch, or either side has no sample; withhold delta, not valid side mean |

## 26. State-transition table

All rows assume the metric-specific source/evidence conditions above. Point-record rates/deltas additionally require both complete circles to be inside the authorized Madrid municipality AOI.

| A radius | B radius | Comparison mode | POI/Stays | Mobility | Pedestrian | UTCI |
|---|---|---|---|---|---|---|
| 900 m | 900 m | Equal windows | Raw represented counts and eligible raw `B−A` | Raw node counts and eligible raw `B−A` | Native means and eligible `B−A` | Same-timestep °C means and eligible `B−A` |
| 500 m | 1,500 m | Different windows | Raw counts retained; eligible records/km² and density `B−A`; otherwise AOI/source abstention | Show side counts; withhold `B−A` | Native means/coverage and eligible `B−A` | Native same-timestep means/sample counts and eligible `B−A` |
| 100 m | 5,000 m | Different windows | Same rules; 5 km circle often fails AOI containment, in which case no density comparator | Show side counts; withhold `B−A` | Native means/coverage and eligible `B−A` | Native means/sample counts; unequal `n` is a qualifier, not by itself abstention |
| Same centre, e.g. 500 m | 2,000 m | Different, nested windows | Same eligible density rule; disclose nested/dependent windows | Side counts only; withhold `B−A` | Native means with per-side counter coverage | Native means with per-side sample coverage |
| Overlapping circles | Different radii | Different windows | Same eligible density rule; overlap does not invalidate geometry; disclose shared-window dependence | Side counts only; withhold `B−A` | Native comparison if evidence compatible | Native comparison if same timestep and both sampled |

## 27. Gate ruling

**GO to the integrated independent-radius implementation described in this document.** The evidence supports a bounded represented-record rate because the official municipal polygon supplies a defensible AOI and the future rule requires the entire circle to be inside it. For circles crossing the AOI, the rate abstains instead of dividing by an area that includes geography outside the defined source target. Madrid Destino records remain a non-exhaustive city-and-surroundings catalogue; the AOI restriction permits only a rate of its represented records within an in-municipality circle and does not claim complete accommodation density.

The present main branch does not yet contain independent radii, area-rate comparison, or unequal-radius abstentions. PR #51 is merged and the audited baseline is clean. Implementation requires a single integrated PR with no production change in this gate.
