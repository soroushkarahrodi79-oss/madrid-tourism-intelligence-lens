#!/usr/bin/env python3
"""Build the committed granted-urban-licence product artifact (issue #71 / K9).

    OFFICIAL GRANTED-LICENCE REGISTER + COMMITTED NDP CROSSWALK
        -> CLASSIFY FAMILY (CLOSED TAXONOMY) -> PARSE GRANT DATE
        -> JOIN RESOLVED LOCATION -> MINIMISE FIELDS -> FINGERPRINT -> ARTIFACT

This reads the official granted-licence register and the committed official-callejero
crosswalk (``data/callejero/madrid_ndp_crosswalk.json``, produced by
``scripts/build_callejero_ndp_crosswalk.py``) and emits the licence evidence layer
the browser renders. The browser never calls datos.madrid.es at runtime; it reads
this committed, fingerprinted artifact.

Granted-only universe
---------------------
``RESOLUCION`` is ``Conceder`` for every row. This is an administrative-grant
record, never an application/refusal denominator, so the artifact and its metadata
structurally carry NO approval rate, rejection rate, refusal count or success rate,
and a granted licence is NEVER evidence that work started, construction occurred or
completed, occupancy happened, or the permitted quantity was built.

Three families, never one total
--------------------------------
Every ``TIPO`` maps to exactly one of three families — building/urbanistic, activity,
temporary activity — through a CLOSED taxonomy. An unseen ``TIPO`` FAILS the build;
nothing is silently mapped to OTHER. The families are counted separately and the
artifact never carries a single cross-family total. Temporary activity is never
collapsed into general activity.

Minimised fields
----------------
Each resolved record carries only product-useful evidence: a stable artefact id, the
exact NDP, the family, the verbatim ``TIPO``, the ISO grant date, ``NORMA_ZONAL`` and
``NIVEL_PROTECCION`` (verbatim, with their three absence states preserved), the
resolved coordinate/barrio/district and crosswalk provenance. ``PERSONA_INTERESADA``
and other non-location attributes are excluded.

Mapped subset of a known denominator
-------------------------------------
Only crosswalk-resolved rows become map records. The unresolved rows survive as
evidence in the coverage metadata (per family and per year); they never disappear
from the denominator and the layer is described as the resolved subset.

Responsible declarations (dataset 133556) are NOT ingested here (Gate M exclusion).

Dependencies
------------
HTTP retrieval of the small licence register is Python standard library. No
third-party import at module level, so this builder stays importable and its pure
classification/join logic stays testable with the standard library alone.

Usage
-----
    python scripts/build_urban_licences.py
    python scripts/build_urban_licences.py --cache-dir <dir>
"""

from __future__ import annotations

import argparse
import collections
import csv
import datetime as _dt
import hashlib
import io
import json
import re
import sys
import time
import unicodedata
import urllib.request
from pathlib import Path

CONTRACT_VERSION = "1.0.0"

CATALOGUE_API = "https://datos.madrid.es/api/3/action/package_show?id="
LICENCE_DATASET = "640505-0-licencias-urbanisticas-otorgadas"
LICENCE_RESOURCE = "640505-1-licencias-urbanisticas-otorgadas"
# Gate M recommended EXCLUSION of responsible declarations from K9 V1. This id is
# recorded ONLY so a guard can assert the builder never ingests it.
EXCLUDED_DECLARATIONS_DATASET = "133556-0-declaraciones-responsables"
USER_AGENT = (
    "madrid-urban-evidence-lens/urban-licences-builder "
    "(+https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens)"
)

CROSSWALK_ARTIFACT = "data/callejero/madrid_ndp_crosswalk.json"
CROSSWALK_META = "data/callejero/madrid_ndp_crosswalk.meta.json"

RESOLVED_STATES = ("RESOLVED", "ADDRESS_TEXT_DISAGREEMENT", "NDP_FOUND_HISTORICAL_ONLY")

# -------------------------------------------------------------- closed TIPO taxonomy
# The exact three families Gate M established. A TIPO not in this map FAILS the build
# (classify_family raises), so taxonomy drift is explicit and never silently OTHER.
FAMILIES = ("BUILDING_URBANISTIC_LICENCE_FAMILY", "ACTIVITY_LICENCE_FAMILY", "TEMPORARY_ACTIVITY_FAMILY")
TIPO_FAMILIES = {
    "Licencia básica actividad": "ACTIVITY_LICENCE_FAMILY",
    "Licencia básica residencial": "BUILDING_URBANISTIC_LICENCE_FAMILY",
    "Licencia básica residencial sujeta a la Ley 3/2024": "BUILDING_URBANISTIC_LICENCE_FAMILY",
    "Licencia básica urbanística residencial sujeta a Ley 3/2024": "BUILDING_URBANISTIC_LICENCE_FAMILY",
    "Licencia de 1ª ocupación y funcionamiento": "BUILDING_URBANISTIC_LICENCE_FAMILY",
    "Licencia de funcionamiento de actividad": "ACTIVITY_LICENCE_FAMILY",
    "Licencia urbanística de actividad": "ACTIVITY_LICENCE_FAMILY",
    "Licencia urbanística residencial": "BUILDING_URBANISTIC_LICENCE_FAMILY",
    "Licencia urbanística residencial sujeta a la ley 3/2024": "BUILDING_URBANISTIC_LICENCE_FAMILY",
    "Licencia urbanística residencial sujeta a Ley 3/2024": "BUILDING_URBANISTIC_LICENCE_FAMILY",
    "Licencias para actividades temporales": "TEMPORARY_ACTIVITY_FAMILY",
}

# ------------------------------------------------------------- pinned Gate M baseline
BASELINE = {
    "licence_rows": 11498,
    "resolved_rows": 11265,
    "unresolved_rows": 233,
    "current_only_resolved_rows": 11179,
    "historical_only_recovered_rows": 86,
    "family_counts": {
        "BUILDING_URBANISTIC_LICENCE_FAMILY": 5938,
        "ACTIVITY_LICENCE_FAMILY": 5385,
        "TEMPORARY_ACTIVITY_FAMILY": 175,
    },
    "unclassified_tipo_rows": 0,
    "nivel_proteccion_absence_states": {"EMPTY": 2507, "Sin Catalogar": 5340, "Sin protección": 1040},
    "norma_zonal_missing": 2505,
    "calibrated_on": "2026-10-06",
}
MIN_RESOLVED_ROWS = 9000

# ================================================================ Spanish date parser
MONTHS = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
}
WEEKDAYS = {
    "lunes": 0, "martes": 1, "miércoles": 2, "jueves": 3,
    "viernes": 4, "sábado": 5, "domingo": 6,
}
DATE_RE = re.compile(
    r"^(lunes|martes|miércoles|jueves|viernes|sábado|domingo), "
    r"(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|"
    r"septiembre|octubre|noviembre|diciembre) de (\d{4})$"
)


# ===================================================================== pure primitives


def canonical(value):
    value = (value or "").strip().upper()
    return " ".join(value.split())


def ascii_key(value):
    text = unicodedata.normalize("NFKD", (value or "").strip().lower())
    return "".join(c for c in text if not unicodedata.combining(c))


def parse_spanish_date(value):
    """Deterministic parse of the exact observed grammar; no machine locale, no fuzzy
    parsing. Returns (date, weekday_consistent). Raises ValueError on any other form."""
    match = DATE_RE.fullmatch((value or "").strip().lower())
    if not match:
        raise ValueError(f"unsupported Spanish date: {value!r}")
    weekday, day, month, year = match.groups()
    parsed = _dt.date(int(year), MONTHS[month], int(day))
    return parsed, parsed.weekday() == WEEKDAYS[weekday]


def classify_family(tipo):
    """Map a verbatim TIPO to exactly one family. Raises on an unseen TIPO so taxonomy
    drift fails the build rather than silently collapsing to OTHER."""
    family = TIPO_FAMILIES.get((tipo or "").strip())
    if family is None:
        raise ValueError(f"unclassified TIPO: {tipo!r}")
    return family


def nivel_proteccion_value(raw):
    """Preserve the protection state verbatim. The three absence-like states (empty,
    'Sin Catalogar', 'Sin protección') and the real protection grades stay distinct:
    empty becomes null, every other value is kept verbatim. They are NEVER merged."""
    value = (raw or "").strip()
    return value or None


def norma_zonal_value(raw):
    """Preserve NORMA_ZONAL verbatim; an empty value is missing/not published and is
    recorded as null. No cause is inferred."""
    value = (raw or "").strip()
    return value or None


def build_licence_record(lic, crosswalk_record):
    """Build one resolved licence product record by joining a licence row to its
    resolved crosswalk record. Pure. Carries only product-useful, minimised fields;
    never PERSONA_INTERESADA. Grant date is FECHA_FIRMA_RESOLUCION."""
    index = crosswalk_record["licence_index"]
    grant = parse_spanish_date(lic["FECHA_FIRMA_RESOLUCION"])[0]
    return {
        "id": f"k9-{index:05d}",
        "ndp": canonical(lic.get("NDP")),
        "family": classify_family(lic.get("TIPO")),
        "tipo": (lic.get("TIPO") or "").strip(),
        "grant_date": grant.isoformat(),
        "norma_zonal": norma_zonal_value(lic.get("NORMA_ZONAL")),
        "nivel_proteccion": nivel_proteccion_value(lic.get("NIVEL_PROTECCION")),
        "lat": crosswalk_record["lat"],
        "lon": crosswalk_record["lon"],
        "coordinate_crs": crosswalk_record["coordinate_crs"],
        "barrio_code": crosswalk_record["barrio_code"],
        "district_code": crosswalk_record["district_code"],
        "crosswalk_state": crosswalk_record["crosswalk_state"],
        "resolution_provenance": crosswalk_record["resolution_provenance"],
        "barrio_provenance": crosswalk_record["barrio_provenance"],
        "address_text_agrees": crosswalk_record["address_text_agrees"],
    }


# ============================================================== retrieval (stdlib)


def _package(dataset_id):
    req = urllib.request.Request(CATALOGUE_API + dataset_id, headers={"User-Agent": USER_AGENT})
    error = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                return json.load(response)["result"]
        except Exception as exc:
            error = exc
            if attempt < 3:
                time.sleep(2 ** attempt)
    raise error


def _resource(pkg, resource_id):
    return next(r for r in pkg["resources"] if r["id"] == resource_id)


def _fetch(url, cache_dir=None, cache_key=None):
    if cache_dir and cache_key:
        body_path = Path(cache_dir) / f"{cache_key}.csv"
        head_path = Path(cache_dir) / f"{cache_key}.headers.json"
        if body_path.exists() and head_path.exists():
            payload = body_path.read_bytes()
            http = json.loads(head_path.read_text(encoding="utf-8"))
            http["sha256"] = hashlib.sha256(payload).hexdigest()
            http["bytes"] = len(payload)
            return payload, http
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    error = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=180) as response:
                payload = response.read()
                http = {
                    "http_last_modified": response.headers.get("Last-Modified"),
                    "http_etag": response.headers.get("ETag"),
                    "http_content_length": response.headers.get("Content-Length"),
                    "bytes": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }
                if cache_dir and cache_key:
                    Path(cache_dir).mkdir(parents=True, exist_ok=True)
                    (Path(cache_dir) / f"{cache_key}.csv").write_bytes(payload)
                    (Path(cache_dir) / f"{cache_key}.headers.json").write_text(
                        json.dumps({k: v for k, v in http.items() if k not in ("sha256", "bytes")}),
                        encoding="utf-8",
                    )
                return payload, http
        except Exception as exc:
            error = exc
            if attempt < 3:
                time.sleep(2 ** attempt)
    raise error


def _decoded_csv(payload, encoding):
    reader = csv.DictReader(io.StringIO(payload.decode(encoding)), delimiter=";")
    return [{(k or "").strip(): (v or "").strip() for k, v in r.items()} for r in reader]


# ============================================================================ build


def now():
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fingerprint(payload):
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def build(out_dir, cache_dir=None):
    root = Path(__file__).resolve().parents[1]
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    generated_at = now()

    crosswalk = json.loads((root / CROSSWALK_ARTIFACT).read_text(encoding="utf-8"))
    crosswalk_meta = json.loads((root / CROSSWALK_META).read_text(encoding="utf-8"))
    crosswalk_records = crosswalk["records"]

    print("[licences] retrieving the granted-licence register ...")
    licence_pkg = _package(LICENCE_DATASET)
    licence_res = _resource(licence_pkg, LICENCE_RESOURCE)
    licence_payload, licence_http = _fetch(licence_res["url"], cache_dir, LICENCE_RESOURCE)
    licences = _decoded_csv(licence_payload, "utf-8-sig")

    # The row-index join is only valid against the exact edition the crosswalk was
    # built from: same bytes, same row order. Fail closed on any mismatch.
    crosswalk_licence_sha = crosswalk_meta["sources"]["licence_register"]["observed_resource_state"]["sha256"]
    if licence_http["sha256"] != crosswalk_licence_sha:
        raise SystemExit(
            "the licence register edition does not match the committed crosswalk: licence SHA "
            f"{licence_http['sha256'][:16]} vs crosswalk's {crosswalk_licence_sha[:16]}. "
            "Rebuild the crosswalk first so the row-index join stays valid."
        )
    if len(licences) != len(crosswalk_records):
        raise SystemExit(
            f"licence rows ({len(licences)}) != crosswalk records ({len(crosswalk_records)}); "
            "the join universe disagrees."
        )

    # ---- granted-only universe guard --------------------------------------------
    resolucion = {canonical(r.get("RESOLUCION")) for r in licences}
    if resolucion != {"CONCEDER"}:
        raise SystemExit(
            f"the register is not a granted-only universe: observed RESOLUCION values {sorted(resolucion)}. "
            "K9 has no application/refusal denominator and must not ingest non-granted rows."
        )

    # ---- classify families (closed taxonomy; unseen TIPO fails) -----------------
    tipo_counts = collections.Counter((r.get("TIPO") or "").strip() for r in licences)
    unknown = sorted(t for t in tipo_counts if t not in TIPO_FAMILIES)
    if unknown:
        raise SystemExit(
            f"unclassified TIPO value(s): {unknown}. Every TIPO must map to exactly one family; "
            "classify it and update TIPO_FAMILIES rather than letting taxonomy drift pass silently."
        )
    family_counts = collections.Counter()
    for tipo, count in tipo_counts.items():
        family_counts[TIPO_FAMILIES[tipo]] += count

    # ---- parse every grant date; fail on drift ----------------------------------
    grant_dates = []
    for i, lic in enumerate(licences):
        parsed, weekday_ok = parse_spanish_date(lic["FECHA_FIRMA_RESOLUCION"])
        if not weekday_ok:
            raise SystemExit(f"row {i}: weekday inconsistent in FECHA_FIRMA_RESOLUCION {lic['FECHA_FIRMA_RESOLUCION']!r}")
        # Cross-check the publisher's own decomposed components.
        if (
            str(parsed.year) != (lic.get("FECHA_FIRMA_RESOLUCION - Año") or "").strip()
            or str(parsed.day) != (lic.get("FECHA_FIRMA_RESOLUCION - Día") or "").strip()
        ):
            raise SystemExit(f"row {i}: publisher date components disagree with the parsed grant date")
        grant_dates.append(parsed)

    # ---- join resolved rows; unresolved survive in coverage only ----------------
    records = []
    per_family = {f: {"resolved": 0, "unresolved": 0} for f in FAMILIES}
    per_year = collections.defaultdict(lambda: {"resolved": 0, "unresolved": 0})
    residual = collections.Counter()
    for lic, xw, grant in zip(licences, crosswalk_records, grant_dates):
        family = TIPO_FAMILIES[(lic.get("TIPO") or "").strip()]
        year = str(grant.year)
        residual[xw["crosswalk_state"]] += 1
        resolved = xw["crosswalk_state"] in RESOLVED_STATES
        per_family[family]["resolved" if resolved else "unresolved"] += 1
        per_year[year]["resolved" if resolved else "unresolved"] += 1
        if resolved:
            records.append(build_licence_record(lic, xw))

    if len(records) < MIN_RESOLVED_ROWS:
        raise SystemExit(f"only {len(records)} resolved licence records (floor {MIN_RESOLVED_ROWS}); suspected collapse.")

    # Deterministic order for a byte-stable artifact.
    records.sort(key=lambda r: r["id"])

    # ---- protection / norma observations (provenance checks, not causal claims) -
    protection_counts = collections.Counter((r.get("NIVEL_PROTECCION") or "EMPTY").strip() or "EMPTY" for r in licences)
    norma_missing = sum(not (r.get("NORMA_ZONAL") or "").strip() for r in licences)
    both_missing = sum(
        not (r.get("NORMA_ZONAL") or "").strip() and not (r.get("NIVEL_PROTECCION") or "").strip() for r in licences
    )
    only_protection = sum(
        not (r.get("NIVEL_PROTECCION") or "").strip() and bool((r.get("NORMA_ZONAL") or "").strip()) for r in licences
    )
    only_norma = sum(
        bool((r.get("NIVEL_PROTECCION") or "").strip()) and not (r.get("NORMA_ZONAL") or "").strip() for r in licences
    )

    date_extent = {"min": min(grant_dates).isoformat(), "max": max(grant_dates).isoformat()}
    row_match_rate = round(len(records) / len(licences), 6)

    families_block = {
        f: {"resolved": per_family[f]["resolved"], "unresolved": per_family[f]["unresolved"], "total": family_counts[f]}
        for f in FAMILIES
    }
    coverage = {
        "total_rows": len(licences),
        "resolved_rows": len(records),
        "unresolved_rows": len(licences) - len(records),
        "row_match_rate": row_match_rate,
        "current_only_resolved_rows": sum(r["resolution_provenance"] == "CURRENT_CALLEJERO" for r in records),
        "historical_only_recovered_rows": sum(r["resolution_provenance"] == "HISTORICAL_CALLEJERO" for r in records),
        "address_text_disagreement_rows": sum(r["crosswalk_state"] == "ADDRESS_TEXT_DISAGREEMENT" for r in records),
        "residual_taxonomy": dict(sorted(residual.items())),
        "per_family": per_family,
        "per_year": {y: per_year[y] for y in sorted(per_year)},
        "coverage_statement": (
            f"Mapped from {row_match_rate * 100:.2f}% of granted records in the pinned register; "
            f"{len(licences) - len(records)} unresolved rows are withheld from the map and reported here."
        ),
    }

    artifact = {
        "contract_version": CONTRACT_VERSION,
        "generated_at": generated_at,
        "granted_only": True,
        "interpretation_ceiling": (
            "These are granted administrative urban licences. A granted licence means an administrative "
            "grant was recorded; it is NOT evidence that work started, construction occurred or "
            "completed, occupancy happened, or the permitted quantity was built. There is no "
            "approval/rejection denominator and no cross-family total."
        ),
        "families": families_block,
        "date_extent": date_extent,
        "coverage": coverage,
        "records": records,
    }
    artifact_fingerprint = fingerprint(artifact)

    meta = {
        "contract_version": CONTRACT_VERSION,
        "artifact": "madrid_urban_licences.json",
        "generated_at": generated_at,
        "builder": "scripts/build_urban_licences.py",
        "gate": "Gate M (#70); issue #71 (K9) production increment",
        "source": {
            "dataset": licence_pkg["name"],
            "resource": licence_res["id"],
            "authority": licence_pkg.get("author") or "Ayuntamiento de Madrid",
            "download_url": licence_res["url"],
            "licence": licence_pkg.get("license_title"),
            "encoding": "UTF-8 with BOM",
            "delimiter": ";",
            "declared_cadence": "MONTHLY",
            "reference_date": None,
            "published_at": None,
            "retrieved_at": generated_at,
            "update_frequency": "MONTHLY",
            "source_state": "NOT_DECLARED_BY_PUBLISHER",
            "observed_resource_state": {**licence_http, "catalogue_metadata_modified": licence_pkg.get("metadata_modified")},
            "freshness_ceiling": (
                "The publisher declares no reference_date and no published_at for the register. The "
                "monthly cadence, the HTTP Last-Modified header and the retrieval clock are observed "
                "resource state only and are never promoted into a source reference date."
            ),
        },
        "crosswalk_dependency": {
            "artifact": CROSSWALK_ARTIFACT,
            "fingerprint": crosswalk_meta["fingerprint"]["value"],
            "current_callejero_resource": crosswalk_meta["sources"]["current_callejero"]["resource_id"],
            "current_callejero_sha256": crosswalk_meta["sources"]["current_callejero"]["observed_resource_state"]["sha256"],
            "historical_callejero_resource": crosswalk_meta["sources"]["historical_callejero"]["resource_id"],
            "historical_callejero_sha256": crosswalk_meta["sources"]["historical_callejero"]["observed_resource_state"]["sha256"],
        },
        "universe": {
            "resolucion": "Conceder (granted only)",
            "forbidden_denominators": ["approval_rate", "rejection_rate", "refusal_count", "success_rate", "processing_performance_rate"],
            "no_cross_family_total": True,
            "granted_is_not_built": True,
        },
        "families": families_block,
        "tipo_taxonomy": {
            "classification": {t: TIPO_FAMILIES[t] for t in sorted(tipo_counts)},
            "tipo_counts": dict(sorted(tipo_counts.items())),
            "family_counts": dict(sorted(family_counts.items())),
            "unclassified_tipo_rows": 0,
            "closed": True,
            "drift_policy": "An unseen TIPO fails the build; nothing is silently mapped to OTHER.",
        },
        "nivel_proteccion": {
            "counts": dict(sorted(protection_counts.items())),
            "absence_states_kept_distinct": ["EMPTY (stored as null)", "Sin Catalogar", "Sin protección"],
            "note": "The three absence-like states and the real protection grades are all preserved verbatim; empty is stored as null and never merged with the named states.",
        },
        "norma_zonal_missingness": {
            "missing": norma_missing,
            "both_protection_and_norma_missing": both_missing,
            "only_protection_missing": only_protection,
            "only_norma_missing": only_norma,
            "note": "Provenance checks only; no cause is inferred and nothing user-facing is derived from missingness.",
        },
        "coverage": coverage,
        "date_extent": date_extent,
        "excluded": {
            "declaraciones_responsables_dataset": EXCLUDED_DECLARATIONS_DATASET,
            "reason": "Gate M recommended excluding responsible declarations from K9 V1. No artifact, UI, count or layer. A future issue may add it as a separate evidence family; it is never joined or summed with granted licences.",
        },
        "overlap_ceiling": (
            "Licence records may concern places also present in Censo de Locales, licensed VUT or "
            "hospitality/activity evidence. No deterministic entity link exists, so these universes are "
            "never summed as unique businesses or sites."
        ),
        "record_fields": sorted(records[0].keys()) if records else [],
        "excluded_fields": ["PERSONA_INTERESADA", "ORGANO_COMPETENTE", "Nº_EXPEDIENTE", "DIRECCION", "FECHA_ALTA"],
        "baseline": {**BASELINE, "note": "Pinned Gate M observations, reproduced from the pinned source edition; recorded, not asserted as permanent truths."},
        "fingerprint": {"algorithm": "sha256", "scope": "canonical JSON of the artifact object", "value": artifact_fingerprint},
        "runtime_policy": "BUILD TIME ONLY. The browser reads this committed, fingerprinted artifact and never calls datos.madrid.es.",
    }

    artifact_path = out_dir / "madrid_urban_licences.json"
    meta_path = out_dir / "madrid_urban_licences.meta.json"
    with open(artifact_path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(artifact, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")
    with open(meta_path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(meta, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(
        f"[licences] wrote {artifact_path} — {len(records)} resolved of {len(licences)} rows, "
        f"families {dict(family_counts)}, {artifact_path.stat().st_size} bytes"
    )
    print(f"[licences] date extent {date_extent['min']}..{date_extent['max']}; fingerprint {artifact_fingerprint[:16]}")
    return artifact, meta


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out-dir", default="data/planning")
    parser.add_argument("--cache-dir", default=None, help="optional local cache for the licence download")
    args = parser.parse_args(argv)
    build(args.out_dir, cache_dir=args.cache_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
