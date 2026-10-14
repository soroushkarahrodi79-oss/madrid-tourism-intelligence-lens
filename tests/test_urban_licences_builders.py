"""Tests for the K9 granted-urban-licence builders (issue #71).

Two layers, both network-free:

  1. The builders' PURE logic — exact NDP identity, current unique/ambiguous match,
     date-aware historical selection (active / zero-active / multi-active), the
     historical version identity, FECHA_FIRMA_RESOLUCION as the licence date,
     DATE_UNAVAILABLE, address-text disagreement, the closed three-family TIPO
     taxonomy, an unknown TIPO failing, the three NIVEL_PROTECCION absence states,
     NORMA_ZONAL missingness and residual reconciliation — on small in-memory
     fixtures.
  2. The COMMITTED artifacts' metadata under data/callejero/ and data/planning/,
     so a bad regeneration fails on every push on both Windows and Ubuntu, pinned
     to the Gate M baseline.

Both builders are imported with the standard library alone (shapely/pyproj live
behind a lazy helper in the crosswalk builder), so this suite installs nothing.
"""

import importlib.util
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


def _load(name):
    path = ROOT / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


XW = _load("build_callejero_ndp_crosswalk")
LIC = _load("build_urban_licences")

SHAS = {"current": "c" * 64, "historical": "h" * 64}


def project(x, y):
    return (40.4, -3.7) if x is not None and y is not None else (None, None)


def locate(x, y):
    return {"barrio": "011", "district": "01"} if x is not None else {"barrio": None, "district": None}


def sdate(year):
    # The grammar is <weekday>, <d> de <month> de <year>; resolve_row ignores the
    # weekday's correctness, so any weekday name is fine for these fixtures.
    return f"lunes, 1 de junio de {year}"


def current_row(ndp, numero="10", calif="", via_clase="CALLE", via_nombre="MAYOR"):
    return {
        "COD_NDP": ndp, "DISTRITO": "01", "BARRIO": "1",
        "UTMX_ETRS": "440000,00", "UTMY_ETRS": "4474000,00",
        "VIA_CLASE": via_clase, "VIA_PAR": "", "VIA_NOMBRE": via_nombre,
        "VIA_NOMBRE_ACENTOS": via_nombre, "NUMERO": numero, "CALIFICADOR": calif,
    }


def hist_row(ndp, alta, baja, numero="5"):
    return {
        "COD_NDP": ndp, "FECHA_DE_ALTA": alta, "FECHA_DE_BAJA": baja,
        "UTMX_ETRS": "441000,00", "UTMY_ETRS": "4475000,00",
        "VIA_CLASE": "CALLE", "VIA_PAR": "", "VIA_NOMBRE": "ANTIGUA",
        "VIA_NOMBRE_ACENTOS": "ANTIGUA", "NÚMERO": numero, "CALIFICADOR": "",
    }


def lic_row(ndp, tipo="Licencia urbanística residencial", firma=None, alta=None,
            via="CL", direccion="MAYOR", num="10", norma="NZ", nivel="Sin protección"):
    return {
        "NDP": ndp, "TIPO": tipo,
        "FECHA_FIRMA_RESOLUCION": firma if firma is not None else sdate(2024),
        "FECHA_FIRMA_RESOLUCION - Año": "2024", "FECHA_FIRMA_RESOLUCION - Día": "1",
        "FECHA_ALTA": alta if alta is not None else sdate(2020),
        "VIA": via, "DIRECCION": direccion, "Nº": num,
        "NORMA_ZONAL": norma, "NIVEL_PROTECCION": nivel,
    }


def resolve(lic, current, historical):
    cbyndp = {}
    for r in current:
        cbyndp.setdefault(XW.canonical(r["COD_NDP"]), []).append(r)
    hbyndp = {}
    for r in historical:
        hbyndp.setdefault(XW.canonical(r["COD_NDP"]), []).append(r)
    return XW.resolve_row(lic, 0, cbyndp, hbyndp, project, locate, SHAS)


class CrosswalkPureLogic(unittest.TestCase):
    def test_exact_ndp_current_unique_resolves(self):
        rec = resolve(lic_row("12345678"), [current_row("12345678")], [])
        self.assertEqual(rec["crosswalk_state"], "RESOLVED")
        self.assertEqual(rec["resolution_provenance"], "CURRENT_CALLEJERO")
        self.assertEqual(rec["barrio_provenance"], "OFFICIAL_CURRENT_CALLEJERO_BARRIO")
        self.assertEqual(rec["barrio_code"], "011")
        self.assertEqual(rec["coordinate_crs"], "EPSG:4326")
        self.assertTrue(rec["address_text_agrees"])

    def test_ndp_is_not_integer_normalised(self):
        # A leading-zero key must only match the identical text; no zero-stripping.
        rec = resolve(lic_row("00012"), [current_row("12")], [])
        self.assertNotEqual(rec["crosswalk_state"], "RESOLVED")

    def test_current_ambiguous_multi_match_withholds_geometry(self):
        rec = resolve(lic_row("12345678"), [current_row("12345678"), current_row("12345678", numero="99")], [])
        self.assertEqual(rec["crosswalk_state"], "AMBIGUOUS_NDP_MULTI_MATCH")
        self.assertIsNone(rec["lat"])
        self.assertIsNone(rec["barrio_code"])

    def test_address_text_disagreement_preserved_but_resolved(self):
        rec = resolve(lic_row("12345678", num="99"), [current_row("12345678", numero="10")], [])
        self.assertEqual(rec["crosswalk_state"], "ADDRESS_TEXT_DISAGREEMENT")
        self.assertFalse(rec["address_text_agrees"])
        self.assertEqual(rec["barrio_code"], "011")  # exact NDP still authoritative

    def test_malformed_ndp(self):
        rec = resolve(lic_row("12A"), [], [])
        self.assertEqual(rec["crosswalk_state"], "MALFORMED_NDP")

    def test_ndp_absent_everywhere(self):
        rec = resolve(lic_row("777"), [current_row("888")], [])
        self.assertEqual(rec["crosswalk_state"], "NDP_ABSENT_CURRENT_CALLEJERO")

    def test_historical_date_aware_unique_match(self):
        rec = resolve(lic_row("999", firma=sdate(2024)), [], [hist_row("999", "01/01/2000", "")])
        self.assertEqual(rec["crosswalk_state"], "NDP_FOUND_HISTORICAL_ONLY")
        self.assertEqual(rec["resolution_provenance"], "HISTORICAL_CALLEJERO")
        self.assertEqual(rec["barrio_provenance"], "POLYGON_DERIVED_FROM_OFFICIAL_HISTORICAL_COORDINATE")
        self.assertEqual(rec["licence_date_selection_basis"], "FECHA_FIRMA_RESOLUCION")

    def test_historical_zero_active_is_cause_unresolved(self):
        # The only version ended before the grant date -> no active version.
        rec = resolve(lic_row("999", firma=sdate(2024)), [], [hist_row("999", "01/01/2000", "31/12/2001")])
        self.assertEqual(rec["crosswalk_state"], "CAUSE_UNRESOLVED")

    def test_historical_multi_active_withheld(self):
        rec = resolve(
            lic_row("999", firma=sdate(2024)),
            [],
            [hist_row("999", "01/01/2000", "", numero="5"), hist_row("999", "01/01/2001", "", numero="7")],
        )
        self.assertEqual(rec["crosswalk_state"], "AMBIGUOUS_NDP_MULTI_MATCH")
        self.assertIsNone(rec["lat"])

    def test_historical_version_identity(self):
        rec = resolve(lic_row("999", firma=sdate(2024)), [], [hist_row("999", "01/01/2000", "")])
        self.assertEqual(
            rec["historical_version"]["version_identity"],
            f"{SHAS['historical']}:999:01/01/2000:",
        )

    def test_firma_date_drives_historical_selection_not_alta(self):
        # Active only in 2023-2024. FECHA_ALTA is 2020 (outside the window). If the
        # builder used FECHA_ALTA it would be unresolved; it resolves, proving
        # FECHA_FIRMA_RESOLUCION is the licence date.
        rec = resolve(
            lic_row("999", firma=sdate(2024), alta=sdate(2020)),
            [],
            [hist_row("999", "01/01/2023", "31/12/2024")],
        )
        self.assertEqual(rec["crosswalk_state"], "NDP_FOUND_HISTORICAL_ONLY")

    def test_date_unavailable(self):
        rec = resolve(lic_row("999", firma=""), [], [hist_row("999", "01/01/2000", "")])
        self.assertEqual(rec["crosswalk_state"], "DATE_UNAVAILABLE")

    def test_parse_spanish_date_is_deterministic(self):
        d, ok = XW.parse_spanish_date("lunes, 1 de enero de 2024")
        self.assertEqual(d.isoformat(), "2024-01-01")
        with self.assertRaises(ValueError):
            XW.parse_spanish_date("2024-01-01")


class LicencePureLogic(unittest.TestCase):
    def test_three_families(self):
        self.assertEqual(LIC.classify_family("Licencia urbanística residencial"), "BUILDING_URBANISTIC_LICENCE_FAMILY")
        self.assertEqual(LIC.classify_family("Licencia urbanística de actividad"), "ACTIVITY_LICENCE_FAMILY")
        self.assertEqual(LIC.classify_family("Licencias para actividades temporales"), "TEMPORARY_ACTIVITY_FAMILY")

    def test_temporary_not_collapsed_into_activity(self):
        self.assertNotEqual(
            LIC.classify_family("Licencias para actividades temporales"),
            LIC.classify_family("Licencia básica actividad"),
        )

    def test_unknown_tipo_fails(self):
        with self.assertRaises(ValueError):
            LIC.classify_family("Licencia inventada 2027")

    def test_nivel_proteccion_three_states_distinct(self):
        self.assertIsNone(LIC.nivel_proteccion_value(""))
        self.assertEqual(LIC.nivel_proteccion_value("Sin Catalogar"), "Sin Catalogar")
        self.assertEqual(LIC.nivel_proteccion_value("Sin protección"), "Sin protección")
        values = {LIC.nivel_proteccion_value(""), LIC.nivel_proteccion_value("Sin Catalogar"), LIC.nivel_proteccion_value("Sin protección")}
        self.assertEqual(len(values), 3, "the three absence states are never merged")

    def test_norma_zonal_missing_preserved_as_null(self):
        self.assertIsNone(LIC.norma_zonal_value(""))
        self.assertEqual(LIC.norma_zonal_value("NZ-1"), "NZ-1")

    def test_build_licence_record_minimises_fields_and_uses_firma(self):
        lic = lic_row("12345678", firma=sdate(2024), nivel="", norma="")
        xw = {
            "licence_index": 7, "lat": 40.4, "lon": -3.7, "coordinate_crs": "EPSG:4326",
            "barrio_code": "011", "district_code": "01", "crosswalk_state": "RESOLVED",
            "resolution_provenance": "CURRENT_CALLEJERO", "barrio_provenance": "OFFICIAL_CURRENT_CALLEJERO_BARRIO",
            "address_text_agrees": True,
        }
        rec = LIC.build_licence_record(lic, xw)
        self.assertEqual(rec["id"], "k9-00007")
        self.assertEqual(rec["grant_date"], "2024-06-01")
        self.assertIsNone(rec["nivel_proteccion"])
        self.assertIsNone(rec["norma_zonal"])
        self.assertNotIn("persona_interesada", rec)
        self.assertNotIn("PERSONA_INTERESADA", rec)


class CommittedCrosswalkRegression(unittest.TestCase):
    """Pinned Gate M regression against the committed crosswalk metadata."""

    @classmethod
    def setUpClass(cls):
        cls.meta = json.loads((ROOT / "data/callejero/madrid_ndp_crosswalk.meta.json").read_text(encoding="utf-8"))
        cls.cov = cls.meta["coverage"]

    def test_pinned_counts(self):
        c = self.cov
        self.assertEqual(c["licence_rows"], 11498)
        self.assertEqual(c["distinct_licence_ndps"], 7938)
        self.assertEqual(c["resolved_rows"], 11265)
        self.assertEqual(c["unresolved_rows"], 233)
        self.assertEqual(c["resolved_distinct_ndps"], 7795)
        self.assertEqual(c["unresolved_distinct_ndps"], 143)
        self.assertEqual(c["current_only_resolved_rows"], 11179)
        self.assertEqual(c["historical_only_recovered_rows"], 86)
        self.assertEqual(c["address_text_disagreement_rows"], 517)

    def test_residual_taxonomy_exhaustive_and_pinned(self):
        self.assertTrue(self.cov["residual_taxonomy_is_exhaustive"])
        self.assertEqual(
            self.cov["residual_taxonomy"],
            {
                "ADDRESS_TEXT_DISAGREEMENT": 517,
                "CAUSE_UNRESOLVED": 117,
                "NDP_ABSENT_CURRENT_CALLEJERO": 116,
                "NDP_FOUND_HISTORICAL_ONLY": 86,
                "RESOLVED": 10662,
            },
        )

    def test_source_fingerprints_present(self):
        src = self.meta["sources"]
        for key in ("licence_register", "current_callejero", "historical_callejero"):
            self.assertRegex(src[key]["observed_resource_state"]["sha256"], r"^[0-9a-f]{64}$")
        self.assertRegex(self.meta["fingerprint"]["value"], r"^[0-9a-f]{64}$")

    def test_match_rate_above_floor(self):
        self.assertGreaterEqual(self.cov["row_match_rate"], 0.90)


class CommittedLicenceRegression(unittest.TestCase):
    """Pinned Gate M regression against the committed licence metadata/artifact."""

    @classmethod
    def setUpClass(cls):
        cls.meta = json.loads((ROOT / "data/planning/madrid_urban_licences.meta.json").read_text(encoding="utf-8"))
        cls.artifact = json.loads((ROOT / "data/planning/madrid_urban_licences.json").read_text(encoding="utf-8"))

    def test_three_family_counts(self):
        fc = self.meta["tipo_taxonomy"]["family_counts"]
        self.assertEqual(fc["BUILDING_URBANISTIC_LICENCE_FAMILY"], 5938)
        self.assertEqual(fc["ACTIVITY_LICENCE_FAMILY"], 5385)
        self.assertEqual(fc["TEMPORARY_ACTIVITY_FAMILY"], 175)
        self.assertEqual(self.meta["tipo_taxonomy"]["unclassified_tipo_rows"], 0)

    def test_nivel_proteccion_three_absence_states(self):
        counts = self.meta["nivel_proteccion"]["counts"]
        self.assertEqual(counts["EMPTY"], 2507)
        self.assertEqual(counts["Sin Catalogar"], 5340)
        self.assertEqual(counts["Sin protección"], 1040)

    def test_norma_zonal_missingness(self):
        nz = self.meta["norma_zonal_missingness"]
        self.assertEqual(nz["missing"], 2505)
        self.assertEqual(nz["both_protection_and_norma_missing"], 2505)
        self.assertEqual(nz["only_protection_missing"], 2)
        self.assertEqual(nz["only_norma_missing"], 0)

    def test_coverage_and_granted_only(self):
        self.assertTrue(self.artifact["granted_only"])
        self.assertEqual(self.artifact["coverage"]["resolved_rows"], 11265)
        self.assertEqual(self.artifact["coverage"]["unresolved_rows"], 233)
        self.assertEqual(self.artifact["coverage"]["current_only_resolved_rows"], 11179)
        self.assertEqual(self.artifact["coverage"]["historical_only_recovered_rows"], 86)

    def test_responsible_declarations_excluded(self):
        self.assertEqual(self.meta["excluded"]["declaraciones_responsables_dataset"], "133556-0-declaraciones-responsables")
        # The dataset id must never appear as a SOURCE of the artifact.
        self.assertNotIn("133556", json.dumps(self.meta["source"]))

    def test_no_persona_interesada_in_records(self):
        for rec in self.artifact["records"][:200]:
            self.assertNotIn("persona_interesada", {k.lower() for k in rec})

    def test_no_cross_family_total_key(self):
        blob = json.dumps(self.artifact).lower()
        for banned in ("total_urban_licences", "all_licence_total", "overall_licence_count"):
            self.assertNotIn(banned, blob)


if __name__ == "__main__":
    unittest.main()
