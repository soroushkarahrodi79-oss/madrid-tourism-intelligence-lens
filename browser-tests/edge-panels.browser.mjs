import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Desktop side panels are anchored to the screen edges and can each be hidden
// (edge tab or [ / ] keys) so the whole map is visible. Phones keep their layout.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mime = { ".css": "text/css", ".geojson": "application/geo+json", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const target = path.resolve(ROOT, pathname === "/" ? "index.html" : pathname.slice(1));
  if (!target.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end();
  fs.readFile(target, (error, content) => error ? response.writeHead(404).end() : response.writeHead(200, { "content-type": mime[path.extname(target)] || "application/octet-stream" }).end(content));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });
test.after(async () => { await browser.close(); server.close(); });

async function open(width, height) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1&lang=en`, { waitUntil: "domcontentloaded" });
  await page.locator("#railToggle").waitFor({ state: "attached" });
  await page.waitForFunction(() => window.__HALO_REGRESSION__?.k11Restored());
  return { context, page };
}
const box = (page, selector) => page.evaluate((s) => { const el = document.querySelector(s); const style = getComputedStyle(el); if (style.display === "none") return null; const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; }, selector);
const overlap = (a, b) => a && b && a.left < b.right - .5 && a.right > b.left + .5 && a.top < b.bottom - .5 && a.bottom > b.top + .5;

test("desktop panels sit on the screen edges and hide/show without losing scroll", async () => {
  const { context, page } = await open(1440, 900);
  try {
    const rail = await box(page, "#layerRail"), panel = await box(page, "#analysisPanel");
    assert.equal(Math.round(rail.left), 0, "layer rail is anchored to the left edge");
    assert.equal(Math.round(panel.right), 1440, "analysis panel is anchored to the right edge");
    assert.ok(!overlap(await box(page, "#railToggle"), await box(page, ".leaflet-control-zoom")), "edge tab does not cover the zoom control");

    await page.evaluate(() => { document.getElementById("analysisPanel").scrollTop = 120; });
    await page.locator("#panelToggle").click();
    assert.equal(await box(page, "#analysisPanel"), null, "analysis panel hidden");
    assert.equal(await page.locator("#panelToggle").getAttribute("aria-expanded"), "false");
    await page.keyboard.press("]");
    assert.ok(await box(page, "#analysisPanel"), "] restores the analysis panel");
    assert.equal(await page.evaluate(() => document.getElementById("analysisPanel").scrollTop), 120, "scroll position restored");

    await page.locator("#railToggle").click();
    assert.equal(await box(page, "#layerRail"), null, "layer rail hidden");
    assert.ok(!overlap(await box(page, "#railToggle"), await box(page, ".leaflet-control-zoom")), "collapsed edge tab does not cover the zoom control");
    await page.keyboard.press("[");
    assert.ok(await box(page, "#layerRail"), "[ restores the layer rail");
    assert.equal(await page.locator("#railToggle").getAttribute("aria-expanded"), "true");
  } finally { await context.close(); }
});

test("[ and ] are ignored while typing, and phones do not show the edge tabs", async () => {
  const { context, page } = await open(1440, 900);
  try {
    await page.locator("#geoSearchQuery").evaluate((el) => el.focus());
    await page.keyboard.type("[]");
    assert.ok(await box(page, "#layerRail") && await box(page, "#analysisPanel"), "typing brackets in a field hides nothing");
  } finally { await context.close(); }
  const phone = await open(390, 844);
  try {
    assert.equal(await box(phone.page, "#railToggle"), null);
    assert.equal(await box(phone.page, "#panelToggle"), null);
  } finally { await phone.context.close(); }
});
