"""football-data xG fills in only for finished matches with no catalogue shots, and steps aside once they arrive."""
import csv
import tempfile
import unittest
from pathlib import Path

from plx import xg_fallback
from plx.config import load_config

ROOT = Path(__file__).resolve().parents[1]
CFG = load_config(ROOT / "config" / "model.json")
ALIASES = {
    "Man Utd": ["Man Utd", "MUN", "Manchester United"],
    "Spurs": ["Spurs", "TOT", "Tottenham Hotspur"],
    "Chelsea": ["Chelsea", "CHE"],
    "Arsenal": ["Arsenal", "ARS"],
}
HEAD = ["Div", "Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG", "HxG", "AxG", "HS", "AS"]


def _catalogue_match(cid, gw, h, a, hs, as_, xh, xa):
    return {"id": 1000 + cid, "_cat_id": cid, "gw": gw, "h": h, "a": a, "hs": hs, "as": as_, "xh": xh, "xa": xa, "shots": [[10, 0, xh, "S", "x"]]}


def _fpl(fid, gw, finished, hs=None, as_=None):
    return {"id": fid, "event": gw, "finished": finished, "team_h_score": hs, "team_a_score": as_, "kickoff_time": "2026-10-31T15:00:00Z"}


class XgFallbackTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self.tmp.name)
        self.cfg = {**CFG, "xg_fallback": {**CFG["xg_fallback"], "min_overlap_matches": 2}}
        rows = [
            # Overlap rows: catalogue xG totals 6.0 here against football-data's 5.0, so the ratio is 1.2.
            ["E0", "01/10/2026", "Arsenal", "Chelsea", 2, 1, 1.5, 1.0, 14, 9],
            ["E0", "08/10/2026", "Man United", "Tottenham", 0, 0, 1.25, 1.25, 11, 12],
            # Gameweek 9: catalogue has no shots yet.
            ["E0", "31/10/2026", "Chelsea", "Man United", 2, 0, 2.5, 1.0, 19, 12],
            ["E0", "31/10/2026", "Tottenham", "Arsenal", 1, 1, 0.5, 0.5, 6, 7],
        ]
        with (self.folder / "E0.csv").open("w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(HEAD)
            w.writerows(rows)
        self.cat = [
            _catalogue_match(1, 1, "Arsenal", "Chelsea", 2, 1, 1.8, 1.2),
            _catalogue_match(2, 2, "Man Utd", "Spurs", 0, 0, 1.5, 1.5),
        ]
        self.fixtures = [
            (("Arsenal", "Chelsea"), _fpl(11, 1, True, 2, 1), 1),
            (("Man Utd", "Spurs"), _fpl(12, 2, True, 0, 0), 2),
            (("Chelsea", "Man Utd"), _fpl(13, 9, True, 2, 0), 3),
            (("Spurs", "Arsenal"), _fpl(14, 9, True, 1, 1), 4),
            (("Chelsea", "Arsenal"), _fpl(15, 10, False), 5),
        ]

    def tearDown(self):
        self.tmp.cleanup()

    def test_fills_only_finished_matches_without_catalogue_shots(self):
        added, info = xg_fallback.fill(self.cat, self.fixtures, self.folder, ALIASES, self.cfg)
        self.assertEqual([(m["h"], m["a"]) for m in added], [("Chelsea", "Man Utd"), ("Spurs", "Arsenal")])
        self.assertAlmostEqual(info["scale"], 1.2)
        self.assertEqual(info["overlap"], 2)
        m = added[0]
        self.assertEqual((m["xh"], m["xa"]), (3.0, 1.2))
        self.assertEqual((m["sh"], m["sa"]), (19, 12))
        self.assertEqual((m["hs"], m["as"], m["ph"], m["pa"]), (2, 0, 3, 0))
        self.assertEqual(m["src"], "fd")
        self.assertEqual(m["shots"], [])
        self.assertAlmostEqual(m["pw"] + m["pd"] + m["pl"], 1.0, places=2)
        self.assertGreater(m["pw"], m["pl"])

    def test_steps_aside_once_catalogue_shots_exist(self):
        # pl-catalogue publishes gameweek 9: those matches are now catalogue matches.
        cat = self.cat + [
            _catalogue_match(3, 9, "Chelsea", "Man Utd", 2, 0, 3.1, 1.3),
            _catalogue_match(4, 9, "Spurs", "Arsenal", 1, 1, 0.6, 0.6),
        ]
        added, info = xg_fallback.fill(cat, self.fixtures, self.folder, ALIASES, self.cfg)
        self.assertEqual(added, [])
        self.assertEqual(info["used"], [])

    def test_partial_catalogue_round_fills_only_the_rest(self):
        cat = self.cat + [_catalogue_match(3, 9, "Chelsea", "Man Utd", 2, 0, 3.1, 1.3)]
        added, _info = xg_fallback.fill(cat, self.fixtures, self.folder, ALIASES, self.cfg)
        self.assertEqual([(m["h"], m["a"]) for m in added], [("Spurs", "Arsenal")])

    def test_score_disagreement_is_not_filled(self):
        fixtures = list(self.fixtures)
        fixtures[2] = (("Chelsea", "Man Utd"), _fpl(13, 9, True, 3, 0), 3)
        added, info = xg_fallback.fill(self.cat, fixtures, self.folder, ALIASES, self.cfg)
        self.assertNotIn(("Chelsea", "Man Utd"), [(m["h"], m["a"]) for m in added])
        self.assertTrue(any("disagrees" in s for s in info["skipped"]))

    def test_too_little_overlap_uses_nothing(self):
        cfg = {**CFG, "xg_fallback": {**CFG["xg_fallback"], "min_overlap_matches": 30}}
        added, info = xg_fallback.fill(self.cat, self.fixtures, self.folder, ALIASES, cfg)
        self.assertEqual(added, [])
        self.assertTrue(info["skipped"])

    def test_missing_file_uses_nothing(self):
        added, _info = xg_fallback.fill(self.cat, self.fixtures, self.folder / "nowhere", ALIASES, self.cfg)
        self.assertEqual(added, [])

    def test_disabled_uses_nothing(self):
        cfg = {**CFG, "xg_fallback": {**CFG["xg_fallback"], "enabled": False}}
        added, _info = xg_fallback.fill(self.cat, self.fixtures, self.folder, ALIASES, cfg)
        self.assertEqual(added, [])


if __name__ == "__main__":
    unittest.main()
