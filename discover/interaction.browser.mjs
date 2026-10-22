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
const capturePath = "/docs/review/ux-p2/after/1440x900-compare.jpg";
const capture = await fs.readFile(path.join(root, capturePath));
async function startServer() {
  const server = http.createServer((req, res) => {
    if (["/discover/", "/discover/index.html"].includes(req.url)) return res.writeHead(200, { "content-type": "text/html" }).end(discover);
    if (req.url === "/") return res.writeHead(200, { "content-type": "text/html" }).end(app);
    if (req.url === capturePath) return res.writeHead(200, { "content-type": "image/jpeg" }).end(capture);
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

async function auditAccessibility(page) {
  return page.evaluate(() => {
    const issues = [];
    const ids = [...document.querySelectorAll("[id]")].map(element => element.id);
    const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    if (duplicates.length) issues.push(`duplicate ids: ${duplicates.join(", ")}`);
    for (const image of document.querySelectorAll("img")) if (!image.hasAttribute("alt")) issues.push(`image without alt: ${image.src}`);
    for (const control of document.querySelectorAll('a[href],button,input,select,textarea,[role="tab"]')) {
      if (control.matches('[aria-hidden="true"]') || !control.getClientRects().length) continue;
      const name = control.getAttribute("aria-label") || control.getAttribute("aria-labelledby") || control.textContent?.trim() || control.getAttribute("title");
      if (!name) issues.push(`unnamed control: ${control.outerHTML.slice(0, 100)}`);
    }
    const parse = value => (value.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
    const luminance = ([r, g, b]) => {
      const channels = [r, g, b].map(channel => { const value = channel / 255; return value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; });
      return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
    };
    const background = element => {
      for (let node = element; node; node = node.parentElement) {
        const color = parse(getComputedStyle(node).backgroundColor);
        if (color.length >= 3 && (color[3] === undefined || color[3] >= .99)) return color;
      }
      return [255, 255, 255];
    };
    const selectors = [".lang button", ".microcopy", ".section-copy", ".tab-number", ".tab span:last-child", ".scope-card small", ".principle-index", ".principle p", ".statement .mini", "footer"];
    for (const element of document.querySelectorAll(selectors.join(","))) {
      if (!element.getClientRects().length) continue;
      const foreground = parse(getComputedStyle(element).color);
      const light = Math.max(luminance(foreground), luminance(background(element)));
      const dark = Math.min(luminance(foreground), luminance(background(element)));
      const ratio = (light + .05) / (dark + .05);
      if (ratio < 4.5) issues.push(`contrast ${ratio.toFixed(2)}: ${element.matches("footer") ? "footer" : element.className || element.tagName}`);
    }
    return issues;
  });
}

test("Discover works over real HTTP at the required widths with optional requests blocked", async t => {
  const { server, base } = await startServer(); const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  for (const width of [320, 390, 768, 1024, 1440]) await t.test(`${width}px`, async () => {
    const { context, page, external, errors } = await open(browser, base, width);
    try {
      const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
      assert.ok(dimensions.scroll <= dimensions.viewport + 1, `no horizontal overflow at ${width}`);
      assert.deepEqual(await auditAccessibility(page), [], `automated accessibility checks pass at ${width}px`);
      assert.equal(await page.locator(".lens-b").evaluate(el => getComputedStyle(el).borderStyle), "dashed");
      assert.equal(await page.locator(".product-proof img").getAttribute("src"), "../docs/review/ux-p2/after/1440x900-compare.jpg");
      assert.doesNotMatch(await page.locator(".hero .lead").textContent(), /transforma|changes/i, "hero avoids unsupported temporal framing");
      assert.equal(await page.locator(".proof-list li").count(), 3, "real product preview explains the three modes");
      const a = page.locator(".lens-a"); await a.focus(); const beforeA = await a.boundingBox(); await page.keyboard.press("ArrowRight"); assert.ok((await a.boundingBox()).x >= beforeA.x + 10, "keyboard moves A");
      if (width !== 320) { const b = page.locator(".lens-b"); await b.scrollIntoViewIfNeeded(); const beforeB = await b.boundingBox(); await page.mouse.move(beforeB.x + beforeB.width / 2, beforeB.y + beforeB.height / 2); await page.mouse.down(); await page.mouse.move(beforeB.x + beforeB.width / 2 - 15, beforeB.y + beforeB.height / 2 - 16); await page.mouse.up(); assert.ok((await b.boundingBox()).x <= beforeB.x - 5, "pointer moves B"); }
      await page.locator('[data-lang="en"]').click(); assert.equal(await page.locator("html").getAttribute("lang"), "en"); assert.equal(await page.locator(".lang").getAttribute("aria-label"), "Language"); assert.match(await page.locator("#storyHeading").textContent(), /Three modes/); assert.equal(await page.locator(".hero [data-app-link]").getAttribute("href"), "../?lang=en");
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
  assert.equal(await page.locator(".hero .action.primary").getAttribute("href"), "../?lang=es");
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" }); assert.match(await page.content(), /Madrid Urban Evidence Lens/); assert.deepEqual(errors, []);
});
