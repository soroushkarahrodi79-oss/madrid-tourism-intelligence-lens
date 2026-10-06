#!/usr/bin/env python3
"""Gate L · L1 — Edition identity and the snapshot contract (issue #65).

Builds the complete edition inventory for both official families, straight from
the catalogue, and establishes:

  * each edition's OWN stated reference date — read from inside the file (the
    ``Estado del desarrollo a fecha …`` cell as an Excel serial in the recent
    editions, or the ``… a 1 de enero de YYYY`` title line in the older ones);
  * that resource-id order is NOT chronological, so "latest" can never be chosen
    by resource id or by name;
  * a snapshot identity in the project form *family + period + fingerprint*,
    because neither the resource id nor the month label is sufficient alone;
  * the declared cadence (the catalogue's machine-readable ``ANNUAL_2`` =
    twice-yearly, i.e. "Semestral") against the observed cadence (annual
    2013–2024, then semestral) — both recorded, neither corrected;
  * the schema ERAS each family passes through, since the files are NOT one
    comparable 2013→2026 series: S1 moves from a per-district single-state layout
    to a flat four-phase table; S2 passes through four distinct column schemas.

This script writes ``results/l1_edition_inventory.json`` and
``results/l1_summary.json``, and exposes helpers (``edition_inventory``,
``reference_date_of``, ``read_flat_rows``, ``RECENT_FLAT_ERA``) that L2/L3/L4
import so every later sub-gate resolves editions the same way.

Run: ``python research/urban_planning_gate/audit_l1_editions.py``
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

import xlrd

import gate_l_common as g

# ------------------------------------------------------------- reference dates

_MONTHS_ES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10,
    "noviembre": 11, "diciembre": 12,
}

# "a 1 de enero de 2013", "a fecha 1 de enero de 2017", etc.
_TITLE_DATE = re.compile(
    r"a\s+(?:fecha\s+)?(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})", re.IGNORECASE
)
# A month label in the resource description: "Enero 2026", "Julio 2025".
_LABEL_MONTH = re.compile(r"\b([A-Za-zÁÉÍÓÚáéíóú]+)\s+(\d{4})\b")
_LABEL_YEAR = re.compile(r"\b(20\d{2})\b")


def _iso(y: int, m: int) -> str:
    return f"{y:04d}-{m:02d}"


def _find_header_row(sheet) -> tuple[int, list[str]]:
    """First row carrying >= 4 non-blank cells is the column header."""
    for r in range(min(12, sheet.nrows)):
        vals = [g.cell_text(c) for c in sheet.row_values(r)]
        if sum(1 for v in vals if v) >= 4:
            return r, vals
    return -1, []


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip()).lower()


def reference_date_of(wb: xlrd.book.Book, description: str) -> dict:
    """The edition's OWN stated reference date, with its provenance recorded.

    Priority, most authoritative first:
      1. a flat ``… a fecha`` column holding an Excel serial (recent editions);
      2. a ``… a N de <mes> de YYYY`` title line inside the first sheet;
      3. the month/year printed in the resource description (least authoritative).
    The method is reported so a reviewer can see where the date came from.
    """
    sheet = wb.sheet_by_index(0)
    hdr_row, hdr = _find_header_row(sheet)

    # 1. Flat "a fecha" column with an Excel serial.
    if hdr_row >= 0:
        for ci, name in enumerate(hdr):
            if "a fecha" in _norm(name) and "estado" in _norm(name):
                for r in range(hdr_row + 1, min(hdr_row + 6, sheet.nrows)):
                    ct = sheet.cell_type(r, ci)
                    cv = sheet.cell_value(r, ci)
                    if ct == xlrd.XL_CELL_NUMBER and cv > 40000:
                        d = xlrd.xldate_as_datetime(cv, wb.datemode)
                        return {
                            "reference_date": _iso(d.year, d.month),
                            "reference_date_full": d.strftime("%Y-%m-%d"),
                            "reference_date_method": "FLAT_A_FECHA_SERIAL",
                            "reference_date_raw": cv,
                        }

    # 2. Title line "a N de <mes> de YYYY" in the first sheet.
    for r in range(min(12, sheet.nrows)):
        for cell in sheet.row_values(r):
            m = _TITLE_DATE.search(str(cell))
            if m:
                mon = _MONTHS_ES.get(m.group(2).lower())
                if mon:
                    return {
                        "reference_date": _iso(int(m.group(3)), mon),
                        "reference_date_full": f"{int(m.group(3)):04d}-{mon:02d}-{int(m.group(1)):02d}",
                        "reference_date_method": "TITLE_LINE_TEXT",
                        "reference_date_raw": str(cell).strip(),
                    }

    # 3. Resource description label (least authoritative).
    mm = _LABEL_MONTH.search(description)
    if mm and mm.group(1).lower() in _MONTHS_ES:
        return {
            "reference_date": _iso(int(mm.group(2)), _MONTHS_ES[mm.group(1).lower()]),
            "reference_date_full": None,
            "reference_date_method": "DESCRIPTION_LABEL_MONTH",
            "reference_date_raw": mm.group(0),
        }
    my = _LABEL_YEAR.search(description)
    if my:
        # A year-only edition's stated date is 1 January of that year (confirmed
        # by the title line in the older editions, e.g. "a 1 de enero de 2013").
        return {
            "reference_date": _iso(int(my.group(1)), 1),
            "reference_date_full": None,
            "reference_date_method": "DESCRIPTION_LABEL_YEAR_ASSUMED_JAN",
            "reference_date_raw": my.group(0),
        }
    return {
        "reference_date": None,
        "reference_date_full": None,
        "reference_date_method": "UNRESOLVED",
        "reference_date_raw": None,
    }


# --------------------------------------------------------------- schema eras

def schema_signature(wb: xlrd.book.Book) -> dict:
    """A stable description of an edition's table shape, for era classification.

    Returns the data sheet count, the detected header tokens (normalised,
    non-blank) and a sha256 fingerprint of that header tuple. Editions sharing a
    fingerprint are structurally identical and may be differenced; across a
    fingerprint boundary they may not.
    """
    sheet = wb.sheet_by_index(0)
    hdr_row, hdr = _find_header_row(sheet)
    tokens = [_norm(h) for h in hdr if (h or "").strip()]
    sig = hashlib.sha256("|".join(tokens).encode("utf-8")).hexdigest()[:16]
    return {
        "sheet_count": len(wb.sheet_names()),
        "header_row_index": hdr_row,
        "header_tokens": tokens,
        "schema_fingerprint": sig,
        "column_count": sheet.ncols,
    }


def classify_era(family: str, sig: dict) -> str:
    """Name the schema era from its header tokens (source-observed, not assumed)."""
    toks = set(sig["header_tokens"])
    if family == "S1":
        if any("planeamiento" in t for t in toks) and any("obras" in t for t in toks):
            return "S1_FOUR_PHASE_FLAT"
        if any(t == "estado de desarrollo" for t in toks):
            return "S1_SINGLE_STATE_PER_DISTRICT"
        return "S1_UNRECOGNISED"
    # S2
    if "cod_ambito" in toks and any("colectiva. edif" in t for t in sig["header_tokens"]):
        return "S2_SPLIT_RESIDENTIAL_FLAT"
    if "codord" in toks:
        return "S2_VAC_CODORD"
    if any(t == "nº viviendas" for t in toks) and any("edif. residencial" == t for t in toks):
        return "S2_SINGLE_RESIDENTIAL"
    if any(t in ("colectiva", "unifamiliar") for t in toks):
        return "S2_COLECTIVA_UNIFAMILIAR"
    return "S2_UNRECOGNISED"


# -------------------------------------------------- flat recent-era row reader

RECENT_FLAT_ERA = {"S1": "S1_FOUR_PHASE_FLAT", "S2": "S2_SPLIT_RESIDENTIAL_FLAT"}


def _resource_id_num(resource_id: str) -> int:
    m = re.search(r"-(\d+)-", resource_id)
    return int(m.group(1)) if m else -1


def read_flat_rows(wb: xlrd.book.Book, family: str) -> dict:
    """Read a recent flat-era edition into header-keyed rows.

    Maps columns by header name (robust to minor index drift), drops any trailing
    aggregate ``Total`` row, and returns {columns, rows:[{col:value}], code_col}.
    Numeric cells stay float; text stays text. Nothing is interpreted here.
    """
    sheet = wb.sheet_by_index(0)
    hdr_row, hdr = _find_header_row(sheet)
    cols = [g.cell_text(c) for c in sheet.row_values(hdr_row)]
    code_col = "Ámbito" if family == "S1" else "COD_AMBITO"
    rows = []
    for r in range(hdr_row + 1, sheet.nrows):
        raw = sheet.row_values(r)
        rec = {}
        for ci, name in enumerate(cols):
            if not name:
                continue
            rec[name] = raw[ci] if ci < len(raw) else ""
        code = g.cell_text(rec.get(code_col, ""))
        if not code:
            continue
        if code.lower().startswith("total"):
            continue
        rows.append(rec)
    return {"columns": cols, "code_col": code_col, "rows": rows}


# ----------------------------------------------------------------- inventory

def edition_inventory() -> dict:
    """Full inventory for both families: catalogue + fingerprint + OLE2 + refdate
    + schema era. Downloads each XLS once (cached). Returns the inventory dict."""
    inv = {"S1": {"package": g.S1_PACKAGE}, "S2": {"package": g.S2_PACKAGE}}
    for family, pkg in [("S1", g.S1_PACKAGE), ("S2", g.S2_PACKAGE)]:
        res = g.package_show(pkg)
        inv[family]["title"] = res.get("title")
        inv[family]["license"] = res.get("license_title") or res.get("license_id")
        inv[family]["catalogue_frequency"] = res.get("frequency") or res.get("accrual_periodicity")
        inv[family]["catalogue_metadata_modified"] = res.get("metadata_modified")
        inv[family]["pdf_docs"] = g.pdf_docs(res)
        editions = []
        for e in g.xls_editions(res):
            meta = g.fetch(e["url"], e["resource_id"], ".xls")
            path = Path(meta["cache_path"])
            ole = g.ole2_timestamps(path)
            wb = g.open_workbook(path)
            refdate = reference_date_of(wb, e["description"])
            sig = schema_signature(wb)
            era = classify_era(family, sig)
            editions.append(
                {
                    "resource_id": e["resource_id"],
                    "resource_id_num": _resource_id_num(e["resource_id"]),
                    "description": e["description"],
                    "url": e["url"],
                    "catalogue_size": e["catalogue_size"],
                    "retrieved_at": meta["retrieved_at"],
                    "http_last_modified": meta["http_last_modified"],
                    "etag": meta["etag"],
                    "bytes": meta["bytes"],
                    "sha256": meta["sha256"],
                    "ole2_created": ole["created"],
                    "ole2_modified": ole["modified"],
                    "schema_era": era,
                    "schema_fingerprint": sig["schema_fingerprint"],
                    "sheet_count": sig["sheet_count"],
                    "column_count": sig["column_count"],
                    "header_tokens": sig["header_tokens"],
                    **refdate,
                    # Snapshot identity: family + period + content fingerprint.
                    "snapshot_identity": f"{family}:{refdate['reference_date']}:{meta['sha256'][:12]}",
                }
            )
        editions.sort(key=lambda x: (x["reference_date"] or "", x["resource_id_num"]))
        inv[family]["editions"] = editions
    return inv


def _non_chronological_proof(editions: list[dict]) -> dict:
    """Prove resource-id order is not chronological: list (resource_id_num ->
    reference_date) and find an inversion where a higher id is an earlier date."""
    by_id = sorted(editions, key=lambda x: x["resource_id_num"])
    pairs = [{"resource_id": e["resource_id"], "resource_id_num": e["resource_id_num"],
              "reference_date": e["reference_date"], "description": e["description"]}
             for e in by_id]
    inversions = []
    for i in range(len(by_id)):
        for j in range(i + 1, len(by_id)):
            a, b = by_id[i], by_id[j]
            if a["reference_date"] and b["reference_date"] and a["reference_date"] > b["reference_date"]:
                inversions.append(
                    {
                        "higher_evidence": f"id {a['resource_id_num']} ({a['description']}) = {a['reference_date']}",
                        "but_later_id": f"id {b['resource_id_num']} ({b['description']}) = {b['reference_date']}",
                    }
                )
    return {
        "id_order_vs_reference_date": pairs,
        "is_chronological_by_id": len(inversions) == 0,
        "inversion_count": len(inversions),
        "inversions_sample": inversions[:6],
    }


def _observed_cadence(editions: list[dict]) -> dict:
    dates = sorted({e["reference_date"] for e in editions if e["reference_date"]})
    gaps = []
    for i in range(1, len(dates)):
        ay, am = map(int, dates[i - 1].split("-"))
        by, bm = map(int, dates[i].split("-"))
        gaps.append((by - ay) * 12 + (bm - am))
    return {
        "reference_dates": dates,
        "month_gaps": gaps,
        "note": "Annual 12-month gaps through 2024, then 6-month gaps from 2025 "
                "(Enero 2025 / Julio 2025 / Enero 2026). The declared ANNUAL_2 "
                "(semestral) cadence is correct only for the recent period.",
    }


def main() -> None:
    g.utf8_stdout()
    inv = edition_inventory()
    summary = {
        "gate": "L1",
        "question": "Edition identity and the snapshot contract for datasets 203200 and 203182.",
        "audit_finished_at": g.now(),
        "reader": {"library": "xlrd", "version": xlrd.__version__,
                   "why": "xlrd 2.0 reads ONLY legacy BIFF .xls OLE2 compound "
                          "documents, which is exactly what these editions are; "
                          "openpyxl (OOXML/ZIP) cannot read them.",
                   "limitation": "xlrd does not read .xlsx; it exposes no cell "
                                 "comments and no chart objects. Neither is needed here."},
        "families": {},
    }
    for family in ("S1", "S2"):
        eds = inv[family]["editions"]
        eras = {}
        for e in eds:
            eras.setdefault(e["schema_era"], []).append(e["reference_date"])
        summary["families"][family] = {
            "package": inv[family]["package"],
            "title": inv[family]["title"],
            "license": inv[family]["license"],
            "declared_cadence_machine": inv[family]["catalogue_frequency"],
            "declared_cadence_note": "EU authority frequency ANNUAL_2 = twice a "
                                     "year = the portal's prose 'Semestral'.",
            "catalogue_metadata_modified": inv[family]["catalogue_metadata_modified"],
            "xls_edition_count": len(eds),
            "chronological_reference_dates": [e["reference_date"] for e in eds],
            "schema_eras": {k: sorted(v) for k, v in eras.items()},
            "schema_era_count": len(eras),
            "snapshot_identities": [e["snapshot_identity"] for e in eds],
            "snapshot_identities_unique": len({e["snapshot_identity"] for e in eds}) == len(eds),
            "non_chronological_proof": _non_chronological_proof(eds),
            "observed_cadence": _observed_cadence(eds),
            "pdf_docs": inv[family]["pdf_docs"],
        }
    summary["single_comparable_series"] = False
    summary["single_comparable_series_note"] = (
        "Neither family is one comparable 2013→2026 series. S1 has two schema "
        "eras (per-district single-state 2013–2024; flat four-phase 2025–2026). "
        "S2 passes through four distinct column schemas. Cross-era differencing "
        "is barred; the honest change surface is confined to within-era pairs."
    )
    g.write_json("l1_edition_inventory.json", inv)
    g.write_json("l1_summary.json", summary)

    # Console digest.
    for family in ("S1", "S2"):
        s = summary["families"][family]
        print(f"[{family}] {s['title']}")
        print(f"   editions={s['xls_edition_count']} eras={s['schema_era_count']} "
              f"id_chronological={s['non_chronological_proof']['is_chronological_by_id']} "
              f"inversions={s['non_chronological_proof']['inversion_count']}")
        for era, dates in s["schema_eras"].items():
            print(f"     {era}: {dates}")
    print("wrote results/l1_edition_inventory.json, results/l1_summary.json")


if __name__ == "__main__":
    main()
