#!/usr/bin/env python3
"""Build the canonical Madrid residential population denominator.

    OFFICIAL PADRON SOURCE -> FETCH -> SELECT PERIOD -> NORMALISE -> RECONCILE
    -> VALIDATE AGAINST CANONICAL GEOGRAPHY -> DERIVE DISTRICT/MUNICIPALITY -> ARTIFACT

This establishes ONE authoritative, period-explicit resident-population value for
every canonical Madrid barrio (PR #25 geography), with deterministic district and
municipality aggregation. It is a denominator only: this builder computes no
tourism indicator, ratio, density or composite score.

Authoritative source
--------------------
Ayuntamiento de Madrid - Subdireccion General de Estadistica, dataset
"Poblacion por distrito y barrio a 1 de enero" (datos.madrid.es dataset 300557),
CC BY 4.0. Its own description names the source as the "Padron Municipal de
habitantes". It publishes official annual population by district and barrio at a
single, explicit reference date (1 January of each year), with official
municipality/district/barrio codes and a total person count per barrio.

It is chosen over the monthly "Padron municipal" dataset (200076) because:
  - it has an explicit 1 January reference date (a real source period), where the
    monthly file is a rolling end-of-month snapshot;
  - it is published at exactly district and barrio level (no seccion censal);
  - its num_personas column is already the barrio total, so no aggregation over
    sex or age is required and there is no double-counting risk.

Population concept
------------------
num_personas is the number of persons registered in the municipal Padron for the
reference date. Registered residents are NOT people physically present at a given
moment, daytime population, tourists, workers present, unique mobile-device users,
households or housing units. See the interpretation ceiling in the metadata.

Vintage rule
------------
The population period is the source reference date (e.g. 2026-01-01), never the
build time. The build time is recorded separately as retrieved_at in the sidecar
metadata. The geography version (barrio v3.4.1 / district v3.2.1) is recorded too
and is distinct from the population period.

Dependencies
------------
Standard library only (urllib, csv, json). No geospatial library: the join to the
canonical geography is by official code, not by geometry.

Usage
-----
    python scripts/build_madrid_population.py
    python scripts/build_madrid_population.py --period 2025
    python scripts/build_madrid_population.py --out-dir data/population
"""

from __future__ import annotations

import argparse
import csv
import datetime as _dt
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

DATASET_ID = "300557-0-poblacion-distrito-barrio"
CSV_URL = (
    "https://datos.madrid.es/dataset/300557-0-poblacion-distrito-barrio/"
    "resource/300557-0-poblacion-distrito-barrio-csv/download/"
    "300557-0-poblacion-distrito-barrio-csv.csv"
)
CATALOGUE_URL = "https://datos.madrid.es/dataset/300557-0-poblacion-distrito-barrio"

INE_MADRID_MUNICIPAL_CODE = "28079"
GEOGRAPHY_ARTIFACT = "data/geography/madrid_admin.geojson"
GEOGRAPHY_META = "data/geography/madrid_admin.meta.json"

CONTRACT_VERSION = "1.0.0"
USER_AGENT = "madrid-tourism-intelligence-lens/population-builder (+https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens)"

DERIVED = "DERIVED_FROM_BARRIO_POPULATION"
SOURCE_REPORTED = "SOURCE_REPORTED"


# --------------------------------------------------------------------- fetching


def _get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=90) as response:  # noqa: S310 (trusted official host)
        return response.read()


def fetch_population_csv() -> str:
    return _get(CSV_URL).decode("utf-8-sig")


# ------------------------------------------------------------------ parsing


def parse_int(value: str) -> int:
    """Parse a Spanish-formatted integer person count ('23.410' -> 23410).

    The dot is a thousands separator; person counts have no decimals. Anything
    that is not a clean non-negative integer raises, so a malformed cell cannot
    become a silent zero or a truncated number.
    """
    cleaned = value.strip().replace(".", "").replace("\xa0", "").replace(" ", "")
    if not re.fullmatch(r"\d+", cleaned):
        raise ValueError(f"not a non-negative integer: {value!r}")
    return int(cleaned)


def parse_year(fecha: str) -> str:
    """Parse only the source contract's explicit 1-January reference date."""
    match = re.fullmatch(
        r"\s*1\s+de\s+enero\s+de\s+(\d{4})\s*",
        fecha,
        flags=re.IGNORECASE,
    )
    if not match:
        raise ValueError(
            f"reference date {fecha!r} does not match the source contract '1 de enero de YYYY'"
        )
    return match.group(1)


def parse_population_csv(text: str) -> list[dict]:
    """Parse source rows and enforce the published population schema.

    Besides parsing the official total, this checks two source-contract facts
    before any geography reconciliation happens:
      - every row belongs to Madrid municipality (28079);
      - num_personas equals num_personas_hombres + num_personas_mujeres.

    That turns the metadata's statement about the sex split into an enforced
    ingestion invariant rather than an undocumented manual observation.
    """
    reader = csv.DictReader(io.StringIO(text), delimiter=";")
    required = {
        "fecha",
        "cod_municipio",
        "cod_distrito",
        "cod_barrio",
        "num_personas",
        "num_personas_hombres",
        "num_personas_mujeres",
    }
    missing = required - set(h.strip() for h in (reader.fieldnames or []))
    if missing:
        raise SystemExit(f"source CSV is missing expected columns: {sorted(missing)}")

    rows = []
    for row_number, raw in enumerate(reader, start=2):
        municipality = raw["cod_municipio"].strip()
        if municipality != INE_MADRID_MUNICIPAL_CODE:
            raise SystemExit(
                f"row {row_number}: cod_municipio={municipality!r}; expected Madrid "
                f"{INE_MADRID_MUNICIPAL_CODE!r}"
            )

        total = parse_int(raw["num_personas"])
        men = parse_int(raw["num_personas_hombres"])
        women = parse_int(raw["num_personas_mujeres"])
        if total != men + women:
            raise SystemExit(
                f"row {row_number}: num_personas={total} but hombres+mujeres={men + women}"
            )

        rows.append(
            {
                "year": parse_year(raw["fecha"]),
                "fecha": raw["fecha"].strip(),
                "cod_municipio": municipality,
                "cod_distrito": raw["cod_distrito"].strip(),
                "cod_barrio": raw["cod_barrio"].strip(),
                "barrio_name": (raw.get("barrio") or "").strip(),
                "residents": total,
            }
        )
    return rows


def select_period(rows: list[dict], canonical_barrio_count: int, requested: str | None) -> str:
    """Pick the reference year, defaulting to the latest COMPLETE one.

    Completeness is defined against the canonical geography: a year is complete
    only when it carries exactly the canonical number of barrios. This avoids
    treating the newest year as complete merely because it has the newest date.
    """
    by_year: dict[str, int] = {}
    for r in rows:
        by_year[r["year"]] = by_year.get(r["year"], 0) + 1

    if requested is not None:
        if requested not in by_year:
            raise SystemExit(f"requested period {requested} is not in the source (years: {sorted(by_year)})")
        return requested

    complete = sorted(y for y, n in by_year.items() if n == canonical_barrio_count)
    if not complete:
        raise SystemExit(
            f"no year has the canonical {canonical_barrio_count} barrios "
            f"(counts by year: {dict(sorted(by_year.items()))})"
        )
    return complete[-1]


# ------------------------------------------------------------- reconciliation


def load_canonical_geography(repo_root: Path) -> tuple[dict, dict, dict]:
    geo = json.loads((repo_root / GEOGRAPHY_ARTIFACT).read_text(encoding="utf-8"))
    barrio_parent = {}
    barrio_name = {}
    district_ids = set()
    for f in geo["features"]:
        p = f["properties"]
        if p["geography_level"] == "barrio":
            barrio_parent[p["official_id"]] = p["parent_id"]
            barrio_name[p["official_id"]] = p["official_name"]
        elif p["geography_level"] == "district":
            district_ids.add(p["official_id"])
    return barrio_parent, barrio_name, district_ids


def normalise_codes(row: dict) -> tuple[str, str]:
    """Map source codes to canonical official_ids by deterministic zero-padding.

    Source cod_barrio/cod_distrito are the same official numeric codes as the
    canonical geography but without leading zeros (Centro/Palacio is 1/11 in the
    source, 01/011 in the geography). This is a pure numeric zero-pad, never a
    name-based or fuzzy match. The result is checked exactly against the canonical
    ids by the caller, so a wrong mapping fails rather than being accepted.
    """
    district_id = row["cod_distrito"].zfill(2)
    barrio_id = row["cod_barrio"].zfill(3)
    return district_id, barrio_id


def reconcile(period_rows: list[dict], barrio_parent: dict) -> list[dict]:
    """Reconcile source rows to canonical barrio ids; fail on any mismatch."""
    seen: dict[str, dict] = {}
    for row in period_rows:
        district_id, barrio_id = normalise_codes(row)
        if barrio_id not in barrio_parent:
            raise SystemExit(
                f"population barrio code {row['cod_barrio']} -> {barrio_id} "
                f"({row['barrio_name']}) is not a canonical barrio"
            )
        if barrio_parent[barrio_id] != district_id:
            raise SystemExit(
                f"barrio {barrio_id} ({row['barrio_name']}) declares parent district {district_id}, "
                f"but the canonical geography says {barrio_parent[barrio_id]}"
            )
        if barrio_id in seen:
            raise SystemExit(f"duplicate barrio {barrio_id} in the selected period")
        if row["residents"] < 0:
            raise SystemExit(f"barrio {barrio_id} has negative population {row['residents']}")
        seen[barrio_id] = {"official_id": barrio_id, "parent_id": district_id, "residents": row["residents"]}

    missing = sorted(set(barrio_parent) - set(seen))
    if missing:
        raise SystemExit(f"the selected period is missing {len(missing)} canonical barrio(s), e.g. {missing[:5]}")
    return [seen[bid] for bid in sorted(seen)]


def derive_totals(barrios: list[dict]) -> tuple[list[dict], int]:
    """Deterministic district and municipality totals from the barrio populations."""
    district: dict[str, int] = {}
    for b in barrios:
        district[b["parent_id"]] = district.get(b["parent_id"], 0) + b["residents"]
    district_records = [
        {"official_id": did, "parent_id": INE_MADRID_MUNICIPAL_CODE, "residents": district[did]}
        for did in sorted(district)
    ]
    municipality_total = sum(b["residents"] for b in barrios)
    return district_records, municipality_total


# --------------------------------------------------------------- serialisation


def write_json(path: Path, obj) -> None:
    # Deterministic and cross-platform: LF endings, trailing newline, UTF-8.
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Build canonical Madrid residential population denominator")
    parser.add_argument("--out-dir", default="data/population")
    parser.add_argument("--period", default=None, help="Reference year, e.g. 2026. Default: latest complete year.")
    args = parser.parse_args(argv)

    repo_root = Path(__file__).resolve().parents[1]
    out_dir = (repo_root / args.out_dir) if not Path(args.out_dir).is_absolute() else Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print("[population] loading canonical geography ...")
    barrio_parent, _barrio_name, _district_ids = load_canonical_geography(repo_root)
    geo_meta = json.loads((repo_root / GEOGRAPHY_META).read_text(encoding="utf-8"))
    geo_versions = geo_meta.get("source_version", {}).get("datasets", {})

    print("[population] fetching official Padron population by barrio ...")
    rows = parse_population_csv(fetch_population_csv())

    period_year = select_period(rows, len(barrio_parent), args.period)
    period_rows = [r for r in rows if r["year"] == period_year]
    reference_date = f"{period_year}-01-01"
    fecha_label = period_rows[0]["fecha"]
    print(f"[population] selected reference period {reference_date} ({fecha_label})")

    barrios = reconcile(period_rows, barrio_parent)
    district_records, municipality_total = derive_totals(barrios)

    # Canonical artifact: municipality, then districts (sorted), then barrios
    # (sorted). Barrio counts are source-reported; district/municipality totals
    # are derived and flagged as such.
    records = [
        {
            "geography_level": "municipality",
            "official_id": INE_MADRID_MUNICIPAL_CODE,
            "parent_id": None,
            "residents": municipality_total,
            "residents_provenance": DERIVED,
        }
    ]
    for d in district_records:
        records.append(
            {
                "geography_level": "district",
                "official_id": d["official_id"],
                "parent_id": d["parent_id"],
                "residents": d["residents"],
                "residents_provenance": DERIVED,
            }
        )
    for b in barrios:
        records.append(
            {
                "geography_level": "barrio",
                "official_id": b["official_id"],
                "parent_id": b["parent_id"],
                "residents": b["residents"],
                "residents_provenance": SOURCE_REPORTED,
            }
        )

    population = {
        "contract_version": CONTRACT_VERSION,
        # The period is source-derived and part of the data: every record is for
        # this reference date. The build time lives only in the sidecar metadata,
        # so this artifact does not churn when rebuilt for the same period.
        "source_period": {
            "reference_date": reference_date,
            "label": fecha_label,
            "type": "padron_annual_reference_date",
            "provisional": False,
        },
        "counts": {"municipality": 1, "districts": len(district_records), "barrios": len(barrios)},
        "records": records,
    }

    meta = {
        "contract_version": CONTRACT_VERSION,
        "title": "Canonical Madrid residential population denominator (barrio, with district and municipality totals)",
        "artifact": "madrid_population.json",
        "source": {
            "authority": "Ayuntamiento de Madrid - Subdireccion General de Estadistica",
            "dataset": "Poblacion por distrito y barrio a 1 de enero",
            "dataset_id": DATASET_ID,
            "catalogue": CATALOGUE_URL,
            "csv": CSV_URL,
            "underlying_register": "Padron Municipal de habitantes",
            "license": "CC BY 4.0",
            "license_url": "https://creativecommons.org/licenses/by/4.0/",
            "attribution": "(c) Ayuntamiento de Madrid",
            "update_frequency": "annual",
        },
        "population_concept": (
            "Persons registered in the municipal Padron (Padron Municipal de habitantes) for the "
            "reference date. num_personas is the source total per barrio."
        ),
        "source_period": {
            "reference_date": reference_date,
            "label": fecha_label,
            "type": "padron_annual_reference_date",
            "provisional": False,
            "selection": (
                "latest annual reference date whose barrio coverage exactly matches the canonical "
                "geography; a year with fewer barrios is treated as incomplete, not as the latest"
            ),
        },
        "dimensions": {
            "available_in_source": ["sex (num_personas_hombres / num_personas_mujeres)"],
            "used": ["num_personas (barrio total)"],
            "aggregated_over": [],
            "note": (
                "The source has one row per (barrio, reference date) and publishes num_personas as the "
                "barrio total, verified to equal hombres + mujeres. No row-level aggregation over sex or "
                "age is performed, so there is no double-counting risk. Sex and age breakdowns are out of "
                "scope for this denominator."
            ),
        },
        "code_reconciliation": {
            "method": "deterministic zero-padding of official source codes; no name-based or fuzzy matching",
            "cod_distrito": "zfill(2) -> district official_id",
            "cod_barrio": "zfill(3) -> barrio official_id",
            "checked": "each normalised id must match a canonical barrio and its parent district exactly",
        },
        "geography_linkage": {
            "geography_artifact": GEOGRAPHY_ARTIFACT,
            "barrio_geography_version": geo_versions.get("barrio", {}).get("published_version"),
            "district_geography_version": geo_versions.get("district", {}).get("published_version"),
            "join": "cod_barrio.zfill(3) == barrio.official_id ; cod_distrito.zfill(2) == district.official_id",
            "note": (
                "The geography versions are NOT the population period. A future audit can state "
                "'population period " + reference_date + " joined to Madrid barrio geography "
                + str(geo_versions.get("barrio", {}).get("published_version")) + "'."
            ),
        },
        "derived_totals": {
            "district": DERIVED,
            "municipality": DERIVED,
            "independent_source_total_available": False,
            "note": (
                "This dataset publishes only barrio rows for this period, so it carries no independent "
                "district or municipality total at the same semantics/period to cross-check against. "
                "District and municipality totals are therefore derived from the barrio populations and "
                "flagged " + DERIVED + "."
            ),
        },
        "totals": {
            "municipality_residents": municipality_total,
            "districts": {d["official_id"]: d["residents"] for d in district_records},
        },
        "retrieved_at": _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "builder": "scripts/build_madrid_population.py",
        "interpretation_ceiling": (
            "Registered residents for the Padron reference date. NOT people physically present at a given "
            "moment, NOT daytime population, NOT tourists, NOT workers present, NOT unique mobile-device "
            "users, NOT households and NOT housing units. It is a residential denominator only; this "
            "artifact defines no tourism indicator, ratio, density or composite score, and must never be "
            "spatially distributed into a circular Lens: a barrio population belongs to the whole barrio, "
            "never to the fraction of it overlapped by a Lens circle."
        ),
    }

    write_json(out_dir / "madrid_population.json", population)
    write_json(out_dir / "madrid_population.meta.json", meta)

    print(
        f"[population] wrote {out_dir/'madrid_population.json'} "
        f"({len(barrios)} barrios, {len(district_records)} districts, municipality total {municipality_total})"
    )
    print(f"[population] wrote {out_dir/'madrid_population.meta.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
