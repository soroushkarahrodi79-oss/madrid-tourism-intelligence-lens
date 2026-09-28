import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const builder = fs.readFileSync(new URL("../scripts/build_runtime_poi.mjs", import.meta.url), "utf8");

test("principal parks are a distinct context layer and off by default", () => {
  assert.match(html, /<span>Context<\/span>/);
  assert.match(html, /<small>not in metrics<\/small>/);
  assert.match(html, /Principal parks/);
  assert.match(html, /data-layer="park" type="checkbox"/);
  assert.doesNotMatch(html, /data-layer="park" type="checkbox" checked/);
  assert.match(app, /park: L\.layerGroup\(\),/);
});

test("deployment builder uses the official Madrid principal parks JSON resource", () => {
  assert.match(builder, /200761-0-parques-jardines/);
  assert.match(builder, /200761-5-parques-jardines-json/);
  assert.match(builder, /parseMadridOpenData\(d, "park"\)/);
});

test("park deployment snapshot is bounded to the same central-Madrid envelope", () => {
  assert.match(builder, /point\.lat >= 40\.385/);
  assert.match(builder, /point\.lat <= 40\.455/);
  assert.match(builder, /point\.lon >= -3\.745/);
  assert.match(builder, /point\.lon <= -3\.645/);
});

test("park records stay outside analytical POI statistics", () => {
  assert.match(app, /let poiPoints = \[\];\nlet parkPoints = \[\];/);
  assert.match(app, /parkPoints = \(runtimePOI\?\.layers\?\.park \|\| \[\]\)/);
  assert.match(app, /return poiStatsInLens\(visiblePoiPoints\(\), centerOf\(which\), radius\)/);
  assert.match(app, /Park context is excluded from lens counts, category mix, nearest features and A\/B comparisons/);
});

test("park markers are rendered as context without lens-shading identity", () => {
  const parkMarkerBlock = app.match(/function addParkContextMarker\(p\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(parkMarkerBlock, /m\._context = p/);
  assert.doesNotMatch(parkMarkerBlock, /m\._p = p/);
  assert.match(parkMarkerBlock, /m\.addTo\(groups\.park\)/);
});
