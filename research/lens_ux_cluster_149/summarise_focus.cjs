// node summarise_focus.cjs <dir with focus_light.json focus_dark.json focus_satellite.json> [--out merged.json]
const fs = require("fs"), path = require("path"); const dir = process.argv[2];
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const ci = (v) => { const o = []; for (let b = 0; b < 3000; b++) o.push(mean(Array.from({ length: v.length }, () => v[Math.floor(rnd() * v.length)]))); o.sort((x, y) => x - y); return [o[75], o[2925]].map((x) => +x.toFixed(0)); };
const merged = { tool: "focus_check.mjs", configs: [] };
console.log("basemap · appearance · state | clusters | focus-visible | ring A (marker box) <3:1 | ring B (chip outline) <3:1 strict/band | any ring pixel ≥3:1 missing (directions) [95% CI over clusters]");
for (const f of ["focus_light.json", "focus_dark.json", "focus_satellite.json"]) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); for (const c of j.configs) {
    merged.configs.push(c); if (c.failed) continue;
    for (const st of ["inLens", "outsideLens"]) { const ch = c.chips.filter((x) => x.state === st); if (!ch.length) continue;
      const g = (fn) => ch.map(fn).filter((x) => x != null); const m = (a) => +mean(a).toFixed(0);
      const any = g((x) => x.combined_any_pixel_below3_pct);
      console.log(`${c.basemapName.padEnd(19)} ${c.appearance.padEnd(5)} ${st.padEnd(11)} n=${String(ch.length).padStart(2)} fv ${ch.filter((x) => x.focusVisible).length}/${ch.length} tab ${c.tabResult.reachedByTab ? "ok" : "NO"} | A ${m(g((x) => x.A_marker_box_ring.strict_below3_pct))}% | B ${m(g((x) => x.B_chip_outline.strict_below3_pct))}%/${m(g((x) => x.B_chip_outline.band_below3_pct))}% | any ${m(any)}% [${ci(any).join("–")}] | rendered change A ${m(g((x) => x.A_marker_box_ring.rendered_change_pct))}% B ${m(g((x) => x.B_chip_outline.rendered_change_pct))}%`); } } }
const o = process.argv.indexOf("--out"); if (o > 0) fs.writeFileSync(process.argv[o + 1], JSON.stringify(merged));
