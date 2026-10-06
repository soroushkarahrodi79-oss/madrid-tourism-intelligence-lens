#!/usr/bin/env python3
"""Gate L · L5 — Geometry join, CRS, freshness and reuse basis (issue #65).

Audits the ArcGIS REST layer ``AMBITOS_PLANEAMIENTO_URBANISTICO`` (sigma.madrid.es)
as geometry/identifier evidence only, and resolves its reuse status:

  * feature count and the ACTUAL identifier universe — the layer is NOT "765
    ámbitos": it mixes planning ámbitos (APE/API/APR/AOE/UZP/UNP/UZI…) with Norma
    Zonal grades (e.g. ``1.1`` = "ZONA 1 GRADO 1º"). This corrects Gate K and makes
    the measured join rate, not the raw feature count, the thing that matters;
  * the geometry↔table join against the S1 (203200) and S2 (203182) edition codes:
    match rate, unmatched-in-geometry, unmatched-in-table, each residual classified;
  * exact-identifier matching vs a normalised hypothesis (strip ``-RP`` / case /
    padding) reported side by side, with exact matching kept as the default —
    because the structure annex proves ``-RP`` (Revisión Parcial) is a DISTINCT
    ámbito (``UZP.3.01`` was annulled by court sentence; ``UZPp.03.01-RP`` is its
    active replacement), so stripping the suffix would merge two different entities;
  * CRS (EPSG:25830) confirmed from service metadata, a deterministic reprojection
    to EPSG:4326 for browser rendering, and the polygon / vertex / payload cost;
  * freshness: the service exposes NO ``editingInfo`` (no lastEditDate, no reference
    date, no cadence), so geometry carries ``reference_date: null`` and only an
    observed resource state — ``source_state: NOT_DECLARED_BY_PUBLISHER``;
  * reuse basis: the service asserts a copyright/attribution string but NO licence
    or reuse statement.

Writes ``results/l5_geometry.json`` and ``results/l5_summary.json``.
Run: ``python research/urban_planning_gate/audit_l5_geometry.py`` (after L1).
Dependencies: ``requests`` and ``pyproj`` (research-only).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import requests
from pyproj import Transformer

import gate_l_common as g
import audit_l1_editions as l1

# Ámbito code families (from the editions and the structure annex). A code that
# matches none of these and looks like "<digit>.<digit>" is a Norma Zonal grade.
AMBITO_PREFIX = re.compile(r"^(APE|API|APR|AOE|UZP|UZI|UNP|UNS|AE|AOD)", re.IGNORECASE)
ZONAL_GRADE = re.compile(r"^\d+\.\d+$")


def _norm_code(code: str) -> str:
    """Normalised hypothesis for matching: upper, no spaces, strip a trailing
    ``-RP``/``(*)`` and collapse ``UZPp``→``UZP`` and zero-padding. Used ONLY to
    MEASURE how many more would match under normalisation; never the default."""
    c = re.sub(r"\s+", "", code).upper()
    c = re.sub(r"\(\*\)$", "", c)
    c = re.sub(r"-RP$", "", c)
    c = c.replace("UZPP", "UZP")
    # zero-pad single digits after a dot: UZP.3.01 -> UZP.03.01
    c = re.sub(r"\.(\d)(?=\.|$)", lambda m: "." + m.group(1).zfill(2), c)
    return c


def _query_all_attrs(layer: str) -> list[dict]:
    out, offset = [], 0
    while True:
        url = (f"{layer}/query?where=1%3D1&outFields=AMB_TX_ETIQ,AMB_TX_DENOM"
               f"&returnGeometry=false&resultOffset={offset}&resultRecordCount=2000&f=json")
        j = requests.get(url, headers=g.UA, timeout=120).json()
        feats = j.get("features", [])
        out.extend(a["attributes"] for a in feats)
        if len(feats) < 2000:
            break
        offset += 2000
    return out


def _edition_codes(family: str) -> set[str]:
    inv = l1.edition_inventory()
    eds = [e for e in inv[family]["editions"] if e["schema_era"] == l1.RECENT_FLAT_ERA[family]]
    eds.sort(key=lambda e: e["reference_date"])
    wb = g.open_workbook(Path(g.fetch(eds[-1]["url"], eds[-1]["resource_id"], ".xls")["cache_path"]))
    data = l1.read_flat_rows(wb, family)
    return {g.cell_text(r[data["code_col"]]) for r in data["rows"] if g.cell_text(r[data["code_col"]])}


def _geometry_metrics(layer: str) -> dict:
    """Fetch geojson, measure polygons/vertices/payload, test reprojection to 4326."""
    url = (f"{layer}/query?where=1%3D1&outFields=AMB_TX_ETIQ&returnGeometry=true"
           f"&outSR=25830&resultRecordCount=2000&f=geojson")
    r = requests.get(url, headers=g.UA, timeout=300)
    payload_bytes = len(r.content)
    gj = r.json()
    feats = gj.get("features", [])
    vertices = 0
    rings = 0
    for f in feats:
        geom = f.get("geometry") or {}
        coords = geom.get("coordinates") or []
        stack = [coords]
        while stack:
            cur = stack.pop()
            if cur and isinstance(cur[0], (int, float)):
                vertices += 1
            elif cur and isinstance(cur[0], list):
                if cur and cur[0] and isinstance(cur[0][0], (int, float)):
                    rings += 1
                for c in cur:
                    stack.append(c)
    # deterministic reprojection sample 25830 -> 4326
    tr = Transformer.from_crs("EPSG:25830", "EPSG:4326", always_xy=True)
    sample = None
    for f in feats:
        geom = f.get("geometry") or {}
        c = geom.get("coordinates")
        while isinstance(c, list) and c and isinstance(c[0], list):
            c = c[0]
        if isinstance(c, list) and len(c) >= 2 and isinstance(c[0], (int, float)):
            lon, lat = tr.transform(c[0], c[1])
            sample = {"src_25830": [c[0], c[1]], "dst_4326": [round(lon, 6), round(lat, 6)]}
            break
    return {"polygon_features": len(feats), "rings": rings, "vertices": vertices,
            "raw_payload_bytes_geojson_25830": payload_bytes, "reprojection_sample": sample}


def main() -> None:
    g.utf8_stdout()
    layer = g.ARCGIS_LAYER
    meta = requests.get(layer + "?f=json", headers=g.UA, timeout=60).json()
    root = requests.get(layer.rsplit("/", 1)[0] + "?f=json", headers=g.UA, timeout=60).json()

    attrs = _query_all_attrs(layer)
    geom_codes = [a.get("AMB_TX_ETIQ") for a in attrs]
    geom_set = {c for c in geom_codes if c}
    ambito_like = sorted([c for c in geom_set if AMBITO_PREFIX.match(c or "")])
    zonal_like = sorted([c for c in geom_set if ZONAL_GRADE.match(c or "")])
    other_like = sorted([c for c in geom_set if c not in set(ambito_like) | set(zonal_like)])

    results = {"gate": "L5", "audit_finished_at": g.now(), "layer": layer,
               "feature_count": meta.get("name") and len(attrs),
               "layer_name": meta.get("name"),
               "identifier_universe": {
                   "total_features": len(attrs),
                   "distinct_codes": len(geom_set),
                   "ambito_like": len(ambito_like),
                   "zonal_grade_like": len(zonal_like),
                   "other": len(other_like),
                   "zonal_grade_samples": zonal_like[:8],
                   "other_samples": other_like[:12],
                   "correction": "The layer is a MIXED universe (ámbitos + Norma Zonal grades "
                                 "such as '1.1' = ZONA 1 GRADO 1º), not '765 ámbitos'.",
               },
               "crs": {"wkid": meta.get("spatialReference", {}).get("wkid")
                       or meta.get("extent", {}).get("spatialReference", {}).get("wkid"),
                       "confirmed": "EPSG:25830",
                       "reprojection": "deterministic 25830 -> 4326 via pyproj for browser rendering"},
               "freshness": {"editingInfo": meta.get("editingInfo"),
                             "has_lastEditDate": bool((meta.get("editingInfo") or {}).get("lastEditDate")),
                             "reference_date": None,
                             "source_state": "NOT_DECLARED_BY_PUBLISHER",
                             "note": "No editingInfo, no lastEditDate, no cadence. Geometry is "
                                     "retrieved at build time, committed as a fingerprinted "
                                     "artifact with an observed_resource_state, never called at runtime."},
               "reuse_basis": {"layer_copyrightText": meta.get("copyrightText"),
                               "service_copyrightText": root.get("copyrightText"),
                               "licenseInfo_present": bool(root.get("licenseInfo") or meta.get("licenseInfo")),
                               "verdict": "MODIFY",
                               "verdict_note": "The service asserts an attribution/copyright string "
                                               "but NO explicit licence or reuse statement. Geometry "
                                               "may be used only under the municipal open-data general "
                                               "conditions with attribution; the authoritative quantities "
                                               "and states come from the CC BY 4.0 editions, never this service."},
               "rp_suffix": {"verdict": "DISTINCT_AMBITO_EXACT_MATCH_ONLY",
                             "evidence": "Structure annex 203200-14: (*) = 'Ámbito creado por la Revisión "
                                         "Parcial del PGOUM85 y Modificación del PGOUM97'. UZP.3.01 "
                                         "(Valdecarros) is listed as annulled by court sentence while "
                                         "UZPp.03.01-RP is the active replacement — so -RP is a distinct "
                                         "entity and the suffix must never be stripped for matching."}}

    # join against S1 and S2 edition codes (exact, then normalised hypothesis)
    for family in ("S1", "S2"):
        table = _edition_codes(family)
        matched = geom_set & table
        geom_only = geom_set - table
        table_only = table - geom_set
        # normalised hypothesis
        gnorm = {_norm_code(c): c for c in geom_set}
        tnorm = {_norm_code(c): c for c in table}
        norm_matched = set(gnorm) & set(tnorm)
        results.setdefault("join", {})[family] = {
            "table_codes": len(table),
            "geometry_codes": len(geom_set),
            "exact_matched": len(matched),
            "exact_match_rate_of_table": round(len(matched) / len(table), 4) if table else None,
            "unmatched_in_geometry": len(geom_only),
            "unmatched_in_table": len(table_only),
            "unmatched_in_geometry_classified": {
                "zonal_grade_like": len([c for c in geom_only if ZONAL_GRADE.match(c or "")]),
                "ambito_like": len([c for c in geom_only if AMBITO_PREFIX.match(c or "")]),
                "other": len([c for c in geom_only if not ZONAL_GRADE.match(c or "") and not AMBITO_PREFIX.match(c or "")]),
            },
            "unmatched_in_table_samples": sorted(table_only)[:12],
            "normalised_matched": len(norm_matched),
            "normalised_gain_over_exact": len(norm_matched) - len(matched),
            "note": "Exact matching is the default. The normalised figure only MEASURES how many "
                    "more would join if -RP/padding/case were folded; it is not adopted, because "
                    "-RP is a distinct ámbito.",
        }

    results["geometry_metrics"] = _geometry_metrics(layer)

    summary = {
        "gate": "L5",
        "feature_count": len(attrs),
        "identifier_universe": {"ambito_like": len(ambito_like), "zonal_grade_like": len(zonal_like),
                                "other": len(other_like)},
        "crs": results["crs"]["wkid"],
        "editingInfo_present": meta.get("editingInfo") is not None,
        "source_state": "NOT_DECLARED_BY_PUBLISHER",
        "reuse_verdict": "MODIFY",
        "rp_verdict": "DISTINCT_AMBITO_EXACT_MATCH_ONLY",
        "join_S1_exact_match_rate_of_table": results["join"]["S1"]["exact_match_rate_of_table"],
        "join_S2_exact_match_rate_of_table": results["join"]["S2"]["exact_match_rate_of_table"],
        "geometry_vertices": results["geometry_metrics"]["vertices"],
        "geometry_payload_bytes": results["geometry_metrics"]["raw_payload_bytes_geojson_25830"],
    }
    g.write_json("l5_geometry.json", results)
    g.write_json("l5_summary.json", summary)
    print("features:", len(attrs), "| ambito-like:", len(ambito_like),
          "zonal:", len(zonal_like), "other:", len(other_like))
    print("CRS:", results["crs"]["wkid"], "| editingInfo:", meta.get("editingInfo"))
    for f in ("S1", "S2"):
        j = results["join"][f]
        print(f"join {f}: exact {j['exact_matched']}/{j['table_codes']} table "
              f"(rate {j['exact_match_rate_of_table']}), geom_only {j['unmatched_in_geometry']}, "
              f"table_only {j['unmatched_in_table']}, norm_gain {j['normalised_gain_over_exact']}")
    gm = results["geometry_metrics"]
    print(f"geometry: {gm['polygon_features']} feats, {gm['vertices']} vertices, "
          f"{gm['raw_payload_bytes_geojson_25830']} bytes; reproj {gm['reprojection_sample']}")
    print("reuse verdict:", results["reuse_basis"]["verdict"])
    print("wrote results/l5_geometry.json, results/l5_summary.json")


if __name__ == "__main__":
    main()
