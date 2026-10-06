"""Contract tests for the committed Gate L · L5 geometry results.

Network-free. Guards:

  J. the geometry<->table join counts in the gate document match the JSON results;
  K. every residual identifier class (unmatched-in-geometry / unmatched-in-table) is
     represented and classified in the results;
  plus: the service CRS is EPSG:25830; the layer exposes no editingInfo so source_state
  is NOT_DECLARED_BY_PUBLISHER; the reuse basis is MODIFY (attribution, no licence); and
  the '-RP' suffix marks a DISTINCT ámbito (exact-match only, suffix never stripped).
"""

import json
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
RESULTS = ROOT / "research" / "urban_planning_gate" / "results"
GEOM = RESULTS / "l5_geometry.json"
SUMMARY = RESULTS / "l5_summary.json"
GATE_DOC = ROOT / "docs" / "URBAN_PLANNING_SOURCE_GATE_L.md"


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


class TestL5Geometry(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rep = load(GEOM)
        cls.sum = load(SUMMARY)
        cls.doc = GATE_DOC.read_text(encoding="utf-8")

    def test_J_join_counts_in_doc_match_json(self):
        s1 = self.rep["join"]["S1"]
        # the doc quotes S1 exact matched / table total
        self.assertIn(str(s1["exact_matched"]), self.doc)
        self.assertIn(str(s1["table_codes"]), self.doc)
        # 99.85% appears in the doc
        rate_pct = round(s1["exact_match_rate_of_table"] * 100, 2)
        self.assertIn(f"{rate_pct}", self.doc)

    def test_K_every_residual_class_represented(self):
        for fam in ("S1", "S2"):
            j = self.rep["join"][fam]
            cls = j["unmatched_in_geometry_classified"]
            # residual geometry-only count equals the sum of its classified buckets
            self.assertEqual(j["unmatched_in_geometry"],
                             cls["zonal_grade_like"] + cls["ambito_like"] + cls["other"])
            self.assertIn("unmatched_in_table_samples", j)

    def test_crs_25830(self):
        self.assertEqual(self.rep["crs"]["wkid"], 25830)
        self.assertIn("4326", self.rep["crs"]["reprojection"])

    def test_no_editing_info_source_state(self):
        self.assertIsNone(self.rep["freshness"]["editingInfo"])
        self.assertEqual(self.rep["freshness"]["source_state"], "NOT_DECLARED_BY_PUBLISHER")
        self.assertIsNone(self.rep["freshness"]["reference_date"])

    def test_reuse_basis_modify(self):
        self.assertEqual(self.rep["reuse_basis"]["verdict"], "MODIFY")
        self.assertFalse(self.rep["reuse_basis"]["licenseInfo_present"])

    def test_rp_suffix_distinct_exact_match(self):
        self.assertEqual(self.rep["rp_suffix"]["verdict"], "DISTINCT_AMBITO_EXACT_MATCH_ONLY")
        # normalisation must not be adopted: it does not gain (and may lose) matches
        self.assertLessEqual(self.rep["join"]["S1"]["normalised_gain_over_exact"], 0)

    def test_mixed_universe_recorded(self):
        u = self.rep["identifier_universe"]
        self.assertGreater(u["zonal_grade_like"], 0)
        self.assertIn("MIXED", u["correction"].upper())


if __name__ == "__main__":
    unittest.main()
