#!/usr/bin/env python3
"""Build the compact Hospitality & Commercial Context production artifact.

The methodology remains owned by Gates A-F. This builder imports their tested
source parser, source-exclusion constants, taxonomy classifier and CURRENT_131
geography decoder; it does not restate those rules independently.

Downloads are fingerprinted before parsing. Optional cache files must live
outside the repository and are accepted only when their SHA-256 is exact.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
GATE_DIR = REPO / "research" / "hospitality_commercial_gate"
sys.path.insert(0, str(GATE_DIR))

import audit_denominator as F  # noqa: E402
import audit_identity as A  # noqa: E402
import audit_status as C  # noqa: E402

REGISTRY_PATH = GATE_DIR / "results" / "gate_f_indicator_registry.json"
SUMMARY_PATH = GATE_DIR / "results" / "gate_f_summary.json"
AUDIT_PATH = GATE_DIR / "results" / "gate_f_denominator_audit.json"
GEOGRAPHY_PATH = REPO / "data" / "geography" / "madrid_admin.geojson"
GEOGRAPHY_META_PATH = REPO / "data" / "geography" / "madrid_admin.meta.json"
POPULATION_PATH = REPO / "data" / "population" / "madrid_population.json"
OUTPUT_PATH = REPO / "data" / "hospitality-commercial-context.json"

CONTRACT_VERSION = "1.0.0"
DEFAULT_INDICATOR = "core_hospitality_premises_count"
APPROVED_LOCALES_SHA256 = "4ca33fed004b836d685aa55961adeca89fdedb8f333f3adc0e8abb8f7a4b87c1"
APPROVED_ACTIVIDADES_SHA256 = "ba9279d6d187105b57889d30b4fe335fe5a60f5fe9efbf47425f46068f0d91a2"
APPROVED_POPULATION_SHA256 = "e6bc8a209927d2acdfd1f0489638d7996b8fed809624093436beafd78cfa8e08"
EXPECTED_CONTROLS = {
    "U0": 203_688,
    "U1": 184_279,
    "U2": 142_107,
    "U3": 19_532,
    "U4": 7_919,
    "U5": 797,
    "U6": 42_061,
}
EXPECTED_EXCLUSIONS = {
    "situacion_8": 12_423,
    "situacion_9": 4_120,
    "access_12": 2_881,
    "union_excluded": 19_409,
}


def sha256_file(path: Path | str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def load_contracts() -> tuple[list[dict], dict, dict]:
    registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    summary = json.loads(SUMMARY_PATH.read_text(encoding="utf-8"))
    audit = json.loads(AUDIT_PATH.read_text(encoding="utf-8"))
    return registry, summary, audit


def admitted_indicator_ids(registry: list[dict], summary: dict) -> list[str]:
    ids = summary["production_candidate_indicator_ids"] + summary[
        "conditional_production_candidate_indicator_ids"
    ]
    rows = {row["indicator_id"]: row for row in registry}
    if set(ids) != {
        key
        for key, row in rows.items()
        if row["admissibility_status"]
        in {"PRODUCTION_CANDIDATE", "CONDITIONAL_PRODUCTION_CANDIDATE"}
    }:
        raise SystemExit("Gate F registry and summary disagree on the admitted indicator set")
    return ids


def approved_source(registry: list[dict], family: str) -> dict:
    sources = registry[0]["reference_period"]["premises_and_activities"]
    return sources[family]


def acquire_source(
    *, family: str, supplied: Path | None, cache_dir: Path | None, source: dict, expected_sha: str
) -> tuple[Path, bool]:
    if supplied:
        path = supplied.resolve()
        temporary = False
    elif cache_dir:
        resolved_cache = cache_dir.resolve()
        if resolved_cache == REPO.resolve() or REPO.resolve() in resolved_cache.parents:
            raise SystemExit("Hospitality source cache must be outside the repository")
        resolved_cache.mkdir(parents=True, exist_ok=True)
        path = resolved_cache / f"{family}-{expected_sha}.csv"
        temporary = False
        if not path.exists():
            temp_path, _headers = A.stream_to_temp(source["url"])
            shutil.move(temp_path, path)
    else:
        temp_path, _headers = A.stream_to_temp(source["url"])
        path = Path(temp_path)
        temporary = True

    actual = sha256_file(path)
    if actual != expected_sha:
        if temporary and path.exists():
            path.unlink()
        raise SystemExit(
            f"{family} snapshot fingerprint mismatch: expected {expected_sha}, got {actual}. "
            "Production regeneration is refused; a separately reviewed snapshot refresh is required."
        )
    return path, temporary


def indicator_values(counts: collections.Counter, residents: int) -> dict[str, int | float]:
    if counts["U2"] <= 0 or residents <= 0:
        raise SystemExit("approved CURRENT_131 geography contains an invalid denominator")
    return {
        "source_included_premises_count": counts["U1"],
        "core_hospitality_premises_count": counts["U3"],
        "accommodation_class_premises_count": counts["U4"],
        "core_hospitality_membership_share_of_populated_taxonomy_premises": round(
            100.0 * counts["U3"] / counts["U2"], 6
        ),
        "core_hospitality_premises_per_1000_residents": round(
            1000.0 * counts["U3"] / residents, 6
        ),
    }


def generated_at() -> str:
    epoch = os.environ.get("SOURCE_DATE_EPOCH")
    moment = (
        dt.datetime.fromtimestamp(int(epoch), tz=dt.timezone.utc)
        if epoch is not None
        else dt.datetime.now(tz=dt.timezone.utc)
    )
    return moment.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def build_artifact(locales_path: Path, activities_path: Path) -> dict:
    registry, summary, audit = load_contracts()
    selectable_ids = admitted_indicator_ids(registry, summary)

    locales = F.parse_locales(str(locales_path), A.detect_dialect(locales_path)["delimiter"])
    activities = F.parse_activities(
        str(activities_path), A.detect_dialect(activities_path)["delimiter"]
    )
    records = locales["records"]
    loc_ids = set(records)
    if locales["duplicates"] or "" in loc_ids:
        raise SystemExit("Gate A id_local identity contract failed")
    if not activities["all_premises"] <= loc_ids:
        raise SystemExit("Actividades references id_local absent from Locales")

    excluded_by_situacion = {
        code: {key for key, row in records.items() if row["situacion"] == code}
        for code in C.EXCL_SITUACION_CODES
    }
    excluded_by_access = {
        code: {key for key, row in records.items() if row["access"] == code}
        for code in C.EXCL_ACCESO_CODES
    }
    sit8 = excluded_by_situacion["8"]
    sit9 = excluded_by_situacion["9"]
    access12 = excluded_by_access["12"]
    excluded = sit8 | sit9 | access12
    u1 = loc_ids - excluded
    u2 = u1 & activities["populated"]
    class_sets = {
        cls: {key for key, memberships in activities["memberships"].items() if cls in memberships}
        & u1
        for cls in F.TARGET_CLASSES
    }
    universes = {
        "U0": loc_ids,
        "U1": u1,
        "U2": u2,
        "U3": class_sets["CORE_HOSPITALITY"],
        "U4": class_sets["ACCOMMODATION"],
        "U5": class_sets["TOURISM_ADJACENT"],
        "U6": class_sets["GENERIC_COMMERCIAL"],
    }
    controls = {key: len(value) for key, value in universes.items()}
    if controls != EXPECTED_CONTROLS:
        raise SystemExit(f"approved citywide control mismatch: expected {EXPECTED_CONTROLS}, got {controls}")
    exclusions = {
        "situacion_8": len(sit8),
        "situacion_9": len(sit9),
        "access_12": len(access12),
        "union_excluded": len(excluded),
    }
    if exclusions != EXPECTED_EXCLUSIONS:
        raise SystemExit(f"source exclusion control mismatch: expected {EXPECTED_EXCLUSIONS}, got {exclusions}")
    interior = {key for key, row in records.items() if row["access"] == "3"}
    if interior - excluded - u1:
        raise SystemExit("Interior was excluded outside the approved source rule")

    geography = json.loads(GEOGRAPHY_PATH.read_text(encoding="utf-8"))
    geography_meta = json.loads(GEOGRAPHY_META_PATH.read_text(encoding="utf-8"))
    population = json.loads(POPULATION_PATH.read_text(encoding="utf-8"))
    if sha256_file(POPULATION_PATH) != APPROVED_POPULATION_SHA256:
        raise SystemExit("population artifact fingerprint does not match Gate F")

    units: dict[str, dict[str, dict]] = {"municipality": {}, "district": {}, "barrio": {}}
    for feature in geography["features"]:
        props = feature["properties"]
        units[props["geography_level"]][props["official_id"]] = props
    residents: dict[str, dict[str, int]] = {"municipality": {}, "district": {}, "barrio": {}}
    for row in population["records"]:
        residents[row["geography_level"]][row["official_id"]] = row["residents"]
    if set(units["barrio"]) != set(residents["barrio"]) or len(units["barrio"]) != 131:
        raise SystemExit("population and canonical CURRENT_131 geography are not a 1:1 join")

    counters = {
        "municipality": collections.defaultdict(collections.Counter),
        "district": collections.defaultdict(collections.Counter),
        "barrio": collections.defaultdict(collections.Counter),
    }
    membership_sets = {key: value for key, value in universes.items() if key in {"U1", "U2", "U3", "U4"}}
    for id_local, row in records.items():
        for universe, members in membership_sets.items():
            if id_local not in members:
                continue
            counters["municipality"]["28079"][universe] += 1
            if row["district"] in units["district"]:
                counters["district"][row["district"]][universe] += 1
            if row["barrio"] in units["barrio"]:
                counters["barrio"][row["barrio"]][universe] += 1

    def output_record(level: str, official_id: str) -> dict:
        props = units[level][official_id]
        return {
            "official_name": props["official_name"],
            "parent_id": props.get("parent_id"),
            "indicators": indicator_values(
                counters[level][official_id], residents[level][official_id]
            ),
        }

    municipality = output_record("municipality", "28079")
    districts = {
        key: output_record("district", key) for key in sorted(units["district"])
    }
    barrios = {key: output_record("barrio", key) for key in sorted(units["barrio"])}

    unresolved = {
        indicator: len(members - {key for key in members if records[key]["barrio"] in units["barrio"]})
        for indicator, members in {
            "source_included_premises_count": u1,
            "core_hospitality_premises_count": universes["U3"],
            "accommodation_class_premises_count": universes["U4"],
            "populated_taxonomy_premises_denominator": u2,
        }.items()
    }
    registry_by_id = {row["indicator_id"]: row for row in registry}
    conditional = registry_by_id["core_hospitality_premises_per_1000_residents"]
    geo_versions = geography_meta["source_version"]["datasets"]
    artifact = {
        "contract_version": CONTRACT_VERSION,
        "metadata": {
            "generated_at": generated_at(),
            "premises_nominal_period": "2026-09",
            "premises_sha256": APPROVED_LOCALES_SHA256,
            "activities_nominal_period": "2026-09",
            "activities_sha256": APPROVED_ACTIVIDADES_SHA256,
            "geography_version": {
                "era": "CURRENT_131",
                "district": geo_versions["district"]["published_version"],
                "barrio": geo_versions["barrio"]["published_version"],
            },
            "population_reference_date": "2026-01-01",
            "population_denominator_type": "registered residents / Padron Municipal reference-date stock",
            "population_artifact_sha256": APPROVED_POPULATION_SHA256,
            "source_exclusion_rule": "exclude if situacion in {8,9} OR access == 12; Interior (access 3) remains included",
            "indicator_registry_version": summary["contract_version"],
            "indicator_registry_sha256": sha256_file(REGISTRY_PATH),
            "selectable_indicator_ids": selectable_ids,
            "default_indicator_id": DEFAULT_INDICATOR,
            "interpretation_ceiling": summary["interpretation_ceiling"],
            "temporal_use_rule": summary["temporal_use_rule"],
            "source": {
                "authority": "Ayuntamiento de Madrid",
                "dataset": "Censo de Locales",
            },
            "conditional_indicator": {
                "indicator_id": conditional["indicator_id"],
                "premises_period": "Sep 2026",
                "population_date": "2026-01-01",
                "denominator_type": "registered residents / Padron Municipal reference-date stock",
                "interpretation_ceiling": conditional["interpretation_ceiling"],
                "implementation_conditions": conditional["implementation_conditions"],
            },
            "unresolved_geography": {
                "barrio": unresolved,
                "rule": "Preserved in municipality and district totals when assigned there; excluded only from barrio aggregation and never coerced to zero.",
            },
            "validation": {
                "approved_citywide_controls_verified": True,
                "source_exclusion_union_verified": True,
                "population_current_131_join_verified": True,
                "gate_f_control_evidence_sha256": sha256_file(AUDIT_PATH),
            },
        },
        "municipality": {"28079": municipality},
        "districts": districts,
        "barrios": barrios,
    }
    for collection in (artifact["municipality"], districts, barrios):
        for row in collection.values():
            if list(row["indicators"]) != selectable_ids:
                raise SystemExit("production output indicator order/allowlist drifted from Gate F")
    return artifact


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--locales", type=Path)
    parser.add_argument("--activities", type=Path)
    parser.add_argument("--cache-dir", type=Path)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()
    if bool(args.locales) != bool(args.activities):
        raise SystemExit("--locales and --activities must be supplied together")

    registry, _summary, _audit = load_contracts()
    acquired: list[tuple[Path, bool]] = []
    try:
        loc = acquire_source(
            family="locales",
            supplied=args.locales,
            cache_dir=args.cache_dir,
            source=approved_source(registry, "premises"),
            expected_sha=APPROVED_LOCALES_SHA256,
        )
        acquired.append(loc)
        act = acquire_source(
            family="actividades",
            supplied=args.activities,
            cache_dir=args.cache_dir,
            source=approved_source(registry, "activities"),
            expected_sha=APPROVED_ACTIVIDADES_SHA256,
        )
        acquired.append(act)
        artifact = build_artifact(loc[0], act[0])
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(artifact, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(
            f"[hospitality-context] wrote {args.output} with "
            f"{len(artifact['barrios'])} barrios and {len(artifact['districts'])} districts"
        )
        return 0
    finally:
        for path, temporary in acquired:
            if temporary and path.exists():
                path.unlink()


if __name__ == "__main__":
    raise SystemExit(main())
