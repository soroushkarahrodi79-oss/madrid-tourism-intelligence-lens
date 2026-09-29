"""Tests for the canonical Madrid administrative geography.

Two layers of checks, both network-free and both dependency-free (no shapely):

  1. The builder's pure normalisation logic (parsing, id/name normalisation,
     hierarchy wiring, coordinate rounding, structural validation), exercised on
     small in-memory fixtures.
  2. The committed artifact data/geography/madrid_admin.geojson, so a bad
     regeneration is caught on every push on both Windows and Ubuntu.
"""

import importlib.util
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "build_madrid_geography.py"
SPEC = importlib.util.spec_from_file_location("build_madrid_geography", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

GEOJSON_PATH = ROOT / "data" / "geography" / "madrid_admin.geojson"
META_PATH = ROOT / "data" / "geography" / "madrid_admin.meta.json"


def _iter_coords(geom):
    stack = [geom["coordinates"]]
    while stack:
        item = stack.pop()
        if item and isinstance(item[0], (int, float)):
            yield item[0], item[1]
        else:
            stack.extend(item)


def _rings(geom):
    return [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]


def _point_in_ring(x, y, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def _contains(feature, x, y):
    for poly in _rings(feature["geometry"]):
        ext, holes = poly[0], poly[1:]
        if _point_in_ring(x, y, ext) and not any(_point_in_ring(x, y, h) for h in holes):
            return True
    return False


# --------------------------------------------------------------- builder logic


class BuilderNormalisationTests(unittest.TestCase):
    def test_round_ring_rounds_dedupes_and_closes(self):
        # Inputs carry more decimals than COORD_DECIMALS (7), so the first two
        # points collapse onto the same rounded coordinate and one is dropped.
        ring = [
            [-3.70000001, 40.40000001],  # A -> [-3.7, 40.4]
            [-3.70000002, 40.40000002],  # collapses onto A at 7 dp -> dropped
            [-3.6990000, 40.4010000],  # B
            [-3.6980000, 40.4000000],  # C
            [-3.7000000, 40.4000000],  # closing point == A
        ]
        out = MODULE._round_ring(ring)
        self.assertEqual(out[0], [-3.7, 40.4])
        self.assertEqual(len(out), 4, "A, B, C, closing A (the consecutive duplicate is dropped)")
        self.assertEqual(out[0], out[-1], "ring must stay closed")

    def test_round_coords_handles_polygon_and_multipolygon(self):
        poly = {"type": "Polygon", "coordinates": [[[-3.70000004, 40.40000004], [-3.699, 40.401], [-3.698, 40.4], [-3.70000004, 40.40000004]]]}
        rounded = MODULE.round_coords(poly)
        self.assertEqual(rounded["type"], "Polygon")
        for x, y in _iter_coords(rounded):
            self.assertEqual(x, round(x, MODULE.COORD_DECIMALS))
            self.assertEqual(y, round(y, MODULE.COORD_DECIMALS))
        multi = {"type": "MultiPolygon", "coordinates": [poly["coordinates"]]}
        self.assertEqual(MODULE.round_coords(multi)["type"], "MultiPolygon")

    def test_build_districts_normalises_and_sorts(self):
        raw = {
            "features": [
                {"properties": {"COD_DIS_TX": "17", "NOMBRE": "Villaverde"}, "geometry": _square()},
                {"properties": {"COD_DIS_TX": "01", "NOMBRE": "Centro"}, "geometry": _square()},
            ]
        }
        districts = MODULE.build_districts(raw)
        self.assertEqual([d["properties"]["official_id"] for d in districts], ["01", "17"])
        centro = districts[0]["properties"]
        self.assertEqual(centro["geography_level"], "district")
        self.assertEqual(centro["official_name"], "Centro")
        self.assertEqual(centro["parent_id"], MODULE.INE_MADRID_MUNICIPAL_CODE)
        self.assertEqual(centro["parent_name"], "Madrid")
        self.assertEqual(centro["geometry_provenance"], "OFFICIAL_GEOMETRY")

    def test_build_barrios_links_to_parent_district(self):
        raw = {
            "features": [
                {"properties": {"COD_BAR": "011", "COD_DIS_TX": "01", "NOMBRE": "Palacio", "NOMDIS": "Centro"}, "geometry": _square()},
            ]
        }
        barrios = MODULE.build_barrios(raw, {"01": "Centro"})
        b = barrios[0]["properties"]
        self.assertEqual(b["official_id"], "011")
        self.assertEqual(b["parent_id"], "01")
        self.assertEqual(b["parent_name"], "Centro")
        self.assertEqual(b["geography_level"], "barrio")

    def test_validate_flags_broken_geography(self):
        muni = _feature("municipality", "28079", "Madrid", None)
        districts = [_feature("district", "01", "Centro", "28079")]
        barrios = [_feature("barrio", "011", "Palacio", "99")]  # unknown parent
        errors = MODULE.validate(muni, districts, barrios)
        self.assertTrue(any("expected 21 districts" in e for e in errors))
        self.assertTrue(any("expected 131 barrios" in e for e in errors))
        self.assertTrue(any("unknown district" in e for e in errors))

    def test_geometry_plausibility_rejects_null_island(self):
        self.assertTrue(MODULE._geometry_plausible(_square()))
        self.assertFalse(MODULE._geometry_plausible({"type": "Polygon", "coordinates": [[[0, 0], [0.001, 0], [0, 0.001], [0, 0]]]}))

    def test_parse_published_version_is_deterministic_and_specific(self):
        district_notes = "... aproximación de los límites a los ejes de viario. Versión de los datos v3.2.1.\r\n\r\n**Fuente:...**"
        barrio_notes = "Versión de los datos v3.4.1."
        self.assertEqual(MODULE.parse_published_version(district_notes), "v3.2.1")
        self.assertEqual(MODULE.parse_published_version(barrio_notes), "v3.4.1")
        # Case/accent tolerant and normalises the leading v.
        self.assertEqual(MODULE.parse_published_version("VERSION DE LOS DATOS 4.0.2"), "v4.0.2")
        # A version-looking token that is not the dataset version is not matched.
        self.assertIsNone(MODULE.parse_published_version("built with library 1.2.3"))
        self.assertIsNone(MODULE.parse_published_version(""))
        self.assertIsNone(MODULE.parse_published_version(None))


# --------------------------------------------------------------- committed artifact


class CommittedArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.geo = json.loads(GEOJSON_PATH.read_text(encoding="utf-8"))
        cls.meta = json.loads(META_PATH.read_text(encoding="utf-8"))
        cls.features = cls.geo["features"]
        cls.municipality = [f for f in cls.features if f["properties"]["geography_level"] == "municipality"]
        cls.districts = [f for f in cls.features if f["properties"]["geography_level"] == "district"]
        cls.barrios = [f for f in cls.features if f["properties"]["geography_level"] == "barrio"]

    def test_counts(self):
        self.assertEqual(len(self.municipality), 1)
        self.assertEqual(len(self.districts), 21)
        self.assertEqual(len(self.barrios), 131)

    def test_unique_ids_and_names(self):
        for group in (self.districts, self.barrios):
            ids = [f["properties"]["official_id"] for f in group]
            self.assertEqual(len(set(ids)), len(ids))
        for f in self.features:
            self.assertTrue(f["properties"]["official_name"].strip())

    def test_hierarchy(self):
        district_ids = {d["properties"]["official_id"] for d in self.districts}
        for b in self.barrios:
            self.assertIn(b["properties"]["parent_id"], district_ids)
            self.assertTrue(b["properties"]["official_id"].startswith(b["properties"]["parent_id"]))
        muni_id = self.municipality[0]["properties"]["official_id"]
        for d in self.districts:
            self.assertEqual(d["properties"]["parent_id"], muni_id)

    def test_geometry_plausible_and_derived_flag(self):
        for f in self.features:
            for x, y in _iter_coords(f["geometry"]):
                self.assertTrue(-4.6 <= x <= -3.0 and 39.8 <= y <= 41.2)
        self.assertEqual(self.municipality[0]["properties"]["geometry_provenance"], "DERIVED_FROM_OFFICIAL_GEOMETRY")

    def test_point_in_polygon_landmarks(self):
        def district_at(x, y):
            for d in self.districts:
                if _contains(d, x, y):
                    return d["properties"]["official_id"]
            return None

        def barrio_at(x, y):
            for b in self.barrios:
                if _contains(b, x, y):
                    return b["properties"]["official_id"]
            return None

        self.assertEqual(district_at(-3.7038, 40.4168), "01")  # Puerta del Sol
        self.assertEqual(barrio_at(-3.7038, 40.4168), "016")
        self.assertEqual(district_at(-3.5935, 40.4936), "21")  # Barajas airport
        # Outside Madrid: no assignment.
        self.assertIsNone(district_at(-4.0273, 39.8628))  # Toledo
        self.assertIsNone(barrio_at(0.0, 0.0))  # null island

    def test_barrio_interior_points_fall_within_parent_district(self):
        by_id = {d["properties"]["official_id"]: d for d in self.districts}
        for b in self.barrios:
            ring = _rings(b["geometry"])[0][0]
            cx = sum(p[0] for p in ring) / len(ring)
            cy = sum(p[1] for p in ring) / len(ring)
            if not _contains(b, cx, cy):
                continue  # concave; skip the rough centroid rather than fail spuriously
            parent = by_id[b["properties"]["parent_id"]]
            self.assertTrue(_contains(parent, cx, cy), f"barrio {b['properties']['official_id']} centre outside its district")

    def test_version_catalogue_date_and_build_time_are_separate(self):
        self.assertNotIn("source_vintage", self.meta, "source_vintage was replaced by source_version")
        sv = self.meta["source_version"]
        self.assertTrue(sv["published_version_exposed"])
        self.assertFalse(sv["geometry_effective_date_exposed"])

        self.assertEqual(sv["datasets"]["district"]["published_version"], "v3.2.1")
        self.assertEqual(sv["datasets"]["barrio"]["published_version"], "v3.4.1")

        catalog_date = sv["datasets"]["barrio"]["catalog_metadata_modified"]
        self.assertRegex(catalog_date, r"^\d{4}-\d{2}-\d{2}$")
        self.assertRegex(self.meta["retrieved_at"], r"^\d{4}-\d{2}-\d{2}T")
        self.assertNotEqual(self.meta["retrieved_at"], catalog_date)
        self.assertNotEqual(sv["datasets"]["barrio"]["published_version"], catalog_date)

    def test_metadata_documents_provenance(self):
        self.assertEqual(self.meta["source"]["license"], "CC BY 4.0")
        self.assertIn("25830", self.meta["coordinate_reference_system"]["source"])
        self.assertEqual(self.meta["municipality_geometry"]["method"], "DERIVED_FROM_OFFICIAL_GEOMETRY")
        self.assertLess(self.meta["municipality_geometry"]["union_coherence"]["relative_difference"], 1e-6)


# --------------------------------------------------------------------- helpers


def _square():
    return {
        "type": "Polygon",
        "coordinates": [[[-3.70, 40.40], [-3.699, 40.40], [-3.699, 40.401], [-3.70, 40.401], [-3.70, 40.40]]],
    }


def _feature(level, official_id, name, parent):
    return {
        "type": "Feature",
        "properties": {
            "geography_level": level,
            "official_id": official_id,
            "official_name": name,
            "parent_id": parent,
        },
        "geometry": _square(),
    }


if __name__ == "__main__":
    unittest.main()
