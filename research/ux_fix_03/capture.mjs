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
    response.writeHead(200, { "content-type": "text/css; charset=utf-8" });
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
const browser = await chromium.launch({ headless: true });
const url = `http://127.0.0.1:${server.address().port}/?haloRegressionTest=1`;
const states = [
  { name: "available", lat: 40.40255, lon: -3.71371, code: "APR.02.09", appearance: "dark", language: "en" },
  { name: "unavailable", lat: 40.40255, lon: -3.71371, unavailable: true, appearance: "light", language: "es" },
  { name: "no-intersection", lat: 40.4149, lon: -3.69, code: "", appearance: "dark", language: "en" },
];

try {
  for (const state of states) {
    const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
    const page = await context.newPage();
    await page.route("**/*", (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.hostname !== "127.0.0.1" && requestUrl.hostname !== "localhost") return route.abort();
      if (state.unavailable && requestUrl.pathname.endsWith("/data/planning/madrid_ambitos.geojson")) {
        return route.fulfill({ status: 503, contentType: "text/plain", body: "Planning evidence unavailable for screenshot scenario" });
      }
      return route.continue();
    });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__));
    await page.waitForFunction(() => {
      const section = document.getElementById("planningAmbito");
      return section && section.dataset.state && section.dataset.state !== "loading";
    });
    await page.evaluate(([lat, lon]) => window.__HALO_REGRESSION__.moveLensToLatLng("A", lat, lon), [state.lat, state.lon]);
    await page.waitForFunction((code) => document.getElementById("planningCode").textContent.trim() === code, state.code ?? "");
    if (state.unavailable) {
      await page.waitForFunction(() => document.getElementById("planningAmbito").dataset.state === "unavailable");
    }
    await page.locator("#appearanceSelect").selectOption(state.appearance);
    await page.locator("#languageSelect").selectOption(state.language);
    await page.waitForTimeout(100);
    const screenshot = path.join(OUTPUT, `territorial-${state.name}-${state.appearance}-${state.language}.png`);
    await page.screenshot({ path: screenshot, fullPage: false });
    const facts = await page.evaluate(() => ({
      area: document.getElementById("areaHeadline").textContent.trim(),
      areaState: document.getElementById("areaProfile").dataset.state,
      planningState: document.getElementById("planningAmbito").dataset.state,
      planningCode: document.getElementById("planningCode").textContent.trim(),
      planningOutside: document.getElementById("planningOutside").hidden
        ? null
        : document.getElementById("planningOutside").textContent.trim(),
      language: document.documentElement.lang,
      appearance: document.documentElement.dataset.appearance,
    }));
    await page.evaluate(() => {
      const panel = document.getElementById("analysisPanel");
      const section = document.getElementById("planningAmbito");
      const stickyHead = document.getElementById("panelHead");
      const targetTop = section.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - stickyHead.getBoundingClientRect().height - 12;
      panel.scrollTo({ top: Math.max(0, targetTop), behavior: "instant" });
    });
    await page.waitForTimeout(100);
    const planningScreenshot = path.join(OUTPUT, `territorial-${state.name}-planning-${state.appearance}-${state.language}.png`);
    await page.screenshot({ path: planningScreenshot, fullPage: false });
    console.log(JSON.stringify({ screenshot, planningScreenshot, ...facts }));
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
