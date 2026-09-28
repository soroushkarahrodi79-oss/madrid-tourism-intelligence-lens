import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("satellite mode uses imagery plus Esri reference overlays", () => {
  assert.match(app, /World_Imagery\/MapServer\/tile/);
  assert.match(app, /Reference\/World_Transportation\/MapServer\/tile/);
  assert.match(app, /Reference\/World_Boundaries_and_Places\/MapServer\/tile/);
  assert.match(app, /L\.layerGroup\(\[imagery, transportation, labels\]\)/);
});

test("reference overlays render above imagery", () => {
  assert.match(app, /zIndex: 200/);
  assert.match(app, /zIndex: 300/);
  assert.match(app, /zIndex: 310/);
});

test("satellite control communicates that labels are included", () => {
  assert.match(html, /Satellite \+ labels · Esri/);
});

test("only imagery failure triggers the global satellite fallback", () => {
  assert.match(app, /imagery\.on\("tileerror", \(event\) => hybrid\.fire\("tileerror", event\)\)/);
});

test("updated app script is cache-busted", () => {
  assert.match(html, /js\/app\.js\?v=20260928-15/);
});
