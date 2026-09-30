"""Contract tests for the committed hospitality Gate B taxonomy report.

Network-free. These guard the *semantics* of
`research/hospitality_commercial_gate/results/gate_b_taxonomy.json`, not its counts:
the counts are observations of one audit run against live monthly snapshots and are
expected to move when the source publishes new months. What must not move is the
classification model the report asserts and the traps it records.

The specific claims guarded here are the ones Gate C (and any later implementation)
must be able to rely on:

  * every populated epigraph receives exactly one class, drawn from the declared set;
  * the class an epigraph gets agrees with the methodology ruling (core hospitality is
    CNAE division 56, accommodation is 55, tourism-adjacent is 79, generic commercial
    is section G, the ambiguous set is section R) — the machine-readable mapping and
    the prose ruling cannot drift apart;
  * accommodation is a class distinct from core hospitality;
  * ambiguous codes stay explicitly ambiguous and out of the hospitality classes;
  * the blank-epigraph rows are labelled UNCLASSIFIED_SOURCE_ACTIVITY and are never
    given one of the activity classes, nor treated as an activity identity;
  * no class or ruling text is a "tourism pressure" / "overtourism" style claim;
  * the observed hierarchy is clean (no epigraph maps to two parents), which is what
    makes the division-based classification safe;
  * the classes partition the populated universe exactly (an internal-consistency
    contract that holds for any run, not a frozen count).
"""

import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPORT = ROOT / "research" / "hospitality_commercial_gate" / "results" / "gate_b_taxonomy.json"

ACTIVITY_CLASSES = {
    "CORE_HOSPITALITY", "ACCOMMODATION", "TOURISM_ADJACENT",
    "GENERIC_COMMERCIAL", "EXCLUDED", "AMBIGUOUS",
}
FORBIDDEN_SUBSTRINGS = [
    "tourism pressure", "overtourism", "over-tourism", "saturation",
    "commercial vitality", "hospitality pressure", "visitor pressure",
    "hotspot", "overtourism claim",
]


class GateBTaxonomyReport(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = json.loads(REPORT.read_text(encoding="utf-8"))
        cls.epigraphs = cls.report["epigraphs"]
        cls.obs = cls.report["observed_taxonomy"]
        cls.rollup = cls.report["class_rollup"]

    def test_every_populated_epigraph_has_exactly_one_declared_class(self):
        seen = {}
        for rec in self.epigraphs:
            code = rec["id_epigrafe"]
            self.assertTrue(code, "epigraph record with a blank code must not exist")
            self.assertIn(rec["assigned_class"], ACTIVITY_CLASSES, code)
            # A code cannot appear twice with two different classes.
            if code in seen:
                self.assertEqual(seen[code], rec["assigned_class"], code)
            seen[code] = rec["assigned_class"]
        self.assertEqual(len(seen), self.obs["distinct_populated_epigraphs"])

    def test_class_assignment_agrees_with_the_methodology_ruling(self):
        # The machine-readable mapping must match the prose ruling: the class is a
        # function of the official CNAE division/section, not the description.
        for rec in self.epigraphs:
            div, sec, cls = rec["id_division"], rec["id_seccion"], rec["assigned_class"]
            if div == "56":
                self.assertEqual(cls, "CORE_HOSPITALITY", rec["id_epigrafe"])
            elif div == "55":
                self.assertEqual(cls, "ACCOMMODATION", rec["id_epigrafe"])
            elif div == "79":
                self.assertEqual(cls, "TOURISM_ADJACENT", rec["id_epigrafe"])
            elif sec == "G":
                self.assertEqual(cls, "GENERIC_COMMERCIAL", rec["id_epigrafe"])
            elif sec == "R":
                self.assertEqual(cls, "AMBIGUOUS", rec["id_epigrafe"])
            else:
                self.assertEqual(cls, "EXCLUDED", rec["id_epigrafe"])

    def test_accommodation_is_a_class_distinct_from_core_hospitality(self):
        core = [r for r in self.epigraphs if r["assigned_class"] == "CORE_HOSPITALITY"]
        acc = [r for r in self.epigraphs if r["assigned_class"] == "ACCOMMODATION"]
        self.assertTrue(core)
        self.assertTrue(acc)
        self.assertTrue(all(r["id_division"] == "56" for r in core))
        self.assertTrue(all(r["id_division"] == "55" for r in acc))
        ruling = self.report["gate_b_ruling"]
        self.assertEqual(ruling["core_hospitality_restoration"], "GO")
        self.assertEqual(ruling["accommodation"], "GO")

    def test_ambiguous_codes_stay_ambiguous_and_out_of_hospitality(self):
        amb = [r for r in self.epigraphs if r["assigned_class"] == "AMBIGUOUS"]
        self.assertTrue(amb, "the ambiguous class must not be empty")
        for r in amb:
            self.assertTrue(r["ambiguous"])
            self.assertEqual(r["status"], "AMBIGUOUS")
            self.assertNotEqual(r["assigned_class"], "CORE_HOSPITALITY")
            self.assertNotEqual(r["assigned_class"], "ACCOMMODATION")

    def test_blank_epigraph_is_unclassified_and_never_an_activity(self):
        blank = self.report["blank_epigraph"]
        self.assertEqual(blank["label"], "UNCLASSIFIED_SOURCE_ACTIVITY")
        # It must not be quietly folded into any activity class.
        self.assertNotIn(blank["label"], ACTIVITY_CLASSES)
        # No populated-epigraph record may carry the unclassified label.
        self.assertFalse(any(r["assigned_class"] == "UNCLASSIFIED_SOURCE_ACTIVITY"
                             for r in self.epigraphs))
        semantics = blank["semantics"].lower()
        self.assertIn("not an activity", semantics)
        self.assertIn("(id_local, '')", semantics)
        self.assertIn("not", semantics)
        # It is characterised, not discarded: the profile fields must be present.
        for field in ("rows", "distinct_locals", "rows_with_entire_taxonomy_blank",
                      "locals_blank_only_no_populated", "situacion_dist"):
            self.assertIn(field, blank)

    def test_no_class_is_named_a_pressure_style_claim(self):
        # "No class named 'tourism pressure'/'overtourism'/..." is a guard on the
        # class *labels*, not on prose: a disclaimer is allowed to name a forbidden
        # term in order to forbid it. So the scan runs over the structured labels -
        # class names, the assignment maps, and every epigraph's class/status.
        labels = set(self.report["classification_framework"]["classes"])
        labels.update(self.report["classification_framework"]["section_default"].values())
        labels.update(self.report["classification_framework"]["division_override"].values())
        for rec in self.epigraphs:
            labels.add(rec["assigned_class"])
            labels.add(rec["status"])
        labels.add(self.report["blank_epigraph"]["label"])
        blob = " ".join(l.lower() for l in labels)
        for bad in FORBIDDEN_SUBSTRINGS:
            self.assertNotIn(bad, blob, bad)
        # And the class set must be exactly the safe, declared set.
        self.assertEqual(set(self.report["classification_framework"]["classes"]),
                         ACTIVITY_CLASSES)

    def test_hierarchy_is_clean_no_epigraph_maps_to_two_parents(self):
        self.assertEqual(self.obs["epigraph_multi_parent_count"], 0)
        self.assertEqual(self.obs["epigraph_multi_parent"], {})

    def test_classes_partition_the_populated_universe_exactly(self):
        # An internal-consistency contract that must hold for ANY run, not a frozen
        # count: the six classes together cover every populated epigraph and row.
        epi_sum = sum(self.rollup[c]["distinct_epigraphs"] for c in ACTIVITY_CLASSES)
        row_sum = sum(self.rollup[c]["source_rows"] for c in ACTIVITY_CLASSES)
        self.assertEqual(epi_sum, self.obs["distinct_populated_epigraphs"])
        self.assertEqual(row_sum, self.obs["rows_populated_epigraph"])
        self.assertEqual(len(self.epigraphs), self.obs["distinct_populated_epigraphs"])

    def test_drift_block_records_the_required_comparisons(self):
        drift = self.report["drift_control_vs_primary"]
        for field in ("epigraphs_in_both", "epigraphs_new_in_primary",
                      "epigraphs_disappeared_from_control",
                      "same_code_changed_description",
                      "same_code_changed_section_or_division",
                      "blank_share_control", "blank_share_primary"):
            self.assertIn(field, drift)
        # Stability, not trend: the drift note must disclaim a trend claim.
        self.assertIn("stability", drift["note"].lower())

    def test_ruling_is_scoped_not_a_blanket_go(self):
        ruling = self.report["gate_b_ruling"]
        for key in ("core_hospitality_restoration", "accommodation",
                    "tourism_adjacent_commercial_context", "generic_commercial_context",
                    "blank_epigraph_semantics", "overall"):
            self.assertIn(key, ruling)
        # Tourism-adjacent must be scoped (division 79 only), not an unconditional GO.
        self.assertIn("79", ruling["tourism_adjacent_commercial_context"])
        # The overall GO must carry a scope limitation forbidding indicators/scores.
        limit = ruling["scope_limitation"].lower()
        self.assertIn("no indicator", limit)


if __name__ == "__main__":
    unittest.main()
