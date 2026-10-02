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
  haloBarMagnitude,
  haloUtciMagnitude,
  formatHaloValue,
  haloQuantile,
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

const live = (value) => ({ value, sourceState: "live" });
const unavailable = () => ({ value: null, sourceState: "unavailable" });
const REFS = Object.freeze({ tourism: 20, stays: 20, mobility: 20, radiusM: 900, quantile: 0.95 });
const BAND = Object.freeze({ min: 30, max: 46 });

const baseInput = () => ({
  references: REFS,
  utciBand: BAND,
  tourism: { a: live(5), b: live(10) },
  stays: { a: live(2), b: live(4) },
  mobility: { a: live(3), b: live(6) },
  utci: {
    enabled: true, timestepA: "15:00", timestepB: "15:00",
    a: { evidence: "MODEL-DERIVED", mean: 36.4, count: 2 },
    b: { evidence: "MODEL-DERIVED", mean: 38.1, count: 3 },
  },
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
  // Mobility is now a perimeter bar; pedestrian is panel-only (not a halo bar).
  assert.equal("pedestrian" in model.metrics, false);
  assert.equal("categoryMix" in model.metrics, false);
  assert.equal("population" in model.metrics, false);
  assert.equal(HALO_COMPACT_LABELS.mobility, "MOB");
});

// --- Deterministic within-metric reference universe ------------------------

test("reference scales are the p95 of per-feature local density, floored at 1 and deterministic", () => {
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
  assert.equal(scales.tourism, 3);
  assert.equal(scales.stays, 1, "a lone feature floors the reference at 1, never 0");
  assert.equal(scales.mobility, 1, "an empty metric floors at 1 (no division by zero)");
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
  assert.deepEqual(deriveHaloUtciBand({ 0: { utci_mean_10m: { "12:00": 42 } } }), { ...HALO_UTCI_FALLBACK_BAND }, "a single value cannot form a band");
});

// --- Within-metric bar magnitude ------------------------------------------

test("bar magnitude is raw / reference, clamped to 0..1 and monotonic", () => {
  assert.equal(haloBarMagnitude(5, 20), 0.25);
  assert.equal(haloBarMagnitude(10, 20), 0.5);
  assert.equal(haloBarMagnitude(40, 20), 1, "a value above the reference clamps to a full bar");
  assert.ok(haloBarMagnitude(5, 20) < haloBarMagnitude(6, 20), "larger raw never yields a shorter bar");
  assert.equal(haloBarMagnitude(0, 20), 0, "a genuine zero is a zero-length bar, not null");
});

test("bar magnitude never treats missing data or a degenerate reference as zero", () => {
  assert.equal(haloBarMagnitude(null, 20), null);
  assert.equal(haloBarMagnitude(undefined, 20), null);
  assert.equal(haloBarMagnitude(5, 0), null, "a zero reference abstains rather than divides");
  assert.equal(haloBarMagnitude(5, null), null);
  assert.equal(haloBarMagnitude(-3, 20), null, "negative raw is not a magnitude");
});

test("UTCI magnitude maps the Celsius band to 0..1 and clamps", () => {
  assert.equal(haloUtciMagnitude(30, { min: 30, max: 46 }), 0);
  assert.equal(haloUtciMagnitude(46, { min: 30, max: 46 }), 1);
  assert.equal(haloUtciMagnitude(38, { min: 30, max: 46 }), 0.5);
  assert.equal(haloUtciMagnitude(60, { min: 30, max: 46 }), 1);
  assert.equal(haloUtciMagnitude(NaN, { min: 30, max: 46 }), null);
  assert.equal(haloUtciMagnitude(38, { min: 46, max: 30 }), null, "an inverted band abstains");
});

test("value formatting prints integers with thousands separators and UTCI in Celsius", () => {
  assert.equal(formatHaloValue("tourism", 12), "12");
  assert.equal(formatHaloValue("stays", 1284), "1,284");
  assert.equal(formatHaloValue("mobility", 0), "0");
  assert.equal(formatHaloValue("utci", 31.63), "31.6°C");
  assert.equal(formatHaloValue("tourism", null), null);
});

// --- Per-side bars: comparability only governs the delta, not each bar ------

test("each lens shows its own bar from its own raw value against the shared reference", () => {
  const model = buildHaloComparison(baseInput());
  const tourism = model.metrics.tourism;
  assert.equal(tourism.aBarMagnitude, 0.25);
  assert.equal(tourism.bBarMagnitude, 0.5);
  assert.equal(tourism.aValueText, "5");
  assert.equal(tourism.bValueText, "10");
  assert.equal(tourism.referenceMax, 20);
  // Same metric, equal values -> equal bars on both lenses.
  const equal = buildHaloComparison({ ...baseInput(), tourism: { a: live(7), b: live(7) } }).metrics.tourism;
  assert.equal(equal.aBarMagnitude, equal.bBarMagnitude);
});

test("a single lens (Lens B unavailable) still renders Lens A's bars and marks B unavailable", () => {
  const model = buildHaloComparison({
    ...baseInput(),
    tourism: { a: live(12), b: unavailable() },
    stays: { a: live(8), b: unavailable() },
    mobility: { a: live(10), b: unavailable() },
    utci: { enabled: true, timestepA: "15:00", timestepB: "15:00", a: { evidence: "MODEL-DERIVED", mean: 36, count: 2 }, b: null },
  });
  const poi = HALO_METRICS[0];
  const aSpec = buildHaloGlyphSpec(poi, model.metrics.tourism, "A");
  const bSpec = buildHaloGlyphSpec(poi, model.metrics.tourism, "B");
  assert.equal(aSpec.type, "bar");
  assert.equal(aSpec.value, "12");
  assert.equal(aSpec.magnitude, 0.6);
  assert.equal(bSpec.type, "abstain");
  assert.equal(bSpec.value, "N/A");
  assert.equal(bSpec.visualState, "unavailable");
  // UTCI single-sided still gives Lens A a bar.
  assert.equal(buildHaloGlyphSpec(HALO_METRICS[3], model.metrics.utci, "A").type, "bar");
  assert.equal(buildHaloGlyphSpec(HALO_METRICS[3], model.metrics.utci, "B").type, "abstain");
});

// --- Glyph spec: bar / zero / abstain + raw value --------------------------

test("glyph spec carries the runtime raw value, clamped magnitude and fixed slot", () => {
  const model = buildHaloComparison(baseInput());
  const poi = HALO_METRICS[0];
  const spec = buildHaloGlyphSpec(poi, model.metrics.tourism, "A");
  assert.equal(spec.metric, "tourism");
  assert.equal(spec.slot, "north");
  assert.equal(spec.label, "POI");
  assert.equal(spec.value, "5");
  assert.equal(spec.type, "bar");
  assert.equal(spec.magnitude, 0.25);
  assert.equal(spec.unit, "POIs");
  const clamped = buildHaloGlyphSpec(poi, buildHaloComparison({ ...baseInput(), tourism: { a: live(500), b: live(10) } }).metrics.tourism, "A");
  assert.equal(clamped.magnitude, 1);
  assert.equal(clamped.value, "500");
});

test("genuine zero and unavailable render distinct glyph states, never conflated", () => {
  const poi = HALO_METRICS[0];
  const zero = buildHaloGlyphSpec(poi, buildHaloComparison({ ...baseInput(), tourism: { a: live(0), b: live(10) } }).metrics.tourism, "A");
  assert.equal(zero.type, "zero");
  assert.equal(zero.value, "0");
  assert.equal(zero.visualState, "zero");
  const na = buildHaloGlyphSpec(poi, buildHaloComparison({ ...baseInput(), tourism: { a: unavailable(), b: live(10) } }).metrics.tourism, "A");
  assert.equal(na.type, "abstain");
  assert.equal(na.value, "N/A");
  assert.notEqual(na.type, zero.type);
  assert.notEqual(na.value, zero.value);
});

test("UTCI is a within-metric bar (no midpoint marker) and prints Celsius", () => {
  const model = buildHaloComparison(baseInput());
  const spec = buildHaloGlyphSpec(HALO_METRICS[3], model.metrics.utci, "B");
  assert.equal(spec.type, "bar");
  assert.equal(spec.value, "38.1°C");
  assert.equal(spec.magnitude, haloUtciMagnitude(38.1, BAND));
  assert.equal(spec.label, "UTCI");
});

test("mobility abstains as unavailable (N/A) when its sources are unavailable", () => {
  const model = buildHaloComparison({ ...baseInput(), mobility: { a: unavailable(), b: unavailable() } });
  const spec = buildHaloGlyphSpec(HALO_METRICS[2], model.metrics.mobility, "A");
  assert.equal(spec.type, "abstain");
  assert.equal(spec.value, "N/A");
  assert.equal(spec.visualState, "unavailable");
});

// --- Geometry helpers ------------------------------------------------------

test("value and caption anchors are fixed per slot and layout, independent of magnitude", () => {
  const poi = HALO_METRICS[0];
  const anchors = [0, 0.25, 0.5, 1].map((fraction) =>
    buildHaloGlyphSpec(poi, buildHaloComparison({ ...baseInput(), tourism: { a: live(fraction * 20), b: live(20) } }).metrics.tourism, "A").valueAnchor);
  assert.deepEqual(anchors, Array(4).fill(haloValueAnchorForSlot("north", "full")));
  assert.notEqual(haloValueAnchorForSlot("north", "full"), null);
  // The number stays visible in compact layout; only the caption drops out.
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
  assert.equal(visible.utci.visible, true);
  assert.equal(resolveHaloSlotVisibility({ layout: "compact" }).tourism.compact, true);
});

test("footprint collisions remain conservative across adjacent slots", () => {
  const east = haloSlotFootprint("east", "full");
  const west = haloSlotFootprint("west", "full");
  assert.equal(haloFootprintsOverlap({ x: 100, y: 100 }, east, { x: 140, y: 100 }, west), true);
  assert.notEqual(haloSlotFootprint("north", "compact"), null);
});

// --- Pedestrian analytical comparison (panel-only, coverage preserved) ------

test("pedestrian activity stays a panel-only analytical comparison with distinct abstentions", () => {
  const valid = activityState(pedestrianInput());
  assert.equal(valid.comparable, true);
  assert.equal(valid.aValue, 0);
  assert.equal(valid.bValue, 10);

  const off = activityState({ ...pedestrianInput(), enabled: false });
  assert.equal(off.stateA, "OFF");
  const unavailableSrc = activityState({ enabled: false, sourceState: "unavailable" });
  assert.equal(unavailableSrc.stateA, "UNAVAILABLE");
  const noEvidenceInput = pedestrianInput();
  noEvidenceInput.a.evidence = "NONE";
  noEvidenceInput.a.observationCount = 0;
  const noEvidence = activityState(noEvidenceInput);
  assert.equal(noEvidence.stateA, "NO_EVIDENCE");
  assert.equal(noEvidence.comparable, false);
  const noPeriod = activityState({ ...pedestrianInput(), periodKey: null });
  assert.equal(noPeriod.comparable, false);
  assert.match(noPeriod.qualifier, /source period unavailable/);
});

test("mobility panel comparison withholds its delta under unequal windows", () => {
  const mobility = buildCountPairState(live(5), live(10), COMPARISON_RADIUS_MODE.UNEQUAL);
  assert.equal(mobility.aValue, 5);
  assert.equal(mobility.bValue, 10);
  assert.equal(mobility.delta, null);
  assert.match(mobility.qualifier, /different window sizes/);
});

test("UTCI off and one-sided evidence abstain distinctly for the panel", () => {
  const off = utciState({ enabled: false });
  assert.equal(off.stateA, "OFF");
  const oneSided = utciState({ enabled: true, timestepA: "15:00", timestepB: "15:00", a: { evidence: "MODEL-DERIVED", mean: 36, count: 2 }, b: { evidence: "NONE", mean: null, count: 0 } });
  assert.equal(oneSided.stateA, "VALID");
  assert.equal(oneSided.stateB, "NO_EVIDENCE");
  assert.equal(oneSided.comparable, false);
});

// --- Accessibility ---------------------------------------------------------

test("accessible summary states each lens raw value, mobility, and within-metric semantics", () => {
  const summary = accessibleComparisonSummary(buildHaloComparison(baseInput()));
  assert.match(summary, /Tourism POIs: Lens A 5 POIs, Lens B 10 POIs/);
  assert.match(summary, /Mobility nodes: Lens A 3 nodes, Lens B 6 nodes/);
  assert.match(summary, /Mean UTCI: Lens A 36\.4°C, Lens B 38\.1°C/);
  assert.match(summary, /comparable within the same metric only, never across metrics/);
  assert.match(summary, /Unavailable data reads N\/A, never zero/);
  assert.doesNotMatch(summary, /percent|%/i);
  const oneSided = buildHaloComparison({ ...baseInput(), tourism: { a: live(5), b: unavailable() } });
  assert.match(accessibleComparisonSummary(oneSided), /Lens B unavailable/);
});

// --- Production wiring (source-level guards) --------------------------------

test("the Leaflet renderer prints a raw-value node, includes Mobility, and stays pointer-transparent", () => {
  const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
  assert.match(app, /interactive: false, keyboard: false/);
  assert.match(css, /\.comparison-halo-icon\{[^}]*pointer-events:none!important/);
  assert.match(app, /class="halo-value"/, "glyph template renders a raw-value text node");
  assert.match(css, /\.halo-value\{/, "the raw value is styled");
  // The halo geometry/render path now drives all four bars including mobility.
  const slice = app.slice(app.indexOf("const HALO_SLOT_GEOMETRY"), app.indexOf("const LENS_BASEMAP_STYLES"));
  assert.match(slice, /buildHaloGlyphSpec/);
  // The halo bars use the deterministic reference universe, not an A/B pair max.
  assert.match(app, /getHaloReferences\(\)/);
  assert.match(app, /computeHaloReferenceScales/);
});

test("browser regression API requires both its query flag and a local hostname", () => {
  const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(app, /const haloRegressionRequested = new URLSearchParams\(window\.location\.search\)\.get\("haloRegressionTest"\) === "1";/);
  assert.match(app, /const haloRegressionLocal = window\.location\.hostname === "127\.0\.0\.1" \|\| window\.location\.hostname === "localhost";/);
  assert.match(app, /if \(haloRegressionRequested && haloRegressionLocal\) \{\s*window\.__HALO_REGRESSION__ = Object\.freeze\(/);
});

test("compare panel keeps a four-column A/B table, moves Pedestrian to panel-only, and promotes Mobility", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /aria-label="Show comparison halo around Lens A and Lens B" aria-checked="true"/);
  assert.match(html, /Lens A<\/th><th scope="col">Lens B<\/th><th scope="col">B−A/);
  assert.match(html, /<th scope="row">Mobility nodes<\/th>/);
  assert.match(html, /Pedestrian · panel only/);
  assert.doesNotMatch(html, /Mobility · panel only/);
});
