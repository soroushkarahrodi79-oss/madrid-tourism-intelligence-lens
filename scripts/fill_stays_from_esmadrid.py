#!/usr/bin/env python3
"""Add official Madrid accommodation points to data/runtime_poi.json.

Source: Madrid Destino / esmadrid.com Spanish accommodation XML.
No third-party packages are required.
"""

from __future__ import annotations

import html
import json
import sys
import urllib.request
from collections import Counter
import xml.etree.ElementTree as ET
from pathlib import Path

SOURCE_URL = "https://www.esmadrid.com/opendata/alojamientos_v1_es.xml"
OUTPUT_PATH = Path("data/runtime_poi.json")


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def first_text(node: ET.Element, names: set[str]) -> str | None:
    """Read a field from either a direct XML tag or Madrid's <item name="…"> form."""
    wanted = {name.casefold() for name in names}
    for el in node.iter():
        tag_name = local_name(el.tag)
        item_name = str(el.attrib.get("name", "")).casefold()
        matches_direct_tag = tag_name in wanted
        matches_named_item = tag_name == "item" and item_name in wanted
        if (matches_direct_tag or matches_named_item) and el.text and el.text.strip():
            return el.text.strip()
    return None


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    # Madrid Destino may expose HTML entities inside XML text nodes.
    return html.unescape(value).strip()


def normalize_stay_kind(value: str | None) -> str:
    text = clean_text(value).casefold()
    if not text:
        return "other"
    if "aparta" in text or "apartamento" in text:
        return "apartment"
    if "hostal" in text:
        return "hostal"
    if "hotel" in text:
        return "hotel"
    if "alberg" in text:
        return "hostel"
    if "pensi" in text or "huésped" in text or "huesped" in text:
        return "guest"
    if "residencia" in text:
        return "residence"
    if "camping" in text or "campamento" in text:
        return "camping"
    return "other"


def parse_number(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return float(value.replace(",", ".").strip())
    except ValueError:
        return None


def normalize_madrid_coords(a: float | None, b: float | None) -> tuple[float, float] | None:
    if a is None or b is None:
        return None

    # Most records are latitude/longitude. Also tolerate accidental reversal.
    candidates = [(a, b), (b, a)]
    for lat, lon in candidates:
        if 39.0 <= lat <= 41.8 and -5.5 <= lon <= -2.0:
            return lat, lon
    return None


def parse_accommodation_xml(xml_text: str) -> list[dict]:
    root = ET.fromstring(xml_text)
    parent = {child: parent for parent in root.iter() for child in parent}
    latitude_nodes = [el for el in root.iter() if local_name(el.tag) == "latitude"]

    points: list[dict] = []
    seen: set[tuple[str, float, float]] = set()

    for lat_el in latitude_nodes:
        node = parent.get(lat_el)
        while node is not None:
            lat = parse_number(first_text(node, {"latitude"}))
            lon = parse_number(first_text(node, {"longitude"}))
            name = clean_text(first_text(node, {"name", "title"}))
            source_type = clean_text(first_text(node, {"tipo"}))
            category = clean_text(first_text(node, {"categoria"}))
            subcategory = clean_text(first_text(node, {"subcategoria"}))
            coords = normalize_madrid_coords(lat, lon)

            if coords and name:
                # The production Madrid feed identifies each <service> with an id
                # attribute. Keep support for an <id> child for schema variants.
                stable_id = node.attrib.get("id") or first_text(node, {"id"}) or str(len(points))
                lat_v, lon_v = coords
                key = (name.casefold(), round(lat_v, 6), round(lon_v, 6))
                if key not in seen:
                    seen.add(key)

                    # Madrid's current/historical production XML uses:
                    #   Tipo = "Alojamientos" (generic group)
                    #   Categoria = "Hoteles" / "Hostales" / "Pensiones" / ...
                    #   SubCategoria = "4 estrellas" / "1 llave" / ...
                    # Therefore the user-facing family must be derived from
                    # Categoria first, not from the generic Tipo field.
                    family_label = category or source_type
                    points.append(
                        {
                            "id": f"stay-published-{stable_id}",
                            "type": "stay",
                            "name": name,
                            "stayKind": normalize_stay_kind(family_label),
                            "accommodationType": family_label or "Sin clasificar",
                            "accommodationCategory": subcategory,
                            "accommodationSourceType": source_type,
                            "lat": lat_v,
                            "lon": lon_v,
                        }
                    )
                break

            node = parent.get(node)

    return points


def fetch_text(url: str, timeout: int = 25) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/xml,text/xml,*/*",
            "User-Agent": (
                "madrid-tourism-intelligence-lens/1.0 "
                "(+https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens)"
            ),
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read().decode("utf-8-sig")


def main() -> int:
    try:
        payload = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"[runtime-poi] stay: cannot read {OUTPUT_PATH}: {exc}", file=sys.stderr)
        return 1

    try:
        xml_text = fetch_text(SOURCE_URL)
        points = parse_accommodation_xml(xml_text)
        if not points:
            raise RuntimeError("official accommodation XML produced zero geocoded records")
    except Exception as exc:
        print(f"[runtime-poi] stay unavailable: {exc}", file=sys.stderr)
        payload.setdefault("status", {})["stay"] = {
            "ok": False,
            "count": 0,
            "error": str(exc),
            "source": "Madrid Destino / esmadrid.com",
        }
        payload.setdefault("sources", {})["stays"] = SOURCE_URL
        OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return 0

    payload.setdefault("layers", {})["stay"] = points
    payload.setdefault("status", {})["stay"] = {
        "ok": True,
        "count": len(points),
        "error": None,
        "source": "Madrid Destino / esmadrid.com",
    }
    payload.setdefault("sources", {})["stays"] = SOURCE_URL

    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    kind_counts = Counter(point["stayKind"] for point in points)
    summary = ", ".join(f"{kind}={count}" for kind, count in sorted(kind_counts.items()))
    print(f"[runtime-poi] stay: {len(points)} points from Madrid Destino / esmadrid.com")
    print(f"[runtime-poi] stay classification: {summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
