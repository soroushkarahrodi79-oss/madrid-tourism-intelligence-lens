"""Contract tests for the committed Gate L · L2 identity / difference-classifier results.

Network-free. Guards the decisive sub-gate's invariants:

  E. the difference classifier is TOTAL — every substantive difference lands in exactly
     one of the five classes; the five class counts sum to total_differences;
  F. the classification uses a fixed five-class precedence with the two non-difference
     buckets (IDENTICAL, COSMETIC_TEXT_DRIFT) kept separate;
  G. there is no silent fallback / no OTHER class;
  plus: the decisive pair is a real within-schema-era consecutive pair; cosmetic text
  drift is separated from substantive change; the entity-identity key is {edition}:{code};
  and the interpretation ceiling PLANNING_STATE_TRANSITION != PHYSICAL_URBAN_CHANGE is stated.
"""

import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
RESULTS = ROOT / "research" / "urban_planning_gate" / "results"
IDENTITY = RESULTS / "l2_identity.json"
SUMMARY = RESULTS / "l2_summary.json"

FIVE_CLASSES = {"NEW_AMBITO", "ABSENT_FROM_EDITION", "MODIFIED_BY_INSTRUMENT",
                "STATE_TRANSITION", "CAUSE_UNRESOLVED"}


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


class TestL2Identity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rep = load(IDENTITY)
        cls.sum = load(SUMMARY)

    def test_E_classifier_total(self):
        for fam in ("S1", "S2"):
            d = self.rep["families"][fam]["decisive_pair"]
            self.assertEqual(sum(d["counts"].values()), d["total_differences"],
                             f"{fam}: class counts must sum to total_differences")

    def test_F_exactly_five_classes_plus_noncount_buckets(self):
        self.assertEqual(set(self.rep["precedence"]), FIVE_CLASSES)
        for fam in ("S1", "S2"):
            d = self.rep["families"][fam]["decisive_pair"]
            self.assertEqual(set(d["counts"].keys()), FIVE_CLASSES)
            # cosmetic drift is tracked as its own non-difference bucket
            self.assertIn("cosmetic_text_drift", d)

    def test_G_no_silent_fallback_no_other(self):
        for fam in ("S1", "S2"):
            d = self.rep["families"][fam]["decisive_pair"]
            self.assertNotIn("OTHER", d["counts"])
            # proportions sum ~1.0 (or 0 when no differences)
            total = sum(d["proportions"].values())
            self.assertTrue(abs(total - 1.0) < 1e-6 or d["total_differences"] == 0)

    def test_decisive_pair_is_within_era_consecutive(self):
        for fam in ("S1", "S2"):
            d = self.rep["families"][fam]["decisive_pair"]
            self.assertEqual(d["pair"], "2025-07 -> 2026-01")

    def test_cosmetic_drift_separated_from_substantive(self):
        # S2 re-encodes note text; cosmetic drift must be non-zero AND excluded from classes
        s2 = self.rep["families"]["S2"]["decisive_pair"]
        self.assertGreater(s2["cosmetic_text_drift"], 0)
        self.assertNotIn("cosmetic", {k.lower() for k in s2["counts"]})

    def test_entity_identity_key(self):
        for fam in ("S1", "S2"):
            self.assertEqual(self.rep["families"][fam]["entity_identity_key"], "{edition}:{code}")

    def test_interpretation_ceiling_stated(self):
        self.assertIn("PLANNING_STATE_TRANSITION", self.rep["interpretation_ceiling"])
        self.assertIn("PHYSICAL_URBAN_CHANGE", self.rep["interpretation_ceiling"])

    def test_cross_era_pairs_non_comparable(self):
        for fam in ("S1", "S2"):
            pairs = self.rep["families"][fam]["all_consecutive_pairs"]
            noncomp = [p for p in pairs if p["status"] == "NON_COMPARABLE"]
            self.assertGreater(len(noncomp), 0, f"{fam} must mark cross-era pairs NON_COMPARABLE")


if __name__ == "__main__":
    unittest.main()
