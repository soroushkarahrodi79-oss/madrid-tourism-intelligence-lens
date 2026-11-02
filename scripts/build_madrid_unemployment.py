#!/usr/bin/env python3
"""Build the barrio-level "tasa absoluta de paro registrado" context artifact.

    OFFICIAL PANEL CSV -> SELECT ONE INDICATOR + EDITION -> NORMALISE CODES
    -> RECONCILE TO CANONICAL GEOGRAPHY -> GATE DENOMINATOR YEAR -> ARTIFACT

This adds ONE official socioeconomic indicator to the Area Profile: the
"Tasa absoluta de paro registrado (febrero)" that the Ayuntamiento de Madrid
publishes per barrio in its "Panel de indicadores de distritos y barrios de
Madrid" (datos.madrid.es dataset 300087, CC BY 4.0).

What the indicator is
---------------------
The panel's own methodology (PDF "Aclaraciones y notas metodologicas",
"Indicadores de desempleo") defines it as the number of registered unemployed
persons (SEPE, month of February) divided by the population of working age
(16 to 64) of the same zone, taken from the Padron Municipal de Habitantes. It
is published as a percentage with two decimals.

It is NOT the EPA unemployment rate (unemployed / active population, a different
indicator in the same panel), and it is NOT unemployed residents divided by
total registered population. This builder never derives a rate: it transcribes
the value the publisher computed.

Source contract (explicit, not inferred)
----------------------------------------
Rows are selected by exact equality on `indicador_completo`, within one
`Periodo panel` edition, at barrio level (`cod_barrio` non-empty). Only the
columns named in REQUIRED_COLUMNS are read. A source that renames them fails
loudly rather than being half-parsed.

Period
------
The accumulated CSV mixes editions (`Periodo panel` 2020..2026). The builder
selects the latest edition that carries one row for every canonical barrio. It
never substitutes another edition's values and never mixes editions.

The edition stamps this indicator with `año` = the edition year and
`fecha_indicador` = 01/01/<year>; the indicator name states "febrero". The
official workbook's "INDICADORES" sheet and the methodology PDF list a different
"year of update" for this indicator (2025 for the 2026 edition), and give its
numerator (paro registrado) a year that differs from its own rate, so those
tables cannot be authoritative for the period. The builder therefore GATES the
year empirically: the same edition's `Número habitantes` (the rate's population
base) must equal the repository's Padron artifact for that year exactly, for
every barrio. That pins the edition's population base to 1 January <year>. The
SEPE numerator month is taken from the indicator's own label ("febrero") and
the edition year; it is a published label, not an independently verified date.

Missing values
--------------
The only missing representation observed in the source is a blank cell. A blank
becomes `rate: null, state: MISSING_IN_SOURCE`. Any other non-numeric text
raises: an unrecognised missing-value code must be looked at, not guessed. A
canonical barrio with no row at all becomes `NOT_PUBLISHED`. Neither is ever 0.

Dependencies: standard library only.

Usage
-----
    python scripts/build_madrid_unemployment.py
    python scripts/build_madrid_unemployment.py --csv-path path/to/acumulado.csv
    python scripts/build_madrid_unemployment.py --out-dir data/socioeconomic
"""

from __future__ import annotations

import argparse
import csv
import datetime as _dt
import hashlib
import io
import json
import re
import sys
import urllib.request
from decimal import Decimal, InvalidOperation
from pathlib import Path

DATASET_ID = "300087-0-indicadores-distritos"
CATALOGUE_URL = "https://datos.madrid.es/dataset/300087-0-indicadores-distritos"
CSV_URL = (
    "https://datos.madrid.es/dataset/300087-0-indicadores-distritos/"
    "resource/300087-0-indicadores-distritos-csv/download/acumulado.csv"
)
METHODOLOGY_PDF_URL = (
    "https://datos.madrid.es/dataset/300087-0-indicadores-distritos/"
    "resource/300087-22-indicadores-distritos/download/300087-22-indicadores-distritos.pdf"
)

RATE_INDICATOR = "Tasa absoluta de paro registrado (febrero)"
POPULATION_INDICATOR = "Número habitantes"
RATE_UNIT = "Tasa"

GEOGRAPHY_ARTIFACT = "data/geography/madrid_admin.geojson"
GEOGRAPHY_META = "data/geography/madrid_admin.meta.json"
POPULATION_ARTIFACT = "data/population/madrid_population.json"

REQUIRED_COLUMNS = (
    "Periodo panel",
    "cod_distrito",
    "cod_barrio",
    "barrio",
    "año",
    "fecha_indicador",
    "unidad_indicador",
    "indicador_completo",
    "valor_indicador",
)

CONTRACT_VERSION = "1.0.0"
STATE_VALID = "VALID"
STATE_MISSING = "MISSING_IN_SOURCE"
STATE_NOT_PUBLISHED = "NOT_PUBLISHED"
USER_AGENT = "madrid-tourism-intelligence-lens/unemployment-builder (+https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens)"


# --------------------------------------------------------------------- fetching


def fetch_csv() -> tuple[str, dict]:
    request = urllib.request.Request(CSV_URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=180) as response:  # noqa: S310 (trusted official host)
        body = response.read()
        headers = {
            "last_modified": response.headers.get("Last-Modified"),
            "content_length": len(body),
        }
    return body.decode("utf-8-sig"), headers


# ------------------------------------------------------------------ parsing


def parse_rate(value: str) -> Decimal | None:
    """Parse a Spanish-formatted percentage ('5,41' -> Decimal('5.41')).

    A blank is the source's missing value and returns None. Anything else that
    is not a plain non-negative decimal raises, so an unrecognised missing-value
    code or a malformed cell cannot become a silent zero.
    """
    cleaned = (value or "").strip()
    if cleaned == "":
        return None
    if not re.fullmatch(r"\d+(,\d+)?", cleaned):
        raise ValueError(f"not a plain non-negative decimal: {value!r}")
    try:
        return Decimal(cleaned.replace(",", "."))
    except InvalidOperation as error:  # pragma: no cover - guarded by the regex
        raise ValueError(f"not a decimal: {value!r}") from error


def parse_panel_rows(text: str) -> list[dict]:
    """Return the barrio-level rows of the two indicators this builder needs."""
    reader = csv.DictReader(io.StringIO(text), delimiter=";")
    fieldnames = [(h or "").strip() for h in (reader.fieldnames or [])]
    missing = [c for c in REQUIRED_COLUMNS if c not in fieldnames]
    if missing:
        raise SystemExit(f"source CSV is missing expected columns: {missing}")

    wanted = {RATE_INDICATOR, POPULATION_INDICATOR}
    rows = []
    for raw in reader:
        if raw["indicador_completo"] not in wanted or not raw["cod_barrio"].strip():
            continue
        rows.append({k: (raw[k] or "").strip() for k in REQUIRED_COLUMNS})
    return rows


def select_edition(rate_rows: list[dict], canonical_ids: set[str], requested: str | None) -> str:
    """Pick the latest panel edition that has a row for every canonical barrio."""
    by_edition: dict[str, set[str]] = {}
    for row in rate_rows:
        by_edition.setdefault(row["Periodo panel"], set()).add(row["cod_barrio"].zfill(3))

    if requested is not None:
        if requested not in by_edition:
            raise SystemExit(f"requested edition {requested} is not in the source (editions: {sorted(by_edition)})")
        return requested

    complete = sorted(e for e, ids in by_edition.items() if ids == canonical_ids)
    if not complete:
        raise SystemExit(
            "no panel edition covers exactly the canonical barrios "
            f"(coverage by edition: { {e: len(ids) for e, ids in sorted(by_edition.items())} })"
        )
    return complete[-1]


# ------------------------------------------------------------- reconciliation


def load_canonical_geography(repo_root: Path) -> tuple[dict, dict]:
    geo = json.loads((repo_root / GEOGRAPHY_ARTIFACT).read_text(encoding="utf-8"))
    parent, name = {}, {}
    for feature in geo["features"]:
        props = feature["properties"]
        if props["geography_level"] == "barrio":
            parent[props["official_id"]] = props["parent_id"]
            name[props["official_id"]] = props["official_name"]
    return parent, name


def reconcile(edition_rows: list[dict], barrio_parent: dict, barrio_name: dict) -> list[dict]:
    """Join to canonical barrios by zero-padded official code; fail on any mismatch.

    Names are checked as a cross-check only (identity is the code). A name that
    differs from the canonical label fails the build: it means the code and the
    label no longer describe the same barrio.
    """
    seen: dict[str, dict] = {}
    for row in edition_rows:
        barrio_id = row["cod_barrio"].zfill(3)
        district_id = row["cod_distrito"].zfill(2)
        if barrio_id not in barrio_parent:
            raise SystemExit(f"barrio code {row['cod_barrio']} -> {barrio_id} ({row['barrio']}) is not canonical")
        if barrio_parent[barrio_id] != district_id:
            raise SystemExit(
                f"barrio {barrio_id} declares district {district_id}, canonical geography says {barrio_parent[barrio_id]}"
            )
        if row["barrio"] != barrio_name[barrio_id]:
            raise SystemExit(
                f"barrio {barrio_id} is named {row['barrio']!r} in the source but {barrio_name[barrio_id]!r} canonically"
            )
        if barrio_id in seen:
            raise SystemExit(f"duplicate barrio {barrio_id} in the selected edition")
        seen[barrio_id] = row
    return seen


def build_records(rate_by_barrio: dict, barrio_parent: dict) -> list[dict]:
    records = []
    for barrio_id in sorted(barrio_parent):
        row = rate_by_barrio.get(barrio_id)
        if row is None:
            rate, state = None, STATE_NOT_PUBLISHED
        else:
            parsed = parse_rate(row["valor_indicador"])
            rate, state = (None, STATE_MISSING) if parsed is None else (float(parsed), STATE_VALID)
        records.append(
            {
                "official_id": barrio_id,
                "parent_id": barrio_parent[barrio_id],
                "rate_percent": rate,
                "state": state,
            }
        )
    return records


def gate_population_year(population_rows: dict, repo_root: Path, edition: str) -> dict:
    """Pin the rate's population base to the repository's Padron artifact.

    The edition's own `Número habitantes` must equal the repo's Padron count for
    every barrio. This is what ties the edition's year to a verified reference
    date independently of the publisher's inconsistent year tables.
    """
    population = json.loads((repo_root / POPULATION_ARTIFACT).read_text(encoding="utf-8"))
    reference_year = population["source_period"]["reference_date"][:4]
    if reference_year != edition:
        return {"performed": False, "reason": f"repo Padron year {reference_year} != edition {edition}"}
    repo_residents = {
        r["official_id"]: r["residents"] for r in population["records"] if r["geography_level"] == "barrio"
    }
    mismatches = []
    for barrio_id, row in population_rows.items():
        source_value = int(row["valor_indicador"].replace(".", ""))
        if repo_residents.get(barrio_id) != source_value:
            mismatches.append(barrio_id)
    if mismatches:
        raise SystemExit(
            f"edition {edition} 'Número habitantes' disagrees with the repo Padron {reference_year} for "
            f"{len(mismatches)} barrio(s), e.g. {mismatches[:5]}; the edition year is not verified"
        )
    return {
        "performed": True,
        "padron_reference_date": population["source_period"]["reference_date"],
        "barrios_compared": len(population_rows),
        "mismatches": 0,
    }


# --------------------------------------------------------------- serialisation


def write_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def digest_rows(rows: list[dict]) -> str:
    """Stable fingerprint of the exact source rows used (not of the whole growing CSV)."""
    canonical = "\n".join(
        "|".join(r[k] for k in REQUIRED_COLUMNS)
        for r in sorted(rows, key=lambda r: (r["indicador_completo"], r["cod_barrio"].zfill(3)))
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def build(text: str, repo_root: Path, requested_edition: str | None = None) -> tuple[dict, dict, dict]:
    """Return (artifact, meta_without_retrieval, gate) for a source CSV text."""
    barrio_parent, barrio_name = load_canonical_geography(repo_root)
    rows = parse_panel_rows(text)
    rate_rows = [r for r in rows if r["indicador_completo"] == RATE_INDICATOR]

    edition = select_edition(rate_rows, set(barrio_parent), requested_edition)
    edition_rate = [r for r in rate_rows if r["Periodo panel"] == edition]
    edition_pop = [r for r in rows if r["indicador_completo"] == POPULATION_INDICATOR and r["Periodo panel"] == edition]

    units = {r["unidad_indicador"] for r in edition_rate}
    years = {r["año"] for r in edition_rate}
    fechas = {r["fecha_indicador"] for r in edition_rate}
    if units != {RATE_UNIT}:
        raise SystemExit(f"unexpected unit(s) for the rate: {sorted(units)}")
    if years != {edition} or fechas != {f"01/01/{edition}"}:
        raise SystemExit(f"rate year/date stamps {sorted(years)} / {sorted(fechas)} do not match edition {edition}")

    rate_by_barrio = reconcile(edition_rate, barrio_parent, barrio_name)
    pop_by_barrio = reconcile(edition_pop, barrio_parent, barrio_name)
    gate = gate_population_year(pop_by_barrio, repo_root, edition)
    if not gate["performed"]:
        raise SystemExit(f"denominator-year gate could not run: {gate['reason']}")

    records = build_records(rate_by_barrio, barrio_parent)
    valid = sum(1 for r in records if r["state"] == STATE_VALID)
    values = [r["rate_percent"] for r in records if r["rate_percent"] is not None]
    if not values or min(values) < 0 or max(values) > 100:
        raise SystemExit(f"rate values outside the plausible 0-100 percent range: {values[:3]}")

    artifact = {
        "contract_version": CONTRACT_VERSION,
        "indicator": {
            "id": "registered_unemployment_rate",
            "source_label": RATE_INDICATOR,
            "unit": "percent",
            "source_unit_label": RATE_UNIT,
            "decimals": 2,
        },
        "source_period": {
            "panel_edition": edition,
            "reference_year": edition,
            "numerator_month": "febrero",
            "label": f"febrero {edition}",
            "fecha_indicador_in_source": f"01/01/{edition}",
            "provisional": False,
        },
        "counts": {"barrios": len(records), "valid": valid, "missing": len(records) - valid},
        "records": records,
    }

    meta = {
        "contract_version": CONTRACT_VERSION,
        "title": "Barrio-level tasa absoluta de paro registrado (Panel de indicadores de distritos y barrios)",
        "artifact": "madrid_registered_unemployment.json",
        "source": {
            "authority": "Ayuntamiento de Madrid - Direccion General de Coordinacion Territorial y Desconcentracion (Servicio de Estudios y Evaluacion Territorial)",
            "dataset": "Panel de indicadores de distritos y barrios de Madrid. Estudio sociodemografico",
            "dataset_id": DATASET_ID,
            "catalogue": CATALOGUE_URL,
            "csv": CSV_URL,
            "methodology_pdf": METHODOLOGY_PDF_URL,
            "indicator_row": {
                "indicador_completo": RATE_INDICATOR,
                "categoria_1": "Indicadores Población desempleo",
                "unidad_indicador": RATE_UNIT,
                "periodo_panel_selected": edition,
            },
            "underlying_registers": "SEPE registered unemployment (numerator); Padron Municipal de Habitantes, ages 16 to 64 (denominator)",
            "license": "CC BY 4.0",
            "license_url": "https://creativecommons.org/licenses/by/4.0/",
            "attribution": "(c) Ayuntamiento de Madrid",
            "update_frequency": "annual",
        },
        "indicator_definition": (
            "Tasa absoluta de paro registrado: registered unemployed persons of a zone divided by the population "
            "of working age (16 to 64) of the same zone, the latter taken from the Padron Municipal de Habitantes "
            "(methodology PDF, 'Indicadores de desempleo'). Published as a percentage with two decimals. The barrio "
            "figure excludes persons coded 'no consta' (which only the district figure counts)."
        ),
        "not_this": [
            "NOT the EPA unemployment rate (unemployed / active population, a different indicator in the same panel)",
            "NOT unemployed residents divided by total registered population",
            "NOT a rate derived by this builder: the value is the publisher's own, transcribed unchanged",
        ],
        "source_period": {
            **artifact["source_period"],
            "selection": (
                "latest Periodo panel edition that carries exactly one row for every canonical barrio; no other "
                "edition's values are substituted or mixed"
            ),
            "period_verification": {
                "denominator_year_gate": gate,
                "gate_method": (
                    "the same edition's 'Número habitantes' must equal data/population/madrid_population.json "
                    "for every barrio; this pins the rate's population base to the Padron reference date"
                ),
                "publisher_year_tables_disagree": (
                    "the methodology PDF and the workbook INDICADORES sheet list a 'year of update' of 2025 for "
                    "this indicator in the 2026 edition (and a different year for its own numerator), while every "
                    "data row is stamped año=2026 / 01/01/2026; the data rows are used, the tables are not, and "
                    "this disagreement is recorded rather than resolved silently"
                ),
                "numerator_month_basis": (
                    "the SEPE month 'febrero' comes from the indicator's published name; its year is the edition "
                    "year stamped on the rows. It is a published label, not an independently verified date."
                ),
            },
        },
        "missing_values": {
            "source_representation": "blank cell",
            "other_codes_observed": [],
            "handling": "blank -> rate_percent null, state MISSING_IN_SOURCE; canonical barrio with no row -> NOT_PUBLISHED; any other non-numeric text fails the build. Never 0.",
            "counts": artifact["counts"],
        },
        "code_reconciliation": {
            "method": "deterministic zero-padding of official source codes; no name-based or fuzzy matching",
            "cod_distrito": "zfill(2) -> district official_id",
            "cod_barrio": "zfill(3) -> barrio official_id",
            "checked": "each id must match a canonical barrio and its parent district; the source barrio label must equal the canonical label",
        },
        "geography_linkage": {
            "geography_artifact": GEOGRAPHY_ARTIFACT,
            "join": "cod_barrio.zfill(3) == barrio.official_id ; cod_distrito.zfill(2) == district.official_id",
            "note": "The value belongs to the WHOLE official barrio. District and municipality figures are not published in this artifact.",
        },
        "selected_rows_sha256": digest_rows(edition_rate + edition_pop),
        "builder": "scripts/build_madrid_unemployment.py",
        "interpretation_ceiling": (
            "Registered unemployment (SEPE, February) as a percentage of the 16-64 Padron population of the whole "
            "official barrio, as published. Contextual socioeconomic evidence about residents, NOT a tourism "
            "impact, NOT evidence that tourism or visitor activity causes or relates to unemployment, NOT the "
            "EPA rate, NOT a measure of vulnerability, deprivation or poverty, and never ranked, banded, scored "
            "or combined into an index. It describes the whole barrio and must never be allocated, weighted or "
            "interpolated into a circular Lens."
        ),
    }
    return artifact, meta, gate


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Build the barrio-level registered-unemployment-rate artifact")
    parser.add_argument("--out-dir", default="data/socioeconomic")
    parser.add_argument("--csv-path", default=None, help="Use a local copy of acumulado.csv instead of fetching it.")
    parser.add_argument("--edition", default=None, help="Panel edition (Periodo panel), e.g. 2026. Default: latest complete.")
    args = parser.parse_args(argv)

    repo_root = Path(__file__).resolve().parents[1]
    out_dir = Path(args.out_dir) if Path(args.out_dir).is_absolute() else repo_root / args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.csv_path:
        text = Path(args.csv_path).read_text(encoding="utf-8-sig")
        retrieval = {"retrieved_at": None, "http_last_modified": None, "local_file": Path(args.csv_path).name}
    else:
        print("[unemployment] fetching the official accumulated panel CSV ...")
        text, headers = fetch_csv()
        retrieval = {
            "retrieved_at": _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "http_last_modified": headers["last_modified"],
            "local_file": None,
        }

    artifact, meta, gate = build(text, repo_root, args.edition)
    meta["retrieval"] = {
        **retrieval,
        "note": "http_last_modified describes the file served, not a publisher reference date.",
    }

    write_json(out_dir / "madrid_registered_unemployment.json", artifact)
    write_json(out_dir / "madrid_registered_unemployment.meta.json", meta)
    counts = artifact["counts"]
    print(
        f"[unemployment] edition {artifact['source_period']['panel_edition']}: {counts['valid']}/{counts['barrios']} "
        f"barrios valid, {counts['missing']} missing; denominator-year gate: {gate['barrios_compared']} barrios compared, 0 mismatches"
    )
    print(f"[unemployment] wrote {out_dir / 'madrid_registered_unemployment.json'} and .meta.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
