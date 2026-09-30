# Gate C0 research package — Madrid tourism-intelligence source landscape

Research-only. Nothing here is imported by the application, nothing here is
built at deploy time, and nothing here writes into `data/`.

## Status — Gate C0 COMPLETE

The source landscape and catalogue exist. See
[`docs/MADRID_TOURISM_INTELLIGENCE_SOURCE_LANDSCAPE.md`](../../docs/MADRID_TOURISM_INTELLIGENCE_SOURCE_LANDSCAPE.md).

**Result: 15 candidates across 7 families — 8 USE, 5 WATCH, 2 REJECT.**

## Two separate pieces of evidence — do not collapse them

This gate rests on two findings, both preserved deliberately.

### 1. The Claude Code environment probe was BLOCKED

`probe_report.json` records the attempt, not an audit. On
**2026-09-30T13:03:25Z** all 14 targets returned `403 Forbidden` from the
session's egress proxy — **0 of 14 ok** — across all seven families:

| family | reachable |
|---|---|
| A — Dataestur / INE | no |
| B — Madrid Open Data | no |
| C — Geoportal Madrid / Sigma | no |
| D — IGN / CNIG / PNOA | no |
| E — Comunidad de Madrid | no |
| F — Inside Airbnb | no |
| G — other (AEMET) | no |

All three **control** targets failed too — URL forms proven by this
repository's own production builders and by Gate B's completed live audit. That
is what makes the diagnosis unambiguous: the 0/14 result is evidence about
**that environment's network policy**, never about a source. It must not be
reinterpreted as a source failure, and the file must not be rewritten to
suggest a probe succeeded. Two tests enforce both.

### 2. Official-source verification was completed independently

The source verification the gate requires was **completed by the project
maintainer on 30 September 2026, outside the restricted environment**, against
current official public documentation and machine-readable metadata: the
API-SEGITTUR OpenAPI 3.0.1 specification (API v2.0), Madrid Open Data dataset
and resource pages, Geoportal Madrid / IDEAM metadata and methodology reports,
CNIG/PNOA technical specifications, Comunidad de Madrid portal metadata, and
Inside Airbnb's own data page and policy.

Every `verified_at` in `source_catalog.json` refers to **that external
verification**, and every record carries
`verification_method: external_official_documentation` so the provenance is
machine-readable. **No probe from the Claude Code environment succeeded on 30
September 2026.**

The probe harness stays in the repository: it remains the right instrument, and
re-running it where egress is open would let a future gate promote candidates on
first-party observation rather than relayed verification.

## What is here

* `probe_sources.py` — bounded feasibility probe. Records transport facts
  (status, content type, length, `Last-Modified`, `ETag`) and a schema
  fingerprint (JSON keys / ESRI field list / CSV header / XML root), and
  writes `probe_report.json`. Every read is capped; raw upstream payloads are
  never persisted; credentialed URLs are refused before the request is made.
* `probe_targets.json` — the target list. Each entry is a **hypothesis**
  carrying a `probe_question` and a `proven_url_form` flag.
* `probe_report.json` — output of the most recent run (the blocked attempt).
* `source_catalog.json` — the Gate C0 machine-readable source catalogue: one
  record per candidate, each with exactly one recommendation, its
  interpretation ceiling, and — for WATCH — its blocker and exact unblock
  condition. No weighted score is published, and a test forbids one.

### What `proven_url_form` may claim

`true` only when **that exact URL form** has already been exercised
successfully, by a production builder here or by a completed live probe, and
`proven_by` must cite the evidence. A portal being reachable does not make one
of its API actions proven, and a proven action on one path does not make a
different path on the same host proven. A test enforces both halves.

Three forms currently qualify:

| target | evidence |
|---|---|
| `madrid_ckan_show_vut` | `scripts/build_madrid_geography.py` calls this `package_show` form |
| `comunidad_ckan_show_control` | Gate B's completed live audit exercised this `package_show` form |
| `geoportal_sigma_limites_control` | `scripts/build_madrid_geography.py` fetches this `MapServer` path |

`package_search` is proven on **neither** portal and is carried as an untested
hypothesis on both. It is the action that would make the audit systematic
rather than a random walk through a web catalogue — which is exactly why it
must be confirmed before it is relied upon, not assumed because the sibling
action works.

## Run it

```bash
python research/source_landscape/probe_sources.py
python research/source_landscape/probe_sources.py --family B
python research/source_landscape/probe_sources.py --id madrid_ckan_show_vut
```

`madrid_ckan_show_vut` is a control target: it re-reads metadata for the
licensed-VUT source Gate B already verified, so a failure elsewhere can be
attributed to that source rather than to the harness.

The run exits 0 whenever it completed, even if every target failed — a refusal,
a 404 or a blocked host is itself a Gate C0 finding and is recorded rather than
raised.

## Conventions

Dates are kept apart and never collapsed: a source's own reference period, its
publication date, and `retrieved_at` (our clock) are three different facts. The
probe can observe only the last of those plus the server's `Last-Modified`
claim, so it records only those and leaves reference periods to the analyst.
