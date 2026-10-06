"""Contract tests for the committed Gate L · L1 edition-inventory results.

Network-free. These guard the methodological invariants of
`research/urban_planning_gate/results/l1_*.json`, not the exact live counts (which
move as the publisher revises editions). What must not regress:

  A. the full edition inventory is reproduced for both families;
  B. resource-id order is demonstrably NOT chronological, so a future implementation
     cannot regress into selecting "latest" by resource id;
  C. snapshot identities are unique within a family;
  D. no two editions share one family+period+fingerprint identity;
  plus: the declared vs observed cadence is preserved as two distinct facts, the
  schema-era finding (no single comparable 2013->2026 series) is recorded, and the
  gate document's stated figures agree with the machine-readable results.
"""

import json
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
RESULTS = ROOT / "research" / "urban_planning_gate" / "results"
INVENTORY = RESULTS / "l1_edition_inventory.json"
SUMMARY = RESULTS / "l1_summary.json"
GATE_DOC = ROOT / "docs" / "URBAN_PLANNING_SOURCE_GATE_L.md"


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


class TestL1Editions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inv = load(INVENTORY)
        cls.sum = load(SUMMARY)
        cls.doc = GATE_DOC.read_text(encoding="utf-8")

    def test_A_full_inventory_both_families(self):
        for fam in ("S1", "S2"):
            eds = self.inv[fam]["editions"]
            self.assertEqual(len(eds), 15, f"{fam} should have 15 XLS editions")
            for e in eds:
                for field in ("resource_id", "url", "sha256", "bytes", "reference_date",
                              "ole2_created", "schema_era", "snapshot_identity"):
                    self.assertIn(field, e)
                self.assertRegex(e["sha256"], r"^[0-9a-f]{64}$")
                self.assertTrue(e["reference_date"] is None or re.match(r"^\d{4}-\d{2}$", e["reference_date"]))

    def test_B_resource_id_order_not_chronological(self):
        for fam in ("S1", "S2"):
            proof = self.sum["families"][fam]["non_chronological_proof"]
            self.assertFalse(proof["is_chronological_by_id"],
                             f"{fam} resource-id order must NOT be chronological")
            self.assertGreater(proof["inversion_count"], 0)

    def test_C_snapshot_identities_unique(self):
        for fam in ("S1", "S2"):
            ids = [e["snapshot_identity"] for e in self.inv[fam]["editions"]]
            self.assertEqual(len(ids), len(set(ids)), f"{fam} snapshot identities must be unique")
            self.assertTrue(self.sum["families"][fam]["snapshot_identities_unique"])

    def test_D_no_duplicate_family_period_fingerprint(self):
        for fam in ("S1", "S2"):
            keys = []
            for e in self.inv[fam]["editions"]:
                keys.append((fam, e["reference_date"], e["sha256"][:12]))
            self.assertEqual(len(keys), len(set(keys)),
                             "no two editions may share family+period+fingerprint")

    def test_declared_vs_observed_cadence_both_kept(self):
        for fam in ("S1", "S2"):
            s = self.sum["families"][fam]
            self.assertIn("ANNUAL_2", s["declared_cadence_machine"])
            self.assertIn("observed_cadence", s)
            self.assertIn("month_gaps", s["observed_cadence"])

    def test_no_single_comparable_series(self):
        self.assertFalse(self.sum["single_comparable_series"])
        self.assertGreaterEqual(self.sum["families"]["S1"]["schema_era_count"], 2)
        self.assertGreaterEqual(self.sum["families"]["S2"]["schema_era_count"], 2)

    def test_doc_agrees_with_results(self):
        self.assertIn("GO WITH CONDITIONS", self.doc)
        # the non-chronological worked example must appear in the doc
        self.assertIn("203200-2", self.doc)
        self.assertIn("xlrd", self.doc)


if __name__ == "__main__":
    unittest.main()
