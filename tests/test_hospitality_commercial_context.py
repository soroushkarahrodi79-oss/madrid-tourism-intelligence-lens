"""Production-contract tests for Hospitality & Commercial Context v1."""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import math
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_PATH = ROOT / "data" / "hospitality-commercial-context.json"
AUDIT_PATH = ROOT / "research" / "hospitality_commercial_gate" / "results" / "gate_f_denominator_audit.json"
SUMMARY_PATH = ROOT / "research" / "hospitality_commercial_gate" / "results" / "gate_f_summary.json"
GEO_PATH = ROOT / "data" / "geography" / "madrid_admin.geojson"
SCRIPT_PATH = ROOT / "scripts" / "build_hospitality_commercial_context.py"

spec = importlib.util.spec_from_file_location("hospitality_builder", SCRIPT_PATH)
builder = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(builder)


class HospitalityCommercialContextTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.artifact = json.loads(ARTIFACT_PATH.read_text(encoding="utf-8"))
        cls.audit = json.loads(AUDIT_PATH.read_text(encoding="utf-8"))
        cls.summary = json.loads(SUMMARY_PATH.read_text(encoding="utf-8"))
        cls.geo = json.loads(GEO_PATH.read_text(encoding="utf-8"))

    def test_snapshot_pins_are_exact(self):
        meta = self.artifact["metadata"]
        self.assertEqual(meta["premises_sha256"], builder.APPROVED_LOCALES_SHA256)
        self.assertEqual(meta["activities_sha256"], builder.APPROVED_ACTIVIDADES_SHA256)
        self.assertEqual(meta["population_artifact_sha256"], builder.APPROVED_POPULATION_SHA256)

    def test_approved_citywide_controls_and_exclusion_union(self):
        observed = {
            key[:2]: value["count"]
            for key, value in self.audit["candidate_universes"].items()
        }
        self.assertEqual(observed, builder.EXPECTED_CONTROLS)
        exclusions = self.audit["source_exclusion_impact"]
        self.assertEqual(exclusions["situacion_8"]["count"], 12_423)
        self.assertEqual(exclusions["situacion_9"]["count"], 4_120)
        self.assertEqual(exclusions["access_12"]["count"], 2_881)
        self.assertEqual(exclusions["union_excluded"], 19_409)
        self.assertEqual(exclusions["double_subtraction_avoided"], 15)

    def test_u2_blank_sin_actividad_interior_and_multiactivity_contracts(self):
        u2 = self.audit["candidate_universes"]["U2_SOURCE_INCLUDED_POPULATED_TAXONOMY_PREMISES"]
        self.assertTrue(u2["includes_populated_sin_actividad"])
        self.assertTrue(u2["excludes_blank_taxonomy"])
        self.assertFalse(u2["verified_current_operation"])
        self.assertEqual(self.audit["blank_taxonomy_effects"]["source_semantics"], "UNRESOLVED")
        self.assertIn("include", self.audit["interior_effects"]["ruling"].lower())
        self.assertIn("Non-exclusive", self.audit["multi_activity"]["treatment"])
        self.assertGreater(
            self.audit["activity_row_counting_sensitivity"]["CORE_HOSPITALITY"]["row_overcount"], 0
        )

    def test_exact_allowlist_and_no_no_go_metric(self):
        approved = self.summary["production_candidate_indicator_ids"] + self.summary[
            "conditional_production_candidate_indicator_ids"
        ]
        self.assertEqual(self.artifact["metadata"]["selectable_indicator_ids"], approved)
        forbidden = set(self.summary["context_only_indicator_ids"] + self.summary["no_go_indicator_ids"])
        for level in ("municipality", "districts", "barrios"):
            for record in self.artifact[level].values():
                self.assertEqual(list(record["indicators"]), approved)
                self.assertFalse(forbidden & set(record["indicators"]))

    def test_values_are_finite_and_geography_keys_are_canonical(self):
        canonical = {
            feature["properties"]["official_id"]
            for feature in self.geo["features"]
            if feature["properties"]["geography_level"] == "barrio"
        }
        self.assertEqual(set(self.artifact["barrios"]), canonical)
        self.assertEqual(len(canonical), 131)
        for record in self.artifact["barrios"].values():
            for value in record["indicators"].values():
                self.assertTrue(math.isfinite(value))
                self.assertGreaterEqual(value, 0)

    def test_unresolved_geography_is_preserved_not_coerced(self):
        unresolved = self.artifact["metadata"]["unresolved_geography"]["barrio"]
        municipality = self.artifact["municipality"]["28079"]["indicators"]
        for indicator in (
            "source_included_premises_count",
            "core_hospitality_premises_count",
            "accommodation_class_premises_count",
        ):
            barrio_sum = sum(row["indicators"][indicator] for row in self.artifact["barrios"].values())
            self.assertEqual(barrio_sum + unresolved[indicator], municipality[indicator])
        self.assertEqual(unresolved["source_included_premises_count"], 1)
        self.assertEqual(unresolved["core_hospitality_premises_count"], 1)

    def test_conditional_population_metadata_is_complete_and_separate(self):
        meta = self.artifact["metadata"]
        conditional = meta["conditional_indicator"]
        self.assertEqual(meta["premises_nominal_period"], "2026-09")
        self.assertEqual(meta["population_reference_date"], "2026-01-01")
        self.assertEqual(conditional["premises_period"], "Sep 2026")
        self.assertEqual(conditional["population_date"], "2026-01-01")
        self.assertIn("registered residents", conditional["denominator_type"])
        self.assertIn("Not tourism pressure", conditional["interpretation_ceiling"])
        self.assertEqual(meta["geography_version"]["era"], "CURRENT_131")

    def test_deterministic_metric_content_hash(self):
        content = copy.deepcopy(self.artifact)
        del content["metadata"]["generated_at"]
        encoded = json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        self.assertEqual(
            hashlib.sha256(encoded).hexdigest(),
            "f09ec7f973ce3af242a49d35d23a9717eeab59cc2599cb9df9ba108c53f73eb7",
        )

    def test_builder_reuses_gate_contract_helpers(self):
        self.assertIs(builder.F.parse_locales, builder.F.parse_locales)
        self.assertEqual(builder.C.EXCL_SITUACION_CODES, {"8", "9"})
        self.assertEqual(builder.C.EXCL_ACCESO_CODES, {"12"})
        source = SCRIPT_PATH.read_text(encoding="utf-8")
        self.assertIn("F.parse_locales", source)
        self.assertIn("F.parse_activities", source)
        self.assertNotIn("premises_per_km2\"", ARTIFACT_PATH.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
