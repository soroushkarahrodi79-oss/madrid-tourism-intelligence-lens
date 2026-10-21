import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const target = path.resolve(ROOT, pathname === "/" ? "index.html" : pathname.slice(1));
  if (!target.startsWith(`${ROOT}${path.sep}`) && target !== path.join(ROOT, "index.html")) return response.writeHead(403).end();
  fs.readFile(target, (error, content) => { if (error) return response.writeHead(404).end(); response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" }); response.end(content); });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address(); const browser = await chromium.launch({ headless: true });
const CAPTURE_DIR = path.join(ROOT, "docs", "review", "ux-o1-tutorial");
async function shot(page, name) { if (process.env.CAPTURE_TUTORIAL_SHOTS !== "1") return; fs.mkdirSync(CAPTURE_DIR, { recursive: true }); await page.screenshot({ path: path.join(CAPTURE_DIR, `${name}.png`), fullPage: false }); }
async function open({ width = 1280, storage = null, url = "" } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 820 } });
  if (storage) await context.addInitScript((value) => localStorage.setItem("madrid-lens-tutorial-v1", value), storage);
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  await page.route("**/*", route => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto(`http://127.0.0.1:${port}/${url}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.MadridLensTutorial)); page.context_ = context; return page;
}
const close = (page) => page.context_.close();

test("first visit invites once; skip, replay, six steps and Escape preserve live state", async (t) => {
  const page = await open(); t.after(() => close(page));
  await page.locator("#tutorialInvite").waitFor();
  await shot(page, "01-first-visit-desktop");
  const before = await page.evaluate(() => { const map = document.querySelector("#map"), panel = document.querySelector("#analysisPanel"), r = map.getBoundingClientRect(); return { mode: panel.dataset.mode, radius: document.querySelector("#radiusSlider").value, base: document.querySelector("#basemapSelect").value, url: location.href, position: getComputedStyle(map).position, mapBox: [r.left, r.top, r.width, r.height], panelZ: getComputedStyle(panel).zIndex, markerPane: document.querySelector("#map .leaflet-marker-pane")?.style.transform, overlayPane: document.querySelector("#map .leaflet-overlay-pane")?.style.transform }; });
  await page.locator("[data-tutorial-start]").click();
  assert.equal(await page.locator("#tutorialHighlight").count(), 1);
  await page.locator("[data-tutorial-next]").click(); await shot(page, "03-place-radius-desktop"); await page.locator("[data-tutorial-back]").click();
  for (let n = 1; n <= 6; n++) { await page.locator("#tutorialGuide").waitFor(); await page.locator("[data-tutorial-next]").click(); }
  assert.match(await page.locator("#tutorialGuide").textContent(), /ready to explore/i);
  await page.locator("[data-tutorial-finish]").click();
  assert.equal(await page.evaluate(() => localStorage.getItem("madrid-lens-tutorial-v1")), "1:completed");
  await page.locator("#tutorialHelpButton").click(); await page.keyboard.press("Escape");
  const after = await page.evaluate(() => { const map = document.querySelector("#map"), panel = document.querySelector("#analysisPanel"), r = map.getBoundingClientRect(); return { mode: panel.dataset.mode, radius: document.querySelector("#radiusSlider").value, base: document.querySelector("#basemapSelect").value, url: location.href, position: getComputedStyle(map).position, mapBox: [r.left, r.top, r.width, r.height], panelZ: getComputedStyle(panel).zIndex, markerPane: document.querySelector("#map .leaflet-marker-pane")?.style.transform, overlayPane: document.querySelector("#map .leaflet-overlay-pane")?.style.transform }; });
  assert.deepEqual(after, before);
  assert.equal(await page.evaluate(() => localStorage.getItem("madrid-lens-tutorial-v1")), "1:completed");
  await page.locator("#tutorialHelpButton").click(); assert.match(await page.locator("#tutorialGuide").textContent(), /Understand the map/);
});

test("returning and deep-link readers are not interrupted; language and phone guide remain usable", async (t) => {
  const firstPhone = await open({ width: 390 }); t.after(() => close(firstPhone));
  await firstPhone.locator("#tutorialInvite").waitFor(); await shot(firstPhone, "02-first-visit-mobile");
  const returning = await open({ storage: "1:completed", width: 390 }); t.after(() => close(returning));
  await returning.waitForTimeout(850); assert.equal(await returning.locator("#tutorialInvite").count(), 0);
  await returning.locator("#tutorialHelpButton").click(); await returning.locator("#languageSelect").selectOption("es");
  await shot(returning, "08-spanish-mobile");
  assert.match(await returning.locator("#tutorialGuide").textContent(), /Entiende el mapa/);
  assert.equal(await returning.locator("#tutorialGuide").evaluate(el => el.classList.contains("tutorial-guide-bottom")), true);
  await returning.locator("[data-tutorial-next]").click(); await returning.locator("[data-tutorial-next]").click(); await shot(returning, "04-layers-mobile");
  await returning.locator("[data-tutorial-next]").click(); await shot(returning, "05-compare-mobile");
  await returning.locator("[data-tutorial-next]").click(); await returning.locator("[data-tutorial-next]").click(); await shot(returning, "06-evidence-mobile");
  await returning.locator("#appearanceSelect").selectOption("dark"); await shot(returning, "07-dark-mobile");
  const deep = await open({ url: "?v=1" }); t.after(() => close(deep)); await deep.waitForTimeout(850); assert.equal(await deep.locator("#tutorialInvite").count(), 0);
});

test.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
