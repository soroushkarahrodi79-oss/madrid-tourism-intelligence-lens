import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const OUTPUT = path.resolve(process.argv[2] || path.join(HERE, "screenshots"));
const BASELINE = process.argv.includes("--baseline");
const baselineCss = BASELINE ? execFileSync("git", ["show", "origin/main:css/app.css"], { cwd: ROOT }) : null;
const ALL_VIEWPORTS = [
  { name: "desktop-1440x900", width: 1440, height: 900, touch: false },
  { name: "ipad-landscape-1180x820", width: 1180, height: 820, touch: true },
  { name: "ipad-portrait-820x1180", width: 820, height: 1180, touch: true },
  { name: "mobile-390x844", width: 390, height: 844, touch: true, mobile: true },
];
const requestedViewport = process.argv.find((arg) => arg.startsWith("--viewport="))?.split("=")[1];
const VIEWPORTS = requestedViewport ? ALL_VIEWPORTS.filter(({ name }) => name === requestedViewport) : ALL_VIEWPORTS;
if (requestedViewport && !VIEWPORTS.length) throw new Error(`unknown viewport: ${requestedViewport}`);
const STATES = [
  { name: "long-barrio", lat: 40.448, lon: -3.735, expectedArea: "Ciudad Universitaria", appearance: "light", language: "en" },
  { name: "long-planning-code", lat: 40.4491896975, lon: -3.551747205, expectedCode: "AOE.00.02-RP", appearance: "dark", language: "en" },
  { name: "no-intersection", lat: 40.4149, lon: -3.69, expectedPlanning: "touches no official planning ámbito", appearance: "dark", language: "es" },
  { name: "unavailable", lat: 40.40255, lon: -3.71371, unavailable: true, expectedPlanning: "no disponible", appearance: "light", language: "es" },
];
const MIME = {
  ".css": "text/css; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const target = path.resolve(ROOT, pathname === "/" ? "index.html" : pathname.slice(1));
  if (!target.startsWith(`${ROOT}${path.sep}`) && target !== path.join(ROOT, "index.html")) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  if (BASELINE && pathname === "/css/app.css") {
    response.writeHead(200, { "content-type": MIME[".css"] });
    response.end(baselineCss);
    return;
  }
  fs.readFile(target).then((content) => {
    response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
    response.end(content);
  }).catch(() => response.writeHead(404).end("Not found"));
});

await fs.mkdir(OUTPUT, { recursive: true });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/?haloRegressionTest=1`;

async function makePage(browser, viewport, unavailable = false) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    hasTouch: viewport.touch,
    ...(viewport.mobile ? { isMobile: true } : {}),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return route.abort();
    if (unavailable && url.pathname.endsWith("/data/planning/madrid_ambitos.geojson")) {
      return route.fulfill({ status: 503, contentType: "text/plain", body: "Planning source unavailable for screenshot state" });
    }
    return route.continue();
  });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__));
  await page.waitForFunction(() => {
    const state = document.getElementById("planningAmbito")?.dataset.state;
    return state && state !== "loading";
  });
  return { context, page };
}

async function capture(page, viewport, state) {
  await page.locator("#appearanceSelect").selectOption(state.appearance);
  await page.locator("#languageSelect").selectOption(state.language);
  await page.waitForFunction(([appearance, language]) =>
    document.documentElement.dataset.appearance === appearance && document.documentElement.lang === language,
  [state.appearance, state.language]);
  await page.evaluate(([lat, lon]) => window.__HALO_REGRESSION__.moveLensToLatLng("A", lat, lon), [state.lat, state.lon]);
  if (state.expectedArea) {
    await page.waitForFunction((name) => document.getElementById("areaHeadline").textContent.trim() === name, state.expectedArea);
  }
  if (state.expectedCode) {
    await page.waitForFunction((code) => document.getElementById("planningCode").textContent.trim() === code, state.expectedCode);
  }
  if (state.unavailable) {
    await page.waitForFunction(() => document.getElementById("planningAmbito").dataset.state === "unavailable");
  }
  if (state.expectedPlanning) {
    const language = state.language;
    await page.waitForFunction(([needle, lang]) => {
      const entry = document.querySelector('#scopeRailList .scope-rail-item[data-scope="PLANNING_AMBITO"] .scope-instance')?.textContent.toLowerCase();
      const translatedNeedle = lang === "es" && needle === "touches no official planning ámbito"
        ? "no toca ningún ámbito oficial de planeamiento"
        : needle;
      return entry?.includes(translatedNeedle);
    }, [state.expectedPlanning, language]);
  }
  const filename = `scope-rail-${state.name}-${viewport.name}-${state.appearance}-${state.language}.png`;
  const screenshot = path.join(OUTPUT, filename);
  await page.locator("#scopeRail").screenshot({ path: screenshot, animations: "disabled" });
  console.log(JSON.stringify({ screenshot, viewport: viewport.name, state: state.name, appearance: state.appearance, language: state.language }));
}

try {
  for (const viewport of VIEWPORTS) {
    const browser = await chromium.launch({ headless: true });
    try {
      const { context, page } = await makePage(browser, viewport);
      for (const state of STATES.filter((candidate) => !candidate.unavailable)) await capture(page, viewport, state);
      await context.close();

      const missing = STATES.find((candidate) => candidate.unavailable);
      const unavailable = await makePage(browser, viewport, true);
      await capture(unavailable.page, viewport, missing);
      await unavailable.context.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
