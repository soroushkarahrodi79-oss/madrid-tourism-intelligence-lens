# AC-P0-12 evidence — results

Commit the device JSON files the runner downloads here (e.g.
`AC_P0_12_iPad_Air_M2_2026-10-18.json`), one per device/cache run. Keep each file
**exactly as exported** — do not hand-edit numbers.

---

## Preserved historical observation — Windows 11 / Chrome / Intel UHD 620 (commit `fe85fa9`)

This is the **first** physical observation, taken with the **initial** runner before
the measurement-integrity corrections (independent review 5563658339). It is kept as
a historical record. **Its frame metric is methodologically NOT comparable to a
properly scoped map-pan scenario, and it is NOT relabelled PASS.**

Owner-reported figures (the owner holds the original JSON; commit it here unchanged —
it is not reproduced byte-for-byte in this repo and was not auto-uploaded):

| Field | Value | Reading under the corrected methodology |
|---|---|---|
| Device / GPU | Windows 11, Chrome, **Intel UHD 620** (real hardware GPU) | device-grade hardware |
| Scenario | marker drag (actual gesture) | graded on **interaction-to-paint only** (R1) |
| Movement events | 920 | — |
| **Interaction-to-paint p95** | **70.7 ms** (243 samples) | **within ≤ 150 ms** → marker-drag PASSES on its own metric |
| Whole-capture frame p95 | 66.4 ms | **DIAGNOSTIC ONLY** — this was an *entire-capture* rAF distribution (idle intervals included), **wrongly graded against the 33.3 ms map-pan ceiling** in the old runner. It is **not** a map-pan measurement and must not be read as one (R1). |
| Membership freshness | true | fresh after settle ✔ |
| Frame sample accounting | **1,604 reported `n` vs 1,603 in `raw`** | the R4 accounting bug (warm frame removed from `raw` only, after stats) — **fixed**: `n === raw.length` now holds and stats recompute from `raw`. |

### Why this is *not* a FAIL of AC-P0-12, and *not* a PASS either

- The old runner labelled this run FAIL **only** because an unbounded whole-capture
  rAF distribution was scored as a **map pan**. Under the corrected, interaction-
  scoped methodology, a **marker drag** is judged by interaction-to-paint (70.7 ms,
  within threshold) and settled freshness (true) — not by a pan ceiling.
- But this run has **no properly scoped map-pan scenario** and **no radius scenario**,
  so it is **not** a complete AC-P0-12 validation either (R2). It is INCOMPLETE.
- It is also **un-baselined** against clean `main` (R5), so the elevated whole-capture
  frame gaps are **not** evidence that P0-a caused a regression. **Do not infer
  causation.**

**Action:** re-run on this Windows device with the corrected runner (all three
actual-gesture scenarios), and, where practical, capture the clean-`main` baseline
for comparison. Commit the new JSON alongside the original.
