#!/usr/bin/env python3
"""Shared helpers for the Gate L urban-planning source audit (issue #65).

Every Gate L audit script imports this module so that all sub-gates read the two
official XLS families and the ArcGIS geometry service the SAME way: one catalogue
call per dataset through the CKAN ``package_show`` action, resource resolution by
the exact human-readable ``description`` (never by the opaque numeric resource id,
which is demonstrably non-chronological), streamed SHA-256 fingerprinting, and an
OLE2 creation-timestamp read taken straight from the compound-document header.

This module performs no interpretation. It downloads bytes, fingerprints them, and
hands the raw workbook rows back to the caller. Source values are preserved
verbatim; every project-side classification lives in the sub-gate scripts, kept
separate from the source facts, exactly as the hospitality gate keeps ``Cerrado``
source meaning separate from the project ceiling.

BIFF8 reader: ``xlrd`` (>= 2.0). xlrd 2.0 deliberately dropped XLSX/XLSM support
and now reads ONLY the legacy BIFF ``.xls`` OLE2 compound documents these editions
ship as — which is exactly, and only, what Gate L needs. ``openpyxl`` cannot read
them (it is an Office-Open-XML/ZIP reader; these files are not ZIPs). The choice,
its version and its limits are recorded in the L1 report and the gate document.

Raw third-party ``.xls``/``.pdf`` files are written to ``cache/`` (git-ignored) and
never committed. Only the compact normalized JSON reports under ``results/`` are
committed. Set ``GATE_L_CACHE`` to reuse a download directory across runs; a cached
file is accepted only when its SHA-256 still matches the catalogue-declared size and
it re-fingerprints identically, so cache use never weakens reproducibility.

Dependencies: ``requests`` and ``xlrd`` (both research-only; neither is added to the
Node ``package.json`` and nothing in the application imports this package).
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import struct
import sys
from pathlib import Path

import requests
import xlrd  # BIFF8 reader; see module docstring.

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
CACHE = Path(os.environ.get("GATE_L_CACHE", HERE / "cache"))

UA = {"User-Agent": "madrid-urban-evidence-lens/gate-l-research (issue #65 source audit)"}

# The two official dated-edition families this gate audits. Both are CC BY 4.0
# legacy BIFF8 .xls on datos.madrid.es. S1 carries the four phase states; S2 the
# remaining buildability by use class.
S1_PACKAGE = "203200-0-desarrollo-ambitos"   # Estado de desarrollo de los ámbitos
S2_PACKAGE = "203182-0-ambitos-remanente"    # Edificabilidad remanente en ámbitos

# The ArcGIS REST geometry layer (Route 2 in Gate K). Geometry + identifier only.
ARCGIS_LAYER = (
    "https://sigma.madrid.es/hosted/rest/services/"
    "DESARROLLO_URBANO_ACTUALIZADO/AMBITOS_PLANEAMIENTO_URBANISTICO/MapServer/0"
)

CKAN_ACTION = "https://datos.madrid.es/api/3/action/package_show?id={pkg}"


def now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def utf8_stdout() -> None:
    """Force UTF-8 on stdout/stderr so Spanish source labels print on any console."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except Exception:
            pass


# ----------------------------------------------------------------- catalogue

def package_show(pkg: str) -> dict:
    """One catalogue call. Returns the CKAN ``result`` object for a dataset."""
    r = requests.get(CKAN_ACTION.format(pkg=pkg), headers=UA, timeout=120)
    r.raise_for_status()
    body = r.json()
    if not body.get("success"):
        raise RuntimeError(f"CKAN package_show failed for {pkg}: {body}")
    return body["result"]


def xls_editions(pkg_result: dict) -> list[dict]:
    """Every XLS resource (an edition), as returned by the catalogue, untouched.

    The opaque numeric resource id is recorded but NEVER used to order or select:
    L1 proves the id order is not chronological. The period is derived from the
    resource ``description`` here only as a provisional label; the authoritative
    reference date is the one printed INSIDE each file (L1 reads it from the
    ``ESTADO DEL DESARROLLO A FECHA …`` cell).
    """
    out = []
    for r in pkg_result["resources"]:
        if (r.get("format") or "").upper() != "XLS":
            continue
        out.append(
            {
                "resource_id": r.get("id"),
                "description": (r.get("description") or "").strip(),
                "name": (r.get("name") or "").strip(),
                "url": r.get("url"),
                "catalogue_size": r.get("size"),
                "format": (r.get("format") or "").upper(),
            }
        )
    return out


def pdf_docs(pkg_result: dict) -> list[dict]:
    out = []
    for r in pkg_result["resources"]:
        if (r.get("format") or "").upper() != "PDF":
            continue
        out.append(
            {
                "resource_id": r.get("id"),
                "description": (r.get("description") or "").strip(),
                "url": r.get("url"),
            }
        )
    return out


# ------------------------------------------------------------------ download

def _cache_path(resource_id: str, suffix: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    safe = resource_id.replace("/", "_")
    return CACHE / f"{safe}{suffix}"


def fetch(url: str, resource_id: str, suffix: str = ".xls") -> dict:
    """Download a resource to the git-ignored cache, fingerprinting as we stream.

    Returns a meta dict carrying the FIRST-retrieval timestamp, HTTP validators,
    byte size, SHA-256 and the local cache path. The full retrieval record is kept
    in a JSON sidecar; a cached file is reused only when it still re-fingerprints to
    the sidecar's SHA, and the real original retrieval metadata is returned (never a
    placeholder), so cache reuse never weakens the committed provenance. ``from_cache``
    flags that the bytes were not re-downloaded this run.
    """
    path = _cache_path(resource_id, suffix)
    sidecar = path.with_suffix(path.suffix + ".meta.json")
    if path.exists() and sidecar.exists():
        try:
            stored = json.loads(sidecar.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            stored = None
        if stored and _sha256_file(path) == stored.get("sha256"):
            return {**stored, "cache_path": str(path), "from_cache": True}

    sha = hashlib.sha256()
    size = 0
    retrieved_at = now()
    with requests.get(url, headers=UA, timeout=600, stream=True) as r:
        r.raise_for_status()
        meta = {
            "http_last_modified": r.headers.get("Last-Modified"),
            "etag": r.headers.get("ETag"),
            "content_type": r.headers.get("Content-Type"),
        }
        with open(path, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                if not chunk:
                    continue
                f.write(chunk)
                sha.update(chunk)
                size += len(chunk)
    meta.update(
        {
            "url": url,
            "resource_id": resource_id,
            "retrieved_at": retrieved_at,
            "bytes": size,
            "sha256": sha.hexdigest(),
        }
    )
    sidecar.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return {**meta, "cache_path": str(path), "from_cache": False}


def _sha256_file(path: Path) -> str:
    # These cached editions are small (<~200 KB .xls / ~100 KB .pdf); read once.
    sha = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(1 << 20)
            if not chunk:
                break
            sha.update(chunk)
    return sha.hexdigest()


# ------------------------------------------------------- OLE2 creation timestamp

# FILETIME epoch: 1601-01-01. The OLE2 (Compound Document) directory root entry
# carries a creation and a modification timestamp as 64-bit FILETIME values. We
# read them straight from the header so the edition's own "published_at" is a
# property of the file, independent of HTTP or catalogue dates.
_FILETIME_EPOCH = _dt.datetime(1601, 1, 1, tzinfo=_dt.timezone.utc)


def ole2_timestamps(path: Path) -> dict:
    """Return the OLE2 root-entry creation/modification UTC timestamps, or nulls.

    Pure-stdlib parse of the Compound File Binary Format: verify the magic, read
    the sector size, walk to the first directory sector, take the root storage
    entry (entry 0) and decode its two FILETIME fields. Returns ISO strings or
    None when a field is zero (unset), which is itself a recorded fact.
    """
    try:
        data = path.read_bytes()
    except OSError:
        return {"created": None, "modified": None, "ole2": False}
    if len(data) < 512 or data[:8] != b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        return {"created": None, "modified": None, "ole2": False}
    sector_shift = struct.unpack_from("<H", data, 30)[0]
    sector_size = 1 << sector_shift
    first_dir_sector = struct.unpack_from("<i", data, 48)[0]
    dir_offset = 512 + first_dir_sector * sector_size
    # Root entry is the first 128-byte directory entry.
    entry = data[dir_offset : dir_offset + 128]
    if len(entry) < 128:
        return {"created": None, "modified": None, "ole2": True}
    created_raw = struct.unpack_from("<Q", entry, 100)[0]
    modified_raw = struct.unpack_from("<Q", entry, 108)[0]

    def decode(raw: int):
        if raw == 0:
            return None
        try:
            return (_FILETIME_EPOCH + _dt.timedelta(microseconds=raw / 10)).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            )
        except (OverflowError, OSError, ValueError):
            return None

    return {"created": decode(created_raw), "modified": decode(modified_raw), "ole2": True}


# ------------------------------------------------------------------- workbook

def open_workbook(path: Path) -> xlrd.book.Book:
    """Open a BIFF8 workbook with xlrd. Raises if the file is not a real .xls."""
    return xlrd.open_workbook(str(path), on_demand=False, formatting_info=False)


def sheet_rows(sheet) -> list[list]:
    """All rows of a sheet as python lists, cell values untouched (str/float)."""
    return [sheet.row_values(r) for r in range(sheet.nrows)]


def cell_text(value) -> str:
    """Normalise a cell to trimmed text without inventing precision.

    xlrd yields floats for numeric cells; an integer-valued float is rendered
    without a trailing ``.0`` so a code like ``9`` does not become ``9.0``. All
    other values are stringified and stripped. This is presentation only; numeric
    analysis reads the raw float, never this string.
    """
    if value is None:
        return ""
    if isinstance(value, float):
        if value == int(value):
            return str(int(value))
        return repr(value)
    return str(value).strip()


# -------------------------------------------------------------------- writing

def write_json(name: str, payload: dict) -> Path:
    RESULTS.mkdir(parents=True, exist_ok=True)
    path = RESULTS / name
    # newline="\n" so re-running on Windows does not rewrite every file with CRLF
    # and show a spurious diff; the committed results stay LF.
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, sort_keys=False)
        f.write("\n")
    return path


def xls_version(path: Path) -> dict:
    return {"library": "xlrd", "version": xlrd.__version__, "cache_path": str(path)}
