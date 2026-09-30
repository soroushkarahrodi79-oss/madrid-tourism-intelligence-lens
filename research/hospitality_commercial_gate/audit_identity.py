#!/usr/bin/env python3
"""Gate A source audit: can a Madrid local/premises and its activities be followed
between monthly snapshots using a stable, source-native identifier?

Run on demand against the LIVE official source. It is not part of the test suite
and nothing in the application imports it. It answers one question only - unit and
identity - for the Ayuntamiento de Madrid dataset

    Censo de locales, sus actividades y terrazas de hosteleria y restauracion -
    historico   (datos.madrid.es  209548-0-censo-locales-historico)

for the "Locales" and "Actividades" resource families, comparing the September
2026 and August 2026 snapshots, with September 2025 as an earlier control for
persistence and schema/format drift.

    python research/hospitality_commercial_gate/audit_identity.py

It writes one compact JSON report next to this file, in results/. Raw upstream
CSVs (each ~85-125 MB) are streamed to a temporary file, fingerprinted, parsed,
and deleted. They are never committed. Every count in the report is an
observation of one run against the fingerprinted resources it records, not a
repository invariant.

Dependencies: Python standard library only.
"""

from __future__ import annotations

import collections
import csv
import datetime as _dt
import hashlib
import io
import json
import os
import re
import sys
import tempfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
UA = {"User-Agent": "madrid-tourism-intelligence-lens gate-a identity audit"}

PACKAGE = "209548-0-censo-locales-historico"
CKAN = f"https://datos.madrid.es/api/3/action/package_show?id={PACKAGE}"
CATALOGUE = f"https://datos.madrid.es/dataset/{PACKAGE}"
STRUCTURE_PDF = (
    "https://datos.madrid.es/dataset/209548-0-censo-locales-historico/resource/"
    "209548-403-censo-locales-historico/download/estructura_ds_ficherocla.pdf"
)

# The two families and three months this gate compares. Resources are NOT hard
# coded by opaque numeric id: they are resolved from the catalogue by their exact
# human-readable `description`, which is the only field that carries family+month
# and is unique per resource. Resolving deterministically IS part of the evidence.
TARGETS = {
    "locales_2026_09": ("Locales. Septiembre 2026", "locales"),
    "locales_2026_08": ("Locales. Agosto 2026", "locales"),
    "locales_2025_09": ("Locales. Septiembre 2025", "locales"),
    "actividades_2026_09": ("Actividades. Septiembre 2026", "actividades"),
    "actividades_2026_08": ("Actividades. Agosto 2026", "actividades"),
    "actividades_2025_09": ("Actividades. Septiembre 2025", "actividades"),
}

csv.field_size_limit(1 << 24)


def now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def blank(v: str | None) -> str:
    return (v or "").strip()


def package() -> dict:
    req = urllib.request.Request(CKAN, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))["result"]


def resolve_resource(pkg: dict, description: str, fmt: str = "CSV") -> dict:
    hits = [
        r for r in pkg["resources"]
        if blank(r.get("description")) == description
        and (r.get("format") or "").upper() == fmt
    ]
    if len(hits) != 1:
        raise SystemExit(
            f"resource {description!r} ({fmt}) resolved to {len(hits)} matches, expected 1"
        )
    return hits[0]


def stream_to_temp(url: str) -> tuple[str, dict]:
    """Download to a temp file, fingerprinting as we go. Returns (path, http meta)."""
    req = urllib.request.Request(url, headers=UA)
    sha = hashlib.sha256()
    size = 0
    fd, path = tempfile.mkstemp(suffix=".csv")
    with urllib.request.urlopen(req, timeout=300) as r, os.fdopen(fd, "wb") as f:
        meta = {
            "http_last_modified": r.headers.get("Last-Modified"),
            "etag": r.headers.get("ETag"),
            "content_type": r.headers.get("Content-Type"),
        }
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            sha.update(chunk)
            size += len(chunk)
    meta["bytes"] = size
    meta["sha256"] = sha.hexdigest()
    return path, meta


def detect_dialect(path: str) -> dict:
    """Observe delimiter, BOM and per-file quoting rather than assume the doc."""
    with open(path, "rb") as f:
        head = f.read(4096)
    bom = head.startswith(b"\xef\xbb\xbf")
    text = head[3:] if bom else head
    first = text.split(b"\n", 1)[0]
    return {
        "delimiter": ";" if first.count(b";") >= first.count(b"|") else "|",
        "utf8_bom": bom,
        "header_fields_quoted": first.strip().startswith(b'"'),
    }


# --------------------------------------------------------------- readers

def read_locales(path: str, keep_attrs: bool):
    ids: set[str] = set()
    dup = collections.Counter()
    blanks = 0
    rows = 0
    tipo = collections.Counter()
    tipo_desc: dict[str, str] = {}
    sit = collections.Counter()
    sit_desc: dict[str, str] = {}
    ndp_count = collections.Counter()
    coord_count = collections.Counter()
    rotulo_blank = 0
    rotulo_count = collections.Counter()
    barrios: set[str] = set()
    districts: set[str] = set()
    barrio_blank = 0
    attrs: dict[str, tuple] = {} if keep_attrs else None
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        rdr = csv.DictReader(f, delimiter=";")
        header = rdr.fieldnames
        for r in rdr:
            rows += 1
            idl = blank(r["id_local"])
            if not idl:
                blanks += 1
            else:
                if idl in ids:
                    dup[idl] += 1
                ids.add(idl)
            ta = blank(r["id_tipo_acceso_local"])
            tipo[ta] += 1
            tipo_desc.setdefault(ta, blank(r["desc_tipo_acceso_local"]))
            sc = blank(r["id_situacion_local"])
            sit[sc] += 1
            sit_desc.setdefault(sc, blank(r["desc_situacion_local"]))
            ndp = blank(r["id_ndp_edificio"])
            if ndp:
                ndp_count[ndp] += 1
            cx, cy = blank(r["coordenada_x_local"]), blank(r["coordenada_y_local"])
            coord_count[(cx, cy)] += 1
            rot = blank(r["rotulo"])
            if not rot:
                rotulo_blank += 1
            else:
                rotulo_count[rot] += 1
            bar = blank(r["id_barrio_local"])
            if not bar:
                barrio_blank += 1
            else:
                barrios.add(bar)
            dist = blank(r["id_distrito_local"])
            if dist:
                districts.add(dist)
            if keep_attrs and idl:
                attrs[idl] = (bar, sc, rot, ndp, blank(r["num_edificio"]), cx, cy, ta)
    summary = {
        "num_columns": len(header),
        "rows": rows,
        "identity_id_local": {
            "field": "id_local",
            "total_rows": rows,
            "blank": blanks,
            "distinct": len(ids),
            "duplicate_ids": len(dup),
            "duplicate_rows": sum(dup.values()),
            "unique_within_snapshot": len(dup) == 0 and blanks == 0,
        },
        "tipo_acceso": {k: {"rows": v, "desc": tipo_desc.get(k, "")} for k, v in sorted(tipo.items())},
        "situacion": {k: {"rows": v, "desc": sit_desc.get(k, "")} for k, v in sorted(sit.items())},
        "geography": {
            "distinct_id_barrio_local": len(barrios),
            "distinct_id_distrito_local": len(districts),
            "rows_blank_barrio": barrio_blank,
        },
        "negative_controls": {
            "name_rotulo": {
                "blank_rows": rotulo_blank,
                "distinct_nonblank": len(rotulo_count),
                "max_rows_sharing_one_value": rotulo_count.most_common(1)[0][1] if rotulo_count else 0,
                "values_shared_by_more_than_one_local": sum(1 for v in rotulo_count.values() if v > 1),
                "examples_most_shared": dict(rotulo_count.most_common(5)),
            },
            "address_id_ndp_edificio": {
                "distinct": len(ndp_count),
                "addresses_with_more_than_one_local": sum(1 for v in ndp_count.values() if v > 1),
                "max_locals_per_address": ndp_count.most_common(1)[0][1] if ndp_count else 0,
            },
            "coordinates": {
                "distinct_pairs": len(coord_count),
                "pairs_shared_by_more_than_one_local": sum(1 for v in coord_count.values() if v > 1),
                "max_locals_per_coordinate": coord_count.most_common(1)[0][1] if coord_count else 0,
                "most_shared_pair": (lambda mc: {"x": mc[0][0][0], "y": mc[0][0][1], "locals": mc[0][1]})(coord_count.most_common(1)) if coord_count else None,
            },
        },
    }
    return summary, header, ids, attrs


def read_actividades(path: str, keep_pairs: bool, locales_ids: set[str] | None):
    rows = 0
    ids: set[str] = set()
    pairs: set[tuple[str, str]] = set()
    pair_dup = collections.Counter()
    id_blank = 0
    epi_blank = 0
    per_local = collections.Counter()
    secciones = collections.Counter()
    divisiones: set[str] = set()
    epigrafes: set[str] = set()
    orphan = 0
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        rdr = csv.DictReader(f, delimiter=";")
        header = rdr.fieldnames
        for r in rdr:
            rows += 1
            idl = blank(r["id_local"])
            epi = blank(r["id_epigrafe"])
            if not idl:
                id_blank += 1
            if not epi:
                epi_blank += 1
            ids.add(idl)
            per_local[idl] += 1
            key = (idl, epi)
            if key in pairs:
                pair_dup[key] += 1
            pairs.add(key)
            secciones[blank(r["id_seccion"])] += 1
            divisiones.add(blank(r["id_division"]))
            epigrafes.add(epi)
            if locales_ids is not None and idl not in locales_ids:
                orphan += 1
    dist = collections.Counter(per_local.values())
    blank_pairs = sum(1 for (_a, b) in pairs if b == "")
    summary = {
        "num_columns": len(header),
        "rows": rows,
        "identity_id_local": {
            "field": "id_local",
            "total_rows": rows,
            "blank": id_blank,
            "distinct": len(ids),
            "note": "Not a row identity in this file: one local repeats once per activity epigraph.",
        },
        "identity_activity_pair": {
            "field": "(id_local, id_epigrafe)",
            "scope": "A within-snapshot activity key ONLY where id_epigrafe is populated.",
            "total_rows": rows,
            "distinct": len(pairs),
            "duplicate_pairs": len(pair_dup),
            "duplicate_rows": sum(pair_dup.values()),
            "blank_epigrafe_rows": epi_blank,
            "distinct_classified_pairs": len(pairs) - blank_pairs,
            "classified_unique_within_snapshot": len(pair_dup) == 0,
            "blank_epigraph_semantics": "UNRESOLVED - deferred to Gate B. (id_local, '') is NOT "
                "treated as a known activity identity; these rows are neither reinterpreted, "
                "given a placeholder category, nor discarded.",
        },
        "activities_per_local": {
            "max": max(dist) if dist else 0,
            "locals_with_more_than_one_activity": sum(c for n, c in dist.items() if n > 1),
            "distribution": dict(sorted(dist.items())),
        },
        "taxonomy_observed": {
            "distinct_secciones_nonblank": len([k for k in secciones if k]),
            "distinct_divisiones_nonblank": len([d for d in divisiones if d]),
            "distinct_epigrafes_nonblank": len([e for e in epigrafes if e]),
            "rows_with_blank_seccion": secciones.get("", 0),
            "note": "Taxonomy counts are recorded for observation only. The activity-code "
                    "taxonomy is Gate B, not Gate A.",
        },
    }
    if locales_ids is not None:
        summary["referential_integrity"] = {
            "orphan_activity_rows_whose_id_local_absent_from_locales": orphan,
        }
    return summary, header, ids, (pairs if keep_pairs else None)


# --------------------------------------------------------------- cross-month

def locales_persistence(a_ids, a_attrs, b_ids, b_attrs, a_label, b_label):
    inter = a_ids & b_ids
    a_only = a_ids - b_ids
    b_only = b_ids - a_ids
    fields = ["id_barrio_local", "id_situacion_local", "rotulo",
              "id_ndp_edificio", "num_edificio", "coordenada_x_local",
              "coordenada_y_local", "id_tipo_acceso_local"]
    changed = collections.Counter()
    n_changed = 0
    sit_transitions = collections.Counter()
    examples = []
    for idl in inter:
        a, b = a_attrs[idl], b_attrs[idl]
        if a != b:
            n_changed += 1
            diffs = [fields[i] for i in range(len(fields)) if a[i] != b[i]]
            for d in diffs:
                changed[d] += 1
            if a[1] != b[1]:
                sit_transitions[f"{a[1]}->{b[1]}"] += 1
            if len(examples) < 6:
                examples.append({
                    "id_local": idl,
                    "changed_fields": diffs,
                    a_label: dict(zip(fields, a)),
                    b_label: dict(zip(fields, b)),
                })
    return {
        "premises_key": "id_local",
        f"{a_label}_count": len(a_ids),
        f"{b_label}_count": len(b_ids),
        "intersection": len(inter),
        f"{a_label}_only_disappeared": len(a_only),
        f"{b_label}_only_appeared": len(b_only),
        "persistence_rate": round(len(inter) / len(a_ids), 5),
        "persistent_locals_with_any_attribute_change": n_changed,
        "attribute_change_breakdown": dict(changed.most_common()),
        "situacion_transitions": dict(sit_transitions.most_common()),
        "change_examples": examples,
        "sample_disappeared_ids": sorted(a_only)[:8],
        "sample_appeared_ids": sorted(b_only)[:8],
    }


def main() -> int:
    RESULTS.mkdir(exist_ok=True)
    started = now()
    print("[gate-a] resolving resources from the official catalogue ...")
    pkg = package()
    resolved = {key: resolve_resource(pkg, desc) for key, (desc, _) in TARGETS.items()}

    # Fetch + fingerprint + parse, one resource at a time.
    resources = {}
    schema = {}
    per_snapshot = {}
    loc_ids = {}
    loc_attrs = {}
    act_pairs = {}
    keep_loc_attrs = {"locales_2026_09", "locales_2026_08"}
    keep_act_pairs = {"actividades_2026_09", "actividades_2026_08"}

    for key, (desc, family) in TARGETS.items():
        res = resolved[key]
        print(f"[gate-a] fetching {desc} ...")
        path, meta = stream_to_temp(res["url"])
        try:
            dialect = detect_dialect(path)
            resources[key] = {
                "description": desc,
                "resource_id": res.get("id"),
                "format": (res.get("format") or "").upper(),
                "url": res["url"],
                "retrieved_at": now(),
                **meta,
            }
            if family == "locales":
                summ, header, ids, attrs = read_locales(path, keep_attrs=key in keep_loc_attrs)
                loc_ids[key] = ids
                if attrs is not None:
                    loc_attrs[key] = attrs
            else:
                lk = key.replace("actividades", "locales")
                summ, header, ids, pairs = read_actividades(
                    path, keep_pairs=key in keep_act_pairs,
                    locales_ids=loc_ids.get(lk),
                )
                if pairs is not None:
                    act_pairs[key] = pairs
            summ["dialect_observed"] = dialect
            per_snapshot[key] = summ
            schema[key] = {"columns": header, "num_columns": len(header), **dialect}
        finally:
            os.unlink(path)
        print(f"[gate-a]   {per_snapshot[key]['rows']} rows, {meta['bytes']} bytes")

    print("[gate-a] computing cross-month persistence ...")
    DIRECTION_CAVEAT = (
        "Valid for identity-persistence testing. The appeared/disappeared DIRECTION "
        "must NOT be read as clean calendar-month churn: the published resource timing "
        "is inverted - the file labelled 'Agosto 2026' was served later (28 Sep) than "
        "the one labelled 'Septiembre 2026' (03 Sep), so Sep is a near-subset of Aug. "
        "The Sep 2025 -> Sep 2026 control is the representative directional delta."
    )
    aug_sep_loc = locales_persistence(
        loc_ids["locales_2026_08"], loc_attrs["locales_2026_08"],
        loc_ids["locales_2026_09"], loc_attrs["locales_2026_09"],
        "aug2026", "sep2026",
    )
    aug_sep_loc["direction_caveat"] = DIRECTION_CAVEAT
    persistence = {
        "locales_aug_to_sep_2026": aug_sep_loc,
        "locales_sep2025_to_sep2026_control": {
            "premises_key": "id_local",
            "sep2025_count": len(loc_ids["locales_2025_09"]),
            "sep2026_count": len(loc_ids["locales_2026_09"]),
            "intersection": len(loc_ids["locales_2025_09"] & loc_ids["locales_2026_09"]),
            "sep2025_only_disappeared": len(loc_ids["locales_2025_09"] - loc_ids["locales_2026_09"]),
            "sep2026_only_appeared": len(loc_ids["locales_2026_09"] - loc_ids["locales_2025_09"]),
            "persistence_rate": round(
                len(loc_ids["locales_2025_09"] & loc_ids["locales_2026_09"]) / len(loc_ids["locales_2025_09"]), 5),
            "note": "The 2025 file is unquoted; the 2026 file quotes every field. The key "
                    "survives that formatting change - a line/string identity would not.",
        },
        "actividades_aug_to_sep_2026": {
            "activity_key": "(id_local, id_epigrafe)",
            "aug2026_pairs": len(act_pairs["actividades_2026_08"]),
            "sep2026_pairs": len(act_pairs["actividades_2026_09"]),
            "pair_intersection": len(act_pairs["actividades_2026_08"] & act_pairs["actividades_2026_09"]),
            "aug2026_only_pairs": len(act_pairs["actividades_2026_08"] - act_pairs["actividades_2026_09"]),
            "sep2026_only_pairs": len(act_pairs["actividades_2026_09"] - act_pairs["actividades_2026_08"]),
            "pair_persistence_rate": round(
                len(act_pairs["actividades_2026_08"] & act_pairs["actividades_2026_09"]) / len(act_pairs["actividades_2026_08"]), 5),
            "note": "Activities churn on premises that themselves persist: new pairs appear "
                    "and old pairs leave while the premises id_local is stable.",
            "direction_caveat": DIRECTION_CAVEAT,
        },
    }

    report = {
        "audit_started_at": started,
        "audit_finished_at": now(),
        "environment_note": "Counts are observations of one run against the fingerprinted "
                            "resources recorded below, not repository invariants.",
        "dataset": {
            "id": PACKAGE,
            "title": pkg.get("title"),
            "catalogue": CATALOGUE,
            "license": pkg.get("license_title"),
            "catalogue_metadata_modified": pkg.get("metadata_modified"),
            "resource_resolution_method": "Exact match on the resource `description` field "
                                          "(family + month), which is unique per resource. "
                                          "Opaque numeric resource ids are recorded, not used to select.",
        },
        "documentation": {
            "structure_pdf": STRUCTURE_PDF,
            "structure_pdf_version": "mar/2022 (as printed in the PDF)",
            "documented_row_units": {
                "locales": "cada registro corresponde a un local (one premises per row)",
                "actividades": "cada registro corresponde a un local mas un codigo de actividad; "
                               "un local con N epigrafes aparece N veces (one premises x activity per row)",
            },
            "documented_premises_identity": "id_local - 'Codigo numerico que identifica cada local'. "
                "Derived from id_ndp_edificio + secuencial_local_PC (puerta de calle) or "
                "agrupacion + planta + local (agrupado).",
        },
        "resources": resources,
        "schema": schema,
        "per_snapshot": per_snapshot,
        "persistence": persistence,
        "gate_a_ruling": {
            "premises_identity": "GO",
            "classified_activity_identity": "GO",
            "blank_epigraph_activity_semantics": "UNRESOLVED",
            "overall": "GO to Gate B",
            "scope_limitation": "Premises identity (id_local) and classified activity identity "
                "((id_local, id_epigrafe) where id_epigrafe is populated) are GO. The semantics of "
                "activity rows with a blank id_epigrafe are UNRESOLVED and are deferred to the Gate B "
                "taxonomy/semantics work; they are not reinterpreted, bucketed or discarded here.",
        },
    }

    out = RESULTS / "gate_a_identity_summary.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[gate-a] wrote {out.relative_to(HERE.parents[1])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
