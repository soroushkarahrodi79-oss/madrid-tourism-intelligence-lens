#!/usr/bin/env python3
"""Gate C status-semantics audit for the Madrid historical premises/activity census.

Run on demand against the LIVE official source. It is not part of the test suite
and nothing in the application imports it. It answers one question only - what the
administrative STATUS fields can and cannot legitimately say - for the Ayuntamiento
de Madrid dataset

    Censo de locales, sus actividades y terrazas de hosteleria y restauracion -
    historico   (datos.madrid.es  209548-0-censo-locales-historico)

using September 2026 as the primary snapshot (Locales + Actividades) and September
2025 Locales as a status-stability control.

    python research/hospitality_commercial_gate/audit_status.py

It reuses the Gate A helpers (resource resolution by exact description, streamed
fingerprinting, per-file dialect detection) from `audit_identity.py` and the Gate B
classification (classify / CLASSES / SECTION_DEFAULT / DIVISION_OVERRIDE) from
`audit_taxonomy.py` in this same directory, so the source contract and the activity
taxonomy are identical to the earlier gates. It writes two compact JSON reports next
to this file, in results/. Raw upstream CSVs (each ~89-125 MB) are streamed to a
temporary file, fingerprinted, parsed and deleted. They are never committed. Every
count in the reports is an observation of one run against the fingerprinted
resources it records, not a repository invariant.

WHAT THIS DOES AND DOES NOT DO
------------------------------
It enumerates the observed situacion and tipo-acceso universes, records what the
official structure document actually SAYS each value means (kept strictly separate
from what is empirically observed and from the project's handling decision),
cross-tabulates status against the Gate B taxonomy-record state, computes the impact
of the source's OWN explicit counting-exclusion rules (situacion 8/9 and access 12),
and measures status mutability between two snapshots. It builds NO indicator, score,
ranking, denominator, map, "operating business" count or economic reading. A status
field is administrative evidence, nothing more.

Dependencies: Python standard library only.
"""

from __future__ import annotations

import collections
import csv
import json
import os
import sys
from pathlib import Path

# Reuse the Gate A source contract and the Gate B classification verbatim.
# Importing rather than duplicating keeps all three gates provably reading the
# same source the same way and classifying activities identically.
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import audit_identity as A  # noqa: E402
import audit_taxonomy as B  # noqa: E402

RESULTS = HERE / "results"
csv.field_size_limit(1 << 24)

# Primary snapshot (status lives on Locales; taxonomy on Actividades) plus a Sep
# 2025 Locales control for status mutability. Gate C deliberately does NOT download
# the full history - that is Gate D.
LOC_PRIMARY = ("locales_2026_09", "Locales. Septiembre 2026")
ACT_PRIMARY = ("actividades_2026_09", "Actividades. Septiembre 2026")
LOC_CONTROL = ("locales_2025_09", "Locales. Septiembre 2025")

# The source's OWN explicit exclusion rules, verified against the structure document
# (estructura_ds_ficherocla.pdf, versiones mar/2022), apartados II and III:
#   - "Los locales en situacion 8 y 9, no deben tenerse en cuenta a la hora de
#      extraer datos de numero total de locales."  (situacion Baja / Baja R)
#   - Puerta de Calle Asociado (acceso 12): "No se trata de un local fisico ...
#      No deben tenerse en cuenta a la hora de extraer datos del numero total de
#      locales."
# These three codes are the ONLY codes the document instructs to exclude. Cerrado,
# Uso vivienda and Obras carry NO exclusion instruction and are NOT excluded here.
EXCL_SITUACION_CODES = {"8", "9"}
EXCL_ACCESO_CODES = {"12"}

# What the official structure document states for each situacion value (apartado III
# and the Situacion code table). Verbatim source semantics - NOT a project reading.
# Kept as its own field so it can never be confused with the empirical observation
# or the project handling decision.
SITUACION_SOURCE_SEMANTICS = {
    "1": "Abierto - 'Local activo en el que se desarrolla algun tipo de actividad "
         "economica' (apartado III); code table: 'Local activo'.",
    "4": "Cerrado - 'Local en el que en ese momento no se realiza ningun tipo de "
         "actividad' (apartado III); code table: 'Local cerrado (sin actividad)'.",
    "5": "Uso vivienda - 'Los locales puerta de calle que se han transformado en "
         "vivienda y se utilizan, exclusivamente, como vivienda familiar' (apartado "
         "III); code table: 'Local destinado a vivienda'.",
    "7": "Obras - 'Locales en los que se esta realizando una reforma' (apartado III); "
         "code table: 'Local en obras'.",
    "8": "Baja - code table: 'Local que ha desaparecido'. Apartado III groups 8 and 9 "
         "as 'Baja o baja por reunificacion: Locales desaparecidos'.",
    "9": "Baja R - code table: 'Local que ha desaparecido uniendose a otro'. Apartado "
         "III groups 8 and 9 as 'Baja o baja por reunificacion: Locales desaparecidos'.",
}
SITUACION_COUNTING_INSTRUCTION = {
    "1": "None. The source gives no exclusion instruction for Abierto.",
    "4": "None. The source gives no exclusion instruction for Cerrado.",
    "5": "None. The source gives no exclusion instruction for Uso vivienda.",
    "7": "None. The source gives no exclusion instruction for Obras.",
    "8": "EXCLUDE from total-premises counts: 'Los locales en situacion 8 y 9, no "
         "deben tenerse en cuenta a la hora de extraer datos de numero total de locales.'",
    "9": "EXCLUDE from total-premises counts: 'Los locales en situacion 8 y 9, no "
         "deben tenerse en cuenta a la hora de extraer datos de numero total de locales.'",
}
# Project interpretation CEILING per situacion - what the evidence can NOT be made to
# claim on its own. A project handling note, explicitly not official source metadata.
SITUACION_INTERPRETATION_CEILING = {
    "1": "Administrative LAST-RECORDED status 'active'. NOT verified current trading: "
         "the source warns situacion is a 'variable de mantenimiento complicado' with "
         "'no ... procedimiento que informe de cuando una actividad cesa y el local se "
         "cierra sin aparecer una nueva actividad', and extraction shows 'la ultima "
         "situacion'. So Abierto may be stale. It is NOT revenue, demand, footfall, "
         "commercial success or proof a business operates today.",
    "4": "Project interpretation ceiling (the verbatim source meaning - 'Local en el que "
         "en ese momento no se realiza ningun tipo de actividad' - is kept separate in "
         "source_semantics): because situacion is a last-recorded, difficult-to-maintain "
         "administrative variable, Cerrado is NOT independently verified current closure, "
         "NOT permanent cessation, NOT business failure, NOT economic decline. No closure "
         "date is published and it is distinct from Baja (desaparecido).",
    "5": "Administrative 'premises converted to dwelling'. Describes recorded use, not "
         "an economic-cessation date or a business outcome.",
    "7": "Administrative 'undergoing building works'. Not a business-activity claim.",
    "8": "Administrative 'premises has disappeared'. Explicitly excluded from total-"
         "premises counts. 'Desaparecido' is an administrative register event, NOT a "
         "measured business failure or economic outcome.",
    "9": "Administrative 'premises has disappeared by merging into another'. Explicitly "
         "excluded from total-premises counts. A register reorganisation event, NOT a "
         "measured business failure.",
}

ACCESO_SOURCE_SEMANTICS = {
    "0": "Agrupado - 'Local perteneciente a una agrupacion de locales' (code table); "
         "apartado II: belongs to an agrupacion (markets, shopping centres ...).",
    "1": "Puerta calle - 'Local con acceso directo desde la calle' (code table); "
         "apartado II: 'Local con acceso directo desde la via publica'.",
    "3": "Interior - UNDOCUMENTED. This code and literal do not appear in the mar/2022 "
         "structure document, whose Tipo-acceso table lists only 0, 1 and 12 and whose "
         "extraction note says only Agrupado / Puerta de Calle / Puerta de Calle "
         "asociado premises were selected. Source meaning UNRESOLVED.",
    "12": "PC Asociado - 'No es un local fisico, va asociado a un local Puerta de Calle, "
          "permite diferenciar actividades, explotadas por diferente titular, dentro "
          "del local puerta de Calle' (code table); apartado II repeats 'No se trata de "
          "un local fisico'.",
}
ACCESO_COUNTING_INSTRUCTION = {
    "0": "None. The source gives no exclusion instruction for Agrupado.",
    "1": "None. The source gives no exclusion instruction for Puerta calle.",
    "3": "UNRESOLVED - the code is undocumented, so the source states no instruction "
         "for it. It is NOT named in any exclusion rule, so the explicit rules neither "
         "include nor exclude it by name.",
    "12": "EXCLUDE from total-premises counts: 'No deben tenerse en cuenta a la hora de "
          "extraer datos del numero total de locales' (apartado II), because it 'No se "
          "trata de un local fisico'.",
}
ACCESO_INTERPRETATION_CEILING = {
    "0": "Administrative access type (belongs to an agrupacion). Not a status claim.",
    "1": "Administrative access type (direct street access). Not a status claim.",
    "3": "UNDOCUMENTED access category. Its meaning cannot be asserted from the source. "
         "It is not named in any exclusion rule and so is left in the counted universe "
         "by the explicit rules, but any future count must flag it as undocumented.",
    "12": "A non-physical sub-access used to separate activities of different owners "
          "inside one physical premises. It is a double-representation / subordinate "
          "access, excluded because it is not a premises - NOT a status or economic "
          "signal.",
}


def pct(n: int, d: int) -> float:
    return round(100.0 * n / d, 4) if d else 0.0


# --------------------------------------------------------------------------
# Parsing

def parse_locales(path: str) -> dict:
    """One streaming pass over a Locales CSV. Returns the status/access universes and
    a per-premises status+access map (one row = one premises)."""
    rows = 0
    sit_rows = collections.Counter()
    sit_desc = {}
    acc_rows = collections.Counter()
    acc_desc = {}
    status = {}  # id_local -> (situacion_code, acceso_code)
    sit_sets = collections.defaultdict(set)   # code -> set(id_local)
    acc_sets = collections.defaultdict(set)   # code -> set(id_local)
    blank_id = 0
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        rdr = csv.DictReader(f, delimiter=";")
        header = rdr.fieldnames
        for r in rdr:
            rows += 1
            idl = A.blank(r["id_local"])
            sc = A.blank(r["id_situacion_local"])
            ac = A.blank(r["id_tipo_acceso_local"])
            sit_rows[sc] += 1
            sit_desc.setdefault(sc, A.blank(r["desc_situacion_local"]))
            acc_rows[ac] += 1
            acc_desc.setdefault(ac, A.blank(r["desc_tipo_acceso_local"]))
            if not idl:
                blank_id += 1
                continue
            status[idl] = (sc, ac)
            sit_sets[sc].add(idl)
            acc_sets[ac].add(idl)
    return {
        "header": header,
        "rows": rows,
        "blank_id_local": blank_id,
        "sit_rows": sit_rows,
        "sit_desc": sit_desc,
        "acc_rows": acc_rows,
        "acc_desc": acc_desc,
        "status": status,
        "sit_sets": sit_sets,
        "acc_sets": acc_sets,
    }


def parse_actividades_taxonomy_state(path: str) -> dict:
    """One streaming pass over an Actividades CSV. Returns, per premises, its Gate B
    class membership and its taxonomy-record state (classified / SIN ACTIVIDAD / blank).

    Taxonomy-record state is a per-PREMISES label, derived from its activity rows:
      - CLASSIFIED        : has >=1 populated, non-Z (not SIN ACTIVIDAD) epigraph
      - SIN_ACTIVIDAD     : has >=1 populated section-Z (SIN ACTIVIDAD) epigraph
      - BLANK             : has >=1 blank-epigraph row (UNCLASSIFIED_SOURCE_ACTIVITY)
    A premises may in principle carry more than one of these; the combination is
    recorded rather than collapsed, so nothing is hidden."""
    rows = 0
    prem_classes = collections.defaultdict(set)   # id_local -> set(Gate B class)
    prem_has_classified = set()
    prem_has_sin_actividad = set()
    prem_has_blank = set()
    all_prem = set()
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        rdr = csv.DictReader(f, delimiter=";")
        header = rdr.fieldnames
        for r in rdr:
            rows += 1
            idl = A.blank(r["id_local"])
            epi = A.blank(r["id_epigrafe"])
            sec = A.blank(r["id_seccion"])
            div = A.blank(r["id_division"])
            all_prem.add(idl)
            if not epi:
                prem_has_blank.add(idl)
                continue
            cls = B.classify(sec, div)
            prem_classes[idl].add(cls)
            if sec == "Z":
                prem_has_sin_actividad.add(idl)
            else:
                prem_has_classified.add(idl)
    return {
        "header": header,
        "rows": rows,
        "prem_classes": prem_classes,
        "prem_has_classified": prem_has_classified,
        "prem_has_sin_actividad": prem_has_sin_actividad,
        "prem_has_blank": prem_has_blank,
        "all_prem": all_prem,
    }


def tax_state(idl: str, act: dict) -> str:
    """Mutually-exclusive per-premises taxonomy-record state, with combinations kept
    explicit so a premises is never silently forced into one bucket."""
    c = idl in act["prem_has_classified"]
    z = idl in act["prem_has_sin_actividad"]
    b = idl in act["prem_has_blank"]
    present = idl in act["all_prem"]
    if not present:
        return "NO_ACTIVITY_ROW"
    flags = (c, z, b)
    return {
        (True, False, False): "CLASSIFIED_ONLY",
        (False, True, False): "SIN_ACTIVIDAD_ONLY",
        (False, False, True): "BLANK_ONLY",
        (True, True, False): "CLASSIFIED_AND_SIN_ACTIVIDAD",
        (True, False, True): "CLASSIFIED_AND_BLANK",
        (False, True, True): "SIN_ACTIVIDAD_AND_BLANK",
        (True, True, True): "CLASSIFIED_SIN_ACTIVIDAD_AND_BLANK",
        (False, False, False): "NO_ACTIVITY_ROW",
    }[flags]


# --------------------------------------------------------------------------
# Analyses

def status_universe(loc: dict) -> dict:
    total = loc["rows"]
    situaciones = {}
    for code, n in sorted(loc["sit_rows"].items()):
        situaciones[code] = {
            "code": code,
            "official_description": loc["sit_desc"].get(code, ""),
            "source_semantics": SITUACION_SOURCE_SEMANTICS.get(
                code, "UNDOCUMENTED - not in the mar/2022 structure document."),
            "official_counting_instruction": SITUACION_COUNTING_INSTRUCTION.get(
                code, "UNRESOLVED - undocumented code, no instruction stated."),
            "maintenance_caveat": (
                "Situacion is 'una variable de mantenimiento complicado'; there is no "
                "procedure that records when an activity ceases and the premises closes "
                "without a new activity appearing, and extraction shows 'la ultima "
                "situacion'. Applies to every situacion value."),
            "empirical_observation": {
                "rows": n, "distinct_id_local": len(loc["sit_sets"].get(code, set())),
                "share_pct": pct(n, total),
            },
            "interpretation_ceiling": SITUACION_INTERPRETATION_CEILING.get(
                code, "UNRESOLVED - undocumented code."),
            "undocumented_code": code not in SITUACION_SOURCE_SEMANTICS,
        }
    accesos = {}
    for code, n in sorted(loc["acc_rows"].items()):
        accesos[code] = {
            "code": code,
            "official_description": loc["acc_desc"].get(code, ""),
            "source_semantics": ACCESO_SOURCE_SEMANTICS.get(
                code, "UNDOCUMENTED - not in the mar/2022 structure document."),
            "official_counting_instruction": ACCESO_COUNTING_INSTRUCTION.get(
                code, "UNRESOLVED - undocumented code, no instruction stated."),
            "empirical_observation": {
                "rows": n, "distinct_id_local": len(loc["acc_sets"].get(code, set())),
                "share_pct": pct(n, total),
            },
            "interpretation_ceiling": ACCESO_INTERPRETATION_CEILING.get(
                code, "UNRESOLVED - undocumented code."),
            "undocumented_code": code not in {"0", "1", "12"},
        }
    documented_not_observed = sorted(
        set(SITUACION_SOURCE_SEMANTICS) - set(loc["sit_rows"]))
    return {
        "premises_rows_total": total,
        "blank_id_local": loc["blank_id_local"],
        "situacion": situaciones,
        "tipo_acceso": accesos,
        "documented_situacion_codes_not_observed": documented_not_observed,
        "documented_situacion_codes_not_observed_note": (
            "Code 7 (Obras) is documented in the structure PDF but is absent from this "
            "live snapshot. Documented != present; it is reported, not invented."
            if documented_not_observed else "All documented situacion codes are present."),
        "undocumented_acceso_codes_observed": sorted(
            c for c in loc["acc_rows"] if c not in {"0", "1", "12"}),
    }


def cross_tab(loc: dict, act: dict) -> dict:
    """C3 - status x taxonomy-record state, at the premises level (status is one row
    per premises; taxonomy state is derived per premises). Answers the five C3
    questions from the actual join, not from assumption."""
    tab = collections.Counter()
    tax_state_totals = collections.Counter()
    for idl, (sc, _ac) in loc["status"].items():
        ts = tax_state(idl, act)
        tab[(sc, ts)] += 1
        tax_state_totals[ts] += 1
    # premises present in Locales but with no Actividades row at all
    missing_act = sum(1 for idl in loc["status"] if idl not in act["all_prem"])
    matrix = {}
    for (sc, ts), n in sorted(tab.items()):
        matrix.setdefault(sc, {})[ts] = n

    def by_state(state):
        return {sc: matrix.get(sc, {}).get(state, 0) for sc in sorted(matrix)}

    abierto_blank = tab.get(("1", "BLANK_ONLY"), 0)
    cerrado_classified = tab.get(("4", "CLASSIFIED_ONLY"), 0)
    baja_classified = (tab.get(("8", "CLASSIFIED_ONLY"), 0)
                       + tab.get(("9", "CLASSIFIED_ONLY"), 0))
    # section Z (SIN ACTIVIDAD) across statuses
    sin_actividad_by_status = by_state("SIN_ACTIVIDAD_ONLY")
    # does status determine taxonomy state? it determines it only if each status maps
    # to exactly one taxonomy state. Count distinct taxonomy states per status.
    states_per_status = {sc: sorted(sts) for sc, sts in matrix.items()}
    status_determines_state = all(len(v) == 1 for v in states_per_status.values())
    return {
        "unit_note": "Rows are PREMISES (id_local), counted once each: status is one row "
                     "per premises in Locales; taxonomy-record state is derived from that "
                     "premises' Actividades rows. No premises is double-counted.",
        "premises_with_no_actividades_row": missing_act,
        "taxonomy_state_totals": dict(tax_state_totals.most_common()),
        "matrix_situacion_x_taxonomy_state": matrix,
        "answers": {
            "abierto_can_coexist_with_blank_taxonomy": {
                "answer": abierto_blank > 0,
                "count_abierto_blank_only": abierto_blank,
                "note": "Abierto premises that carry only an UNCLASSIFIED_SOURCE_ACTIVITY "
                        "(blank) taxonomy. If > 0, open status and absent classification "
                        "co-occur - the two dimensions are independent.",
            },
            "cerrado_can_retain_populated_activity_codes": {
                "answer": cerrado_classified > 0,
                "count_cerrado_classified_only": cerrado_classified,
            },
            "baja_can_retain_populated_activity_codes": {
                "answer": baja_classified > 0,
                "count_baja_classified_only": baja_classified,
            },
            "section_Z_sin_actividad_coexists_with_multiple_statuses": {
                "answer": sum(1 for v in sin_actividad_by_status.values() if v > 0) > 1,
                "distribution_by_situacion": sin_actividad_by_status,
            },
            "administrative_status_determines_taxonomy_state": {
                "answer": status_determines_state,
                "taxonomy_states_seen_per_situacion": states_per_status,
                "conclusion": ("Status does NOT determine taxonomy state: each status "
                               "co-occurs with several taxonomy states, so status and "
                               "activity classification are SEPARATE dimensions and must "
                               "not be collapsed."
                               if not status_determines_state else
                               "Each status maps to exactly one taxonomy state in this "
                               "snapshot."),
            },
        },
    }


def status_by_class(loc: dict, act: dict) -> dict:
    """C4 - per Gate B class, the status/access composition over the DISTINCT premises
    in that class. A premises may belong to several classes (it is counted once per
    class it is in); it is never counted twice WITHIN a class."""
    out = {}
    # build class -> set(premises) from the taxonomy pass
    class_premises = collections.defaultdict(set)
    for idl, classes in act["prem_classes"].items():
        for c in classes:
            class_premises[c].add(idl)
    for cls in list(B.CLASSES):
        prem = class_premises.get(cls, set())
        sit = collections.Counter()
        acc = collections.Counter()
        for idl in prem:
            st = loc["status"].get(idl)
            if st is None:
                continue
            sit[st[0]] += 1
            acc[st[1]] += 1
        total = len(prem)
        out[cls] = {
            "distinct_premises": total,
            "situacion_distribution": {
                c: {"premises": n, "share_pct": pct(n, total)}
                for c, n in sorted(sit.items())},
            "tipo_acceso_distribution": {
                c: {"premises": n, "share_pct": pct(n, total)}
                for c, n in sorted(acc.items())},
            "source_excluded_premises": sum(
                1 for idl in prem
                if (loc["status"].get(idl, ("", ""))[0] in EXCL_SITUACION_CODES
                    or loc["status"].get(idl, ("", ""))[1] in EXCL_ACCESO_CODES)),
        }
    out["_note"] = ("Distinct-premises counts do NOT sum across classes - a premises "
                    "may host activities in more than one class. The purpose is to test "
                    "whether any class has a materially different status composition, "
                    "NOT to rank sectors.")
    return out


def official_exclusions(loc: dict) -> dict:
    """C5 - impact of the source's OWN explicit exclusion rules, with overlaps handled
    so PC Asociado is never double-subtracted."""
    total = loc["rows"]
    sit8 = loc["sit_sets"].get("8", set())
    sit9 = loc["sit_sets"].get("9", set())
    acc12 = loc["acc_sets"].get("12", set())
    union = sit8 | sit9 | acc12
    return {
        "raw_premises_universe": total,
        "rules_verified_against_source": [
            "situacion 8 (Baja): 'Los locales en situacion 8 y 9, no deben tenerse en "
            "cuenta a la hora de extraer datos de numero total de locales.' (apartado III)",
            "situacion 9 (Baja R): same instruction, grouped with 8.",
            "acceso 12 (PC Asociado): 'No deben tenerse en cuenta a la hora de extraer "
            "datos del numero total de locales' because 'No se trata de un local fisico' "
            "(apartado II).",
        ],
        "rule_scope": {
            "applies_to": "Locales rows (premises). The instruction is about 'numero "
                          "total de locales' (count of premises), not about Actividades "
                          "activity rows.",
            "unconditional": True,
            "codes_covered": {"situacion": sorted(EXCL_SITUACION_CODES),
                              "tipo_acceso": sorted(EXCL_ACCESO_CODES)},
            "codes_NOT_covered": "Cerrado (4), Uso vivienda (5) and Obras (7) carry NO "
                                 "exclusion instruction and are NOT excluded.",
        },
        "excluded_by_each_rule": {
            "situacion_8_baja": len(sit8),
            "situacion_9_baja_r": len(sit9),
            "acceso_12_pc_asociado": len(acc12),
        },
        "overlaps": {
            "sit8_and_sit9": len(sit8 & sit9),
            "sit8_and_acceso12": len(sit8 & acc12),
            "sit9_and_acceso12": len(sit9 & acc12),
            "sit8_and_sit9_and_acceso12": len(sit8 & sit9 & acc12),
            "note": "situacion 8 and 9 are mutually exclusive (one situacion per "
                    "premises), so sit8 & sit9 is 0 by construction. The meaningful "
                    "overlap is PC Asociado premises that are also Baja/Baja R - these "
                    "must be counted once, not subtracted twice.",
        },
        "sum_if_naively_added": len(sit8) + len(sit9) + len(acc12),
        "union_excluded": len(union),
        "double_subtraction_avoided": (len(sit8) + len(sit9) + len(acc12)) - len(union),
        "remaining_after_official_exclusions": total - len(union),
        "audit_note": "This is an AUDIT calculation of the source's explicit exclusion "
                      "rules. It does NOT authorise a production denominator or indicator. "
                      "Gate F remains the denominator gate. The excluded records remain "
                      "valid historical evidence; exclusion is from a current total-count "
                      "universe only, not from the research record.",
    }


def candidate_states(excl: dict, loc: dict) -> dict:
    """C6 - evidence-honest candidate counting states. Project handling labels, each
    explicitly distinguished from source terminology."""
    sit1 = len(loc["sit_sets"].get("1", set()))
    return {
        "_note": "These are PROJECT handling labels, NOT official source categories. "
                 "They name counting universes; none asserts that a premises trades today.",
        "SOURCE_INCLUDED_PREMISES": {
            "rule": "All premises MINUS the union of situacion in {8,9} and acceso == 12.",
            "source_basis": "Directly from the source's explicit 'no deben tenerse en "
                            "cuenta' instructions (apartados II, III).",
            "count": excl["remaining_after_official_exclusions"],
            "interpretation_ceiling": "The set of administrative premises records the "
                "source itself does not exclude from a total count. NOT a trading-business "
                "count, NOT economic activity.",
            "usable_in_later_gates": True,
        },
        "SOURCE_EXCLUDED_PREMISES": {
            "rule": "Union of situacion in {8,9} and acceso == 12.",
            "source_basis": "The source's explicit exclusion instructions.",
            "count": excl["union_excluded"],
            "interpretation_ceiling": "Administratively disappeared premises (Baja/Baja R) "
                "and non-physical sub-accesses (PC Asociado). Kept in the research record; "
                "excluded only from a current total-count universe.",
            "usable_in_later_gates": True,
        },
        "ADMINISTRATIVELY_OPEN": {
            "rule": "situacion == 1 (Abierto).",
            "source_basis": "Situacion code 1 only. Explicitly NOT an operating-business "
                            "proxy - see the maintenance caveat and interpretation ceiling.",
            "count": sit1,
            "interpretation_ceiling": "Last-recorded administrative status is 'active'. "
                "CANNOT be read as 'currently operating business', trading, demand or "
                "commercial success. The source warns the value may be stale.",
            "usable_in_later_gates": "MODIFY - usable only as an administrative-status "
                "descriptor, never as a current-operation count, and not without the "
                "maintenance caveat travelling with it.",
        },
        "STATUS_UNCERTAIN": {
            "rule": "Project reservation for any premises whose current real-world "
                    "operating state cannot be established from the register.",
            "source_basis": "The source's own maintenance caveat: no procedure detects "
                            "cessation without a replacement activity.",
            "count": None,
            "interpretation_ceiling": "A disclaimer label, not a computed subset. It "
                "records that the register cannot certify real-time operation for ANY "
                "premises, so no 'currently trading' count is admitted.",
            "usable_in_later_gates": False,
        },
    }


def abierto_deep(loc: dict, act: dict, ctrl: dict | None) -> dict:
    """C7 - the Abierto investigation."""
    abierto = loc["sit_sets"].get("1", set())
    n = len(abierto)
    with_classified = sum(1 for i in abierto if i in act["prem_has_classified"])
    with_blank = sum(1 for i in abierto if i in act["prem_has_blank"])
    with_sin = sum(1 for i in abierto if i in act["prem_has_sin_actividad"])
    # distribution across Gate B classes (a premises may count in several classes)
    class_dist = collections.Counter()
    for i in abierto:
        for c in act["prem_classes"].get(i, set()):
            class_dist[c] += 1
    transitions = None
    if ctrl is not None:
        ctrl_status = ctrl["status"]
        ctrl_abierto = ctrl["sit_sets"].get("1", set())
        persistent = set(abierto) & set(ctrl_status)
        # of premises Abierto in 2026 that existed in 2025, what were they in 2025?
        was = collections.Counter(ctrl_status[i][0] for i in persistent)
        # of premises Abierto in 2025 that persist, what are they in 2026?
        now_map = collections.Counter(
            loc["status"][i][0] for i in (ctrl_abierto & set(loc["status"])))
        transitions = {
            "abierto_2026_present_in_2025": len(persistent),
            "their_2025_situacion": dict(was.most_common()),
            "abierto_2025_present_in_2026": len(ctrl_abierto & set(loc["status"])),
            "their_2026_situacion": dict(now_map.most_common()),
            "note": "Mutability evidence only. A status change is an administrative "
                    "record change, NOT an observed business opening or closing.",
        }
    return {
        "official_definition": SITUACION_SOURCE_SEMANTICS["1"],
        "count_premises": n,
        "with_populated_classified_activity": with_classified,
        "with_blank_taxonomy_only_or_partial": with_blank,
        "with_section_Z_sin_actividad": with_sin,
        "gate_b_class_distribution": dict(class_dist.most_common()),
        "temporal": transitions,
        "question": "Does 'Abierto' support the statement 'currently operating business'?",
        "ruling": "NO - only as an administrative status.",
        "ruling_basis": (
            "The source defines Abierto as a premises with 'algun tipo de actividad "
            "economica', but (a) it explicitly warns situacion is a 'variable de "
            "mantenimiento complicado' with no procedure to detect cessation without a "
            "replacement activity, (b) extraction shows 'la ultima situacion' (last "
            "recorded, not verified-today), and (c) 11,000+ Abierto premises carry no "
            "activity classification at all. Abierto is therefore ADMINISTRATIVELY_OPEN "
            "(last-recorded active), never a verified current-operation count."),
    }


def cerrado_deep(loc: dict, act: dict) -> dict:
    """C8 - the Cerrado investigation."""
    cerrado = loc["sit_sets"].get("4", set())
    n = len(cerrado)
    with_classified = sum(1 for i in cerrado if i in act["prem_has_classified"])
    with_blank = sum(1 for i in cerrado if i in act["prem_has_blank"])
    return {
        "official_definition": SITUACION_SOURCE_SEMANTICS["4"],
        "source_semantics": "Local en el que en ese momento no se realiza ningun tipo de "
            "actividad. (apartado III - VERBATIM source meaning, not paraphrased.)",
        "count_premises": n,
        "with_populated_classified_activity": with_classified,
        "with_blank_taxonomy": with_blank,
        "activity_codes_can_remain_attached": with_classified > 0,
        "closure_dates_published": False,
        "temporary_or_permanent": "UNRESOLVED - the source says only 'en ese momento no "
            "se realiza ningun tipo de actividad' (no activity AT THAT MOMENT). It states "
            "neither permanence nor a closure date, and is explicitly distinct from Baja "
            "(desaparecido).",
        "question": "Can 'Cerrado' be interpreted as business cessation or economic failure?",
        "ruling": "NO (bounded).",
        "project_interpretation_ceiling": {
            "reasoning": "Because situacion is a difficult-to-maintain, LAST-RECORDED "
                "administrative variable and the source lacks a complete cessation-update "
                "procedure, Gate C does NOT treat Cerrado as any of the following:",
            "not_treated_as": [
                "independently verified current closure",
                "permanent cessation",
                "business failure",
                "economic decline",
            ],
            "note": "This is the PROJECT interpretation ceiling, kept strictly separate "
                "from the verbatim source_semantics above; it does not restate or replace "
                "the source meaning.",
        },
        "ruling_basis": "The verbatim source meaning is retained in source_semantics "
            "('Local en el que en ese momento no se realiza ningun tipo de actividad'). "
            "Separately, the project interpretation ceiling applies: Cerrado is NOT "
            "independently verified current closure, NOT permanent cessation, NOT business "
            "failure and NOT economic decline. No closure date exists and activity codes "
            "can remain attached. NO-GO stands for those interpretations.",
    }


def baja_deep(loc: dict, act: dict) -> dict:
    """C9 - Baja and Baja R, treated separately."""
    out = {}
    for code, key in (("8", "baja"), ("9", "baja_r")):
        s = loc["sit_sets"].get(code, set())
        with_classified = sum(1 for i in s if i in act["prem_has_classified"])
        out[key] = {
            "code": code,
            "official_definition": SITUACION_SOURCE_SEMANTICS[code],
            "count_premises": len(s),
            "retains_populated_activity_codes": with_classified,
            "explicitly_excluded_from_total_premises_count": True,
        }
    out["distinction_documented"] = (
        "YES - the code table distinguishes 8 'Local que ha desaparecido' from 9 'Local "
        "que ha desaparecido uniendose a otro' (disappeared by merging into another). "
        "Apartado III groups both as 'Baja o baja por reunificacion: Locales desaparecidos'.")
    out["role_in_source_counting"] = (
        "Both are UNCONDITIONALLY excluded from total-premises counts by the source's own "
        "instruction. They remain valid historical records and must NOT be deleted from "
        "research artifacts; exclusion is from a current total-count universe only.")
    out["interpretation_ceiling"] = (
        "'Desaparecido' is an administrative register event. It is NOT a measured business "
        "failure, bankruptcy or economic outcome, and Baja R in particular is a "
        "reorganisation (merge), not a closure.")
    return out


def other_statuses(loc: dict, universe: dict) -> dict:
    """C10 - Uso vivienda, Obras and every remaining status."""
    out = {}
    for code in sorted(loc["sit_rows"]):
        if code in ("1", "4", "8", "9"):
            continue  # handled in their own deep-dives
        s = loc["sit_sets"].get(code, set())
        documented = code in SITUACION_SOURCE_SEMANTICS
        out[code] = {
            "official_description": loc["sit_desc"].get(code, ""),
            "source_semantics": SITUACION_SOURCE_SEMANTICS.get(code, "UNDOCUMENTED."),
            "count_premises": len(s),
            "future_counting_inclusion_defensible": (
                "Defensible as an administrative premises record; the source gives no "
                "exclusion instruction. But Uso vivienda is explicitly a premises "
                "converted to housing, so including it in a 'commercial premises' reading "
                "would need its own justification." if code == "5" else
                "UNRESOLVED." if not documented else
                "No source exclusion; inclusion defensible as an administrative record."),
            "interpretation_ceiling": SITUACION_INTERPRETATION_CEILING.get(
                code, "UNRESOLVED - undocumented code."),
            "uncertainty": ("Documented but ABSENT from this snapshot (0 rows)."
                            if documented and len(s) == 0 else
                            "UNRESOLVED - undocumented code." if not documented else
                            "Documented and present."),
        }
    # also surface documented-but-absent codes (e.g. Obras)
    for code in universe["documented_situacion_codes_not_observed"]:
        out[code] = {
            "official_description": None,
            "source_semantics": SITUACION_SOURCE_SEMANTICS.get(code, "UNDOCUMENTED."),
            "count_premises": 0,
            "future_counting_inclusion_defensible": "N/A - absent from this snapshot.",
            "interpretation_ceiling": SITUACION_INTERPRETATION_CEILING.get(code, ""),
            "uncertainty": "Documented in the structure PDF but ABSENT from this snapshot.",
        }
    return out


def acceso_deep(loc: dict) -> dict:
    """C11 - access type, especially PC Asociado and the undocumented Interior code."""
    total = loc["rows"]
    pc = loc["acc_sets"].get("12", set())
    interior = loc["acc_sets"].get("3", set())
    return {
        "pc_asociado": {
            "code": "12",
            "official_meaning": ACCESO_SOURCE_SEMANTICS["12"],
            "count_premises": len(pc),
            "share_pct": pct(len(pc), total),
            "why_excluded": "The source says it 'No se trata de un local fisico' and must "
                            "not be counted in the total number of premises. It is a "
                            "subordinate access used to separate activities of different "
                            "owners inside one physical premises - a double-representation, "
                            "not an independent premises.",
            "is_physical_premises": False,
            "overlap_with_status_exclusions": {
                "pc_asociado_also_baja_8": len(pc & loc["sit_sets"].get("8", set())),
                "pc_asociado_also_baja_r_9": len(pc & loc["sit_sets"].get("9", set())),
                "note": "Any PC Asociado premises also in Baja/Baja R must be counted once "
                        "in the exclusion union, not subtracted twice.",
            },
            "ruling": "GO as an explicit source exclusion (not a status/economic signal).",
        },
        "interior_undocumented": {
            "code": "3",
            "official_meaning": ACCESO_SOURCE_SEMANTICS["3"],
            "count_premises": len(interior),
            "share_pct": pct(len(interior), total),
            "handling": "Reported as UNDOCUMENTED. It is not named in any exclusion rule, "
                        "so the explicit rules leave it in the counted universe. Any future "
                        "count MUST flag it; Gate C does not invent a meaning for it.",
            "materiality": "Large (one quarter of premises), so it is surfaced prominently, "
                           "but it does not change the explicit exclusion arithmetic, which "
                           "names only situacion 8/9 and acceso 12.",
        },
        "other_access_codes_requiring_handling": (
            "Agrupado (0) and Puerta calle (1) carry no special counting instruction. Only "
            "PC Asociado (12) is excluded; Interior (3) is undocumented and flagged."),
    }


def nominal_snapshot_revision(resources: dict, premises_total: int) -> dict:
    """Provenance finding: the resource labelled 'Septiembre 2026' was re-published
    between the Gate A/B run and this Gate C run. Reads the committed Gate A summary for
    the earlier reference state and compares SHA-256 FINGERPRINTS, never month labels.
    A nominal month label is not, by itself, a version identity."""
    cur = resources.get(LOC_PRIMARY[0], {})
    earlier = None
    ga = RESULTS / "gate_a_identity_summary.json"
    if ga.exists():
        try:
            g = json.loads(ga.read_text(encoding="utf-8"))
            r = g["resources"]["locales_2026_09"]
            earlier = {
                "sha256": r.get("sha256"),
                "bytes": r.get("bytes"),
                "http_last_modified": r.get("http_last_modified"),
                "distinct_premises": g["per_snapshot"]["locales_2026_09"][
                    "identity_id_local"]["distinct"],
            }
        except Exception:
            earlier = None
    revised = bool(earlier and cur.get("sha256") and earlier.get("sha256")
                   and cur["sha256"] != earlier["sha256"])
    return {
        "warning": "NOMINAL_SNAPSHOT_REVISION",
        "nominal_label": "Septiembre 2026",
        "revised_since_gate_a_b": revised,
        "gate_a_b_reference": earlier,
        "gate_c_current": {
            "sha256": cur.get("sha256"),
            "bytes": cur.get("bytes"),
            "http_last_modified": cur.get("http_last_modified"),
            "distinct_premises": premises_total,
        },
        "statements": [
            "1. Gate C uses a LATER published revision of the resource labelled "
            "'Septiembre 2026' than the Gate A/B run did.",
            "2. Gate C counts MUST NOT be numerically compared against the earlier Gate "
            "A/B Sep-2026 counts without using their respective SHA-256 fingerprints.",
            "3. This does NOT invalidate Gate A/B conclusions; those remain valid "
            "observations tied to their own recorded SHA-256 upstream states.",
            "4. The mutable/revised nature of nominal monthly snapshots is a formal Gate D "
            "temporal-comparability question.",
            "5. Never treat the month label alone as sufficient version identity; identity "
            "is the (month label + SHA-256 fingerprint) pair.",
        ],
    }


def temporal_control(loc: dict, ctrl: dict) -> dict:
    """C12 - status mutability Sep 2025 -> Sep 2026, bounded interpretation only."""
    a = ctrl["status"]  # 2025
    b = loc["status"]   # 2026
    persistent = set(a) & set(b)
    trans = collections.Counter()
    for idl in persistent:
        trans[(a[idl][0], b[idl][0])] += 1
    # named transitions of interest
    def t(x, y):
        return trans.get((x, y), 0)
    return {
        "control_snapshot": LOC_CONTROL[0],
        "primary_snapshot": LOC_PRIMARY[0],
        "persistent_premises": len(persistent),
        "situacion_transition_matrix": {
            f"{x}->{y}": n for (x, y), n in sorted(trans.items(), key=lambda kv: -kv[1])},
        "named_transitions": {
            "abierto_to_cerrado": t("1", "4"),
            "cerrado_to_abierto": t("4", "1"),
            "abierto_to_baja": t("1", "8"),
            "baja_to_abierto": t("8", "1"),
            "abierto_to_baja_r": t("1", "9"),
            "uso_vivienda_to_other": sum(n for (x, y), n in trans.items()
                                         if x == "5" and y != "5"),
            "unchanged": sum(n for (x, y), n in trans.items() if x == y),
        },
        "interpretation": "Statuses behave like MUTABLE administrative attributes: the "
            "same persistent premises (stable id_local) carries different situacion values "
            "across snapshots in both directions. Transitions are NOT read as real business "
            "openings/closures.",
        "scope_note": "Two snapshots only. Full historical comparability (field/code/format "
                      "homogeneity across the whole series) remains Gate D.",
    }


def main() -> int:
    RESULTS.mkdir(exist_ok=True)
    started = A.now()
    print("[gate-c] resolving resources from the official catalogue ...")
    pkg = A.package()

    resources = {}
    parsed = {}

    def fetch(key, desc, parser):
        res = A.resolve_resource(pkg, desc)
        print(f"[gate-c] fetching {desc} ...")
        path, meta = A.stream_to_temp(res["url"])
        try:
            dialect = A.detect_dialect(path)
            out = parser(path)
            resources[key] = {
                "description": desc, "resource_id": res.get("id"),
                "format": (res.get("format") or "").upper(), "url": res["url"],
                "retrieved_at": A.now(), "dialect_observed": dialect, **meta,
            }
        finally:
            os.unlink(path)
        print(f"[gate-c]   rows={out['rows']}")
        return out

    loc = fetch(LOC_PRIMARY[0], LOC_PRIMARY[1], parse_locales)
    act = fetch(ACT_PRIMARY[0], ACT_PRIMARY[1], parse_actividades_taxonomy_state)
    ctrl = fetch(LOC_CONTROL[0], LOC_CONTROL[1], parse_locales)

    print("[gate-c] analysing ...")
    universe = status_universe(loc)
    revision = nominal_snapshot_revision(resources, universe["premises_rows_total"])
    xtab = cross_tab(loc, act)
    by_class = status_by_class(loc, act)
    excl = official_exclusions(loc)
    cands = candidate_states(excl, loc)
    abierto = abierto_deep(loc, act, ctrl)
    cerrado = cerrado_deep(loc, act)
    baja = baja_deep(loc, act)
    others = other_statuses(loc, universe)
    acceso = acceso_deep(loc)
    temporal = temporal_control(loc, ctrl)

    documentation = {
        "structure_pdf": A.STRUCTURE_PDF,
        "structure_pdf_version": "mar/2022 (as printed in the PDF)",
        "situacion_is_hard_to_maintain": (
            "Apartado III: 'se trata de una variable de mantenimiento complicado, ya que "
            "... no se dispone de ninguno [procedimiento] que informe de cuando una "
            "actividad cesa y el local se cierra sin aparecer una nueva actividad.' So any "
            "situacion value can be stale."),
        "extraction_shows_last_situacion": (
            "'Extraccion de datos ... a una fecha dada mostrandose la ultima situacion del "
            "local.' Situacion is the LAST RECORDED state, not a verified real-time status."),
        "official_total_count_exclusions": (
            "situacion 8 and 9 (apartado III) and acceso 12 PC Asociado (apartado II) are "
            "the ONLY codes the document instructs to exclude from 'numero total de locales'."),
        "three_levels_kept_separate": (
            "This report keeps source_semantics (what the document says), "
            "empirical_observation (what the data shows) and project_handling / "
            "interpretation_ceiling (our analytical decision) in separate fields and never "
            "merges them. Project handling labels are NOT official source metadata."),
    }

    rulings = {
        "abierto_semantics": {
            "use_as_current_operation_proxy": "NO-GO",
            "basis": abierto["ruling_basis"],
        },
        "cerrado_semantics": {
            "use_as_business_cessation_evidence": "NO-GO",
            "basis": cerrado["ruling_basis"],
        },
        "baja_baja_r": {
            "use_as_explicit_source_exclusions": "GO",
            "basis": "Both codes are unconditionally excluded from total-premises counts "
                     "by the source's own instruction (apartado III).",
        },
        "pc_asociado": {
            "use_as_explicit_source_exclusion": "GO",
            "basis": "The source excludes PC Asociado from total-premises counts because "
                     "it is not a physical premises (apartado II).",
        },
        "source_excluded_premises_universe": {
            "use_as_reproducible_administrative_filtering_rule": "GO",
            "basis": "Union of situacion {8,9} and acceso 12, overlaps handled so PC "
                     "Asociado is not double-subtracted. This is a research filtering rule, "
                     "NOT a production denominator (Gate F).",
        },
        "economic_interpretation": {
            "ruling": "NO-GO",
            "basis": "No status field supports trading, demand, turnover, success, failure, "
                     "vitality, saturation or tourism-pressure claims. Independent evidence "
                     "would be required and is absent.",
        },
        "overall_gate_c": {
            "ruling": "GO to Gate D",
            "basis": "Administrative status semantics are established: the source's explicit "
                     "exclusion rules are reproducible (administrative filtering GO), while "
                     "current-operation and economic inference remain NO-GO. Mixed "
                     "sub-rulings are the intended outcome of the gate.",
            "mixed_subrulings_are_expected": True,
        },
    }

    report = {
        "audit_started_at": started,
        "audit_finished_at": A.now(),
        "environment_note": "Counts are observations of one run against the fingerprinted "
                            "resources recorded below, not repository invariants.",
        "dataset": {
            "id": A.PACKAGE, "title": pkg.get("title"), "catalogue": A.CATALOGUE,
            "license": pkg.get("license_title"),
            "catalogue_metadata_modified": pkg.get("metadata_modified"),
            "resource_resolution_method": "Exact match on the resource `description` field "
                "(family + month), unique per resource. Opaque numeric resource ids are "
                "recorded, not used to select.",
        },
        "documentation": documentation,
        "nominal_snapshot_revision": revision,
        "resources": resources,
        "primary_locales_snapshot": LOC_PRIMARY[0],
        "primary_actividades_snapshot": ACT_PRIMARY[0],
        "control_locales_snapshot": LOC_CONTROL[0],
        "status_universe": universe,
        "status_x_taxonomy_state": xtab,
        "status_by_gate_b_class": by_class,
        "official_counting_exclusions": excl,
        "candidate_counting_states": cands,
        "abierto": abierto,
        "cerrado": cerrado,
        "baja_and_baja_r": baja,
        "other_statuses": others,
        "access_type": acceso,
        "temporal_status_control": temporal,
        "gate_c_ruling": rulings,
        "interpretation_ceiling": {
            "this_evidence_can_never_claim_on_its_own": [
                "that any premises is currently trading / operating today",
                "a count of active businesses",
                "a count of business failures or closures",
                "economic decline, growth, success or commercial health",
                "commercial vitality, saturation, tourism pressure or overtourism",
                "demand, turnover, revenue, footfall or visitor numbers",
            ],
            "what_it_can_support": [
                "the number of premises remaining after the source's explicit exclusion rules",
                "the administrative status composition of documented hospitality/commercial premises",
                "how much of the source universe is administratively unresolved or unclassified",
            ],
        },
    }

    out = RESULTS / "gate_c_status.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[gate-c] wrote {out.relative_to(HERE.parents[1])}")

    summary = {
        "audit_finished_at": report["audit_finished_at"],
        "primary_locales_snapshot": LOC_PRIMARY[0],
        "nominal_snapshot_revision": {
            "warning": revision["warning"],
            "nominal_label": revision["nominal_label"],
            "revised_since_gate_a_b": revision["revised_since_gate_a_b"],
            "gate_a_b_reference_sha256": (revision["gate_a_b_reference"] or {}).get("sha256"),
            "gate_a_b_reference_premises": (revision["gate_a_b_reference"] or {}).get("distinct_premises"),
            "gate_c_current_sha256": revision["gate_c_current"]["sha256"],
            "gate_c_current_premises": revision["gate_c_current"]["distinct_premises"],
            "note": "Compare snapshots by (label + SHA-256), never by month label alone.",
        },
        "resources_sha256": {k: v["sha256"] for k, v in resources.items()},
        "situacion_universe": {
            c: {"desc": v["official_description"],
                "rows": v["empirical_observation"]["rows"],
                "share_pct": v["empirical_observation"]["share_pct"]}
            for c, v in universe["situacion"].items()},
        "tipo_acceso_universe": {
            c: {"desc": v["official_description"],
                "rows": v["empirical_observation"]["rows"],
                "share_pct": v["empirical_observation"]["share_pct"],
                "undocumented": v["undocumented_code"]}
            for c, v in universe["tipo_acceso"].items()},
        "official_counting_exclusions": {
            "raw_premises_universe": excl["raw_premises_universe"],
            "excluded_by_each_rule": excl["excluded_by_each_rule"],
            "union_excluded": excl["union_excluded"],
            "double_subtraction_avoided": excl["double_subtraction_avoided"],
            "remaining_after_official_exclusions": excl["remaining_after_official_exclusions"],
        },
        "abierto_blank_coexistence": xtab["answers"][
            "abierto_can_coexist_with_blank_taxonomy"]["count_abierto_blank_only"],
        "status_determines_taxonomy_state": xtab["answers"][
            "administrative_status_determines_taxonomy_state"]["answer"],
        "gate_c_ruling": rulings,
    }
    outs = RESULTS / "gate_c_status_summary.json"
    outs.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[gate-c] wrote {outs.relative_to(HERE.parents[1])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
