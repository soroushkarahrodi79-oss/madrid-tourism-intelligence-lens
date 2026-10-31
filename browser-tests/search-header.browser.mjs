// Civic Search V2 (package 2-4): the three-zone header, the search field's
// visual and accessible states, and the responsive matrix.
//
// search-surface.browser.mjs owns the open/close interaction contract. This
// suite owns geometry (nothing overlaps, in any language or width), the field's
// accessible name and states, reduced motion, appearance tokens, and the
// visibility of a stale Question Explorer answer after a dismissal.
// GEOSEARCH_BROWSER=webkit selects Safari's engine; SEARCH_SURFACE_CAPTURE_DIR
// writes the evidence screenshots.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";

const ROOT = process.env.GEOSEARCH_ROOT
  ? path.resolve(process.env.GEOSEARCH_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = process.env.GEOSEARCH_BROWSER === "webkit" ? webkit : chromium;
const CAPTURE_DIR = process.env.SEARCH_SURFACE_CAPTURE_DIR || null;
const MIME = { ".css": "text/css", ".geojson": "application/geo+json", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const target = path.resolve(ROOT, pathname === "/" ? "index.html" : pathname.slice(1));
  if (!target.startsWith(`${ROOT}${path.sep}`) && target !== path.join(ROOT, "index.html")) return response.writeHead(403).end();
  fs.readFile(target, (error, content) => (error
    ? response.writeHead(404).end()
    : response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" }).end(content)));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const browser = await ENGINE.launch({ headless: true });

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

// Looping tests create many pages. WebKit closes the whole browser when dozens
// of contexts stay open at once, so only the most recent one is kept alive.
let openContext = null;
async function track(context, t) {
  if (openContext) await openContext.close().catch(() => {});
  openContext = context;
  t.after(() => context.close().catch(() => {}));
}

async function pageFor({ viewport = { width: 1280, height: 900 }, colorScheme = "light", language = "en", appearance = null, reducedMotion = "no-preference", touch = false } = {}) {
  const context = await browser.newContext({ viewport, colorScheme, reducedMotion, ...(touch ? { hasTouch: true, isMobile: true } : {}) });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error.message)));
  await page.route("**/*", (route) => (new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort()));
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const api = window.__GEO_SEARCH_TEST__;
    if (!api) return false;
    const status = api.snapshot().universeStatus;
    return status.administrative !== "loading" && status.ambito !== "loading";
  });
  await page.evaluate(() => window.__QUESTION_EXPLORER_TEST__.whenReady());
  await page.waitForFunction(() => document.querySelector("#geoSearchPanel").dataset.questionExplorer === "ready");
  if (language !== "en") await page.selectOption("#languageSelect", language);
  if (appearance) await page.selectOption("#appearanceSelect", appearance);
  await page.waitForTimeout(120);
  return { page, context, errors };
}

async function capture(page, name) {
  if (!CAPTURE_DIR) return;
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(CAPTURE_DIR, `${name}.png`) });
}

const geometry = (page) => page.evaluate(() => {
  const box = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
  const panel = document.querySelector("#geoSearchPanel");
  const header = document.querySelector("header");
  const input = document.querySelector("#geoSearchQuery");
  const toggle = document.querySelector("#geoSearchToggle");
  const visible = (node) => node && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden";
  return {
    presentation: panel.dataset.presentation,
    header: box(header),
    brand: box(document.querySelector(".brand")),
    tools: box(document.querySelector(".header-tools")),
    field: visible(input) ? box(input) : null,
    toggle: visible(toggle) ? box(toggle) : null,
    surface: box(document.querySelector(".geo-search-surface")),
    analysis: box(document.querySelector("#analysisPanel")),
    zoom: box(document.querySelector(".leaflet-control-zoom")),
    rail: box(document.querySelector("#layerRail")),
    attribution: box(document.querySelector(".leaflet-control-attribution")),
    gap: Number.parseFloat(getComputedStyle(header).columnGap) || 12,
    pageOverflow: document.documentElement.scrollWidth - innerWidth,
  };
});

const overlaps = (a, b) => a && b && a.width > 0 && b.width > 0 && !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);

// ------------------------------------------------------ three-zone header

test("the header is three zones: the field never overlaps brand or tools, and is centred whenever there is room", async (t) => {
  for (const language of ["en", "es"]) {
    for (const width of [1100, 1200, 1280, 1366, 1440, 1536, 1920]) {
      const { page, context, errors } = await pageFor({ viewport: { width, height: 900 }, language });
      await track(context, t);
      const g = await geometry(page);
      const label = `${language}/${width}`;
      assert.ok(g.pageOverflow <= 0, `${label}: no horizontal page overflow`);
      if (g.presentation !== "inline") { assert.ok(g.toggle, `${label}: compact activator is visible`); continue; }
      assert.ok(g.field.width >= 260 && g.field.width <= 480.5, `${label}: field width ${g.field.width} stays in 260-480`);
      assert.ok(g.field.left >= g.brand.right + g.gap - 0.5, `${label}: clears the brand`);
      assert.ok(g.field.right <= g.tools.left - g.gap + 0.5, `${label}: clears the tools`);
      assert.ok(g.header.height < 80, `${label}: the header stays one row`);
      const innerLeft = g.header.left + 9, innerRight = g.header.right - 9;
      const symmetric = 2 * Math.max(g.brand.width, g.tools.width) + g.field.width + 2 * g.gap <= innerRight - innerLeft;
      // The three-zone grid applies above 1100px; below it the shrinkable flex layout is kept.
      if (symmetric && width > 1100) {
        const headerCentre = (g.header.left + g.header.right) / 2;
        assert.ok(Math.abs((g.field.left + g.field.right) / 2 - headerCentre) <= 2, `${label}: centred when both sides fit`);
      }
      assert.deepEqual(errors, []);
      if (width === 1440 || width === 1280) await capture(page, `header-${language}-${width}`);
    }
  }
});

test("a resize is correct on its first frame: no overlap, no stale surface geometry", async (t) => {
  const { page, context } = await pageFor({ viewport: { width: 1536, height: 864 } });
  await track(context, t);
  await page.locator("#geoSearchQuery").click();
  for (const width of [1280, 1100, 1440, 1536]) {
    await page.setViewportSize({ width, height: 864 });
    // Read in the same task, before any later frame or timer can repair it.
    const g = await geometry(page);
    if (g.field) {
      assert.ok(g.field.right <= g.tools.left - g.gap + 0.5, `${width}: no overlap in the first frame`);
      assert.ok(g.field.left >= g.brand.right + g.gap - 0.5, `${width}: clears the brand in the first frame`);
    }
    await page.waitForFunction((w) => innerWidth === w, width);
  }
  await page.waitForTimeout(100);
  const leftover = await page.evaluate(() => ({
    surface: document.documentElement.style.getPropertyValue("--geo-search-inline-surface-width"),
    top: document.documentElement.style.getPropertyValue("--geo-search-inline-surface-top"),
    left: document.documentElement.style.getPropertyValue("--geo-search-left"),
  }));
  assert.equal(leftover.top, "", "the measured surface offset no longer exists");
  assert.equal(leftover.left, "", "no corridor offset is left behind");
});

test("the open surface hangs from the field, stays inside the corridor and covers no map control", async (t) => {
  for (const language of ["en", "es"]) {
    for (const width of [1280, 1440, 1536]) {
      const { page, context } = await pageFor({ viewport: { width, height: 900 }, language });
      await track(context, t);
      await page.locator("#geoSearchQuery").click();
      await page.keyboard.type("Palacio");
      await page.waitForFunction(() => document.querySelectorAll("#geoSearchResults button").length > 0);
      const g = await geometry(page);
      const label = `${language}/${width}`;
      if (g.presentation !== "inline") continue;
      assert.ok(g.surface.top >= g.header.bottom + 8, `${label}: the surface starts below the header`);
      assert.ok(Math.abs(g.surface.left - g.field.left) <= 1, `${label}: the surface is aligned to the field`);
      assert.ok(g.surface.width <= g.field.width + 1, `${label}: the surface is no wider than the field`);
      assert.ok(g.surface.right <= g.analysis.left - 8, `${label}: the surface stops before the analysis panel`);
      for (const part of ["zoom", "rail", "attribution"]) assert.equal(overlaps(g.surface, g[part]), false, `${label}: the surface does not cover ${part}`);
      if (width === 1440) await capture(page, `surface-${language}-${width}`);
    }
  }
});

// ------------------------------------------------- responsive matrix

const MATRIX = [[320, 700], [390, 844], [430, 932], [768, 1024], [850, 900], [851, 900], [1024, 768], [1280, 800], [1440, 900], [1536, 864]];

test("every approved viewport keeps search reachable, 44px, overflow-free and operable, in EN and ES", async (t) => {
  for (const language of ["en", "es"]) {
    for (const [width, height] of MATRIX) {
      const { page, context } = await pageFor({ viewport: { width, height }, language });
      await track(context, t);
      const g = await geometry(page);
      const label = `${language}/${width}x${height}`;
      assert.ok(g.pageOverflow <= 0, `${label}: no horizontal overflow`);
      const control = g.field || g.toggle;
      assert.ok(control, `${label}: search is reachable`);
      assert.ok(control.height >= 43.5 && control.width >= 43.5, `${label}: control is at least 44px`);
      assert.ok(control.left >= -0.5 && control.right <= width + 0.5, `${label}: control is inside the viewport`);
      if (g.field) {
        assert.equal(overlaps(g.field, g.tools), false, `${label}: field vs tools`);
        assert.equal(overlaps(g.field, g.brand), false, `${label}: field vs brand`);
      }
      // Operable: open, then dismiss with Escape, then nothing is left open.
      if (g.field) await page.locator("#geoSearchQuery").click(); else await page.locator("#geoSearchToggle").click();
      assert.equal(await page.locator("#geoSearchPanel").getAttribute("data-open"), "true", `${label}: opens`);
      const open = await geometry(page);
      assert.ok(open.pageOverflow <= 0, `${label}: opening adds no overflow`);
      const surface = open.surface;
      const panel = await page.locator("#geoSearchPanel").boundingBox();
      const shown = open.presentation === "inline" ? surface : panel;
      const shownLeft = shown.left ?? shown.x;
      const shownRight = shown.right ?? shown.x + shown.width;
      assert.ok(shownLeft >= -0.5 && shownRight <= width + 0.5, `${label}: the open surface is inside the viewport ${JSON.stringify(shown)}`);
      // Focus reaches the field on the next frame (WebKit needs layout first); a key pressed earlier would go to the page.
      await page.waitForFunction(() => document.activeElement && document.activeElement.id === "geoSearchQuery");
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#geoSearchPanel").getAttribute("data-open"), "false", `${label}: Escape closes`);
      if (width === 320 || width === 390 || width === 768 || width === 1280) await capture(page, `matrix-${language}-${width}`);
    }
  }
});

// ------------------------------------------------------- appearance

function luminance(rgb) {
  const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

for (const appearance of ["light", "dark", "system"]) {
  for (const language of ["en", "es"]) {
    test(`${appearance}/${language}: the field, placeholder, key hint and surface are legible and token-driven`, async (t) => {
      const scheme = appearance === "dark" ? "dark" : "light";
      const { page, context } = await pageFor({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, appearance, language });
      await track(context, t);
      const read = () => page.evaluate(() => {
        const rgb = (value) => (value.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
        const input = document.querySelector("#geoSearchQuery");
        const field = getComputedStyle(input);
        return {
          text: rgb(field.color), background: rgb(field.backgroundColor), placeholder: rgb(getComputedStyle(input, "::placeholder").color),
          icon: rgb(getComputedStyle(document.querySelector(".geo-search-icon")).color),
          hintDisplay: getComputedStyle(document.querySelector(".geo-search-hint")).display,
          appearance: document.documentElement.dataset.appearance,
        };
      });
      const idle = await read();
      assert.equal(idle.background[3] ?? 1, 1, "the field background is opaque, so contrast is well defined");
      assert.ok(contrast(idle.text, idle.background) >= 4.5, "typed text meets 4.5:1");
      assert.ok(contrast(idle.placeholder, idle.background) >= 4.5, `placeholder meets 4.5:1 (${contrast(idle.placeholder, idle.background).toFixed(2)})`);
      assert.ok(contrast(idle.icon, idle.background) >= 3, "the magnifier meets 3:1 as a graphical object");
      assert.equal(idle.hintDisplay, "block", "the / hint is offered at idle on a fine pointer");
      await page.locator("#geoSearchQuery").click();
      assert.equal((await read()).hintDisplay, "none", "the hint steps aside once the field is active");
      const surface = await page.locator(".geo-search-surface").evaluate((node) => getComputedStyle(node).backgroundColor);
      assert.notEqual(surface, "rgba(0, 0, 0, 0)", "the surface has its own panel surface");
      if (language === "en") await capture(page, `appearance-${appearance}-open`);
    });
  }
}

// ------------------------------------------------------- accessibility

test("the one input has an accessible name, shortcut and described status in both presentations", async (t) => {
  for (const [width, label] of [[1440, "inline"], [768, "compact"]]) {
    for (const language of ["en", "es"]) {
      const { page, context } = await pageFor({ viewport: { width, height: 900 }, language });
      await track(context, t);
      if (label === "compact") await page.locator("#geoSearchToggle").click(); else await page.locator("#geoSearchQuery").click();
      const input = page.locator("#geoSearchQuery");
      const name = await input.evaluate((node) => (node.getAttribute("aria-label") || (node.labels && [...node.labels].map((l) => l.textContent).join(" ")) || "").trim());
      assert.ok(name.length > 3, `${label}/${language}: the input is named (${JSON.stringify(name)})`);
      assert.equal(await input.getAttribute("aria-keyshortcuts"), "/");
      assert.equal(await input.getAttribute("type"), "search");
      assert.equal(await page.locator(".geo-search-icon").getAttribute("aria-hidden"), "true");
      assert.equal(await page.locator(".geo-search-hint").getAttribute("aria-hidden"), "true");
      assert.equal(await page.locator("#geoSearchStatus").getAttribute("aria-live"), "polite");
      assert.match(await page.locator("#geoSearchStatus").textContent(), /\S/, `${label}/${language}: the status announces the open surface`);
      assert.ok((await input.getAttribute("aria-describedby")).includes("geoSearchStatus"));
      const role = await page.getByRole("searchbox").first().count();
      assert.equal(role, 1, `${label}/${language}: exposed as a searchbox`);
    }
  }
});

test("focus handling: opening keeps focus in the field, results are reachable, every dismissal returns it", async (t) => {
  const { page, context } = await pageFor({ viewport: { width: 1440, height: 900 } });
  await track(context, t);
  const active = () => page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.className));
  await page.keyboard.press("Tab");
  await page.locator("#geoSearchQuery").focus();
  assert.equal(await page.locator("#geoSearchPanel").getAttribute("data-open"), "true", "keyboard focus opens the surface");
  assert.equal(await active(), "geoSearchQuery");
  await page.keyboard.type("Palacio");
  await page.waitForFunction(() => document.querySelectorAll("#geoSearchResults button").length > 0);
  assert.equal(await active(), "geoSearchQuery", "typing never moves focus");
  await page.keyboard.press("ArrowDown");
  assert.match(await page.evaluate(() => document.activeElement.className), /geo-search-result/);
  await page.keyboard.press("ArrowUp");
  assert.equal(await active(), "geoSearchQuery");
  await page.keyboard.press("Escape");
  assert.equal(await active(), "geoSearchQuery", "Escape returns focus to the field");
  assert.equal(await page.locator("#geoSearchPanel").getAttribute("data-open"), "false");
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.locator("#geoSearchPanel").getAttribute("data-open"), "true", "ArrowDown reopens it from the keyboard");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#geoSearchPanel").getAttribute("data-open"), "false");
});

test("reduced motion removes the surface animation; otherwise it is a short, single entrance", async (t) => {
  for (const [reducedMotion, expectAnimation] of [["reduce", false], ["no-preference", true]]) {
    const { page, context } = await pageFor({ viewport: { width: 1440, height: 900 }, reducedMotion });
    await track(context, t);
    await page.locator("#geoSearchQuery").click();
    const style = await page.locator(".geo-search-surface").evaluate((node) => { const s = getComputedStyle(node); return { name: s.animationName, duration: s.animationDuration }; });
    if (expectAnimation) {
      assert.equal(style.name, "geo-search-surface-in");
      assert.ok(Number.parseFloat(style.duration) <= 0.2, "the entrance is at most 200ms");
    } else assert.equal(style.name, "none", "no animation under reduced motion");
  }
});

test("touch: the activator is 44px and the keyboard hint is not shown on a coarse pointer", async (t) => {
  const { page, context } = await pageFor({ viewport: { width: 390, height: 844 }, touch: true });
  await track(context, t);
  const toggle = await page.locator("#geoSearchToggle").boundingBox();
  assert.ok(toggle.width >= 43.5 && toggle.height >= 43.5);
  await page.locator("#geoSearchToggle").tap();
  assert.equal(await page.locator("#geoSearchPanel").getAttribute("data-open"), "true");
  assert.equal(await page.locator(".geo-search-hint").evaluate((node) => getComputedStyle(node).display), "none");
  const field = await page.locator("#geoSearchQuery").boundingBox();
  assert.ok(field.height >= 43.5, "the field keeps a 44px touch target");
});

// ----------------------------------------------- stale M2 after dismissal

test("an Evidence Question answer is visibly marked out of date, with its cause, after the selection is dismissed", async (t) => {
  for (const language of ["en", "es"]) {
    const { page, context } = await pageFor({ viewport: { width: 1440, height: 900 }, language });
    await track(context, t);
    await page.locator("#geoSearchQuery").fill("APR.02.09");
    await page.waitForFunction(() => document.querySelectorAll("#geoSearchResults button").length > 0);
    await page.locator("#geoSearchResults button").first().click();
    await page.locator("#geoSearchAnalyze").click();
    await page.locator("#geoSearchQuestions > summary").click();
    await page.locator('.qx-q[data-question="LICENCES_IN_LENS"]').click();
    await page.waitForFunction(() => { const s = window.__QUESTION_EXPLORER_TEST__.snapshot(); return s && s.kind && s.kind !== "loading"; });
    await page.waitForFunction(() => { const a = document.querySelector("#qxAnswer"); return !a.hidden && a.dataset.stale === "false" && a.getAttribute("aria-busy") === "false"; });
    const key = await page.evaluate(() => window.__QUESTION_EXPLORER_TEST__.snapshot().contextKey);
    const lens = await page.evaluate(() => window.__HALO_REGRESSION__.lensCenters());

    // An outside click clears the selection, which is part of the answer's
    // context. The explorer marks the held answer out of date at once and
    // recomputes it ~140ms later, so the marking is recorded as it happens
    // rather than raced.
    await page.evaluate(() => {
      window.__staleLog = [];
      const answer = document.querySelector("#qxAnswer");
      new MutationObserver(() => {
        if (answer.dataset.stale !== "true") return;
        window.__staleLog.push({
          badge: answer.querySelector(".qx-badge")?.textContent || "",
          note: answer.querySelector(".qx-stale")?.textContent || "",
          dossierDisabled: answer.querySelector(".qx-action-dossier") ? answer.querySelector(".qx-action-dossier").disabled : null,
        });
      }).observe(answer, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    await page.locator("#modeCompareButton").click();
    await page.waitForFunction((previous) => {
      const answer = document.querySelector("#qxAnswer");
      const s = window.__QUESTION_EXPLORER_TEST__.snapshot();
      return window.__staleLog.length > 0 && answer.dataset.stale === "false" && answer.getAttribute("aria-busy") === "false" && s.contextKey !== previous;
    }, key);
    const log = await page.evaluate(() => window.__staleLog);
    const marked = log[0];
    assert.match(marked.badge, language === "es" ? /Desactualizada/ : /Out of date/, "the held answer is labelled out of date");
    assert.match(marked.badge, language === "es" ? /lugar seleccionado/ : /selected place/, "the label names the selected place as a cause");
    assert.match(marked.note, language === "es" ? /lugar seleccionado/ : /selected place/, "the status note names it too");
    if (marked.dossierDisabled !== null) assert.equal(marked.dossierDisabled, true, "a stale answer cannot be turned into a dossier");
    assert.deepEqual(await page.evaluate(() => window.__HALO_REGRESSION__.lensCenters()), lens, "the Lens did not move");
    assert.notEqual(await page.evaluate(() => window.__QUESTION_EXPLORER_TEST__.snapshot().contextKey), key, "the refreshed answer is bound to the context now on screen, never the old one");
  }
});

// ------------------------------------------------------- compact parity

test("compact presentation shows the same magnifier field inside the one panel", async (t) => {
  const { page, context } = await pageFor({ viewport: { width: 768, height: 1024 } });
  await track(context, t);
  await page.locator("#geoSearchToggle").click();
  assert.equal(await page.locator(".geo-search-icon").isVisible(), true);
  assert.equal(await page.locator("#geoSearchPanel .geo-search-field #geoSearchQuery").count(), 1, "one input, never a clone");
  assert.equal(await page.locator("#geoSearchPanel input[type=search]").count(), 1);
  await capture(page, "compact-768-open");
});
