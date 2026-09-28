import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const provenance = JSON.parse(
  fs.readFileSync(new URL("../data/hati_provenance.json", import.meta.url), "utf8")
);
const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("HATI study-area bounds match the pinned source definition", () => {
  assert.deepEqual(provenance.study_area.bounds, {
    lat_min: 40.404,
    lat_max: 40.421,
    lon_min: -3.696,
    lon_max: -3.6775,
  });
  assert.equal(provenance.study_area.geometry_type, "rectangle");
  assert.equal(provenance.study_area.source_file, "src/define_study_area.py");
});

test("map renders HATI study area as a boundary, not a thermal surface", () => {
  assert.match(app, /L\.rectangle\(/);
  assert.match(app, /fillOpacity: 0\.025/);
  assert.match(app, /Boundary only — thermal evidence exists only at sampled points/);
  assert.match(html, /It is <b>not<\/b> a continuous heat surface/);
});

test("Evidence navigation uses the provenance-backed study-area bounds", () => {
  assert.match(app, /hatiStudyArea\?\.bounds/);
  assert.match(app, /hatiStudyArea\.bounds\.lat_min/);
  assert.match(app, /hatiStudyArea\.bounds\.lon_max/);
});
