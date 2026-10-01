#!/usr/bin/env python3
"""Inspect the official INE municipality-origin XLSX workbooks for Gate H.

Research probe only. Standard library, no workbook dependency. It downloads
the exact files linked by INEbase, resolves XLSX shared strings, reports sheets,
header rows, dimensions, and a bounded sample of rows containing Madrid code
28079. The workbooks themselves are never committed.
"""

from __future__ import annotations

import io
import json
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

FILES = {
    "domestic_2026": "https://www.ine.es/experimental/turismo_moviles/exp_tmov_interno_mun_2026.xlsx",
}
OUT = Path("research/destination_origin/workbook_probe_report.json")
NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"


def download(url: str) -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "madrid-tourism-intelligence-lens/1.0 Gate-H workbook probe",
            "Accept": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*",
        },
    )
    with urllib.request.urlopen(req, timeout=180) as response:
        data = response.read()
    if not data.startswith(b"PK"):
        raise RuntimeError(f"{url} did not return an XLSX/ZIP payload")
    return data


def shared_strings(zf: zipfile.ZipFile) -> list[str]:
    name = "xl/sharedStrings.xml"
    if name not in zf.namelist():
        return []
    values = []
    with zf.open(name) as fh:
        for event, elem in ET.iterparse(fh, events=("end",)):
            if elem.tag == f"{{{NS_MAIN}}}si":
                text = "".join(
                    node.text or ""
                    for node in elem.iter()
                    if node.tag == f"{{{NS_MAIN}}}t"
                )
                values.append(text)
                elem.clear()
    return values


def workbook_sheets(zf: zipfile.ZipFile) -> list[dict]:
    wb = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    targets = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in rels.findall(f"{{{NS_PKG_REL}}}Relationship")
    }
    result = []
    sheets = wb.find(f"{{{NS_MAIN}}}sheets")
    for sheet in list(sheets or []):
        rid = sheet.attrib.get(f"{{{NS_REL}}}id")
        target = targets.get(rid, "")
        if target.startswith("/"):
            path = target.lstrip("/")
        elif target.startswith("xl/"):
            path = target
        else:
            path = "xl/" + target.lstrip("/")
        result.append(
            {
                "name": sheet.attrib.get("name"),
                "sheet_id": sheet.attrib.get("sheetId"),
                "path": path,
            }
        )
    return result


def cell_value(cell, strings):
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return "".join(
            node.text or "" for node in cell.iter() if node.tag == f"{{{NS_MAIN}}}t"
        )
    v = cell.find(f"{{{NS_MAIN}}}v")
    if v is None or v.text is None:
        return None
    raw = v.text
    if cell_type == "s":
        try:
            return strings[int(raw)]
        except (ValueError, IndexError):
            return raw
    if cell_type == "b":
        return raw == "1"
    return raw


def inspect_sheet(zf, sheet, strings):
    first_rows = []
    madrid_rows = []
    rows_seen = 0
    dimension = None
    with zf.open(sheet["path"]) as fh:
        context = ET.iterparse(fh, events=("start", "end"))
        for event, elem in context:
            if event == "start" and elem.tag == f"{{{NS_MAIN}}}dimension" and dimension is None:
                dimension = elem.attrib.get("ref")
            if event != "end" or elem.tag != f"{{{NS_MAIN}}}row":
                continue
            rows_seen += 1
            row = {}
            for cell in elem.findall(f"{{{NS_MAIN}}}c"):
                ref = cell.attrib.get("r", "")
                col = "".join(ch for ch in ref if ch.isalpha())
                row[col] = cell_value(cell, strings)
            compact = {k: v for k, v in row.items() if v not in (None, "")}
            if len(first_rows) < 12:
                first_rows.append({"row": elem.attrib.get("r"), "cells": compact})
            values = {str(v).strip() for v in compact.values()}
            if "28079" in values and len(madrid_rows) < 25:
                madrid_rows.append({"row": elem.attrib.get("r"), "cells": compact})
            elem.clear()
            if len(first_rows) >= 12 and len(madrid_rows) >= 25:
                break
    return {
        "dimension": dimension,
        "rows_scanned": rows_seen,
        "first_rows": first_rows,
        "madrid_rows": madrid_rows,
    }


def inspect_xlsx(name: str, url: str) -> dict:
    payload = download(url)
    with zipfile.ZipFile(io.BytesIO(payload)) as zf:
        strings = shared_strings(zf)
        sheets = workbook_sheets(zf)
        inspected = []
        for sheet in sheets:
            inspected.append({**sheet, **inspect_sheet(zf, sheet, strings)})
    return {
        "name": name,
        "url": url,
        "bytes": len(payload),
        "shared_string_count": len(strings),
        "sheets": inspected,
    }


def main() -> int:
    report = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "files": {},
    }
    for name, url in FILES.items():
        try:
            report["files"][name] = inspect_xlsx(name, url)
        except Exception as exc:
            report["files"][name] = {"name": name, "url": url, "error": f"{type(exc).__name__}: {exc}"}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
