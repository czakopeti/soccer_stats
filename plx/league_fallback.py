"""Keep the other leagues going when Understat is down.

The last good Understat download of each league is kept in data/understat/.
When a fresh download fails, that copy is used, and matches played since then
are filled in from football-data.co.uk's current-season file: score, plus
match xG rescaled to Understat's scale by the ratio measured on this season's
matches that both sources have.

Club names differ between the two sources (Athletic Club / Ath Bilbao), so
they are matched from the results themselves: the same date and the same
score, over every match both sources have. Nothing is typed in per club. A
league whose names do not pair off one to one is not filled.

As soon as Understat answers again, its download replaces all of this.
"""
from __future__ import annotations

import copy
import csv
import math
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

from plx.elo import parse_fd_date


def _num(value):
    try:
        out = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


def load_fd(path: Path) -> list[dict]:
    """Finished matches with a score and both xG values."""
    if not path.is_file():
        return []
    rows = []
    with path.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        if not reader.fieldnames or not {"Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG", "HxG", "AxG"} <= set(reader.fieldnames):
            return []
        for rec in reader:
            v = [_num(rec.get(k)) for k in ("FTHG", "FTAG", "HxG", "AxG")]
            if not rec.get("HomeTeam") or not rec.get("Date") or any(x is None for x in v):
                continue
            try:
                d = parse_fd_date(rec["Date"]).date()
            except Exception:  # noqa: BLE001 - an unreadable row is skipped, not guessed
                continue
            rows.append({"date": d, "h": rec["HomeTeam"].strip(), "a": rec["AwayTeam"].strip(),
                         "hs": int(v[0]), "as": int(v[1]), "xh": v[2], "xa": v[3]})
    return rows


def _played(dates: list[dict]) -> list[dict]:
    return [d for d in dates if d.get("isResult")]


def map_names(dates: list[dict], fd: list[dict], min_votes: int = 3) -> tuple[dict[str, str] | None, str]:
    """Understat club name -> football-data club name, from matches with the same date and score."""
    by_key: dict[tuple, list[dict]] = defaultdict(list)
    for r in fd:
        by_key[(r["date"], r["hs"], r["as"])].append(r)
    votes: dict[str, Counter] = defaultdict(Counter)
    for m in _played(dates):
        d = date.fromisoformat(m["datetime"][:10])
        hs, as_ = int(m["goals"]["h"]), int(m["goals"]["a"])
        for dd in (d - timedelta(days=1), d, d + timedelta(days=1)):
            for r in by_key.get((dd, hs, as_), []):
                votes[m["h"]["title"]][r["h"]] += 1
                votes[m["a"]["title"]][r["a"]] += 1
    teams = sorted({m["h"]["title"] for m in dates} | {m["a"]["title"] for m in dates})
    mapping: dict[str, str] = {}
    for t in teams:
        top = votes[t].most_common(2)
        if not top or top[0][1] < min_votes or (len(top) > 1 and top[1][1] * 2 >= top[0][1]):
            return None, f"{t} could not be paired with one football-data name."
        mapping[t] = top[0][0]
    if len(set(mapping.values())) != len(mapping):
        return None, "Two clubs paired with the same football-data name."
    return mapping, ""


def fill(dates: list[dict], fd: list[dict], min_overlap: int) -> tuple[list[dict], dict]:
    """The cached Understat list with matches played since filled in from football-data."""
    info = {"filled": 0, "scale": None, "overlap": 0, "note": ""}
    if not fd:
        info["note"] = "No football-data file."
        return dates, info
    mapping, why = map_names(dates, fd)
    if mapping is None:
        info["note"] = why
        return dates, info
    fd_by_pair = {(r["h"], r["a"]): r for r in fd}
    ours = theirs = 0.0
    for m in _played(dates):
        r = fd_by_pair.get((mapping[m["h"]["title"]], mapping[m["a"]["title"]]))
        if r is None or (r["hs"], r["as"]) != (int(m["goals"]["h"]), int(m["goals"]["a"])):
            continue
        ours += float(m["xG"]["h"]) + float(m["xG"]["a"])
        theirs += r["xh"] + r["xa"]
        info["overlap"] += 1
    if info["overlap"] < min_overlap or theirs <= 0:
        info["note"] = f"Only {info['overlap']} matches overlap with football-data."
        return dates, info
    ratio = ours / theirs
    info["scale"] = round(ratio, 4)
    # Only matches played since the kept copy ends, and never one the copy already has
    # (the two sources occasionally disagree on which side was at home).
    through = date.fromisoformat(cache_date(dates))
    seen = set()
    for m in _played(dates):
        d = date.fromisoformat(m["datetime"][:10])
        pair = frozenset((mapping[m["h"]["title"]], mapping[m["a"]["title"]]))
        for dd in (d - timedelta(days=1), d, d + timedelta(days=1)):
            seen.add((dd, pair))
    out = copy.deepcopy(dates)
    for m in out:
        if m.get("isResult"):
            continue
        r = fd_by_pair.get((mapping[m["h"]["title"]], mapping[m["a"]["title"]]))
        if r is None or r["date"] < through or (r["date"], frozenset((r["h"], r["a"]))) in seen:
            continue
        m["isResult"] = True
        m["goals"] = {"h": str(r["hs"]), "a": str(r["as"])}
        m["xG"] = {"h": str(round(r["xh"] * ratio, 4)), "a": str(round(r["xa"] * ratio, 4))}
        # football-data has the local date only; keep Understat's kickoff time on it.
        if m["datetime"][:10] != r["date"].isoformat():
            m["datetime"] = r["date"].isoformat() + m["datetime"][10:]
        m["src"] = "fd"
        info["filled"] += 1
    return out, info


def cache_date(dates: list[dict]) -> str | None:
    played = [d["datetime"] for d in dates if d.get("isResult") and d.get("src") != "fd"]
    return max(played)[:10] if played else None
