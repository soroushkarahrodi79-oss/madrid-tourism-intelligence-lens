import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectPath = "/madrid-tourism-intelligence-lens";
const evidenceDir = process.env.DISCOVER_EVIDENCE_DIR;
const contentTypes = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

async function serveTree() {
  const server = http.createServer(async (request, response) => {
    const rawPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (!rawPath.startsWith(projectPath)) return response.writeHead(404).end();
    const relative = rawPath.slice(projectPath.length).replace(/^\/+/, "") || "index.html";
    const target = path.resolve(root, relative.endsWith("/") ? path.join(relative, "index.html") : relative);
    if (!target.startsWith(root + path.sep) && target !== root) return response.writeHead(403).end();
    try { const body = await fs.readFile(target); response.writeHead(200, { "content-type": contentTypes[path.extname(target)] || "application/octet-stream" }).end(body); } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}${projectPath}` };
}
async function maybeShot(page, name) { if (evidenceDir) { await fs.mkdir(evidenceDir, { recursive: true }); await page.screenshot({ path: path.join(evidenceDir, name), fullPage: false }); } }

test("GitHub Pages project-subpath serves Discover and preserves the application route", async t => {
  const { server, base } = await serveTree(); const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = await context.newPage(); page.setDefaultTimeout(8000); t.after(() => context.close());
  const failures = []; page.on("requestfailed", request => failures.push(request.url()));
  await page.goto(`${base}/discover/`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200);
  assert.ok(Number(await page.locator(".hero h1").evaluate(element => getComputedStyle(element).opacity)) > .9, "hero heading is readable after optional motion settles");
  assert.equal(await page.locator(".product-proof img").evaluate(image => image.complete && image.naturalWidth > 0), true, "real preview image loads");
  await maybeShot(page, "01-desktop-hero-1440.png");
  assert.equal(await page.locator(".hero .action.primary").getAttribute("href"), "../?lang=es");
  await page.locator(".hero .action.primary").click(); await page.waitForURL(`${base}/?lang=es`);
  await page.waitForTimeout(800);
  const resources = await page.evaluate(() => performance.getEntriesByType("resource").map(entry => entry.name));
  assert.ok(resources.some(url => url.includes("/css/app.css")), "application CSS loaded");
  assert.ok(resources.some(url => url.includes("/js/app.js")), "application JS loaded");
  assert.ok(resources.some(url => url.includes("/data/snapshot_poi.json") || url.includes("/data/runtime_poi.json")), "application data asset requested");
  await page.goto(`${base}/?lang=en#analysisPanel`, { waitUntil: "domcontentloaded" });
  assert.equal(new URL(page.url()).hash, "#analysisPanel", "root deep-link hash is preserved");
  assert.ok(failures.every(url => !url.includes(`${base}/discover/`)), "Discover does not break its own project-subpath assets");
});

test("Discover release evidence: modes, keyboard, mobile order and reduced motion", async t => {
  const { server, base } = await serveTree(); const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } }); desktop.setDefaultTimeout(8000);
  await desktop.goto(`${base}/discover/`, { waitUntil: "domcontentloaded" }); await desktop.waitForTimeout(1200);
  await desktop.locator("#journey").scrollIntoViewIfNeeded(); await maybeShot(desktop, "02-story-place-1440.png");
  await desktop.locator('[data-story="compare"]').scrollIntoViewIfNeeded(); await desktop.waitForTimeout(200); await maybeShot(desktop, "03-story-compare-1440.png");
  await desktop.locator('[data-story="city"]').scrollIntoViewIfNeeded(); await desktop.waitForTimeout(200); await maybeShot(desktop, "04-story-city-1440.png");
  await desktop.locator(".lens-a").focus(); const before = await desktop.locator(".lens-a").boundingBox(); await desktop.keyboard.press("ArrowRight"); assert.ok((await desktop.locator(".lens-a").boundingBox()).x > before.x, "keyboard moves Lens A"); await maybeShot(desktop, "05-keyboard-focus-1440.png");
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } }); mobile.setDefaultTimeout(8000); await mobile.route("https://**/*", route => route.abort()); await mobile.goto(`${base}/discover/`, { waitUntil: "domcontentloaded" }); assert.ok(Number(await mobile.locator(".hero h1").evaluate(element => getComputedStyle(element).opacity)) > .9, "mobile heading is readable without the optional motion CDN"); await maybeShot(mobile, "06-mobile-hero-390.png");
  const order = await mobile.locator(".story-layout > *").evaluateAll(nodes => nodes.map(node => node.className)); assert.deepEqual(order, ["story-visual", "story-narrative"], "mobile reading order remains visual then narrative");
  const reduced = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" }); reduced.setDefaultTimeout(8000); await reduced.goto(`${base}/discover/`, { waitUntil: "domcontentloaded" }); assert.equal(await reduced.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), true); await maybeShot(reduced, "07-reduced-motion-390.png");
  for (const page of [desktop, mobile, reduced]) { const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1); assert.equal(overflow, true, "no horizontal clipping"); }
  await Promise.all([desktop.close(), mobile.close(), reduced.close()]);
});
