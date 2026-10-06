#!/usr/bin/env python3
"""Gate L · L2 — Ámbito identity across editions (the decisive sub-gate, #65).

Differences two REAL consecutive editions and classifies every difference into
exactly one of five classes, with a deterministic precedence and NO silent
fallback and NO ``OTHER``:

  1. ``NEW_AMBITO``            — code absent earlier, present later
  2. ``ABSENT_FROM_EDITION``  — code present earlier, absent later
  3. ``MODIFIED_BY_INSTRUMENT`` — present in both, later notes record an MPG
                                 (Modificación del Plan General) modification
  4. ``STATE_TRANSITION``     — present in both, a phase/situación value changed,
                                 with no documented instrument modification
  5. ``CAUSE_UNRESOLVED``     — present in both, some other field changed and the
                                 source states no cause

The decisive pair is determined FROM THE L1 INVENTORY, not from memory: the
latest two consecutive editions that share a schema fingerprint (so the diff is
structural, not an artefact of a schema change). That is **2025-07 → 2026-01**
for both families. A robustness pass then classifies every consecutive
same-schema pair; cross-schema-era pairs are reported ``NON_COMPARABLE`` and
never differenced.

A source-state/phase transition is NOT a development event — the project's
``STATUS_TRANSITION ≠ BUSINESS_EVENT`` rule, here
``PLANNING_STATE_TRANSITION ≠ PHYSICAL_URBAN_CHANGE``. This script classifies
*published differences*; it never calls one "progress".

Writes ``results/l2_identity.json`` and ``results/l2_summary.json``.
Run: ``python research/urban_planning_gate/audit_l2_identity.py`` (after L1).
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

import gate_l_common as g
import audit_l1_editions as l1

CLASSES = ["NEW_AMBITO", "ABSENT_FROM_EDITION", "MODIFIED_BY_INSTRUMENT",
           "STATE_TRANSITION", "CAUSE_UNRESOLVED"]

# Two codes present in both editions can differ in two very different ways: a
# SUBSTANTIVE change (a phase value, a situación value, a new instrument note), or
# a COSMETIC re-encoding of the same text — the publisher adds accents or changes
# case between editions (observed: "AMBITO DE NUEVA CREACION" -> "ÁMBITO DE NUEVA
# CREACIÓN"). Counting cosmetic drift as change would fabricate a change signal,
# the exact failure this gate exists to prevent. So the equality test folds accents
# / case / whitespace, while the report preserves every string VERBATIM. Cosmetic
# drift is counted in its own bucket, never inside the five substantive classes.


def _fold(text: str) -> str:
    """Accent/case/whitespace-insensitive form, for EQUALITY TESTING ONLY. The
    original text is always preserved verbatim in the emitted report."""
    s = unicodedata.normalize("NFKD", text or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).strip().upper()

# An MPG modification documented in the free-text notes: a Modificación del Plan
# General reference coupled with a modification verb. "NUEVA CREACIÓN POR LA MPG"
# is a creation marker, handled by NEW_AMBITO when the code is genuinely new, and
# never mistaken for a modification of an already-present code.
_MPG_MODIFIED = re.compile(r"modificad[oa].*mpg|mpg[.\s]*\d.*modificad", re.IGNORECASE | re.DOTALL)
_MPG_ANY = re.compile(r"mpg[.\s]*\d", re.IGNORECASE)


def _norm(t: str) -> str:
    return re.sub(r"\s+", " ", (t or "").strip()).lower()


def _resolve_cols(header_tokens: list[str]):
    """Locate code / state / notes columns by header name, per era. Returns
    (code_idx-name, [state names], [notes names]) as normalised names."""
    code = None
    for want in ("cod_ambito", "codord"):
        if want in header_tokens:
            code = want
            break
    if code is None:
        for t in header_tokens:
            if t in ("ámbito", "ambito", "código", "codigo"):
                code = t
                break
    states = [t for t in header_tokens
              if t.startswith("estado de desarrollo") or "situaci" in t or t == "descripcion"]
    notes = [t for t in header_tokens if t in ("observaciones", "nuevo")]
    return code, states, notes


def read_edition(family: str, edition: dict) -> dict:
    """Read ONE edition (any era) into {code: {state_sig, notes, has_mpg_mod}}.

    Reads every data sheet (the 2013/2014 S1 editions split ámbitos across 21
    district sheets). Columns are resolved by header name so the reader survives
    the column-order drift between editions. Duplicate codes within an edition are
    recorded; the first wins for the state signature and a flag is set.
    """
    path = Path(g.fetch(edition["url"], edition["resource_id"], ".xls")["cache_path"])
    wb = g.open_workbook(path)
    out: dict[str, dict] = {}
    duplicates: list[str] = []
    for sidx in range(len(wb.sheet_names())):
        sheet = wb.sheet_by_index(sidx)
        hdr_row, hdr = l1._find_header_row(sheet)
        if hdr_row < 0:
            continue
        tokens = [_norm(h) for h in hdr]
        code_name, state_names, note_names = _resolve_cols(tokens)
        if code_name is None or code_name not in tokens:
            continue
        idx = {tokens[i]: i for i in range(len(tokens)) if tokens[i]}
        code_i = idx[code_name]
        for r in range(hdr_row + 1, sheet.nrows):
            raw = sheet.row_values(r)
            if code_i >= len(raw):
                continue
            code = g.cell_text(raw[code_i])
            if not code or code.lower().startswith("total") or _norm(code) in tokens:
                continue
            state_sig = tuple(
                (sn, g.cell_text(raw[idx[sn]]) if idx[sn] < len(raw) else "")
                for sn in state_names
            )
            notes = " ".join(
                g.cell_text(raw[idx[nn]]) if idx[nn] < len(raw) else "" for nn in note_names
            ).strip()
            if code in out:
                duplicates.append(code)
                continue
            out[code] = {
                "state_sig": state_sig,
                "notes": notes,
                "has_mpg_mod": bool(_MPG_MODIFIED.search(notes)),
                "has_mpg_any": bool(_MPG_ANY.search(notes)),
            }
    return {"codes": out, "duplicates": sorted(set(duplicates)), "has_notes_column": _edition_has_notes(wb)}


def _edition_has_notes(wb) -> bool:
    sheet = wb.sheet_by_index(0)
    _, hdr = l1._find_header_row(sheet)
    return any(_norm(h) in ("observaciones", "nuevo") for h in hdr)


def _state_changed(ra: dict, rb: dict) -> bool:
    fa = tuple((n, _fold(v)) for n, v in ra["state_sig"])
    fb = tuple((n, _fold(v)) for n, v in rb["state_sig"])
    return fa != fb


def _notes_changed(ra: dict, rb: dict) -> bool:
    return _fold(ra["notes"]) != _fold(rb["notes"])


def classify_pair(a: dict, b: dict) -> dict:
    """Total, precedence-ordered classification of every code in the union of the
    two editions. Every code lands in exactly one bucket: the five substantive
    difference classes, plus IDENTICAL and COSMETIC_TEXT_DRIFT for non-differences.
    The five classes partition the SUBSTANTIVE differences; nothing falls through."""
    a_codes, b_codes = a["codes"], b["codes"]
    results = {c: [] for c in CLASSES}
    all_codes = set(a_codes) | set(b_codes)
    identical = 0
    cosmetic = []
    for code in sorted(all_codes):
        in_a, in_b = code in a_codes, code in b_codes
        if in_a and not in_b:
            results["ABSENT_FROM_EDITION"].append({"code": code})
            continue
        if in_b and not in_a:
            results["NEW_AMBITO"].append({"code": code})
            continue
        # present in both
        ra, rb = a_codes[code], b_codes[code]
        state_changed = _state_changed(ra, rb)
        notes_changed = _notes_changed(ra, rb)
        if not state_changed and not notes_changed:
            # No substantive change. Was anything re-encoded (accents/case)?
            if ra["state_sig"] != rb["state_sig"] or ra["notes"] != rb["notes"]:
                cosmetic.append({"code": code, "earlier": ra["notes"], "later": rb["notes"]})
            else:
                identical += 1
            continue
        # precedence: MODIFIED_BY_INSTRUMENT (3) before STATE_TRANSITION (4)
        if rb["has_mpg_mod"] and not ra["has_mpg_mod"]:
            results["MODIFIED_BY_INSTRUMENT"].append(
                {"code": code, "note_later": rb["notes"]})
            continue
        if state_changed:
            results["STATE_TRANSITION"].append(
                {"code": code, "from": ra["state_sig"], "to": rb["state_sig"]})
            continue
        # notes changed substantively but no phase/situación value change and no
        # documented instrument: the source does not state why the record moved.
        results["CAUSE_UNRESOLVED"].append(
            {"code": code, "note_earlier": ra["notes"], "note_later": rb["notes"]})
    counts = {c: len(results[c]) for c in CLASSES}
    total_diffs = sum(counts.values())
    proportions = {c: (counts[c] / total_diffs if total_diffs else 0.0) for c in CLASSES}
    return {
        "rows_earlier": len(a_codes),
        "rows_later": len(b_codes),
        "shared_codes": len(set(a_codes) & set(b_codes)),
        "identical_shared": identical,
        "cosmetic_text_drift": len(cosmetic),
        "cosmetic_samples": cosmetic[:6],
        "total_differences": total_diffs,
        "counts": counts,
        "proportions": proportions,
        "has_notes_both": a["has_notes_column"] and b["has_notes_column"],
        "samples": {c: results[c][:8] for c in CLASSES},
    }


def _consecutive_same_era(eds: list[dict]) -> list[tuple[dict, dict]]:
    pairs = []
    s = sorted(eds, key=lambda e: e["reference_date"] or "")
    for i in range(1, len(s)):
        pairs.append((s[i - 1], s[i]))
    return pairs


def main() -> None:
    g.utf8_stdout()
    inv = l1.edition_inventory()
    report = {"gate": "L2", "audit_finished_at": g.now(),
              "precedence": CLASSES,
              "interpretation_ceiling": "PLANNING_STATE_TRANSITION != PHYSICAL_URBAN_CHANGE. "
              "These are published administrative differences; none is evidence of construction.",
              "families": {}}
    summary = {"gate": "L2", "audit_finished_at": g.now(), "families": {}}

    for family in ("S1", "S2"):
        eds = inv[family]["editions"]
        recent_era = l1.RECENT_FLAT_ERA[family]
        recent = [e for e in eds if e["schema_era"] == recent_era]
        recent.sort(key=lambda e: e["reference_date"])
        decisive_a, decisive_b = recent[-2], recent[-1]
        a = read_edition(family, decisive_a)
        b = read_edition(family, decisive_b)
        decisive = classify_pair(a, b)
        decisive["pair"] = f"{decisive_a['reference_date']} -> {decisive_b['reference_date']}"

        # Robustness: every consecutive pair, same-era differenced, cross-era NON_COMPARABLE.
        all_pairs = []
        s = sorted(eds, key=lambda e: e["reference_date"])
        for i in range(1, len(s)):
            ea, eb = s[i - 1], s[i]
            if ea["schema_era"] != eb["schema_era"]:
                all_pairs.append({
                    "pair": f"{ea['reference_date']} -> {eb['reference_date']}",
                    "status": "NON_COMPARABLE",
                    "reason": f"schema era changes {ea['schema_era']} -> {eb['schema_era']}",
                })
                continue
            ma, mb = read_edition(family, ea), read_edition(family, eb)
            res = classify_pair(ma, mb)
            all_pairs.append({
                "pair": f"{ea['reference_date']} -> {eb['reference_date']}",
                "status": "COMPARED",
                "schema_era": ea["schema_era"],
                "counts": res["counts"],
                "proportions": res["proportions"],
                "total_differences": res["total_differences"],
                "cosmetic_text_drift": res["cosmetic_text_drift"],
                "rows_earlier": res["rows_earlier"],
                "rows_later": res["rows_later"],
                "shared_codes": res["shared_codes"],
                "has_notes_both": res["has_notes_both"],
            })

        report["families"][family] = {
            "decisive_pair": decisive,
            "decisive_pair_selected_by": "latest two consecutive editions sharing a "
                                         f"schema fingerprint ({recent_era})",
            "all_consecutive_pairs": all_pairs,
            "entity_identity_key": "{edition}:{code}",
            "notes_detectability": (
                "MODIFIED_BY_INSTRUMENT is detectable only where an OBSERVACIONES/"
                "nuevo notes column exists (S2 recent + some S2 mid eras). S1 carries "
                "no notes column, so an S1 phase STATE_TRANSITION cannot be attributed "
                "to, or cleared of, an instrument modification from S1 alone."),
        }
        summary["families"][family] = {
            "decisive_pair": decisive["pair"],
            "rows_earlier": decisive["rows_earlier"],
            "rows_later": decisive["rows_later"],
            "shared_codes": decisive["shared_codes"],
            "total_differences": decisive["total_differences"],
            "cosmetic_text_drift": decisive["cosmetic_text_drift"],
            "counts": decisive["counts"],
            "proportions": decisive["proportions"],
            "non_comparable_pairs": sum(1 for p in all_pairs if p["status"] == "NON_COMPARABLE"),
            "compared_pairs": sum(1 for p in all_pairs if p["status"] == "COMPARED"),
        }

    g.write_json("l2_identity.json", report)
    g.write_json("l2_summary.json", summary)
    for family in ("S1", "S2"):
        d = summary["families"][family]
        print(f"[{family}] decisive {d['decisive_pair']}: {d['total_differences']} substantive diffs of "
              f"{d['shared_codes']} shared ({d['rows_earlier']}->{d['rows_later']} rows); "
              f"cosmetic drift={d['cosmetic_text_drift']}")
        for c in CLASSES:
            print(f"     {c:22} {d['counts'][c]:4}  {d['proportions'][c]*100:5.1f}%")
    print("wrote results/l2_identity.json, results/l2_summary.json")


if __name__ == "__main__":
    main()
