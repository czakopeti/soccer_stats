"""Round grouping and the no-look-ahead rule for the other leagues."""
import unittest

from plx.config import load_config
from plx.leagues import build_league, check


def _m(i, dt, h, a, res=None):
    d = {"id": str(i), "isResult": res is not None, "h": {"title": h}, "a": {"title": a}, "datetime": dt}
    if res:
        d["goals"] = {"h": str(res[0]), "a": str(res[1])}
        d["xG"] = {"h": str(res[2]), "a": str(res[3])}
    return d


class LeaguesTest(unittest.TestCase):
    def setUp(self):
        self.cfg = load_config()
        self.season = {"code": "TST", "label": "Test", "goal_level": 1.4, "prior": {t: 0.0 for t in "ABCD"}}

    def test_rounds_and_postponed(self):
        dates = [
            _m(1, "2000-01-01 15:00:00", "A", "B", (2, 0, 1.8, 0.4)),
            _m(2, "2000-01-01 17:00:00", "C", "D", (1, 1, 1.0, 1.1)),
            _m(3, "2000-01-08 17:00:00", "A", "C", (0, 1, 0.7, 1.3)),
            _m(4, "2000-01-08 15:00:00", "B", "D"),  # postponed, no new date
            _m(5, "2000-01-15 15:00:00", "D", "A"),
            _m(6, "2000-01-15 17:00:00", "B", "C"),
        ]
        lg = build_league(dates, self.season, self.cfg)
        self.assertEqual([len(r["matches"]) for r in lg["rounds"]], [2, 1, 2])
        self.assertEqual(lg["postponed"], [{"h": "B", "a": "D", "dt": "2000-01-08 15:00:00"}])
        self.assertEqual(lg["next_round"], 3)
        first = lg["rounds"][0]["matches"][0]
        # Round 1 has no earlier data, so both sides start equal.
        self.assertAlmostEqual(first["lh"], first["la"], places=6)
        self.assertEqual(check(lg), ["Test: 4 clubs, expected 18 or 20."])


if __name__ == "__main__":
    unittest.main()
