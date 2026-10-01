#!/usr/bin/env python3
"""Gate H probe for Madrid destination-origin evidence.

This is a research probe, not a production builder. It interrogates INE's
official Tempus3 JSON API for the two municipality-level origin tables already
identified in Gate C0:

- domestic origin municipality -> destination municipality (table 53001)
- inbound country of residence -> destination municipality (table 52048)

The probe is deliberately compact: resolve the destination-municipality group,
prove Madrid is official municipality code 28079, fetch only the Madrid slice,
and report the source unit, periods and null/secrecy/zero semantics.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_ROOT = "https://servicios.ine.es/wstempus/js/ES"
SERIES_ROOT = "https://servicios.ine.es/wstempus/jsCache/ES"
TABLES = {
    "domestic": {
        "table_id": 53001,
        "title": "Número de turistas por municipio de origen y destino",
    },
    "inbound": {
        "table_id": 52048,
        "title": "RECEPTOR - Número de turistas mensuales por municipio de destino, desglosados por continente y país de residencia.",
    },
}
MADRID_CODE = "28079"
MADRID_NAME = "Madrid"
OUT = Path("research/destination_origin/probe_report.json")


def fetch_json(
    path: str,
    params: list[tuple[str, str | int]] | None = None,
    timeout: int = 180,
    root: str = API_ROOT,
):
    query = urllib.parse.urlencode(params or [])
    url = f"{root}/{path}" + (f"?{query}" if query else "")
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "madrid-tourism-intelligence-lens/1.0 Gate-H source probe",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        raw = response.read()
    if not raw.strip():
        raise RuntimeError(f"{url} returned an empty body")
    return json.loads(raw.decode("utf-8")), url


def text(value) -> str:
    return str(value or "").strip()


def item_name(item: dict) -> str:
    for key in ("Nombre", "nombre", "Name", "name"):
        if key in item:
            return text(item[key])
    return ""


def item_id(item: dict):
    for key in ("Id", "id", "ID"):
        if key in item:
            return item[key]
    return None


def item_code(item: dict) -> str:
    for key in ("Codigo", "Código", "codigo", "code", "Cod"):
        if key in item:
            return text(item[key])
    return ""


def find_destination_group(groups: list[dict]) -> dict:
    candidates = []
    for group in groups:
        name = item_name(group).casefold()
        if "municipio" in name and "destino" in name:
            candidates.append(group)
    if len(candidates) != 1:
        raise RuntimeError(
            f"expected exactly one destination-municipality group, found {len(candidates)}: "
            f"{[item_name(g) for g in candidates]}"
        )
    return candidates[0]


def find_madrid_value(values: list[dict]) -> dict:
    exact_code = [v for v in values if item_code(v) == MADRID_CODE]
    if len(exact_code) == 1:
        return exact_code[0]
    exact_name = [v for v in values if item_name(v).casefold() == MADRID_NAME.casefold()]
    if len(exact_name) == 1:
        return exact_name[0]
    matches = [
        {"id": item_id(v), "name": item_name(v), "code": item_code(v)}
        for v in values
        if "madrid" in item_name(v).casefold() or MADRID_CODE in item_code(v)
    ]
    raise RuntimeError(f"Madrid municipality 28079 not uniquely resolved: {matches[:20]}")


def flatten_series(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("Data", "data", "Series", "series"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
        preview = json.dumps(payload, ensure_ascii=False)[:1200]
        raise RuntimeError(
            f"unexpected SERIES_TABLA object keys={list(payload)[:20]} preview={preview}"
        )
    raise RuntimeError(f"unexpected SERIES_TABLA shape: {type(payload).__name__}")


def observations(series: dict) -> list[dict]:
    for key in ("Data", "data"):
        value = series.get(key)
        if isinstance(value, list):
            return value
    return []


def unit_catalog() -> dict[str, str]:
    payload, _ = fetch_json("UNIDADES")
    if not isinstance(payload, list):
        return {}
    return {str(item_id(x)): item_name(x) for x in payload if item_id(x) is not None}


def analyse_table(kind: str, spec: dict, units: dict[str, str]) -> dict:
    table_id = spec["table_id"]
    result = {
        "kind": kind,
        "table_id": table_id,
        "title": spec["title"],
        "reachable": False,
    }

    try:
        groups, groups_url = fetch_json(f"GRUPOS_TABLA/{table_id}")
        if not isinstance(groups, list):
            raise RuntimeError("GRUPOS_TABLA did not return a list")

        dest_group = find_destination_group(groups)
        group_id = item_id(dest_group)
        if group_id is None:
            raise RuntimeError("destination-municipality group has no Id")

        values, values_url = fetch_json(f"VALORES_GRUPOSTABLA/{table_id}/{group_id}", [("det", 1)])
        if not isinstance(values, list):
            raise RuntimeError("VALORES_GRUPOSTABLA did not return a list")
        madrid = find_madrid_value(values)

        madrid_id = item_id(madrid)
        madrid_code = item_code(madrid)
        if madrid_id is None:
            raise RuntimeError("Madrid destination value has no Id")
        if madrid_code and madrid_code != MADRID_CODE:
            raise RuntimeError(f"Madrid destination carries code {madrid_code}, not {MADRID_CODE}")

        # GRUPOS_TABLA returns a table-group id, which is not necessarily the
        # Tempus3 variable id accepted by tv=. With det=1, each value exposes
        # the underlying variable identity; use that instead of guessing.
        variable = madrid.get("Variable")
        variable_id = (
            madrid.get("FK_Variable")
            or madrid.get("IdVariable")
            or (variable.get("Id") if isinstance(variable, dict) else variable)
            or madrid.get("FKVariable")
        )
        result.update(
            {
                "destination_group_raw": dest_group,
                "madrid_raw": madrid,
                "destination_variable_id": variable_id,
            }
        )
        if variable_id is None:
            raise RuntimeError(
                f"Madrid value exposes no Tempus3 variable id; keys={list(madrid)[:30]}"
            )

        # GRUPOS_TABLA/VALORES_GRUPOSTABLA expose ordinary Tempus3 numeric
        # variable/value identifiers here, so the documented filter is
        # tv=id_variable:id_valor (19:2813 for Madrid).
        destination_filter = f"{variable_id}:{madrid_id}"
        data_payload, data_url = fetch_json(
            f"DATOS_TABLA/{table_id}",
            [
                ("nult", 2),
                ("tip", "AM"),
                ("det", 2),
                ("tv", destination_filter),
            ],
        )
        series = flatten_series(data_payload)
        if not series:
            raise RuntimeError("Madrid-filtered DATOS_TABLA returned zero series")

        unit_ids = sorted(
            {
                str(s.get("FK_Unidad"))
                for s in series
                if s.get("FK_Unidad") is not None
            }
        )

        def series_code(s):
            return text(s.get("COD") or s.get("Cod") or s.get("Codigo"))

        coded = sorted((s for s in series if series_code(s)), key=series_code)
        sample = coded[:8]
        all_obs = [row for s in series for row in observations(s)]
        sample_series = []
        for s in sample:
            code = series_code(s)
            defining_values = []
            try:
                vals, _ = fetch_json(f"VALORES_SERIE/{code}", [("det", 1)])
                if isinstance(vals, list):
                    defining_values = [
                        {
                            "variable_id": (
                                v.get("FK_Variable")
                                or (
                                    v.get("Variable", {}).get("Id")
                                    if isinstance(v.get("Variable"), dict)
                                    else v.get("Variable")
                                )
                            ),
                            "value_id": item_id(v),
                            "name": item_name(v),
                            "code": item_code(v) or None,
                        }
                        for v in vals
                        if item_name(v)
                    ]
            except Exception:
                defining_values = []

            sample_series.append(
                {
                    "code": code,
                    "name": s.get("Nombre"),
                    "unit_id": s.get("FK_Unidad"),
                    "unit_name": units.get(str(s.get("FK_Unidad"))),
                    "periodicity": s.get("FK_Periodicidad"),
                    "observations": len(observations(s)),
                    "defining_values": defining_values,
                }
            )

        periods = sorted(
            {
                f"{row.get('Anyo'):04d}-{int(row.get('FK_Periodo')):02d}"
                for row in all_obs
                if isinstance(row.get("Anyo"), int)
                and isinstance(row.get("FK_Periodo"), int)
                and 1 <= int(row.get("FK_Periodo")) <= 12
            }
        )

        null_count = sum(1 for row in all_obs if row.get("Valor") is None)
        secret_count = sum(1 for row in all_obs if row.get("Secreto") is True)
        zero_count = sum(
            1
            for row in all_obs
            if isinstance(row.get("Valor"), (int, float)) and row.get("Valor") == 0
        )
        unknown_null = sum(
            1 for row in all_obs if row.get("Valor") is None and row.get("Secreto") is not True
        )

        result.update(
            {
                "reachable": True,
                "groups_url": groups_url,
                "values_url": values_url,
                "data_url": data_url,
                "destination_filter": destination_filter,
                "destination_group": {
                    "id": group_id,
                    "name": item_name(dest_group),
                },
                "madrid": {
                    "id": madrid_id,
                    "name": item_name(madrid),
                    "code": madrid_code or None,
                },
                "series_count": len(series),
                "observation_count": len(all_obs),
                "unit_ids": unit_ids,
                "unit_names": [units.get(x) for x in unit_ids],
                "periods": periods,
                "null_count": null_count,
                "secret_count": secret_count,
                "true_zero_count": zero_count,
                "null_without_secret_flag": unknown_null,
                "sample_series": sample_series,
            }
        )
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"

    return result


def main() -> int:
    report = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "source": "INE Tempus3 JSON API",
        "api_root": API_ROOT,
        "madrid_required_code": MADRID_CODE,
        "tables": {},
    }

    try:
        units = unit_catalog()
        report["unit_catalog_reachable"] = True
    except Exception as exc:
        units = {}
        report["unit_catalog_reachable"] = False
        report["unit_catalog_error"] = f"{type(exc).__name__}: {exc}"

    for kind, spec in TABLES.items():
        report["tables"][kind] = analyse_table(kind, spec, units)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps(report, ensure_ascii=False, indent=2))
    # A blocked source is a Gate-H finding, not a CI infrastructure failure.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
