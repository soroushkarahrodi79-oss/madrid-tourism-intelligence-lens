import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("lens circles render in a dedicated pane above vector POIs", () => {
  assert.match(app, /map\.createPane\("lensPane"\)/);
  assert.match(app, /map\.getPane\("lensPane"\)\.style\.zIndex = "460"/);
  assert.match(app, /pane: "lensPane"/);
});

test("lens contrast adapts to light satellite and dark basemaps", () => {
  assert.match(app, /const LENS_BASEMAP_STYLES = \{/);
  assert.match(app, /light: \{[\s\S]*?color: "#123b5f"/);
  assert.match(app, /satellite: \{[\s\S]*?color: "#ffffff"/);
  assert.match(app, /dark: \{[\s\S]*?color: "#ffffff"/);
  assert.match(app, /if \(lensStyleController\) lensStyleController\(requested\)/);
});

test("active lens boundary is stronger than inactive lens boundary, but quiet enough for the V3 bars", () => {
  const weight = app.match(/weight: isActive \? ([\d.]+) : ([\d.]+)/);
  const opacity = app.match(/opacity: isActive \? ([\d.]+) : ([\d.]+)/);
  assert.ok(weight, "lens weight is driven by the active flag");
  assert.ok(opacity, "lens opacity is driven by the active flag");
  assert.ok(Number(weight[1]) > Number(weight[2]), "active boundary is thicker than inactive");
  assert.ok(Number(opacity[1]) > Number(opacity[2]), "active boundary is more opaque than inactive");
  // The circumference must stay quieter than the data bars (fill stroke-width 9).
  assert.ok(Number(weight[1]) <= 3, "active boundary does not dominate the perimeter bars");
  assert.match(app, /applyLensBasemapStyle\(activeBasemapName\)/);
});

test("lens boundaries use a two-sided contrast halo for mixed imagery", () => {
  assert.match(css, /\.lens-boundary\{filter:drop-shadow\(0 0 1\.5px rgba\(0,0,0,\.9\)\) drop-shadow\(0 0 2\.5px rgba\(255,255,255,\.5\)\)/);
});

test("adaptive lens assets are cache-busted", () => {
  assert.match(html, /css\/app\.css\?v=[\w.-]+/);
  assert.match(html, /js\/app\.js\?v=[\w.-]+/);
});
