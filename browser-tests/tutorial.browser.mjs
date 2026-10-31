import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";

const ROOT = process.env.TUTORIAL_ROOT
  ? path.resolve(process.env.TUTORIAL_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE_NAME = process.env.TUTORIAL_BROWSER === "webkit" ? "webkit" : "chromium";
const ENGINE = ENGINE_NAME === "webkit" ? webkit : chromium;
const MIME = { ".css": "text/css", ".geojson": "application/geo+json", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const target = path.resolve(ROOT, pathname === "/" ? "index.html" : pathname.slice(1));
  if (!target.startsWith(`${ROOT}${path.sep}`) && target !== path.join(ROOT, "index.html")) return response.writeHead(403).end();
  fs.readFile(target, (error, content) => {
    if (error) return response.writeHead(404).end();
    response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" }); response.end(content);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await ENGINE.launch({ headless: true });

async function open({ width = 1280, height = 820, storage, url = "", colorScheme = "light", reducedMotion = "no-preference", delay = null } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme, reducedMotion });
  if (storage !== undefined) await context.addInitScript((value) => localStorage.setItem("madrid-lens-tutorial-v1", value), storage);
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(requestUrl.hostname)) return route.abort();
    if (delay && delay.names.some((name) => requestUrl.pathname.endsWith(name))) await new Promise((resolve) => setTimeout(resolve, delay.ms));
    return route.continue();
  });
  await page.goto(`http://127.0.0.1:${port}/${url}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.MadridLensTutorial) && Boolean(document.querySelector("#map .leaflet-pane")));
  page.context_ = context; page.errors_ = errors; return page;
}
const close = (page) => page.context_.close();

async function startManual(page) {
  await page.locator("#tutorialHelpButton").click();
  await page.locator("#tutorialGuide").waitFor();
}

async function goToStep(page, index) {
  for (let step = 0; step < index; step += 1) await page.locator("[data-tutorial-next]").click();
  await page.locator("#tutorialGuide").waitFor();
}

async function workspaceState(page) {
  return page.evaluate(() => {
    const api = window.__QUESTION_EXPLORER_TEST__;
    const context = api.context();
    const url = new URL(location.href);
    const registry = api.registry();
    return {
      mode: document.getElementById("analysisPanel").dataset.mode,
      lens: context.lens,
      lensA: url.searchParams.get("a"),
      lensB: url.searchParams.get("b"),
      radii: window.__GEO_SEARCH_TEST__.radii(),
      basemap: document.getElementById("basemapSelect").value,
      layers: [...document.querySelectorAll("[data-layer]")].filter((input) => input.checked).map((input) => input.dataset.layer).sort(),
      ambitoA: document.getElementById("ambitoSelectA").value,
      ambitoB: document.getElementById("ambitoSelectB").value,
      licenceWindow: context.licenceWindow,
      canonicalUrl: location.href,
      registrySameObject: registry === window.__tutorialRegistryReference,
      registryProbe: registry.sourceProvenance("planning_ambito_geometry"),
      answer: api.snapshot(),
      objectUrlCalls: window.__tutorialObjectUrlCalls,
      dossierRequests: performance.getEntriesByType("resource").filter((entry) => entry.name.includes("evidence-dossier.js")).length,
    };
  });
}

test("first visit, legacy preferences, shared links and harnesses keep invitation behavior backward compatible", async (t) => {
  const first = await open();
  await first.locator("#tutorialInvite").waitFor();
  assert.match(await first.locator("#tutorialInvite").textContent(), /optional and self-paced/i);
  await first.locator("[data-tutorial-later]").click();
  assert.equal(await first.evaluate(() => localStorage.getItem("madrid-lens-tutorial-v1")), "1:dismissed");
  await first.reload({ waitUntil: "domcontentloaded" }); await first.waitForTimeout(600);
  assert.equal(await first.locator("#tutorialInvite").count(), 0, "dismissed V1 preference is not re-invited");
  await startManual(first);
  assert.match(await first.locator("#tutorialGuide").textContent(), /Step 1 of 8/);
  await close(first);

  for (const stored of ["1:completed", "1:dismissed"]) {
    const returning = await open({ storage: stored });
    await returning.waitForTimeout(600); assert.equal(await returning.locator("#tutorialInvite").count(), 0, stored);
    await startManual(returning); assert.match(await returning.locator("#tutorialGuide").textContent(), /Understand the Lens/);
    await close(returning);
  }
  for (const url of ["?v=1", "?haloRegressionTest=1"]) {
    const suppressed = await open({ url });
    await suppressed.waitForTimeout(600); assert.equal(await suppressed.locator("#tutorialInvite").count(), 0, url);
    assert.equal(await suppressed.locator("#tutorialHelpButton").count(), 1, "manual replay stays available");
    await close(suppressed);
  }
});

test("the eight-step bilingual tour has distinct completion, Back, Escape, Skip and focus return", async (t) => {
  const page = await open({ storage: "1:completed" }); t.after(() => close(page));
  await startManual(page);
  assert.equal(await page.locator(".tutorial-progress").getAttribute("role"), "status");
  assert.equal(await page.locator(".tutorial-progress").getAttribute("aria-live"), "polite");
  await page.locator("[data-tutorial-next]").click();
  assert.match(await page.locator("#tutorialGuide").textContent(), /Find an official place/);
  await page.locator("[data-tutorial-back]").click();
  assert.match(await page.locator("#tutorialGuide").textContent(), /Understand the Lens/);
  for (let step = 0; step < 8; step += 1) await page.locator("[data-tutorial-next]").click();
  assert.match(await page.locator("#tutorialGuide").textContent(), /Tour complete/);
  assert.doesNotMatch(await page.locator("#tutorialGuide").textContent(), /Step 8 of 8/);
  await page.locator("[data-tutorial-finish]").click();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "tutorialHelpButton");
  assert.equal(await page.evaluate(() => localStorage.getItem("madrid-lens-tutorial-v1")), "1:completed");

  await startManual(page); await page.keyboard.press("Escape");
  assert.equal(await page.locator("#tutorialGuide").count(), 0); assert.equal(await page.evaluate(() => document.activeElement?.id), "tutorialHelpButton");
  await startManual(page); await page.locator("[data-tutorial-skip]").click();
  assert.equal(await page.locator("#tutorialGuide").count(), 0); assert.equal(await page.evaluate(() => document.activeElement?.id), "tutorialHelpButton");

  await startManual(page); await page.locator("#languageSelect").selectOption("es");
  assert.match(await page.locator("#tutorialGuide").textContent(), /Paso 1 de 8|Comprende la Lente/);
  await goToStep(page, 5);
  assert.match(await page.locator("#tutorialGuide").textContent(), /seis preguntas|K13|abstención/);
  assert.deepEqual(page.errors_, []);
});

test("tour preserves active reading, registry and a completed M2 answer and never invokes M3", async (t) => {
  const page = await open({ storage: "1:completed", url: "?haloRegressionTest=1" }); t.after(() => close(page));
  await page.waitForFunction(() => Boolean(window.__QUESTION_EXPLORER_TEST__) && Boolean(window.__GEO_SEARCH_TEST__));
  await page.evaluate(() => window.__QUESTION_EXPLORER_TEST__.whenReady());
  await page.waitForFunction(() => {
    const context = window.__QUESTION_EXPLORER_TEST__.context();
    return context.readiness.planning === "ready" && window.__QUESTION_EXPLORER_TEST__.registry();
  });
  const licences = page.locator('[data-layer="licences"]');
  if (!await licences.isChecked()) await licences.locator("xpath=..").click();
  await page.waitForFunction(() => {
    const context = window.__QUESTION_EXPLORER_TEST__.context();
    return context.readiness.licences === "ready" && Boolean(context.licenceWindow);
  });
  await page.evaluate(() => window.__QUESTION_EXPLORER_TEST__.view().ask("AMBITO_AT_POINT"));
  await page.waitForFunction(() => ["answered", "abstained"].includes(window.__QUESTION_EXPLORER_TEST__.snapshot()?.kind));
  await page.evaluate(() => {
    const api = window.__QUESTION_EXPLORER_TEST__;
    window.__tutorialRegistryReference = api.registry();
    window.__tutorialObjectUrlCalls = 0;
    const nativeCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (...args) => { window.__tutorialObjectUrlCalls += 1; return nativeCreateObjectURL(...args); };
  });
  const before = await workspaceState(page);

  await startManual(page);
  await goToStep(page, 5);
  const navigation = page.locator("[data-tutorial-navigate]");
  assert.equal(await navigation.count(), 1, "a closed inline Question Explorer retains its explicit tour reveal action");
  await navigation.click();
  await page.waitForFunction(() => {
    const panel = document.getElementById("geoSearchPanel");
    const questions = document.getElementById("geoSearchQuestions");
    return panel?.dataset.presentation === "inline"
      ? Boolean(questions?.open && !document.getElementById("questionExplorer")?.hidden)
      : document.getElementById("geoSearchToggle")?.getAttribute("aria-expanded") === "true";
  });
  await page.locator("[data-tutorial-next]").click();
  assert.match(await page.locator("#tutorialGuide").textContent(), /Create one evidence dossier/);
  await page.locator("[data-tutorial-next]").click();
  assert.match(await page.locator("#tutorialGuide").textContent(), /Verify and reproduce/);
  await page.locator("[data-tutorial-next]").click();
  await page.locator("[data-tutorial-finish]").click();

  const after = await workspaceState(page);
  assert.deepEqual(after, before);
  assert.equal(after.objectUrlCalls, 0, "no dossier download was created");
  assert.equal(after.dossierRequests, 0, "the M3 module was not requested");
  assert.deepEqual(page.errors_, []);
});

test("responsive Light/Dark ES/EN tour stays contained and uses honest M2/M3 fallbacks", async (t) => {
  const page = await open({ storage: "1:completed", width: 1440, height: 900, reducedMotion: "reduce" }); t.after(() => close(page));
  await startManual(page);
  const viewports = [[320,568],[390,844],[430,932],[768,1024],[834,1112],[1024,768],[1366,768],[1440,900]];
  for (let index = 0; index < viewports.length; index += 1) {
    const [width, height] = viewports[index];
    await page.setViewportSize({ width, height });
    await page.selectOption("#appearanceSelect", index % 2 ? "dark" : "light");
    await page.selectOption("#languageSelect", index % 2 ? "es" : "en");
    const guide = page.locator("#tutorialGuide");
    await guide.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    const geometry = await guide.evaluate((node) => {
      const r = node.getBoundingClientRect();
      const buttons = [...node.querySelectorAll("button")].map((button) => { const b = button.getBoundingClientRect(); return { width: b.width, height: b.height }; });
      return { rect: { left:r.left,right:r.right,top:r.top,bottom:r.bottom }, scrollable: node.scrollHeight >= node.clientHeight, buttons };
    });
    assert.ok(geometry.rect.left >= -1 && geometry.rect.right <= width + 1, `${width}×${height}: horizontal containment`);
    assert.ok(geometry.rect.top >= -1 && geometry.rect.bottom <= height + 1, `${width}×${height}: vertical containment`);
    assert.ok(geometry.buttons.every(({ width: w, height: h }) => w >= 44 && h >= 44), `${width}×${height}: touch targets`);
    await guide.focus(); await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => ({
      inside: Boolean(document.activeElement?.closest("#tutorialGuide")),
      outline: getComputedStyle(document.activeElement).outlineStyle,
    }));
    assert.equal(focused.inside, true, `${width}×${height}: focus remains in guide controls`);
    assert.notEqual(focused.outline, "none", `${width}×${height}: visible keyboard focus`);
    const highlight = page.locator("#tutorialHighlight");
    if (await highlight.count()) {
      const h = await highlight.boundingBox();
      assert.ok(h.x >= -1 && h.y >= -1 && h.x + h.width <= width + 1 && h.y + h.height <= height + 1, `${width}×${height}: highlight inside viewport`);
    }
    if (index < viewports.length - 1) await page.locator("[data-tutorial-next]").click();
  }
  assert.equal(await page.locator("#qxAnswer .qx-action-dossier").count(), 0, "no fake dossier action exists without an answer");
  assert.match(await page.locator("#tutorialGuide").textContent(), /K11|K13|Evidencia y límites/);
  if (ENGINE_NAME === "chromium") {
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    assert.equal(await page.evaluate(() => matchMedia("(forced-colors: active)").matches), true);
    assert.equal(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), true);
    assert.notEqual(await page.locator("#tutorialGuide").evaluate((node) => getComputedStyle(node).borderStyle), "none");
  }
  assert.deepEqual(page.errors_, []);
});

test("finder loading uses the real M1 fallback without hiding tutorial controls", async (t) => {
  const page = await open({
    storage: "1:completed", width: 390, height: 844,
    delay: { names: ["madrid_admin.geojson", "madrid_ambitos.geojson"], ms: 7000 },
  });
  t.after(() => close(page));
  await startManual(page); await goToStep(page, 5);
  assert.equal(await page.locator("#geoSearchToggle").count(), 1);
  assert.equal(await page.locator("#qxAnswer .qx-action-dossier").count(), 0);
  assert.match(await page.locator("#tutorialGuide").textContent(), /registered evidence questions/);
  assert.equal(await page.locator("[data-tutorial-navigate]").isEnabled(), true);
  await page.locator("[data-tutorial-navigate]").click();
  assert.equal(await page.locator("#geoSearchPanel").getAttribute("data-presentation"), "overlay");
  assert.equal(await page.locator("#geoSearchToggle").getAttribute("aria-expanded"), "true");
  assert.equal(await page.locator("#tutorialGuide").count(), 1);
  assert.deepEqual(page.errors_, []);
});

test("closing or skipping while M2 loads cancels the pending question reveal", async () => {
  for (const exit of ["close", "skip"]) {
    const page = await open({
      storage: "1:completed", width: 390, height: 844,
      delay: { names: ["madrid_admin.geojson", "madrid_ambitos.geojson"], ms: 1500 },
    });
    try {
      await page.evaluate(() => {
        window.__tutorialScrollTargets = [];
        const nativeScrollIntoView = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (...args) {
          window.__tutorialScrollTargets.push(this.id || this.className || this.tagName);
          return nativeScrollIntoView.apply(this, args);
        };
      });
      await startManual(page); await goToStep(page, 5);
      await page.evaluate((action) => {
        document.querySelector("[data-tutorial-navigate]").click();
        document.querySelector(action === "close" ? "[data-tutorial-close]" : "[data-tutorial-skip]").click();
      }, exit);
      await page.waitForTimeout(2200);
      assert.equal(await page.locator("#tutorialGuide").count(), 0, `${exit}: dismissed guide stays closed`);
      const scrolls = await page.evaluate(() => window.__tutorialScrollTargets);
      assert.equal(scrolls.includes("questionExplorer"), false, `${exit}: stale reveal does not scroll M2`);
      assert.deepEqual(page.errors_, []);
    } finally {
      await close(page);
    }
  }
});

test("exiting immediately after Show Lens controls cancels its deferred render", async (t) => {
  const page = await open({ storage: "1:completed", width: 390, height: 568 }); t.after(() => close(page));
  await page.evaluate(() => { document.getElementById("radiusSlider").style.display = "none"; });
  await startManual(page); await goToStep(page, 2);
  assert.match(await page.locator("[data-tutorial-navigate]").textContent(), /Show Lens controls/);
  await page.evaluate(() => {
    document.querySelector("[data-tutorial-navigate]").click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(100);
  assert.equal(await page.locator("#tutorialGuide").count(), 0, "deferred render cannot resurrect the guide");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "tutorialHelpButton");
  assert.deepEqual(page.errors_, []);
});

test("capture Guided Tour review states", async (t) => {
  const output = process.env.TUTORIAL_CAPTURE_DIR;
  if (!output) return t.skip("TUTORIAL_CAPTURE_DIR not set");
  const phase = process.env.TUTORIAL_CAPTURE_PHASE || "after";
  fs.mkdirSync(output, { recursive: true });
  const requested = phase === "before"
    ? [{ name:"desktop-lens", width:1440, height:900, step:0 }, { name:"phone-place", width:390, height:844, step:1 }, { name:"tablet-final", width:834, height:1112, step:5 }]
    : [{ name:"desktop-m1", width:1440, height:900, step:1 }, { name:"phone-m2", width:390, height:844, step:5 }, { name:"tablet-m3", width:834, height:1112, step:6 }, { name:"desktop-k11-k13", width:1366, height:768, step:7 }];
  for (const item of requested) {
    const page = await open({ storage: "1:completed", width:item.width, height:item.height });
    const count = await page.evaluate(() => window.MadridLensTutorial.STEP_COUNT || window.MadridLensTutorial.COPY.en.steps.length);
    await startManual(page); await goToStep(page, Math.min(item.step, count - 1));
    await page.screenshot({ path: path.join(output, `${item.name}.png`) });
    await close(page);
  }
});

test.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); });
