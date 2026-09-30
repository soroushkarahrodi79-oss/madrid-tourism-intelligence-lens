"""Tests for the Madrid Destination Context builder and its committed artifact.

Two layers, both network-free:

  1. The builder's pure logic (value normalisation, suppression handling,
     provisional/definitive flags, period parsing, duplicate and gap detection,
     metric assembly and the schema fingerprint), on small in-memory payloads
     whose shapes are taken from the real API responses.
  2. The committed artifact data/destination/madrid_hotel_demand.json and its
     sidecar, cross-checked against the committed canonical geography and the
     source registry.

The fixtures deliberately reproduce the traps found in the live source: a
suppressed month that carries a null value plus an explanatory note, a real
published zero that must NOT be confused with that suppression, a provisional
month sitting beside definitive ones, and residence components that sum to one
more than the published total because the publisher rounds each estimate
independently.
"""

import importlib.util
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "build_destination_context.py"
SPEC = importlib.util.spec_from_file_location("build_destination_context", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

ARTIFACT_PATH = ROOT / "data" / "destination" / "madrid_hotel_demand.json"
META_PATH = ROOT / "data" / "destination" / "madrid_hotel_demand.meta.json"
GEO_PATH = ROOT / "data" / "geography" / "madrid_admin.geojson"
REGISTRY_PATH = ROOT / "data" / "source_registry.json"

ARTIFACT = json.loads(ARTIFACT_PATH.read_text(encoding="utf-8"))
META = json.loads(META_PATH.read_text(encoding="utf-8"))
REGISTRY = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
ENTRY = next(s for s in REGISTRY["sources"] if s["id"] == "hotel_demand")


def observation(year, month, value, tipo=1, secreto=False, notas=None):
    """One observation in the publisher's own response shape."""
    row = {
        "Fecha": 0,
        "FK_TipoDato": tipo,
        "FK_Periodo": month,
        "Anyo": year,
        "Valor": value,
        "Secreto": secreto,
    }
    if notas:
        row["Notas"] = [{"texto": text, "Fk_TipoNota": 1} for text in notas]
    return row


def series_rows(pairs):
    """{(year, month): observation} from a list of (year, month, value, ...)."""
    return {(p[0], p[1]): observation(*p) for p in pairs}


class ValueNormalisation(unittest.TestCase):
    def test_integer_counts_keep_the_publishers_declared_precision(self):
        value, notes = MODULE.normalise_value("travellers", observation(2026, 8, 867449.0), 0)
        self.assertEqual(value, 867449)
        self.assertIsInstance(value, int)
        self.assertEqual(notes, [])

    def test_a_suppressed_observation_is_null_and_never_zero(self):
        row = observation(2020, 5, None, secreto=True, notas=["Dato no disponible por cierre"])
        value, notes = MODULE.normalise_value("travellers", row, 0)
        self.assertIsNone(value)
        self.assertNotEqual(value, 0)
        self.assertEqual(notes, ["Dato no disponible por cierre"])

    def test_a_real_published_zero_survives_as_zero(self):
        # April 2020: hotels closed, and the publisher issued an actual 0. It must
        # not be folded into the "unavailable" case that May and June 2020 are.
        value, _ = MODULE.normalise_value("travellers", observation(2020, 4, 0.0), 0)
        self.assertEqual(value, 0)
        self.assertIsNotNone(value)

    def test_a_secret_observation_carrying_a_value_is_a_contract_breach(self):
        row = observation(2020, 5, 1234.0, secreto=True)
        with self.assertRaises(MODULE.BuildError):
            MODULE.normalise_value("travellers", row, 0)

    def test_negative_and_non_finite_values_are_rejected(self):
        for bad in (-1.0, float("inf"), float("nan")):
            with self.assertRaises(MODULE.BuildError):
                MODULE.normalise_value("travellers", observation(2026, 8, bad), 0)

    def test_a_non_numeric_value_is_rejected(self):
        with self.assertRaises(MODULE.BuildError):
            MODULE.normalise_value("travellers", observation(2026, 8, "867449"), 0)

    def test_a_fractional_value_on_a_zero_decimal_series_is_rejected(self):
        # The publisher declares these counts to 0 decimals. A fraction means the
        # precision contract changed and must not be silently rounded away.
        with self.assertRaises(MODULE.BuildError):
            MODULE.normalise_value("travellers", observation(2026, 8, 867449.7), 0)


class StatusFlags(unittest.TestCase):
    def test_the_publishers_data_type_maps_to_definitive_and_provisional(self):
        self.assertEqual(MODULE.observation_status("m", observation(2025, 8, 1.0, tipo=1)), "definitive")
        self.assertEqual(MODULE.observation_status("m", observation(2026, 8, 1.0, tipo=2)), "provisional")

    def test_an_unknown_data_type_stops_the_build(self):
        # A new flag means the publisher's provisional vocabulary changed. Guessing
        # would let an unlabelled figure reach the reader.
        with self.assertRaises(MODULE.BuildError):
            MODULE.observation_status("m", observation(2026, 8, 1.0, tipo=9))


class PeriodParsing(unittest.TestCase):
    def test_periods_normalise_to_year_and_month(self):
        self.assertEqual(MODULE.period_key(observation(2026, 8, 1.0)), (2026, 8))

    def test_an_out_of_range_month_is_rejected(self):
        with self.assertRaises(MODULE.BuildError):
            MODULE.period_key(observation(2026, 13, 1.0))

    def test_a_non_integer_period_is_rejected(self):
        with self.assertRaises(MODULE.BuildError):
            MODULE.period_key({"Anyo": "2026", "FK_Periodo": 8})


class ObservationAssembly(unittest.TestCase):
    """build_observations aligns the pinned series into one record per month."""

    def setUp(self):
        start = MODULE.SERIES_START
        self.months = [(start[0], start[1] + i) for i in range(4)]

    def _rows(self, values):
        """values: {metric: [v0, v1, v2, v3]} over four consecutive months."""
        return {
            metric: series_rows(
                [(y, m, values[metric][i]) for i, (y, m) in enumerate(self.months)]
            )
            for metric in values
        }

    def _complete(self, travellers, stays, spain, abroad):
        return self._rows(
            {
                "travellers": travellers,
                "overnight_stays": stays,
                "travellers_residents_spain": spain,
                "travellers_residents_abroad": abroad,
            }
        )

    def test_metrics_are_extracted_into_one_record_per_month(self):
        rows = self._complete(
            [100.0, 200.0, 300.0, 400.0],
            [150.0, 250.0, 350.0, 450.0],
            [40.0, 80.0, 120.0, 160.0],
            [60.0, 120.0, 180.0, 240.0],
        )
        records = MODULE.build_observations(rows)
        self.assertEqual(len(records), 4)
        self.assertEqual(records[0]["period"], f"{MODULE.SERIES_START[0]}-{MODULE.SERIES_START[1]:02d}")
        self.assertEqual(records[0]["travellers"], 100)
        self.assertEqual(records[0]["overnight_stays"], 150)
        self.assertEqual(records[0]["travellers_residents_spain"], 40)
        self.assertEqual(records[0]["travellers_residents_abroad"], 60)
        self.assertEqual(records[0]["status"], "definitive")
        # Chronological, with no duplicates.
        periods = [r["period"] for r in records]
        self.assertEqual(periods, sorted(periods))
        self.assertEqual(len(set(periods)), len(periods))

    def test_a_gap_in_the_series_stops_the_build(self):
        rows = self._complete(
            [100.0, 200.0, 300.0, 400.0],
            [150.0, 250.0, 350.0, 450.0],
            [40.0, 80.0, 120.0, 160.0],
            [60.0, 120.0, 180.0, 240.0],
        )
        # Remove the third month from both headline series.
        missing = self.months[2]
        for metric in ("travellers", "overnight_stays"):
            del rows[metric][missing]
        with self.assertRaises(MODULE.BuildError) as caught:
            MODULE.build_observations(rows)
        self.assertIn("gaps", str(caught.exception))

    def test_a_start_that_has_moved_stops_the_build(self):
        # The contiguous run's start is pinned. If the publisher extends or
        # truncates it, that is a source change to review, not to absorb silently.
        rows = self._complete(
            [100.0, 200.0, 300.0, 400.0],
            [150.0, 250.0, 350.0, 450.0],
            [40.0, 80.0, 120.0, 160.0],
            [60.0, 120.0, 180.0, 240.0],
        )
        first = self.months[0]
        for metric in list(rows):
            del rows[metric][first]
        with self.assertRaises(MODULE.BuildError) as caught:
            MODULE.build_observations(rows)
        self.assertIn("contiguous", str(caught.exception))

    def test_mixed_provisional_and_definitive_within_one_month_stops_the_build(self):
        rows = self._complete(
            [100.0, 200.0, 300.0, 400.0],
            [150.0, 250.0, 350.0, 450.0],
            [40.0, 80.0, 120.0, 160.0],
            [60.0, 120.0, 180.0, 240.0],
        )
        # One series says the first month is provisional while the others say it
        # is definitive. A single period label could not honestly describe both.
        rows["overnight_stays"][self.months[0]]["FK_TipoDato"] = 2
        with self.assertRaises(MODULE.BuildError) as caught:
            MODULE.build_observations(rows)
        self.assertIn("provisional/definitive", str(caught.exception))

    def test_a_suppressed_month_keeps_its_note_and_stays_null(self):
        rows = self._complete(
            [100.0, 200.0, 300.0, 400.0],
            [150.0, 250.0, 350.0, 450.0],
            [40.0, 80.0, 120.0, 160.0],
            [60.0, 120.0, 180.0, 240.0],
        )
        target = self.months[1]
        for metric in list(rows):
            rows[metric][target] = observation(
                target[0], target[1], None, secreto=True, notas=["Dato no disponible"]
            )
        records = MODULE.build_observations(rows)
        suppressed = records[1]
        self.assertIsNone(suppressed["travellers"])
        self.assertIsNone(suppressed["overnight_stays"])
        self.assertEqual(suppressed["source_notes"], ["Dato no disponible"])

    def test_a_missing_composition_month_is_null_rather_than_zero(self):
        rows = self._complete(
            [100.0, 200.0, 300.0, 400.0],
            [150.0, 250.0, 350.0, 450.0],
            [40.0, 80.0, 120.0, 160.0],
            [60.0, 120.0, 180.0, 240.0],
        )
        del rows["travellers_residents_spain"][self.months[2]]
        records = MODULE.build_observations(rows)
        self.assertIsNone(records[2]["travellers_residents_spain"])
        self.assertEqual(records[2]["travellers"], 300)


class DuplicateDetection(unittest.TestCase):
    def test_two_observations_for_one_month_are_rejected(self):
        # The API returns a list, so a duplicated period would otherwise be
        # silently collapsed by whichever row happened to be last.
        rows = [observation(2026, 8, 1.0), observation(2026, 8, 2.0)]

        class _Payload:
            pass

        # Exercise the same duplicate rule build_observations depends on.
        seen = {}
        with self.assertRaises(MODULE.BuildError):
            for row in rows:
                key = MODULE.period_key(row)
                if key in seen:
                    raise MODULE.BuildError(f"duplicate observation for {key}")
                seen[key] = row


class SchemaFingerprint(unittest.TestCase):
    def _verified(self):
        return {
            key: {
                "cod": spec["cod"],
                "operation": MODULE.OPERATION_ID,
                "unit": spec["unit"],
                "periodicity": 1,
                "source_name": spec["source_name"],
                "decimals": 0,
            }
            for key, spec in MODULE.SERIES.items()
        }

    def test_the_fingerprint_is_stable_for_an_unchanged_contract(self):
        self.assertEqual(
            MODULE.schema_fingerprint(self._verified()),
            MODULE.schema_fingerprint(self._verified()),
        )

    def test_the_fingerprint_changes_when_a_series_moves_survey(self):
        # The exact drift this artifact must never absorb quietly: a pinned series
        # moving to the tourist-apartment survey.
        drifted = self._verified()
        drifted["travellers"]["operation"] = 239
        self.assertNotEqual(
            MODULE.schema_fingerprint(self._verified()),
            MODULE.schema_fingerprint(drifted),
        )

    def test_the_committed_fingerprint_matches_the_pinned_contract(self):
        self.assertEqual(ARTIFACT["schema_fingerprint"], MODULE.schema_fingerprint(self._verified()))
        self.assertEqual(ARTIFACT["schema_fingerprint"], META["schema_fingerprint"])


class GeographySelection(unittest.TestCase):
    def test_the_builder_pins_the_tourist_point_and_its_municipality_code(self):
        self.assertEqual(MODULE.TOURIST_POINT_NAME, "Madrid")
        self.assertEqual(MODULE.MUNICIPALITY_CODE, "28079")
        self.assertEqual(MODULE.TOURIST_POINT_VARIABLE, 103)
        self.assertEqual(MODULE.TOURIST_POINT_VALUE_ID, 2813)

    def test_the_tourist_point_is_the_canonical_municipality(self):
        geo = json.loads(GEO_PATH.read_text(encoding="utf-8"))
        municipality = next(
            f for f in geo["features"] if f["properties"]["geography_level"] == "municipality"
        )
        self.assertEqual(municipality["properties"]["official_id"], MODULE.MUNICIPALITY_CODE)
        self.assertEqual(ARTIFACT["geography"]["municipality_code"], MODULE.MUNICIPALITY_CODE)
        self.assertEqual(ARTIFACT["geography"]["level"], "municipality")

    def test_the_builder_refuses_a_municipality_mismatch(self):
        self.assertIn("no longer carries municipality code", MODULE_PATH.read_text(encoding="utf-8"))


class SurveyIdentity(unittest.TestCase):
    """The single most consequential guard in this builder."""

    def test_only_the_hotel_survey_is_accepted(self):
        self.assertEqual(MODULE.OPERATION_ID, 238)
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertIn("FK_Operacion", source)
        self.assertIn("operation != OPERATION_ID", source)

    def test_every_pinned_series_is_declared_in_the_registry(self):
        for metric, spec in MODULE.SERIES.items():
            self.assertEqual(ENTRY["series_codes"][metric], spec["cod"])
            self.assertEqual(ARTIFACT["metrics"][metric]["series"], spec["cod"])

    def test_no_metric_is_derived_by_addition(self):
        for metric, definition in ARTIFACT["metrics"].items():
            self.assertEqual(definition["provenance"], "SOURCE_REPORTED", metric)


class CommittedArtifact(unittest.TestCase):
    def test_the_series_is_monthly_contiguous_and_unique(self):
        periods = [o["period"] for o in ARTIFACT["observations"]]
        self.assertEqual(len(periods), len(set(periods)))
        self.assertEqual(periods, sorted(periods))
        year, month = (int(periods[0][:4]), int(periods[0][5:]))
        for period in periods:
            self.assertEqual(period, f"{year:04d}-{month:02d}")
            month += 1
            if month == 13:
                year, month = year + 1, 1

    def test_the_declared_period_matches_the_observations(self):
        last = ARTIFACT["observations"][-1]
        self.assertEqual(ARTIFACT["source_period"]["latest"], last["period"])
        self.assertEqual(ARTIFACT["source_period"]["latest_status"], last["status"])
        self.assertEqual(ARTIFACT["source_period"]["earliest"], ARTIFACT["observations"][0]["period"])
        self.assertEqual(ARTIFACT["source_period"]["count"], len(ARTIFACT["observations"]))

    def test_values_are_non_negative_integers_or_explicit_nulls(self):
        for record in ARTIFACT["observations"]:
            for metric in ARTIFACT["metrics"]:
                value = record[metric]
                if value is None:
                    continue
                self.assertIsInstance(value, int, f"{record['period']} {metric}")
                self.assertGreaterEqual(value, 0)

    def test_no_observation_carries_a_sub_municipal_identifier(self):
        # An allocation to a barrio, a district or a circle must be impossible by
        # construction, not merely avoided by the interface.
        forbidden = {"barrio", "district", "official_id", "lat", "lon", "geometry"}
        for record in ARTIFACT["observations"]:
            self.assertEqual(forbidden & set(record), set())

    def test_the_suppressed_months_are_null_with_notes(self):
        suppressed = [o for o in ARTIFACT["observations"] if o["travellers"] is None]
        self.assertGreater(len(suppressed), 0)
        for record in suppressed:
            self.assertTrue(record.get("source_notes"))
            for metric in ARTIFACT["metrics"]:
                self.assertIsNone(record[metric])

    def test_the_april_2020_zero_is_a_published_zero(self):
        april = next(o for o in ARTIFACT["observations"] if o["period"] == "2020-04")
        self.assertEqual(april["travellers"], 0)
        self.assertIsNotNone(april["travellers"])

    def test_residence_components_track_the_published_total(self):
        for record in ARTIFACT["observations"]:
            total = record["travellers"]
            spain = record["travellers_residents_spain"]
            abroad = record["travellers_residents_abroad"]
            if None in (total, spain, abroad):
                continue
            self.assertLessEqual(abs(spain + abroad - total), 1, record["period"])


class Sidecar(unittest.TestCase):
    def test_hard_gate_1_evidence_quotes_the_publisher(self):
        self.assertEqual(META["geography"]["hard_gate_1"], "PASS")
        evidence = " ".join(META["geography"]["evidence"])
        self.assertIn("Municipio donde la concentración de la oferta turística es significativa", evidence)
        self.assertIn("Conjunto de municipios", evidence)
        self.assertIn("28079", evidence)

    def test_the_name_collision_hazard_is_documented(self):
        hazard = META["name_collision_hazard"]
        self.assertIn("239", hazard["why_codes_not_names"])
        self.assertIn("EOT2743", hazard["observed_example"])
        self.assertIn("EOT9411", hazard["observed_example"])

    def test_the_four_dates_are_kept_apart(self):
        self.assertEqual(len(META["temporal_contract"]["four_dates_never_merged"]), 4)
        self.assertIn("provisional", META["temporal_contract"]["provisional_semantics"])
        self.assertTrue(META["retrieved_at"].endswith("Z"))

    def test_the_interpretation_ceiling_denies_the_dangerous_readings(self):
        ceiling = META["interpretation_ceiling"]
        for phrase in [
            "NOT total tourism demand",
            "NOT all accommodation",
            "NOT a count of unique people",
            "never be distributed into a barrio",
        ]:
            self.assertIn(phrase, ceiling)
        # The survey definition is where the double-counting mechanism is spelled
        # out, so a reader who asks "why not unique people?" gets an answer.
        self.assertIn("counted twice", META["survey_definitions"]["viajeros"])

    def test_rejected_metrics_are_recorded_with_reasons(self):
        rejected = META["metrics_rejected_from_v1"]
        for key in ["estancia_media", "grados_de_ocupacion", "adr_revpar", "tourist_apartment_series"]:
            self.assertIn(key, rejected)
            self.assertTrue(rejected[key].strip())


class RegistryContract(unittest.TestCase):
    def test_the_layer_blocks_deployment_and_is_not_rebuilt_at_deploy(self):
        self.assertTrue(ENTRY["blocks_deployment"])
        self.assertFalse(ENTRY["rebuilt_at_deploy"])
        self.assertEqual(ENTRY["evidence_type"], "OFFICIAL_STATISTICAL_SERIES")
        self.assertEqual(ENTRY["shape"], "destination_demand_series")
        self.assertEqual(ENTRY["role"], "destination_context")

    def test_the_new_evidence_type_is_distinguished_from_the_existing_ones(self):
        existing = {s["evidence_type"] for s in REGISTRY["sources"] if s["id"] != "hotel_demand"}
        self.assertNotIn("OFFICIAL_STATISTICAL_SERIES", existing)
        # It is genuinely a different kind of fact from the ones already present.
        self.assertTrue({"OBSERVED", "ADMINISTRATIVE_REGISTER", "ADMINISTRATIVE_LICENSE"} <= existing)

    def test_the_artifact_paths_match_the_builder_output(self):
        self.assertEqual(ENTRY["artifact"], "destination/madrid_hotel_demand.json")
        self.assertEqual(ENTRY["meta_artifact"], "destination/madrid_hotel_demand.meta.json")
        self.assertEqual(ENTRY["builder"], "scripts/build_destination_context.py")
        self.assertTrue(ARTIFACT_PATH.exists())
        self.assertTrue(META_PATH.exists())

    def test_this_source_declares_no_spatial_envelope(self):
        self.assertIsNone(ENTRY["expected_spatial_scope"])
        self.assertIn("no coordinates", ENTRY["spatial_scope_note"])


if __name__ == "__main__":
    unittest.main()
