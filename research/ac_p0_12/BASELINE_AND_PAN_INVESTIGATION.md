# AC-P0-12 map-pan investigation — pre-existing limitation vs PR #96 regression

**PR #96 · head `ab1f650` · test-only.** Investigates the owner's valid Windows 11 /
Chrome / **Intel UHD 620** AC-P0-12 result: marker drag **PASS** (p95 136.6 ms, 61
samples, fresh), radius drag **PASS** (p95 144.9 ms, 56 samples, fresh), **map pan
FAIL** (p95 66.8 ms, 273 samples, vs the 33.3 ms ceiling) → overall **FAIL for this
Windows device class**. (Owner-reported summary figures; the raw device JSON stays
with the owner and is not published here without approval.)

**Question:** is the map-pan failure a pre-existing limitation of the Leaflet stack,
or a regression introduced by PR #96 (the P0-a membership promotion)?

> **Honesty:** every number in §3 was produced by an **automated synthetic
> mouse-drag** in the Claude built-in browser pane on a dev machine that happens to
> be an Intel UHD 620. **No human physical gesture was performed by these automated
> tests.** They are not a device validation and their absolute values are inflated
> by the pane (devicePixelRatio 2.5, embedded webview); only the **same-machine,
> same-session main-vs-PR comparison** is used, and only for direction and ranking.

---

## 1. Diff-level evidence: PR #96 does not touch the map-pan render path

- `git diff origin/main...HEAD -- js/app.js` adds **no** map `move` / `moveend` /
  `movestart` / `drag` / pan handlers. The only `map.on(...)` handlers are
  `zoomend`/`resize`/`click` — none fire during a pan.
- A **pan is a drag, not a click**; `map.on("click")` (which moves the Lens and
  calls `refresh()`) is not triggered by panning. So `refresh()` — the only path
  that renders the promoted membership block — does **not** run during a pan.
- The promoted membership is **panel DOM** (`#planningMembership` chips), not a map
  layer. P0-a adds **no map geometry** and changes **no renderer**.
- The **724 ámbito polygons are not all drawn**: `renderPlanningPolygon` draws only
  the single *containing* ámbito (and at the default centre containment is
  `outside_all_ambitos`, so none is drawn). The 724 are used for point-in-polygon
  queries, not rendered. So the K12 "724-polygon pan ceiling" is **not** the real
  per-pan cost here.

**What actually repaints during a pan** (identical on main and PR): basemap raster
tiles, the default-visible POI canvas markers (`stay` 613 + `bike` 631 + `rail` 148
+ museum/info ≈ **1,400 points**), the admin geography lattice (**153 features /
31,648 vertices**), and the Lens/halo — all pre-existing (from #68/#71, merged
before P0-a), all scaled by devicePixelRatio.

## 2. The baseline is valid and reproducible

A clean `origin/main` (55fa0c7) worktree + **minimal** test instrumentation (the two
`js/app.js` hooks — the loopback/LAN seam gate and the read-only `mapView()` getter
— plus the runner folder) boots the runner in **BASELINE mode** (no membership
surface; freshness N/A). The instrumentation patch
(`baseline_app_instrumentation.patch`, 30 insertions / 1 deletion) **applies cleanly
on clean `origin/main`** and contains **no P0-a functionality**. Owner steps: §5.

## 3. Same-machine automated pan comparison (Intel UHD 620, dpr 2.5)

Automated synthetic mouse-drag pan, ~70 active frames/rep, `pan_frame_ms` via the
runner's active-pan-interval capture. Several reps each:

| Configuration | median (ms) | p95 (ms) |
|---|---|---|
| **Clean `main` (baseline)** — default layers | ~100 | ~117–166 (≈133) |
| **PR #96** — default layers | ~150 | ~217–233 |
| **PR #96 — membership block `display:none`** | ~117–133 | ~150–183 |

Threshold: **33.3 ms**. Three readings matter:

1. **Clean `main` fails the pan ceiling by a wide margin** (median ~100 ms, p95
   ~133 ms ≫ 33.3). The owner's device likewise fails (66.8 ms). → **The map-pan
   failure is PRE-EXISTING; P0-a did not introduce it.**
2. PR #96 runs **~1.2–1.5× higher** than `main` on this stressed pane, and **hiding
   the always-visible membership block recovers most of that gap** (150 → ~120
   median). → There is **weak, confounded evidence of a smaller, secondary
   per-pan-frame cost from the always-visible PLACE panel** (plausibly style-recalc
   / compositing of a taller panel on weak hardware). It is **not** the cause of the
   ceiling failure (`main` fails without it) and is **unconfirmed on real hardware**.
3. Both sit far above 33.3 ms regardless — consistent with K12 §12 (weak Intel
   laptop Leaflet real-payload pan 143–311 ms).

## 4. Bottlenecks, ranked by evidence

1. **(Dominant, high confidence) Pre-existing Leaflet canvas + raster repaint at
   dpr-scaled resolution on a weak integrated GPU.** Evidence: clean-`main` fail
   (§3), owner device 66.8 ms, K12 §12. Fed by the ~1,400 default POI markers + the
   31,648-vertex admin lattice + basemap tiles — all unchanged by P0-a. This is the
   open **K12 renderer question** (MapLibre), already decided **NOT YET / keep
   Leaflet**, gated on whether weak integrated-GPU laptops are a hard support floor.
2. **(Multiplier, architectural) devicePixelRatio.** Canvas work scales with dpr²;
   the owner's standalone Chrome dpr (≈1.0–1.5) is far below this pane's 2.5, so the
   owner's absolute numbers are lower — but still over the ceiling (66.8 ms).
3. **(Secondary, low confidence, P0-a-attributable, unconfirmed) Always-visible
   membership PLACE panel.** Evidence: §3.2 (hiding it recovers most of the
   PR-vs-`main` gap). Small, confounded, does not cause the failure.
4. **Not factors:** the 724-ámbito polygon layer (not rendered); the membership scan
   `ambitosIntersecting` (runs on marker/radius settle, **never during a pan**).

## 5. The comparison the owner must perform (Windows PowerShell, port 8001)

Run the **clean-`main` baseline** on the **same device, same session**, right after a
PR #96 run, keeping everything comparable (below), then compare **map-pan `pan_frame_ms.p95`**.

```powershell
# From the repo root (the PR #96 checkout), on the PR branch:
#   serve the PR app on 8000 as before:
python -m http.server 8000 --bind 0.0.0.0        # PR #96 (feature)  → port 8000

# In a SECOND PowerShell window: build the throwaway clean-main baseline worktree.
cd C:\workspace\madrid-intelligence-tourism-lens
$PR = git rev-parse HEAD                          # record the PR head (ab1f650…)
git worktree add ..\lens-main-baseline origin/main
cd ..\lens-main-baseline
git checkout $PR -- research/ac_p0_12             # copy the runner (test-only) from the PR
git apply ..\madrid-intelligence-tourism-lens\research\ac_p0_12\baseline_app_instrumentation.patch
node research\ac_p0_12\stamp_commit.mjs
python -m http.server 8001 --bind 0.0.0.0        # clean main (baseline) → port 8001
```

- URLs (PR on **8000**, baseline on **8001**):
  - PR #96 (feature): `http://<laptop-LAN-IP>:8000/research/ac_p0_12/device_runner.html`
  - Baseline (clean main): `http://<laptop-LAN-IP>:8001/research/ac_p0_12/device_runner.html`
  - If Windows Firewall prompts for port 8001, allow Python on **Private** networks (same as 8000).
- The baseline page shows a **BASELINE mode** banner (freshness N/A; not an AC-P0-12
  gate). Run the **actual-gesture Map pan** capture on **both** (and marker/radius if
  you like), with the **same** physical gesture style, and compare `pan_frame_ms.p95`.

**Keep comparable (and the remaining confounders to document):** same **hardware**
(the one Windows machine), same **browser build**, same **window size / viewport**
(so devicePixelRatio and the map pixel area match), same **zoom** (default 14), same
**radius** (default 900 m — radius does not affect pan), same **map position**
(default centre), same **enabled layers** (default; do not toggle licences or
hospitality), **cold cache** (fresh private tab) on both, and **alternate** PR↔main
runs a few times to average out thermal drift. Remaining confounders you cannot fully
remove: thermal/background-load drift between runs, frame-time quantisation near
60 fps multiples, and that the baseline is `origin/main` + minimal instrumentation
(not literally the PR minus one feature). If the baseline cannot be built on the
device, record **COMPARISON UNAVAILABLE** and do **not** attribute causation.

**Expected result** (from §3): clean `main` map-pan p95 also **far exceeds 33.3 ms**
on this device — confirming the failure is pre-existing. If PR is materially higher
than `main` (beyond run-to-run spread), that is the secondary panel effect (§4.3) to
investigate separately; if they are comparable, PR adds no measurable pan cost.

## 6. Is optimization justified?

- The **dominant** cost (bottleneck 1) is a **pre-existing renderer limitation**, and
  improving it is the **K12 MapLibre/renderer decision** — already **NOT YET (keep
  Leaflet)**, gated on the weak-integrated-GPU support-floor question (K12 §12.4
  blocker 2). It is **out of scope for P0-a** and must not be a speculative redesign
  here.
- The **secondary** panel effect (bottleneck 3) is **unconfirmed on real hardware**.
  **Only if** the owner's device baseline confirms a material PR-over-`main` pan
  increment is a **small, scoped** mitigation worth evaluating (e.g. CSS
  `contain: content` / `content-visibility` on the off-screen membership block so a
  tall PLACE panel does not inflate per-frame work) — **after** confirmation, never
  speculatively, and without touching scientific contracts, thresholds or HATI.

## 7. GO / HOLD recommendation for PR #96

- **Functional correctness: GO.** P0-a correctness, freshness, scientific contracts
  and CI are unaffected by this investigation.
- **AC-P0-12 device gate (Intel UHD 620 / weak-integrated-GPU Windows class): FAIL on
  map pan → HOLD production merge/release for that declared class**, exactly as
  `docs/UX_I1_P0A_MEMBERSHIP.md` §4 already prescribes ("a class that cannot be made
  to pass → HOLD rollout / redesign"). **The HOLD is caused by a PRE-EXISTING Leaflet
  limitation on weak integrated GPUs (the open K12 blocker 2), not by a P0-a
  regression.** Do **not** weaken the 33.3 ms threshold.
- **Next step is a product decision, not a P0-a fix:** run the device baseline (§5)
  to confirm pre-existing, then decide whether the weak-integrated-GPU class is a
  **hard support floor** (K12 §12.4). If **no**, P0-a is GO for the supported device
  classes (verify iPad/iPhone/modern desktop with the runner); the pan HOLD applies
  only to the unsupported weak-GPU class. If **yes**, renderer work (K12) is required
  for that class **independently of P0-a**. Keep **PR #96 Draft and unmerged**; no
  deploy, no HATI change.
