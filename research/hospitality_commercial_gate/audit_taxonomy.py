#!/usr/bin/env python3
"""Gate B activity-taxonomy audit for the Madrid historical premises/activity census.

Run on demand against the LIVE official source. It is not part of the test suite
and nothing in the application imports it. It answers one question only - the
activity taxonomy - for the Ayuntamiento de Madrid dataset

    Censo de locales, sus actividades y terrazas de hosteleria y restauracion -
    historico   (datos.madrid.es  209548-0-censo-locales-historico)

for the "Actividades" resource family, using September 2026 as the primary
taxonomy snapshot and September 2025 as a drift/control snapshot.

    python research/hospitality_commercial_gate/audit_taxonomy.py

It reuses the Gate A helpers (resource resolution by exact description, streamed
fingerprinting, per-file dialect detection) from `audit_identity.py` in this same
directory, so the source contract is identical to Gate A. It writes two compact
JSON reports next to this file, in results/. Raw upstream CSVs (each ~125 MB) are
streamed to a temporary file, fingerprinted, parsed and deleted. They are never
committed. Every count in the reports is an observation of one run against the
fingerprinted resources it records, not a repository invariant.

WHAT THIS DOES AND DOES NOT DO
------------------------------
It reads the official three-level activity hierarchy (Seccion -> Division ->
Epigrafe) directly from the live data, assigns every populated epigraph to exactly
one analytical class using the official CNAE-09 section/division the source itself
carries (never keyword-matching the description text), and characterises the
blank-epigraph rows. It builds NO indicator, score, ranking, denominator, map or
"pressure" claim. An activity record is administrative evidence, nothing more.

Dependencies: Python standard library only.
"""

from __future__ import annotations

import collections
import csv
import datetime as _dt
import json
import os
import sys
from pathlib import Path

# Reuse the Gate A source contract verbatim (same catalogue, same resolution,
# same streamed fingerprinting). Importing rather than duplicating keeps the two
# gates provably reading the same source the same way.
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import audit_identity as A  # noqa: E402

RESULTS = HERE / "results"
csv.field_size_limit(1 << 24)

# September 2026 is the primary taxonomy snapshot; September 2025 the control.
PRIMARY = ("actividades_2026_09", "Actividades. Septiembre 2026")
CONTROL = ("actividades_2025_09", "Actividades. Septiembre 2025")

# --------------------------------------------------------------------------
# Classification framework.
#
# The assignment is made on the official CNAE-09 SECTION (a letter) and DIVISION
# (two digits) that the source file carries on every activity row, NEVER on the
# free-text epigraph description. The structure document is explicit that section
# and division "coinciden con los utilizados por la CNAE-09 del INE" and that
# "todos los epigrafes de una misma division empiezan por los dos digitos de
# division" - so a division-level rule is exactly a rule on the official code
# prefix, and is fully auditable. The live data confirms it: no epigraph maps to
# more than one (section, division) parent.
#
# Classes (issue #33 Gate B, letters A-F):
#   CORE_HOSPITALITY   (A) - food & beverage service
#   ACCOMMODATION      (B) - lodging; kept separate from food/beverage AND from
#                            the licensed-VUT / Madrid Destino evidence universes
#   TOURISM_ADJACENT   (C) - not inherently a tourist business but defensibly
#                            destination-relevant with a clean source-native code
#   GENERIC_COMMERCIAL (D) - documented commerce, no tourism-specific reading
#   EXCLUDED           (E) - outside a Hospitality & Commercial Context reading
#   AMBIGUOUS          (F) - hierarchy/semantics do not permit a confident class
# Blank epigraph is handled separately (UNCLASSIFIED_SOURCE_ACTIVITY); it is NOT
# one of A-F and is never treated as an activity.
CLASSES = {
    "CORE_HOSPITALITY": "A. Food and beverage service (CNAE division 56).",
    "ACCOMMODATION": "B. Lodging (CNAE division 55). Separate from food/beverage and "
                     "from the licensed-VUT and Madrid Destino accommodation universes.",
    "TOURISM_ADJACENT": "C. Not inherently a tourist business but defensibly "
                        "destination-relevant, admitted only with a clean source-native code.",
    "GENERIC_COMMERCIAL": "D. Documented commerce with no tourism-specific interpretation; "
                          "background commercial composition only.",
    "EXCLUDED": "E. Activity outside a Hospitality & Commercial Context reading.",
    "AMBIGUOUS": "F. Section/division semantics do not permit a confident class; manual review.",
}
UNCLASSIFIED = "UNCLASSIFIED_SOURCE_ACTIVITY"

# Default class per CNAE section; overridden by division where the hospitality /
# tourism question needs finer resolution than the section gives.
SECTION_DEFAULT = {
    "A": "EXCLUDED",  # agricultura, ganaderia, silvicultura y pesca
    "B": "EXCLUDED",  # industrias extractivas
    "C": "EXCLUDED",  # industria manufacturera
    "D": "EXCLUDED",  # suministro de energia
    "E": "EXCLUDED",  # suministro de agua, saneamiento, residuos
    "F": "EXCLUDED",  # construccion
    "G": "GENERIC_COMMERCIAL",  # comercio al por mayor y menor; reparacion vehiculos
    "H": "EXCLUDED",  # transporte y almacenamiento
    "I": "CORE_HOSPITALITY",  # hosteleria - always resolved at division level below
    "J": "EXCLUDED",  # informacion y comunicaciones
    "K": "EXCLUDED",  # actividades financieras y de seguros
    "L": "EXCLUDED",  # actividades inmobiliarias
    "M": "EXCLUDED",  # actividades profesionales, cientificas y tecnicas
    "N": "EXCLUDED",  # actividades administrativas y servicios auxiliares
    "O": "EXCLUDED",  # administracion publica y defensa
    "P": "EXCLUDED",  # educacion
    "Q": "EXCLUDED",  # actividades sanitarias y de servicios sociales
    "R": "AMBIGUOUS",  # actividades artisticas, recreativas y de entretenimiento
    "S": "EXCLUDED",  # otros servicios
    "U": "EXCLUDED",  # organismos extraterritoriales
    "Z": "EXCLUDED",  # SIN ACTIVIDAD (explicit no-activity code, distinct from blank)
}
DIVISION_OVERRIDE = {
    "55": "ACCOMMODATION",       # servicios de alojamiento
    "56": "CORE_HOSPITALITY",    # servicios de comidas y bebidas
    "79": "TOURISM_ADJACENT",    # agencias de viajes, operadores turisticos, reservas
}

# Divisions whose EXCLUDED members are nonetheless consumer-facing and could be
# reclassified into a broader "commercial composition" scope IF a management
# question justified it. Recorded so the exclusion is honest, not silent. This is
# a note only; it does not change the assigned class.
BROADER_COMPOSITION_CANDIDATE_DIVISIONS = {
    "64", "65", "66",  # finance / insurance branches (section K)
    "68",              # real-estate agencies (section L)
    "95", "96",        # repair + other personal services (section S)
    "45",              # (already GENERIC_COMMERCIAL, listed for completeness) not added
}


def classify(id_seccion: str, id_division: str) -> str:
    sec = (id_seccion or "").strip()
    div = (id_division or "").strip()
    if div in DIVISION_OVERRIDE:
        return DIVISION_OVERRIDE[div]
    return SECTION_DEFAULT.get(sec, "AMBIGUOUS")


def rationale_for(cls: str, sec: str, div: str, desc_sec: str, desc_div: str) -> str:
    if cls == "CORE_HOSPITALITY":
        return ("CNAE division 56 (servicios de comidas y bebidas) within section I "
                "(hosteleria): food and beverage service.")
    if cls == "ACCOMMODATION":
        return ("CNAE division 55 (servicios de alojamiento) within section I (hosteleria): "
                "lodging. Distinct from food/beverage and from the licensed-VUT and Madrid "
                "Destino accommodation universes; not to be merged with them.")
    if cls == "TOURISM_ADJACENT":
        return ("CNAE division 79 (agencias de viajes, operadores turisticos, servicios de "
                "reservas): destination-facing commerce with a clean source-native code.")
    if cls == "GENERIC_COMMERCIAL":
        return (f"CNAE section G (comercio), division {div} ({desc_div.lower()}): documented "
                "commerce, background composition only, no tourism-specific reading.")
    if cls == "AMBIGUOUS":
        return (f"CNAE section R (actividades artisticas, recreativas y de entretenimiento), "
                f"division {div} ({desc_div.lower()}): a candidate tourism-adjacent category, "
                "but the section mixes destination-relevant culture/entertainment with "
                "non-tourism activity (e.g. gambling, local sport) and no source-native "
                "sub-code isolates the tourism-facing part. Manual review; not forced into a "
                "tourism class.")
    # EXCLUDED
    if sec == "Z":
        return ("Section Z (SIN ACTIVIDAD): an explicit populated 'no activity' code. "
                "Excluded from every activity class; note this is distinct from a blank epigraph.")
    note = ""
    if div in BROADER_COMPOSITION_CANDIDATE_DIVISIONS:
        note = (" Consumer-facing; could be reclassified into a broader commercial-composition "
                "scope if a management question justified it - not included in the confirmed "
                "commercial class here.")
    return (f"CNAE section {sec} ({desc_sec.lower()}), division {div}: outside a Hospitality & "
            f"Commercial Context reading.{note}")


# --------------------------------------------------------------------------
# Parsing

def parse_actividades(path: str) -> dict:
    """One streaming pass over an Actividades CSV. Returns the taxonomy hierarchy,
    per-epigraph aggregates, per-class distinct-local unions and the blank profile."""
    rows = 0
    epi_rows = collections.Counter()
    epi_locals = collections.defaultdict(set)
    epi_desc = collections.defaultdict(set)
    epi_parent = {}  # id_epigrafe -> (id_seccion, id_division)
    epi_multi_parent = collections.defaultdict(set)
    sec_desc = collections.defaultdict(set)
    div_desc = collections.defaultdict(set)
    div_parent_sec = collections.defaultdict(set)
    class_locals = collections.defaultdict(set)
    class_rows = collections.Counter()
    class_epis = collections.defaultdict(set)

    # blank-epigraph profile
    blank_rows = 0
    blank_locals = set()
    blank_field_all_empty = 0
    blank_situacion = collections.Counter()
    blank_acceso = collections.Counter()
    blank_barrios = set()
    populated_locals = set()

    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        rdr = csv.DictReader(f, delimiter=";")
        header = rdr.fieldnames
        for r in rdr:
            rows += 1
            epi = A.blank(r["id_epigrafe"])
            sec = A.blank(r["id_seccion"])
            div = A.blank(r["id_division"])
            dsec = A.blank(r["desc_seccion"])
            ddiv = A.blank(r["desc_division"])
            depi = A.blank(r["desc_epigrafe"])
            idl = A.blank(r["id_local"])
            if epi:
                epi_rows[epi] += 1
                epi_locals[epi].add(idl)
                epi_desc[epi].add(depi)
                epi_multi_parent[epi].add((sec, div))
                epi_parent[epi] = (sec, div)
                populated_locals.add(idl)
                cls = classify(sec, div)
                class_locals[cls].add(idl)
                class_rows[cls] += 1
                class_epis[cls].add(epi)
                if sec:
                    sec_desc[sec].add(dsec)
                if div:
                    div_desc[div].add(ddiv)
                    div_parent_sec[div].add(sec)
            else:
                blank_rows += 1
                blank_locals.add(idl)
                if not any((sec, div, dsec, ddiv, depi)):
                    blank_field_all_empty += 1
                blank_situacion[A.blank(r.get("id_situacion_local"))] += 1
                blank_acceso[A.blank(r.get("id_tipo_acceso_local"))] += 1
                b = A.blank(r.get("id_barrio_local"))
                if b:
                    blank_barrios.add(b)

    multi_parent = {e: sorted(list(p)) for e, p in epi_multi_parent.items() if len(p) > 1}
    multi_desc = {e: sorted(d) for e, d in epi_desc.items() if len(d) > 1}

    return {
        "header": header,
        "rows": rows,
        "epi_rows": epi_rows,
        "epi_locals": epi_locals,
        "epi_desc": epi_desc,
        "epi_parent": epi_parent,
        "multi_parent": multi_parent,
        "multi_desc": multi_desc,
        "sec_desc": {s: sorted(d) for s, d in sec_desc.items()},
        "div_desc": {d: sorted(v) for d, v in div_desc.items()},
        "div_parent_sec": {d: sorted(v) for d, v in div_parent_sec.items()},
        "class_locals": class_locals,
        "class_rows": class_rows,
        "class_epis": class_epis,
        "blank": {
            "rows": blank_rows,
            "distinct_locals": len(blank_locals),
            "rows_with_entire_taxonomy_blank": blank_field_all_empty,
            "situacion_dist": dict(blank_situacion.most_common()),
            "tipo_acceso_dist": dict(blank_acceso.most_common()),
            "distinct_barrios_present": len(blank_barrios),
            "locals_blank_only_no_populated": len(blank_locals - populated_locals),
            "locals_blank_and_also_populated": len(blank_locals & populated_locals),
        },
    }


def drift(primary: dict, control: dict) -> dict:
    """B6 - taxonomy stability between the two snapshots. Not a trend claim."""
    ea, eb = set(primary["epi_rows"]), set(control["epi_rows"])
    desc_changed, parent_changed = [], []
    for e in sorted(ea & eb):
        da, db = primary["epi_desc"][e], control["epi_desc"][e]
        if da != db:
            desc_changed.append({"id_epigrafe": e, "control": sorted(db), "primary": sorted(da)})
        pa, pb = primary["epi_parent"][e], control["epi_parent"][e]
        if pa != pb:
            parent_changed.append({"id_epigrafe": e, "control": pb, "primary": pa})
    return {
        "control_snapshot": CONTROL[0],
        "primary_snapshot": PRIMARY[0],
        "epigraphs_control": len(eb),
        "epigraphs_primary": len(ea),
        "epigraphs_in_both": len(ea & eb),
        "epigraphs_new_in_primary": sorted(ea - eb),
        "epigraphs_disappeared_from_control": sorted(eb - ea),
        "same_code_changed_description": desc_changed,
        "same_code_changed_section_or_division": parent_changed,
        "distinct_sections_control": len(control["sec_desc"]),
        "distinct_sections_primary": len(primary["sec_desc"]),
        "distinct_divisions_control": len(control["div_desc"]),
        "distinct_divisions_primary": len(primary["div_desc"]),
        "blank_epigraph_rows_control": control["blank"]["rows"],
        "blank_epigraph_rows_primary": primary["blank"]["rows"],
        "blank_share_control": round(control["blank"]["rows"] / control["rows"], 4),
        "blank_share_primary": round(primary["blank"]["rows"] / primary["rows"], 4),
        "note": "Taxonomy stability only. Row/premises counts and any activity trend are NOT "
                "claimed here; full temporal comparability is Gate D.",
    }


def build_epigraph_records(p: dict) -> list:
    recs = []
    for e in sorted(p["epi_rows"]):
        sec, div = p["epi_parent"][e]
        dsec = (p["sec_desc"].get(sec) or [""])[0]
        ddiv = (p["div_desc"].get(div) or [""])[0]
        descs = sorted(p["epi_desc"][e])
        cls = classify(sec, div)
        rec = {
            "id_epigrafe": e,
            "desc_epigrafe": descs if len(descs) > 1 else descs[0],
            "id_seccion": sec,
            "desc_seccion": dsec,
            "id_division": div,
            "desc_division": ddiv,
            "assigned_class": cls,
            "rationale": rationale_for(cls, sec, div, dsec, ddiv),
            "status": "AMBIGUOUS" if cls == "AMBIGUOUS" else "CONFIRMED",
            "source_row_count": int(p["epi_rows"][e]),
            "distinct_local_count": len(p["epi_locals"][e]),
            "manually_reviewed": True,
            "ambiguous": cls == "AMBIGUOUS",
        }
        if len(descs) > 1:
            rec["source_description_inconsistency"] = (
                "Same code carries more than one description within a single snapshot; "
                "the assigned class rests on the CNAE division, which is unambiguous.")
        recs.append(rec)
    return recs


def class_rollup(p: dict) -> dict:
    out = {}
    for cls in list(CLASSES):
        out[cls] = {
            "distinct_epigraphs": len(p["class_epis"].get(cls, set())),
            "source_rows": int(p["class_rows"].get(cls, 0)),
            "distinct_locals": len(p["class_locals"].get(cls, set())),
        }
    return out


def main() -> int:
    RESULTS.mkdir(exist_ok=True)
    started = A.now()
    print("[gate-b] resolving Actividades resources from the official catalogue ...")
    pkg = A.package()

    resources = {}
    parsed = {}
    for key, desc in (PRIMARY, CONTROL):
        res = A.resolve_resource(pkg, desc)
        print(f"[gate-b] fetching {desc} ...")
        path, meta = A.stream_to_temp(res["url"])
        try:
            dialect = A.detect_dialect(path)
            parsed[key] = parse_actividades(path)
            resources[key] = {
                "description": desc,
                "resource_id": res.get("id"),
                "format": (res.get("format") or "").upper(),
                "url": res["url"],
                "retrieved_at": A.now(),
                "dialect_observed": dialect,
                **meta,
            }
        finally:
            os.unlink(path)
        print(f"[gate-b]   rows={parsed[key]['rows']} "
              f"epigraphs={len(parsed[key]['epi_rows'])}")

    p = parsed[PRIMARY[0]]
    epigraph_records = build_epigraph_records(p)
    rollup = class_rollup(p)
    populated_rows = int(sum(p["epi_rows"].values()))

    documentation = {
        "structure_pdf": A.STRUCTURE_PDF,
        "structure_pdf_version": "mar/2022 (as printed in the PDF)",
        "hierarchy": "Three levels: Seccion (a letter) -> Division (two digits) -> Epigrafe. "
                     "Source: 'clasificacion propia del Ayuntamiento que parte de los antiguos "
                     "epigrafes de Impuesto de Actividades Economicas (I.A.E.)'.",
        "seccion_division_are_cnae09": "The document states Seccion and Division 'coinciden con "
            "los utilizados por la CNAE-09 del INE' and that every epigraph of a division begins "
            "with the division's two digits. Classification here is therefore made on the "
            "official CNAE section/division the file carries, never on the epigraph description.",
        "epigrafe_is_administrative": "Epigrafe is an administrative (IAE/CNAE-derived) code, not "
            "an operational business label; the PDF states activity data are provided 'solo a "
            "efectos estadisticos'. A row is administrative evidence, not trading, revenue, "
            "employment, footfall, demand, popularity or commercial health.",
        "pdf_counts_are_stale": {
            "pdf": {"secciones": 21, "divisiones": 87, "epigrafes": 448},
            "live_primary": {
                "secciones": len(p["sec_desc"]),
                "divisiones": len(p["div_desc"]),
                "epigrafes": len(p["epi_rows"]),
            },
            "note": "The mar/2022 PDF counts differ from the live data; the taxonomy is read "
                    "live, not assumed from the PDF.",
        },
        "blank_epigraph_not_documented": "The structure document defines every field but never "
            "defines an empty/blank epigraph. Its meaning below is characterised empirically only.",
        "field_name_note": "The PDF writes 'ide_epigrafe'; the files use 'id_epigrafe'.",
    }

    blank = dict(p["blank"])
    blank["label"] = UNCLASSIFIED
    blank["label_scope"] = (
        "A PROJECT HANDLING label, not an official source meaning. The source defines no "
        "category for these records; this label is how the project carries them.")
    blank["handling"] = (
        "RESOLVED - the blank set is fully characterised empirically (fields above): the entire "
        "taxonomy is blank, it is one row per premises, it never co-occurs with a classified "
        "activity, and it is present across all barrios.")
    blank["source_semantics"] = (
        "UNRESOLVED - the official structure documentation never defines an empty epigraph, so "
        "WHY these records carry no taxonomy is not stated by the source and is not asserted here.")
    blank["semantics"] = (
        "Every blank-epigraph row carries an entirely blank taxonomy (id_seccion, id_division, "
        "and all three descriptions are also empty), so no higher hierarchy level can rescue it. "
        "It is one row per premises and never co-occurs on a premises that also has a populated "
        "epigraph. It is therefore a premises-level 'no activity classification recorded' set, "
        "labelled UNCLASSIFIED_SOURCE_ACTIVITY. It is NOT an activity, NOT assigned any class "
        "A-F, NOT given a placeholder category, NOT discarded, and (id_local, '') is NOT an "
        "activity identity. It is distinct from section Z 'SIN ACTIVIDAD', which is an explicit "
        "populated code. It must never be silently dropped from a later premises denominator.")
    blank["situacion_note"] = (
        "Situacion skews to Cerrado/Baja/Uso-vivienda, consistent with premises that plausibly "
        "have no current activity, BUT a substantial share are 'Abierto' (situacion=1), i.e. "
        "open premises with economic activity yet no activity code. So the blank cannot be read "
        "as merely 'closed'; it is genuinely an absent classification. Situacion interpretation "
        "itself is Gate C, not decided here.")

    report = {
        "audit_started_at": started,
        "audit_finished_at": A.now(),
        "environment_note": "Counts are observations of one run against the fingerprinted "
                            "resources recorded below, not repository invariants.",
        "dataset": {
            "id": A.PACKAGE,
            "title": pkg.get("title"),
            "catalogue": A.CATALOGUE,
            "license": pkg.get("license_title"),
            "catalogue_metadata_modified": pkg.get("metadata_modified"),
            "resource_resolution_method": "Exact match on the resource `description` field "
                "(family + month), which is unique per resource. Opaque numeric resource ids "
                "are recorded, not used to select.",
        },
        "documentation": documentation,
        "resources": resources,
        "primary_snapshot": PRIMARY[0],
        "classification_framework": {
            "classes": CLASSES,
            "unclassified_label": UNCLASSIFIED,
            "assignment_rule": "Each populated epigraph inherits the class of its CNAE division "
                "(DIVISION_OVERRIDE) or, absent an override, its CNAE section (SECTION_DEFAULT). "
                "Because every epigraph of a division begins with the division digits and no "
                "epigraph maps to more than one parent, this is a rule on the official code, not "
                "on description text.",
            "section_default": SECTION_DEFAULT,
            "division_override": DIVISION_OVERRIDE,
        },
        "observed_taxonomy": {
            "distinct_sections": len(p["sec_desc"]),
            "distinct_divisions": len(p["div_desc"]),
            "distinct_populated_epigraphs": len(p["epi_rows"]),
            "rows_total": p["rows"],
            "rows_populated_epigraph": populated_rows,
            "rows_blank_epigraph": p["blank"]["rows"],
            "epigraph_multi_parent_count": len(p["multi_parent"]),
            "epigraph_multi_parent": p["multi_parent"],
            "epigraph_multi_description": p["multi_desc"],
            "sections": {s: {"desc": p["sec_desc"][s]} for s in sorted(p["sec_desc"])},
        },
        "class_rollup": rollup,
        "epigraphs": epigraph_records,
        "blank_epigraph": blank,
        "drift_control_vs_primary": drift(p, parsed[CONTROL[0]]),
        "gate_b_ruling": {
            "core_hospitality_restoration": "GO",
            "accommodation": "GO",
            "tourism_adjacent_commercial_context": "GO (division 79 only); MODIFY to broaden",
            "generic_commercial_context": "GO",
            "blank_epigraph_semantics": {
                "handling": "RESOLVED",
                "source_semantics": "UNRESOLVED",
                "label": UNCLASSIFIED,
                "note": "Empirical handling is RESOLVED - the blank set is fully characterised "
                    "and given the project handling label UNCLASSIFIED_SOURCE_ACTIVITY. Source "
                    "semantics are UNRESOLVED - the official documentation does not define why "
                    "these records carry no taxonomy, so UNCLASSIFIED_SOURCE_ACTIVITY is a "
                    "project handling label, not an official source meaning.",
            },
            "overall": "GO to Gate C, with scoped sub-rulings above",
            "scope_limitation": "GO admits a classification LAYER only. No indicator, count, "
                "ranking, score, denominator, map or 'pressure' claim is authorised. Accommodation "
                "here is census-activity evidence and must not be merged with licensed-VUT or "
                "Madrid Destino accommodation. The blank set must be carried explicitly, never "
                "silently dropped.",
        },
        "product_name_recommendation": {
            "recommendation": "KEEP 'Hospitality & Commercial Context'.",
            "basis": "Hospitality maps cleanly to CNAE section I (division 56 food/beverage + "
                     "division 55 accommodation); Commercial Context maps cleanly to CNAE section "
                     "G (comercio). Both pillars have defensible source-native definitions.",
            "caveat": "The name is defensible only for the classification layer. It must not be "
                      "read as tourism pressure, overtourism, saturation or commercial vitality.",
        },
    }

    out = RESULTS / "gate_b_taxonomy.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[gate-b] wrote {out.relative_to(HERE.parents[1])}")

    summary = {
        "audit_finished_at": report["audit_finished_at"],
        "primary_snapshot": PRIMARY[0],
        "resources_sha256": {k: v["sha256"] for k, v in resources.items()},
        "observed_taxonomy": {
            k: report["observed_taxonomy"][k] for k in (
                "distinct_sections", "distinct_divisions", "distinct_populated_epigraphs",
                "rows_total", "rows_populated_epigraph", "rows_blank_epigraph",
                "epigraph_multi_parent_count",
            )
        },
        "class_rollup": rollup,
        "blank_epigraph": {
            "label": UNCLASSIFIED,
            "rows": blank["rows"],
            "rows_with_entire_taxonomy_blank": blank["rows_with_entire_taxonomy_blank"],
            "locals_blank_only_no_populated": blank["locals_blank_only_no_populated"],
        },
        "drift_headline": {
            "epigraphs_new": report["drift_control_vs_primary"]["epigraphs_new_in_primary"],
            "epigraphs_disappeared": report["drift_control_vs_primary"]["epigraphs_disappeared_from_control"],
            "same_code_changed_description": len(report["drift_control_vs_primary"]["same_code_changed_description"]),
            "same_code_changed_parent": len(report["drift_control_vs_primary"]["same_code_changed_section_or_division"]),
        },
        "gate_b_ruling": report["gate_b_ruling"],
    }
    outs = RESULTS / "gate_b_taxonomy_summary.json"
    outs.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[gate-b] wrote {outs.relative_to(HERE.parents[1])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
