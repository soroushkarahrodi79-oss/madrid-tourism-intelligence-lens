// Independent-sample audit for the edge measurements.
//   node audit_samples.cjs <dir containing audit_light.json audit_dark.json audit_satellite.json> [--json out.json]
// Pooled boundary samples (36 angles per chip, repeated per view and per zoom) are NOT independent. This script
// de-duplicates by cluster identity (type:lat,lon:count), groups clusters into geographic locations (single linkage,
// 250 m), and reports per-chip results with a bootstrap over UNIQUE CLUSTERS. The three basemaps observe the SAME
// clusters over different backgrounds: that adds background variety, not independent clusters.
const fs = require("fs"), path = require("path");
const dir = process.argv[2]; const BN = { light: "Positron", dark: "DarkMatter", satellite: "Esri" };
const hav = (a, b) => { const R = 6371000, r = (x) => x * Math.PI / 180, dl = r(b[0] - a[0]), dn = r(b[1] - a[1]); const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const boot = (vals, stat, B = 4000) => { if (!vals.length) return null; const out = []; for (let b = 0; b < B; b++) { const s = Array.from({ length: vals.length }, () => vals[Math.floor(rnd() * vals.length)]); out.push(stat(s)); } out.sort((x, y) => x - y); return [out[Math.floor(0.025 * B)], out[Math.floor(0.975 * B)]].map((x) => +x.toFixed(1)); };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const result = {};
for (const b of ["light", "dark", "satellite"]) {
  const rows = JSON.parse(fs.readFileSync(path.join(dir, `audit_${b}.json`), "utf8")).rows;
  for (const app of ["light", "dark"]) for (const state of ["inLens", "outsideLens"]) {
    const obs = []; for (const r of rows.filter((x) => x.appearance === app)) for (const c of r.stats.perChip || []) if (c.state === state && c.cid) obs.push({ ...c, ctx: `${r.site}@z${r.zoom}` });
    if (!obs.length) continue;
    const byId = new Map(); for (const o of obs) { if (!byId.has(o.cid)) byId.set(o.cid, []); byId.get(o.cid).push(o); }
    const ids = [...byId.keys()]; const pos = ids.map((id) => id.split(":")[1].split(",").map(Number));
    const parent = ids.map((_, i) => i); const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (hav(pos[i], pos[j]) <= 250) parent[find(i)] = find(j);
    const locations = new Set(ids.map((_, i) => find(i))).size;
    const chip = (k) => ids.map((id) => { const v = byId.get(id).map((o) => o[k]).filter((x) => x != null); return v.length ? mean(v) : null; }).filter((x) => x != null);
    const row = (k) => { const v = chip(k); return v.length ? { mean_pct_below3: +mean(v).toFixed(1), ci95: boot(v, mean), chips_with_gt5pct_below3: v.filter((x) => x > 5).length, n_chips: v.length } : null; };
    const pooledSamples = obs.reduce((s, o) => s + o.samples, 0);
    result[`${BN[b]} | ${app} appearance | ${state}`] = {
      observations: obs.length, unique_clusters: ids.length, geographic_locations_250m: locations, views: [...new Set(obs.map((o) => o.ctx))], pooled_samples_NOT_independent: pooledSamples,
      samples_per_unique_cluster_mean: +(pooledSamples / ids.length).toFixed(1),
      dual_tone_all_samples: row("multi_below3_pct"), dual_tone_inked_samples: row("multi_ink_below3_pct"), halo_ring: row("halo_below3_pct"), border_ring_inked: row("border_ink_below3_pct"), dash_gap_fraction_pct: state === "outsideLens" ? +mean(chip("gap_fraction_pct")).toFixed(1) : null,
    };
  }
}
if (process.argv.includes("--json")) fs.writeFileSync(process.argv[process.argv.indexOf("--json") + 1], JSON.stringify(result, null, 1));
for (const [k, v] of Object.entries(result)) {
  const f = (r) => (r ? `${r.mean_pct_below3}% [${r.ci95?.join("–")}] (${r.chips_with_gt5pct_below3}/${r.n_chips} chips >5%)` : "n/a");
  console.log(`${k.padEnd(46)} uniq ${String(v.unique_clusters).padStart(3)} loc ${v.geographic_locations_250m} obs ${v.observations} samples ${v.pooled_samples_NOT_independent}\n    dual-tone all ${f(v.dual_tone_all_samples)} | dual-tone inked ${f(v.dual_tone_inked_samples)}\n    halo ${f(v.halo_ring)} | border(inked) ${f(v.border_ring_inked)} | dash gaps ${v.dash_gap_fraction_pct ?? "-"}% | views ${v.views.join(",")}`);
}
