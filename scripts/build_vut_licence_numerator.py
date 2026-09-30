#!/usr/bin/env python3
"""Build the canonical Madrid licensed-VUT numerator (Gate B, Candidate A).

    OFFICIAL LICENCE EXTRACT -> FETCH XLSX + SHP -> PARSE -> JOIN BY EXPEDIENTE
    -> REPROJECT -> CANONICAL BARRIO CONTAINMENT -> AGGREGATE -> ARTIFACT

This is a NUMERATOR ONLY. It computes no ratio, no per-resident figure, no
density, no ranking and no composite score, and it never touches the Padron
denominator. See docs/ACCOMMODATION_NUMERATOR_GATE_B.md for the feasibility
gate that admitted this source.

Authoritative source
--------------------
Ayuntamiento de Madrid, dataset "Viviendas de uso turistico con licencia"
(datos.madrid.es 300694), CC BY 4.0. Responsible unit, per the dataset's own
structure document: Agencia de Actividades - Subdireccion General de Actividades
Economicas - Servicio de Licencias y Consultas. Update frequency: bimonthly.

Universe (narrow, and must be named as such)
--------------------------------------------
Urban-planning ACTIVITY LICENCES GRANTED in the city of Madrid for hospedaje
use in the tourist-dwelling (VUT) typology. The publisher states explicitly that
no other hospedaje modality is included - not hotels, hostels, guest houses,
pensions, aparthotels, nor tourist apartments. This is therefore NOT "all
accommodation", NOT "all VUT in operation", NOT the regional tourism-accommodation
inventory, and NOT online platform listings. Those are separate universes.

Unit of analysis
----------------
One source row = one granted activity licence, identified by EXPEDIENTE_LU.
The publisher's own structure document defines column "N VUT" as the "numero de
unidades de viviendas de uso turistico incluidas en cada licencia urbanistica de
actividad" - the number of tourist-dwelling UNITS contained in each licence. One
licence can therefore cover many dwellings, so two different figures exist and
are NOT interchangeable:

    vut_licences = COUNT(distinct EXPEDIENTE_LU)
    vut_units    = SUM(N VUT)

Both are emitted. Neither may be described with the other's name.

Geography
---------
The SHP resource carries one PointZ per record in EPSG:25830 (ETRS89 / UTM 30N),
declared by the .prj and by the shapefile's own metadata. Points are reprojected
to EPSG:4326 and resolved against the canonical geography by containment. The
XLSX and SHP resources are joined by EXPEDIENTE, never by row order: the two
resources are published in different orders.

The source DISTRITO column is a free-text label (25 distinct spellings for 21
districts, with accent and hyphen variants) and is never used as a join key. It
is compared against the geometry-derived district and disagreements are reported,
never silently overwritten.

Zero is a true zero here
------------------------
A barrio with no granted licence is emitted with 0, not as missing data. The
source enumerates granted licences for the whole municipality, so the absence of
a licence in a barrio is an observation, not a coverage gap. This is the one
place where this project's "missing is not zero" rule does not apply, and the
reason is recorded in the sidecar metadata.

Vintage rule
------------
The source publishes no reference-date field and no effective date. Four distinct
dates exist and this builder never collapses them into one:

  1. catalogue metadata dates published by the portal (not recorded here);
  2. the HTTP Last-Modified header observed on each resource file, which is a
     transport-level fact about the file served, NOT a publisher-declared
     publication or reference date;
  3. the per-record RESOLUCION, the date each licence was granted;
  4. retrieved_at, this builder's own clock.

The artifact records (2) as an observed resource-file state and (3) as the span
of grant dates present in the current extract. The build clock is recorded
separately and is never presented as the source date.

What the extract does NOT establish
-----------------------------------
The source publishes no documented retention policy for revoked, expired or
ceased licences, so this builder does not describe the extract as a cumulative
stock, nor assert that every licence ever granted is still present. It states
only what is verifiable: the current published extract contains granted
activity-licence records whose grant dates span the observed range, and it
carries no revocation, expiry or cessation field. The artifact therefore cannot
establish current operation and must never be called "operating VUT".

Dependencies
------------
Standard library for fetching (urllib), archive handling (zipfile) and I/O
(json, struct, xml). `shapely` and `pyproj` are BUILDER-ONLY dependencies, needed
for containment and reprojection; the committed artifact is plain JSON and the
test suite does not need them. Install with `pip install shapely pyproj` to
regenerate.

Usage
-----
    python scripts/build_vut_licence_numerator.py
    python scripts/build_vut_licence_numerator.py --out-dir data/accommodation
"""

from __future__ import annotations

import argparse
import collections
import datetime as _dt
import hashlib
import json
import re
import struct
import sys
import unicodedata
import urllib.request
import zipfile
from pathlib import Path

DATASET_ID = "300694-0-viviendas-turisticas-geoportal"
DATASET_URL = "https://datos.madrid.es/dataset/300694-0-viviendas-turisticas-geoportal"
XLSX_URL = (
    "https://geoportal.madrid.es/fsdescargas/IDEAM_WBGEOPORTAL/VIVIENDA/"
    "VIVIENDAS_TURISTICAS/VIVIENDAS_USO_TURISTICO.xlsx"
)
SHP_ZIP_URL = (
    "https://geoportal.madrid.es/fsdescargas/IDEAM_WBGEOPORTAL/VIVIENDA/"
    "VIVIENDAS_TURISTICAS/VIVIENDAS_USO_TURISTICO.zip"
)
SOURCE_CRS = "EPSG:25830"
OUTPUT_CRS = "EPSG:4326"

# Provenance vocabulary. Nothing in this artifact is SOURCE_REPORTED: the source
# publishes licence records, never barrio figures. Barrio totals are derived by
# this project from those records; district and municipality totals are derived
# in turn from the already-aggregated barrio values.
DERIVED_FROM_LICENCE_RECORDS = "DERIVED_FROM_LICENCE_RECORDS"
DERIVED_FROM_BARRIO_TOTALS = "DERIVED_FROM_BARRIO_TOTALS"

REPO_ROOT = Path(__file__).resolve().parent.parent
GEOGRAPHY = REPO_ROOT / "data" / "geography" / "madrid_admin.geojson"

# ----------------------------------------------------------------- XLSX reader

_SSML = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def read_xlsx_rows(data: bytes) -> list[dict[str, str]]:
    """Return the first worksheet as a list of {column-letter: text} dicts."""
    from xml.etree import ElementTree as ET

    with zipfile.ZipFile(__import__("io").BytesIO(data)) as zf:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in zf.namelist():
            root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in root.findall(f"{_SSML}si"):
                shared.append("".join(t.text or "" for t in si.iter(f"{_SSML}t")))
        sheet = ET.fromstring(zf.read("xl/worksheets/sheet1.xml"))

    rows: list[dict[str, str]] = []
    for row in sheet.iter(f"{_SSML}row"):
        cells: dict[str, str] = {}
        for cell in row.findall(f"{_SSML}c"):
            ref = cell.get("r") or ""
            match = re.match(r"([A-Z]+)", ref)
            if not match:
                continue
            kind = cell.get("t")
            value_el = cell.find(f"{_SSML}v")
            if kind == "s" and value_el is not None:
                text = shared[int(value_el.text or "0")]
            elif kind == "inlineStr":
                text = "".join(t.text or "" for t in cell.iter(f"{_SSML}t"))
            else:
                text = value_el.text if value_el is not None else ""
            cells[match.group(1)] = text or ""
        rows.append(cells)
    return rows


def parse_licence_rows(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    """Map the XLSX grid onto licence records, dropping the publisher's trailer.

    The published workbook ends with summary rows carrying COUNTIF/SUM formulas
    over the data range (and blank spacer rows). They are not licences: counting
    every populated row, or summing the unit column over the whole sheet, would
    both overstate the numerator. A licence row is identified by having a
    non-empty EXPEDIENTE_LU, which is the source's own record identifier.
    """
    if not rows:
        return []
    header = {letter: (name or "").strip() for letter, name in rows[0].items()}
    records = []
    for row in rows[1:]:
        record = {header[letter]: value for letter, value in row.items() if letter in header}
        if normalise_text(record.get("EXPEDIENTE_LU")):
            records.append(record)
    return records


# ------------------------------------------------------- shapefile (DBF + SHP)


def read_dbf(data: bytes, encoding: str = "utf-8") -> list[dict[str, str]]:
    """Return DBF records as dicts of stripped text, preserving file order."""
    record_count, header_len, record_len = struct.unpack("<IHH", data[4:12])
    fields: list[tuple[str, int]] = []
    offset = 32
    while data[offset] != 0x0D:
        descriptor = data[offset : offset + 32]
        name = descriptor[:11].split(b"\x00")[0].decode("latin-1")
        fields.append((name, descriptor[16]))
        offset += 32
    out = []
    for index in range(record_count):
        start = header_len + index * record_len
        raw = data[start : start + record_len]
        if raw[:1] == b"*":       # tombstoned record
            continue
        position = 1
        record = {}
        for name, length in fields:
            record[name] = raw[position : position + length].decode(encoding, "replace").strip()
            position += length
        out.append(record)
    return out


def read_shp_points(data: bytes) -> list[tuple[float, float] | None]:
    """Return one (x, y) per shapefile record; None for a null shape."""
    points: list[tuple[float, float] | None] = []
    offset = 100
    while offset < len(data):
        _number, content_len = struct.unpack(">ii", data[offset : offset + 8])
        body = data[offset + 8 : offset + 8 + content_len * 2]
        shape_type = struct.unpack("<i", body[:4])[0]
        if shape_type == 0:
            points.append(None)
        elif shape_type in (1, 11, 21):      # Point, PointZ, PointM
            points.append(struct.unpack("<dd", body[4:20]))
        else:
            raise ValueError(f"unsupported shapefile geometry type {shape_type}")
        offset += 8 + content_len * 2
    return points


# ------------------------------------------------------------- pure helpers


def normalise_text(value: str | None) -> str:
    """Collapse whitespace; the source carries stray leading spaces."""
    return " ".join((value or "").split())


def parse_units(value: str | None) -> int:
    """Parse the 'N VUT' column, which is a Double in the SHP and an int in XLSX.

    An absent or unparseable unit count is an error rather than an assumed 1:
    silently defaulting would fabricate dwellings that the source never granted.
    """
    text = normalise_text(value)
    if not text:
        raise ValueError("missing VUT unit count")
    number = float(text.replace(",", "."))
    if number != int(number) or number < 0:
        raise ValueError(f"non-integer VUT unit count: {value!r}")
    return int(number)


def district_label_key(value: str | None) -> str:
    """Fold a free-text DISTRITO label for comparison only, never for joining.

    The source publishes 25 spellings for 21 districts (accent and hyphen
    variants such as 'Tetuan'/'Tetuán', 'San Blas - Canillejas'). This folding
    exists solely so the comparison against the geometry-derived district does
    not report cosmetic differences as disagreements.
    """
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(c for c in text if not unicodedata.combining(c)).upper()
    text = text.replace("DISTRITO DE ", "").replace("-", " ")
    return " ".join(text.split())


def summarise_grant_dates(dates: list[str]) -> dict[str, object]:
    """Describe the span of RESOLUCION grant dates present in the extract."""
    clean = sorted(d for d in (normalise_text(x) for x in dates) if re.fullmatch(r"\d{8}", d))
    def iso(value: str) -> str:
        return f"{value[:4]}-{value[4:6]}-{value[6:]}"
    return {
        "records_with_grant_date": len(clean),
        "earliest_grant_date": iso(clean[0]) if clean else None,
        "latest_grant_date": iso(clean[-1]) if clean else None,
        "by_year": dict(sorted(collections.Counter(d[:4] for d in clean).items())),
    }


def aggregate_by_barrio(joined: list[dict[str, object]]) -> dict[str, dict[str, int]]:
    """Sum licences and VUT units per barrio official_id."""
    totals: dict[str, dict[str, int]] = {}
    for record in joined:
        barrio = record["barrio_id"]
        if barrio is None:
            continue
        bucket = totals.setdefault(str(barrio), {"vut_licences": 0, "vut_units": 0})
        bucket["vut_licences"] += 1
        bucket["vut_units"] += int(record["vut_units"])
    return totals


# ---------------------------------------------------------------- fetching


def fetch(url: str) -> tuple[bytes, dict[str, str]]:
    request = urllib.request.Request(url, headers={"User-Agent": "madrid-tourism-lens/gate-b"})
    with urllib.request.urlopen(request, timeout=180) as response:
        payload = response.read()
        headers = {
            "last_modified": response.headers.get("Last-Modified"),
            "etag": response.headers.get("ETag"),
            "content_length": response.headers.get("Content-Length"),
        }
    headers["sha256"] = hashlib.sha256(payload).hexdigest()
    headers["bytes"] = len(payload)
    return payload, headers


def _require_geospatial():
    try:
        from pyproj import Transformer
        from shapely.geometry import Point, shape
    except ImportError as exc:                                   # pragma: no cover
        raise SystemExit(
            "shapely and pyproj are required to reproject and resolve the licence "
            "points against the canonical geography (pip install shapely pyproj)"
        ) from exc
    return Transformer, Point, shape


# ------------------------------------------------------------------- build


def build(out_dir: Path) -> None:
    Transformer, Point, shape = _require_geospatial()

    print(f"[vut] fetching {XLSX_URL}")
    xlsx_bytes, xlsx_http = fetch(XLSX_URL)
    print(f"[vut] fetching {SHP_ZIP_URL}")
    zip_bytes, zip_http = fetch(SHP_ZIP_URL)

    licences = parse_licence_rows(read_xlsx_rows(xlsx_bytes))
    print(f"[vut] {len(licences)} licence rows in the workbook (trailer rows dropped)")

    with zipfile.ZipFile(__import__("io").BytesIO(zip_bytes)) as zf:
        names = {Path(n).suffix.lower(): n for n in zf.namelist()}
        dbf_records = read_dbf(zf.read(names[".dbf"]))
        shp_points = read_shp_points(zf.read(names[".shp"]))
        projection = zf.read(names[".prj"]).decode("latin-1")
    if "25830" not in projection and "UTM_Zone_30N" not in projection:
        raise SystemExit(f"unexpected shapefile projection: {projection[:120]}")
    if len(dbf_records) != len(shp_points):
        raise SystemExit("shapefile attribute and geometry counts disagree")

    # Join by EXPEDIENTE. The two resources are published in different row
    # orders, so positional zipping would mis-assign every geometry.
    geometry_by_expediente: dict[str, tuple[float, float] | None] = {}
    for record, point in zip(dbf_records, shp_points):
        geometry_by_expediente[normalise_text(record.get("EXPEDIENTE"))] = point
    district_by_expediente = {
        normalise_text(r.get("EXPEDIENTE")): r.get("DISTRITO") for r in dbf_records
    }

    geography = json.loads(GEOGRAPHY.read_text(encoding="utf-8"))
    features = geography["features"]
    municipality = next(
        shape(f["geometry"]) for f in features
        if f["properties"]["geography_level"] == "municipality"
    )
    districts = [
        (f["properties"], shape(f["geometry"])) for f in features
        if f["properties"]["geography_level"] == "district"
    ]
    barrios = [
        (f["properties"], shape(f["geometry"])) for f in features
        if f["properties"]["geography_level"] == "barrio"
    ]
    transformer = Transformer.from_crs(SOURCE_CRS, OUTPUT_CRS, always_xy=True)

    joined: list[dict[str, object]] = []
    label_disagreements: list[dict[str, str]] = []
    missing_geometry: list[str] = []
    outside_municipality: list[str] = []

    for licence in licences:
        expediente = normalise_text(licence.get("EXPEDIENTE_LU"))
        units = parse_units(licence.get("UNIDADES_VUT"))
        point = geometry_by_expediente.get(expediente)
        entry: dict[str, object] = {
            "expediente": expediente,
            "vut_units": units,
            "barrio_id": None,
            "district_id": None,
        }
        if point is None:
            missing_geometry.append(expediente)
            joined.append(entry)
            continue
        lon, lat = transformer.transform(point[0], point[1])
        geom = Point(lon, lat)
        if not municipality.covers(geom):
            outside_municipality.append(expediente)
        district = next((props for props, poly in districts if poly.covers(geom)), None)
        barrio = next((props for props, poly in barrios if poly.covers(geom)), None)
        entry["district_id"] = district["official_id"] if district else None
        entry["barrio_id"] = barrio["official_id"] if barrio else None
        if district:
            source_label = district_by_expediente.get(expediente) or licence.get("DISTRITO")
            if district_label_key(source_label) != district_label_key(district["official_name"]):
                label_disagreements.append({
                    "expediente": expediente,
                    "source_district_label": normalise_text(source_label),
                    "geometry_district_id": district["official_id"],
                    "geometry_district_name": district["official_name"],
                })
        joined.append(entry)

    resolved = [e for e in joined if e["barrio_id"]]
    print(f"[vut] {len(resolved)}/{len(joined)} licences resolved to a canonical barrio")
    if label_disagreements:
        print(f"[vut] {len(label_disagreements)} source DISTRITO label(s) disagree with the geometry")

    totals = aggregate_by_barrio(joined)
    records = []
    barrio_props = {props["official_id"]: props for props, _ in barrios}
    district_totals: dict[str, dict[str, int]] = {}
    for official_id, props in sorted(barrio_props.items()):
        value = totals.get(official_id, {"vut_licences": 0, "vut_units": 0})
        records.append({
            "geography_level": "barrio",
            "official_id": official_id,
            "parent_id": props["parent_id"],
            "vut_licences": value["vut_licences"],
            "vut_units": value["vut_units"],
            # Barrio totals are NOT reported by the source. The source publishes
            # individual licence records; this project derives the barrio figure
            # by reprojecting the source geometry and aggregating by containment.
            "value_provenance": DERIVED_FROM_LICENCE_RECORDS,
        })
        bucket = district_totals.setdefault(props["parent_id"], {"vut_licences": 0, "vut_units": 0})
        bucket["vut_licences"] += value["vut_licences"]
        bucket["vut_units"] += value["vut_units"]

    for props, _ in sorted(districts, key=lambda d: d[0]["official_id"]):
        value = district_totals.get(props["official_id"], {"vut_licences": 0, "vut_units": 0})
        records.append({
            "geography_level": "district",
            "official_id": props["official_id"],
            "parent_id": props["parent_id"],
            "vut_licences": value["vut_licences"],
            "vut_units": value["vut_units"],
            "value_provenance": DERIVED_FROM_BARRIO_TOTALS,
        })
    records.append({
        "geography_level": "municipality",
        "official_id": "28079",
        "parent_id": None,
        "vut_licences": sum(v["vut_licences"] for v in district_totals.values()),
        "vut_units": sum(v["vut_units"] for v in district_totals.values()),
        "value_provenance": DERIVED_FROM_BARRIO_TOTALS,
    })

    retrieved_at = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    grant_dates = summarise_grant_dates([r.get("RESOLUCION", "") for r in dbf_records])

    artifact = {
        "contract_version": "1.0.0",
        "source_state": {
            "xlsx_http_last_modified": xlsx_http["last_modified"],
            "shp_http_last_modified": zip_http["last_modified"],
            "http_last_modified_is_not_a_reference_date": (
                "These are the HTTP Last-Modified headers observed on the resource files "
                "when this build fetched them. They describe the state of the file served, "
                "not a publisher-declared publication, effective or reference date. The "
                "source declares none."
            ),
            "grant_date_span": grant_dates,
        },
        "counts": {
            "licences": len(licences),
            "vut_units": sum(parse_units(r.get("UNIDADES_VUT")) for r in licences),
            "barrios_with_at_least_one_licence": len(totals),
            "barrios": len(barrio_props),
        },
        "records": records,
    }
    meta = {
        "contract_version": "1.0.0",
        "title": "Madrid licensed tourist-dwelling (VUT) activity licences and units, by canonical barrio",
        "artifact": "madrid_vut_licences.json",
        "source": {
            "authority": "Ayuntamiento de Madrid - Agencia de Actividades, Subdireccion General de Actividades Economicas, Servicio de Licencias y Consultas",
            "dataset": "Viviendas de uso turistico con licencia",
            "dataset_id": DATASET_ID,
            "catalogue": DATASET_URL,
            "resources": {
                "xlsx": {"url": XLSX_URL, **{k: v for k, v in xlsx_http.items()}},
                "shp_zip": {"url": SHP_ZIP_URL, **{k: v for k, v in zip_http.items()}},
            },
            "license": "CC BY 4.0",
            "license_url": "https://creativecommons.org/licenses/by/4.0/",
            "attribution": "(c) Ayuntamiento de Madrid",
            "update_frequency": "bimonthly",
        },
        "universe": {
            "includes": "Urban-planning activity licences GRANTED in the city of Madrid for hospedaje use in the tourist-dwelling (vivienda de uso turistico) typology.",
            "excludes": "Every other hospedaje modality, named by the publisher: tourist apartments, hostels, guest houses, hotels, pensions and aparthotels.",
            "is_not": [
                "all tourist dwellings operating in Madrid",
                "all VUT responsible declarations filed with the Comunidad de Madrid",
                "the Comunidad de Madrid regional tourism-accommodation inventory",
                "online platform listings",
                "accommodation capacity, beds or places",
            ],
            "grant_decision": "Every record in the audited extract carries DECRETO_LU = 'Conceder'; the extract contains granted licences only.",
            "currency_caveat": "The current published extract contains granted activity-licence records whose grant dates span the range recorded in source_period.grant_date_span. The source carries no revocation, expiry or cessation field and publishes no retention policy for licences that were later revoked or ceased, so the extract cannot establish current operation and must never be called 'operating VUT'. It is not described here as a cumulative stock, because the source does not document one.",
        },
        "unit_of_analysis": {
            "row": "One granted urban-planning activity licence (expediente).",
            "vut_licences": "COUNT of distinct EXPEDIENTE_LU.",
            "vut_units": "SUM of the source column 'N VUT', defined by the publisher as the number of tourist-dwelling units included in each activity licence.",
            "not_interchangeable": "A licence is not a dwelling. In the audited extract 1 licence covered up to 48 units, so the two figures must never be given each other's name.",
        },
        "identity": {
            "key": "EXPEDIENTE_LU",
            "rule": "The licence expediente is the source's record identifier; no deduplication by address or name is performed.",
            "multiple_licences_per_address": "Several licences may share one official address (COD_NDP); those are distinct licences, not duplicates.",
        },
        "geography_linkage": {
            "geography_artifact": "data/geography/madrid_admin.geojson",
            "barrio_geography_version": "v3.4.1",
            "district_geography_version": "v3.2.1",
            "method": "Source PointZ geometry in EPSG:25830, reprojected to EPSG:4326, resolved by polygon containment against the canonical geography.",
            "resource_join": "XLSX and SHP are joined by EXPEDIENTE, never by row order: the resources are published in different orders.",
            "source_district_label": "The source DISTRITO column is free text (25 spellings for 21 districts) and is never used as a join key; disagreements with the geometry-derived district are reported, not overwritten.",
            "resolved_to_barrio": len(resolved),
            "records_total": len(joined),
            "missing_geometry": missing_geometry,
            "outside_municipality": outside_municipality,
            "district_label_disagreements": label_disagreements,
        },
        "zero_semantics": {
            "zero_is_a_real_zero": True,
            "scope": "within this published source extract and its Madrid-wide coverage",
            "why": "The extract enumerates granted activity-licence records across the whole municipality, so a barrio with no matched source record receives zero published granted-licence records and zero source-reported VUT units, rather than missing data. This is the exception to this project's 'missing is not zero' rule and it is scoped to this artifact's source universe and source state.",
            "is_not": "A zero is NOT an assertion that no tourist-dwelling activity has ever existed or exists today in that barrio. It states only what this extract contains.",
        },
        "source_period": {
            "reference_date_published_by_source": False,
            "effective_date_published_by_source": False,
            "xlsx_http_last_modified": xlsx_http["last_modified"],
            "grant_date_span": grant_dates,
            "semantics": "The source declares no reference or effective date. What can be stated honestly is (a) the HTTP Last-Modified header observed on the resource file, which describes the file served and is not a publisher-declared publication or reference date, and (b) the span of per-record licence grant dates present in the current extract. Portal metadata dates, the HTTP header, the per-record grant dates and this builder's retrieved_at clock are four different things and are never collapsed into one.",
        },
        "denominator_note": "This artifact carries no population, no ratio and no rate. The Padron denominator has its own reference date (1 January 2026) which differs from this source's state; any future indicator must show both periods rather than imply they coincide.",
        "retrieved_at": retrieved_at,
        "builder": "scripts/build_vut_licence_numerator.py",
        "interpretation_ceiling": (
            "A count of granted urban-planning activity licences, and of the tourist-dwelling "
            "units those licences contain, for the city of Madrid. It is NOT all accommodation, "
            "NOT all tourist dwellings in operation, NOT beds, rooms or places, NOT a measure of "
            "tourism pressure, overtourism, saturation, carrying capacity, tourism intensity, "
            "resident displacement, neighbourhood burden, impact or attractiveness, and NOT a "
            "ratio of any kind. Counts belong to the whole official barrio and must never be "
            "spatially distributed into a circular Lens."
        ),
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "madrid_vut_licences.json").write_text(
        json.dumps(artifact, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (out_dir / "madrid_vut_licences.meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        f"[vut] wrote {out_dir}: {artifact['counts']['licences']} licences, "
        f"{artifact['counts']['vut_units']} VUT units, "
        f"{artifact['counts']['barrios_with_at_least_one_licence']}/{len(barrio_props)} barrios covered"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--out-dir", default="data/accommodation", type=Path)
    args = parser.parse_args(argv)
    build(REPO_ROOT / args.out_dir if not args.out_dir.is_absolute() else args.out_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
