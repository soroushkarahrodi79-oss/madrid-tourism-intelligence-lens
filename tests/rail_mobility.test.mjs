import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const builder = fs.readFileSync(new URL("../scripts/build_runtime_poi.mjs", import.meta.url), "utf8");

test("Metro and Cercanias are one explicit operational rail layer", () => {
  assert.match(html, /Metro & Cercanías/);
  assert.match(html, /data-layer="rail" type="checkbox" checked/);
  assert.match(app, /rail: L\.layerGroup\(\)\.addTo\(map\)/);
});

test("mobility metric combines BiciMAD and rail without changing the raw layers", () => {
  assert.match(app, /value: s\.mobility/);
  assert.match(app, /combinedStatus\(layerStatus, \["bikes", "rail"\]\)/);
  assert.match(app, /BiciMAD \+ rail stations in lens/);
});

test("deployment snapshot uses official CRTM M4 and M5 station services", () => {
  assert.match(builder, /M4_Red\/FeatureServer\/0\/query/);
  assert.match(builder, /M5_Red\/FeatureServer\/0\/query/);
  assert.match(builder, /parseCrtmStations\(d, "metro"\)/);
  assert.match(builder, /parseCrtmStations\(d, "cercanias"\)/);
});

test("rail snapshot is spatially bounded to central Madrid", () => {
  assert.match(builder, /CENTRAL_MADRID_ENVELOPE = "-3\.745,40\.385,-3\.645,40\.455"/);
});

test("rail tooltips preserve mode and line metadata", () => {
  assert.match(app, /p\.mode === "cercanias" \? "Cercanías" : "Metro"/);
  assert.match(app, /const lines = p\.lines \?/);
});
