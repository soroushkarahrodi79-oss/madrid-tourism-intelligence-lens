# CI performance audit V1

## Scope and decision rule

This audit began at `origin/main` commit
`94d361253aed37c7159bc15573e8a32900fa4f42`, using successful push run
[40759479604](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/actions/runs/40759479604).
PR #139 merged during validation, so the branch was integrated with current
`origin/main` commit `2ba11e1e90a66a36f72c0c9179572f90433bb43c` and the audit was
re-run against its additional Chromium and WebKit coverage. Successful PR run
[40779172501](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/actions/runs/40779172501)
has the same tree and supplies the post-merge test timings. No application, CSS,
geography, dataset, analytical, assertion, or acceptance-threshold change is
part of this optimization.

The optimization rule is: partition complete test files across isolated GitHub
jobs and split the new 10-28 minute UX-C2 entrypoint only at anchored top-level
test-name boundaries. `--test-concurrency=1` remains in every process. Exact TAP
totals make every UX-C2 partition fail closed on missing, renamed, duplicated,
or newly unassigned tests.

## Measured baseline

### Job and major-step wall time

| Job / step | Wall time |
| --- | ---: |
| Full workflow critical path (current main) | 30m 29s |
| `radial-halo-browser` job | 24m 11s |
| Chromium browser test step | 22m 42s |
| Chromium install | 19s |
| UX-H1 before/after capture | 19s |
| UX-C2 Chromium capture | 32s |
| `ux-c2-webkit` job | 30m 29s |
| UX-C2 WebKit suite | 28m 25s |
| UX-C2 WebKit capture | 1m 18s |
| `ux-c1-webkit` job | 6m 00s |
| `test (ubuntu-latest)` job | 1m 33s |
| `test (windows-latest)` job | 1m 58s |

Before PR #139, the full workflow was 13m 29s, the Chromium job was 13m 25s,
and its suite was 12m 28s. The newly merged UX-C2 coverage raised current main
to 30m 29s, with a 22m 42s Chromium suite and a 28m 25s WebKit suite.

Browser installation is variable: Chromium took 19–26 seconds in examined
runs, while WebKit ranged from 31 seconds to 2m 17s. Installation is not
material beside the browser suites. Caching the Playwright browser directory
was not adopted because it does
not remove OS-package installation, is sensitive to Playwright/runner image
identity, and adds cache correctness risk. The existing npm cache is retained.

### Ten slowest Chromium cases

Measured from the current-main TAP log:

| Case | Time |
| --- | ---: |
| UX-H1.2 map controls hang from the real header edge without collisions | 29.85s |
| PA 7 observed-but-undocumented publisher value | 15.92s |
| PA 10 multiple published rows remain separate | 15.89s |
| PA 18 edition absence is explicit and never zero | 15.86s |
| K5 type floor and AA contrast at 1440px | 15.48s |
| K5 type floor and AA contrast at 1100px | 15.29s |
| K5 type floor and AA contrast at 850px | 14.86s |
| K5 type floor and AA contrast at 560px | 13.81s |
| K5 type floor and AA contrast at 360px | 13.73s |
| K5 type floor and AA contrast at 420px | 13.65s |

The six K5 cases total about 87 seconds. The three highlighted Planning Ámbito
cases total about 48 seconds. UX-H1.2 is one 30-second case. These are measured
bottlenecks. Possible savings inside those cases are hypotheses only; their
waits, fixture construction, assertions, and thresholds were not changed.

### File-level timing used for shard design

Durations are derived from file boundaries and test durations in the same
current-main run. Small boundary/setup differences explain rounding.

| File | Approx. seconds | Shard |
| --- | ---: | ---: |
| `light-contrast-ux-c1.browser.mjs` | 115.4 | 1 |
| `visual-language.browser.mjs` | 92.1 | 2 |
| `planning-ambito.browser.mjs` | 87.1 | 3 |
| `radial-halo.browser.mjs` | 81.4 | 3 |
| `information-architecture.browser.mjs` | 65.1 | 2 |
| `evidence-url.browser.mjs` | 47.3 | 1 |
| `mobile-layers-ux-h1-2.browser.mjs` | 30.5 | 2 |
| `urban-licences.browser.mjs` | 22.0 | 1 |
| `appearance.browser.mjs` | 20.6 | 3 |
| `mobility-extraction.browser.mjs` | 20.0 | 1 |
| `ambito-comparison.browser.mjs` | 18.6 | 2 |
| `k12-r1-thin.browser.mjs` | 17.1 | 3 |
| `institutional-journey.browser.mjs` | 17.0 | 1 |
| `territorial-compact.browser.mjs` | 15.0 | 3 |
| `map-control-layout.browser.mjs` | 12.1 | 2 |
| `scope-rail-compact.browser.mjs` | 11.8 | 2 |
| `p0a-staging-gate.browser.mjs` | 10.5 | 3 |
| `planning-explorer.browser.mjs` | 10.3 | 1 |
| `ta3-identity.browser.mjs` | 9.0 | 2 |
| `header-ux-h1.browser.mjs` | 8.5 | 3 |
| `ta4-map-chrome.browser.mjs` | 8.2 | 1 |
| `rail-ambito-layout.browser.mjs` | 7.8 | 2 |
| `tutorial.browser.mjs` | 7.1 | 1 |
| `discover/release-check.browser.mjs` | 5.1 | 3 |
| `hospitality-fill-hold.browser.mjs` | 4.0 | 3 |
| `discover/interaction.browser.mjs` | 3.3 | 2 |

Longest-processing-time bin packing produces historical loads of 247.3, 250.3,
and 249.3 seconds. A one-run recalibration that moved UX-H1.2 and Appearance to
shard 1 was rejected after three repetitions: it added about 110 seconds to the
critical shard rather than the historical 51-second estimate. The original LPT
grouping remains the fastest measured architecture. A blind filename/test-count
split would be badly skewed because one 106-test contrast file and a few
single-test files contain most of the runtime.

PR #139 then added `panel-containment-ux-c2.browser.mjs`: 128 registered
Chromium tests (127 asserted plus one capture-only test) taking 629.6 seconds,
and 125 registered WebKit tests (124 asserted plus one capture-only test) taking
1,702.2 seconds. Measured group totals are:

| UX-C2 group | Chromium | WebKit |
| --- | ---: | ---: |
| Appearance/language | 114.3s | 324.6s |
| Baseline real-data viewports | 71.3s | 198.0s |
| Panel min/max width | 37.0s | 112.4s |
| Classic scrollbars (Chromium only) | 14.2s | — |
| Long-content fixtures | 63.0s | 167.3s |
| Licence/hospitality layers | 52.4s | 133.4s |
| Coarse-pointer touch | 115.3s | 321.9s |
| Fallback fonts | 143.4s | 385.7s |
| Evidence drawer | 14.2s | 45.4s |
| Three specific regressions | 4.5s | 13.5s |

Anchored group partitions add approximately 200-215 seconds of UX-C2 work to
each existing Chromium shard. The WebKit partitions are independently packed
to approximately 565-570 seconds each. This is measured partitioning, not a
filename or test-count split.

## Inventory and assurance baseline

The current-main Chromium command reports 576 tests: 574 pass, zero fail, two
intentionally skipped capture cases, across 27 entrypoint files. The UX-C1
WebKit contrast run reports 106 tests (105 pass, one capture-only skip), and the
UX-C2 WebKit run reports 125 tests (124 pass, one capture-only skip). Static
source inventory finds 2,285 `assert.` references in browser entrypoints; loops exercise many
of those sites more than once.

The unchanged non-browser baseline in this worktree is:

- Node: 1,123 passed, zero failed, zero skipped.
- Python: 501 run, 493 passed, 8 intentionally skipped, zero failed.

No browser test file is modified in this PR. Therefore every browser test title,
assertion call site, expected result, viewport, language, appearance, evidence
state, timeout, and threshold is byte-identical to `origin/main`.

The shard manifest adds a fail-closed reconciliation check. It discovers every
top-level `browser-tests/*.browser.mjs` and `discover/*.browser.mjs` file and
fails on an unassigned file, a duplicate assignment, or an assignment that no
longer exists. On this base it proves 27 discovered files = 27 assignments with
zero duplicates. UX-C2 additionally validates exact engine-specific TAP totals:
128 Chromium / 125 WebKit registered tests and 127 / 124 asserted tests across
the respective partition unions.

## Root cause and isolation audit

Measured root cause before PR #139: the 12m 28s Chromium step serialized the
whole browser inventory under `--test-concurrency=1`. Current main adds one file
that contributes 10m 30s in Chromium and 28m 22s in WebKit. Install, checkout,
npm, and artifact overhead remain small by comparison.

Lifecycle findings:

- The 27 entrypoints contain 30 explicit browser-launch call sites. Most files
  launch once and reuse that browser only inside the file; the two Discover
  files launch once per top-level test.
- Every local HTTP server binds `127.0.0.1` on port `0`, so the OS assigns an
  ephemeral port. No fixed test port was found.
- Tests create independent browser contexts/pages and close them within their
  file. Browser and server teardown is file-local.
- `localStorage` and other browser state are context-local. No persistent
  browser profile or `launchPersistentContext` is used.
- Planning Ámbito writes K7 screenshots under `test-results`; K12 writes visual
  evidence to a temporary directory; other capture paths are environment-gated.
  Separate GitHub jobs have separate workspaces, so these paths do not collide.
- Running multiple files concurrently inside one Node process would be unsafe:
  each file has module-level server/browser state, some files intentionally
  depend on sequential tests, and screenshot paths are not worker-qualified.
  This PR does not do that.

A three-process stress probe on one Windows workstation caused existing render
timeouts through CPU starvation. It was stopped and is not counted as a pass.
That result reinforces the separate-runner design: each GitHub matrix shard gets
its own VM rather than competing on one runner. No timeout was increased and no
failure was retried or hidden.

## Optimized architecture

`chromium-browser-shard` is a three-entry matrix. Each job checks out a clean
workspace, restores the npm cache, installs Chromium, verifies the full manifest,
then runs its assigned whole files and one measured UX-C2 name partition
serially with the original Node test runner. Matrix `fail-fast` is disabled so
every shard reports its result.

The existing `radial-halo-browser` required-check name is retained as a small
aggregate job. It runs with `always()` and succeeds only when the matrix result
is `success`. This avoids silently changing an existing required-check identity;
the three named shard checks remain visible for diagnosis.

UX-H1 and UX-C2 Chromium before/after screenshots still run exactly once and
retain their artifact names. UX-C1 WebKit remains a separate unchanged job.
The new 28-minute UX-C2 WebKit suite uses a second three-entry matrix with exact
TAP reconciliation; its original `ux-c2-webkit` check name is retained as a
fail-closed aggregate. Before/after capture still runs once. The original
`ux-c2-webkit-evidence` artifact remains, while two additional per-shard matrix
artifacts preserve the evidence produced outside the capture shard.

Workflow triggers are already non-duplicative for branch work: pull requests
run once, while `push` is restricted to `main`. The post-merge `main` run is an
intentional release-candidate verification, so event triggers were not changed
and no aggressive cancellation was added.

## Concurrent-task integration record

PR #139 merged while this PR's first three green repetitions were running. The
branch was merged with the new `origin/main` rather than reporting those stale
runs as final. The added entrypoint was measured from its successful run,
partitioned explicitly, and its Chromium/WebKit captures and evidence artifacts
were retained. The fail-closed manifest would have rejected the new file until
this reconciliation was complete.

## Validation record

Local validation after integrating current main:

- shard inventory: 27 files, 27 assignments, zero duplicates;
- workflow YAML parse: pass;
- `node --check scripts/browser-test-shards.mjs`: pass;
- `git diff --check`: pass;
- Node suite: 1,123/1,123 pass;
- Python suite: 501 run, 8 skipped, zero fail.

GitHub optimized-run measurements and the three-run stability assessment are
recorded in the PR after the workflow completes. Until those comparable runs
are green, the release decision is **HOLD**.

