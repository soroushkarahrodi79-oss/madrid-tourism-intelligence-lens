import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "build_pedestrian_activity.py"
SPEC = importlib.util.spec_from_file_location("build_pedestrian_activity", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class PedestrianActivityBuilderTests(unittest.TestCase):
    def test_aggregates_permanent_counter_rows_inside_central_madrid(self):
        csv_text = """fecha;hora;identificador;peatones;device_id;Número_distrito;distrito;direccion;observaciones_direccion;latitude;longitude
01-01-2024;10:00;P1;100;D1;1;Centro;Gran Vía 1;;40.4160;-3.7030
01-01-2024;11:00;P1;200;D1;1;Centro;Gran Vía 1;;40.4160;-3.7030
02-01-2024;10:00;P2;300;D2;3;Retiro;Alcalá 100;;40.4210;-3.6800
02-01-2024;10:00;OUT;999;D3;99;Outside;Outside;;40.7000;-3.7000
"""
        parsed = MODULE.parse_pedestrian_csv(csv_text)
        self.assertEqual(parsed["stationCount"], 2)
        self.assertEqual(parsed["observationCount"], 3)
        self.assertEqual(parsed["dateMin"], "2024-01-01")
        self.assertEqual(parsed["dateMax"], "2024-01-02")

        p1 = next(station for station in parsed["stations"] if station["stationId"] == "P1")
        self.assertEqual(p1["name"], "Gran Vía 1")
        self.assertEqual(p1["district"], "Centro")
        self.assertEqual(p1["observationCount"], 2)
        self.assertEqual(p1["meanObserved"], 150.0)

    def test_accepts_spanish_coordinate_headers_and_decimal_commas(self):
        csv_text = """FECHA;HORA;IDENTIFICADOR;PEATONES;DISTRITO;DIRECCION;LATITUD;LONGITUD
03-02-2024;18:00;P3;450;CENTRO;Puerta del Sol;40,4169;-3,7035
"""
        parsed = MODULE.parse_pedestrian_csv(csv_text)
        self.assertEqual(parsed["stationCount"], 1)
        station = parsed["stations"][0]
        self.assertAlmostEqual(station["lat"], 40.4169)
        self.assertAlmostEqual(station["lon"], -3.7035)
        self.assertEqual(station["meanObserved"], 450.0)

    def test_parses_coordinate_and_date_shape_used_by_current_madrid_resource(self):
        # Real 2024 CKAN rows currently expose coordinates like
        # 40.417.386 / -3.707.141 and fecha with an attached hour.
        csv_text = """fecha;hora;identificador;peatones;device_id;Numero_distrito;distrito;direccion;observaciones_direccion;latitude;longitude
01/01/2024 0:00;0:00;PERM_PEA01_PM01;910;PERM_PEA01_PM01;1;Centro;Calle Arenal esquina San Martín;Calle peatonal;40.417.386;-3.707.141
"""
        parsed = MODULE.parse_pedestrian_csv(csv_text)
        self.assertEqual(parsed["stationCount"], 1)
        station = parsed["stations"][0]
        self.assertAlmostEqual(station["lat"], 40.417386)
        self.assertAlmostEqual(station["lon"], -3.707141)
        self.assertEqual(station["dateMin"], "2024-01-01")
        self.assertEqual(station["dateMax"], "2024-01-01")
        self.assertEqual(station["meanObserved"], 910.0)

    def test_rejects_invalid_or_negative_counts_without_fabricating_values(self):
        csv_text = """fecha;hora;identificador;peatones;distrito;direccion;latitude;longitude
01-01-2024;10:00;BAD1;-1;Centro;Test;40.416;-3.703
01-01-2024;11:00;BAD2;not-a-number;Centro;Test;40.416;-3.703
"""
        parsed = MODULE.parse_pedestrian_csv(csv_text)
        self.assertEqual(parsed["stationCount"], 0)
        self.assertEqual(parsed["observationCount"], 0)
        self.assertEqual(parsed["rejectedRows"], 2)


if __name__ == "__main__":
    unittest.main()
