"""Contract tests for the committed Gate A identity report.

Network-free. These guard the *semantics* of
`research/hospitality_commercial_gate/results/gate_a_identity_summary.json`, not
its counts: the counts are observations of one audit run against live monthly
snapshots and are expected to move when the source publishes new months. What must
not move is the identity model the report asserts and the traps it records.

The specific claims guarded here are the ones a later gate must be able to rely on:

  * `id_local` is a within-snapshot premises key, and `(id_local, id_epigrafe)` a
    within-snapshot activity key, in every audited snapshot;
  * the Actividades file is one-to-many over premises, so premises identity and
    activity identity are genuinely different keys;
  * the weaker identities (name, address, coordinates) are recorded as non-unique,
    not merely dismissed;
  * the CSV format drift between 2025 and 2026 is recorded rather than normalised
    away, because a later gate must not mistake it for a real change.
"""

import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPORT = ROOT / "research" / "hospitality_commercial_gate" / "results" / "gate_a_identity_summary.json"

LOCALES = ["locales_2026_09", "locales_2026_08", "locales_2025_09"]
ACTIVIDADES = ["actividades_2026_09", "actividades_2026_08", "actividades_2025_09"]


class GateAIdentityReport(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = json.loads(REPORT.read_text(encoding="utf-8"))
        cls.snap = cls.report["per_snapshot"]

    def test_ruling_distinguishes_premises_classified_and_blank_epigraph(self):
        ruling = self.report["gate_a_ruling"]
        self.assertEqual(ruling["premises_identity"], "GO")
        self.assertEqual(ruling["classified_activity_identity"], "GO")
        self.assertEqual(ruling["blank_epigraph_activity_semantics"], "UNRESOLVED")
        self.assertIn("GO to Gate B", ruling["overall"])

    def test_id_local_is_a_premises_key_in_every_locales_snapshot(self):
        for key in LOCALES:
            ident = self.snap[key]["identity_id_local"]
            self.assertTrue(ident["unique_within_snapshot"], key)
            self.assertEqual(ident["blank"], 0, key)
            self.assertEqual(ident["distinct"], ident["total_rows"], key)

    def test_classified_activity_pair_is_a_key_in_every_actividades_snapshot(self):
        for key in ACTIVIDADES:
            pair = self.snap[key]["identity_activity_pair"]
            self.assertEqual(pair["field"], "(id_local, id_epigrafe)", key)
            self.assertTrue(pair["classified_unique_within_snapshot"], key)
            self.assertEqual(pair["distinct"], pair["total_rows"], key)
            # The classified subset is strictly smaller than the whole file when
            # blank-epigraph rows exist: total = classified + blank.
            self.assertEqual(
                pair["distinct_classified_pairs"] + pair["blank_epigrafe_rows"],
                pair["distinct"], key,
            )

    def test_blank_epigraph_rows_are_not_claimed_as_an_activity_identity(self):
        # The correction the reviewer required: blank id_epigrafe rows are deferred
        # to Gate B, not reinterpreted, bucketed or discarded, and never called a
        # known activity identity.
        pair = self.snap["actividades_2026_09"]["identity_activity_pair"]
        self.assertGreater(pair["blank_epigrafe_rows"], 0)
        semantics = pair["blank_epigraph_semantics"].lower()
        self.assertIn("unresolved", semantics)
        self.assertIn("gate b", semantics)
        self.assertIn("not", semantics)

    def test_aug_sep_direction_is_flagged_as_not_calendar_churn(self):
        for block in ("locales_aug_to_sep_2026", "actividades_aug_to_sep_2026"):
            caveat = self.report["persistence"][block]["direction_caveat"].lower()
            self.assertIn("direction", caveat)
            self.assertIn("inverted", caveat)

    def test_actividades_is_one_to_many_over_premises(self):
        # Premises identity and activity identity must be different keys: some
        # locals carry more than one activity, so id_local cannot be a row key here.
        for key in ACTIVIDADES:
            apl = self.snap[key]["activities_per_local"]
            self.assertGreater(apl["locals_with_more_than_one_activity"], 0, key)
            self.assertGreater(apl["max"], 1, key)

    def test_activity_universe_is_referentially_inside_the_premises_universe(self):
        # Where the same-month Locales file was available, no activity row may
        # reference a premises absent from it.
        for key in ("actividades_2026_09", "actividades_2026_08"):
            ri = self.snap[key].get("referential_integrity")
            self.assertIsNotNone(ri, key)
            self.assertEqual(ri["orphan_activity_rows_whose_id_local_absent_from_locales"], 0, key)

    def test_weaker_identities_are_recorded_as_non_unique(self):
        nc = self.snap["locales_2026_09"]["negative_controls"]
        self.assertGreater(nc["name_rotulo"]["blank_rows"], 0)
        self.assertGreater(nc["name_rotulo"]["max_rows_sharing_one_value"], 1)
        self.assertGreater(nc["address_id_ndp_edificio"]["addresses_with_more_than_one_local"], 0)
        self.assertGreater(nc["coordinates"]["max_locals_per_coordinate"], 1)

    def test_format_drift_between_years_is_recorded_not_normalised(self):
        y2025 = self.snap["locales_2025_09"]["dialect_observed"]
        y2026 = self.snap["locales_2026_09"]["dialect_observed"]
        # The finding: the 2025 file is unquoted, the 2026 file quotes every field,
        # yet the key persists across it (guarded by the persistence block below).
        self.assertFalse(y2025["header_fields_quoted"])
        self.assertTrue(y2026["header_fields_quoted"])
        self.assertEqual(y2025["delimiter"], ";")
        self.assertEqual(y2026["delimiter"], ";")

    def test_persistence_shows_a_stable_key_under_attribute_drift(self):
        p = self.report["persistence"]["locales_aug_to_sep_2026"]
        self.assertEqual(p["premises_key"], "id_local")
        # The crux of Gate A: persistent premises whose descriptive attributes
        # changed while the identifier held. Both facts must be represented.
        self.assertIn("persistent_locals_with_any_attribute_change", p)
        self.assertIsInstance(p["attribute_change_breakdown"], dict)
        control = self.report["persistence"]["locales_sep2025_to_sep2026_control"]
        self.assertEqual(control["premises_key"], "id_local")
        self.assertIn("survives", control["note"].lower())


if __name__ == "__main__":
    unittest.main()
