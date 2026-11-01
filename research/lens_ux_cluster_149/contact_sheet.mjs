// Compose labelled side-by-side crops (control, V1, V2, V3) for one basemap/appearance into a single PNG.
//   node contact_sheet.mjs <cropsDir> <basemap: light|dark|satellite> <appearance> <out.png>
// Crops are real rendered pixels (1x); the sheet upscales them 2x with nearest-neighbour so 11px glyphs can be judged.
// Basemap names: light = CARTO Positron, dark = CARTO Dark Matter, satellite = Esri World Imagery.
import fs from "node:fs"; import path from "node:path"; import { chromium } from "playwright";
const [dir, basemap, appearance, out] = process.argv.slice(2);
const names = ["control", "V1", "V2", "V3"];
const html = `<body style="margin:0;background:#888;font:12px sans-serif;color:#fff"><div style="display:grid;grid-template-columns:repeat(2,840px);gap:6px;padding:6px">${names.map((n) => {
  const b64 = fs.readFileSync(path.join(path.resolve(dir), `${n}_${basemap}_${appearance}.png`)).toString("base64");
  return `<div><div style="padding:2px 4px;background:#000">${n} — ${{ light: "CARTO Positron", dark: "CARTO Dark Matter", satellite: "Esri World Imagery" }[basemap]}, ${appearance} appearance, 2x nearest</div><img style="width:840px;height:520px;image-rendering:pixelated;display:block" src="data:image/png;base64,${b64}"></div>`; }).join("")}</div>
<div style="padding:4px 8px;background:#000">Basemap tiles: © OpenStreetMap contributors © CARTO / Tiles © Esri — Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community. Not committed.</div></body>`;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1700, height: 1130 } });
await p.setContent(html); await p.screenshot({ path: out, fullPage: true }); await b.close(); console.log("wrote", out);
