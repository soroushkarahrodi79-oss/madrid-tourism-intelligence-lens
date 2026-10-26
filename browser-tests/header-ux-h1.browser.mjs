import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(process.env.UX_H1_ROOT || SCRIPT_ROOT);
const CAPTURE_DIR = process.env.UX_H1_CAPTURE_DIR ? path.resolve(process.env.UX_H1_CAPTURE_DIR) : null;
const CAPTURE_ONLY = process.env.UX_H1_CAPTURE_ONLY === "1";
const viewports = [["1440x900",1440,900,"en","light","light"],["1024x768",1024,768,"es","dark","dark"],["820x1180",820,1180,"en","system","light"],["768x1024",768,1024,"es","light","light"],["390x844",390,844,"en","dark","dark"],["360x740",360,740,"es","system","dark"],["680x430",680,430,"en","light","light"],["560x400",560,400,"es","dark","dark"]];
const mime = { ".css":"text/css", ".geojson":"application/geo+json", ".html":"text/html", ".js":"text/javascript", ".json":"application/json", ".png":"image/png", ".svg":"image/svg+xml" };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const target = path.resolve(ROOT, pathname === "/" ? "index.html" : pathname.slice(1));
  if (!target.startsWith(`${ROOT}${path.sep}`) && target !== path.join(ROOT, "index.html")) return response.writeHead(403).end();
  fs.readFile(target, (error, content) => error ? response.writeHead(404).end() : response.writeHead(200, { "content-type": mime[path.extname(target)] || "application/octet-stream" }).end(content));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });

async function open({ width, height, language, preference, colorScheme }) {
  const context = await browser.newContext({ viewport:{ width, height }, colorScheme, hasTouch:width <= 820, isMobile:width <= 560 });
  await context.addInitScript((appearance) => { localStorage.setItem("madrid-lens-appearance", appearance); }, preference);
  const page = await context.newPage();
  await page.route("**/*", (route) => {
    const { hostname } = new URL(route.request().url());
    return hostname === "127.0.0.1" || hostname === "tile.openstreetmap.org" || hostname === "basemaps.cartocdn.com" ? route.continue() : route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1&lang=${language}`, { waitUntil:"domcontentloaded" });
  await page.locator(CAPTURE_ONLY ? "#map" : "#tutorialHelpButton").waitFor();
  await page.waitForFunction(() => window.__HALO_REGRESSION__?.k11Restored());
  return { context, page };
}

test("UX-H1 header has no viewport overflow or control collisions at the required dimensions", async () => {
  if (CAPTURE_DIR) fs.mkdirSync(CAPTURE_DIR, { recursive:true });
  for (const [name,width,height,language,preference,colorScheme] of viewports) {
    const { context, page } = await open({ width, height, language, preference, colorScheme });
    const state = await page.evaluate(() => {
      const rect = (selector) => { const b = document.querySelector(selector).getBoundingClientRect(); return { left:b.left, top:b.top, right:b.right, bottom:b.bottom, height:b.height }; };
      const boxes = ["#appearanceSelect", "#languageSelect", "#tutorialHelpButton"].map(rect);
      const overlap = boxes.some((a, i) => boxes.slice(i + 1).some((b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
      return { overflow:document.documentElement.scrollWidth > innerWidth, boxes, overlap, header:rect("header"), language:document.documentElement.lang };
    });
    if (CAPTURE_DIR) await page.screenshot({ path:path.join(CAPTURE_DIR, `${name}-${language}-${preference}.png`) });
    if (!CAPTURE_ONLY) {
      assert.equal(state.overflow, false, `${name}: no horizontal page overflow`);
      assert.equal(state.overlap, false, `${name}: preference controls do not overlap`);
      assert.equal(state.language, language, `${name}: requested language renders`);
      assert.ok(state.boxes.every((box) => box.height >= 44), `${name}: header targets are at least 44px high`);
      assert.ok(state.header.left >= 0 && state.header.right <= width, `${name}: header stays in viewport`);
    }
    await context.close();
  }
});

test("UX-H1 retains keyboard access to preferences, layers, zoom and attribution", async () => {
  if (CAPTURE_ONLY) return;
  const { context, page } = await open({ width:390, height:844, language:"es", preference:"dark", colorScheme:"dark" });
  await page.locator("#appearanceSelect").focus();
  assert.equal(await page.evaluate(() => document.activeElement.id), "appearanceSelect");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "languageSelect");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "tutorialHelpButton");
  await page.locator("#mobileLayersButton").press("Enter");
  assert.equal(await page.locator("#mobileLayersButton").getAttribute("aria-expanded"), "true");
  assert.ok(await page.locator(".leaflet-control-zoom a").count() >= 2, "Leaflet zoom remains available");
  assert.ok(await page.locator(".leaflet-control-attribution").count() >= 1, "Leaflet attribution remains available");
  await context.close();
});

test.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); });
