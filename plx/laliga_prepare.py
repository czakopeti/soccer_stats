"""Build the La Liga page JSON from the shot feed and historical results.

Club names are learned by joining this season's result file to the shot feed
on date and score. They are not typed in. Bookmaker columns in the result
file are never read.
"""
from __future__ import annotations

import collections
import csv
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from plx.elo import EloError, build_priors, load_history_matches
from plx.europe import EuropeError, to_team_rows
from plx.names import ClubIndex, NameError, UnmappedName
from plx.laliga_calendar import apply_official_rounds
from plx.prepare import PrepareError, _fixture_changes, _outcome


def _load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _utc(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _fd_day(value: str) -> str:
    day, month, year = value.split("/")
    return f"{year}-{month}-{day}"


def learn_aliases(fd_rows: list[dict], matches: list[dict]) -> dict[str, str]:
    """Map a results-file spelling onto the shot-feed club name. Ambiguous rows are skipped."""
    by_score: dict[tuple, list[dict]] = {}
    for match in matches:
        if not match["result"]:
            continue
        key = (match["day"], match["hg"], match["ag"])
        by_score.setdefault(key, []).append(match)
        # The results file dates a late kickoff on the local evening, which can be the next UTC day.
        prev = (datetime.strptime(match["day"], "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
        by_score.setdefault((prev, match["hg"], match["ag"]), []).append(match)
    mapping: dict[str, str] = {}
    for row in fd_rows:
        key = (_fd_day(row["Date"]), int(row["FTHG"]), int(row["FTAG"]))
        options = by_score.get(key) or []
        unique = {(m["home"], m["away"]) for m in options}
        if len(unique) != 1:
            continue
        home, away = unique.pop()
        mapping.setdefault(row["HomeTeam"].strip(), home)
        mapping.setdefault(row["AwayTeam"].strip(), away)
    return mapping


def _position(raw: str) -> str:
    parts = set((raw or "").split())
    if "GK" in parts:
        return "GKP"
    if "F" in parts:
        return "FWD"
    if "D" in parts and "M" not in parts:
        return "DEF"
    return "MID"


def prepare_laliga(root: Path, model: dict, league: dict, previous: dict | None) -> tuple[dict, dict]:
    src = root / "sources" / "laliga"
    manifest = _load(src / "fetch_manifest.json")
    payload = _load(src / "league.json")
    th = model["thresholds"]
    res_map = model["shot_results"]
    sit_map = model["shot_situations"]
    now = datetime.now(timezone.utc)

    dates = payload["dates"]
    if len(dates) < 2:
        raise PrepareError("The shot feed did not return a fixture list.")
    short = {}
    canonical = []
    for team in payload["teams"].values():
        canonical.append(team["title"])
    fixtures = []
    for row in dates:
        home = row["h"]["title"]
        away = row["a"]["title"]
        short[home] = row["h"].get("short_title") or home[:3]
        short[away] = row["a"].get("short_title") or away[:3]
        fixtures.append(
            {
                "id": str(row["id"]),
                "home": home,
                "away": away,
                "kick": _utc(row["datetime"]),
                "result": bool(row.get("isResult")),
                "hg": None if row["goals"]["h"] is None else int(row["goals"]["h"]),
                "ag": None if row["goals"]["a"] is None else int(row["goals"]["a"]),
                "day": row["datetime"][:10],
            }
        )
    teams = sorted(set(short))
    if len(teams) < 2:
        raise PrepareError("The shot feed did not name the clubs.")
    calendar_text = (src / "matchdays.txt").read_text(encoding="utf-8")
    espn_events = _load(src / "espn_fixtures.json")
    official = apply_official_rounds(
        fixtures,
        calendar_text,
        espn_events,
        model,
        slack_days=int(league.get("matchday_date_slack_days", 2)),
    )
    rounds = official["rounds"]
    unresolved = official["unresolved"]
    official_current = official["official_current"]
    expected_rounds = 2 * (len(teams) - 1)
    assigned_rounds = int(official["round_count"])
    played_by = {}
    for row in fixtures:
        played_by[row["home"]] = played_by.get(row["home"], 0) + 1
        played_by[row["away"]] = played_by.get(row["away"], 0) + 1
    if len(fixtures) != len(teams) * (len(teams) - 1) or any(n != expected_rounds for n in played_by.values()):
        raise PrepareError(
            f"The fixture list does not make a home-and-away league: {len(teams)} clubs, "
            f"{len(fixtures)} fixtures."
        )

    fd_rows = []
    with (src / "current_results.csv").open(encoding="utf-8-sig", newline="") as fh:
        for rec in csv.DictReader(fh):
            if rec.get("FTHG") in (None, "") or rec.get("FTAG") in (None, ""):
                continue
            fd_rows.append(rec)
    aliases = learn_aliases(fd_rows, fixtures)
    missing_now = [team for team in teams if team not in set(aliases.values())]
    if missing_now:
        raise PrepareError(
            "These clubs never lined up with the results file, so historical names cannot be learned: "
            + ", ".join(missing_now)
        )

    start_year = int(manifest["season_start_year"])
    season = f"{start_year}/{str(start_year + 1)[-2:]}"
    history = load_history_matches(src / "history", manifest["history"]["season_codes"], league["history_divisions"])
    first = min(row["kick"] for row in fixtures)
    alias_sets = {team: [team, short.get(team, "")] for team in teams}
    for spelling, canonical_name in aliases.items():
        alias_sets.setdefault(canonical_name, [canonical_name]).append(spelling)
    espn_aliases = _load(src / "europe_aliases.json")
    index = ClubIndex(model)
    for team, names in alias_sets.items():
        index.add(team, names)
    for info in espn_aliases:
        try:
            team = index.match(info.get("display") or "")
        except UnmappedName:
            continue
        alias_sets[team].extend(info.get("aliases") or [])
    try:
        priors = build_priors(history, teams, alias_sets, first.replace(tzinfo=None), model, division=league["top_division"])
    except (EloError, NameError) as exc:
        raise PrepareError(str(exc)) from exc
    rates = priors["goal_rates"]

    shot_rows = []
    matches = []
    disagreements = []
    fd_index = {}
    for rec in fd_rows:
        home = aliases.get(rec["HomeTeam"].strip())
        away = aliases.get(rec["AwayTeam"].strip())
        if not home or not away:
            continue
        fd_index[(home, away, _fd_day(rec["Date"]))] = (int(rec["FTHG"]), int(rec["FTAG"]))
    pen_xg_values = []
    padd = collections.Counter()
    dec = collections.Counter()
    ug = collections.Counter()
    x_scale = float(th["shot_x_scale"])
    y_scale = float(th["shot_y_scale"])
    box_x = float(th["outside_box_understat_x"])
    big = float(th["big_chance_xg"])
    late = int(th["late_goal_minute"])
    player_extra: dict[int, dict] = {}

    for row in fixtures:
        if not row["result"]:
            continue
        body = _load(src / "matches" / f"{row['id']}.json")
        shots = body.get("shots") or {}
        flat = []
        seen_shot = set()
        for side_key, side_name, opp_name in (("h", row["home"], row["away"]), ("a", row["away"], row["home"])):
            for shot in shots.get(side_key) or []:
                # The feed sometimes repeats a shot under a second id. Same player, minute, outcome and xG is one shot.
                signature = (
                    side_key,
                    str(shot.get("player_id") or shot.get("player") or ""),
                    str(shot.get("minute") or ""),
                    shot.get("result") or "",
                    round(float(shot.get("xG") or 0), 4),
                    shot.get("situation") or "",
                )
                if signature in seen_shot:
                    continue
                seen_shot.add(signature)
                flat.append((side_key, side_name, opp_name, shot))
        flat.sort(key=lambda item: (int(item[3].get("minute") or 0), int(item[3].get("id") or 0)))
        if not flat:
            raise PrepareError(f"{row['home']} v {row['away']} is marked finished but has no shots.")
        home_xg = [float(s["xG"]) for side, _, _, s in flat if side == "h" and s.get("result") != "OwnGoal"]
        away_xg = [float(s["xG"]) for side, _, _, s in flat if side == "a" and s.get("result") != "OwnGoal"]
        win, draw, loss = _outcome(home_xg, away_xg)
        hs, as_ = int(row["hg"]), int(row["ag"])
        fd_score = None
        for shift in (0, -1, 1):
            day = (row["kick"] + timedelta(days=shift)).strftime("%Y-%m-%d")
            fd_score = fd_index.get((row["home"], row["away"], day))
            if fd_score:
                break
        if fd_score and fd_score != (hs, as_):
            disagreements.append(f"{row['home']} {hs}-{as_} vs results file {fd_score[0]}-{fd_score[1]}")
        scored = []
        for side, team, opp, shot in flat:
            result_name = shot.get("result") or ""
            if result_name == "OwnGoal":
                scored.append((opp, None))
            elif result_name == "Goal":
                scorer = int(shot.get("player_id") or -1)
                scored.append((team, scorer if scorer >= 0 else None))
        def _pts(gf: int, ga: int) -> int:
            return 3 if gf > ga else 1 if gf == ga else 0
        for tm, scorer in scored:
            if scorer is None:
                continue
            gf, ga = (hs, as_) if tm == row["home"] else (as_, hs)
            padd[scorer] += _pts(gf, ga) - _pts(gf - 1, ga)
        for tm, (gf, ga) in ((row["home"], (hs, as_)), (row["away"], (as_, hs))):
            if gf <= ga:
                continue
            mine = [scorer for club, scorer in scored if club == tm]
            if len(mine) > ga and mine[ga] is not None:
                dec[mine[ga]] += 1
        gw = rounds[row["id"]]
        fid = int(row["id"])
        embedded = []
        for side, team, opp, shot in flat:
            result = shot.get("result") or ""
            situation = shot.get("situation") or ""
            if result not in res_map or situation not in sit_map:
                raise PrepareError(f"Unrecognised shot label {result!r} / {situation!r}. The build stopped.")
            minute = int(shot.get("minute") or 0)
            xg = float(shot.get("xG") or 0)
            player = shot.get("player") or ""
            pid = int(shot.get("player_id") or -1)
            embedded.append([minute, 0 if side == "h" else 1, round(xg, 3), res_map[result], player])
            if situation == "Penalty" and result != "OwnGoal":
                pen_xg_values.append(xg)
            extra = player_extra.setdefault(pid, {"sot": 0, "hg": 0, "ob": 0, "lg": 0, "bc": 0, "bcm": 0, "pg": 0, "dist": 0.0, "dn": 0})
            on_target = result in {"Goal", "SavedShot"}
            if on_target:
                extra["sot"] += 1
            if result == "Goal" and shot.get("shotType") == "Head":
                extra["hg"] += 1
            if result == "Goal" and situation != "Penalty" and float(shot.get("X") or 0) < box_x:
                extra["ob"] += 1
            if result == "Goal" and minute >= late:
                extra["lg"] += 1
            if xg >= big and result != "OwnGoal":
                extra["bc"] += 1
                if result != "Goal":
                    extra["bcm"] += 1
            if situation == "Penalty" and result == "Goal":
                extra["pg"] += 1
            if result == "Goal" and pid >= 0 and situation != "Penalty":
                assisted = shot.get("player_assisted")
                if not (isinstance(assisted, str) and assisted.strip()):
                    ug[pid] += 1
            if result != "OwnGoal":
                # Understat X,Y are 0–1 from the attacking goal. Distance is descriptive only.
                dx = (1 - float(shot.get("X") or 0)) * float(th["pitch_length_m"])
                dy = (float(shot.get("Y") or 0) - 0.5) * float(th["pitch_width_m"])
                extra["dist"] += (dx * dx + dy * dy) ** 0.5
                extra["dn"] += 1
            shot_rows.append(
                [
                    gw,
                    fid,
                    team,
                    opp,
                    player,
                    shot.get("player_assisted") or "",
                    minute,
                    round(float(shot.get("X") or 0) * x_scale, 1),
                    round(float(shot.get("Y") or 0) * y_scale, 1),
                    round(xg, 3),
                    res_map[result],
                    sit_map[situation],
                    shot.get("shotType") or "",
                    shot.get("lastAction") or "None",
                    pid,
                    int(shot.get("id") or 0),
                ]
            )
        matches.append(
            {
                "id": fid,
                "gw": gw,
                "date": _iso(row["kick"])[:10],
                "h": row["home"],
                "a": row["away"],
                "hs": hs,
                "as": as_,
                "xh": round(sum(home_xg), 2),
                "xa": round(sum(away_xg), 2),
                "sh": len(home_xg),
                "sa": len(away_xg),
                "pw": round(win, 3),
                "pd": round(draw, 3),
                "pl": round(loss, 3),
                "xph": round(3 * win + draw, 2),
                "xpa": round(3 * loss + draw, 2),
                "ph": 3 if hs > as_ else 1 if hs == as_ else 0,
                "pa": 3 if as_ > hs else 1 if hs == as_ else 0,
                "shots": embedded,
            }
        )
    if not pen_xg_values:
        raise PrepareError("This season's shots include no penalties, so non-penalty xG cannot be calculated.")
    if disagreements:
        raise PrepareError("Scores disagree with the results file: " + "; ".join(disagreements[:6]))

    players = []
    for person in payload["players"]:
        pid = int(person["id"])
        extra = player_extra.get(pid, {})
        minutes = int(person.get("time") or 0)
        players.append(
            {
                "id": pid,
                "n": person.get("player_name") or "",
                "full": person.get("player_name") or "",
                "t": person.get("team_title") or "",
                "pos": _position(person.get("position") or ""),
                "min": minutes,
                "g": int(person.get("goals") or 0),
                "npg": int(person.get("npg") or 0),
                "xg": round(float(person.get("xG") or 0), 2),
                "npxg": round(float(person.get("npxG") or 0), 2),
                "a": int(person.get("assists") or 0),
                "xa": round(float(person.get("xA") or 0), 2),
                "sh": int(person.get("shots") or 0),
                "kp": int(person.get("key_passes") or 0),
                "yc": int(person.get("yellow_cards") or 0),
                "rc": int(person.get("red_cards") or 0),
                "sot": extra.get("sot", 0),
                "hg": extra.get("hg", 0),
                "ob": extra.get("ob", 0),
                "lg": extra.get("lg", 0),
                "bc": extra.get("bc", 0),
                "bcm": extra.get("bcm", 0),
                "pg": extra.get("pg", 0),
                "padd": int(padd[pid]),
                "dec": int(dec[pid]),
                "ug": int(ug[pid]),
                "dist": round(extra["dist"] / extra["dn"], 1) if extra.get("dn") else None,
                "stt": "a",
                "news": "",
            }
        )

    opta = {}
    for team in payload["teams"].values():
        hist = team.get("history") or []
        ratios = []
        for item in hist:
            block = item.get("ppda") or {}
            att = float(block.get("att") or 0)
            defence = float(block.get("def") or 0)
            if defence > 0:
                ratios.append(att / defence)
        opta[team["title"]] = {"sequences_ppda": round(sum(ratios) / len(ratios), 2)} if ratios else {}

    fx = []
    status_rows = []
    changes_seed = []
    for row in fixtures:
        gw = rounds[row["id"]]
        fx.append([gw, row["home"], row["away"], _iso(row["kick"]), 1 if row["result"] else 0, int(row["id"])])
        status_rows.append(
            {
                "event": gw,
                "kickoff": _iso(row["kick"]),
                "finished": bool(row["result"]),
                "started": bool(row.get("live")),
                "home": row["home"],
                "away": row["away"],
            }
        )
        if row.get("flag"):
            changes_seed.append(
                {
                    "kind": row["flag"],
                    "id": int(row["id"]),
                    "gameweek": gw,
                    "home": row["home"],
                    "away": row["away"],
                    "was": None,
                    "now": _iso(row["kick"]),
                }
            )
    changes, _note = _fixture_changes(previous, fx)
    changes = changes_seed + changes
    # A round is published only when every match in it has a result, or ESPN has
    # flagged it (abandoned, postponed, cancelled, suspended). The shot feed being
    # slow to update is not a flag.
    played_gw = assigned_rounds if official_current is None else official_current - 1
    euro_events = _load(src / "europe_events.json")
    try:
        euro, coverage = to_team_rows(euro_events, teams, alias_sets, model)
    except EuropeError as exc:
        raise PrepareError(str(exc)) from exc
    month = now.month
    if month in set(model["sources"]["europe_required_months"]) and coverage["fixtures"] == 0:
        raise PrepareError(
            "No European fixtures were found for these clubs. Rest days would quietly ignore Europe, so the build stopped."
        )
    client_cfg = {
        "display_timezone": model["display_timezone"],
        "ratings": model["ratings"],
        "prediction": model["prediction"],
        "simulation": model["simulation"],
        "places": league["places"],
        "thresholds": model["thresholds"],
        "set_piece_situations": model["set_piece_situations"],
        "competitions": {c["code"]: c["label"] for c in model["sources"]["european_competitions"]},
    }
    data = {
        "league_name": league["league_name"],
        "brand": league["brand"],
        "page_title": league["page_title"],
        "round_name": league["round_name"],
        "domestic_name": league["domestic_name"],
        "other_href": league["other_href"],
        "other_label": league["other_label"],
        "hide_opta": True,
        "hide_empty_profile": True,
        "hide_groups": league["hide_groups"],
        "hide_top": league["hide_top"],
        "hide_empty_cols": bool(league.get("hide_empty_cols")),
        "round_abbr": league.get("round_abbr") or "",
        "player_note": league.get("player_note") or "",
        "cup_clause": league.get("cup_clause") or "",
        "history_phrase": league["history_phrase"],
        "rate_phrase": league["rate_phrase"],
        "profile_title": league["profile_title"],
        "absence_note": league["absence_note"],
        "omitted_note": league["omitted_note"],
        "banner": league["banner"],
        "credit": league["credit"] + f" Updated {now.date().isoformat()}, matchdays 1–{played_gw}.",
        "season": season,
        "season_start_year": start_year,
        "gw": int(played_gw),
        "rounds": assigned_rounds,
        "exported": manifest.get("fetched_at"),
        "generated_at": now.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "short": short,
        "fx": fx,
        "matches": matches,
        "shots": shot_rows,
        "opta": opta,
        "players": players,
        "euro": euro,
        "prior": priors["prior"],
        "elo": priors["elo"],
        "fixture_changes": changes,
        "europe_note": (
            f"European kickoffs are loaded automatically ({coverage['fixtures']} matches, "
            f"{len(coverage['teams'])} clubs). Domestic cups are not included."
        ),
        "cfg": client_cfg,
        "derived": {
            "league_gpg": round(rates["league_gpg"], 4),
            "home_factor": round(rates["home_factor"], 4),
            "away_factor": round(rates["away_factor"], 4),
            "home_gpg": round(rates["home_gpg"], 4),
            "away_gpg": round(rates["away_gpg"], 4),
            "goal_rate_seasons": rates["seasons"],
            "goal_rate_matches": rates["matches"],
            "pen_xg": round(sum(pen_xg_values) / len(pen_xg_values), 4),
            "pen_n": len(pen_xg_values),
            "elo_hfa": priors["home_advantage"],
            "elo_mean": priors["mean_elo"],
            "history_matches": priors["matches_used"],
            "history_through": priors["history_through"],
        },
    }
    # The ratings model reads DER from the embedded derived block via the same keys the PL page uses.
    # goal_rates() above replaced the history-file measurement. build_priors also measured a rate;
    # the page should use the division-specific one, which is what `rates` is.
    meta = {
        "season": season,
        "gameweek": int(played_gw),
        "no_new_round": bool(previous) and int(previous.get("gw") or 0) == int(played_gw),
        "fixture_changes": changes,
        "status_fixtures": status_rows,
        "unresolved": unresolved,
        "official_current": official_current,
        "europe": coverage,
        "fetch": manifest,
        "shots": len(shot_rows),
        "matches": len(matches),
        "teams": len(teams),
        "rounds": assigned_rounds,
        "fixtures": len(fx),
        "derived": data["derived"],
    }
    return data, meta
