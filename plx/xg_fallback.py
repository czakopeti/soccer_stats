"""Match xG for finished matches that pl-catalogue has no shots for yet.

pl-catalogue's shots come from Understat. When the Premier League feed shows a
match as finished but pl-catalogue has no shots for it, the match xG and shot
counts come from football-data.co.uk's current-season file instead.

football-data's xG comes from a different provider and runs on a lower scale,
so it is multiplied by a ratio measured on this season's matches that both
sources have (the catalogue's xG total divided by football-data's). A match is
filled only when football-data's score agrees with the Premier League feed.

The catalogue always wins: a match that has catalogue shots never reads this
file. So as soon as pl-catalogue publishes the missing shots, the next build
goes back to shot-level data for that match with nothing to undo.
"""
from __future__ import annotations

import csv
import math
from pathlib import Path

from plx.names import AmbiguousName, ClubIndex, UnmappedName

SOURCE = "football-data.co.uk"


def _num(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        out = float(text)
    except ValueError:
        return None
    return out if math.isfinite(out) else None


def load_rows(path: Path) -> list[dict]:
    """Finished matches with a score, both xG values and both shot counts."""
    if not path.is_file():
        return []
    rows = []
    with path.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        if not reader.fieldnames or not {"HomeTeam", "AwayTeam", "FTHG", "FTAG", "HxG", "AxG"} <= set(reader.fieldnames):
            return []
        for rec in reader:
            vals = {k: _num(rec.get(k)) for k in ("FTHG", "FTAG", "HxG", "AxG", "HS", "AS")}
            if not rec.get("HomeTeam") or not rec.get("AwayTeam") or any(vals[k] is None for k in ("FTHG", "FTAG", "HxG", "AxG")):
                continue
            rows.append(
                {
                    "home": rec["HomeTeam"].strip(),
                    "away": rec["AwayTeam"].strip(),
                    "hs": int(vals["FTHG"]),
                    "as": int(vals["FTAG"]),
                    "xh": vals["HxG"],
                    "xa": vals["AxG"],
                    "sh": int(vals["HS"]) if vals["HS"] is not None else None,
                    "sa": int(vals["AS"]) if vals["AS"] is not None else None,
                }
            )
    return rows


def by_pair(rows: list[dict], alias_sets: dict[str, list[str]], cfg: dict) -> tuple[dict, list[str]]:
    """Key football-data rows by the Premier League names. Unmatched spellings are returned, not guessed."""
    index = ClubIndex(cfg)
    for team, aliases in alias_sets.items():
        index.add(team, aliases)
    out: dict[tuple[str, str], dict] = {}
    unmatched: list[str] = []
    for row in rows:
        try:
            pair = (index.match(row["home"]), index.match(row["away"]))
        except (UnmappedName, AmbiguousName) as exc:
            unmatched.append(str(exc))
            continue
        out[pair] = row
    return out, unmatched


def scale(matches: list[dict], fd: dict) -> tuple[float | None, int]:
    """Catalogue xG ÷ football-data xG over the matches both have."""
    ours = theirs = 0.0
    n = 0
    for m in matches:
        row = fd.get((m["h"], m["a"]))
        if row is None or (row["hs"], row["as"]) != (m["hs"], m["as"]):
            continue
        ours += m["xh"] + m["xa"]
        theirs += row["xh"] + row["xa"]
        n += 1
    if n == 0 or theirs <= 0:
        return None, n
    return ours / theirs, n


def outcome(lh: float, la: float, max_goals: int) -> tuple[float, float, float]:
    """Home win, draw and away win from independent Poisson goals on the match xG."""
    ph = [math.exp(-lh) * lh**k / math.factorial(k) for k in range(max_goals + 1)]
    pa = [math.exp(-la) * la**k / math.factorial(k) for k in range(max_goals + 1)]
    w = d = l = 0.0
    for i, p in enumerate(ph):
        for j, q in enumerate(pa):
            if i > j:
                w += p * q
            elif i == j:
                d += p * q
            else:
                l += p * q
    tot = w + d + l
    return w / tot, d / tot, l / tot


def build_match(fid: int, cat_id: int, gw: int, date: str, home: str, away: str, hs: int, as_: int, row: dict, ratio: float, max_goals: int) -> dict:
    xh, xa = row["xh"] * ratio, row["xa"] * ratio
    win, draw, loss = outcome(xh, xa, max_goals)
    return {
        "id": fid,
        "gw": gw,
        "date": date,
        "h": home,
        "a": away,
        "hs": hs,
        "as": as_,
        "xh": round(xh, 2),
        "xa": round(xa, 2),
        "sh": row["sh"] if row["sh"] is not None else 0,
        "sa": row["sa"] if row["sa"] is not None else 0,
        "pw": round(win, 3),
        "pd": round(draw, 3),
        "pl": round(loss, 3),
        "xph": round(3 * win + draw, 2),
        "xpa": round(3 * loss + draw, 2),
        "ph": 3 if hs > as_ else 1 if hs == as_ else 0,
        "pa": 3 if as_ > hs else 1 if hs == as_ else 0,
        "shots": [],
        "src": "fd",
        "_cat_id": cat_id,
    }


def fill(matches: list[dict], fixtures: list[tuple], folder: Path, alias_sets: dict[str, list[str]], cfg: dict) -> tuple[list[dict], dict]:
    """Matches to add for finished fixtures that have no catalogue match.

    matches are the catalogue matches already built. fixtures are
    ((home, away), fpl_fixture, catalogue_fixture_id) for the whole season.
    A fixture with a catalogue match is never touched.
    """
    fb_cfg = cfg.get("xg_fallback") or {}
    info = {"used": [], "scale": None, "overlap": 0, "unmatched": [], "skipped": []}
    have = {m["_cat_id"] for m in matches}
    waiting = [(pair, fpl, cid) for pair, fpl, cid in fixtures if fpl.get("finished") and cid not in have]
    if not waiting or not fb_cfg.get("enabled"):
        return [], info
    rows = load_rows(folder / f"{fb_cfg['division']}.csv")
    fd, unmatched = by_pair(rows, alias_sets, cfg)
    ratio, overlap = scale(matches, fd)
    info.update({"scale": round(ratio, 4) if ratio else None, "overlap": overlap, "unmatched": unmatched[:5]})
    if ratio is None or overlap < int(fb_cfg["min_overlap_matches"]):
        info["skipped"].append(
            f"Only {overlap} matches overlap with football-data, fewer than {fb_cfg['min_overlap_matches']}, so its xG was not rescaled or used."
        )
        return [], info
    out = []
    for pair, fpl, cid in waiting:
        if fpl.get("team_h_score") is None or fpl.get("team_a_score") is None or not fpl.get("event"):
            info["skipped"].append(f"{pair[0]} vs {pair[1]}: no official score")
            continue
        hs, as_ = int(fpl["team_h_score"]), int(fpl["team_a_score"])
        row = fd.get(pair)
        if row is None:
            info["skipped"].append(f"{pair[0]} vs {pair[1]}: not in football-data yet")
            continue
        if (row["hs"], row["as"]) != (hs, as_):
            info["skipped"].append(f"{pair[0]} vs {pair[1]}: football-data score {row['hs']}-{row['as']} disagrees")
            continue
        ko = str(fpl.get("kickoff_time") or "")
        out.append(
            build_match(int(fpl["id"]), cid, int(fpl["event"]), ko[:10], pair[0], pair[1], hs, as_, row, ratio, int(cfg["prediction"]["max_goals"]))
        )
        info["used"].append({"home": pair[0], "away": pair[1], "gameweek": int(fpl["event"])})
    return out, info
