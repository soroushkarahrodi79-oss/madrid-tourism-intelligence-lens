import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as playwright from "playwright";

// UX-C1 — Light contrast & analytical readability.
//
// Asserts COMPUTED colours and EFFECTIVE (composited, opacity-aware) contrast of
// every text node and state indicator in the Comparison Bridge, Decision Insight
// and Spatial Window Sensitivity, per appearance, language, focus state and
// viewport. Selector existence and CSS strings are deliberately not asserted.

// UXC1_BROWSER selects the engine: "chromium" (default) or "webkit". The same
// assertions run on both; nothing is relaxed per engine.
const ENGINE = process.env.UXC1_BROWSER || "chromium";
assert.ok(["chromium", "webkit"].includes(ENGINE), `UXC1_BROWSER must be chromium or webkit, got ${ENGINE}`);
// UXC1_ROOT serves another checkout (e.g. the base branch) for before/after capture.
const ROOT = path.resolve(process.env.UXC1_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
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
const browser = await playwright[ENGINE].launch({ headless: true });
test.after(async () => { await browser.close(); server.close(); });

const EVIDENCE = (overrides = {}) => ({
  aoiState: "eligible",
  tourism: { a: { value: 17, sourceState: "live" }, b: { value: 26, sourceState: "live" } },
  stays: { a: { value: 2, sourceState: "live" }, b: { value: 4, sourceState: "live" } },
  mobility: { a: { value: 3, sourceState: "live" }, b: { value: 40, sourceState: "live" } },
  utci: {
    enabled: true, timestepA: "15:00", timestepB: "15:00",
    a: { evidence: "MODEL-DERIVED", mean: 36.4, count: 2 },
    b: { evidence: "MODEL-DERIVED", mean: 38.1, count: 3 },
  },
  ...overrides,
});
// `radii` is the scenario window applied after the baseline is captured at
// 900/900. Equal radii keep the comparison observed; unequal radii withhold it.
const STATES = {
  observed: () => ({ evidence: EVIDENCE(), radii: { A: 1200, B: 1200 } }),
  unavailable: () => ({ evidence: EVIDENCE({ mobility: { a: { value: 3, sourceState: "live" }, b: { value: 40, sourceState: "unavailable" } } }), radii: { A: 1200, B: 1200 } }),
  withheld: () => ({ evidence: EVIDENCE(), radii: { A: 900, B: 1200 } }),
  off: () => ({ evidence: EVIDENCE({ utci: { enabled: false } }), radii: { A: 1200, B: 1200 } }),
};

async function openApp({ width = 1440, height = 900, colorScheme = "light", preference, locale = "en-US", lang } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme, locale });
  if (preference) await context.addInitScript((value) => localStorage.setItem("madrid-lens-appearance", value), preference);
  const page = await context.newPage();
  // Cold-start budget only: the first WebKit page load on a fresh CI runner took
  // ~13s (observed), which starved the first action's actionability wait. This
  // is harness readiness; no assertion is relaxed.
  page.setDefaultTimeout(ENGINE === "webkit" ? 30000 : 8000);
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === "127.0.0.1" || host === "localhost" ? route.continue() : route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1${lang ? `&lang=${lang}` : ""}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__) && Boolean(window.MadridAppearance), null, { timeout: 30000 });
  await page.waitForLoadState("load");
  page.context_ = context;
  return page;
}

// Drive the real production render path into COMPARE with a deterministic
// comparison state, a captured spatial baseline and a focused metric.
async function compareState(page, { state = "observed", focus = "mobility" } = {}) {
  await page.locator("#modeCompareButton").click();
  await page.locator("#compareDetail > summary").click();
  await page.evaluate(({ evidence, radii }) => {
    const api = window.__HALO_REGRESSION__;
    api.setRadius("A", 900); api.setRadius("B", 900);
    api.setComparisonOverride(evidence);
    api.captureSpatialBaseline();
    api.setRadius("A", radii.A); api.setRadius("B", radii.B);
    api.setComparisonOverride(evidence);
  }, STATES[state]());
  if (focus) await page.evaluate((metric) => window.__HALO_REGRESSION__.focusMetric(metric, "A", true), focus);
  await page.waitForFunction(() => document.querySelectorAll("#decisionInsightItems .di-item").length === 4);
}

// In-page WCAG contrast audit over composited layers (transparent backgrounds,
// ancestor opacity). Returns one record per text-bearing element.
const AUDIT = ({ roots, fallbackBg }) => {
  const parse = (value) => {
    const m = value.match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0, 0];
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const over = (top, under) => {
    const a = top[3] + under[3] * (1 - top[3]);
    if (a === 0) return [0, 0, 0, 0];
    return [0, 1, 2].map((i) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a).concat(a);
  };
  const lum = ([r, g, b]) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (x, y) => { const a = lum(x), b = lum(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  const base = parse(fallbackBg);
  const stack = (el) => {
    // Layers from el up to the root; opacity of the whole chain is folded in.
    let bg = [0, 0, 0, 0];
    let opacity = 1;
    let outside = [0, 0, 0, 0];
    const chain = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.push(n);
    // Composite bottom-up: root-most ancestor first.
    let acc = base.slice(0, 3).concat(1);
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const cs = getComputedStyle(chain[i]);
      const op = Number(cs.opacity);
      if (op < 1) { opacity *= op; if (outside[3] === 0) outside = acc.slice(); }
      acc = over(parse(cs.backgroundColor), acc);
    }
    return { bg: acc, opacity, outside: outside[3] === 0 ? acc : outside };
  };
  const results = [];
  for (const root of roots.map((s) => document.querySelector(s)).filter(Boolean)) {
    if (root.hidden || !root.getClientRects().length) continue;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const el = t.parentElement;
      if (!t.nodeValue.trim() || seen.has(el)) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || !el.getClientRects().length) continue;
      if (el.closest(".sr-only")) continue;
      const { bg, opacity, outside } = stack(el);
      const fgRaw = parse(cs.color);
      const fgOnBg = over(fgRaw, bg);
      // Opacity group: result = o*group + (1-o)*backdrop.
      const mix = (g, b) => [0, 1, 2].map((i) => opacity * g[i] + (1 - opacity) * b[i]);
      const fg = mix(fgOnBg, outside), eb = mix(bg, outside);
      results.push({
        selector: `${el.id ? `#${el.id}` : ""}.${[...el.classList].join(".")}`,
        text: el.textContent.trim().slice(0, 40),
        fontSize: parseFloat(cs.fontSize),
        fontWeight: Number(cs.fontWeight),
        color: cs.color,
        opacity,
        effectiveFg: fg.map(Math.round).join(","),
        effectiveBg: eb.map(Math.round).join(","),
        ratio: Math.round(ratio(fg, eb) * 100) / 100,
      });
    }
  }
  return results;
};
const ROOTS = ["#comparisonBridge", "#decisionInsight", "#spatialSensitivity", "#compareDetail"];
const auditFor = async (page) => {
  const appearance = await page.locator("html").getAttribute("data-appearance");
  const fallbackBg = appearance === "light" ? "rgb(244, 246, 249)" : "rgb(8, 16, 26)";
  return page.evaluate(AUDIT, { roots: ROOTS, fallbackBg });
};
const failing = (rows) => rows.filter((row) => row.ratio < 4.5);

// ---------------------------------------------------------------------------
// The confirmed defect: focused Mobility row in Light.
// ---------------------------------------------------------------------------
for (const mode of [
  { name: "explicit Light", preference: "light", colorScheme: "dark" },
  { name: "System with light OS preference", preference: "system", colorScheme: "light" },
]) {
  test(`focused Mobility row is readable in ${mode.name} (confirmed defect)`, async (t) => {
    const page = await openApp({ ...mode, width: 1024, height: 768 });
    t.after(() => page.context_.close());
    assert.equal(await page.locator("html").getAttribute("data-appearance"), "light");
    await compareState(page);
    const row = await page.evaluate(() => {
      const li = document.querySelector('#decisionInsightItems .di-item[data-metric-id="mobility"]');
      return { focused: li.dataset.focused, text: li.textContent.trim(), cs: getComputedStyle(li).backgroundColor, rel: getComputedStyle(li.querySelector(".di-rel")).color, metric: getComputedStyle(li.querySelector(".di-metric")).color };
    });
    assert.equal(row.focused, "true");
    assert.match(row.text, /Mobility nodes/);
    assert.match(row.text, /\+3\d/, "observed B − A figure is printed");
    const rows = (await auditFor(page)).filter((r) => /di-metric|di-rel/.test(r.selector) && /Mobility|\+3\d/.test(r.text));
    assert.ok(rows.length >= 2, JSON.stringify(rows));
    for (const r of rows) assert.ok(r.ratio >= 4.5, `focused Mobility ${r.selector} contrast ${r.ratio}:1 (fg ${r.color}) ${JSON.stringify(row)}`);
  });
}

// ---------------------------------------------------------------------------
// Full-surface audit: every text node, per appearance × language × state.
// ---------------------------------------------------------------------------
for (const appearance of ["light", "dark"]) {
  for (const lang of ["en", "es"]) {
    for (const state of Object.keys(STATES)) {
      for (const focus of [null, "tourism", "stays", "mobility", "utci"]) {
        test(`WCAG AA text contrast · ${appearance} · ${lang} · ${state} · focus=${focus}`, async (t) => {
          const page = await openApp({ preference: appearance, lang, width: 1180, height: 820 });
          t.after(() => page.context_.close());
          await compareState(page, { state, focus });
          const rows = await auditFor(page);
          assert.ok(rows.length > 12, "audit reached the analytical surfaces");
          assert.deepEqual(failing(rows), [], "text below 4.5:1");
        });
      }
    }
  }
}

// Focus is carried by structure/background, not by colour alone, and the
// unfocused rows are not dimmed through opacity in Light.
test("Light focus indication is structural and unfocused rows are not dimmed", async (t) => {
  const page = await openApp({ preference: "light", width: 1024, height: 768 });
  t.after(() => page.context_.close());
  await compareState(page);
  const probe = await page.evaluate(() => [...document.querySelectorAll("#decisionInsightItems .di-item")].map((li) => {
    const cs = getComputedStyle(li);
    return { focused: li.dataset.focused, opacity: Number(cs.opacity), borderLeft: parseFloat(cs.borderLeftWidth), borderColor: cs.borderLeftColor, bg: cs.backgroundColor };
  }));
  const focused = probe.find((r) => r.focused === "true");
  const others = probe.filter((r) => r.focused !== "true");
  assert.ok(focused.borderLeft >= 3, "focused row has a ≥3px structural edge");
  assert.notEqual(focused.bg, others[0].bg, "focused row has its own surface");
  for (const r of others) assert.equal(r.opacity, 1, "unfocused rows keep full opacity (no opacity-washed text)");
});

// Meaningful non-text indicator (focused edge) ≥ 3:1 against its row surface.
test("Light focused-row edge meets 3:1 non-text contrast", async (t) => {
  const page = await openApp({ preference: "light", width: 1024, height: 768 });
  t.after(() => page.context_.close());
  await compareState(page);
  const ratio = await page.evaluate(() => {
    const li = document.querySelector('#decisionInsightItems .di-item[data-focused="true"]');
    const cs = getComputedStyle(li);
    const rgb = (v) => v.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const a = lum(rgb(cs.borderLeftColor)), b = lum(rgb(cs.backgroundColor));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  assert.ok(ratio >= 3, `edge contrast ${ratio}`);
});

// Reading size: analytical sentences/figures ≥ 12px, tracked uppercase labels ≥ 11px.
for (const appearance of ["light", "dark"]) {
  test(`analytical microcopy is comfortably sized · ${appearance}`, async (t) => {
    const page = await openApp({ preference: appearance, width: 1180, height: 820 });
    t.after(() => page.context_.close());
    await compareState(page);
    const rows = await auditFor(page);
    const small = rows.filter((r) => /(di-metric|di-rel|di-status|di-guard|ss-status|ss-guard|ss-reading-value|ss-transition|ss-metric|cb-sub|cb-radius|cb-qualifier|comparison-bridge-empty)/.test(r.selector) && r.fontSize < 12);
    assert.deepEqual(small.map((r) => `${r.selector}:${r.fontSize}`), []);
    const labels = rows.filter((r) => /(di-title|ss-title|cb-lens|cb-rel-label|cb-metric-name|ss-window-label|ss-reading-label)/.test(r.selector) && r.fontSize < 11);
    assert.deepEqual(labels.map((r) => `${r.selector}:${r.fontSize}`), []);
  });
}

// Responsive: no horizontal overflow, nothing clipped, panel remains scrollable.
const VIEWPORTS = [[1440, 900], [1366, 768], [1180, 820], [1024, 768], [820, 1180], [768, 1024], [390, 844], [360, 800], [844, 390]];
for (const [width, height] of VIEWPORTS) {
  for (const appearance of ["light", "dark"]) {
    test(`no overflow and AA contrast at ${width}×${height} · ${appearance}`, async (t) => {
      const page = await openApp({ preference: appearance, width, height });
      t.after(() => page.context_.close());
      await compareState(page);
      const m = await page.evaluate(() => {
        const over = [];
        for (const sel of ["#comparisonBridge", "#decisionInsight", "#spatialSensitivity"]) {
          const el = document.querySelector(sel);
          if (el && el.getClientRects().length) over.push([sel, el.scrollWidth - el.clientWidth]);
        }
        const rows = [...document.querySelectorAll("#decisionInsightItems .di-item")].map((li) => li.scrollWidth - li.clientWidth);
        return { doc: document.documentElement.scrollWidth - innerWidth, over, rows };
      });
      assert.ok(m.doc <= 1, JSON.stringify(m));
      for (const [sel, o] of m.over) assert.ok(o <= 1, `${sel} overflows by ${o}`);
      for (const o of m.rows) assert.ok(o <= 1, JSON.stringify(m));
      assert.deepEqual(failing(await auditFor(page)), []);
    });
  }
}

// Appearance persistence and live switching do not disturb the scrollable
// analytical panel, and the focused row stays readable while it scrolls.
test("switching appearance and metric keeps scroll position, focused row stays readable, theme persists", async (t) => {
  const page = await openApp({ preference: "light", width: 1024, height: 768 });
  t.after(() => page.context_.close());
  await compareState(page);
  const metrics = await page.evaluate(() => {
    const el = document.getElementById("analysisPanel");
    el.scrollTop = 140;
    return { scrollable: el.scrollHeight > el.clientHeight + 140, top: el.scrollTop };
  });
  assert.equal(metrics.scrollable, true, "the panel genuinely scrolls in this state");
  assert.ok(metrics.top >= 100, `scrollTop applied (${metrics.top})`);
  const top = () => page.evaluate(() => document.getElementById("analysisPanel").scrollTop);
  const before = await top();
  await page.locator("#appearanceSelect").selectOption("dark");
  assert.ok(Math.abs((await top()) - before) <= 2, "dark switch keeps scroll");
  await page.evaluate(() => window.__HALO_REGRESSION__.focusMetric("stays", "A", true));
  await page.locator("#appearanceSelect").selectOption("light");
  const after = await top();
  assert.ok(Math.abs(after - before) <= 2, `scroll jumped ${before} → ${after}`);
  // Scroll each analytical surface into view; contrast holds.
  for (const sel of ["#decisionInsight", "#spatialSensitivity"]) {
    await page.locator(sel).scrollIntoViewIfNeeded();
    assert.deepEqual(failing(await auditFor(page)), [], `${sel} readable while scrolled`);
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await page.locator("html").getAttribute("data-appearance"), "light");
});

// Evidence capture (opt-in, no assertions about pixels): the 1024×768 iPad
// landscape case, System Light, Mobility focused. Run with UXC1_CAPTURE_DIR set
// and --test-name-pattern="capture"; UXC1_ROOT points at the checkout to render.
test("capture iPad landscape System-light Mobility screenshot", { skip: !process.env.UXC1_CAPTURE_DIR }, async (t) => {
  const dir = process.env.UXC1_CAPTURE_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, colorScheme: "light", deviceScaleFactor: 2 });
  await context.addInitScript(() => localStorage.setItem("madrid-lens-appearance", "system"));
  const page = await context.newPage();
  t.after(() => context.close());
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === "127.0.0.1" || host === "localhost" ? route.continue() : route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__) && Boolean(window.MadridAppearance));
  assert.equal(await page.locator("html").getAttribute("data-appearance"), "light");
  await compareState(page);
  await page.locator("#decisionInsight").screenshot({ path: path.join(dir, `${ENGINE}-ipad-landscape-system-light-decision-insight.png`) });
  await page.locator("#spatialSensitivity").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(dir, `${ENGINE}-ipad-landscape-system-light-full.png`) });
});
