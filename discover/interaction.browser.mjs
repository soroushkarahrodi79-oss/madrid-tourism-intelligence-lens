// Discover landing V3: layout, accessibility, language and mode-viewer checks.
// Served from the real repository tree; every non-loopback request is blocked
// and must not even be attempted (the landing has no third-party dependency).
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".webp": "image/webp", ".woff2": "font/woff2", ".png": "image/png" };

async function startServer() {
  const server = http.createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const target = path.resolve(root, "." + (pathname.endsWith("/") ? pathname + "index.html" : pathname));
    if (!target.startsWith(root + path.sep)) return res.writeHead(403).end();
    try { const body = await fs.readFile(target); res.writeHead(200, { "content-type": types[path.extname(target)] || "application/octet-stream" }).end(body); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function open(browser, base, { width, reducedMotion = "no-preference", locale = "es-ES", query = "" }) {
  const context = await browser.newContext({ viewport: { width, height: width <= 420 ? 844 : 900 }, reducedMotion, locale });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  const external = []; const errors = []; const missing = [];
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") { external.push(url.href); return route.abort(); }
    return route.continue();
  });
  page.on("pageerror", error => errors.push(String(error)));
  page.on("response", response => { if (response.status() >= 400) missing.push(response.url()); });
  await page.goto(`${base}/discover/${query}`, { waitUntil: "load" });
  return { context, page, external, errors, missing };
}

// Automated checks only; this is not a WCAG conformance claim.
async function audit(page) {
  return page.evaluate(() => {
    const issues = [];
    const ids = [...document.querySelectorAll("[id]")].map(node => node.id);
    const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    if (dupes.length) issues.push(`duplicate ids: ${dupes}`);
    for (const img of document.querySelectorAll("img")) if (!img.getAttribute("alt")) issues.push(`image without alt: ${img.src}`);
    for (const control of document.querySelectorAll("a[href],button")) {
      if (!control.getClientRects().length) continue;
      const name = control.getAttribute("aria-label") || control.textContent.trim();
      if (!name) issues.push(`unnamed control: ${control.outerHTML.slice(0, 80)}`);
    }
    const parse = value => (value.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => { const c = [r, g, b].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
    const bg = node => { for (let n = node; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] >= .9)) return c; } return [255, 255, 255]; };
    for (const node of document.querySelectorAll("body *")) {
      if (!node.getClientRects().length || ["SCRIPT", "STYLE"].includes(node.tagName)) continue;
      if (![...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim())) continue;
      const style = getComputedStyle(node);
      if (style.visibility === "hidden" || node.closest("[aria-hidden='true'], .skip")) continue;
      const a = lum(parse(style.color)), b = lum(bg(node));
      const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) issues.push(`contrast ${ratio.toFixed(2)}: ${node.tagName}.${node.className} "${node.textContent.trim().slice(0, 30)}"`);
    }
    return issues;
  });
}

test("Discover V3 renders, stays accessible and works offline at every width", async t => {
  const { server, base } = await startServer(); const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  for (const width of [320, 390, 768, 1024, 1440]) await t.test(`${width}px`, async () => {
    const { context, page, external, errors, missing } = await open(browser, base, { width });
    try {
      const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
      assert.ok(size.scroll <= size.viewport + 1, `no horizontal overflow at ${width}px`);
      await page.evaluate(() => document.querySelectorAll(".reveal").forEach(node => node.classList.add("is-in")));
      await page.waitForTimeout(800);
      assert.deepEqual(await audit(page), [], `automated accessibility checks at ${width}px`);
      const cta = page.locator("[data-primary-cta]");
      assert.equal(await cta.getAttribute("href"), "../?lang=es");
      const box = await cta.boundingBox();
      assert.ok(box.y + box.height <= (width <= 420 ? 844 : 900), "primary CTA is visible in the first viewport");
      assert.equal(await page.locator(".hero-plate img").evaluate(img => img.complete && img.naturalWidth > 0), true, "authentic hero capture loads");
      assert.deepEqual(external, [], "no third-party request is attempted");
      assert.deepEqual(missing, [], "no missing asset");
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
});

test("Mode viewer is a keyboard-operable tab set over real captures", async t => {
  const { server, base } = await startServer(); const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const { context, page, errors } = await open(browser, base, { width: 1440 }); t.after(() => context.close());
  const visible = () => page.locator(".panel").evaluateAll(panels => panels.filter(p => getComputedStyle(p).visibility === "visible").map(p => p.dataset.panel));
  assert.deepEqual(await visible(), ["place"]);
  await page.locator("#tab-place").focus(); await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#tab-compare").getAttribute("aria-selected"), "true");
  assert.equal(await page.evaluate(() => document.activeElement.id), "tab-compare", "focus follows selection");
  await page.waitForTimeout(800);
  assert.deepEqual(await visible(), ["compare"], "outgoing panel is hidden once the transition ends");
  await page.keyboard.press("End"); assert.equal(await page.locator("#tab-city").getAttribute("aria-selected"), "true");
  await page.keyboard.press("Home"); assert.equal(await page.locator("#tab-place").getAttribute("aria-selected"), "true");
  await page.locator("#tab-city").click(); await page.waitForTimeout(800);
  assert.deepEqual(await visible(), ["city"]);
  for (const mode of ["place", "compare", "city"]) {
    assert.equal(await page.locator(`#panel-${mode} .marker`).count(), 3, `${mode}: three numbered callouts`);
    assert.equal(await page.locator(`#panel-${mode} .legend li`).count(), 3, `${mode}: three legend entries`);
    assert.equal(await page.locator(`#panel-${mode} img`).evaluate(img => img.complete && img.naturalWidth > 0), true, `${mode} capture loads`);
  }
  assert.deepEqual(errors, []);
});

test("Language: switch, persistence, URL parameter and localized app links", async t => {
  const { server, base } = await startServer(); const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const { context, page, errors } = await open(browser, base, { width: 390 }); t.after(() => context.close());
  assert.equal(await page.locator("html").getAttribute("lang"), "es");
  await page.locator('[data-lang="en"]').click();
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  assert.match(await page.locator("#heroTitle").textContent(), /beyond/);
  assert.equal(await page.locator('[data-lang="en"]').getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("[data-primary-cta]").getAttribute("href"), "../?lang=en");
  assert.match(await page.locator("[data-reading-link]").getAttribute("href"), /&lg=en$/);
  assert.match(await page.locator("[data-case-link]").getAttribute("href"), /^\.\.\/\?lang=en&journey=yeserias.*&lg=en$/);
  assert.equal(await page.locator(".hero-plate img").getAttribute("alt"), "Detail of a real Lens capture in COMPARE mode: two analysis circles over central Madrid, Lens A in Los Jerónimos and Lens B in Imperial.");
  await page.reload({ waitUntil: "load" });
  assert.equal(await page.locator("html").getAttribute("lang"), "en", "choice persists across reloads");
  await page.locator('[data-lang="es"]').click();
  assert.match(await page.locator("#heroTitle").textContent(), /más allá/);
  assert.equal(await page.locator(".hero-plate img").getAttribute("alt"), await page.locator(".hero-plate img").evaluate(img => img.dataset.esalt));
  const english = await open(browser, base, { width: 1440, locale: "en-GB" }); t.after(() => english.context.close());
  assert.equal(await english.page.locator("html").getAttribute("lang"), "en", "English browsers start in English");
  const forced = await open(browser, base, { width: 1440, locale: "en-GB", query: "?lang=es" }); t.after(() => forced.context.close());
  assert.equal(await forced.page.locator("html").getAttribute("lang"), "es", "?lang= wins over the browser language");
  assert.deepEqual(errors, []);
});

test("Reduced motion: content is static and immediately readable", async t => {
  const { server, base } = await startServer(); const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const { context, page, errors } = await open(browser, base, { width: 390, reducedMotion: "reduce" }); t.after(() => context.close());
  const state = await page.evaluate(() => ({
    animated: [...document.querySelectorAll("*")].filter(node => getComputedStyle(node).animationName !== "none").length,
    heading: getComputedStyle(document.querySelector("#heroTitle .line > span")).transform,
    hidden: [...document.querySelectorAll(".reveal")].filter(node => getComputedStyle(node).opacity !== "1").length,
  }));
  assert.equal(state.animated, 0, "no CSS animation runs");
  assert.equal(state.heading, "none", "headline is in its final position");
  assert.equal(state.hidden, 0, "no section waits for a scroll reveal");
  await page.locator("#tab-compare").click();
  assert.equal(await page.locator("#panel-place").evaluate(p => getComputedStyle(p).visibility), "hidden", "mode change is instant");
  assert.deepEqual(errors, []);
});
