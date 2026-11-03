# Hospitality & Commercial Context — choropleth fill: cartographic HOLD

**Status: HOLD for four of five indicators; the membership share is reactivated**
(see the [Reactivation record](#reactivation-record--membership-share) at the end).
The value-driven polygon fill and its min–max gradient legend remain suspended for
`source_included_premises_count`, `core_hospitality_premises_count`,
`accommodation_class_premises_count` and `core_hospitality_premises_per_1000_residents`.
Nothing else changes: the five Gate F indicators, the artifact, barrio selection, the
administrative context card, source attribution, ES/EN copy, and the shareable-URL
metric/barrio state are all preserved. For held indicators the barrio polygons remain
as outlines (still hoverable and selectable; the value stays readable through the
metric selector and the context card). The switch is the explicit allowlist
`FILL_INDICATOR_IDS` in `js/hospitality-context.js` (there is no global flag); every
fill goes through `fillClass()`.

## Why

Gate F (`HOSPITALITY_COMMERCIAL_METHOD_GATE.md`, F.15) admitted five indicators as
*values*; it states that neither readiness class "is a UI authorisation", and it
ruled the **area denominator NO-GO** (gross-area land-use bias). The shipped fill
applied one undifferentiated encoding to all five indicators: a **linear min–max
ramp of one purple hue at ~0.34 fill opacity**, with no class breaks and a two-number
legend. No review of classification, legend or misreading risk was ever recorded.

The five approved indicators are three absolute counts, one percentage and one
per-1,000-residents rate. Barrio values (n = 131, Sep 2026 snapshot):

| Indicator | Type | min / median / max | Verdict as polygon fill |
|---|---|---|---|
| `source_included_premises_count` | absolute count | 32 / 1,206 / 5,018 | **Not defensible.** Raw count over polygons of very unequal area and size; shows where barrios are large or dense. |
| `core_hospitality_premises_count` | absolute count | 3 / 120 / 616 | **Not defensible.** Same area/size confound; right-skewed. |
| `accommodation_class_premises_count` | absolute count | 0 / 21 / 1,239 | **Not defensible.** Max ≈ 59× median, so a linear ramp leaves nearly all barrios indistinguishable; the class is heterogeneous (Division 55), not capacity. |
| `core_hospitality_membership_share_of_populated_taxonomy_premises` | administrative proportion | 6.5 % / 14.0 % / 31.5 % | **Closest candidate, still unreviewed.** A share suits a choropleth in principle, but its denominator (populated-taxonomy premises, includes `SIN ACTIVIDAD`, not verified operation) and non-exclusive membership need reviewed classes and legend. |
| `core_hospitality_premises_per_1000_residents` | resident-denominated rate | 0.84 / 4.4 / 63.8 | **Not defensible yet.** Small-resident barrios give extreme rates that dominate a linear ramp; dual-dated (Sep 2026 / 1 Jan 2026); invites the "tourism pressure" reading the gate forbids. |

Tourism-pressure, saturation, overtourism and operating-business readings are
unsupported for all five and must not be implied by a map.

Normalisation was **not** assumed to make a metric choropleth-suitable: even the
share and the rate fail on the encoding (no class breaks, no outlier handling, no
legend review), not only on meaning.

## Conditions to reactivate (all required, recorded in a reviewed PR)

Reactivation is per indicator. Replace the global constant with an explicit
indicator allowlist, and record for each enabled indicator:

1. **Indicator meaning and denominator.** Exact wording of what a fill value means,
   its denominator and exclusions. Counts need a defensible rate, or an explicit
   decision that unequal-area counts may be shaded (the area denominator is
   currently NO-GO).
2. **Geographic and temporal comparability.** CURRENT_131 only; one fingerprinted
   snapshot; separate dates stated for any rate; no cross-2017 or cross-edition mixing.
3. **Class breaks and classification method.** A named method (quantile, natural
   breaks, or manual with rationale), the number of classes, outlier and
   small-denominator handling, and the break values shown to the user. No hidden
   linear min–max ramp.
4. **Colour scaling and legend.** A single-hue sequential ramp legible in Light and
   Dark and colour-vision-safe, a class legend listing the real breaks and units, and
   a distinct "no data" swatch. No red/amber/green evaluative colours.
5. **Misinterpretation review.** Written assessment against the interpretation
   ceiling (not pressure, burden, saturation, capacity or operation), with on-map
   copy that states it.
6. **Source limitations.** Censo de Locales caveats (mutable status, ~25 % of
   premises without coordinates, no operation guarantee) stated beside the legend.
7. **Tests.** Update `tests/hospitality_context.test.mjs` and
   `browser-tests/hospitality-fill-hold.browser.mjs` to assert the new approved
   encoding for exactly the enabled indicators and nothing else.

Until then a defensible absence of a map is preferred to an attractive but
misleading geographic claim.

## Reactivation record — membership share

Scope: **only** `core_hospitality_membership_share_of_populated_taxonomy_premises`.
The other four indicators stay on HOLD and `tests/hospitality_context.test.mjs` and
`browser-tests/hospitality-fill-hold.browser.mjs` assert that they produce no fill and
no legend. Evidence below was produced against the committed artifact
(premises SHA-256 `4ca33fed…`, activities SHA-256 `ba9279d6…`, geography CURRENT_131,
barrio v3.4.1). Where a condition is only partly met, it says so.

| # | Condition | Evidence | Status |
|---|---|---|---|
| 1 | Meaning and denominator | Gate F F.8: percentage of source-included premises **with populated taxonomy** (U2, 142,107 premises) that have at least one documented division-56 activity. Non-exclusive membership; U2 keeps populated `SIN ACTIVIDAD` and excludes blank taxonomy (blank share 3.1 %–46.9 % by barrio, F.3). Not verified operation. Shown beside the legend, ES/EN. | Met |
| 2 | Geographic and temporal comparability | CURRENT_131 only; one fingerprinted snapshot (Sep 2026 nominal period); no per-resident rate, so no second date; no cross-2017 or cross-edition mixing. A test asserts the Gate F audit and the artifact carry identical snapshot fingerprints. | Met |
| 3 | Class breaks and method | Five quantile classes: cut = sorted barrio value at index `ceil(k·n/5)`, class = number of cuts ≤ value. Deterministic, no randomness. n = 131, cuts 11.73 / 13.09 / 14.76 / 17.20 %, class sizes 27 / 26 / 26 / 26 / 26 (verified in the browser). No ties at any cut and no null value in the 131 barrios; non-finite values and non-enabled indicators return no class (unit-tested). Legend ranges use `<` on the upper bound so a value equal to a cut is read as the upper class; cuts are displayed to one decimal, so a barrio within 0.05 points of a cut can display the cut value yet sit in the lower class. No outlier capping: the top class spans 17.2–31.5 %. | Met |
| 3b | Small-denominator handling | The share's base per barrio is not in the artifact. The app recovers it as `round(core count × 100 / share)`. This is **not** presented as exact on its own: a test requires it to equal, for all 131 barrios, the exact integer `source_included − blank_taxonomy` in `research/hospitality_commercial_gate/results/gate_f_denominator_audit.json` (`blank_taxonomy_effects.by_barrio`), which is computed from the same fingerprinted snapshot. It matched 131/131; the sum is 142,106, one below the Gate F U2 total because one premises has no barrio code (F.11). The UI still labels the figure approximate (≈). Barrios with base < 200 (10 barrios: 24 to 170 premises) get a dashed outline and a tooltip line. **The threshold 200 is a project heuristic, not a source value.** At the municipal share (13.7 %) the binomial standard error is ≈2.4 points at n = 200, ≈3.4 at n = 100 and ≈7.0 at n = 24; the three middle classes are 1.35, 1.67 and 2.44 points wide. So at n ≈ 200 the standard error already equals the widest middle class, and it stays at or above the narrowest one up to n ≈ 650. At the median base (≈900) it is ≈1.2 points, close to the class widths. **The absence of a dashed outline therefore does not mean a class is statistically separated**: classes are a descriptive ordering of recorded shares, and 200 only marks where the instability is largest. No suppression or winsorisation is applied. | Met, with the limitation stated |
| 4 | Colour and legend | Single-hue purple, five lightness steps, monotonic; class legend lists the real breaks and the unit; Light and Dark inspected on screenshots. **Not done:** a colour-vision-deficiency simulation was not run, and there is no "no data" swatch because no barrio has a null value (0 of 131); a distinct swatch must be added before any indicator with gaps is enabled. No red/amber/green. | Partly met |
| 5 | Misinterpretation review | The ceiling is on the map legend, ES/EN: not pressure, saturation, capacity or operating businesses; it describes the share of recorded premises with a documented division-56 activity, a classification, not trade, occupancy or tourism demand. A high share can arise from a small or blank-heavy base and says nothing about visitors. Population density and the area denominator remain NO-GO and are not used. | Met |
| 6 | Source limitations | Beside the legend: premises status is mutable (a status is the last recorded value, not verified operation), about 25 % of premises have no coordinates, blank taxonomy excluded. Premises are assigned to barrios by source code, so missing coordinates do not remove them from the share (F.11). | Met |
| 7 | Tests | `tests/hospitality_context.test.mjs`: allowlist is exactly the share, other four give no fill, five classes cover 131 barrios, recovered base equals the audit, copy keys exist ES/EN, app routes fill only through `fillClass`. `browser-tests/hospitality-fill-hold.browser.mjs`: share paints 5 distinct classes with a 5-swatch legend, selector labels mark one map and four panel-only metrics, held indicators paint nothing and show no legend, ES/EN notice, Dark at 390 px without horizontal overflow. | Met |

Known limits left unchanged: the native select can truncate the `· map` suffix of a
long label at narrow widths in Light (the option list shows it in full); the browser
test reached `unavailable` once in three runs (hospitality state is decided at load
time against geography readiness, a pre-existing race outside this change).

**Verdict: GO for the membership share only, with conditions 3b and 4 carrying the
limitations above. HOLD continues for the four other indicators.**
