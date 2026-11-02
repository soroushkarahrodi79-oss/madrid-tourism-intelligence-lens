// Is "≥ 30 unique in-Lens clusters from ≥ 2 independent Lens contexts" achievable with the app's real Lens movement
// (click/drag to any centre; radius 100–5000 m, default 900 m) and its real clustering (js/clustering.js, zoom < 16)?
//   node feasibility.cjs <runtime_poi.json>
// Independent contexts = NON-OVERLAPPING Lens circles (centres ≥ 2R apart), so no cluster or underlying point is shared.
// Repeated zooms of one circle, repeated views and the three basemaps are NOT counted as additional contexts.
const fs = require("fs"); const { clusterPointsByPixelGrid } = require("../../js/clustering.js");
const poi = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).layers;
const pts = [...(poi.stay || []).map((p) => ({ ...p, type: "stay" })), ...(poi.bike || []).map((p) => ({ ...p, type: "bike" }))].filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
const hav = (a, b) => { const R = 6371000, r = (x) => x * Math.PI / 180, dl = r(b.lat - a.lat), dn = r(b.lon - a.lon); const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dn / 2) ** 2; return 2 * 6371000 * Math.asin(Math.sqrt(h)); };
const lat = pts.map((p) => p.lat), lon = pts.map((p) => p.lon);
console.log(`points: stay ${pts.filter((p) => p.type === "stay").length}, bike ${pts.filter((p) => p.type === "bike").length}; extent lat ${Math.min(...lat).toFixed(3)}–${Math.max(...lat).toFixed(3)}, lon ${Math.min(...lon).toFixed(3)}–${Math.max(...lon).toFixed(3)}`);
for (const zoom of [13, 14, 15]) {
  // clusters are built per layer exactly as rebuildDenseLayer does (stay and bike separately)
  const clusters = ["stay", "bike"].flatMap((t) => clusterPointsByPixelGrid(pts.filter((p) => p.type === t), zoom).filter((c) => c.count > 1).map((c) => ({ lat: c.lat, lon: c.lon, count: c.count, type: t })));
  for (const R of [500, 900, 1500, 2500]) {
    const step = Math.max(R / 4, 100), cands = [];
    for (let la = Math.min(...lat); la <= Math.max(...lat); la += step / 111000) for (let lo = Math.min(...lon); lo <= Math.max(...lon); lo += step / (111000 * Math.cos(40.4 * Math.PI / 180))) {
      const c = { lat: la, lon: lo }; const n = clusters.filter((k) => hav(c, k) <= R).length; if (n) cands.push({ ...c, n });
    }
    cands.sort((a, b) => b.n - a.n); const chosen = [];
    for (const c of cands) if (chosen.every((d) => hav(c, d) >= 2 * R)) chosen.push(c);
    const ctx = (min) => chosen.filter((c) => c.n >= min).length;
    console.log(`z${zoom} R=${String(R).padStart(4)} m | clusters total ${clusters.length} | best single Lens ${cands[0]?.n ?? 0} | disjoint Lens contexts with >=10: ${ctx(10)}, >=15: ${ctx(15)}, >=30: ${ctx(30)} | top disjoint counts: ${chosen.slice(0, 6).map((c) => c.n).join(",")}`);
  }
}
