"""The pipeline must follow the files it is given, not a baked-in 2026/27 league."""
import json
import shutil
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from plx.config import load_config
from plx.names import UnmappedName
from plx.prepare import PrepareError, prepare


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _history_csv(rows: list[tuple]) -> str:
    lines = ["Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR"]
    for div, date, home, away, hg, ag in rows:
        lines.append(f"{div},{date},{home},{away},{hg},{ag},{'H' if hg > ag else 'A' if hg < ag else 'D'}")
    return "\n".join(lines) + "\n"


def build_world(root: Path, *, break_history: bool = False) -> None:
    teams = [
        ("Northport City", "NOR", 1),
        ("Southbridge Utd", "SOU", 2),
        ("Eastwick", "EAS", 3),
        ("Westmere Hotspur", "WES", 4),
    ]
    # Home-and-away, two matches per gameweek.
    pairs = []
    names = [t[0] for t in teams]
    for i, home in enumerate(names):
        for away in names:
            if home != away:
                pairs.append((home, away))
    assert len(pairs) == 12
    fixtures = []
    for i, (home, away) in enumerate(pairs):
        gw = i // 2 + 1
        day = 10 + gw
        kick = f"2031-08-{day:02d}T15:00:00Z"
        fid = 5000 + i
        finished = gw <= 2
        hs = 2 if finished and i % 2 == 0 else (1 if finished else None)
        as_ = 1 if finished and i % 2 == 0 else (1 if finished else None)
        fixtures.append({
            "id": fid, "event": gw, "kickoff_time": kick, "finished": finished,
            "team_h": teams[[t[0] for t in teams].index(home)][2],
            "team_a": teams[[t[0] for t in teams].index(away)][2],
            "team_h_score": hs, "team_a_score": as_, "provisional_start_time": False,
        })
    events = []
    for gw in range(1, 7):
        events.append({
            "id": gw, "name": f"Gameweek {gw}", "deadline_time": f"2031-08-{9 + gw:02d}T11:00:00Z",
            "finished": gw <= 2, "is_current": gw == 2, "is_next": gw == 3, "data_checked": gw <= 2,
        })
    bootstrap = {
        "events": events,
        "teams": [{"id": i, "name": n, "short_name": s} for n, s, i in teams],
        "elements": [],
    }
    _write(root / "sources/fpl/bootstrap.json", json.dumps(bootstrap))
    _write(root / "sources/fpl/fixtures.json", json.dumps(fixtures))
    _write(root / "sources/fetch_manifest.json", json.dumps({
        "fetched_at": "2031-08-20T08:00:00Z",
        "season_start_year": 2031,
        "catalogue": {"commit": "abc123", "committed_at": "2031-08-19T10:00:00Z", "repo": "example"},
        "fpl": {"fetched_at": "2031-08-20T08:00:00Z", "events": 6, "fixtures": 12},
        "history": {"fetched_at": "2031-08-20T08:00:00Z", "files": [], "season_codes": ["2930", "3031"]},
        "europe": {"fetched_at": "2031-08-20T08:00:00Z", "events": 1, "espn_clubs": 4},
    }))
    cat = root / "sources/pl-catalogue/data/2031-32"
    _write(cat / "manifest.json", json.dumps({"season": "2031-32", "exported_at": "2031-08-19T09:00:00Z"}))
    club_lines = ["club_id,name,short_name"] + [f"{i},{n},{s}" for n, s, i in teams]
    _write(cat / "clubs.csv", "\n".join(club_lines) + "\n")
    fx_lines = ["fixture_id,gw,kickoff_time,home_team,away_team,home_score,away_score,finished"]
    for i, f in enumerate(fixtures):
        home = next(n for n, s, tid in teams if tid == f["team_h"])
        away = next(n for n, s, tid in teams if tid == f["team_a"])
        hs = "" if f["team_h_score"] is None else f["team_h_score"]
        as_ = "" if f["team_a_score"] is None else f["team_a_score"]
        fx_lines.append(f"{i + 1},{f['event']},{f['kickoff_time']},{home},{away},{hs},{as_},{1 if f['finished'] else 0}")
    _write(cat / "fixtures.csv", "\n".join(fx_lines) + "\n")
    # Two shots explain Northport 2-1 Eastwick (fixture catalogue id of the first pair).
    first = fixtures[0]
    home = next(n for n, s, tid in teams if tid == first["team_h"])
    away = next(n for n, s, tid in teams if tid == first["team_a"])
    # Find catalogue fixture id: enumeration order matches fixtures order, id = index+1.
    shot_header = "shot_id,fixture_id,gw,minute,player,assisted_name,x,y,xg,result,situation,shot_type,last_action,h_a"
    shots = [shot_header]
    # Only the finished fixtures need shots. Give each finished fixture a consistent shot list.
    for i, f in enumerate(fixtures):
        if not f["finished"]:
            continue
        fid = i + 1
        gw = f["event"]
        hs, as_ = f["team_h_score"], f["team_a_score"]
        # home goals as open-play goals, away goals as open-play goals, one penalty among them
        n = 0
        for g in range(hs):
            n += 1
            sit = "Penalty" if n == 1 else "OpenPlay"
            xg = "0.76" if sit == "Penalty" else "0.20"
            shots.append(f"{fid * 10 + n},{fid},{gw},{10 + n},Keeley,,0.9,0.5,{xg},Goal,{sit},RightFoot,Pass,h")
        for g in range(as_):
            n += 1
            shots.append(f"{fid * 10 + n},{fid},{gw},{40 + n},Alden,,0.88,0.4,0.15,Goal,OpenPlay,LeftFoot,Pass,a")
        n += 1
        shots.append(f"{fid * 10 + n},{fid},{gw},60,Alden,,0.7,0.5,0.04,MissedShots,OpenPlay,RightFoot,None,a")
    _write(cat / "shots.csv", "\n".join(shots) + "\n")
    # player files so shot ids resolve
    player_shots = ["shot_id,player_id"]
    for line in shots[1:]:
        sid = line.split(",")[0]
        player_shots.append(f"{sid},11")
    _write(cat / "players/Keeley_11/shots.csv", "\n".join(player_shots) + "\n")
    _write(cat / "players.csv", "\n".join([
        "player_id,web_name,first_name,second_name,full_name,team,position,status,news,price,selected_by_percent,total_points,season_minutes,season_goals,season_assists,season_xg,season_xa",
        "11,Keeley,Ada,Keeley,Ada Keeley,Northport City,FWD,a,,8.0,5.0,12,180,2,0,0.9,0.1",
    ]) + "\n")
    _write(cat / "club_stats.csv", "team,metric,value\nNorthport City,possession_pos_perc,55\n")
    _write(cat / "gws/merged_gw.csv", "element,defensive_contribution\n11,4\n")
    _write(cat / "market.csv", "player_id,fetch_date,market_value_eur\n11,2031-08-19,1000000\n")
    hist_names = {
        "Northport City": "Zorbex Wanderers" if break_history else "Northport",
        "Southbridge Utd": "Southbridge United",
        "Eastwick": "Eastwick",
        "Westmere Hotspur": "Westmere",
    }
    # Extra clubs so the files look like a league, not four teams repeating.
    extras = ["Quaytown", "Redhall", "Millcross", "Oakend"]
    rows = []
    for code, year in (("2930", 2029), ("3031", 2030)):
        for div in ("E0", "E1"):
            # 30 matches, home side wins a bit more than half.
            for k in range(80):
                pool = list(hist_names.values()) + extras
                home, away = pool[k % len(pool)], pool[(k * 3 + 1) % len(pool)]
                if home == away:
                    away = pool[(k + 2) % len(pool)]
                # A mild home edge, close to a real league, so the fitted home advantage sits inside the search grid.
                slot = k % 20
                if slot < 9:
                    hg, ag = 2, 0
                elif slot < 14:
                    hg, ag = 1, 1
                else:
                    hg, ag = 0, 1
                rows.append((div, f"{10 + (k % 18):02d}/{(k % 9) + 1:02d}/{year}", home, away, hg, ag))
            _write(root / f"sources/football-data/{div}_{code}.csv", _history_csv(
                [r for r in rows if r[0] == div and r[1].endswith(str(year))]
            ))
    espn = []
    for name, short, _i in teams:
        aliases = [name, short]
        if not break_history:
            aliases.append(hist_names[name])
        espn.append({"display": name, "aliases": aliases})
    _write(root / "sources/europe/aliases.json", json.dumps(espn))
    _write(root / "sources/europe/events.json", json.dumps([{
        "competition": "UCL",
        "event_id": "9",
        "kickoff_utc": "2031-09-16T19:00:00Z",
        "home": "Northport City",
        "away": "Sample Rovers",
        "time_valid": True,
        "name": "Sample Rovers at Northport City",
    }]))


class SimulatedSeasonTest(unittest.TestCase):
    def test_pipeline_follows_a_future_season(self):
        root = Path("/tmp/plx_sim_ok")
        if root.exists():
            shutil.rmtree(root)
        build_world(root)
        data, meta = prepare(root, load_config(), None)
        self.assertEqual(data["season"], "2031/32")
        self.assertEqual(sorted(data["short"]), ["Eastwick", "Northport City", "Southbridge Utd", "Westmere Hotspur"])
        self.assertNotIn("Arsenal", data["short"])
        self.assertEqual(data["rounds"], 6)
        self.assertEqual(len(data["fx"]), 12)
        self.assertTrue(all(row[3].startswith("2031-08-") for row in data["fx"]))
        self.assertEqual(data["derived"]["pen_n"] >= 1, True)
        self.assertAlmostEqual(data["derived"]["pen_xg"], 0.76, places=2)
        for team in data["short"]:
            self.assertIn(team, data["prior"])
        self.assertEqual(data["euro"][0][0], "Northport City")
        self.assertEqual(data["euro"][0][3], "Sample Rovers")
        self.assertNotIn("odds", data)
        self.assertGreater(meta["derived"]["history_matches"], 20)

    def test_unmapped_club_stops_the_build(self):
        root = Path("/tmp/plx_sim_bad")
        if root.exists():
            shutil.rmtree(root)
        build_world(root, break_history=True)
        with self.assertRaises((UnmappedName, PrepareError)) as caught:
            prepare(root, load_config(), None)
        self.assertIn("Northport", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
