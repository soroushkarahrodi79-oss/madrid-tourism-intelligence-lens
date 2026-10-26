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
const CASE_QUERY = "journey=yeserias&v=1&m=PLACE&a=40.395543,-3.691757,900&be=0&al=A&ly=museum.info.stay.bike.rail&sc=LENS&rd=citizen&lg=es&lang=es&haloRegressionTest=1";

async function open(viewport, colorScheme = "light", query = CASE_QUERY) {
  const context = await browser.newContext({ viewport, colorScheme });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.goto(`http://127.0.0.1:${port}/?${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__HALO_REGRESSION__?.planning()?.code === "APE.02.20");
  return { page, context };
}

test("the complete institutional journey uses PLACE, official evidence, compatible COMPARE, and verification", async (t) => {
  const { page, context } = await open({ width: 1280, height: 900 }); t.after(() => context.close());
  assert.equal(await page.locator("#institutionalJourney").isVisible(), true);
  assert.match(await page.locator("#institutionalJourneyTitle").textContent(), /registros oficiales/i);
  assert.equal(await page.locator("#analysisPanel").getAttribute("data-mode"), "PLACE");
  await page.waitForFunction(() => window.__HALO_REGRESSION__.k11Restored());

  await page.locator("#institutionalJourneyNext").click();
  await page.waitForFunction(() => document.querySelector('[data-layer="licences"]')?.checked);
  await page.waitForFunction(() => window.__HALO_REGRESSION__.licenceSnapshot().perFamily !== null);
  const licences = await page.evaluate(() => window.__HALO_REGRESSION__.licenceSnapshot());
  assert.ok(Object.values(licences.perFamily).some((value) => value > 0), "real resolved licence records are available in the selected circle/window");
  assert.equal(await page.locator("#institutionalJourney").getAttribute("data-step"), "2");

  await page.locator("#institutionalJourneyNext").click();
  assert.equal(await page.locator('[data-layer="licences"]').isChecked(), false, "journey-owned markers disappear during the ámbito comparison");
  await page.waitForFunction(() => window.__HALO_REGRESSION__.ambitoState().bodyHidden === false);
  const comparison = await page.evaluate(() => window.__HALO_REGRESSION__.ambitoState());
  assert.equal(comparison.scope, "AMBITO");
  assert.equal(comparison.a.code, "APE.02.20");
  assert.equal(comparison.b.code, "APE.02.12");
  assert.equal(comparison.categorical.length, 4);
  assert.ok(comparison.quantity.some((row) => !row.withheld), "at least one like-for-like official quantity is compared");

  await page.selectOption("#languageSelect", "en");
  assert.match(await page.locator("#institutionalJourneyTitle").textContent(), /compatible planning/i);
  await page.locator("#institutionalJourneyNext").click();
  assert.equal(await page.locator("#institutionalJourneyEvidence").isVisible(), true);
  await page.locator("#institutionalJourneyEvidence").click();
  assert.equal(await page.locator("#evidenceDrawer").evaluate((drawer) => drawer.open), true);
  assert.equal(await page.locator("#k11ShareBtn").isVisible(), true);
  assert.equal(await page.locator("#k11ExportBtn").isVisible(), true);

  await page.locator("#evidenceDrawerClose").click();
  await page.locator("#institutionalJourneyClose").click();
  assert.equal(await page.locator("#institutionalJourney").isHidden(), true);
  assert.equal(await page.locator("#analysisPanel").getAttribute("data-mode"), "PLACE");
  assert.equal(await page.locator('[data-layer="licences"]').isChecked(), false, "journey-owned opt-in layer is cleaned up on exit");
});

for (const fixture of [
  { name: "iPad portrait", viewport: { width: 834, height: 1112 }, color: "light" },
  { name: "iPad landscape dark", viewport: { width: 1194, height: 834 }, color: "dark" },
  { name: "mobile portrait", viewport: { width: 390, height: 844 }, color: "light" },
]) test(`journey stays usable on ${fixture.name}`, async (t) => {
  const { page, context } = await open(fixture.viewport, fixture.color); t.after(() => context.close());
  const layout = await page.locator("#institutionalJourney").evaluate((el) => ({
    width: el.getBoundingClientRect().width,
    viewport: document.documentElement.clientWidth,
    nextHeight: document.getElementById("institutionalJourneyNext").getBoundingClientRect().height,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  assert.ok(layout.width > 0 && layout.width <= layout.viewport);
  assert.ok(layout.nextHeight >= 44, "touch target is at least 44px");
  assert.ok(layout.overflow <= 1, "no horizontal page overflow");
  await page.locator("#institutionalJourneyNext").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#institutionalJourney").getAttribute("data-step"), "2");
});


// K11's versioned language has precedence even over a contradictory plain
// lang= entry. The native selector, shell and journey must agree at first paint
// and after the user changes language.
for (const lang of ["es", "en"]) test(`versioned ${lang} case entry synchronizes document, selector and UI`, async (t) => {
  const params = new URLSearchParams(CASE_QUERY);
  params.set("lg", lang);
  params.set("lang", lang === "es" ? "en" : "es");
  const { page, context } = await open({ width: 1024, height: 768 }, "light", params.toString());
  t.after(() => context.close());
  await page.waitForFunction(() => window.__HALO_REGRESSION__?.k11Restored());
  const initialShell = lang === "es" ? "Capas operativas" : "Operational layers";
  const initialJourney = lang === "es" ? /registros oficiales/i : /official records/i;
  assert.equal(await page.locator("html").getAttribute("lang"), lang);
  assert.equal(await page.locator("#languageSelect").inputValue(), lang);
  assert.equal(await page.locator('[data-i18n="aside.layers"]').textContent(), initialShell);
  assert.match(await page.locator("#institutionalJourneyTitle").textContent(), initialJourney);

  const switched = lang === "es" ? "en" : "es";
  await page.selectOption("#languageSelect", switched);
  assert.equal(await page.locator("html").getAttribute("lang"), switched);
  assert.equal(await page.locator("#languageSelect").inputValue(), switched);
  assert.equal(await page.locator('[data-i18n="aside.layers"]').textContent(), switched === "es" ? "Capas operativas" : "Operational layers");
  assert.match(await page.locator("#institutionalJourneyTitle").textContent(), switched === "es" ? /registros oficiales/i : /official records/i);
});

// User-controlled switches are never reset just because the guided experience
// reaches COMPARE or ends. Explicit user changes override journey automation.
test("journey respects manual licence opt-in before the evidence step", async (t) => {
  const { page, context } = await open({ width: 1280, height: 900 }); t.after(() => context.close());
  await page.waitForFunction(() => window.__HALO_REGRESSION__?.k11Restored());
  assert.equal(await page.locator('[data-layer="licences"]').isChecked(), false);
  await page.locator('[data-layer="licences"]').evaluate((input) => input.click());
  assert.equal(await page.locator('[data-layer="licences"]').isChecked(), true);
  await page.locator("#institutionalJourneyNext").waitFor({ state: "visible" });
  await page.locator("#institutionalJourneyNext").click();
  await page.locator("#institutionalJourneyNext").click();
  assert.equal(await page.locator('[data-layer="licences"]').isChecked(), true, "user-enabled overlay stays on in COMPARE");
  await page.locator("#institutionalJourneyClose").click();
  assert.equal(await page.locator('[data-layer="licences"]').isChecked(), true, "user-enabled overlay survives exit");
});

test("journey restores only its own licence layer on Back and leaves user re-enables alone", async (t) => {
  const { page, context } = await open({ width: 1280, height: 900 }); t.after(() => context.close());
  await page.waitForFunction(() => window.__HALO_REGRESSION__?.k11Restored());
  await page.locator("#institutionalJourneyNext").click();
  assert.equal(await page.locator('[data-layer="licences"]').isChecked(), true);
  await page.locator("#institutionalJourneyNext").click();
  assert.equal(await page.locator('[data-layer="licences"]').isChecked(), false);
  await page.locator("#institutionalJourneyBack").click();
  assert.equal(await page.locator('[data-layer="licences"]').isChecked(), true, "Back reopens the guide-managed layer");
  await page.locator("#institutionalJourneyNext").click();
  assert.equal(await page.locator('[data-layer="licences"]').isChecked(), false);
  await page.locator('[data-layer="licences"]').evaluate((input) => input.click());
  await page.locator("#institutionalJourneyClose").click();
  assert.equal(await page.locator('[data-layer="licences"]').isChecked(), true, "manual re-enable must survive closing the guide");
});

test("journey leaves a licence layer enabled by the shared reading unchanged", async (t) => {
  const params = new URLSearchParams(CASE_QUERY);
  params.set("ly", "museum.info.stay.bike.rail.licences");
  const { page, context } = await open({ width: 1280, height: 900 }, "light", params.toString());
  t.after(() => context.close());
  await page.waitForFunction(() => window.__HALO_REGRESSION__?.k11Restored());
  assert.equal(await page.locator('[data-layer="licences"]').isChecked(), true);
  await page.locator("#institutionalJourneyNext").click();
  await page.locator("#institutionalJourneyNext").click();
  assert.equal(await page.locator('[data-layer="licences"]').isChecked(), true, "preselected source is not journey-owned");
  await page.locator("#institutionalJourneyClose").click();
  assert.equal(await page.locator('[data-layer="licences"]').isChecked(), true);
});

test.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); });
