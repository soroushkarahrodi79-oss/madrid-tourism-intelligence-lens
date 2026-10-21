import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const discover = await fs.readFile(path.join(root, "discover/index.html"), "utf8");
const app = await fs.readFile(path.join(root, "index.html"), "utf8");
const capture = await fs.readFile(path.join(root, "research/ux_t1_appearance/screenshots/04-desktop-compare-light.png"));
async function startServer() {
  const server = http.createServer((req, res) => {
    if (["/discover/", "/discover/index.html"].includes(req.url)) return res.writeHead(200, { "content-type": "text/html" }).end(discover);
    if (req.url === "/") return res.writeHead(200, { "content-type": "text/html" }).end(app);
    if (req.url === "/research/ux_t1_appearance/screenshots/04-desktop-compare-light.png") return res.writeHead(200, { "content-type": "image/png" }).end(capture);
    res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
async function open(browser, base, width, reducedMotion = "no-preference") {
  const context = await browser.newContext({ viewport: { width, height: width <= 420 ? 844 : 900 }, reducedMotion });
  const page = await context.newPage(); page.setDefaultTimeout(6000);
  const external = []; const errors = [];
  await page.route("https://**/*", route => { external.push(route.request().url()); route.abort(); });
  page.on("pageerror", error => errors.push(String(error)));
  await page.goto(`${base}/discover/`, { waitUntil: "domcontentloaded" });
  return { context, page, external, errors };
}

test("Discover works over real HTTP at the required widths with optional requests blocked", async t => {
  const { server, base } = await startServer(); const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  for (const width of [320, 390, 768, 1440]) await t.test(`${width}px`, async () => {
    const { context, page, external, errors } = await open(browser, base, width);
    try {
      const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
      assert.ok(dimensions.scroll <= dimensions.viewport + 1, `no horizontal overflow at ${width}`);
      assert.equal(await page.locator(".lens-b").evaluate(el => getComputedStyle(el).borderStyle), "dashed");
      assert.equal(await page.locator(".product-proof img").getAttribute("src"), "../research/ux_t1_appearance/screenshots/04-desktop-compare-light.png");
      const a = page.locator(".lens-a"); await a.focus(); const beforeA = await a.boundingBox(); await page.keyboard.press("ArrowRight"); assert.ok((await a.boundingBox()).x >= beforeA.x + 10, "keyboard moves A");
      if (width !== 320) { const b = page.locator(".lens-b"); await b.scrollIntoViewIfNeeded(); const beforeB = await b.boundingBox(); await page.mouse.move(beforeB.x + beforeB.width / 2, beforeB.y + beforeB.height / 2); await page.mouse.down(); await page.mouse.move(beforeB.x + beforeB.width / 2 - 15, beforeB.y + beforeB.height / 2 - 16); await page.mouse.up(); assert.ok((await b.boundingBox()).x <= beforeB.x - 5, "pointer moves B"); }
      await page.locator('[data-lang="en"]').click(); assert.equal(await page.locator("html").getAttribute("lang"), "en"); assert.equal(await page.locator(".lang").getAttribute("aria-label"), "Language"); assert.match(await page.locator("#storyHeading").textContent(), /Three modes/);
      await page.locator("#tab-place").focus(); await page.keyboard.press("ArrowRight"); assert.equal(await page.locator("#tab-compare").getAttribute("aria-selected"), "true");
      assert.ok(external.every(url => url.includes("cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/")), "only optional GSAP requests are blocked"); assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
});

test("Discover honors reduced motion and preserves the root-app route", async t => {
  const { server, base } = await startServer(); const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const { context, page, errors } = await open(browser, base, 390, "reduce"); t.after(() => context.close());
  assert.ok(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches));
  assert.equal(await page.locator(".hero .action.primary").getAttribute("href"), "../");
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" }); assert.match(await page.content(), /Madrid Urban Evidence Lens/); assert.deepEqual(errors, []);
});
