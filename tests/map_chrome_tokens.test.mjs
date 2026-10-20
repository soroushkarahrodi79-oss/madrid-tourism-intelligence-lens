import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const css = fs.readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const darkTokens = css.slice(0, css.indexOf("*{box-sizing:border-box}"));
const lightBlock = css.match(/:root\[data-appearance="light"\]\{([^}]*)\}/)?.[1] || "";

function token(source, name) {
  const value = source.match(new RegExp(`--${name}:([^;]+);`))?.[1];
  assert.ok(value, `missing --${name}`);
  return value;
}

test("T-a4 map chrome roles preserve Dark values and prepare dormant Light values", () => {
  const expectedDark = {
    "map-fallback-surface": "#09111c",
    "map-attribution-surface": "rgba(5,8,12,.75)",
    "map-attribution-text": "#aab9ca", // approved contrast correction from #8798ab
    "map-attribution-link": "#b9c7d7",
    "map-zoom-surface": "#0b1521",
    "map-zoom-text": "#fff",
    "map-zoom-edge": "#25364a",
    "map-zoom-hover-surface": "#0b1521",
    "map-zoom-disabled-text": "#fff",
    "map-zoom-disabled-opacity": ".56",
    "map-zoom-shadow": "0 8px 24px rgba(0,0,0,.24)",
    "map-tooltip-surface": "#09131f",
    "map-tooltip-text": "#fff",
    "map-tooltip-edge": "#31465d",
    "map-tooltip-arrow": "#31465d",
    "map-tooltip-shadow": "0 10px 28px rgba(0,0,0,.4)",
    "map-label-surface": "rgba(9,18,30,.9)",
    "map-label-text": "#e8f0fa",
    "map-label-edge": "rgba(178,203,228,.42)",
    "map-label-shadow": "0 6px 18px rgba(0,0,0,.45)",
    "map-label-b-edge": "rgba(67,215,255,.45)",
    "map-label-b-text": "var(--ta3-lens-b-text)",
  };
  for (const [name, value] of Object.entries(expectedDark)) assert.equal(token(darkTokens, name), value);

  const expectedLight = {
    "map-fallback-surface": "#f4f6f9",
    "map-attribution-surface": "rgba(255,255,255,.92)",
    "map-attribution-text": "#445468",
    "map-attribution-link": "#0a63c7",
    "map-zoom-surface": "#fff",
    "map-zoom-text": "#16222f",
    "map-zoom-edge": "#74808e",
    "map-zoom-hover-surface": "#f2f4f7",
    "map-zoom-disabled-text": "#667586",
    "map-zoom-disabled-opacity": "1",
    "map-zoom-shadow": "0 8px 24px rgba(16,24,34,.18)",
    "map-tooltip-surface": "rgba(255,255,255,.96)",
    "map-tooltip-text": "#16222f",
    "map-tooltip-edge": "#74808e",
    "map-tooltip-arrow": "#74808e",
    "map-tooltip-shadow": "0 10px 28px rgba(16,24,34,.18)",
    "map-label-surface": "rgba(255,255,255,.94)",
    "map-label-text": "#16222f",
    "map-label-edge": "#74808e",
    "map-label-shadow": "0 6px 18px rgba(16,24,34,.16)",
    "map-label-b-edge": "#00718f",
    "map-label-b-text": "#00718f",
  };
  for (const [name, value] of Object.entries(expectedLight)) assert.equal(token(lightBlock, name), value);
});

test("T-a4 tokens own only the bounded application map chrome and keep Light dormant", () => {
  assert.match(css, /#map\{[^}]*background:var\(--map-fallback-surface\)/);
  assert.match(css, /\.leaflet-container\{[^}]*background:var\(--map-fallback-surface\)/);
  assert.match(css, /\.leaflet-control-attribution\{background:var\(--map-attribution-surface\)!important;color:var\(--map-attribution-text\)!important\}/);
  assert.match(css, /\.leaflet-control-attribution a\{color:var\(--map-attribution-link\)!important;text-decoration:underline;text-underline-offset:2px\}/);
  assert.match(css, /\.leaflet-control-zoom a\{[^}]*background:var\(--map-zoom-surface\)!important;color:var\(--map-zoom-text\)!important;border-color:var\(--map-zoom-edge\)!important\}/);
  assert.match(css, /\.leaflet-control-zoom a:hover\{background:var\(--map-zoom-hover-surface\)!important\}/);
  assert.match(css, /\.leaflet-control-zoom a\.leaflet-disabled\{[^}]*opacity:var\(--map-zoom-disabled-opacity\)/);
  assert.match(css, /\.leaflet-tooltip\{background:var\(--map-tooltip-surface\);border:1px solid var\(--map-tooltip-edge\);color:var\(--map-tooltip-text\)/);
  assert.match(css, /\.leaflet-tooltip-top:before\{border-top-color:var\(--map-tooltip-arrow\)\}/);
  assert.match(css, /\.area-label\{background:var\(--map-label-surface\);border:1px solid var\(--map-label-edge\);color:var\(--map-label-text\)/);
  assert.match(css, /\.area-label-b\{border-color:var\(--map-label-b-edge\)\}/);

  assert.equal((html.match(/data-appearance=/g) || []).length, 0, "no theme is activated in markup");
  assert.doesNotMatch(app, /(?:setAttribute|dataset)\s*\(?\s*["']data-appearance|dataset\.appearance\s*=/,
    "application startup must not activate an appearance");
  assert.match(css, /--chrome-focus-ring-color:#9bd5ff;/, "map chrome reuses the T-a2 focus token");
  assert.match(css, /--chrome-focus-separation-color:#08101a;/, "map chrome reuses the T-a2 separation token");
});
