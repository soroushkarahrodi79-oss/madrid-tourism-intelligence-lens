import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const BASE_SHA = "7f7240ee20f4bc9359df8b639902f2c0558ba185";
const SITE = "https://soroushkarahrodi79-oss.github.io/madrid-tourism-intelligence-lens";
const CANDIDATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASELINE = process.env.TA2_BASE_ROOT;
const OUTPUT = path.dirname(fileURLToPath(import.meta.url));
const MIME = new Map([[".html", "text/html"], [".css", "text/css"], [".js", "text/javascript"], [".json", "application/json"], [".geojson", "application/geo+json"], [".svg", "image/svg+xml"], [".png", "image/png"], [".woff2", "font/woff2"]]);
const SELECTORS = [
  "#evidenceDrawer", ".drawer-head", ".drawer-close", ".drawer-reading", ".reading-btn",
  ".drawer-record", ".drawer-source", ".drawer-ceiling", ".drawer-share", ".drawer-action",
  ".header-tools select", ".mode-btn", ".scope-rail-item", "#haloToggle", ".switch input",
  ".switch span", ".hospitality-select-wrap", ".hospitality-controls select", ".panel-resize-handle",
  ".area-source-toggle", ".skip-link", ".planning-membership-seeall", ".halo-glyph", ".ambito-metric-focus",
];
const PROPERTIES = ["color", "backgroundColor", "borderTopColor", "borderTopWidth", "borderTopStyle", "outlineColor", "outlineStyle", "outlineWidth", "outlineOffset", "boxShadow", "opacity", "position", "display", "visibility", "width", "height", "borderRadius", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

async function inputs() {
  if (!BASELINE || git(BASELINE, "rev-parse", "HEAD") !== BASE_SHA) throw new Error("TA2_BASE_ROOT must name the clean T-a2 base worktree.");
  if (git(CANDIDATE, "rev-parse", "HEAD") !== BASE_SHA) throw new Error("Candidate is not based on the verified main SHA.");
  if (git(BASELINE, "status", "--porcelain").length) throw new Error("Baseline worktree must be clean.");
  const candidateChanges = git(CANDIDATE, "diff", "--name-only", "HEAD").split(/\r?\n/).filter(Boolean);
  if (candidateChanges.some((file) => file !== "css/app.css")) throw new Error(`Unexpected candidate changes: ${candidateChanges.join(", ")}`);
  const manifestResponse = await fetch(`${SITE}/data/deployment_manifest.json`, { cache: "no-store" });
  const manifestBytes = Buffer.from(await manifestResponse.arrayBuffer());
  if (!manifestResponse.ok) throw new Error("Could not fetch current Pages deployment manifest.");
  const manifest = JSON.parse(manifestBytes);
  if (manifest.commit !== BASE_SHA || manifest.build_state !== "pass") throw new Error("Deployed baseline does not match the verified main SHA/build state.");
  const poiResponse = await fetch(`${SITE}/data/runtime_poi.json`, { cache: "no-store" });
  const poiBytes = Buffer.from(await poiResponse.arrayBuffer());
  if (!poiResponse.ok) throw new Error("Could not fetch deployment POI snapshot.");
  return { manifest, manifestSha256: hash(manifestBytes), poiBytes, poiSha256: hash(poiBytes) };
}

function serve(root, input) {
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
    if (pathname === "/data/runtime_poi.json") return res.writeHead(200, { "content-type": "application/json" }).end(input.poiBytes);
    if (pathname === "/js/runtime-config.js") {
      const r = await fetch(`${SITE}/js/runtime-config.js`, { cache: "no-store" });
      return res.writeHead(r.status, { "content-type": "text/javascript" }).end(Buffer.from(await r.arrayBuffer()));
    }
    let decoded; try { decoded = decodeURIComponent(pathname); } catch { return res.writeHead(400).end(); }
    const target = path.resolve(root, `.${decoded === "/" ? "/index.html" : decoded}`);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) return res.writeHead(403).end();
    try {
      const bytes = await fs.readFile(target);
      res.writeHead(200, { "content-type": MIME.get(path.extname(target)) || "application/octet-stream", "cache-control": "no-store" }).end(bytes);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` })); });
}

async function open(browser, url, viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, locale: "en-US" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => document.querySelector("#layerSourceNote")?.textContent.includes("DEPLOYMENT SNAPSHOT"), null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  return { page, errors };
}

async function sample(page) {
  return page.evaluate(({ selectors, properties }) => selectors.map((selector) => ({
    selector,
    nodes: [...document.querySelectorAll(selector)].map((node) => {
      const style = getComputedStyle(node), box = node.getBoundingClientRect();
      return { visible: !!node.getClientRects().length && style.display !== "none" && style.visibility !== "hidden", focusVisible: node.matches(":focus-visible"), computed: Object.fromEntries(properties.map((name) => [name, style[name]])), box: { x: box.x, y: box.y, width: box.width, height: box.height } };
    }),
  })), { selectors: SELECTORS, properties: PROPERTIES });
}

async function keyboardChecks(page) {
  const results = [];
  await page.keyboard.press("Tab");
  const firstTabStop = await page.evaluate(() => ({ name: document.activeElement?.id || document.activeElement?.className || document.activeElement?.tagName, focusVisible: document.activeElement?.matches(":focus-visible") }));
  const targets = [".header-tools select", '.mode-btn[data-mode="PLACE"]', ".scope-rail-item"];
  for (const selector of targets) {
    await page.locator(selector).first().focus();
    const state = await page.evaluate((selector) => {
      const node = document.activeElement, style = getComputedStyle(node);
      return { active: node?.id || node?.className || node?.tagName, selector, focusVisible: node?.matches(":focus-visible"), outline: `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`, outlineOffset: style.outlineOffset, boxShadow: style.boxShadow };
    }, selector);
    results.push({ isolatedAfterKeyboardTabModality: true, ...state });
  }
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#evidenceDrawer")?.open);
  const close = page.locator("#evidenceDrawerClose");
  const closeFocus = await close.evaluate((node) => { const s = getComputedStyle(node); return { found: node === document.activeElement, focusVisible: node.matches(":focus-visible"), outline: `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}`, outlineOffset: s.outlineOffset, boxShadow: s.boxShadow }; });
  results.push({ selector: "#evidenceDrawerClose", ...closeFocus });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("#evidenceDrawer")?.open);
  results.push({ selector: "drawer return focus", returnedToRail: await page.locator(".scope-rail-item").first().evaluate((node) => node === document.activeElement) });
  await page.locator("#modeCompareButton").click();
  await page.waitForFunction(() => document.querySelector("#analysisPanel")?.dataset.mode === "COMPARE");
  await page.keyboard.press("Tab");
  await page.locator("#haloToggle").focus();
  results.push({ selector: "#haloToggle", isolatedAfterKeyboardTabModality: true, ...(await page.locator("#haloToggle").evaluate((node) => { const s = getComputedStyle(node); return { focusVisible: node.matches(":focus-visible"), outline: `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}`, outlineOffset: s.outlineOffset, boxShadow: s.boxShadow }; })) });
  return { firstTabStop, states: results };
}

async function statePair(browser, baseUrl, candidateUrl, id, viewport, openDrawer) {
  const base = await open(browser, baseUrl, viewport), candidate = await open(browser, candidateUrl, viewport);
  if (openDrawer) {
    for (const page of [base.page, candidate.page]) {
      const opener = page.locator(".scope-rail-item").first();
      await opener.focus(); await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelector("#evidenceDrawer")?.open);
      await page.locator("#evidenceDrawerClose").focus();
      await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
    }
  }
  const [baseStyles, candidateStyles] = await Promise.all([sample(base.page), sample(candidate.page)]);
  const differences = [];
  for (let i = 0; i < baseStyles.length; i++) if (JSON.stringify(baseStyles[i]) !== JSON.stringify(candidateStyles[i])) differences.push({ selector: baseStyles[i].selector, baseline: baseStyles[i].nodes, candidate: candidateStyles[i].nodes });
  const basePng = await base.page.screenshot({ fullPage: false, animations: "disabled" });
  const candidatePng = await candidate.page.screenshot({ fullPage: false, animations: "disabled" });
  const pixelDiff = basePng.equals(candidatePng) ? { dimensionsEqual: true, changedPixels: 0, changedChannels: 0, maxChannelDelta: 0, boundingBox: null } : await base.page.evaluate(async ([baseline, candidate]) => {
    const decode = async (data) => { const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode(); return image; };
    const [a, b] = await Promise.all([decode(baseline), decode(candidate)]);
    if (a.width !== b.width || a.height !== b.height) return { dimensionsEqual: false, baseline: [a.width, a.height], candidate: [b.width, b.height] };
    const canvas = document.createElement("canvas"); canvas.width = a.width; canvas.height = a.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(a, 0, 0); const left = context.getImageData(0, 0, a.width, a.height).data;
    context.clearRect(0, 0, a.width, a.height); context.drawImage(b, 0, 0); const right = context.getImageData(0, 0, b.width, b.height).data;
    let pixels = 0, channels = 0, maxDelta = 0, minX = a.width, minY = a.height, maxX = -1, maxY = -1;
    for (let p = 0; p < left.length; p += 4) {
      let changed = false;
      for (let c = 0; c < 4; c++) { const delta = Math.abs(left[p + c] - right[p + c]); if (delta) { channels++; changed = true; maxDelta = Math.max(maxDelta, delta); } }
      if (changed) { pixels++; const i = p / 4, x = i % a.width, y = Math.floor(i / a.width); minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    }
    return { dimensionsEqual: true, changedPixels: pixels, changedChannels: channels, maxChannelDelta: maxDelta, boundingBox: pixels ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null };
  }, [basePng.toString("base64"), candidatePng.toString("base64")]);
  const file = `screenshots/${id}.png`;
  await fs.writeFile(path.join(OUTPUT, file), candidatePng);
  const result = { id, viewport, drawerOpen: openDrawer, baselineScreenshotSha256: hash(basePng), candidateScreenshotSha256: hash(candidatePng), screenshotBytesEqual: basePng.equals(candidatePng), pixelDiff, candidateScreenshot: file, computedStylesEqual: !differences.length, differences, baselineErrors: base.errors, candidateErrors: candidate.errors, baselineStyles: baseStyles, candidateStyles };
  await base.page.close(); await candidate.page.close();
  return result;
}

async function main() {
  const input = await inputs();
  await fs.mkdir(path.join(OUTPUT, "screenshots"), { recursive: true });
  const baseServer = await serve(BASELINE, input), candidateServer = await serve(CANDIDATE, input);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const captures = [];
    for (const [name, viewport] of [["desktop", { width: 1440, height: 900 }], ["tablet", { width: 834, height: 1112 }], ["mobile", { width: 390, height: 844 }]]) {
      captures.push(await statePair(browser, baseServer.url, candidateServer.url, `${name}-drawer-closed`, viewport, false));
      captures.push(await statePair(browser, baseServer.url, candidateServer.url, `${name}-drawer-open`, viewport, true));
    }
    const focusBase = await open(browser, baseServer.url, { width: 1440, height: 900 });
    const focusCandidate = await open(browser, candidateServer.url, { width: 1440, height: 900 });
    const focusBaseline = await keyboardChecks(focusBase.page), focusCandidateStyles = await keyboardChecks(focusCandidate.page);
    await focusBase.page.close(); await focusCandidate.page.close();
    const forcedColors = [];
    for (const url of [baseServer.url, candidateServer.url]) {
      const { page } = await open(browser, url, { width: 1440, height: 900 });
      await page.emulateMedia({ forcedColors: "active" });
      await page.locator(".mode-btn[data-mode='PLACE']").focus();
      forcedColors.push(await page.evaluate(() => ({ active: matchMedia("(forced-colors: active)").matches, outlineColor: getComputedStyle(document.activeElement).outlineColor, outlineWidth: getComputedStyle(document.activeElement).outlineWidth, boxShadow: getComputedStyle(document.activeElement).boxShadow, backgroundColor: getComputedStyle(document.activeElement).backgroundColor })));
      await page.close();
    }
    const report = { schema: "ux-t1-ta2-drawer-focus-parity/1.0", baseSha: BASE_SHA, candidateWorkingTree: git(CANDIDATE, "status", "--short"), deployment: { commit: input.manifest.commit, buildState: input.manifest.build_state, workflowRun: input.manifest.workflow_run, manifestSha256: input.manifestSha256, poiSha256: input.poiSha256 }, browser: { name: "Chromium", version: browser.version(), deviceScaleFactor: 1, headless: true }, selectorSet: SELECTORS, propertySet: PROPERTIES, captures, keyboardFocus: { baseline: focusBaseline, candidate: focusCandidateStyles }, windowsForcedColorsEmulation: forcedColors, note: "Chromium desktop forced-colors emulation; not a physical Windows High Contrast test or WCAG conformance result." };
    await fs.writeFile(path.join(OUTPUT, "parity.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ browser: report.browser, deployment: report.deployment, captures: captures.map(({ id, computedStylesEqual, screenshotBytesEqual, pixelDiff, baselineErrors, candidateErrors }) => ({ id, computedStylesEqual, screenshotBytesEqual, pixelDiff, baselineErrors, candidateErrors })), keyboardFocus: { baseline: focusBaseline, candidate: focusCandidateStyles }, windowsForcedColorsEmulation: forcedColors }, null, 2));
    if (captures.some((c) => !c.computedStylesEqual || c.baselineErrors.length || c.candidateErrors.length) || JSON.stringify(focusBaseline) !== JSON.stringify(focusCandidateStyles)) throw new Error("Parity or page-error check failed.");
  } finally {
    if (browser) await browser.close();
    await Promise.all([baseServer, candidateServer].map(({ server }) => new Promise((resolve) => server.close(resolve))));
  }
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
