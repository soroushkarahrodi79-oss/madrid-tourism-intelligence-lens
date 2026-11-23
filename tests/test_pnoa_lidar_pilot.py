"""Tests for the PNOA-LiDAR pilot primitives and its isolation from the app.

Fixtures here are SYNTHETIC arrays that exercise the arithmetic; they are unit
fixtures, never observations of Madrid. Only the isolation test is standard
library; the rest skip themselves when numpy/rasterio are not installed, so the
file stays collectable in CI without installing anything.
"""

from __future__ import annotations

import math
import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
PILOT = ROOT / "research" / "pnoa_lidar_madrid_pilot"
sys.path.insert(0, str(PILOT))

import lidar_core as core  # noqa: E402  (stdlib-only at import time)

core.isolate_proj_environment()  # must precede any rasterio/pyproj import

try:
    import numpy as np
except ImportError:  # pragma: no cover
    np = None
try:
    import rasterio
except ImportError:  # pragma: no cover
    rasterio = None


class IsolationTests(unittest.TestCase):
    def test_app_does_not_reference_the_pilot(self):
        for rel in ("index.html", "package.json"):
            self.assertNotIn("pnoa_lidar_madrid_pilot", (ROOT / rel).read_text(encoding="utf-8"), rel)
        for folder in ("js", "css"):
            for f in (ROOT / folder).rglob("*"):
                if f.is_file() and f.suffix in {".js", ".css", ".mjs"}:
                    self.assertNotIn("pnoa_lidar_madrid_pilot", f.read_text(encoding="utf-8"), str(f))

    def test_no_raster_is_committed_in_the_package(self):
        banned = {".tif", ".tiff", ".laz", ".las", ".zip"}
        found = [p.name for p in PILOT.rglob("*") if p.suffix.lower() in banned]
        self.assertEqual(found, [])

    def test_noise_floor_is_declared_rmse_in_quadrature(self):
        self.assertAlmostEqual(core.NOISE_FLOOR_M, math.sqrt(2) * 0.15, places=3)


@unittest.skipIf(np is None, "numpy not installed")
class CoreTests(unittest.TestCase):
    def test_difference_and_nodata_propagation(self):
        mds = np.array([[10.0, 5.0], [-9999.0, 7.0]], dtype="float32")
        mdt = np.array([[4.0, np.nan], [3.0, 7.0]], dtype="float32")
        out = core.normalised_surface(mds, mdt, -9999.0, None)
        self.assertEqual(float(out[0, 0]), 6.0)
        self.assertTrue(np.isnan(out[0, 1]))  # NaN in MDT
        self.assertTrue(np.isnan(out[1, 0]))  # NoData in MDS
        self.assertEqual(float(out[1, 1]), 0.0)

    def test_nodata_value_is_not_subtracted(self):
        mds = np.full((2, 2), -9999.0, dtype="float32")
        mdt = np.full((2, 2), 600.0, dtype="float32")
        self.assertTrue(np.isnan(core.normalised_surface(mds, mdt, -9999.0, -9999.0)).all())

    def test_shape_mismatch_is_refused(self):
        with self.assertRaises(ValueError):
            core.normalised_surface(np.zeros((2, 2)), np.zeros((2, 3)), None, None)

    def test_summary_states_its_denominators(self):
        nd = np.array([[0.0, 3.0, np.nan], [12.0, -1.0, 0.2]], dtype="float32")
        inside = np.array([[True, True, True], [True, True, False]])
        s = core.height_summary(nd, inside, 0.25)
        self.assertEqual((s["cells_total"], s["cells_valid"]), (5, 4))
        self.assertAlmostEqual(s["valid_fraction"], 0.8)
        self.assertAlmostEqual(s["area_valid_m2"], 1.0)
        self.assertAlmostEqual(s["share_at_or_above"]["3m"], 0.5)  # 3.0 and 12.0 of 4
        self.assertAlmostEqual(s["share_below_negative_tolerance"], 0.25)  # -1.0 of 4

    def test_empty_geometry_does_not_divide_by_zero(self):
        s = core.height_summary(np.full((2, 2), np.nan, "float32"), np.ones((2, 2), bool), 0.25)
        self.assertEqual(s["cells_valid"], 0)
        self.assertNotIn("mean", s)

    def test_circle_area_matches_pi_r_squared(self):
        m = core.circle_mask((800, 800), (0.0, 400.0), 0.5, (200.0, 200.0), 100.0)
        self.assertAlmostEqual(m.sum() * 0.25, math.pi * 100.0**2, delta=0.01 * math.pi * 100.0**2)

    def test_criteria_fold(self):
        self.assertEqual(core.evaluate_criteria({"a": True})["verdict"], "PASS")
        r = core.evaluate_criteria({"a": True, "b": False})
        self.assertEqual((r["verdict"], r["failed"]), ("FAIL", ["b"]))


@unittest.skipIf(np is None or rasterio is None, "numpy/rasterio not installed")
class EndToEndSyntheticTests(unittest.TestCase):
    """Runs the real script on SYNTHETIC GeoTIFFs laid over the real AOI extent."""

    def _write(self, path, data, transform, nodata):
        with rasterio.open(path, "w", driver="GTiff", height=data.shape[0], width=data.shape[1], count=1,
                           dtype="float32", crs="EPSG:25830", transform=transform, nodata=nodata,
                           compress="deflate", tiled=True, blockxsize=256, blockysize=256) as dst:
            dst.write(data, 1)

    def test_pipeline_on_synthetic_pair(self):
        import run_pilot
        from rasterio.transform import from_origin

        x0, y0, x1, y1 = 439500.0, 4474100.0, 441400.0, 4472900.0
        w, h = int((x1 - x0) / 0.5), int((y0 - y1) / 0.5)
        tf = from_origin(x0, y0, 0.5, 0.5)
        mdt = np.full((h, w), 650.0, dtype="float32")
        mds = mdt.copy()
        mds[1000:1100, 1000:1100] += 12.0  # a 50 m x 50 m block, 12 m tall
        with tempfile.TemporaryDirectory() as td:
            td = pathlib.Path(td)
            self._write(td / "mds.tif", mds, tf, -9999.0)
            self._write(td / "mdt.tif", mdt, tf, -9999.0)
            code = run_pilot.main(["--mds", str(td / "mds.tif"), "--mdt", str(td / "mdt.tif"), "--out", str(td / "out")])
            import json
            rep = json.loads((td / "out" / "pilot_report.json").read_text(encoding="utf-8"))
        self.assertEqual(code, 0, rep["acceptance"])
        self.assertEqual(rep["acceptance"]["verdict"], "PASS")
        self.assertEqual(rep["aoi_summary"]["valid_fraction"], 1.0)
        self.assertAlmostEqual(rep["aoi_summary"]["max"], 12.0, places=3)
        self.assertTrue(rep["inputs"]["mds"]["crs_equivalent_to_25830"])

    def test_epsg_3042_label_is_accepted_and_missing_crs_is_not(self):
        import run_pilot
        from rasterio.transform import from_origin

        tf = from_origin(439500.0, 4474100.0, 0.5, 0.5)
        data = np.full((200, 200), 650.0, "float32")
        with tempfile.TemporaryDirectory() as td:
            td = pathlib.Path(td)
            for name, crs in (("a", "EPSG:3042"), ("b", "EPSG:25830"), ("none", None)):
                with rasterio.open(td / f"{name}.tif", "w", driver="GTiff", height=200, width=200, count=1,
                                   dtype="float32", crs=crs, transform=tf) as dst:
                    dst.write(data, 1)
            self.assertTrue(run_pilot.crs_equivalent_to_25830(td / "a.tif"))
            self.assertTrue(run_pilot.crs_equivalent_to_25830(td / "b.tif"))
            self.assertFalse(run_pilot.crs_equivalent_to_25830(td / "none.tif"))

    def test_sheet_outside_the_aoi_is_refused_not_computed(self):
        import run_pilot
        from rasterio.transform import from_origin

        with tempfile.TemporaryDirectory() as td:
            td = pathlib.Path(td)
            for n in ("mds", "mdt"):
                with rasterio.open(td / f"{n}.tif", "w", driver="GTiff", height=200, width=200, count=1,
                                   dtype="float32", crs="EPSG:3042", transform=from_origin(267180.0, 4440630.0, 0.5, 0.5)) as dst:
                    dst.write(np.full((200, 200), 650.0, "float32"), 1)
            code = run_pilot.main(["--mds", str(td / "mds.tif"), "--mdt", str(td / "mdt.tif"), "--out", str(td / "o")])
            self.assertEqual(code, 1)

    def test_misaligned_pair_fails_the_grid_criterion(self):
        import run_pilot
        from rasterio.transform import from_origin

        w, h = 4000, 2400
        with tempfile.TemporaryDirectory() as td:
            td = pathlib.Path(td)
            self._write(td / "mds.tif", np.full((h, w), 650.0, "float32"), from_origin(439500.0, 4474100.0, 0.5, 0.5), -9999.0)
            self._write(td / "mdt.tif", np.full((h, w), 650.0, "float32"), from_origin(439500.25, 4474100.0, 0.5, 0.5), -9999.0)
            code = run_pilot.main(["--mds", str(td / "mds.tif"), "--mdt", str(td / "mdt.tif"), "--out", str(td / "out")])
            import json
            rep = json.loads((td / "out" / "pilot_report.json").read_text(encoding="utf-8"))
        self.assertEqual(code, 2)
        self.assertIn("grids_identical_in_aoi", rep["acceptance"]["failed"])


@unittest.skipIf(np is None or rasterio is None, "numpy/rasterio not installed")
class DiagnosticsTests(unittest.TestCase):
    def test_low_cell_component_geometry(self):
        import diagnostics
        from rasterio.transform import from_origin

        nd = np.full((100, 100), 10.0, "float32")
        nd[10:14, 10:20] = 0.0  # 4 x 10 cells = 2 m x 5 m = 10 m2
        info, mask, big = diagnostics.low_cells(nd, np.ones((100, 100), bool), from_origin(0.0, 50.0, 0.5, 0.5))
        self.assertEqual((info["cells"], info["components"]), (40, 1))
        self.assertAlmostEqual(big[0][0], 10.0)
        self.assertAlmostEqual(big[0][1], 2 * 10.0 / 14.0, places=6)  # 2A/P
        self.assertAlmostEqual(info["share_of_low_cells_with_difference_exactly_zero"], 1.0)

    def test_shift_test_flags_itself_non_discriminating_on_a_flat_pair(self):
        import diagnostics

        h = w = 60
        mdt = np.full((h, w), 650.0, "float32")
        r = diagnostics.shift_sensitivity(mdt + 5.0, mdt, np.ones((h, w), bool), None, None)
        self.assertFalse(r["discriminating"])

    def test_shift_test_detects_misregistration_on_a_steep_ramp(self):
        import diagnostics

        h = w = 60
        mdt = (np.arange(w, dtype="float32") * 0.3)[None, :].repeat(h, axis=0)
        r = diagnostics.shift_sensitivity(mdt.copy(), mdt, np.ones((h, w), bool), None, None)
        self.assertTrue(r["discriminating"])

    def test_committed_diagnostics_report_matches_its_own_claims(self):
        import json

        d = json.loads((PILOT / "results" / "diagnostics.json").read_text(encoding="utf-8"))
        c = d["crs_and_alignment"]
        self.assertTrue(c["geotransform_exactly_equal"] and c["bounds_exactly_equal"] and c["shape_equal"])
        self.assertFalse(c["one_cell_shift_sensitivity"]["discriminating"])
        self.assertEqual(c["epsg_3042"]["axes"][0][0], "N")
        self.assertEqual(c["epsg_25830"]["axes"][0][0], "E")


if __name__ == "__main__":
    unittest.main()
