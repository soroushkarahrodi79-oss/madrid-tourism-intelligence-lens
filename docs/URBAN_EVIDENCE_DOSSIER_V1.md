# Urban Evidence Dossier V1 (M3)

## 1. Baseline inventory

Verified against live GitHub before implementation on 2026-10-29:

- repository: `soroushkarahrodi79-oss/madrid-tourism-intelligence-lens`;
- `origin/main`: `00b63684b3410a9f4277cb9c613b132a7904b200`;
- M1 merged in PR #141; M2 merged in PR #143;
- no open pull requests at preflight;
- K11 emits the documented five-file reading export and versioned URL;
- K13 returns the frozen seven-field evidence contract or a first-class abstention.

### A. Existing capability

K11 can already export the complete visible workspace reading as exactly five files:
`reading.json`, `sources.json`, `geometry.geojson`, `README.txt`, and `state.url`.
It preserves the visible values, contributing source metadata, applicable geometry,
source ceilings, editions and declared fingerprints. It does not recompute values.

### B. Actual gap

M2 deliberately did not place the selected question in the K11 URL or export. The
registered shape, validated parameters, frozen K13 outcome, question-specific limits
and abstention reason were therefore not preservable as one research event.

### C. Minimal solution

M3 adds a separate two-file dossier action to a completed M2 answer card. It exports
one standalone HTML document and one JSON record from the same frozen dossier object.
K11 remains unchanged and available for complete workspace geometry and cross-mode
evidence.

### D. Scientific risks addressed

- The application validates the complete M2 context key immediately before assembly
  and again after the deferred module load. A stale answer cannot be exported.
- The assembler accepts only the six M2 shapes and only `answered` or `abstained`
  terminal outcomes. Loading and unavailable UI states are not research records.
- The seven K13 evidence fields are copied without DOM parsing, rounding or a second
  resolver call.
- Only K13-authenticated contributing source identities are copied from the existing
  registry. Unknown metadata remains absent and explicit null dates remain null.
- Lens circle, official barrio, district, planning ámbito, municipality and located
  administrative records remain distinct. No overlap is converted into quantity.
- Edition differences remain the K7 classification and are never labelled progress.
- Granted licences remain administrative grants and never become built outcomes.

## 2. Contract and architecture

`js/evidence-dossier.js` is pure: no DOM, Leaflet, fetch, storage, clock or raw source
data. Its caller supplies one resolved outcome, the captured context, authenticated
source records, a UTC timestamp and the canonical K11 URL. It validates and freezes
schema version 1, then renders JSON and safe standalone HTML from that same object.

`js/question-explorer-view.js` adds **Create evidence dossier** to completed supported
answers and abstentions. `js/app.js` owns context validation, deferred import, source
authentication, Blob downloads, fallback links and errors. No dossier code is loaded
on the initial critical path.

## 3. JSON contract

Top-level fields are:

- `dossier_schema_version` and `generated_at`;
- `identification`: product, reading language/preference, M2 model, registry contract
  and honestly characterized deployment-build identity;
- `question`: exact id, wording, registered shape, parameters, subject and context key;
- `context`: frozen Lens, selected entity, planning code and licence window where
  applicable, with an explicit scope distinction;
- `outcome`: either `ANSWERED` with the exact seven K13 evidence fields or `ABSTAINED`
  with the registry abstention and a null evidence value;
- `sources`: only contributing source records, using the documented K11 metadata
  subset including editions and fingerprints where declared;
- `method`: source fact or named deterministic transformation, explicitly not run at
  export time;
- `limitations`: verbatim source ceiling plus the fixed ES/EN M2 implications;
- `reproducibility`: K11 URL, shape, parameters, source ids, schema and exact caveats.

## 4. Human-readable document

The HTML has no script, remote font, stylesheet or runtime request. It uses semantic
headings and tables, selectable text, escaped strings, responsive screen styles and
an A4 `@page` print stylesheet. It can be printed or saved as PDF by the browser; M3
does not generate or claim a PDF.

Sections follow the contract: identification; research question; geographic object
and analytical window; result; source and temporal provenance; method; interpretation
limits; reproduction; attribution.

## 5. Relationship with K11

M3 does not add a sixth K11 file. The canonical URL restores URL-schema-v1 workspace
state, not the selected question or saved answer. The dossier preserves the exported
question event. A later deployment can resolve different evidence if committed
artifacts change, and a matching build id alone is not proof of byte identity.

## 6. Committed Madrid example

The example uses the institutional coordinate `40.395543, -3.691757`, 900 m Lens A,
and `APE.02.20 CÁRCEL DE YESERÍAS`. It records the existing K7 difference classifier
for the committed 2025-07-01 and 2026-01-01 editions:

- [HTML](examples/urban-evidence-dossier-v1/yeserias-edition-difference.html)
- [JSON](examples/urban-evidence-dossier-v1/yeserias-edition-difference.json)

Regenerate it with:

```text
node scripts/build_dossier_example.mjs <UTC-ISO-timestamp>
```

The single-question dossier does not combine Yeserías with APE.02.12 BOLÍVAR Y
COBRE. That workflow remains a K11-supported comparison reading; a two-ámbito dossier
would be a separate milestone and comparison contract.

## 7. Verification and limits

Deterministic tests cover all six shapes, factual parity, the Yeserías classifier,
licence windows, abstention, stale context, malformed metadata, unknown sources,
missing licence metadata, explicit null dates, long/injection-like strings, ES/EN and
HTML/JSON consistency. Browser tests cover download fallbacks, rapid activation,
offline opening, A4 print output, Light/Dark and the eight required viewports.

Review captures are committed under `docs/review/m3-urban-evidence-dossier/`:

- `before/` and `after/` contain matched edition-answer cards in desktop Light,
  desktop Dark and 390 × 844 mobile views;
- `after/desktop-light-4-dossier-ready.png` shows the two fallback download links;
- `after/desktop-light-5-dossier-document.png` shows the complete offline document.

These are emulated-browser captures, not physical-device or screen-reader evidence.

### Measured incremental cost

Measured byte-for-byte against `origin/main` at `00b63684` with gzip level 9:

| Load phase | Files | Raw delta | Gzip delta |
|---|---|---:|---:|
| Initial page | `index.html`, `js/app.js`, `css/app.css` | +5,412 B | +1,551 B |
| Existing post-load M2 modules | `question-explorer.js`, `question-explorer-view.js` | +2,228 B | +619 B |
| Only after dossier action | `evidence-dossier.js` | 21,050 B | 7,269 B total |

A real local run measured 254 ms in Chromium and 218 ms in WebKit from activation
through deferred module loading, HTML/JSON assembly, Blob creation and fallback-link rendering. Resource timing
asserts zero dossier-module requests before activation and exactly one afterwards.
This is a development-machine observation, not a user-device latency guarantee.

### Local verification record

- `node --test`: 1,201 passed, 0 failed, 0 skipped.
- `python -m unittest discover -s tests -p "test_*.py"`: 501 passed, 8 existing
  conditional skips, 0 failed.
- `browser-tests/question-explorer.browser.mjs` on Chromium: 39 passed, 1
  capture-only test skipped when no capture directory is supplied.
- Targeted real WebKit dossier export: 1 passed, 0 failed. CI runs the dossier
  export inside the existing `qx-webkit-smoke` job as well.
- Browser-shard inventory: 29 files assigned once, no gaps or duplicates.
- Chromium opened the generated HTML with zero runtime requests and produced a
  non-empty A4 PDF through the browser print path. No PDF is committed or claimed
  as an M3 output.
- `git diff --check`: clean.

No physical-device or screen-reader validation is claimed. WebKit and Chromium
checks use browser engines with emulated viewports.

Deferred by design: multi-question reports, combined comparative dossiers, report
management, cloud storage, AI conclusions, PDF generation and map screenshots.
