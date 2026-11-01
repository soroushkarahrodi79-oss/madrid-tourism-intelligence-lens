# LENS-UX-VISION-G0 — Scientific Cartographic, Colour, Typography & Visual Comfort Audit

**Target:** Madrid Urban Evidence Lens — `soroushkarahrodi79-oss/madrid-tourism-intelligence-lens`
**Audit date:** 2026-11-01
**Mode:** STRICT READ-ONLY. No repository file was created, modified or deleted. No branch, commit, PR or issue. Nothing deployed.
**Primary measurement target:** the live GitHub Pages deployment (production data, production CARTO key).
**Harness:** [`research/lens_ux_vision_g0/`](../research/lens_ux_vision_g0/) — reproduces every contrast and separability figure below.
**Tracked as:** #149 (clusters) · #150 (markers) · #151 (typography) · #152 (colour-only discrimination) · #153 (human-validation gate) · #154 (panel height) · #155 (basemap fallback).

---

## A. EXECUTIVE VERDICT

**Is the current default Light experience professionally suitable for GIS analysis and extended desktop use?**

**Partly — and the part that fails is the most important one.**

The *application chrome* (left rail, analysis panel, header, dialogs) is, in every state this audit reached, a competently built Light theme: **0 text-contrast failures out of 124 rendered text elements in both Light and Dark appearance**, a **universal and consistent focus indicator on 251/251 focusable controls**, a **clean SC 1.4.12 text-spacing pass**, and **no clipping or truncation in either English or Spanish**. This is better than most analytical web GIS, and it should not be disturbed.

The *map* — which is where the evidence actually lives — fails. **All five default-on operational categories fall below the WCAG 3:1 non-text-contrast threshold against the actual default basemap**, four of them across 100% of sampled tile area, with Metro & Cercanías at a median **1.28:1** (effectively invisible). Simultaneously, the aggregation layer that carries *no* category identity renders at **12.98:1** and covers **21.4% of the map viewport**. The result is an inverted visual hierarchy of roughly **11×**: the least informative mark on screen is the most visually dominant, and the actual evidence is the least.

The cause is identifiable and documented in the codebase's own comments: the marker palette was tuned for the **dark** basemap and was never re-tuned when Light became the default appearance. Measured against CARTO `dark_all`, the identical palette scores **4.88–11.11:1** and passes. Against the default `light_all`, it scores **1.30–2.88:1**.

**Already supported by evidence (verified, measured):** chrome contrast, focus visibility, text spacing, reflow, bilingual robustness, basemap provenance and integrity, marker/cluster contrast failure, hierarchy inversion, panel/viewport geometry, categorical confusion under simulated CVD.

**Not yet supported (unverified):** any claim about real user task performance, comprehension, misinterpretation rates or subjective visual comfort. No human was tested. Section K proposes the protocol that would close this gap.

---

## B. BASELINE INVENTORY

### B.1 Repository and deployment state

| Item | Value | Source | Confidence |
|---|---|---|---|
| Expected baseline (brief) | `913de27`, "after PR #148" | audit brief | — |
| **Actual `origin/main` HEAD** | **`913de2766a718b2c64b0419542d5117cc380293b`**, 2026-11-01 04:40:45 −0800, "Merge PR #148 from codex/civic-search-v2-pr2" | `git log -1 origin/main` | Verified |
| **Local working-tree HEAD** | `b4deede` (2026-10-19) on branch `codex/ux-p1-small-screen` | `git rev-parse` | Verified |
| **Local vs origin/main** | **200 commits behind, 0 ahead**; merge-base = local HEAD | `git rev-list --count` | Verified |
| Local working tree | **Dirty**, pre-existing: `M css/app.css`, `M browser-tests/information-architecture.browser.mjs`, untracked `.worktrees/`, `lens-k12-benchmark/`, `research/ac_p0_12/results/_final_thin_remeasure.log` | `git status --porcelain` | Verified |
| Pages deployment of `913de27` | **success**, run `41307637236`, 2026-11-01T12:40:48Z | `gh run list` | Verified |
| Deployment manifest | `build_state: "pass"`, 0 errors, 0 warnings, 19/19 layers available, 5 operational layers, 1,470 operational records, `commit: 913de27…` | `<site>/data/deployment_manifest.json` | Verified |

> **Baseline discrepancy — resolved, and it matters.** The brief said "verify the actual current HEAD before any analysis." The local checkout is **not** the baseline: it is a 200-commit-stale feature branch, and it carries two uncommitted edits — one of which (`css/app.css`, `.place-circle-reading>small` `#74879c → #8298af`) is a *contrast-raising* change that does not exist on `main`. **Auditing the local working tree would have produced wrong numbers.**
>
> **Resolution, non-destructively:** the baseline tree was extracted with `git archive origin/main | tar -x` into an isolated scratch directory. No checkout, no reset, no stash, no worktree. The dirty state was left exactly as found and re-verified unchanged after extraction.
>
> Because the deployed Pages revision **is** `913de27` and only the deployment injects the CARTO key and builds `runtime_poi.json`, **the live site is the only faithful runtime baseline**, and it was used as the primary measurement target.

### B.2 Runtime baseline (measured in-page on the live deployment)

| Question from §1 of the brief | Measured answer | Confidence |
|---|---|---|
| Which basemap loads by default? | `basemapSelect = "light"` → CARTO Positron `light_all` | Verified |
| **Positron loading, or silent OSM fallback?** | **Positron, genuinely.** 20/20 DOM tiles from `basemaps.cartocdn.com/rastertiles/light_all/`; key present (35 chars); attribution reads "© OpenStreetMap contributors © CARTO". **No fallback.** | Verified |
| Default appearance: explicit Light or System→Light? | **System**, resolving to **light** (`matchMedia(prefers-color-scheme: dark) = false`). `data-appearance-preference="system"`, `data-appearance="light"`. **Not explicit Light.** | Verified |
| Relationship between appearance and basemap | **Fully independent, by design.** Switching appearance to Dark leaves the basemap on `light_all`. `js/appearance.js` has no path into `setBasemap`. | Verified |
| Default operational layers | `museum, info, stay, bike, rail` (5 on); `pedestrian, park, heat, licences, hospitality` off; admin boundaries `off`; halo on | Verified |
| Snapshots / clusters / overlays / evidence loaded? | Yes — manifest `pass`, 1,470 operational records, 191 clusters rendered, PLACE panel fully populated | Verified |

> **Critical latent fragility (not currently triggered).** `createCartoBasemap()` (`js/app.js:205-206`) begins `if (!cartoBasemapKey) return createOsmBasemap();`. The key lives only in `js/runtime-config.js`, which is **committed with an empty string** and overwritten at deploy time from the `CARTO_BASEMAP_KEY` secret. So **every local checkout, every fork, every PR preview and any deployment with an unset/expired/rotated secret silently serves OpenStreetMap standard tiles** — a far busier, more saturated, mid-luminance basemap — while `LENS_BASEMAP_STYLES.light` and `ADMIN_BASEMAP_STYLES.light` continue applying Positron-tuned strokes. This is a *silent* substitution: no console warning, no UI state, and the select still reads "Light · CARTO Positron". It is not failing today; it is one secret-expiry away from failing, and it would degrade the cartography without telling anyone.

### B.3 Typography tokens (verified against live computed styles)

| Token | Declared | Live computed | Status |
|---|---|---|---|
| `--t-display` | 28px | 28px | Unchanged |
| `--t-title` | 20px | 20px | Unchanged |
| `--t-figure` | 16px | 16px | Unchanged |
| `--t-body` | 14px | 14px | Unchanged |
| `--t-label` | 12px | 12px | Unchanged |
| `--t-meta` | 11px | 11px | Unchanged |
| `--t-micro` | 10px | 10px | Unchanged |

All seven historical values are intact. Family: `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.

### B.4 Light appearance tokens (active, verified)

`--bg #f4f6f9` · `--panel rgba(255,255,255,.96)` · `--text #16222f` · `--muted #445468` · `--text-meta #526277` · focus ring `#075f9a`.

> The `:root` comment claiming Light values "remain dormant until a later, separately approved theme activation" is **stale**. The `:root[data-appearance="light"]` block (css/app.css:1503) is live and fully applied. The comment should not be trusted as documentation.

### B.5 Operational palette (verified from source and live DOM)

| Category | Hex | Radius | Fill α | Stroke α | Clustered |
|---|---|---|---|---|---|
| Museums | `#9d72ff` | 4.2 | 0.78 | 0.95 | no |
| Tourist info | `#c79cff` | 4.2 | 0.78 | 0.95 | no |
| Hotels & stays | `#3da8ff` | 4.2 | 0.78 | 0.95 | **yes** |
| BiciMAD | `#54e2b5` | **2.8** | 0.78 | 0.95 | **yes** |
| Metro & Cercanías | `#ffd166` | 4.2 | 0.78 | 0.95 | no |
| Pedestrian (opt-in) | `#ff7aa2` | 4.4 | 0.42 | 0.92 | no |
| Parks (opt-in, context) | `#70dea4` | 3.6 | **0.22** | 0.80 | no |
| Licences (opt-in) | `#c0794f` | — | — | — | no |

---

## C. MAP AUDIT

### C.1 Basemap readability — Positron is the right choice. Keep it.

24 production tiles were fetched and decoded (6 Madrid sites × z12/14/16/17 = **1,572,864 pixels**): dense (Sol, Salamanca), park-heavy (Retiro, Casa de Campo), sparse (Villaverde, Vicálvaro).

| Metric | Measured |
|---|---|
| Mean relative luminance | **0.806 – 0.919** across all sites/zooms |
| Median relative luminance | 0.776 – 0.955 |
| 5th-percentile luminance | 0.693 – 0.791 |
| Distinct colours per tile | **16 – 32** |
| Pixels ≥ `#dfdfdf` | ~95% |

Dominant palette: `#f2f6f1` (park/green, 15.5%), `#ededed` (building, 10.4%), `#f6f6f4` (9.7%), `#fafaf8` (7.0%), `#e4e4e4` (6.4%), `#dfdfdf` (4.4%), `#ffffff` (3.6%), water `#d4dadc` (1.1%).

**Assessment.** 16–32 distinct colours per tile is exceptionally restrained — Positron carries street hierarchy, labels, parks and water while occupying a ~0.69–1.00 luminance band and almost no chroma. It supplies geographic context without competing with thematic marks. Street hierarchy survives to z12; labels are present and legible; parks are differentiated by a faint green cast rather than saturation. **This is textbook analytical-basemap behaviour and the brief's warning not to assume "palest is best" does not apply against it — it is pale *and* structured.**

**Verdict on §2.3 basemap comparison:** Positron is already correct. No alternative basemap is recommended, and no basemap experiment is justified. **The problem is not the basemap. The problem is what is drawn on top of it.** Replacing or darkening the basemap to rescue the markers would be solving the right problem in the wrong layer and would degrade the one component that is working.

### C.2 Marker visibility — P0 FAILURE

Marker edge (stroke, α 0.95) and fill (α 0.78) were alpha-composited over **224,712 sampled real tile pixels** and scored with the WCAG relative-luminance contrast formula.

**Current palette against the default basemap (CARTO Positron `light_all`):**

All figures in this table are from the **full per-pixel estimator**. (An earlier draft mixed two estimators in this table; corrected at review — see §J.)

| Category | Hex | Fill CR (median) | **Edge CR (median)** | Edge CR (min) | **% tile area below 3:1** |
|---|---|---|---|---|---|
| Metro & Cercanías | `#ffd166` | 1.23 | **1.28** | 1.00 | **100%** |
| BiciMAD | `#54e2b5` | 1.36 | **1.43** | 1.00 | **100%** |
| Tourist info | `#c79cff` | 1.67 | **1.88** | 1.00 | **100%** |
| Hotels & stays | `#3da8ff` | 1.91 | **2.19** | 1.00 | **100%** |
| Museums | `#9d72ff` | 2.31 | **2.82** | 1.12 | **87%** |

**Not one default category reaches 3:1 anywhere meaningful on the default map.** Metro at 1.28:1 and BiciMAD at 1.43:1 are below the threshold at which a mark is reliably *detectable*, let alone identifiable. BiciMAD compounds this with the smallest radius in the system (2.8px vs 4.2px).

**The same palette against CARTO `dark_all`** (43,692 sampled pixels, mean bg luminance 0.019):

| Category | `light_all` (default) | `dark_all` | % below 3:1 on dark |
|---|---|---|---|
| Metro & Cercanías | **1.28** | **11.11** | 0% |
| BiciMAD | **1.43** | **9.88** | 0% |
| Tourist info | **1.88** | **7.40** | 0% |
| Hotels & stays | **2.19** | **6.35** | 1.1% |
| Museums | **2.82** | **4.88** | 10.1% |

**This is proof, not inference.** The palette is correct for a dark basemap and wrong for the default light one. The codebase says so itself (css/app.css:1588): *"Tile-dependent marker and halo colours remain the shipped values because `#0098c0` has not passed a per-pixel gate across all three basemaps."* The gate was never run; the dark-era values shipped into a light-default product.

**Scope note:** this failure is governed by **basemap selection**, not appearance theme. Dark appearance + default light basemap still fails, because the two systems are independent (§B.2).

### C.3 Cluster behaviour — P0, and the larger of the two problems

| Measurement | Value |
|---|---|
| Clusters rendered at default view | **191** (105 BiciMAD + 86 Hotels) |
| Share of map viewport covered | **21.4%** |
| Surface | `rgba(8,16,27,.92)` — the **dark-theme** panel colour, unchanged in Light |
| Border / glow | 2px dashed `#ffffff` + 5px white outer ring + 20px black drop shadow |
| Effective contrast vs Positron median | **12.98:1** |
| `cluster-stay` vs `cluster-bike` computed styles | **byte-identical** |

Three distinct defects:

1. **Hierarchy inversion.** Cluster 12.98:1 against Metro marker 1.15:1 — an **≈11× inversion**. The mark that encodes *"some unspecified number of things are near here"* is an order of magnitude more salient than the mark that encodes *"this specific museum is here."* The ratio moves slightly with the reference tile colour: **11.3×** against the sampled Positron median, **11.2×** against `#ededed`, which is the figure `capture_map_evidence.mjs` reproduces. Nothing turns on the second decimal; the finding is the order of magnitude. §5.3 of the brief requires that styling never imply greater reliability through visual prominence; here it does so emphatically, and in favour of the less informative object.
2. **Total loss of category identity.** Two different operational categories aggregate into pixel-identical black chips. This is beyond SC 1.4.1 (Use of Colour) — colour is not merely the *only* distinguishing cue, there is **no** distinguishing cue. A user cannot tell a hotel cluster from a bike-station cluster without clicking.
3. **Dark-theme surface leaking into Light.** `rgba(8,16,27,.92)` is the Dark `--panel` token hard-coded into map chrome. Combined with a white dashed border and white glow on a pale basemap, it produces the dense, spiky, near-black blanket visible in the evidence screenshots.

The captured crop (`shots/` and the inline evidence) shows the practical consequence: across a 370×220 region of central Madrid, **every visible mark is a cluster chip and not a single individual category marker is discernible.**

### C.4 Categorical distinction — CIEDE2000

Composited fill over the modal Positron colour `#f2f6f1`, CIEDE2000, normal vision:

- Worst pair: **Museums ↔ Tourist info = ΔE 10.2**. These are deliberately related hues (`#9d72ff` / `#c79cff`), but at 4.2px with ~2:1 background contrast, ΔE 10.2 is marginal for reliable identification. This is one of the confusion pairs the brief explicitly flagged.
- Hotels (`#3da8ff`) ↔ Lens A fill (`#3da8ff`, α 0.10): **the identical hex**. Lens A's fill and the Hotels category are the same colour, separated only by opacity and geometry (dashed circumference vs point). The brief flagged "Hotels and Lens A" — confirmed as a genuine shared identity in source.
- BiciMAD (`#54e2b5`) ↔ Parks (`#70dea4`): both desaturated greens; Parks is context-only at α 0.22, which helps, but the hue family is shared.

### C.5 Colour-vision accessibility (simulated — screening only)

Machado, Oliveira & Fernandes (2009) severity-1.0 matrices, applied in linear RGB; ΔE2000 on simulated composited fills. **These are simulations, not evidence of what people with CVD actually perceive.**

| Condition | Worst pairs (ΔE2000) | Pairs < 10 (of 10) |
|---|---|---|
| Protanopia | **Tourist info ↔ Hotels = 0.9**, Museums↔Hotels 8.1, Museums↔Info 9.0 | **3** |
| Deuteranopia | Museums↔Hotels 3.7, Info↔Hotels 6.3, Museums↔Info 9.9 | **3** |
| Tritanopia | Hotels↔BiciMAD 9.5, Museums↔Info 11.0 | 1 |
| Grayscale | BiciMAD↔Metro 2.4, Info↔Hotels 3.2 | **7** |

**Tourist info ↔ Hotels at ΔE 0.9 under protanopia is effectively a single colour.** With no shape, glyph, pattern or label differentiating categories — all markers are plain filled circles of near-identical radius — a protanopic user has **no available channel** for distinguishing these two categories on the map. This is a clear SC 1.4.1 concern, independent of the contrast failure.

### C.6 Lens A/B semantics — no change required

`LENS_BASEMAP_STYLES.light` gives Lens A stroke `#123b5f` and Lens B `#00768f` — both dark, both high-contrast against Positron, both correct. Structural differentiation is sound and uses **non-colour channels**: A solid admin outline vs B dotted (`2 4`); A dash `3 6` vs B `2 7`; weight and opacity encode active state. Admin geometry is deliberately neutral slate vs the lens's blue. This is well-designed and should be left alone. The only issue is the Lens A fill sharing `#3da8ff` with the Hotels category (§C.4).

---

## D. LEFT-PANEL AUDIT

| Measurement | 1366×768 | 1440×900 | 1920×1080 |
|---|---|---|---|
| Width | 222px (fixed) | 222px | 222px |
| Rendered height | 660px | 792px | 972px |
| Content height | 1,099px | 1,099px | 1,099px |
| **Content below the fold** | **40%** | 28% | 12% |
| Spanish content height | 1,129px → **42% hidden** | — | — |

**Information hierarchy.** The rail is well-organised against the brief's six questions: grouped headings (MAP DISPLAY / OPERATIONAL LAYERS / ADMINISTRATIVE REGISTER / OBSERVED ACTIVITY), per-layer colour dot, switch, and — notably good — **per-group scientific caveats rendered inline**: "granted ≠ built", "not tourism-specific", "not in metrics", "bounded pilot", "Park context is excluded from lens counts", "5 layers · deployment snapshot" with a DEPLOYMENT SNAPSHOT provenance chip. The distinction between metric-contributing and context-only layers *is* expressed. This is genuinely strong evidence design.

**Typography — the problem.** **100% of left-rail text is ≤12px**: 18 nodes at 12px, 11 at 11px, **11 at 10px**. There is no body-size text in the rail at all. The scientific caveats listed above — the exact content the brief says "must never become practically unreadable because of compact styling" — are rendered at **10px**, several in **uppercase with 0.7–0.8px letter-spacing** ("BASE MAP", "ADMINISTRATIVE BOUNDARIES", "ACCOMMODATION CATEGORY"), which removes word-shape cues at the size where they matter most.

**Contrast is not the issue:** 0/40 failures, minimum 6.23:1 against a 4.5:1 requirement. The rail has *contrast headroom it is not spending on size*.

**Control ergonomics.** Layer switches render **27×15px**. Below the 24px SC 2.5.8 minimum, but they **pass via the spacing exception** — nearest genuine neighbouring target is 27.4–88.2px away. Conformant, but 15px of vertical target is small for precise pointing in sustained use. The `.area-source-toggle` / `.planning-source-toggle` disclosure buttons are **114×11.6px**; these are inline within text and qualify for the SC 2.5.8 inline exception.

**Spanish.** No clipping, no truncation, no horizontal scroll. Labels wrap cleanly within 146–181px. Verified pass.

---

## E. RIGHT-PANEL AUDIT

### E.1 Geometry

Content height is **state-dependent**: a fresh browser profile shows the first-run tutorial card inside the analysis panel, adding ~225px. The rows below are the **tutorial-dismissed steady state**; the fresh-profile state is given underneath.

| Viewport | Panel height | Available height | **Unused vertical space** | Content height | **Below fold** |
|---|---|---|---|---|---|
| 1366×768 | 660px | 660px | 0 | 1,331px | **51%** |
| 1440×900 | **720px (capped)** | 792px | **72px** | 1,331px | **46%** |
| 1920×1080 | **720px (capped)** | 972px | **252px** | 1,331px | **46%** |
| 1366×768, Spanish | 660px | 660px | 0 | 1,591px | **59%** |
| 1440×900, fresh profile (tutorial shown) | 720px | 792px | 72px | 1,557px | **54%** |

The last row is the one `capture_map_evidence.mjs` reproduces, because it runs on a clean profile. Both are true; the cap finding holds in either state.

Root cause, `css/app.css:298`:
```
height: var(--analysis-panel-height, min(720px, calc(100vh - 108px - ...)))
```
`.panel` carries a **hard 720px cap**; `.left` (line 193) carries `max-height: calc(100vh - 108px)` with **no cap**. On a Full HD display the left rail grows to 972px while the analysis panel refuses to exceed 720px, leaving **252px of available vertical space deliberately unused** and ~46% of the analytical content below the fold.

> **A finding I withdrew.** Intermediate measurements suggested the panel height failed to track viewport resizes (a stale 660px across three viewports). A clean reload test disproved this: `panelH 720 === min(720, innerHeight−108)`, `tracksViewport: true`, no inline style, `--analysis-panel-height` unset. The stale value was an artifact of the browser pane's own scaling, not product behaviour. **There is no resize bug.** The 720px cap is real; the resize defect is not.

### E.2 Reading comfort

| Mode | Text nodes | Contrast failures | Min ratio | **% of text ≤12px** |
|---|---|---|---|---|
| PLACE | 80 | **0** | 5.59:1 | **90%** |
| COMPARE | 92 | **0** | 5.59:1 | 74% |
| CITY | 14,829 | **0** | 6.88:1 | 0% (dominated by a 14px barrio list) |

PLACE size histogram: **34 nodes at 10px**, 15 at 11px, 23 at 12px — against only 3 at 14px, 3 at 16px, 2 at 20px.

**The analytical mode users spend most time in renders 90% of its text at or below the 12px label token, and 43% at the 10px microtext token.** Line length is healthy (31–77 characters, median well inside the 45–85 comfort band) and line-height is reasonable where tokenised (1.35–1.5), though a significant number of nodes resolve to `line-height: normal` rather than a token — an internal inconsistency worth tidying.

Numerical hierarchy is handled well: `font-variant-numeric: tabular-nums` on figures, a clear 20px/16px figure tier, and distinct treatment for abstention states (`.abstain`).

### E.3 Map-to-panel interaction

The brief's specific concern — "high-contrast dark clusters against light panels" — is **confirmed and is the dominant cross-component defect**. With 191 near-black chips at 12.98:1 occupying 21.4% of the map beside a `rgba(255,255,255,.96)` panel, the luminance discontinuity across the map/panel seam is severe, and attention is pulled to the least informative region of the screen. Fixing the cluster surface (§I, P0-2 — #149) resolves a map problem *and* a cross-panel problem in one change.

### E.4 Analytical interpretation

No evidence that styling implies differential reliability **within the panel** — abstention, withheld, unavailable and context-only states are consistently de-emphasised rather than decorated, and provenance chips (OFFICIAL REGISTER, ADMINISTRATIVE LICENCE, DEPLOYMENT SNAPSHOT) are neutral. **On the map, the opposite is true** (§C.3). Evidence semantics are preserved in the panel and violated in the map layer.

---

## F. TYPOGRAPHY AUDIT

All seven tokens are intact (§B.3). The weaknesses are in *application*, not in the scale's definition.

**Verified weaknesses:**

1. **Over-reliance on the bottom two tokens.** 10px and 11px carry primary analytical and caveat content, not just incidental metadata. 90% of PLACE panel text and 100% of left-rail text is ≤12px.
2. **No webfont is declared.** There is **no `@font-face`, no Google Fonts link, no preconnect** anywhere in `index.html` or the CSS. `Inter` resolves on this machine only because Inter is **installed locally**. Measured string widths at 14px: Inter **197.5px**, Segoe UI **210.0px** (+6.3%), generic sans-serif **215.6px** (+9.2%). On the large majority of Windows machines without Inter installed, the entire interface renders in Segoe UI at ~6% wider metrics. **Every density, wrapping and truncation judgement in this product is therefore machine-dependent and untested on the font most users will actually get.** This is a reproducibility defect in a scientific instrument, and it also means my own clipping results (§D, §E — clean) are valid for Inter and *not* established for Segoe UI.
3. **Uppercase + letter-spacing at 10px** on rail section headings.
4. **Inconsistent line-height**: mixture of tokenised ratios (1.15–1.5) and `normal`.

**Not weaknesses (verified):** contrast at every size; tabular numerals; line length; heading hierarchy; Spanish wrapping; SC 1.4.12 text-spacing robustness.

### Candidate T1 — Minimal correction
Change only what is demonstrated. Promote the ~10 scientific-caveat strings from `--t-micro` (10px) to `--t-meta` (11px); stop using 10px for anything a user must read to interpret evidence correctly, restricting it to incidental metadata. Declare a self-hosted Inter `@font-face` with `font-display: swap` so metrics are deterministic. Drop uppercase on 10px rail headings or move them to 11px. Normalise `line-height: normal` to tokens. **No scale change, no identity change, no layout change.** Estimated panel content growth: <6%.

### Candidate T2 — Reading-oriented desktop
Re-base the scale one step for sustained analytical reading: body 14→15px, label 12→13px, meta 11→12px, micro 10→11px, retaining display/title/figure. Pair with lifting the `.panel` 720px cap so the added height is absorbed by newly available vertical space rather than by more scrolling. **Trade-off:** ~8–10% content growth; at 1366×768 this worsens below-fold content unless the cap fix lands first; at 1920×1080 it is absorbed entirely. **T2 must not ship without the panel-height fix.**

**Recommendation: T1 now (#151); T2 only after the #154 cap fix is measured.**

---

## G. ACCESSIBILITY RESULTS (WCAG 2.2 AA)

| SC | Result | Evidence |
|---|---|---|
| **1.4.1 Use of Colour** | **FAIL** | Clusters: `cluster-stay` and `cluster-bike` computed styles byte-identical — no cue of any kind. Markers: plain circles of near-identical radius; Tourist info↔Hotels ΔE 0.9 under simulated protanopia with no shape/glyph/pattern alternative. |
| **1.4.3 Contrast (Minimum)** | **NO FAILURE OBSERVED** | 0 failures / 124 rendered text elements, Light and Dark. Min 5.59:1 (Light), 4.64:1 (Dark) against 4.5:1. Three modes, two languages. Composited backgrounds computed through the translucent panel stack. **Scope:** the states this harness reached. Error states, transient toasts and parts of the evidence drawer were never rendered, so this is not a conformance claim for the product. |
| 1.4.4 Resize Text | **PASS (indicative)** | At 683×384 (≈200% of 1366×768) layout reflows to the stacked small-screen IA; no horizontal page scroll; no clipping. Measured by viewport emulation, **not** by true browser zoom — see limitations. |
| 1.4.10 Reflow | **PASS (indicative)** | Same test; stacked layout, `horizontalPageScroll: false`. |
| **1.4.11 Non-text Contrast** | **FAIL (default basemap)** | All 5 default operational categories below 3:1 against the default basemap; 4 of 5 across 100% of sampled tile area; worst median 1.28:1 (full-pixel estimator). 224,712 real tile pixels, one basemap. |
| **1.4.12 Text Spacing** | **NO FAILURE OBSERVED** | Injected line-height 1.5 / letter-spacing 0.12em / word-spacing 0.16em / paragraph 2em: **0 newly clipped elements**, no horizontal scroll. **Scope:** one viewport, one mode, Inter installed — not re-run on the Segoe UI fallback (§F.2). |
| **2.4.7 Focus Visible** | **NO FAILURE OBSERVED** | **251/251** focusable elements reachable in the default PLACE state show an indicator; 243 use a consistent 2px `#075f9a` outline at 2px offset. **Scope:** elements present in that one state; controls that appear only in other modes or dialogs were not enumerated. |
| 2.4.11 Focus Not Obscured | **NOT TESTED** | Requires scroll-position-dependent testing against sticky headers and the evidence drawer. Not measured; **do not claim conformance.** |
| **2.5.8 Target Size** | **NO FAILURE CONFIRMED (via exceptions)** | 22 targets below 24px; 20 pass the spacing exception (nearest real neighbour 27.4–88.2px) or the inline exception. The 2 residuals are map markers/clusters, where position is geographically essential (explicit WCAG exception). |

**Honest limits on these results.**
- Contrast was computed from composited sRGB values, which is correct for the chrome but is a *model* for the map: it assumes uniform alpha compositing over sampled tile pixels and does not account for anti-aliasing at a 2.8–4.2px radius, which will make small markers perform **worse**, not better, than reported.
- Tile imagery is dynamic. Positron can be re-rendered by CARTO at any time; these numbers describe tiles served on 2026-11-01.
- CVD figures are **simulations** (Machado 2009). They screen for risk. They are not a substitute for testing with people who have colour-vision deficiencies.
- 1.4.4 / 1.4.10 were tested by viewport emulation, which approximates but does not equal true browser zoom (it does not reproduce zoom's effect on media-query-independent rasterisation or on the Leaflet tile scale factor).
- Font metrics are Inter-specific (§F.2); clipping results are not established for the Segoe UI fallback.
- **Do not treat the 1.4.3 pass as a conformance certificate.** It is a pass on every text pair this harness rendered, in the states it reached. It does not cover unreached states (error states, some drawer contents, transient toasts).

---

## H. CANDIDATE COMPARISON

Identical conditions: composited over the 22 dominant Positron colours weighted by measured area share; CIEDE2000 over the modal colour; Machado 2009 CVD.

| | **A — Current** | **B — Contrast-adjusted** | **C — Current hues + opaque dark outline** |
|---|---|---|---|
| Edge CR, median | 1.30 – 2.88 | **4.43 – 5.35** | **14.75** (all) |
| Edge CR, min | 1.00 – 2.27 | **3.49 – 4.22** | **11.40** |
| % tile area < 3:1 | **85 – 100%** | **0%** | **0%** |
| Fill CR, median | 1.25 – 2.35 | 3.29 – 3.81 | 1.25 – 2.35 (unchanged) |
| Worst ΔE, normal vision | 10.2 | **13.0** | 10.2 |
| Worst ΔE, protanopia | 0.9 | 4.6 | 0.9 |
| Worst ΔE, deuteranopia | 3.7 | **1.4 (worse)** | 3.7 |
| Worst ΔE, grayscale | 2.4 | **0.1 (far worse)** | 2.4 |
| Pairs ΔE<10, grayscale | 7/10 | **10/10 (all)** | 7/10 |
| Established colour identities changed | — | **All 5** | **None** |

**Reading the result honestly — and it is not the result the brief anticipated.**

- **B fixes SC 1.4.11 and genuinely improves normal-vision separability.** But it buys its contrast by equalising lightness across all five categories, which **destroys grayscale separability entirely** (all 10 pairs below ΔE 10; worst pair 0.1) and makes **deuteranopic** separation *worse* than today (1.4 vs 3.7). It also changes all five established category identities, which carries re-learning cost and touches a documented visual contract.
- **C achieves a decisively better contrast outcome than B** — 14.75:1 median, 11.40:1 worst, 0% failing area — **while changing no established colour at all.** The dark outline is what the eye detects; the unchanged hue remains the identifier.
- **Neither B nor C fixes categorical discrimination under CVD.** C leaves it untouched (ΔE 0.9 protan); B makes parts of it worse.

**Conclusion: C is the better candidate on the evidence, and the brief's premise that the fix is a palette swap is not supported.** The right structure is a **two-layer fix with different owners**:

1. **Detectability (SC 1.4.11)** → Candidate C. Minimal, reversible, zero semantic change, largest measured gain.
2. **Discrimination (SC 1.4.1)** → **not a colour problem at all.** It requires a non-colour channel: per-category glyph or marker shape, which simultaneously resolves the protanopia ΔE 0.9 confusion, the grayscale collapse, and the cluster-identity failure. No palette can fix this.

**No winner is declared on appearance or on contrast arithmetic alone.** C wins on measured contrast *and* on preservation of scientific meaning; the discrimination problem is referred out of the palette question entirely.

---

## I. PRIORITISED ISSUE REGISTER

### P0-1 — Default operational markers fail SC 1.4.11 against the default basemap — **#150**

| | |
|---|---|
| **Evidence** | §C.2. 224,712 real Positron pixels. Edge CR 1.30–2.88 median; 4/5 categories fail across 100% of sampled area. Same palette scores 4.88–11.11 on `dark_all`. |
| **Component** | `js/app.js:4-12` `LAYER_COLOR`; `js/app.js:2325-2344` `addMarker()` |
| **Failure** | Museums, Tourist info, Hotels, BiciMAD, Metro are not reliably detectable on the default map. Not a hypothesis — measured. |
| **Affected** | All users, default configuration, every task beginning "find/identify a place". Worst for low-vision users and on low-quality or glare-affected displays. |
| **Baseline** | Full-pixel edge medians: Metro 1.28:1, BiciMAD 1.43:1, Tourist info 1.88:1, Hotels 2.19:1, Museums 2.82:1 |
| **Proposal** | Candidate C: opaque dark outline (`#16222f`, weight ≈1.5) retaining all current fills. |
| **Benefit** | Edge CR → 14.75 median / 11.40 min; 0% failing area; **no colour identity changed**. |
| **Regression risk** | Added visual weight at 2.8px (BiciMAD) may read as heavier dots; outline must not approach cluster-chip darkness. Requires a visual check at z12 and z17 on dense and park tiles. |
| **Acceptance** | Every default category ≥3:1 edge contrast across ≥99% of sampled tile area on all three basemaps; no category hex changed; cluster/marker salience ratio ≤2:1. |
| **Tests before implementation** | Re-run the tile-sampling harness on `light_all`, `dark_all` and Esri imagery; visual diff at 4 zooms × 3 site types; confirm `LENS_BASEMAP_STYLES` unaffected. |

### P0-2 — Cluster chips invert visual hierarchy and carry no category identity — **#149**

| | |
|---|---|
| **Evidence** | §C.3. 191 clusters, 21.4% of viewport, 12.98:1, `cluster-stay` ≡ `cluster-bike` byte-identical. |
| **Component** | `.poi-cluster` / `.cluster-*` in `css/app.css`; `addClusterMarker()` `js/app.js:2388+`; `DENSE_LAYER_TYPES` |
| **Failure** | The least informative mark dominates the map at ≈11× the salience of the evidence; two categories are visually indistinguishable; the Dark `--panel` surface is hard-coded into Light map chrome. |
| **Affected** | All users; directly violates the §5.3 contract that prominence must not imply reliability. |
| **Baseline** | Cluster 12.98:1 vs Metro marker 1.15:1; 0 distinguishing cues between cluster types. |
| **Proposal** | Appearance-aware cluster surface (light-theme token, not `rgba(8,16,27,.92)`); reduce the white glow/dashed treatment; give each cluster its category colour and/or glyph; reconsider cluster thresholds so 191 chips is not the default state. |
| **Benefit** | Restores evidence-first hierarchy; restores category identity to ~21% of map marks; removes the map/panel luminance discontinuity (§E.3). |
| **Regression risk** | Lighter chips need their own ≥3:1 against Positron and ≥4.5:1 for the count label. Category-coloured chips must not be confused with individual markers. |
| **Acceptance** | Cluster-to-marker salience ratio ≤2:1; cluster count label ≥4.5:1; `cluster-stay` and `cluster-bike` distinguishable without colour alone; cluster chrome uses appearance tokens. |
| **Tests** | Contrast harness on cluster surface; automated assertion that cluster types differ in a non-colour property; screenshot diff at 3 viewports. |

### P1-1 — Analysis panel capped at 720px, wasting up to 252px of available height — **#154**

Evidence §E.1 · `css/app.css:298` · 46% of content below fold at 1920×1080 with 252px unused · Proposal: raise/remove the cap, aligning `.panel` with `.left`'s uncapped `max-height` · Risk: very tall panels on large displays may hurt scan-ability; consider a higher cap rather than none · Acceptance: ≤25% below fold at 1920×1080; no change at 1366×768 · Tests: geometry harness at 4 viewports, EN and ES.

### P1-2 — No webfont declared; typography is machine-dependent — **#151**

Evidence §F.2 · No `@font-face` anywhere; Inter vs Segoe UI differ by 6.3% in measured width · Proposal: self-host Inter with `font-display: swap` · Benefit: deterministic metrics; all density/clipping results become reproducible · Risk: added payload; licence compliance (Inter is OFL) · Acceptance: identical rendered metrics on a machine without Inter installed · Tests: re-run clipping and Spanish-wrapping checks with local Inter disabled.

### P1-3 — Scientific caveats rendered at the 10px microtext token — **#151**

Evidence §D, §E.2 · 11 left-rail nodes and 34 PLACE-panel nodes at 10px, including "granted ≠ built", "not in metrics", "Park context is excluded from lens counts" · Proposal: Candidate T1 · Benefit: the content the product most depends on being read becomes readable · Risk: ~6% content growth; sequence after P1-1 · Acceptance: no interpretation-critical string below 11px; no new clipping in EN or ES.

### P2-1 — Categorical discrimination unavailable without colour — **#152**

Evidence §C.5 · Tourist info ↔ Hotels ΔE 0.9 (protanopia); 7/10 pairs ΔE<10 in grayscale; all markers identical circles · Proposal: per-category glyph/shape as a second channel · Note: **this is the only fix for SC 1.4.1**; no palette resolves it · Acceptance: every category pair distinguishable with colour removed entirely.

### P2-2 — Silent OSM substitution when the CARTO key is absent — **#155**

Evidence §B.2 · `js/app.js:206` · Fork/local/PR-preview/secret-expiry all silently serve OSM while the selector still says "CARTO Positron" and Positron-tuned overlay styles persist · Proposal: surface the fallback in the attribution/selector and log it · Acceptance: fallback state is visible to the user and detectable in tests.

### P2-3 — Layer switches 27×15px; disclosure buttons 114×11.6px — *not filed*

Evidence §D · Conformant via SC 2.5.8 exceptions, but small for sustained precise pointing · P2 ergonomics, not a conformance defect.

### P3-1 — Four legend dots render 8×6px (elliptical, not circular) — *not filed*

`.metric-head .dot{width:6px;height:6px}` overridden to 8px width in context; cosmetic.

### P3-2 — `line-height: normal` used alongside tokenised ratios — *not filed*

Internal inconsistency; no measured harm.

---

## J. VISUAL EVIDENCE PACKAGE

The measurement harness and its outputs are committed under
[`research/lens_ux_vision_g0/`](../research/lens_ux_vision_g0/):

| Path | Contents |
|---|---|
| [`README.md`](../research/lens_ux_vision_g0/README.md) | Pinned inputs, reproduce instructions, limits |
| [`color_analysis.mjs`](../research/lens_ux_vision_g0/color_analysis.mjs) | Contrast, CIEDE2000 and CVD analysis — no key, no network, no dependencies |
| [`sample_positron_tiles.mjs`](../research/lens_ux_vision_g0/sample_positron_tiles.mjs) | Regenerates the background palette from production tiles (requires `CARTO_BASEMAP_KEY`) |
| [`results/positron_palette_20261101.json`](../research/lens_ux_vision_g0/results/positron_palette_20261101.json) | Measured Positron palette, per-tile luminance summary, `dark_all` control |
| [`results/color_analysis_20261101.json`](../research/lens_ux_vision_g0/results/color_analysis_20261101.json) | Full three-candidate output |
| [`capture_map_evidence.mjs`](../research/lens_ux_vision_g0/capture_map_evidence.mjs) | Executable reproduction of the §C.3 visual claims: cluster census, coverage, category-identity check, salience ratio |
| [`results/map_evidence_20261101.json`](../research/lens_ux_vision_g0/results/map_evidence_20261101.json) | That script's output, with attribution and limitations |

Reproduce the contrast and separability tables in §C and §H with:

```bash
node research/lens_ux_vision_g0/color_analysis.mjs
```

**Two estimators.** This report quotes the **full per-pixel sample** (224,712 background pixels). `color_analysis.mjs` uses a **22-colour area-weighted approximation**, so that it runs with no dependencies and no CARTO key. **It therefore cannot reproduce this report's contrast figures**; it reports them from the recorded `full_pixel_reference` block alongside its own, and checks the divergence. Observed maximum divergence across both palettes is **0.12**, always in the optimistic direction, so this report carries the conservative figures. The per-pixel estimator is regenerable with `sample_positron_tiles.mjs --full-pixel-contrast`.

**Corrections applied at review (2026-11-01).** This report was re-audited against its own harness before the evidence was committed. Five numeric claims were wrong and are corrected above:

1. The §C.2 table mixed the two estimators (Metro edge 1.30 and two `min` cells came from the weighted approximation, the rest from the per-pixel pass). It is now purely per-pixel: Metro edge median is **1.28**, not 1.30.
2. The maximum estimator divergence was stated as 0.06. That was derived from palette A alone; across both palettes it is **0.12**.
3. The salience ratio was stated flatly as 11.3×. It depends on the reference tile colour: **11.2×–11.3×**, reported as ≈11×.
4. Analysis-panel content height is **state-dependent** (the first-run tutorial card adds ~225px). The original figures were the tutorial-dismissed state without saying so; both states are now tabulated in §E.1.
5. Several WCAG rows read as unqualified PASS verdicts. They are now **NO FAILURE OBSERVED**, scoped to the states this harness actually reached.

None of these changes a verdict. All five made a claim stronger or broader than its evidence, which is the failure mode this report is supposed to guard against.

**Not committed.** Screenshots and the isolated-server log were working artifacts and are not part of the evidence package; every numeric claim here is regenerable from the harness above. The verified baseline tree was obtained with `git archive origin/main` into a scratch directory and discarded.

**Sampling methodology.** Primary target: live GitHub Pages deployment of `913de27` (the only runtime with the production CARTO key and built `runtime_poi.json`). Tiles fetched directly from `basemaps.cartocdn.com` and decoded via `createImageBitmap` → `OffscreenCanvas` → `getImageData`. 6 sites × 4 zooms (z12/14/16/17) = 24 tiles = 1,572,864 pixels; 224,712 sub-sampled for contrast. Site classes: dense urban (Sol, Salamanca), park-heavy (Retiro, Casa de Campo), sparse (Villaverde, Vicálvaro). Viewports 1366×768, 1440×900, 1920×1080, plus 683×384 as a 200%-zoom proxy. Both appearances, both languages, all three modes. All measurements taken after fonts, tiles and data had settled; the deployment manifest was checked for `build_state: "pass"` before any visual claim, so no network failure is reported as a design defect.

**Repository integrity.** `git status --porcelain` and `git rev-parse HEAD` were captured before and after all work and are **identical**. The two pre-existing modified files and three untracked paths were left untouched. One client-side CSS injection was made in the audit browser for the SC 1.4.12 test and removed in the same session (verified `injectedStyleNowPresent: false`, `letterSpacing: normal`); it never touched the repository or the deployment.

---

## K. HUMAN VALIDATION PROTOCOL

**Status: not performed.** Every perceptual claim above is instrument-measured or simulated. The following would close the gap.

**Participants.** 6–8 exploratory: 2–3 urban planners/GIS professionals, 2 tourism/policy analysts, 2–3 informed citizens. Recruit **at least 2 with a diagnosed colour-vision deficiency** — the protan/deutan findings (§C.5) are the least safe to generalise from simulation. Exploratory sample: directional only, **not statistically definitive**.

**Design.** Within-subjects, A vs C (B only if a stakeholder requires it), counterbalanced by Latin square; task order randomised; 1366×768 and 1920×1080 counterbalanced.

**Tasks.** (1) Find a named official place. (2) Identify all markers of one category in a bounded area. (3) Distinguish two adjacent categories (Museums vs Tourist info; Hotels vs BiciMAD clusters). (4) Read a specific figure in the right panel. (5) State the scope of that metric — barrio or Lens circle? (6) Locate its source and its interpretation limit. (7) Compare Lens A and Lens B on one metric. (8) Toggle a layer without losing the current reading.

**Measures.** Completion rate; time to completion; **category-identification accuracy** (primary, for #150/#149); **incorrect interpretations** (primary, for scope/limit tasks — the scientific-integrity outcome); navigation errors; subjective readability and visual effort (per-task, not only post-session); preference.

Report perception, accessibility, analytical accuracy and visual comfort as **four separate outcomes**. A palette that wins on preference while raising misinterpretation must be rejected — under the stated priority order, scientific integrity outranks comfort.

**Decision rule, set in advance.** Adopt C if category-identification accuracy improves materially with **no increase** in incorrect interpretations. Any rise in scope/limit misinterpretation blocks adoption regardless of preference.

---

## L. PHASED IMPLEMENTATION ROADMAP

Minimal, independently testable, independently revertible. **None implemented.**

| Phase | Issue | Scope | Gate |
|---|---|---|---|
| **PR-1** | #149 | Cluster surface + category identity (map chrome only; no `LAYER_COLOR` change) | Salience ratio ≤2:1; label ≥4.5:1; cluster types distinguishable without colour |
| **PR-2** | #150 | Candidate C outline on operational markers (no hex changed) | ≥3:1 edge contrast ≥99% of tile area on all 3 basemaps |
| **PR-3** | #154 | Panel height cap | ≤25% below fold at 1920×1080; 1366×768 unchanged |
| **PR-4** | #151 | Self-hosted Inter | Identical metrics without locally installed Inter |
| **PR-5** | #151 | Candidate T1 caveat sizing | No interpretation-critical string <11px; no new clipping EN/ES |
| **PR-6** | #152 | Non-colour category channel (glyphs) | All pairs distinguishable with colour removed |
| **PR-7** | #155 | Visible basemap-fallback state | Fallback detectable in UI and in tests |
| **Gate** | #153 | §K human validation before any `LAYER_COLOR` hex change (i.e. before Candidate B is ever reconsidered) | — |

PR-1 before PR-2: with clusters still dominant, PR-2's marker gain would be hard to perceive or evaluate. PR-3 before PR-5: T1 adds content height and needs the cap lifted first. PR-4 and PR-5 are the two halves of #151 and may land together.

---

## 15. FINAL DECISION GATE

Separate verdicts, because the evidence differs sharply by component.

| Component | Verdict | Basis |
|---|---|---|
| **Basemap (CARTO Positron)** | **GO — KEEP** | 1.57M pixels measured across 6 sites × 4 zooms. 16–32 colours/tile, 0.69–1.00 luminance band, structured hierarchy. Correct choice on this evidence; no experiment justified. Six sites are not a survey of Madrid. |
| **Map overlay colours & clusters** | **MODIFY — TARGETED** | Reproducible SC 1.4.11 failure across all 5 default categories; ≈11× hierarchy inversion; zero cluster category identity. #150, #149. |
| **Left panel** | **MODIFY — TARGETED** | Structure and contrast are sound (0/40 failures, min 6.23:1). 100% of text ≤12px, caveats at 10px. #151. |
| **Right panel** | **MODIFY — TARGETED** | 0 contrast failures in all 3 modes. 720px cap wastes 252px and hides 46% of content at 1920×1080. #154. |
| **Typography system** | **MODIFY — TARGETED (scale: GO)** | All 7 tokens intact and correctly defined. Defects are in application (10px caveats) and in the undeclared webfont. T1, not T2, for now. |
| **Chrome colour system (Light)** | **GO — KEEP** | 0/124 failures Light *and* Dark; 251/251 focus indicators; clean 1.4.12 result; bilingual with no clipping. Scoped to the states exercised — see §G. |
| **Categorical discrimination (CVD)** | **HOLD — INSUFFICIENT EVIDENCE** | Simulation shows ΔE 0.9 protan confusion, but no person with CVD has been tested, and **no palette fixes it** (B is worse in deuteranopia and grayscale). Needs §K before any colour change. |

### Explicitly distinguished

**Verified** (direct observation): baseline is `913de27`; local checkout is 200 commits stale and dirty; Positron loads genuinely with no fallback; default appearance is System→Light; appearance and basemap are independent; default layers; all 7 type tokens; Light tokens active; cluster styles byte-identical; `.panel` 720px cap in source; no `@font-face` anywhere.

**Measured** (quantified): 1,572,864 tile pixels; 224,712 contrast samples; marker edge contrast 1.28–2.82 (full-pixel) on light vs 4.88–11.11 on dark; 191 clusters / 21.4% coverage (bounding-box upper bound) / 12.98:1; ≈11× inversion; 0 text-contrast failures across 124 elements in both appearances and all 3 modes; 251/251 focus indicators; 0 newly clipped elements under 1.4.12; panel below-fold 46–59%; Inter vs Segoe 6.3% width delta.

**Merely simulated** (not observed in humans): all protanopia/deuteranopia/tritanopia/grayscale results; Candidate B and C contrast projections (modelled compositing, not rendered pixels — anti-aliasing at 2.8–4.2px will make real markers perform *worse* than modelled); 200% zoom via viewport emulation rather than true browser zoom.

**Uncertain / untested:** SC 2.4.11 Focus Not Obscured; real task performance, comprehension and misinterpretation rates; subjective comfort; rendering with the Segoe UI fallback; behaviour under Windows display scaling other than 100%; whether 191 clusters is representative across Madrid; stability of CARTO's tile rendering over time.

**What should change first:** **#149 (clusters)**, then **#150 (Candidate C outlines)**. Together they are the smallest reversible change that restores an evidence-first visual hierarchy, and neither alters a single documented colour identity.

**What should remain untouched:** the CARTO Positron basemap; every `LAYER_COLOR` hex (until §K); the Light chrome token system; Lens A/B structural grammar (solid/dashed, halos, centre markers, legend sync); the seven typography tokens; all evidence semantics, abstention states, provenance chips and scope language.

---

### Withdrawn during the audit

Two candidate findings were disproved by follow-up testing and are recorded so they are not re-raised:

1. **"No focus indicators anywhere" (251/251 missing).** A programmatic `.focus()` probe failed to trigger `:focus-visible`. After establishing keyboard modality with a real Tab press, the corrected result was **251/251 present**. SC 2.4.7 is a pass.
2. **"Analysis panel height does not track viewport resize."** A stale 660px reading across three viewports was an artifact of the browser pane's own scaling. A clean reload confirmed `tracksViewport: true`. Only the 720px cap is real.

**No code was changed. No implementation is authorised by this document.**
