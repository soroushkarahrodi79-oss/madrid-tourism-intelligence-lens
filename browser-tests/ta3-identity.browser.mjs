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

async function openApp(width) {
  const context = await browser.newContext({ viewport: { width, height: width <= 560 ? 760 : 900 } });
  await context.addInitScript(() => localStorage.setItem("madrid-lens-appearance", "dark"));
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === "127.0.0.1" || host === "localhost" ? route.continue() : route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__));
  await page.waitForFunction(() => /Reference ·|Referencia ·/.test(document.getElementById("scopeRailFreshness").textContent));
  return { page, context };
}

const luminance = (hex) => {
  const rgb = hex.match(/[\da-f]{2}/gi).map((part) => parseInt(part, 16) / 255);
  const linear = rgb.map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
};
const contrast = (foreground, background) => {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
};

const cssHex = (value) => {
  const parts = value.match(/[\d.]+/g).map(Number);
  return `#${parts.slice(0, 3).map((part) => Math.round(part).toString(16).padStart(2, "0")).join("")}`;
};

test("T-a3 light identity roles render safely across languages, viewports and basemaps", async (t) => {
  const app = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "css/app.css"), "utf8");
  assert.doesNotMatch(app, /HALO_GLYPH_COLORS|--halo-color:\$\{/,
    "JS must not inline a halo colour over the CSS identity roles");
  assert.match(css, /\.halo-glyph\.halo-a\{--halo-color:var\(--ta3-map-halo-a\)\}/);
  assert.match(css, /\.halo-glyph\.halo-b\{--halo-color:var\(--ta3-map-halo-b\)\}/);

  for (const width of [390, 768, 1440]) {
    const { page, context } = await openApp(width);
    try {
      assert.equal(await page.locator("html").getAttribute("data-appearance"), "dark",
        "manual Dark resolves synchronously at production startup");
      await page.locator('.mode-btn[data-mode="COMPARE"]').click();
      await page.waitForFunction(() => document.getElementById("analysisPanel").dataset.mode === "COMPARE");

      await page.evaluate(() => {
        const fixture = document.createElement("div");
        fixture.id = "ta3IdentityFixture";
        fixture.style.cssText = "position:fixed;z-index:1500;left:8px;bottom:8px;max-width:calc(100vw - 16px);display:flex;flex-wrap:wrap;align-items:center;gap:4px;background:#fff;color:#16222f;padding:8px;border:1px solid #c7ced7;border-radius:8px";
        for (const kind of ["register", "observed", "snapshot", "model", "statistics", "licence", "planning-scope-badge"]) {
          const badge = document.createElement("span");
          badge.className = `badge ${kind}`;
          badge.textContent = kind;
          fixture.append(badge);
        }
        for (const side of ["a", "b"]) {
          const button = document.createElement("button");
          button.className = `lensbtn active ${side}`;
          button.textContent = `Lens ${side.toUpperCase()}`;
          fixture.append(button);
          const pick = document.createElement("span");
          pick.className = `ambito-pick-tag ac-${side}`;
          pick.textContent = side.toUpperCase();
          fixture.append(pick);
          const identity = document.createElement("div");
          identity.className = `ambito-id ac-${side}`;
          const tag = document.createElement("span");
          tag.className = "ambito-id-tag";
          tag.textContent = side.toUpperCase();
          identity.append(tag);
          fixture.append(identity);
          const track = document.createElement("span");
          track.className = `ambito-bar-track ac-${side}`;
          const fill = document.createElement("span");
          fill.className = "ambito-bar-fill";
          fill.style.width = "50%";
          track.append(fill);
          fixture.append(track);
        }
        document.body.append(fixture);
      });

      const dark = await page.evaluate(() => {
        const color = (selector, property = "color") => getComputedStyle(document.querySelector(selector))[property];
        return {
          bridgeA: color(".cb-side-a .cb-lens"),
          bridgeB: color(".cb-side-b .cb-lens"),
          buttonA: color("#ta3IdentityFixture .lensbtn.a"),
          buttonB: color("#ta3IdentityFixture .lensbtn.b"),
          idA: color("#ta3IdentityFixture .ambito-id.ac-a", "borderLeftColor"),
          idB: color("#ta3IdentityFixture .ambito-id.ac-b", "borderLeftColor"),
          barA: color("#ta3IdentityFixture .ambito-bar-track.ac-a .ambito-bar-fill", "backgroundColor"),
          barB: color("#ta3IdentityFixture .ambito-bar-track.ac-b .ambito-bar-fill", "backgroundColor"),
          badges: [...document.querySelectorAll("#ta3IdentityFixture .badge")].map((node) => getComputedStyle(node).color),
        };
      });
      assert.equal(dark.bridgeA, "rgb(238, 245, 252)");
      assert.equal(dark.bridgeB, "rgb(67, 215, 255)");
      assert.equal(dark.buttonA, "rgb(255, 255, 255)");
      assert.equal(dark.buttonB, "rgb(116, 227, 255)");
      assert.equal(dark.idA, "rgb(156, 205, 255)");
      assert.equal(dark.idB, "rgb(67, 215, 255)");
      assert.equal(dark.barA, "rgb(156, 205, 255)");
      assert.equal(dark.barB, "rgb(67, 215, 255)");
      assert.deepEqual(dark.badges, [
        "rgb(189, 214, 239)", "rgb(255, 154, 187)", "rgb(194, 206, 219)",
        "rgb(255, 195, 109)", "rgb(159, 212, 194)", "rgb(174, 190, 208)", "rgb(212, 221, 231)",
      ]);
      await page.locator("#appearanceSelect").selectOption("light");

      for (const language of ["en", "es"]) {
        await page.locator("#languageSelect").selectOption(language);
        await page.waitForFunction((value) => document.documentElement.lang === value, language);
        for (const basemap of ["light", "dark", "satellite"]) {
          await page.evaluate((value) => {
            const select = document.getElementById("basemapSelect");
            select.value = value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
          }, basemap);
          const result = await page.evaluate(() => {
            const root = getComputedStyle(document.documentElement);
            const style = (selector) => {
              const node = document.querySelector(selector);
              const computed = getComputedStyle(node);
              return {
                color: computed.color,
                background: computed.backgroundColor,
                border: computed.borderLeftColor,
                borderStyle: computed.borderLeftStyle,
                borderTopStyle: computed.borderTopStyle,
                text: node.textContent.trim(),
              };
            };
            const badges = [...document.querySelectorAll("#ta3IdentityFixture .badge")].map((node) => {
              const computed = getComputedStyle(node);
              return { color: computed.color, background: computed.backgroundColor, border: computed.borderTopColor };
            });
            return {
              lang: document.documentElement.lang,
              basemap: document.getElementById("basemapSelect").value,
              aBridge: style(".cb-side-a .cb-lens"),
              bBridge: style(".cb-side-b .cb-lens"),
              aButton: style("#ta3IdentityFixture .lensbtn.a"),
              bButton: style("#ta3IdentityFixture .lensbtn.b"),
              aId: style("#ta3IdentityFixture .ambito-id.ac-a"),
              bId: style("#ta3IdentityFixture .ambito-id.ac-b"),
              aBar: style("#ta3IdentityFixture .ambito-bar-track.ac-a .ambito-bar-fill"),
              bBar: style("#ta3IdentityFixture .ambito-bar-track.ac-b .ambito-bar-fill"),
              badges,
              mapCenterA: root.getPropertyValue("--ta3-map-center-a").trim(),
              mapCenterB: root.getPropertyValue("--ta3-map-center-b").trim(),
              mapHaloA: root.getPropertyValue("--ta3-map-halo-a").trim(),
              mapHaloB: root.getPropertyValue("--ta3-map-halo-b").trim(),
            };
          });

          assert.equal(result.lang, language);
          assert.equal(result.basemap, basemap);
          const bounds = await page.locator("#ta3IdentityFixture").boundingBox();
          const viewport = page.viewportSize();
          assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height,
            `simulated Light identity sample is visible at ${width}px`);
          assert.equal(cssHex(result.aBridge.color), "#123b5f");
          assert.equal(cssHex(result.bBridge.color), "#00718f");
          assert.equal(cssHex(result.aButton.color), "#123b5f");
          assert.equal(cssHex(result.bButton.color), "#00718f");
          assert.equal(result.aButton.borderTopStyle, "solid");
          assert.equal(result.bButton.borderTopStyle, "dashed");
          assert.equal(result.aId.borderStyle, "solid");
          assert.equal(result.bId.borderStyle, "dashed");
          assert.equal(cssHex(result.aId.border), "#123b5f");
          assert.equal(cssHex(result.bId.border), "#0098c0");
          assert.equal(cssHex(result.aBar.background), "#123b5f");
          assert.equal(cssHex(result.bBar.background), "#0098c0");
          assert.equal(result.badges.length, 7);
          for (const badge of result.badges) {
            assert.equal(cssHex(badge.color), "#16222f");
            assert.equal(cssHex(badge.background), "#f2f4f7");
          }

          assert.ok(contrast("#123b5f", "#ffffff") >= 4.5, "Lens A UI text meets the normal-text screen");
          assert.ok(contrast("#00718f", "#ffffff") >= 4.5, "Lens B UI text meets the normal-text screen");
          assert.ok(contrast("#16222f", "#f2f4f7") >= 4.5, "neutral badge text meets the normal-text screen");
          assert.ok(contrast("#123b5f", "#ffffff") >= 3, "Lens A UI graphic clears the essential-graphic screen");
          assert.ok(contrast("#0098c0", "#ffffff") >= 3, "Lens B UI graphic clears the essential-graphic screen on its UI surface");

          const lumaA = luminance("#123b5f");
          const lumaB = luminance("#00718f");
          assert.ok(Math.abs(lumaA - lumaB) > .08, "approved A/B text remains separable in grayscale with explicit labels");

          assert.equal(result.mapCenterA, "#fff", "map center A remains unchanged pending tile gate");
          assert.equal(result.mapCenterB, "#43d7ff", "map center B remains unchanged pending tile gate");
          assert.equal(result.mapHaloA, "#f7fbff", "halo A remains unchanged pending tile gate");
          assert.equal(result.mapHaloB, "#43d7ff", "halo B remains unchanged pending tile gate");
          const screenshot = await page.screenshot({ animations: "disabled" });
          assert.deepEqual([...screenshot.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], "simulated Light state renders to PNG");
        }
      }
      t.diagnostic(`width=${width}px; locales=en/es; basemaps=light/dark/satellite; UI roles pass; map colors held`);
    } finally {
      await context.close();
    }
  }
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});
