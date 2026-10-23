# Hospitality & Commercial Context — choropleth fill: cartographic HOLD

**Status: HOLD.** The value-driven polygon fill and its min–max gradient legend are
suspended. Nothing else changes: the five Gate F indicators, the artifact, barrio
selection, the administrative context card, source attribution, ES/EN copy, and the
shareable-URL metric/barrio state are all preserved. The barrio polygons remain as
outlines (still hoverable and selectable; the value stays readable through the metric
selector and the context card). The switch is the single constant
`VALUE_FILL_ENABLED` in `js/hospitality-context.js`; every fill goes through
`fillIntensity()`.

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
