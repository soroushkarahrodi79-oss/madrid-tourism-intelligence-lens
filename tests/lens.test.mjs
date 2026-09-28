import assert from "node:assert/strict";
import test from "node:test";
import {
  haversineMeters,
  poiStatsInLens,
  deltaOrDash,
  pedestrianStatsInLens,
  combinedStatus,
  comparisonDelta,
  categoryMixState,
} from "../js/lens.js";

test("haversineMeters: zero distance for identical points", () => {
  const p = { lat: 40.4149, lon: -3.69 };
  assert.equal(haversineMeters(p, p), 0);
});

test("haversineMeters: known short distance is plausible", () => {
  const a = { lat: 40.4149, lon: -3.69 };
  const b = { lat: 40.4159, lon: -3.69 }; // ~111 m north
  const d = haversineMeters(a, b);
  assert.ok(d > 90 && d < 130, `expected ~111m, got ${d}`);
});

test("poiStatsInLens: deterministic across repeated calls", () => {
  const points = [
    { type: "museum", lat: 40.4149, lon: -3.69 },
    { type: "stay", lat: 40.4149, lon: -3.6905 },
    { type: "rail", lat: 40.4148, lon: -3.6903 },
    { type: "bike", lat: 40.5, lon: -3.9 }, // far away, excluded
  ];
  const center = { lat: 40.4149, lon: -3.69 };
  const s1 = poiStatsInLens(points, center, 500);
  const s2 = poiStatsInLens(points, center, 500);
  assert.deepEqual(s1, s2);
  assert.equal(s1.museum, 1);
  assert.equal(s1.stay, 1);
  assert.equal(s1.bike, 0);
  assert.equal(s1.rail, 1);
  assert.equal(s1.mobility, 1);
  assert.equal(s1.total, 3);
});

test("poiStatsInLens: empty lens returns zeroed counts, not undefined", () => {
  const s = poiStatsInLens([], { lat: 0, lon: 0 }, 500);
  assert.equal(s.total, 0);
  assert.deepEqual(s.nearest, []);
});

test("deltaOrDash: null when either side lacks a value", () => {
  assert.equal(deltaOrDash(null, 5), null);
  assert.equal(deltaOrDash(5, null), null);
});

test("deltaOrDash: signed delta string when both sides have values", () => {
  assert.equal(deltaOrDash(10, 14), "+4");
  assert.equal(deltaOrDash(14, 10), "-4");
});

test("combinedStatus: unavailable outranks snapshot which outranks live", () => {
  assert.equal(combinedStatus({ a: "live", b: "unavailable" }, ["a", "b"]), "unavailable");
  assert.equal(combinedStatus({ a: "live", b: "snapshot" }, ["a", "b"]), "snapshot");
  assert.equal(combinedStatus({ a: "live", b: "live" }, ["a", "b"]), "live");
});

test("comparisonDelta: unavailable layer never produces a numeric delta", () => {
  assert.equal(comparisonDelta("unavailable", 3, 7), "—");
  assert.equal(comparisonDelta("unavailable", 0, 0), "—"); // not "+0"
});

test("comparisonDelta: snapshot comparison is marked as a sample, never as an exhaustive live delta", () => {
  const result = comparisonDelta("snapshot", 2, 5);
  assert.equal(result, "+3 sample");
  assert.notEqual(result, "+3");
});

test("comparisonDelta: all-live behavior is unchanged (plain signed delta, no dash, no label)", () => {
  assert.equal(comparisonDelta("live", 2, 5), "+3");
  assert.equal(comparisonDelta("live", 5, 2), "-3");
});

test("comparisonDelta: missing values still fall back to a dash regardless of status", () => {
  assert.equal(comparisonDelta("live", null, 5), "—");
  assert.equal(comparisonDelta("snapshot", 5, null), "—");
});

test("categoryMixState: an unavailable category never gets a fabricated 0% share", () => {
  const { rows, label } = categoryMixState(
    { Museum: 4, Stay: 2, Bike: 0, Info: 1 },
    { Museum: "live", Stay: "live", Bike: "unavailable", Info: "live" }
  );
  assert.deepEqual(rows.Bike, { na: true });
  assert.notEqual(rows.Bike.pct, 0);
  assert.match(label, /unavailable/i);
});

test("categoryMixState: percentages are computed only over known (non-unavailable) categories", () => {
  const { rows } = categoryMixState(
    { Museum: 1, Stay: 1, Bike: 0, Info: 0 },
    { Museum: "live", Stay: "live", Bike: "unavailable", Info: "live" }
  );
  // total across known categories is 2 (Museum + Stay + Info), Bike excluded
  assert.equal(rows.Museum.pct, 50);
  assert.equal(rows.Stay.pct, 50);
  assert.equal(rows.Info.pct, 0);
});

test("categoryMixState: snapshot layers are labelled as a sample mix, not presented as exhaustive", () => {
  const { label } = categoryMixState(
    { Museum: 4, Stay: 2, Bike: 3, Info: 1 },
    { Museum: "snapshot", Stay: "live", Bike: "live", Info: "live" }
  );
  assert.match(label, /sample/i);
  assert.match(label, /not exhaustive/i);
});

test("categoryMixState: all-live layers produce no caveat label", () => {
  const { label } = categoryMixState(
    { Museum: 4, Stay: 2, Bike: 3, Info: 1 },
    { Museum: "live", Stay: "live", Bike: "live", Info: "live" }
  );
  assert.equal(label, "");
});


test("combinedStatus: published snapshot is between live and partial snapshot", () => {
  assert.equal(combinedStatus({ a: "live", b: "published" }, ["a", "b"]), "published");
  assert.equal(combinedStatus({ a: "published", b: "snapshot" }, ["a", "b"]), "snapshot");
});

test("comparisonDelta: deployment snapshot is explicitly labelled", () => {
  assert.equal(comparisonDelta("published", 2, 5), "+3 deploy");
});

test("categoryMixState: deployment snapshots are marked as not real-time", () => {
  const { label } = categoryMixState(
    { Museum: 4, Stay: 2, Bike: 3, Info: 1 },
    { Museum: "published", Stay: "live", Bike: "published", Info: "live" }
  );
  assert.match(label, /deployment snapshot/i);
  assert.match(label, /not real-time/i);
});


test("poiStatsInLens: mobility combines BiciMAD and rail station records", () => {
  const center = { lat: 40.4149, lon: -3.69 };
  const points = [
    { type: "bike", lat: 40.4149, lon: -3.69 },
    { type: "rail", lat: 40.4150, lon: -3.6901 },
    { type: "rail", lat: 40.4151, lon: -3.6901 },
  ];
  const s = poiStatsInLens(points, center, 500);
  assert.equal(s.bike, 1);
  assert.equal(s.rail, 2);
  assert.equal(s.mobility, 3);
});


test("pedestrianStatsInLens: recombines station aggregates using observation weights", () => {
  const center = { lat: 40.4149, lon: -3.69 };
  const stations = [
    {
      lat: 40.4149,
      lon: -3.69,
      meanObserved: 100,
      observationCount: 10,
      dateMin: "2024-01-01",
      dateMax: "2024-01-31",
    },
    {
      lat: 40.4150,
      lon: -3.6901,
      meanObserved: 300,
      observationCount: 30,
      dateMin: "2024-02-01",
      dateMax: "2024-06-30",
    },
    {
      lat: 40.50,
      lon: -3.90,
      meanObserved: 999,
      observationCount: 1,
      dateMin: "2024-01-01",
      dateMax: "2024-01-01",
    },
  ];
  const result = pedestrianStatsInLens(stations, center, 500);
  assert.equal(result.evidence, "OBSERVED");
  assert.equal(result.stationCount, 2);
  assert.equal(result.observationCount, 40);
  assert.equal(result.meanObserved, 250);
  assert.equal(result.dateMin, "2024-01-01");
  assert.equal(result.dateMax, "2024-06-30");
});

test("pedestrianStatsInLens: abstains when no permanent counter falls inside the lens", () => {
  const result = pedestrianStatsInLens(
    [{ lat: 40.50, lon: -3.90, meanObserved: 100, observationCount: 10 }],
    { lat: 40.4149, lon: -3.69 },
    500
  );
  assert.deepEqual(result, {
    evidence: "NONE",
    stationCount: 0,
    observationCount: 0,
    meanObserved: null,
    dateMin: null,
    dateMax: null,
  });
});
