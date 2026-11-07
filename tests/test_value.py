"""Value picks: the shots-and-form adjustment, the two rules, and the pick record."""
import csv
import io
import json
import unittest
from pathlib import Path

from plx import value

ROOT = Path(__file__).resolve().parents[1]
MODEL = json.loads((ROOT / "config" / "value_model.json").read_text(encoding="utf-8"))
HEAD = "Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,HS,AS,HST,AST,AvgH,AvgD,AvgA,MaxH,MaxD,MaxA"


def _rows(text):
    return list(csv.DictReader(io.StringIO(HEAD + "\n" + text.strip() + "\n")))


class ValueModelTest(unittest.TestCase):
    def test_chances_add_up_and_follow_shots(self):
        avg = [2.5, 3.4, 2.9]
        flat = value.chances(avg, {"sotd": MODEL["mean"]["sotd"], "shd": MODEL["mean"]["shd"], "gd": MODEL["mean"]["gd"], "form": MODEL["mean"]["form"]}, MODEL)
        better = value.chances(avg, {"sotd": 4.0, "shd": 8.0, "gd": MODEL["mean"]["gd"], "form": MODEL["mean"]["form"]}, MODEL)
        self.assertAlmostEqual(sum(flat), 1.0, places=9)
        self.assertGreater(better[0], flat[0])  # out-shooting the opponent lifts the home chance
        luckier = value.chances(avg, {"sotd": MODEL["mean"]["sotd"], "shd": MODEL["mean"]["shd"], "gd": 2.0, "form": 8}, MODEL)
        self.assertLess(luckier[0], flat[0])  # results ahead of shots are priced too high already

    def test_rule_c(self):
        avg = [3.0, 3.4, 2.4]
        p = [0.36, 0.26, 0.38]  # home edge 8% at 3.00, inside the 2.50-5.00 band
        q = value.market(avg)
        lower = [q[0] - 0.02, q[1], q[2] + 0.02]
        higher = [q[0] + 0.02, q[1], q[2] - 0.02]
        self.assertEqual([(k["rule"], k["side"]) for k in value.marks(p, avg, MODEL["rules"], lower)], [("C", "1")])
        self.assertEqual(value.marks(p, avg, MODEL["rules"], higher), [])  # Elo rates the home side above the market
        self.assertEqual(value.marks(p, avg, MODEL["rules"], None), [])  # no Elo, no pick
        self.assertEqual(value.marks([0.33, 0.30, 0.37], avg, MODEL["rules"], lower), [])  # edge below 5%

    def test_elo_method(self):
        elo = value.Elo({"newcomer": 1500, "teams": {"X": 1600, "Y": 1500}}, MODEL)
        self.assertAlmostEqual(elo.diff("X", "Y"), 200)
        we = 1 / (10 ** (-200 / 400) + 1)
        elo.add({"HomeTeam": "X", "AwayTeam": "Y", "FTHG": "3", "FTAG": "0"})
        self.assertAlmostEqual(elo.r["X"], 1600 + 20 * (14 / 8) * (1 - we))
        self.assertAlmostEqual(elo.r["X"] + elo.r["Y"], 3100)
        self.assertEqual(elo.diff("Z", "Y") + elo.r["Y"] - 100, 1500)  # a newcomer starts at the newcomer rating
        e = value.elo_chances(200, MODEL)
        self.assertAlmostEqual(sum(e), 1.0)
        self.assertGreater(e[0], e[2])

    def test_no_look_ahead_and_record(self):
        lines = []
        # Five rounds for four clubs; A always out-shoots its opponent but loses.
        pairs = [("A", "B", "C", "D"), ("A", "C", "B", "D"), ("A", "D", "B", "C"), ("B", "A", "D", "C"), ("C", "A", "D", "B")]
        for r, (h1, a1, h2, a2) in enumerate(pairs):
            d = f"{1 + 7 * r:02d}/08/2026"
            for h, a in ((h1, a1), (h2, a2)):
                a_home = h == "A"
                hs, hst = (20, 9) if a_home else (8, 3)
                as_, ast = (20, 9) if a == "A" else (8, 3)
                hg, ag = (0, 1) if a_home else (1, 0) if a == "A" else (1, 1)
                lines.append(f"E0,{d},15:00,{h},{a},{hg},{ag},{hs},{as_},{hst},{ast},2.6,3.4,2.8,2.7,3.5,3.0")
        lines.append("E0,05/09/2026,15:00,A,B,1,0,15,5,6,2,3.0,3.4,2.4,3.2,3.5,2.5")
        # Elo starts A far below the others, so it rates A lower than the market does.
        start = {"newcomer": 1500, "teams": {"A": 1100, "B": 1500, "C": 1500, "D": 1500}}
        out = value.score_league(_rows("\n".join(lines)), _rows("E0,12/09/2026,15:00,A,C,,,,,,,3.0,3.4,2.4,3.2,3.5,2.6"), "Test", MODEL, start)
        # The sixth match is the first with five matches behind each side; A out-shot everyone but lost.
        picks = [h for h in out["history"] if h["h"] == "A" and h["a"] == "B"]
        self.assertTrue(picks and all(h["side"] == "1" for h in picks))
        self.assertTrue(all(h["won"] for h in picks))
        c = next(h for h in picks if h["rule"] == "C")
        self.assertEqual(c["price"], 3.0)  # rule C is paid at the average price
        nxt = out["upcoming"][0]
        self.assertIn("p", nxt)
        self.assertIn("elo", nxt)
        s = value.summary(out["history"], "C")
        self.assertEqual((s["n"], s["won"]), (1, 1))
        self.assertEqual(value.summary(out["history"], "C", since="2026-10-01")["n"], 0)

    def test_kickoff_is_uk_time(self):
        self.assertEqual(value._iso(value.kickoff("07/11/2026", "17:30")), "2026-11-07T17:30Z")
        self.assertEqual(value._iso(value.kickoff("01/08/2026", "17:30")), "2026-08-01T16:30Z")


if __name__ == "__main__":
    unittest.main()
