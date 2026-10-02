import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  HALO_METRICS,
  UTCI_PX_PER_C,
  accessibleComparisonSummary,
  buildHaloComparison,
  normalizedCountPair,
  COMPARISON_RADIUS_MODE,
  representedRate,
  buildCountPairState,
  buildHaloGlyphSpec,
  haloLabelAnchorForSlot,
  haloSlotFootprint,
  haloFootprintsOverlap,
  haloLayoutForRadius,
  resolveHaloSlotVisibility,
} from "../js/radial-halo.js";

const live = (value) => ({ value, sourceState: "live" });
const baseInput = () => ({
  tourism: { a: live(5), b: live(10) },
  stays: { a: live(2), b: live(4) },
  pedestrian: {
    enabled: true, sourceState: "published", periodKey: "2024",
    a: { evidence: "OBSERVED", meanObserved: 0, stationCount: 1, observationCount: 3, dateMin: "2024-01-01", dateMax: "2024-01-01" },
    b: { evidence: "OBSERVED", meanObserved: 10, stationCount: 2, observationCount: 8, dateMin: "2024-01-01", dateMax: "2024-01-02" },
  },
  utci: {
    enabled: true, timestepA: "15:00", timestepB: "15:00",
    a: { evidence: "MODEL-DERIVED", mean: 36.4, count: 2 },
    b: { evidence: "MODEL-DERIVED", mean: 38.1, count: 3 },
  },
});

test("shared count scale uses one A/B maximum in either value order", () => {
  assert.deepEqual(normalizedCountPair(5, 10), { max: 10, a: 0.5, b: 1 });
  assert.deepEqual(normalizedCountPair(10, 5), { max: 10, a: 1, b: 0.5 });
});

test("two genuine valid count zeros stay valid without division by zero", () => {
  const model = buildHaloComparison({ ...baseInput(), tourism: { a: live(0), b: live(0) } });
  assert.equal(model.metrics.tourism.comparable, true);
  assert.equal(model.metrics.tourism.aMagnitude, 0);
  assert.equal(model.metrics.tourism.bMagnitude, 0);
  assert.equal(model.metrics.tourism.delta, 0);
});

test("equal windows compare raw POI/stay counts while unequal eligible windows compare represented rates", () => {
  const equal = buildHaloComparison({ ...baseInput(), radiusMode: COMPARISON_RADIUS_MODE.EQUAL, radii: { A: 900, B: 900 }, aoiState: "not-required" });
  assert.equal(equal.metrics.tourism.delta, 5);
  const unequal = buildHaloComparison({
    ...baseInput(), radiusMode: COMPARISON_RADIUS_MODE.UNEQUAL, radii: { A: 500, B: 1500 }, aoiState: "eligible",
    tourism: { a: live(8), b: live(21) }, stays: { a: live(8), b: live(21) },
  });
  assert.equal(unequal.metrics.tourism.aRawValue, 8);
  assert.equal(unequal.metrics.tourism.bRawValue, 21);
  assert.equal(unequal.metrics.tourism.aValue, representedRate(8, 500));
  assert.equal(unequal.metrics.tourism.delta, representedRate(21, 1500) - representedRate(8, 500));
  assert.equal(unequal.metrics.stays.aValue, representedRate(8, 500));
});

test("unequal POI and stay comparisons withhold at AOI or source mismatch and never fall back to raw delta", () => {
  const crossing = buildHaloComparison({ ...baseInput(), radiusMode: COMPARISON_RADIUS_MODE.UNEQUAL, radii: { A: 500, B: 1500 }, aoiState: "crosses" });
  assert.equal(crossing.metrics.tourism.aRawValue, 5);
  assert.equal(crossing.metrics.tourism.delta, null);
  assert.equal(crossing.metrics.tourism.aMagnitude, null);
  assert.match(crossing.metrics.tourism.qualifier, /crosses Madrid AOI/);
  const incompatible = buildHaloComparison({
    ...baseInput(), radiusMode: COMPARISON_RADIUS_MODE.UNEQUAL, radii: { A: 500, B: 1500 }, aoiState: "eligible",
    tourism: { a: live(5), b: { value: 10, sourceState: "snapshot" } },
  });
  assert.equal(incompatible.metrics.tourism.delta, null);
  assert.equal(incompatible.metrics.tourism.aRawValue, 5);
});

test("unequal mobility keeps raw side counts and withholds delta; native evidence remains native", () => {
  const mobility = buildCountPairState(live(5), live(10), COMPARISON_RADIUS_MODE.UNEQUAL);
  assert.equal(mobility.aValue, 5); assert.equal(mobility.bValue, 10); assert.equal(mobility.delta, null);
  assert.match(mobility.qualifier, /different window sizes/);
  const model = buildHaloComparison({ ...baseInput(), radiusMode: COMPARISON_RADIUS_MODE.UNEQUAL, radii: { A: 500, B: 1500 }, aoiState: "eligible" });
  assert.equal(model.metrics.pedestrian.delta, 10);
  assert.equal(Number(model.metrics.utci.delta.toFixed(1)), 1.7);
});

test("unavailable A or B is an abstention, never a zero comparison", () => {
  const inputA = baseInput();
  inputA.tourism = { a: { value: null, sourceState: "unavailable" }, b: live(10) };
  const a = buildHaloComparison(inputA).metrics.tourism;
  assert.equal(a.aValue, null);
  assert.equal(a.bValue, 10);
  assert.equal(a.aMagnitude, null);
  assert.equal(a.comparable, false);

  const inputB = baseInput();
  inputB.tourism = { a: live(10), b: { value: null, sourceState: "unavailable" } };
  const b = buildHaloComparison(inputB).metrics.tourism;
  assert.equal(b.aValue, 10);
  assert.equal(b.bValue, null);
  assert.equal(b.bMagnitude, null);
  assert.equal(b.comparable, false);
});

test("Pedestrian no evidence does not make a numeric comparison", () => {
  const input = baseInput();
  input.pedestrian.b.evidence = "NONE";
  input.pedestrian.b.meanObserved = null;
  input.pedestrian.b.observationCount = 0;
  const state = buildHaloComparison(input).metrics.pedestrian;
  assert.equal(state.comparable, false);
  assert.equal(state.stateB, "NO_EVIDENCE");
  assert.equal(state.aMagnitude, null);
});

test("Pedestrian evidence without a source period withholds the direct comparison", () => {
  const input = baseInput();
  input.pedestrian.periodKey = null;
  const state = buildHaloComparison(input).metrics.pedestrian;
  assert.equal(state.comparable, false);
  assert.equal(state.delta, null);
  assert.match(state.qualifier, /source period unavailable/);
});

test("HATI off and one-sided HATI evidence abstain distinctly", () => {
  const offInput = baseInput();
  offInput.utci.enabled = false;
  const off = buildHaloComparison(offInput).metrics.utci;
  assert.equal(off.id, "off");
  assert.equal(off.stateA, "OFF");
  assert.equal(off.aValue, null);

  const oneSided = baseInput();
  oneSided.utci.b = { evidence: "NONE", mean: null, count: 0 };
  const missing = buildHaloComparison(oneSided).metrics.utci;
  assert.equal(missing.comparable, false);
  assert.equal(missing.stateA, "VALID");
  assert.equal(missing.stateB, "NO_EVIDENCE");
  assert.equal(missing.delta, null);
});

test("UTCI keeps the native Celsius difference around a shared local midpoint", () => {
  const state = buildHaloComparison(baseInput()).metrics.utci;
  assert.equal(Number(state.delta.toFixed(1)), 1.7);
  assert.equal(state.midpoint, 37.25);
  assert.equal(Number(state.aOffsetPx.toFixed(2)), -0.85 * UTCI_PX_PER_C);
  assert.equal(Number(state.bOffsetPx.toFixed(2)), 0.85 * UTCI_PX_PER_C);
  assert.equal(Number(state.delta.toFixed(1)), 1.7);
});

test("source-state mismatch withholds direct count comparison", () => {
  const input = baseInput();
  input.stays = { a: live(5), b: { value: 7, sourceState: "snapshot" } };
  const state = buildHaloComparison(input).metrics.stays;
  assert.equal(state.comparable, false);
  assert.equal(state.delta, null);
  assert.equal(state.aValue, 5);
  assert.equal(state.bValue, 7);
});

test("metric slots have stable fixed order even when evidence is absent", () => {
  const model = buildHaloComparison({ ...baseInput(), stays: { a: null, b: null } });
  assert.deepEqual(model.order, ["tourism", "stays", "pedestrian", "utci"]);
  assert.equal(model.metrics.stays.comparable, false);
  assert.deepEqual(model.order, HALO_METRICS.map(({ id }) => id));
});

test("V2 maps count/rate values to outward bars and real zero to an origin mark", () => {
  const model = buildHaloComparison(baseInput());
  const poi = HALO_METRICS.find(({ id }) => id === "tourism");
  assert.deepEqual(buildHaloGlyphSpec(poi, model.metrics.tourism, "A"), {
    metric: "tourism", slot: "north", which: "A", layout: "full", label: "POI", labelAnchor: { x: 76, y: 12, textAnchor: "start" }, visualState: "numeric", type: "bar", qualified: false, magnitude: 0.5,
  });
  const zeroModel = buildHaloComparison({ ...baseInput(), tourism: { a: live(0), b: live(10) } });
  assert.equal(buildHaloGlyphSpec(poi, zeroModel.metrics.tourism, "A").type, "zero");
  assert.notEqual(buildHaloGlyphSpec(poi, zeroModel.metrics.tourism, "A").type, "abstain");
  const unequal = buildHaloComparison({ ...baseInput(), radiusMode: COMPARISON_RADIUS_MODE.UNEQUAL, radii: { A: 500, B: 1500 }, aoiState: "eligible" });
  assert.equal(buildHaloGlyphSpec(poi, unequal.metrics.tourism, "A").type, "bar");
  assert.equal(unequal.metrics.tourism.aValue, representedRate(5, 500));
});

test("V2 makes unavailable, no evidence and AOI withholding nonnumeric states", () => {
  const poi = HALO_METRICS.find(({ id }) => id === "tourism");
  const unavailable = buildHaloComparison({ ...baseInput(), tourism: { a: { value: null, sourceState: "unavailable" }, b: live(10) } });
  assert.equal(buildHaloGlyphSpec(poi, unavailable.metrics.tourism, "A").visualState, "unavailable");
  const noEvidenceInput = baseInput(); noEvidenceInput.pedestrian.a.evidence = "NONE"; noEvidenceInput.pedestrian.a.observationCount = 0;
  const pedestrian = buildHaloComparison(noEvidenceInput).metrics.pedestrian;
  assert.equal(buildHaloGlyphSpec(HALO_METRICS[2], pedestrian, "A").visualState, "no-evidence");
  const withheld = buildHaloComparison({ ...baseInput(), radiusMode: COMPARISON_RADIUS_MODE.UNEQUAL, radii: { A: 500, B: 1500 }, aoiState: "crosses" });
  const withheldSpec = buildHaloGlyphSpec(poi, withheld.metrics.tourism, "A");
  assert.equal(withheldSpec.visualState, "withheld"); assert.equal(withheldSpec.type, "abstain");
});

test("V2 uses the UTCI midpoint marker rather than a count bar and keeps short labels at fixed slots", () => {
  const model = buildHaloComparison(baseInput());
  const temp = buildHaloGlyphSpec(HALO_METRICS[3], model.metrics.utci, "B");
  assert.equal(temp.type, "temperature"); assert.equal("magnitude" in temp, false); assert.equal(temp.label, "UTCI");
  assert.deepEqual(HALO_METRICS.map(({ slot, id }) => [slot, id]), [["north", "tourism"], ["east", "stays"], ["south", "pedestrian"], ["west", "utci"]]);
});

test("V2 compact fallback and per-slot suppression are deterministic", () => {
  assert.equal(haloLayoutForRadius(42), "full");
  assert.equal(haloLayoutForRadius(30), "compact");
  assert.equal(haloLayoutForRadius(29.9), "hidden");
  const visible = resolveHaloSlotVisibility({ layout: "full", blockedSlots: ["stays"] });
  assert.equal(visible.tourism.visible, true); assert.equal(visible.stays.visible, false); assert.equal(visible.utci.visible, true);
  assert.equal(resolveHaloSlotVisibility({ layout: "compact" }).tourism.compact, true);
});

test("V2 labels stay at a fixed full-track endpoint across magnitudes and abstention", () => {
  const poi = HALO_METRICS.find(({ id }) => id === "tourism");
  const anchors = [0, 0.25, 0.5, 1].map((magnitude) => {
    const model = buildHaloComparison({ ...baseInput(), tourism: { a: live(magnitude * 10), b: live(10) } });
    return buildHaloGlyphSpec(poi, model.metrics.tourism, "A").labelAnchor;
  });
  assert.deepEqual(anchors, Array(4).fill({ x: 76, y: 12, textAnchor: "start" }));
  const zeroSpec = buildHaloGlyphSpec(poi, buildHaloComparison({ ...baseInput(), tourism: { a: live(0), b: live(10) } }).metrics.tourism, "A");
  const withheldSpec = buildHaloGlyphSpec(poi, buildHaloComparison({ ...baseInput(), radiusMode: COMPARISON_RADIUS_MODE.UNEQUAL, radii: { A: 500, B: 1500 }, aoiState: "crosses" }).metrics.tourism, "A");
  assert.equal(zeroSpec.type, "zero");
  assert.deepEqual(zeroSpec.labelAnchor, anchors[0]);
  assert.deepEqual(withheldSpec.labelAnchor, anchors[0]);
  assert.equal(buildHaloGlyphSpec(poi, buildHaloComparison(baseInput()).metrics.tourism, "A", "compact").labelAnchor, null);
  assert.equal(haloLabelAnchorForSlot("north", "compact"), null);
});

test("V2 footprint collisions include fixed full labels while preserving per-slot suppression", () => {
  const east = haloSlotFootprint("east", "full");
  const west = haloSlotFootprint("west", "full");
  assert.equal(haloFootprintsOverlap({ x: 100, y: 100 }, east, { x: 150, y: 100 }, west), true, "full label footprints overlap despite 50 px anchor separation");
  const visibleA = resolveHaloSlotVisibility({ layout: "full", blockedSlots: ["stays"] });
  const visibleB = resolveHaloSlotVisibility({ layout: "full", blockedSlots: ["utci"] });
  assert.equal(visibleA.stays.visible, false); assert.equal(visibleA.tourism.visible, true);
  assert.equal(visibleB.utci.visible, false); assert.equal(visibleB.pedestrian.visible, true);
});

test("V2 renderer remains pointer-transparent and excludes Mobility", () => {
  const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
  assert.match(app, /interactive: false, keyboard: false/);
  assert.match(css, /\.comparison-halo-icon\{[^}]*pointer-events:none!important/);
  assert.doesNotMatch(app.slice(app.indexOf("const HALO_SLOT_GEOMETRY"), app.indexOf("const LENS_BASEMAP_STYLES")), /mobility/i);
});

test("V1 halo model admits no Mobility, Category Mix, or administrative/destination metric", () => {
  const model = buildHaloComparison(baseInput());
  assert.deepEqual(Object.keys(model.metrics), ["tourism", "stays", "pedestrian", "utci"]);
  assert.equal("mobility" in model.metrics, false);
  assert.equal("categoryMix" in model.metrics, false);
  assert.equal("population" in model.metrics, false);
  assert.equal("licensedVut" in model.metrics, false);
  assert.equal("hotelDemand" in model.metrics, false);
  assert.equal("domesticOrigins" in model.metrics, false);
});

test("Pedestrian OFF, UNAVAILABLE and NO EVIDENCE remain separate states", () => {
  const off = buildHaloComparison({ ...baseInput(), pedestrian: { ...baseInput().pedestrian, enabled: false } }).metrics.pedestrian;
  const unavailable = buildHaloComparison({ ...baseInput(), pedestrian: { enabled: false, sourceState: "unavailable" } }).metrics.pedestrian;
  const noEvidenceInput = baseInput();
  noEvidenceInput.pedestrian.a.evidence = "NONE";
  noEvidenceInput.pedestrian.a.observationCount = 0;
  const noEvidence = buildHaloComparison(noEvidenceInput).metrics.pedestrian;
  assert.equal(off.stateA, "OFF");
  assert.equal(unavailable.stateA, "UNAVAILABLE");
  assert.equal(noEvidence.stateA, "NO_EVIDENCE");
});

test("accessible comparison summary provides A, B, difference and evidence ceilings", () => {
  const summary = accessibleComparisonSummary(buildHaloComparison(baseInput()));
  assert.match(summary, /Lens A 5 represented records, Lens B 10 represented records, difference \+5/);
  assert.match(summary, /Pedestrian activity: Lens A 0\.0 observed pedestrians\/hour, Lens B 10\.0 observed pedestrians\/hour/);
  assert.match(summary, /Lens A coverage: 1 counter, 3 observations, 2024-01-01 to 2024-01-01/);
  assert.match(summary, /Lens B coverage: 2 counters, 8 observations, 2024-01-01 to 2024-01-02/);
  assert.doesNotMatch(summary, /percent|%/i);
  assert.equal(buildHaloComparison(baseInput()).metrics.pedestrian.id, "valid-deployment");
  const oneSided = baseInput();
  oneSided.utci.b = { evidence: "NONE", mean: null, count: 0 };
  assert.match(accessibleComparisonSummary(buildHaloComparison(oneSided)), /Lens B no evidence; comparison withheld/);
  assert.match(summary, /pair maximum for the active same-unit comparator only/);
  assert.match(summary, /not a benchmark/);
});

test("Compare panel has a four-column A/B counterpart and halo toggle stays accessible", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /aria-label="Show comparison halo around Lens A and Lens B" aria-checked="true"/);
  assert.match(html, /Lens A<\/th><th scope="col">Lens B<\/th><th scope="col">B−A/);
  assert.match(html, /Mobility · panel only/);
});
