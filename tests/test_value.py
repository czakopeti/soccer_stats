"""Home value: home advantage, the pick rule, and the track record."""
import csv
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from plx import value

OURS = ["Athletic Club", "Atletico Madrid", "Real Betis", "Celta Vigo"]
FD = {"Athletic Club": "Ath Bilbao", "Atletico Madrid": "Ath Madrid", "Real Betis": "Betis", "Celta Vigo": "Celta"}
ROUNDS = [[(0, 1), (2, 3)], [(0, 2), (1, 3)], [(0, 3), (1, 2)], [(1, 0), (3, 2)], [(2, 0), (3, 1)], [(3, 0), (2, 1)]]
HEAD = ["Div", "Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG", "HxG", "AxG", "AvgH", "AvgD", "AvgA", "AvgCH", "AvgCD", "AvgCA"]
RULE = {"max_home_odds": None}


class HomeValueTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.played, self.upcoming, rows = [], [], []
        start = date(2026, 8, 15)
        for r, games in enumerate(ROUNDS):
            d = start + timedelta(days=7 * r)
            for k, (h, a) in enumerate(games):
                hs, as_ = (r + k) % 3, (r * 2 + k + 1) % 3
                m = {"h": OURS[h], "a": OURS[a], "dt": f"{d.isoformat()} 18:00:00", "lh": 1.6 if k == 0 else 1.0, "la": 1.0 if k == 0 else 1.6}
                if r < 5:
                    m.update(hs=hs, **{"as": as_})
                    self.played.append(m)
                    # The first match of each round is priced generously for the home side.
                    rows.append(["SP1", d.strftime("%d/%m/%Y"), FD[OURS[h]], FD[OURS[a]], hs, as_, 1.2, 1.0,
                                 3.0 if k == 0 else 1.5, 3.5, 3.0, 2.8 if k == 0 else 1.5, 3.5, 3.0])
                else:
                    self.upcoming.append(m)
        with (self.dir / "SP1.csv").open("w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(HEAD)
            w.writerows(rows)
        self.fixtures = [
            {"Div": "SP1", "HomeTeam": "Celta", "AwayTeam": "Ath Bilbao", "AvgH": "3.0", "AvgD": "3.5", "AvgA": "2.5"},
            {"Div": "SP1", "HomeTeam": "Betis", "AwayTeam": "Ath Madrid", "AvgH": "3.0", "AvgD": "3.5", "AvgA": "2.5"},
        ]

    def tearDown(self):
        self.tmp.cleanup()

    def _build(self, h_adv=0.1):
        return value.league_rows("Test", self.played, self.upcoming, self.dir / "SP1.csv", self.fixtures, "SP1", h_adv, RULE, -0.25, 10)

    def test_home_advantage_raises_the_home_chance(self):
        flat = value.probs(1.3, 1.3, -0.25, 10)
        home = value.probs(1.3 * 1.1, 1.3 / 1.1, -0.25, 10)
        self.assertAlmostEqual(sum(flat), 1.0, places=9)
        self.assertGreater(home[0], flat[0])
        self.assertLess(home[2], flat[2])

    def test_pick_rule(self):
        out = self._build()
        self.assertNotIn("error", out)
        picks = [r for r in out["history"] if r["pick"]]
        # Only the stronger home sides priced above our fair odds.
        self.assertEqual(len(picks), 5)
        self.assertTrue(all(r["lh"] > r["la"] and r["bk"][0] * r["p"][0] > 1 for r in picks))
        up = {(r["h"], r["a"]): r for r in out["upcoming"]}
        self.assertTrue(up[("Celta Vigo", "Athletic Club")]["pick"])
        self.assertFalse(up[("Real Betis", "Atletico Madrid")]["pick"])  # the away side is stronger

    def test_summary_and_tracking_date(self):
        out = self._build()
        s = value.summary(out["history"])
        picks = [r for r in out["history"] if r["pick"]]
        self.assertEqual(s["n"], len(picks))
        self.assertAlmostEqual(s["profit"], round(sum((r["bk"][0] - 1) if r["hs"] > r["as"] else -1 for r in picks), 2))
        self.assertGreater(s["clv"], 0)  # 3.0 before, 2.8 at kickoff
        later = value.summary(out["history"], since="2026-09-01")
        self.assertEqual(later["n"], sum(1 for r in picks if r["dt"] >= "2026-09-01"))


if __name__ == "__main__":
    unittest.main()
