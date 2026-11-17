// PNOA aerial imagery is an OPT-IN reference overlay, never evidence. Tile
// requests are stubbed (no external traffic); this asserts the explicit
// activation, the request shape, visible attribution, the presence/absence/error
// status in both languages, keyboard use, and that nothing canonical moves.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".css": "text/css", ".geojson": "application/geo+json", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const target = path.resolve(ROOT, pathname === "/" ? "index.html" : pathname.slice(1));
  if (!target.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end();
  fs.readFile(target, (error, content) => (error
    ? response.writeHead(404).end()
    : response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" }).end(content)));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const browser = await chromium.launch({ headless: true });
test.after(async () => { await browser.close(); server.close(); });

async function openPage({ ign = "ok", viewport = { width: 1280, height: 800 } } = {}) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const ignRequests = [];
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/runtime-config.js")) return route.fulfill({ contentType: "text/javascript", body: 'window.RUNTIME_CONFIG={CARTO_BASEMAP_KEY:""};' });
    if (url.hostname === "127.0.0.1") return route.continue();
    if (url.hostname === "www.ign.es") {
      ignRequests.push(url);
      return ign === "down" ? route.fulfill({ status: 503, body: "" }) : route.fulfill({ contentType: "image/png", body: PNG_1X1 });
    }
    if (route.request().resourceType() === "image") return route.fulfill({ contentType: "image/png", body: PNG_1X1 });
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/?lang=en`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#pnoaToggle", { state: "attached" });
  return { page, context, ignRequests };
}
const status = (page) => page.evaluate(() => {
  const el = document.getElementById("pnoaStatus");
  return { state: el.dataset.state, text: el.textContent };
});
const waitState = (page, state) => page.waitForFunction((s) => document.getElementById("pnoaStatus").dataset.state === s, state);
// The lens circle style is the observable output of the data-layer palette.
const lensStroke = (page) => page.evaluate(() => lenses.A.circle.options.color);

test("default: off, explicit absence statement, no IGN request, no attribution", async () => {
  const { page, context, ignRequests } = await openPage();
  assert.equal(await page.locator("#pnoaToggle").isChecked(), false);
  const s = await status(page);
  assert.equal(s.state, "off");
  assert.match(s.text, /every count and indicator is unaffected/);
  assert.equal(await page.locator(".leaflet-pnoa-pane img").count(), 0);
  assert.doesNotMatch(await page.locator("#map .leaflet-control-attribution").innerText(), /PNOA/);
  await page.waitForTimeout(300);
  assert.equal(ignRequests.length, 0, "nothing is requested from IGN until the reader opts in");
  assert.equal(await page.locator("#pnoaToggle").getAttribute("aria-describedby"), "pnoaStatus");
  assert.equal(await page.locator("#pnoaStatus").getAttribute("role"), "status");
  await context.close();
});

test("on: official WMS request shape, visible attribution, reference-only status, canonical URL untouched", async () => {
  const { page, context, ignRequests } = await openPage();
  await page.waitForTimeout(300);
  const urlBefore = await page.evaluate(() => location.search + location.hash);
  const strokeOff = await lensStroke(page);
  await page.locator("label.switch:has(#pnoaToggle)").click();
  await waitState(page, "on");
  const text = (await status(page)).text;
  assert.match(text, /Reference only: it is not an input to any count, indicator or Lens result/);
  assert.match(text, /different capture dates/);
  assert.ok(ignRequests.length > 0);
  const q = ignRequests[0];
  assert.equal(q.pathname, "/wms-inspire/pnoa-ma");
  assert.equal(q.searchParams.get("layers"), "OI.OrthoimageCoverage");
  assert.equal(q.searchParams.get("crs"), "EPSG:3857");
  assert.equal(q.searchParams.get("version"), "1.3.0");
  assert.equal(q.searchParams.get("request"), "GetMap");
  const attribution = await page.locator("#map .leaflet-control-attribution").innerText();
  assert.match(attribution, /PNOA/);
  assert.match(attribution, /Instituto Geográfico Nacional/);
  assert.match(attribution, /CC BY 4\.0/);
  assert.ok(await page.locator(".leaflet-pnoa-pane img").count() > 0, "imagery lives in its own pane");
  const z = await page.evaluate(() => ({ pnoa: +map.getPane("pnoaPane").style.zIndex, admin: +map.getPane("adminPane").style.zIndex, tile: +getComputedStyle(map.getPane("tilePane")).zIndex }));
  assert.ok(z.pnoa > z.tile && z.pnoa < z.admin, "above the basemap, below every data layer");
  assert.equal(await page.evaluate(() => location.search + location.hash), urlBefore, "the shareable URL does not encode the overlay");
  assert.equal(await lensStroke(page), "#ffffff", "data layers switch to the satellite palette over imagery");
  await page.locator("label.switch:has(#pnoaToggle)").click();
  assert.equal((await status(page)).state, "off");
  assert.equal(await page.locator(".leaflet-pnoa-pane img").count(), 0);
  assert.doesNotMatch(await page.locator("#map .leaflet-control-attribution").innerText(), /PNOA/);
  assert.equal(await lensStroke(page), strokeOff, "palette restored");
  await context.close();
});

test("basemap change while on keeps the overlay and the imagery palette", async () => {
  const { page, context } = await openPage();
  await page.locator("label.switch:has(#pnoaToggle)").click();
  await waitState(page, "on");
  await page.selectOption("#basemapSelect", "dark");
  assert.equal(await page.locator("#pnoaToggle").isChecked(), true);
  assert.ok(await page.locator(".leaflet-pnoa-pane img").count() > 0);
  assert.equal(await lensStroke(page), "#ffffff");
  await context.close();
});

test("service down: error status, nothing breaks, map still has its basemap", async () => {
  const { page, context } = await openPage({ ign: "down" });
  await page.locator("label.switch:has(#pnoaToggle)").click();
  await waitState(page, "error");
  assert.match((await status(page)).text, /unavailable.*every indicator are unchanged/);
  assert.ok(await page.locator(".leaflet-tile-pane img").count() > 0, "basemap still present");
  await context.close();
});

test("Spanish, keyboard activation and mobile width", async () => {
  const { page, context } = await openPage({ viewport: { width: 390, height: 780 } });
  await page.selectOption("#languageSelect", "es");
  await page.waitForFunction(() => /Desactivada/.test(document.getElementById("pnoaStatus").textContent));
  await page.locator("#mobileLayersButton").click();
  await page.locator('.rail-group[data-rail-group="map"] > summary').click();
  assert.match(await page.locator("#pnoaLabel").innerText(), /Ortofoto aérea · PNOA/);
  assert.equal(await page.locator("#pnoaLabel").isVisible(), true, "the control is reachable in the phone rail");
  await page.evaluate(() => document.getElementById("pnoaToggle").focus());
  assert.equal(await page.evaluate(() => document.activeElement.id), "pnoaToggle");
  await page.keyboard.press("Space");
  await waitState(page, "on");
  assert.match((await status(page)).text, /Solo referencia/);
  assert.match(await page.locator("#map .leaflet-control-attribution").innerText(), /CC BY 4\.0/);
  await context.close();
});
