import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const dynamics = fs.readFileSync(new URL("../js/domestic-origin-dynamics.js", import.meta.url), "utf8");

test("Dynamics is nested within Domestic Origins and uses its existing source-month control", () => {
  const originsStart = html.indexOf('<section id="domesticOrigins"');
  const dynamicsStart = html.indexOf('<section id="domesticOriginDynamics"');
  assert.ok(originsStart >= 0 && dynamicsStart > originsStart);
  assert.match(app, /compareDomesticOriginMonths\(originModel\.index, originMonth\)/);
  assert.match(app, /getElementById\("domesticOriginsMonth"\)\.onchange[\s\S]*originMonth = event\.target\.value/);
  assert.equal((html.match(/<select id="[^"]+"/g) || []).filter((item) => /month/i.test(item)).length, 1);
});

test("Dynamics carries both threshold disclosures and no international or map feature", () => {
  assert.match(dynamics, /Changes in published presence do not necessarily mean an origin gained or lost tourists/);
  assert.match(dynamics, /Los cambios de presencia publicada no implican necesariamente que un origen haya ganado o perdido turistas/);
  assert.doesNotMatch(html + dynamics, /international origin|origin map|flow line|choropleth|spider map/i);
});

test("Production labels use published-set terminology and retain null semantics", () => {
  assert.match(html, /Newly present in published set/);
  assert.match(html, /No longer present in published set/);
  assert.match(dynamics, /previousCount: null/);
  assert.match(dynamics, /currentCount: null/);
  assert.doesNotMatch(html, /new market|lost market|visitor retention|market churn/i);
});
