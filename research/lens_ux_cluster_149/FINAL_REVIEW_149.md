# #149 — final bounded review (PR #157, V2 design)

Measured with `validate.mjs --prod … --part edge` on the production page with only `css/app.css` and `js/app.js` replaced by route interception; real CARTO Positron, CARTO Dark Matter and Esri imagery; 1440×900, DPR 1, headless Chromium. Per-cluster audit: `audit_samples.cjs`, results `results/audit_summary_20261101.json`.

## 1. Sample-size audit (what is and is not independent)
* A boundary "sample" is one of 36 angles around one chip. Samples of one chip are strongly dependent; pooled sample counts (512, 7 062, …) are **not** evidence of precision and are reported only as a size of the raw data.
* **In-Lens, Light appearance:** 22 chip observations = **11 unique clusters** (`type:lat,lon:count`), each seen in two overlapping views (Sol@z14 and Retiro@z14). Those 11 are **11 distinct locations ≥ 250 m apart but all inside the single Lens circle (Los Jerónimos, A·900 m)** → **one independent Lens context**, 11 clusters. Dark appearance: the same 11 clusters (one view).
* The three basemaps observe the **same** clusters over different backgrounds; that adds background diversity, not independent clusters.
* **Out-of-Lens:** 108 unique clusters (103 locations at 250 m) across five views; z12 and z14 views of one neighbourhood contain different aggregations of the same underlying points, so they are not independent either. Dark appearance: 55 clusters, one view.
* Uncertainty below is a **bootstrap over unique clusters** (4 000 resamples, per-cluster mean of the percentage of samples below 3:1). With n = 11 the intervals are wide and one Lens context cannot support a population claim about Madrid.

## 2. What the numbers establish — engineering criterion vs WCAG 2.2 SC 1.4.11
* **Engineering acceptance criterion (this project's, not WCAG's):** "at ≥ 95 % of boundary samples, at least one of the two opposite-tone rings reaches ≥ 3:1 against the adjacent basemap pixel (rendered), per basemap × appearance × Lens state, with the cluster-level 95 % interval for the failing share ≤ 5 %". It is a heuristic for variable backgrounds; WCAG defines no percentage, no dual-tone rule and no handling of photographic backgrounds.
* **SC 1.4.11 (AA)** requires ≥ 3:1 against adjacent colours for visual information *required to identify* UI components and states, and for graphical objects required to understand content. **Not established, and not claimed:**
  * whether the chip outline is "required to identify" the component (the count text and category glyph also identify it) — an accessibility-owner judgement, not a measurement;
  * conformance of the page (conformance is per page, with all content);
  * contrast of the **focus indicator** (a single-tone `--map-cluster-edge` outline, offset 3 px) on real tiles — **not measured**;
  * human, assistive-technology or low-vision validation; WebKit pixel rendering (WebKit ran the computed-style/behaviour tests only).
* **Established (rendered pixels, real tiles, screening only):** count text (SC 1.4.3 analogue) p05 ≥ 16:1 in-Lens and ≥ 4.8:1 out-of-Lens, 0 % of chips < 4.5:1; 11 px glyph recognisable (correlation with its own mask > other mask for 100 % of measured chips, r 0.91–0.99); keyboard Enter/Space, accessible names and tooltips in EN and ES at first render and on language switch.

## 3. Remaining failures — per ring and dual-tone (cluster-level; % of samples < 3:1, mean per cluster [bootstrap 95 % CI])
| basemap · appearance · state | unique clusters | halo ring | border ring (inked) | dual-tone, all samples | dual-tone, inked only | dash gaps |
|---|---|---|---|---|---|---|
| Positron · Light · **in-Lens** | 11 | 68.2 [61.1–75.3] | 3.8 [0.5–8.3] | **1.8 [0–5.5]** | 1.8 [0–5.5] | – |
| Dark Matter · Light · in-Lens | 11 | 7.0 [3.2–11.3] | 44.2 [36.8–51.6] | 2.7 [0–6.5] | 2.7 [0–6.5] | – |
| Esri · Light · in-Lens | 11 | 25.3 [19.7–30.7] | 23.4 [13.4–33.5] | 1.8 [0–5.5] | 1.8 [0–5.5] | – |
| Positron · **Dark** · in-Lens | 11 | 9.0 [3.7–15.0] | 85.6 [81.1–90.1] | **6.1 [2.7–10.6]** | 6.1 [2.6–10.5] | – |
| Dark Matter · Dark · in-Lens | 11 | 59.1 [51.7–67.6] | 8.2 [4.7–12.4] | 2.1 [0–5.8] | 2.1 [0–5.8] | – |
| Esri · Dark · in-Lens | 11 | 30.3 [21.1–39.8] | 30.6 [21.0–40.7] | **5.0 [1.3–9.6]** | 5.0 [1.3–9.9] | – |
| Positron · Light · **out-of-Lens** | 108 | 82.7 [81.9–83.4] | 5.1 [4.6–5.6] | **41.3 [40.7–41.9]** | **4.9 [4.4–5.3]** | 47.8 % |
| Dark Matter · Light · out-of-Lens | 108 | 4.7 [3.7–5.8] | 47.6 [45.8–49.6] | 1.8 [1.1–2.5] | 1.3 [0.9–1.9] | 49.5 % |
| Esri · Light · out-of-Lens | 108 | 43.3 [41.2–45.3] | 36.7 [34.6–38.9] | **21.2 [19.7–22.8]** | **8.4 [7.3–9.5]** | 49.8 % |
| Positron · Dark · out-of-Lens | 55 | 12.8 [11.4–14.1] | 87.2 [85.2–89.0] | 9.2 [8.0–10.3] | 12.5 [10.5–14.3] | 48.4 % |
| Dark Matter · Dark · out-of-Lens | 55 | 80.8 [79.3–82.3] | 1.0 [0.3–1.6] | 24.3 [23.1–25.6] | 0.7 [0.2–1.2] | 49.2 % |
| Esri · Dark · out-of-Lens | 55 | 42.5 [40.1–44.9] | 38.0 [34.3–41.5] | 17.5 [15.7–19.4] | 7.9 [6.2–9.5] | 49.0 % |

Reading it without softening it:
* **In-Lens Light:** point estimates (1.8 / 2.7 / 1.8 %) meet ≤ 5 %, but with one Lens context and 11 clusters the interval upper bounds (5.5 / 6.5 / 5.5 %) exceed 5 %: **the criterion is not statistically established.** No single ring passes on Esri (25 % / 23 % fail) — consistent with single-ring infeasibility there.
* **In-Lens Dark:** Positron 6.1 % and Esri 5.0 % (intervals reach 10.6 % and 9.6 %) — **not met**; Dark Matter 2.1 % [0–5.8] is not established either.
* **Out-of-Lens:** the dashed border leaves ≈ 48–50 % of the perimeter as dash gaps by design (the structural out-of-Lens cue). Counting **all** perimeter samples the dual-tone result fails on Positron (41 %) and Esri (21 %); on **inked samples only** it is Positron 4.9 % [4.4–5.3] (straddles 5 %), Esri 8.4 % (fails), Dark Matter 1.3 % (met). Gaps are reported, not hidden: the gap perimeter is not a pass, and inked-only is a disclosed restriction, not a conformance argument.
* The band metric (strongest pixel in each ring's radial band) tolerates ±1 px rasterisation and is **optimistic**; the fixed-radius strict values in `results/*` are pessimistic. Neither is a WCAG verdict.
