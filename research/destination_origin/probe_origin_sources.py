#!/usr/bin/env python3
"""Gate H-A probe: Dataestur domestic municipality-origin evidence for Madrid.

Research probe only. The official Dataestur OpenAPI documents
/TURISMO_INTERNO_MUN_MUN_DL with one required year parameter and a CSV response.
This probe streams the file, fingerprints it, identifies its schema, and retains
only bounded evidence for destination municipality Madrid (28079).
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE_URL = "https://www.dataestur.es/API-SEGITTUR-v2/TURISMO_INTERNO_MUN_MUN_DL"
YEARS_TO_TRY = (2025,)
MADRID_CODE = "28079"
OUT = Path("research/destination_origin/dataestur_domestic_probe.json")


def norm(value: str) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "_", text.casefold()).strip("_")


def delimiter_from(header_line: str) -> str:
    candidates = [";", ",", "\t", "|"]
    return max(candidates, key=header_line.count)


def request_year(year: int):
    query = urllib.parse.urlencode({"año": year})
    url = f"{BASE_URL}?{query}"
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/octet-stream,text/csv,*/*",
            "User-Agent": "madrid-tourism-intelligence-lens/1.0 Gate-H-A probe",
        },
    )
    return urllib.request.urlopen(req, timeout=240), url


def decode(raw: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def parse_row(line: str, delimiter: str) -> list[str]:
    return next(csv.reader([line], delimiter=delimiter))


def choose_destination_columns(headers: list[str]) -> list[int]:
    result = []
    for idx, header in enumerate(headers):
        n = norm(header)
        if "destino" not in n:
            continue
        if any(token in n for token in ("codigo", "cod_", "municipio", "ine")):
            result.append(idx)
    return result


def choose_measure_columns(headers: list[str]) -> list[int]:
    result = []
    for idx, header in enumerate(headers):
        n = norm(header)
        if any(token in n for token in ("turista", "viaje", "valor", "numero", "flujo")):
            if not any(token in n for token in ("origen", "destino", "codigo", "municipio")):
                result.append(idx)
    return result


def scan_year(year: int) -> dict:
    response, url = request_year(year)
    digest = hashlib.sha256()
    content_length = response.headers.get("Content-Length")
    content_type = response.headers.get("Content-Type")
    disposition = response.headers.get("Content-Disposition")

    first_raw = response.readline()
    if not first_raw:
        raise RuntimeError("empty response")
    digest.update(first_raw)
    first = decode(first_raw).rstrip("\r\n")
    delimiter = delimiter_from(first)
    headers = [h.strip() for h in parse_row(first, delimiter)]
    if len(headers) < 2:
        raise RuntimeError(f"could not parse CSV header: {first[:300]!r}")

    dest_cols = choose_destination_columns(headers)
    measure_cols = choose_measure_columns(headers)
    total_rows = 0
    madrid_rows = 0
    sample = []
    measure_profile = {
        headers[i]: {"blank": 0, "zero": 0, "numeric": 0, "other": 0, "examples": []}
        for i in measure_cols
    }

    for raw in response:
        digest.update(raw)
        line = decode(raw).rstrip("\r\n")
        if not line:
            continue
        row = parse_row(line, delimiter)
        if len(row) < len(headers):
            row += [""] * (len(headers) - len(row))
        total_rows += 1

        match = False
        if dest_cols:
            match = any(str(row[i]).strip() == MADRID_CODE for i in dest_cols if i < len(row))
        else:
            match = any(str(value).strip() == MADRID_CODE for value in row)

        if not match:
            continue

        madrid_rows += 1
        if len(sample) < 20:
            sample.append({headers[i]: row[i] if i < len(row) else "" for i in range(len(headers))})

        for i in measure_cols:
            if i >= len(row):
                continue
            raw_value = str(row[i]).strip()
            profile = measure_profile[headers[i]]
            if raw_value == "":
                profile["blank"] += 1
                continue
            normalized = raw_value.replace(".", "").replace(",", ".")
            try:
                value = float(normalized)
                profile["numeric"] += 1
                if value == 0:
                    profile["zero"] += 1
            except ValueError:
                profile["other"] += 1
                if raw_value not in profile["examples"] and len(profile["examples"]) < 8:
                    profile["examples"].append(raw_value)

    response.close()
    return {
        "year": year,
        "url": url,
        "content_type": content_type,
        "content_disposition": disposition,
        "prefix_sha256": digest.hexdigest(),\n        "source_content_length": content_length,\n        "scan_bounded_after_madrid_rows": 50,
        "delimiter": delimiter,
        "headers": headers,
        "normalized_headers": [norm(h) for h in headers],
        "destination_candidate_columns": [headers[i] for i in dest_cols],
        "measure_candidate_columns": [headers[i] for i in measure_cols],
        "row_count": total_rows,
        "madrid_row_count": madrid_rows,
        "madrid_sample": sample,
        "madrid_measure_profile": measure_profile,
    }


def main() -> int:
    report = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "source": {
            "authority": "SEGITTUR / Dataestur",
            "endpoint": "/TURISMO_INTERNO_MUN_MUN_DL",
            "documented_semantics": "Procedencia y destino de los turistas residentes que visitan un municipio distinto al suyo en el territorio español",
            "response_format": "CSV",
            "required_parameter": "año",
            "documented_available_since": 2019,
        },
        "madrid_destination_code": MADRID_CODE,
        "attempts": [],
        "selected": None,
    }

    for year in YEARS_TO_TRY:
        try:
            result = scan_year(year)
            report["attempts"].append({"year": year, "ok": True, "madrid_rows": result["madrid_row_count"]})
            if result["madrid_row_count"] > 0:
                report["selected"] = result
                break
        except Exception as exc:
            report["attempts"].append({"year": year, "ok": False, "error": f"{type(exc).__name__}: {exc}"})

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))

    if not report["selected"]:
        raise SystemExit("Gate H-A hard stop: no usable Madrid destination rows found")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
