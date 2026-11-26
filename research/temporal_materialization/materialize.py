#!/usr/bin/env python3
"""Madrid Urban Time Machine, Gate 4B: materialize a temporal manifest.

Reads a Gate 4A manifest (docs/TEMPORAL_MANIFEST.md), downloads exactly the WMS
images it lists, checks each one, georeferences it and records its hash.

    python materialize.py --manifest manifest.json --output package/
    python materialize.py --verify package/            # offline, no downloads

Standalone: nothing in the Lens web runtime imports this. Pillow is needed to
materialize (to decode images); ``--verify`` uses the standard library only.
See README.md for the package layout and the limits of every claim.

Exit codes: 0 all frames valid / package intact; 2 manifest or output directory
refused (nothing downloaded); 3 package incomplete; 4 integrity failure.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import http.client
import io
import json
import math
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

TOOL = {"name": "madrid-temporal-materializer", "version": "1.0.0"}
PACKAGE_SCHEMA = {"id": "urn:madrid-urban-evidence-lens:materialized-package", "version": "1.0.0"}
SCHEMA_PATH = pathlib.Path(__file__).resolve().parents[2] / "docs" / "schemas" / "temporal-manifest.v1.schema.json"

MANIFEST_VERSIONS = {"1.0.0"}
# The only destination this tool will contact. Redirects are refused, not followed.
SERVICE_URL = "https://www.ign.es/wms/pnoa-historico"
GETMAP_KEYS = {"service", "version", "request", "layers", "styles", "format",
               "transparent", "crs", "bbox", "width", "height"}
FORMATS = {"image/jpeg": ("JPEG", ".jpg", ".jgw"), "image/png": ("PNG", ".png", ".pgw")}
MAX_SIDE = 4096          # the service's MaxWidth / MaxHeight
MAX_COVERAGES = 20       # the Lens catalogue has 13; anything far above is not a Lens sequence
MAX_RESPONSE_BYTES = 64 * 1024 * 1024
EARTH_RADIUS = 6378137.0
WEB_MERCATOR_LIMIT = math.pi * EARTH_RADIUS

TIMEOUT_S = 90
ATTEMPTS = 3
MAX_RETRY_AFTER_S = 60
PAUSE_S = 1.0            # between consecutive requests to the provider
USER_AGENT = f"{TOOL['name']}/{TOOL['version']}"

# Coverage heuristic (README.md, "Coverage diagnosis"). Not a coverage measurement.
NEAR_WHITE = 250         # darkest channel at or above this counts as near-white
BLOCK = 16               # a block is "flat white" only if every pixel in it is near-white
EMPTY_FRACTION = 0.999
PARTIAL_BLOCK_FRACTION = 0.005

# EPSG:3857 as written by GDAL 3.12 (WKT1_GDAL) and its ESRI form.
WKT_GDAL = ('PROJCS["WGS 84 / Pseudo-Mercator",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],'
            'AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],'
            'AUTHORITY["EPSG","4326"]],PROJECTION["Mercator_1SP"],PARAMETER["central_meridian",0],PARAMETER["scale_factor",1],PARAMETER["false_easting",0],'
            'PARAMETER["false_northing",0],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Easting",EAST],AXIS["Northing",NORTH],'
            'EXTENSION["PROJ4","+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs"],AUTHORITY["EPSG","3857"]]')
WKT_ESRI = ('PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],'
            'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Mercator_Auxiliary_Sphere"],PARAMETER["False_Easting",0.0],'
            'PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",0.0],PARAMETER["Standard_Parallel_1",0.0],PARAMETER["Auxiliary_Sphere_Type",0.0],UNIT["Meter",1.0]]')

PACKAGE_LIMITATIONS = [
    ("RECEIVED_BYTES_ONLY", "The package preserves the bytes the service returned at the recorded retrieval time. That is not the original flight imagery."),
    ("REPEATABLE_REQUEST_NOT_PIXELS", "The same request can be repeated; the provider may return different pixels later."),
    ("INTEGRITY_NOT_AUTHENTICITY", "Hashes detect later alteration or corruption of these files. They are not a signature and prove nothing about the provider."),
    ("COVERAGE_NOT_MEASURED", "The coverage state is a heuristic about near-white blocks. It is not a coverage percentage and cannot confirm full coverage."),
    ("RETRIEVAL_DATE_IS_NOT_ACQUISITION_DATE", "retrieved_at is when the file was downloaded. The acquisition year or flight interval is in date, as the manifest states it."),
    ("NO_CHANGE_MEASUREMENT", "Differences between frames are not measured change."),
    ("NO_3D_NOT_LIDAR_COREGISTERED", "2D orthophotos. Do not drape them over, or mix them with, contemporary LiDAR geometry without an explicit warning: neither the epochs nor the registration match."),
]


class Refused(Exception):
    """The input or output cannot be used. Nothing is downloaded."""

    def __init__(self, problems):
        self.problems = [problems] if isinstance(problems, str) else list(problems)
        super().__init__("; ".join(self.problems))


class Altered(Refused):
    """An existing package no longer matches its records. Nothing is written."""


class FrameError(Exception):
    def __init__(self, code, message, retryable=False, retry_after=None, response=None):
        super().__init__(message)
        self.code, self.retryable, self.retry_after = code, retryable, retry_after
        self.response = response


# ---------------------------------------------------------------- manifest

# The keywords the Gate 4A schema uses. An unknown keyword is an error, so a
# future schema cannot be half-checked in silence.
_ANNOTATIONS = {"$schema", "$id", "title", "description", "$defs", "format"}
_CHECKS = {"$ref", "type", "const", "enum", "pattern", "minimum", "required", "properties",
           "additionalProperties", "items", "minItems", "maxItems"}
_TYPES = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
}


def schema_errors(value, schema, root, path="$"):
    unknown = set(schema) - _ANNOTATIONS - _CHECKS
    if unknown:
        raise Refused(f"schema uses keywords this tool cannot check: {sorted(unknown)}")
    if "$ref" in schema:
        return schema_errors(value, root["$defs"][schema["$ref"].rsplit("/", 1)[1]], root, path)
    errors = []
    if "type" in schema:
        types = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        if not any(_TYPES[t](value) for t in types):
            return [f"{path}: expected {' or '.join(types)}"]
    if "const" in schema and value != schema["const"]:
        errors.append(f"{path}: must be {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: must be one of {schema['enum']}")
    if "pattern" in schema and isinstance(value, str) and not re.search(schema["pattern"], value):
        errors.append(f"{path}: does not match {schema['pattern']}")
    if "minimum" in schema and _TYPES["number"](value) and value < schema["minimum"]:
        errors.append(f"{path}: below minimum {schema['minimum']}")
    if isinstance(value, dict):
        properties = schema.get("properties", {})
        errors += [f"{path}: missing {key}" for key in schema.get("required", []) if key not in value]
        for key, item in value.items():
            if key in properties:
                errors += schema_errors(item, properties[key], root, f"{path}.{key}")
            elif schema.get("additionalProperties") is False:
                errors.append(f"{path}: unexpected field {key}")
    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0) or len(value) > schema.get("maxItems", len(value)):
            errors.append(f"{path}: wrong number of items")
        if "items" in schema:
            for i, item in enumerate(value):
                errors += schema_errors(item, schema["items"], root, f"{path}[{i}]")
    return errors


def parse_json_strict(data: bytes):
    def unique(pairs):
        out = {}
        for key, value in pairs:
            if key in out:
                raise ValueError(f"duplicate key {key!r}")
            out[key] = value
        return out

    def no_constant(name):
        raise ValueError(f"non-finite number {name}")

    return json.loads(data.decode("utf-8"), object_pairs_hook=unique, parse_constant=no_constant)


def mercator(lon, lat):
    return (EARTH_RADIUS * math.radians(lon),
            EARTH_RADIUS * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)))


def url_errors(url, coverage, manifest, where):
    """A GetMap URL is used verbatim, so every part of it must match the manifest."""
    if not url.isascii() or any(ord(c) <= 32 for c in url):
        return [f"{where}: URL contains spaces, control or non-ASCII characters"]
    if not url.startswith(SERVICE_URL + "?") or "#" in url:
        return [f"{where}: URL is not the contracted service {SERVICE_URL}"]
    try:
        pairs = urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query, keep_blank_values=True, strict_parsing=True)
    except ValueError as exc:
        return [f"{where}: unreadable URL ({exc})"]
    query = dict(pairs)
    if len(query) != len(pairs) or set(query) != GETMAP_KEYS:
        return [f"{where}: URL must carry exactly the parameters {sorted(GETMAP_KEYS)}, once each"]
    image, view = manifest["image"], manifest["view"]
    expected = {"service": "WMS", "version": "1.3.0", "request": "GetMap", "layers": coverage["layer"],
                "styles": "", "format": image["format"], "transparent": "false", "crs": view["crs"],
                "width": str(image["width"]), "height": str(image["height"])}
    errors = [f"{where}: URL {k}={query[k]!r} disagrees with the manifest ({v!r})"
              for k, v in expected.items() if query[k] != v]
    try:
        bbox = [float(v) for v in query["bbox"].split(",")]
    except ValueError:
        bbox = None
    if bbox != view["bbox"]:
        errors.append(f"{where}: URL bbox disagrees with view.bbox")
    return errors


def manifest_errors(manifest, schema):
    if not isinstance(manifest, dict) or not isinstance(manifest.get("schema"), dict):
        return ["$: not a temporal manifest (no schema object)"]
    declared = manifest["schema"]
    if declared.get("id") != "urn:madrid-urban-evidence-lens:temporal-manifest" or declared.get("version") not in MANIFEST_VERSIONS:
        return [f"$.schema: unsupported {declared.get('id')} {declared.get('version')}; supported versions: {sorted(MANIFEST_VERSIONS)}"]
    errors = schema_errors(manifest, schema, schema)
    if errors:
        return errors

    view, image, service = manifest["view"], manifest["image"], manifest["service"]
    minx, miny, maxx, maxy = view["bbox"]
    width, height = image["width"], image["height"]
    if not (-WEB_MERCATOR_LIMIT <= minx < maxx <= WEB_MERCATOR_LIMIT and -WEB_MERCATOR_LIMIT <= miny < maxy <= WEB_MERCATOR_LIMIT):
        return ["$.view.bbox: not an ordered [minE, minN, maxE, maxN] inside EPSG:3857"]
    if not (1 <= width <= MAX_SIDE and 1 <= height <= MAX_SIDE):
        return [f"$.image: width and height must be within 1..{MAX_SIDE}"]

    west, south, east, north = view["bbox_geographic"]["bbox"]
    centre = view["centre"]
    if not all(-180 <= v <= 180 for v in (west, east, centre["longitude"])) or \
            not all(-85.06 <= v <= 85.06 for v in (south, north, centre["latitude"])):
        return ["$.view: geographic coordinates out of range (check axis order)"]
    projected = [*mercator(west, south), *mercator(east, north)]
    if any(abs(a - b) > 0.1 for a, b in zip(projected, view["bbox"])):
        errors.append("$.view.bbox_geographic: does not match view.bbox (check axis order)")
    cx, cy = mercator(centre["longitude"], centre["latitude"])
    if abs(cx - (minx + maxx) / 2) > 0.1 or abs(cy - (miny + maxy) / 2) > 0.1:
        errors.append("$.view.centre: is not the centre of view.bbox")
    px, py = (maxx - minx) / width, (maxy - miny) / height
    if abs(px - py) / px > 1 / min(width, height):
        errors.append("$.image: width and height do not match the bbox aspect ratio")
    if abs(px - image["mercator_units_per_pixel"]) > 1e-5:
        errors.append("$.image.mercator_units_per_pixel: does not match bbox / width")

    if image["format"] not in FORMATS:
        errors.append(f"$.image.format: unsupported {image['format']!r}")
    if service["format"] != image["format"]:
        errors.append("$.service.format: differs from image.format")
    if service["url"] != SERVICE_URL:
        errors.append(f"$.service.url: only {SERVICE_URL} is allowed")
    if width > service["max_width"] or height > service["max_height"]:
        errors.append("$.image: larger than the service maximum in the manifest")

    frames = manifest["sequence"]["frames"]
    coverages = [("$.reference", manifest["reference"])] + [(f"$.sequence.frames[{i}]", f) for i, f in enumerate(frames)]
    if len(coverages) > MAX_COVERAGES:
        return errors + [f"$.sequence.frames: more than {MAX_COVERAGES} coverages"]
    seen = set()
    for where, coverage in coverages:
        cid = coverage["coverage_id"]
        if not re.fullmatch(r"[A-Za-z0-9_]{1,40}", cid):
            errors.append(f"{where}.coverage_id: {cid!r} is not a safe identifier")
        if cid.lower() in seen:
            errors.append(f"{where}.coverage_id: duplicate {cid!r}")
        seen.add(cid.lower())
        if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,80}", coverage["layer"]):
            errors.append(f"{where}.layer: not a single safe layer name")
        date = coverage["date"]
        if date["start_year"] > date["end_year"] or (date["kind"] == "annual_mosaic" and date["start_year"] != date["end_year"]):
            errors.append(f"{where}.date: inconsistent years")
        errors += url_errors(coverage["getmap_url"], coverage, manifest, f"{where}.getmap_url")
    order = [(f["date"]["start_year"], f["date"]["end_year"], f["documented_extent"] == "madrid_city") for f in frames]
    if order != sorted(order):
        errors.append("$.sequence.frames: not in the documented chronological order")
    return errors


def load_manifest(path: pathlib.Path):
    try:
        data = path.read_bytes()
        manifest = parse_json_strict(data)
    except (OSError, ValueError, UnicodeError) as exc:
        raise Refused(f"cannot read manifest: {exc}") from exc
    errors = manifest_errors(manifest, json.loads(SCHEMA_PATH.read_text(encoding="utf-8")))
    if errors:
        raise Refused(errors)
    return data, manifest


def plan(manifest):
    """Reference first, then the sequence in manifest order. Names are deterministic."""
    extension = FORMATS[manifest["image"]["format"]][1]
    items = [{"role": "reference", "sequence_index": None, "stem": "ref", "coverage": manifest["reference"]}]
    items += [{"role": "frame", "sequence_index": i, "stem": f"f{i + 1:02d}", "coverage": c}
              for i, c in enumerate(manifest["sequence"]["frames"])]
    for item in items:
        item["name"] = f"{item['stem']}_{item['coverage']['coverage_id']}{extension}"
    return items


# ---------------------------------------------------------------- georeferencing

def georeference(manifest):
    """North-up affine of the requested image. WMS BBOX is the outer pixel EDGE."""
    minx, miny, maxx, maxy = manifest["view"]["bbox"]
    width, height = manifest["image"]["width"], manifest["image"]["height"]
    px, py = (maxx - minx) / width, (maxy - miny) / height
    cos_lat = math.cos(math.radians(manifest["view"]["centre"]["latitude"]))
    return {
        "crs": "EPSG:3857",
        "axis_order": ["easting", "northing"],
        "bbox": list(manifest["view"]["bbox"]),
        "width": width,
        "height": height,
        "pixel_size_mercator_units": [px, py],
        "approx_ground_m_per_pixel_at_centre": [round(px * cos_lat, 4), round(py * cos_lat, 4)],
        "gdal_geotransform": [minx, px, 0.0, maxy, 0.0, -py],
        # World files locate the CENTRE of the upper-left pixel: A, D, B, E, C, F.
        "world_file": [px, 0.0, 0.0, -py, minx + px / 2, maxy - py / 2],
    }


def sidecars(name, spatial, image_format):
    """File name -> text. World file (geometry), .prj (ESRI) and .aux.xml (CRS for GDAL/QGIS)."""
    stem = name.rsplit(".", 1)[0]
    srs = WKT_GDAL.replace("&", "&amp;").replace("<", "&lt;").replace('"', "&quot;")
    return {
        stem + FORMATS[image_format][2]: "".join(f"{v!r}\n" for v in spatial["world_file"]),
        stem + ".prj": WKT_ESRI + "\n",
        name + ".aux.xml": f'<PAMDataset>\n  <SRS dataAxisToSRSAxisMapping="1,2">{srs}</SRS>\n</PAMDataset>\n',
    }


# ---------------------------------------------------------------- download and checks

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def fetch(url, timeout=TIMEOUT_S):
    """One GET, no redirects. Returns (status, lower-cased headers, body)."""
    opener = urllib.request.build_opener(_NoRedirect)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with opener.open(request, timeout=timeout) as response:
            status, headers, body = response.status, response.headers, response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as exc:
        with exc:
            status, headers, body = exc.code, exc.headers, exc.read(4096)
    return status, {k.lower(): v for k, v in headers.items()}, body


def response_summary(status, headers):
    keep = ("content-type", "content-length", "date", "last-modified", "etag", "retry-after", "location")
    return {"status": status, **{k: headers[k] for k in keep if k in headers}}


def check_response(status, headers, body, image_format, width, height):
    """HTTP 200 proves nothing: decode the bytes. Returns the decoded Pillow image."""
    from PIL import Image  # lazy: --verify and manifest validation do not need it

    info = response_summary(status, headers)

    def fail(code, message, **kwargs):
        raise FrameError(code, message, response=info, **kwargs)

    content_type = headers.get("content-type", "").split(";")[0].strip().lower()
    if 300 <= status < 400:
        fail("REDIRECT_REFUSED", f"HTTP {status} to {headers.get('location')!r}; redirects are not followed")
    if status != 200:
        after = headers.get("retry-after", "").strip()
        # A Retry-After this tool cannot read as seconds is treated as "too long".
        fail("RATE_LIMITED" if status == 429 else "HTTP_ERROR", f"HTTP {status}",
             retryable=status in (429, 500, 502, 503, 504),
             retry_after=int(after) if after.isdigit() else (math.inf if after else None))
    if "xml" in content_type or body.lstrip()[:1] == b"<":
        text = " ".join(re.sub(r"<[^>]*>", " ", body[:2000].decode("utf-8", "replace")).split())
        fail("SERVICE_EXCEPTION", text[:300] or "XML response instead of an image")
    if content_type != image_format:
        fail("CONTENT_TYPE_MISMATCH", f"asked for {image_format}, got {content_type or 'no content type'}")
    if len(body) > MAX_RESPONSE_BYTES:
        fail("TOO_LARGE", "response larger than the size limit")
    declared = headers.get("content-length", "")
    if declared.isdigit() and int(declared) != len(body):
        fail("DECODE_ERROR", f"incomplete body: {len(body)} of {declared} bytes", retryable=True)
    trailer = b"\xff\xd9" if image_format == "image/jpeg" else b"IEND\xaeB`\x82"
    if not body.rstrip(b"\x00").endswith(trailer):
        fail("DECODE_ERROR", "image is truncated (no end marker)", retryable=True)
    try:
        image = Image.open(io.BytesIO(body))
        actual_format, size = image.format, image.size
        if actual_format != FORMATS[image_format][0]:
            fail("CONTENT_TYPE_MISMATCH", f"bytes are {actual_format}, not {image_format}")
        if size != (width, height):  # checked before decoding any pixels
            fail("DIMENSION_MISMATCH", f"asked for {width}x{height}, got {size[0]}x{size[1]}")
        image.load()
    except FrameError:
        raise
    except Exception as exc:  # Pillow raises many types for corrupt input
        fail("DECODE_ERROR", f"cannot decode: {exc}")
    return image


def diagnose_coverage(image):
    """Conservative. Can say "empty" or "suspect"; can never say "covered"."""
    from PIL import Image, ImageChops

    rgba = image.convert("RGBA")
    flat = Image.new("RGB", rgba.size, (255, 255, 255))
    flat.paste(rgba, mask=rgba.getchannel("A"))  # fully transparent counts as blank
    r, g, b = flat.split()
    blank = ImageChops.darker(ImageChops.darker(r, g), b).point(lambda v: 255 if v >= NEAR_WHITE else 0)
    fraction = blank.histogram()[255] / (image.width * image.height)

    blocks = blank.reduce(BLOCK)
    cols, rows = blocks.size
    full = {i for i, v in enumerate(blocks.tobytes()) if v == 255}
    stack = [i for i in full if i % cols in (0, cols - 1) or i // cols in (0, rows - 1)]
    edge = set(stack)
    while stack:
        i = stack.pop()
        x, y = i % cols, i // cols
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            j = ny * cols + nx
            if 0 <= nx < cols and 0 <= ny < rows and j in full and j not in edge:
                edge.add(j)
                stack.append(j)
    edge_fraction = len(edge) / (cols * rows)
    interior_fraction = (len(full) - len(edge)) / (cols * rows)

    flags = []
    if fraction >= EMPTY_FRACTION:
        state = "EMPTY_BLANK"
    elif edge_fraction >= PARTIAL_BLOCK_FRACTION:
        state = "SUSPECTED_PARTIAL"
    else:
        state = "COVERAGE_UNVERIFIED"
        if interior_fraction >= PARTIAL_BLOCK_FRACTION:
            flags.append("INTERIOR_FLAT_WHITE")
        if all(low == high for low, high in flat.getextrema()):
            flags.append("UNIFORM_IMAGE")
    return {
        "state": state,
        "near_white_pixel_fraction": round(fraction, 6),
        "edge_connected_flat_white_block_fraction": round(edge_fraction, 6),
        "interior_flat_white_block_fraction": round(interior_fraction, 6),
        "flags": flags,
    }


def download(url, spec, fetcher, sleep, counter):
    """Bounded retries for transient failures only."""
    for attempt in range(1, ATTEMPTS + 1):
        try:
            counter["requests"] += 1
            try:
                status, headers, body = fetcher(url)
            except (OSError, http.client.HTTPException) as exc:  # URLError, timeout, reset, short read
                raise FrameError("NETWORK_ERROR", f"{type(exc).__name__}: {exc}", retryable=True) from exc
            image = check_response(status, headers, body, *spec)
            return body, image, response_summary(status, headers)
        except FrameError as error:
            too_long = error.retry_after is not None and error.retry_after > MAX_RETRY_AFTER_S
            if not error.retryable or too_long or attempt == ATTEMPTS:
                raise
            sleep(error.retry_after if error.retry_after is not None else 2 ** attempt)


# ---------------------------------------------------------------- package

def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_atomic(path: pathlib.Path, data: bytes):
    part = path.with_name(path.name + ".part")
    with open(part, "wb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(part, path)


def json_bytes(value) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


_DOWNLOADED = ("status", "file", "sidecars", "sha256", "bytes", "retrieved_at", "response", "coverage", "superseded")
_FRAME_FILE = re.compile(r"frames/[A-Za-z0-9_][A-Za-z0-9_.-]*")


def read_checksums(path: pathlib.Path):
    """-> ({relative path: sha256}, [problems]). A listed path cannot leave the package."""
    listed, problems = {}, []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  ((?:frames/)?[A-Za-z0-9_][A-Za-z0-9_.-]*)", line)
        if match:
            listed[match[2]] = match[1]
        else:
            problems.append(f"unreadable checksum line: {line!r}")
    return listed, problems


def write_checksums(path: pathlib.Path, sums):
    write_atomic(path, "".join(f"{h}  {p}\n" for p, h in sorted(sums.items())).encode("utf-8"))


def recorded_hashes(package):
    """Every hash the materialized manifest itself records."""
    required = {"source-manifest.json": package["source_manifest"]["sha256"]}
    for frame in package["frames"]:
        if frame["status"] == "VALID_IMAGE":
            required[frame["file"]] = frame["sha256"]
            required.update(frame["sidecars"])
    return required


def check_before_resume(out: pathlib.Path):
    """A resume rewrites the records and checksums, so everything it would build on must
    first still be what a run wrote. A missing frame file is allowed (it is fetched or
    regenerated); an altered one is not.

    save() writes checksums.sha256.next, then the two JSON files, then renames the list
    into place, so a run killed in between matches one of the two lists.
    """
    committed, pending = out / "checksums.sha256", out / "checksums.sha256.next"
    manifest, report = out / "materialized-manifest.json", out / "validation-report.json"
    if not manifest.is_file():
        if committed.is_file():
            raise Altered(f"{manifest.name} is missing")
        return
    lists = [read_checksums(p) for p in (committed, pending) if p.is_file()]
    digest = sha256(manifest.read_bytes())
    match = next((found for found in lists if found[0].get(manifest.name) == digest), None)
    if match is None:
        raise Altered(f"{manifest.name} does not match checksums.sha256")
    listed, problems = dict(match[0]), list(match[1])
    if report.is_file():
        actual = sha256(report.read_bytes())
        if actual not in [found[0].get(report.name) for found in lists]:
            problems.append(f"altered: {report.name}")
        listed[report.name] = actual
    problems += [f"altered: {relative}" for relative, expected in listed.items()
                 if (out / relative).is_file() and sha256((out / relative).read_bytes()) != expected]
    try:
        required = recorded_hashes(json.loads(manifest.read_text(encoding="utf-8")))
        problems += [f"checksum list disagrees with the manifest: {p}" for p, h in required.items() if listed.get(p) != h]
    except (ValueError, KeyError, TypeError, AttributeError) as exc:
        problems.append(f"{manifest.name} unreadable: {exc}")
    if problems:
        raise Altered(problems)
    if pending.is_file():  # finish the interrupted save
        write_checksums(committed, listed)
        pending.unlink()


def prepare_output(out: pathlib.Path, source: bytes):
    """A new or empty directory, or a package of this same manifest. Returns prior records."""
    copy = out / "source-manifest.json"
    if copy.exists():
        if copy.read_bytes() != source:
            raise Refused(f"{out} holds a package of a different manifest; choose another --output")
    elif out.exists() and (not out.is_dir() or any(p.suffix != ".part" for p in out.iterdir())):
        raise Refused(f"{out} is not empty and is not a materialized package; nothing was overwritten")
    if copy.exists():
        check_before_resume(out)  # before anything is written
    else:
        out.mkdir(parents=True, exist_ok=True)
        write_atomic(copy, source)
    (out / "frames").mkdir(exist_ok=True)
    previous = out / "materialized-manifest.json"
    if not previous.exists():
        return {}
    try:
        records = {f["coverage_id"]: f for f in json.loads(previous.read_text(encoding="utf-8"))["frames"]}
        for record in records.values():
            # A recorded path is used for file access: it must stay inside frames/.
            if record["status"] == "VALID_IMAGE" and not _FRAME_FILE.fullmatch(record["file"]):
                raise ValueError(f"unsafe recorded path {record['file']!r}")
            record.update({k: record[k] for k in _DOWNLOADED})
        return records
    except (ValueError, KeyError, TypeError) as exc:
        raise Refused(f"{previous} is unreadable ({exc}); restore it or choose another --output") from exc


def frame_record(item, manifest, spatial):
    coverage = item["coverage"]
    return {
        "coverage_id": coverage["coverage_id"],
        "role": item["role"],
        "sequence_index": item["sequence_index"],
        "layer": coverage["layer"],
        "service_layer_title": coverage["service_layer_title"],
        "product": coverage["product"],
        "date": coverage["date"],
        "documented_extent": coverage["documented_extent"],
        "nominal_resolution_m": coverage["nominal_resolution_m"],
        "request_url": coverage["getmap_url"],
        "crs": spatial["crs"],
        "bbox": spatial["bbox"],
        "width": spatial["width"],
        "height": spatial["height"],
        "pixel_size_mercator_units": spatial["pixel_size_mercator_units"],
        "approx_ground_m_per_pixel_at_centre": spatial["approx_ground_m_per_pixel_at_centre"],
        "licence": manifest["service"]["licence"],
        "attribution": coverage["attribution"],
        "limitations": coverage["limitations"],
        "status": "NOT_ATTEMPTED",
        "file": None,
        "sidecars": {},
        "sha256": None,
        "bytes": None,
        "retrieved_at": None,
        "response": None,
        "coverage": {"state": "NOT_ASSESSED"},
        "superseded": None,  # earlier hash, if a recorded file went missing and was downloaded again
        "error": None,
    }


def reusable(record, old):
    return bool(old) and old["status"] == "VALID_IMAGE" and old.get("request_url") == record["request_url"]


def reuse(out, record, old):
    """Carry over a previously verified file, or raise: nothing is ever overwritten."""
    if not reusable(record, old):
        return False
    target = out / old["file"]
    part = target.with_name(target.name + ".part")
    # Interrupted between recording the file and renaming it into place.
    if not target.exists() and part.exists() and sha256(part.read_bytes()) == old["sha256"]:
        os.replace(part, target)
    if not target.exists():
        return False
    if sha256(target.read_bytes()) != old["sha256"]:
        raise FrameError("INTEGRITY_CONFLICT", f"{old['file']} no longer matches its recorded hash; it was left untouched")
    record.update({k: old[k] for k in _DOWNLOADED})
    return True


def write_sidecars(out, record, spatial, image_format):
    written = {}
    for name, text in sidecars(pathlib.PurePosixPath(record["file"]).name, spatial, image_format).items():
        relative, data = f"frames/{name}", text.encode("utf-8")
        path = out / relative
        if not path.exists():
            write_atomic(path, data)
        elif path.read_bytes() != data:
            raise FrameError("INTEGRITY_CONFLICT", f"{relative} was altered; it was left untouched")
        written[relative] = sha256(data)
    record["sidecars"] = written


def save(out, source, manifest, spatial, records, run):
    valid = [r for r in records if r["status"] == "VALID_IMAGE"]
    by_hash = {}
    for r in valid:
        by_hash.setdefault(r["sha256"], []).append(r["coverage_id"])
    warnings = [f"identical image bytes for {', '.join(ids)}: do not read them as separate observations"
                for ids in by_hash.values() if len(ids) > 1]
    warnings += [f"{r['coverage_id']}: coverage {r['coverage']['state']}" for r in valid
                 if r["coverage"]["state"] != "COVERAGE_UNVERIFIED"]
    warnings += [f"{r['coverage_id']}: {flag}" for r in valid for flag in r["coverage"]["flags"]]
    warnings += [f"{r['coverage_id']}: downloaded again after its file went missing; "
                 f"bytes {'identical' if r['sha256'] == r['superseded']['sha256'] else 'DIFFERENT'}"
                 for r in valid if r["superseded"]]
    complete = len(valid) == len(records) and not any(r["error"] for r in records)

    package = {
        "schema": PACKAGE_SCHEMA,
        "tool": run["tool"],
        "complete": complete,
        "source_manifest": {
            "file": "source-manifest.json",
            "sha256": sha256(source),
            "schema_version": manifest["schema"]["version"],
            "generated_at": manifest["generated_at"],
            "deployment_commit": manifest["generator"]["deployment_commit"],
        },
        "spatial": {**spatial, "pixel_convention": "bbox is the outer edge of the edge pixels; world file values refer to pixel centres; row 0 is north"},
        "service": {k: manifest["service"][k] for k in ("url", "version", "provider", "licence")},
        "order": {"reference": records[0]["coverage_id"], "sequence": [r["coverage_id"] for r in records[1:]]},
        "frames": records,
        "limitations": [{"code": c, "text": t} for c, t in PACKAGE_LIMITATIONS] + manifest["limitations"],
        "reproducibility": {
            "request": "repeatable: request_url per frame",
            "file_integrity": "verifiable offline: checksums.sha256",
            "provider_pixels": "not guaranteed",
        },
    }
    report = {
        "generated_at": utc_now(),
        "complete": complete,
        "counts": {"coverages": len(records), "valid": len(valid),
                   "failed": sum(r["status"] not in ("VALID_IMAGE", "NOT_ATTEMPTED") for r in records),
                   "not_attempted": sum(r["status"] == "NOT_ATTEMPTED" for r in records)},
        "last_run": {"network_requests": run["requests"], "reused_files": run["reused"], "downloaded_files": run["downloaded"]},
        "coverage_heuristic": {"near_white_threshold": NEAR_WHITE, "block_px": BLOCK, "empty_pixel_fraction": EMPTY_FRACTION,
                               "partial_block_fraction": PARTIAL_BLOCK_FRACTION},
        "frames": [{"coverage_id": r["coverage_id"], "status": r["status"], "coverage": r["coverage"], "error": r["error"]} for r in records],
        "warnings": warnings,
    }
    package_bytes, report_bytes = json_bytes(package), json_bytes(report)
    sums = {"source-manifest.json": sha256(source),
            "materialized-manifest.json": sha256(package_bytes),
            "validation-report.json": sha256(report_bytes)}
    for r in valid:
        sums[r["file"]] = r["sha256"]
        sums.update(r["sidecars"])
    pending = out / "checksums.sha256.next"  # see check_before_resume
    write_checksums(pending, sums)
    write_atomic(out / "materialized-manifest.json", package_bytes)
    write_atomic(out / "validation-report.json", report_bytes)
    os.replace(pending, out / "checksums.sha256")
    return report


def materialize(manifest_path, out, fetcher=fetch, sleep=time.sleep, log=print):
    source, manifest = load_manifest(pathlib.Path(manifest_path))
    import PIL  # fail before touching the output if the decoder is missing

    out = pathlib.Path(out)
    previous = prepare_output(out, source)
    spatial = georeference(manifest)
    image_format = manifest["image"]["format"]
    spec = (image_format, spatial["width"], spatial["height"])
    items = plan(manifest)
    records = [frame_record(item, manifest, spatial) for item in items]
    # Keep what is already on record, so an interruption never forgets a verified file.
    for record in records:
        old = previous.get(record["coverage_id"])
        if reusable(record, old):
            record.update({k: old[k] for k in _DOWNLOADED})
    run = {"tool": {**TOOL, "pillow": PIL.__version__}, "requests": 0, "reused": 0, "downloaded": 0, "conflict": False}
    by_url, stopped = {}, False

    for item, record in zip(items, records):
        url = record["request_url"]
        old = previous.get(record["coverage_id"])
        try:
            if url in by_url:  # identical request: one download, one file
                record.update({k: by_url[url][k] for k in _DOWNLOADED})
            elif reuse(out, record, old):
                write_sidecars(out, record, spatial, image_format)
                run["reused"] += 1
            elif stopped:
                record.update(frame_record(item, manifest, spatial))
            else:
                relative = f"frames/{item['name']}"
                if (out / relative).exists():
                    raise FrameError("INTEGRITY_CONFLICT", f"{relative} exists but no run recorded it; it was left untouched")
                record.update(frame_record(item, manifest, spatial))
                if run["requests"]:
                    sleep(PAUSE_S)
                body, image, response = download(url, spec, fetcher, sleep, run)
                part = out / (relative + ".part")
                part.write_bytes(body)  # the provider's bytes, never re-encoded
                record.update({"file": relative, "sha256": sha256(body), "bytes": len(body),
                               "retrieved_at": utc_now(), "response": response, "coverage": diagnose_coverage(image)})
                if old and old["sha256"]:  # recorded before, but the file is gone
                    record["superseded"] = {"sha256": old["sha256"], "retrieved_at": old["retrieved_at"]}
                write_sidecars(out, record, spatial, image_format)
                record["status"] = "VALID_IMAGE"
                save(out, source, manifest, spatial, records, run)  # record first, then rename
                os.replace(part, out / relative)
                run["downloaded"] += 1
            if record["status"] == "VALID_IMAGE":
                by_url[url] = record
        except FrameError as error:
            if error.code == "INTEGRITY_CONFLICT":
                run["conflict"] = True
                if reusable(record, old):
                    # Keep the original record, so the next run and --verify still see the mismatch.
                    record.update({k: old[k] for k in _DOWNLOADED})
                else:
                    record.update(frame_record(item, manifest, spatial), status=error.code)
            else:
                record.update(frame_record(item, manifest, spatial), status=error.code, response=error.response)
            record["error"] = str(error)
            stopped = stopped or error.code == "RATE_LIMITED"
        log(f"{record['coverage_id']:>12}  {record['status']:<18} {record['coverage']['state']}"
            + (f"  {record['error']}" if record["error"] else ""))
        save(out, source, manifest, spatial, records, run)

    report = save(out, source, manifest, spatial, records, run)
    code = 4 if run["conflict"] else (0 if report["complete"] else 3)
    return code, report


def verify(out, log=print):
    """Offline integrity check. Never opens a network connection."""
    out = pathlib.Path(out)
    sums_path = out / "checksums.sha256"
    if not sums_path.is_file():
        log(f"FAIL: {sums_path} is missing; not a materialized package")
        return 4
    listed, problems = read_checksums(sums_path)
    for relative, expected in listed.items():
        path = out / relative
        if not path.is_file():
            problems.append(f"missing: {relative}")
        elif sha256(path.read_bytes()) != expected:
            problems.append(f"altered: {relative}")
    complete = False
    try:
        package = json.loads((out / "materialized-manifest.json").read_text(encoding="utf-8"))
        complete = package["complete"]
        problems += [f"checksum list disagrees with the manifest: {p}"
                     for p, h in recorded_hashes(package).items() if listed.get(p) != h]
        problems += [f"not covered by checksums: {n}" for n in ("materialized-manifest.json", "validation-report.json") if n not in listed]
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        problems.append(f"materialized-manifest.json unreadable: {exc}")
    for path in sorted(out.rglob("*")):
        relative = path.relative_to(out).as_posix()
        if path.is_file() and path != sums_path and relative not in listed:
            log(f"note: unlisted file {relative}")
    for problem in problems:
        log(f"FAIL: {problem}")
    if problems:
        return 4
    log(f"OK: {len(listed)} files match their hashes" + ("" if complete else "; the package is INCOMPLETE"))
    return 0 if complete else 3


def main(argv=None):
    parser = argparse.ArgumentParser(description="Materialize a Madrid Urban Evidence Lens temporal manifest.")
    parser.add_argument("--manifest", help="temporal manifest JSON exported by Lens (never modified)")
    parser.add_argument("--output", help="package directory: new, empty, or a previous run of this manifest")
    parser.add_argument("--verify", metavar="PACKAGE", help="check a package's hashes offline and exit")
    args = parser.parse_args(argv)
    if args.verify:
        if args.manifest or args.output:
            parser.error("--verify takes no other option")
        return verify(args.verify)
    if not (args.manifest and args.output):
        parser.error("--manifest and --output are required")
    try:
        code, report = materialize(args.manifest, args.output)
    except Altered as error:
        print("INTEGRITY FAILURE, nothing was written:", *error.problems, sep="\n  ", file=sys.stderr)
        return 4
    except Refused as error:
        print("REFUSED:", *error.problems, sep="\n  ", file=sys.stderr)
        return 2
    except ImportError:
        print("Pillow is required: pip install -r requirements.txt", file=sys.stderr)
        return 2
    counts, last = report["counts"], report["last_run"]
    print(f"{counts['valid']}/{counts['coverages']} valid; {last['downloaded_files']} downloaded, "
          f"{last['reused_files']} reused, {last['network_requests']} requests; {len(report['warnings'])} warnings")
    for warning in report["warnings"]:
        print("warning:", warning)
    return code


if __name__ == "__main__":
    sys.exit(main())
