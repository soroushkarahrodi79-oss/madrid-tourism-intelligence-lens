import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".css": "text/css; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};
const INSIDE = { lat: 40.40255, lon: -3.71371, code: "APR.02.09" };
const OUTSIDE = { lat: 40.4149, lon: -3.69 };
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900, coarse: false },
  { name: "ipad-landscape", width: 1180, height: 820, coarse: true },
  { name: "ipad-portrait", width: 820, height: 1180, coarse: true },
  { name: "mobile", width: 390, height: 844, coarse: true, mobile: true },
];

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

async function openApp(viewport, { unavailablePlanning = false, unavailablePopulation = false } = {}) {
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
    if (unavailablePopulation && url.pathname.endsWith("/data/population/madrid_population.json")) {
      return route.fulfill({ status: 503, contentType: "text/plain", body: "Population source unavailable" });
    }
    return route.continue();
  });
  await page.goto(`${baseUrl}/?haloRegressionTest=1&p0aStaging=1`, { waitUntil: "domcontentloaded" });
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
    await page.waitForFunction((code) => document.getElementById("planningCode").textContent.trim() === code, point.code);
  }
}

const closePage = (page) => page.context_.close();
test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

for (const viewport of VIEWPORTS) {
  test(`territorial layout stays legible and contained at ${viewport.name} in Light/Dark and EN/ES`, async (t) => {
    const page = await openApp(viewport);
    t.after(() => closePage(page));
    await moveTo(page, INSIDE);
    assert.equal(await page.locator("#areaProfile").getAttribute("data-state"), "resolved");
    assert.equal(await page.locator("#planningAmbito").getAttribute("data-state"), "resolved");

    for (const appearance of ["light", "dark"]) {
      await page.locator("#appearanceSelect").selectOption(appearance);
      for (const language of ["en", "es"]) {
        await page.locator("#languageSelect").selectOption(language);
        await page.waitForFunction((expected) => document.documentElement.lang === expected, language);
        const view = await page.evaluate(() => {
          const panel = document.getElementById("analysisPanel");
          const area = document.getElementById("areaProfile");
          const planning = document.getElementById("planningAmbito");
          const summary = document.getElementById("placeCircleSummary");
          const areaEvidence = area.querySelector(".evidence-link");
          const areaEvidenceStyle = getComputedStyle(areaEvidence);
          const icon = areaEvidence.querySelector("span");
          const box = (node) => ({ width: node.clientWidth, scrollWidth: node.scrollWidth });
          return {
            appearance: document.documentElement.dataset.appearance,
            language: document.documentElement.lang,
            viewportWidth: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            panel: box(panel),
            panelOverflow: [...panel.querySelectorAll("*")]
              .filter((node) => node.getClientRects().length && node.scrollWidth > node.clientWidth + 1)
              .map((node) => ({
                tag: node.tagName,
                id: node.id,
                className: typeof node.className === "string" ? node.className : "",
                width: node.clientWidth,
                scrollWidth: node.scrollWidth,
                right: Math.round(node.getBoundingClientRect().right * 10) / 10,
                text: (node.innerText || "").trim().slice(0, 100),
              })),
            area: box(area),
            planning: box(planning),
            summary: { visible: getComputedStyle(summary).display !== "none", ...box(summary) },
            circleRadius: document.getElementById("placeCircleSummaryRadius").textContent.trim(),
            circleLabels: [...summary.querySelectorAll(".place-circle-reading > span")].map((node) => node.textContent.trim()),
            areaHeadline: document.getElementById("areaHeadline").textContent.trim(),
            areaCode: document.getElementById("areaCodes").textContent.trim(),
            residents: document.getElementById("areaResidentsValue").textContent.trim(),
            residentScope: document.getElementById("areaScopeNote").textContent.trim(),
            vut: document.getElementById("areaVutValue").textContent.trim(),
            vutUnit: document.getElementById("areaVutUnit").textContent.trim(),
            areaScope: document.getElementById("areaScopeHint").textContent.trim(),
            planningDenomination: document.getElementById("planningDenomination").textContent.trim(),
            planningCode: document.getElementById("planningCode").textContent.trim(),
            planningKind: document.querySelector("#planningIdentity .planning-kind").textContent.trim(),
            planningScope: document.getElementById("planningScopeHint").textContent.trim(),
            planningEdition: document.getElementById("planningEdition").textContent.trim(),
            distinction: document.querySelector("#planningIdentity .planning-distinction").textContent.trim(),
            evidence: [
              document.querySelector("#placeCircleSummary .evidence-link"),
              areaEvidence,
              document.querySelector("#planningAmbito .section-head .evidence-link"),
            ].map((button) => ({
              visible: getComputedStyle(button).display !== "none",
              prefix: button.dataset.evidencePrefix,
              name: button.getAttribute("aria-label"),
              target: { width: getComputedStyle(button).width, height: getComputedStyle(button).height },
            })),
            areaEvidenceTarget: {
              width: areaEvidenceStyle.width,
              height: areaEvidenceStyle.height,
              iconWidth: icon ? getComputedStyle(icon).width : "22px",
              iconHeight: icon ? getComputedStyle(icon).height : "22px",
            },
          };
        });

        assert.equal(view.appearance, appearance);
        assert.equal(view.language, language);
        assert.ok(view.documentWidth <= view.viewportWidth + 1, `${viewport.name}/${appearance}/${language}: no page-level horizontal overflow`);
        for (const [name, bounds] of [["panel", view.panel], ["area", view.area], ["planning", view.planning]]) {
          assert.ok(bounds.scrollWidth <= bounds.width + 1, `${viewport.name}/${appearance}/${language}: ${name} has no horizontal overflow (${JSON.stringify(bounds)}; panel overflow nodes=${JSON.stringify(view.panelOverflow)})`);
        }
        assert.equal(view.summary.visible, viewport.width <= 850, "the existing responsive circle-summary visibility is unchanged");
        assert.match(view.circleRadius, /900 m (radius|de radio)/i);
        assert.deepEqual(view.circleLabels.length, 4);
        assert.match(view.residents, /\d/);
        assert.match(view.residentScope, /barrio|barrio oficial|official barrio|círculo|Lens circle/i);
        assert.match(view.areaScope, /barrio/i);
        assert.ok(view.areaHeadline.length > 0);
        assert.ok(view.areaCode.includes("Barrio"));
        assert.equal(view.vut, "22");
        assert.match(view.vutUnit, /VUT/i);
        assert.equal(view.planningCode, INSIDE.code);
        assert.match(view.planningKind, /Planning ámbito|Ámbito de planeamiento/i);
        assert.match(view.planningScope, /ámbito|ambito/i);
        assert.ok(view.planningDenomination.length > 0);
        assert.ok(view.planningEdition.length > 0, "the official edition remains visible with planning evidence");
        assert.match(view.distinction, /not the barrio|no es el barrio/i);
        assert.deepEqual(view.evidence.map((item) => item.prefix), ["place.metric.", "place.area.", "place.planning."]);
        assert.ok(view.evidence.every((item) => item.visible && item.name && item.name.length > 0));
        if (viewport.coarse) {
          assert.ok(parseFloat(view.areaEvidenceTarget.width) >= 44, "the evidence button itself retains the coarse-pointer target");
          assert.ok(parseFloat(view.areaEvidenceTarget.height) >= 44);
          assert.equal(view.areaEvidenceTarget.iconWidth, "22px", "the information mark remains visually compact");
          assert.equal(view.areaEvidenceTarget.iconHeight, "22px");
        } else {
          assert.equal(view.areaEvidenceTarget.width, "22px", "the icon remains visually compact on a fine pointer");
          assert.equal(view.areaEvidenceTarget.height, "22px");
        }
      }
    }
  });
}

test("administrative and planning absences stay explicit and never become zero or a shared measure", async (t) => {
  const populationMissing = await openApp(VIEWPORTS[1], { unavailablePopulation: true });
  t.after(() => closePage(populationMissing));
  await moveTo(populationMissing, INSIDE);
  await populationMissing.waitForFunction(() => document.getElementById("areaProfile").dataset.residents === "unavailable");
  assert.equal(await populationMissing.locator("#areaProfile").getAttribute("data-state"), "resolved", "the barrio remains identified when only its population source is unavailable");
  assert.equal(await populationMissing.locator("#areaHeadline").textContent(), "Imperial");
  assert.equal(await populationMissing.locator("#areaResidentsValue").textContent(), "Unavailable");
  assert.doesNotMatch(await populationMissing.locator("#areaResidentsValue").textContent(), /^0+$/);
  assert.equal(await populationMissing.locator("#areaVutValue").textContent(), "22", "VUT context keeps its own artifact and state");

  const planningMissing = await openApp(VIEWPORTS[1], { unavailablePlanning: true });
  t.after(() => closePage(planningMissing));
  await moveTo(planningMissing, { ...INSIDE, code: "" });
  assert.equal(await planningMissing.locator("#planningAmbito").getAttribute("data-state"), "unavailable");
  assert.equal(await planningMissing.locator("#planningIdentity").isVisible(), false);
  assert.equal(await planningMissing.locator("#planningOutside").isVisible(), true);
  const unavailableMessage = await planningMissing.locator("#planningOutside").textContent();
  assert.match(unavailableMessage, /unavailable|not available|no está disponible/i);
  assert.doesNotMatch(unavailableMessage, /No official planning ámbito contains/i, "unavailable evidence stays distinct from no intersection");
  assert.equal(await planningMissing.locator("#areaHeadline").textContent(), "Imperial");
  assert.equal(await planningMissing.locator("#areaResidentsValue").textContent(), "24,313");

  const outside = await openApp(VIEWPORTS[1]);
  t.after(() => closePage(outside));
  await moveTo(outside, OUTSIDE);
  await outside.waitForFunction(() => document.getElementById("planningAmbito").dataset.state === "outside_all_ambitos");
  assert.equal(await outside.locator("#planningIdentity").isVisible(), false);
  assert.equal(await outside.locator("#planningOutside").isVisible(), true);
  const explanation = await outside.locator("#planningOutside").textContent();
  assert.match(explanation, /No official planning ámbito contains the Lens centre/i);
  assert.match(explanation, /does not cover the whole municipality/i);
  assert.doesNotMatch(explanation, /\b0\b/);
  assert.equal(await outside.locator("#planningPhasesBlock").isVisible(), false);
  assert.equal(await outside.locator("#planningBuildBlock").isVisible(), false);
  assert.equal(await outside.locator("#areaProfile").getAttribute("data-state"), "resolved");
  assert.equal(await outside.locator("#areaHeadline").textContent(), "Los Jerónimos");
  assert.match(await outside.locator("#placeCircleSummaryRadius").textContent(), /900 m (radius|de radio)/i);
});

test("long official planning names and codes wrap without clipping or moving either Lens", async (t) => {
  const page = await openApp(VIEWPORTS[3]);
  t.after(() => closePage(page));
  await moveTo(page, INSIDE);
  const before = await page.evaluate(() => ({ view: window.__HALO_REGRESSION__.mapView(), centres: window.__HALO_REGRESSION__.lensCenters() }));
  const query = page.locator("#planningExplorerQuery");
  await query.fill("API.06.05");
  await page.waitForFunction(() => document.querySelectorAll("#planningExplorerResults button").length === 1);
  await page.locator("#planningExplorerResults button").click();
  assert.equal(await page.locator("#planningExplorerCode").textContent(), "API.06.05");
  assert.equal(await page.locator("#planningExplorerDenomination").textContent(), "MANZANA ENTRE LADERA, PINOS BAJA, CAPITÁN BLANCO ARGIBAY");
  const dimensions = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: innerWidth,
    card: document.getElementById("planningExplorerCard").clientWidth,
    cardContent: document.getElementById("planningExplorerCard").scrollWidth,
    denomination: document.getElementById("planningExplorerDenomination").getBoundingClientRect().width,
  }));
  assert.ok(dimensions.document <= dimensions.viewport + 1);
  assert.ok(dimensions.cardContent <= dimensions.card + 1, "long exact denomination and code do not widen the card");
  const after = await page.evaluate(() => ({ view: window.__HALO_REGRESSION__.mapView(), centres: window.__HALO_REGRESSION__.lensCenters() }));
  assert.deepEqual(after, before, "inspecting a long official identity does not move a Lens or the map");
});

test("evidence target remains operable by keyboard and across the coarse-pointer hit area", async (t) => {
  const page = await openApp(VIEWPORTS[1]);
  t.after(() => closePage(page));
  await moveTo(page, INSIDE);
  const opener = page.locator("#areaProfile .evidence-link");
  await opener.focus();
  assert.equal(await opener.evaluate((node) => node.matches(":focus-visible")), true);
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#evidenceDrawer").getAttribute("open"), "");
  assert.ok(await page.locator("#evidenceDrawerBody .drawer-record").count() > 0, "the area evidence route still presents source records");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.getElementById("evidenceDrawer").open);
  assert.equal(await opener.evaluate((node) => document.activeElement === node), true, "keyboard dismissal returns focus to the evidence control");

  const box = await opener.boundingBox();
  await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
  await page.waitForFunction(() => document.getElementById("evidenceDrawer").open);
  assert.ok(await page.locator("#evidenceDrawerBody .drawer-record").count() > 0, "the far edge of the real 44px button opens the same evidence route");
  await page.locator("#evidenceDrawerClose").click();
});

test("Place, Compare, and City retain independent panel scroll positions", async (t) => {
  const page = await openApp(VIEWPORTS[0]);
  t.after(() => closePage(page));
  const panel = page.locator("#analysisPanel");
  const switchMode = async (mode) => {
    await page.evaluate((name) => document.querySelector(`.mode-btn[data-mode="${name}"]`).click(), mode);
    await page.waitForFunction((name) => document.getElementById("analysisPanel").dataset.mode === name, mode);
    assert.equal(await page.locator("[data-mode-section]:visible").count(), 1);
  };
  await panel.evaluate((node) => { node.scrollTop = 280; });
  const place = await panel.evaluate((node) => node.scrollTop);
  await switchMode("COMPARE");
  assert.equal(await panel.evaluate((node) => node.scrollTop), 0);
  await panel.evaluate((node) => { node.scrollTop = 180; });
  const compare = await panel.evaluate((node) => node.scrollTop);
  await switchMode("CITY");
  assert.equal(await panel.evaluate((node) => node.scrollTop), 0);
  await panel.evaluate((node) => { node.scrollTop = 110; });
  const city = await panel.evaluate((node) => node.scrollTop);
  await switchMode("COMPARE");
  assert.equal(await panel.evaluate((node) => node.scrollTop), compare);
  await switchMode("PLACE");
  assert.equal(await panel.evaluate((node) => node.scrollTop), place);
  await switchMode("CITY");
  assert.equal(await panel.evaluate((node) => node.scrollTop), city);
});
