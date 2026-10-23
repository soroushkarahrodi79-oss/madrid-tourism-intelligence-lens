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
  if (!target.startsWith(ROOT + path.sep) && target !== path.join(ROOT, "index.html")) return response.writeHead(403).end();
  fs.readFile(target, (error, data) => {
    if (error) return response.writeHead(404).end();
    response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
    response.end(data);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const port = server.address().port;

const scenarios = [
  { width: 1440, height: 900, touch: false, locale: "en" },
  { width: 1024, height: 768, touch: true, locale: "en" },
  { width: 820, height: 1180, touch: true, locale: "en" },
  { width: 768, height: 1024, touch: true, locale: "es" },
  { width: 390, height: 844, touch: true, locale: "en" },
  { width: 360, height: 740, touch: true, locale: "es" },
  { width: 680, height: 430, touch: true, locale: "es" },
  { width: 560, height: 400, touch: true, locale: "en" },
];
const intersects = (a, b) =>
  a.left < b.right - 1 && a.right > b.left + 1 &&
  a.top < b.bottom - 1 && a.bottom > b.top + 1;
const contained = (inner, outer, tolerance = 1) =>
  inner.left >= outer.left - tolerance && inner.right <= outer.right + tolerance &&
  inner.top >= outer.top - tolerance && inner.bottom <= outer.bottom + tolerance;

async function openApp(scenario) {
  const context = await browser.newContext({
    viewport: { width: scenario.width, height: scenario.height },
    hasTouch: scenario.touch,
    isMobile: scenario.touch,
    deviceScaleFactor: scenario.touch ? 2 : 1,
  });
  await context.addInitScript(() => localStorage.setItem("madrid-lens-appearance", "light"));
  const page = await context.newPage();
  page.setDefaultTimeout(9000);
  await page.route("**/*", (route) => {
    const hostname = new URL(route.request().url()).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" ? route.continue() : route.abort();
  });
  await page.goto("http://127.0.0.1:" + port + "/?haloRegressionTest=1", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__) &&
    Boolean(document.querySelector(".leaflet-control-zoom-in")) &&
    Boolean(document.querySelector(".leaflet-control-attribution")));
  if (scenario.locale === "es") await page.locator("#languageSelect").selectOption("es");
  return { context, page };
}

test("map +/- and attribution geometry stay legible across mobile, iPad and laptop", async (t) => {
  for (const s of scenarios) {
    await t.test(s.width + "x" + s.height + " touch=" + s.touch + " " + s.locale, async () => {
      const { context, page } = await openApp(s);
      try {
        const layout = await page.evaluate(() => {
          const box = (selector) => {
            const r = document.querySelector(selector).getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
          };
          const style = getComputedStyle(document.querySelector(".leaflet-control-zoom-in"));
          return {
            plus: box(".leaflet-control-zoom-in"),
            minus: box(".leaflet-control-zoom-out"),
            zoom: box(".leaflet-control-zoom"),
            attribution: box(".leaflet-control-attribution"),
            rail: box("#layerRail"),
            header: box("header"),
            zoomDisplay: style.display,
            align: style.alignItems,
            justify: style.justifyContent,
            coarse: matchMedia("(pointer: coarse)").matches,
          };
        });
        assert.equal(layout.zoomDisplay, "flex", "Leaflet links must not inherit the generic inline-flex touch rule");
        assert.equal(layout.align, "center");
        assert.equal(layout.justify, "center");
        assert.ok(layout.plus.width >= (layout.coarse ? 43.5 : 35.5));
        assert.ok(layout.plus.height >= (layout.coarse ? 43.5 : 35.5));
        assert.ok(contained(layout.plus, layout.zoom) && contained(layout.minus, layout.zoom), "zoom glyph buttons fit their own container");
        const horizontal = s.width <= 680 && s.height <= 480;
        if (horizontal) {
          assert.ok(Math.abs(layout.plus.right - layout.minus.left) <= 1.5, "short landscape zoom buttons are horizontal");
          assert.ok(Math.abs(layout.plus.top - layout.minus.top) <= 1.5);
        } else {
          assert.ok(Math.abs(layout.plus.bottom - layout.minus.top) <= 1.5, "zoom buttons stack vertically");
          assert.ok(Math.abs(layout.plus.left - layout.minus.left) <= 1.5);
        }
        assert.ok(!intersects(layout.zoom, layout.attribution), "zoom must not cover map source credits");
        assert.ok(!intersects(layout.zoom, layout.header), "zoom must not cover the header");
        assert.ok(!intersects(layout.zoom, layout.rail), "zoom must stay outside the layer rail");
        assert.ok(layout.attribution.left >= -1 && layout.attribution.right <= s.width + 1, "attribution remains in viewport");

        if (s.width <= 560) await page.locator("#mobileLayersButton").click();
        const operational = page.locator('.rail-group[data-rail-group="operational"]');
        if (!(await operational.evaluate((node) => node.open))) await operational.locator("summary").first().click();
        const layers = await page.evaluate(() => {
          const rail = document.querySelector("#layerRail");
          const rr = rail.getBoundingClientRect();
          const box = (node) => {
            const r = node.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          };
          const rows = [...document.querySelectorAll('.rail-group[data-rail-group="operational"] .layer')];
          const filter = document.querySelector("#stayKindFilter");
          return {
            rail: box(rail),
            rows: rows.map((row) => ({
              label: box(row.querySelector(".layer-left")),
              toggle: box(row.querySelector(".switch")),
              fontSize: parseFloat(getComputedStyle(row).fontSize),
            })),
            filter: box(filter),
            scrollable: rail.scrollHeight > rail.clientHeight + 1,
            viewportWidth: innerWidth,
            railWidth: rr.width,
          };
        });
        assert.ok(layers.rows.length >= 5, "all operational layer controls remain mounted");
        assert.ok(layers.rail.left >= -1 && layers.rail.right <= s.width + 1, "rail stays within the viewport");
        for (const row of layers.rows) {
          assert.ok(row.label.right + 2 <= row.toggle.left, "label and toggle have separate non-overlapping columns");
          assert.ok(row.label.left >= layers.rail.left && row.toggle.right <= layers.rail.right, "row fits the layer rail");
          assert.ok(row.fontSize >= 12, "layer text is not rendered at the old 10px micro scale");
        }
        assert.ok(layers.filter.left >= layers.rail.left && layers.filter.right <= layers.rail.right, "accommodation selector fits");
        if (layers.scrollable) {
          const moved = await page.evaluate(() => {
            const rail = document.getElementById("layerRail");
            rail.scrollTop = rail.scrollHeight;
            return rail.scrollTop;
          });
          assert.ok(moved > 0, "long rail scrolls independently instead of clipping lower layers");
        }
        if (s.width > 560) {
          const overlap = await page.evaluate(() => {
            const rail = document.querySelector("#layerRail").getBoundingClientRect();
            const attribution = document.querySelector(".leaflet-control-attribution").getBoundingClientRect();
            return rail.left < attribution.right && rail.right > attribution.left &&
              rail.top < attribution.bottom && rail.bottom > attribution.top;
          });
          assert.equal(overlap, false, "credits do not sit over the persistent tablet/desktop rail");
        }
      } finally {
        await context.close();
      }
    });
  }
});

test("left rail section headings keep 16px spacing across desktop, iPad and phone layouts", async (t) => {
  const headerScenarios = [
    { width: 1440, height: 900, touch: false, locale: "en" },
    { width: 1180, height: 820, touch: true, locale: "es" },
    { width: 390, height: 844, touch: true, locale: "en" },
  ];
  for (const s of headerScenarios) {
    await t.test(s.width + "x" + s.height + " " + s.locale, async () => {
      const { context, page } = await openApp(s);
      try {
        if (s.width <= 560) await page.locator("#mobileLayersButton").click();
        const operational = page.locator('.rail-group[data-rail-group="operational"]');
        if (!(await operational.evaluate((node) => node.open))) {
          await operational.locator("summary").first().click();
        }
        const layout = await page.evaluate(() => {
          const rail = document.querySelector("#layerRail");
          const railBox = rail.getBoundingClientRect();
          return [...document.querySelectorAll("#layerRail .rail-group > summary")].map((summary) => {
            const style = getComputedStyle(summary);
            const heading = summary.querySelector(".rail-group-copy");
            const summaryBox = summary.getBoundingClientRect();
            const headingBox = heading.getBoundingClientRect();
            return {
              group: summary.parentElement.dataset.railGroup,
              text: heading.textContent.trim(),
              paddingLeft: style.paddingLeft,
              paddingRight: style.paddingRight,
              background: style.backgroundColor,
              summaryLeft: summaryBox.left,
              summaryRight: summaryBox.right,
              headingLeft: headingBox.left,
              railLeft: railBox.left,
              railRight: railBox.right,
              headingOverflows: heading.scrollWidth > heading.clientWidth + 1 || heading.scrollHeight > heading.clientHeight + 1,
              summaryOverflows: summary.scrollWidth > summary.clientWidth + 1 || summary.scrollHeight > summary.clientHeight + 1,
            };
          });
        });
        assert.equal(layout.length, 6, "all left rail section headers remain present");
        for (const header of layout) {
          assert.equal(header.paddingLeft, "16px", `${header.group} has 16px left padding`);
          assert.equal(header.paddingRight, "16px", `${header.group} has 16px right padding`);
          assert.ok(header.headingLeft - header.summaryLeft >= 15.5, `${header.group} text sits inside its background`);
          assert.ok(header.summaryLeft >= header.railLeft && header.summaryRight <= header.railRight, `${header.group} background stays within the rail`);
          assert.equal(header.headingOverflows, false, `${header.group} heading text does not overflow`);
          assert.equal(header.summaryOverflows, false, `${header.group} header contents do not overflow`);
        }
        const operationalHeader = layout.find((header) => header.group === "operational");
        assert.equal(operationalHeader.background, "rgb(232, 241, 248)", "the light blue open-group background remains in place");
        assert.equal(await page.locator('[data-i18n="aside.layers"]').textContent(), s.locale === "es" ? "Capas operativas" : "Operational layers");
        assert.equal(await page.locator('[data-i18n="aside.map"]').textContent(), s.locale === "es" ? "Visualización del mapa" : "Map display");
      } finally {
        await context.close();
      }
    });
  }
});
test("real Leaflet zoom actions remain functional after centering fix", async () => {
  const { context, page } = await openApp({ width: 390, height: 844, touch: true, locale: "en" });
  try {
    const initial = await page.evaluate(() => eval("map").getZoom());
    await page.locator(".leaflet-control-zoom-in").click();
    await page.waitForFunction((before) => eval("map").getZoom() > before, initial);
    assert.ok((await page.evaluate(() => eval("map").getZoom())) > initial);
  } finally {
    await context.close();
  }
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});
