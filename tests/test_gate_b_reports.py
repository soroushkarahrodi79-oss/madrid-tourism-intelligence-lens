"""Contract tests for the committed Gate B evidence reports.

Network-free. These guard the *semantics* of the reports in
`research/accommodation_gate_b/`, not their counts: the counts are observations
of one audit run against live sources and are expected to move when the sources
move. What must not move is how the reports describe dates, universes and
reconciliation strength.

The specific risks guarded here all came out of review of the Gate B PR:

  * a portal's "current dataset state" date silently becoming a record-level
    effective or reference period the source never published;
  * an HTTP `Last-Modified` header being promoted into a publication date;
  * an external control difference being described as *explained* when the two
    sources cover different periods and the audit cannot show that time alone
    accounts for it.
"""

import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPORTS = ROOT / "research" / "accommodation_gate_b"


def load(name):
    return json.loads((REPORTS / f"report_{name}.json").read_text(encoding="utf-8"))


class CandidateBTemporalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporal = load("candidate_b")["candidate_b"]["temporal"]

    def test_portal_state_date_is_recorded_rather_than_denied(self):
        # The portal does date the current dataset state, so the report must not
        # claim the source carries no date information at all.
        self.assertTrue(self.temporal["portal_declared_dataset_state_date"])

    def test_portal_state_date_is_not_promoted_into_a_reference_period(self):
        self.assertFalse(self.temporal["record_level_reference_or_effective_date"])
        self.assertIsNone(self.temporal["temporal_coverage_declared"])
        for absent in ("reference_date", "effective_date", "source_period"):
            self.assertNotIn(absent, self.temporal)

    def test_http_header_is_kept_separate_from_the_portal_state_date(self):
        self.assertIn("json_http_last_modified", self.temporal)
        self.assertNotEqual(
            self.temporal["json_http_last_modified"],
            self.temporal["portal_declared_dataset_state_date"],
        )
        self.assertIn("http_last_modified_is_not_a_reference_date", self.temporal)

    def test_longitudinal_gaps_are_still_recorded(self):
        self.assertFalse(self.temporal["historical_snapshots_published"])
        self.assertFalse(self.temporal["previous_states_reconstructable"])

    def test_assessment_is_conditional_not_absent(self):
        assessment = self.temporal["assessment"].lower()
        self.assertIn("conditional", assessment)
        self.assertNotIn("no period at all", assessment)


class CandidateATemporalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporal = load("candidate_a")["candidate_a"]["temporal"]

    def test_no_retention_policy_is_claimed(self):
        # Without a documented retention policy the extract cannot be called a
        # cumulative stock, however plausible that reading is. The note may only
        # mention "cumulative" to disclaim it.
        note = self.temporal["retention_note"].lower()
        self.assertFalse(self.temporal["retention_policy_published"])
        self.assertIn("not described as a cumulative stock", note)
        self.assertEqual(note.count("cumulative"), 1)

    def test_catalogue_date_and_http_header_are_distinct_fields(self):
        self.assertIn("catalogue_metadata_modified", self.temporal)
        self.assertIn("xlsx_http_last_modified", self.temporal)
        self.assertNotEqual(
            self.temporal["catalogue_metadata_modified"],
            self.temporal["xlsx_http_last_modified"],
        )

    def test_no_reference_or_effective_date_is_claimed(self):
        self.assertFalse(self.temporal["reference_date_field_published"])
        self.assertFalse(self.temporal["effective_date_published"])

    def test_grant_dates_are_a_span_not_a_period(self):
        self.assertLessEqual(
            self.temporal["earliest_grant_date"], self.temporal["latest_grant_date"]
        )


class ControlReconciliationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.recon = load("control")["control"]["reconciliation"]

    def test_non_vut_difference_is_not_claimed_to_be_explained(self):
        classification = self.recon["non_vut_total"]["classification"].lower()
        self.assertNotIn("explainable", classification)
        self.assertIn("not fully reconciled", classification)
        self.assertTrue(
            "plausibl" in classification or "compatible" in classification,
            classification,
        )

    def test_vut_difference_stays_unexplained(self):
        self.assertIn("unexplained", self.recon["vut_total"]["classification"].lower())

    def test_period_mismatch_is_stated_explicitly(self):
        self.assertIn("periods differ", self.recon["period_mismatch"].lower())

    def test_control_is_evidence_not_a_target(self):
        self.assertIn("never a target", self.recon["note"].lower())


if __name__ == "__main__":
    unittest.main()
