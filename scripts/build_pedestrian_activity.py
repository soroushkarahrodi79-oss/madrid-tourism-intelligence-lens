#!/usr/bin/env python3
"""Build a bounded deployment snapshot of Madrid permanent pedestrian counters.

Source: Madrid Open Data dataset 300321, 2024 permanent pedestrian resource.
The source reports pedestrian counts at fixed stations by date and hour.
The builder reads the official CKAN DataStore API first and retains the direct
CSV download as a fallback. It aggregates raw rows to station-level summaries
so the static app never needs to ship or fetch the large source in the browser.
"""

from __future__ import annotations

import csv
import io
import json
import math
import re
import sys
import unicodedata
import urllib.request
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

SOURCE_URL = (
    "https://datos.madrid.es/dataset/300321-0-aforos-peatones-bicicletas/"
    "resource/300321-0-aforos-peatones-bicicletas-csv/download/"
    "300321-0-aforos-peatones-bicicletas-csv.csv"
)
DATASET_URL = "https://datos.madrid.es/dataset/300321-0-aforos-peatones-bicicletas"
OUTPUT_PATH = Path("data/pedestrian_activity.json")
SOURCE_YEAR = 2024
RESOURCE_ID = "300321-0-aforos-peatones-bicicletas-csv"
DATASTORE_URL = "https://datos.madrid.es/api/3/action/datastore_search"
DATASTORE_PAGE_SIZE = 5000

LAT_MIN, LAT_MAX = 40.385, 40.455
LON_MIN, LON_MAX = -3.745, -3.645


def normalize_header(value: str | None) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.strip().casefold()
    return re.sub(r"[^a-z0-9]+", "_", text).strip("_")


def parse_number(value: str | None) -> float | None:
    if value is None:
        return None
    text = str(value).strip().replace(" ", "")
    if not text:
        return None
    # Counts may use a decimal comma in exported CSV variants.
    if text.count(",") == 1 and text.count(".") == 0:
        text = text.replace(",", ".")
    try:
        number = float(text)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def parse_coordinate(value: str | None) -> float | None:
    """Parse Madrid's coordinate strings without inventing locations.

    The 2024 pedestrian resource currently serialises coordinates such as
    "40.417.386" and "-3.707.141". Those are the documented WGS84 values
    40.417386 / -3.707141 with digit-group separators inserted after the
    decimal point. Normal decimal-dot/comma forms are also accepted.
    """
    if value is None:
        return None
    text = str(value).strip().replace(" ", "").replace(",", ".")
    if not text:
        return None

    sign = ""
    if text[0] in "+-":
        sign, text = text[0], text[1:]

    parts = text.split(".")
    if len(parts) > 2 and all(part.isdigit() for part in parts):
        text = parts[0] + "." + "".join(parts[1:])

    try:
        number = float(sign + text)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def parse_date(value: str | None) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    # Production records may include the hour in the fecha field.
    date_text = text.split()[0]
    for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(date_text, fmt)
        except ValueError:
            pass
    return None


def decode_csv(payload: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return payload.decode(encoding)
        except UnicodeDecodeError:
            continue
    return payload.decode("latin-1", errors="replace")


def row_value(row: dict[str, str], *aliases: str) -> str:
    for alias in aliases:
        key = normalize_header(alias)
        if key in row and str(row[key] or "").strip():
            return str(row[key]).strip()
    return ""


def normalized_rows(text: str):
    sample = text[:8192]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t,")
    except csv.Error:
        dialect = csv.excel
        dialect.delimiter = ";"

    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    for raw in reader:
        yield {normalize_header(k): (v or "").strip() for k, v in raw.items() if k is not None}


def parse_pedestrian_rows(rows) -> dict:
    groups: dict[tuple[str, float, float], dict] = {}
    accepted_rows = 0
    rejected_rows = 0

    for row in rows:
        lat = parse_coordinate(row_value(row, "latitude", "latitud"))
        lon = parse_coordinate(row_value(row, "longitude", "longitud"))
        pedestrians = parse_number(row_value(row, "peatones", "bicicletas/peatones", "bicicletas_peatones"))

        if lat is None or lon is None or pedestrians is None or pedestrians < 0:
            rejected_rows += 1
            continue
        if not (LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX):
            continue

        station_id = row_value(row, "identificador", "device_id") or f"{lat:.6f},{lon:.6f}"
        key = (station_id, round(lat, 6), round(lon, 6))
        address = row_value(row, "direccion", "nombre_vial")
        district = row_value(row, "distrito")
        date_obj = parse_date(row_value(row, "fecha"))
        date_iso = date_obj.date().isoformat() if date_obj else ""

        if key not in groups:
            groups[key] = {
                "id": f"pedestrian-{station_id}",
                "type": "pedestrian",
                "name": address or f"Pedestrian counter {station_id}",
                "stationId": station_id,
                "district": district,
                "address": address,
                "lat": lat,
                "lon": lon,
                "sumPedestrians": 0.0,
                "observationCount": 0,
                "dateMin": date_iso,
                "dateMax": date_iso,
            }

        g = groups[key]
        g["sumPedestrians"] += pedestrians
        g["observationCount"] += 1
        if date_iso:
            if not g["dateMin"] or date_iso < g["dateMin"]:
                g["dateMin"] = date_iso
            if not g["dateMax"] or date_iso > g["dateMax"]:
                g["dateMax"] = date_iso
        if not g["address"] and address:
            g["address"] = address
            g["name"] = address
        if not g["district"] and district:
            g["district"] = district
        accepted_rows += 1

    stations = []
    total_sum = 0.0
    total_obs = 0
    for g in groups.values():
        obs = g["observationCount"]
        if not obs:
            continue
        mean_observed = g["sumPedestrians"] / obs
        total_sum += g["sumPedestrians"]
        total_obs += obs
        stations.append(
            {
                "id": g["id"],
                "type": "pedestrian",
                "name": g["name"],
                "stationId": g["stationId"],
                "district": g["district"],
                "address": g["address"],
                "lat": round(g["lat"], 7),
                "lon": round(g["lon"], 7),
                "meanObserved": round(mean_observed, 1),
                "observationCount": obs,
                "dateMin": g["dateMin"],
                "dateMax": g["dateMax"],
            }
        )

    stations.sort(key=lambda x: (x["name"].casefold(), x["stationId"]))
    dates = [d for s in stations for d in (s["dateMin"], s["dateMax"]) if d]

    return {
        "stations": stations,
        "stationCount": len(stations),
        "observationCount": total_obs,
        "meanObserved": round(total_sum / total_obs, 1) if total_obs else None,
        "dateMin": min(dates) if dates else None,
        "dateMax": max(dates) if dates else None,
        "acceptedRows": accepted_rows,
        "rejectedRows": rejected_rows,
    }


def parse_pedestrian_csv(text: str) -> dict:
    return parse_pedestrian_rows(normalized_rows(text))


def datastore_rows(timeout: int = 60):
    offset = 0
    total = None

    while True:
        query = urllib.parse.urlencode(
            {
                "resource_id": RESOURCE_ID,
                "limit": DATASTORE_PAGE_SIZE,
                "offset": offset,
            }
        )
        payload = fetch_bytes(
            f"{DATASTORE_URL}?{query}",
            timeout=timeout,
            accept="application/json",
        )
        decoded = json.loads(payload.decode("utf-8"))
        if not decoded.get("success"):
            raise RuntimeError("Madrid CKAN DataStore returned success=false")

        result = decoded.get("result") or {}
        records = result.get("records") or []
        if total is None:
            total_value = result.get("total")
            total = int(total_value) if isinstance(total_value, (int, float)) else None

        for raw in records:
            yield {
                normalize_header(k): ("" if v is None else str(v).strip())
                for k, v in raw.items()
                if k is not None
            }

        offset += len(records)
        if not records or (total is not None and offset >= total):
            break


def fetch_bytes(url: str, timeout: int = 60, accept: str = "text/csv,text/plain,*/*") -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            "Accept": accept,
            "User-Agent": (
                "madrid-tourism-intelligence-lens/1.0 "
                "(+https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens)"
            ),
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read()


def unavailable_payload(error: str) -> dict:
    return {
        "available": False,
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "source": {
            "dataset": "Madrid Open Data — Aforos de peatones y bicicletas",
            "datasetUrl": DATASET_URL,
            "resourceUrl": SOURCE_URL,
            "resourceId": RESOURCE_ID,
            "dataApiUrl": DATASTORE_URL,
            "year": SOURCE_YEAR,
        },
        "scope": {
            "latMin": LAT_MIN,
            "latMax": LAT_MAX,
            "lonMin": LON_MIN,
            "lonMax": LON_MAX,
        },
        "recordSemantics": "Published permanent pedestrian-counter observations by date and hour; not tourism-specific.",
        "stations": [],
        "stationCount": 0,
        "observationCount": 0,
        "dateMin": None,
        "dateMax": None,
        "error": error,
    }


def main() -> int:
    retrieval_route = None
    retrieval_errors: list[str] = []
    try:
        try:
            parsed = parse_pedestrian_rows(datastore_rows())
            retrieval_route = "ckan_datastore_search"
        except Exception as api_exc:
            retrieval_errors.append(f"CKAN DataStore: {api_exc}")
            payload = fetch_bytes(SOURCE_URL)
            parsed = parse_pedestrian_csv(decode_csv(payload))
            retrieval_route = "csv_download_fallback"

        if not parsed["stations"]:
            raise RuntimeError("source produced zero valid pedestrian stations inside the central-Madrid envelope")

        output = {
            "available": True,
            "generatedAt": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
            "source": {
                "dataset": "Madrid Open Data — Aforos de peatones y bicicletas",
                "datasetUrl": DATASET_URL,
                "resourceUrl": SOURCE_URL,
                "resourceId": RESOURCE_ID,
                "dataApiUrl": DATASTORE_URL,
                "retrievalRoute": retrieval_route,
                "year": SOURCE_YEAR,
            },
            "scope": {
                "latMin": LAT_MIN,
                "latMax": LAT_MAX,
                "lonMin": LON_MIN,
                "lonMax": LON_MAX,
            },
            "recordSemantics": "Published permanent pedestrian-counter observations by date and hour; not tourism-specific.",
            "latestPublishedQuarterMayBeProvisional": True,
            **parsed,
            "error": None,
        }
    except Exception as exc:
        detail = "; ".join(retrieval_errors + [str(exc)]) if retrieval_errors else str(exc)
        print(f"[pedestrian-activity] unavailable: {detail}", file=sys.stderr)
        output = unavailable_payload(detail)

    OUTPUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        "[pedestrian-activity] "
        f"available={output['available']} stations={output['stationCount']} observations={output['observationCount']} "
        f"route={output.get('source', {}).get('retrievalRoute', 'none')}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
