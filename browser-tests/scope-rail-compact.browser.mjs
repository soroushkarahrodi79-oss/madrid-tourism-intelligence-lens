import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900, coarse: false },
  { name: "ipad-landscape", width: 1180, height: 820, coarse: true },
  { name: "ipad-portrait", width: 820, height: 1180, coarse: true },
  { name: "mobile", width: 390, height: 844, coarse: true, mobile: true },
];
const LONG_BARRIO = { lat: 40.448, lon: -3.735 };
const LONG_PLANNING_CODE = { lat: 40.4491896975, lon: -3.551747205, code: "AOE.00.02-RP" };
const NO_INTERSECTION = { lat: 40.4149, lon: -3.69 };
const DEFAULT_INSIDE = { lat: 40.40255, lon: -3.71371, code: "APR.02.09" };

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const target = path.resolve(ROOT, pathname === "/" ? "index.html" : pathname.slice(1));
  if (!target.startsWith(`${ROOT}${path.sep}`) && target !== path.join(ROOT, "index.html")) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(target, (error, content) => {
    if (error) return response.writeHead(404).end("Not found");
    response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
    response.end(content);
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const baseUrl = `http://127.0.0.1:${server.address().port}`;

async function openApp(viewport, { unavailablePlanning = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    hasTouch: viewport.coarse,
    ...(viewport.mobile ? { isMobile: true } : {}),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return route.abort();
    if (unavailablePlanning && url.pathname.endsWith("/data/planning/madrid_ambitos.geojson")) {
      return route.fulfill({ status: 503, contentType: "text/plain", body: "Planning source unavailable" });
    }
    return route.continue();
  });
  await page.goto(`${baseUrl}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__));
  await page.waitForFunction(() => {
    const section = document.getElementById("planningAmbito");
    return section && section.dataset.state && section.dataset.state !== "loading";
  });
  page.context_ = context;
  return page;
}

async function moveTo(page, point) {
  await page.evaluate(([lat, lon]) => window.__HALO_REGRESSION__.moveLensToLatLng("A", lat, lon), [point.lat, point.lon]);
  if (point.code) {
    await page.waitForFunction((expected) => document.getElementById("planningCode").textContent.trim() === expected, point.code);
  }
}

async function railSnapshot(page) {
  return page.evaluate(() => {
    const rail = document.getElementById("scopeRail");
    const list = document.getElementById("scopeRailList");
    const panel = document.getElementById("analysisPanel");
    const bounds = (node) => ({ width: node.clientWidth, scrollWidth: node.scrollWidth });
    return {
      document: { width: innerWidth, scrollWidth: document.documentElement.scrollWidth },
      panel: bounds(panel),
      rail: bounds(rail),
      list: bounds(list),
      aria: rail.getAttribute("aria-label"),
      freshness: document.getElementById("scopeRailFreshness").textContent.trim(),
      entries: [...list.querySelectorAll(".scope-rail-item")].map((button) => ({
        scope: button.dataset.scope,
        name: button.querySelector(".scope-name")?.textContent.trim(),
        instance: button.querySelector(".scope-instance")?.textContent.trim() ?? "",
        label: button.getAttribute("aria-label"),
        glyphHidden: button.querySelector(".scope-glyph")?.getAttribute("aria-hidden"),
        nameFontSize: getComputedStyle(button.querySelector(".scope-name")).fontSize,
        instanceFontSize: getComputedStyle(button.querySelector(".scope-instance")).fontSize,
        box: { width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height },
      })),
      freshnessBox: (() => {
        const rect = document.getElementById("scopeRailFreshness").getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      })(),
    };
  });
}

const closePage = (page) => page.context_.close();
test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

for (const viewport of VIEWPORTS) {
  test(`scope rail stays contained, readable and distinct at ${viewport.name}`, async (t) => {
    const page = await openApp(viewport);
    t.after(() => closePage(page));
    await moveTo(page, DEFAULT_INSIDE);

    for (const appearance of ["light", "dark"]) {
      await page.locator("#appearanceSelect").selectOption(appearance);
      for (const language of ["en", "es"]) {
        await page.locator("#languageSelect").selectOption(language);
        await page.waitForFunction((expected) => document.documentElement.lang === expected, language);
        const rail = await railSnapshot(page);
        assert.equal(await page.locator("#scopeRail").isVisible(), true);
        assert.ok(rail.document.scrollWidth <= rail.document.width + 1, `${appearance}/${language}: no document overflow`);
        for (const name of ["panel", "rail", "list"]) {
          assert.ok(rail[name].scrollWidth <= rail[name].width + 1, `${appearance}/${language}: ${name} fits (${JSON.stringify(rail[name])})`);
        }
        assert.equal(rail.aria, language === "es"
          ? "Alcance y fecha de referencia de la evidencia en pantalla"
          : "Evidence scope and reference date on screen");
        assert.deepEqual(rail.entries.map((entry) => entry.scope), ["OFFICIAL_BARRIO", "LENS_CIRCLE", "PLANNING_AMBITO"]);
        assert.deepEqual(rail.entries.map((entry) => entry.glyphHidden), ["true", "true", "true"]);
        assert.ok(rail.entries.every((entry) => entry.name && entry.instance && entry.label?.length > 0));
        assert.ok(rail.entries.every((entry) => parseFloat(entry.nameFontSize) >= 11 && parseFloat(entry.instanceFontSize) >= 12), "scope label and primary value retain a readable, consistent hierarchy");
        assert.match(rail.entries[0].name, /Official barrio|Barrio oficial/i);
        assert.match(rail.entries[1].instance, /A · 900 m/i);
        assert.match(rail.entries[2].name, /Planning ámbito|Ámbito de planeamiento/i);
        assert.match(rail.freshness, /^(Reference|Referencia) · /);
        if (viewport.coarse) {
          assert.ok(rail.entries.every(({ box }) => box.width >= 43.5 && box.height >= 43.5), "scope entries retain 44px coarse-pointer targets");
          assert.ok(rail.freshnessBox.height >= 43.5, "the freshness evidence control retains its coarse-pointer target");
        }
      }
    }
  });
}

test("scope rail preserves the exact long barrio and planning code without joining their geographies", async (t) => {
  const page = await openApp(VIEWPORTS[1]);
  t.after(() => closePage(page));

  await moveTo(page, LONG_BARRIO);
  await page.waitForFunction(() => document.getElementById("areaHeadline").textContent.trim() === "Ciudad Universitaria");
  let rail = await railSnapshot(page);
  const barrio = rail.entries.find((entry) => entry.scope === "OFFICIAL_BARRIO");
  const planning = rail.entries.find((entry) => entry.scope === "PLANNING_AMBITO");
  assert.match(barrio.instance, /Ciudad Universitaria/);
  assert.ok(barrio.label.includes("Ciudad Universitaria"), "the accessible name includes the exact official barrio instance");
  assert.notEqual(barrio.scope, planning.scope, "administrative barrio and official planning geography remain separate scopes");

  await moveTo(page, LONG_PLANNING_CODE);
  rail = await railSnapshot(page);
  const exactPlanningEntry = rail.entries.find((entry) => entry.scope === "PLANNING_AMBITO");
  assert.equal(exactPlanningEntry.instance, LONG_PLANNING_CODE.code);
  assert.ok(exactPlanningEntry.label.includes(LONG_PLANNING_CODE.code), "the accessible name includes the exact planning code");
});

test("no-intersection and unavailable planning remain explicit, distinct rail states", async (t) => {
  const outside = await openApp(VIEWPORTS[2]);
  t.after(() => closePage(outside));
  await moveTo(outside, NO_INTERSECTION);
  await outside.waitForFunction(() => document.getElementById("planningAmbito").dataset.state === "outside_all_ambitos");
  const outsideEntry = (await railSnapshot(outside)).entries.find((entry) => entry.scope === "PLANNING_AMBITO");
  assert.match(outsideEntry.instance, /touches no official planning ámbito|no toca ningún ámbito oficial de planeamiento/i);
  assert.ok(outsideEntry.label.includes(outsideEntry.instance), "the full no-intersection meaning is accessible");
  assert.doesNotMatch(outsideEntry.instance, /unavailable|no disponible/i);

  const missing = await openApp(VIEWPORTS[2], { unavailablePlanning: true });
  t.after(() => closePage(missing));
  await moveTo(missing, { lat: DEFAULT_INSIDE.lat, lon: DEFAULT_INSIDE.lon });
  await missing.waitForFunction(() => document.getElementById("planningAmbito").dataset.state === "unavailable");
  const missingEntry = (await railSnapshot(missing)).entries.find((entry) => entry.scope === "PLANNING_AMBITO");
  assert.match(missingEntry.instance, /unavailable|no disponible/i);
  assert.ok(missingEntry.label.includes(missingEntry.instance), "the full unavailable state is accessible");
  assert.doesNotMatch(missingEntry.instance, /no official planning ámbito contains|ningún ámbito oficial de planeamiento contiene/i);
  assert.notEqual(missingEntry.instance, outsideEntry.instance, "missing evidence is never presented as a no-intersection result");
});

test("rail evidence remains keyboard operable and Escape restores focus to the same scope", async (t) => {
  const page = await openApp(VIEWPORTS[1]);
  t.after(() => closePage(page));
  await moveTo(page, LONG_PLANNING_CODE);
  const opener = page.locator('#scopeRailList .scope-rail-item[data-scope="PLANNING_AMBITO"]');
  await opener.focus();
  assert.equal(await opener.evaluate((button) => button.matches(":focus-visible")), true);
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#evidenceDrawer").getAttribute("open"), "");
  assert.ok(await page.locator("#evidenceDrawerBody .drawer-record").count() > 0, "the rail evidence route still exposes provenance records");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.getElementById("evidenceDrawer").open);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.scope), "PLANNING_AMBITO");
});
