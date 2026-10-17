#!/usr/bin/env python3
"""K12 - section 4 GeoParquet / Parquet builder-side cost (DETERMINISTIC bytes).

Question from issue #74: does Parquet/GeoParquet reduce the Python builders'
preprocessing output, and is there a browser consumer without DuckDB-WASM?

This harness measures the BUILDER-SIDE artifact bytes: it re-encodes the real
tabular payloads (urban licence records; domestic-origin rows) as Parquet with
several codecs and compares against the committed JSON (raw and gzip). Byte
figures are hardware-independent.

It does NOT convert the ambito geometry to GeoParquet: that needs the spatial
stack (geopandas/shapely) AND a browser GeoParquet reader, which is exactly the
dependency the verdict turns on - documented, not silently skipped.

Run:  python3 research/runtime_spike/geoparquet/parquet_cost.py
Out:  research/runtime_spike/results/geoparquet.json

THROWAWAY research harness - not wired into production, not a builder.
"""
import gzip
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))


def gz_len(b):
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=9) as f:
        f.write(b)
    return len(buf.getvalue())


def parquet_bytes(rows, compression):
    import pyarrow as pa
    import pyarrow.parquet as pq

    table = pa.Table.from_pylist(rows)
    sink = pa.BufferOutputStream()
    pq.write_table(table, sink, compression=compression)
    return len(sink.getvalue().to_pybytes())


def measure(name, json_path, rows):
    with open(json_path, "rb") as f:
        raw = f.read()
    json_raw = len(raw)
    json_gz = gz_len(raw)
    # the records-only JSON (what a Parquet file would replace) measured fairly:
    records_json = json.dumps(rows, ensure_ascii=False).encode("utf-8")
    out = {
        "artifact": name,
        "rows": len(rows),
        "full_json_raw_bytes": json_raw,
        "full_json_gzip_bytes": json_gz,
        "records_only_json_raw_bytes": len(records_json),
        "records_only_json_gzip_bytes": gz_len(records_json),
    }
    for codec in ("none", "snappy", "gzip", "zstd"):
        try:
            out[f"parquet_{codec}_bytes"] = parquet_bytes(rows, None if codec == "none" else codec)
        except Exception as e:  # noqa: BLE001
            out[f"parquet_{codec}_bytes"] = f"ERROR: {e}"
    return out


def measure_geometry(name, geojson_path):
    """GeoParquet-style geometry: a WKB geometry column + properties, Parquet-zstd,
    measured against the source GeoJSON (raw + gzip). Uses shapely for WKB only
    (not geopandas); this is the builder-side geometry number issue #74 asked for.
    """
    import pyarrow as pa
    import pyarrow.parquet as pq
    from shapely.geometry import shape

    with open(geojson_path, "rb") as f:
        raw = f.read()
    gj = json.loads(raw)
    feats = gj["features"]
    wkb_col = []
    prop_cols = {}
    for feat in feats:
        wkb_col.append(shape(feat["geometry"]).wkb)
        for k, v in (feat.get("properties") or {}).items():
            prop_cols.setdefault(k, [None] * len(wkb_col))
    # normalise property columns to equal length (sparse props -> None)
    n = len(feats)
    cols = {"geometry_wkb": wkb_col}
    for k in prop_cols:
        col = []
        for feat in feats:
            col.append((feat.get("properties") or {}).get(k))
        # arrow needs homogeneous-ish types; stringify non-scalars
        cols[k] = [v if (v is None or isinstance(v, (str, int, float, bool))) else json.dumps(v, ensure_ascii=False) for v in col]
    table = pa.table(cols)
    out = {
        "artifact": name,
        "features": n,
        "geojson_raw_bytes": len(raw),
        "geojson_gzip_bytes": gz_len(raw),
    }
    for codec in ("zstd", "snappy"):
        sink = pa.BufferOutputStream()
        pq.write_table(table, sink, compression=codec)
        out[f"geoparquet_{codec}_bytes"] = len(sink.getvalue().to_pybytes())
    return out


def main():
    lic_path = os.path.join(ROOT, "data/planning/madrid_urban_licences.json")
    with open(lic_path, encoding="utf-8") as f:
        lic = json.load(f)
    lic_rows = [
        {
            "id": r.get("id"),
            "ndp": r.get("ndp"),
            "family": r.get("family"),
            "tipo": r.get("tipo"),
            "grant_date": r.get("grant_date"),
            "norma_zonal": r.get("norma_zonal"),
            "nivel_proteccion": r.get("nivel_proteccion"),
            "lat": float(r["lat"]) if r.get("lat") is not None else None,
            "lon": float(r["lon"]) if r.get("lon") is not None else None,
            "barrio_code": r.get("barrio_code"),
            "district_code": r.get("district_code"),
            "crosswalk_state": r.get("crosswalk_state"),
        }
        for r in lic["records"]
    ]

    dom_path = os.path.join(ROOT, "data/destination/madrid_domestic_origins.json")
    with open(dom_path, encoding="utf-8") as f:
        dom = json.load(f)
    dom_rows = []
    for m in dom.get("months", []):
        for o in m.get("published_origins", []):
            row = dict(o)
            row["source_month"] = m.get("source_month")
            dom_rows.append(row)

    import pyarrow

    result = {
        "spike": "K12 runtime decision",
        "measurement": "geoparquet_builder_side",
        "deterministic": "all figures are byte sizes (hardware-independent)",
        "pyarrow_version": pyarrow.__version__,
        "python_version": sys.version.split()[0],
        "browser_consumer_finding": (
            "No browser consumer reads Parquet/GeoParquet WITHOUT a WASM reader "
            "(DuckDB-WASM or parquet-wasm). GeoParquet is therefore gated behind the "
            "DuckDB-WASM decision (NO-GO at this scale)."
        ),
        "tabular_artifacts": [
            measure("urban_licences", lic_path, lic_rows),
            measure("domestic_origins", dom_path, dom_rows),
        ],
        "geometry_artifacts": [
            measure_geometry("ambitos", os.path.join(ROOT, "data/planning/madrid_ambitos.geojson")),
            measure_geometry("admin", os.path.join(ROOT, "data/geography/madrid_admin.geojson")),
        ],
    }

    out_path = os.path.join(ROOT, "research/runtime_spike/results/geoparquet.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(f"geoparquet -> {os.path.relpath(out_path, ROOT)}")
    for a in result["tabular_artifacts"]:
        print(
            f"  TAB {a['artifact']:<16} json gz {a['full_json_gzip_bytes']//1024}KB "
            f"vs parquet.zstd {a['parquet_zstd_bytes']//1024}KB"
        )
    for a in result["geometry_artifacts"]:
        print(
            f"  GEO {a['artifact']:<16} geojson gz {a['geojson_gzip_bytes']//1024}KB "
            f"vs geoparquet.zstd {a['geoparquet_zstd_bytes']//1024}KB ({a['features']} feat)"
        )


if __name__ == "__main__":
    main()
