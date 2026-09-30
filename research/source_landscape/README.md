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

## What is here

* `probe_sources.py` — bounded feasibility probe. Records transport facts
  (status, content type, length, `Last-Modified`, `ETag`) and a schema
  fingerprint (JSON keys / ESRI field list / CSV header / XML root), and
  writes `probe_report.json`. Every read is capped; raw upstream payloads are
  never persisted; credentialed URLs are refused before the request is made.
* `probe_targets.json` — the target list. Each entry is a **hypothesis**
  carrying a `probe_question` and a `proven_url_form` flag that says whether
  the URL form is already proven in this repository's production builders or
  is a candidate awaiting confirmation.

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
