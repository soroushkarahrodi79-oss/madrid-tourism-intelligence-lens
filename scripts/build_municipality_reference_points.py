#!/usr/bin/env python3
"""Build the Spanish municipality reference-point artifact from the IGN NGMEP.

Input is the official "Nomenclator Geografico de Municipios y Entidades de
Poblacion" CSV + MDB archive (BD_Municipios-Entidades.zip) from the CNIG download
centre. The download form is protected by bot detection, so the archive is
fetched by a person and passed in with --zip; this script never downloads it.

Only MUNICIPIOS.csv is read. Each row becomes one point keyed by the five-digit
INE municipality code (the first five digits of the eleven-digit COD_INE), so it
joins directly to origin_municipality_code in madrid_domestic_origins.json.

    python scripts/build_municipality_reference_points.py --zip BD_Municipios-Entidades.zip
"""
import argparse
import csv
import datetime
import hashlib
import io
import json
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "geography" / "spain_municipality_points.json"
META = ROOT / "data" / "geography" / "spain_municipality_points.meta.json"

TABLE = "MUNICIPIOS.csv"
LON_FIELD = "LONGITUD_ETRS89_REGCAN95"
LAT_FIELD = "LATITUD_ETRS89_REGCAN95"
REQUIRED = ["COD_INE", "NOMBRE_ACTUAL", LON_FIELD, LAT_FIELD, "ORIGENCOOR"]
# Integrity envelope for Spain incl. Canary Islands and Balearics; it catches a
# swapped or mis-scaled coordinate, it is not an analytical boundary.
LON_RANGE = (-19.0, 5.0)
LAT_RANGE = (27.0, 44.5)
DECIMALS = 6
MIN_RECORDS = 8000  # Spain has ~8,130 municipalities; a collapse must fail loudly.

DOWNLOAD_PAGE = "https://centrodedescargas.cnig.es/CentroDescargas/nomenclator-geografico-municipios-entidades-poblacion"
LICENCE = (
    "Orden FOM/2807/2015 licence of use, compatible with CC BY 4.0; "
    "authorship (IGN / CNIG) must be acknowledged"
)
# The CNIG's own credit for a derived work ("Tipo 3" on the NGMEP file record).
ATTRIBUTION = "Obra derivada de NGMEP CC-BY 4.0 ign.es"
ATTRIBUTION_SOURCE = "https://centrodedescargas.cnig.es/CentroDescargas/detalleArchivo?sec=9000004"
# No download log or server timestamp exists for a manual download, so the
# archive's modification time is the only retrieval evidence there is.
RETRIEVED_AT_BASIS = (
    "Modification time (UTC) of the manually downloaded archive as found on disk, "
    "taken as the retrieval time; no download log or server timestamp was recorded"
)
SEMANTICS = (
    "Reference point of the municipality as published by the IGN: a point placed as "
    "centrally as possible inside the municipality's main population nucleus. It is "
    "not the centroid of the municipal territory and not an administrative boundary."
)


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def parse(raw):
    text = raw.decode("latin-1")  # file is ISO-8859-1 (file(1): "ISO-8859 text")
    reader = csv.DictReader(io.StringIO(text), delimiter=";")
    missing = [f for f in REQUIRED if f not in (reader.fieldnames or [])]
    if missing:
        sys.exit(f"{TABLE} is missing required columns: {missing}")
    points, origin_counts = {}, Counter()
    for row in reader:
        cod = row["COD_INE"]
        if not re.fullmatch(r"\d{11}", cod) or not cod.endswith("000000"):
            sys.exit(f"unexpected COD_INE shape: {cod!r}")
        code = cod[:5]
        if code in points:
            sys.exit(f"duplicate municipality code {code}")
        lon = float(row[LON_FIELD].replace(",", "."))
        lat = float(row[LAT_FIELD].replace(",", "."))
        if not (LON_RANGE[0] <= lon <= LON_RANGE[1] and LAT_RANGE[0] <= lat <= LAT_RANGE[1]):
            sys.exit(f"{code} {row['NOMBRE_ACTUAL']}: coordinate outside the integrity envelope: {lon}, {lat}")
        points[code] = [round(lon, DECIMALS), round(lat, DECIMALS)]
        origin_counts[row["ORIGENCOOR"]] += 1
    if len(points) < MIN_RECORDS:
        sys.exit(f"only {len(points)} municipalities; expected at least {MIN_RECORDS}")
    return dict(sorted(points.items())), origin_counts


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--zip", required=True, type=Path, help="path to BD_Municipios-Entidades.zip downloaded from the CNIG centre")
    args = ap.parse_args()

    zip_bytes = args.zip.read_bytes()
    retrieved_at = datetime.datetime.fromtimestamp(args.zip.stat().st_mtime, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        names = z.namelist()
        mdb = [n for n in names if re.fullmatch(r"\d{6}_NGMEP\.mdb", n)]
        if len(mdb) != 1 or TABLE not in names:
            sys.exit(f"archive layout not recognised: {names}")
        edition = f"{mdb[0][:4]}-{mdb[0][4:6]}"
        table_bytes = z.read(TABLE)

    points, origin_counts = parse(table_bytes)
    lons = [p[0] for p in points.values()]
    lats = [p[1] for p in points.values()]

    artifact = {
        "contract_version": "1.0.0",
        "source": {
            "authority": "Instituto Geografico Nacional (IGN) - Centro Nacional de Informacion Geografica (CNIG)",
            "dataset": "Nomenclator Geografico de Municipios y Entidades de Poblacion (NGMEP)",
            "edition": edition,
            "table": TABLE,
            "download_page": DOWNLOAD_PAGE,
            "licence": LICENCE,
            "retrieved_at": retrieved_at,
            "retrieved_at_basis": RETRIEVED_AT_BASIS,
            "attribution": ATTRIBUTION,
            "attribution_source": ATTRIBUTION_SOURCE,
        },
        "key": {
            "field": "COD_INE",
            "rule": "First five digits of the eleven-digit COD_INE (province + municipality); the remaining six are 000000 on municipality rows.",
            "joins_to": "origin_municipality_code in data/destination/madrid_domestic_origins.json",
        },
        "coordinates": {
            "order": "[longitude, latitude]",
            "crs": "ETRS89 (Peninsula and Balearic Islands) and REGCAN95 (Canary Islands); both are WGS84-compatible and are used as WGS84 for display",
            "decimals": DECIMALS,
            "semantics": SEMANTICS,
        },
        "record_count": len(points),
        "points": points,
    }
    meta = {
        "contract_version": "1.0.0",
        "artifact": OUT.name,
        "source": artifact["source"],
        "fingerprints": {
            "archive_sha256": sha256_bytes(zip_bytes),
            "table_sha256": sha256_bytes(table_bytes),
        },
        "field_mapping": {"key": "COD_INE[0:5]", "longitude": LON_FIELD, "latitude": LAT_FIELD, "coordinate_source": "ORIGENCOOR"},
        "coordinate_source_distribution": dict(sorted(origin_counts.items(), key=lambda kv: (-kv[1], kv[0]))),
        "integrity": {
            "record_count": len(points),
            "minimum_records": MIN_RECORDS,
            "longitude_range": [min(lons), max(lons)],
            "latitude_range": [min(lats), max(lats)],
            "envelope": {"longitude": list(LON_RANGE), "latitude": list(LAT_RANGE)},
            "rounded_to_decimals": DECIMALS,
        },
        "interpretation_ceiling": SEMANTICS
        + " Used only to place published origin municipalities on a map; it carries no tourism, population or flow information.",
        "refresh": "python scripts/build_municipality_reference_points.py --zip BD_Municipios-Entidades.zip (archive downloaded manually from the CNIG download centre)",
    }
    OUT.write_text(json.dumps(artifact, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    META.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(points)} municipalities, edition {edition}, wrote {OUT.relative_to(ROOT)} and {META.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
