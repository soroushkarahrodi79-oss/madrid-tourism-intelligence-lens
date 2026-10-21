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

const luminance = (rgb) => {
  const linear = rgb.map((v) => {
    const c = v / 255;
    return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  });
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
};
const hexRgb = (hex) => hex.match(/[\da-f]{2}/gi).map((v) => parseInt(v, 16));
const contrast = (a, b) => {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
};
const composite = (front, back, alpha) => front.map((channel, i) => Math.round(channel * alpha + back[i] * (1 - alpha)));

async function openApp(viewport) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => localStorage.setItem("madrid-lens-appearance", "dark"));
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === "127.0.0.1" || host === "localhost" ? route.continue() : route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__));
  return { page, context };
}

async function computedMapRoles(page) {
  return page.evaluate(() => {
    const style = (selector) => getComputedStyle(document.querySelector(selector));
    const attributionLink = document.querySelector(".leaflet-control-attribution a[href]");
    return {
      mapBackground: style(".leaflet-container").backgroundColor,
      attribution: {
        background: style(".leaflet-control-attribution").backgroundColor,
        text: style(".leaflet-control-attribution").color,
        link: attributionLink && getComputedStyle(attributionLink).color,
        linkDecoration: attributionLink && getComputedStyle(attributionLink).textDecorationLine,
      },
      zoom: {
        background: style(".leaflet-control-zoom a").backgroundColor,
        text: style(".leaflet-control-zoom a").color,
        border: style(".leaflet-control-zoom a").borderTopColor,
        shadow: style(".leaflet-control-zoom").boxShadow,
      },
      tooltip: {
        background: getComputedStyle(Object.assign(document.createElement("div"), { className: "leaflet-tooltip leaflet-tooltip-top" })).backgroundColor,
        text: getComputedStyle(Object.assign(document.createElement("div"), { className: "leaflet-tooltip" })).color,
      },
      light: document.documentElement.dataset.appearance === "light",
      basemap: document.getElementById("basemapSelect").value,
      language: document.getElementById("languageSelect").value,
    };
  });
}

test("T-a4 map chrome roles render across desktop/mobile, EN/ES and all three basemaps", async (t) => {
  const app = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
  assert.match(app, /A: \{ color: "#123b5f", fillColor: "#3da8ff", fillOpacity: 0\.10 \}/);
  assert.match(app, /B: \{ color: "#64f0ff", fillColor: "#43d7ff", fillOpacity: 0\.12 \}/);

  const appearanceResults = [];
  for (const appearance of ["dark", "light"]) {
    const { page, context } = await openApp({ width: 1440, height: 900 });
    try {
      assert.equal(await page.locator("html").getAttribute("data-appearance"), "dark",
        "manual Dark resolves synchronously at production startup");
      if (appearance === "light") await page.locator("#appearanceSelect").selectOption("light");
      const sequence = [
        { basemap: "light", width: 1440, language: "en" },
        { basemap: "dark", width: 1440, language: "es" },
        { basemap: "satellite", width: 390, language: "en" },
        { basemap: "light", width: 390, language: "es" },
        { basemap: "dark", width: 390, language: "en" },
        { basemap: "satellite", width: 1440, language: "es" },
      ];
      for (const state of sequence) {
        await page.setViewportSize({ width: state.width, height: state.width <= 560 ? 760 : 900 });
        await page.locator("#languageSelect").selectOption(state.language);
        if (state.width <= 560 && await page.locator("#mobileLayersButton").getAttribute("aria-expanded") !== "true") {
          await page.locator("#mobileLayersButton").click();
          await page.waitForFunction(() => document.getElementById("mobileLayersButton")?.getAttribute("aria-expanded") === "true");
        }
        if (state.width <= 560 && !(await page.locator('.rail-group[data-rail-group="map"]').evaluate((node) => node.open))) {
          await page.locator('.rail-group[data-rail-group="map"] > summary').click();
        }
        await page.locator("#basemapSelect").selectOption(state.basemap);
        const roles = await computedMapRoles(page);
        assert.equal(roles.light, appearance === "light");
        assert.equal(roles.basemap, state.basemap, "appearance remains independent from basemap selection");
        assert.equal(roles.language, state.language);
        assert.equal(roles.attribution.linkDecoration.includes("underline"), true,
          "provider links have a persistent structural cue");

        if (appearance === "dark") {
          assert.equal(roles.attribution.background, "rgba(5, 8, 12, 0.75)");
          assert.equal(roles.attribution.text, "rgb(170, 185, 202)");
          assert.equal(roles.attribution.link, "rgb(185, 199, 215)");
          assert.equal(roles.zoom.background, "rgb(11, 21, 33)");
          assert.equal(roles.zoom.text, "rgb(255, 255, 255)");
          assert.equal(roles.zoom.border, "rgb(37, 54, 74)");
        } else {
          assert.equal(roles.attribution.background, "rgba(255, 255, 255, 0.92)");
          assert.equal(roles.attribution.text, "rgb(68, 84, 104)");
          assert.equal(roles.attribution.link, "rgb(10, 99, 199)");
          assert.equal(roles.zoom.background, "rgb(255, 255, 255)");
          assert.equal(roles.zoom.text, "rgb(22, 34, 47)");
          assert.equal(roles.zoom.border, "rgb(116, 128, 142)");
        }
        appearanceResults.push({ appearance, ...state });
        if (state.width <= 560) await page.locator("#mobileLayersButton").click();
      }

      // WCAG text checks use the worst-case composited application surface over
      // black/white map pixels. The separate deployed snapshot check measures
      // actual tile compositing; flat-color arithmetic alone does not certify tiles.
      const darkSurfaceOverWhite = composite([5, 8, 12], [255, 255, 255], .75);
      const darkText = hexRgb("aab9ca");
      const darkLink = hexRgb("b9c7d7");
      const lightAttrWorst = composite([255, 255, 255], [0, 0, 0], .92);
      const lightTooltipWorst = composite([255, 255, 255], [0, 0, 0], .96);
      const lightLabelWorst = composite([255, 255, 255], [0, 0, 0], .94);
      assert.ok(contrast(darkText, darkSurfaceOverWhite) >= 4.5);
      assert.ok(contrast(darkLink, darkSurfaceOverWhite) >= 4.5);
      assert.ok(contrast(hexRgb("445468"), lightAttrWorst) >= 4.5);
      assert.ok(contrast(hexRgb("0a63c7"), lightAttrWorst) >= 4.5);
      assert.ok(contrast(hexRgb("16222f"), lightTooltipWorst) >= 4.5);
      assert.ok(contrast(hexRgb("16222f"), lightLabelWorst) >= 4.5);
      assert.ok(contrast(hexRgb("74808e"), [255, 255, 255]) >= 3,
        "zoom separator meets 3:1 against the Light button surface");
      assert.ok(contrast(hexRgb("74808e"), [242, 244, 247]) >= 3,
        "zoom separator meets 3:1 against the Light hovered button surface");

      // Move the real browser pointer over a rendered Leaflet point that owns a
      // tooltip. This exercises Leaflet's normal hover/open path and its top arrow.
      await page.waitForFunction(() => typeof map !== "undefined" && Object.values(map._layers)
        .some((layer) => layer._tooltip && typeof layer.getLatLng === "function"), null, { timeout: 12000 });
      const tooltipPoint = await page.evaluate(() => {
        const container = map.getContainer();
        const box = container.getBoundingClientRect();
        for (const layer of Object.values(map._layers)) {
          if (!layer._tooltip || typeof layer.getLatLng !== "function") continue;
          const point = map.latLngToContainerPoint(layer.getLatLng());
          const x = Math.round(box.left + point.x);
          const y = Math.round(box.top + point.y);
          if (x < 2 || y < 2 || x >= innerWidth - 2 || y >= innerHeight - 2) continue;
          if (document.elementFromPoint(x, y)?.closest("#map")) return { x, y };
        }
        return null;
      });
      assert.ok(tooltipPoint, "a visible tooltip-enabled map feature is present");
      await page.mouse.move(tooltipPoint.x, tooltipPoint.y);
      await page.waitForSelector(".leaflet-tooltip-top", { state: "visible" });
      const tooltip = await page.evaluate(() => ({
        background: getComputedStyle(document.querySelector(".leaflet-tooltip-top")).backgroundColor,
        text: getComputedStyle(document.querySelector(".leaflet-tooltip-top")).color,
        arrow: getComputedStyle(document.querySelector(".leaflet-tooltip-top"), ":before").borderTopColor,
      }));
      assert.equal(tooltip.text, appearance === "dark" ? "rgb(255, 255, 255)" : "rgb(22, 34, 47)");
      assert.equal(tooltip.arrow, appearance === "dark" ? "rgb(49, 70, 93)" : "rgb(116, 128, 142)");

      // The top arrow repeats the pointer-to-feature association: the real
      // marker remains the hover target while its tooltip is open. It is not
      // treated as an essential non-text cue over heterogeneous tile pixels.

      // Real minimum-zoom interaction: Leaflet must expose and visually mute an
      // inactive control; its text is covered by the WCAG inactive-component exception.
      await page.evaluate(() => window.__HALO_REGRESSION__.setZoom(0));
      const zoomOut = page.locator(".leaflet-control-zoom-out");
      await page.waitForFunction(() => {
        const button = document.querySelector(".leaflet-control-zoom-out");
        return button?.classList.contains("leaflet-disabled") && button.getAttribute("aria-disabled") === "true";
      });
      const disabled = await zoomOut.evaluate((node) => ({
        opacity: getComputedStyle(node).opacity,
        foreground: getComputedStyle(node).color,
        state: node.getAttribute("aria-disabled"),
      }));
      assert.equal(disabled.state, "true");
      assert.equal(disabled.opacity, appearance === "dark" ? "0.56" : "1");
      assert.equal(disabled.foreground, appearance === "dark" ? "rgb(255, 255, 255)" : "rgb(102, 117, 134)");
      const disabledBounds = await zoomOut.boundingBox();
      await page.mouse.click(disabledBounds.x + disabledBounds.width / 2, disabledBounds.y + disabledBounds.height / 2);
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => eval("map").getZoom()), 0,
        "a click on the inactive zoom-out control leaves the map at its minimum zoom");
      await page.locator(".leaflet-control-zoom-in").click();
      await page.waitForFunction(() => !document.querySelector(".leaflet-control-zoom-out")?.classList.contains("leaflet-disabled"));
      assert.equal(await zoomOut.getAttribute("aria-disabled"), "false", "zoom-out returns to an active state after a real zoom-in");

      // Keyboard reaches actual Leaflet zoom anchors and T-a2 focus roles stay in effect.
      await page.evaluate(() => document.activeElement?.blur());
      let focusVisible = false;
      for (let i = 0; i < 18 && !focusVisible; i += 1) {
        await page.keyboard.press("Tab");
        focusVisible = await page.locator(".leaflet-control-zoom a:focus-visible").count() > 0;
      }
      assert.ok(focusVisible, "keyboard navigation reaches a Leaflet zoom control with visible focus");
      const focus = await page.locator(".leaflet-control-zoom a:focus-visible").evaluate((node) => ({
        outlineWidth: getComputedStyle(node).outlineWidth,
        outlineOffset: getComputedStyle(node).outlineOffset,
        separation: getComputedStyle(node).boxShadow,
      }));
      assert.equal(focus.outlineWidth, "2px");
      assert.equal(focus.outlineOffset, "3px");
      assert.match(focus.separation, /0px 0px 0px 1px/);

      // Attribution link receives actual keyboard focus and keeps its underline.
      await page.locator(".leaflet-control-attribution a[href]").first().focus();
      assert.equal(await page.locator(".leaflet-control-attribution a[href]").first().evaluate((node) => getComputedStyle(node).textDecorationLine), "underline");
    } finally {
      await context.close();
    }
  }
  assert.equal(appearanceResults.length, 12, "six bounded states per appearance cover all basemaps, widths and languages");
  t.diagnostic(JSON.stringify({ renderedStates: appearanceResults }));
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});
