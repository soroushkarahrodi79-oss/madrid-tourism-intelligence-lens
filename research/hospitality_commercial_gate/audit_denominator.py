#!/usr/bin/env python3
"""Gate F denominator and indicator-admissibility audit.

This is a research-only audit for the September 2026 Madrid premises census.  It
reuses Gate A's source contract, Gate B's classifier, Gate C's exclusion codes and
Gate E's current-geography decoder.  It writes compact, deterministic JSON evidence;
it does not write production data or UI configuration.

Raw source CSVs are streamed to temporary files and deleted.  Set ``GATE_F_CACHE``
to an external directory to retain MD5-verified downloads for deterministic rebuilds.
The cache must not point inside the repository.
"""

from __future__ import annotations

import collections
import csv
import hashlib
import json
import math
import os
import shutil
import statistics
import sys
from itertools import combinations
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
RESULTS = HERE / "results"
sys.path.insert(0, str(HERE))

import audit_geography as E  # noqa: E402
import audit_identity as A  # noqa: E402
import audit_status as C  # noqa: E402
import audit_taxonomy as B  # noqa: E402

LOC_DESCRIPTION = "Locales. Septiembre 2026"
ACT_DESCRIPTION = "Actividades. Septiembre 2026"
NOMINAL_PERIOD = "2026-09"
POPULATION_PATH = REPO / "data" / "population" / "madrid_population.json"
POPULATION_META_PATH = REPO / "data" / "population" / "madrid_population.meta.json"
GEOGRAPHY_PATH = REPO / "data" / "geography" / "madrid_admin.geojson"
GEOGRAPHY_META_PATH = REPO / "data" / "geography" / "madrid_admin.meta.json"

UNIVERSE_CLASSES = {
    "U3": "CORE_HOSPITALITY",
    "U4": "ACCOMMODATION",
    "U5": "TOURISM_ADJACENT",
    "U6": "GENERIC_COMMERCIAL",
}
TARGET_CLASSES = tuple(UNIVERSE_CLASSES.values())
ALL_CLASSES = (
    "CORE_HOSPITALITY", "ACCOMMODATION", "TOURISM_ADJACENT",
    "GENERIC_COMMERCIAL", "AMBIGUOUS", "EXCLUDED",
)


def pct(n: int | float, d: int | float) -> float | None:
    return round(100.0 * n / d, 4) if d else None


def rate(n: int | float, d: int | float, scale: float = 1.0) -> float | None:
    return round(scale * n / d, 6) if d else None


def sha256_file(path: Path | str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while chunk := fh.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def md5_file(path: Path | str) -> str:
    h = hashlib.md5()  # noqa: S324 - source-version verification, not security
    with open(path, "rb") as fh:
        while chunk := fh.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def resource_provenance(resource: dict, path: Path | str) -> dict:
    return {
        "description": resource.get("description"),
        "resource_id": resource.get("id"),
        "url": resource.get("url"),
        "nominal_period": NOMINAL_PERIOD,
        "content_fingerprint_sha256": sha256_file(path),
        "catalogue_md5": resource.get("hash"),
        "catalogue_size_bytes": resource.get("size"),
        "catalogue_created": resource.get("created"),
        "catalogue_issued": resource.get("issued"),
        "catalogue_last_modified": resource.get("last_modified"),
        "snapshot_identity_rule": "family + nominal_period + content_fingerprint",
    }


def get_resource(pkg: dict, description: str, cache_dir: str | None) -> tuple[str, bool, dict]:
    resource = A.resolve_resource(pkg, description)
    cached = None
    if cache_dir:
        cache = Path(cache_dir).resolve()
        if REPO.resolve() == cache or REPO.resolve() in cache.parents:
            raise SystemExit("GATE_F_CACHE must be outside the repository")
        cache.mkdir(parents=True, exist_ok=True)
        cached = cache / f"{resource['id']}.csv"
        expected_md5 = (resource.get("hash") or "").lower()
        expected_size = int(resource.get("size") or 0)
        if cached.exists():
            valid_size = not expected_size or cached.stat().st_size == expected_size
            valid_md5 = not expected_md5 or md5_file(cached) == expected_md5
            if valid_size and valid_md5:
                return str(cached), False, resource
            cached.unlink()

    tmp, _http = A.stream_to_temp(resource["url"])
    if cached:
        shutil.copyfile(tmp, cached)
        os.unlink(tmp)
        if resource.get("hash") and md5_file(cached) != resource["hash"].lower():
            cached.unlink()
            raise SystemExit(f"downloaded {description} does not match catalogue MD5")
        return str(cached), False, resource
    return tmp, True, resource


def current_barrio_code(raw: str) -> str | None:
    district, seq = E.id_barrio_decoded(raw, 2026)
    return E.code_from_decoded(district, seq)


def parse_locales(path: str, delimiter: str) -> dict:
    records = {}
    duplicate_ids = 0
    with open(path, "r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh, delimiter=delimiter)
        for row in reader:
            idl = A.blank(row.get("id_local"))
            if idl in records:
                duplicate_ids += 1
            raw_barrio = A.blank(row.get("id_barrio_local"))
            barrio = current_barrio_code(raw_barrio) if raw_barrio else None
            raw_district = A.blank(row.get("id_distrito_local"))
            district = raw_district.zfill(2) if raw_district else None
            x = A.blank(row.get("coordenada_x_local"))
            y = A.blank(row.get("coordenada_y_local"))
            coordinate_missing = (not x or not y or (x in {"0", "0.0", "0,0"} and y in {"0", "0.0", "0,0"}))
            records[idl] = {
                "situacion": A.blank(row.get("id_situacion_local")),
                "access": A.blank(row.get("id_tipo_acceso_local")),
                "district": district,
                "barrio": barrio,
                "raw_barrio": raw_barrio,
                "coordinate_missing": coordinate_missing,
            }
    return {"records": records, "rows": len(records) + duplicate_ids, "duplicates": duplicate_ids}


def parse_activities(path: str, delimiter: str) -> dict:
    memberships = collections.defaultdict(set)
    populated = set()
    blank = set()
    all_premises = set()
    rows_by_class = collections.Counter()
    rows_by_class_premises = collections.Counter()
    total_rows = 0
    populated_rows = 0
    blank_rows = 0
    with open(path, "r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh, delimiter=delimiter)
        for row in reader:
            total_rows += 1
            idl = A.blank(row.get("id_local"))
            epi = A.blank(row.get("id_epigrafe"))
            all_premises.add(idl)
            if not epi:
                blank_rows += 1
                blank.add(idl)
                continue
            populated_rows += 1
            populated.add(idl)
            cls = B.classify(A.blank(row.get("id_seccion")), A.blank(row.get("id_division")))
            memberships[idl].add(cls)
            rows_by_class[cls] += 1
            rows_by_class_premises[(cls, idl)] += 1
    return {
        "memberships": memberships,
        "populated": populated,
        "blank": blank,
        "all_premises": all_premises,
        "rows_by_class": rows_by_class,
        "rows_by_class_premises": rows_by_class_premises,
        "total_rows": total_rows,
        "populated_rows": populated_rows,
        "blank_rows": blank_rows,
    }


def load_population() -> dict:
    pop = json.loads(POPULATION_PATH.read_text(encoding="utf-8"))
    meta = json.loads(POPULATION_META_PATH.read_text(encoding="utf-8"))
    by_level = collections.defaultdict(dict)
    for rec in pop["records"]:
        by_level[rec["geography_level"]][rec["official_id"]] = rec["residents"]
    return {"artifact": pop, "meta": meta, "by_level": by_level}


def ring_area_m2(ring: list) -> float:
    """Spherical polygon-ring area for canonical WGS84 coordinates.

    Sufficient for auditing whether gross administrative area is a defensible
    denominator; it is not emitted as a production metric.
    """
    if len(ring) < 3:
        return 0.0
    radius = 6_371_008.8
    area = 0.0
    for idx, point in enumerate(ring):
        nxt = ring[(idx + 1) % len(ring)]
        lon1, lat1 = map(math.radians, point[:2])
        lon2, lat2 = map(math.radians, nxt[:2])
        area += (lon2 - lon1) * (2.0 + math.sin(lat1) + math.sin(lat2))
    return area * radius * radius / 2.0


def geometry_area_m2(geometry: dict) -> float:
    def polygon_area(coords: list) -> float:
        if not coords:
            return 0.0
        outer = abs(ring_area_m2(coords[0]))
        holes = sum(abs(ring_area_m2(ring)) for ring in coords[1:])
        return max(0.0, outer - holes)

    if geometry["type"] == "Polygon":
        return polygon_area(geometry["coordinates"])
    if geometry["type"] == "MultiPolygon":
        return sum(polygon_area(poly) for poly in geometry["coordinates"])
    raise ValueError(f"unsupported canonical geometry type {geometry['type']}")


def load_geography() -> dict:
    geo = json.loads(GEOGRAPHY_PATH.read_text(encoding="utf-8"))
    meta = json.loads(GEOGRAPHY_META_PATH.read_text(encoding="utf-8"))
    units = collections.defaultdict(dict)
    for feature in geo["features"]:
        props = feature["properties"]
        level = props["geography_level"]
        units[level][props["official_id"]] = {
            "name": props["official_name"],
            "parent_id": props.get("parent_id"),
            "area_km2": round(geometry_area_m2(feature["geometry"]) / 1_000_000.0, 6),
        }
    return {"units": units, "meta": meta}


def distribution(values: list[float]) -> dict:
    ordered = sorted(values)
    if not ordered:
        return {"count": 0}

    def quantile(p: float) -> float:
        if len(ordered) == 1:
            return ordered[0]
        pos = (len(ordered) - 1) * p
        lo, hi = math.floor(pos), math.ceil(pos)
        if lo == hi:
            return ordered[lo]
        return ordered[lo] * (hi - pos) + ordered[hi] * (pos - lo)

    mean = statistics.fmean(ordered)
    return {
        "count": len(ordered),
        "min": round(ordered[0], 6),
        "p10": round(quantile(0.1), 6),
        "median": round(statistics.median(ordered), 6),
        "p90": round(quantile(0.9), 6),
        "max": round(ordered[-1], 6),
        "mean": round(mean, 6),
        "coefficient_of_variation": round(statistics.pstdev(ordered) / mean, 6) if mean else None,
    }


def average_ranks(values: dict[str, float | None]) -> dict[str, float]:
    pairs = sorted((value, key) for key, value in values.items() if value is not None)
    ranks = {}
    pos = 0
    while pos < len(pairs):
        end = pos + 1
        while end < len(pairs) and pairs[end][0] == pairs[pos][0]:
            end += 1
        rank = (pos + 1 + end) / 2.0
        for _value, key in pairs[pos:end]:
            ranks[key] = rank
        pos = end
    return ranks


def rank_diagnostic(left: dict[str, float | None], right: dict[str, float | None]) -> dict:
    lr, rr = average_ranks(left), average_ranks(right)
    keys = sorted(set(lr) & set(rr))
    if len(keys) < 2:
        return {"units_compared": len(keys), "spearman_rho": None}
    ml = statistics.fmean(lr[k] for k in keys)
    mr = statistics.fmean(rr[k] for k in keys)
    numerator = sum((lr[k] - ml) * (rr[k] - mr) for k in keys)
    dl = math.sqrt(sum((lr[k] - ml) ** 2 for k in keys))
    dr = math.sqrt(sum((rr[k] - mr) ** 2 for k in keys))
    shifts = [abs(lr[k] - rr[k]) for k in keys]
    return {
        "units_compared": len(keys),
        "spearman_rho": round(numerator / (dl * dr), 6) if dl and dr else None,
        "mean_absolute_rank_shift": round(statistics.fmean(shifts), 4),
        "max_absolute_rank_shift": round(max(shifts), 4),
        "note": "Diagnostic only; barrio identities and ordered rankings are not emitted.",
    }


def build_registry(snapshot: dict, population_ref: dict, population_version: dict, geo_meta: dict) -> list[dict]:
    common_metadata = [
        "numerator_universe", "source_exclusions", "unit", "geography_version",
        "premises_snapshot_fingerprint", "interpretation_ceiling", "temporal_use_rule",
    ]
    population_metadata = common_metadata + [
        "denominator_source", "denominator_reference_date", "denominator_data_version",
        "premises_population_reference_mismatch",
    ]
    entries = [
        ("source_included_premises_count", "Source-included premises", "U1: distinct id_local after situacion 8/9 OR access 12 exclusions", "none", "premises", "GO", "PRODUCTION_CANDIDATE", "How many premises records remain after the source's explicit exclusions?", "A direct administrative count.", "Not active businesses, commercial vitality, tourism supply or current operation.", common_metadata, "Low; union exclusions and premises deduplication are source-defined."),
        ("core_hospitality_premises_count", "Documented hospitality-class premises", "U3: distinct U1 premises with at least one division 56 activity", "none", "premises", "GO", "PRODUCTION_CANDIDATE", "Where is documented food-and-beverage activity present?", "Administrative presence of division-56-class premises.", "Not verified operation, visitor use, demand, capacity, pressure or saturation.", common_metadata, "Non-exclusive membership; activity-row counting would inflate the numerator."),
        ("accommodation_class_premises_count", "Documented accommodation-class premises", "U4: distinct U1 premises with at least one division 55 activity", "none", "premises", "GO", "PRODUCTION_CANDIDATE", "Where are division-55-class premises documented?", "Administrative presence of the heterogeneous division-55 class.", "Not beds, capacity, licensed VUT stock, demand or tourist intensity.", common_metadata, "Heterogeneous epigraphs; count only, no merged accommodation universe."),
        ("tourism_adjacent_premises_count", "Documented travel-trade-class premises", "U5: distinct U1 premises with a division 79 activity", "none", "premises", "CONTEXT ONLY", "CONTEXT_ONLY", "Where is documented travel-trade activity present?", "Administrative context for division 79.", "Not tourism intensity, demand or pressure; limited destination-management relevance.", common_metadata, "Small numerator; mathematically clear but limited decision relevance."),
        ("core_hospitality_membership_share_of_populated_taxonomy_premises", "Premises with a documented core-hospitality activity (%)", "U3 distinct premises with at least one documented CORE_HOSPITALITY activity", "U2 distinct source-included premises with at least one populated epigraph, including populated section Z / SIN ACTIVIDAD", "percent", "GO", "PRODUCTION_CANDIDATE", "What percentage of source-included premises with populated taxonomy have at least one documented CORE_HOSPITALITY activity?", "A source-internal, non-exclusive membership rate; populated taxonomy does not mean verified current operation.", "Class memberships are non-exclusive; shares across analytical classes are not expected to sum to 100%. Not market share, capacity, saturation or verified operation.", common_metadata, "Blank taxonomy is excluded; populated section Z / SIN ACTIVIDAD remains in U2; class multi-membership is retained."),
        ("core_hospitality_share_of_source_included_premises", "Hospitality-class membership share of source-included premises", "U3 distinct premises", "U1 distinct source-included premises", "percent", "MODIFY", "CONTEXT_ONLY", "What share of all source-included premises carries hospitality classification?", "A source-internal membership share whose denominator includes blank-taxonomy premises.", "Not a populated-taxonomy membership rate, capacity or saturation.", common_metadata, "Sensitive to spatial variation in blank taxonomy; use the populated-taxonomy membership indicator when that is the intended denominator."),
        ("source_included_premises_per_1000_residents", "Source-included premises per 1,000 registered residents", "U1 distinct source-included premises", "registered residents at 2026-01-01", "premises per 1,000 registered residents", "MODIFY", "CONTEXT_ONLY", "How does the broad documented-premises universe compare with residential population?", "A residential-context administrative density.", "Not tourism pressure, resident burden, tourism intensity, saturation, overtourism or present-person exposure.", population_metadata, "Broad mixed numerator plus eight-calendar-month reference mismatch."),
        ("core_hospitality_premises_per_1000_residents", "Documented hospitality-class premises per 1,000 registered residents", "U3 distinct source-included division-56 premises", "registered residents at 2026-01-01", "premises per 1,000 registered residents", "MODIFY", "CONDITIONAL_PRODUCTION_CANDIDATE", "Where is documented hospitality presence relatively concentrated compared with resident population?", "Administrative residential-context density only.", "Not tourism pressure, resident burden, visitor intensity, demand, capacity, saturation, overtourism or verified operating-business density.", population_metadata, "Date mismatch and non-residential centrality require dual-date metadata and an interpretation ceiling."),
        ("accommodation_class_premises_per_1000_residents", "Documented accommodation-class premises per 1,000 registered residents", "U4 distinct source-included division-55 premises", "registered residents at 2026-01-01", "premises per 1,000 registered residents", "NO-GO", "NO_GO", "Would division-55 premises relative to residents support a useful management question?", "Arithmetic is possible but the numerator is too heterogeneous for a stable accommodation reading.", "Never accommodation capacity, tourist beds, licensed VUT stock, demand, tourist intensity, tourism pressure, resident burden, saturation or overtourism.", population_metadata, "Division-55 heterogeneity and its longitudinal administrative-universe discontinuity."),
        ("premises_per_km2", "Source-included premises per gross administrative km²", "U1 distinct source-included premises", "gross canonical polygon area", "premises per km²", "NO-GO", "NO_GO", "How concentrated are documented premises in physical space?", "Gross-area arithmetic only; not admitted as an indicator.", "Not built-up density, accessible-land density, commercial intensity, pressure or saturation.", common_metadata + ["area_method", "land_use_exclusions"], "Gross polygons include parks and non-buildable land; no built-up-area denominator exists."),
        ("core_hospitality_premises_per_km2", "Documented hospitality-class premises per gross administrative km²", "U3 distinct source-included division-56 premises", "gross canonical polygon area", "premises per km²", "NO-GO", "NO_GO", "How concentrated is documented hospitality presence in physical space?", "Gross-area arithmetic only; not admitted as an indicator.", "Not capacity, pressure, saturation, tourism intensity or usable-urban-area density.", common_metadata + ["area_method", "land_use_exclusions"], "Gross polygons create land-use bias; a defensible built-up-area denominator is unavailable."),
    ]
    risks = {
        "source_included_premises_count": ("GO", "GO", "GO", "MODIFY", "GO", "GO", "MODIFY", "GO"),
        "core_hospitality_premises_count": ("GO", "GO", "GO", "MODIFY", "GO", "GO", "MODIFY", "GO"),
        "accommodation_class_premises_count": ("GO", "GO", "GO", "MODIFY", "GO", "MODIFY", "MODIFY", "GO"),
        "tourism_adjacent_premises_count": ("GO", "GO", "GO", "MODIFY", "GO", "MODIFY", "MODIFY", "CONTEXT ONLY"),
        "core_hospitality_membership_share_of_populated_taxonomy_premises": ("GO", "GO", "GO", "MODIFY", "GO", "GO", "MODIFY", "GO"),
        "core_hospitality_share_of_source_included_premises": ("GO", "GO", "MODIFY", "MODIFY", "GO", "MODIFY", "MODIFY", "CONTEXT ONLY"),
        "source_included_premises_per_1000_residents": ("GO", "GO", "MODIFY", "MODIFY", "GO", "MODIFY", "MODIFY", "CONTEXT ONLY"),
        "core_hospitality_premises_per_1000_residents": ("GO", "GO", "MODIFY", "MODIFY", "GO", "MODIFY", "MODIFY", "GO"),
        "accommodation_class_premises_per_1000_residents": ("GO", "MODIFY", "MODIFY", "NO-GO", "GO", "MODIFY", "NO-GO", "NO-GO"),
        "premises_per_km2": ("GO", "GO", "NO-GO", "MODIFY", "GO", "NO-GO", "NO-GO", "NO-GO"),
        "core_hospitality_premises_per_km2": ("GO", "GO", "NO-GO", "MODIFY", "GO", "NO-GO", "NO-GO", "NO-GO"),
    }
    risk_fields = (
        "source_validity", "numerator_clarity", "denominator_clarity", "temporal_compatibility",
        "geographic_compatibility", "sensitivity", "interpretive_risk", "decision_relevance",
    )
    population_indicators = {
        "source_included_premises_per_1000_residents",
        "core_hospitality_premises_per_1000_residents",
        "accommodation_class_premises_per_1000_residents",
    }
    registry = []
    conditional_conditions = [
        "Premises reference period must be displayed as Sep 2026.",
        "Resident denominator reference date must be displayed separately as 01 Jan 2026.",
        "Denominator must be identified as registered residents / Padron reference-date stock.",
        "Dual dates must be displayed separately; no shared '2026' wording may imply simultaneity.",
        "Interpretation is residential-context administrative density only.",
        "Must not be presented as tourism pressure, resident burden, saturation or overtourism.",
        "Must not be presented as verified operating-business density.",
    ]
    for iid, label, numerator, denominator, unit, ruling, status, question, interpretation, ceiling, metadata, sensitivity in entries:
        reference_period = {"premises_and_activities": snapshot}
        if iid in population_indicators:
            reference_period["population"] = {
                "reference_date": population_ref["reference_date"],
                "type": population_ref["type"],
                "data_version": population_version,
            }
        registry.append({
            "indicator_id": iid,
            "label": label,
            "numerator": numerator,
            "denominator": denominator,
            "unit": unit,
            "geography": {
                "scope": "Madrid municipality, district and CURRENT_131 barrio; barrio production use is current snapshot only",
                "district_version": geo_meta["source_version"]["datasets"]["district"]["published_version"],
                "barrio_version": geo_meta["source_version"]["datasets"]["barrio"]["published_version"],
            },
            "reference_period": reference_period,
            "ruling": ruling,
            "admissibility_status": status,
            "decision_question": question,
            "interpretation": interpretation,
            "interpretation_ceiling": ceiling,
            "temporal_use": "Current Sep-2026 fingerprinted snapshot only; no trend inference. CURRENT_131 comparisons require separately audited snapshots and Gate D segmentation.",
            "required_metadata": metadata,
            "known_sensitivity": sensitivity,
            "reason": f"{ruling}: {interpretation} {sensitivity}",
            "risk_matrix": dict(zip(risk_fields, risks[iid])),
            "implementation_conditions": (
                conditional_conditions
                if status == "CONDITIONAL_PRODUCTION_CANDIDATE" else []
            ),
        })
    return registry


def apply_approved_semantic_contract(audit: dict) -> dict:
    """Apply the approved post-audit vocabulary without recomputing evidence.

    This transformation is deliberately idempotent. It changes no count, percentage,
    coefficient, exclusion, date or ruling; it only makes U2, the CORE/U2 membership
    indicator and production-readiness semantics exact.
    """
    universes = audit["candidate_universes"]
    old_u2 = "U2_SOURCE_INCLUDED_CLASSIFIED_PREMISES"
    new_u2 = "U2_SOURCE_INCLUDED_POPULATED_TAXONOMY_PREMISES"
    if old_u2 in universes:
        item = universes.pop(old_u2)
        reordered = {}
        for key, value in universes.items():
            reordered[key] = value
            if key.startswith("U1_"):
                reordered[new_u2] = item
        audit["candidate_universes"] = universes = reordered
    u2 = universes[new_u2]
    u2["definition"] = (
        "U1 premises with at least one populated id_epigrafe. Includes populated "
        "section Z / 000000 / SIN ACTIVIDAD under the mechanical populated-epigraph "
        "rule; blank taxonomy is excluded. Populated taxonomy does not mean verified "
        "current operation or economic activity."
    )
    u2["includes_populated_sin_actividad"] = True
    u2["excludes_blank_taxonomy"] = True
    u2["verified_current_operation"] = False

    blank = audit["blank_taxonomy_effects"]
    blank["excluded_from"] = [
        "U2 populated-taxonomy-premises denominator",
        "populated-taxonomy membership denominator",
    ]
    blank["spatial_bias_finding"] = (
        "Material spatial variation means dropping blank taxonomy from an all-premises "
        "denominator would change area comparisons. It is excluded only where the "
        "denominator is explicitly limited to populated source taxonomy."
    )

    diagnostics = audit["sensitivity_diagnostics"]
    diagnostics["scenario_definitions"]["B"] = "U2 populated-taxonomy premises / population"
    diagnostics["scenario_definitions"]["D"] = (
        "CORE_HOSPITALITY non-exclusive membership / U2 populated-taxonomy premises"
    )
    replacements = {
        "B_U2_per_1000_residents": "B_U2_populated_taxonomy_per_1000_residents",
        "D_core_share_classified": "D_core_membership_pct_of_populated_taxonomy",
    }
    renamed = {}
    for key, value in diagnostics["barrio_rank_diagnostics"].items():
        for old, new in replacements.items():
            key = key.replace(old, new)
        renamed[key] = value
    diagnostics["barrio_rank_diagnostics"] = renamed

    counterfactual = audit["interior_effects"]["counterfactual_exclusion"]
    old_key = "core_share_classified_rank_diagnostic"
    new_key = "core_membership_pct_of_populated_taxonomy_rank_diagnostic"
    if old_key in counterfactual:
        value = counterfactual.pop(old_key)
        counterfactual[new_key] = value

    preferences = audit["indicator_family_preference"]
    preferences.pop("source_internal_composition", None)
    preferences["source_internal_membership"] = (
        "More internally coherent because numerator and denominator share the same "
        "administrative system; answers non-exclusive class membership within populated "
        "taxonomy, not residential context and not a mutually exclusive partition."
    )
    preferences["universal_kpi"] = (
        "NO-GO. Counts, non-exclusive source membership and external-denominator "
        "densities answer different questions."
    )
    return audit


def build_summary(registry: list[dict]) -> dict:
    production = [
        row["indicator_id"] for row in registry
        if row["admissibility_status"] == "PRODUCTION_CANDIDATE"
    ]
    conditional = [
        row["indicator_id"] for row in registry
        if row["admissibility_status"] == "CONDITIONAL_PRODUCTION_CANDIDATE"
    ]
    conditional_conditions = {
        row["indicator_id"]: row["implementation_conditions"]
        for row in registry
        if row["admissibility_status"] == "CONDITIONAL_PRODUCTION_CANDIDATE"
    }
    return {
        "contract_version": "1.0.0",
        "gate": "Gate F - Denominator Construction & Indicator Admissibility",
        "scope": "Current Sep-2026 fingerprinted snapshot in CURRENT_131 geography; research ruling, not UI implementation.",
        "rulings": {
            "source_included_premises_universe": "GO",
            "blank_taxonomy_handling": "GO",
            "interior_access_handling": "GO",
            "populated_taxonomy_premises_denominator": "GO",
            "population_denominator": "MODIFY",
            "area_denominator": "NO-GO",
            "core_hospitality_nonexclusive_membership_rate": "GO",
            "core_hospitality_per_resident": "MODIFY",
            "accommodation_per_resident": "NO-GO",
            "pressure_saturation_overtourism_indicator": "NO-GO",
            "overall_gate_f": "GO - scoped implementation may proceed only for the exact unconditional and conditional candidate sets and mandatory metadata; this audit itself authorises no UI change.",
        },
        "admissibility_ladder": {
            "LEVEL_1_DESCRIPTIVE_COUNT": "GO when the premises universe and exclusions are explicit.",
            "LEVEL_2_SOURCE_INTERNAL_MEMBERSHIP": "GO/MODIFY depending on populated-taxonomy vs all-source denominator, with non-exclusive memberships disclosed.",
            "LEVEL_3_EXTERNAL_DENOMINATOR_DENSITY": "MODIFY for resident population; NO-GO for gross area in the current evidence base.",
            "LEVEL_4_PRESSURE_CAPACITY_IMPACT": "NO-GO; independent impact/capacity evidence is absent.",
        },
        "production_candidate_indicator_ids": production,
        "conditional_production_candidate_indicator_ids": conditional,
        "conditional_production_requirements": conditional_conditions,
        "context_only_indicator_ids": [
            row["indicator_id"] for row in registry
            if row["admissibility_status"] == "CONTEXT_ONLY"
        ],
        "no_go_indicator_ids": [
            row["indicator_id"] for row in registry
            if row["admissibility_status"] == "NO_GO"
        ],
        "required_global_metadata": [
            "numerator universe", "source exclusions", "unit",
            "denominator source and reference date where applicable",
            "CURRENT_131 geography version",
            "premises snapshot family + nominal period + content fingerprint",
            "denominator data version", "interpretation ceiling", "temporal-use rule",
        ],
        "temporal_use_rule": "Current snapshot only. No approved current indicator automatically supports a trend; current population must never be applied to HISTORICAL_128 records.",
        "interpretation_ceiling": [
            "active or operating businesses", "tourism pressure", "resident burden",
            "tourism stress", "carrying capacity", "saturation", "overtourism",
            "visitor demand", "commercial vitality", "accommodation capacity",
            "tourist beds", "tourist intensity",
        ],
    }


def write_outputs(audit: dict, registry: list[dict], summary: dict) -> None:
    (RESULTS / "gate_f_denominator_audit.json").write_text(
        json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (RESULTS / "gate_f_indicator_registry.json").write_text(
        json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (RESULTS / "gate_f_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def rebuild_approved_semantics() -> int:
    """Rebuild semantic contracts from approved committed evidence, with no network."""
    audit_path = RESULTS / "gate_f_denominator_audit.json"
    if not audit_path.exists():
        raise SystemExit("approved Gate F denominator artifact is required for offline rebuild")
    audit = apply_approved_semantic_contract(json.loads(audit_path.read_text(encoding="utf-8")))
    alignment = audit["population_alignment"]
    population_ref = {
        "reference_date": alignment["reference_date"],
        "type": alignment["reference_type"],
    }
    registry = build_registry(
        audit["snapshot_identity"], population_ref,
        alignment["population_data_version"],
        json.loads(GEOGRAPHY_META_PATH.read_text(encoding="utf-8")),
    )
    summary = build_summary(registry)
    write_outputs(audit, registry, summary)
    print("[gate-f] rebuilt approved semantic contracts from committed evidence (no network)")
    return 0


def main() -> int:
    RESULTS.mkdir(exist_ok=True)
    pop = load_population()
    geo = load_geography()
    pkg = A.package()
    cache = os.environ.get("GATE_F_CACHE")
    cleanup = []
    try:
        print("[gate-f] resolving and reading Sep-2026 Locales ...")
        loc_path, loc_temp, loc_resource = get_resource(pkg, LOC_DESCRIPTION, cache)
        cleanup.append(loc_path if loc_temp else None)
        loc_dialect = A.detect_dialect(loc_path)
        locales = parse_locales(loc_path, loc_dialect["delimiter"])

        print("[gate-f] resolving and reading Sep-2026 Actividades ...")
        act_path, act_temp, act_resource = get_resource(pkg, ACT_DESCRIPTION, cache)
        cleanup.append(act_path if act_temp else None)
        act_dialect = A.detect_dialect(act_path)
        activities = parse_activities(act_path, act_dialect["delimiter"])

        loc_ids = set(locales["records"])
        if locales["duplicates"] or "" in loc_ids:
            raise SystemExit("Gate A identity contract failed for current Locales")
        if not activities["all_premises"] <= loc_ids:
            raise SystemExit("Actividades contains id_local absent from Locales")

        # Reuse Gate C's executable source rule. The named sets below are only the
        # required per-code diagnostics; they do not redefine eligibility.
        excluded_by_situacion = {
            code: {i for i, r in locales["records"].items() if r["situacion"] == code}
            for code in C.EXCL_SITUACION_CODES
        }
        excluded_by_access = {
            code: {i for i, r in locales["records"].items() if r["access"] == code}
            for code in C.EXCL_ACCESO_CODES
        }
        sit8 = excluded_by_situacion["8"]
        sit9 = excluded_by_situacion["9"]
        acc12 = excluded_by_access["12"]
        interior = {i for i, r in locales["records"].items() if r["access"] == "3"}
        excluded = sit8 | sit9 | acc12
        u1 = loc_ids - excluded
        u2 = u1 & activities["populated"]
        class_sets = {
            cls: {i for i, memberships in activities["memberships"].items() if cls in memberships} & u1
            for cls in ALL_CLASSES
        }
        universes = {"U0": loc_ids, "U1": u1, "U2": u2}
        universes.update({u: class_sets[cls] for u, cls in UNIVERSE_CLASSES.items()})

        snapshot = {
            "premises": resource_provenance(loc_resource, loc_path),
            "activities": resource_provenance(act_resource, act_path),
        }
        population_ref = pop["artifact"]["source_period"]
        population_version = {
            "contract_version": pop["meta"]["contract_version"],
            "artifact_sha256": sha256_file(POPULATION_PATH),
            "metadata_sha256": sha256_file(POPULATION_META_PATH),
            "retrieved_at": pop["meta"]["retrieved_at"],
        }

        per_barrio = collections.defaultdict(lambda: collections.Counter())
        per_district = collections.defaultdict(lambda: collections.Counter())
        membership_labels = {"U0": loc_ids, "U1": u1, "U2": u2, "U3": universes["U3"], "U4": universes["U4"], "U5": universes["U5"], "U6": universes["U6"]}
        for idl, rec in locales["records"].items():
            b, d = rec["barrio"], rec["district"]
            for key, members in membership_labels.items():
                if idl in members:
                    if b:
                        per_barrio[b][key] += 1
                    if d:
                        per_district[d][key] += 1
            if idl in u1 and idl in activities["blank"]:
                if b:
                    per_barrio[b]["blank"] += 1
                if d:
                    per_district[d]["blank"] += 1
            if idl in u1 and idl in interior:
                if b:
                    per_barrio[b]["interior"] += 1
                if d:
                    per_district[d]["interior"] += 1

        pop_b = pop["by_level"]["barrio"]
        pop_d = pop["by_level"]["district"]
        canonical_b = set(geo["units"]["barrio"])
        if set(pop_b) != canonical_b:
            raise SystemExit("Population geography cannot be tied 1:1 to CURRENT_131")

        metrics = {name: {} for name in (
            "A_U1_per_1000_residents",
            "B_U2_populated_taxonomy_per_1000_residents",
            "C_core_per_1000_residents",
            "D_core_membership_pct_of_populated_taxonomy",
        )}
        raw_per_pop, u1_without_interior, core_without_interior, core_share_without_interior = {}, {}, {}, {}
        for bid in sorted(canonical_b):
            residents = pop_b[bid]
            counts = per_barrio[bid]
            metrics["A_U1_per_1000_residents"][bid] = rate(counts["U1"], residents, 1000)
            metrics["B_U2_populated_taxonomy_per_1000_residents"][bid] = rate(counts["U2"], residents, 1000)
            metrics["C_core_per_1000_residents"][bid] = rate(counts["U3"], residents, 1000)
            metrics["D_core_membership_pct_of_populated_taxonomy"][bid] = rate(counts["U3"], counts["U2"], 100)
            raw_per_pop[bid] = rate(counts["U0"], residents, 1000)
            u1_without_interior[bid] = rate(counts["U1"] - counts["interior"], residents, 1000)
            core_int = sum(1 for i in universes["U3"] & interior if locales["records"][i]["barrio"] == bid)
            core_without_interior[bid] = rate(counts["U3"] - core_int, residents, 1000)
            classified_int = sum(1 for i in u2 & interior if locales["records"][i]["barrio"] == bid)
            core_share_without_interior[bid] = rate(counts["U3"] - core_int, counts["U2"] - classified_int, 100)

        sensitivity_pairs = {}
        for left, right in combinations(metrics, 2):
            sensitivity_pairs[f"{left}__vs__{right}"] = rank_diagnostic(metrics[left], metrics[right])

        blank_u1 = u1 & activities["blank"]
        blank_status = collections.Counter(locales["records"][i]["situacion"] for i in blank_u1)
        blank_access = collections.Counter(locales["records"][i]["access"] for i in blank_u1)
        blank_district = [{"district_id": did, "source_included": per_district[did]["U1"], "blank_taxonomy": per_district[did]["blank"], "share_pct": pct(per_district[did]["blank"], per_district[did]["U1"])} for did in sorted(geo["units"]["district"])]
        blank_barrio = [{"barrio_id": bid, "source_included": per_barrio[bid]["U1"], "blank_taxonomy": per_barrio[bid]["blank"], "share_pct": pct(per_barrio[bid]["blank"], per_barrio[bid]["U1"])} for bid in sorted(canonical_b)]
        blank_shares = [r["share_pct"] for r in blank_barrio if r["share_pct"] is not None]

        interior_u1 = u1 & interior
        interior_district = [{"district_id": did, "source_included": per_district[did]["U1"], "interior": per_district[did]["interior"], "share_pct": pct(per_district[did]["interior"], per_district[did]["U1"])} for did in sorted(geo["units"]["district"])]
        interior_barrio_shares = [pct(per_barrio[bid]["interior"], per_barrio[bid]["U1"]) for bid in sorted(canonical_b) if per_barrio[bid]["U1"]]
        interior_tax = {cls: len(interior_u1 & class_sets[cls]) for cls in ALL_CLASSES}
        interior_tax["UNCLASSIFIED_SOURCE_ACTIVITY"] = len(interior_u1 & activities["blank"])

        class_row_sensitivity = {}
        for cls in ALL_CLASSES:
            rows_in_u1 = sum(
                count for (row_cls, idl), count in activities["rows_by_class_premises"].items()
                if row_cls == cls and idl in u1
            )
            prem_count = len(class_sets[cls])
            class_row_sensitivity[cls] = {
                "activity_rows": rows_in_u1,
                "distinct_premises": prem_count,
                "row_overcount": rows_in_u1 - prem_count,
                "row_inflation_pct": pct(rows_in_u1 - prem_count, prem_count),
            }

        target_membership_cardinality = collections.Counter()
        all_membership_cardinality = collections.Counter()
        pairwise_overlap = {}
        for idl in u1:
            memberships = activities["memberships"].get(idl, set())
            target_membership_cardinality[str(len(memberships & set(TARGET_CLASSES)))] += 1
            all_membership_cardinality[str(len(memberships))] += 1
        for left, right in combinations(TARGET_CLASSES, 2):
            pairwise_overlap[f"{left}__{right}"] = len(class_sets[left] & class_sets[right])

        population_values = list(pop_b.values())
        anomalies = {
            "zero_population_barrios": sorted(k for k, v in pop_b.items() if v == 0),
            "under_1000_residents": sorted(
                ({"barrio_id": k, "residents": v} for k, v in pop_b.items() if 0 < v < 1000),
                key=lambda x: x["barrio_id"],
            ),
            "under_5000_residents": sorted(
                ({"barrio_id": k, "residents": v} for k, v in pop_b.items() if 0 < v < 5000),
                key=lambda x: x["barrio_id"],
            ),
            "resident_distribution": distribution(population_values),
            "suppression_rule": "NONE. No zero denominator is present; small-denominator diagnostics are disclosed instead of winsorising or suppressing.",
        }

        missing_barrio_ids = {i for i, rec in locales["records"].items() if not rec["barrio"]}
        missing_coords = {i for i, rec in locales["records"].items() if rec["coordinate_missing"]}
        resolved_missing_coords = {i for i in missing_coords if locales["records"][i]["barrio"]}

        area_diagnostic = {
            "method": "Spherical polygon area derived from the committed canonical WGS84 geometry; gross administrative area, with polygon holes subtracted.",
            "municipality_area_km2": geo["units"]["municipality"]["28079"]["area_km2"],
            "sum_barrio_area_km2": round(sum(v["area_km2"] for v in geo["units"]["barrio"].values()), 6),
            "barrio_area_distribution_km2": distribution([v["area_km2"] for v in geo["units"]["barrio"].values()]),
            "built_up_area_denominator_available": False,
            "ruling": "NO-GO for production: gross polygons include parks and non-buildable/non-commercial land, so raw km2 creates land-use bias. Arithmetic is retained only as a method diagnostic.",
        }

        universe_defs = {
            "U0_RAW_PREMISES": "All distinct id_local in Locales.",
            "U1_SOURCE_INCLUDED_PREMISES": "U0 minus the union of situacion 8/9 OR access 12; no inferred exclusion.",
            "U2_SOURCE_INCLUDED_POPULATED_TAXONOMY_PREMISES": "U1 premises with at least one populated id_epigrafe. Includes populated section Z / 000000 / SIN ACTIVIDAD under the mechanical populated-epigraph rule; blank taxonomy is excluded. Populated taxonomy does not mean verified current operation or economic activity.",
            "U3_SOURCE_INCLUDED_CORE_HOSPITALITY_PREMISES": "Distinct U1 premises with at least one Gate B CORE_HOSPITALITY (division 56) membership.",
            "U4_SOURCE_INCLUDED_ACCOMMODATION_PREMISES": "Distinct U1 premises with at least one Gate B ACCOMMODATION (division 55) membership.",
            "U5_SOURCE_INCLUDED_TOURISM_ADJACENT_PREMISES": "Distinct U1 premises with at least one Gate B TOURISM_ADJACENT (division 79) membership.",
            "U6_SOURCE_INCLUDED_GENERIC_COMMERCIAL_PREMISES": "Distinct U1 premises with at least one Gate B GENERIC_COMMERCIAL (section G) membership.",
        }
        universe_counts = {name: {"definition": definition, "count": len(universes[f"U{idx}"])} for idx, (name, definition) in enumerate(universe_defs.items())}

        registry = build_registry(snapshot, population_ref, population_version, geo["meta"])
        production_candidates = [e["indicator_id"] for e in registry if e["admissibility_status"] == "PRODUCTION_CANDIDATE"]
        conditional_production_candidates = [
            e["indicator_id"] for e in registry
            if e["admissibility_status"] == "CONDITIONAL_PRODUCTION_CANDIDATE"
        ]
        audit = {
            "contract_version": "1.0.0",
            "scope": "Gate F research audit only; no production/UI wiring and no area ranking output.",
            "snapshot_identity": snapshot,
            "candidate_universes": universe_counts,
            "source_exclusion_impact": {
                "situacion_8": {"count": len(sit8), "share_raw_pct": pct(len(sit8), len(loc_ids))},
                "situacion_9": {"count": len(sit9), "share_raw_pct": pct(len(sit9), len(loc_ids))},
                "access_12": {"count": len(acc12), "share_raw_pct": pct(len(acc12), len(loc_ids))},
                "overlaps": {"8_and_9": len(sit8 & sit9), "8_and_12": len(sit8 & acc12), "9_and_12": len(sit9 & acc12), "triple": len(sit8 & sit9 & acc12)},
                "naive_sum": len(sit8) + len(sit9) + len(acc12),
                "union_excluded": len(excluded),
                "double_subtraction_avoided": len(sit8) + len(sit9) + len(acc12) - len(excluded),
                "remaining_u1": len(u1),
                "barrio_order_sensitivity_raw_vs_union_filtered": rank_diagnostic(raw_per_pop, metrics["A_U1_per_1000_residents"]),
            },
            "blank_taxonomy_effects": {
                "project_label": "UNCLASSIFIED_SOURCE_ACTIVITY",
                "source_semantics": "UNRESOLVED",
                "u1_blank_premises": len(blank_u1),
                "share_of_u1_pct": pct(len(blank_u1), len(u1)),
                "included_in": ["U1/all documented-premises counts", "U1 denominator"],
                "excluded_from": ["U2 populated-taxonomy-premises denominator", "populated-taxonomy membership denominator"],
                "status_composition": dict(sorted(blank_status.items())),
                "access_composition": dict(sorted(blank_access.items())),
                "by_district": blank_district,
                "by_barrio": blank_barrio,
                "barrio_share_distribution_pct": distribution(blank_shares),
                "spatial_bias_finding": "Material spatial variation means dropping blank taxonomy from an all-premises denominator would change area comparisons. It is excluded only where the denominator is explicitly limited to populated source taxonomy.",
            },
            "interior_effects": {
                "code": "3",
                "source_semantics": "UNRESOLVED/undocumented",
                "raw_count": len(interior),
                "raw_share_pct": pct(len(interior), len(loc_ids)),
                "u1_count": len(interior_u1),
                "u1_share_pct": pct(len(interior_u1), len(u1)),
                "overlap_source_excluded": len(interior & excluded),
                "taxonomy_membership_counts_nonexclusive": interior_tax,
                "by_district": interior_district,
                "barrio_share_distribution_pct": distribution([x for x in interior_barrio_shares if x is not None]),
                "counterfactual_exclusion": {
                    "u1_removed": len(interior_u1),
                    "u1_change_pct": pct(-len(interior_u1), len(u1)),
                    "u1_per_resident_rank_diagnostic": rank_diagnostic(metrics["A_U1_per_1000_residents"], u1_without_interior),
                    "core_per_resident_rank_diagnostic": rank_diagnostic(metrics["C_core_per_1000_residents"], core_without_interior),
                    "core_membership_pct_of_populated_taxonomy_rank_diagnostic": rank_diagnostic(metrics["D_core_membership_pct_of_populated_taxonomy"], core_share_without_interior),
                },
                "ruling": "GO to include under the explicit source rule, with source semantics flagged. No evidence supports exclusion; the counterfactual is material and therefore cannot be adopted silently.",
            },
            "multi_activity": {
                "treatment": "Non-exclusive premises memberships. Every class count deduplicates id_local within class; no forced exclusive assignment.",
                "target_class_membership_cardinality_within_u1": dict(sorted(target_membership_cardinality.items())),
                "all_gate_b_class_membership_cardinality_within_u1": dict(sorted(all_membership_cardinality.items())),
                "pairwise_target_class_overlap": pairwise_overlap,
                "share_warning": "Class membership shares may overlap and are not expected to sum to 100%.",
            },
            "activity_row_counting_sensitivity": class_row_sensitivity,
            "population_alignment": {
                "authority": pop["meta"]["source"]["authority"],
                "dataset": pop["meta"]["source"]["dataset"],
                "underlying_register": pop["meta"]["source"]["underlying_register"],
                "unit": "persons registered in the municipal Padron",
                "reference_date": population_ref["reference_date"],
                "reference_type": population_ref["type"],
                "annual_average": False,
                "total_population": pop["by_level"]["municipality"]["28079"],
                "coverage": {"municipality": 1, "districts": len(pop_d), "barrios": len(pop_b)},
                "key_structure": "barrio official_id (3 digits), district parent_id (2 digits), CURRENT_131 only",
                "one_to_one_current_131": set(pop_b) == canonical_b,
                "population_data_version": population_version,
                "premises_nominal_period": NOMINAL_PERIOD,
                "calendar_month_offset": 8,
                "lower_bound_days_if_premises_anchored_to_2026_09_01": 243,
                "exact_day_gap": "UNAVAILABLE because the premises source supplies a nominal month, not an exact reference day",
                "alternative_closer_period": "A monthly Padron dataset exists (dataset 200076) but uses rolling end-of-month semantics and is not a committed, audited CURRENT_131 denominator in this project. It is not substituted silently.",
                "ruling": "MODIFY: acceptable as an annual residential-context denominator only with both dates displayed and no simultaneity claim.",
            },
            "population_denominator_anomalies": anomalies,
            "geographic_completeness": {
                "u0_missing_barrio_code": len(missing_barrio_ids),
                "u1_missing_barrio_code": len(missing_barrio_ids & u1),
                "u3_missing_barrio_code": len(missing_barrio_ids & universes["U3"]),
                "u0_missing_coordinate": len(missing_coords),
                "code_resolved_despite_missing_coordinate": len(resolved_missing_coords),
                "rule": "Code-resolved premises remain geographically assignable even when coordinates are missing; coordinates are never an eligibility filter.",
            },
            "sensitivity_diagnostics": {
                "scenario_definitions": {
                    "A": "U1 / population", "B": "U2 populated-taxonomy premises / population",
                    "C": "CORE_HOSPITALITY / population", "D": "CORE_HOSPITALITY non-exclusive membership / U2 populated-taxonomy premises",
                },
                "barrio_rank_diagnostics": sensitivity_pairs,
                "no_rankings_emitted": True,
            },
            "area_denominator": area_diagnostic,
            "indicator_family_preference": {
                "source_internal_membership": "More internally coherent because numerator and denominator share the same administrative system; answers non-exclusive class membership within populated taxonomy, not residential context and not a mutually exclusive partition.",
                "population_density": "Admissible only as residential-context density with an external denominator, dual dates and a strict interpretation ceiling; answers a different question.",
                "universal_kpi": "NO-GO. Counts, non-exclusive source membership and external-denominator densities answer different questions.",
            },
        }

        audit = apply_approved_semantic_contract(audit)
        summary = build_summary(registry)
        write_outputs(audit, registry, summary)
        print(
            f"[gate-f] wrote {len(registry)} candidate rulings; "
            f"production candidates: {len(production_candidates)}; "
            f"conditional production candidates: {len(conditional_production_candidates)}"
        )
        return 0
    finally:
        for path in cleanup:
            if path and os.path.exists(path):
                os.unlink(path)


if __name__ == "__main__":
    if sys.argv[1:] == ["--rebuild-approved-semantics"]:
        raise SystemExit(rebuild_approved_semantics())
    if sys.argv[1:]:
        raise SystemExit("usage: audit_denominator.py [--rebuild-approved-semantics]")
    raise SystemExit(main())
