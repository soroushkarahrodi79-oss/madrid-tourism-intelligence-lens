import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "fill_stays_from_esmadrid.py"
SPEC = importlib.util.spec_from_file_location("fill_stays_from_esmadrid", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class AccommodationXmlParserTests(unittest.TestCase):
    def test_extracts_madrid_production_extradata_taxonomy(self):
        # Mirrors the real esmadrid production shape: taxonomy fields are
        # <item name="..."> values under <extradata>.
        xml = """<?xml version="1.0" encoding="UTF-8"?>
        <serviceList>
          <service fechaActualizacion="2026-09-28" id="76363">
            <basicData>
              <language>es</language>
              <name>Hotel Test Madrid</name>
              <title>Hotel Test Madrid</title>
            </basicData>
            <geoData>
              <address>Calle Test 1</address>
              <latitude>40.4155</latitude>
              <longitude>-3.6912</longitude>
            </geoData>
            <extradata>
              <item name="idTipo">3</item>
              <item name="Tipo">Alojamientos</item>
              <item name="idCategoria">7022</item>
              <item name="Categoria">Hoteles</item>
              <item name="idSubCategoria">7026</item>
              <item name="SubCategoria">4 estrellas</item>
            </extradata>
          </service>
        </serviceList>
        """
        points = MODULE.parse_accommodation_xml(xml)
        self.assertEqual(len(points), 1)
        self.assertEqual(points[0]["id"], "stay-published-76363")
        self.assertEqual(points[0]["name"], "Hotel Test Madrid")
        self.assertEqual(points[0]["stayKind"], "hotel")
        self.assertEqual(points[0]["accommodationType"], "Alojamientos")
        self.assertEqual(points[0]["accommodationCategory"], "Hoteles")
        self.assertEqual(points[0]["accommodationSubcategory"], "4 estrellas")
                self.assertAlmostEqual(points[0]["lat"], 40.4155)
        self.assertAlmostEqual(points[0]["lon"], -3.6912)

    def test_decodes_html_entities_and_normalizes_aparthotels_before_hotels(self):
        xml = """<root><service><id>8</id><name>Catalonia Plaza Espa&amp;ntilde;a</name>
        <extradata><item name="Tipo">Alojamientos</item><item name="Categoria">Apartahoteles</item><item name="SubCategoria">3 llaves</item></extradata>
        <geo><latitude>40.4200</latitude><longitude>-3.7000</longitude></geo>
        </service></root>"""
        points = MODULE.parse_accommodation_xml(xml)
        self.assertEqual(points[0]["name"], "Catalonia Plaza España")
        self.assertEqual(points[0]["stayKind"], "apartment")
        self.assertEqual(points[0]["accommodationType"], "Alojamientos")
        self.assertEqual(points[0]["accommodationCategory"], "Apartahoteles")
        self.assertEqual(points[0]["accommodationSubcategory"], "3 llaves")

    def test_normalizes_supported_official_type_families(self):
        expected = {
            "Hoteles": "hotel",
            "Hostales": "hostal",
            "Apartahoteles": "apartment",
            "Apartamentos turísticos": "apartment",
            "Albergues": "hostel",
            "Pensiones": "guest",
            "Casa de huéspedes": "guest",
            "Residencias universitarias": "residence",
            "Camping": "camping",
            "Otro": "other",
        }
        for raw, kind in expected.items():
            with self.subTest(raw=raw):
                self.assertEqual(MODULE.normalize_stay_kind(raw), kind)

    def test_tolerates_reversed_coordinates(self):
        xml = """<root><service><id>7</id><title>Hostal Centro</title>
        <geo><latitude>-3.7000</latitude><longitude>40.4200</longitude></geo>
        </service></root>"""
        points = MODULE.parse_accommodation_xml(xml)
        self.assertEqual(len(points), 1)
        self.assertAlmostEqual(points[0]["lat"], 40.42)
        self.assertAlmostEqual(points[0]["lon"], -3.7)


    def test_still_accepts_direct_tag_schema_variant(self):
        xml = """<root><service><id>99</id><name>Hostal Directo</name>
        <Tipo>Alojamientos</Tipo><Categoria>Hostales</Categoria><SubCategoria>2 estrellas</SubCategoria>
        <geo><latitude>40.4100</latitude><longitude>-3.7000</longitude></geo>
        </service></root>"""
        points = MODULE.parse_accommodation_xml(xml)
        self.assertEqual(points[0]["stayKind"], "hostal")
        self.assertEqual(points[0]["accommodationType"], "Alojamientos")
        self.assertEqual(points[0]["accommodationCategory"], "Hostales")
        self.assertEqual(points[0]["accommodationSubcategory"], "2 estrellas")


if __name__ == "__main__":
    unittest.main()
