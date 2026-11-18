// #200: polygon drawing on small phones. At 360x640 the bottom panel left the
// drawing toolbar ~88px for ~269px of content, so Finish/Cancel/edit tools needed
// inner scrolling. While drawing/editing, the bottom panel is now folded away
// (CSS only) and restored on exit. Geometry, calculations and exports untouched.
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
  if (!target.startsWith(ROOT + path.sep)) return response.writeHead(403).end();
  fs.readFile(target, (error, data) => {
    if (error) return response.writeHead(404).end();
    response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
    response.end(data);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const port = server.address().port;

const RING = [{ lat: 40.41, lon: -3.71 }, { lat: 40.41, lon: -3.68 }, { lat: 40.425, lon: -3.68 }, { lat: 40.425, lon: -3.71 }];
const scenarios = [
  { width: 360, height: 640, touch: true },
  { width: 390, height: 844, touch: true },
  { width: 1440, height: 900, touch: false },
];
const intersects = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
const box = (page, selector) => page.evaluate((s) => {
  const r = document.querySelector(s).getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
}, selector);
const panelShown = (page) => page.evaluate(() => getComputedStyle(document.getElementById("analysisPanel")).display !== "none");
const innerScroll = (page) => page.evaluate(() => { const t = document.getElementById("spatialToolbar"); return t.scrollHeight - t.clientHeight; });

async function open(s) {
  const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, hasTouch: s.touch, isMobile: s.touch, deviceScaleFactor: 1 });
  await context.addInitScript(() => localStorage.setItem("madrid-lens-appearance", "light"));
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  await page.route("**/*", (route) => {
    const hostname = new URL(route.request().url()).hostname;
    return hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__) && typeof window.__addVertex === "function");
  await page.waitForFunction(() => document.getElementById("tourismValue").textContent.trim() !== "—");
  await page.locator("#spatialToolsToggle").click();
  await page.locator("#geometryModePolygon").click();
  return { context, page };
}

for (const s of scenarios) {
  test(`${s.width}x${s.height}: draw, finish, edit and cancel keep tools reachable and restore the panel`, async () => {
    const { context, page } = await open(s);
    try {
      const mobile = s.width <= 850;
      assert.equal(await panelShown(page), true, "panel visible before drawing");
      await page.evaluate(() => { document.getElementById("analysisPanel").scrollTop = 37; });
      const scrollBefore = await page.evaluate(() => document.getElementById("analysisPanel").scrollTop);

      await page.locator("#polygonDrawButton").click();
      assert.equal(await panelShown(page), !mobile, mobile ? "phone: panel folded while drawing" : "desktop: panel untouched");
      const toolbar = await box(page, "#spatialToolbar");
      for (const id of ["polygonAddVertexButton", "polygonUndoButton", "polygonFinishButton", "polygonCancelButton"]) {
        const b = await box(page, `#${id}`);
        assert.ok(b.top >= toolbar.top - 1 && b.bottom <= toolbar.bottom + 1, `${id} inside the toolbar box`);
        assert.ok(b.bottom <= s.height && b.right <= s.width, `${id} inside the viewport`);
        if (s.touch) assert.ok(b.height >= 43.5, `${id} is a 44px target`);
      }
      assert.ok(await innerScroll(page) <= 1, "no inner scroll needed to reach any drawing action");
      assert.ok(!intersects(toolbar, await box(page, ".leaflet-control-attribution")), "toolbar clears the mandatory attribution");
      assert.ok(!intersects(toolbar, await box(page, ".leaflet-control-zoom")), "toolbar clears the zoom control");

      await page.locator("#polygonFinishButton").focus();
      assert.equal(await page.evaluate(() => document.activeElement.id), "polygonFinishButton", "Finish is keyboard-focusable");

      await page.locator("#polygonCancelButton").click();
      assert.equal(await panelShown(page), true, "panel restored after cancel");
      assert.equal(await page.evaluate(() => window.__ring()), null, "cancel commits no geometry");

      await page.locator("#polygonDrawButton").click();
      await page.evaluate((r) => { for (const v of r) window.__addVertex(v); }, RING);
      await page.locator("#polygonFinishButton").click();
      assert.equal(await panelShown(page), true, "panel restored after finish");
      assert.equal(await page.evaluate(() => document.getElementById("analysisPanel").scrollTop), scrollBefore, "panel scroll preserved");
      const committed = await page.evaluate(() => window.__ring());
      assert.equal(committed.length, RING.length);
      RING.forEach((v, i) => {
        assert.ok(Math.abs(committed[i].lat - v.lat) < 1e-9 && Math.abs(committed[i].lon - v.lon) < 1e-9, `vertex ${i} unchanged`);
      });

      await page.locator("#polygonEditButton").click();
      assert.equal(await panelShown(page), !mobile);
      assert.ok(await innerScroll(page) <= 1, "edit tools need no inner scroll");
      const editToolbar = await box(page, "#spatialToolbar");
      for (const id of ["polygonEditApplyButton", "polygonEditCancelButton"]) {
        const b = await box(page, `#${id}`);
        assert.ok(b.bottom <= editToolbar.bottom + 1 && b.bottom <= s.height, `${id} reachable`);
        if (s.touch) assert.ok(b.height >= 43.5, `${id} is a 44px target`);
      }
      await page.locator("#polygonEditCancelButton").click();
      assert.equal(await panelShown(page), true, "panel restored after edit cancel");
      assert.deepEqual(await page.evaluate(() => window.__ring()), committed, "edit cancel leaves geometry identical");

      await page.locator("#polygonRedrawButton").click();
      assert.equal(await panelShown(page), !mobile);
      await page.locator("#spatialToolsToggle").click();
      assert.equal(await panelShown(page), true, "panel restored when tools are closed");
    } finally {
      await context.close();
    }
  });
}
test.after(async () => { await browser.close(); server.close(); });
