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
  fs.readFile(target, (error, content) => {
    if (error) return response.writeHead(404).end();
    response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
    response.end(content);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });

async function openApp(width, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: width <= 560 ? 760 : 900 }, ...options });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === "127.0.0.1" || host === "localhost" ? route.continue() : route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__));
  await page.waitForFunction(() => /Reference ·|Referencia ·/.test(document.getElementById("scopeRailFreshness").textContent));
  page.context_ = context;
  return page;
}
const closePage = (page) => page.context_.close();
const setMode = async (page, mode) => {
  await page.locator(`.mode-btn[data-mode="${mode}"]`).click();
  await page.waitForFunction((value) => document.getElementById("analysisPanel").dataset.mode === value, mode);
  await page.evaluate(() => document.querySelectorAll("details").forEach((node) => { node.open = true; }));
};

const auditVisibleText = (page) => page.evaluate(() => {
  const excluded = "svg,svg *,.leaflet-control,.leaflet-control *,.leaflet-tooltip,.leaflet-tooltip *,option,script,style,.sr-only,.sr-only *";
  const parse = (value) => {
    const match = value.match(/rgba?\(([^)]+)\)/);
    if (!match) return [0, 0, 0, 0];
    const parts = match[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  };
  const over = (front, back) => {
    const alpha = front[3] + back[3] * (1 - front[3]);
    if (!alpha) return [0, 0, 0, 0];
    return [0, 1, 2].map((i) => (front[i] * front[3] + back[i] * back[3] * (1 - front[3])) / alpha).concat(alpha);
  };
  const luminance = (rgb) => {
    const channel = rgb.slice(0, 3).map((v) => { const x = v / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; });
    return .2126 * channel[0] + .7152 * channel[1] + .0722 * channel[2];
  };
  const ratio = (a, b) => { const l1 = luminance(a); const l2 = luminance(b); return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05); };
  const visible = (node) => {
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && box.width > 0 && box.height > 0;
  };
  const background = (node) => {
    const chain = [];
    for (let current = node; current; current = current.parentElement) chain.push(current);
    let result = [8, 16, 26, 1]; // product-owned map/body fallback under translucent chrome
    for (const current of chain.reverse()) result = over(parse(getComputedStyle(current).backgroundColor), result);
    return result;
  };
  const textParents = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (text.textContent.trim()) textParents.add(text.parentElement);
  }
  const rows = [];
  for (const node of textParents) {
    if (!node || node.matches(excluded) || !visible(node)) continue;
    const style = getComputedStyle(node);
    const size = parseFloat(style.fontSize);
    const bg = background(node);
    let opacity = 1;
    for (let current = node; current; current = current.parentElement) opacity *= Number(getComputedStyle(current).opacity);
    const fg = over([...parse(style.color).slice(0, 3), parse(style.color)[3] * opacity], bg);
    const contrast = ratio(fg, bg);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    rows.push({
      tag: node.tagName.toLowerCase(), id: node.id, cls: String(node.className).slice(0, 80),
      text: node.textContent.trim().replace(/\s+/g, " ").slice(0, 90), size, contrast, required: large ? 3 : 4.5,
      fg: style.color, bg: bg.slice(0, 3).map(Math.round).join(","), opacity,
      parent: `${node.parentElement?.tagName}.${node.parentElement?.className}`.slice(0, 100),
    });
  }
  return rows;
});

for (const width of [360, 420, 560, 850, 1100, 1440]) {
  test(`K5 computed type floor and AA contrast hold at ${width}px`, async (t) => {
    const page = await openApp(width);
    t.after(() => closePage(page));
    const rows = [];
    for (const mode of ["PLACE", "COMPARE", "CITY"]) {
      await setMode(page, mode);
      rows.push(...await auditVisibleText(page));
      await page.locator(`[data-evidence-mode="${mode}"]`).click();
      rows.push(...await auditVisibleText(page));
      await page.keyboard.press("Escape");
    }
    const minimumSize = Math.min(...rows.map((row) => row.size));
    const minimumContrast = Math.min(...rows.map((row) => row.contrast));
    const sizeFailures = rows.filter((row) => row.size < 10);
    const contrastFailures = rows.filter((row) => row.contrast + .01 < row.required);
    assert.ok(minimumSize >= 10, JSON.stringify(sizeFailures.slice(0, 20), null, 2));
    assert.equal(contrastFailures.length, 0, `contrast failures (${contrastFailures.length}; first 20):\n${JSON.stringify(contrastFailures.slice(0, 20), null, 2)}`);
    t.diagnostic(`width=${width}; visible text nodes=${rows.length}; min-size=${minimumSize.toFixed(2)}px; min-contrast=${minimumContrast.toFixed(2)}:1`);
  });
}

test("K5 every visible application-owned interactive has a 44px coarse-pointer target", async (t) => {
  const page = await openApp(1100, { hasTouch: true, isMobile: false });
  t.after(() => closePage(page));
  const failures = [];
  for (const mode of ["PLACE", "COMPARE", "CITY"]) {
    await setMode(page, mode);
    for (const drawer of [false, true]) {
      if (drawer) await page.locator(`[data-evidence-mode="${mode}"]`).click();
      failures.push(...await page.evaluate(() => {
        const visible = (node) => { const s = getComputedStyle(node); const b = node.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0 && b.width > 0 && b.height > 0; };
        return [...document.querySelectorAll('button,select,input,summary,a[href],[role="button"]')]
          .filter((node) => visible(node) && !node.closest(".leaflet-control") && !node.closest("svg"))
          .map((node) => {
            const target = node.matches(".switch input,.halo-toggle input") ? node.closest("label") : node;
            const box = target.getBoundingClientRect();
            return { node: `${node.tagName.toLowerCase()}#${node.id}.${node.className}`, width: box.width, height: box.height };
          }).filter((item) => item.width < 43.5 || item.height < 43.5);
      }));
      if (drawer) await page.keyboard.press("Escape");
    }
  }
  assert.deepEqual(failures, []);
});

test("K5 representative controls expose a rendered high-contrast focus indicator", async (t) => {
  const page = await openApp(1100);
  t.after(() => closePage(page));
  await setMode(page, "COMPARE");
  await page.keyboard.press("Tab"); // establish keyboard focus modality
  const baseSelectors = [
    ".mode-btn", ".scope-rail-item", ".scope-rail-freshness", ".evidence-route", ".detail-disclosure>summary",
    ".layer-action", ".header-tools select", ".basemap-control select", ".switch input", "#radiusSlider",
    "#resetButton", ".cmp-metric-focus", ".ss-button",
  ];
  const assertIndicators = async (selectors) => {
   for (const selector of selectors) {
    const node = page.locator(`${selector}:visible`).first();
    if (await node.count() === 0) continue;
    await node.focus();
    const indicator = await node.evaluate((element) => {
      const candidates = [element, element.nextElementSibling, element.closest(".hospitality-select-wrap")].filter(Boolean);
      return candidates.some((candidate) => {
        const style = getComputedStyle(candidate);
        return (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2) || style.boxShadow !== "none" || style.filter !== "none";
      });
    });
    assert.equal(indicator, true, `${selector} has no rendered focus treatment`);
   }
  };
  await assertIndicators(baseSelectors);
  await page.locator('[data-evidence-mode="COMPARE"]').click();
  await page.keyboard.press("Tab");
  await assertIndicators([".drawer-close", ".reading-btn", "#drawerSources a[href]"]);
});

test("K5 reduced-motion preference suppresses retained non-essential movement", async (t) => {
  const page = await openApp(1100, { reducedMotion: "reduce" });
  t.after(() => closePage(page));
  const durations = await page.evaluate(() => [...document.querySelectorAll("body *")].flatMap((node) => {
    const style = getComputedStyle(node);
    return [style.transitionDuration, style.animationDuration].flatMap((value) => value.split(",")).map((value) => value.trim());
  }));
  const milliseconds = durations.map((value) => value.endsWith("ms") ? parseFloat(value) : parseFloat(value) * 1000).filter(Number.isFinite);
  assert.ok(milliseconds.every((value) => value <= .011), `retained duration: ${Math.max(...milliseconds)}ms`);
});

test("K5 phase fixture is categorical, non-ordinal and distinguishable in greyscale", async (t) => {
  const context = await browser.newContext({ viewport: { width: 900, height: 500 }, colorScheme: "dark" });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/browser-tests/fixtures/phase-categories.html`);
  const phase = await page.locator(".state:not(.no-necesita):not(.origin)").evaluateAll((nodes) => nodes.map((node) => ({
    text: node.textContent.trim(), border: getComputedStyle(node).borderTopStyle, glyph: getComputedStyle(node, "::before").content,
  })));
  assert.deepEqual(phase.map((item) => item.border), ["dotted", "dashed", "double", "solid"]);
  assert.equal(new Set(phase.map((item) => item.glyph)).size, 4);
  assert.doesNotMatch(phase.map((item) => item.text).join(" "), /\b(?:1|2|3|4|next|progress|complete|success|failure)\b/i);
  const noNecesita = await page.locator(".no-necesita").evaluate((node) => ({ outline: getComputedStyle(node).outlineStyle, glyph: getComputedStyle(node, "::before").content }));
  assert.equal(noNecesita.outline, "solid");
  assert.equal(noNecesita.glyph, '"—"');
  const origin = await page.locator(".origin").evaluate((node) => ({ left: getComputedStyle(node).borderLeftWidth, right: getComputedStyle(node).borderRightWidth, glyph: getComputedStyle(node, "::before").content }));
  assert.equal(origin.left, "7px");
  assert.equal(origin.right, "7px");
  assert.equal(origin.glyph, '"◆"');
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});
