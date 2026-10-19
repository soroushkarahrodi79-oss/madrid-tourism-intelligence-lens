# AC-P0-12 physical-device validation runner (shared with K12-R1)

**Test-only. Not shipped.** Nothing in this folder is referenced by `index.html`,
`css/` or `js/`. It exists so the owner can satisfy the **AC-P0-12 device gate**
for PR #96 (`docs/UX_I1_P0A_MEMBERSHIP.md` §4) from a Windows laptop + a physical
iPad and iPhone, **without a Mac and without Safari Web Inspector** — and the same
`auto_compare.mjs` harness is reused by K12-R1 (issue #97, PR #98, merged) to
A/B-measure the gated `?k12opt=` Leaflet pan optimizations via `--self`/`--opt`
(see *Flags* below). The two uses are independent: P0-a membership measurement
never touches `?k12opt=`, and the K12 A/B never touches membership/HATI.

It measures the **real PR #96 production app** (`index.html` + `js/app.js`) — not
the isolated K12 Leaflet harness. It loads the actual app in a same-origin iframe
and drives the **production interaction paths** (marker drag, radius slider, map
pan) through the app's existing, opt-in `__HALO_REGRESSION__` test seam. It changes
no dataset, scientific contract, membership semantic, UI layout or HATI behaviour.

> **This runner does not, by itself, declare AC-P0-12 PASS.** A PASS is only
> produced from **actual physical-gesture** runs on a **device-grade** environment
> for every declared supported class. Automated sequences are a reproducible proxy
> and are reported separately — the runner refuses to treat them as a device pass.

---

## What it measures (and the honest label on each number)

Per the K12 methodology (`docs/RUNTIME_DECISION_SPIKE.md` §3.2, §11) and
`research/runtime_spike/device_harness/thresholds.json` (the single source of the
thresholds — this runner fetches that file, it does not copy the numbers):

**Metrics are SCOPED to each interaction (never cross-applied):**

| Scenario | Graded metric (good / acceptable p95) | What it is |
|---|---|---|
| **Marker drag** | `interaction_to_paint_ms` ≤ 100 / **≤ 150 ms** | a **double-rAF proxy** (two frames), frame-quantised, one sample per *genuine* Lens move; **not** a true paint timestamp. **Plus** settled membership freshness. |
| **Radius drag** | `interaction_to_paint_ms` ≤ 100 / **≤ 150 ms** | same proxy, one sample per *genuine* radius change. **Plus** settled freshness. |
| **Map pan** | `pan_frame_ms` ≤ 16.7 / **≤ 33.3 ms** | `requestAnimationFrame` deltas recorded **only while the map centre is actually moving** (verified active-pan interval, incl. inertia); first/warm frame dropped. |

> **The map-pan 33.3 ms ceiling is applied ONLY to the map-pan scenario.** A
> marker/radius capture also records whole-window frame deltas, but those are a
> **named diagnostic** (`capture_frame_ms_diagnostic`), **never graded** against the
> pan ceiling. (The earlier Windows FAIL came from grading a whole marker-drag
> window as if it were a pan — corrected here; see *Measurement-integrity corrections*.)

Other recorded fields: `script_work_ms` (synchronous production-call time, automated
runs only), `freshness` (after settle, the **whole** displayed membership set —
code + “contains the Lens centre” bit + language, from `#planningMembership`’s
signature — equals the canonical `ambitosIntersecting` set; **N/A** for a map pan,
which does not move the Lens, and for a pre-feature `main` baseline).

**Attribution (every sample is tied to a genuine interaction).** A bare
`pointermove`/`mousemove` is not proof of a drag, radius change or pan. Each sample
is counted only when the production state the gesture should move actually changed —
the active **Lens centre** (marker), the **radius** (slider), or the **map centre**
(pan) — read back from the app. Idle moves and duplicate mouse/touch/pointer
compatibility events are excluded (the capture listens to one event source). If
attribution is impossible, or nothing genuine ever moved, the scenario is recorded
**NOT TESTED / INCOMPLETE**, never a fabricated sample.

**Raw-data integrity.** The first (warm) sample is dropped **before** any statistic
is computed, so `n === raw.length` and every median/p95/max recomputes byte-for-byte
from the stored `raw` array (asserted in code and tests).

**Three measurement kinds, never equated:**

- **`actual_gesture`** — you physically drag/pan with a finger or pointer. This is
  the device-grade path, and a **PASS requires all three** actual-gesture scenarios
  (marker drag, radius drag, map pan) present, attributed, sufficiently sampled and
  passing. One or two scenarios → **INCOMPLETE**, never PASS.
- **`automated_sequence`** — the production code is driven in a loop (≥ 40 reps).
  Reproducible, but **not** a physical gesture, and never a device PASS.
- (The CPU-only and headless proxies in `docs/UX_I1_P0A_MEMBERSHIP.md` §4 are a
  third, separate thing and are not re-run here.)

Scenarios cover the **default 900 m** radius and the **maximum 5 000 m** radius, a
representative **Madrid-centre** Lens position (Puerta del Sol, 40.415, −3.692),
and require **≥ 40 valid (attributed) samples** per interaction scenario.

---

## A · Launch on the Windows laptop (PowerShell)

From the repository root (`C:\workspace\madrid-intelligence-tourism-lens`):

```powershell
# 1. Make sure you are on the PR branch and stamp the commit the runner will record
git switch design/ux-i1-p0a-membership
node research/ac_p0_12/stamp_commit.mjs

# 2. Serve the WHOLE repo on all interfaces so the iPad/iPhone can reach it over Wi-Fi
python -m http.server 8000 --bind 0.0.0.0

# 3. Find the laptop's LAN IP (note the IPv4Address on your Wi-Fi adapter)
#    (run in a second PowerShell window)
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*' -or $_.IPAddress -like '172.*' } | Select-Object IPAddress,InterfaceAlias
```

If Windows Firewall prompts, **allow Python on Private networks**. If no prompt
appears and the iPad cannot connect, open the port once:

```powershell
New-NetFirewallRule -DisplayName "AC-P0-12 runner (temp)" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow -Profile Private
```
Remove it when finished:
```powershell
Remove-NetFirewallRule -DisplayName "AC-P0-12 runner (temp)"
```

**The test URL** (replace the IP with your laptop's LAN IP):

- On the **laptop itself** (desktop class): `http://localhost:8000/research/ac_p0_12/device_runner.html`
- On the **iPad / iPhone**: `http://<laptop-LAN-IP>:8000/research/ac_p0_12/device_runner.html`
  e.g. `http://192.168.1.20:8000/research/ac_p0_12/device_runner.html`

> The measurement seam is enabled **only** on a loopback or private-LAN host (plus
> the app’s own `?haloRegressionTest=1`, which the runner adds automatically). The
> public GitHub Pages deployment can never enable it. If you open the runner from a
> public host it shows a red banner and the buttons stay disabled.

---

## B · Run it on each device (the same steps everywhere)

Keep the runner page **visible and in the foreground** the whole time — Safari and
Chrome throttle `requestAnimationFrame` on hidden/background tabs, which would
corrupt the pan frame-time numbers. On iPad/iPhone, do not switch apps mid-capture.

1. Open the test URL. Wait for **“✔ app ready”** under *The real app*.
2. Fill **Device label** (e.g. `iPad Air M2 / iPadOS 18 / Safari`) and choose the
   **Declared class** (desktop / tablet / phone). Set cache/network if you know them.
   (The commit SHA auto-fills from `commit.json`.)
3. **Actual gestures — do ALL THREE (a PASS needs all three):** tap a capture
   button, then **perform that one gesture on the map above** until the live counter
   reaches the target (≥ 40 **genuine** samples — idle pauses don’t count), then tap
   **Stop**:
   - *Marker drag* — drag a Lens pin around near the centre (keep it moving; the
     counter only advances while the Lens centre actually moves).
   - *Radius drag* — drag the radius slider back and forth between small and large.
   - *Map pan* — drag/flick the map itself (the counter advances only while the map
     is actually panning, inertia included).
   After the marker and radius captures the runner checks membership **freshness**
   on-device. Map pan does not move the Lens, so its freshness is **N/A** by design.
   > To reach 40 marker/radius samples you typically need a continuous ~10–15 s drag
   > (one interaction-to-paint sample lands roughly every other frame). Just keep the
   > gesture going until the counter hits the target.
4. **Automated sequences:** tap **Run all automated** (reproducible proxy; records
   drag r=900, drag r=5000, radius sweep). Optional but recommended for context.
5. Tap **⬇ Download JSON evidence**. On iPad/iPhone this saves to **Files**
   (or offers a share sheet).
6. **Cold vs warm cache:** for a cold-cache run use a fresh Safari **private** tab;
   for warm, reload once first and set cache = warm.

**Collect the evidence:** AirDrop / copy each JSON back to the laptop into
`research/ac_p0_12/results/` (create it), naming them by device, e.g.
`results/AC_P0_12_iPad_Air_M2_2026-10-18.json`. Commit them to PR #96. The JSON
records device/browser/OS, GPU, viewport, cache, network, commit SHA, every
scenario’s median/p95/max/sample-count, freshness, and the pass/fail verdict.

### What a passing file looks like

- `verdict` starts with **`PASS (this device)`** (only possible with all three
  actual-gesture scenarios present).
- `device_grade.device_grade` is **true** (non-software GPU, human label, an actual
  gesture, ≥ 40 samples, no attestation conflict).
- `missing_actual_scenarios` is `[]`.
- Each `scenarios[*]` with `measurement_kind: "actual_gesture"` has `grade.pass:
  true`; marker/radius also have `freshness.fresh: true`; pan has `freshness.
  applicable: false` (N/A by design).

A class that **cannot** pass means **HOLD rollout / redesign for that class**
(`docs/UX_I1_P0A_MEMBERSHIP.md` §4 step 4) — recording the failure is not enough.

---

## C · Automated main-vs-PR pan comparison (one command) — and the manual baseline

**One command, no manual steps** (builds+tears down a disposable clean-`main`
worktree, launches real headed hardware Chrome, drives identical automated pans on
both, writes versioned JSON to `results/`):

```powershell
node research/ac_p0_12/auto_compare.mjs            # --rounds=4 --warmup=5 --frames=50 --dpr=2
```

These are **`hardware_automated`** scripted mouse drags — **not** human physical
gestures and **never** `device_grade`. The harness **fails closed**
(`COMPARISON UNAVAILABLE`) on: a software/unknown GPU (H1), too-few samples or an
incomparable PR/main environment or excess positional drift (H2); it **awaits**
teardown and reports worktree-removal failure (H3); its guards are unit-tested in
`tests/ac_p0_12_auto_compare.test.mjs`; and `--self=pr` runs a **null control**
(same build both arms → paired delta ≈ 0) proving no arm bias. Flags: `--rounds`,
`--warmup`, `--frames`, `--dpr`, `--self=pr|main`, `--layers=on|off`, and K12-R1's
`--opt=<csv>` (candidate arm loads the gated `?k12opt=<csv>` pan optimization,
baseline off, same build, POI layers ON by default — see `K12_R1_RESULTS.md`).

**Finding** (see `BASELINE_AND_PAN_INVESTIGATION.md`): on Intel UHD 620 the map-pan
FAIL is **pre-existing** (clean `main` fails 33.3 ms even with POI layers off). The
earlier "~50–66 ms P0-a overhead" was a **measurement confound** — unequal
POI-cluster rendering between the two instances, which the hardened render-state
guard now catches (`COMPARISON UNAVAILABLE`). With a **deterministic, equal** render
state (POI layers disabled) PR ≈ `main` across runs + both null controls, and Chrome
CDP tracing shows equal per-pan Script/Layout/RecalcStyle/heap/nodes — **no material
P0-a pan regression.** Minimal Leaflet remediation of the pre-existing cost (before
MapLibre) is assessed in `K12_UHD620_REMEDIATION.md`. Flag `--layers=on` keeps POIs
on (render state may be non-deterministic → the guard may refuse).

### Manual physical baseline (optional) — R5

AC-P0-12 is about the **promoted** membership. To check the promotion did not
regress interaction latency, measure clean `main` with the **same interaction
measures**, then compare — **without porting the P0-a feature into `main`**.

`main` has **no** membership surface (`#planningMembership`) and **no** P0-a seam
methods, so the runner **auto-detects BASELINE mode** there: it measures the same
marker-drag / radius-drag / map-pan interactions, marks membership **freshness
`N/A (pre-feature)`** (never a failure), and labels the report `BASELINE (main)` —
**not** an AC-P0-12 gate verdict.

What `main` *does* need is the **test-only instrumentation** (the two `js/app.js`
hooks — the LAN seam-gate widening + the read-only `mapView()` getter — plus this
runner), which is **not** P0-a functionality. The cleanest, minimal path uses the
committed patch `baseline_app_instrumentation.patch` (30 insertions / 1 deletion,
verified to apply on clean `origin/main`) and copies the runner from the PR:

```powershell
cd C:\workspace\madrid-intelligence-tourism-lens
$PR = git rev-parse HEAD
git worktree add ..\lens-main-baseline origin/main
cd ..\lens-main-baseline
git checkout $PR -- research/ac_p0_12             # copy the runner (test-only) from the PR
git apply ..\madrid-intelligence-tourism-lens\research\ac_p0_12\baseline_app_instrumentation.patch
node research\ac_p0_12\stamp_commit.mjs
python -m http.server 8001 --bind 0.0.0.0
```

See `BASELINE_AND_PAN_INVESTIGATION.md` for the full map-pan causation analysis and
the exact owner comparison procedure.

- **Laptop:** `http://localhost:8001/research/ac_p0_12/device_runner.html`
- **iPad/iPhone:** `http://<laptop-LAN-IP>:8001/research/ac_p0_12/device_runner.html`

Run the **actual-gesture** captures on both the PR (`:8000`) and the baseline
(`:8001`) on the **same device, same session**, and compare
`interaction_to_paint_ms` (marker/radius) and `pan_frame_ms` (pan). The baseline
page shows a **BASELINE mode** banner and disables the automated sequences (they
rely on P0-a seam methods absent from `main`).

> **If a valid baseline cannot be built** (the cherry-pick does not apply cleanly,
> or `mapView`/attribution is unavailable), the report records **`COMPARISON
> UNAVAILABLE`**. In that case **do not infer that P0-a caused** any observed
> slowdown — an un-baselined single-device number is not evidence of a regression.

---

## Files

| File | Purpose |
|---|---|
| `device_runner.html` | the owner-facing page: instructions, device capture, Start, live results, Download JSON. Embeds the real app in an iframe. |
| `runner_core.mjs` | the measurement engine (double-rAF proxy, frame capture, freshness, device-grade, verdict). Pure functions are unit-tested by `tests/ac_p0_12_runner.test.mjs`. |
| `stamp_commit.mjs` | writes `commit.json` (SHA/branch/dirty) so every evidence file is stamped. Run once before serving. |
| `commit.json` | generated, untracked. |
| `baseline_app_instrumentation.patch` | the two test-only `js/app.js` hooks, for a clean-`main` baseline worktree (no P0-a). |
| `auto_compare.mjs` | one-command headed-Chrome `hardware_automated` main-vs-PR pan comparison (fail-closed H1/H2/H3, warm steady-state, re-centered, null control). |
| `auto_compare_guards.mjs` | pure fail-closed guards (hardware GPU, sample sufficiency, comparability, drift), unit-tested. |
| `BASELINE_AND_PAN_INVESTIGATION.md` | map-pan analysis: pre-existing failure confirmed + a detected (non-localizable, immaterial) P0-a overhead; GO/HOLD + the binary support-floor decision. |
| `K12_UHD620_REMEDIATION.md` | evidence-led minimal-Leaflet-tuning assessment (before MapLibre); not implemented in PR #96. |
| `K12_R1_RESULTS.md` | K12-R1's measured `--opt` A/B outcomes + GO/HOLD for issue #97 (merged PR #98; gated test-only, no production default). |
| `results/auto_compare_*.json` | versioned `hardware_automated` evidence (incl. a null control and a fail-closed `UNAVAILABLE` sample). |
| `results/` | committed device JSON evidence + the preserved historical Windows observation (`results/README.md`). |

## The two test-only production touches this needs

Both are **test instrumentation**, not P0-a functionality, and both are safe to
carry into a clean-`main` baseline worktree:

1. **Host-gate widening.** `js/app.js`’s `__HALO_REGRESSION__` seam was already
   **opt-in** (absent unless the URL carries `?haloRegressionTest=1`) and restricted
   to `localhost` / `127.0.0.1`. It is widened to also allow **loopback, RFC1918
   private-LAN, link-local and `.local`** hosts, so a physically attached iPad/iPhone
   (which reaches the laptop by its LAN IP, never “localhost”) can drive the real
   app. The `?haloRegressionTest=1` opt-in is still required and the public GitHub
   Pages host never matches, so the seam stays absent in all normal use. The
   predicate is mirrored and unit-tested in `runner_core.mjs`
   (`isLoopbackOrPrivateLanHost`).
2. **Read-only `mapView()` seam getter.** Returns the Leaflet map centre + zoom so a
   frame-time sample can be **attributed** to a genuine map pan (the map centre
   actually moved). It only reads Leaflet state — it moves nothing and runs no model.

No dataset, scientific contract, membership semantic, UI layout or HATI behaviour is
changed by either.

## Measurement-integrity corrections (independent review 5563658339)

The first Windows run exposed methodology bugs in the initial runner; this version
corrects them (tests in `tests/ac_p0_12_runner.test.mjs`):

- **R1 — scope.** The map-pan 33.3 ms ceiling was being applied to a whole
  marker-drag window. Now marker/radius grade on interaction-to-paint only; map pan
  grades on frame p95 over the **verified active-pan interval** only; whole-window
  frames on a drag/radius capture are a **named, non-graded diagnostic**.
- **R2 — complete gate.** A global PASS now requires **all three** actual-gesture
  scenarios; one/two → INCOMPLETE.
- **R3 — attribution.** Samples are tied to a genuine Lens/radius/map change, one
  event source (dedup), idle/background excluded, fail-closed if attribution is
  impossible.
- **R4 — accounting.** Warm-up dropped **before** stats, so `n === raw.length` and
  every stat recomputes from `raw`.
- **R5 — baseline.** Clean-`main` baseline runs the same measures without porting
  P0-a; freshness `N/A`; `COMPARISON UNAVAILABLE` when a baseline can’t be built.

The previous Windows observation is **preserved unchanged** and its whole-capture
frame metric is marked **not comparable to a scoped map-pan scenario** — it is **not**
relabelled PASS. See `results/README.md`.
