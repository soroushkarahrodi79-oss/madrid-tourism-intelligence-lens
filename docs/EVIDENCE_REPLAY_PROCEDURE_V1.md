# Evidence Replay procedure V1 (documented procedure, no new feature)

**Status: procedure only.** It uses what the Lens already ships on `origin/main`
(`b64d9db`, 2026-11-21): the K7 edition comparison, the Urban Evidence Dossier and the
opt-in PNOA 2006 | 2023 comparator. It adds no code, no dependency and no UI. It was
derived from a read-only feasibility audit and a read-only validation gate (Gate 1,
2026-11-23).

It complements, and does not replace, [AMBITO_CHANGE_DETECTION_V1.md](AMBITO_CHANGE_DETECTION_V1.md)
(the classifier), [URBAN_EVIDENCE_DOSSIER_V1.md](URBAN_EVIDENCE_DOSSIER_V1.md) and
[URBAN_EVIDENCE_DOSSIER_RESEARCHER_GUIDE.md](URBAN_EVIDENCE_DOSSIER_RESEARCHER_GUIDE.md)
(the exported record), and the historical comparator section of
[DATA_PROVENANCE.md](DATA_PROVENANCE.md).

It lets a reader reproduce **one administrative change** between two named official
editions, next to one **negative control**, and look at the PNOA pair as visual
context. It does not tell a construction story.

## 1. What this procedure can and cannot say

| It can say | It cannot say |
|---|---|
| Which published field values differ between two named editions of the official ámbito state table, with both dates and both file fingerprints | Whether anything was built, demolished or changed on the ground |
| That a code with no difference is `NO_CHANGE` *in the published evidence object* | That Madrid did not change physically there |
| That two annual PNOA mosaics (2006, 2023) can be viewed on the same map view | That the imagery confirms, contradicts or dates the administrative change |

**The two time axes do not overlap.** The tabular pair is 2025-07-01 → 2026-01-01.
The imagery pair is the annual mosaics 2006 and 2023. No reading may join them, and
no change metric, score or ranking is produced from either.

The current ámbito polygon is the 2026-era boundary (`madrid_ambitos.meta.json`
declares no reference date). It must not be read as a 2006 or 2023 feature.

## 2. Pinned inputs

Edition identity is **family + source-stated reference date + full SHA-256**. A
resource id, filename or HTTP `Last-Modified` is never an identity.
Source: Ayuntamiento de Madrid open data, CC BY 4.0. Retrieved 2026-10-06 and
recorded in `data/planning/madrid_ambito_state.json` (`change_detection`).

| Edition | Reference date | SHA-256 | Bytes | HTTP `Last-Modified` | `published_at` |
|---|---|---|---:|---|---|
| `S1:2025-07:e1ff3e0e0f63` | 2025-07-01 | `e1ff3e0e0f63fe59dbe64d10b319026917c34d9086f395e9787b6fe3661cf49d` | 175104 | Sun, 15 Feb 2026 22:24:42 GMT | null |
| `S1:2026-01:585db074c122` | 2026-01-01 | `585db074c122caec3293137e56742b5c9d77189205050aab328520a2dd1ec677` | 171520 | Thu, 09 Apr 2026 11:14:47 GMT | 2026-03-24 |
| `S2:2025-07:09f6859a2541` | 2025-07-01 | `09f6859a2541ea8c31eb3ce47464ca5fbec64d38f57a7b3b435bb65e4a5cb286` | 83456 | Sun, 15 Feb 2026 22:24:32 GMT | null |
| `S2:2026-01:326edf48d221` | 2026-01-01 | `326edf48d2214e73175256777fd5083a3f656a05d0bcf0bec36b63ac6cc899e8` | 91136 | Thu, 09 Apr 2026 10:28:30 GMT | 2026-03-24 |

- S1 = development state by phase (`S1_FOUR_PHASE_FLAT`); S2 = available buildability (`S2_SPLIT_RESIDENTIAL_FLAT`). The comparison is within one schema era only.
- The reference date comes from the sheet's own column "Estado del desarrollo a fecha".
- The 2025-07 files carry a 2026 `Last-Modified`, later than their reference date. That header is **not** a publication date.
- Resource URLs are in `data/planning/madrid_ambito_state.json` → `change_detection.{previous,current}.families.{S1,S2}.resource_url`.

**Fingerprint status.** On 2026-11-23 the four resources were downloaded afresh from
the URLs recorded in the state artifact into an isolated directory outside the
repository (HTTP 200) and hashed. **All four SHA-256 values and byte sizes match the
table above exactly**, and a `HEAD` request showed the same `Last-Modified` values. This
shows the files served that day are byte-identical to the ones the Lens recorded on
2026-10-06. It does not show the publisher's data are correct, and it says nothing about
the files in the future: the publisher can replace a file at the same URL, which is why
the hash is the identity.

## 3. Procedure

Run from a checkout that contains `js/ambito-change.js` and
`data/planning/madrid_ambito_state.json` (e.g. `origin/main` `b64d9db` or later).
Everything below is read-only.

### Step 1: reproduce the edition comparison (offline, deterministic)

```js
// save outside the repo, run: node compare.cjs <path-to-lens-checkout> <CODE>
const root = process.argv[2], code = process.argv[3];
const change = require(root + "/js/ambito-change.js");
const st = require(root + "/data/planning/madrid_ambito_state.json");
const cd = st.change_detection;
const ed = (s) => ({ reference_date: s.reference_date, families: s.families });
const r = change.buildAmbitoComparison({ previous: ed(cd.previous), current: ed(cd.current), exactCode: code });
console.log(r.comparabilityVerdict, r.dates);
console.log("S1:", r.state.S1.outcome, JSON.stringify(r.state.S1.evidence.phaseDifferences));
console.log("S2:", r.buildability.state, "observedDifferenceCount =", r.buildability.observedDifferenceCount);
```

Equivalent in the app (exercised in a browser on 2026-11-23): in *Find a place* type the
exact code, pick the "Planning ámbito" result, press *Analyze*, open *Explore evidence
questions* and ask "What changed between the two available official editions?". The answer
card states the two dates; *Create evidence dossier* (Step 5) preserves the full record.

### Step 2: the positive case, `APR.03.04` "DOCTOR ESQUERDO"

Distrito 3 Retiro; characteristic use *Dotacional*; surface 9 190,75 m² (published).

Expected result (verified 2026-11-23 on `b64d9db`):

- `comparabilityVerdict` = `COMPARABLE_WITHIN_SCHEMA_ERA`; dates 2025-07-01 → 2026-01-01.
- S1 `STATE_TRANSITION`, exactly one difference:
  `planeamiento`: `Sin Iniciar` → `Finalizado` (both `PUBLISHED`).
- Unchanged: `gestion` `Sin Iniciar`; `urbanizacion_proyecto` `No Necesita`; `urbanizacion_obras` `No Necesita`.
- All four values use source-documented vocabulary. No cosmetic text differences.
- S2 `NO_CHANGE`: one matched row per edition, 0 observed differences, 0 withheld cells.
- Entity identities: `S1:2025-07:e1ff3e0e0f63:APR.03.04` and `S1:2026-01:585db074c122:APR.03.04`.

Reading: *the published planning-phase value of this ámbito changed between the two
editions.* It is an administrative state. It is not evidence of works.

### Step 3: the negative control, `UZPp.03.01-RP` "DESARROLLO DEL ESTE - VALDECARROS"

Expected result (verified 2026-11-23):

- S1 `NO_CHANGE`; S2 `NO_CHANGE` (1 matched row each, 0 differences, 0 withheld).
- Phases identical in both editions: planeamiento `Finalizado`, gestión `En Ejecución`,
  urbanización-proyecto `Finalizado`, urbanización-obras `En Ejecución`.
- `En Ejecución` in gestión and obras is `SOURCE_OBSERVED_NOT_DOCUMENTED` (present in the
  sheet, not defined by the publisher).

Reading: *no difference in the compared published fields.* Not "nothing happened".

### Step 4: view the PNOA pair as context only

Open the opt-in comparator on the same place. Replace `<LENS_URL>` with the deployed
Lens (`https://soroushkarahrodi79-oss.github.io/madrid-tourism-intelligence-lens/`)
or a local checkout:

- APR.03.04 view: `<LENS_URL>?hv=1&hc=40.40565%2C-3.67193&hz=18&hp=2006-2023&hd=50`
- Valdecarros view: `<LENS_URL>?hv=1&hc=40.35030%2C-3.61680&hz=14&hp=2006-2023&hd=50`

These are **view** links (centre, zoom, pair, divider). Both parse as valid under
`js/historical-url.js`. They carry no evidence and no selection, and the evidence link
(`v=1`) and the session file do not carry them either.

While the comparator is active the contemporary map layers, selection and analysis
panels are hidden or inert by design, so the ámbito outline is not drawn over the
imagery. Record the ámbito from Steps 2–3 separately.

On 2026-11-23 a direct request to the IGN historical WMS returned valid JPEGs for both
layers over both places. Opening the APR.03.04 link in the app, however, ended in the
**Partial** state for both years (10 of the 2006 and 11 of the 2023 tiles loaded, 30
requested in total): the service did not return every tile at that moment, and the app said
so. This is the expected behaviour and a reason to treat imagery availability as variable.
A blank area or the base map showing through means *no image returned*, not *no change*.
The APR.03.04 link restored the comparator in the browser (divider at 50 %, 2006 | 2023
labels). The Valdecarros link was only checked by parsing it with `js/historical-url.js`,
not opened in the browser.

### Step 5: keep the record with the existing mechanisms

- **Dossier.** On the answered `AMBITO_EDITION_DIFF` card, *Create evidence dossier*
  prepares a standalone HTML + JSON pair (offered as links, in case a download is
  blocked). A worked example is in
  `docs/examples/urban-evidence-dossier-v1/yeserias-edition-difference.{html,json}`.
  Read it with the researcher guide. The verifiable **V2** dossier
  (`scripts/dossier_verify.mjs`) exists for `AMBITO_PHASES` only; the edition-difference
  dossier is **V1** and is not independently verifiable by that script.

  Exercised in a browser on 2026-11-23 (served from a clean clone of `main` `b64d9db`,
  localhost), for both `APR.03.04` and `UZPp.03.01-RP`. In both cases the JSON was
  `dossier_schema_version` 1, outcome `ANSWERED`, and the HTML and JSON linked from the page
  were identical to the generated files. What the V1 JSON **does** contain (read from the file):

  | Present in the dossier | Value for both cases |
  |---|---|
  | Question and parameters | `AMBITO_EDITION_DIFF`, `{ "code": <exact code> }`, selected entity and name |
  | Verdict and dates | `COMPARABLE_WITHIN_SCHEMA_ERA`, 2025-07-01 → 2026-01-01 |
  | Differences | S1 outcome with `phaseDifferences` and the verbatim phase values; S2 state, row matching and observed-difference count |
  | Entity identities | `S1:2025-07:e1ff3e0e0f63:<code>`, `S1:2026-01:585db074c122:<code>` |
  | Edition identities and **full SHA-256** | all four, identical to §2 (compared programmatically); also bytes, `Last-Modified`, `published_at` per edition |
  | Source record | `planning_ambito_state`: licence, retrieval route, `change_detection` pair |
  | Limitations | four: the verbatim source ceiling, "two dated official editions, nothing between or after them", "a difference is not necessarily progress", "published planning evidence, not physical change on the ground" |
  | Reproducibility | a canonical workspace URL, the registered shape and parameters |

  What it does **not** contain, so it must be kept separately: any PNOA or comparator state
  (no imagery reference at all), a V2 verification record, the session geometries beyond the
  Lens circle (centre, 900 m), and anything proving the file was produced by the stated code.
  Its build identity is a cache-busting id, "not a cryptographic data fingerprint". The
  canonical URL is built from the origin that served the page, and it restores the workspace
  state, not the question or the saved answer. The edition files' SHA-256 values in the
  dossier are the recorded retrieval values; §2 is what verifies them against a fresh download.
  The saved HTML was not opened as an offline document in a browser; it was checked as text
  (it contains the code, the edition identity, the full SHA-256 and the limitation).
- **Session.** Use the existing session export (`madrid-lens-session`,
  `js/evidence-url.js`) for geometries and readings.
- **Comparator view.** Note the Step 4 link next to them, because neither the dossier nor
  the session stores it.

## 4. Record to keep with each run

| Item | Value |
|---|---|
| Lens commit (code + data) | e.g. `b64d9db` |
| Edition identities and SHA-256 | the four rows in §2 |
| Ámbito code, verdict, exact differences | from Step 1 (copy verbatim) |
| Both dates | reference 2025-07-01 and 2026-01-01; `published_at` as in §2 |
| Imagery | layers `PNOA2006`, `PNOA2023`; annual mosaics; flight year only, no day; 0,50 m (2006), 0,25 m (2023) per the service's layer abstracts; date the service was queried |
| Comparator view link | from Step 4 |
| Dossier / session files | from Step 5 |
| Stated limits | the table in §1 |

## 5. Reproducibility, by level

1. **Tabular data: reproducible.** Fixed editions + deterministic module. Two runs over all
   724 ámbitos give the same output hash, and the same for the two cases above.
   The four SHA-256 values were re-verified against a fresh download on 2026-11-23 (§2). Residual
   risk: the publisher can replace a file at the same URL, which is why identity is the hash.
2. **View parameters: reproducible.** Link round-trip and the session contract are covered by tests.
3. **Images: not exactly reproducible.** The IGN service is dynamic. Treat imagery as
   context, never as the thing being reproduced. Dated screenshots, if kept, are supporting
   material and not a source.

## 6. Known limits of the comparison itself

- S1 outcomes over the 724 codes: 654 `NO_CHANGE`, 10 `STATE_TRANSITION`, 58 `CAUSE_UNRESOLVED`, 2 `NEW_AMBITO`.
  S2: 5 `OBSERVED_PUBLISHED_DIFFERENCE`; 624 `WITHHELD` means *no S2 row published*, not a change.
- In the S2 classifier a floating-point difference can count as an observed difference
  (e.g. `APE.20.10` unifamiliar `10281.44887804` vs `10281.448878040002`; `UZP.1.03` industrial
  `28690.6` vs `28690.59999999999`). Read the values before reading the label.
- A phase change is an administrative state change. A persistent planning note is not an
  instrument event (`MODIFIED_BY_INSTRUMENT` needs a dated, field-relevant instrument).
- Eras before 2025 use earlier schemas and are not comparable (`NON_COMPARABLE`).

## 7. Checks run when this was written (2026-11-23)

On an isolated copy of `origin/main` `b64d9db`, outside the repository:

- `node --test` on `ambito_change`, `historical_url`, `lens_session`, `evidence_registry`,
  `evidence_url`, `planning_ambito`, `ambito_comparison`, `ambito_comparison_integration`,
  `evidence_export`, `evidence_dossier`: 285 pass, 0 fail.
- `unittest` on `test_gate_l1_editions`, `test_gate_l3_phases`, `test_planning_ambito_builders`: 80 pass.
- Browser check of the real export flow (Step 5) in the Claude desktop Browser pane against a
  local server on a clean clone of `main` (`b64d9db`), for both cases, as described above. The
  console showed only a 404 for a local file that does not exist outside a deploy and a
  cross-origin error from an unrelated third-party layer; neither affects the dossier.
- Not run: `npm run test:browser`, the Playwright suite `browser-tests/question-explorer.browser.mjs`
  (needs `npm install`), and the remaining Python gate L tests. A real file download to disk was
  not observed in the pane; only the generated Blob links were read.

## 8. Out of scope

A timeline, a change score, automatic change detection, AI interpretation of imagery,
overlaying the current polygon on 2006 imagery, a browser-to-MCP bridge, 3D/globe rendering,
and any new dependency. Any of these needs new evidence and an explicit owner decision.
