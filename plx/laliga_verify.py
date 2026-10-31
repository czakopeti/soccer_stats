"""Checks for the La Liga page. A failure does not touch the Premier League site."""
from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from plx.config import load_config
from plx.laliga_calendar import audit_published_rounds
from plx.language import find_hits
from plx.round_status import describe_round, summary_problems
from plx.verify import _browser, _check, _parse_time


def verify_laliga(root: Path, data: dict, meta: dict, previous: dict | None, browser: bool = True) -> dict:
    checks: list[dict] = []
    teams = list(data["short"])
    n = len(teams)
    rounds = int(data["rounds"])
    per_club = Counter(club for row in data["fx"] for club in row[1:3])
    full = 2 * (n - 1)
    _check(
        checks,
        "League shape",
        n >= 2 and rounds == full and len(data["fx"]) == n * (n - 1) and all(count == full for count in per_club.values()),
        f"{n} clubs, {rounds} matchdays, {len(data['fx'])} fixtures.",
    )
    pairs = Counter((row[1], row[2]) for row in data["fx"])
    _check(
        checks,
        "Every club plays every other club home and away",
        all(v == 1 for v in pairs.values()) and len(pairs) == n * (n - 1),
        f"{len(pairs)} unique home-and-away pairs.",
    )
    bad = []
    for match in data["matches"]:
        shots = [s for s in data["shots"] if s[1] == match["id"] and s[10] != "O"]
        xh = sum(s[9] for s in shots if s[2] == match["h"])
        xa = sum(s[9] for s in shots if s[2] == match["a"])
        if abs(xh - match["xh"]) > 0.08 or abs(xa - match["xa"]) > 0.08:
            bad.append(f"{match['h']} {match['xh']} vs shots {xh:.2f}")
        gh = sum(1 for s in data["shots"] if s[1] == match["id"] and ((s[10] == "G" and s[2] == match["h"]) or (s[10] == "O" and s[2] == match["a"])))
        ga = sum(1 for s in data["shots"] if s[1] == match["id"] and ((s[10] == "G" and s[2] == match["a"]) or (s[10] == "O" and s[2] == match["h"])))
        if gh != match["hs"] or ga != match["as"]:
            bad.append(f"{match['h']} {match['hs']}-{match['as']} but shots count {gh}-{ga}")
    _check(checks, "Shots add up to the match", not bad, "Scores and xG match the shot file." if not bad else "; ".join(bad[:6]))
    _check(
        checks,
        "Penalty xG was measured from this season's penalties",
        int(data["derived"]["pen_n"]) >= 1,
        f"Average of {data['derived']['pen_n']} penalties is {data['derived']['pen_xg']}.",
    )
    _check(checks, "Bookmaker prices are not in the data", "odds" not in data, "The page data has no bookmaker block.")
    if not previous:
        _check(checks, "Player totals did not shrink", True, "First build: there is no earlier week to compare.")
    else:
        old = {p["id"]: p for p in previous.get("players") or []}
        shrunk = [p["n"] for p in data["players"] if p["id"] in old and (p["min"] < old[p["id"]]["min"] or p["g"] < old[p["id"]]["g"])]
        _check(checks, "Player totals did not shrink", not shrunk, "Minutes and goals did not fall." if not shrunk else ", ".join(shrunk[:8]))
    fetched = _parse_time((meta.get("fetch") or {}).get("fetched_at"))
    fresh = fetched is not None and (datetime.now(timezone.utc) - fetched).total_seconds() < 36 * 3600
    _check(checks, "Sources were refreshed", fresh, "The La Liga download is from this run." if fresh else "The La Liga download is missing or older than 36 hours.")

    try:
        gap_days = int(load_config(root / "config" / "model.json")["verify"]["quiet_gap_days"])
    except (OSError, KeyError, TypeError, ValueError):
        gap_days = 12
    note = describe_round(
        meta.get("status_fixtures") or [],
        int(data["gw"]),
        datetime.now(timezone.utc),
        data["cfg"]["display_timezone"],
        meta.get("fixture_changes") or [],
        gap_days=gap_days,
        round_label=data.get("round_name") or "Matchday",
        league_name=data.get("league_name") or "La Liga",
    )
    _check(
        checks,
        "The match file is not behind a completed round",
        note.kind != "lag",
        note.summary,
    )
    round_problems = audit_published_rounds(
        data["fx"],
        data["matches"],
        meta.get("unresolved") or [],
        int(data["gw"]),
        n,
        meta.get("official_current"),
        note.event,
    )
    _check(
        checks,
        "Matchdays add up",
        not round_problems,
        "Completed matches fill the completed rounds, and the current round matches the matchday file."
        if not round_problems
        else " ".join(round_problems),
    )
    verbs = {
        "postponed": "was postponed",
        "abandoned": "was abandoned",
        "cancelled": "was cancelled",
        "suspended": "was suspended",
        "forfeited": "was forfeited",
    }
    held = []
    for item in meta.get("unresolved") or []:
        verb = verbs.get(item.get("status") or "", "has no completed result")
        sentence = f"{item.get('home')} v {item.get('away')} {verb}."
        if sentence not in note.summary:
            held.append(sentence)
    extra = (" " + " ".join(held[:3])) if held else ""
    published_matches = sum(1 for match in data["matches"] if match["gw"] <= data["gw"])
    summary = (
        f"{note.summary}{extra} {data['season']} through matchday {data['gw']}: "
        f"{published_matches} completed matches, {len(data['fx'])} fixtures."
    )
    problems = summary_problems(summary, note)
    _check(
        checks,
        "The status line matches the fixtures",
        not problems,
        summary if not problems else " ".join(problems),
    )
    text_hits = find_hits(data.get("banner") or "") + find_hits(data.get("credit") or "") + find_hits(data.get("omitted_note") or "")
    _check(checks, "The page text is English", not text_hits, "No Hungarian in the La Liga notes." if not text_hits else "; ".join(text_hits[:4]))
    if browser:
        page = root / "site" / "laliga" / "index.html"
        ok_browser, detail = _browser(page, list(data["short"]) + [p["n"] for p in data["players"]], root / "review" / "laliga-copy.txt")
        _check(checks, "The page opens and every tab has content", ok_browser, detail)
    else:
        _check(checks, "The page opens and every tab has content", False, "Browser check was skipped, so this build cannot be published.")
    ok = all(c["pass"] for c in checks)
    if not ok:
        failed = [c["name"] for c in checks if not c["pass"]]
        summary = "The new build was not published. " + note.summary + " Failed checks: " + ", ".join(failed) + "."
    return {
        "ok": ok,
        "timestamp": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "season": data.get("season"),
        "gameweek": data.get("gw"),
        "no_new_round": bool(meta.get("no_new_round")),
        "summary": summary,
        "checks": checks,
        "fixture_changes": meta.get("fixture_changes") or [],
        "europe": {"fixtures": (meta.get("europe") or {}).get("fixtures"), "note": data.get("europe_note")},
    }
