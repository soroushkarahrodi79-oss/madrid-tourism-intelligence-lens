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
  assert.match(html, /css\/app\.css\?v=20260928-19/);
});


test("desktop analysis panel is substantially larger by default", () => {
  assert.match(css, /width:min\(480px,calc\(100vw - 300px/);
  assert.match(css, /height:min\(720px,calc\(100dvh - 108px/);
  assert.match(css, /min-width:390px/);
  assert.match(css, /min-height:360px/);
});

test("low-height laptop view no longer collapses the desktop panel to 44vh", () => {
  const shortDesktopStart = css.indexOf("@media(max-height:700px){");
  const compactShortStart = css.indexOf("@media(max-width:850px) and (max-height:700px){");
  assert.ok(shortDesktopStart >= 0 && compactShortStart > shortDesktopStart);
  const shortDesktopBlock = css.slice(shortDesktopStart, compactShortStart);
  assert.doesNotMatch(shortDesktopBlock, /\.panel\{/);
  assert.match(css, /@media\(max-width:850px\) and \(max-height:700px\)\{\s*\.panel\{max-height:44vh;max-height:44dvh\}/);
});

test("manual resize control is desktop-only and touch-safe", () => {
  assert.match(html, /id="panelResizeHandle"/);
  assert.match(css, /\.panel-resize-handle\{[\s\S]*?cursor:nesw-resize;touch-action:none/);
  assert.match(css, /@media\(max-width:850px\)[\s\S]*?\.panel-resize-handle\{display:none\}/);
});
