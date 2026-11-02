"""Tests for the barrio-level registered-unemployment-rate artifact.

Network-free and dependency-free, in two layers:

  1. The builder's pure logic on a synthetic panel CSV generated from the
     committed canonical geography and Padron artifact (so the denominator-year
     gate runs for real): parsing, missing-value handling, exact indicator
     selection (the EPA rate and the counts must never be picked up), edition
     selection, code/name reconciliation, determinism and every failure mode.
  2. The committed artifact and sidecar cross-checked against the canonical
     geography and the Padron artifact.
"""

import importlib.util
import json
import pathlib
import unittest
from decimal import Decimal

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("build_madrid_unemployment", ROOT / "scripts" / "build_madrid_unemployment.py")
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

ARTIFACT = ROOT / "data" / "socioeconomic" / "madrid_registered_unemployment.json"
META = ROOT / "data" / "socioeconomic" / "madrid_registered_unemployment.meta.json"
GEO = json.loads((ROOT / "data" / "geography" / "madrid_admin.geojson").read_text(encoding="utf-8"))
POPULATION = json.loads((ROOT / "data" / "population" / "madrid_population.json").read_text(encoding="utf-8"))

BARRIOS = sorted(
    (f["properties"]["official_id"], f["properties"]["parent_id"], f["properties"]["official_name"])
    for f in GEO["features"]
    if f["properties"]["geography_level"] == "barrio"
)
RESIDENTS = {r["official_id"]: r["residents"] for r in POPULATION["records"] if r["geography_level"] == "barrio"}
HEADER = (
    "Orden;Periodo panel;ciudad;cod_distrito;distrito;cod_barrio;barrio;año;fecha_indicador;fuente_indicador;"
    "categoría_1;categoría_2;indicador_nivel1;indicador_nivel2;indicador_nivel3;unidad_indicador;"
    "indicador_completo;valor_indicador"
)


def _row(edition, barrio, indicator, unit, value, year=None, fecha=None):
    barrio_id, parent_id, name = barrio
    year = year or edition
    fecha = fecha or f"01/01/{edition}"
    return (
        f"1;{edition};Ciudad de Madrid;{int(parent_id)};D;{int(barrio_id)};{name};{year};{fecha};"
        f"Estadística Ayuntamiento de Madrid;c1;c2;n1;;;{unit};{indicator};{value}"
    )


def make_csv(edition="2026", rate_value=lambda i: f"{2 + i % 7},{i % 100:02d}", skip=(), extra=(), residents=None):
    lines = [HEADER]
    for i, barrio in enumerate(BARRIOS):
        if barrio[0] not in skip:
            lines.append(_row(edition, barrio, MODULE.RATE_INDICATOR, "Tasa", rate_value(i)))
        # Decoys that share the topic but are different indicators.
        lines.append(_row(edition, barrio, "Tasa de desempleo en hombres de 16 a 24 años", "Tasa", "99,99"))
        lines.append(_row(edition, barrio, "Paro registrado (número de personas registradas en SEPE en febrero)", "Personas", "123"))
        lines.append(_row(edition, barrio, MODULE.POPULATION_INDICATOR, "Habitantes", str((residents or RESIDENTS)[barrio[0]])))
    lines.extend(extra)
    return "\n".join(lines) + "\n"


class ParseTests(unittest.TestCase):
    def test_parse_rate_reads_spanish_decimals_and_blank_is_missing(self):
        self.assertEqual(MODULE.parse_rate("5,41"), Decimal("5.41"))
        self.assertEqual(MODULE.parse_rate("12"), Decimal("12"))
        self.assertIsNone(MODULE.parse_rate(""))
        self.assertIsNone(MODULE.parse_rate("  "))

    def test_parse_rate_rejects_unknown_missing_codes_and_junk(self):
        for bad in ("n.d.", "s/d", "-", "..", "-3,2", "5.41", "1e2", "NaN"):
            with self.assertRaises(ValueError, msg=bad):
                MODULE.parse_rate(bad)

    def test_missing_columns_fail_loudly(self):
        with self.assertRaises(SystemExit):
            MODULE.parse_panel_rows("Periodo panel;cod_barrio;valor_indicador\n2026;11;5,4\n")


class BuildTests(unittest.TestCase):
    def test_builds_one_valid_record_per_canonical_barrio_unchanged_from_source(self):
        artifact, meta, gate = MODULE.build(make_csv(), ROOT)
        self.assertEqual(len(artifact["records"]), 131)
        self.assertEqual([r["official_id"] for r in artifact["records"]], [b[0] for b in BARRIOS])
        first = artifact["records"][0]
        self.assertEqual(first, {"official_id": BARRIOS[0][0], "parent_id": BARRIOS[0][1], "rate_percent": 2.0, "state": "VALID"})
        # Values are transcribed (2 + i%7, i%100 as cents), never recomputed.
        self.assertEqual(artifact["records"][8]["rate_percent"], 3.08)
        self.assertEqual(artifact["counts"], {"barrios": 131, "valid": 131, "missing": 0})
        self.assertEqual(gate["mismatches"], 0)
        self.assertEqual(gate["barrios_compared"], 131)

    def test_decoy_indicators_are_never_selected(self):
        artifact, _, _ = MODULE.build(make_csv(), ROOT)
        self.assertNotIn(99.99, [r["rate_percent"] for r in artifact["records"]])
        self.assertNotIn(123.0, [r["rate_percent"] for r in artifact["records"]])

    def test_blank_is_missing_in_source_and_absent_row_is_not_published_never_zero(self):
        text = make_csv(rate_value=lambda i: "" if i == 3 else "4,00", skip=(BARRIOS[5][0],))
        # Coverage by row existence is required for edition selection, so a fully
        # absent barrio must be rejected at selection, not silently zero-filled.
        with self.assertRaises(SystemExit):
            MODULE.build(text, ROOT)
        blank_only = make_csv(rate_value=lambda i: "" if i == 3 else "4,00")
        artifact, _, _ = MODULE.build(blank_only, ROOT)
        record = artifact["records"][3]
        self.assertEqual((record["state"], record["rate_percent"]), ("MISSING_IN_SOURCE", None))
        self.assertEqual(artifact["counts"], {"barrios": 131, "valid": 130, "missing": 1})

    def test_build_records_marks_a_barrio_without_a_row_not_published(self):
        parent = {b[0]: b[1] for b in BARRIOS[:2]}
        rows = MODULE.build_records({BARRIOS[0][0]: {"valor_indicador": "4,5"}}, parent)
        self.assertEqual([r["state"] for r in rows], ["VALID", "NOT_PUBLISHED"])
        self.assertIsNone(rows[1]["rate_percent"])

    def test_deterministic_and_idempotent(self):
        text = make_csv()
        first = MODULE.build(text, ROOT)
        second = MODULE.build(text, ROOT)
        self.assertEqual(json.dumps(first[0], sort_keys=True), json.dumps(second[0], sort_keys=True))
        self.assertEqual(first[1]["selected_rows_sha256"], second[1]["selected_rows_sha256"])
        # A different value changes the fingerprint (it is not a constant).
        changed = MODULE.build(make_csv(rate_value=lambda i: "3,33"), ROOT)
        self.assertNotEqual(first[1]["selected_rows_sha256"], changed[1]["selected_rows_sha256"])

    def test_latest_complete_edition_wins_and_incomplete_newer_edition_is_ignored(self):
        older = make_csv(edition="2025", rate_value=lambda i: "7,00", residents=RESIDENTS)
        # A partial newer edition: only 2 barrios.
        partial = "\n".join(
            _row("2027", BARRIOS[i], MODULE.RATE_INDICATOR, "Tasa", "1,00") for i in range(2)
        )
        merged = make_csv(edition="2026", rate_value=lambda i: "4,00") + "\n".join(older.splitlines()[1:]) + "\n" + partial + "\n"
        artifact, _, _ = MODULE.build(merged, ROOT)
        self.assertEqual(artifact["source_period"]["panel_edition"], "2026")
        self.assertEqual({r["rate_percent"] for r in artifact["records"]}, {4.0})  # no 2025 or 2027 value mixed in

    def test_requested_edition_must_exist(self):
        with self.assertRaises(SystemExit):
            MODULE.build(make_csv(), ROOT, requested_edition="1999")

    def test_period_stamps_and_unit_are_verified(self):
        wrong_year = make_csv() + _row("2026", BARRIOS[0], MODULE.RATE_INDICATOR, "Tasa", "1,0", year="2025") + "\n"
        with self.assertRaises(SystemExit):  # duplicate barrio, and a conflicting year stamp
            MODULE.build(wrong_year, ROOT)
        text = make_csv().replace(";Tasa;Tasa absoluta de paro registrado (febrero);", ";Personas;Tasa absoluta de paro registrado (febrero);", 1)
        with self.assertRaises(SystemExit):
            MODULE.build(text, ROOT)

    def test_unrecognised_missing_code_fails_the_build(self):
        with self.assertRaises(ValueError):
            MODULE.build(make_csv(rate_value=lambda i: "n.d." if i == 0 else "4,00"), ROOT)

    def test_code_name_and_parent_must_match_the_canonical_geography(self):
        renamed = make_csv().replace(BARRIOS[0][2], "Otro barrio")
        with self.assertRaises(SystemExit):
            MODULE.build(renamed, ROOT)
        unknown = make_csv(extra=(_row("2026", ("999", "99", "Fantasma"), MODULE.RATE_INDICATOR, "Tasa", "4,00"),))
        with self.assertRaises(SystemExit):
            MODULE.build(unknown, ROOT)

    def test_denominator_year_gate_fails_when_the_population_base_disagrees(self):
        drifted = dict(RESIDENTS)
        drifted[BARRIOS[10][0]] += 1
        with self.assertRaises(SystemExit):
            MODULE.build(make_csv(residents=drifted), ROOT)

    def test_implausible_rate_fails(self):
        with self.assertRaises(SystemExit):
            MODULE.build(make_csv(rate_value=lambda i: "250,00"), ROOT)


class CommittedArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.artifact = json.loads(ARTIFACT.read_text(encoding="utf-8"))
        cls.meta = json.loads(META.read_text(encoding="utf-8"))

    def test_joins_every_canonical_barrio_exactly_once_with_the_right_parent(self):
        records = self.artifact["records"]
        self.assertEqual([(r["official_id"], r["parent_id"]) for r in records], [(b[0], b[1]) for b in BARRIOS])
        self.assertEqual(self.artifact["counts"], {"barrios": 131, "valid": 131, "missing": 0})

    def test_values_are_source_numbers_with_no_derived_or_territorial_fields(self):
        for record in self.artifact["records"]:
            self.assertEqual(set(record), {"official_id", "parent_id", "rate_percent", "state"})
            self.assertEqual(record["state"], "VALID")
            self.assertIsInstance(record["rate_percent"], float)
            self.assertTrue(0 <= record["rate_percent"] <= 100)
            self.assertEqual(round(record["rate_percent"], 2), record["rate_percent"])
        palacio = next(r for r in self.artifact["records"] if r["official_id"] == "011")
        self.assertEqual(palacio["rate_percent"], 5.41)  # the publisher's own value for Palacio

    def test_period_unit_and_definition_are_recorded(self):
        self.assertEqual(self.artifact["indicator"]["unit"], "percent")
        self.assertEqual(self.artifact["indicator"]["source_label"], "Tasa absoluta de paro registrado (febrero)")
        self.assertEqual(self.artifact["source_period"]["reference_year"], "2026")
        self.assertEqual(self.artifact["source_period"]["numerator_month"], "febrero")
        self.assertIn("16 to 64", self.meta["indicator_definition"])
        self.assertTrue(any("EPA" in line for line in self.meta["not_this"]))
        self.assertTrue(any("total registered population" in line for line in self.meta["not_this"]))

    def test_denominator_year_gate_is_recorded_and_matches_the_committed_padron(self):
        gate = self.meta["source_period"]["period_verification"]["denominator_year_gate"]
        self.assertTrue(gate["performed"])
        self.assertEqual(gate["padron_reference_date"], POPULATION["source_period"]["reference_date"])
        self.assertEqual(gate["mismatches"], 0)
        self.assertIn("publisher_year_tables_disagree", self.meta["source_period"]["period_verification"])

    def test_provenance_licence_and_interpretation_ceiling(self):
        self.assertEqual(self.meta["source"]["license"], "CC BY 4.0")
        self.assertEqual(self.meta["source"]["dataset_id"], "300087-0-indicadores-distritos")
        self.assertTrue(self.meta["source"]["csv"].endswith("/acumulado.csv"))
        ceiling = self.meta["interpretation_ceiling"]
        for phrase in ("NOT a tourism impact", "NOT the EPA rate", "never ranked", "never be allocated"):
            self.assertIn(phrase, ceiling)

    def test_no_raw_source_is_committed(self):
        sizes = {p.name: p.stat().st_size for p in ARTIFACT.parent.iterdir()}
        self.assertEqual(set(sizes), {ARTIFACT.name, META.name})
        self.assertLess(sizes[ARTIFACT.name], 64_000)


if __name__ == "__main__":
    unittest.main()
