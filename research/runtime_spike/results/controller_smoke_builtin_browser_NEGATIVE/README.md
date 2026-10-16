# iPad controller smoke — NEGATIVE example (NOT an iPad run)

`K12_iPad_Built-in-browser_smoke_Chrome_2026-10-16.json` is a controller export
captured while testing `device_harness/ipad_controller.html` **inside the Claude
desktop app's built-in browser on Windows** — not on an iPad. It is preserved here
**unchanged** (SHA-256 `5b4b78b91e52cf4a067c7d42370ee22903120fb8404a9dae1525c1f442d050f1`)
as a **regression negative example**. It is **evidence of a bug**, never device
evidence, and must never be promoted to iPad results.

## Why it is a negative example

The file was produced by an earlier version of the controller that treated the
owner's attestation as *sufficient*. It therefore reports, misleadingly:

- `is_device_grade: true` and `attestation.physically_attested: true` — despite an
  observed environment of **Windows / Claude-Chrome (MSIX) / Intel UHD 620 ANGLE
  Direct3D11**;
- `launch.channel: "safari"` and `verified_config.channel: "safari"` — **hardcoded**,
  though the recorded `userAgent` is a Windows Chromium string.

The run is honestly **incomplete** (`complete:false`, 30/38) — but its device-grade
and platform provenance are false. One of the 30 "complete" scenarios (index 0,
`leaflet_ambito_light_z14_renderer`) is a **synthetic sparse envelope**
(`interaction_to_paint_ms: {p95: 42.1}`, no `n`/`raw`) injected during controller
testing; the earlier completeness check wrongly accepted it.

## What the fixed controller does with this file

`tests/mobile_controller.test.mjs` feeds this file's results back through the
corrected `mobile_controller_core.mjs` and asserts:

- `is_device_grade` is **false** — the observed Windows / Claude / Intel-ANGLE
  environment contradicts the claimed iPad Safari route (attestation is required but
  not sufficient);
- `provenance.blockers` names the Windows platform, the Chromium browser, and the
  non-Apple ANGLE/Direct3D GPU;
- the exported `launch` no longer claims `"safari"` — it reports the **observed**
  platform/browser;
- the sparse index-0 envelope is rejected as **incomplete** ("no raw samples"), so
  it can never satisfy completeness; the other 29 real measurements (with full
  `raw` sample arrays) are **retained**, and nothing is invented.

The original file is left exactly as exported; the 30/38 figure it records stands as
the historical artifact.
