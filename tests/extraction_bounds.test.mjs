import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import extraction from "../js/extraction-bounds.js";
import { crtmStationQuery, loadAllLayers } from "../js/data.js";
import { poiStatsInLens, categoryMixState, combinedStatus } from "../js/lens.js";
import {
  buildHaloComparison, buildCountPairState, buildComparisonBridgeModel, buildDecisionInsightModel,
  accessibleComparisonSummary, buildHaloGlyphSpec, HALO_METRICS, bridgeWithheldReason,
} from "../js/radial-halo.js";
import { LEGACY_COPY_ES, localizeCopyEs } from "../js/legacy-copy.js";

// F-01 — geographic extraction boundary safety for the combined Mobility metric.
//
// The CRTM rail layer is queried only inside a rectangle. That rectangle is an
// EXTRACTION QUERY BOUNDARY, not proof of complete coverage: a Lens circle that
// is not wholly inside it must not carry a combined Mobility count, a truncation
// must never become a numeric zero, and a circle inside it must still be
// disclosed as "completeness not verified".

const B = extraction.RAIL_EXTRACTION_BOUNDS;
const S = extraction.STATE;
const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
const eligibility = (lat, lon, radiusM, bounds = B) => extraction.eligibility({ lat, lon }, radiusM, bounds);

const SOL = { lat: 40.4169, lon: -3.7035 };
const RETIRO = { lat: 40.4149, lon: -3.69 };
const BARAJAS = { lat: 40.4743, lon: -3.5805 };

// ---------------------------------------------------------------- the contract

test("the extraction rectangle is the documented CRTM query envelope, defined once", () => {
  assert.deepEqual({ ...B }, { west: -3.745, south: 40.385, east: -3.645, north: 40.455 });
  assert.equal(extraction.envelopeParam(), "-3.745,40.385,-3.645,40.455");
  assert.equal(extraction.RAIL_EXTRACTION_RECORD.is_coverage_evidence, false);
  assert.equal(extraction.RAIL_EXTRACTION_RECORD.completeness, "NOT_VERIFIED");
  assert.ok(Object.isFrozen(B));
});

test("build-time query, browser fallback query, registry and artefact record cannot drift apart", () => {
  const url = new URL(crtmStationQuery("https://example.test/query"));
  assert.equal(url.searchParams.get("geometry"), extraction.envelopeParam());

  const builder = read("../scripts/build_runtime_poi.mjs");
  assert.match(builder, /extraction\.envelopeParam\(extraction\.RAIL_EXTRACTION_BOUNDS\)/);
  assert.match(builder, /extraction: extraction\.RAIL_EXTRACTION_RECORD/);
  const data = read("../js/data.js");
  assert.doesNotMatch(data, /-3\.745,40\.385/);

  const registry = JSON.parse(read("../data/source_registry.json"));
  const rail = registry.sources.find((source) => source.id === "rail");
  assert.deepEqual(
    { west: rail.extraction_bounds.west, south: rail.extraction_bounds.south, east: rail.extraction_bounds.east, north: rail.extraction_bounds.north },
    { ...B },
  );
  assert.equal(rail.extraction_bounds.contract_version, extraction.CONTRACT_VERSION);
  assert.equal(rail.extraction_bounds.is_coverage_evidence, false);
  assert.equal(rail.extraction_bounds.completeness, "NOT_VERIFIED");
  assert.equal(rail.extraction_bounds.boundary_tolerance_m, extraction.BOUNDARY_TOLERANCE_M);
  // The integrity envelope stays a different, looser thing and is not reused.
  assert.equal(rail.expected_spatial_scope, "central_madrid_area");
  assert.notDeepEqual(registry.spatial_scopes.central_madrid_area, { ...B });
});

test("a recorded rectangle is accepted only when it is exactly this contract", () => {
  assert.equal(extraction.recordMatchesContract(extraction.RAIL_EXTRACTION_RECORD), true);
  assert.equal(extraction.recordMatchesContract(null), false);
  assert.equal(extraction.recordMatchesContract({}), false);
  assert.equal(extraction.recordMatchesContract({ ...extraction.RAIL_EXTRACTION_RECORD, contract_version: "0.9.0" }), false);
  assert.equal(extraction.recordMatchesContract({ ...extraction.RAIL_EXTRACTION_RECORD, bounds: { ...B, east: -3.6 } }), false);
  assert.equal(extraction.recordMatchesContract({ ...extraction.RAIL_EXTRACTION_RECORD, bounds: { ...B, west: "x" } }), false);
});

// ------------------------------------------------------------------ geometry

test("representative Lenses: Sol 900 m, Sol 5 km, Retiro 5 km, Barajas 500 m / 900 m / 2 km", () => {
  assert.equal(eligibility(SOL.lat, SOL.lon, 900).state, S.WITHIN);
  assert.equal(eligibility(SOL.lat, SOL.lon, 5000).state, S.PARTIAL);
  assert.equal(eligibility(RETIRO.lat, RETIRO.lon, 5000).state, S.PARTIAL);
  for (const radius of [500, 900, 2000]) assert.equal(eligibility(BARAJAS.lat, BARAJAS.lon, radius).state, S.OUTSIDE, `Barajas ${radius} m`);
});

test("the Lens default circle (Retiro, 900 m) is eligible", () => {
  assert.equal(eligibility(RETIRO.lat, RETIRO.lon, 900).state, S.WITHIN);
});

test("a circle immediately inside the boundary is WITHIN; closer than the safety margin is PARTIAL", () => {
  // Centre on the meridian-free middle of the rectangle, near the north parallel.
  const R = extraction.EARTH_RADIUS_M;
  const radius = 500;
  const lon = (B.west + B.east) / 2;
  const northClearance = (clearanceM) => B.north - ((radius + clearanceM) / R) * (180 / Math.PI);
  const margin = extraction.BOUNDARY_TOLERANCE_M;
  assert.equal(eligibility(northClearance(margin + 5), lon, radius).state, S.WITHIN);
  assert.equal(eligibility(northClearance(margin - 5), lon, radius).state, S.PARTIAL);
  // Exactly tangent to the parallel: the circle touches the boundary, so it is not safe.
  assert.equal(eligibility(northClearance(0), lon, radius).state, S.PARTIAL);
});

test("a circle crossing the boundary by a small margin is PARTIAL on every edge", () => {
  const R = extraction.EARTH_RADIUS_M;
  const radius = 700;
  const midLat = (B.south + B.north) / 2;
  const midLon = (B.west + B.east) / 2;
  const degLat = (m) => (m / R) * (180 / Math.PI);
  const degLon = (m, lat) => degLat(m) / Math.cos((lat * Math.PI) / 180);
  assert.equal(eligibility(B.north - degLat(radius - 30), midLon, radius).state, S.PARTIAL);
  assert.equal(eligibility(B.south + degLat(radius - 30), midLon, radius).state, S.PARTIAL);
  assert.equal(eligibility(midLat, B.east - degLon(radius - 30, midLat), radius).state, S.PARTIAL);
  assert.equal(eligibility(midLat, B.west + degLon(radius - 30, midLat), radius).state, S.PARTIAL);
  // A centre just outside the rectangle whose circle still reaches in.
  assert.equal(eligibility(B.north + degLat(200), midLon, radius).state, S.PARTIAL);
});

test("a circle completely outside is OUTSIDE, and a centre on a corner is PARTIAL", () => {
  assert.equal(eligibility(40.6, -3.4, 1000).state, S.OUTSIDE);
  assert.equal(eligibility(B.north, B.east, 500).state, S.PARTIAL);
});

test("unreliable input fails closed to EXTRACTION_BOUNDS_UNKNOWN", () => {
  for (const bad of [
    extraction.eligibility({ lat: SOL.lat, lon: SOL.lon }, 900, null),
    extraction.eligibility({ lat: SOL.lat, lon: SOL.lon }, 900, undefined),
    extraction.eligibility({ lat: SOL.lat, lon: SOL.lon }, 900, { west: -3.6, south: 40.4, east: -3.7, north: 40.5 }),
    extraction.eligibility({ lat: SOL.lat, lon: SOL.lon }, 900, { west: "a", south: 40.4, east: -3.6, north: 40.5 }),
    extraction.eligibility({ lat: NaN, lon: SOL.lon }, 900, B),
    extraction.eligibility(null, 900, B),
    extraction.eligibility({ lat: SOL.lat, lon: SOL.lon }, 0, B),
    extraction.eligibility({ lat: SOL.lat, lon: SOL.lon }, -5, B),
    extraction.eligibility({ lat: 95, lon: SOL.lon }, 900, B),
    extraction.railEligibility(SOL, 900, null),
    extraction.railEligibility(SOL, 900, { ...extraction.RAIL_EXTRACTION_RECORD, bounds: { ...B, north: 41 } }),
  ]) {
    assert.equal(bad.state, S.UNKNOWN);
  }
  assert.equal(extraction.railEligibility(SOL, 900, extraction.RAIL_EXTRACTION_RECORD).state, S.WITHIN);
});

test("containment is exact: no circle called WITHIN leaves the rectangle, none called OUTSIDE reaches it", () => {
  // Brute-force the geodesic perimeter and interior of pseudo-random circles.
  const R = extraction.EARTH_RADIUS_M;
  const toRad = Math.PI / 180;
  const destination = (lat, lon, bearing, distance) => {
    const a = distance / R;
    const la = lat * toRad;
    const lo = lon * toRad;
    const la2 = Math.asin(Math.sin(la) * Math.cos(a) + Math.cos(la) * Math.sin(a) * Math.cos(bearing));
    const lo2 = lo + Math.atan2(Math.sin(bearing) * Math.sin(a) * Math.cos(la), Math.cos(a) - Math.sin(la) * Math.sin(la2));
    return [la2 / toRad, lo2 / toRad];
  };
  const inside = ([la, lo]) => la >= B.south && la <= B.north && lo >= B.west && lo <= B.east;
  let seed = 7;
  const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const seen = new Set();
  for (let index = 0; index < 4000; index += 1) {
    const lat = 40.34 + random() * 0.18;
    const lon = -3.8 + random() * 0.2;
    const radius = 100 + random() * 5000;
    const { state } = eligibility(lat, lon, radius);
    seen.add(state);
    if (state === S.WITHIN || state === S.OUTSIDE) {
      let anyInside = false;
      let allInside = true;
      for (let step = 0; step < 360; step += 1) {
        for (const fraction of [1, 0.5]) {
          const point = destination(lat, lon, (step * Math.PI) / 180, radius * fraction);
          anyInside = anyInside || inside(point);
          allInside = allInside && inside(point);
        }
      }
      if (state === S.WITHIN) assert.ok(allInside, `WITHIN circle leaves the rectangle: ${lat},${lon} r=${radius}`);
      if (state === S.OUTSIDE) assert.ok(!anyInside, `OUTSIDE circle reaches the rectangle: ${lat},${lon} r=${radius}`);
    }
  }
  assert.deepEqual([...seen].sort(), [S.OUTSIDE, S.PARTIAL, S.WITHIN].sort());
});

test("the tolerance is a one-way, conservative margin: a larger margin never makes a circle MORE eligible", () => {
  const rank = { [S.WITHIN]: 2, [S.PARTIAL]: 1, [S.OUTSIDE]: 0 };
  for (const [lat, lon, radius] of [[SOL.lat, SOL.lon, 3400], [SOL.lat, SOL.lon, 3450], [RETIRO.lat, RETIRO.lon, 3250], [40.4549, -3.69, 200]]) {
    const loose = extraction.eligibility({ lat, lon }, radius, B, { toleranceM: 0 });
    const strict = extraction.eligibility({ lat, lon }, radius, B, { toleranceM: 300 });
    assert.ok(rank[strict.state] <= rank[loose.state], `${lat},${lon} r=${radius}`);
  }
});

// ---------------------------------------------------- mobility safety (stats)

const POINTS = [
  { type: "bike", lat: 40.4169, lon: -3.7035 },
  { type: "bike", lat: 40.417, lon: -3.7036 },
  { type: "rail", mode: "metro", lat: 40.4168, lon: -3.7038 },
  { type: "museum", lat: 40.4165, lon: -3.7032 },
  { type: "bike", lat: 40.4743, lon: -3.5805 },
];

test("applyMobilitySafety keeps the total inside the rectangle and removes every way to rebuild it outside", () => {
  const raw = poiStatsInLens(POINTS, SOL, 900);
  assert.equal(raw.mobility, 3);

  const within = extraction.applyMobilitySafety(raw, eligibility(SOL.lat, SOL.lon, 900));
  assert.equal(within.mobility, 3);
  assert.equal(within.bike, 2);
  assert.equal(within.rail, 1);
  assert.equal(within.mobilityEvidence.withheld, false);
  assert.equal(within.mobilityEvidence.extractionState, S.WITHIN);

  const rawOutside = poiStatsInLens(POINTS, BARAJAS, 900);
  assert.equal(rawOutside.mobility, 1, "the truncated count would have been a plausible-looking number");
  const outside = extraction.applyMobilitySafety(rawOutside, eligibility(BARAJAS.lat, BARAJAS.lon, 900));
  for (const key of ["mobility", "bike", "rail", "total"]) assert.equal(outside[key], null, key);
  assert.equal(outside.mobilityEvidence.withheld, true);
  assert.equal(outside.mobilityEvidence.reason, "EXTRACTION_BOUNDS");
  assert.equal(outside.mobilityEvidence.extractionState, S.OUTSIDE);
  assert.ok(Object.isFrozen(outside), "the safe stats cannot be patched back");
  // Individual records are preserved for the map and the nearest list.
  assert.equal(outside.nearest.length, rawOutside.nearest.length);
  assert.ok(outside.nearest.some((p) => p.type === "bike"));
  // The other metrics are untouched.
  assert.equal(outside.museum, rawOutside.museum);
  assert.equal(outside.stay, rawOutside.stay);
  assert.equal(outside.info, rawOutside.info);
  assert.equal(outside.tourism, rawOutside.tourism);

  const partial = extraction.applyMobilitySafety(poiStatsInLens(POINTS, SOL, 5000), eligibility(SOL.lat, SOL.lon, 5000));
  assert.equal(partial.mobility, null);
  assert.equal(partial.mobilityEvidence.extractionState, S.PARTIAL);
  const unknown = extraction.applyMobilitySafety(raw, extraction.railEligibility(SOL, 900, null));
  assert.equal(unknown.mobility, null);
  assert.equal(unknown.mobilityEvidence.extractionState, S.UNKNOWN);
});

test("a genuine observed zero inside the queried area stays a zero, and a truncation is never one", () => {
  const empty = poiStatsInLens([{ type: "museum", lat: 40.4165, lon: -3.7032 }], SOL, 900);
  const within = extraction.applyMobilitySafety(empty, eligibility(SOL.lat, SOL.lon, 900));
  assert.equal(within.mobility, 0);
  assert.equal(within.mobilityEvidence.withheld, false);

  const outside = extraction.applyMobilitySafety(poiStatsInLens([], BARAJAS, 900), eligibility(BARAJAS.lat, BARAJAS.lon, 900));
  assert.equal(outside.mobility, null);
  assert.notEqual(outside.mobility, 0);
});

test("the category mix leaves a withheld Mobility out of the shares and never shows it as 0%", () => {
  const mix = categoryMixState(
    { Museum: 2, Stay: 2, Bike: null, Info: 0 },
    { Museum: "published", Stay: "published", Bike: "withheld", Info: "published" },
  );
  assert.deepEqual(mix.rows.Bike, { na: true, withheld: true });
  assert.equal(mix.rows.Museum.pct, 50);
  assert.equal(mix.rows.Stay.pct, 50);
  assert.match(mix.label, /Mobility withheld/);
  const unavailable = categoryMixState({ Museum: 1, Bike: null }, { Museum: "published", Bike: "unavailable" });
  assert.deepEqual(unavailable.rows.Bike, { na: true });
  assert.doesNotMatch(unavailable.label, /Mobility withheld/);
});

// ------------------------------------------------- comparison / halo / bridge

const side = (value, state, sourceState = "published") => ({ value, sourceState, extraction: { state } });
const WITHIN_SIDE = (value, sourceState) => side(value, S.WITHIN, sourceState);
const OUT_SIDE = (sourceState) => side(null, S.OUTSIDE, sourceState);
const PARTIAL_SIDE = (sourceState) => side(null, S.PARTIAL, sourceState);
const REFERENCES = { tourism: 8, stays: 8, mobility: 8, radiusM: 900, quantile: 0.95 };

function mobilityOf(a, b, radii = { A: 900, B: 900 }) {
  const radiusMode = radii.A === radii.B ? "EQUAL_RADIUS" : "UNEQUAL_RADIUS";
  const live = (value) => ({ a: { value, sourceState: "published" }, b: { value, sourceState: "published" } });
  const comparison = buildHaloComparison({
    radiusMode, radii, aoiState: "eligible", references: REFERENCES, utciBand: { min: 30, max: 46 },
    tourism: live(4), stays: live(4), mobility: { a, b }, utci: { enabled: false },
  });
  const pair = buildCountPairState(a, b, radiusMode);
  return { comparison, halo: comparison.metrics.mobility, pair, radiusMode };
}

test("both Lenses eligible: the comparison is the ordinary one and is disclosed as inside the queried area", () => {
  const { halo, pair } = mobilityOf(WITHIN_SIDE(3), WITHIN_SIDE(6));
  assert.equal(halo.comparable, true);
  assert.equal(halo.delta, 3);
  assert.equal(halo.aSideState, "VALID");
  assert.equal(halo.aExtraction, S.WITHIN);
  assert.equal(pair.comparable, true);
});

test("one eligible and one ineligible Lens: A's qualified value survives, B and the comparison are withheld", () => {
  for (const radii of [{ A: 900, B: 900 }, { A: 900, B: 1800 }]) {
    const { halo, pair, comparison } = mobilityOf(WITHIN_SIDE(7), OUT_SIDE(), radii);
    for (const state of [halo, pair]) {
      assert.equal(state.comparable, false);
      assert.equal(state.delta, null);
      assert.equal(state.aRawValue, 7);
      assert.equal(state.bRawValue, null);
      assert.equal(state.id, "extraction-withheld");
      assert.equal(state.bWithheld, true);
      assert.equal(state.aWithheld, false);
    }
    assert.equal(halo.aSideState, "VALID");
    assert.equal(halo.bSideState, "WITHHELD_EXTRACTION");
    assert.equal(halo.aQualified, true, "A keeps its deployment-snapshot qualifier");
    const specA = buildHaloGlyphSpec(HALO_METRICS.find((m) => m.id === "mobility"), halo, "A");
    const specB = buildHaloGlyphSpec(HALO_METRICS.find((m) => m.id === "mobility"), halo, "B");
    assert.equal(specA.value, "7");
    assert.equal(specB.value, "—");
    assert.equal(specB.visualState, "withheld");
    assert.equal(specB.type, "abstain");
    assert.ok(!("magnitude" in specB));
    assert.match(accessibleComparisonSummary(comparison), /Lens B mobility withheld/);
  }
});

test("both Lenses ineligible: both are withheld, neither is zero, neither is unavailable", () => {
  const { halo, pair } = mobilityOf(PARTIAL_SIDE(), OUT_SIDE());
  for (const state of [halo, pair]) {
    assert.equal(state.comparable, false);
    assert.equal(state.aRawValue, null);
    assert.equal(state.bRawValue, null);
    assert.equal(state.stateA, "WITHHELD_EXTRACTION");
    assert.equal(state.stateB, "WITHHELD_EXTRACTION");
  }
  assert.equal(halo.aSideState, "WITHHELD_EXTRACTION");
  assert.equal(halo.bSideState, "WITHHELD_EXTRACTION");
  assert.equal(halo.aBarMagnitude, null);
  assert.equal(halo.bBarMagnitude, null);
  assert.equal(halo.aValueText, null);
});

test("a fail-closed UNKNOWN extraction withholds exactly like OUTSIDE", () => {
  const { halo } = mobilityOf(side(null, S.UNKNOWN), WITHIN_SIDE(2));
  assert.equal(halo.aWithheld, true);
  assert.equal(halo.bRawValue, 2);
});

test("the Bridge, Insight and relationship cell read ONE withheld reason, distinct from other reasons", () => {
  const { pair } = mobilityOf(WITHIN_SIDE(7), OUT_SIDE(), { A: 900, B: 1800 });
  assert.equal(bridgeWithheldReason("mobility", pair), "extraction-bounds");
  const equal = mobilityOf(WITHIN_SIDE(7), OUT_SIDE());
  const model = buildComparisonBridgeModel({ metricId: "mobility", state: equal.pair, radiusMode: "EQUAL_RADIUS", radii: { A: 900, B: 900 } });
  assert.equal(model.a.evidence, "VALID");
  assert.equal(model.b.evidence, "WITHHELD_EXTRACTION");
  assert.equal(model.b.rawValue, null);
  assert.equal(model.b.valueText, null);
  assert.equal(model.relationship.comparable, false);
  assert.equal(model.relationship.withheldReasonCode, "extraction-bounds");

  // Window-size withholding must not mask the geographic reason.
  const unequalModel = buildComparisonBridgeModel({ metricId: "mobility", state: pair, radiusMode: "UNEQUAL_RADIUS", radii: { A: 900, B: 1800 } });
  assert.equal(unequalModel.relationship.withheldReasonCode, "extraction-bounds");
  const other = buildCountPairState({ value: 3, sourceState: "published" }, { value: 4, sourceState: "published" }, "UNEQUAL_RADIUS");
  assert.equal(bridgeWithheldReason("mobility", other), "different-window-sizes");

  const insight = buildDecisionInsightModel({
    metricModels: { mobility: model }, radiusMode: "EQUAL_RADIUS", radii: { A: 900, B: 900 },
  });
  const item = insight.items.find((entry) => entry.metricId === "mobility");
  assert.equal(item.state, "withheld", "withheld, not unavailable");
  assert.equal(item.withheldReasonCode, "extraction-bounds");
});

test("source unavailability stays independent of geographic eligibility", () => {
  // Layer unavailable, Lens inside the rectangle: the usual unavailable state.
  const unavailableInside = mobilityOf({ value: null, sourceState: "unavailable", extraction: { state: S.WITHIN } }, { value: null, sourceState: "unavailable", extraction: { state: S.WITHIN } });
  assert.equal(unavailableInside.halo.id, "unavailable");
  assert.equal(unavailableInside.halo.aWithheld, undefined);
  assert.equal(unavailableInside.halo.aSideState, "UNAVAILABLE");
  // Layer unavailable AND Lens beyond the rectangle: still "source unavailable"
  // (the layer cannot be read at all); geography never relabels it.
  const unavailableOutside = mobilityOf({ value: null, sourceState: "unavailable", extraction: { state: S.OUTSIDE } }, { value: null, sourceState: "unavailable", extraction: { state: S.OUTSIDE } });
  assert.equal(unavailableOutside.halo.id, "unavailable");
  assert.equal(unavailableOutside.halo.aSideState, "UNAVAILABLE");
  assert.equal(unavailableOutside.halo.qualifier, "source unavailable");
  // And the reverse: a withheld Lens is never reported as an unavailable source.
  const withheld = mobilityOf(OUT_SIDE(), OUT_SIDE());
  assert.notEqual(withheld.halo.id, "unavailable");
  assert.notEqual(withheld.halo.aSideState, "UNAVAILABLE");
});

test("a single-Lens halo (no Lens B) still shows a withheld A as withheld, not N/A", () => {
  const { halo } = mobilityOf(OUT_SIDE(), { value: null, sourceState: "unavailable" });
  assert.equal(halo.aSideState, "WITHHELD_EXTRACTION");
  assert.equal(halo.bSideState, "UNAVAILABLE");
  const eligible = mobilityOf(WITHIN_SIDE(5), { value: null, sourceState: "unavailable" });
  assert.equal(eligible.halo.aSideState, "VALID");
});

test("a genuine observed zero inside the queried area is a VALID zero, never withheld", () => {
  const { halo } = mobilityOf(WITHIN_SIDE(0), WITHIN_SIDE(4));
  assert.equal(halo.comparable, true);
  assert.equal(halo.aSideState, "VALID");
  const spec = buildHaloGlyphSpec(HALO_METRICS.find((m) => m.id === "mobility"), halo, "A");
  assert.equal(spec.visualState, "zero");
  assert.equal(spec.value, "0");
});

test("metrics that carry no extraction evidence are not affected (museums, stays, tourism)", () => {
  const live = (value) => ({ a: { value, sourceState: "published" }, b: { value: value + 1, sourceState: "published" } });
  const comparison = buildHaloComparison({
    radiusMode: "EQUAL_RADIUS", radii: { A: 900, B: 900 }, aoiState: "eligible", references: REFERENCES, utciBand: { min: 30, max: 46 },
    tourism: live(3), stays: live(2), mobility: live(1), utci: { enabled: false },
  });
  for (const id of ["tourism", "stays", "mobility"]) assert.equal(comparison.metrics[id].comparable, true, id);
  assert.equal(comparison.metrics.mobility.aExtraction, undefined);
});

test("the combined Mobility status still follows the existing source states", () => {
  assert.equal(combinedStatus({ bikes: "published", rail: "published" }, ["bikes", "rail"]), "published");
  assert.equal(combinedStatus({ bikes: "published", rail: "unavailable" }, ["bikes", "rail"]), "unavailable");
});

// ------------------------------------------------------- loading and wiring

test("loadAllLayers reports the rectangle a published rail layer was built with, or null", async () => {
  const snapshot = { museum: [{ id: "m", name: "M", lat: 40.41, lon: -3.69 }] };
  const point = (id) => ({ id, type: "rail", mode: "metro", name: "R", lat: 40.41, lon: -3.69 });
  const withRecord = await loadAllLayers(snapshot, {
    layers: { rail: [point("r1")], bike: [{ id: "b1", type: "bike", name: "B", lat: 40.41, lon: -3.69 }] },
    status: { rail: { ok: true, count: 1, error: null, extraction: extraction.RAIL_EXTRACTION_RECORD } },
  });
  assert.equal(withRecord.layerStatus.rail, "published");
  assert.deepEqual(withRecord.extraction.rail, extraction.RAIL_EXTRACTION_RECORD);

  const older = await loadAllLayers(snapshot, {
    layers: { rail: [point("r1")] },
    status: { rail: { ok: true, count: 1, error: null } },
  });
  assert.equal(older.layerStatus.rail, "published");
  assert.equal(older.extraction.rail, null, "an artefact that does not state its rectangle is not trusted");
  assert.equal(extraction.railEligibility(SOL, 900, older.extraction.rail).state, S.UNKNOWN);
});

test("production wiring: every Mobility consumer reads the safe stats, never the raw sum", () => {
  const app = read("../js/app.js");
  // statsFor is the single producer and applies the safety.
  assert.match(app, /function statsFor\(which\) \{\s*return LensExtractionBounds\.applyMobilitySafety\(/);
  assert.match(app, /railExtractionRecord = extraction\?\.rail \?\? null/);
  // The two comparison builders and the single-Lens halo go through mobilitySide.
  assert.equal((app.match(/mobilitySide\(/g) || []).length >= 4, true);
  // The only place a Mobility {value, sourceState} pair is assembled is mobilitySide().
  assert.equal((app.match(/\bmobility, sourceState/g) || []).length, 1);
  assert.doesNotMatch(app, /value: (a|b|s)\.mobility, sourceState/);
  // No call site re-derives the combined sum from its components.
  assert.doesNotMatch(app, /\.bike\s*\+\s*[\w.]*\.rail|\.rail\s*\+\s*[\w.]*\.bike/);
  assert.match(app, /extraction_eligibility/);
  // The URL carries no geographic status: it derives from centre, radius and contract.
  const url = read("../js/evidence-url.js");
  assert.doesNotMatch(url, /EXTRACTION_BOUNDS|extraction/i);
});

test("index.html loads the extraction contract before every script that reads it", () => {
  const html = read("../index.html");
  const order = [...html.matchAll(/<script src="(js\/[^"?]+)/g)].map((m) => m[1]);
  const at = (name) => order.indexOf(name);
  assert.ok(at("js/extraction-bounds.js") >= 0);
  for (const consumer of ["js/lens.js", "js/radial-halo.js", "js/data.js", "js/app.js"]) {
    assert.ok(at("js/extraction-bounds.js") < at(consumer), `extraction-bounds before ${consumer}`);
  }
});

test("the evidence export names the boundary and never calls it coverage", () => {
  const exp = read("../js/evidence-export.js");
  assert.match(exp, /"extraction_bounds"/);
  assert.match(exp, /extraction boundary: W /);
  const registry = JSON.parse(read("../data/source_registry.json"));
  const rail = registry.sources.find((source) => source.id === "rail");
  assert.match(rail.interpretation_ceiling, /not verified/);
  assert.match(rail.extraction_bounds.note, /NOT the expected_spatial_scope integrity envelope/);
});

// ----------------------------------------------------------------- ES / EN copy

test("every new user-facing English phrase has a Spanish rendering", () => {
  const phrases = [
    "rail: queried central area",
    "Lens extends beyond the Metro/Cercanías extraction area",
    "Metro/Cercanías extraction area could not be verified",
    "Withheld · Lens extends beyond the Metro/Cercanías extraction area",
    "Mobility withheld (beyond extraction area)",
    "withheld, the Lens extends beyond the geographic extraction area",
    "Lens A mobility withheld: the Lens extends beyond the geographic extraction area of Metro and Cercanías",
    "Lens B mobility withheld: the Lens extends beyond the geographic extraction area of Metro and Cercanías",
    "a Metro and Cercanías value is limited to the queried central area and its completeness is not verified",
    "The combined Mobility count is withheld because Metro and Cercanías stations were queried only inside a central rectangle of Madrid and this Lens reaches outside it, so missing stations would read as zero.",
    "Metro and Cercanías stations were queried only inside a central rectangle of Madrid. This Lens fits inside it, but completeness of the source within it is not verified.",
  ];
  for (const phrase of phrases) {
    const es = localizeCopyEs(phrase);
    assert.notEqual(es, phrase, `no ES for: ${phrase}`);
    assert.ok(LEGACY_COPY_ES.some(([en]) => en === phrase), phrase);
  }
  assert.equal(localizeCopyEs("Withheld\nr 900 m"), "Retenido\nr 900 m");
  assert.equal(
    localizeCopyEs("BiciMAD + CRTM deployment snapshot · rail: queried central area"),
    "BiciMAD + instantánea del despliegue de CRTM · tren: área central consultada",
  );
  const app = read("../js/app.js");
  assert.match(app, /"reason\.extraction-bounds": "Lens extends beyond the Metro\/Cercanías extraction area"/);
  assert.match(app, /"reason\.extraction-bounds": "la Lente excede el área de extracción de Metro\/Cercanías"/);
});
