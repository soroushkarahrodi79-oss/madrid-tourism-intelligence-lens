import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "fill_stays_from_esmadrid.py"
SPEC = importlib.util.spec_from_file_location("fill_stays_from_esmadrid", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class AccommodationXmlParserTests(unittest.TestCase):
    def test_extracts_nearest_record_with_name_and_coordinates(self):
        xml = """<?xml version="1.0" encoding="UTF-8"?>
        <root>
          <service>
            <basicData>
              <id>42</id>
              <name>Hotel Test Madrid</name>
            </basicData>
            <geoData>
              <address>Calle Test 1</address>
              <latitude>40.4155</latitude>
              <longitude>-3.6912</longitude>
            </geoData>
          </service>
        </root>
        """
        points = MODULE.parse_accommodation_xml(xml)
        self.assertEqual(len(points), 1)
        self.assertEqual(points[0]["id"], "stay-published-42")
        self.assertEqual(points[0]["name"], "Hotel Test Madrid")
        self.assertAlmostEqual(points[0]["lat"], 40.4155)
        self.assertAlmostEqual(points[0]["lon"], -3.6912)

    def test_tolerates_reversed_coordinates(self):
        xml = """<root><service><id>7</id><title>Hostal Centro</title>
        <geo><latitude>-3.7000</latitude><longitude>40.4200</longitude></geo>
        </service></root>"""
        points = MODULE.parse_accommodation_xml(xml)
        self.assertEqual(len(points), 1)
        self.assertAlmostEqual(points[0]["lat"], 40.42)
        self.assertAlmostEqual(points[0]["lon"], -3.7)


if __name__ == "__main__":
    unittest.main()
