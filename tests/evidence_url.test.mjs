// Shareable evidence state — the URL-state contract these tests defend (K11, #73).
//
// THE DECISIVE CONTRACTS:
//
//   1. Every captured dimension round-trips EXACTLY — asserted per dimension, not
//      in bulk, so a regression names the dimension it broke.
//   2. A `v` mismatch REFUSES; it never restores a different schema's meaning.
//   3. Every invalid-value class (radius, coordinates, ámbito, layer, metric,
//      baseline, timestep) degrades to a STATED partial restore with a reason
//      code — never a silent default.
//   4. Serialization is canonical: one reading maps to exactly one string.
//   5. A snapshot mismatch is an evidence WARNING, not an interface degradation.
//   6. The pure model's vocabularies stay in sync with the real app state
//      (layers, Halo metrics, planning metrics, radius bounds).

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  URL_SCHEMA_VERSION,
  EVIDENCE_URL_LAYERS,
  LENS_RADIUS_BOUNDS,
  LENS_METRIC_IDS,
  AMBITO_METRIC_IDS,
  REASON,
  OUTCOME,
  serializeEvidenceState,
  buildShareUrl,
  parseEvidenceState,
} from "../js/evidence-url.js";

import { LENS_RADIUS } from "../js/lens.js";
import { HALO_METRICS } from "../js/radial-halo.js";
import { AMBITO_METRIC_IDS as REAL_AMBITO_METRIC_IDS } from "../js/ambito-comparison.js";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// A complete, valid reading used as the round-trip fixture. Every dimension set.
const FULL = Object.freeze({
  snapshotId: "20261015-1",
  mode: "COMPARE",
  lensA: { lat: 40.41490, lon: -3.69000, radiusM: 900 },
  lensB: { lat: 40.42240, lon: -3.70370, radiusM: 1200 },
  lensBEnabled: true,
  activeLens: "B",
  layers: ["museum", "stay", "pedestrian", "licences"],
  timestep: "15:00",
  stayKind: "all",
  originMonth: "2024-06",
  scope: "AMBITO",
  ambitoA: "AOE.00.01",
  ambitoB: "API.03.11",
  metric: { id: "ambito_surface", locked: true },
  reading: "analyst",
  language: "es",
  baseline: { radiusA: 900, radiusB: 1200, radiusMode: "UNEQUAL_RADIUS", evidenceKey: "hati:15:00|stay:all" },
});

const KNOWN_CODES = ["AOE.00.01", "API.03.11", "APR.06.02"];
const KNOWN_MONTHS = ["2024-05", "2024-06", "2024-07"];
const PARSE_OPTS = { snapshotId: "20261015-1", knownAmbitoCodes: KNOWN_CODES, knownOriginMonths: KNOWN_MONTHS };

function parseFull(overrides = {}) {
  return parseEvidenceState(serializeEvidenceState({ ...FULL, ...overrides }), PARSE_OPTS);
}

// ---------------------------------------------------------------- round-trip

test("full reading round-trips as EXACT with no issues", () => {
  const result = parseFull();
  assert.equal(result.ok, true);
  assert.equal(result.outcome, OUTCOME.EXACT);
  assert.deepEqual(result.issues, []);
  assert.equal(result.version.requested, URL_SCHEMA_VERSION);
});

test("round-trip preserves mode", () => {
  for (const mode of ["PLACE", "COMPARE", "CITY"]) {
    assert.equal(parseFull({ mode }).state.mode, mode);
  }
});

test("round-trip preserves Lens A centre and radius exactly", () => {
  const { lensA } = parseFull().state;
  assert.equal(lensA.lat, FULL.lensA.lat);
  assert.equal(lensA.lon, FULL.lensA.lon);
  assert.equal(lensA.radiusM, FULL.lensA.radiusM);
});

test("round-trip preserves Lens B centre, radius and enabled flag", () => {
  const { state } = parseFull();
  assert.equal(state.lensB.lat, FULL.lensB.lat);
  assert.equal(state.lensB.lon, FULL.lensB.lon);
  assert.equal(state.lensB.radiusM, FULL.lensB.radiusM);
  assert.equal(state.lensBEnabled, true);
  assert.equal(parseFull({ lensBEnabled: false }).state.lensBEnabled, false);
});

test("round-trip preserves active lens", () => {
  assert.equal(parseFull({ activeLens: "A" }).state.activeLens, "A");
  assert.equal(parseFull({ activeLens: "B" }).state.activeLens, "B");
});

test("round-trip preserves enabled layers in canonical order", () => {
  const { layers } = parseFull({ layers: ["licences", "museum", "stay", "pedestrian"] }).state;
  assert.deepEqual(layers, ["museum", "stay", "pedestrian", "licences"]);
});

test("round-trip preserves an empty layer set distinctly from absent", () => {
  assert.deepEqual(parseFull({ layers: [] }).state.layers, []);
});

test("round-trip preserves heat timestep and stay-kind filter", () => {
  const { state } = parseFull({ timestep: "09:00", stayKind: "hotel" });
  assert.equal(state.timestep, "09:00");
  assert.equal(state.stayKind, "hotel");
});

test("round-trip preserves comparison scope and ámbito codes", () => {
  const { state } = parseFull();
  assert.equal(state.scope, "AMBITO");
  assert.equal(state.ambitoA, "AOE.00.01");
  assert.equal(state.ambitoB, "API.03.11");
});

test("round-trip preserves a locked metric in LENS scope", () => {
  const { state } = parseFull({ scope: "LENS", metric: { id: "utci", locked: true }, ambitoA: null, ambitoB: null });
  assert.deepEqual(state.metric, { id: "utci", locked: true });
});

test("round-trip preserves a focused-but-unlocked metric", () => {
  const { state } = parseFull({ metric: { id: "ambito_surface", locked: false } });
  assert.deepEqual(state.metric, { id: "ambito_surface", locked: false });
});

test("round-trip preserves the domestic-origin source month", () => {
  assert.equal(parseFull().state.originMonth, "2024-06");
  assert.equal(parseFull({ originMonth: "2024-07" }).state.originMonth, "2024-07");
});

test("an unknown origin month is a stated partial restore, never a silent latest fallback", () => {
  const result = parseEvidenceState("v=1&m=CITY&om=1999-01", PARSE_OPTS);
  assert.equal(result.outcome, OUTCOME.PARTIAL);
  assert.equal(result.state.originMonth, undefined);
  assert.equal(result.issues.find((i) => i.dimension === "originMonth").code, REASON.INVALID_ORIGIN_MONTH);
});

test("a malformed origin month degrades with a reason", () => {
  const result = parseEvidenceState("v=1&m=CITY&om=June2024", PARSE_OPTS);
  assert.equal(result.state.originMonth, undefined);
  assert.equal(result.issues.find((i) => i.dimension === "originMonth").code, REASON.INVALID_ORIGIN_MONTH);
});

test("round-trip preserves reading and language", () => {
  assert.equal(parseFull({ reading: "citizen" }).state.reading, "citizen");
  assert.equal(parseFull({ language: "en" }).state.language, "en");
});

test("round-trip preserves the sensitivity baseline and its identity", () => {
  const { baseline } = parseFull().state;
  assert.equal(baseline.radiusA, 900);
  assert.equal(baseline.radiusB, 1200);
  assert.equal(baseline.radiusMode, "UNEQUAL_RADIUS");
  assert.equal(baseline.evidenceKey, "hati:15:00|stay:all");
});

// ---------------------------------------------------------------- determinism

test("serialization is canonical: identical readings produce identical strings", () => {
  const a = serializeEvidenceState(FULL);
  const b = serializeEvidenceState({ ...FULL, layers: [...FULL.layers].reverse() });
  assert.equal(a, b);
});

test("serialization always begins with the version key", () => {
  assert.match(serializeEvidenceState(FULL), /^v=1(&|$)/);
});

test("buildShareUrl drops any existing query/hash and appends canonical state", () => {
  const url = buildShareUrl("https://example.org/lens/?old=1#frag", { mode: "PLACE" });
  assert.ok(url.startsWith("https://example.org/lens/?v=1"));
  assert.ok(!url.includes("#frag"));
  assert.ok(!url.includes("old=1"));
});

// ---------------------------------------------------------------- version gate

test("a missing version is REFUSED, not restored", () => {
  const result = parseEvidenceState("m=COMPARE&a=40.41,-3.69,900", PARSE_OPTS);
  assert.equal(result.ok, false);
  assert.equal(result.outcome, OUTCOME.REFUSED);
  assert.equal(result.state, null);
  assert.equal(result.issues[0].code, REASON.VERSION_MISSING);
});

test("an unsupported future version is REFUSED, never silently reinterpreted", () => {
  const result = parseEvidenceState("v=2&m=CITY", PARSE_OPTS);
  assert.equal(result.ok, false);
  assert.equal(result.outcome, OUTCOME.REFUSED);
  assert.equal(result.state, null);
  assert.equal(result.issues[0].code, REASON.VERSION_UNSUPPORTED);
  assert.equal(result.version.requested, 2);
});

test("a non-numeric version is REFUSED", () => {
  const result = parseEvidenceState("v=abc", PARSE_OPTS);
  assert.equal(result.outcome, OUTCOME.REFUSED);
  assert.equal(result.issues[0].code, REASON.VERSION_UNSUPPORTED);
});

// ------------------------------------------------------- invalid-value classes

test("an out-of-range radius is a stated partial restore, not a clamp", () => {
  const raw = `v=1&m=PLACE&a=40.4149,-3.69,${LENS_RADIUS_BOUNDS.maxM + 500}`;
  const result = parseEvidenceState(raw, PARSE_OPTS);
  assert.equal(result.outcome, OUTCOME.PARTIAL);
  assert.equal(result.state.lensA, undefined);
  const issue = result.issues.find((i) => i.dimension === "lensA");
  assert.equal(issue.code, REASON.INVALID_RADIUS);
});

test("out-of-bounds coordinates are a stated partial restore", () => {
  const result = parseEvidenceState("v=1&a=12.34,56.78,900", PARSE_OPTS);
  assert.equal(result.outcome, OUTCOME.PARTIAL);
  assert.equal(result.state.lensA, undefined);
  assert.equal(result.issues.find((i) => i.dimension === "lensA").code, REASON.INVALID_COORDINATES);
});

test("an unknown ámbito code is a stated partial restore (exact codes only)", () => {
  const result = parseEvidenceState("v=1&sc=AMBITO&aa=NOT.A.CODE&ab=API.03.11", PARSE_OPTS);
  assert.equal(result.outcome, OUTCOME.PARTIAL);
  assert.equal(result.state.ambitoA, undefined);
  assert.equal(result.state.ambitoB, "API.03.11");
  assert.equal(result.issues.find((i) => i.dimension === "ambitoA").code, REASON.UNKNOWN_AMBITO);
});

test("an unknown layer id is dropped with a stated reason, known layers kept", () => {
  const result = parseEvidenceState("v=1&ly=museum.unicorn.stay", PARSE_OPTS);
  assert.equal(result.outcome, OUTCOME.PARTIAL);
  assert.deepEqual(result.state.layers, ["museum", "stay"]);
  assert.equal(result.issues.find((i) => i.dimension === "layers").code, REASON.UNKNOWN_LAYER);
});

test("an unsupported metric is a stated partial restore", () => {
  const result = parseEvidenceState("v=1&sc=LENS&fm=not_a_metric&fl=1", PARSE_OPTS);
  assert.equal(result.outcome, OUTCOME.PARTIAL);
  assert.equal(result.state.metric, undefined);
  assert.equal(result.issues.find((i) => i.dimension === "metric").code, REASON.UNKNOWN_METRIC);
});

test("a metric from the wrong scope never silently survives the scope switch", () => {
  // ambito_surface is an AMBITO metric; it must be rejected in LENS scope.
  const result = parseEvidenceState("v=1&sc=LENS&fm=ambito_surface", PARSE_OPTS);
  assert.equal(result.state.metric, undefined);
  assert.equal(result.issues.find((i) => i.dimension === "metric").code, REASON.UNKNOWN_METRIC);
  // tourism is a LENS metric; it must be rejected in AMBITO scope.
  const r2 = parseEvidenceState("v=1&sc=AMBITO&fm=tourism", PARSE_OPTS);
  assert.equal(r2.state.metric, undefined);
  assert.equal(r2.issues.find((i) => i.dimension === "metric").code, REASON.UNKNOWN_METRIC);
});

test("an invalid mode, reading, language and active lens each degrade with a reason", () => {
  const result = parseEvidenceState("v=1&m=WANDER&rd=robot&lg=fr&al=C", PARSE_OPTS);
  assert.equal(result.outcome, OUTCOME.PARTIAL);
  assert.equal(result.state.mode, undefined);
  assert.equal(result.state.reading, undefined);
  assert.equal(result.state.language, undefined);
  assert.equal(result.state.activeLens, undefined);
  const codes = result.issues.map((i) => i.code);
  assert.ok(codes.includes(REASON.INVALID_MODE));
  assert.ok(codes.includes(REASON.INVALID_READING));
  assert.ok(codes.includes(REASON.INVALID_LANGUAGE));
  assert.ok(codes.includes(REASON.INVALID_ACTIVE_LENS));
});

test("an invalid comparison scope degrades with a reason", () => {
  const result = parseEvidenceState("v=1&sc=GALAXY", PARSE_OPTS);
  assert.equal(result.state.scope, undefined);
  assert.equal(result.issues.find((i) => i.dimension === "scope").code, REASON.INVALID_SCOPE);
});

test("a malformed baseline degrades with a reason and drops only the baseline", () => {
  const result = parseEvidenceState("v=1&m=COMPARE&bl=99,1200,UNEQUAL_RADIUS", PARSE_OPTS);
  assert.equal(result.state.baseline, undefined);
  assert.equal(result.state.mode, "COMPARE");
  assert.equal(result.issues.find((i) => i.dimension === "baseline").code, REASON.INVALID_BASELINE);
});

test("a baseline with an invalid radius mode degrades", () => {
  const result = parseEvidenceState("v=1&bl=900,1200,SOMETIMES", PARSE_OPTS);
  assert.equal(result.state.baseline, undefined);
  assert.equal(result.issues.find((i) => i.dimension === "baseline").code, REASON.INVALID_BASELINE);
});

test("an invalid timestep format degrades with a reason", () => {
  const result = parseEvidenceState("v=1&ts=25:99", PARSE_OPTS);
  assert.equal(result.state.timestep, undefined);
  assert.equal(result.issues.find((i) => i.dimension === "timestep").code, REASON.INVALID_TIMESTEP);
});

test("a timestep outside the known set degrades when a vocabulary is supplied", () => {
  const result = parseEvidenceState("v=1&ts=03:00", { ...PARSE_OPTS, knownTimesteps: ["09:00", "15:00"] });
  assert.equal(result.state.timestep, undefined);
  assert.equal(result.issues.find((i) => i.dimension === "timestep").code, REASON.INVALID_TIMESTEP);
});

test("a malformed lens string degrades with a reason", () => {
  const result = parseEvidenceState("v=1&a=garbage", PARSE_OPTS);
  assert.equal(result.state.lensA, undefined);
  assert.equal(result.issues.find((i) => i.dimension === "lensA").code, REASON.MALFORMED);
});

// ------------------------------------------------------------ snapshot axis

test("a snapshot mismatch warns but keeps the interface restore EXACT", () => {
  const raw = serializeEvidenceState({ ...FULL, snapshotId: "OLD-SNAPSHOT" });
  const result = parseEvidenceState(raw, { snapshotId: "NEW-SNAPSHOT", knownAmbitoCodes: KNOWN_CODES });
  assert.equal(result.outcome, OUTCOME.EXACT); // interface still restored exactly
  assert.equal(result.snapshot.status, "MISMATCH");
  assert.equal(result.snapshot.stored, "OLD-SNAPSHOT");
  assert.equal(result.snapshot.current, "NEW-SNAPSHOT");
  assert.ok(result.issues.some((i) => i.code === REASON.SNAPSHOT_MISMATCH));
});

test("a matching snapshot reports MATCH and no snapshot issue", () => {
  const result = parseFull();
  assert.equal(result.snapshot.status, "MATCH");
  assert.ok(!result.issues.some((i) => i.code === REASON.SNAPSHOT_MISMATCH));
});

test("an unknown snapshot (no current supplied) neither matches nor warns", () => {
  const result = parseEvidenceState(serializeEvidenceState(FULL), { knownAmbitoCodes: KNOWN_CODES });
  assert.equal(result.snapshot.status, "UNKNOWN");
  assert.ok(!result.issues.some((i) => i.code === REASON.SNAPSHOT_MISMATCH));
});

// -------------------------------------------------- cross-module sync guards

test("URL layer vocabulary matches the real data-layer toggles in index.html", () => {
  const html = read("index.html");
  const found = new Set([...html.matchAll(/data-layer="([^"]+)"/g)].map((m) => m[1]));
  assert.deepEqual([...found].sort(), [...EVIDENCE_URL_LAYERS].sort());
});

test("URL Lens-metric vocabulary matches HALO_METRICS", () => {
  assert.deepEqual([...LENS_METRIC_IDS].sort(), HALO_METRICS.map((m) => m.id).sort());
});

test("URL ámbito-metric vocabulary matches the real AMBITO_METRIC_IDS", () => {
  assert.deepEqual([...AMBITO_METRIC_IDS], [...REAL_AMBITO_METRIC_IDS]);
});

test("URL radius bounds and step match the real LENS_RADIUS", () => {
  assert.equal(LENS_RADIUS_BOUNDS.minM, LENS_RADIUS.minM);
  assert.equal(LENS_RADIUS_BOUNDS.maxM, LENS_RADIUS.maxM);
  assert.equal(LENS_RADIUS_BOUNDS.stepM, LENS_RADIUS.stepM);
});

// -------------------------------------------- off-step radius (silent rounding)

test("an in-range but off-step radius is a stated partial restore, never silently rounded", () => {
  // 725 is in [100,5000] but off the 50 m step; the app would snap it to 750.
  const result = parseEvidenceState("v=1&m=COMPARE&a=40.4149,-3.69,725", PARSE_OPTS);
  assert.equal(result.outcome, OUTCOME.PARTIAL);
  assert.equal(result.state.lensA, undefined, "the off-step lens is not silently restored at a different radius");
  const issue = result.issues.find((i) => i.dimension === "lensA");
  assert.equal(issue.code, REASON.RADIUS_NOT_ON_STEP);
});

test("an on-step radius restores exactly", () => {
  const result = parseEvidenceState("v=1&m=COMPARE&a=40.4149,-3.69,750&b=40.42,-3.70,900&be=1", PARSE_OPTS);
  assert.equal(result.state.lensA.radiusM, 750);
  assert.equal(result.state.lensB.radiusM, 900);
  assert.ok(!result.issues.some((i) => i.code === REASON.RADIUS_NOT_ON_STEP));
});

test("Lens B off-step radius degrades independently of Lens A", () => {
  const result = parseEvidenceState("v=1&m=COMPARE&a=40.4149,-3.69,900&b=40.42,-3.70,733&be=1", PARSE_OPTS);
  assert.equal(result.state.lensA.radiusM, 900, "A (on-step) restored");
  assert.equal(result.state.lensB, undefined, "B (off-step) degraded");
  assert.equal(result.issues.find((i) => i.dimension === "lensB").code, REASON.RADIUS_NOT_ON_STEP);
});

test("an off-step sensitivity baseline radius degrades with a reason", () => {
  const result = parseEvidenceState("v=1&bl=725,900,EQUAL_RADIUS", PARSE_OPTS);
  assert.equal(result.state.baseline, undefined);
  assert.equal(result.issues.find((i) => i.dimension === "baseline").code, REASON.INVALID_BASELINE);
});
