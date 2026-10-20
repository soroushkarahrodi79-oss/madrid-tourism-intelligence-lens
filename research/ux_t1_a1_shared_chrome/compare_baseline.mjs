import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const BASE_SHA = "028d0389454b4248180654075022e4397b14fd5b";
const POI_SHA = "981449c5b52fac59835a826f89d163eae99d13a042a72acb80bcdc08acb88a70";
const MANIFEST_SHA = "bdbc5c1c85f9d9f47893b7444b824921a42245dfd3d0be362bb648be39006133";
const CANDIDATE_CSS_SHA = "ca32202595a3ec20b00f8b3b47caec16f6939eac41cc744a303fdfed527f8a9f";
const SITE = "https://soroushkarahrodi79-oss.github.io/madrid-tourism-intelligence-lens";
const CANDIDATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASELINE = process.env.TA1_BASE_ROOT;
const PACKAGE = process.env.TA1_OUTPUT_DIR ? path.resolve(process.env.TA1_OUTPUT_DIR) : null;
const MIME = new Map([[".html","text/html"],[".css","text/css"],[".js","text/javascript"],[".json","application/json"],[".geojson","application/geo+json"],[".svg","image/svg+xml"],[".png","image/png"],[".woff2","font/woff2"]]);
const SELECTORS = [
  "body", ".brand", ".brand-sub", ".left", ".left h3", ".rail-group > summary", ".map-display",
  ".mobile-layers-button", '.mobile-layers-button[aria-expanded="true"]',
  ".basemap-control label", ".map-control label", ".language-control label",
  ".basemap-control select", ".map-control select", ".language-control select", ".stay-filter label", ".stay-filter select",
  ".panel", ".panel h3", ".panel-head", ".mode-nav", ".mode-btn", ".header-tools select",
  ".card", ".card-title", ".controlbox", ".controltop", ".controltop b",
  ".badge.register", ".cb-side-a .cb-lens", ".cb-side-b .cb-lens",
];
const PROPERTIES = [
  "color","backgroundColor","borderTopColor","borderRightColor","borderBottomColor","borderLeftColor",
  "borderTopWidth","borderRightWidth","borderBottomWidth","borderLeftWidth","borderTopStyle","borderBottomStyle",
  "outlineColor","outlineStyle","outlineWidth","outlineOffset","boxShadow","backdropFilter","opacity",
  "fontSize","fontFamily","fontWeight","lineHeight","display","visibility","position","width","height",
  "minWidth","minHeight","maxWidth","maxHeight","paddingTop","paddingRight","paddingBottom","paddingLeft",
  "borderTopLeftRadius","borderTopRightRadius","borderBottomRightRadius","borderBottomLeftRadius",
];
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore","pipe","pipe"] }).trim();

async function verifiedInputs() {
  if (!BASELINE) throw new Error("Set TA1_BASE_ROOT to a clean worktree at the baseline SHA.");
  if (!PACKAGE) throw new Error("Set TA1_OUTPUT_DIR to a new, empty directory; existing evidence is never overwritten.");
  if (git(BASELINE, "rev-parse", "HEAD") !== BASE_SHA) throw new Error("Baseline worktree SHA mismatch.");
  execFileSync("git", ["-C", BASELINE, "diff", "--quiet", "HEAD", "--"], { stdio: "ignore" });
  if (git(BASELINE, "ls-files", "--others", "--exclude-standard")) throw new Error("Baseline worktree has untracked source files.");
  if (git(CANDIDATE, "merge-base", "HEAD", BASE_SHA) !== BASE_SHA) throw new Error("Candidate branch does not descend from the pinned baseline.");
  const changed = git(CANDIDATE, "diff", "--name-only", `${BASE_SHA}...HEAD`).split(/\r?\n/).filter(Boolean);
  if (changed.some((file) => file !== "css/app.css" && !file.startsWith("research/ux_t1_a1_shared_chrome/"))) {
    throw new Error(`Candidate branch contains out-of-scope files: ${changed.join(", ")}`);
  }
  execFileSync("git", ["-C", CANDIDATE, "diff", "--quiet", "HEAD", "--"], { stdio: "ignore" });
  const untracked = git(CANDIDATE, "ls-files", "--others", "--exclude-standard").split(/\r?\n/).filter(Boolean);
  if (untracked.some((file) => !file.startsWith("research/ux_t1_a1_shared_chrome/"))) {
    throw new Error(`Candidate worktree has out-of-scope untracked files: ${untracked.join(", ")}`);
  }
  const cssSha = sha256(await fs.readFile(path.join(CANDIDATE, "css/app.css")));
  if (cssSha !== CANDIDATE_CSS_SHA) throw new Error(`Candidate CSS hash mismatch: ${cssSha}`);
  try {
    const existing = await fs.readdir(PACKAGE);
    if (existing.length) throw new Error(`Output directory is not empty; refusing to overwrite: ${PACKAGE}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const manifestResponse = await fetch(`${SITE}/data/deployment_manifest.json`, { cache: "no-store" });
  const manifestBytes = Buffer.from(await manifestResponse.arrayBuffer());
  if (!manifestResponse.ok || sha256(manifestBytes) !== MANIFEST_SHA) throw new Error("Deployment manifest verification failed.");
  const deployment = JSON.parse(manifestBytes);
  if (deployment.commit !== BASE_SHA || deployment.build_state !== "pass") throw new Error("Deployment/source mismatch.");
  const poiResponse = await fetch(`${SITE}/data/runtime_poi.json`, { cache: "no-store" });
  const poiBytes = Buffer.from(await poiResponse.arrayBuffer());
  if (!poiResponse.ok || sha256(poiBytes) !== POI_SHA) throw new Error("Production snapshot verification failed.");
  return { manifestBytes, deployment, poiBytes };
}

function serve(root, poiBytes) {
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
    if (pathname === "/data/runtime_poi.json") { res.writeHead(200,{"content-type":"application/json"}).end(poiBytes); return; }
    if (pathname === "/js/runtime-config.js") {
      const upstream = await fetch(`${SITE}/js/runtime-config.js`, { cache: "no-store" });
      res.writeHead(upstream.status,{"content-type":"text/javascript","cache-control":"no-store"}).end(Buffer.from(await upstream.arrayBuffer())); return;
    }
    let decoded; try { decoded=decodeURIComponent(pathname); } catch { res.writeHead(400).end(); return; }
    const target=path.resolve(root, `.${decoded === "/" ? "/index.html" : decoded}`);
    if(target!==root&&!target.startsWith(`${root}${path.sep}`)){res.writeHead(403).end();return;}
    try { const bytes=await fs.readFile(target);res.writeHead(200,{"content-type":MIME.get(path.extname(target))||"application/octet-stream","cache-control":"no-store"}).end(bytes); }
    catch { res.writeHead(404).end(); }
  });
  return new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>resolve({server,url:`http://127.0.0.1:${server.address().port}/`}));});
}

async function open(browser,url,viewport) {
  const page=await browser.newPage({viewport,deviceScaleFactor:1,locale:"en-US"});page.setDefaultTimeout(8000);
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(url,{waitUntil:"domcontentloaded",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#layerSourceNote")?.textContent.includes("DEPLOYMENT SNAPSHOT"),null,{timeout:30000});
  await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(1200);return {page,errors};
}

async function sample(page) {
  return page.evaluate(({selectors,properties})=>selectors.map(selector=>{
    const nodes=[...document.querySelectorAll(selector)];
    return {selector,nodes:nodes.map((node,index)=>{
      const s=getComputedStyle(node),r=node.getBoundingClientRect();
      return {index,visible:node.getClientRects().length>0&&s.display!=="none"&&s.visibility!=="hidden"&&Number(s.opacity)>0,
        computed:Object.fromEntries(properties.map(p=>[p,s[p]])),box:{x:r.x,y:r.y,width:r.width,height:r.height}};
    })};
  }),{selectors:SELECTORS,properties:PROPERTIES});
}

async function statePair(browser,baseUrl,candidateUrl,id,viewport,actions) {
  const base=await open(browser,baseUrl,viewport),candidate=await open(browser,candidateUrl,viewport);
  await actions(base.page);await actions(candidate.page);
  await base.page.waitForTimeout(900);await candidate.page.waitForTimeout(900);
  const baselineStyles=await sample(base.page),candidateStyles=await sample(candidate.page);
  const differences=[];
  for(let i=0;i<baselineStyles.length;i++)if(JSON.stringify(baselineStyles[i])!==JSON.stringify(candidateStyles[i]))differences.push({selector:baselineStyles[i].selector,baselineCount:baselineStyles[i].nodes.length,candidateCount:candidateStyles[i].nodes.length,baseline:baselineStyles[i].nodes,candidate:candidateStyles[i].nodes});
  const basePng=await base.page.screenshot({fullPage:false,animations:"disabled"});
  const candidatePng=await candidate.page.screenshot({fullPage:false,animations:"disabled"});
  const filename=`${id}.png`;await fs.writeFile(path.join(PACKAGE,"screenshots",filename),candidatePng);
  const record={id,viewport,baselineScreenshotSha256:sha256(basePng),candidateScreenshot:{file:`screenshots/${filename}`,sha256:sha256(candidatePng),bytes:candidatePng.length},computedStylesEqual:differences.length===0,differences,baselineStyles,candidateStyles,baselineErrors:base.errors,candidateErrors:candidate.errors};
  await base.page.close();await candidate.page.close();return record;
}

async function mapGroupOpen(page){if(!(await page.locator("#basemapSelect").isVisible()))await page.locator('details[data-rail-group="map"] > summary').click();}

async function main(){
  const inputs=await verifiedInputs();
  await fs.mkdir(path.join(PACKAGE,"screenshots"),{recursive:true});
  let baseServer,candidateServer,browser;
  const captures=[];
  try{
    baseServer=await serve(BASELINE,inputs.poiBytes);candidateServer=await serve(CANDIDATE,inputs.poiBytes);
    browser=await chromium.launch({headless:true});
    const place=async()=>{};
    captures.push(await statePair(browser,baseServer.url,candidateServer.url,"desktop-place-light",{width:1440,height:900},place));
    const compare=async p=>{await p.locator("#modeCompareButton").click();await p.waitForFunction(()=>document.querySelector("#analysisPanel")?.dataset.mode==="COMPARE");await p.locator("#compareDetail > summary").click();await p.locator(".cmp-metric-focus").first().click();await p.mouse.move(1200,500);await p.mouse.wheel(0,-5000);await p.waitForFunction(()=>["#cbLensALabel","#cbLensBLabel"].every(s=>{const r=document.querySelector(s).getBoundingClientRect();return r.width&&r.height&&r.top>=0&&r.bottom<=innerHeight;}));};
    captures.push(await statePair(browser,baseServer.url,candidateServer.url,"desktop-compare-light",{width:1440,height:900},compare));
    const tablet=async p=>{await mapGroupOpen(p);await p.locator("#basemapSelect").selectOption("dark");await p.locator("#modeCompareButton").click();};
    captures.push(await statePair(browser,baseServer.url,candidateServer.url,"tablet-compare-dark",{width:834,height:1112},tablet));
    const mobile=async p=>{await p.locator("#mobileLayersButton").click();await mapGroupOpen(p);await p.locator("#basemapSelect").selectOption("dark");};
    captures.push(await statePair(browser,baseServer.url,candidateServer.url,"mobile-layers-dark",{width:390,height:844},mobile));
    const cssSha256=sha256(await fs.readFile(path.join(CANDIDATE,"css/app.css")));
    const computed={schema:"ux-t1-a1-shared-chrome-computed-parity/1.0",baselineSource:BASE_SHA,candidateSource:git(CANDIDATE,"rev-parse","HEAD"),candidateCssSha256:cssSha256,browser:{name:"Chromium",version:browser.version(),headless:true,deviceScaleFactor:1},deploymentManifestSha256:sha256(inputs.manifestBytes),productionPoiSha256:sha256(inputs.poiBytes),propertySet:PROPERTIES,selectors:SELECTORS,states:captures.map(({id,viewport,computedStylesEqual,differences,baselineStyles,candidateStyles})=>({id,viewport,computedStylesEqual,differences,baselineStyles,candidateStyles}))};
    await fs.writeFile(path.join(PACKAGE,"computed-style-parity.json"),JSON.stringify(computed,null,2)+"\n");
    const images=captures.map(({id,viewport,baselineScreenshotSha256,candidateScreenshot})=>({id,viewport,baselineScreenshotSha256,candidateScreenshot}));
    await fs.writeFile(path.join(PACKAGE,"screenshot-comparison.json"),JSON.stringify({schema:"ux-t1-a1-shared-chrome-screenshots/1.0",baselineSource:BASE_SHA,candidateSource:git(CANDIDATE,"rev-parse","HEAD"),candidateCssSha256:cssSha256,poiSha256:sha256(inputs.poiBytes),note:"Candidate screenshots are durable here; base-side screenshots were captured in the same Chromium run from the clean pinned source, but are omitted to avoid duplicate bulk. Existing T-a0 screenshots and their hashes are in PR #104. Live map tile imagery can change between runs.",captures:images},null,2)+"\n");
    if(captures.some(c=>!c.computedStylesEqual||c.baselineErrors.length||c.candidateErrors.length))throw new Error("Computed-style or page-error parity failed; inspect the emitted records before accepting.");
    console.log(JSON.stringify({source:git(CANDIDATE,"rev-parse","HEAD"),browser:browser.version(),captures:images,computedStyleParity:"PASS: all sampled modified and protected selectors identical",propertySet:PROPERTIES.length,selectors:SELECTORS.length},null,2));
  }finally{
    if(browser)await browser.close();
    if(baseServer)await new Promise(r=>baseServer.server.close(r));
    if(candidateServer)await new Promise(r=>candidateServer.server.close(r));
  }
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
