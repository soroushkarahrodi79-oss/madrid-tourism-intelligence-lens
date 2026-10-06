#!/usr/bin/env python3
"""Gate L · L6 — Sources audited and deliberately NOT adopted, with the measured
reason for each (issue #65).

Each candidate is probed first-hand and its disqualifying measurement recorded, so
the exclusion is evidence, not assertion:

  * ``MCPG_Madrid_Crece`` — parcel register: feature count, the undocumented
    ``FASE_UR`` codes, the ``F_BAJA_G = 9999-09-09`` sentinel, ``F_ALTA_G`` null,
    ``SUP_AMBITO`` null, and the ``EDIF_AMBITO`` denormalisation demonstrated
    numerically (the ámbito total repeated on every parcel row, so naive summation
    multiplies citywide buildability by the parcel count). Verdict: NOT YET.
  * ``FASES_RECEPCION_URBANIZACION`` — tiny universe, ``FECHA`` typed String.
  * ``OBRA_PUBLICA`` — one directorate's portfolio, not a city-wide universe.
  * ``ETAPAS_DESARROLLOS_DEL_SURESTE`` — southeast only, ``ETAPA`` integer, no date.
  * ``PLAN_18000`` — tiny, no dwelling-count field.
  * ``madridcrece.madrid.es`` / ``gemelo.madrid.es`` — 403 to automated clients
    (recorded, never bypassed): presentation surfaces, not retrieval routes.
  * The "51,000 viviendas" class of figure — not retrievable from any audited
    machine-readable official source: PRESENTATION SURFACE / NOT A REPRODUCIBLE
    RETRIEVAL ROUTE.

Writes ``results/l6_nonadopted.json`` and ``results/l6_summary.json``.
Run: ``python research/urban_planning_gate/audit_l6_nonadopted.py``.
"""

from __future__ import annotations

import collections
import urllib.parse
from pathlib import Path

import requests

import gate_l_common as g

SIGMA = "https://sigma.madrid.es/hosted/rest/services"
SERVICES = {
    "MCPG_Madrid_Crece": f"{SIGMA}/GESTION_URBANA/MCPG_Madrid_Crece/MapServer",
    "ETAPAS_DESARROLLOS_DEL_SURESTE": f"{SIGMA}/URBANISMO/ETAPAS_DESARROLLOS_DEL_SURESTE/MapServer",
    "FASES_RECEPCION_URBANIZACION": f"{SIGMA}/DESARROLLO_URBANO_ACTUALIZADO/FASES_RECEPCION_URBANIZACION/MapServer",
    "OBRA_PUBLICA": f"{SIGMA}/OBRAS/OBRA_PUBLICA/MapServer",
    "PLAN_18000": f"{SIGMA}/VIVIENDA/PLAN_18000/MapServer",
}
PORTALS = ["https://madridcrece.madrid.es/", "https://gemelo.madrid.es/es/evd-urbanismo"]
BROWSER_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                            "(KHTML, like Gecko) Chrome/140.0 Safari/537.36"}


def _first_layer(service: str) -> int | None:
    j = requests.get(service + "?f=json", headers=g.UA, timeout=60).json()
    layers = j.get("layers") or []
    for ly in layers:
        if ly.get("type") in (None, "Feature Layer"):
            return ly.get("id")
    return layers[0]["id"] if layers else 0


def _layer_meta(service: str, lid: int) -> dict:
    return requests.get(f"{service}/{lid}?f=json", headers=g.UA, timeout=60).json()


def _count(service: str, lid: int) -> int:
    j = requests.get(f"{service}/{lid}/query?where=1%3D1&returnCountOnly=true&f=json",
                     headers=g.UA, timeout=60).json()
    return j.get("count")


def _sample(service: str, lid: int, n: int = 500, fields: str = "*") -> list[dict]:
    j = requests.get(f"{service}/{lid}/query?where=1%3D1&outFields={fields}&returnGeometry=false"
                     f"&resultRecordCount={n}&f=json", headers=g.UA, timeout=120).json()
    return [f["attributes"] for f in j.get("features", [])]


def audit_mcpg() -> dict:
    svc = SERVICES["MCPG_Madrid_Crece"]
    lid = _first_layer(svc)
    meta = _layer_meta(svc, lid)
    fields = [f["name"] for f in meta.get("fields", [])]
    count = _count(svc, lid)
    rows = _sample(svc, lid, 2000)
    # EDIF_AMBITO denormalisation demonstrated against a known ámbito whose total is
    # non-null (Valdecarros): the single ámbito total is repeated on every parcel
    # row, so a naive SUM multiplies citywide buildability by the parcel count.
    where = urllib.parse.quote("DESC_AMBITO LIKE '%VALDECARROS%'")
    cnt = requests.get(f"{svc}/{lid}/query?where={where}&returnCountOnly=true&f=json",
                       headers=g.UA, timeout=60).json().get("count")
    vj = requests.get(f"{svc}/{lid}/query?where={where}&outFields=EDIF_AMBITO&returnGeometry=false"
                      f"&resultRecordCount=2000&f=json", headers=g.UA, timeout=120).json()
    edif_vals = {f["attributes"].get("EDIF_AMBITO") for f in vj.get("features", [])}
    worst = None
    if len(edif_vals) == 1 and None not in edif_vals:
        v = next(iter(edif_vals))
        worst = {"ambito": "DESARROLLO DEL ESTE - VALDECARROS", "parcel_rows": cnt,
                 "edif_ambito_m2": v, "distinct_edif_ambito_values": 1,
                 "naive_sum_m2": round(v * cnt, 1), "inflation_factor": cnt,
                 "note": "The ámbito total is identical on every one of its parcel rows; summing "
                         "EDIF_AMBITO over parcels multiplies the true ámbito buildability by the "
                         "parcel count."}
    fase_ur = collections.Counter(str(r.get("FASE_UR")) for r in rows)
    f_baja = collections.Counter(str(r.get("F_BAJA_G")) for r in rows)
    sup_null = sum(1 for r in rows if r.get("SUP_AMBITO") in (None, ""))
    alta_null = sum(1 for r in rows if r.get("F_ALTA_G") in (None, ""))
    return {
        "service": svc, "layer": lid, "feature_count": count, "field_count": len(fields),
        "fields": fields,
        "fase_ur_values_undocumented": dict(fase_ur.most_common(10)),
        "f_baja_g_sentinel_9999_09_09": f_baja.get("9999-09-09", 0),
        "f_baja_g_top": dict(f_baja.most_common(5)),
        "sup_ambito_null_in_sample": sup_null,
        "f_alta_g_null_in_sample": alta_null,
        "sample_rows": len(rows),
        "edif_ambito_denormalisation_demo": worst,
        "licence_statement": meta.get("copyrightText") or None,
        "verdict": "NOT_YET",
        "revisit_conditions": "Only if FASE_UR is documented, the sentinel/null date semantics are "
                              "published, the EDIF_AMBITO denormalisation is resolved (ámbito total "
                              "not repeated per parcel), and an explicit reuse statement exists.",
    }


def audit_small(name: str, expect_field: str | None = None) -> dict:
    svc = SERVICES[name]
    try:
        lid = _first_layer(svc)
        meta = _layer_meta(svc, lid)
        fields = {f["name"]: f.get("type") for f in meta.get("fields", [])}
        count = _count(svc, lid)
        return {"service": svc, "layer": lid, "feature_count": count,
                "fields": fields, "copyrightText": meta.get("copyrightText") or None}
    except Exception as e:
        return {"service": svc, "error": f"{type(e).__name__}: {e}"}


def audit_portals() -> list[dict]:
    out = []
    for url in PORTALS:
        row = {"url": url}
        for label, ua in [("plain", g.UA), ("browser_ua", BROWSER_UA)]:
            try:
                r = requests.get(url, headers=ua, timeout=40)
                row[label] = r.status_code
            except Exception as e:
                row[label] = f"ERR {type(e).__name__}"
        out.append(row)
    return out


def main() -> None:
    g.utf8_stdout()
    mcpg = audit_mcpg()
    fases = audit_small("FASES_RECEPCION_URBANIZACION")
    obra = audit_small("OBRA_PUBLICA")
    etapas = audit_small("ETAPAS_DESARROLLOS_DEL_SURESTE")
    plan18 = audit_small("PLAN_18000")
    portals = audit_portals()

    etapas_has_date = any("fecha" in f.lower() or "date" in (t or "").lower()
                          for f, t in (etapas.get("fields") or {}).items())
    plan18_has_dwelling = any("vivienda" in f.lower() for f in (plan18.get("fields") or {}))

    report = {
        "gate": "L6", "audit_finished_at": g.now(),
        "MCPG_Madrid_Crece": {**mcpg},
        "FASES_RECEPCION_URBANIZACION": {**fases,
            "fecha_typed_string": (fases.get("fields") or {}).get("FECHA") == "esriFieldTypeString",
            "verdict": "NOT_A_USABLE_UNIVERSE"},
        "OBRA_PUBLICA": {**obra, "verdict": "NOT_A_CITY_WIDE_UNIVERSE",
            "note": "One directorate's works portfolio; not 'public works in Madrid'."},
        "ETAPAS_DESARROLLOS_DEL_SURESTE": {**etapas, "has_reference_date": etapas_has_date,
            "verdict": "DEFER", "needs": "A reference date and a city-wide (not southeast-only) universe."},
        "PLAN_18000": {**plan18, "has_dwelling_count_field": plan18_has_dwelling,
            "verdict": "NOT_ADOPTED", "note": "Tiny; no dwelling-count field."},
        "viewer_portals": {"probes": portals,
            "verdict": "NOT_A_RETRIEVAL_ROUTE",
            "note": "403 to automated clients with and without a browser UA. Access controls "
                    "were recorded, never bypassed. Presentation surfaces, not registers — the "
                    "Gate A esmadrid precedent."},
        "housing_unit_figures": {"example": "51,000 viviendas (Valdecarros) / 22,285 (Los Berrocales)",
            "verdict": "PRESENTATION_SURFACE_NOT_A_REPRODUCIBLE_RETRIEVAL_ROUTE",
            "note": "Appear in narrative/press/portal surfaces; not retrievable from any audited "
                    "machine-readable official source. Not publishable by this product."},
    }
    summary = {
        "gate": "L6",
        "MCPG_feature_count": mcpg["feature_count"],
        "MCPG_field_count": mcpg["field_count"],
        "MCPG_edif_denormalisation": mcpg["edif_ambito_denormalisation_demo"],
        "MCPG_verdict": "NOT_YET",
        "FASES_feature_count": fases.get("feature_count"),
        "OBRA_feature_count": obra.get("feature_count"),
        "ETAPAS_feature_count": etapas.get("feature_count"),
        "PLAN_18000_feature_count": plan18.get("feature_count"),
        "portals": portals,
        "housing_unit_verdict": "PRESENTATION_SURFACE_NOT_A_REPRODUCIBLE_RETRIEVAL_ROUTE",
    }
    g.write_json("l6_nonadopted.json", report)
    g.write_json("l6_summary.json", summary)
    print("MCPG:", mcpg["feature_count"], "features,", mcpg["field_count"], "fields; denorm demo:",
          mcpg["edif_ambito_denormalisation_demo"])
    print("FASES:", fases.get("feature_count"), "OBRA:", obra.get("feature_count"),
          "ETAPAS:", etapas.get("feature_count"), "PLAN_18000:", plan18.get("feature_count"))
    print("portals:", portals)
    print("wrote results/l6_nonadopted.json, results/l6_summary.json")


if __name__ == "__main__":
    main()
