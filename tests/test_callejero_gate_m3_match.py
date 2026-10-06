import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
RESULT = ROOT / "research/callejero_gate/results/m3_match.json"


class GateM3Match(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = json.loads(RESULT.read_text(encoding="utf-8"))

    def test_overall_counts_and_rates_reconcile(self):
        overall = self.report["overall"]
        self.assertEqual(overall["licence_rows"], overall["matched_rows"] + overall["unmatched_rows"])
        self.assertEqual(overall["distinct_licence_ndps"],
                         overall["matched_distinct_ndps"] + overall["unmatched_distinct_ndps"])
        self.assertAlmostEqual(overall["row_match_rate"], overall["matched_rows"] / overall["licence_rows"], places=6)
        self.assertAlmostEqual(overall["ndp_match_rate"], overall["matched_distinct_ndps"] / overall["distinct_licence_ndps"], places=6)

    def test_current_historical_recovery_reconciles(self):
        overall = self.report["overall"]
        history = self.report["current_and_historical"]
        self.assertEqual(overall["matched_rows"],
                         history["current_only_matched_rows"] + history["historical_only_recovered_rows"])
        self.assertEqual(overall["unmatched_rows"], history["still_unresolved_rows"])
        self.assertGreater(history["historical_only_recovered_rows"], 0)

    def test_every_year_and_tipo_reconciles(self):
        overall = self.report["overall"]
        self.assertEqual(set(self.report["per_year"]), {"2023", "2024", "2025", "2026"})
        for grouping in (self.report["per_year"], self.report["per_tipo"]):
            self.assertEqual(sum(v["rows"] for v in grouping.values()), overall["licence_rows"])
            for record in grouping.values():
                self.assertEqual(record["rows"], record["matched"] + record["unmatched"])
                self.assertAlmostEqual(record["match_rate"], record["matched"] / record["rows"], places=6)
        self.assertEqual(len(self.report["per_tipo"]), 9)

    def test_residual_taxonomy_is_exhaustive(self):
        residuals = self.report["residual_taxonomy"]
        self.assertTrue(self.report["residual_taxonomy_is_exhaustive"])
        self.assertEqual(sum(residuals.values()), self.report["overall"]["licence_rows"])
        self.assertEqual(residuals["NDP_FOUND_HISTORICAL_ONLY"],
                         self.report["current_and_historical"]["historical_only_recovered_rows"])
        self.assertEqual(residuals["ADDRESS_TEXT_DISAGREEMENT"],
                         self.report["address_text"]["disagreement_rows"])

    def test_barrio_coverage_hierarchy_and_spatial_check(self):
        era = self.report["barrio_era"]
        self.assertTrue(era["exact_code_set_match"])
        self.assertEqual(era["callejero_distinct_codes"], 131)
        self.assertEqual(era["unknown_codes"], [])
        hierarchy = self.report["district_barrio_consistency"]
        self.assertEqual(hierarchy["checked_rows"], hierarchy["consistent"])
        self.assertEqual(hierarchy["disagreements"], 0)
        spatial = self.report["spatial_cross_check"]
        self.assertEqual(spatial["official_barrio_disagrees_with_polygon"], 0)
        self.assertEqual(spatial["outside_municipality"], 0)


if __name__ == "__main__":
    unittest.main()
