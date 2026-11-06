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

    def test_rules(self):
        avg = [3.0, 3.4, 2.4]
        # Our home chance 36%: edge 8% at 3.00, inside A's 2.50-5.00 band, so both rules.
        m = value.marks([0.36, 0.26, 0.38], avg, MODEL["rules"])
        self.assertEqual(sorted(k["rule"] for k in m), ["A", "B"])
        self.assertTrue(all(k["side"] == "1" for k in m))
        # 4% at 2.40 on the away side: B only (below A's edge and price band).
        m = value.marks([0.30, 0.2667, 0.4333], avg, MODEL["rules"])
        self.assertEqual([(k["rule"], k["side"]) for k in m], [("B", "2")])
        self.assertEqual(value.marks([0.3, 0.3, 0.4], avg, MODEL["rules"]), [])

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
        out = value.score_league(_rows("\n".join(lines)), _rows("E0,12/09/2026,15:00,A,C,,,,,,,3.0,3.4,2.4,3.2,3.5,2.6"), "Test", MODEL)
        # The sixth match is the first with five matches behind each side; A out-shot everyone but lost.
        picks = [h for h in out["history"] if h["h"] == "A" and h["a"] == "B"]
        self.assertTrue(picks and all(h["side"] == "1" for h in picks))
        self.assertTrue(all(h["won"] for h in picks))
        b = next(h for h in picks if h["rule"] == "B")
        self.assertEqual(b["price"], 3.2)  # rule B is paid at the best price
        nxt = out["upcoming"][0]
        self.assertIn("p", nxt)
        s = value.summary(out["history"], "B")
        self.assertEqual((s["n"], s["won"]), (1, 1))
        self.assertEqual(value.summary(out["history"], "B", since="2026-10-01")["n"], 0)

    def test_kickoff_is_uk_time(self):
        self.assertEqual(value._iso(value.kickoff("07/11/2026", "17:30")), "2026-11-07T17:30Z")
        self.assertEqual(value._iso(value.kickoff("01/08/2026", "17:30")), "2026-08-01T16:30Z")


if __name__ == "__main__":
    unittest.main()
