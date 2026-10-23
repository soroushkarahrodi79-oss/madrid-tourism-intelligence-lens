import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Cartographic HOLD contract for Hospitality & Commercial Context: no indicator
// may colour a barrio polygon by value, the min-max legend is absent, and the
// administrative values, barrio selection and ES/EN copy still work.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".css": "text/css",
  ".geojson": "application/geo+json",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "hospitality-commercial-context.json"), "utf8"));
const INDICATORS = artifact.metadata.selectable_indicator_ids;

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const target = path.resolve(ROOT, pathname === "/" ? "index.html" : pathname.slice(1));
  if (!target.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end();
  fs.readFile(target, (error, content) => {
    if (error) return response.writeHead(404).end();
    response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" }).end(content);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });

async function newPage(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, ...options });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === "127.0.0.1" || host === "localhost" ? route.continue() : route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__));
  return page;
}

const fills = (page) => page.evaluate(() => window.__HALO_REGRESSION__.hospitalityFillSnapshot());

test("no indicator colours any barrio polygon, and the min-max legend is absent", async () => {
  const page = await newPage();
  assert.equal(await page.evaluate(() => window.__HALO_REGRESSION__.enableHospitality()), "ready");
  for (const id of INDICATORS) {
    await page.evaluate((metric) => window.__HALO_REGRESSION__.setHospitalityMetric(metric), id);
    const snap = await fills(page);
    assert.equal(snap.fills.length, 131, id);
    assert.ok(snap.fills.every((f) => f.fillOpacity === 0), `${id}: a polygon has a visible fill`);
    assert.equal(snap.scaleHidden, true, id);
    assert.equal(snap.scaleMin, null, id);
    assert.equal(snap.scaleMax, null, id);
    assert.equal(snap.holdNoticeHidden, false, id);
  }
  await page.context().close();
});

test("administrative value, selection and ES/EN copy still work during the hold", async () => {
  const page = await newPage();
  await page.evaluate(() => window.__HALO_REGRESSION__.enableHospitality());
  const barrio = await page.evaluate(() => window.__HALO_REGRESSION__.hospitalitySnapshot().sampleBarrio);
  const expected = artifact.barrios[barrio].indicators.core_hospitality_premises_count;
  await page.evaluate((id) => window.__HALO_REGRESSION__.selectHospitalityBarrio(id), barrio);
  const snap = await page.evaluate(() => window.__HALO_REGRESSION__.hospitalitySnapshot());
  assert.equal(snap.barrio, barrio);
  assert.equal(snap.areaName, artifact.barrios[barrio].official_name);
  assert.equal(snap.value.replace(/\D/g, ""), String(expected));
  assert.ok((await fills(page)).fills.every((f) => f.fillOpacity === 0), "selection must not add a fill");

  await page.selectOption("#languageSelect", "en");
  assert.match(await page.locator("#hospitalityFillHold").textContent(), /on hold/);
  await page.selectOption("#languageSelect", "es");
  assert.match(await page.locator("#hospitalityFillHold").textContent(), /suspenso/);
  await page.context().close();
});

test("hold holds in Dark appearance and at 390px without horizontal overflow", async () => {
  const page = await newPage({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  await page.evaluate(() => window.__HALO_REGRESSION__.enableHospitality());
  const snap = await fills(page);
  assert.ok(snap.fills.every((f) => f.fillOpacity === 0));
  assert.equal(snap.scaleHidden, true);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  assert.ok(overflow <= 0, `horizontal overflow ${overflow}px`);
  await page.context().close();
});

test.after(async () => {
  await browser.close();
  server.close();
});
