# AC-P0-12 physical-device validation runner

**Test-only. Not shipped.** Nothing in this folder is referenced by `index.html`,
`css/` or `js/`. It exists so the owner can satisfy the **AC-P0-12 device gate**
for PR #96 (`docs/UX_I1_P0A_MEMBERSHIP.md` §4) from a Windows laptop + a physical
iPad and iPhone, **without a Mac and without Safari Web Inspector**.

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

| Metric | Threshold (good / acceptable p95) | What it actually is |
|---|---|---|
| `interaction_to_paint_ms` | ≤ 100 ms / **≤ 150 ms** | a **double-rAF proxy** (two frames), frame-quantised; **not** a true paint timestamp. Floors near one frame on a fast path. |
| `pan_frame_ms` | ≤ 16.7 ms / **≤ 33.3 ms** | the distribution of `requestAnimationFrame` deltas during a pan (first/warm frame dropped). |
| `script_work_ms` | report-only | the **synchronous** wall time of the production interaction call (`moveLensToLatLng` / slider `oninput` → `refresh()`). Automated runs only. |
| `freshness` | must be fresh | after settle, the **whole** displayed membership set (code + “contains the Lens centre” bit + language, read from `#planningMembership`’s signature) equals the canonical `ambitosIntersecting` set right now. |

**Three measurement kinds, never equated:**

- **`actual_gesture`** — you physically drag/pan with a finger or pointer. This is
  the device-grade path and the only one that can produce a PASS.
- **`automated_sequence`** — the production code is driven in a loop (≥ 40 reps).
  Reproducible, but **not** a physical pointer/touch gesture.
- (The CPU-only and headless proxies in `docs/UX_I1_P0A_MEMBERSHIP.md` §4 are a
  third, separate thing and are not re-run here.)

Scenarios cover the **default 900 m** radius and the **maximum 5 000 m** radius, a
representative **Madrid-centre** Lens position (Puerta del Sol, 40.415, −3.692),
and require **≥ 40 valid samples** per interaction scenario.

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
3. **Actual gestures (do all three):** tap a capture button, then **perform that one
   gesture on the map above** until the counter reaches the target (≥ 40), then tap
   **Stop**:
   - *Marker drag* — drag a Lens pin around near the centre.
   - *Radius drag* — drag the radius slider back and forth between small and large.
   - *Map pan* — drag/flick the map itself.
   After drag and radius captures the runner checks membership **freshness** on-device.
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

- `verdict` starts with **`PASS (this device)`**.
- `device_grade.device_grade` is **true** (non-software GPU, human label, an actual
  gesture, ≥ 40 samples, no attestation conflict).
- Every `scenarios[*]` with `measurement_kind: "actual_gesture"` has
  `grade.pass: true` and `freshness.fresh: true` (for drag/radius).

A class that **cannot** pass means **HOLD rollout / redesign for that class**
(`docs/UX_I1_P0A_MEMBERSHIP.md` §4 step 4) — recording the failure is not enough.

---

## C · Comparable baseline on merged `main` (where practical)

AC-P0-12 is about the **promoted** membership. To show the promotion did not
regress interaction latency, measure merged `main` with the **same** runner and
methodology, then compare.

**Laptop baseline (unmodified `main`, works today):** a `main` checkout exposes the
seam on `localhost` already, so no change is needed for a laptop run:

```powershell
git worktree add ..\lens-main main
cd ..\lens-main
# copy the test-only runner into the main checkout (main does not contain it)
Copy-Item -Recurse ..\madrid-intelligence-tourism-lens\research\ac_p0_12 research\ac_p0_12
node research/ac_p0_12/stamp_commit.mjs
python -m http.server 8001 --bind 0.0.0.0
# laptop: http://localhost:8001/research/ac_p0_12/device_runner.html
```

Run the **automated sequences** on both (PR branch :8000, main :8001) on the same
laptop, same session, and compare `interaction_to_paint_ms` / `script_work_ms`.

**iPad/iPhone baseline on `main`:** the LAN seam-gate widening lives on the PR
branch only, so to drive `main` from a real iPad you must also carry that one
commit into the `main` worktree:

```powershell
cd ..\lens-main
git cherry-pick <the AC-P0-12 commit SHA from the PR>   # test-only; do not merge/push
```

Then serve and run exactly as in §B. Keep this worktree local and throwaway; do not
push a cherry-picked `main`.

> Honest scope: the baseline is **“where practical.”** The laptop automated
> comparison is straightforward; a full actual-gesture iPad baseline on `main`
> requires the cherry-pick above. Record whichever you run and label it clearly.

---

## Files

| File | Purpose |
|---|---|
| `device_runner.html` | the owner-facing page: instructions, device capture, Start, live results, Download JSON. Embeds the real app in an iframe. |
| `runner_core.mjs` | the measurement engine (double-rAF proxy, frame capture, freshness, device-grade, verdict). Pure functions are unit-tested by `tests/ac_p0_12_runner.test.mjs`. |
| `stamp_commit.mjs` | writes `commit.json` (SHA/branch/dirty) so every evidence file is stamped. Run once before serving. |
| `commit.json` | generated, untracked. |
| `results/` | you create this and commit the device JSON evidence here. |

## The one production change this needs

`js/app.js`’s `__HALO_REGRESSION__` seam was already **opt-in** (absent unless the
URL carries `?haloRegressionTest=1`) and already restricted to `localhost` /
`127.0.0.1`. The only change on this branch widens that host check to also allow
**loopback, RFC1918 private-LAN, link-local and `.local`** hosts, so a physically
attached iPad/iPhone (which reaches the laptop by its LAN IP, never “localhost”)
can drive the real app. The explicit `?haloRegressionTest=1` opt-in is still
required, and the public GitHub Pages host is a routable domain that never matches
— so the seam remains absent in all normal use. The predicate is mirrored and
unit-tested in `runner_core.mjs` (`isLoopbackOrPrivateLanHost`).
