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
  assert.match(css, /\.leaflet-top\.leaflet-left\{top:calc\(var\(--header-bottom\) \+ 10px\);left:auto;right:calc\(10px \+ var\(--safe-right\)\)\}/);
});

test("coarse-pointer controls share the universal 44px floor", () => {
  assert.match(css, /@media\(pointer:coarse\)/);
  assert.match(css, /:where\(button,select,summary,a\[href\],\[role="button"\],input\[type="range"\],input\[type="checkbox"\]\)\{min-width:44px;min-height:44px\}/);
  assert.match(css, /\.switch\{width:44px;height:44px\}/);
  assert.match(css, /\.place-jump-chip\{min-height:44px;/, "the quick-jump class must not undercut the coarse-pointer floor");
  assert.doesNotMatch(css, /\.place-jump-chip\{[^}]*min-height:(?:[0-3]\d|4[0-3])px/);
});

test("P1 map-first phone disclosure keeps the complete layer rail available on demand", () => {
  assert.match(html, /id="mobileLayersButton"[^>]*aria-expanded="false"[^>]*aria-controls="layerRail"/);
  assert.match(css, /@media\(max-width:560px\)\{[\s\S]*?\.mobile-layers-button\{display:inline-flex\}/);
  assert.match(css, /\.left\[hidden\]\{display:none!important\}/);
  assert.match(css, /\.leaflet-control-attribution a\[href\]\{display:inline;min-width:0;min-height:0\}/);
});

test("P1 small-screen rail uses six native disclosure groups and preserves all ten layer switches", () => {
  assert.equal((html.match(/<details class="rail-group"/g) || []).length, 6);
  assert.equal((html.match(/<summary>/g) || []).length >= 6, true);
  assert.equal((html.match(/<input[^>]+data-layer=/g) || []).length, 10);
  assert.match(css, /@media\(max-width:850px\)[\s\S]*?\.rail-group>summary\{[^}]*min-height:44px/);
});

test("the two skip links are first in the body and become visible on focus", () => {
  assert.match(html, /<body>\s*<a class="sr-only skip-link" href="#analysisPanel"[^>]*>[^<]+<\/a>\s*<a class="sr-only skip-link" href="#layerRail"/);
  assert.match(css, /\.skip-link:focus\{[^}]*position:fixed[^}]*clip:auto/);
});

test("form control typography is central rather than breakpoint-specific", () => {
  assert.match(css, /select,[^}]*\{font-size:var\(--t-label\)\}/);
  for (const block of mediaBlocks(css)) assert.doesNotMatch(block, /font-size\s*:/);
});

test("responsive stylesheet is cache-busted in the page", () => {
  assert.match(html, /css\/app\.css\?v=[\w.-]+/);
});


test("desktop analysis panel is substantially larger by default", () => {
  assert.match(css, /width:var\(--analysis-panel-width,min\(480px,calc\(100vw - 300px/);
  assert.match(css, /height:var\(--analysis-panel-height,min\(720px,calc\(100dvh - 108px/);
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

function mediaBlocks(source) {
  const blocks = [];
  let index = source.indexOf("@media");
  while (index !== -1) {
    const open = source.indexOf("{", index);
    let depth = 1;
    let cursor = open + 1;
    while (depth && cursor < source.length) {
      if (source[cursor] === "{") depth += 1;
      if (source[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    blocks.push(source.slice(open + 1, cursor - 1));
    index = source.indexOf("@media", cursor);
  }
  return blocks;
}
