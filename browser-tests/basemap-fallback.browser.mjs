// Issue #155 — the basemap selector names the provider that is actually serving
// tiles. Tile requests are stubbed (no external traffic) and the CARTO key is a
// fake test value; only the fallback state, labels and warnings are asserted.

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

// `cartoTiles`: "ok" serves stub tiles, "denied" answers CARTO tile requests 403
// (what an invalid or host-restricted key produces).
async function openPage({ key = "", cartoTiles = "ok" } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const warnings = [];
  page.on("console", (message) => { if (message.type() === "warning") warnings.push(message.text()); });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/runtime-config.js")) return route.fulfill({ contentType: "text/javascript", body: `window.RUNTIME_CONFIG={CARTO_BASEMAP_KEY:${JSON.stringify(key)}};` });
    if (url.hostname === "127.0.0.1") return route.continue();
    if (url.hostname.endsWith("cartocdn.com") && cartoTiles === "denied") return route.fulfill({ status: 403, body: "" });
    if (route.request().resourceType() === "image") return route.fulfill({ contentType: "image/png", body: PNG_1X1 });
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#basemapSelect");
  return { page, context, warnings };
}

const state = (page) => page.evaluate(() => {
  const select = document.getElementById("basemapSelect");
  return {
    provider: select.dataset.effectiveProvider,
    reason: select.dataset.fallbackReason || null,
    labels: Object.fromEntries([...select.options].map((o) => [o.value, o.textContent])),
  };
});

test("missing CARTO key: UI names OpenStreetMap, state is machine-readable, one warning", async () => {
  const { page, context, warnings } = await openPage();
  let s = await state(page);
  assert.equal(s.provider, "osm");
  assert.equal(s.reason, "missing-key");
  assert.doesNotMatch(s.labels.light, /Positron/);
  assert.doesNotMatch(s.labels.dark, /Dark Matter/);
  assert.match(s.labels.light, /OpenStreetMap/);
  assert.equal(s.labels.satellite, "Satellite + labels · Esri");

  await page.selectOption("#basemapSelect", "dark");
  await page.selectOption("#basemapSelect", "satellite");
  s = await state(page);
  assert.equal(s.provider, "esri");
  assert.equal(s.reason, null);
  assert.doesNotMatch(s.labels.light, /Positron/, "fallback labels persist while Satellite is selected");
  assert.doesNotMatch(s.labels.dark, /Dark Matter/);
  assert.match(s.labels.dark, /light/, "Dark fallback says the OSM tiles are standard/light");
  await page.selectOption("#basemapSelect", "light");
  assert.equal((await state(page)).provider, "osm");
  assert.equal(warnings.filter((w) => w.includes("CARTO_BASEMAP_KEY")).length, 1, "warns exactly once");

  await page.selectOption("#languageSelect", "es");
  await page.waitForFunction(() => /no disponible/.test(document.querySelector('#basemapSelect option[value="light"]').textContent));
  assert.doesNotMatch((await state(page)).labels.light, /Positron/);
  await context.close();
});

test("valid CARTO key: Positron/Dark Matter labels and provider unchanged, no warning", async () => {
  const { page, context, warnings } = await openPage({ key: "test-key" });
  const s = await state(page);
  assert.equal(s.provider, "carto");
  assert.equal(s.reason, null);
  assert.equal(s.labels.light, "Light · CARTO Positron");
  assert.equal(s.labels.dark, "Dark · CARTO Dark Matter");
  assert.equal(warnings.filter((w) => w.includes("CARTO_BASEMAP_KEY")).length, 0);
  await context.close();
});

test("runtime tile failure (invalid or host-restricted key) falls back to OSM and says so", async () => {
  const { page, context, warnings } = await openPage({ key: "test-key", cartoTiles: "denied" });
  await page.waitForFunction(() => document.getElementById("basemapSelect").dataset.effectiveProvider === "osm");
  const s = await state(page);
  assert.equal(s.reason, "tile-error");
  assert.match(s.labels.light, /OpenStreetMap/);
  assert.equal(s.labels.dark, "Dark · CARTO Dark Matter", "only the failed selection is relabelled");
  assert.equal(warnings.filter((w) => w.includes("CARTO_BASEMAP_KEY")).length, 0, "key was configured; no missing-key warning");
  assert.ok(await page.evaluate(() => document.querySelectorAll(".leaflet-tile-pane img").length > 0), "map is not blank");
  await context.close();
});
