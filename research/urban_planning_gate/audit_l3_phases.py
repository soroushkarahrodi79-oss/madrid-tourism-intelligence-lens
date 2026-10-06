#!/usr/bin/env python3
"""Gate L · L3 — Phase vocabulary and the ``No Necesita`` semantics (issue #65).

Audits the four published phase columns of S1 (203200) — ``Planeamiento``,
``Gestión``, ``Urbanización. Proyecto``, ``Urbanización. Obras`` — across the
editions where they exist (the recent flat era: 2025-01, 2025-07, 2026-01), and
reports:

  * the complete observed value set per column, with counts and edition span;
  * documented-vs-observed drift against the publisher's structure PDF
    (version Nov 2025), which lists the expected ``Estado de Desarrollo`` values
    verbatim — and does NOT list ``En Ejecución``, which the data nonetheless
    carries, and spells ``PGOUM 85`` where the data writes ``PGOUM-85``;
  * that ``PGOUM 85`` / ``PGOUM 97`` are DOCUMENTED state values but are plan-of-
    origin markers, not phase progress — they fill the phase cells of ámbitos
    tracked under the prior plan;
  * whether the four phases form an ordered funnel or are independent dimensions,
    tested empirically (a "later" phase advanced while an "earlier" phase is not);
  * the ``No Necesita`` semantics: a documented value whose MEANING the publisher
    never defines, so the project-side reading "the phase does not apply" is
    SOURCE-OBSERVED, not SOURCE-DOCUMENTED — while ``No Necesita`` and
    ``Sin Iniciar`` remain structurally distinct values that must never collapse.

The single-state era (2013–2024, one ``Estado de Desarrollo`` column) is reported
separately, since it is a different structure and cannot be aligned to the four
phases.

Writes ``results/l3_phases.json`` and ``results/l3_summary.json``.
Run: ``python research/urban_planning_gate/audit_l3_phases.py`` (after L1).
"""

from __future__ import annotations

import collections
import re
import unicodedata
from pathlib import Path

import gate_l_common as g
import audit_l1_editions as l1

# The S1 phase columns, in the publisher's nominal left-to-right order.
PHASE_COLUMNS = [
    "Estado de desarrollo. Planeamiento",
    "Estado de desarrollo. Gestión",
    "Estado de desarrollo.Urbanización. Proyecto",
    "Estado de desarrollo. Urbanización. Obras",
]

# The DOCUMENTED Estado de Desarrollo vocabulary, read VERBATIM from the structure
# PDF 203200-13 (version Noviembre 2025, sha256 8480ef941dec…). Recorded here as a
# fingerprinted source fact so the documented-vs-observed comparison is auditable.
PDF_DOCUMENTED_STATES = ["En Tramitación", "Finalizado", "No necesita",
                         "PGOUM 85", "PGOUM 97", "Sin Iniciar"]
PDF_RESOURCE = {"resource_id": "203200-13-desarrollo-ambitos",
                "version": "Noviembre 2025", "sha256_prefix": "8480ef941dec"}

# Plan-of-origin markers that occupy phase cells (documented states, not progress).
PGOUM_MARKERS = {"PGOUM-85", "PGOUM-97", "PGOUM 85", "PGOUM 97"}
ADVANCED = {"En Ejecución", "Finalizado"}
NOT_ADVANCED = {"Sin Iniciar", "En tramitación", "En Tramitación"}


def _fold(t: str) -> str:
    """Fold accents, case, whitespace AND hyphen/space punctuation, for the
    documented-vs-observed comparison only. This makes 'PGOUM-85' match the
    documented 'PGOUM 85' (punctuation drift) while leaving genuine spelling
    variants such as 'Finalizada' vs 'Finalizado' distinct."""
    s = unicodedata.normalize("NFKD", t or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.replace("-", " ")
    return re.sub(r"\s+", " ", s).strip().upper()


def main() -> None:
    g.utf8_stdout()
    inv = l1.edition_inventory()
    s1 = inv["S1"]["editions"]
    flat = [e for e in s1 if e["schema_era"] == "S1_FOUR_PHASE_FLAT"]
    flat.sort(key=lambda e: e["reference_date"])
    single = [e for e in s1 if e["schema_era"] == "S1_SINGLE_STATE_PER_DISTRICT"]
    single.sort(key=lambda e: e["reference_date"])

    # ---- four-phase vocabulary across the flat editions
    per_column = {c: collections.Counter() for c in PHASE_COLUMNS}
    seen_in = {c: {} for c in PHASE_COLUMNS}   # value -> {first, last}
    funnel_violations = []
    rows_total = 0
    for ed in flat:
        path = Path(g.fetch(ed["url"], ed["resource_id"], ".xls")["cache_path"])
        wb = g.open_workbook(path)
        data = l1.read_flat_rows(wb, "S1")
        # resolve the phase columns by exact header name
        for rec in data["rows"]:
            rows_total += 1
            vals = {}
            for c in PHASE_COLUMNS:
                v = g.cell_text(rec.get(c, ""))
                per_column[c][v] += 1
                vals[c] = v
                sv = seen_in[c].setdefault(v, {"first": ed["reference_date"], "last": ed["reference_date"]})
                sv["last"] = ed["reference_date"]
            # funnel test: a later phase advanced while an earlier is not advanced
            for i in range(len(PHASE_COLUMNS)):
                for j in range(i + 1, len(PHASE_COLUMNS)):
                    ev, lv = vals[PHASE_COLUMNS[i]], vals[PHASE_COLUMNS[j]]
                    if ev in PGOUM_MARKERS or lv in PGOUM_MARKERS:
                        continue
                    if ev == "No Necesita" or lv == "No Necesita":
                        continue
                    if lv in ADVANCED and ev in NOT_ADVANCED:
                        funnel_violations.append({
                            "edition": ed["reference_date"], "code": g.cell_text(rec.get("Ámbito", "")),
                            "earlier_phase": PHASE_COLUMNS[i], "earlier_value": ev,
                            "later_phase": PHASE_COLUMNS[j], "later_value": lv,
                        })

    observed_values = sorted({v for c in PHASE_COLUMNS for v in per_column[c] if v})
    documented_folded = {_fold(x) for x in PDF_DOCUMENTED_STATES}
    observed_not_documented = sorted([v for v in observed_values if _fold(v) not in documented_folded])
    documented_not_observed = sorted([x for x in PDF_DOCUMENTED_STATES
                                      if _fold(x) not in {_fold(v) for v in observed_values}])
    spelling_drift = []
    for v in observed_values:
        for d in PDF_DOCUMENTED_STATES:
            if _fold(v) == _fold(d) and v != d:
                spelling_drift.append({"observed": v, "documented": d})
    # Split the genuinely-undocumented values from number/gender spelling variants
    # of a documented value (Finalizada / Finalizadas ~ the documented Finalizado).
    def _is_finalizado_variant(v: str) -> bool:
        return _fold(v).startswith("FINALIZAD") and _fold(v) != "FINALIZADO"
    undocumented_states = [v for v in observed_not_documented if not _is_finalizado_variant(v)]
    finalizado_variants = [v for v in observed_not_documented if _is_finalizado_variant(v)]

    # ---- single-state era vocabulary (2013-2024)
    single_vocab = collections.Counter()
    for ed in single:
        path = Path(g.fetch(ed["url"], ed["resource_id"], ".xls")["cache_path"])
        wb = g.open_workbook(path)
        for sidx in range(len(wb.sheet_names())):
            sheet = wb.sheet_by_index(sidx)
            hdr_row, hdr = l1._find_header_row(sheet)
            if hdr_row < 0:
                continue
            toks = [_fold(h) for h in hdr]
            if "ESTADO DE DESARROLLO" not in toks:
                continue
            ci = toks.index("ESTADO DE DESARROLLO")
            for r in range(hdr_row + 1, sheet.nrows):
                raw = sheet.row_values(r)
                if ci < len(raw):
                    v = g.cell_text(raw[ci])
                    if v:
                        single_vocab[v] += 1

    report = {
        "gate": "L3",
        "audit_finished_at": g.now(),
        "structure_pdf": PDF_RESOURCE,
        "four_phase_era": {
            "editions": [e["reference_date"] for e in flat],
            "rows_scanned": rows_total,
            "phase_columns": PHASE_COLUMNS,
            "per_column_vocabulary": {
                c: [{"value": v, "count": per_column[c][v],
                     "first_edition": seen_in[c][v]["first"], "last_edition": seen_in[c][v]["last"]}
                    for v, _ in per_column[c].most_common() if v]
                for c in PHASE_COLUMNS
            },
            "observed_values": observed_values,
            "documented_values_pdf": PDF_DOCUMENTED_STATES,
            "observed_not_documented": observed_not_documented,
            "undocumented_states": undocumented_states,
            "undocumented_states_note": "Values present in the data but absent from the "
                "structure PDF's expected-value list. 'En Ejecución' is a genuinely "
                "undocumented phase state the files nonetheless use throughout.",
            "finalizado_spelling_variants": finalizado_variants,
            "documented_not_observed": documented_not_observed,
            "spelling_drift": spelling_drift,
            "pgoum_markers_in_phase_cells": {
                m: sum(per_column[c].get(m, 0) for c in PHASE_COLUMNS) for m in sorted(PGOUM_MARKERS)
            },
        },
        "ordering_analysis": {
            "method": "For every ordered pair of phase columns, count rows where the "
                      "later phase is advanced (En Ejecución/Finalizado) while the earlier "
                      "is not advanced (Sin Iniciar/En tramitación); PGOUM markers and "
                      "No Necesita excluded.",
            "funnel_violation_count": len(funnel_violations),
            "funnel_violations_sample": funnel_violations[:12],
            "verdict": ("MULTI_DIMENSIONAL_NO_SCALAR_STAGE" if funnel_violations
                        else "CONSISTENT_WITH_FUNNEL_BUT_NOT_DOCUMENTED_AS_ONE"),
        },
        "no_necesita": {
            "documented_as_value": True,
            "semantics_defined_by_publisher": False,
            "verdict": "SOURCE_OBSERVED_INTERPRETATION_UNRESOLVED",
            "note": "The structure PDF lists 'No necesita' as an expected Estado de "
                    "Desarrollo value but never defines its meaning. The reading 'the "
                    "phase does not apply' is a project-side interpretation, not a "
                    "publisher statement. Structurally, 'No Necesita' and 'Sin Iniciar' "
                    "are distinct listed values and must never be collapsed.",
            "no_necesita_count": sum(per_column[c].get("No Necesita", 0) for c in PHASE_COLUMNS),
            "sin_iniciar_count": sum(per_column[c].get("Sin Iniciar", 0) for c in PHASE_COLUMNS),
            "are_distinct_values": "No Necesita" in observed_values and "Sin Iniciar" in observed_values,
        },
        "single_state_era": {
            "editions": [e["reference_date"] for e in single],
            "note": "2013–2024 editions carry ONE 'Estado de Desarrollo' column, not four "
                    "phases, in a per-district multi-sheet layout. The four-phase vocabulary "
                    "cannot be aligned to this era; cross-era phase differencing is barred.",
            "observed_vocabulary": [{"value": v, "count": c} for v, c in single_vocab.most_common() if v],
        },
    }
    summary = {
        "gate": "L3",
        "four_phase_editions": [e["reference_date"] for e in flat],
        "observed_values": observed_values,
        "observed_not_documented": observed_not_documented,
        "undocumented_states": undocumented_states,
        "finalizado_spelling_variants": finalizado_variants,
        "spelling_drift": spelling_drift,
        "funnel_violation_count": len(funnel_violations),
        "phase_ordering_verdict": report["ordering_analysis"]["verdict"],
        "no_necesita_verdict": report["no_necesita"]["verdict"],
        "no_necesita_distinct_from_sin_iniciar": report["no_necesita"]["are_distinct_values"],
        "pgoum_markers_share_of_phase_cells": round(
            sum(report["four_phase_era"]["pgoum_markers_in_phase_cells"].values())
            / max(1, rows_total * len(PHASE_COLUMNS)), 4),
    }
    g.write_json("l3_phases.json", report)
    g.write_json("l3_summary.json", summary)
    print("observed phase values:", observed_values)
    print("undocumented_states:", undocumented_states, "| finalizado_variants:", finalizado_variants)
    print("spelling_drift:", spelling_drift)
    print("funnel violations:", len(funnel_violations), "->", report["ordering_analysis"]["verdict"])
    print("No Necesita:", report["no_necesita"]["verdict"],
          "distinct_from_sin_iniciar:", report["no_necesita"]["are_distinct_values"])
    print("PGOUM markers share of phase cells:", summary["pgoum_markers_share_of_phase_cells"])
    print("wrote results/l3_phases.json, results/l3_summary.json")


if __name__ == "__main__":
    main()
