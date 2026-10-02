import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  HALO_METRICS,
  UTCI_PX_PER_C,
  accessibleComparisonSummary,
  buildHaloComparison,
  normalizedCountPair,
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
  assert.match(summary, /largest valid value in this A\/B comparison only/);
  assert.match(summary, /not a benchmark/);
});

test("Compare panel has a four-column A/B counterpart and halo toggle stays accessible", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /aria-label="Show comparison halo around Lens A and Lens B" aria-checked="true"/);
  assert.match(html, /Lens A<\/th><th scope="col">Lens B<\/th><th scope="col">B−A/);
  assert.match(html, /Mobility · panel only/);
});
