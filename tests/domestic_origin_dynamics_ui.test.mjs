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

test("app script, stylesheet, shell scripts and the app's own modules and registry share one cache version, independent of the K11 snapshot id", () => {
  const appVersion = html.match(/js\/app\.js\?v=([\w-]+)/)?.[1];
  const cssVersion = html.match(/css\/app\.css\?v=([\w-]+)/)?.[1];
  const moduleVersion = app.match(/const ORIGIN_CONTEXT_MODULE_VERSION = "([\w-]+)"/)?.[1];
  const areaVersion = app.match(/const AREA_PROFILE_MODULE_VERSION = "([\w-]+)"/)?.[1];
  const registryVersion = app.match(/const REGISTRY_ASSET_VERSION = "([\w-]+)"/)?.[1];
  assert.ok(appVersion && cssVersion && moduleVersion && areaVersion && registryVersion);
  assert.equal(new Set([appVersion, cssVersion, moduleVersion, areaVersion, registryVersion]).size, 1);
  // The scripts the registered-unemployment change modified are served under that same version,
  // so no browser can pair a new app.js with a cached scope-rail, dictionary or catalogue.
  for (const script of ["scope-rail", "shell-copy", "legacy-copy"]) {
    assert.equal(html.match(new RegExp(`js/${script}\\.js\\?v=([\\w-]+)`))?.[1], appVersion, `${script}.js carries the release version`);
  }
  assert.match(app, /import\(moduleUrl\("domestic-origin-context\.js", ORIGIN_CONTEXT_MODULE_VERSION\)\)/);
  assert.match(app, /import\(moduleUrl\("area-profile\.js", AREA_PROFILE_MODULE_VERSION\)\)/);
  assert.match(app, /fetchAreaJson\("data\/source_registry\.json", REGISTRY_ASSET_VERSION\)/);
  // Unmodified data artifacts keep the original asset identity (and the K11 snapshot id does not move).
  assert.match(app, /function fetchAreaJson\(url, version = AREA_ASSET_VERSION\)/);
  assert.match(app, /const AREA_ASSET_VERSION = "20261029-m3-dossier-v1"/);
  assert.match(app, /const K11_SNAPSHOT_ID = AREA_ASSET_VERSION/);
});
