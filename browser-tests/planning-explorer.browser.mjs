import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".css": "text/css", ".geojson": "application/geo+json", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const target = path.resolve(ROOT, pathname === "/" ? "index.html" : pathname.slice(1));
  if (!target.startsWith(`${ROOT}${path.sep}`) && target !== path.join(ROOT, "index.html")) return response.writeHead(403).end();
  fs.readFile(target, (error, content) => error ? response.writeHead(404).end() : response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" }).end(content));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const browser = await chromium.launch({ headless: true });

async function pageFor(viewport = { width: 1280, height: 900 }, unavailable = false, colorScheme = "light") {
  const context = await browser.newContext({ viewport, colorScheme });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (unavailable && url.pathname.endsWith("/data/planning/madrid_ambitos.geojson")) return route.fulfill({ status: 503, body: "unavailable" });
    return url.hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#planningExplorer")?.dataset.state !== "loading");
  return { page, context };
}
async function snapshot(page) { return page.evaluate(() => window.__HALO_REGRESSION__.planningExplorerSnapshot()); }

test.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); });

test("explorer searches exact codes, rejects unknown codes, and highlights only after selection", async (t) => {
  const { page, context } = await pageFor(); t.after(() => context.close());
  const query = page.locator("#planningExplorerQuery");
  await query.fill("APR.02.09");
  await page.waitForFunction(() => document.querySelectorAll("#planningExplorerResults button").length === 1);
  assert.deepEqual((await snapshot(page)).results, ["APR.02.09"]);
  assert.equal((await snapshot(page)).selectedLayer, false);
  await page.locator("#planningExplorerResults button").click();
  const selected = await snapshot(page);
  assert.equal(selected.selectedCode, "APR.02.09");
  assert.equal(selected.selectedLayer, true);
  assert.equal(selected.cameraMoves, 0);
  const inspection = await page.evaluate(() => ({
    code: document.querySelector("#planningExplorerCode").textContent,
    phases: document.querySelectorAll("#planningExplorerPhaseRows li").length,
    buildability: document.querySelectorAll("#planningExplorerBuildRows .planning-uses li").length,
    inspectedState: document.querySelector("#planningExplorerStateAbsent").hidden,
    inspectedBuild: document.querySelector("#planningExplorerBuildAbsent").hidden,
  }));
  assert.equal(inspection.code, "APR.02.09");
  assert.equal(inspection.phases, 4);
  assert.ok(inspection.buildability >= 4);
  assert.equal(inspection.inspectedState, true);
  assert.equal(inspection.inspectedBuild, true);
  await page.locator("#planningExplorerEvidenceToggle").click();
  assert.match(await page.locator("#evidenceDrawerFilter").textContent(), /Dataset-level provenance.*Inspected official ámbito: APR\.02\.09/);
  await page.locator("#evidenceDrawerClose").click();
  await query.fill("NOT.A.REAL.CODE");
  assert.match(await page.locator("#planningExplorerStatus").textContent(), /No official planning ámbito/i);
});

test("changing an inspected ámbito replaces fields without stale values", async (t) => {
  const { page, context } = await pageFor(); t.after(() => context.close());
  const select = async (code) => {
    await page.locator("#planningExplorerQuery").fill(code);
    await page.locator("#planningExplorerResults button").click();
    return page.evaluate(() => ({ code: document.querySelector("#planningExplorerCode").textContent, phases: [...document.querySelectorAll("#planningExplorerPhaseRows li")].map((row) => row.textContent), build: document.querySelector("#planningExplorerBuildRows").textContent }));
  };
  const first = await select("APR.02.09");
  const alternative = await page.evaluate(() => [...document.querySelectorAll("#planningExplorerResults button")].map((node) => node.dataset.code)[0]);
  assert.equal(alternative, "APR.02.09");
  const second = await select("APE.01.01");
  assert.equal(second.code, "APE.01.01");
  assert.notDeepEqual(second.phases, first.phases);
  assert.notEqual(second.build, first.build);
});

test("selected inspector preserves canonical phase distinctions and separate published buildability rows", async (t) => {
  const { page, context } = await pageFor(); t.after(() => context.close());
  const select = async (code) => {
    await page.locator("#planningExplorerQuery").fill(code);
    await page.locator("#planningExplorerResults button").click();
  };
  await select("APR.02.09");
  assert.equal(await page.locator("#planningExplorerPhaseRows .planning-phase-mark").first().textContent(), "?");
  assert.match(await page.locator("#planningExplorerPhaseRows .sr-only").first().textContent(), /Unresolved meaning/);
  assert.match(await page.locator("#planningExplorerPhaseRows .planning-phase-note").first().textContent(), /distinct state; its precise meaning is not defined/i);
  assert.match(await page.locator("#planningExplorerPhaseRows").textContent(), /No Necesita/);

  await select("APE.01.01");
  assert.equal(await page.locator("#planningExplorerPhaseRows .planning-phase-mark").first().textContent(), "§");
  assert.match(await page.locator("#planningExplorerPhaseRows .sr-only").first().textContent(), /Plan-of-origin marker/);
  assert.match(await page.locator("#planningExplorerPhaseRows .planning-phase-note").first().textContent(), /not a development state/i);
  assert.match(await page.locator("#planningExplorerPhaseRows").textContent(), /PGOUM-97/);

  await select("AOE.00.11-RP");
  assert.match(await page.locator("#planningExplorerPhaseRows .planning-phase-note").textContent(), /Observed in the published data; not listed/i);
  assert.match(await page.locator("#planningExplorerPhaseRows").textContent(), /En Ejecución/);

  await select("APR.21.02");
  assert.match(await page.locator("#planningExplorerBuildRows .planning-block-note").textContent(), /more than one row.*never added together/i);
  assert.ok(await page.locator("#planningExplorerBuildRows .planning-build-row").count() > 1);
});

test("only the explicit Show on map action changes camera; Lens and COMPARE stay untouched", async (t) => {
  const { page, context } = await pageFor(); t.after(() => context.close());
  const before = await page.evaluate(() => ({ view: window.__HALO_REGRESSION__.mapView(), centres: window.__HALO_REGRESSION__.lensCenters(), explorer: window.__HALO_REGRESSION__.planningExplorerSnapshot() }));
  await page.locator("#planningExplorerQuery").fill("APR.02.09");
  await page.locator("#planningExplorerResults button").click();
  const afterSelect = await page.evaluate(() => ({ view: window.__HALO_REGRESSION__.mapView(), centres: window.__HALO_REGRESSION__.lensCenters(), explorer: window.__HALO_REGRESSION__.planningExplorerSnapshot(), mode: document.querySelector("#analysisPanel").dataset.mode }));
  assert.deepEqual(afterSelect.view, before.view);
  assert.deepEqual(afterSelect.centres, before.centres);
  assert.equal(afterSelect.explorer.cameraMoves, 0);
  assert.equal(afterSelect.mode, "PLACE");
  await page.locator("#planningExplorerMap").click();
  const afterMap = await page.evaluate(() => ({ view: window.__HALO_REGRESSION__.mapView(), centres: window.__HALO_REGRESSION__.lensCenters(), explorer: window.__HALO_REGRESSION__.planningExplorerSnapshot() }));
  assert.notDeepEqual(afterMap.view, before.view);
  assert.deepEqual(afterMap.centres, before.centres);
  assert.equal(afterMap.explorer.cameraMoves, 1);
  await page.locator("#modeCompareButton").click();
  assert.equal((await snapshot(page)).selectedLayer, false, "PLACE selection never becomes a COMPARE polygon");
});

test("keyboard, Spanish copy, mobile control size, reset and unavailable state are explicit", async (t) => {
  const { page, context } = await pageFor({ width: 375, height: 812 }); t.after(() => context.close());
  const query = page.locator("#planningExplorerQuery");
  await query.fill("APR.02.09");
  await query.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.code), "APR.02.09");
  await page.keyboard.press("Enter");
  assert.equal((await snapshot(page)).selectedCode, "APR.02.09");
  const mobile = await page.evaluate(() => ({
    map: document.querySelector("#planningExplorerMap").getBoundingClientRect().height,
    evidence: document.querySelector("#planningExplorerEvidenceToggle").getBoundingClientRect().height,
    summary: document.querySelector("#planningExplorerEvidence summary").getBoundingClientRect().height,
    close: document.querySelector("#planningExplorerClose").getBoundingClientRect().height,
    query: document.querySelector("#planningExplorerQuery").getBoundingClientRect().height,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
  }));
  assert.ok(mobile.map >= 44);
  assert.ok(mobile.evidence >= 44);
  assert.ok(mobile.summary >= 44);
  assert.ok(mobile.close >= 44);
  assert.ok(mobile.query >= 44);
  assert.equal(mobile.overflow, false);
  await page.locator("#languageSelect").selectOption("es");
  assert.equal(await page.locator("#planningExplorerMap").textContent(), "Ver en mapa");
  await page.locator("#planningExplorerClose").click();
  assert.equal((await snapshot(page)).selectedLayer, false);
  const absent = await pageFor({ width: 800, height: 700 }, true); t.after(() => absent.context.close());
  assert.equal((await snapshot(absent.page)).state, "unavailable");
  assert.match(await absent.page.locator("#planningExplorerStatus").textContent(), /unavailable/i);
});

test("native result buttons retain focus through Lens refresh and language change", async (t) => {
  const { page, context } = await pageFor(); t.after(() => context.close());
  const query = page.locator("#planningExplorerQuery");
  await query.fill("APR.02.09");
  await query.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), "BUTTON");
  await page.evaluate(() => window.__HALO_REGRESSION__.moveLensToLatLng("A", 40.40255, -3.71371));
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.code), "APR.02.09");
  await page.locator("#languageSelect").selectOption("es");
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.code), "APR.02.09");
  const semantics = await page.locator("#planningExplorerResults").evaluate((node) => ({ role: node.getAttribute("role"), buttonRole: node.querySelector("button")?.getAttribute("role") }));
  assert.equal(semantics.role, null);
  assert.equal(semantics.buttonRole, null);
  await page.keyboard.press("Enter");
  assert.equal((await snapshot(page)).selectedCode, "APR.02.09");
});

test("explorer uses appearance tokens in Light, Dark and System without changing the map", async (t) => {
  const { page, context } = await pageFor({ width: 1280, height: 900 }, false, "dark"); t.after(() => context.close());
  await page.locator("#planningExplorerQuery").fill("APR.02.09");
  await page.locator("#planningExplorerResults button").click();
  const sample = async () => page.evaluate(() => {
    const node = document.querySelector("#planningExplorer");
    const map = window.__HALO_REGRESSION__.mapView();
    return { appearance: document.documentElement.dataset.appearance, color: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor, map };
  });
  const lightBefore = await sample();
  await page.locator("#appearanceSelect").selectOption("light");
  const light = await sample();
  await page.locator("#appearanceSelect").selectOption("dark");
  const dark = await sample();
  await page.locator("#appearanceSelect").selectOption("system");
  const system = await sample();
  assert.equal(light.appearance, "light");
  assert.equal(dark.appearance, "dark");
  assert.equal(system.appearance, "dark");
  assert.notEqual(light.color, dark.color);
  assert.notEqual(light.background, dark.background);
  assert.deepEqual(light.map, lightBefore.map);
  assert.deepEqual(dark.map, lightBefore.map);
  assert.deepEqual(system.map, lightBefore.map);
  await page.locator("#languageSelect").selectOption("es");
  assert.match(await page.locator("#planningExplorerEdition").textContent(), /Edición del estado de desarrollo: 1 ene\. 2026.*Edición de edificabilidad disponible: 1 ene\. 2026/);
});
