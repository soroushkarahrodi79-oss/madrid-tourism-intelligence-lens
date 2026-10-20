#!/usr/bin/env node
// Test-only rendered T-a3 comparison. It injects isolated preview CSS into the
// pinned live Pages build; it never edits application assets or writes data.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, renameSync } from "node:fs";
import { chromium } from "playwright";

const SITE = "https://soroushkarahrodi79-oss.github.io/madrid-tourism-intelligence-lens";
const EXPECTED_COMMIT = "216cfbd3549c5d9575da0e89013f8e4a95f7fe5b";
const EXPECTED_MANIFEST_SHA256 = "104bace30bc747f1dd9eb9d4c2bfa8ac060fc411a3fedd33f727e8208e7f61e2";
const EXPECTED_POI_SHA256 = "a482ba871adcfd195167bde82a0609b62377c82cd69c59bf7a3366687c10a68b";
const PACKAGE = path.dirname(fileURLToPath(import.meta.url));
const CURRENT = path.join(PACKAGE, "capture-current");
const RUN_ID = `${Date.now()}-${process.pid}`;
const STAGE = path.join(PACKAGE, `.capture-stage-${RUN_ID}`);
const BACKUP = path.join(PACKAGE, `.capture-backup-${RUN_ID}`);
const OUT = path.join(STAGE, "screenshots");
const EXPECTED_SCREENSHOTS = [
  "01-shipped-dark-reference-en.png", "02-shipped-dark-reference-es.png",
  "03-light-navy-b-text-safe-en.png", "04-light-graphite-b-text-safe-es.png",
  "05-light-navy-existing-cyan.png", "06-light-graphite-text-safe-satellite.png",
  "07-light-navy-graphic-dark-basemap.png", "08-grayscale-a-b-structural-check.png",
];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function pngInfo(bytes) {
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function validatePackage(root, { requireHashes = false } = {}) {
  const metadataPath = path.join(root, "capture-metadata.json");
  const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
  if (metadata.schema !== "ux-t1-ta3-rendered-preview/1.0" || metadata.sourceCommit !== EXPECTED_COMMIT || metadata.pagesCommit !== EXPECTED_COMMIT || metadata.manifestSha256 !== EXPECTED_MANIFEST_SHA256 || metadata.poiSha256 !== EXPECTED_POI_SHA256 || metadata.poiSourceMode !== "deployment-snapshot") throw new Error(`Existing/staged evidence metadata is not pinned as expected: ${metadataPath}`);
  const entries = Array.isArray(metadata.screenshots) && typeof metadata.screenshots[0] === "object"
    ? metadata.screenshots : metadata.screenshots.map((file) => ({ file }));
  if (entries.length !== EXPECTED_SCREENSHOTS.length || EXPECTED_SCREENSHOTS.some((file) => !entries.some((entry) => entry.file === file))) throw new Error(`Expected exactly the eight named images in ${root}`);
  for (const entry of entries) {
    const bytes = await fs.readFile(path.join(root, "screenshots", entry.file));
    const info = pngInfo(bytes);
    if (!info || info.width !== 1440 || info.height !== 900 || bytes.length < 100_000) throw new Error(`Invalid PNG/dimensions/size: ${entry.file}`);
    if (entry.sha256 && sha256(bytes) !== entry.sha256) throw new Error(`PNG digest mismatch: ${entry.file}`);
    if (requireHashes && !entry.sha256) throw new Error(`Missing committed PNG digest: ${entry.file}`);
    if (entry.width && (entry.width !== info.width || entry.height !== info.height)) throw new Error(`PNG dimension metadata mismatch: ${entry.file}`);
  }
  if (metadata.pageErrors?.length) throw new Error(`Page errors in evidence package: ${metadata.pageErrors.join("; ")}`);
  return metadata;
}

async function recoverLastPackage() {
  if (existsSync(CURRENT)) return;
  const backups = (await fs.readdir(PACKAGE)).filter((name) => name.startsWith(".capture-backup-")).sort().reverse();
  if (backups.length) renameSync(path.join(PACKAGE, backups[0]), CURRENT);
}

const manifestResponse = await fetch(`${SITE}/data/deployment_manifest.json`, { cache: "no-store" });
if (!manifestResponse.ok) throw new Error(`manifest HTTP ${manifestResponse.status}`);
const manifestBytes = Buffer.from(await manifestResponse.arrayBuffer());
const manifest = JSON.parse(manifestBytes);
if (sha256(manifestBytes) !== EXPECTED_MANIFEST_SHA256) throw new Error("Pages manifest digest changed; stop and review the deployment.");
if (manifest.commit !== EXPECTED_COMMIT || manifest.build_state !== "pass") {
  throw new Error(`Pages build ${manifest.commit}/${manifest.build_state}; expected ${EXPECTED_COMMIT}/pass`);
}
const poiResponse = await fetch(`${SITE}/data/runtime_poi.json`, { cache: "no-store" });
if (!poiResponse.ok) throw new Error(`runtime POI HTTP ${poiResponse.status}`);
const poiBytes = Buffer.from(await poiResponse.arrayBuffer());
const poi = JSON.parse(poiBytes);
if (sha256(poiBytes) !== EXPECTED_POI_SHA256) throw new Error("Runtime POI digest changed; stop and review the deployed data.");
if (poi.sourceMode !== "deployment-snapshot") throw new Error(`unexpected POI mode ${poi.sourceMode}`);

await recoverLastPackage();
await validatePackage(CURRENT);
for (const name of await fs.readdir(PACKAGE)) {
  if (name.startsWith(".capture-stage-")) await fs.rm(path.join(PACKAGE, name), { recursive: true, force: true });
}
await fs.mkdir(OUT, { recursive: true });
// The shipped-dark references are unaffected by the T-a4 selector correction.
// Copy them into staging; regenerate only simulated candidate images 03–08.
for (const name of EXPECTED_SCREENSHOTS.slice(0, 2)) {
  await fs.copyFile(path.join(CURRENT, "screenshots", name), path.join(OUT, name));
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(15000);
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForFunction(() => (document.querySelector("#layerSourceNote")?.textContent || "").includes("DEPLOYMENT SNAPSHOT"), null, { timeout: 45000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1000);

await page.evaluate(() => {
  const banner = document.createElement("div");
  banner.id = "ta3-preview-banner";
  banner.textContent = "T-a3 · SIMULATED DESIGN PREVIEW · NOT AN IMPLEMENTED THEME";
  document.body.append(banner);
  const card = document.createElement("section");
  card.id = "ta3-review-card";
  card.setAttribute("aria-label", "T-a3 identity samples, simulated preview only");
  card.innerHTML = `
    <div class="ta3-card-head"><strong>Identity samples</strong><span id="ta3-option"></span></div>
    <div class="ta3-badges" aria-label="Representative evidence badges">
      <span class="badge register">REGISTER</span><span class="badge observed">OBSERVED</span>
      <span class="badge snapshot">SNAPSHOT</span><span class="badge model">MODEL</span>
      <span class="badge statistics">STATISTICS</span><span class="badge licence">LICENCE</span>
      <span class="badge planning-scope-badge">PLANNING SCOPE</span>
    </div>
    <div class="ta3-pair">
      <div class="ta3-id a"><b>Lens A</b><small id="ta3-a-code"></small><span class="ta3-solid"></span><button>Lens A · active</button></div>
      <div class="ta3-id b"><b>Lens B</b><small id="ta3-b-code"></small><span class="ta3-dashed"></span><button>Lens B · compare</button></div>
    </div>
    <div class="ta3-note">Labels carry identity; B keeps its dashed cue. Badge words and category tints retain their existing meaning.</div>`;
  document.body.append(card);
});

const previewStyle = `
  #ta3-preview-banner{position:fixed;z-index:20000;left:50%;top:10px;transform:translateX(-50%);padding:8px 13px;border-radius:6px;background:#172b3b;color:#fff;font:700 11px/1.2 system-ui,sans-serif;letter-spacing:.06em;box-shadow:0 2px 10px #0004;white-space:nowrap}
  #ta3-review-card{position:fixed;z-index:19999;left:258px;bottom:38px;width:440px;padding:13px 15px;border:1px solid #aab7c4;border-radius:10px;background:rgba(255,255,255,.96);color:#16222f;box-shadow:0 8px 26px #0003;font:12px/1.4 system-ui,sans-serif}
  #ta3-review-card .ta3-card-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:9px;color:#16222f}
  #ta3-option{font-size:10px;color:#445468}
  #ta3-review-card .ta3-badges{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px}
  #ta3-review-card .badge{font:600 10px/1.2 system-ui,sans-serif;letter-spacing:.035em;padding:4px 6px;margin:0;border-radius:5px;color:#16222f!important}
  #ta3-review-card .badge.register{background:rgba(143,189,232,.12);border:1px solid rgba(143,189,232,.42)}
  #ta3-review-card .badge.observed{background:rgba(255,122,162,.12);border:1px solid rgba(255,122,162,.42)}
  #ta3-review-card .badge.snapshot{background:rgba(151,166,183,.14);border:1px solid rgba(151,166,183,.38)}
  #ta3-review-card .badge.model{background:rgba(255,176,74,.12);border:1px solid rgba(255,176,74,.42)}
  #ta3-review-card .badge.statistics{background:rgba(126,196,178,.1);border:1px solid rgba(126,196,178,.38)}
  #ta3-review-card .badge.licence{background:rgba(162,178,198,.085);border:1px solid rgba(162,178,198,.4)}
  #ta3-review-card .badge.planning-scope-badge{background:rgba(174,184,196,.1);border:1px solid rgba(174,184,196,.42)}
  #ta3-review-card .ta3-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  #ta3-review-card .ta3-id{padding:8px;border:1px solid #aab7c4;border-radius:6px;display:grid;grid-template-columns:auto 1fr;gap:5px 8px;align-items:center}
  #ta3-review-card .ta3-id small{font:10px system-ui,sans-serif;text-align:right}
  #ta3-review-card .ta3-solid,#ta3-review-card .ta3-dashed{height:0;border-top:3px solid var(--ta3-a)}
  #ta3-review-card .ta3-dashed{border-top-color:var(--ta3-b-graphic);border-top-style:dashed}
  #ta3-review-card button{grid-column:1/-1;padding:5px;border:1px solid currentColor;border-radius:5px;background:transparent;font:600 10px system-ui,sans-serif;color:inherit;text-align:left}
  #ta3-review-card .ta3-note{margin-top:8px;color:#445468;font-size:10px}
  body.ta3-light{--bg:#f4f6f9;--panel:rgba(255,255,255,.92);--panel2:rgba(244,246,249,.92);--text:#16222f;--muted:#445468;--text-meta:#54657a;
    --chrome-page-background:#f4f6f9;--chrome-header-surface:rgba(255,255,255,.96);--chrome-panel-surface:rgba(255,255,255,.94);--chrome-card-surface:rgba(255,255,255,.8);--chrome-control-group-surface:#edf1f5;--chrome-form-surface:#fff;
    --chrome-text-primary:#16222f;--chrome-text-metadata:#54657a;--chrome-text-brand-subtle:#445468;--chrome-text-section:#445468;--chrome-text-control-label:#445468;--chrome-text-control-value:#16222f;--chrome-text-control-caption:#445468;--chrome-text-control-strong:#16222f;--chrome-text-card-title:#273747;--chrome-border:rgba(16,24,34,.18);--chrome-divider:rgba(16,24,34,.12);
    --chrome-drawer-surface:#fff;--chrome-drawer-border:rgba(16,24,34,.22);--chrome-drawer-divider:rgba(16,24,34,.18);--chrome-drawer-control-surface:#f4f6f9;--chrome-drawer-record-surface:#f7f8fa;--chrome-drawer-neutral-surface:#f4f6f9;--chrome-drawer-share-surface:#edf1f5;--chrome-drawer-provenance-divider:rgba(16,24,34,.12);--chrome-drawer-edition-border:rgba(16,24,34,.2);--chrome-focus-ring-color:#0a63c7;--chrome-focus-separation-color:#fff}
  body.ta3-light .left,body.ta3-light .panel,body.ta3-light header{color:#16222f;background:rgba(255,255,255,.94);border-color:rgba(16,24,34,.18);box-shadow:0 5px 20px rgba(25,42,58,.12)}
  body.ta3-light .panel *{color:#34495b!important}
  body.ta3-light .left *:not(.dot){color:#34495b!important}
  body.ta3-light header *{color:#34495b!important}
  body.ta3-light .panel .mode-btn[aria-pressed="true"],body.ta3-light .panel .lensbtn.active{background:#e8eef4!important;color:#16222f!important;border-color:#6d8093!important}
  body.ta3-light .title,body.ta3-light .brand-title,body.ta3-light .section-head span,body.ta3-light .cb-lens,body.ta3-light .metric-value,body.ta3-light .area-value,body.ta3-light .area-vut-value{color:#16222f}
  body.ta3-light .section-head small,body.ta3-light .area-context,body.ta3-light .area-codes,body.ta3-light .area-value-label,body.ta3-light .area-period,body.ta3-light .area-scope p,body.ta3-light .metric-head,body.ta3-light .metric-foot,body.ta3-light .metric-value small{color:#445468}
  body.ta3-light .area-figure,body.ta3-light .metric,body.ta3-light .controlbox,body.ta3-light .card,body.ta3-light .place-circle-reading{background:#fff;border-color:rgba(16,24,34,.16)}
  body.ta3-light .lensbtn{color:#445468;background:#fff;border-color:rgba(16,24,34,.2)}
  body.ta3-light .lensbtn.active.a{color:#16222f;border-color:var(--ta3-a);background:color-mix(in srgb,var(--ta3-a) 8%,white)}
  body.ta3-light .lensbtn.active.b{color:var(--ta3-b-text);border-color:var(--ta3-b-graphic);background:color-mix(in srgb,var(--ta3-b-graphic) 8%,white)}
  body.ta3-light .badge{color:#16222f!important}
  body.ta3-light .cb-side-a .cb-lens,body.ta3-light .lens-a{color:var(--ta3-a)!important}
  body.ta3-light .cb-side-b .cb-lens,body.ta3-light .lens-b{color:var(--ta3-b-text)!important}
  body.ta3-light .panel .badge{color:#16222f!important}
  body.ta3-light .ambito-pick-tag.ac-a,body.ta3-light .ambito-id.ac-a{color:var(--ta3-a)!important}
  body.ta3-light .ambito-pick-tag.ac-b,body.ta3-light .ambito-id.ac-b{color:var(--ta3-b-text)!important}
  body.ta3-light .marker-a{color:var(--ta3-a)!important} body.ta3-light .marker-b{color:var(--ta3-b-graphic)!important}
  body.ta3-light .halo-glyph.halo-a{--halo-color:var(--ta3-a-graphic)!important} body.ta3-light .halo-glyph.halo-b{--halo-color:var(--ta3-b-graphic)!important}
  body.ta3-light .halo-value,body.ta3-light .halo-state-mark{stroke:#08101a}
  body.ta3-light .ta3-id.a{color:var(--ta3-a)} body.ta3-light .ta3-id.b{color:var(--ta3-b-text)}
`;
await page.addStyleTag({ content: previewStyle });

async function setModeCompare() {
  if (await page.locator("#modeCompareButton").getAttribute("aria-pressed") !== "true") {
    await page.locator("#modeCompareButton").click();
    await page.waitForTimeout(400);
  }
  if ((await page.locator("#lensBButton").textContent()).toLowerCase().includes("enable")) {
    await page.locator("#lensBButton").click();
    await page.waitForTimeout(700);
  }
}
async function chooseLanguage(language) {
  await page.locator("#languageSelect").selectOption(language);
  await page.waitForTimeout(250);
}
async function chooseBasemap(basemap) {
  await page.locator("#basemapSelect").selectOption(basemap);
  await page.waitForTimeout(1500);
}
async function configure(candidate, language, basemap, halo = true) {
  await page.evaluate(({ candidate, language, basemap, halo }) => {
    const root = document.body;
    const definitions = {
      "navy-existing": { a: "#123b5f", ag: "#123b5f", bt: "#00718f", bg: "#43d7ff" },
      "navy-graphic": { a: "#123b5f", ag: "#123b5f", bt: "#00718f", bg: "#0098c0" },
      "graphite-text": { a: "#343a40", ag: "#343a40", bt: "#00718f", bg: "#00718f" },
      "graphite-graphic": { a: "#343a40", ag: "#343a40", bt: "#00718f", bg: "#0098c0" },
    };
    const d = definitions[candidate];
    root.classList.add("ta3-light");
    for (const [name, value] of Object.entries({ "--ta3-a": d.a, "--ta3-a-graphic": d.ag, "--ta3-b-text": d.bt, "--ta3-b-graphic": d.bg })) root.style.setProperty(name, value);
    document.querySelector("#ta3-option").textContent = `${candidate} · ${language.toUpperCase()} · ${basemap.toUpperCase()} basemap`;
    document.querySelector("#ta3-a-code").textContent = d.a;
    document.querySelector("#ta3-b-code").textContent = `text ${d.bt} / graphic ${d.bg}`;
    const mode = document.querySelector("#analysisPanel")?.dataset.mode;
    document.querySelector("#ta3-review-card").style.filter = "none";
    root.dataset.ta3Candidate = candidate;
    document.documentElement.lang = language;
    const haloToggle = document.querySelector("#haloToggle");
    if (haloToggle && haloToggle.checked !== halo) { haloToggle.click(); }
  }, { candidate, language, basemap, halo });
  await chooseLanguage(language);
  await setModeCompare();
  await chooseBasemap(basemap);
  await page.waitForTimeout(800);
}

async function save(name, label, candidate, language, basemap, halo = true, grayscale = false) {
  await configure(candidate, language, basemap, halo);
  await page.evaluate((label) => { document.querySelector("#ta3-preview-banner").textContent = `T-a3 · ${label} · SIMULATED / TEST-ONLY`; }, label);
  if (grayscale) await page.addStyleTag({ content: "html{filter:grayscale(1)!important}" });
  await page.screenshot({ path: path.join(OUT, name), fullPage: false });
  if (grayscale) await page.evaluate(() => document.querySelectorAll("style").forEach((n) => { if (n.textContent === "html{filter:grayscale(1)!important}") n.remove(); }));
}

await chooseLanguage("en");
await chooseBasemap("light");
await setModeCompare();
await page.locator("#ta3-review-card").evaluate((n) => n.remove());

await page.evaluate(() => {
  const card = document.createElement("section"); card.id = "ta3-review-card";
  card.innerHTML = `<div class="ta3-card-head"><strong>Identity samples</strong><span id="ta3-option"></span></div><div class="ta3-badges"><span class="badge register">REGISTER</span><span class="badge observed">OBSERVED</span><span class="badge snapshot">SNAPSHOT</span><span class="badge model">MODEL</span><span class="badge statistics">STATISTICS</span><span class="badge licence">LICENCE</span><span class="badge planning-scope-badge">PLANNING SCOPE</span></div><div class="ta3-pair"><div class="ta3-id a"><b>Lens A</b><small id="ta3-a-code"></small><span class="ta3-solid"></span><button>Lens A · active</button></div><div class="ta3-id b"><b>Lens B</b><small id="ta3-b-code"></small><span class="ta3-dashed"></span><button>Lens B · compare</button></div></div><div class="ta3-note">Labels carry identity; B keeps its dashed cue. Badge words and category tints retain their existing meaning.</div>`;
  document.body.append(card);
});
await page.addStyleTag({ content: previewStyle });

await save("03-light-navy-b-text-safe-en.png", "NAVY A · B TEXT-SAFE + CYAN GRAPHIC · EN · LIGHT BASEMAP", "navy-graphic", "en", "light");
await save("04-light-graphite-b-text-safe-es.png", "GRAPHITE A · B TEXT-SAFE + CYAN GRAPHIC · ES · LIGHT BASEMAP", "graphite-graphic", "es", "light");
await save("05-light-navy-existing-cyan.png", "NAVY A · B SHIPPED CYAN · LIGHT BASEMAP", "navy-existing", "en", "light");
await save("06-light-graphite-text-safe-satellite.png", "GRAPHITE A · B TEXT-SAFE · SATELLITE", "graphite-text", "en", "satellite");
await save("07-light-navy-graphic-dark-basemap.png", "NAVY A · B GRAPHIC CANDIDATE · DARK BASEMAP", "navy-graphic", "es", "dark");
await save("08-grayscale-a-b-structural-check.png", "GRAYSCALE STRUCTURE CHECK · GRAPHITE A / CYAN B", "graphite-graphic", "en", "light", true, true);

const contrast = await page.evaluate(() => {
  const rgb = (value) => {
    const m = value.match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const xs = m[1].split(",").map((x) => Number(x.trim()));
    return [xs[0], xs[1], xs[2], xs.length > 3 ? xs[3] : 1];
  };
  const composite = (fg, bg) => { const a = fg[3]; return [0,1,2].map((i) => fg[i]*a+bg[i]*(1-a)).concat([1]); };
  const background = (node) => {
    let color = [244,246,249,1]; const chain=[];
    for (let el=node;el&&el.nodeType===1;el=el.parentElement) chain.push(el);
    for (const el of chain.reverse()) { const c=rgb(getComputedStyle(el).backgroundColor); if(c&&c[3]>0) color=composite(c,color); }
    return color;
  };
  const lum = (rgbv) => { const a=rgbv.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*a[0]+.7152*a[1]+.0722*a[2]; };
  const hex = (x) => "#"+x.slice(0,3).map(v=>Math.round(v).toString(16).padStart(2,"0")).join("");
  const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
  const rows=[];
  for(const el of document.querySelectorAll("#ta3-review-card .badge")){
    const fg=rgb(getComputedStyle(el).color), bg=background(el);
    const fgComposite=composite(fg,bg);
    rows.push({badge:el.textContent.trim(),foreground:getComputedStyle(el).color,backgroundHex:hex(bg),textContrast:ratio(fgComposite,bg),textSizePx:parseFloat(getComputedStyle(el).fontSize),criterion:"SC 1.4.3; normal text ≥ 4.5:1"});
  }
  const style=getComputedStyle(document.body);
  const body=rgb(style.backgroundColor);
  const panelCss=rgb(getComputedStyle(document.querySelector(".panel")).backgroundColor);
  const panel=composite(panelCss,body);
  const colors={"Lens A navy #123b5f":"#123b5f","Lens A graphite #343a40":"#343a40","Lens B shipped cyan #43d7ff":"#43d7ff","Lens B graphic #0098c0":"#0098c0","Lens B text #00718f":"#00718f"};
  const roles=Object.entries(colors).map(([role,value])=>{
    const color=rgb(`rgb(${parseInt(value.slice(1,3),16)},${parseInt(value.slice(3,5),16)},${parseInt(value.slice(5,7),16)})`);
    const tint=composite([color[0],color[1],color[2],.08],panel);
    return {role,value,panelSurface:hex(panel),contrastOnPanel:ratio(color,panel),contrastOnOwn8PercentTint:ratio(color,tint),ownTintSurface:hex(tint)};
  });
  return {samples:rows, identityRoles:roles, bodyBackground:style.backgroundColor,panelBackground:getComputedStyle(document.querySelector(".panel")).backgroundColor,panelSurfaceAfterBodyComposite:hex(panel)};
});

const screenshotMetadata = [];
for (const file of EXPECTED_SCREENSHOTS) {
  const bytes = await fs.readFile(path.join(OUT, file));
  const dimensions = pngInfo(bytes);
  if (!dimensions || dimensions.width !== 1440 || dimensions.height !== 900 || bytes.length < 100_000) throw new Error(`Screenshot failed PNG integrity check: ${file}`);
  screenshotMetadata.push({ file, sha256: sha256(bytes), width: dimensions.width, height: dimensions.height, bytes: bytes.length });
}
await fs.writeFile(path.join(STAGE, "capture-metadata.json"), JSON.stringify({
  schema:"ux-t1-ta3-rendered-preview/1.0", simulated:true, productionAssetsChanged:false,
  sourceCommit:EXPECTED_COMMIT,pagesCommit:manifest.commit,manifestSha256:sha256(manifestBytes),poiSha256:sha256(poiBytes),poiSourceMode:poi.sourceMode,
  screenshots:screenshotMetadata, badgeTextContrast:contrast, pageErrors,
  previewOwnership:{
    simulatedAppearanceOwned:["T-a3 badge foreground/tint samples","Lens A/B panel and button identity","Lens A/B center marker and SVG halo colors"],
    unchangedBasemapOwned:["LENS_BASEMAP_STYLES and circle geometry","Leaflet attribution control","Leaflet zoom controls","Leaflet tooltips","basemap tiles and provider styling"],
    injectedLeafletOverrides:[]
  },
  note:"Preview CSS and badge samples exist only in this Playwright page. No T-a4 Leaflet control or tooltip selectors are overridden. Contrast computation uses computed foregrounds and browser-composited ancestor backgrounds for preview badge rows; map marks are treated as heterogeneous backgrounds and visually reviewed, not certified by one ratio."
},null,2)+"\n");
await validatePackage(STAGE, { requireHashes: true });
await browser.close();
if (pageErrors.length) throw new Error(`browser errors: ${pageErrors.join("; ")}`);
// The previous package remains recoverable until the new staged package has
// passed its complete hash/dimension/metadata checks and is in place.
renameSync(CURRENT, BACKUP);
try {
  renameSync(STAGE, CURRENT);
  await validatePackage(CURRENT, { requireHashes: true });
  await fs.rm(BACKUP, { recursive: true, force: true });
} catch (error) {
  if (existsSync(CURRENT)) await fs.rm(CURRENT, { recursive: true, force: true });
  if (existsSync(BACKUP)) renameSync(BACKUP, CURRENT);
  throw error;
}
console.log(`Captured and validated ${screenshotMetadata.length} reference/candidate PNGs from ${EXPECTED_COMMIT}; manifest=${sha256(manifestBytes)}; poi=${sha256(poiBytes)}`);
