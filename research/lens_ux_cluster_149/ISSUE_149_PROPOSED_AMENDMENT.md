# Amendment to issue #149 — APPLIED (owner-approved bounded release, PR #157)

This is the text posted at the top of [#149](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/issues/149) (original issue text preserved below it, byte-for-byte apart from a trailing newline). Follow-up: [#159](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/issues/159). Dependency comments: [#150](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/issues/150#issuecomment-6565106204), [#153](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/issues/153#issuecomment-6565106524).

## ✏️ Amendment — owner-approved scope reduction (bounded release path for PR #157)
**Status:** OPEN. The original findings and acceptance criteria are preserved **unchanged** below the divider (GitHub edit history also keeps the prior version). This amendment records an explicit, owner-approved scope reduction; it is not a silent waiver and **makes no WCAG conformance claim**.

**Linked:** PR #157 (Draft → bounded implementation, **not merged, not deployed**) · follow-up **#159** (UX-V1b) · relative-salience dependency → #150 and #153 · [release decision memo](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/blob/87fbad159b7eea340ab0b631ffd2aa339a0aa9e3/research/lens_ux_cluster_149/RELEASE_DECISION_MEMO_149.md).

### Bounded implementation delivered by PR #157 (A1–A4, pending review)
| | criterion | state on PR #157 |
|---|---|---|
| A1 | Cluster chrome resolves through appearance tokens; no Dark-only literal in Light | met (test-asserted) |
| A2 | Count ≥ 4.5:1 against its rendered chip fill on real tiles | met on CARTO Positron, Dark Matter and Esri (p05 ≥ 16:1 in-Lens, ≥ 4.8:1 out-of-Lens; strongest-core-pixel measure) |
| A3 | The two categories differ without colour | met as **automated graphical discrimination** (the two glyph masks differ; mask correlation at the rendered 11 px size). **This is not human recognition**; human validation is not done (#153, #159) |
| A4 | Keyboard: Enter/Space activation, accessible name (category + count), EN/ES at render and on language switch | met (Chromium + WebKit CI) |

### Transferred, **unresolved** — tracked in #159
* **A5 — cluster boundary** (original criterion 2, "chip ≥ 3:1"): **not established.** Single-ring ≥ 95 % is infeasible on Esri imagery; the replacement ≥ 95 % dual-tone rule is a **project heuristic, not WCAG**, and the sample is 11 unique clusters in one Lens context (in-Lens Light failure 1.8 / 2.7 / 1.8 % but interval upper bounds 5.5 / 6.5 / 5.5 %; Dark-appearance in-Lens Positron 6.1 %, Esri 5.0 %; out-of-Lens dashed chips ≈ 48–50 % of perimeter is dash gap).
* **A6 — all real basemaps × both appearances** (original criterion 6): measured on real CARTO Positron, Dark Matter and Esri; the boundary result remains open (A5).
* **Keyboard-focus contrast** (new finding, not in the original criteria): reachable by Tab and `:focus-visible`, but ≥ 3:1 is missing in ≈ 45–52 % of directions on mismatched appearance/basemap pairs (Dark Matter·Light, Positron·Dark) and 19–21 % on Esri in-Lens. The marker-box ring is pre-existing; the PR adds a chip outline.

### Dependency transferred — not solved
* **Original criterion 1 (cluster:marker salience ≤ 2:1)** is withdrawn from #149: with a chip at ≥ 3:1 and the weakest marker at ~1.15–1.22:1 the ratio is ≥ 2.46–2.61, so criteria 1 and 2 cannot both hold while the markers are unchanged, and a ratio of two WCAG contrast ratios is not a perceptual salience model. Relative whole-map salience is **transferred to #150 (marker contrast) and #153 (human validation); it has not been solved or measured.**

### Mapping of the original checklist
1 salience ≤ 2:1 → #150/#153 (unresolved) · 2 chip ≥ 3:1 → A5 → #159 (unresolved) · 3 count ≥ 4.5:1 → A2 (met) · 4 distinguishable without colour → A3 (automated discrimination only) · 5 tokens → A1 (met) · 6 all basemaps × appearances → A6 → #159 (measured, boundary open).

### Corrections to the original measurements (found while verifying; the original text below is left as written)
* The "191 chips / 21.4 % viewport coverage" figure counts chips present in the DOM, including those outside the viewport; at 1440×900, z14 about 130 are on screen and some are under panels, so 21.4 % is an overstatement.
* "Byte-identical computed styles" held in **Light** appearance; in Dark the chip border took the layer colour.
* Clusters do not exist at z ≥ 16 (clustering is off), so z17 views show individual markers only.

**Not claimed:** WCAG 2.2 SC 1.4.11 (or any) conformance; human or assistive-technology validation; that #150's marker contrast is addressed. This issue is **not** closed by PR #157.

