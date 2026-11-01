# PR #157 / Issue #149 — release decision memo

Implementation frozen at **V2, HEAD `5e8ebff9525a4aebffec6df7c5f169831d1445ee`** (14/14 CI jobs pass, worktree clean, PR is an open Draft, mergeable, `main` unchanged at `c3d73ed`). Commits after `5e8ebff` are research/docs only (this memo, measurement tools, results); no production file changes after `5e8ebff`. Not an accessibility conformance statement.

## 1. Is the rendered cluster border *essential* under SC 1.4.11? (reasoning and limits)
SC 1.4.11 (AA) requires ≥ 3:1 against adjacent colours for (a) visual information **required to identify** UI components and states and (b) graphical objects **required to understand** content.

| element | role | required by 1.4.11? | evidence |
|---|---|---|---|
| **count** (numeral) | text identifying the control and its content | text rule (1.4.3, 4.5:1) rather than 1.4.11 | p05 ≥ 16:1 in-Lens, ≥ 4.8:1 out-of-Lens on real tiles |
| **category glyph** | non-text graphic that carries the category | **yes** (b); adjacent colour = chip fill | strongest pixel p05 ≥ 16:1 / ≥ 4.4:1; 41–49 % of its 11 px box ≥ 3:1; recognised for 100 % of measured chips (screening) |
| **border / halo ring** | boundary of the control | **arguably not required to identify it**: a numeral + category glyph already identify the control and distinguish it from individual circle markers (plain, no text/glyph) | boundary figures in `FINAL_REVIEW_149.md` |
| **focus state** | state of an interactive component | **yes** (a) | §2 below — **not met everywhere** |
| **individual map markers** | plain circles with no text; fill/outline *are* their identification | yes, but they are **#150's subject**, not the cluster chip | out of scope here |
| layer-colour inset ring | decorative duplicate of the layer colour; the glyph carries category | no | – |

Reasoning for "arguably not required": WCAG's Understanding text for 1.4.11 treats a component whose identity is conveyed by its text/label as not needing its boundary to meet 3:1. **Limits:** (1) this is an interpretation, not a measurement — it is the accessibility owner's call; (2) the boundary may still matter for perceiving that numeral and glyph belong to **one** control and its extent (Gestalt grouping; on Positron the Light fill is only 1.2–1.7:1 against the tile, so grouping rests on the ring); (3) WCAG has no rule for photographic/variable backgrounds, no percentage threshold and no dual-tone rule — the ≥ 95 % dual-tone criterion (A5) is this project's heuristic; (4) conformance is per page and nothing here asserts it; (5) no human, screen-reader or low-vision testing; WebKit was behaviour-tested, not pixel-measured. Target size (box 38–46 px) is not a 1.4.11 matter and is not assessed.

## 2. Focus-indicator check on real tiles (Positron, Dark Matter, Esri × Light/Dark; `focus_check.mjs`)
Method: production page with `css/app.css`, `js/app.js`, `js/shell-copy.js` replaced by route interception (no key read); Lens A centred, z14, 1440×900. **Keyboard visibility ≠ CSS outline presence**, so each config (a) presses **Tab** until a cluster is reached and checks `:focus-visible`, then (b) for **11 in-Lens clusters and 12 out-of-Lens clusters** compares rendered pixels **focused vs unfocused** and tests the changed pixels for ≥ 3:1 against the adjacent unfocused colour. A focused cluster shows **two single-tone rings**, measured separately by CSS isolation inside the test session (tooltips hidden in these crops; the focus tooltip is an extra cue): **A** = the app-wide `:where([role="button"]):focus-visible` ring on the marker box (existing behaviour, unchanged by this PR); **B** = this PR's chip outline (3 px, offset 3 px, `--map-cluster-edge`).

Result: a real Tab sequence reaches a cluster in **5 presses in all 6 configs**, the element matches `:focus-visible` (23/23 clusters per config), the tooltip opens, and the rendered focus indicator changes pixels around the chip (ring A in 94–100 % of directions; ring B in 45–100 %, lowest on mismatched pairs). **But contrast is only adequate when the ring tone is opposite to the basemap** (the ring follows the *appearance*, the basemap is chosen independently):

| basemap · appearance | in-Lens: any ring pixel ≥ 3:1 **missing** in % of directions [95 % CI over 11 clusters] | A (box) / B (chip) strict % < 3:1 | out-of-Lens (12 clusters) any-missing % |
|---|---|---|---|
| Positron · Light | **6 [2–11]** | 16 / 13 | 1 |
| Dark Matter · Dark | **8 [4–13]** | 19 / 17 | 1 |
| Esri · Light | 19 [11–29] | 71 / 37 | 43 |
| Esri · Dark | 21 [14–27] | 53 / 40 | 24 |
| Dark Matter · Light | **45 [36–54]** | 86 / 78 | 63 |
| Positron · Dark | **52 [45–60]** | 90 / 86 | 60 |

So the focus state **is visible in the sense of rendering and keyboard reachability, but does not reach 3:1 in roughly half of directions on mismatched appearance/basemap pairs, and on satellite in 19–43 %**. Ring A pre-exists this PR — verified on the **untouched production page**: `role=button`, `:focus-visible`, marker-box outline `solid 2px off 3px` #075f9a (Light) / #9bd5ff (Dark), no chip outline, no `aria-label`, and Enter does **not** zoom (dead tab stop). The PR adds ring B (helps on matched pairs, no worse elsewhere), so this is a **pre-existing app-wide limitation made measurable, not a regression introduced here**; it is not fixed here. Remedy for a follow-up: a two-tone (dark + white) marker focus ring (the usual technique for backgrounds of unknown tone). Screenshot sheet (not committed, third-party tiles): `…/scratchpad/focus/focus_sheet.png`.

## 3. Is the A5 sample plan achievable? (`feasibility.cjs`, real clustering, 1 244 stay + BiciMAD points)
Independent contexts = **non-overlapping Lens circles**; repeated zooms, views and basemaps do **not** count. With the real clustering (cells 60 px at z14, 46 px at z15; none from z16) and Lens radius 100–5 000 m moved by clicking the map:

| zoom · radius | best single Lens (clusters) | disjoint contexts with ≥ 10 / ≥ 15 / ≥ 30 | top disjoint counts |
|---|---|---|---|
| z14 · 900 m (default) | 29 | 7 / 2 / 0 | 29, 20, 14, 12, 10, 10 |
| z14 · 1 500 m | 60 | 5 / 4 / 1 | 60, 19, 17, 17, 14 |
| z15 · 900 m | 50 | 2 / 1 / 1 | 50, 11, 9, 8 |
| z13 · 900 m | 8 | 0 / 0 / 0 | 8, 8, 8, 7 |

**"≥ 30 unique in-Lens clusters from ≥ 2 independent contexts" is achievable only by choosing the densest central Lens positions** (e.g. z14·900 m: 29 + 20 = 49 clusters in 2 contexts). Caveats: all such contexts are central, dense urban imagery (peripheral/park contexts hold ≤ 10 clusters at 900 m; ≥ 1 500 m is needed for diversity), two contexts in one city are disjoint but **not statistically independent**, the dataset snapshot changes, and a larger n only narrows the interval if the underlying failure rate is genuinely < 5 % — Dark-appearance Positron (6.1 %) and Esri out-of-Lens (8.4 % inked) would still fail. The requirement is therefore **measurable but not guaranteed to be met**, and a stricter definition of "independent" (separate cities/datasets) is not achievable with this product.

## 4. Owner decision
### STRICT — keep A5, PR #157 stays on HOLD
* **Needed:** a measurement campaign on ≥ 30 unique in-Lens clusters from ≥ 2 (preferably 3–4 incl. ≥ 1 peripheral/park) disjoint contexts, per basemap × appearance × state; success also requires Dark-appearance in-Lens (≤ 5 % fail), Esri and out-of-Lens inked results to meet the criterion, which current point estimates say they **will probably not without a further design change** (not permitted now).
* **Consequence:** nothing ships; the original dark chips (191 chips, no category identity, Dark literal in Light, dead keyboard tab-stops, no accessible names) remain; the PR can stay Draft indefinitely; effort is spent on a criterion that is a project heuristic rather than a WCAG requirement.

### BOUNDED RELEASE — accept A1–A4, transfer A5/A6 explicitly
* **Accepted as the implemented improvement:** A1 tokens/appearance-aware chrome; A2 count ≥ 4.5:1; A3 non-colour category glyph recognised at 11 px (screening); A4 keyboard activation (Enter/Space), accessible names and tooltips in EN/ES at render and on switch; no `LAYER_COLOR`/clustering change; 14/14 CI.
* **Documented, not waived:** A5 (boundary criterion not established: 11 clusters, 1 context); A6 (all real basemaps measured, A5 open); focus-contrast limitation of §2; out-of-Lens dash-gap boundary on Positron/Esri; Dark-appearance in-Lens; owner decision on whether the outline is SC 1.4.11-required; no human/AT validation; relative salience (#150/#153).
* **Required paper trail (owner-approved, none done yet):** (i) edit #149 with `ISSUE_149_PROPOSED_AMENDMENT.md` (A1–A4 closed by #157; A5/A6 and the focus-ring finding transferred; relative salience moved to #150/#153); (ii) a **named follow-up issue** (suggested: "UX-V1b — cluster boundary and marker focus-ring contrast across appearance × basemap"), scoped to the sample plan in §3, a two-tone focus ring, Dark-appearance chips and dashed-gap handling; (iii) release notes must not claim accessibility or WCAG conformance.
* **Consequence:** users get measurable improvements now (chips no longer dominate, categories distinguishable, keyboard works, Spanish names); known weaker areas ship knowingly, with an owner and a tracked issue. Risk: the accessibility limitations of §2 (largely pre-existing) ship until the follow-up lands.

## 5. Recommendation
**BOUNDED RELEASE**, conditional on the owner approving the explicit #149 amendment and a named follow-up issue, with no WCAG claim. Reasons: every measured axis improves or is unchanged versus the shipped baseline; no regression was found (focus ring A is unchanged; B is additive); A5 cannot be closed by more measurement alone because the failing cells (Dark-appearance Positron, Esri out-of-Lens) need a **design** change that this freeze forbids; and STRICT would keep known defects in production to protect a heuristic. If the owner or accessibility lead judges that the focus-state contrast of §2 blocks release, choose STRICT or add the two-tone focus ring to the scope (a separate, approved change).

## 6. Actions requiring owner approval (none taken)
1. Choose **STRICT** or **BOUNDED RELEASE**.
2. Authorise editing **#149** with the proposed amendment (agent did not edit it).
3. Authorise creating the **follow-up issue** (title/scope above).
4. Accessibility-owner ruling: is the cluster outline "required to identify" the component (SC 1.4.11)?
5. Authorise marking **PR #157 ready for review**, and separately any **merge/deploy** (not requested, not done).
6. If wanted: authorise a separate, bounded **two-tone focus-ring** change (out of the frozen scope).
