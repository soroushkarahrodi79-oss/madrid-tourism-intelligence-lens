import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  HALO_METRICS,
  HALO_COMPACT_LABELS,
  HALO_REFERENCE_DEFAULTS,
  HALO_UTCI_FALLBACK_BAND,
  accessibleComparisonSummary,
  buildHaloComparison,
  buildHaloGlyphSpec,
  buildCountPairState,
  computeHaloReferenceScales,
  deriveHaloUtciBand,
  haloDensity,
  haloDensityMagnitude,
  haloUtciMagnitude,
  formatHaloValue,
  haloQuantile,
  circleAreaKm2,
  activityState,
  utciState,
  COMPARISON_RADIUS_MODE,
  representedRate,
  haloLabelAnchorForSlot,
  haloValueAnchorForSlot,
  haloSlotFootprint,
  haloFootprintsOverlap,
  haloLayoutForRadius,
  resolveHaloSlotVisibility,
} from "../js/radial-halo.js";

const AREA900 = Math.PI * 0.81; // km² of a 900 m reference window
const live = (value) => ({ value, sourceState: "live" });
const unavailable = () => ({ value: null, sourceState: "unavailable" });
// Reference DENSITIES (records/km²) for the bars, shared by Lens A and Lens B.
const REFS = Object.freeze({ tourism: 8, stays: 8, mobility: 8, radiusM: 900, quantile: 0.95 });
const BAND = Object.freeze({ min: 30, max: 46 });

const baseInput = (overrides = {}) => ({
  references: REFS,
  utciBand: BAND,
  radii: { A: 900, B: 900 },
  tourism: { a: live(5), b: live(10) },
  stays: { a: live(2), b: live(4) },
  mobility: { a: live(3), b: live(6) },
  utci: {
    enabled: true, timestepA: "15:00", timestepB: "15:00",
    a: { evidence: "MODEL-DERIVED", mean: 36.4, count: 2 },
    b: { evidence: "MODEL-DERIVED", mean: 38.1, count: 3 },
  },
  ...overrides,
});
const pedestrianInput = () => ({
  enabled: true, sourceState: "published", periodKey: "2024",
  a: { evidence: "OBSERVED", meanObserved: 0, stationCount: 1, observationCount: 3, dateMin: "2024-01-01", dateMax: "2024-01-01" },
  b: { evidence: "OBSERVED", meanObserved: 10, stationCount: 2, observationCount: 8, dateMin: "2024-01-01", dateMax: "2024-01-02" },
});

// --- The four V3 perimeter metrics ----------------------------------------

test("V3 halo exposes exactly the four brief metrics in a fixed clockwise order", () => {
  assert.deepEqual(HALO_METRICS.map(({ id, slot }) => [id, slot]), [
    ["tourism", "north"], ["stays", "east"], ["mobility", "south"], ["utci", "west"],
  ]);
  const model = buildHaloComparison(baseInput());
  assert.deepEqual(Object.keys(model.metrics), ["tourism", "stays", "mobility", "utci"]);
  assert.deepEqual(model.order, ["tourism", "stays", "mobility", "utci"]);
  assert.equal("pedestrian" in model.metrics, false);
  assert.equal(HALO_COMPACT_LABELS.mobility, "MOB");
});

// --- Reference DENSITY universe --------------------------------------------

test("reference scales are the p95 of per-feature local DENSITY (records/km²), deterministic", () => {
  const points = [
    // 3 tourism features clustered (<900 m apart) -> each neighbourhood is 3.
    { lat: 40.4168, lon: -3.7038, type: "museum" },
    { lat: 40.4170, lon: -3.7040, type: "museum" },
    { lat: 40.4172, lon: -3.7042, type: "info" },
    // 1 isolated stay far away -> neighbourhood density 1.
    { lat: 40.5000, lon: -3.6000, type: "stay" },
  ];
  const scales = computeHaloReferenceScales(points);
  assert.equal(scales.radiusM, HALO_REFERENCE_DEFAULTS.radiusM);
  // Density = neighbour count / window area, NOT a raw neighbour count.
  assert.ok(Math.abs(scales.tourism - 3 / AREA900) < 1e-6, `tourism density ${scales.tourism}`);
  assert.ok(Math.abs(scales.stays - 1 / AREA900) < 1e-6, "a lone feature floors the density at 1/area");
  assert.ok(Math.abs(scales.mobility - 1 / AREA900) < 1e-6, "an empty metric floors at 1/area (no divide by zero)");
  assert.deepEqual(computeHaloReferenceScales(points), scales, "same input yields the same reference");
});

test("haloQuantile is a deterministic nearest-rank quantile ignoring non-finite values", () => {
  assert.equal(haloQuantile([1, 2, 3, 4], 0), 1);
  assert.equal(haloQuantile([1, 2, 3, 4], 1), 4);
  assert.equal(haloQuantile([10, 20, 30, NaN], 0.5), 20);
  assert.equal(haloQuantile([], 0.95), 0);
});

test("UTCI band is a robust Celsius spread from model assets, with a documented fallback", () => {
  const assets = { 0: { utci_mean_10m: { "12:00": 30, "15:00": 40, "18:00": 50 } }, 1: { utci_mean_10m: { "15:00": 35 } } };
  const band = deriveHaloUtciBand(assets, { lowerQuantile: 0, upperQuantile: 1 });
  assert.equal(band.min, 30);
  assert.equal(band.max, 50);
  assert.deepEqual(deriveHaloUtciBand({}), { ...HALO_UTCI_FALLBACK_BAND });
});

// --- Density-based bar magnitude (the core V3 semantic) --------------------

test("density = rawCount / circleAreaKm2(radius)", () => {
  assert.ok(Math.abs(haloDensity(10, 900) - 10 / AREA900) < 1e-9);
  assert.equal(haloDensity(null, 900), null);
  assert.equal(haloDensity(-1, 900), null);
});

test("bar magnitude is density / referenceDensity, clamped, and monotonic in density", () => {
  // Same reference, same radius: monotonic in raw count.
  assert.ok(haloDensityMagnitude(5, 900, 8) < haloDensityMagnitude(6, 900, 8));
  // Same raw count, SMALLER radius -> higher density -> longer bar (brief B).
  assert.ok(haloDensityMagnitude(5, 500, 8) > haloDensityMagnitude(5, 1000, 8));
  // Counts proportional to area -> EQUAL density -> EQUAL bars (brief C).
  const a = haloDensityMagnitude(2, 500, 8);
  const b = haloDensityMagnitude(8, 1000, 8); // area(1000)=4*area(500), 8=4*2
  assert.ok(Math.abs(a - b) < 1e-9, `area-proportional counts give equal bars (${a} vs ${b})`);
  // Clamp and abstention.
  assert.equal(haloDensityMagnitude(10000, 500, 8), 1, "above-reference density clamps to a full bar");
  assert.equal(haloDensityMagnitude(0, 900, 8), 0, "a genuine zero is a zero-length bar");
  assert.equal(haloDensityMagnitude(null, 900, 8), null, "missing data never becomes zero");
  assert.equal(haloDensityMagnitude(5, 900, 0), null, "a zero reference abstains rather than divides");
});

test("UTCI magnitude maps a Celsius band to 0..1, never area-normalized", () => {
  assert.equal(haloUtciMagnitude(30, { min: 30, max: 46 }), 0);
  assert.equal(haloUtciMagnitude(46, { min: 30, max: 46 }), 1);
  assert.equal(haloUtciMagnitude(38, { min: 30, max: 46 }), 0.5);
  assert.equal(haloUtciMagnitude(60, { min: 30, max: 46 }), 1);
  assert.equal(haloUtciMagnitude(NaN, { min: 30, max: 46 }), null);
});

test("value formatting prints the RAW COUNT with thousands separators, UTCI in Celsius", () => {
  assert.equal(formatHaloValue("tourism", 12), "12");
  assert.equal(formatHaloValue("stays", 1284), "1,284");
  assert.equal(formatHaloValue("mobility", 0), "0");
  assert.equal(formatHaloValue("utci", 31.63), "31.6°C");
  assert.equal(formatHaloValue("tourism", null), null);
});

// --- Per-side bars + shared scale + unequal radii -------------------------

test("each lens shows its own density bar; the printed value stays the raw count", () => {
  const model = buildHaloComparison(baseInput());
  const t = model.metrics.tourism;
  assert.equal(t.aValueText, "5");
  assert.equal(t.bValueText, "10");
  assert.equal(t.referenceDensity, 8);
  assert.ok(Math.abs(t.aDensity - 5 / AREA900) < 1e-9);
  assert.equal(t.aBarMagnitude, haloDensityMagnitude(5, 900, 8));
  assert.equal(t.bBarMagnitude, haloDensityMagnitude(10, 900, 8));
});

test("bar semantics are identical in single, equal-radius and unequal-radius modes (brief F)", () => {
  const poi = HALO_METRICS[0];
  // Equal radius.
  const equal = buildHaloComparison(baseInput({ radii: { A: 900, B: 900 }, tourism: { a: live(5), b: live(5) } }));
  assert.equal(
    buildHaloGlyphSpec(poi, equal.metrics.tourism, "A").magnitude,
    buildHaloGlyphSpec(poi, equal.metrics.tourism, "B").magnitude,
    "equal density -> equal bars at equal radius"
  );
  // Unequal radius, counts proportional to area -> equal bars (same semantic).
  const unequal = buildHaloComparison(baseInput({ radii: { A: 500, B: 1000 }, tourism: { a: live(2), b: live(8) } }));
  const ua = buildHaloGlyphSpec(poi, unequal.metrics.tourism, "A").magnitude;
  const ub = buildHaloGlyphSpec(poi, unequal.metrics.tourism, "B").magnitude;
  assert.ok(Math.abs(ua - ub) < 1e-9, "equal density across unequal radii -> equal bars");
  // Single lens (B absent): A still gets its own density bar.
  const single = buildHaloComparison(baseInput({ radii: { A: 900, B: 900 }, tourism: { a: live(5), b: unavailable() } }));
  assert.equal(buildHaloGlyphSpec(poi, single.metrics.tourism, "A").type, "bar");
  assert.equal(buildHaloGlyphSpec(poi, single.metrics.tourism, "B").type, "abstain");
});

test("the SAME reference density is shared by Lens A and Lens B (brief E)", () => {
  const model = buildHaloComparison(baseInput({ radii: { A: 500, B: 2500 } }));
  assert.equal(model.metrics.tourism.referenceDensity, model.metrics.stays.referenceDensity === 8 ? 8 : model.metrics.tourism.referenceDensity);
  assert.equal(model.metrics.tourism.referenceDensity, 8);
  // A larger window no longer buys a longer bar for free: same raw count, bigger
  // radius -> shorter bar.
  const same = buildHaloComparison(baseInput({ radii: { A: 500, B: 2500 }, mobility: { a: live(10), b: live(10) } }));
  const poiMob = HALO_METRICS[2];
  assert.ok(
    buildHaloGlyphSpec(poiMob, same.metrics.mobility, "A").magnitude >
    buildHaloGlyphSpec(poiMob, same.metrics.mobility, "B").magnitude,
    "same raw count in the 25x-larger window gives a shorter bar"
  );
});

// --- Glyph spec: bar / zero / abstain + raw value + saturation -------------

test("glyph spec carries the raw count, a clamped density magnitude and fixed slot", () => {
  const model = buildHaloComparison(baseInput());
  const spec = buildHaloGlyphSpec(HALO_METRICS[0], model.metrics.tourism, "A");
  assert.equal(spec.value, "5");
  assert.equal(spec.type, "bar");
  assert.equal(spec.magnitude, haloDensityMagnitude(5, 900, 8));
  assert.equal(spec.unit, "POIs");
});

test("values above the reference density saturate without changing the printed raw number (brief H)", () => {
  // density of 500 POIs in a 500 m window hugely exceeds reference 8/km².
  const model = buildHaloComparison(baseInput({ radii: { A: 500, B: 900 }, tourism: { a: live(500), b: live(10) } }));
  const spec = buildHaloGlyphSpec(HALO_METRICS[0], model.metrics.tourism, "A");
  assert.equal(spec.magnitude, 1, "bar clamps at full length");
  assert.equal(spec.value, "500", "raw count still printed in full");
  assert.equal(spec.saturated, true, "saturation is flagged");
  // A below-reference density is not flagged saturated.
  const low = buildHaloComparison(baseInput({ radii: { A: 900, B: 900 }, tourism: { a: live(1), b: live(10) } }));
  assert.equal(buildHaloGlyphSpec(HALO_METRICS[0], low.metrics.tourism, "A").saturated, false);
});

test("genuine zero and unavailable render distinct glyph states, never conflated (brief I)", () => {
  const poi = HALO_METRICS[0];
  const zero = buildHaloGlyphSpec(poi, buildHaloComparison(baseInput({ tourism: { a: live(0), b: live(10) } })).metrics.tourism, "A");
  assert.equal(zero.type, "zero");
  assert.equal(zero.value, "0");
  const na = buildHaloGlyphSpec(poi, buildHaloComparison(baseInput({ tourism: { a: unavailable(), b: live(10) } })).metrics.tourism, "A");
  assert.equal(na.type, "abstain");
  assert.equal(na.value, "N/A");
  assert.notEqual(na.type, zero.type);
  assert.notEqual(na.value, zero.value);
});

test("UTCI is a within-metric band bar (not area-normalized) and prints Celsius (brief J)", () => {
  const model = buildHaloComparison(baseInput({ radii: { A: 400, B: 2000 } }));
  const spec = buildHaloGlyphSpec(HALO_METRICS[3], model.metrics.utci, "B");
  assert.equal(spec.type, "bar");
  assert.equal(spec.value, "38.1°C");
  assert.equal(spec.magnitude, haloUtciMagnitude(38.1, BAND), "UTCI magnitude depends only on the Celsius band, not the radius");
});

test("mobility abstains as unavailable (N/A) when its sources are unavailable", () => {
  const model = buildHaloComparison(baseInput({ mobility: { a: unavailable(), b: unavailable() } }));
  const spec = buildHaloGlyphSpec(HALO_METRICS[2], model.metrics.mobility, "A");
  assert.equal(spec.type, "abstain");
  assert.equal(spec.value, "N/A");
  assert.equal(spec.visualState, "unavailable");
});

// --- Geometry helpers ------------------------------------------------------

test("value and caption anchors are fixed per slot and layout, independent of magnitude", () => {
  const poi = HALO_METRICS[0];
  const anchors = [0, 2, 5, 40].map((count) =>
    buildHaloGlyphSpec(poi, buildHaloComparison(baseInput({ tourism: { a: live(count), b: live(10) } })).metrics.tourism, "A").valueAnchor);
  assert.deepEqual(anchors, Array(4).fill(haloValueAnchorForSlot("north", "full")));
  assert.notEqual(buildHaloGlyphSpec(poi, buildHaloComparison(baseInput()).metrics.tourism, "A", "compact").valueAnchor, null);
  assert.equal(buildHaloGlyphSpec(poi, buildHaloComparison(baseInput()).metrics.tourism, "A", "compact").labelAnchor, null);
  assert.equal(haloLabelAnchorForSlot("north", "compact"), null);
});

test("layout thresholds and per-slot suppression stay deterministic", () => {
  assert.equal(haloLayoutForRadius(42), "full");
  assert.equal(haloLayoutForRadius(30), "compact");
  assert.equal(haloLayoutForRadius(29.9), "hidden");
  const visible = resolveHaloSlotVisibility({ layout: "full", blockedSlots: ["stays"] });
  assert.equal(visible.tourism.visible, true);
  assert.equal(visible.stays.visible, false);
  assert.equal(visible.mobility.visible, true);
  assert.equal(resolveHaloSlotVisibility({ layout: "compact" }).tourism.compact, true);
});

test("footprint collisions remain conservative across adjacent slots", () => {
  const east = haloSlotFootprint("east", "full");
  const west = haloSlotFootprint("west", "full");
  assert.equal(haloFootprintsOverlap({ x: 100, y: 100 }, east, { x: 140, y: 100 }, west), true);
});

// --- Pedestrian analytical comparison (panel-only) -------------------------

test("pedestrian activity stays a panel-only analytical comparison with distinct abstentions", () => {
  assert.equal(activityState(pedestrianInput()).comparable, true);
  assert.equal(activityState({ ...pedestrianInput(), enabled: false }).stateA, "OFF");
  assert.equal(activityState({ enabled: false, sourceState: "unavailable" }).stateA, "UNAVAILABLE");
  const noEvidenceInput = pedestrianInput();
  noEvidenceInput.a.evidence = "NONE";
  noEvidenceInput.a.observationCount = 0;
  assert.equal(activityState(noEvidenceInput).stateA, "NO_EVIDENCE");
  assert.match(activityState({ ...pedestrianInput(), periodKey: null }).qualifier, /source period unavailable/);
});

test("mobility panel comparison withholds its delta under unequal windows (halo intensity is separate)", () => {
  const mobility = buildCountPairState(live(5), live(10), COMPARISON_RADIUS_MODE.UNEQUAL);
  assert.equal(mobility.delta, null);
  assert.match(mobility.qualifier, /different window sizes/);
});

test("UTCI off and one-sided evidence abstain distinctly for the panel", () => {
  assert.equal(utciState({ enabled: false }).stateA, "OFF");
  const oneSided = utciState({ enabled: true, timestepA: "15:00", timestepB: "15:00", a: { evidence: "MODEL-DERIVED", mean: 36, count: 2 }, b: { evidence: "NONE", mean: null, count: 0 } });
  assert.equal(oneSided.stateB, "NO_EVIDENCE");
  assert.equal(oneSided.comparable, false);
});

// --- Accessibility ---------------------------------------------------------

test("accessible summary states raw counts, density-bar meaning, and within-metric-only comparability", () => {
  const summary = accessibleComparisonSummary(buildHaloComparison(baseInput()));
  assert.match(summary, /Tourism POIs: Lens A 5 POIs, Lens B 10 POIs/);
  assert.match(summary, /Mobility nodes: Lens A 3 nodes, Lens B 6 nodes/);
  assert.match(summary, /Mean UTCI: Lens A 36\.4°C, Lens B 38\.1°C/);
  assert.match(summary, /printed number is the raw count/i);
  assert.match(summary, /represented spatial density/i);
  assert.match(summary, /comparable within the same metric only, never across metrics/);
  assert.match(summary, /Unavailable data reads N\/A, never zero/);
  assert.doesNotMatch(summary, /percent|%/i);
  // Saturation is surfaced for accessibility.
  const sat = accessibleComparisonSummary(buildHaloComparison(baseInput({ radii: { A: 400, B: 900 }, tourism: { a: live(500), b: live(10) } })));
  assert.match(sat, /at or above reference/i);
});

// --- Production wiring (source-level guards) --------------------------------

test("the renderer prints a raw-value node, uses the shared density references, and stays pointer-transparent", () => {
  const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
  assert.match(app, /interactive: false, keyboard: false/);
  assert.match(css, /\.comparison-halo-icon\{[^}]*pointer-events:none!important/);
  assert.match(app, /class="halo-value"/);
  assert.match(css, /\.halo-value\{/);
  assert.match(app, /getHaloReferences\(\)/);
  assert.match(app, /computeHaloReferenceScales\(visiblePoiPoints\(\)\)/, "references share the counted (filtered) population");
  const slice = app.slice(app.indexOf("const HALO_SLOT_GEOMETRY"), app.indexOf("const LENS_BASEMAP_STYLES"));
  assert.match(slice, /buildHaloGlyphSpec/);
});

test("browser regression API requires both its query flag and a local hostname", () => {
  const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(app, /const haloRegressionRequested = new URLSearchParams\(window\.location\.search\)\.get\("haloRegressionTest"\) === "1";/);
  assert.match(app, /const haloRegressionLocal = window\.location\.hostname === "127\.0\.0\.1" \|\| window\.location\.hostname === "localhost";/);
  assert.match(app, /if \(haloRegressionRequested && haloRegressionLocal\) \{\s*window\.__HALO_REGRESSION__ = Object\.freeze\(/);
});

test("compare panel keeps the four-column A/B table, Pedestrian panel-only, Mobility promoted", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /aria-label="Show comparison halo around Lens A and Lens B" aria-checked="true"/);
  assert.match(html, /Lens A<\/th><th scope="col">Lens B<\/th><th scope="col">B−A/);
  assert.match(html, /<th scope="row">Mobility nodes<\/th>/);
  assert.match(html, /Pedestrian · panel only/);
  assert.doesNotMatch(html, /Mobility · panel only/);
});
