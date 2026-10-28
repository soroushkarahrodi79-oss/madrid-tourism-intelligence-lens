import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as playwright from "playwright";
import { DESIGNED_HSCROLL, PANEL_AUDIT } from "./panel-containment-audit.mjs";

// UX-C2 — right analytical panel containment & responsive geometry.
//
// Every assertion is a MEASUREMENT of the rendered page (bounding rectangles,
// clientWidth/scrollWidth, computed padding/border, scrollbar width) taken
// against each element's real parent content box. CSS text is never asserted.
// See panel-containment-audit.mjs for the finding classes.
//
//   UXC2_BROWSER      "chromium" (default) | "webkit"
//   UXC2_ROOT         serve another checkout (the base branch) for before/after
//   UXC2_MATRIX_DIR   write the measured containment matrix (JSON) there
//   UXC2_CAPTURE_DIR  write screenshots there (see the "capture" test)
const ENGINE = process.env.UXC2_BROWSER || "chromium";
assert.ok(["chromium", "webkit"].includes(ENGINE), `UXC2_BROWSER must be chromium or webkit, got ${ENGINE}`);
const ROOT = path.resolve(process.env.UXC2_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const MATRIX_DIR = process.env.UXC2_MATRIX_DIR || "";
const MIME = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".geojson": "application/json" };
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
// Playwright's headless Chromium hides scrollbars by default, which would hide
// the very gutter allocation under test. `classic` contexts keep them, so a
// 15px/6px scrollbar really takes space from the panel and its lists.
const hidden = await playwright[ENGINE].launch({ headless: true });
const classic = ENGINE === "chromium" ? await playwright.chromium.launch({ headless: true, ignoreDefaultArgs: ["--hide-scrollbars"] }) : hidden;
test.after(async () => { await hidden.close(); if (classic !== hidden) await classic.close(); server.close(); });

// The ten required viewports.
const VIEWPORTS = [
  [1440, 900], [1366, 768], [1180, 820], [1024, 768], [820, 1180],
  [768, 1024], [560, 800], [390, 844], [360, 800], [844, 390],
];
const MODES = ["PLACE", "COMPARE", "CITY"];
const MATRIX = [];

// Lens A sits by Los Jerónimos / Retiro (the reported iPad scenario); Lens B is
// enabled so COMPARE renders its real bridge, insight and tables.
const LENS = "a=40.4141,-3.6912,900&b=40.4224,-3.7037,900&al=A";

async function openApp({ width, height, preference = "light", colorScheme = "light", lang = "en", panelSize = null, scrollbars = "hidden" }) {
  const browser = scrollbars === "classic" ? classic : hidden;
  const context = await browser.newContext({ viewport: { width, height }, colorScheme, locale: lang === "es" ? "es-ES" : "en-US", deviceScaleFactor: 2 });
  await context.addInitScript(([pref, size]) => {
    localStorage.setItem("madrid-lens-appearance", pref);
    if (size) localStorage.setItem("madrid-tourism-intelligence-lens:analysis-panel-size:v1", JSON.stringify(size));
  }, [preference, panelSize]);
  const page = await context.newPage();
  // Cold-start budget only (first WebKit load on a fresh runner is slow).
  page.setDefaultTimeout(ENGINE === "webkit" ? 30000 : 10000);
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === "127.0.0.1" || host === "localhost" ? route.continue() : route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1&v=1&m=PLACE&${LENS}&be=1&lg=${lang}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__HALO_REGRESSION__?.k11Restored?.() === true, null, { timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.MadridAppearance), null, { timeout: 30000 });
  page.context_ = context;
  return page;
}

async function setMode(page, mode) {
  await page.locator(`#mode${mode[0]}${mode.slice(1).toLowerCase()}Button`).click();
  await page.waitForFunction((m) => document.getElementById("analysisPanel").dataset.mode === m, mode);
}

// Open or close every disclosure that belongs to the visible mode.
async function setDetail(page, mode, open, { nested = true } = {}) {
  await page.evaluate(({ mode: m, open: o, nested: n }) => {
    const scope = { PLACE: "#modePlace", COMPARE: "#compareLine", CITY: "#modeCity" }[m];
    for (const d of document.querySelectorAll(`${scope} details`)) {
      if (d.closest("[hidden]")) continue;
      if (d.matches(".detail-disclosure") || n) d.open = o;
    }
  }, { mode, open, nested });
  // Two frames: lets the Detail renderers (planning list, tables) settle.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(250);
}

// Deterministic long-content stress. It overwrites TEXT only, in slots that are
// known to carry official/translated names, and never touches any figure used
// by a calculation. Real-data runs never call this.
async function applyStress(page) {
  await page.evaluate(() => {
    const LONG = "Área de Planeamiento Específico de la Ciudadela Histórica y Ensanche Oriental del Paseo Imperial";
    const TOKEN = "ESTRUCTURAGEOGRAFICAINTERMUNICIPALSINESPACIOSDEPLANEAMIENTO";
    const nearest = document.getElementById("nearestList");
    if (nearest && nearest.children.length) {
      nearest.innerHTML = [LONG, TOKEN, "Museo Nacional Centro de Arte Reina Sofía Edificio Sabatini"]
        .map((n, i) => `<li><i class="dot dot-museum dot-inline"></i>${n}<em>${(i + 1) * 1111} m</em></li>`).join("");
    }
    for (const el of document.querySelectorAll("#planningTouchedList > li > span:not(.planning-touched-code):not(.planning-touched-centre), .planning-membership-chip-name")) el.textContent = LONG;
    for (const el of document.querySelectorAll("#planningTouchedList .planning-touched-code, .planning-membership-chip .planning-touched-code")) el.textContent = "APE.01.05/M-EXTENDIDO";
    for (const el of document.querySelectorAll(".cb-metric-name, .comparetable tbody th, .planning-denomination")) el.textContent = LONG;
    for (const el of document.querySelectorAll(".metric-value")) el.textContent = "1.234.567";
  });
  await page.waitForTimeout(150);
}

async function audit(page, rootSelector = "#analysisPanel") {
  return page.evaluate(PANEL_AUDIT, { rootSelector, designed: DESIGNED_HSCROLL, includeFocus: true });
}

function describe(findings) {
  const grouped = new Map();
  for (const f of findings) {
    const key = `${f.kind} | ${f.el}`;
    grouped.set(key, [...(grouped.get(key) || []), f.detail]);
  }
  return [...grouped].map(([k, v]) => `${k} → ${v[0]}${v.length > 1 ? ` (+${v.length - 1} more)` : ""}`).join("\n");
}

function record(meta, result) {
  MATRIX.push({ ...meta, panel: result.stats, findings: result.findings.length, designed: result.designed.length });
}

// Core assertion shared by every scenario.
function assertContained(meta, result) {
  record(meta, result);
  const where = JSON.stringify(meta);
  assert.equal(result.error, undefined, `${where}: ${result.error}`);
  assert.equal(result.findings.length, 0, `${where}: containment findings\n${describe(result.findings)}`);
  const { minInsetLeft, minInsetRight } = result.stats;
  if (minInsetLeft !== null && minInsetRight !== null) {
    assert.ok(minInsetLeft >= -0.75 && minInsetRight >= -0.75, `${where}: a card leaves the panel content box (L ${minInsetLeft}, R ${minInsetRight})`);
    assert.ok(Math.abs(minInsetLeft - minInsetRight) <= 1.5, `${where}: left/right spacing unbalanced (L ${minInsetLeft}, R ${minInsetRight})`);
  }
}

async function runModes(page, meta, { details = [true, false], scrolled = [false, true], stress = false } = {}) {
  for (const mode of MODES) {
    await setMode(page, mode);
    for (const open of details) {
      await setDetail(page, mode, open);
      if (stress) await applyStress(page);
      for (const scroll of scrolled) {
        await page.evaluate((s) => { const p = document.getElementById("analysisPanel"); p.scrollTop = s ? Math.max(0, (p.scrollHeight - p.clientHeight) / 2) : 0; }, scroll);
        await page.waitForTimeout(80);
        const result = await audit(page);
        assertContained({ ...meta, mode, detail: open, scrolled: scroll, stress }, result);
      }
    }
  }
}

// ---------------------------------------------------------------- the matrix

for (const [width, height] of VIEWPORTS) {
  test(`real data, Light/EN: Place, Compare and City stay contained at ${width}x${height}`, async () => {
    const page = await openApp({ width, height });
    try { await runModes(page, { width, height, appearance: "light", lang: "en" }); } finally { await page.context_.close(); }
  });
}

// Appearance x language on the viewports that change the layout class.
for (const [width, height] of [[1440, 900], [1180, 820], [1024, 768], [820, 1180], [390, 844]]) {
  for (const [appearance, preference, colorScheme] of [["light", "light", "light"], ["dark", "dark", "dark"], ["system-light", "system", "light"]]) {
    for (const lang of ["en", "es"]) {
      if (appearance === "light" && lang === "en") continue; // covered above
      test(`real data, ${appearance}/${lang.toUpperCase()}: contained at ${width}x${height}`, async () => {
        const page = await openApp({ width, height, preference, colorScheme, lang });
        try {
          assert.equal(await page.evaluate(() => document.documentElement.lang), lang, "the requested language is active");
          assert.equal(await page.evaluate(() => document.documentElement.dataset.appearance), colorScheme === "dark" || preference === "dark" ? "dark" : "light");
          await runModes(page, { width, height, appearance, lang }, { details: [true], scrolled: [false, true] });
        } finally { await page.context_.close(); }
      });
    }
  }
}

// Desktop panel resizing: the minimum and maximum widths the app allows.
for (const [width, height] of [[1440, 900], [1366, 768], [1180, 820], [1024, 768]]) {
  for (const [label, size] of [["minimum", { width: 100, height: 600 }], ["maximum", { width: 5000, height: 600 }]]) {
    test(`panel at its ${label} allowed width stays contained at ${width}x${height}`, async () => {
      const page = await openApp({ width, height, panelSize: size });
      try {
        const rect = await page.evaluate(() => document.getElementById("analysisPanel").getBoundingClientRect().width);
        // At <=1100px the app's CSS fixes the panel width and ignores the stored
        // size (observed; see ROOT_CAUSE.md "Known limitations"), so the
        // min/max width assertion only applies to the wider desktop layout.
        if (width > 1100) {
          if (label === "minimum") assert.equal(Math.round(rect), 390);
          else assert.ok(rect > 390, "maximum width is wider than the minimum");
        }
        await runModes(page, { width, height, panelWidth: Math.round(rect), panel: label }, { details: [true], scrolled: [false, true] });
      } finally { await page.context_.close(); }
    });
  }
}

// Classic (space-taking) scrollbars: the gutter allocation case. Chromium only;
// WebKit on iPad uses overlay scrollbars, so there is no gutter to measure.
if (ENGINE === "chromium") {
  for (const [width, height] of [[1440, 900], [1180, 820], [1024, 768]]) {
    test(`classic scrollbars: contained and balanced at ${width}x${height}`, async () => {
      const page = await openApp({ width, height, scrollbars: "classic" });
      try { await runModes(page, { width, height, scrollbars: "classic" }, { details: [true], scrolled: [false, true] }); } finally { await page.context_.close(); }
    });
  }
}

// Deterministic long-content fixtures (NOT real data): long official names,
// unbreakable tokens, 7-character figures.
for (const [width, height] of [[1440, 900], [1180, 820], [1024, 768], [820, 1180], [560, 800], [390, 844], [360, 800], [844, 390]]) {
  for (const lang of ["en", "es"]) {
    test(`long-content stress fixture (${lang}): contained at ${width}x${height}`, async () => {
      const page = await openApp({ width, height, lang });
      try { await runModes(page, { width, height, lang }, { details: [true], scrolled: [false], stress: true }); } finally { await page.context_.close(); }
    });
  }
}

// Blocks that only render once their layer is on: granted urban licences and
// hospitality context, through the same production paths the toggles use.
for (const [width, height] of [[1440, 900], [1180, 820], [1024, 768], [390, 844], [360, 800]]) {
  for (const lang of ["en", "es"]) {
    test(`licence and hospitality layers on (${lang}): contained at ${width}x${height}`, async () => {
      const page = await openApp({ width, height, lang });
      try {
        await page.evaluate(async () => { await window.__HALO_REGRESSION__.enableLicences(); await window.__HALO_REGRESSION__.enableHospitality(); });
        await page.waitForTimeout(500);
        const visible = await page.evaluate(() => ({
          lic: Boolean(document.querySelector("#modePlace .lic-families")?.getClientRects().length),
          hosp: Boolean(document.querySelector("#modePlace .hospitality-meta-grid")?.getClientRects().length),
        }));
        await runModes(page, { width, height, lang, layers: `licences+hospitality (rendered: ${JSON.stringify(visible)})` }, { details: [true], scrolled: [false, true] });
      } finally { await page.context_.close(); }
    });
  }
}

// The Evidence & limits drawer shares the card/grid patterns.
for (const [width, height] of [[1440, 900], [1180, 820], [820, 1180], [390, 844], [360, 800]]) {
  for (const lang of ["en", "es"]) {
    test(`evidence drawer (${lang}): contained at ${width}x${height}`, async () => {
      const page = await openApp({ width, height, lang });
      try {
        await page.locator("#modePlace .evidence-route, [data-evidence-mode='PLACE']").first().click();
        await page.waitForFunction(() => document.getElementById("evidenceDrawer").open);
        await page.waitForTimeout(300);
        for (const scroll of [false, true]) {
          await page.evaluate((s) => { const d = document.getElementById("evidenceDrawer"); d.scrollTop = s ? d.scrollHeight / 2 : 0; }, scroll);
          const result = await audit(page, "#evidenceDrawer");
          assertContained({ width, height, lang, surface: "drawer", scrolled: scroll }, result);
        }
      } finally { await page.context_.close(); }
    });
  }
}

// The reported scenario, asserted on its own so the failure message names it.
test("reported iPad-landscape Place Detail: Category mix, Nearest and ámbito list are inside their cards, symmetric", async () => {
  const page = await openApp({ width: 1180, height: 820 });
  try {
    await setDetail(page, "PLACE", true);
    const m = await page.evaluate(() => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right }; };
      const content = (el) => {
        const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        const sb = el.offsetWidth - el.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
        return { l: r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft), r: r.right - parseFloat(cs.borderRightWidth) - sb - parseFloat(cs.paddingRight) };
      };
      const disclosure = document.getElementById("placeDetail");
      const cards = [...document.querySelectorAll("#placeDetail .mix > .card")];
      const touched = [...document.querySelectorAll("#planningTouchedList > li")];
      return {
        disclosure: content(disclosure),
        cards: cards.map(box),
        cardContent: cards.map(content),
        nearestTexts: [...document.querySelectorAll("#nearestList li")].map((li) => ({ client: li.clientWidth, scroll: li.scrollWidth })),
        touchedCard: content(document.getElementById("planningTouchedCard")),
        touched: touched.map(box),
        touchedCount: touched.length,
      };
    });
    assert.ok(m.cards.length >= 2 && m.touchedCount >= 3, "Category mix, Nearest and several ámbitos are visible");
    for (const c of m.cards) assert.ok(c.l >= m.disclosure.l - 0.75 && c.r <= m.disclosure.r + 0.75, "cards sit inside the Detail disclosure");
    for (const t of m.nearestTexts) assert.ok(t.scroll <= t.client + 1, "Nearest rows are not clipped");
    const leftInset = Math.min(...m.touched.map((t) => t.l - m.touchedCard.l));
    const rightInset = Math.min(...m.touched.map((t) => m.touchedCard.r - t.r));
    assert.ok(Math.abs(leftInset - rightInset) <= 1.5, `ámbito rows balanced inside their card (L ${leftInset}, R ${rightInset})`);
  } finally { await page.context_.close(); }
});

// Intentional vertical scrolling must keep working: the list is capped and still scrolls.
test("the Planning ámbitos list still scrolls vertically inside its own region and never horizontally", async () => {
  const page = await openApp({ width: 1180, height: 820 });
  try {
    await setDetail(page, "PLACE", true);
    // Stress only the amount of rows by cloning real ones (names untouched).
    await page.evaluate(() => {
      const list = document.getElementById("planningTouchedList");
      const rows = [...list.children];
      while (list.children.length < 16) for (const r of rows) list.append(r.cloneNode(true));
    });
    const s = await page.evaluate(() => {
      const l = document.getElementById("planningTouchedList");
      const before = l.scrollTop; l.scrollTop = 40;
      return { client: l.clientHeight, scrollH: l.scrollHeight, moved: l.scrollTop - before, sw: l.scrollWidth, cw: l.clientWidth, oy: getComputedStyle(l).overflowY };
    });
    assert.ok(s.scrollH > s.client, "the capped list overflows vertically");
    assert.ok(s.moved > 0, "the list scrolls vertically");
    assert.ok(s.sw <= s.cw + 1, "the list never scrolls horizontally");
    assert.equal(s.oy, "auto");
  } finally { await page.context_.close(); }
});

// Opening Detail must not shift anything that is above it.
test("opening Detail does not move the controls above it", async () => {
  const page = await openApp({ width: 1180, height: 820 });
  try {
    await setDetail(page, "PLACE", false, { nested: false });
    const read = () => page.evaluate(() => {
      const r = (s) => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return [b.left, b.top, b.width]; };
      const p = document.getElementById("analysisPanel");
      // Horizontal geometry of the always-visible blocks, plus the panel itself.
      return { head: r(".panel-head"), rail: r("#scopeRail"), summary: r("#placeDetail > summary"), panelW: p.getBoundingClientRect().width, cw: p.clientWidth };
    });
    const before = await read();
    await setDetail(page, "PLACE", true, { nested: false });
    const after = await read();
    // Opening Detail adds a "Lens ∩ ámbito" provenance row to the scope rail
    // (intentional content, K4), so the summary may move DOWN; nothing may move
    // sideways or resize, and nothing above the rail may move at all.
    assert.deepEqual(after.head, before.head);
    assert.deepEqual([after.rail[0], after.rail[1], after.rail[2]], [before.rail[0], before.rail[1], before.rail[2]]);
    assert.equal(after.summary[0], before.summary[0]);
    assert.equal(after.summary[2], before.summary[2]);
    assert.equal(after.panelW, before.panelW);
    assert.equal(after.cw, before.cw);
  } finally { await page.context_.close(); }
});

// ----------------------------------------------------------------- capture

test("capture: iPad-landscape System-light screenshots for before/after", async (t) => {
  const dir = process.env.UXC2_CAPTURE_DIR;
  if (!dir) return t.skip("UXC2_CAPTURE_DIR not set");
  fs.mkdirSync(dir, { recursive: true });
  const shots = [["ipad-landscape-1180x820", 1180, 820], ["ipad-1024x768", 1024, 768], ["phone-390x844", 390, 844], ["phone-360x800", 360, 800]];
  for (const [name, width, height] of shots) {
    const page = await openApp({ width, height, preference: "system", colorScheme: "light" });
    try {
      await setDetail(page, "PLACE", true);
      await page.evaluate(() => { const m = document.querySelector("#placeDetail .mix"); m.scrollIntoView({ block: "start" }); });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(dir, `${name}-place-detail.png`) });
      await setMode(page, "CITY");
      await setDetail(page, "CITY", true);
      await page.evaluate(() => { document.getElementById("analysisPanel").scrollTop = 1e6; });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(dir, `${name}-city-detail-bottom.png`) });
    } finally { await page.context_.close(); }
  }
});

test.after(() => {
  if (MATRIX_DIR && MATRIX.length) {
    fs.mkdirSync(MATRIX_DIR, { recursive: true });
    fs.writeFileSync(path.join(MATRIX_DIR, `containment-matrix-${ENGINE}.json`), JSON.stringify(MATRIX, null, 1));
  }
});
