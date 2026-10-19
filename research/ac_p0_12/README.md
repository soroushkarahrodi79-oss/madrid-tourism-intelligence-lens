# AC-P0-12 / K12-R1 hardware pan-measurement harness (test-only)

**Not shipped.** Nothing here is referenced by `index.html`, `css/` or `js/`. On this
branch (`k12-r1-leaflet-pan`, off `origin/main`) it measures Leaflet **map-pan**
performance on real hardware Chrome to evaluate the bounded optimizations in issue
#97, **before** any production default or MapLibre proposal.

## One command

```bash
node research/ac_p0_12/auto_compare.mjs            # options below
```

Builds+tears down a disposable clean-`origin/main` worktree (or same-build for
`--self`/`--opt`), launches **real headed hardware-accelerated Chrome**, drives
identical automated map-pan gestures on two arms (warm, drift-controlled, ABBA),
captures `pan_frame_ms` + Chrome `Performance.getMetrics`, and writes versioned JSON
to `results/`. **Fails closed** (`COMPARISON UNAVAILABLE`) on: software/unknown GPU
(H1); too-few/invalid samples, incomparable render state, or excess drift (H2);
awaited idempotent teardown (H3). Guards unit-tested in
`tests/ac_p0_12_auto_compare.test.mjs`.

> **`hardware_automated` — scripted mouse drags, NOT human gestures, NEVER
> `device_grade`.** Does not substitute for physical iPad/iPhone Safari validation.

### Flags

| Flag | Meaning |
|---|---|
| `--rounds=N --warmup=N --frames=N` | ABBA pairs / discarded warm-up pans / target active frames |
| `--dpr=2` | device pixel ratio (match the owner's physical dpr 2) |
| `--layers=on\|off` | POI layers ON (shipped default workload) or OFF (deterministic, lighter) |
| `--self=pr\|main` | **null control** — same build both arms → paired delta ≈ 0 (no bias) |
| `--opt=<csv>` | **K12-R1 A/B** — candidate arm loads the gated `?k12opt=<csv>` pan optimization, baseline off, same build, POI-ON by default |

The `?k12opt=` optimizations (`idle`, `noretina`, `thin`) live in `js/app.js`, gated to
a loopback/private-LAN host + the explicit flag — **absent in production** until an
A/B-proven, contract-preserving one is approved as a default.

## Files

| File | Purpose |
|---|---|
| `auto_compare.mjs` | the harness (one command) |
| `auto_compare_guards.mjs` | pure fail-closed guards (hardware, samples, comparability, drift, layers label) |
| `runner_core.mjs` | the pan-frame capture (`GestureCapture`) + env |
| `stamp_commit.mjs` | writes `commit.json` (SHA stamp) |
| `device_runner.html` | owner-facing device runner (for the physical gate; on this branch it runs in baseline mode) |
| `baseline_app_instrumentation.patch` | the two test-only `js/app.js` seam hooks (mapView + LAN host gate) for the clean-main baseline worktree |
| `K12_R1_RESULTS.md` | the measured A/B outcomes + GO/HOLD for issue #97 |
| `K12_UHD620_REMEDIATION.md` | the pre-remediation assessment (levers ranked) |
| `results/auto_compare_*.json` | versioned `hardware_automated` evidence |
