# AC-P0-12 map-pan investigation — pre-existing failure + a detected P0-a overhead

**PR #96 · investigated at head `b6ab37f` · test-only.** The owner's valid physical
Windows 11 / Chrome / **Intel UHD 620** AC-P0-12 run (commit `ab1f650`): marker drag
**PASS** (p95 136.6 ms, 61 samples, fresh), radius drag **PASS** (p95 144.9 ms, 56
samples, fresh), **map pan FAIL** (p95 66.8 ms, 273 samples, vs 33.3 ms), at
**viewport 1036×518, devicePixelRatio 2**. Overall **FAIL for this device class**.
(Owner-reported summary; the raw device JSON stays with the owner and its **FAIL is
preserved unchanged**.)

**Question:** is the map-pan failure pre-existing, or a regression from PR #96?

**Answer — two separate findings, both now on a TRUSTWORTHY harness:**
1. **Pre-existing absolute failure — CONFIRMED.** Clean `origin/main` also fails the
   33.3 ms pan ceiling by ~4× on this hardware (warmed p50 ≈ 117–133 ms).
2. **Incremental P0-a overhead — DETECTED (reversal of the earlier reading).** With
   the harness-integrity defects fixed (below) and a **null control** proving the
   harness is unbiased, PR #96 pans **~50–66 ms slower than `main`** (5/5 pairs,
   reproduced 3×). It is **not** localized to any DOM or per-frame code path and has
   **no bounded, removable cause** to patch; and it is **immaterial to the UHD 620
   gate** (both arms fail by ~4×). See §3–§5.

> **Measurement classes are kept strictly separate.** The owner's `ab1f650` run is a
> **physical actual-gesture device** result. Everything in §3 is **`hardware_automated`**:
> scripted Playwright mouse drags on real hardware Chrome (Intel UHD 620, not
> SwiftShader). These are **not** human gestures and **never** `device_grade`; `0/N`
> or `5/5` paired comparisons are evidence of *detected / not-detected* overhead in
> this environment, **not** proof for a physical device. They do not substitute for
> the owner's physical iPad/iPhone Safari validation.

---

## 1. The harness is now trustworthy (review 5564383172, H1–H3)

`research/ac_p0_12/auto_compare.mjs` is one command; `auto_compare_guards.mjs` holds
its pure fail-closed logic, unit-tested in `tests/ac_p0_12_auto_compare.test.mjs`
(11 cases incl. synthetic fail conditions). Fixes:

- **H1 — fail-closed hardware GPU.** A software / SwiftShader / llvmpipe / NO_WEBGL /
  unknown / missing renderer on **either** arm → `COMPARISON UNAVAILABLE` (never a
  warning that proceeds). Hardware must be *positively* established (a vendor token).
- **H2 — sample sufficiency + comparability + drift.** Each measured pan must be
  error-free with **≥48 post-warm active-pan frames**; PR/main must match on **map
  rectangle, zoom, DPR, initial centre and data-readiness**; and the map is
  **re-centered to default before every pan** (calibrated corrective drag) so
  positional drift stays < 0.001° (observed 0.00008°). Any violation → `UNAVAILABLE`
  (demonstrated: a drift breach is recorded in `results/auto_compare_UNAVAILABLE_*.json`).
- **H3 — awaited, idempotent teardown.** Browser and servers are **awaited** closed,
  the **uniquely-named** disposable worktree is removed with retries, failure is
  reported (non-zero exit + explicit log, never silent), unrelated worktrees are
  never touched, and a locked leftover can never collide with a later run.
- **Null control.** `--self=pr` serves the **same** build on both arms; the harness
  then reports paired delta **0.1 ms** (3/5 pairs each way) — proving **no
  arm/port/page bias**. So a non-zero PR−main delta is a real build difference.

**Methodology note (why the earlier reading flipped).** The GPU/browser warms
strongly over a session, and an uncontrolled pan lets the map drift onto different
tiles. The first-generation harness (commit `ca81e5b`, results
`auto_compare_ca81e5bd_*.json`) had **no drift control** and its warmed numbers
drifted onto lighter terrain, hiding the overhead (0/10). The review flagged exactly
this. The current harness keeps the map at the dense default centre every pan, warm
and comparable — and the overhead appears.

## 2. Diff-level: PR #96 adds no map-pan code path

`git diff origin/main..HEAD` adds **no** map `move`/`drag`/pan handlers, **no**
rAF/observer/timer/interval, and **no** expensive CSS (no `will-change`, filter,
shadow). A pan is a drag, not a click, so `refresh()` (the only path that renders the
membership block) never runs during a pan; the 724 ámbitos are not drawn (only the
containing one, none at default). The only P0-a listeners are on marker
`dragstart`/`dragend` and a `See all` click — none fire during a map pan.

## 3. Results — `hardware_automated`, Intel UHD 620, dpr 2, map 1036×650, warm, drift < 0.0001°

Three independent rigorous runs (evidence `results/auto_compare_b6ab37fe_*.json`):

| | clean `main` pooled p50 | PR #96 pooled p50 | paired PR−main p50 | PR slower in |
|---|---|---|---|---|
| run 1 | 133 | 183 | **+66** | 5/5 pairs |
| run 2 | 117 | 167 | **+50** | 5/5 pairs |
| run 3 | 117 | 183 | **+66** | 4/4 pairs |

Both arms' p95 ≈ 150–233 ms — **both FAIL 33.3 ms by ~4×**. Null control (both PR):
paired **0.1 ms**. So:
- **Pre-existing absolute failure is confirmed** (clean `main` ≫ 33.3 ms), matching
  the owner's physical 66.8 ms.
- **A material, reproducible PR-over-main overhead (~50–66 ms p50) is detected** on
  this hardware — the earlier "no regression" was the drift artifact (§1).

## 4. Localization — it is NOT the membership block, NOT the DOM

On the warm PR page (same run), ablations:

| PR state | pooled p50 |
|---|---|
| control (as shipped) | 183 |
| `#planningMembership` `display:none` | ≈ control (diag ≈ 0) |
| `#planningMembership` `content-visibility:auto` | ≈ control |
| **`#planningMembership` removed from the DOM** | **183 (no change)** |
| **whole PLACE planning section removed from the DOM** | **183 (no change)** |
| clean `main` | 117 |

Removing **all** P0-a DOM does **not** move PR's pan cost. Combined with §2 (no
per-frame code), the overhead is **not** in any rendered element or per-frame path.
It is a **whole-build engine-state effect**: the larger PR `js/app.js` (+300 lines)
and the always-on membership computation, which builds and **retains the 724-ámbito /
140k-vertex planning index in memory** from boot, most plausibly via heap/GC/JIT
pressure that lands on every pan frame. (It may be partly a V8-on-this-machine
characteristic; whether it reproduces on iPad/iPhone Safari is unknown and is a
reason the physical multi-device runs still matter.)

## 5. Is a bounded mitigation justified? — NO (no removable cause; immaterial to the gate)

- The overhead has **no localized, removable cause** (§4): it is not the block, the
  section, the DOM, or a per-frame path, so there is **no "smallest bounded
  P0-a-specific mitigation"** to apply. Implementing anything would be the
  speculative change the owner's direction forbids, and using CSS hiding to make the
  promoted evidence inaccessible is explicitly disallowed.
- It is **immaterial to the UHD 620 gate**: both PR and `main` fail 33.3 ms by ~4×;
  removing the whole P0-a overhead (PR 183 → 117 = `main`) would **still fail** by
  ~3.5×. So the overhead does not change GO/HOLD for this class.
- It is **worth re-checking where it could matter**: on a device that panned near the
  threshold, a +50 ms overhead could flip a PASS. That is a property of the physical
  **iPad/iPhone Safari** validations (device_grade, not automatable here), not of
  this UHD 620 result. Recorded as an open item, not a silent pass.

## 6. The pre-existing failure is the real remediation target — see the K12 assessment

Fixing the P0-a overhead would not make UHD 620 pass. The route to the Windows
performance requirement (if UHD 620 is a supported floor) is to cut the **pre-existing**
Leaflet pan cost, assessed evidence-first in
[`K12_UHD620_REMEDIATION.md`](K12_UHD620_REMEDIATION.md) — **minimal Leaflet tuning
before any MapLibre proposal**, none implemented in PR #96.

## 7. GO / HOLD

- **Functional correctness: GO** (P0-a correctness, freshness, scientific and
  accessibility contracts, CI — unaffected).
- **Map-pan FAIL on Intel UHD 620 is PRE-EXISTING** (clean `main` fails by ~4×); PR
  #96 adds a **real but immaterial** ~50 ms overhead that does not change the gate
  outcome and is not localizable to a bounded fix.
- **AC-P0-12 device gate: FAIL for the Intel UHD 620 class → HOLD for that class.**
  Threshold **not** weakened; UHD 620 **not** silently dropped. Automation does not
  satisfy the physical Safari gate.

## 8. What remains before PR #96 can become merge-ready

1. **Support-floor policy decision** (the binary in §9) — whether UHD 620 is a hard
   supported floor. This is the primary gate on the pan FAIL.
2. **Physical iPad/iPhone Safari actual-gesture AC-P0-12 runs** (device_grade; cannot
   be produced by automation here). These also tell us whether the §4 overhead
   matters on a near-threshold device.
3. If UHD 620 is kept as a floor: the **K12 minimal-Leaflet remediation** assessment
   (`K12_UHD620_REMEDIATION.md`) as its own authorized track — not inside PR #96.

## 9. The precise decision for the owner (binary)

**Is the Intel UHD 620 / weak-integrated-GPU laptop class a HARD supported-device
floor for AC-P0-12 release?**

- **(A) NO — below the floor.** The UHD 620 pan FAIL is a documented below-floor
  limitation and does **not** block PR #96; the remaining gate is the physical
  iPad/iPhone Safari runs (and confirming the §4 overhead is harmless there). On
  those passing → READY → merge on explicit owner authorization.
- **(B) YES — a hard floor.** Then *no* version of P0-a *or clean `main`* meets the
  33.3 ms pan ceiling there; it needs the **K12 minimal-Leaflet remediation** (then
  MapLibre only if that is insufficient), authorized separately. PR #96 stays HOLD
  behind that work, independent of P0-a.

Either way: **PR #96 stays Draft and unmerged; no deploy; no HATI change; no
threshold weakening; no speculative renderer change inside PR #96.**
