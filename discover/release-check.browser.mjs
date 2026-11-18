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

  await page.goto(`${base}/discover/methodology.html?lang=es#evidencia`);
  await page.getByRole("navigation", { name: "Navegación de Discover" }).getByRole("link", { name: "Explorar Lens" }).click();
  await appReady("es")(session);
  assert.equal(new URL(page.url()).pathname, `${projectPath}/`, "methodology opens the viewer directly");

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
  await shared.page.getByRole("link", { name: "Sources and methodology" }).click();
  await shared.page.waitForURL(`${base}/discover/methodology.html?lang=en#evidencia`);
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
  const navigationUrls = [];
  hash.page.on("framenavigated", frame => {
    if (frame === hash.page.mainFrame()) navigationUrls.push(frame.url());
  });
  await hash.page.goto(`${base}/?lang=en#analysisPanel`, { waitUntil: "load" });
  await appReady("en")(hash);
  // The app may serialize its canonical query before the load event.
  assert.equal(navigationUrls[0], `${base}/?lang=en#analysisPanel`, "the fragment reaches the app on entry");
  assert.ok(navigationUrls.every(url => new URL(url).pathname === `${projectPath}/`), "the deep link stays in the app");

  const guided = await newPage(browser); t.after(() => guided.context.close());
  await guided.page.goto(`${base}/discover/?lang=es#evidencia`, { waitUntil: "load" });
  await guided.page.waitForURL(`${base}/discover/methodology.html?lang=es#evidencia`);
  await guided.page.locator("[data-case-link]").click();
  await guided.page.waitForURL(url => url.searchParams.get("journey") === "yeserias" || url.searchParams.get("m") === "PLACE");
  assert.equal(new URL(guided.page.url()).pathname, `${projectPath}/`, "guided case opens the application");
  await appReady("es")(guided);
  assert.deepEqual(guided.errors, []);

  for (const fragment of ["modos", "panel-compare", "tab-city"]) {
    await guided.page.goto(`${base}/discover/index.html?lang=en#${fragment}`);
    await guided.page.waitForURL(`${base}/discover/methodology.html?lang=en#${fragment}`);
    const mode = fragment.split("-")[1] || "place";
    assert.equal(await guided.page.locator(`#tab-${mode}`).getAttribute("aria-selected"), "true");
    assert.equal(await guided.page.locator(`#panel-${mode}`).getAttribute("aria-hidden"), "false");
  }
});

test("Discover keeps one instant entry in Spanish and English across viewport sizes", async t => {
  const { server, base } = await serveTree(); const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const labels = {
    es: ["Fuentes y metodología", "Volver a Discover", "Metodología técnica", "Procedencia de los datos", "Limitaciones científicas"],
    en: ["Sources and methodology", "Back to Discover", "Technical methodology", "Data provenance", "Scientific limitations"],
  };
  const docs = ["METHODOLOGY.md", "DATA_PROVENANCE.md", "CLAIMS_AND_LIMITATIONS.md"];
  for (const [width, height] of [[1440, 900], [820, 1180], [390, 844], [360, 640], [320, 640]]) {
    const session = await newPage(browser, { viewport: { width, height }, reducedMotion: "reduce" });
    const { page, context } = session;
    try {
      const flightRequests = [];
      page.on("request", request => {
        if (/\/(earth|iberia)\.webp$/.test(request.url())) flightRequests.push(request.url());
      });
      await page.goto(`${base}/discover/`);
      const cta = page.locator("[data-primary-cta]");
      assert.equal(await cta.count(), 1);
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      assert.equal(await cta.evaluate(link => link.matches(":focus-visible")), true);
      for (const lang of ["es", "en"]) {
        await page.locator(`[data-lang="${lang}"]`).click();
        assert.equal(await cta.getAttribute("href"), `../?lang=${lang}`);
        const box = await cta.boundingBox();
        assert.ok(box.y + box.height <= height, `${lang}: CTA fits at ${width}x${height}`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);

        const [methodology, back, ...documentLabels] = labels[lang];
        await page.getByRole("link", { name: methodology }).click();
        await page.waitForURL(`${base}/discover/methodology.html?lang=${lang}#evidencia`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        const masthead = await page.locator(".masthead").boundingBox();
        for (const [i, label] of documentLabels.entries()) {
          const doc = page.locator("#evidencia").getByRole("link", { name: label });
          const target = new URL(await doc.getAttribute("href"));
          assert.equal(target.href, `https://github.com/soroushkarahrodi79-oss${projectPath}/blob/main/docs/${docs[i]}`);
          assert.equal(await doc.getAttribute("hreflang"), "en");
          const bounds = await doc.boundingBox();
          assert.ok(bounds.y >= masthead.height && bounds.y + bounds.height <= height, `${label} fits at ${width}x${height}`);
        }
        await page.getByRole("link", { name: back }).click();
        await page.waitForURL(`${base}/discover/index.html?lang=${lang}`);
        assert.equal(await page.locator("html").getAttribute("lang"), lang);
      }
      assert.equal(await page.locator(".city").evaluate(img => img.complete && img.naturalWidth > 0), true);
      assert.equal(await page.locator(".flight img").count(), 0);
      assert.deepEqual(flightRequests, []);
      assert.deepEqual(session.errors, []);
    } finally { await context.close(); }
  }
});

test("Flight runs once and the static entry survives failed assets and disabled JavaScript", async t => {
  const { server, base } = await serveTree(); const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const session = await newPage(browser);
  t.after(() => session.context.close());
  const { page } = session;
  await page.goto(`${base}/discover/`, { waitUntil: "domcontentloaded" });
  const flight = page.locator(".flight.is-flying");
  await flight.waitFor({ state: "visible" });
  assert.equal(await flight.locator("img").count(), 2);
  assert.equal(await page.locator("[data-primary-cta]").isVisible(), true);
  await flight.waitFor({ state: "detached" });
  await page.reload();
  assert.equal(await page.locator(".flight img").count(), 0, "a reload in the same tab does not replay");
  assert.deepEqual(session.errors, []);

  const missing = await newPage(browser);
  t.after(() => missing.context.close());
  await missing.page.route("**/earth.webp", route => route.abort());
  await missing.page.goto(`${base}/discover/`);
  assert.equal(await missing.page.locator(".flight img").count(), 0);
  assert.equal(await missing.page.locator(".city").evaluate(img => img.naturalWidth > 0), true);
  assert.equal(await missing.page.locator("[data-primary-cta]").isVisible(), true);
  assert.deepEqual(missing.errors, []);

  const staticPage = await newPage(browser, { javaScriptEnabled: false });
  t.after(() => staticPage.context.close());
  await staticPage.page.goto(`${base}/discover/`);
  assert.equal(await staticPage.page.locator("[data-primary-cta]").getAttribute("href"), "../?lang=es");
  assert.equal(await staticPage.page.locator(".city").evaluate(img => img.naturalWidth > 0), true);
});
