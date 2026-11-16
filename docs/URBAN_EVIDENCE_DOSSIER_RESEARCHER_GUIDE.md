# Researcher verification guide — Urban Evidence Dossier V1

1. Open the JSON companion and confirm `dossier_schema_version` is `1`.
2. Identify `question.registered_shape` and inspect the exact
   `question.parameters`. These are the parameters supplied to K13.
3. For an answered record, treat `outcome.evidence` as the preserved result. Verify
   its value, scope, unit, source id, five freshness fields, ceiling and derivation.
   For an abstention, confirm `outcome.evidence` is null and retain the machine reason.
4. Check that the geographic object in `context` matches the intended Lens or exact
   official code. Do not substitute a barrio, district, Lens circle or planning ámbito
   for another scope.
5. Follow each `sources[].dataset_url` and `retrieval_route`. Where `editions` or
   `change_detection` is present, compare the declared resource ids and full SHA-256
   values with the committed registry.
6. Read every `limitations` entry. The verbatim ceiling governs what the evidence may
   support; the translated methodological limits explain its implications.
7. Use `reproducibility.canonical_k11_state_url` to restore the workspace state. The
   link does not restore the question or frozen answer. Use the JSON for that record.
8. Use the separate K11 five-file export when complete geometry or cross-mode evidence
   is required. Dossier V1 intentionally contains no second geospatial export.

The dossier detects and preserves a research event; it does not authenticate the
publisher, certify official status or prove that a later deployment uses byte-identical
evidence. Independently verify source editions when that level of assurance is needed.

## Verifiable dossier (V2) — `AMBITO_PHASES` only

On the published site, **Create evidence dossier** for the *AMBITO_PHASES* question
exports a V2 dossier (`dossier_schema_version: 2`) when, and only when, the deploy
published `build-identity.json` **and** the artifact bytes the page was served hash to
that file's fingerprints. Otherwise the export is a plain V1 and the interface says it
is not independently verifiable. Every other question stays V1.

To check one:

```
git clone https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens
cd madrid-tourism-intelligence-lens
git checkout <verification.commit from the JSON>
node scripts/dossier_verify.mjs <dossier.json>      # 0 VERIFIED · 1 MISMATCH · 2 UNVERIFIABLE
```

**What a pass proves:** the recorded value is exactly what the pure reader
`developmentState` returns over the two committed artifacts at that commit, whose
SHA-256 values match the dossier; the verifier's own modules equal that commit's blobs.

**What it does not prove:** that the publisher's data are correct; that the method is
scientifically valid; that the commit is an official release; that the browser that
produced the file really ran that commit's code (the deploy identity asserts it, the
dossier cannot prove it); or that the commit remains reachable (a rewritten history
makes the dossier `UNVERIFIABLE`, never falsely verified). The `verification` record
text is English only.
