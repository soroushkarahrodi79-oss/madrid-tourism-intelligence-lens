# Gate C0 research package — Madrid tourism-intelligence source landscape

Research-only. Nothing here is imported by the application, nothing here is
built at deploy time, and nothing here writes into `data/`.

## Status — IN PROGRESS, blocked on network access

Gate C0's central requirement is source *verification*: the official dataset
page, the official metadata, the official schema, and a light probe of the
actual machine-readable resource, in that order of preference. Web summaries
are explicitly not acceptable evidence for it.

At the time of this commit that verification could not be performed. The
session's egress policy permits GitHub and package registries only, and denied
every upstream host the audit needs — including the four this repository's own
production build already depends on (`datos.madrid.es`, `www.esmadrid.com`,
`datos.emtmadrid.es`, `datos.crtm.es`). Deployment is unaffected: the Pages
workflow builds on GitHub-hosted runners, which have their own network.

Consequently this package currently contains the **probe harness only**. The
source landscape report and the machine-readable catalogue are deliberately
absent rather than written from unverified recollection: issuing a `USE`
recommendation — which asserts reproducible access to a trustworthy source —
for a source whose endpoint has never once been contacted would be precisely
the failure mode Gates A and B exist to prevent.

### Recorded evidence of the blocked run

`probe_report.json` is the machine-readable record of the audit **attempt**,
not of an audit. On **2026-09-30T13:03:25Z**, all 14 targets returned
`Tunnel connection failed: 403 Forbidden` — **0 of 14 ok**, across all seven
families:

| family | reachable |
|---|---|
| A — Dataestur / INE | no |
| B — Madrid Open Data | no |
| C — Geoportal Madrid / Sigma | no |
| D — IGN / CNIG / PNOA | no |
| E — Comunidad de Madrid | no |
| F — Inside Airbnb | no |
| G — other (AEMET) | no |

Network availability is **proven by successful responses, never inferred from
settings**. The three control targets are what make that proof possible: each
is a URL form already exercised successfully by a production builder or by the
completed Gate B audit, so a failure on them isolates the environment from the
source. All three failed, which attributes this run's outcome to the egress
policy and to nothing about the sources themselves.

Gate C0 resumes when a re-run returns successful responses from at least
Dataestur, Madrid Open Data, Geoportal/Sigma, Comunidad de Madrid, IGN/CNIG and
Inside Airbnb. Any family still blocked at that point is recorded as blocked
rather than filled in from recollection.

## What is here

* `probe_sources.py` — bounded feasibility probe. Records transport facts
  (status, content type, length, `Last-Modified`, `ETag`) and a schema
  fingerprint (JSON keys / ESRI field list / CSV header / XML root), and
  writes `probe_report.json`. Every read is capped; raw upstream payloads are
  never persisted; credentialed URLs are refused before the request is made.
* `probe_targets.json` — the target list. Each entry is a **hypothesis**
  carrying a `probe_question` and a `proven_url_form` flag.
* `probe_report.json` — output of the most recent run.

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
