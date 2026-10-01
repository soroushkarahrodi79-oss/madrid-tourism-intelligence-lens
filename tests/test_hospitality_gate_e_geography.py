"""Contract tests for the committed hospitality Gate E geographic-reconciliation reports.

Network-free. These guard the *semantics* of the Gate E artifacts in
`research/hospitality_commercial_gate/results/`, not their exact counts: the counts are
observations of one audit run against live, re-publishable monthly snapshots and are
expected to move. What must not move is HOW Gate E reconciles source census geography to
Madrid's authoritative canonical district/barrio geography ACROSS THE DOCUMENTED 2017
administrative reorganisation, and the guard-rails that keep it honest.

Specifically guarded (the claims any later gate / implementation must rely on):

  * the four geographic evidence layers are named and kept separate; both the CURRENT
    (131) and the official HISTORICAL (1987, 128) authoritative geographies are recorded
    with provenance;
  * the 128->131 transition is recorded as a DOCUMENTED administrative reorganisation
    (2017), NOT 'cause unresolved' and NOT a mere source-coverage change;
  * the canonical entity key is ERA-AWARE: numeric barrio-code equality across the 2017
    break never establishes entity identity (historical 192 'Ambroz' is NOT current 192
    'Valdebernardo'); the entity-relationship classification carries REPLACED / NEW /
    LEGACY, not only cosmetic name variants;
  * the geography eras are determined from the OBSERVED source barrio set (not the
    calendar), with explicit Censo implementation breakpoints;
  * current 131/131 reconciliation remains GO and current hierarchy is consistent;
  * the 2015+ and 2014 barrio rulings are MODIFY (segmented), while district rulings stay
    GO and separate;
  * coordinate validation is MODIFY (strong agreement among usable points but ~25% have
    none), declares its CRS + explicit tolerance, and never snaps; historical
    point-in-polygon is NOT performed against current polygons;
  * population geography joinability is KEY-only against the CURRENT geography; no
    residents value is joined and no per-resident indicator is constructed (Gate F);
  * no tourism-pressure / saturation / economic verdict appears in any ruling label;
  * the methodology-document ruling agrees with the machine-readable ruling.
"""

import json
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
RESULTS = ROOT / "research" / "hospitality_commercial_gate" / "results"
SUMMARY = RESULTS / "gate_e_geography_summary.json"
CROSSWALK = RESULTS / "gate_e_geography_crosswalk.json"
QUALITY = RESULTS / "gate_e_geography_quality.json"
ERAS = RESULTS / "gate_e_geography_eras.json"
METHOD_DOC = ROOT / "docs" / "HOSPITALITY_COMMERCIAL_METHOD_GATE.md"
GEOJSON = ROOT / "data" / "geography" / "madrid_admin.geojson"

VALID_STATUSES = {
    "EXACT_CODE_MATCH", "EXACT_NAME_AND_DISTRICT_MATCH", "NORMALIZED_NAME_MATCH",
    "LEGACY_CODE_MAPPED", "AMBIGUOUS", "UNMATCHED", "GEOMETRY_CONFLICT",
    "GEOGRAPHY_MISSING",
}
VALID_RULINGS = {"GO", "MODIFY", "NO-GO"}
VALID_RELATIONSHIPS = {
    "SAME_ENTITY", "NAME_CHANGE_ONLY", "BOUNDARY_CHANGED", "SPLIT", "REPLACED",
    "NEW_ENTITY", "LEGACY_ENTITY", "UNRESOLVED",
}
FORBIDDEN_IN_LABELS = [
    "tourism pressure", "overtourism", "over-tourism", "saturation", "vitality",
    "visitor pressure", "gentrification", "displacement", "resident burden",
    "commercial health",
]


class GateEGeographyReports(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.summary = json.loads(SUMMARY.read_text(encoding="utf-8"))
        cls.crosswalk = json.loads(CROSSWALK.read_text(encoding="utf-8"))
        cls.quality = json.loads(QUALITY.read_text(encoding="utf-8"))
        cls.eras = json.loads(ERAS.read_text(encoding="utf-8"))
        cls.ruling = cls.summary["ruling"]

    def test_all_artifacts_present(self):
        for p in (SUMMARY, CROSSWALK, QUALITY, ERAS):
            self.assertTrue(p.exists(), p)
        self.assertGreater(len(self.crosswalk["rows"]), 0)

    # -- evidence layers + both authoritative geographies ------------------
    def test_four_evidence_layers_and_both_geographies(self):
        joined = " ".join(self.summary["evidence_layers_kept_separate"]).lower()
        for needle in ("source-record", "authoritative", "canonical", "reconciliation"):
            self.assertIn(needle, joined)
        g = self.summary["authoritative_canonical_geography"]
        self.assertTrue(g["provenance_established"])
        self.assertEqual(g["districts"], 21)
        self.assertEqual(g["barrios"], 131)
        h = self.summary["authoritative_historical_geography"]
        self.assertEqual(h["feature_count"], 128)
        self.assertIn("Madrid", h["authority"])
        self.assertTrue(h["sha256"])
        self.assertTrue(h["url"].startswith("http"))

    # -- 128 -> 131 is a DOCUMENTED 2017 reorganisation -------------------
    def test_128_to_131_is_documented_2017_reorganisation(self):
        block = self.summary["128_to_131"]
        self.assertEqual(block["cause"], "DOCUMENTED_ADMINISTRATIVE_REORGANISATION_2017")
        ev = block["evidence"].lower()
        self.assertIn("2017", ev)
        self.assertIn("vicalvaro", ev)
        self.assertIn("documented administrative change", ev)
        # must NOT be left unresolved, and a coverage gap must be explicitly denied
        self.assertNotIn("cause unresolved", ev)
        self.assertIn("not a source-coverage gap", ev)

    def test_ensanche_legal_instrument_is_recorded_not_open(self):
        # The Ensanche de Vallecas legal instrument is authoritative evidence, no longer an
        # open item; and its three dates are kept distinct from the Censo implementation.
        inst = self.summary["128_to_131"]["ensanche_de_vallecas_legal_instrument"]
        self.assertIn("31 de mayo de 2017", inst["acuerdo"])
        self.assertIn("7927", inst["boam_publication"])
        self.assertEqual(inst["censo_first_observed"], "Septiembre 2017")
        # the stale 'open item' key must be gone everywhere in the summary
        self.assertNotIn("remaining_open_question", json.dumps(self.summary))
        self.assertNotIn("is not stated in the v3.4.1 notes", json.dumps(self.summary))

    def test_three_date_types_kept_separate_both_reorganisations(self):
        d = self.summary["boundary_history"]["three_distinct_dates_not_collapsed"]
        for key in ("ensanche_de_vallecas_183", "vicalvaro_reorg_191_192_193_194"):
            self.assertIn("legal_decision", d[key])
            self.assertIn("boam_publication", d[key])
            self.assertIn("censo_first_observed", d[key])
        # the implementation date is explicitly NOT a legal effective date
        self.assertIn("not", d["caveat"].lower())
        self.assertIn("legal effective date", d["caveat"].lower())

    # -- era-aware key: code equality != entity identity ------------------
    def test_canonical_entity_key_is_era_aware(self):
        rule = self.crosswalk["canonical_entity_key_rule"].lower()
        self.assertIn("geography_era", rule)
        self.assertIn("not", rule)
        # every reconciled row's key is prefixed by its geography era
        for r in self.crosswalk["rows"]:
            key = r["canonical_entity_key"]
            if key:
                self.assertTrue(key.startswith(r["geography_era"] + ":"), r)

    def test_historical_192_ambroz_is_not_current_192_valdebernardo(self):
        keys192 = {}
        for r in self.crosswalk["rows"]:
            if r["decoded_code"] == "192":
                keys192[r["geography_era"]] = (r["canonical_entity_key"], r["target_barrio_name"])
        # the historical and current entities at code 192 must have DISTINCT keys/names
        self.assertIn("HISTORICAL_128", keys192)
        self.assertIn("CURRENT_131", keys192)
        self.assertNotEqual(keys192["HISTORICAL_128"][0], keys192["CURRENT_131"][0])
        self.assertIn("Ambroz", keys192["HISTORICAL_128"][1])
        self.assertIn("Valdebernardo", keys192["CURRENT_131"][1])

    def test_code_reuse_and_legacy_are_classified_not_cosmetic(self):
        rels = self.crosswalk["entity_relationships_1987_to_current"]
        by_code = rels["by_current_code"]
        self.assertEqual(by_code["192"]["relationship"], "REPLACED")
        # new barrios from the reorganisation
        for c in ("183", "193", "194"):
            self.assertEqual(by_code[c]["relationship"], "NEW_ENTITY", c)
        # old Ambroz is a legacy entity, not a cosmetic variant
        legacy = rels["legacy_historical_entities"]
        self.assertIn("192", legacy)
        self.assertIn("Ambroz", legacy["192"]["historical_name"])
        # the full relationship vocabulary is respected
        for v in by_code.values():
            self.assertIn(v["relationship"], VALID_RELATIONSHIPS)

    def test_boundary_changes_not_labelled_presentation_only(self):
        # at least one real BOUNDARY_CHANGED / REPLACED / NEW_ENTITY must exist: the 2017
        # change is NOT reducible to name normalization.
        rels = [v["relationship"] for v in
                self.crosswalk["entity_relationships_1987_to_current"]["by_current_code"].values()]
        self.assertTrue(any(r in ("BOUNDARY_CHANGED", "REPLACED", "NEW_ENTITY") for r in rels))

    # -- geography eras determined from data, with breakpoints ------------
    def test_geography_eras_determined_from_observed_data(self):
        bp = self.summary["geography_eras_and_breakpoints"]
        self.assertIn("observed", bp["method"].lower())
        self.assertIn("not", bp["method"].lower())
        # the Censo implementation breakpoints are stated (last historical, first current)
        self.assertTrue(bp["last_historical_128_observed"])
        self.assertTrue(bp["first_current_131_observed"])
        self.assertIn("vicalvaro_reorg_breakpoint", bp)
        # the 171 rename is noted as NOT implemented in the source (name lags code)
        self.assertIn("NOT implemented", bp["san_andres_171_rename"])

    def test_each_sentinel_carries_an_observed_era(self):
        for label, rec in self.summary["sentinels"].items():
            self.assertIn(rec["observed_geography_era"],
                          {"HISTORICAL_128", "TRANSITIONAL_129", "CURRENT_131"}, label)

    # -- current reconciliation remains GO, hierarchy consistent ----------
    def test_current_era_reconciliation_is_complete(self):
        cur = self.summary["current_era_reconciliation"]
        self.assertEqual(cur["hierarchy_conflicts"], 0)
        self.assertTrue(cur["all_131_reconciled_exactly"])
        self.assertEqual(self.ruling["current_barrio_reconciliation"], "GO")
        self.assertEqual(self.ruling["current_district_reconciliation"], "GO")

    def test_current_matches_are_code_based_to_current_geography(self):
        era = self.summary["current_era_reconciliation"]["era"]
        for r in self.crosswalk["rows"]:
            if r["source_era"] == era and r["canonical_entity_key"]:
                self.assertEqual(r["geography_era"], "CURRENT_131", r)
                self.assertEqual(r["reconciliation_method"], "ID_BARRIO_DECODE", r)

    # -- statuses from the declared vocabulary; unresolved stays visible --
    def test_statuses_from_vocabulary_and_unresolved_visible(self):
        for r in self.crosswalk["rows"]:
            self.assertIn(r["reconciliation_status"], VALID_STATUSES, r)
            if r["canonical_entity_key"] is None:
                self.assertIn(r["reconciliation_status"],
                              {"UNMATCHED", "AMBIGUOUS", "GEOMETRY_CONFLICT", "GEOGRAPHY_MISSING"}, r)
                self.assertTrue(r["evidence_note"])

    # -- 2014 not coerced into current codes ------------------------------
    def test_2014_reconciles_within_historical_not_current(self):
        rows14 = [r for r in self.crosswalk["rows"] if r["source_era"] == "Septiembre 2014"]
        self.assertTrue(rows14)
        for r in rows14:
            if r["canonical_entity_key"]:
                self.assertEqual(r["geography_era"], "HISTORICAL_128", r)
        # code 192 in 2014 resolves to historical Ambroz, never current Valdebernardo
        r192 = [r for r in rows14 if r["decoded_code"] == "192"]
        self.assertTrue(r192)
        self.assertIn("Ambroz", r192[0]["target_barrio_name"])

    # -- segmented barrio rulings, separate district ruling ---------------
    def test_barrio_rulings_segmented_district_separate(self):
        self.assertEqual(self.ruling["era_2015plus_barrio_compatibility"], "MODIFY")
        self.assertEqual(self.ruling["era_2014_barrio_compatibility"], "MODIFY")
        self.assertEqual(self.ruling["era_2015plus_district_compatibility"], "GO")
        self.assertEqual(self.ruling["era_2014_district_compatibility"], "GO")
        # the MODIFY basis must cite the 2017 segmentation, not a cosmetic reason
        basis = self.ruling["ruling_bases"]["era_2015plus_barrio"].lower()
        self.assertIn("2017", basis)
        self.assertIn("segment", basis)

    # -- coordinate validation MODIFY, CRS + tolerance, no snap -----------
    def test_coordinate_validation_is_modify_with_explicit_crs_tolerance(self):
        self.assertEqual(self.ruling["coordinate_validation"], "MODIFY")
        pip = self.summary["point_in_polygon"]
        self.assertIn("EPSG:25830", pip["crs_source_empirical"])
        self.assertIn("empirical", pip["crs_source_empirical"].lower())
        self.assertIsInstance(pip["boundary_tolerance_m"], (int, float))
        self.assertIn("no snapping", pip["transform"].lower())

    def test_historical_pip_not_done_against_current_polygons(self):
        pip = self.summary["point_in_polygon"]
        self.assertIn("CURRENT", pip["scope"])
        self.assertIn("NOT_PERFORMED", pip["historical_point_in_polygon"])
        self.assertIn("never against current", pip["historical_point_in_polygon"].lower())

    def test_coordinate_availability_and_pip_agreement_are_distinct(self):
        # These are two DIFFERENT concepts and must be reported as separate fields: a
        # coverage rate (availability) and a correctness rate conditional on usable coords
        # (PiP agreement). The high agreement must never be presented as an availability.
        pip = self.summary["point_in_polygon"]
        av = pip["coordinate_availability"]
        ag = pip["point_in_polygon_agreement"]
        # availability ~ 75% usable / ~25% unusable
        self.assertEqual(av["total_premises"], av["usable_coordinates"] + av["unusable_zero_sentinel"])
        self.assertLess(av["availability_rate"], 0.9)        # roughly 0.75
        self.assertGreater(av["availability_rate"], 0.6)
        self.assertLess(av["unusable_share"], 0.4)           # roughly 0.25
        self.assertGreater(av["unusable_share"], 0.1)
        # agreement is CONDITIONAL and ~0.9998 - and is a different number from availability
        self.assertGreater(ag["agreement_rate_conditional_on_usable"], 0.99)
        self.assertEqual(ag["points_tested"], av["usable_coordinates"])
        self.assertNotAlmostEqual(ag["agreement_rate_conditional_on_usable"],
                                  av["availability_rate"], places=2)
        self.assertIn("conditional", ag["basis"].lower())
        # nowhere does the artifact imply the agreement rate is an availability/lack rate
        blob = json.dumps(self.summary).lower()
        self.assertNotIn("99.978% lack", blob)
        self.assertNotIn("99.978 lack", blob)
        self.assertNotIn("99.978% of premises have no", blob)

    # -- boundary history: documented change, three dates kept apart ------
    def test_boundary_history_documents_change(self):
        bh = self.summary["boundary_history"]
        self.assertIn("documented", bh["finding"].lower())
        self.assertIn("2017", bh["finding"])
        self.assertTrue(bh["historical_polygons_available"])
        d = bh["three_distinct_dates_not_collapsed"]
        self.assertIn("current_geometry_effective_period", d)
        # the per-change three-date breakdown is covered by
        # test_three_date_types_kept_separate_both_reorganisations

    # -- population: key-only against CURRENT geography -------------------
    def test_population_key_joinability_only(self):
        pj = self.summary["population_geography_joinability"]
        self.assertIn("No population value is joined", pj["note"])
        self.assertIn("CURRENT", pj["scope"])
        self.assertEqual(self.ruling["population_geography_joinability"], "GO")
        blob = json.dumps(self.summary).lower()
        for term in ("per_capita", "per_resident", "premises_per_"):
            self.assertNotIn(term, blob)

    # -- no forbidden terms in ruling labels -----------------------------
    def test_no_forbidden_terms_in_ruling_labels(self):
        blob = " ".join(f"{k} {v}" for k, v in self.ruling.items()
                        if k not in ("notes", "ruling_bases")).lower()
        for term in FORBIDDEN_IN_LABELS:
            self.assertNotIn(term, blob, term)

    def test_ruling_scoped_overall_go_to_gate_f(self):
        self.assertIn("Gate F", self.ruling["overall"])
        self.assertIn("GO", self.ruling["overall"])
        for k, v in self.ruling.items():
            if k in ("overall", "point_in_polygon_agreement_rate", "ruling_bases", "notes"):
                continue
            self.assertIn(v, VALID_RULINGS, f"{k}={v}")

    # -- no raw CSV committed --------------------------------------------
    def test_no_raw_csv_committed(self):
        research = ROOT / "research" / "hospitality_commercial_gate"
        for p in research.rglob("*.csv"):
            self.fail(f"raw CSV committed: {p}")
        for p in RESULTS.glob("gate_e_*.json"):
            for m in re.finditer(r'"([^"]+\.csv)"', p.read_text(encoding="utf-8")):
                self.assertRegex(m.group(1), r"^https?://", f"local csv ref in {p.name}")

    # -- methodology doc agrees with machine ruling ----------------------
    def test_methodology_ruling_agrees_with_machine_output(self):
        text = METHOD_DOC.read_text(encoding="utf-8")
        self.assertIn("Gate E", text)
        self.assertRegex(text, r"[Cc]urrent barrio reconciliation.{0,80}GO")
        self.assertRegex(text, r"2015\+ barrio.{0,120}MODIFY")
        self.assertRegex(text, r"2014 barrio.{0,120}MODIFY")
        self.assertRegex(text, r"[Cc]oordinate validation.{0,80}MODIFY")
        self.assertRegex(text, r"[Oo]verall Gate E.{0,80}GO to Gate F")
        # the documented 2017 reorganisation and the Ambroz/Valdebernardo code reuse
        self.assertRegex(text, r"2017")
        self.assertRegex(text, r"[Aa]mbroz")
        self.assertRegex(text, r"[Vv]aldebernardo")


if __name__ == "__main__":
    unittest.main()
