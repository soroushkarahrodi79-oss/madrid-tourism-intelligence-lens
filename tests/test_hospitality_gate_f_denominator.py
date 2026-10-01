"""Focused contract tests for Gate F denominator admissibility.

Counts are observations tied to upstream fingerprints, so these tests assert the
methodological relationships and metadata contract rather than freezing live totals.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GATE = ROOT / "research" / "hospitality_commercial_gate"
RESULTS = GATE / "results"
DOC = ROOT / "docs" / "HOSPITALITY_COMMERCIAL_METHOD_GATE.md"

sys.path.insert(0, str(GATE))
SPEC = importlib.util.spec_from_file_location("audit_denominator", GATE / "audit_denominator.py")
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


class GateFDenominatorContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.audit = json.loads((RESULTS / "gate_f_denominator_audit.json").read_text(encoding="utf-8"))
        cls.registry = json.loads((RESULTS / "gate_f_indicator_registry.json").read_text(encoding="utf-8"))
        cls.summary = json.loads((RESULTS / "gate_f_summary.json").read_text(encoding="utf-8"))
        cls.methodology = DOC.read_text(encoding="utf-8")
        cls.by_id = {row["indicator_id"]: row for row in cls.registry}

    def test_source_exclusion_is_union_not_double_subtraction(self):
        ex = self.audit["source_exclusion_impact"]
        self.assertEqual(MODULE.C.EXCL_SITUACION_CODES, {"8", "9"})
        self.assertEqual(MODULE.C.EXCL_ACCESO_CODES, {"12"})
        components = ex["situacion_8"]["count"] + ex["situacion_9"]["count"] + ex["access_12"]["count"]
        self.assertEqual(ex["naive_sum"], components)
        self.assertEqual(ex["union_excluded"], components - ex["double_subtraction_avoided"])
        self.assertEqual(
            self.audit["candidate_universes"]["U0_RAW_PREMISES"]["count"] - ex["union_excluded"],
            self.audit["candidate_universes"]["U1_SOURCE_INCLUDED_PREMISES"]["count"],
        )

    def test_interior_is_flagged_and_not_excluded(self):
        interior = self.audit["interior_effects"]
        self.assertNotIn("3", MODULE.C.EXCL_ACCESO_CODES)
        self.assertGreater(interior["u1_count"], 0)
        self.assertIn("include", interior["ruling"].lower())
        self.assertEqual(self.summary["rulings"]["interior_access_handling"], "GO")

    def test_blank_taxonomy_remains_explicit(self):
        blank = self.audit["blank_taxonomy_effects"]
        self.assertEqual(blank["project_label"], "UNCLASSIFIED_SOURCE_ACTIVITY")
        self.assertEqual(blank["source_semantics"], "UNRESOLVED")
        self.assertGreater(blank["u1_blank_premises"], 0)
        self.assertIn("U1 denominator", blank["included_in"])
        self.assertIn("U2 populated-taxonomy-premises denominator", blank["excluded_from"])
        u1 = self.audit["candidate_universes"]["U1_SOURCE_INCLUDED_PREMISES"]["count"]
        u2 = self.audit["candidate_universes"]["U2_SOURCE_INCLUDED_POPULATED_TAXONOMY_PREMISES"]["count"]
        self.assertEqual(u1 - u2, blank["u1_blank_premises"])

    def test_u2_is_populated_taxonomy_not_verified_activity(self):
        u2 = self.audit["candidate_universes"]["U2_SOURCE_INCLUDED_POPULATED_TAXONOMY_PREMISES"]
        definition = u2["definition"]
        self.assertIn("populated id_epigrafe", definition)
        self.assertTrue(u2["includes_populated_sin_actividad"])
        self.assertTrue(u2["excludes_blank_taxonomy"])
        self.assertFalse(u2["verified_current_operation"])
        self.assertRegex(definition, r"000000\s*/\s*SIN ACTIVIDAD")
        self.assertIn("does not mean verified current operation", definition)

    def test_premises_are_deduplicated_and_multi_activity_is_not_hidden(self):
        multi = self.audit["multi_activity"]
        self.assertIn("Non-exclusive", multi["treatment"])
        self.assertGreater(int(multi["target_class_membership_cardinality_within_u1"].get("2", 0)), 0)
        row_sensitivity = self.audit["activity_row_counting_sensitivity"]
        self.assertGreater(row_sensitivity["CORE_HOSPITALITY"]["activity_rows"], row_sensitivity["CORE_HOSPITALITY"]["distinct_premises"])
        self.assertIn("distinct", self.by_id["core_hospitality_premises_count"]["numerator"].lower())
        self.assertIn("not expected to sum to 100%", multi["share_warning"])

    def test_population_date_and_mismatch_are_explicit(self):
        alignment = self.audit["population_alignment"]
        self.assertRegex(alignment["reference_date"], r"^\d{4}-01-01$")
        self.assertEqual(alignment["premises_nominal_period"], "2026-09")
        self.assertEqual(alignment["calendar_month_offset"], 8)
        self.assertIn("UNAVAILABLE", alignment["exact_day_gap"])
        for iid in (
            "source_included_premises_per_1000_residents",
            "core_hospitality_premises_per_1000_residents",
            "accommodation_class_premises_per_1000_residents",
        ):
            self.assertEqual(self.by_id[iid]["reference_period"]["population"]["reference_date"], alignment["reference_date"])

    def test_current_population_is_never_applied_to_historical_128(self):
        rule = self.summary["temporal_use_rule"]
        self.assertIn("never", rule.lower())
        self.assertIn("HISTORICAL_128", rule)
        self.assertIn("current snapshot only", rule.lower())

    def test_coordinate_missingness_does_not_remove_code_resolved_premises(self):
        geography = self.audit["geographic_completeness"]
        self.assertGreater(geography["code_resolved_despite_missing_coordinate"], 0)
        self.assertIn("never an eligibility filter", geography["rule"])

    def test_accommodation_is_never_labelled_capacity_or_beds(self):
        count = self.by_id["accommodation_class_premises_count"]
        density = self.by_id["accommodation_class_premises_per_1000_residents"]
        self.assertNotRegex(count["label"].lower(), r"capacity|beds")
        self.assertEqual(density["ruling"], "NO-GO")
        self.assertRegex(density["interpretation_ceiling"].lower(), r"capacity|beds")

    def test_per_resident_labels_and_interpretations_make_no_pressure_claim(self):
        forbidden = ("pressure", "burden", "overtourism", "saturation")
        for row in self.registry:
            if "residents" not in row["unit"]:
                continue
            public_claim = (row["label"] + " " + row["interpretation"]).lower()
            self.assertFalse(any(term in public_claim for term in forbidden), row["indicator_id"])
            ceiling = row["interpretation_ceiling"].lower()
            self.assertTrue(all(term in ceiling for term in forbidden), row["indicator_id"])

    def test_source_internal_and_population_families_remain_distinct(self):
        membership = self.by_id[
            "core_hospitality_membership_share_of_populated_taxonomy_premises"
        ]
        residential = self.by_id["core_hospitality_premises_per_1000_residents"]
        self.assertIn("U2", membership["denominator"])
        self.assertIn("registered residents", residential["denominator"])
        self.assertNotEqual(membership["decision_question"], residential["decision_question"])
        self.assertEqual(self.audit["indicator_family_preference"]["universal_kpi"].split(".")[0], "NO-GO")

    def test_core_u2_is_nonexclusive_membership_not_partition_composition(self):
        row = self.by_id[
            "core_hospitality_membership_share_of_populated_taxonomy_premises"
        ]
        combined = " ".join((
            row["label"], row["decision_question"], row["interpretation"],
            row["interpretation_ceiling"], row["known_sensitivity"],
        )).lower()
        self.assertIn("non-exclusive", combined)
        self.assertIn("not expected to sum to 100%", combined)
        self.assertIn("sin actividad", combined)
        self.assertNotIn("mutually exclusive composition", combined)
        self.assertIn("not expected to sum to 100%", self.audit["multi_activity"]["share_warning"])

    def test_every_go_or_modify_candidate_has_complete_contract(self):
        for row in self.registry:
            if row["ruling"] not in {"GO", "MODIFY"}:
                continue
            for field in ("numerator", "denominator", "unit", "geography", "reference_period", "interpretation_ceiling", "temporal_use"):
                self.assertTrue(row[field], f"{row['indicator_id']} missing {field}")
            self.assertIn("premises_and_activities", row["reference_period"])
            self.assertEqual(set(row["risk_matrix"]), {
                "source_validity", "numerator_clarity", "denominator_clarity",
                "temporal_compatibility", "geographic_compatibility", "sensitivity",
                "interpretive_risk", "decision_relevance",
            })

    def test_no_go_is_not_a_production_candidate(self):
        production = set(self.summary["production_candidate_indicator_ids"]) | set(
            self.summary["conditional_production_candidate_indicator_ids"]
        )
        for row in self.registry:
            if row["ruling"] == "NO-GO":
                self.assertEqual(row["admissibility_status"], "NO_GO")
                self.assertNotIn(row["indicator_id"], production)

    def test_modify_resident_density_is_conditional_not_unconditional(self):
        iid = "core_hospitality_premises_per_1000_residents"
        row = self.by_id[iid]
        self.assertEqual(row["ruling"], "MODIFY")
        self.assertEqual(row["admissibility_status"], "CONDITIONAL_PRODUCTION_CANDIDATE")
        self.assertNotIn(iid, self.summary["production_candidate_indicator_ids"])
        self.assertEqual(self.summary["conditional_production_candidate_indicator_ids"], [iid])
        conditions = " ".join(row["implementation_conditions"]).lower()
        for required in (
            "sep 2026", "01 jan 2026", "registered residents", "padron",
            "dual dates", "no shared '2026'", "residential-context",
            "tourism pressure", "resident burden", "saturation", "overtourism",
            "verified operating-business density",
        ):
            self.assertIn(required, conditions)
        self.assertEqual(
            row["implementation_conditions"],
            self.summary["conditional_production_requirements"][iid],
        )
        self.assertEqual(row["reference_period"]["population"]["reference_date"], "2026-01-01")

    def test_count_indicator_labels_remain_bounded(self):
        source = self.by_id["source_included_premises_count"]
        core = self.by_id["core_hospitality_premises_count"]
        accommodation = self.by_id["accommodation_class_premises_count"]
        self.assertNotIn("business", source["label"].lower())
        self.assertNotIn("operating restaurant", core["label"].lower())
        self.assertNotRegex(accommodation["label"].lower(), r"beds|capacity|licensed")

    def test_methodology_and_registry_rulings_agree(self):
        self.assertIn("## Gate F — Denominator Construction & Indicator Admissibility", self.methodology)
        for iid in self.summary["production_candidate_indicator_ids"]:
            self.assertIn(f"`{iid}`", self.methodology)
            self.assertEqual(self.by_id[iid]["admissibility_status"], "PRODUCTION_CANDIDATE")
        for iid in self.summary["conditional_production_candidate_indicator_ids"]:
            self.assertIn(f"`{iid}`", self.methodology)
            self.assertEqual(
                self.by_id[iid]["admissibility_status"],
                "CONDITIONAL_PRODUCTION_CANDIDATE",
            )
        self.assertIn("Pressure / saturation / overtourism indicator | **NO-GO**", self.methodology)
        self.assertIn("**Accommodation per resident: NO-GO.**", self.methodology)


if __name__ == "__main__":
    unittest.main()
