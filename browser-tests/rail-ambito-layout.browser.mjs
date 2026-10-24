import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Mobile PLACE layout regression: the full-width "Planning ámbito" rail row.
//
// Its instance is a sentence (the explicit absence, "The Lens circle touches no
// official planning ámbito."). The app declares `Inter` first but ships no webfont,
// so on a machine without it (the GitHub runner, many phones) a wider fallback face
// renders it and the sentence wraps. Stacked under its own label that wrap cost a
// whole extra row and pushed #placeCircleSummary from 240.75px to 255.14px at
// 390x844, past the 250px bound IA 22 asserts. This file reproduces that with a
// forced wide fallback face at the rail's terminal state (barrio and ámbito
// resolved, registry loaded, fonts loaded - awaited, never slept on) and asserts
// the layout contract. IA 22 itself and its 250px bound are untouched.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".css": "text/css; charset=utf-8", ".geojson": "application/geo+json; charset=utf-8", ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml",
};
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const target = path.resolve(ROOT, relative);
  if (!target.startsWith(`${ROOT}${path.sep}`) && target !== path.join(ROOT, "index.html")) { response.writeHead(403).end("Forbidden"); return; }
  fs.readFile(target, (error, content) => {
    if (error) { response.writeHead(404).end("Not found"); return; }
    response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
    response.end(content);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });
test.after(async () => { await browser.close(); server.close(); });

const WIDE_FALLBACK = '*{font-family:"DejaVu Sans","Bitstream Vera Sans",Verdana,sans-serif !important}';

async function openTerminal({ width, height = 844, language = "en", wideFont = true, touch = false }) {
  const context = await browser.newContext({ viewport: { width, height }, ...(touch ? { hasTouch: true, isMobile: true } : {}) });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === "127.0.0.1" || host === "localhost" ? route.continue() : route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__));
  if (wideFont) await page.addStyleTag({ content: WIDE_FALLBACK });
  if (language !== "en") {
    await page.selectOption("#languageSelect", language);
    await page.waitForFunction((code) => document.documentElement.lang === code, language);
  }
  // Terminal rail state: registry loaded, barrio and ámbito resolved (no
  // "locating…" left), fonts loaded.
  await page.waitForFunction(() => window.__HALO_REGRESSION__.registryReady()
    && !/locating…|localizando…/i.test(document.getElementById("scopeRailList").textContent)
    && document.fonts.status === "loaded");
  return { page, context };
}

const measure = (page) => page.evaluate(() => {
  const panelTop = document.getElementById("analysisPanel").getBoundingClientRect().top;
  const li = document.querySelector('#scopeRailList li[data-scope="PLANNING_AMBITO"]');
  const button = li.querySelector("button");
  const name = li.querySelector(".scope-name");
  const instance = li.querySelector(".scope-instance");
  // Per-line boxes of the text itself (a block's own rect would hide the wrap).
  const lineRects = (node) => { const range = document.createRange(); range.selectNodeContents(node); return [...range.getClientRects()].filter((rect) => rect.width > 0); };
  const lineCount = (node) => new Set(lineRects(node).map((rect) => Math.round(rect.top))).size;
  return {
    summaryTop: document.getElementById("placeCircleSummary").getBoundingClientRect().top - panelTop,
    buttonHeight: button.getBoundingClientRect().height,
    nameTop: name.getBoundingClientRect().top,
    instanceFirstLineTop: lineRects(instance)[0].top,
    instanceLines: lineCount(instance),
    nameText: name.textContent.trim(),
    instanceText: instance.textContent.trim(),
    buttonText: button.textContent.replace(/\s+/g, " ").trim(),
    chips: [...document.querySelectorAll("#placeJump .place-jump-chip")].map((chip) => chip.getBoundingClientRect().height),
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});

for (const width of [360, 390]) {
  test(`${width}px EN: wide fallback face, terminal rail state - summary stays under IA 22's 250px bound`, async () => {
    const { page, context } = await openTerminal({ width });
    try {
      const m = await measure(page);
      assert.ok(m.instanceLines >= 2, `precondition: the ámbito sentence wraps with the wide face (lines ${m.instanceLines})`);
      assert.ok(m.summaryTop < 250, `summary top ${m.summaryTop}px must be < 250px`);
      assert.ok(Math.abs(m.nameTop - m.instanceFirstLineTop) < 6, "the label runs in on the first line of the sentence");
      assert.equal(m.overflowX, 0, "no horizontal overflow");
    } finally { await context.close(); }
  });
}

test("390px ES: the wrapped Spanish sentence shares its first line with the label and the rail adds no stacked label row", async () => {
  const { page, context } = await openTerminal({ width: 390, language: "es" });
  try {
    const m = await measure(page);
    assert.ok(m.instanceLines >= 2);
    assert.ok(Math.abs(m.nameTop - m.instanceFirstLineTop) < 6);
    assert.ok(m.summaryTop < 250, `ES summary top ${m.summaryTop}px must be < 250px`);
  } finally { await context.close(); }
});

test("all geographic/provenance text of the ámbito row is still rendered, in EN and ES", async () => {
  for (const [language, label, sentence] of [
    ["en", /planning ámbito/i, /The Lens circle touches no official planning ámbito\./],
    ["es", /ámbito de planeamiento/i, /El círculo de Lente no toca ningún ámbito oficial de planeamiento\./],
  ]) {
    const { page, context } = await openTerminal({ width: 390, language });
    try {
      const m = await measure(page);
      assert.match(m.nameText, label);
      assert.match(m.instanceText, sentence);
      assert.match(m.buttonText, sentence);
    } finally { await context.close(); }
  }
});

test("touch targets: the ámbito row and the quick-jump chips keep their 44px minimum on a coarse pointer", async () => {
  const { page, context } = await openTerminal({ width: 390, touch: true });
  try {
    const m = await measure(page);
    assert.ok(m.buttonHeight >= 43.99, `ámbito button ${m.buttonHeight}px`);
    assert.ok(m.chips.length >= 2 && m.chips.every((h) => h >= 43.99), `chips ${m.chips}`);
    const rail = await page.evaluate(() => [...document.querySelectorAll("#scopeRailList button, #scopeRailFreshness")].map((b) => b.getBoundingClientRect().height));
    assert.ok(rail.every((h) => h >= 43.99), `rail targets ${rail}`);
  } finally { await context.close(); }
});

test("wider layouts keep the stacked label above the instance (tablet and desktop unchanged)", async () => {
  for (const [width, height] of [[768, 1024], [1366, 900]]) {
    const { page, context } = await openTerminal({ width, height });
    try {
      const m = await measure(page);
      assert.ok(m.nameTop < m.instanceFirstLineTop - 6, `${width}px: label stays above the instance`);
    } finally { await context.close(); }
  }
});

test("the native face (no forced fallback) still satisfies the same contract", async () => {
  const { page, context } = await openTerminal({ width: 390, wideFont: false });
  try {
    const m = await measure(page);
    assert.ok(m.summaryTop < 250, `native face summary top ${m.summaryTop}px`);
  } finally { await context.close(); }
});
