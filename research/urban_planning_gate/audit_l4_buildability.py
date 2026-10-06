#!/usr/bin/env python3
"""Gate L · L4 — Buildability semantics and the no-dwelling-count ceiling (#65).

Audits the S2 (203182) buildability fields and resolves what "remanente" means,
in what unit, and whether a published dwelling count exists. Findings:

  * Each field's exact Spanish label, the structure-PDF description verbatim, and
    its unit — the residential/tertiary/industrial figures are **m²**
    (``Edificabilidad disponible para el uso … en m²``).
  * The publisher defines the dataset as ``edificabilidad DISPONIBLE para los usos
    lucrativos … en los ámbitos de ordenación VIGENTES … según la situación del
    ámbito`` — i.e. *available/remaining buildable floor area under the plan*. It
    does NOT say "remaining to be physically built"; that stronger claim is not
    supported.
  * The ``Colectiva. Nº Viviendas`` / ``Unifamiliar. Nº Viviendas`` columns ARE
    documented ("Nº de viviendas disponibles … en unidades") — which CORRECTS Gate
    K §6.6's "no dwelling-count field exists" — BUT their published values equal
    ``Edif. Residencial ÷ 100`` and are fractional (e.g. 163.167), so they are a
    mechanical m²/100 proxy at an assumed 100 m²/dwelling, NOT a count of real
    dwelling units. The no-dwelling-count ceiling therefore HOLDS, on stronger,
    evidence-based grounds: the product may publish buildability in m² and must
    not present the ``Nº Viviendas`` figure as a dwelling count.
  * Buildability is not comparable across schema eras (the fields change:
    ``VACRES/VACIND/VACTER`` → single ``Edif. Residencial`` → ``Colectiva`` /
    ``Unifamiliar`` split). Within the recent flat era a naive edition-to-edition
    delta is further confounded by ámbitos entering/leaving and by situación
    changes, so a difference is at most an ``OBSERVED PUBLISHED DIFFERENCE`` with
    cause unresolved — never "construction".

Writes ``results/l4_buildability.json`` and ``results/l4_summary.json``.
Run: ``python research/urban_planning_gate/audit_l4_buildability.py`` (after L1).
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

import gate_l_common as g
import audit_l1_editions as l1

PDF_RESOURCE = {"resource_id": "203182-7-ambitos-remanente",
                "version": "Noviembre 2025", "sha256_prefix": "f18aad6a9701"}

# Field label -> (structure-PDF description verbatim, unit). Source facts, recorded
# exactly as the PDF states them.
S2_FIELD_DOC = {
    "Colectiva. Edif. Residencial": ("Edificabilidad disponible para el uso de residencial colectiva en m²", "m2"),
    "Colectiva. Nº \nViviendas": ("Nº de viviendas disponibles para residencial colectiva en unidades", "unidades_declared"),
    "Unifamiliar. Edif. Residencial": ("Edificabilidad disponible para el uso de residencial unifamiliar en m²", "m2"),
    "Unifamiliar. Nº \nViviendas": ("Nº de viviendas disponibles para residencial unifamiliar en unidades", "unidades_declared"),
    "Edif. Industrial": ("Edificabilidad disponible para el uso Industrial en m²", "m2"),
    "Edif. Terciario": ("Edificabilidad disponible para el uso Terciario en m²", "m2"),
}
REMANENTE_DEFINITION = ("edificabilidad disponible para los usos lucrativos Residencial, "
                        "Servicios Terciarios e Industrial en los ámbitos de ordenación "
                        "vigentes del Plan General de Ordenación Urbana de Madrid, según la "
                        "situación del ámbito.")


def _num(v):
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(".", "").replace(",", ".") if "," in str(v) else str(v).strip()
    try:
        return float(s)
    except ValueError:
        return None


def _find_col(cols, *needles):
    for c in cols:
        cl = re.sub(r"\s+", " ", c).strip().lower()
        if all(n in cl for n in needles):
            return c
    return None


def _test_ratio(rows, edif_col, viv_col):
    """Test whether Nº Viviendas == Edif. Residencial / 100 across all rows."""
    tested = matched = fractional = 0
    samples = []
    for rec in rows:
        e = _num(rec.get(edif_col, ""))
        v = _num(rec.get(viv_col, ""))
        if e is None or v is None:
            continue
        if e == 0 and v == 0:
            continue
        tested += 1
        if abs(v * 100.0 - e) < 0.5:
            matched += 1
        if v != int(v):
            fractional += 1
        if len(samples) < 6 and v != 0:
            samples.append({"edif_m2": e, "n_viviendas": v, "edif_div_100": round(e / 100.0, 4)})
    return {"rows_tested": tested, "equal_to_edif_over_100": matched, "fractional_values": fractional,
            "match_rate": round(matched / tested, 4) if tested else None, "samples": samples}


def main() -> None:
    g.utf8_stdout()
    inv = l1.edition_inventory()
    s2 = inv["S2"]["editions"]
    flat = [e for e in s2 if e["schema_era"] == "S2_SPLIT_RESIDENTIAL_FLAT"]
    flat.sort(key=lambda e: e["reference_date"])
    latest = flat[-1]

    path = Path(g.fetch(latest["url"], latest["resource_id"], ".xls")["cache_path"])
    wb = g.open_workbook(path)
    data = l1.read_flat_rows(wb, "S2")
    cols = data["columns"]

    col_col_edif = _find_col(cols, "colectiva", "edif", "residencial")
    col_col_viv = _find_col(cols, "colectiva", "viviendas")
    uni_edif = _find_col(cols, "unifamiliar", "edif", "residencial")
    uni_viv = _find_col(cols, "unifamiliar", "viviendas")

    ratio_colectiva = _test_ratio(data["rows"], col_col_edif, col_col_viv)
    ratio_unifamiliar = _test_ratio(data["rows"], uni_edif, uni_viv)

    # cross-edition comparability within the flat era (Jul2025 -> Jan2026)
    comparability = {"schema_eras_for_buildability": {}, "within_flat_era_movement": None}
    for ed in s2:
        comparability["schema_eras_for_buildability"].setdefault(ed["schema_era"], []).append(ed["reference_date"])
    if len(flat) >= 2:
        a, b = flat[-2], flat[-1]
        wa = g.open_workbook(Path(g.fetch(a["url"], a["resource_id"], ".xls")["cache_path"]))
        da = l1.read_flat_rows(wa, "S2")
        def tot(rows, col):
            return round(sum(_num(r.get(col, "")) or 0 for r in rows), 1)
        comparability["within_flat_era_movement"] = {
            "pair": f"{a['reference_date']} -> {b['reference_date']}",
            "colectiva_edif_residencial_total_m2": {a["reference_date"]: tot(da["rows"], col_col_edif),
                                                    b["reference_date"]: tot(data["rows"], col_col_edif)},
            "rows": {a["reference_date"]: len(da["rows"]), b["reference_date"]: len(data["rows"])},
            "caveat": "A city total shifts both because per-ámbito figures move AND because "
                      "ámbitos enter/leave the file and situación changes rebase the universe. "
                      "A naive delta cannot be attributed to construction: it is at most an "
                      "OBSERVED PUBLISHED DIFFERENCE with cause unresolved.",
        }

    # confirm no protected-housing count and no usable dwelling count
    has_protected_col = any("protegid" in c.lower() for c in cols)

    report = {
        "gate": "L4",
        "audit_finished_at": g.now(),
        "structure_pdf": PDF_RESOURCE,
        "edition_audited": latest["reference_date"],
        "remanente_definition_verbatim": REMANENTE_DEFINITION,
        "remanente_meaning": {
            "publisher_word": "disponible (available)",
            "qualifier": "según la situación del ámbito; en ámbitos vigentes",
            "supported_claim": "available/remaining buildable floor area under the plan, in m², by use",
            "NOT_supported": ["remaining to be physically built", "remaining unallocated",
                              "will be consumed", "market value"],
            "verdict": "AVAILABLE_BUILDABILITY_M2_UNDER_PLAN",
        },
        "fields": [
            {"label": k, "pdf_description": v[0], "unit": v[1],
             "present_in_latest": _find_col(cols, *[t for t in re.split(r"[.\s]+", k.lower()) if t][:2]) is not None}
            for k, v in S2_FIELD_DOC.items()
        ],
        "n_viviendas_finding": {
            "documented": True,
            "documented_as": "Nº de viviendas disponibles … en unidades",
            "colectiva_ratio_test": ratio_colectiva,
            "unifamiliar_ratio_test": ratio_unifamiliar,
            "conclusion": "The Nº Viviendas columns equal Edif. Residencial ÷ 100 and are "
                          "fractional, so they are a mechanical m²/100 proxy at an assumed "
                          "100 m²/dwelling, NOT a count of real dwelling units.",
            "corrects_gate_k": "Gate K §6.6 stated 'no dwelling-count field exists in either "
                               "file'. A column LABELLED as a dwelling count does exist in S2; "
                               "its values are a derived m²/100 proxy, not an authoritative count.",
        },
        "no_dwelling_ceiling": {
            "verdict": "BINDING",
            "basis": "The only dwelling-labelled field is a fractional m²/100 derivation; the "
                     "lucrative-use figures are m². No authoritative dwelling-unit or "
                     "protected-dwelling count is published.",
            "has_protected_housing_count_column": has_protected_col,
            "prohibited": ["m² ÷ assumed dwelling size", "extrapolated protected-housing count",
                           "derived household capacity", "publishing Nº Viviendas as a dwelling count"],
        },
        "cross_edition_comparability": comparability,
    }
    summary = {
        "gate": "L4",
        "buildability_unit": "m2",
        "remanente_meaning": report["remanente_meaning"]["verdict"],
        "n_viviendas_is_m2_over_100": (ratio_colectiva["match_rate"], ratio_unifamiliar["match_rate"]),
        "n_viviendas_fractional": (ratio_colectiva["fractional_values"], ratio_unifamiliar["fractional_values"]),
        "no_dwelling_ceiling": "BINDING",
        "cross_era_buildability_delta": "BARRED (fields change across eras); within-era delta is "
                                        "OBSERVED_PUBLISHED_DIFFERENCE with cause unresolved.",
    }
    g.write_json("l4_buildability.json", report)
    g.write_json("l4_summary.json", summary)
    print("remanente meaning:", report["remanente_meaning"]["verdict"])
    print("Colectiva  Nº Viviendas == Edif/100:", ratio_colectiva["match_rate"],
          "fractional:", ratio_colectiva["fractional_values"], "/", ratio_colectiva["rows_tested"])
    print("Unifamiliar Nº Viviendas == Edif/100:", ratio_unifamiliar["match_rate"],
          "fractional:", ratio_unifamiliar["fractional_values"], "/", ratio_unifamiliar["rows_tested"])
    print("no-dwelling ceiling:", report["no_dwelling_ceiling"]["verdict"],
          "| protected col:", has_protected_col)
    print("wrote results/l4_buildability.json, results/l4_summary.json")


if __name__ == "__main__":
    main()
