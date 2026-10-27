import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mime = { ".css":"text/css", ".geojson":"application/geo+json", ".html":"text/html", ".js":"text/javascript", ".json":"application/json", ".png":"image/png", ".svg":"image/svg+xml" };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const target = path.resolve(ROOT, pathname === "/" ? "index.html" : pathname.slice(1));
  if (!target.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end();
  fs.readFile(target, (error, content) => error ? response.writeHead(404).end() : response.writeHead(200, { "content-type": mime[path.extname(target)] || "application/octet-stream" }).end(content));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });
test.after(async () => { await browser.close(); server.close(); });

const sizes = [[320,700],[360,740],[390,844],[430,932],[560,400],[560,760],[600,820],[680,430],[768,1024],[820,1180],[1024,768],[1440,900]];
const combos = [["en","light","light"],["es","dark","dark"],["en","system","dark"]];
const hit = (a, b) => a && b && a.left < b.right - .5 && a.right > b.left + .5 && a.top < b.bottom - .5 && a.bottom > b.top + .5;

test("UX-H1.2 map controls hang from the real header edge without collisions", async () => {
  for (const [width, height] of sizes) for (const [language, preference, colorScheme] of combos) {
    const context = await browser.newContext({ viewport:{ width, height }, colorScheme, hasTouch:width <= 820, isMobile:width <= 560 });
    await context.addInitScript((value) => localStorage.setItem("madrid-lens-appearance", value), preference);
    const page = await context.newPage();
    await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
    await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1&lang=${language}`, { waitUntil:"domcontentloaded" });
    await page.locator("#tutorialHelpButton").waitFor();
    await page.waitForFunction(() => window.__HALO_REGRESSION__?.k11Restored());
    const read = () => page.evaluate(() => {
      const rect = (selector) => {
        const el = document.querySelector(selector); const style = getComputedStyle(el);
        if (!el || style.display === "none" || style.visibility === "hidden" || el.hidden) return null;
        const b = el.getBoundingClientRect(); return { left:b.left, top:b.top, right:b.right, bottom:b.bottom, width:b.width, height:b.height };
      };
      const header = document.querySelector("header");
      return {
        overflow:document.documentElement.scrollWidth > innerWidth,
        clipped:header.scrollWidth > header.clientWidth + 1 || header.scrollHeight > header.clientHeight + 1,
        header:rect("header"), button:rect("#mobileLayersButton"), rail:rect("#layerRail"),
        prefs:["#appearanceSelect", "#languageSelect", "#tutorialHelpButton"].map(rect),
        zoom:rect(".leaflet-control-zoom"), attribution:rect(".leaflet-control-attribution"),
        expanded:document.querySelector("#mobileLayersButton").getAttribute("aria-expanded"),
        cssBottom:getComputedStyle(document.documentElement).getPropertyValue("--header-bottom")
      };
    });
    const name = `${width}x${height} ${language}/${preference}`;
    const closed = await read();
    assert.equal(closed.overflow, false, `${name}: no horizontal overflow`);
    assert.equal(closed.clipped, false, `${name}: header text is not clipped`);
    assert.equal(parseFloat(closed.cssBottom), Math.ceil(closed.header.bottom), `${name}: --header-bottom tracks the rendered header`);
    if (closed.rail) assert.ok(closed.rail.top >= closed.header.bottom, `${name}: persistent rail starts below the header`);
    if (width > 560) assert.equal(closed.button, null, `${name}: no redundant Layers button where the rail is persistent`);
    else {
      assert.ok(closed.button.width >= 44 && closed.button.height >= 44, `${name}: Layers keeps a 44px target`);
      assert.ok(closed.button.top >= closed.header.bottom + 8, `${name}: Layers sits clear of the header`);
      assert.ok(closed.button.left >= 10 && closed.button.left <= 12, `${name}: Layers aligns to the left map margin`);
      assert.ok(!closed.prefs.some((box) => hit(closed.button, box)) && !hit(closed.button, closed.zoom) && !hit(closed.button, closed.attribution), `${name}: Layers collides with no control`);
      assert.equal(closed.expanded, "false", `${name}: starts collapsed`);
      await page.locator("#mobileLayersButton").click();
      const open = await read();
      assert.equal(open.expanded, "true", `${name}: aria-expanded true when open`);
      assert.ok(open.rail && open.rail.top >= closed.button.bottom && open.rail.top >= open.header.bottom, `${name}: opened rail sits below Layers and the header`);
      assert.equal(open.overflow, false, `${name}: no overflow when open`);
      await page.keyboard.press("Escape");
      const reclosed = await read();
      assert.equal(reclosed.expanded, "false", `${name}: Escape collapses`);
      assert.equal(reclosed.rail, null, `${name}: rail hidden again`);
    }
    await context.close();
  }
});
