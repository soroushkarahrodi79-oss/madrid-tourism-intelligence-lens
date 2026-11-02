const fs=require("fs");const V=["control","V1","V2","V3"],B=["light","dark","satellite"],BN={light:"Positron",dark:"DarkMatter",satellite:"Esri"};
const W=(items,get,wget)=>{let s=0,w=0;for(const it of items){const v=get(it),n=wget(it);if(v==null||!n)continue;s+=v*n;w+=n}return w?+(s/w).toFixed(1):null};
const out={};
for(const v of V)for(const b of B){const r=JSON.parse(fs.readFileSync(require("path").join(process.argv[2]||".",`edge_${v}_${b}.json`),"utf8"));out[v+"|"+b]=r.rows}
function row(v,b,app,state){const rows=out[v+"|"+b].filter(x=>x.appearance==app).map(x=>x.stats[state]).filter(s=>s.chips>0);if(!rows.length)return null;
 const g=(k)=>W(rows,s=>s[k].pctBelow3,s=>s[k].n);
 return {nrows:rows.length,chips:rows.reduce((a,s)=>a+s.chips,0),halo:g("halo_band_vs_bg"),border:g("border_band_vs_bg"),haloStrict:g("halo_vs_bg"),borderStrict:g("border_vs_bg"),multi:g("multi_tone_band_vs_bg_PROPOSED_CRITERION_NOT_AUTOPASS"),multiInk:g("multi_tone_band_inked_samples_only"),
  blackRing:W(rows,s=>s.bg_ring_feasibility?.black_ring_pct,s=>s.bg_ring_feasibility?.samples),bestSingle:W(rows,s=>s.bg_ring_feasibility?.best_single_ring_pct_cleared,s=>s.bg_ring_feasibility?.samples),bwDual:W(rows,s=>s.bg_ring_feasibility?.black_or_white_pct,s=>s.bg_ring_feasibility?.samples),
  countP05:Math.min(...rows.map(s=>s.count_rendered_core_vs_fill.p05).filter(x=>x!=null)),glyphMaxP05:Math.min(...rows.map(s=>s.glyph_rendered_max_vs_fill.p05).filter(x=>x!=null)),
  recog:W(rows,s=>s.glyph_recognition_11px.correct_pct,s=>s.glyph_recognition_11px.n),corr:W(rows,s=>s.glyph_recognition_11px.own_mask_corr_mean*100,s=>s.glyph_recognition_11px.n)/100}}
for(const app of ["light","dark"])for(const state of ["inLens","outsideLens"]){console.log(`\n## appearance=${app} ${state}  (% samples <3:1: halo/border band | strict | multi-tone | feasibility: blackRing / bestSingle / black-or-white; glyph recog %, corr; count p05 min, glyph-max p05 min)`);
 for(const b of B)for(const v of V){const r=row(v,b,app,state);if(r)console.log(`${BN[b].padEnd(10)}${v.padEnd(8)} n${r.nrows}/${r.chips}ch | halo ${r.halo} border ${r.border} | strict ${r.haloStrict}/${r.borderStrict} | multi ${r.multi} ink-only ${r.multiInk} | feas ${r.blackRing}/${r.bestSingle}/${r.bwDual} | recog ${r.recog}% r=${r.corr} | cnt ${r.countP05} gly ${r.glyphMaxP05}`)}}
