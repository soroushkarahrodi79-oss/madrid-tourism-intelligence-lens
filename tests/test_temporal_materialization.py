"""Gate 4B: the temporal manifest materializer (research/temporal_materialization).

Deterministic and offline: the manifest is the committed Gate 4A example, every
image is SYNTHETIC (generated here, never an observation of Madrid) and the only
socket opened is a loopback server. Tests that decode images skip without Pillow.
"""

from __future__ import annotations

import contextlib
import copy
import hashlib
import http.server
import io
import json
import pathlib
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "research" / "temporal_materialization"))

import materialize as m  # noqa: E402  (stdlib-only at import time)

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover
    Image = None

EXAMPLE = ROOT / "docs" / "examples" / "temporal-manifest.example.json"
SCHEMA = json.loads(m.SCHEMA_PATH.read_text(encoding="utf-8"))
W, H = 1280, 800


def example():
    return json.loads(EXAMPLE.read_text(encoding="utf-8"))


def errors_after(change):
    manifest = example()
    change(manifest)
    return m.manifest_errors(manifest, SCHEMA)


def frame0(manifest):
    return manifest["sequence"]["frames"][0]


class ManifestValidationTests(unittest.TestCase):
    def test_committed_example_is_accepted(self):
        self.assertEqual(m.manifest_errors(example(), SCHEMA), [])

    def test_invalid_manifests_are_rejected(self):
        def swap_axes(x):
            w, s, e, n = x["view"]["bbox_geographic"]["bbox"]
            x["view"]["bbox_geographic"]["bbox"] = [s, w, n, e]

        cases = {
            "unsupported version": lambda x: x["schema"].update(version="2.0.0"),
            "unknown field": lambda x: x.update(extra=1),
            "missing field": lambda x: x["view"].pop("bbox"),
            "wrong type": lambda x: x["image"].update(width="1280"),
            "wrong CRS": lambda x: x["view"].update(crs="EPSG:4326"),
            "wrong axis order": lambda x: x["view"].update(axis_order=["northing", "easting"]),
            "swapped geographic axes": swap_axes,
            "reversed bbox": lambda x: x["view"]["bbox"].reverse(),
            "oversized image": lambda x: x["image"].update(width=8000),
            "distorted aspect": lambda x: x["image"].update(height=400),
            "duplicate id": lambda x: frame0(x).update(coverage_id=x["reference"]["coverage_id"]),
            "path as id": lambda x: frame0(x).update(coverage_id="../escape"),
            "inverted years": lambda x: frame0(x)["date"].update(start_year=1999),
            "unordered sequence": lambda x: x["sequence"]["frames"].reverse(),
            "unsupported format": lambda x: (x["image"].update(format="image/tiff"), x["service"].update(format="image/tiff")),
            "other service": lambda x: x["service"].update(url="https://example.org/wms"),
        }
        for name, change in cases.items():
            with self.subTest(name):
                self.assertTrue(errors_after(change))

    def test_only_the_contracted_getmap_url_is_accepted(self):
        good = frame0(example())["getmap_url"]
        base = "https://www.ign.es/wms/pnoa-historico"
        bad = [
            good.replace("https://", "http://"),
            good.replace("www.ign.es", "www.ign.es.example.org"),
            good.replace("www.ign.es", "www.ign.es@example.org"),
            good.replace("www.ign.es", "www.ign.es:8443"),
            good.replace(base, base + "/../other"),
            good.replace(base, "file:///etc/passwd"),
            good + "#fragment",
            good + "&map=/etc/passwd",
            good + "&width=1280",
            good.replace("request=GetMap", "request=GetFeatureInfo"),
            good.replace("layers=AMS_1956-1957", "layers=AMS_1956-1957%2CPNOA2023"),
            good.replace("width=1280", "width=4096"),
            good.replace("bbox=-412535.167", "bbox=-500000"),
        ]
        for url in bad:
            with self.subTest(url=url[:90]):
                self.assertNotEqual(url, good)
                self.assertTrue(errors_after(lambda x: frame0(x).update(getmap_url=url)))

    def test_non_strict_json_is_refused(self):
        for text in (b'{"a":1,"a":2}', b'{"a":NaN}', b"not json"):
            with self.subTest(text), self.assertRaises(ValueError):
                m.parse_json_strict(text)

    def test_unknown_schema_keyword_is_not_silently_skipped(self):
        with self.assertRaises(m.Refused):
            m.schema_errors(1, {"maximum": 0}, {})

    def test_refused_manifest_downloads_and_writes_nothing(self):
        manifest = example()
        manifest["service"]["url"] = "https://example.org/wms"
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp, "m.json")
            path.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaises(m.Refused):
                m.materialize(path, pathlib.Path(tmp, "out"), fetcher=self.fail)
            self.assertFalse(pathlib.Path(tmp, "out").exists())


class CommandLineTests(unittest.TestCase):
    def test_exit_codes_for_refusals(self):
        with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stderr(io.StringIO()), \
                contextlib.redirect_stdout(io.StringIO()):
            bad = pathlib.Path(tmp, "m.json")
            bad.write_text('{"schema": {"id": "x", "version": "9"}}', encoding="utf-8")
            self.assertEqual(m.main(["--manifest", str(bad), "--output", str(pathlib.Path(tmp, "out"))]), 2)
            self.assertEqual(m.main(["--verify", tmp]), 4)


class GeoreferencingTests(unittest.TestCase):
    def test_world_file_uses_pixel_centres_and_reproduces_the_bbox(self):
        manifest = example()
        spatial = m.georeference(manifest)
        a, d, b, e, c, f = spatial["world_file"]
        minx, miny, maxx, maxy = manifest["view"]["bbox"]
        self.assertEqual((d, b), (0.0, 0.0))
        self.assertGreater(a, 0)
        self.assertLess(e, 0)  # row 0 is north
        self.assertAlmostEqual(c - a / 2, minx, places=6)
        self.assertAlmostEqual(f - e / 2, maxy, places=6)
        self.assertAlmostEqual(c + a * (W - 0.5), maxx, places=6)
        self.assertAlmostEqual(f + e * (H - 0.5), miny, places=6)

    def test_sidecars(self):
        files = m.sidecars("f01_x.jpg", m.georeference(example()), "image/jpeg")
        self.assertEqual(sorted(files), ["f01_x.jgw", "f01_x.jpg.aux.xml", "f01_x.prj"])
        self.assertEqual(len(files["f01_x.jgw"].split()), 6)
        self.assertIn("Mercator_Auxiliary_Sphere", files["f01_x.prj"])
        self.assertNotIn("GeoTransform", files["f01_x.jpg.aux.xml"])
        self.assertIn("f01_x.pgw", m.sidecars("f01_x.png", m.georeference(example()), "image/png"))


def encode(image, fmt="JPEG"):
    buffer = io.BytesIO()
    image.save(buffer, fmt, **({"quality": 90} if fmt == "JPEG" else {}))
    return buffer.getvalue()


def textured(seed, size=(W, H)):
    image = Image.new("RGB", size, (60 + seed % 120, 110, 80))
    ImageDraw.Draw(image).rectangle([seed % 300, 100, seed % 300 + 200, 400], fill=(150, 140, 130))
    return image


def ok(body, content_type="image/jpeg", status=200, **headers):
    return status, {"content-type": content_type, "content-length": str(len(body)), **headers}, body


class FakeService:
    """Answers by layer name. `special` maps a layer to a list of replies used in order."""

    def __init__(self, special=None):
        self.special = {k: list(v) for k, v in (special or {}).items()}
        self.calls = []
        self.bodies = {}

    def __call__(self, url):
        layer = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))["layers"]
        self.calls.append(layer)
        if self.special.get(layer):
            reply = self.special[layer].pop(0) if len(self.special[layer]) > 1 else self.special[layer][0]
            if isinstance(reply, BaseException):
                raise reply
            return reply
        self.bodies[layer] = encode(textured(sum(layer.encode()) * 7 + len(layer)))
        return ok(self.bodies[layer])


def offline(url):
    raise AssertionError(f"network used: {url}")


@unittest.skipIf(Image is None, "Pillow is not installed")
class PipelineTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = pathlib.Path(tmp.name)
        self.manifest = self.tmp / "manifest.json"
        self.manifest.write_bytes(EXAMPLE.read_bytes())
        self.out = self.tmp / "package"
        self.sleeps = []

    def run_tool(self, fetcher, manifest=None):
        return m.materialize(manifest or self.manifest, self.out, fetcher=fetcher,
                             sleep=self.sleeps.append, log=lambda *_: None)

    def package(self):
        return json.loads((self.out / "materialized-manifest.json").read_text(encoding="utf-8"))

    def by_id(self):
        return {f["coverage_id"]: f for f in self.package()["frames"]}

    def verify(self):
        return m.verify(self.out, log=lambda *_: None)

    def test_complete_package(self):
        before = self.manifest.read_bytes()
        service = FakeService()
        code, report = self.run_tool(service)
        self.assertEqual(code, 0)
        self.assertEqual(len(service.calls), 10)
        self.assertEqual(report["counts"]["valid"], 10)
        self.assertEqual(self.manifest.read_bytes(), before)
        self.assertEqual((self.out / "source-manifest.json").read_bytes(), before)

        package, source = self.package(), example()
        self.assertTrue(package["complete"])
        self.assertEqual(package["order"]["sequence"], [f["coverage_id"] for f in source["sequence"]["frames"]])
        for record, coverage in zip(package["frames"], [source["reference"], *source["sequence"]["frames"]]):
            data = (self.out / record["file"]).read_bytes()
            self.assertEqual(data, service.bodies[coverage["layer"]], "received bytes are stored unchanged")
            self.assertEqual(record["sha256"], hashlib.sha256(data).hexdigest())
            self.assertEqual(record["bytes"], len(data))
            self.assertEqual(record["date"], coverage["date"])
            self.assertEqual(record["request_url"], coverage["getmap_url"])
            self.assertEqual(record["attribution"], coverage["attribution"])
            self.assertEqual((record["width"], record["height"], record["crs"]), (W, H, "EPSG:3857"))
            self.assertEqual(record["bbox"], source["view"]["bbox"])
            self.assertEqual(record["coverage"]["state"], "COVERAGE_UNVERIFIED")
            self.assertEqual(len(record["sidecars"]), 3)
        self.assertEqual(self.by_id()["ams1956"]["date"]["end_year"], 1957)
        self.assertEqual(self.verify(), 0)

    def test_rerun_is_fully_offline(self):
        self.run_tool(FakeService())
        first = self.by_id()
        code, report = self.run_tool(offline)
        self.assertEqual(code, 0)
        self.assertEqual(report["last_run"], {"network_requests": 0, "reused_files": 10, "downloaded_files": 0})
        self.assertEqual(self.by_id(), first)

    def test_interrupted_run_resumes_without_repeating_downloads(self):
        interrupted = FakeService({"SIGPAC": [KeyboardInterrupt()]})
        with self.assertRaises(KeyboardInterrupt):
            self.run_tool(interrupted)
        self.assertEqual(self.verify(), 3, "an interrupted package is verifiable and reported incomplete")
        kept = {k: v for k, v in self.by_id().items() if v["status"] == "VALID_IMAGE"}
        self.assertEqual(sorted(kept), ["2006", "ams1956", "olistat"])
        service = FakeService()
        code, report = self.run_tool(service)
        self.assertEqual(code, 0)
        self.assertEqual(len(service.calls), 7)
        self.assertEqual(report["last_run"]["reused_files"], 3)
        for cid, record in kept.items():
            self.assertEqual(self.by_id()[cid], record)

    def test_interruption_between_record_and_rename_recovers(self):
        self.run_tool(FakeService())
        target = self.out / self.by_id()["2023"]["file"]
        target.rename(target.with_name(target.name + ".part"))
        code, _ = self.run_tool(offline)
        self.assertEqual(code, 0)
        self.assertTrue(target.is_file())

    def test_a_deleted_file_is_fetched_again_and_the_replacement_is_declared(self):
        self.run_tool(FakeService())
        record = self.by_id()["2023"]
        (self.out / record["file"]).unlink()
        code, report = self.run_tool(FakeService({"PNOA2023": [ok(encode(textured(9)))]}))
        self.assertEqual(code, 0)
        self.assertEqual(self.by_id()["2023"]["superseded"],
                         {"sha256": record["sha256"], "retrieved_at": record["retrieved_at"]})
        self.assertIn("2023: downloaded again after its file went missing; bytes DIFFERENT", report["warnings"])
        self.run_tool(offline)
        self.assertIsNotNone(self.by_id()["2023"]["superseded"], "the history survives later runs")

    def test_altered_image_is_detected_and_never_overwritten(self):
        self.run_tool(FakeService())
        record = self.by_id()["2023"]
        target = self.out / record["file"]
        target.write_bytes(target.read_bytes() + b"x")
        altered = target.read_bytes()
        self.assertEqual(self.verify(), 4)
        for _ in range(2):  # the mismatch must survive a rerun, not be forgotten by it
            code, _report = self.run_tool(offline)
            self.assertEqual(code, 4)
            self.assertEqual(target.read_bytes(), altered)
            self.assertEqual(self.by_id()["2023"]["sha256"], record["sha256"])
            self.assertFalse(self.package()["complete"])
            self.assertEqual(self.verify(), 4)

    def test_missing_or_altered_sidecar(self):
        self.run_tool(FakeService())
        world = self.out / "frames" / "ref_2006.jgw"
        original = world.read_bytes()
        world.write_bytes(original.replace(b"-", b"", 1))
        self.assertEqual(self.verify(), 4)
        world.unlink()
        self.assertEqual(self.verify(), 4)
        world.write_bytes(original)
        self.assertEqual(self.verify(), 0)

    def test_gis_statistics_in_aux_xml_are_tolerated_but_a_new_crs_is_not(self):
        self.run_tool(FakeService())
        aux = self.out / "frames" / "ref_2006.jpg.aux.xml"
        original = aux.read_bytes()
        aux.write_bytes(original.replace(b"</PAMDataset>", b'<Metadata><MDI key="STATISTICS_MEAN">1</MDI></Metadata></PAMDataset>'))
        self.assertEqual(self.verify(), 0)
        aux.write_bytes(original.replace(b"3857", b"4326"))
        self.assertEqual(self.verify(), 4)

    def test_existing_content_is_never_overwritten(self):
        self.out.mkdir()
        (self.out / "notes.txt").write_text("mine", encoding="utf-8")
        with self.assertRaises(m.Refused):
            self.run_tool(offline)
        self.assertEqual([p.name for p in self.out.iterdir()], ["notes.txt"])

        self.out = self.tmp / "second"
        self.run_tool(FakeService())
        other = example()
        other["generated_at"] = "2026-01-01T00:00:00Z"
        path = self.tmp / "other.json"
        path.write_text(json.dumps(other), encoding="utf-8")
        with self.assertRaises(m.Refused):
            self.run_tool(offline, path)

    def test_unrecorded_file_is_a_conflict(self):
        self.run_tool(FakeService({"PNOA2023": [ok(b"nope", "text/plain")]}))
        stray = self.out / "frames" / "f09_2023.jpg"
        stray.write_bytes(b"stray")
        code, _ = self.run_tool(offline)
        self.assertEqual(code, 4)
        self.assertEqual(stray.read_bytes(), b"stray")

    def test_recorded_path_cannot_leave_the_package(self):
        self.run_tool(FakeService())
        package = self.package()
        package["frames"][0]["file"] = "../manifest.json"
        (self.out / "materialized-manifest.json").write_text(json.dumps(package), encoding="utf-8")
        with self.assertRaises(m.Refused):
            self.run_tool(offline)

    def test_bad_responses_are_classified_and_leave_no_file(self):
        good = encode(textured(1))
        xml = b'<?xml version="1.0"?><ServiceExceptionReport><ServiceException code="LayerNotDefined">no such layer</ServiceException></ServiceExceptionReport>'
        replies = {
            "AMS_1956-1957": [ok(xml, "text/xml")],
            "OLISTAT": [ok(b"<html>maintenance</html>", "image/jpeg")],
            "SIGPAC": [ok(good[: len(good) // 2])],
            "PNOA2009": [ok(encode(textured(2, (640, 400))))],
            "PNOA2011": [ok(encode(textured(3), "PNG"), "image/png")],
            "PNOA2014": [ok(b"\xff\xd8garbage\xff\xd9")],
            "PNOA2017": [(404, {"content-type": "text/plain"}, b"not found")],
            "PNOA2020": [(302, {"location": "https://example.org/x.jpg"}, b"")],
        }
        service = FakeService(replies)
        code, report = self.run_tool(service)
        self.assertEqual(code, 3)
        status = {k: v["status"] for k, v in self.by_id().items()}
        self.assertEqual(status, {
            "2006": "VALID_IMAGE", "ams1956": "SERVICE_EXCEPTION", "olistat": "SERVICE_EXCEPTION",
            "sigpac": "DECODE_ERROR", "2009": "DIMENSION_MISMATCH", "2011": "CONTENT_TYPE_MISMATCH",
            "2014": "DECODE_ERROR", "2017": "HTTP_ERROR", "2020": "REDIRECT_REFUSED", "2023": "VALID_IMAGE"})
        self.assertIn("no such layer", self.by_id()["ams1956"]["error"])
        self.assertEqual(service.calls.count("PNOA2017"), 1, "a 404 is not retried")
        self.assertEqual(service.calls.count("PNOA2020"), 1, "a redirect is not followed or retried")
        self.assertEqual(report["counts"]["failed"], 8)
        self.assertEqual(len(list((self.out / "frames").glob("*.jpg"))), 2)
        for record in self.by_id().values():
            if record["status"] != "VALID_IMAGE":
                self.assertEqual((record["file"], record["sha256"], record["coverage"]["state"]), (None, None, "NOT_ASSESSED"))
        self.assertEqual(self.verify(), 3)

        retry = FakeService()
        code, _ = self.run_tool(retry)
        self.assertEqual((code, len(retry.calls)), (0, 8), "only failed frames are requested again")

    def test_transient_errors_are_retried_a_bounded_number_of_times(self):
        busy = (503, {}, b"")
        service = FakeService({"AMS_1956-1957": [urllib.error.URLError("reset"), ok(encode(textured(4)))],
                               "OLISTAT": [busy]})
        code, _ = self.run_tool(service)
        self.assertEqual(code, 3)
        self.assertEqual(self.by_id()["ams1956"]["status"], "VALID_IMAGE")
        self.assertEqual(self.by_id()["olistat"]["status"], "HTTP_ERROR")
        self.assertEqual(service.calls.count("OLISTAT"), m.ATTEMPTS)

    def test_rate_limit_is_respected(self):
        short = (429, {"retry-after": "7"}, b"")
        self.run_tool(FakeService({"OLISTAT": [short, ok(encode(textured(5)))]}))
        self.assertIn(7, self.sleeps)

        self.out = self.tmp / "limited"
        service = FakeService({"OLISTAT": [(429, {"retry-after": "3600"}, b"")]})
        code, report = self.run_tool(service)
        self.assertEqual(code, 3)
        self.assertEqual(service.calls, ["PNOA2006", "AMS_1956-1957", "OLISTAT"], "the run stops asking")
        self.assertEqual(self.by_id()["olistat"]["status"], "RATE_LIMITED")
        self.assertEqual(report["counts"]["not_attempted"], 7)

    def test_identical_requests_are_downloaded_once(self):
        manifest = example()
        twin = copy.deepcopy(manifest["sequence"]["frames"][-1])
        twin["coverage_id"] = "2023_again"
        manifest["sequence"]["frames"].append(twin)
        path = self.tmp / "twin.json"
        path.write_text(json.dumps(manifest), encoding="utf-8")
        service = FakeService()
        code, report = self.run_tool(service, path)
        self.assertEqual((code, len(service.calls)), (0, 10))
        self.assertEqual(self.by_id()["2023_again"]["file"], self.by_id()["2023"]["file"])
        self.assertEqual(len(self.package()["order"]["sequence"]), 10)
        self.assertTrue(any("identical image bytes" in w for w in report["warnings"]))
        self.assertEqual(self.run_tool(offline, path)[0], 0)

    def test_empty_response_is_reported_not_hidden(self):
        white = ok(encode(Image.new("RGB", (W, H), (255, 255, 255))))
        code, report = self.run_tool(FakeService({"PNOA2011": [white]}))
        self.assertEqual(code, 0, "technically valid image")
        self.assertEqual(self.by_id()["2011"]["status"], "VALID_IMAGE")
        self.assertEqual(self.by_id()["2011"]["coverage"]["state"], "EMPTY_BLANK")
        self.assertIn("2011: coverage EMPTY_BLANK", report["warnings"])


@unittest.skipIf(Image is None, "Pillow is not installed")
class CoverageDiagnosisTests(unittest.TestCase):
    def diagnose(self, paint, fmt="JPEG"):
        image = Image.new("RGB", (640, 400), (90, 110, 80))
        paint(ImageDraw.Draw(image))
        return m.diagnose_coverage(Image.open(io.BytesIO(encode(image, fmt))))

    def test_states(self):
        white = (255, 255, 255)
        self.assertEqual(self.diagnose(lambda d: d.rectangle([0, 0, 639, 399], fill=white))["state"], "EMPTY_BLANK")
        self.assertEqual(self.diagnose(lambda d: d.rectangle([400, 0, 639, 399], fill=white))["state"], "SUSPECTED_PARTIAL")
        textured_only = self.diagnose(lambda d: None)
        self.assertEqual((textured_only["state"], textured_only["flags"]), ("COVERAGE_UNVERIFIED", ["UNIFORM_IMAGE"]))

    def test_white_surfaces_are_not_called_missing_coverage(self):
        white = (255, 255, 255)
        roof = self.diagnose(lambda d: d.rectangle([300, 180, 340, 220], fill=white))
        self.assertEqual((roof["state"], roof["flags"]), ("COVERAGE_UNVERIFIED", []))
        speckle = self.diagnose(lambda d: [d.point((x, y), fill=white) for x in range(0, 640, 2) for y in range(400)], "PNG")
        self.assertEqual(speckle["state"], "COVERAGE_UNVERIFIED")
        self.assertAlmostEqual(speckle["near_white_pixel_fraction"], 0.5)
        hall = self.diagnose(lambda d: d.rectangle([160, 80, 480, 320], fill=white))
        self.assertEqual((hall["state"], hall["flags"]), ("COVERAGE_UNVERIFIED", ["INTERIOR_FLAT_WHITE"]))

    def test_transparent_png_is_empty(self):
        self.assertEqual(m.diagnose_coverage(Image.new("RGBA", (64, 64), (0, 0, 0, 0)))["state"], "EMPTY_BLANK")


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.server.seen.append(self.path)
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "/target")
        elif self.path == "/target":
            self.send_response(200)
        else:
            self.send_response(503)
            self.send_header("Retry-After", "2")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *args):
        pass


class TransportTests(unittest.TestCase):
    """The real fetcher, against loopback only."""

    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        cls.server.seen = []
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_redirects_are_not_followed_and_error_statuses_are_returned(self):
        status, headers, _ = m.fetch(self.base + "/redirect", timeout=5)
        self.assertEqual((status, headers["location"]), (302, "/target"))
        self.assertNotIn("/target", self.server.seen)
        status, headers, _ = m.fetch(self.base + "/busy", timeout=5)
        self.assertEqual((status, headers["retry-after"]), (503, "2"))


class IsolationTests(unittest.TestCase):
    def test_the_web_app_does_not_reference_the_tool(self):
        files = [ROOT / "index.html", ROOT / "package.json", *(ROOT / "js").rglob("*.js")]
        for path in files:
            self.assertNotIn("temporal_materialization", path.read_text(encoding="utf-8"), path.name)


if __name__ == "__main__":
    unittest.main()
