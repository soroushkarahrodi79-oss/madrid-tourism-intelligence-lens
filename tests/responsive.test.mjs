import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const css = fs.readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("responsive layout uses safe-area insets for notched/tablet devices", () => {
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /safe-area-inset-right/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /safe-area-inset-left/);
});

test("Leaflet zoom controls move away from the layer panel on tablet/mobile", () => {
  assert.match(css, /\.leaflet-top\.leaflet-left\{top:calc\(73px \+ var\(--safe-top\)\);left:auto;right:calc\(10px \+ var\(--safe-right\)\)\}/);
});

test("touch controls have larger tap targets", () => {
  assert.match(css, /@media\(pointer:coarse\)/);
  assert.match(css, /\.switch\{width:42px;height:24px\}/);
  assert.match(css, /\.leaflet-control-zoom a\{width:42px!important;height:42px!important/);
});

test("mobile form controls avoid iOS focus zoom", () => {
  assert.match(css, /select,\.smallbtn\{font-size:16px\}/);
  assert.match(css, /\.basemap-control select\{font-size:16px\}/);
});

test("responsive stylesheet is cache-busted in the page", () => {
  assert.match(html, /css\/app\.css\?v=20260928-16/);
});
