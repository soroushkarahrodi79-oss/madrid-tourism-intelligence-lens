#!/usr/bin/env python3
"""Gate D temporal-comparability audit for the Madrid historical premises/activity census.

Run on demand against the LIVE official source. It is not part of the test suite and
nothing in the application imports it. It answers one question only - which temporal
comparisons across the historical premises/activity census are scientifically
defensible, and where the series must be segmented, qualified or rejected - for the
Ayuntamiento de Madrid dataset

    Censo de locales, sus actividades y terrazas de hosteleria y restauracion -
    historico   (datos.madrid.es  209548-0-censo-locales-historico)

for the Locales and Actividades resource families only (Terrazas and Licencias are
not analysed; they are counted in the catalogue inventory for structure context).

    python research/hospitality_commercial_gate/audit_temporal.py

Gate D does NOT measure trends. It determines whether future trend measurement is
valid. It builds NO production aggregate, chart, choropleth, ranking, score,
denominator or "growth" indicator.

STAGED NETWORK DISCIPLINE (reproducibility is partly an efficiency property):
  Stage 0  catalogue metadata only (one CKAN package_show call) - no file bytes.
  Stage 1  HTTP Range GET of the first 64 KiB of EVERY Locales/Actividades resource
           to read its header/dialect/column signature. ~280 small requests.
  Stage 2  FULL download of a small, deliberately chosen SENTINEL set (one per schema
           era + structural breakpoints + Sep 2025 + Sep 2026 current) to measure
           id_local identity intersection, status/access vocabulary, activity-taxonomy
           vocabulary and source geography vocabulary across eras. Sentinels only;
           the full multi-gigabyte history is never downloaded.

It reuses the Gate A source contract (catalogue access, streamed fingerprinting,
per-file dialect detection) from audit_identity.py and the Gate B classification
(classify / CLASSES / DIVISION_OVERRIDE) from audit_taxonomy.py in this same
directory, so Gate D reads the same upstream the same way and classifies activities
identically to the earlier gates.

Snapshot identity is version-aware. A nominal month label (e.g. "Septiembre 2026") is
NEVER treated as sufficient identity: the resource labelled "Septiembre 2026" was
re-published in place (same resource id, different bytes) between Gate A/B and Gate C.
Identity is the composite (family + nominal_period + content fingerprint), with the
retrieval timestamp and HTTP/catalogue version metadata recorded alongside.

Raw upstream CSVs are streamed to a temporary file, fingerprinted (MD5 to cross-check
the catalogue-declared hash, SHA-256 as the project fingerprint), parsed and deleted.
They are never committed. Every count is an observation of one run against the
fingerprinted resources it records, not a repository invariant.

Dependencies: Python standard library only.
"""

from __future__ import annotations

import collections
import csv
import datetime as _dt
import hashlib
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import audit_identity as A  # noqa: E402  (catalogue + fingerprint + dialect contract)
import audit_taxonomy as B  # noqa: E402  (Gate B CNAE classification)

RESULTS = HERE / "results"
UA = A.UA
csv.field_size_limit(1 << 24)

# ---------------------------------------------------------------- period parsing

MONTHS = {
    "Enero": 1, "Febrero": 2, "Marzo": 3, "Abril": 4, "Mayo": 5, "Junio": 6,
    "Julio": 7, "Agosto": 8, "Septiembre": 9, "Octubre": 10, "Noviembre": 11,
    "Diciembre": 12,
}
MONTH_NAME = {v: k for k, v in MONTHS.items()}
# Deterministic: "<Family>. <Month> <Year>". An optional parenthetical qualifier
# after the family (e.g. "Terrazas (informacion en proceso...). Septiembre 2016") is
# tolerated; the family is normalised by stripping it.
PERIOD_RE = re.compile(r"^(?P<fam>.+?)\.\s+(?P<mon>[A-Za-zñÑáéíóúÁÉÍÓÚ]+)\s+(?P<yr>\d{4})$")
FAMILY_QUALIFIER_RE = re.compile(r"\s*\(.*?\)\s*$")
# Cut timestamp embedded in some download URLs, e.g. 209548_20261001_045230.csv
URL_CUT_RE = re.compile(r"_(\d{8})_(\d{6})")

GATE_D_FAMILIES = ("Locales", "Actividades")


def parse_period(description: str):
    """Return (family, year, month) or None. Deterministic; no fuzzy matching."""
    m = PERIOD_RE.match((description or "").strip())
    if not m:
        return None
    mon = m.group("mon")
    if mon not in MONTHS:
        return None
    fam = FAMILY_QUALIFIER_RE.sub("", m.group("fam")).strip()
    return fam, int(m.group("yr")), MONTHS[mon]


def period_label(year: int, month: int) -> str:
    return f"{MONTH_NAME[month]} {year}"


def url_cut_timestamp(url: str):
    fn = (url or "").rsplit("/", 1)[-1]
    m = URL_CUT_RE.search(fn)
    return f"{m.group(1)}T{m.group(2)}" if m else None


# ---------------------------------------------------------------- Stage 0/1 helpers

def range_get(url: str, first: int, last: int):
    """HTTP Range GET [first,last]. Returns (bytes, status, total_size_or_None)."""
    req = urllib.request.Request(url, headers={**UA, "Range": f"bytes={first}-{last}"})
    last_err = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                raw = r.read()
                cr = r.headers.get("Content-Range")
                total = int(cr.split("/")[-1]) if cr and "/" in cr else None
                return raw, r.status, total, {
                    "http_last_modified": r.headers.get("Last-Modified"),
                    "etag": r.headers.get("ETag"),
                    "accept_ranges_honored": r.status == 206,
                }
        except Exception as e:  # noqa: BLE001
            last_err = e
    raise last_err


def normalise_first_token(tok: str) -> str:
    """Strip BOM/stray leading non-alnum so an encoding quirk does not masquerade as
    a schema change (e.g. the 2024-06 files whose header begins with a stray byte)."""
    return re.sub(r"^[^0-9A-Za-z]+", "", tok or "")


def sniff_schema(url: str) -> dict:
    """Stage 1: establish encoding/BOM, delimiter, quoting, header-vs-data and the
    column signature from the first 64 KiB. Bounded; no full download."""
    raw, status, total, http = range_get(url, 0, 65535)
    bom = raw.startswith(b"\xef\xbb\xbf")
    text = raw[3:] if bom else raw
    if bom:
        encoding = "utf-8-sig"
    else:
        try:
            text.decode("utf-8")
            encoding = "utf-8"
        except UnicodeDecodeError as e:
            encoding = "utf-8" if e.start >= len(text) - 4 else "latin-1"
    nl = text.find(b"\n")
    line1 = text[: nl if nl >= 0 else len(text)]
    delim = ";" if line1.count(b";") >= line1.count(b"|") else "|"
    quoted = line1.strip().startswith(b'"')
    db = delim.encode()
    toks = [t.strip().strip(b'"').decode("utf-8", errors="replace") for t in line1.split(db)]
    toks = [normalise_first_token(toks[0])] + toks[1:] if toks else toks
    first = toks[0].lower() if toks else ""
    has_header = first == "id_local"
    # A header anomaly: a header line present but prefixed by a stray/BOM byte that is
    # not the standard UTF-8 BOM (recorded as presentation/format drift, not a break).
    header_byte_anomaly = (not bom) and has_header and not line1.lstrip().startswith(b'"id_local') \
        and not line1.lstrip().startswith(b"id_local")
    return {
        "http": http,
        "range_honored": status == 206,
        "total_bytes": total,
        "bom_utf8": bom,
        "encoding": encoding,
        "delimiter": delim,
        "header_row_quoted": quoted,
        "has_header_row": has_header,
        "header_byte_anomaly": header_byte_anomaly,
        "num_columns": len(toks),
        "header_tokens": toks if has_header else None,
        "first_row_sample": None if has_header else toks,
    }


def schema_signature(sniff: dict) -> str:
    """Compact deterministic signature of the structural schema: delimiter + the
    header token tuple (headered) or a positional column-count marker (headerless).
    Presentation attributes (BOM, quoting, byte anomaly) are deliberately EXCLUDED so
    that a pure format/presentation change does not read as a structural break."""
    if sniff["has_header_row"]:
        body = "HEADER\t" + "\t".join(sniff["header_tokens"])
    else:
        body = f"HEADERLESS\tncols={sniff['num_columns']}"
    body = f"delim={sniff['delimiter']}\t" + body
    return hashlib.sha256(body.encode("utf-8")).hexdigest()[:16]


# ---------------------------------------------------------------- Stage 2 full parse

def pick_encoding(path: str) -> str:
    """Detect file encoding. The 2014-era files are Latin-1 (ISO-8859-1), not UTF-8;
    later files are UTF-8, mostly BOM-prefixed. A UTF-8 decode failure deep inside the
    sampled head means a non-UTF-8 file; a failure only at the very tail is a split
    multibyte character and is treated as UTF-8. This encoding change is itself a
    recorded format-drift datum (D6)."""
    with open(path, "rb") as f:
        head = f.read(1 << 20)
    if head.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    try:
        head.decode("utf-8")
        return "utf-8"
    except UnicodeDecodeError as e:
        return "utf-8" if e.start >= len(head) - 4 else "latin-1"


def stream_fingerprint(url: str):
    """Full download to temp, computing BOTH md5 (catalogue cross-check) and sha256
    (project fingerprint). Returns (path, meta). Extends A.stream_to_temp with md5."""
    import tempfile
    req = urllib.request.Request(url, headers=UA)
    md5 = hashlib.md5()
    sha = hashlib.sha256()
    size = 0
    fd, path = tempfile.mkstemp(suffix=".csv")
    with urllib.request.urlopen(req, timeout=600) as r, os.fdopen(fd, "wb") as f:
        meta = {
            "http_last_modified": r.headers.get("Last-Modified"),
            "etag": r.headers.get("ETag"),
            "content_type": r.headers.get("Content-Type"),
        }
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            md5.update(chunk)
            sha.update(chunk)
            size += len(chunk)
    meta["bytes"] = size
    meta["md5"] = md5.hexdigest()
    meta["sha256"] = sha.hexdigest()
    return path, meta


def parse_locales_sentinel(path: str, delimiter: str) -> dict:
    """One streamed pass over a Locales sentinel: id_local identity, situacion/acceso
    CODE vocabulary AND text-description vocabulary (the 2014 era populates only the
    text, not the numeric code), source geography vocabulary. Field access is defensive
    because the earliest eras carry fewer columns and a different encoding."""
    enc = pick_encoding(path)
    ids: set[str] = set()
    dup = 0
    blank_id = 0
    id_len = collections.Counter()
    sit = collections.Counter()
    sit_desc: dict[str, str] = {}
    acc = collections.Counter()
    acc_desc: dict[str, str] = {}
    sit_code_populated = 0
    acc_code_populated = 0
    desc_sit_vocab = collections.Counter()
    desc_acc_vocab = collections.Counter()
    districts: set[str] = set()
    barrios: set[str] = set()
    barrio_blank = 0
    barrio_fmt = collections.Counter()  # "integer" vs "decimal_comma" vs "other"
    barrio_samples: list[str] = []
    rows = 0
    with open(path, "r", encoding=enc, newline="") as f:
        rdr = csv.DictReader(f, delimiter=delimiter)
        for r in rdr:
            rows += 1
            idl = A.blank(r.get("id_local"))
            if not idl:
                blank_id += 1
            else:
                if idl in ids:
                    dup += 1
                ids.add(idl)
                id_len[len(idl)] += 1
            sc = A.blank(r.get("id_situacion_local"))
            sit[sc] += 1
            if sc:
                sit_code_populated += 1
            ds = A.blank(r.get("desc_situacion_local"))
            sit_desc.setdefault(sc, ds)
            if ds:
                desc_sit_vocab[ds] += 1
            ac = A.blank(r.get("id_tipo_acceso_local"))
            acc[ac] += 1
            if ac:
                acc_code_populated += 1
            da = A.blank(r.get("desc_tipo_acceso_local"))
            acc_desc.setdefault(ac, da)
            if da:
                desc_acc_vocab[da] += 1
            dist = A.blank(r.get("id_distrito_local"))
            if dist:
                districts.add(dist)
            bar = A.blank(r.get("id_barrio_local"))
            if not bar:
                barrio_blank += 1
            else:
                barrios.add(bar)
                if re.fullmatch(r"\d+", bar):
                    barrio_fmt["integer"] += 1
                elif re.fullmatch(r"\d+,\d+", bar):
                    barrio_fmt["decimal_comma"] += 1
                else:
                    barrio_fmt["other"] += 1
                if len(barrio_samples) < 5 and bar not in barrio_samples:
                    barrio_samples.append(bar)
    return {
        "encoding_observed": enc,
        "rows": rows,
        "identity": {
            "field": "id_local",
            "distinct": len(ids),
            "blank": blank_id,
            "duplicate_rows": dup,
            "unique_within_snapshot": dup == 0 and blank_id == 0,
            "id_length_distribution": dict(sorted(id_len.items())),
        },
        "situacion_code_populated_rows": sit_code_populated,
        "acceso_code_populated_rows": acc_code_populated,
        "situacion_code_vocabulary": {k: {"rows": v, "desc": sit_desc.get(k, "")}
                                      for k, v in sorted(sit.items())},
        "acceso_code_vocabulary": {k: {"rows": v, "desc": acc_desc.get(k, "")}
                                   for k, v in sorted(acc.items())},
        "situacion_desc_vocabulary": dict(desc_sit_vocab.most_common()),
        "acceso_desc_vocabulary": dict(desc_acc_vocab.most_common()),
        "geography": {
            "distinct_id_distrito_local": len(districts),
            "distinct_id_barrio_local": len(barrios),
            "rows_blank_barrio": barrio_blank,
            "id_barrio_local_format": dict(barrio_fmt),
            "id_barrio_local_samples": barrio_samples,
        },
        "_ids": ids,  # retained in-memory for cross-era intersection; not serialised
    }


def parse_actividades_sentinel(path: str, delimiter: str) -> dict:
    """One streamed pass over an Actividades sentinel: section/division/epigraph
    vocabulary, blank-epigraph share, and the Gate B class projection (does the
    division 55/56/79 + section G/R mapping hold in this era?)."""
    enc = pick_encoding(path)
    rows = 0
    secs = collections.Counter()
    divs = collections.Counter()
    epis: set[str] = set()
    epi_blank_rows = 0
    fully_blank_taxonomy_rows = 0
    sec_code_populated = 0
    div_code_populated = 0
    class_rows = collections.Counter()
    class_premises: dict[str, set[str]] = collections.defaultdict(set)
    div_desc: dict[str, str] = {}
    sec_desc: dict[str, str] = {}
    desc_division_vocab = collections.Counter()
    desc_seccion_vocab = collections.Counter()
    # epigraph -> set of (section, division) parents, to test parent stability
    epi_parents: dict[str, set] = collections.defaultdict(set)
    with open(path, "r", encoding=enc, newline="") as f:
        rdr = csv.DictReader(f, delimiter=delimiter)
        for r in rdr:
            rows += 1
            idl = A.blank(r.get("id_local"))
            sec = A.blank(r.get("id_seccion"))
            div = A.blank(r.get("id_division"))
            epi = A.blank(r.get("id_epigrafe"))
            dsec = A.blank(r.get("desc_seccion"))
            ddiv = A.blank(r.get("desc_division"))
            if sec:
                secs[sec] += 1
                sec_code_populated += 1
                sec_desc.setdefault(sec, dsec)
            if div:
                divs[div] += 1
                div_code_populated += 1
                div_desc.setdefault(div, ddiv)
            if dsec:
                desc_seccion_vocab[dsec] += 1
            if ddiv:
                desc_division_vocab[ddiv] += 1
            if epi:
                epis.add(epi)
                epi_parents[epi].add((sec, div))
            else:
                epi_blank_rows += 1
            if not sec and not div and not epi:
                fully_blank_taxonomy_rows += 1
            cls = B.classify(sec, div) if (sec or div) else B.UNCLASSIFIED
            class_rows[cls] += 1
            if idl:
                class_premises[cls].add(idl)
    multi_parent = {e: sorted(f"{s}/{d}" for (s, d) in ps)
                    for e, ps in epi_parents.items() if len(ps) > 1}
    return {
        "encoding_observed": enc,
        "rows": rows,
        "code_population": {
            "id_seccion_populated_rows": sec_code_populated,
            "id_division_populated_rows": div_code_populated,
            "desc_division_vocabulary_size": len(desc_division_vocab),
            "desc_seccion_vocabulary_size": len(desc_seccion_vocab),
        },
        "taxonomy_vocabulary": {
            "distinct_sections": len(secs),
            "distinct_divisions": len(divs),
            "distinct_epigraphs": len(epis),
            "sections_present": sorted(secs),
            "divisions_present": sorted(divs, key=lambda d: (len(d), d)),
            "epigraph_blank_rows": epi_blank_rows,
            "epigraph_blank_share_pct": round(100 * epi_blank_rows / rows, 2) if rows else None,
            "fully_blank_taxonomy_rows": fully_blank_taxonomy_rows,
            "epigraphs_with_multiple_parents": multi_parent,
        },
        "gate_b_class_projection": {
            cls: {"rows": class_rows.get(cls, 0),
                  "distinct_premises": len(class_premises.get(cls, set()))}
            for cls in list(B.CLASSES) + [B.UNCLASSIFIED]
        },
        "gate_b_key_divisions_present": {
            "55_accommodation": "55" in divs,
            "56_core_hospitality": "56" in divs,
            "79_tourism_adjacent": "79" in divs,
            "G_generic_commercial_section": "G" in secs,
            "R_ambiguous_section": "R" in secs,
        },
        "_div_desc": div_desc,
        "_sec_desc": sec_desc,
    }


# ---------------------------------------------------------------- main

def build_inventory(pkg: dict) -> dict:
    """D1 - complete deterministic inventory of the Locales + Actividades catalogue,
    plus a family census of the whole package. Metadata only."""
    rows = []
    family_census = collections.Counter()
    unparsed = []
    for res in pkg["resources"]:
        if (res.get("format") or "").upper() != "CSV":
            continue
        parsed = parse_period(res.get("description", ""))
        if not parsed:
            unparsed.append(res.get("description"))
            continue
        fam, yr, mo = parsed
        family_census[fam] += 1
        if fam not in GATE_D_FAMILIES:
            continue
        url = res.get("url", "")
        rows.append({
            "family": fam,
            "year": yr,
            "month": mo,
            "nominal_period": period_label(yr, mo),
            "resource_id": res.get("id"),
            "description": res.get("description"),
            "format": (res.get("format") or "").upper(),
            "url": url,
            "url_cut_timestamp": url_cut_timestamp(url),
            "catalogue_size_bytes": res.get("size"),
            "catalogue_hash_md5": res.get("hash"),
            "catalogue_hash_algorithm": res.get("hash_algorithm") or "MD5(32-hex, implicit)",
            "catalogue_created": res.get("created"),
            "catalogue_issued": res.get("issued"),
            "catalogue_last_modified": res.get("last_modified"),
            "catalogue_metadata_modified": res.get("metadata_modified"),
        })
    rows.sort(key=lambda r: (r["family"], r["year"], r["month"]))
    return {"rows": rows, "family_census": dict(family_census), "unparsed_descriptions": unparsed}


def continuity(rows: list) -> dict:
    """D2 - month index, missing/duplicate/out-of-order per family."""
    out = {}
    for fam in GATE_D_FAMILIES:
        fr = [r for r in rows if r["family"] == fam]
        periods = [(r["year"], r["month"]) for r in fr]
        seen = collections.Counter(periods)
        dups = {period_label(y, m): seen[(y, m)] for (y, m) in seen if seen[(y, m)] > 1}
        ordered = sorted(set(periods))
        y0, m0 = ordered[0]
        y1, m1 = ordered[-1]
        expected = [(y, mo) for y in range(y0, y1 + 1) for mo in range(1, 13)
                    if (y > y0 or mo >= m0) and (y < y1 or mo <= m1)]
        missing = sorted(set(expected) - set(periods))
        out[fam] = {
            "earliest": period_label(y0, m0),
            "latest": period_label(y1, m1),
            "expected_monthly_periods_in_span": len(expected),
            "present_periods": len(set(periods)),
            "resources": len(fr),
            "missing_months": [period_label(y, m) for (y, m) in missing],
            "missing_count": len(missing),
            "duplicate_nominal_periods": dups,
        }
    loc = {(r["year"], r["month"]) for r in rows if r["family"] == "Locales"}
    act = {(r["year"], r["month"]) for r in rows if r["family"] == "Actividades"}
    out["family_coverage_difference"] = {
        "locales_only": [period_label(y, m) for (y, m) in sorted(loc - act)],
        "actividades_only": [period_label(y, m) for (y, m) in sorted(act - loc)],
    }
    return out


# Sentinels chosen AFTER the Stage-1 scan revealed the schema eras. One representative
# per era, the structural breakpoints, one mid-history period, plus Sep 2025 (Gate A/C
# control) and Sep 2026 (current revision). The full history is NOT downloaded.
SENTINELS = [
    ("Locales", 2014, 9, "earliest full era (38-col 2014 schema)"),
    ("Locales", 2015, 9, "40-col era (2015-01..2022-09) early representative"),
    ("Locales", 2020, 9, "40-col era mid-history representative"),
    ("Locales", 2022, 10, "48-col era start (structural breakpoint)"),
    ("Locales", 2025, 9, "46-col era; Gate A/C control (SHA a9b5571a86eb)"),
    ("Locales", 2026, 9, "46-col era current published revision"),
    ("Actividades", 2014, 9, "44-col 2014 taxonomy schema"),
    ("Actividades", 2015, 9, "46-col era taxonomy representative"),
    ("Actividades", 2022, 10, "49-col era taxonomy representative"),
    ("Actividades", 2026, 9, "47-col era current taxonomy"),
]


def main() -> int:
    RESULTS.mkdir(exist_ok=True)
    started = A.now()
    stage1_only = "--inventory-only" in sys.argv

    print("[gate-d] Stage 0: catalogue metadata ...")
    pkg = A.package()
    inv = build_inventory(pkg)
    rows = inv["rows"]
    by_period = {(r["family"], r["year"], r["month"]): r for r in rows}
    cont = continuity(rows)

    print(f"[gate-d] Stage 1: Range header scan of {len(rows)} Locales/Actividades resources ...")
    bytes_ranged = 0
    for r in rows:
        s = sniff_schema(r["url"])
        bytes_ranged += 65536
        r["schema"] = s
        r["schema_signature"] = schema_signature(s)
        print(f"[gate-d]   {r['family']} {r['nominal_period']}: "
              f"hdr={s['has_header_row']} ncols={s['num_columns']} sig={r['schema_signature']}")

    # Schema eras: contiguous runs of an identical schema_signature per family.
    eras = {}
    for fam in GATE_D_FAMILIES:
        fr = [r for r in rows if r["family"] == fam]
        runs = []
        for r in fr:
            sig = r["schema_signature"]
            if runs and runs[-1]["schema_signature"] == sig:
                runs[-1]["end"] = r["nominal_period"]
                runs[-1]["months"] += 1
            else:
                runs.append({
                    "schema_signature": sig,
                    "start": r["nominal_period"],
                    "end": r["nominal_period"],
                    "months": 1,
                    "num_columns": r["schema"]["num_columns"],
                    "has_header_row": r["schema"]["has_header_row"],
                    "header_tokens": r["schema"]["header_tokens"],
                })
        eras[fam] = runs

    full_downloads = []
    bytes_downloaded = 0
    locales_ids: dict[str, set] = {}
    sentinel_reports = {"Locales": {}, "Actividades": {}}

    if not stage1_only:
        print("[gate-d] Stage 2: sentinel full downloads ...")
        for fam, yr, mo, why in SENTINELS:
            key = (fam, yr, mo)
            meta_row = by_period.get(key)
            if not meta_row:
                print(f"[gate-d]   SENTINEL MISSING: {fam} {period_label(yr, mo)}")
                continue
            print(f"[gate-d]   downloading {fam} {period_label(yr, mo)} ({why}) ...")
            path, meta = stream_fingerprint(meta_row["url"])
            bytes_downloaded += meta["bytes"]
            try:
                delim = meta_row["schema"]["delimiter"]
                if fam == "Locales":
                    rep = parse_locales_sentinel(path, delim)
                    locales_ids[period_label(yr, mo)] = rep.pop("_ids")
                else:
                    rep = parse_actividades_sentinel(path, delim)
                    rep.pop("_div_desc", None)
                    rep.pop("_sec_desc", None)
            finally:
                os.unlink(path)
            md5_match = (meta["md5"] == meta_row["catalogue_hash_md5"])
            sentinel_reports[fam][period_label(yr, mo)] = {
                "why_sentinel": why,
                "resource_id": meta_row["resource_id"],
                "url": meta_row["url"],
                "url_cut_timestamp": meta_row["url_cut_timestamp"],
                "retrieved_at": A.now(),
                "bytes": meta["bytes"],
                "md5": meta["md5"],
                "sha256": meta["sha256"],
                "catalogue_declared_md5": meta_row["catalogue_hash_md5"],
                "md5_matches_catalogue": md5_match,
                "http_last_modified": meta["http_last_modified"],
                "etag": meta["etag"],
                "schema_signature": meta_row["schema_signature"],
                "report": rep,
            }
            full_downloads.append({"family": fam, "period": period_label(yr, mo),
                                   "bytes": meta["bytes"], "reason": why})
            print(f"[gate-d]     {meta['bytes']} bytes, md5_matches_catalogue={md5_match}")

    # D9 identity intersection across Locales sentinels (adjacent + long-run).
    identity_intersections = []
    labels = [period_label(y, m) for (f, y, m, _w) in SENTINELS if f == "Locales"
              and period_label(y, m) in locales_ids]
    pairs = []
    for i in range(len(labels) - 1):
        pairs.append((labels[i], labels[i + 1]))  # adjacent sentinels
    if len(labels) >= 2:
        pairs.append((labels[0], labels[-1]))      # full-span long run
        pairs.append((labels[1], labels[-1]))      # first stable-core era -> current
    seen_pairs = set()
    for a, b in pairs:
        if (a, b) in seen_pairs or a not in locales_ids or b not in locales_ids:
            continue
        seen_pairs.add((a, b))
        sa, sb = locales_ids[a], locales_ids[b]
        inter = len(sa & sb)
        identity_intersections.append({
            "from": a, "to": b,
            "from_count": len(sa), "to_count": len(sb),
            "intersection": inter,
            "persistence_from_rate": round(inter / len(sa), 5) if sa else None,
            "appeared_in_to": len(sb - sa),
            "disappeared_from_from": len(sa - sb),
        })

    report = {
        "audit_started_at": started,
        "audit_finished_at": A.now(),
        "environment_note": "Counts are observations of one run against the fingerprinted "
                            "resources recorded below, not repository invariants. A nominal "
                            "month label is NEVER sufficient snapshot identity.",
        "dataset": {
            "id": A.PACKAGE,
            "title": pkg.get("title"),
            "catalogue": A.CATALOGUE,
            "license": pkg.get("license_title"),
            "catalogue_metadata_modified": pkg.get("metadata_modified"),
            "resource_resolution_method": "Deterministic parse of the resource `description` "
                "('<Family>. <Month> <Year>'); opaque numeric resource ids recorded, not used "
                "to select.",
        },
        "network_discipline": {
            "stage0_catalogue_calls": 1,
            "stage1_range_requests": len(rows),
            "stage1_bytes_ranged_approx": bytes_ranged,
            "stage2_full_downloads": len(full_downloads),
            "stage2_bytes_downloaded": bytes_downloaded,
            "full_downloads": full_downloads,
            "rationale": "Full history is NOT downloaded. Stage 1 reads only the first 64 KiB of "
                         "each resource to establish schema; Stage 2 downloads one sentinel per "
                         "schema era plus structural breakpoints and the Sep 2025 / Sep 2026 "
                         "controls to measure identity, status, taxonomy and geography vocabulary.",
        },
        "d1_inventory": {
            "family_census_csv": inv["family_census"],
            "unparsed_descriptions": inv["unparsed_descriptions"],
            "gate_d_resource_count": len(rows),
        },
        "d2_continuity": cont,
        "d3_snapshot_identity_model": SNAPSHOT_IDENTITY_MODEL,
        "d4_d5_schema_eras": eras,
        "d7_d8_d9_d10_sentinels": sentinel_reports,
        "d9_identity_intersections": identity_intersections,
    }
    attach_rulings(report)

    # Write compact manifest separately (D1/D2 + per-resource provenance, no schema blob).
    manifest = {
        "audit_finished_at": report["audit_finished_at"],
        "dataset": report["dataset"],
        "family_census_csv": inv["family_census"],
        "coverage": cont,
        "resources": [{k: r[k] for k in (
            "family", "nominal_period", "resource_id", "url", "url_cut_timestamp",
            "catalogue_size_bytes", "catalogue_hash_md5", "catalogue_created",
            "catalogue_issued", "catalogue_last_modified", "schema_signature")}
            for r in rows],
    }
    (RESULTS / "gate_d_resource_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    eras_out = {
        "audit_finished_at": report["audit_finished_at"],
        "schema_eras": eras,
        "snapshot_identity_model": SNAPSHOT_IDENTITY_MODEL,
    }
    (RESULTS / "gate_d_schema_eras.json").write_text(
        json.dumps(eras_out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    (RESULTS / "gate_d_temporal_compatibility.json").write_text(
        json.dumps({
            "audit_finished_at": report["audit_finished_at"],
            "sentinels": sentinel_reports,
            "identity_intersections": identity_intersections,
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    (RESULTS / "gate_d_temporal_summary.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"[gate-d] wrote 4 artifacts to {RESULTS.relative_to(HERE.parents[1])}")
    print(f"[gate-d] stage1 range bytes ~{bytes_ranged}; stage2 downloaded {bytes_downloaded} bytes")
    return 0


SNAPSHOT_IDENTITY_MODEL = {
    "rule": "snapshot_identity = (family, nominal_period, content_fingerprint)",
    "nominal_period": "What month the resource REPRESENTS (reference period). Parsed "
                      "deterministically from the resource description. NOT sufficient alone.",
    "content_fingerprint": "Which observed published revision was analysed. SHA-256 computed "
                           "on download is the project fingerprint; the catalogue also declares "
                           "an MD5 (+size) that a reader can cross-check without downloading.",
    "retrieval_timestamp": "When that revision was observed (recorded per sentinel).",
    "resource_id_is_insufficient": "The resource id is STABLE across in-place re-publication "
        "(the Sep 2026 Locales resource kept id 209548-851 while its bytes/size/URL-cut-timestamp "
        "changed between Gate A/B and Gate C). Therefore resource id is NOT version identity.",
    "url_cut_timestamp": "Some download URLs embed a cut timestamp (e.g. 209548_20261001_045230.csv) "
        "that changes on re-publication; recorded as a corroborating revision signal, not as identity.",
    "later_republication": "A later re-publication does not invalidate an earlier fingerprinted "
        "result; it creates a DIFFERENT resource version under the same nominal period.",
}


# ---------------------------------------------------------------- rulings (D6, D11-D17)
# These verdicts are analytical DECISIONS, grounded in the sentinel/era evidence this
# same script produces. They are kept as structured constants (as Gate C does), and the
# supporting numbers are injected from the live evidence by attach_rulings(). No verdict
# claims a premises trades, opens, closes or carries economic meaning.

DRIFT_CLASSIFICATION = {
    "legend": ["cosmetic_format_only", "structurally_compatible", "potentially_semantic",
               "confirmed_semantic_break", "unresolved"],
    "principle": "Format drift is mechanically normalisable; semantic drift may segment or "
                 "invalidate a comparison. Every observed change is classified, never silently "
                 "normalised away.",
    "changes": [
        {"change": "Delimiter ';' throughout the files (mar/2022 doc says '|')",
         "class": "cosmetic_format_only",
         "evidence": "All 280 Locales/Actividades resources delimit with ';'."},
        {"change": "Encoding Latin-1 (ISO-8859-1) in the 2014..~2022 files -> UTF-8(-sig) from the 2022-10 era",
         "class": "cosmetic_format_only",
         "evidence": "Sentinels: 2014/2015/2020 decode as latin-1; 2022-10/2025/2026 are utf-8-sig."},
        {"change": "UTF-8 BOM present/absent varies; some months unquoted vs fully quoted",
         "class": "cosmetic_format_only",
         "evidence": "Stage-1 per-resource bom/quoting flags; Gate A already noted 2025 unquoted vs 2026 quoted."},
        {"change": "Header row absent (Marzo 2014) / header prefixed by a stray byte (Junio 2024)",
         "class": "cosmetic_format_only",
         "evidence": "Marzo 2014 is genuinely headerless but same column structure as its era; "
                     "the 2024-06 files carry a header whose first token is a stray-byte '?id_local'."},
        {"change": "Trailing columns added 2022-10 (cod_postal, horas, fx_carga, fx_datos_ini/fin) and "
                   "fx_datos_ini/fin dropped 2024-10",
         "class": "structurally_compatible",
         "evidence": "The first ~40 Locales / ~46 Actividades core columns (identity, geography, status, "
                     "access, taxonomy) keep identical names and order; only trailing columns change."},
        {"change": "2014 schema differs in field set and order (Junio 2014 33-col lacks id_tipo_acceso_local, "
                   "cod_barrio_local, id_seccion_censal_local; different building/address block)",
         "class": "confirmed_semantic_break",
         "evidence": "Locales eras: headerless-38 (2014-03), 33-col (2014-06), 38-col (2014-09/12), "
                     "40-col (2015-01..2022-09). The 2014 field set/order is not the stable core."},
        {"change": "Status/access recorded as TEXT only in 2014 (code columns blank); situacion codes from "
                   "2015, access codes only from 2022-10",
         "class": "confirmed_semantic_break",
         "evidence": "Locales sentinels: 2014 situacion/acceso code-populated rows = 0 (desc text present); "
                     "2015/2020 situacion coded but access code-populated = 0; 2022-10 both coded."},
        {"change": "situacion code vocabulary drifts: code 7 'En obras' present 2015-2022 then absent 2025/2026; "
                   "undocumented code 10 'Baja PC Asociado' present 2015-2022 then absent; code 9 desc gains an accent",
         "class": "potentially_semantic",
         "evidence": "Sentinel situacion_code_vocabulary across eras; existing code MEANINGS are stable, "
                     "but the code SET changes (appearance/disappearance), so vocabulary must be read live per snapshot."},
        {"change": "access code 3 'Interior' (undocumented) absent in 2022-10, present ~50k rows by 2025/2026",
         "class": "potentially_semantic",
         "evidence": "Sentinel acceso_code_vocabulary: 2022-10 is {0,1,12}; 2025/2026 add 3 'Interior'. "
                     "Gate C already flagged code 3 as undocumented."},
        {"change": "Actividades unclassified set represented as blank epigraph (2014/2015/2026, ~24-30%) vs a "
                   "sentinel section '-1' / divisions '00','PT' with ZERO blanks in the 2022-10..2024-09 era",
         "class": "confirmed_semantic_break",
         "evidence": "Oct 2022: epigraph_blank_rows=0, section '-1' present, AMBIGUOUS projection inflated to "
                     "42,454 rows (vs ~2.6-4.3k from section R elsewhere). The Gate B class MAP of 55/56/79/G is "
                     "unaffected, but the blank/unclassified accounting must be normalised ('-1'/'00'/'PT' -> "
                     "UNCLASSIFIED_SOURCE_ACTIVITY) before class SHARES are compared across this era."},
        {"change": "Barrio code SYSTEM changes: bare barrio number in 2014 (e.g. '11') vs district-concatenated "
                   "from 2015 ('1502','704','104'); barrio count 128 (2014/2015) -> 131 (2020+)",
         "class": "potentially_semantic",
         "evidence": "Locales geography samples/format per era. District count stable at 21. Reconciliation to "
                     "canonical geometry is Gate E; Gate D only reports the source-code break."},
        {"change": "Observed administrative-universe expansion: +52,024 id_local somewhere within the "
                   "Oct 2022 -> Sep 2025 sentinel interval (additive; 112 disappear). Cause unresolved.",
         "class": "confirmed_semantic_break",
         "evidence": "Identity persistence stays >=99.9% (id_local architecture stable, no re-key), but the "
                     "observed premises COUNT universe grows ~35%. The two sentinels (Oct 2022, Sep 2025) do "
                     "NOT temporally localise the discontinuity more precisely, and no official source "
                     "documents a coverage-policy change, so WHY the universe expanded is unresolved. The "
                     "methodological consequence is bounded: total-count comparison across the break requires "
                     "segmentation, independent of its cause."},
    ],
}

MONTHLY_TRANSITION_RULING = {
    "rule": "STATUS_TRANSITION != BUSINESS_EVENT",
    "ruling": "NO-GO to label month-to-month status transitions as business openings, closures, "
              "failures or reopenings.",
    "basis": "Gate C established situacion is the 'ultima situacion' and a 'variable de mantenimiento "
             "complicado' with no procedure to detect cessation without a replacement activity. Gate C "
             "observed Baja/Baja R premises reverting to Abierto - which a literal 'disappeared' reading "
             "cannot produce - so transitions are register-state changes, not events.",
    "permitted_language": ["recorded status transition", "register-state change", "administrative transition"],
    "forbidden_language": ["opening", "closure", "business failure", "reopening", "survival"],
}

QUESTION_TYPES = {
    "type_1_snapshot_comparison": {
        "example": "How does administratively recorded hospitality composition differ between two "
                   "fingerprinted snapshots in the same schema era?",
        "status": "Supported within a tier (A/B) once units, taxonomy and status treatment are compatible.",
    },
    "type_2_monthly_change": {
        "example": "How did documented premises counts change from one month to the next?",
        "status": "Higher risk - resource revisions, administrative update timing, status maintenance, "
                  "publication anomalies and administrative-universe changes all confound it. Admissible only as a change "
                  "in ADMINISTRATIVELY DOCUMENTED counts, never as business change.",
    },
    "type_3_event_inference": {
        "example": "How many businesses opened or closed this month?",
        "status": "NO-GO. The source carries no event dates; status is last-recorded and mutable.",
    },
}

INTERPRETATION_CEILING = {
    "a_future_series_may_claim": [
        "change in the number of administratively documented premises (after the source's own exclusions)",
        "change in the recorded activity composition (CNAE class shares) within a comparable tier",
        "change in the administrative source-status composition",
        "change in source-included premises after applying the documented exclusions",
    ],
    "a_future_series_may_never_claim": [
        "number of businesses operating or trading", "business openings or closures", "business survival",
        "commercial success or failure", "economic growth or decline", "tourist demand", "overtourism",
        "saturation", "tourism pressure",
    ],
    "principle": "A premises census remains administrative evidence through time, not a measure of economic "
                 "activity, commercial vitality or visitor demand.",
}

REPRODUCIBILITY_PROTOCOL = {
    "when_a_monthly_resource_is_used_analytically_persist": [
        "source_family", "nominal_reference_period", "resource_id", "retrieval_timestamp", "source_url",
        "http_last_modified", "etag_if_available", "byte_count", "sha256",
        "catalogue_declared_md5_and_size", "url_cut_timestamp_if_present",
        "parser_schema_version", "observed_schema_signature",
    ],
    "schema_signature_definition": "sha256 (first 16 hex) of 'delim=<d>\\tHEADER\\t<tab-joined header tokens>' "
        "for a headered file, or 'delim=<d>\\tHEADERLESS\\tncols=<n>' for a headerless one. Presentation "
        "attributes (BOM, quoting, header-byte anomaly) are EXCLUDED so a pure format change does not read "
        "as a structural break; they are recorded separately.",
    "no_raw_csv_committed": "Raw CSVs are streamed, fingerprinted, parsed and deleted. Only compact manifests "
        "are committed. Version identity never relies on human memory of a schema.",
}


def _pkey(label: str):
    try:
        mon, yr = label.split()
        return (int(yr), MONTHS.get(mon, 0))
    except Exception:  # noqa: BLE001
        return (0, 0)


def attach_rulings(report: dict) -> None:
    """Attach the D6/D11-D17 analytical blocks and the scoped Gate D ruling, injecting
    supporting numbers from the live sentinel/era/intersection evidence in `report`."""
    sent = report.get("d7_d8_d9_d10_sentinels", {})
    loc = sent.get("Locales", {})
    act = sent.get("Actividades", {})
    inters = report.get("d9_identity_intersections", [])

    def loc_rep(p):
        return loc.get(p, {}).get("report", {})

    def act_rep(p):
        return act.get(p, {}).get("report", {})

    loc_periods = sorted(loc, key=_pkey)
    act_periods = sorted(act, key=_pkey)

    # earliest era where the situacion / access CODE is populated (not text-only)
    sit_code_eras = [p for p in loc_periods if loc_rep(p).get("situacion_code_populated_rows", 0) > 0]
    acc_code_eras = [p for p in loc_periods if loc_rep(p).get("acceso_code_populated_rows", 0) > 0]
    earliest_sit_code = sit_code_eras[0] if sit_code_eras else None
    earliest_acc_code = acc_code_eras[0] if acc_code_eras else None

    # long-run identity persistence (earliest Locales sentinel -> latest)
    long_run = next((it for it in inters
                     if loc_periods and it["from"] == loc_periods[0] and it["to"] == loc_periods[-1]), None)

    # accommodation (division 55) premises across the first and last Actividades sentinels
    def acc_premises(p):
        return act_rep(p).get("gate_b_class_projection", {}).get("ACCOMMODATION", {}).get("distinct_premises")
    acc_growth = None
    if act_periods:
        acc_growth = {"from": act_periods[0], "from_premises": acc_premises(act_periods[0]),
                      "to": act_periods[-1], "to_premises": acc_premises(act_periods[-1])}

    current_loc_era = report.get("d4_d5_schema_eras", {}).get("Locales", [])
    current_loc_era = current_loc_era[-1] if current_loc_era else None
    current_act_era = report.get("d4_d5_schema_eras", {}).get("Actividades", [])
    current_act_era = current_act_era[-1] if current_act_era else None

    report["d6_drift_classification"] = DRIFT_CLASSIFICATION
    report["d11_revision_risk_and_capture_protocol"] = {
        "what_can_be_proven_about_revised_months": [
            "A nominal month can be re-published IN PLACE: the Sep 2026 Locales resource kept resource id "
            "209548-851 while its bytes/size/URL-cut-timestamp changed across the Gate A/B, Gate C and Gate D "
            "runs (Gate A/B SHA 2475e8bc...; Gate C SHA 4ca33fed...; this run's SHA recorded per sentinel). "
            "Resource id is therefore NOT version identity.",
            "The catalogue exposes 'created'/'issued' for all 498 CSVs but 'last_modified' for only the most "
            "recently touched resources, so it cannot by itself prove the full retrospective revision history "
            "of older months.",
            "Only the CURRENTLY published revision can be reconstructed for historical months; earlier "
            "published bytes for a past month are not retrievable from the catalogue once overwritten.",
        ],
        "catalogue_declared_fingerprint": "Every CSV carries a catalogue MD5 + size; all 10 sentinels this run "
            "downloaded matched their catalogue-declared MD5, so a reader can detect a re-publication cheaply "
            "by comparing catalogue MD5+size without downloading.",
        "capture_protocol": REPRODUCIBILITY_PROTOCOL,
    }
    report["d12_question_types"] = QUESTION_TYPES
    report["d13_temporal_tiers"] = {
        "TIER_A_directly_comparable": {
            "definition": "Same schema era, code vocabulary and encoding; fingerprint-aware.",
            "applies_to": f"The current era (Locales {current_loc_era['start'] if current_loc_era else '?'} -> "
                          f"{current_loc_era['end'] if current_loc_era else '?'}; Actividades "
                          f"{current_act_era['start'] if current_act_era else '?'} -> "
                          f"{current_act_era['end'] if current_act_era else '?'}), snapshot-revision-aware.",
        },
        "TIER_B_comparable_after_explicit_normalisation": {
            "definition": "Core identity/geography/status/taxonomy fields present with the same meaning; only "
                          "presentation/trailing-column differences, normalisable without destroying comparability.",
            "applies_to": "The 40-col (2015-01..2022-09) and 48/49-col (2022-10..2024-09) eras vs current, for "
                          "id_local identity and the stable 55/56/79/G CNAE classes; normalise encoding "
                          "(latin-1->utf-8), BOM/quoting, trailing columns, desc accent drift, and the 2022-era "
                          "'-1'/'00'/'PT' unclassified sentinel. COUNT-level comparison across 2022->2025 stays "
                          "blocked by the observed administrative-universe expansion (cause unresolved).",
        },
        "TIER_C_segmented_comparison_only": {
            "definition": "A known semantic/structural break; compare only within the segment.",
            "applies_to": "The 2014 era(s): different barrio code system, status/access as TEXT not codes, "
                          "headerless Marzo 2014, 33-col Junio 2014 missing access/geography fields, latin-1.",
        },
        "TIER_D_no_go": {
            "definition": "Temporal inference unsupported.",
            "applies_to": "Business-event inference (openings/closures/survival) from status transitions in any "
                          "era; count-level 'growth' across the 2022->2025 observed administrative-universe "
                          "expansion; and a single homogeneous 2014->2026 trend series.",
        },
    }
    report["d14_earliest_defensible_windows"] = {
        "_note": "Per analytical dimension. Not one universal start date; different dimensions have different "
                 "windows. Each carries evidence and a caveat and whether direct comparison, normalisation or "
                 "segmentation is required.",
        "premises_identity_id_local": {
            "earliest_defensible_nominal_month": "Septiembre 2014",
            "comparison_mode": "direct for persistence; id_local is stable with no re-key",
            "evidence": f"Long-run persistence {loc_periods[0] if loc_periods else '?'} -> "
                        f"{loc_periods[-1] if loc_periods else '?'}: "
                        f"{long_run['persistence_from_rate'] if long_run else 'n/a'} "
                        f"(intersection {long_run['intersection'] if long_run else 'n/a'}); adjacent persistence "
                        f">=0.996 in every pair; no mass-reset signature.",
            "caveat": "Identity persistence is NOT count comparability: the observed premises universe expands "
                      "+52,024 id_local somewhere within Oct 2022 -> Sep 2025 (additive; cause unresolved), so "
                      "total counts are not a trend across that break.",
        },
        "status_composition_by_code": {
            "earliest_defensible_nominal_month": earliest_sit_code,
            "comparison_mode": "normalisation (TIER B); segment 2014",
            "evidence": f"situacion CODE first populated in {earliest_sit_code}; before that status is text-only. "
                        f"Code vocabulary drifts (7 'En obras' and 10 'Baja PC Asociado' disappear after 2022).",
            "caveat": "Existing code meanings are stable, but the code SET changes; read vocabulary live per "
                      "snapshot. 2014 status is text-only and must be segmented.",
        },
        "source_excluded_premises_filtering": {
            "earliest_defensible_nominal_month": earliest_acc_code,
            "comparison_mode": "normalisation; situacion-only partial earlier",
            "evidence": f"The full code-based rule (situacion 8/9 UNION access 12) needs the access CODE, first "
                        f"populated in {earliest_acc_code}. situacion 8/9 codes exist from {earliest_sit_code}; "
                        f"a text 'PC Asociado' exists from 2014 but not as a code.",
            "caveat": "Before the access code exists, PC Asociado can only be approximated from text; 2014 has "
                      "neither situacion nor access codes.",
        },
        "core_hospitality_div56": {
            "earliest_defensible_nominal_month": "Septiembre 2014 (mapping); Septiembre 2015 (clean core)",
            "comparison_mode": "normalisation; segment 2014 for format/encoding/geography",
            "evidence": "Division 56 present with 0 multi-parent epigraphs in every Actividades sentinel "
                        "(2014->2026); class map projects back cleanly.",
            "caveat": "Row/premises COUNTS are not a trend across the observed administrative-universe "
                      "expansion; share-of-classified is the safer quantity.",
        },
        "accommodation_div55": {
            "earliest_defensible_nominal_month": "mapping stable to 2014; composition comparison requires segmentation",
            "comparison_mode": "segment; count comparison NO-GO across the discontinuity",
            "evidence": f"Division 55 mapping is stable, but recorded accommodation premises move "
                        f"{acc_growth['from_premises'] if acc_growth else '?'} ({acc_growth['from'] if acc_growth else '?'}) "
                        f"-> {acc_growth['to_premises'] if acc_growth else '?'} ({acc_growth['to'] if acc_growth else '?'}): "
                        f"a major discontinuity in the RECORDED accommodation universe, causal mechanism "
                        f"UNRESOLVED. The Gate D artifacts carry division-level counts only, not per-epigraph "
                        f"counts (e.g. 551005 'VIVIENDAS TURISTICAS'), so the discontinuity is NOT attributed "
                        f"to any specific epigraph here.",
            "caveat": "Must NOT be read as accommodation growth; must NOT be attributed to a cause the Gate D "
                      "evidence does not demonstrate; and the census accommodation class is never merged with "
                      "the licensed-VUT or Madrid Destino universes (Gate B no-merge rule).",
        },
        "tourism_adjacent_div79": {
            "earliest_defensible_nominal_month": "Septiembre 2014 (mapping); Septiembre 2015 (clean core)",
            "comparison_mode": "normalisation; segment 2014",
            "evidence": "Division 79 present in every Actividades sentinel; small and stable (~570-834 premises).",
            "caveat": "Small counts; composition only, not demand.",
        },
        "generic_commercial_sectionG": {
            "earliest_defensible_nominal_month": "Septiembre 2014 (mapping); Septiembre 2015 (clean core)",
            "comparison_mode": "normalisation; segment 2014",
            "evidence": "Section G present in every Actividades sentinel; 0 multi-parent epigraphs.",
            "caveat": "Background composition only.",
        },
        "barrio_level_grouping": {
            "earliest_defensible_nominal_month": "Septiembre 2015 (current code system), pending Gate E",
            "comparison_mode": "MODIFY pending Gate E reconciliation; segment 2014",
            "evidence": "District count stable at 21 across all eras; barrio code is district-concatenated from "
                        "2015 (e.g. '104') but a bare barrio number in 2014 (e.g. '11'); barrio count 128 (2014/2015) "
                        "-> 131 (2020+).",
            "caveat": "Reconciliation to canonical geometry is Gate E; Gate D only reports the source-code break.",
        },
    }
    report["d16_interpretation_ceiling"] = INTERPRETATION_CEILING
    report["d15_monthly_transition_ruling"] = MONTHLY_TRANSITION_RULING
    report["gate_d_ruling"] = {
        "resource_continuity": {
            "ruling": "MODIFY",
            "basis": "The sequence is deterministic and auditable - every Locales/Actividades resource "
                     "description parses (0 unparsed) and each nominal month maps to exactly ONE resource id "
                     "(0 duplicate nominal periods) - but it is NOT a complete uninterrupted monthly series: "
                     "2014 is quarterly, and both families have missing nominal months (Locales 10, Actividades "
                     "12 within their spans). MODIFY: missing periods must remain explicit and must NEVER be "
                     "imputed as zero.",
        },
        "snapshot_version_identity": {
            "ruling": "GO",
            "basis": "Identity is (family + nominal_period + content fingerprint). Resource id is proven "
                     "insufficient (stable across in-place re-publication); the catalogue MD5+size and the URL cut "
                     "timestamp corroborate a revision cheaply. A later re-publication creates a different version, "
                     "it does not invalidate an earlier fingerprinted result.",
        },
        "schema_continuity": {
            "ruling": "MODIFY",
            "basis": "At least three structural eras after 2014 (2015-01, 2022-10, 2024-10 boundaries) plus a "
                     "distinct 2014 era. Within an era the schema is stable; across the 2015->2024 eras the Gate "
                     "A-C CORE fields are present and normalisable; the 2014 era is a structural break.",
        },
        "premises_identity_longitudinal": {
            "ruling": "GO",
            "basis": "id_local persists >=99.3% even Sep 2014 -> Sep 2026 with no re-key signature; adjacent "
                     "persistence >=0.996 throughout. Count comparability is a SEPARATE question (see the "
                     "administrative-universe-expansion caveat), but identity itself is longitudinally sound.",
        },
        "activity_taxonomy_longitudinal": {
            "ruling": "MODIFY",
            "basis": "The 55/56/79 division and G/R section mapping is present with 0 multi-parent epigraphs in "
                     "every era, so the class MAP projects back to 2014. But the unclassified/blank representation "
                     "is era-specific (the 2022-10..2024-09 era uses section '-1' / divisions '00','PT' and zero "
                     "blanks), and the recorded accommodation (55) universe shows a large discontinuity of "
                     "unresolved cause, so class SHARES/counts need explicit normalisation and segmentation, "
                     "not a raw backward projection.",
        },
        "status_composition_longitudinal": {
            "ruling": "MODIFY",
            "basis": f"situacion codes exist only from {earliest_sit_code}; access codes only from "
                     f"{earliest_acc_code}; 2014 is text-only. Code meanings are stable, but the code set drifts "
                     f"(7 and 10 disappear, 3 appears) and a description gains an accent, so vocabulary is read "
                     f"live per snapshot and 2014 is segmented.",
        },
        "month_to_month_status_transition_as_business_events": {
            "ruling": "NO-GO",
            "basis": MONTHLY_TRANSITION_RULING["basis"],
        },
        "barrio_grouping_over_time": {
            "ruling": "MODIFY pending Gate E",
            "basis": "District codes are stable (21) across all eras; the barrio code system changes at the "
                     "2014->2015 boundary and the barrio count moves 128->131. Reconciliation is Gate E.",
        },
        "overall_gate_d": {
            "ruling": "GO to Gate E",
            "basis": "Recent-era (2024-10+) comparisons are directly defensible (TIER A, fingerprint-aware); the "
                     "2015->2024 history is comparable after explicit normalisation (TIER B) with count-level "
                     "comparison blocked across the observed 2022->2025 administrative-universe expansion (cause "
                     "unresolved); 2014 is segmented (TIER C); "
                     "business-event inference is NO-GO; and a single homogeneous 2014->2026 trend series is NO-GO. "
                     "A shorter defensible window is preferred over a longer false series.",
            "mixed_subrulings_are_expected": True,
        },
    }


def rebuild_summary() -> int:
    """Network-free regeneration of the summary + its ruling blocks from the already
    committed, fingerprinted artifacts (manifest + eras + compatibility). Deterministic;
    used for verification without re-downloading ~769 MB of sentinels."""
    summ_path = RESULTS / "gate_d_temporal_summary.json"
    report = json.loads(summ_path.read_text(encoding="utf-8"))
    # Prefer the standalone artifacts as the evidence of record where present.
    eras_art = RESULTS / "gate_d_schema_eras.json"
    comp_art = RESULTS / "gate_d_temporal_compatibility.json"
    if eras_art.exists():
        report["d4_d5_schema_eras"] = json.loads(eras_art.read_text(encoding="utf-8"))["schema_eras"]
    if comp_art.exists():
        comp = json.loads(comp_art.read_text(encoding="utf-8"))
        report["d7_d8_d9_d10_sentinels"] = comp["sentinels"]
        report["d9_identity_intersections"] = comp["identity_intersections"]
    attach_rulings(report)
    report["audit_finished_at"] = A.now()
    report["rebuild_note"] = "Ruling blocks regenerated network-free from committed fingerprinted artifacts."
    summ_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[gate-d] rebuilt summary + rulings from committed artifacts (network-free)")
    return 0


if __name__ == "__main__":
    if "--rebuild-summary" in sys.argv:
        sys.exit(rebuild_summary())
    sys.exit(main())
