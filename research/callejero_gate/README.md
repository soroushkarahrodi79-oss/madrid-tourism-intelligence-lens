# Gate M — official callejero NDP crosswalk

Research-only audits for GitHub issue #70. Nothing here is imported by the
application, and the package creates no production data, builder, registry entry,
runtime dependency, or UI.

Run the complete live audit from the repository root:

```powershell
py -3 research/callejero_gate/audit_all.py
```

The audit downloads the exact resources selected from the official Madrid CKAN
catalogue, fingerprints the received bytes, parses them in memory, and writes only
compact derived JSON to `results/`. No upstream raw file is committed. The current
licence URL is overwritten by its publisher; the committed SHA-256 and HTTP metadata
therefore identify the observed edition and must be reviewed if a later run changes.

Individual `audit_m*.py` entry points exist for the five sub-gates, but each resolves
the same official source bundle so the preferred reproducible invocation is
`audit_all.py`.

Dependencies are Python's standard library plus the repository-established
`shapely` and `pyproj` packages for the diagnostic point-in-polygon validation.
The identity join itself is exact `NDP` → `COD_NDP`; geometry is never used to infer
identity.
