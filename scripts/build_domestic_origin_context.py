#!/usr/bin/env python3
"""Build Madrid's domestic-origin Destination Context from INE's direct XLSX.

The output is a compact, committed, Madrid-destination-only artifact.  It is a
monthly list of published origin→Madrid municipality crossings for residents
travelling from another province, never a Lens, barrio or district statistic.
INE publishes only crossings with MORE THAN 30 tourists: an absent crossing is
therefore deliberately absent, not zero.

Uses only the Python standard library.  XLSX is a ZIP of XML documents; reading
the small, fixed part of that format ourselves avoids making the Pages/test
workflow depend on an unpinned spreadsheet package.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import tempfile
import urllib.request
import zipfile
from decimal import Decimal, InvalidOperation
from pathlib import Path
from xml.etree import ElementTree as ET

SOURCE_URL = "https://www.ine.es/experimental/turismo_moviles/exp_tmov_interno_mun_{year}.xlsx"
MADRID_CODE = "28079"
EXPECTED_COLUMNS = ["mes", "mun_orig_cod", "mun_orig", "dest_cod", "dest", "turistas", "prov_orig_cod", "prov_orig", "prov_dest_cod", "prov_dest"]
SOURCE_UNIVERSE = {
    "residence": "Residents in Spain",
    "trip_condition": "Travel to a province different from the province of residence",
    "disaggregation": "Origin and destination municipality",
    "same_province_travel_excluded": True,
}
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main", "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"

class BuildError(RuntimeError): pass

def norm(text):
    return " ".join(str(text or "").lower().replace("á","a").replace("é","e").replace("í","i").replace("ó","o").replace("ú","u").split())

def column_number(ref):
    total = 0
    for char in re.match(r"[A-Z]+", ref).group(0): total = total * 26 + ord(char) - 64
    return total - 1

def xlsx_parts(path):
    archive = zipfile.ZipFile(path)
    try:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            shared = ["".join(node.itertext()) for node in root.findall("m:si", NS)]
        book = ET.fromstring(archive.read("xl/workbook.xml"))
        rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {node.attrib["Id"]: node.attrib["Target"] for node in rels.findall(f"{{{REL_NS}}}Relationship")}
        sheets = []
        for sheet in book.findall("m:sheets/m:sheet", NS):
            target = targets.get(sheet.attrib.get(f"{{{NS['r']}}}id"))
            if not target: raise BuildError(f"workbook sheet {sheet.attrib.get('name')} has no relationship")
            sheets.append((sheet.attrib["name"], "xl/" + target.lstrip("/")))
        return archive, shared, sheets
    except Exception:
        archive.close(); raise

def sheet_rows(archive, shared, member):
    # Large monthly sheets hold tens of thousands of crossings. Stream one row
    # at a time instead of materialising an XML tree that can exceed a gigabyte.
    with archive.open(member) as handle:
        for _, row in ET.iterparse(handle, events=("end",)):
            if row.tag != f"{{{NS['m']}}}row": continue
            values = {}
            for cell in row.findall("m:c", NS):
                ref = cell.attrib.get("r", "")
                if not ref: continue
                value = cell.find("m:v", NS)
                raw = value.text if value is not None else ""
                if cell.attrib.get("t") == "s":
                    try: raw = shared[int(raw)]
                    except (ValueError, IndexError): raise BuildError(f"invalid shared string in {member}")
                elif cell.attrib.get("t") == "inlineStr": raw = "".join(cell.itertext())
                values[column_number(ref)] = raw
            if values: yield [values.get(i, "") for i in range(max(values) + 1)]
            row.clear()

def discover_month_sheets(path):
    archive, shared, sheets = xlsx_parts(path)
    try:
        result = [(name, member) for name, member in sheets if MONTH_RE.fullmatch(name)]
        if not result: raise BuildError("no monthly YYYY-MM sheets found")
        return sorted(result)
    finally: archive.close()

def verify_suppression_statement(path):
    archive, shared, sheets = xlsx_parts(path)
    try:
        notes = []
        for name, member in sheets:
            if MONTH_RE.fullmatch(name): continue
            for row in sheet_rows(archive, shared, member): notes.extend(row)
        text = norm(" ".join(notes))
        if "provincia diferente" not in text:
            raise BuildError("information sheet does not verify the province-different source universe")
        if "mas de 30 turistas" not in text:
            raise BuildError("information sheet does not verify the >30-tourist suppression rule")
    finally: archive.close()

def validate_code(value, width, field, period):
    value = str(value).strip()
    if not re.fullmatch(rf"\d{{{width}}}", value):
        raise BuildError(f"{period}: {field} must be a zero-padded {width}-digit string")
    return value

def validate_count(value, period, origin):
    try: number = Decimal(str(value).strip())
    except (InvalidOperation, ValueError): raise BuildError(f"{period} {origin}: turistas is malformed")
    if not number.is_finite() or number != number.to_integral_value():
        raise BuildError(f"{period} {origin}: turistas must be a finite integer")
    if number <= 30:
        raise BuildError(f"{period} {origin}: published turistas must be strictly greater than 30")
    return int(number)

def schema_fingerprint():
    payload = {"columns": EXPECTED_COLUMNS, "month_sheet_pattern": "YYYY-MM", "destination": {"dest_cod": MADRID_CODE, "dest": "Madrid", "prov_dest_cod": "28", "prov_dest": "Madrid"}, "source_universe": SOURCE_UNIVERSE, "suppression": "turistas > 30"}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

def build_records(path, workbook_year):
    verify_suppression_statement(path)
    archive, shared, sheets = xlsx_parts(path)
    try:
        months = []
        for period, member in sorted((n, p) for n, p in sheets if MONTH_RE.fullmatch(n)):
            if int(period[:4]) != workbook_year:
                raise BuildError(f"{period}: monthly sheet year does not match declared workbook year {workbook_year}")
            rows = sheet_rows(archive, shared, member)
            header = next(rows, None)
            if header != EXPECTED_COLUMNS: raise BuildError(f"{period}: source schema changed; expected exact ten columns")
            origins, seen = [], set()
            for row in rows:
                if len(row) != len(EXPECTED_COLUMNS): raise BuildError(f"{period}: row does not have ten columns")
                item = dict(zip(EXPECTED_COLUMNS, row))
                if item["mes"] != period: raise BuildError(f"{period}: row source month disagrees with sheet")
                item["dest_cod"] = validate_code(item["dest_cod"], 5, "dest_cod", period)
                if item["dest_cod"] != MADRID_CODE: continue
                if (item["dest"], str(item["prov_dest_cod"]), item["prov_dest"]) != ("Madrid", "28", "Madrid"):
                    raise BuildError(f"{period}: Madrid destination corroboration failed")
                origin = validate_code(item["mun_orig_cod"], 5, "mun_orig_cod", period)
                if origin in seen: raise BuildError(f"{period}: duplicate published origin municipality {origin}")
                seen.add(origin)
                tourists = validate_count(item["turistas"], period, origin)
                origins.append({"origin_municipality_code": origin, "origin_municipality_name": str(item["mun_orig"]), "origin_province_code": validate_code(item["prov_orig_cod"], 2, "prov_orig_cod", period), "origin_province_name": str(item["prov_orig"]), "source_reported_tourists": tourists})
            origins.sort(key=lambda r: (-r["source_reported_tourists"], r["origin_municipality_name"], r["origin_municipality_code"]))
            months.append({"source_month": period, "published_origins": origins})
        if not months: raise BuildError("no monthly source data")
        return months
    finally: archive.close()

def artifacts(months, year, url, retrieved_at):
    fingerprint = schema_fingerprint(); available = [m["source_month"] for m in months]
    artifact = {"contract_version":"1.0.0","source":{"authority":"Instituto Nacional de Estadística (INE)","source_url":url,"workbook_year":year,"retrieved_at":retrieved_at},"source_universe":SOURCE_UNIVERSE,"geography":{"level":"municipality","municipality_code":MADRID_CODE,"municipality_name":"Madrid","scope_note":"Madrid municipality only; no barrio, district, coordinates or Lens-circle allocation."},"source_period":{"granularity":"month","available_months":available,"latest":available[-1],"semantics":"A source month is the observation month, distinct from the workbook year and retrieval timestamp."},"suppression":{"rule":"INE publishes only origin-destination crossings with more than 30 tourists.","absent_is_not_zero":"Origins may be outside the source universe, including same-province travel; within the covered universe absent rows may be suppressed and are never materialised as zero or an other-origins residual."},"source_schema":EXPECTED_COLUMNS,"schema_fingerprint":fingerprint,"months":months}
    meta = {"contract_version":"1.0.0","artifact":"madrid_domestic_origins.json","source":artifact["source"],"source_universe":SOURCE_UNIVERSE,"geography":{"resolved_level":"municipality","municipality_code":MADRID_CODE,"destination_corroboration":{"dest":"Madrid","prov_dest_cod":"28","prov_dest":"Madrid"}},"source_schema":EXPECTED_COLUMNS,"schema_fingerprint":fingerprint,"temporal_contract":{"workbook_year":"Container year, not the observation date; every discovered monthly sheet must use this year.","source_month":"Each published crossing is assigned to its exact monthly worksheet.","latest_source_month":available[-1],"retrieved_at":retrieved_at},"suppression_semantics":artifact["suppression"],"interpretation_ceiling":"Source-reported resident tourists from published Spanish origin municipalities travelling to Madrid municipality from another province in a source month. Same-province travel is outside the source universe. It is descriptive context, not a complete distribution of domestic tourism, a share of all domestic tourists, a market ranking, causal evidence, forecast or any barrio, district or Lens-circle measure."}
    return artifact, meta

def atomic_json_outputs(outputs):
    """Serialize both related outputs before replacing either committed file."""
    temporary = []
    try:
        for path, data in outputs:
            path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=path.parent) as tmp:
                json.dump(data, tmp, ensure_ascii=False, indent=2)
                tmp.write("\n")
                temporary.append((Path(tmp.name), path))
        for temp, path in temporary:
            temp.replace(path)
    finally:
        for temp, _ in temporary:
            temp.unlink(missing_ok=True)

def main(argv=None):
    parser=argparse.ArgumentParser(); parser.add_argument("--year", type=int, default=dt.datetime.now(dt.timezone.utc).year); parser.add_argument("--workbook", type=Path); parser.add_argument("--out-dir", type=Path, default=Path("data/destination")); args=parser.parse_args(argv)
    url=SOURCE_URL.format(year=args.year); retrieved=dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00","Z")
    if args.workbook: workbook=args.workbook
    else:
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp: workbook=Path(tmp.name)
        try: urllib.request.urlretrieve(url, workbook)
        except Exception as exc: workbook.unlink(missing_ok=True); raise BuildError(f"INE workbook download failed: {exc}")
    months=build_records(workbook, args.year); artifact, meta=artifacts(months,args.year,url,retrieved)
    atomic_json_outputs(((args.out_dir/"madrid_domestic_origins.json", artifact), (args.out_dir/"madrid_domestic_origins.meta.json", meta)))
    if not args.workbook: workbook.unlink(missing_ok=True)

if __name__ == "__main__": main()
