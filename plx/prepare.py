"""Turn the downloaded feeds into the single JSON file the page reads.

Scores, kickoffs, teams and the season label come from the feeds. Pre-season
strength and the league goal rate come from historical results. Penalty xG is
the average of this season's penalties. Nothing here is typed in for one year.
"""
from __future__ import annotations

import collections
import glob
import json
import math
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from plx.elo import build_priors, load_history_matches, season_code
from plx.europe import EuropeError, to_team_rows
from plx.names import link_feeds


class PrepareError(RuntimeError):
    pass


def _load_json(path: Path):
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def _season_identity(first_kickoff: str, tz_name: str) -> tuple[int, str, str]:
    dt = datetime.fromisoformat(first_kickoff.replace("Z", "+00:00")).astimezone(ZoneInfo(tz_name))
    start = dt.year if dt.month >= 7 else dt.year - 1
    label = f"{start}/{str(start + 1)[-2:]}"
    folder = f"{start}-{str(start + 1)[-2:]}"
    return start, label, folder


def _iso_z(value: str | None) -> str | None:
    if not value or (isinstance(value, float) and math.isnan(value)):
        return None
    text = str(value).strip()
    if not text or text.lower() == "none":
        return None
    if text.endswith("Z") or "+" in text[10:]:
        return text.replace("+00:00", "Z")
    # Catalogue sometimes stores a kickoff with no timezone. The Premier League feed is the authority.
    return text


def _poisson_binomial(xgs: list[float]) -> np.ndarray:
    p = np.zeros(len(xgs) + 1)
    p[0] = 1.0
    for x in xgs:
        p[1:] = p[1:] * (1 - x) + p[:-1] * x
        p[0] *= 1 - x
    return p


def _outcome(xh: list[float], xa: list[float]) -> tuple[float, float, float]:
    ph, pa = _poisson_binomial(xh), _poisson_binomial(xa)
    grid = np.outer(ph, pa)
    return float(np.tril(grid, -1).sum()), float(np.trace(grid)), float(np.triu(grid, 1).sum())


def _fixture_changes(previous: dict | None, fx: list) -> tuple[list, str | None]:
    if not previous or not previous.get("fx"):
        return [], "First build: there is no earlier fixture list to compare."
    old = {}
    for row in previous["fx"]:
        if len(row) < 6:
            continue
        old[row[5]] = row
    changes = []
    new_ids = set()
    for row in fx:
        new_ids.add(row[5])
        prev = old.get(row[5])
        if prev is None:
            changes.append(
                {"kind": "added", "id": row[5], "gameweek": row[0], "home": row[1], "away": row[2], "kickoff": row[3]}
            )
            continue
        if prev[3] != row[3]:
            changes.append(
                {
                    "kind": "postponed" if not row[3] else "rescheduled",
                    "id": row[5],
                    "gameweek": row[0],
                    "home": row[1],
                    "away": row[2],
                    "was": prev[3],
                    "now": row[3],
                }
            )
        if prev[0] != row[0]:
            changes.append(
                {
                    "kind": "moved_gameweek",
                    "id": row[5],
                    "home": row[1],
                    "away": row[2],
                    "was": prev[0],
                    "now": row[0],
                }
            )
    for fid, prev in old.items():
        if fid not in new_ids:
            changes.append(
                {"kind": "removed", "id": fid, "gameweek": prev[0], "home": prev[1], "away": prev[2], "kickoff": prev[3]}
            )
    return changes, None


def _num(value):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    if isinstance(value, str) and value.strip() == "":
        return None
    return value


def prepare(root: Path, cfg: dict, previous: dict | None = None) -> tuple[dict, dict]:
    sources = root / "sources"
    manifest = _load_json(sources / "fetch_manifest.json")
    bootstrap = _load_json(sources / "fpl" / "bootstrap.json")
    fpl_fixtures = _load_json(sources / "fpl" / "fixtures.json")
    events = bootstrap["events"]
    fpl_teams = bootstrap["teams"]
    if not events or not fpl_teams or not fpl_fixtures:
        raise PrepareError("The Premier League feed came back empty.")

    by_id = {int(t["id"]): t for t in fpl_teams}
    kickoffs = [f["kickoff_time"] for f in fpl_fixtures if f.get("kickoff_time")]
    if not kickoffs:
        raise PrepareError("No fixture has a kickoff time, so the season cannot be identified.")
    start_year, season_label, folder = _season_identity(min(kickoffs), cfg["display_timezone"])
    if int(manifest["season_start_year"]) != start_year:
        raise PrepareError(
            f"The download was for a season starting {manifest['season_start_year']}, "
            f"but the fixtures start in {start_year}. The two sources disagree, so nothing was published."
        )

    catalogue = sources / "pl-catalogue" / "data" / folder
    if not catalogue.is_dir():
        found = []
        data_root = sources / "pl-catalogue" / "data"
        if data_root.is_dir():
            found = sorted(p.name for p in data_root.iterdir() if p.is_dir())
        raise PrepareError(
            f"pl-catalogue has no {folder} folder for the {season_label} season. Folders present: {found or 'none'}."
        )
    cat_manifest = _load_json(catalogue / "manifest.json")
    if str(cat_manifest.get("season", "")).replace("/", "-") not in (folder, season_label.replace("/", "-")):
        raise PrepareError(
            f"pl-catalogue says the folder is season {cat_manifest.get('season')!r}, "
            f"but the Premier League fixtures are {season_label}. The build stopped."
        )

    n_teams = len(fpl_teams)
    n_rounds = len(events)
    expected_rounds = 2 * (n_teams - 1)
    if n_rounds != expected_rounds:
        raise PrepareError(
            f"The Premier League lists {n_teams} clubs and {n_rounds} gameweeks. "
            f"A home-and-away league of {n_teams} clubs should have {expected_rounds} gameweeks. "
            "The build stopped rather than assume a number."
        )

    clubs = pd.read_csv(catalogue / "clubs.csv")
    short_by_cat = dict(zip(clubs.name, clubs.short_name))
    canonical = []
    for team in fpl_teams:
        name = team["name"]
        short = team.get("short_name") or short_by_cat.get(name)
        if not short:
            raise PrepareError(f"{name} has no short name on the Premier League feed or in pl-catalogue.")
        canonical.append((name, short))
    fpl_names = {name for name, _short in canonical}
    cat_names = set(clubs.name)
    if cat_names != fpl_names:
        raise PrepareError(
            "pl-catalogue's club list does not match the Premier League feed. "
            f"Only on the Premier League feed: {sorted(fpl_names - cat_names)}. "
            f"Only in pl-catalogue: {sorted(cat_names - fpl_names)}."
        )
    short = {name: code for name, code in canonical}

    espn_raw = _load_json(sources / "europe" / "aliases.json")
    espn_clubs = [
        {
            "display": row.get("display"),
            "aliases": row.get("aliases") or [],
        }
        for row in espn_raw
    ]
    alias_sets = link_feeds(canonical, espn_clubs, cfg)

    # --- fixtures: FPL is the authority for dates and gameweeks ---
    pair_to_fpl = {}
    fx = []
    unscheduled = []
    for f in sorted(fpl_fixtures, key=lambda r: (r.get("event") or 999, r.get("kickoff_time") or "", r.get("id") or 0)):
        try:
            home = by_id[int(f["team_h"])]["name"]
            away = by_id[int(f["team_a"])]["name"]
        except KeyError as exc:
            raise PrepareError(f"Fixture {f.get('id')} names a club id that is not in this season: {exc}") from exc
        pair = (home, away)
        if pair in pair_to_fpl:
            raise PrepareError(f"{home} vs {away} appears twice in the fixture list.")
        gw = f.get("event")
        ko = _iso_z(f.get("kickoff_time"))
        finished = bool(f.get("finished"))
        pair_to_fpl[pair] = f
        fx.append([int(gw) if gw else None, home, away, ko, 1 if finished else 0, int(f["id"])])
        if not gw or not ko:
            unscheduled.append({"home": home, "away": away, "gameweek": gw, "kickoff": ko, "id": int(f["id"])})

    if len(fx) != n_teams * (n_teams - 1):
        raise PrepareError(
            f"Expected {n_teams * (n_teams - 1)} fixtures for {n_teams} clubs, and the feed has {len(fx)}."
        )
    counts = collections.Counter()
    for row in fx:
        counts[row[1]] += 1
        counts[row[2]] += 1
    bad = [t for t, n in counts.items() if n != expected_rounds]
    if bad or len(counts) != n_teams:
        raise PrepareError(f"These clubs do not have {expected_rounds} fixtures: {bad or counts}.")

    cat_fx = pd.read_csv(catalogue / "fixtures.csv")
    cat_by_pair = {}
    for rec in cat_fx.itertuples(index=False):
        pair = (rec.home_team, rec.away_team)
        if pair in cat_by_pair:
            raise PrepareError(f"pl-catalogue lists {pair[0]} vs {pair[1]} more than once.")
        cat_by_pair[pair] = rec
    missing_pairs = [p for p in pair_to_fpl if p not in cat_by_pair]
    extra_pairs = [p for p in cat_by_pair if p not in pair_to_fpl]
    if missing_pairs or extra_pairs:
        raise PrepareError(
            "The fixture pairs in pl-catalogue do not match the Premier League feed. "
            f"Missing from catalogue (first 5): {missing_pairs[:5]}. Extra: {extra_pairs[:5]}."
        )

    score_disagreements = []
    kickoff_disagreements = []
    gw_disagreements = []
    for pair, fpl in pair_to_fpl.items():
        cat = cat_by_pair[pair]
        fpl_finished = bool(fpl.get("finished"))
        cat_finished = int(cat.finished) == 1
        if fpl_finished and cat_finished:
            fs = (int(fpl["team_h_score"]), int(fpl["team_a_score"]))
            cs = (int(cat.home_score), int(cat.away_score))
            if fs != cs:
                score_disagreements.append({"home": pair[0], "away": pair[1], "fpl": list(fs), "catalogue": list(cs)})
        if fpl.get("event") and int(cat.gw) != int(fpl["event"]):
            gw_disagreements.append({"home": pair[0], "away": pair[1], "fpl": int(fpl["event"]), "catalogue": int(cat.gw)})
        cat_ko = _iso_z(str(cat.kickoff_time).replace(" ", "T"))
        fpl_ko = _iso_z(fpl.get("kickoff_time"))
        if cat_ko and fpl_ko and cat_ko[:16] != fpl_ko[:16]:
            kickoff_disagreements.append({"home": pair[0], "away": pair[1], "fpl": fpl_ko, "catalogue": cat_ko})

    # --- shots and matches ---
    shots_df = pd.read_csv(catalogue / "shots.csv")
    res_map = cfg["shot_results"]
    sit_map = cfg["shot_situations"]
    unknown_res = sorted(set(shots_df.result.dropna()) - set(res_map))
    unknown_sit = sorted(set(shots_df.situation.dropna()) - set(sit_map))
    if unknown_res or unknown_sit:
        raise PrepareError(
            "The shot file uses labels this build does not know, so they were not guessed. "
            f"Results: {unknown_res or 'none'}. Situations: {unknown_sit or 'none'}. "
            "Add them to config/model.json once you know what they mean."
        )

    sid_to_pid = {}
    player_dir = catalogue / "players"
    shot_files = glob.glob(str(player_dir / "*" / "shots.csv"))
    if not shot_files:
        raise PrepareError(f"No per-player shot files under {player_dir}. Shot-to-player links cannot be built.")
    for fp in shot_files:
        try:
            part = pd.read_csv(fp, usecols=["shot_id", "player_id"])
        except Exception:
            continue
        sid_to_pid.update(dict(zip(part.shot_id, part.player_id)))

    th = cfg["thresholds"]
    big = float(th["big_chance_xg"])
    box_x = float(th["outside_box_understat_x"])
    pitch_l = float(th["pitch_length_m"])
    pitch_w = float(th["pitch_width_m"])
    x_scale = float(th["shot_x_scale"])
    y_scale = float(th["shot_y_scale"])

    matches = []
    shot_rows = []
    played_fpl_ids = []
    for pair, fpl in pair_to_fpl.items():
        if not fpl.get("finished"):
            continue
        cat = cat_by_pair[pair]
        if int(cat.finished) != 1:
            continue
        fid_cat = int(cat.fixture_id)
        fid = int(fpl["id"])
        gw = int(fpl["event"])
        home, away = pair
        g = shots_df[shots_df.fixture_id == fid_cat].sort_values(["minute", "shot_id"])
        if g.empty:
            # Recorded below as a finished match with no shots. Still an error for verify.
            continue
        g = g.copy()
        g["team"] = [home if r.h_a == "h" else away for r in g.itertuples()]
        g["opp"] = [away if r.h_a == "h" else home for r in g.itertuples()]
        nh = g[(g.team == home) & (g.result != "OwnGoal")]
        na = g[(g.team == away) & (g.result != "OwnGoal")]
        win, draw, loss = _outcome(nh.xg.astype(float).tolist(), na.xg.astype(float).tolist())
        hs, as_ = int(cat.home_score), int(cat.away_score)
        act_h = 3 if hs > as_ else 1 if hs == as_ else 0
        act_a = 3 if as_ > hs else 1 if hs == as_ else 0
        embedded = []
        for z in g.itertuples():
            embedded.append(
                [int(z.minute), 0 if z.team == home else 1, round(float(z.xg), 3), res_map[z.result], z.player]
            )
        ko = _iso_z(fpl.get("kickoff_time")) or ""
        matches.append(
            {
                "id": fid,
                "gw": gw,
                "date": ko[:10],
                "h": home,
                "a": away,
                "hs": hs,
                "as": as_,
                "xh": round(float(nh.xg.sum()), 2),
                "xa": round(float(na.xg.sum()), 2),
                "sh": int(len(nh)),
                "sa": int(len(na)),
                "pw": round(win, 3),
                "pd": round(draw, 3),
                "pl": round(loss, 3),
                "xph": round(3 * win + draw, 2),
                "xpa": round(3 * loss + draw, 2),
                "ph": act_h,
                "pa": act_a,
                "shots": embedded,
                "_cat_id": fid_cat,
            }
        )
        played_fpl_ids.append(fid)
        for z in g.sort_values(["minute", "shot_id"]).itertuples():
            assist = z.assisted_name if isinstance(z.assisted_name, str) else ""
            last = z.last_action if isinstance(z.last_action, str) else "None"
            pid = sid_to_pid.get(z.shot_id)
            shot_rows.append(
                [
                    gw,
                    fid,
                    z.team,
                    z.opp,
                    z.player,
                    assist,
                    int(z.minute),
                    round(float(z.x) * x_scale, 1),
                    round(float(z.y) * y_scale, 1),
                    round(float(z.xg), 3),
                    res_map[z.result],
                    sit_map[z.situation],
                    z.shot_type,
                    last,
                    int(pid) if pid is not None and not (isinstance(pid, float) and math.isnan(pid)) else -1,
                    int(z.shot_id),
                ]
            )

    # Rebuild shot rows in a stable order and attach pids already included.
    # Goal impact uses catalogue shot ids.
    match_by_cat = {m["_cat_id"]: m for m in matches}
    finished_missing_shots = []
    for pair, fpl in pair_to_fpl.items():
        if not fpl.get("finished"):
            continue
        cat = cat_by_pair[pair]
        if int(cat.fixture_id) not in match_by_cat:
            finished_missing_shots.append({"home": pair[0], "away": pair[1], "gameweek": fpl.get("event")})

    fpl_finished_gw = max((int(e["id"]) for e in events if e.get("finished")), default=0)
    catalogue_gw = max((m["gw"] for m in matches), default=0)

    # Penalty xG from this season's own penalties. No fallback number.
    pen_key = "Penalty"
    penalties = shots_df[shots_df.situation == pen_key]
    # Only penalties in finished matches we kept.
    kept_cat_ids = set(match_by_cat)
    penalties = penalties[penalties.fixture_id.isin(kept_cat_ids)]
    if penalties.empty:
        raise PrepareError(
            "This season's shot file has no penalties, so non-penalty xG cannot be calculated without inventing a number. The build stopped."
        )
    pen_xg = float(penalties.xg.mean())

    # Players
    players_df = pd.read_csv(catalogue / "players.csv")
    if "season_minutes" not in players_df.columns:
        raise PrepareError("players.csv has no season_minutes column.")
    rows = []
    for p in players_df.itertuples(index=False):
        minutes = _num(getattr(p, "season_minutes", None))
        if minutes is None or float(minutes) < 1:
            continue
        if p.team not in fpl_names:
            raise PrepareError(f"Player {p.web_name} is listed at {p.team}, which is not a club in this season.")
        full = getattr(p, "full_name", None)
        if not isinstance(full, str) or not full.strip():
            full = f"{getattr(p, 'first_name', '')} {getattr(p, 'second_name', '')}".strip()
        rows.append(
            {
                "id": int(p.player_id),
                "n": p.web_name,
                "full": full,
                "t": p.team,
                "pos": p.position,
                "min": int(float(minutes)),
                "g": int(float(p.season_goals or 0)),
                "a": int(float(p.season_assists or 0)),
                "xg": round(float(p.season_xg or 0), 2),
                "xa": round(float(getattr(p, "season_xa", 0) or 0), 2),
                "price": float(p.price),
                "sel": float(p.selected_by_percent),
                "pts": int(float(p.total_points or 0)),
            }
        )
    if not rows:
        raise PrepareError("No players with minutes were found.")

    market_path = catalogue / "market.csv"
    mk = {}
    if market_path.exists():
        market = pd.read_csv(market_path).sort_values("fetch_date").groupby("player_id").tail(1)
        mk = dict(zip(market.player_id, market.market_value_eur))
    for r in rows:
        if r["id"] in mk and pd.notna(mk[r["id"]]):
            r["mv"] = float(mk[r["id"]])
        else:
            r["mv"] = None

    # Goal impact and shot-derived player numbers.
    fxi = cat_fx.set_index("fixture_id")
    pts = lambda a, b: 3 if a > b else 1 if a == b else 0
    padd = collections.Counter()
    dec = collections.Counter()
    goals = shots_df[shots_df.result.isin(["Goal", "OwnGoal"]) & shots_df.fixture_id.isin(kept_cat_ids)]
    for fid, g in goals.sort_values(["minute", "shot_id"]).groupby("fixture_id"):
        rec = fxi.loc[fid]
        home, away = rec.home_team, rec.away_team
        hs, as_ = int(rec.home_score), int(rec.away_score)
        seq = []
        for z in g.itertuples():
            shooter = home if z.h_a == "h" else away
            if z.result == "OwnGoal":
                seq.append((away if shooter == home else home, None))
            else:
                pid = sid_to_pid.get(z.shot_id)
                seq.append((shooter, None if pid is None or (isinstance(pid, float) and math.isnan(pid)) else int(pid)))
        for tm, pid in seq:
            if pid is None:
                continue
            gf, ga = (hs, as_) if tm == home else (as_, hs)
            padd[pid] += pts(gf, ga) - pts(gf - 1, ga)
        for tm, (gf, ga) in ((home, (hs, as_)), (away, (as_, hs))):
            if gf > ga:
                mine = [p for t2, p in seq if t2 == tm]
                if len(mine) > ga and mine[ga] is not None:
                    dec[mine[ga]] += 1

    ps = collections.defaultdict(collections.Counter)
    dist = collections.defaultdict(list)
    for z in shots_df[shots_df.fixture_id.isin(kept_cat_ids)].itertuples():
        pid = sid_to_pid.get(z.shot_id)
        if pid is None or (isinstance(pid, float) and math.isnan(pid)) or z.result == "OwnGoal":
            continue
        pid = int(pid)
        c = ps[pid]
        goal = z.result == "Goal"
        c["bc"] += float(z.xg) >= big
        c["bcm"] += (float(z.xg) >= big) and not goal
        if goal:
            c["hg"] += z.shot_type == "Head"
            c["ob"] += float(z.x) < box_x
            c["lg"] += int(z.minute) >= int(th["late_goal_minute"])
            c["ug"] += (not isinstance(z.assisted_name, str)) and z.situation != pen_key
            c["pg"] += z.situation == pen_key
        c["pk"] += z.situation == pen_key
        if z.situation != pen_key:
            dist[pid].append(math.hypot((1 - float(z.x)) * pitch_l, (float(z.y) - 0.5) * pitch_w))

    merged_path = catalogue / "gws" / "merged_gw.csv"
    if not merged_path.exists():
        raise PrepareError("pl-catalogue is missing gws/merged_gw.csv, which holds defensive contributions.")
    merged = pd.read_csv(merged_path)
    if "defensive_contribution" not in merged.columns or "element" not in merged.columns:
        raise PrepareError("merged_gw.csv has no defensive contribution column.")
    dc = merged.groupby("element").defensive_contribution.sum()

    pi = players_df.set_index("player_id")
    opt_cols = {
        "sh": "opta_shots",
        "sot": "opta_shots_on_target",
        "npg": "opta_np_goals",
        "npxg": "opta_np_xg",
        "opxa": "opta_op_xa",
        "cc": "opta_chances_created",
        "occ": "opta_op_chances_created",
        "tb": "opta_successful_through_balls",
        "cr": "opta_successful_op_crosses",
        "f3": "opta_successful_final_third_passes",
        "pas": "opta_passes",
        "pp": "opta_pass_perc",
        "car": "opta_carries",
        "pc": "opta_progressive_carries",
        "pd": "opta_progressive_distance",
        "tck": "opta_tackles",
        "rec": "opta_recoveries",
        "itc": "opta_interceptions",
        "blk": "opta_blocks",
        "clr": "opta_clearances",
        "gdw": "opta_ground_duels_won",
        "gdt": "opta_ground_duels",
        "adw": "opta_aerial_duels_won",
        "adt": "opta_aerial_duels",
        "sv": "opta_saves_made",
        "svp": "opta_save_perc",
        "gpv": "opta_goals_prevented",
        "xgot": "opta_xgot_conceded",
        "gc": "opta_goals_conceded",
        "yc": "opta_yellows",
        "rc": "opta_reds",
        "fc": "opta_fouls_commited",
        "kp": "understat_key_passes",
        "cs": "season_clean_sheets",
        "st": "season_starts",
        "form": "form",
        "epn": "ep_next",
        "age": "age_at_fetch",
        "cop": "chance_of_playing_next_round",
    }

    def cell(pid, col):
        if col not in pi.columns or pid not in pi.index:
            return None
        value = pi.loc[pid, col]
        if isinstance(value, pd.Series):
            value = value.iloc[0]
        if value is None or (isinstance(value, float) and math.isnan(value)) or pd.isna(value):
            return None
        return round(float(value), 2)

    unmapped_shots = 0
    for r in rows:
        pid = r["id"]
        for key, col in opt_cols.items():
            value = cell(pid, col)
            if value is not None or key not in r:
                r[key] = value
        c = ps.get(pid, collections.Counter())
        for key in ("bc", "bcm", "hg", "ob", "lg", "ug", "pg", "pk"):
            r[key] = int(c[key])
        r["npg"] = r["g"] - r["pg"]
        r["npxg"] = round(max(0.0, r["xg"] - pen_xg * r["pk"]), 2)
        r["dist"] = round(sum(dist[pid]) / len(dist[pid]), 1) if dist.get(pid) else None
        r["padd"] = int(padd[pid])
        r["dec"] = int(dec[pid])
        r["dc"] = int(dc.get(pid, 0))
        status = pi.loc[pid, "status"] if "status" in pi.columns else "a"
        if isinstance(status, pd.Series):
            status = status.iloc[0]
        news = pi.loc[pid, "news"] if "news" in pi.columns else ""
        if isinstance(news, pd.Series):
            news = news.iloc[0]
        r["stt"] = status if isinstance(status, str) else "a"
        r["news"] = news if isinstance(news, str) and r["stt"] != "a" else ""

    for row in shot_rows:
        if row[14] < 0:
            unmapped_shots += 1

    # Opta team metrics
    club_stats = pd.read_csv(catalogue / "club_stats.csv")
    piv = club_stats.pivot_table(index="team", columns="metric", values="value", aggfunc="first")
    wanted = cfg["opta_team_metrics"]
    missing_metrics = [m for m in wanted if m not in piv.columns]
    opta = {}
    for team in fpl_names:
        if team not in piv.index:
            opta[team] = {}
            continue
        opta[team] = {}
        for key in wanted:
            if key not in piv.columns or pd.isna(piv.loc[team].get(key)):
                continue
            opta[team][key] = round(float(piv.loc[team][key]), 2)

    # History → priors and goal rates
    hist_codes = manifest["history"]["season_codes"]
    history = load_history_matches(
        sources / "football-data",
        hist_codes,
        cfg["sources"]["football_data_divisions"],
    )
    first_local = datetime.fromisoformat(min(kickoffs).replace("Z", "+00:00")).astimezone(ZoneInfo(cfg["display_timezone"]))
    season_start = datetime(first_local.year, first_local.month, first_local.day)
    priors = build_priors(history, [name for name, _s in canonical], alias_sets, season_start, cfg)

    # Europe
    events_eu = _load_json(sources / "europe" / "events.json")
    try:
        euro, coverage = to_team_rows(events_eu, [n for n, _s in canonical], alias_sets, cfg)
    except EuropeError:
        raise
    # Client does not need the raw ESPN id. Rows are [team, kickoff, code, opponent, home].
    month = datetime.now(ZoneInfo("UTC")).month
    required = month in set(cfg["sources"]["europe_required_months"])
    if required and coverage["fixtures"] == 0:
        raise PrepareError(
            "No European fixtures were found for Premier League clubs. Rest days would quietly ignore Europe, so the build stopped. "
            "The public fixture feed may be down or blocking this runner."
        )

    for m in matches:
        m.pop("_cat_id", None)

    changes, change_note = _fixture_changes(previous, fx)
    no_new_round = bool(previous) and int(previous.get("gw") or 0) == int(catalogue_gw)

    comp_labels = {c["code"]: c["label"] for c in cfg["sources"]["european_competitions"]}
    europe_note = (
        f"European kickoffs are loaded automatically ({coverage['fixtures']} matches, "
        f"{len(coverage['teams'])} Premier League clubs). "
        "Domestic cup ties are not included, so a midweek cup game will not show up in the rest-day count. "
        "Clubs with no European tie this season are treated as not playing in Europe."
    )
    if coverage["kickoffs_marked_unconfirmed"]:
        europe_note += f" {coverage['kickoffs_marked_unconfirmed']} kickoffs are marked unconfirmed by the source."

    client_cfg = {
        "display_timezone": cfg["display_timezone"],
        "ratings": cfg["ratings"],
        "prediction": cfg["prediction"],
        "simulation": cfg["simulation"],
        "places": cfg["places"],
        "thresholds": cfg["thresholds"],
        "set_piece_situations": cfg["set_piece_situations"],
        "competitions": comp_labels,
    }
    derived = {
        "league_gpg": round(priors["goal_rates"]["league_gpg"], 4),
        "home_factor": round(priors["goal_rates"]["home_factor"], 4),
        "away_factor": round(priors["goal_rates"]["away_factor"], 4),
        "home_gpg": round(priors["goal_rates"]["home_gpg"], 4),
        "away_gpg": round(priors["goal_rates"]["away_gpg"], 4),
        "goal_rate_seasons": priors["goal_rates"]["seasons"],
        "goal_rate_matches": priors["goal_rates"]["matches"],
        "pen_xg": round(pen_xg, 4),
        "pen_n": int(len(penalties)),
        "elo_hfa": priors["home_advantage"],
        "elo_mean": priors["mean_elo"],
        "history_matches": priors["matches_used"],
        "history_through": priors["history_through"],
    }

    data = {
        "season": season_label,
        "season_start_year": start_year,
        "gw": int(catalogue_gw),
        "rounds": int(n_rounds),
        "exported": cat_manifest.get("exported_at"),
        "generated_at": datetime.now(ZoneInfo("UTC")).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "short": short,
        "fx": fx,
        "matches": matches,
        "shots": shot_rows,
        "opta": opta,
        "players": rows,
        "euro": euro,
        "prior": priors["prior"],
        "elo": priors["elo"],
        "unscheduled": unscheduled,
        "fixture_changes": changes,
        "europe_note": europe_note,
        "other_href": "laliga/",
        "other_label": "La Liga",
        "cfg": client_cfg,
        "derived": derived,
    }
    meta = {
        "season": season_label,
        "gameweek": int(catalogue_gw),
        "fpl_finished_gameweek": int(fpl_finished_gw),
        "no_new_round": no_new_round,
        "change_note": change_note,
        "fixture_changes": changes,
        "unscheduled": unscheduled,
        "score_disagreements": score_disagreements,
        "kickoff_disagreements": kickoff_disagreements,
        "gameweek_disagreements": gw_disagreements,
        "finished_missing_shots": finished_missing_shots,
        "unmapped_shots": unmapped_shots,
        "shots": len(shot_rows),
        "matches": len(matches),
        "players": len(rows),
        "missing_opta_metrics": missing_metrics,
        "europe": coverage,
        "europe_note": europe_note,
        "derived": derived,
        "elo": priors["elo"],
        "prior": priors["prior"],
        "catalogue": {
            "commit": manifest["catalogue"]["commit"],
            "committed_at": manifest["catalogue"]["committed_at"],
            "exported_at": cat_manifest.get("exported_at"),
            "folder": folder,
        },
        "fetch": manifest,
        "teams": n_teams,
        "rounds": n_rounds,
        "fixtures": len(fx),
    }
    return data, meta
