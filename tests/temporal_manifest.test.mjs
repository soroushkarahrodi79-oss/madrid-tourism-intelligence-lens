// Gate 4A: the temporal manifest builder and its published schema (docs/TEMPORAL_MANIFEST.md).
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const H = require("../js/historical-url.js");
const M = require("../js/temporal-manifest.js");
const read = (file) => JSON.parse(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
const SCHEMA = read("docs/schemas/temporal-manifest.v1.schema.json");

const INPUT = {
  generatedAt: "2026-11-25T20:00:00.000Z",
  generator: { asset_version: "test", deployment_commit: null },
  wmsUrl: "https://www.ign.es/wms/pnoa-historico",
  centre: { lat: 40.3925, lon: -3.699 },
  zoom: 17,
  size: { width: 1280, height: 720 },
  dividerFraction: 0.5,
  pair: { left: "2006", right: "2023" },
  varyingSide: "right",
  includeCity: false,
  dwellMs: 2000,
  observed: { sides: { left: "ok", right: "ok" }, playbackPhase: "stopped", pending: null },
};
const build = (over = {}) => M.buildTemporalManifest({ ...INPUT, ...over }, H);

// A validator for exactly the JSON Schema keywords the published schema uses (no dependency).
const KNOWN = new Set(["$schema", "$id", "$defs", "$ref", "title", "description", "format", "type", "const", "enum", "required", "properties", "additionalProperties", "items", "minItems", "maxItems", "minimum", "pattern"]);
function validate(value, schema, path = "$") {
  for (const key of Object.keys(schema)) assert.ok(KNOWN.has(key), `validator does not implement "${key}"`);
  if (schema.$ref) return validate(value, SCHEMA.$defs[schema.$ref.split("/").pop()], path);
  const kind = value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.includes(kind) && !(kind === "integer" && types.includes("number"))) return [`${path}: ${kind} is not ${types}`];
  }
  const errors = [];
  if ("const" in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) errors.push(`${path}: const`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: enum ${value}`);
  if (schema.pattern && kind === "string" && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: pattern ${value}`);
  if ("minimum" in schema && typeof value === "number" && value < schema.minimum) errors.push(`${path}: minimum`);
  if (kind === "array") {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) errors.push(`${path}: item count`);
    if (schema.items) value.forEach((item, i) => errors.push(...validate(item, schema.items, `${path}[${i}]`)));
  }
  if (kind === "object") {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${path}.${key}: missing`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) errors.push(...validate(item, schema.properties[key], `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: unexpected`);
    }
  }
  return errors;
}

test("a manifest validates against the published schema, including a pending frame; defects are caught", () => {
  assert.deepEqual(validate(build(), SCHEMA), []);
  assert.deepEqual(validate(build({ observed: { sides: { left: "loading", right: "ok" }, playbackPhase: "advancing", pending: { coverage_id: "2009", loaded: false } } }), SCHEMA), []);
  const broken = build();
  delete broken.view.bbox;
  broken.sequence.frames[0].extra = 1;
  assert.equal(validate(broken, SCHEMA).length, 2);
});

test("the real example in docs/examples validates and equals a rebuild from its own parameters", () => {
  const example = read("docs/examples/temporal-manifest.example.json");
  assert.deepEqual(validate(example, SCHEMA), []);
  const rebuilt = M.buildTemporalManifest({
    generatedAt: example.generated_at,
    generator: example.generator,
    wmsUrl: example.service.url,
    centre: { lat: example.view.centre.latitude, lon: example.view.centre.longitude },
    zoom: example.view.zoom,
    size: { width: example.image.width, height: example.image.height },
    dividerFraction: example.display.divider_fraction,
    pair: { left: example.observed.visible.left.coverage_id, right: example.observed.visible.right.coverage_id },
    varyingSide: example.display.varying_side,
    includeCity: example.display.include_10cm_city_coverages,
    dwellMs: example.display.dwell_ms,
    observed: { sides: { left: example.observed.visible.left.tile_state, right: example.observed.visible.right.tile_state }, playbackPhase: example.observed.playback_phase, pending: example.observed.pending_next },
  }, H);
  assert.deepEqual(rebuilt, example);
});

test("sequence: chronological, reference fixed and excluded, 10 cm dates only on request", () => {
  const without = build();
  assert.equal(without.display.reference_side, "left");
  assert.equal(without.reference.coverage_id, "2006");
  assert.deepEqual(without.sequence.frames.map((f) => f.coverage_id), ["ams1956", "olistat", "sigpac", "2009", "2011", "2014", "2017", "2020", "2023"]);
  const withCity = build({ includeCity: true }).sequence.frames.map((f) => f.coverage_id);
  assert.deepEqual(withCity, ["ams1956", "olistat", "sigpac", "2009", "pnoa10_2009", "2011", "pnoa10_2013", "2014", "pnoa10_2016", "2017", "2020", "2023"]);
  const leftMoves = build({ varyingSide: "left" });
  assert.equal(leftMoves.display.reference_side, "right");
  assert.equal(leftMoves.reference.coverage_id, "2023");
  assert.ok(!leftMoves.sequence.frames.some((f) => f.coverage_id === "2023"));
});

test("dates and coverage metadata: annual years, flight intervals, resolution and limits", () => {
  const frames = new Map(build({ includeCity: true }).sequence.frames.map((f) => [f.coverage_id, f]));
  assert.deepEqual(frames.get("2023").date, { kind: "annual_mosaic", start_year: 2023, end_year: 2023, label: "2023" });
  assert.deepEqual(frames.get("ams1956").date, { kind: "multi_year_flight", start_year: 1956, end_year: 1957, label: "1956–57" });
  assert.deepEqual(frames.get("sigpac").date, { kind: "multi_year_flight", start_year: 1997, end_year: 2003, label: "1997–2003" });
  assert.ok(frames.get("ams1956").limitations.includes("RESOLUTION_UNCERTAIN_LAYER_ABSTRACT_IMPLIES_1_M"));
  assert.ok(frames.get("pnoa10_2009").limitations.includes("MADRID_CITY_FOOTPRINT_ONLY"));
  assert.equal(frames.get("pnoa10_2009").documented_extent, "madrid_city");
  for (const cov of H.HIST_COVERAGES) assert.ok(M.TM_SERVICE_TITLES[cov.layer], `no service title for ${cov.layer}`);
  // z17 here asks for ~0.91 m pixels: coarser than 0.5 m. z19 asks for ~0.23 m.
  assert.ok(!frames.get("2023").limitations.includes("REQUEST_FINER_THAN_NOMINAL_RESOLUTION"));
  const close = build({ zoom: 19 });
  assert.ok(close.image.requested_ground_m_per_pixel < 0.25);
  assert.ok(close.reference.limitations.includes("REQUEST_FINER_THAN_NOMINAL_RESOLUTION"));
});

test("extent: EPSG:3857 easting/northing, square pixels, consistent with centre, zoom and size", () => {
  const m = build();
  const [minx, miny, maxx, maxy] = m.view.bbox;
  const res = 40075016.68557849 / (256 * 2 ** 17);
  assert.ok(Math.abs((maxx - minx) - 1280 * res) < 0.01);
  assert.ok(Math.abs((maxy - miny) - 720 * res) < 0.01);
  assert.ok(Math.abs((maxx - minx) / m.image.width - (maxy - miny) / m.image.height) < 1e-5);
  const [w, s, e, n] = m.view.bbox_geographic.bbox;
  assert.ok(w < -3.699 && e > -3.699 && s < 40.3925 && n > 40.3925);
  assert.ok(Math.abs((w + e) / 2 + 3.699) < 1e-6);
  assert.ok(minx < 0 && miny > 4_900_000, "easting first (negative west of Greenwich), then northing");
  assert.equal(m.view.verified_frame.contains_bbox, true);
});

test("GetMap URLs: one shared extent and size, only the layer differs", () => {
  const m = build({ includeCity: true });
  const shared = new Set();
  for (const frame of [m.reference, ...m.sequence.frames]) {
    const url = new URL(frame.getmap_url);
    assert.equal(url.origin + url.pathname, INPUT.wmsUrl);
    assert.equal(url.searchParams.get("layers"), frame.layer);
    assert.equal(url.searchParams.get("version"), "1.3.0");
    assert.equal(url.searchParams.get("request"), "GetMap");
    assert.equal(url.searchParams.get("crs"), "EPSG:3857");
    assert.equal(url.searchParams.get("bbox"), m.view.bbox.join(","));
    assert.equal(url.searchParams.get("width"), "1280");
    assert.equal(url.searchParams.get("height"), "720");
    assert.equal(url.searchParams.get("format"), "image/jpeg");
    url.searchParams.delete("layers");
    shared.add(url.toString());
  }
  assert.equal(shared.size, 1);
});

test("a viewport larger than the service maximum is scaled down on the same extent", () => {
  const big = build({ size: { width: 6000, height: 3000 } });
  assert.equal(big.image.width, 4096);
  assert.equal(big.image.height, 2048);
  assert.deepEqual(big.view.bbox, M.tmView({ centre: INPUT.centre, zoom: 17, size: { width: 6000, height: 3000 } }).view.bbox);
});

test("zoom 9 over the whole region: valid, and flagged when the extent exceeds the verified frame", () => {
  const m = build({ centre: { lat: 40.525, lon: -3.815 }, zoom: 9 });
  assert.deepEqual(validate(m, SCHEMA), []);
  assert.equal(m.view.verified_frame.contains_centre, true);
  assert.equal(m.view.verified_frame.contains_bbox, false);
});

test("deterministic: only the declared volatile fields differ between exports of one configuration", () => {
  const a = build();
  const b = build({
    generatedAt: "2027-01-01T00:00:00.000Z",
    generator: { asset_version: "other", deployment_commit: "a".repeat(40) },
    observed: { sides: { left: "loading", right: "error" }, playbackPhase: "halted", pending: { coverage_id: "2009", loaded: false } },
  });
  assert.deepEqual(a.volatile_fields, ["generated_at", "generator", "observed"]);
  for (const key of a.volatile_fields) { delete a[key]; delete b[key]; }
  assert.deepEqual(a, b);
});

test("no availability claim, no hashes, input left untouched", () => {
  const input = structuredClone(INPUT);
  const m = M.buildTemporalManifest(input, H);
  assert.deepEqual(input, INPUT);
  assert.doesNotMatch(JSON.stringify([m.reference, m.sequence]), /availab|sha256|hash|tile_state/i);
  assert.deepEqual(m.limitations.map((l) => l.code), M.TM_LIMITATIONS.map(([code]) => code));
  assert.match(M.temporalManifestFileName(m), /^madrid-temporal-manifest_2006-ref_z17_40\.3925_-3\.6990_20261125T200000Z\.json$/);
});
