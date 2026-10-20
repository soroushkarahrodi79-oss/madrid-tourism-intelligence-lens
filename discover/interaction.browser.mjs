import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Isolated landing test: no basemaps, data, analytics engine or external network.
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HTML = await fs.readFile(path.join(ROOT, "index.html"), "utf8");

const launch = async () => chromium.launch({ headless: true });
const open = async (browser, width, reducedMotion = "no-preference") => {
  const context = await browser.newContext({ viewport: { width, height: width <= 420 ? 844 : 900 }, reducedMotion });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  await page.route("**/*", (route) => route.abort()); // GSAP is enhancement, not a product dependency.
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.setContent(HTML, { waitUntil: "domcontentloaded" });
  return { context, page, errors };
};

test("Discover V2 is usable across four widths without network", async (t) => {
  const browser = await launch();
  t.after(() => browser.close());
  for (const width of [320, 390, 768, 1440]) {
    await t.test(`${width}px: two movable lenses, reset, ES/EN, accessible tabs`, async () => {
      const { context, page, errors } = await open(browser, width);
      try {
        const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
        assert.ok(dimensions.scroll <= dimensions.viewport + 1, `overflow ${width}: ${JSON.stringify(dimensions)}`);
        assert.equal(await page.locator(".lens-handle").count(), 2);
        assert.equal(await page.locator(".story-step").count(), 3);
        assert.match(await page.locator(".visual-disclaimer").textContent(), /ilustración|illustration/i);
        const a = page.locator(".lens-a");
        await a.scrollIntoViewIfNeeded();
        const beforeA = await a.boundingBox();
        await a.focus();
        await page.keyboard.press("ArrowRight");
        assert.ok((await a.boundingBox()).x >= beforeA.x + 10, "arrow-key movement");
        const b = page.locator(".lens-b");
        await b.scrollIntoViewIfNeeded();
        const beforeB = await b.boundingBox();
        const start = { x: beforeB.x + beforeB.width / 2, y: beforeB.y + beforeB.height / 2 };
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x - 15, start.y - 16, { steps: 5 });
        await page.mouse.up();
        assert.ok((await b.boundingBox()).x <= beforeB.x - 5, "pointer movement");
        await page.locator("#demoReset").click();
        assert.ok(Math.abs((await b.boundingBox()).x - beforeB.x) < 2, "reset");
        assert.equal(await a.getAttribute("aria-pressed"), "true");
        await page.locator('[data-lang="en"]').click();
        assert.equal(await page.locator("html").getAttribute("lang"), "en");
        assert.match(await a.getAttribute("aria-label"), /^Drag/);
        await page.locator("#tab-place").focus();
        await page.keyboard.press("ArrowRight");
        assert.equal(await page.locator("#tab-compare").getAttribute("aria-selected"), "true");
        assert.ok(await page.locator("#scene-compare").isVisible());
        await page.locator('[data-lang="es"]').click();
        assert.equal(await page.locator("html").getAttribute("lang"), "es");
        assert.deepEqual(errors, [], "no browser JS exceptions");
      } finally {
        await context.close();
      }
    });
  }
});

test("Discover V2 respects prefers-reduced-motion", async (t) => {
  const browser = await launch();
  t.after(() => browser.close());
  const { context, page, errors } = await open(browser, 390, "reduce");
  t.after(() => context.close());
  assert.ok(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches));
  assert.equal(await page.locator(".lens-handle").count(), 2);
  assert.deepEqual(errors, []);
});