#!/usr/bin/env python3
"""
One-time (re-runnable) extraction of HATI-Madrid outdoor UTCI evidence into
data/hati_assets.json + data/hati_provenance.json.

This script reads directly from a local checkout of the HATI-Madrid research
repository (read-only) and never writes back to it. Re-run it whenever the
HATI evidence needs to be refreshed against a newer commit; do not hand-edit
the generated JSON files.

Usage:
    python3 scripts/extract_hati_evidence.py --hati-root /path/to/heat-adaptive-tourism-madrid
"""
import argparse
import csv
import json
import subprocess
from datetime import date, datetime, timezone
from pathlib import Path

HATI_REPO_URL = "https://github.com/soroushkarahrodi79-oss/heat-adaptive-tourism-madrid"
PILOT_ASSETS_REL = "data/processed/pilot_assets.csv"
THERMAL_EXPOSURE_REL = "data/processed/phase2_asset_thermal_exposure.csv"
STUDY_DATE = "2023-08-21"
SUPPORTED_TIMESTEPS = ["12:00", "15:00", "18:00"]


def git_commit_sha(repo_root: Path) -> str:
    out = subprocess.run(
        ["git", "-C", str(repo_root), "rev-parse", "HEAD"],
        check=True, capture_output=True, text=True,
    )
    return out.stdout.strip()


def load_pilot_assets(path: Path) -> dict:
    assets = {}
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["indoor_outdoor"] != "outdoor":
                continue
            assets[row["asset_id"]] = {
                "id": row["asset_id"],
                "name": row["name"],
                "category": row["category"],
                "lat": float(row["latitude"]),
                "lon": float(row["longitude"]),
                "osm_source": row["source"],
                "evidence_notes": row["evidence_notes"],
                "utci_mean_10m": {},
                "utci_category": {},
            }
    return assets


def merge_thermal_exposure(assets: dict, path: Path) -> None:
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            asset_id = row["asset_id"]
            if asset_id not in assets:
                continue
            ts = row["timestamp"]
            if ts not in SUPPORTED_TIMESTEPS:
                continue
            if row["indoor_outdoor"] != "outdoor":
                continue
            val = row["utci_mean_10m"]
            if val == "":
                continue
            assets[asset_id]["utci_mean_10m"][ts] = float(val)
            assets[asset_id]["utci_category"][ts] = row["utci_category"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hati-root", required=True, type=Path,
                     help="Path to a local checkout of heat-adaptive-tourism-madrid")
    ap.add_argument("--out-dir", default=Path(__file__).resolve().parent.parent / "data",
                     type=Path)
    args = ap.parse_args()

    commit_sha = git_commit_sha(args.hati_root)
    pilot_assets_path = args.hati_root / PILOT_ASSETS_REL
    thermal_path = args.hati_root / THERMAL_EXPOSURE_REL

    assets = load_pilot_assets(pilot_assets_path)
    merge_thermal_exposure(assets, thermal_path)

    # Drop any outdoor asset that ended up with no UTCI evidence at all
    # (should not happen in this pilot, but keep the pipeline honest).
    assets = {k: v for k, v in assets.items() if v["utci_mean_10m"]}

    out_assets = sorted(assets.values(), key=lambda a: a["id"])
    args.out_dir.mkdir(parents=True, exist_ok=True)

    assets_path = args.out_dir / "hati_assets.json"
    with assets_path.open("w", encoding="utf-8") as f:
        json.dump(out_assets, f, ensure_ascii=False, indent=2)
        f.write("\n")

    provenance = {
        "source_repository": HATI_REPO_URL,
        "source_commit_sha": commit_sha,
        "source_files": [PILOT_ASSETS_REL, THERMAL_EXPOSURE_REL],
        "study_date": STUDY_DATE,
        "extraction_date": datetime.now(timezone.utc).date().isoformat(),
        "fields_used": {
            "from_pilot_assets_csv": ["asset_id", "name", "category", "latitude",
                                       "longitude", "indoor_outdoor", "source",
                                       "evidence_notes"],
            "from_phase2_asset_thermal_exposure_csv": ["asset_id", "indoor_outdoor",
                                                        "timestamp", "utci_mean_10m",
                                                        "utci_category"],
        },
        "filter_applied": "indoor_outdoor == 'outdoor' (indoor assets excluded: "
                           "SOLWEIG models the outdoor microclimate only)",
        "supported_timesteps": SUPPORTED_TIMESTEPS,
        "transformation": "No spatial or temporal interpolation. Values are copied "
                           "verbatim from the utci_mean_10m column (mean UTCI over a "
                           "10 m buffer around each asset point, from SOLWEIG output) "
                           "for the three modelled timestamps of the single pilot day.",
        "utci_category_citation": "Bröde P. et al. (2012), International Journal of "
                                   "Biometeorology - official published UTCI thermal-"
                                   "stress category bands, reused as-is by HATI-Madrid "
                                   "(see its docs/PHASE2_UTCI_METHOD.md) and by this "
                                   "project. Not an invented threshold.",
        "asset_count": len(out_assets),
        "limitations": [
            "UTCI values are model-derived (SOLWEIG physical microclimate model), "
            "not measured thermal comfort or physiological observation.",
            "All values correspond to a single modelled pilot day, 21 August 2023, "
            "and do not represent real-time or current conditions.",
            "Coverage is bounded to the 14 outdoor pilot assets in central Madrid "
            "(Paseo del Arte / Parque del Retiro area); it is not a city-wide surface.",
            "Values must not be spatially interpolated across Madrid; only the "
            "sampled asset points themselves carry evidence.",
            "HATI Layer B (post Gate-3B) is RESEARCH_FROZEN; HATI Layer A is "
            "RELEASE_LOCKED. This project reads this evidence read-only and does "
            "not modify, extend, or re-run the HATI pipeline.",
        ],
    }
    provenance_path = args.out_dir / "hati_provenance.json"
    with provenance_path.open("w", encoding="utf-8") as f:
        json.dump(provenance, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Wrote {assets_path} ({len(out_assets)} outdoor assets)")
    print(f"Wrote {provenance_path} (source commit {commit_sha})")


if __name__ == "__main__":
    main()
