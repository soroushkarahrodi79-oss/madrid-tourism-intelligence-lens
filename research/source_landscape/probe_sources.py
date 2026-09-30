#!/usr/bin/env python3
"""Gate C0 feasibility probe: is a candidate source technically usable at all?

Run on demand against the LIVE official sources; it is not part of the test
suite and nothing in the application depends on it. It exists to separate two
things Gate C0 must never confuse:

    "looks promising from the description"   vs   "technically usable"

    TARGET LIST -> BOUNDED FETCH -> TRANSPORT FACTS -> SCHEMA FINGERPRINT
    -> COMPACT JSON REPORT

    python research/source_landscape/probe_sources.py
    python research/source_landscape/probe_sources.py --family A --family B
    python research/source_landscape/probe_sources.py --id dataestur_apidata_root

What it deliberately does NOT do
--------------------------------
* It does not ingest. Nothing it fetches reaches data/ or the application.
* It does not download a whole dataset. Every request is capped (see
  DEFAULT_MAX_BYTES and the per-target `max_bytes`), and the cap is recorded in
  the report so a truncated read is never mistaken for a complete one.
* It does not write raw upstream payloads to disk. Only transport facts and
  schema fingerprints are persisted. A body prefix is kept only for `html` and
  `unknown` targets, where it is the only way to tell an API page from a
  JavaScript shell, and it is truncated to BODY_PREFIX_CHARS.
* It does not authenticate. No target may carry a key, token or credential;
  a target whose URL looks like it carries one is refused before the request
  is made (see _refuse_if_credentialed).
* It does not assert quality, authority or fitness. Those are judgements for
  the Gate C0 report. This script only records what the wire returned.

Why transport facts are recorded separately from schema
-------------------------------------------------------
Gate C0 must keep four dates apart: the source's own reference period, its
publication/update date, the moment WE retrieved it, and the resource's server
state. Only the last two are observable here, so only those are written:
`retrieved_at` (our clock) and `last_modified` / `etag` (the server's claim).
A reference period is a documentation fact and is filled in by the analyst, not
by this script, which is why there is no field for it here.

Exit status is 0 whenever the run completed, even if every target failed:
a refusal, a 404 or a blocked host is itself a Gate C0 finding and must be
recorded rather than raised. Only an unusable invocation exits non-zero.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import pathlib
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
TARGETS_PATH = HERE / "probe_targets.json"
REPORT_PATH = HERE / "probe_report.json"

# A probe is a metadata read, not a download. 256 KiB is enough for an ESRI
# service descriptor, an OGC API landing page, a WFS GetCapabilities head or a
# CSV header row, and far too small to constitute ingestion of any of them.
DEFAULT_MAX_BYTES = 256 * 1024
BODY_PREFIX_CHARS = 600
TIMEOUT_S = 45
USER_AGENT = (
    "madrid-tourism-intelligence-lens/gate-c0-source-probe "
    "(research; bounded metadata probe; contact via repository issues)"
)

# Anything that would make a probe carry a secret. Gate C0 forbids credentials
# anywhere in the repository, so a credentialed target is refused rather than
# silently probed and then redacted.
CREDENTIAL_HINTS = re.compile(
    r"(?:^|[?&])(api[_-]?key|apikey|key|token|access[_-]?token|secret|password|passwd|auth)=",
    re.IGNORECASE,
)


def _utc_now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _refuse_if_credentialed(url: str) -> str | None:
    """Return a refusal reason, or None when the URL is safe to request."""
    if CREDENTIAL_HINTS.search(url):
        return "refused: URL appears to carry a credential parameter"
    parsed = urllib.parse.urlsplit(url)
    if parsed.username or parsed.password:
        return "refused: URL carries userinfo credentials"
    if parsed.scheme not in ("http", "https"):
        return f"refused: unsupported scheme {parsed.scheme!r}"
    return None


def _fetch(url: str, max_bytes: int) -> dict:
    """Bounded GET. Returns transport facts plus at most max_bytes of body."""
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            # Ask the server to stop early where it honours Range. Servers that
            # ignore it are handled by the bounded read below, so correctness
            # never depends on Range support.
            "Range": f"bytes=0-{max_bytes - 1}",
            "Accept": "*/*",
        },
        method="GET",
    )
    context = ssl.create_default_context()
    started = time.monotonic()
    with urllib.request.urlopen(request, timeout=TIMEOUT_S, context=context) as response:
        body = response.read(max_bytes)
        elapsed_ms = round((time.monotonic() - started) * 1000)
        headers = response.headers
        declared = headers.get("Content-Length")
        try:
            declared_len = int(declared) if declared is not None else None
        except ValueError:
            declared_len = None
        return {
            "ok": True,
            "http_status": response.status,
            "final_url": response.url,
            "content_type": headers.get("Content-Type"),
            "content_length_header": declared_len,
            "content_range_header": headers.get("Content-Range"),
            "last_modified": headers.get("Last-Modified"),
            "etag": headers.get("ETag"),
            "bytes_read": len(body),
            "body_truncated": len(body) >= max_bytes,
            "elapsed_ms": elapsed_ms,
            "_body": body,
        }


def _fingerprint_json(body: bytes, truncated: bool) -> dict:
    """Schema shape of a JSON body. Refuses to guess when the read was cut."""
    if truncated:
        return {
            "parsed": False,
            "reason": "body truncated at the probe cap; no schema claimed",
        }
    try:
        doc = json.loads(body.decode("utf-8", errors="strict"))
    except (ValueError, UnicodeDecodeError) as exc:
        return {"parsed": False, "reason": f"not valid UTF-8 JSON: {exc}"}

    out: dict = {"parsed": True, "root_type": type(doc).__name__}
    if isinstance(doc, dict):
        out["root_keys"] = sorted(doc.keys())[:80]
        # GeoJSON and ESRI both answer the two questions Gate C0 cares about
        # first: what geometry, and what attribute fields.
        if isinstance(doc.get("features"), list):
            out["feature_count_in_probe"] = len(doc["features"])
            first = doc["features"][0] if doc["features"] else None
            if isinstance(first, dict):
                props = first.get("properties")
                if props is None and isinstance(first.get("attributes"), dict):
                    props = first["attributes"]
                if isinstance(props, dict):
                    out["feature_fields"] = sorted(props.keys())[:120]
                geom = first.get("geometry")
                if isinstance(geom, dict):
                    out["geometry_type"] = geom.get("type")
        if isinstance(doc.get("fields"), list):
            out["esri_fields"] = [
                {"name": f.get("name"), "type": f.get("type"), "alias": f.get("alias")}
                for f in doc["fields"]
                if isinstance(f, dict)
            ][:120]
        for key in ("geometryType", "name", "title", "description", "copyrightText",
                    "currentVersion", "maxRecordCount", "crs", "extent"):
            if key in doc:
                out[key] = doc[key] if not isinstance(doc[key], (dict, list)) else "<present>"
    elif isinstance(doc, list):
        out["root_length"] = len(doc)
        if doc and isinstance(doc[0], dict):
            out["first_item_keys"] = sorted(doc[0].keys())[:120]
    return out


def _fingerprint_delimited(body: bytes, truncated: bool) -> dict:
    """Header row of a CSV/TSV. Valid even when the read was truncated, because
    the header is the first line; the truncation flag is still reported."""
    text = body.decode("utf-8-sig", errors="replace")
    first_line = text.splitlines()[0] if text.splitlines() else ""
    counts = {d: first_line.count(d) for d in (";", ",", "\t", "|")}
    delimiter = max(counts, key=counts.get) if any(counts.values()) else None
    fields = [f.strip().strip('"') for f in first_line.split(delimiter)] if delimiter else []
    return {
        "parsed": bool(fields),
        "header_only": True,
        "body_truncated": truncated,
        "delimiter": delimiter,
        "field_count": len(fields),
        "fields": fields[:120],
    }


def _fingerprint_xml(body: bytes, truncated: bool) -> dict:
    """Root element and first child tags, read without an XML parser so a
    truncated document does not raise. Namespaces are kept verbatim."""
    text = body.decode("utf-8", errors="replace")
    tags = re.findall(r"<([A-Za-z_][\w.:-]*)", text)
    root = tags[0] if tags else None
    seen: list[str] = []
    for tag in tags[1:]:
        if tag not in seen:
            seen.append(tag)
        if len(seen) >= 40:
            break
    return {
        "parsed": root is not None,
        "body_truncated": truncated,
        "root_element": root,
        "distinct_child_tags": seen,
    }


def _fingerprint(kind: str, body: bytes, truncated: bool) -> dict:
    if kind in ("json", "esri", "ogc", "geojson"):
        return _fingerprint_json(body, truncated)
    if kind in ("csv", "tsv"):
        return _fingerprint_delimited(body, truncated)
    if kind in ("xml", "wms", "wfs"):
        return _fingerprint_xml(body, truncated)
    # html / binary / unknown: report only what can be seen without claiming
    # a schema. A body prefix is the evidence that distinguishes a real API
    # response from a portal's JavaScript shell.
    text = body.decode("utf-8", errors="replace")
    return {
        "parsed": False,
        "body_truncated": truncated,
        "body_prefix": re.sub(r"\s+", " ", text[:BODY_PREFIX_CHARS]).strip(),
    }


def probe(target: dict) -> dict:
    url = target["url"]
    max_bytes = int(target.get("max_bytes", DEFAULT_MAX_BYTES))
    record = {
        "id": target["id"],
        "family": target.get("family"),
        "dataset": target.get("dataset"),
        "url": url,
        "kind": target.get("kind", "unknown"),
        "probe_question": target.get("probe_question"),
        "max_bytes": max_bytes,
        "retrieved_at": _utc_now(),
    }

    refusal = _refuse_if_credentialed(url)
    if refusal:
        record.update({"ok": False, "error": refusal})
        return record

    try:
        result = _fetch(url, max_bytes)
    except urllib.error.HTTPError as exc:
        record.update({
            "ok": False,
            "http_status": exc.code,
            "error": f"HTTP {exc.code} {exc.reason}",
            "content_type": exc.headers.get("Content-Type") if exc.headers else None,
        })
        return record
    except Exception as exc:  # network, TLS, proxy policy, DNS, timeout
        record.update({"ok": False, "error": f"{type(exc).__name__}: {exc}"})
        return record

    body = result.pop("_body")
    record.update(result)
    record["fingerprint"] = _fingerprint(record["kind"], body, result["body_truncated"])
    return record


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--family", action="append", default=[],
                        help="restrict to a source family letter (repeatable)")
    parser.add_argument("--id", action="append", default=[],
                        help="restrict to a target id (repeatable)")
    parser.add_argument("--targets", type=pathlib.Path, default=TARGETS_PATH)
    parser.add_argument("--out", type=pathlib.Path, default=REPORT_PATH)
    args = parser.parse_args(argv)

    if not args.targets.exists():
        print(f"targets file not found: {args.targets}", file=sys.stderr)
        return 2
    targets = json.loads(args.targets.read_text(encoding="utf-8"))["targets"]

    if args.family:
        wanted = {f.upper() for f in args.family}
        targets = [t for t in targets if str(t.get("family", "")).upper() in wanted]
    if args.id:
        wanted_ids = set(args.id)
        targets = [t for t in targets if t["id"] in wanted_ids]
    if not targets:
        print("no targets selected", file=sys.stderr)
        return 2

    results = []
    for target in targets:
        record = probe(target)
        results.append(record)
        status = "ok" if record.get("ok") else "FAIL"
        detail = record.get("error") or record.get("content_type") or ""
        print(f"[{status:4}] {record['id']:<42} {detail}", file=sys.stderr)

    report = {
        "probe_contract_version": "1.0.0",
        "purpose": (
            "Gate C0 technical-feasibility observations. Transport facts and schema "
            "fingerprints only. Not ingestion, not a quality judgement, and not a "
            "statement of any source's reference period."
        ),
        "run_at": _utc_now(),
        "targets_probed": len(results),
        "targets_ok": sum(1 for r in results if r.get("ok")),
        "results": results,
    }
    args.out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {args.out} ({report['targets_ok']}/{report['targets_probed']} ok)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
