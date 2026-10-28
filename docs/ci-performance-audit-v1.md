# CI performance audit V1

## Scope and decision rule

This audit covers the `Test` workflow at `origin/main` commit
`94d361253aed37c7159bc15573e8a32900fa4f42`. The comparable baseline is the
successful push run [40759479604](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/actions/runs/40759479604).
The older PR run 40711106144 was also checked and showed the same Chromium
bottleneck. No application, CSS, geography, dataset, analytical, assertion, or
acceptance-threshold change is part of this optimization.

The optimization rule is: partition complete test files across isolated GitHub
jobs, but retain `--test-concurrency=1` inside every file-level process. This
keeps each suite's existing browser/server lifetime and ordering intact.

## Measured baseline

### Job and major-step wall time

| Job / step | Wall time |
| --- | ---: |
| Full workflow critical path | 13m 29s |
| `radial-halo-browser` job | 13m 25s |
| Chromium browser test step | 12m 28s |
| Chromium install | 19s |
| UX-H1 before/after capture | 20s |
| UX-H1 artifact upload | 2s |
| `ux-c1-webkit` job | 7m 52s |
| WebKit install | 2m 17s |
| WebKit contrast suite | 4m 52s |
| WebKit before/after capture | 27s |
| `test (ubuntu-latest)` job | 1m 38s |
| Ubuntu Node tests | 1m 20s |
| Ubuntu Python tests | 1s |
| `test (windows-latest)` job | 1m 24s |
| Windows Node tests | 55s |
| Windows Python tests | 3s |

Browser installation is variable: Chromium took 19–26 seconds in the two
examined runs, while WebKit took 31 seconds in run 40711106144 and 2m 17s in the
current-main run. Chromium installation is not material beside its 12m 28s
suite. Caching the Playwright browser directory was not adopted because it does
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

Longest-processing-time bin packing produces historical loads of 247.3,
250.3, and 249.3 seconds. A blind filename/test-count split would be badly
skewed because one 106-test contrast file and a few single-test files contain
most of the runtime.

## Inventory and assurance baseline

The current-main Chromium command reports 448 tests: 447 pass, zero fail, one
intentionally skipped capture case. It has 430 top-level tests plus nested
subtests across 26 entrypoint files. The WebKit contrast run reports 106 tests:
105 pass and the same capture-only case skipped. Static source inventory finds
2,259 `node:assert` call sites in the 26 browser entrypoints; loops exercise many
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
longer exists. On this base it proves 26 discovered files = 26 assignments with
zero duplicates.

## Root cause and isolation audit

Measured root cause: the 12m 28s Chromium step serializes approximately 12m 29s
of test-case duration under `--test-concurrency=1`. Install, checkout, npm, and
artifact overhead are small by comparison.

Lifecycle findings:

- The 26 entrypoints contain 28 explicit browser-launch call sites. Most files
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
then runs its assigned files serially with the original Node test runner.
Matrix `fail-fast` is disabled so every shard reports its result.

The existing `radial-halo-browser` required-check name is retained as a small
aggregate job. It runs with `always()` and succeeds only when the matrix result
is `success`. This avoids silently changing an existing required-check identity;
the three named shard checks remain visible for diagnosis.

UX-H1 before/after screenshots still run exactly once and are still uploaded
under `ux-h1-map-header-screenshots`. They run on one matrix entry after its
tests. The independent WebKit job, assertions, screenshot capture, and artifact
name remain unchanged.

Workflow triggers are already non-duplicative for branch work: pull requests
run once, while `push` is restricted to `main`. The post-merge `main` run is an
intentional release-candidate verification, so event triggers were not changed
and no aggressive cancellation was added.

## Pending-task integration note

Draft PR #139 is based on the same main commit and changes `package.json`,
`.github/workflows/test.yml`, and browser coverage. It adds
`panel-containment-ux-c2.browser.mjs`, Chromium evidence capture, and an
independent UX-C2 WebKit job. If #139 lands first, this branch must be rebased;
the new browser entrypoint must be measured and assigned to one shard, its
capture must remain once-per-workflow, and its WebKit job must remain intact.
Until that assignment is made, the manifest will deliberately fail instead of
silently omitting the new tests.

## Validation record

Local validation completed before opening the PR:

- shard inventory: 26 files, 26 assignments, zero duplicates;
- workflow YAML parse: pass;
- `node --check scripts/browser-test-shards.mjs`: pass;
- `git diff --check`: pass;
- Node suite: 1,123/1,123 pass;
- Python suite: 501 run, 8 skipped, zero fail.

GitHub optimized-run measurements and the three-run stability assessment are
recorded in the PR after the workflow completes. Until those comparable runs
are green, the release decision is **HOLD**.

