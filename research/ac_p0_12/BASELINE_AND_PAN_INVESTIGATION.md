# AC-P0-12 map-pan investigation — pre-existing limitation vs PR #96 regression

**PR #96 · investigated at head `ca81e5b` · test-only.** The owner's valid physical
Windows 11 / Chrome / **Intel UHD 620** AC-P0-12 run (commit `ab1f650`) recorded:
marker drag **PASS** (p95 136.6 ms, 61 samples, fresh), radius drag **PASS** (p95
144.9 ms, 56 samples, fresh), **map pan FAIL** (p95 66.8 ms, 273 samples, vs the
33.3 ms ceiling), at **viewport 1036×518, devicePixelRatio 2**. Overall **FAIL for
this Windows device class**. (Owner-reported summary; the raw device JSON stays with
the owner and is not published here without approval, and its **FAIL is preserved
unchanged**.)

**Question:** is the map-pan failure pre-existing, or a regression introduced by
PR #96 (the P0-a membership promotion)?

**Answer (two separate findings, both now backed by real-hardware measurement):**
1. **Pre-existing absolute failure — CONFIRMED.** Clean `origin/main` also fails the
   33.3 ms pan ceiling by a wide margin on this hardware.
2. **Incremental PR regression — NOT materially present.** A warmed, drift-robust,
   paired hardware comparison shows PR ≈ `main` (PR often marginally faster); **0 of
   10 warmed pairs show PR materially slower.**

> **Measurement classes are kept strictly separate.** The owner's `ab1f650` run is a
> **physical actual-gesture device** result. Everything in §3 below is
> **`hardware_automated`**: scripted Playwright mouse drags on real hardware Chrome.
> These are **not human physical gestures** and are **never** `device_grade` /
> `actual_gesture` under the AC-P0-12 manual-device contract; they do not substitute
> for the owner's physical Safari/device validation on iPad/iPhone.

---

## 1. Diff-level evidence: PR #96 does not touch the map-pan render path

- `git diff origin/main...HEAD -- js/app.js` adds **no** map `move` / `moveend` /
  `drag` / pan handlers; the only `map.on(...)` are `zoomend`/`resize`/`click`, none
  of which fire during a pan.
- A **pan is a drag, not a click**; `map.on("click")` (which moves the Lens and calls
  `refresh()`) is not triggered by panning, so `refresh()` — the only path that
  renders the promoted membership block — does **not** run during a pan.
- The promoted membership is **panel DOM** (`#planningMembership` chips), not a map
  layer: P0-a adds **no map geometry** and changes **no renderer**.
- The **724 ámbitos are not rendered** — `renderPlanningPolygon` draws only the
  single *containing* ámbito (none at the default centre). They are used for
  point-in-polygon queries, not drawn. The membership scan `ambitosIntersecting`
  runs on marker/radius **settle**, never during a pan.
- What repaints during a pan (identical on `main` and PR): basemap raster tiles, the
  default-visible POI canvas markers (≈1,400 points), the admin lattice (153
  features / 31,648 vertices), Lens/halo — all pre-existing (#68/#71, merged before
  P0-a), all scaled by devicePixelRatio.

## 2. Automated comparison harness (one command, no manual steps)

`node research/ac_p0_12/auto_compare.mjs [--rounds=N] [--warmup=N] [--frames=N] [--dpr=2]`
builds a **disposable clean `origin/main` worktree**, applies **only**
`baseline_app_instrumentation.patch` (the two test-only `js/app.js` hooks — no P0-a)
plus the runner, serves the PR checkout and the baseline on two loopback HTTP
servers, launches **real headed hardware-accelerated Chrome**, and drives **identical
automated map-pan gestures** against both — then tears everything down (browser,
servers, worktree) and writes versioned JSON to `results/`. It **fails closed**
(`COMPARISON UNAVAILABLE`) if the baseline cannot be built or Chrome cannot run with
a hardware (non-SwiftShader) GPU, and never touches unrelated worktrees/untracked
files. Each run records renderer, DPR, viewport, map area, zoom, centre, layers,
cache, both SHAs and timing.

**Methodology note — warm-up and drift (important).** The GPU/browser warms strongly
over a session: an **un-warmed** run showed pan p50 fall from ~350 ms (first pan) to
~66 ms (twelfth), which **swamps any arm difference** and produced a spurious
PR-slower gap. The harness therefore **discards warm-up pans**, then runs **tight
alternation with per-adjacent-pair deltas** (temporally adjacent PR/main cancel slow
drift) and **flips the within-pair order each round**. A PR regression is called
*material* only when the paired p50 delta exceeds the run-to-run noise floor **and**
≥70 % of warmed pairs show PR slower.

## 3. Results — `hardware_automated`, Intel UHD 620, dpr 2, map 1036×650

Two independent warmed sessions (evidence JSON in `results/auto_compare_*.json`):

| Session | arm | pooled p50 | pooled p95 | vs 33.3 ms |
|---|---|---|---|---|
| A (4 pairs) | main | 50.0 | **83.7** | FAIL |
| A | PR #96 | 17.0 | **83.2** | FAIL |
| B (6 pairs, 444 frames/arm) | main | 33.4 | **83.3** | FAIL |
| B | PR #96 | 16.8 | **83.3** | FAIL |

Drift-robust **paired PR − main**: session A p50 **−0.7 ms** / p95 **−16.4 ms**;
session B p50 **−0.2 ms** / p95 **−0.1 ms**. **PR was slower in 0 of 10 warmed pairs**
(run-to-run noise floor ≈ one 16.7 ms frame). A warmed `#planningMembership`
display-A/B diagnostic was **inconsistent in sign across sessions** (+16.7 ms vs
−16.9 ms ≈ ±one frame), i.e. **noise, no reproducible panel effect**.

**Reading:**
1. **Both arms fail the 33.3 ms pan ceiling by a wide margin** (p95 ≈ 83 ms warmed),
   consistent with the owner's physical 66.8 ms and with K12 §12 (weak Intel laptop
   Leaflet real-payload pan fails). → **The failure is PRE-EXISTING.**
2. **No material incremental PR overhead** once warm-up/ordering is controlled
   (paired deltas within noise; PR often marginally faster; 0/10 pairs PR-slower). →
   **P0-a does not materially worsen map-pan on this hardware.** This is an
   evidence-based finding from scripted hardware runs, **not** a physical-device
   proof; the iPad/iPhone Safari physical validations remain separately required.

> This supersedes the earlier `ca81e5b` draft of this section, which (a) read the
> owner DPR as "≈1.0–1.5" — **corrected: the owner JSON records dpr 2** — and (b)
> reported an un-warmed PR-vs-`main` gap as a *possible incremental regression*. With
> warm-up + paired controls that gap disappears.

## 4. Bottlenecks, ranked by evidence

1. **(Dominant, high confidence) Pre-existing Leaflet canvas + raster repaint at
   dpr-scaled resolution on a weak integrated GPU.** Evidence: clean-`main` warmed
   p95 ≈ 83 ms (§3), owner device 66.8 ms, K12 §12. Fed by ≈1,400 default POI canvas
   markers + the 31,648-vertex admin lattice + basemap tiles — all unchanged by P0-a.
   Improving it is the **K12 renderer question** (MapLibre), already **NOT YET / keep
   Leaflet**, gated on the weak-integrated-GPU support-floor decision — **out of
   scope for P0-a**.
2. **(Multiplier, architectural) devicePixelRatio.** Canvas work scales with dpr²;
   the owner's device and this harness both ran at **dpr 2**.
3. **Not a factor — the P0-a membership panel.** The warmed paired comparison shows
   no material PR overhead, and the panel display-A/B is at the noise floor with
   inconsistent sign. (The earlier `ca81e5b` "possible panel effect" was the
   un-warmed artifact.)
4. **Not factors:** the 724-ámbito polygon layer (not rendered); the
   `ambitosIntersecting` scan (never runs during a pan).

## 5. Optimization — not justified for PR #96

No material P0-a pan regression is supported by the evidence, so there is **nothing
P0-a-specific to optimise**, and the owner's constraints forbid speculative work. The
dominant cost is the **pre-existing K12 renderer limitation**, documented separately;
addressing it is the MapLibre decision, not a P0-a change, and must not be an
unapproved rewrite. (Had a material regression been confirmed, the smallest bounded
mitigation would have been CSS containment that keeps the block **visible and
accessible** — never hiding the promoted evidence — but it is not warranted.)

## 6. The owner's physical baseline is still welcome but no longer required for causation

The `hardware_automated` comparison already answers causation on the UHD 620 class.
If the owner still wants a **physical** main-vs-PR confirmation, the one-command
harness is `node research/ac_p0_12/auto_compare.mjs`; a manual physical baseline would
use the port-8001 steps in the README (§C). If any baseline cannot be built, the
harness records **COMPARISON UNAVAILABLE** and no causation is asserted.

## 7. GO / HOLD recommendation for PR #96

- **Functional correctness: GO** (unaffected; P0-a correctness, freshness, scientific
  and accessibility contracts and CI hold).
- **No P0-a pan regression**: the AC-P0-12 map-pan FAIL on the Intel UHD 620 class is
  a **pre-existing Leaflet limitation**, confirmed on real hardware; PR #96 does not
  cause or worsen it. The physical Windows FAIL stands, unchanged and correctly a
  property of the device class, **not** of P0-a.
- **AC-P0-12 device gate: FAIL for the Intel UHD 620 / weak-integrated-GPU class →
  the PR remains HOLD for that class** per `docs/UX_I1_P0A_MEMBERSHIP.md` §4. The
  threshold is **not** weakened and UHD 620 is **not** silently dropped.
- **The only remaining blocker is a device-support policy decision** (K12 §12.4
  blocker 2), stated precisely in §8. P0-a engineering is complete; there is no P0-a
  fix left to make.

## 8. The precise decision for the owner (binary, with consequences)

**Is the Intel UHD 620 / weak-integrated-GPU laptop class a HARD supported-device
floor for AC-P0-12 release?**

- **(A) NO — it is below the supported floor** (supported floor = modern desktop +
  the declared iPad/iPhone Safari models). **Consequence:** the UHD 620 map-pan FAIL
  is a documented limitation of a below-floor class and **does not block PR #96**. The
  remaining release gate is then the **physical iPad/iPhone Safari actual-gesture
  AC-P0-12 runs** (device_grade — these cannot be produced by automation here). When
  those pass, PR #96 can go **READY for review → merge on explicit owner
  authorization**.
- **(B) YES — UHD 620 is a hard floor.** **Consequence:** *no* version of P0-a — and
  *not even clean `main`* — can meet the 33.3 ms pan ceiling on that hardware with the
  current Leaflet stack (proven: `main` fails too). Passing it requires the **K12
  renderer work (MapLibre)**, a separate, currently-unapproved effort. PR #96 then
  **stays HOLD behind that renderer decision**, independent of P0-a — merging P0-a
  would not change the UHD 620 outcome either way.

Either way: **PR #96 stays Draft and unmerged; no deploy; no HATI change; no
threshold weakening.** Automation does not substitute for the physical iPad/iPhone
Safari approvals.
