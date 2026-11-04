// Landing-first routing under the real GitHub Pages project subpath.
// The bare public URL opens Discover; every stateful URL reaches the application.
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
const contentTypes = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".woff2": "font/woff2" };

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
async function newPage(browser, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-ES", ...options });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  await page.route("**/*", route => (new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort()));
  const errors = []; page.on("pageerror", error => errors.push(String(error)));
  return { context, page, errors };
}
const appReady = (lang) => ({ page }) => page.waitForFunction(expected =>
  document.documentElement.lang === expected && document.querySelector("#languageSelect")?.value === expected && Boolean(document.querySelector("#map .leaflet-pane")), lang);

test("bare public URL opens the landing; CTA enters the localized app; Back and refresh behave", async t => {
  const { server, base } = await serveTree(); const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const session = await newPage(browser); const { page } = session; t.after(() => session.context.close());
  // data/runtime_poi.json is produced only by the deployment build; the app falls back to its committed snapshot locally.
  const failed = []; page.on("response", response => { if (response.status() >= 400 && !response.url().includes("/data/runtime_poi.json")) failed.push(response.url()); });

  await page.goto(`${base}/`, { waitUntil: "load" });
  assert.equal(page.url(), `${base}/discover/`, "bare root URL redirects to the landing");
  const baseline = await newPage(browser); t.after(() => baseline.context.close());
  await baseline.page.goto(`${base}/discover/`, { waitUntil: "load" });
  assert.equal(await page.evaluate(() => history.length), await baseline.page.evaluate(() => history.length), "redirect replaces the entry instead of stacking one");
  await maybeShot(page, "01-landing-1440.png");

  await page.locator("[data-primary-cta]").click();
  await page.waitForURL(url => url.pathname === `${projectPath}/` && url.search.length > 0);
  await appReady("es")(session);
  assert.equal(await page.locator('[data-i18n="aside.layers"]').textContent(), "Capas operativas");
  const resources = await page.evaluate(() => performance.getEntriesByType("resource").map(entry => entry.name));
  assert.ok(resources.some(url => url.includes("/css/app.css")) && resources.some(url => url.includes("/js/app.js")), "application assets load");

  await page.waitForTimeout(500);
  await page.reload({ waitUntil: "load" });
  assert.equal(new URL(page.url()).pathname, `${projectPath}/`, "refresh inside Lens stays in Lens");
  await appReady("es")(session);

  await page.goBack({ waitUntil: "load" });
  assert.equal(page.url(), `${base}/discover/`, "Back returns to the landing");
  await page.locator('[data-lang="en"]').click();
  await page.locator("[data-primary-cta]").click();
  await appReady("en")(session);
  assert.equal(await page.locator('[data-i18n="aside.layers"]').textContent(), "Operational layers");

  await page.goto(`${base}/index.html`, { waitUntil: "load" });
  assert.equal(page.url(), `${base}/discover/`, "explicit index.html without state also opens the landing");
  assert.deepEqual(failed, [], "no 4xx/5xx response for landing or application assets");
  assert.deepEqual(session.errors, []);
});

test("stateful URLs reach the application directly", async t => {
  const { server, base } = await serveTree(); const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });

  // The landing's own "open this reading" link is a real shared COMPARE reading.
  const shared = await newPage(browser); t.after(() => shared.context.close());
  await shared.page.goto(`${base}/discover/?lang=en`, { waitUntil: "load" });
  const href = await shared.page.locator("[data-reading-link]").getAttribute("href");
  assert.match(href, /^\.\.\/\?v=1&/);
  await shared.page.locator("[data-reading-link]").click();
  await shared.page.waitForURL(url => url.pathname === `${projectPath}/`);
  await appReady("en")(shared);
  await shared.page.waitForFunction(() => document.querySelector("#modeCompareButton")?.getAttribute("aria-pressed") === "true");
  const url = new URL(shared.page.url());
  assert.equal(url.searchParams.get("v"), "1");
  assert.equal(url.searchParams.get("m"), "COMPARE");
  assert.equal(url.searchParams.get("a"), "40.41490,-3.69000,900", "Lens A restored");
  assert.equal(url.searchParams.get("b"), "40.40520,-3.72119,500", "Lens B restored");
  assert.equal(await shared.page.getByText("Link not restored").count(), 0, "reading is not refused");
  await maybeShot(shared.page, "02-shared-reading-1440.png");
  assert.deepEqual(shared.errors, []);

  const hash = await newPage(browser); t.after(() => hash.context.close());
  await hash.page.goto(`${base}/?lang=en#analysisPanel`, { waitUntil: "load" });
  assert.equal(new URL(hash.page.url()).hash, "#analysisPanel", "fragment deep link is preserved");
  await appReady("en")(hash);

  const guided = await newPage(browser); t.after(() => guided.context.close());
  await guided.page.goto(`${base}/discover/`, { waitUntil: "load" });
  await guided.page.locator("[data-case-link]").click();
  await guided.page.waitForURL(url => url.searchParams.get("journey") === "yeserias" || url.searchParams.get("m") === "PLACE");
  assert.equal(new URL(guided.page.url()).pathname, `${projectPath}/`, "guided case opens the application");
  await appReady("es")(guided);
  assert.deepEqual(guided.errors, []);
});
