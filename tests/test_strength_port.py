"""The Python model must give the same numbers as the browser model."""
import json
import unittest
from pathlib import Path

from plx.strength import predict, ratings

ROOT = Path(__file__).resolve().parents[1]
from tests.test_model_acceptance import CASES  # noqa: E402  (same cases as the page test)


class StrengthPortTest(unittest.TestCase):
    def test_python_model_matches_the_acceptance_cases(self):
        d = json.loads((ROOT / "data" / "pl.json").read_text(encoding="utf-8"))
        cfg = d["cfg"]
        teams = sorted(set(d["prior"]))
        ms = [{"gw": m["gw"], "h": m["h"], "a": m["a"], "hs": m["hs"], "as": m["as"], "xh": m["xh"], "xa": m["xa"]} for m in d["matches"]]
        for gw, h, a, odds, xg in CASES:
            R = ratings(ms, teams, d["prior"], gw - 1, cfg["ratings"], cfg["ratings"]["goal_level_prior"])
            p = predict(h, a, R, cfg["prediction"]["dixon_coles_rho"], cfg["prediction"]["max_goals"])
            got = [f"{1 / p[k]:.2f}" for k in ("pw", "pd", "pl")]
            self.assertEqual(got, list(odds), f"GW{gw} {h}–{a}")
            self.assertEqual(f"{p['lh']:.2f}–{p['la']:.2f}", xg if isinstance(xg, str) else f"{xg[0]}–{xg[1]}", f"GW{gw} {h}–{a}")


if __name__ == "__main__":
    unittest.main()


class HomeAdvantageTest(unittest.TestCase):
    def test_home_option_raises_the_home_side(self):
        """Home advantage on, as ratings(upto, {home: true}) in the browser: the home side's chance goes up."""
        d = json.loads((Path(__file__).resolve().parents[1] / "data" / "pl.json").read_text(encoding="utf-8"))
        c, der = d["cfg"], d["derived"]
        teams = list(d["short"])
        upto = max(1, d["gw"])
        hg = {"home_factor": der["home_factor"], "away_factor": der["away_factor"]}
        R0 = ratings(d["matches"], teams, d["prior"], upto, c["ratings"], c["ratings"]["goal_level_prior"])
        R1 = ratings(d["matches"], teams, d["prior"], upto, c["ratings"], c["ratings"]["goal_level_prior"], hg)
        self.assertEqual((R0["hfH"], R0["hfA"]), (1.0, 1.0))
        self.assertGreater(R1["hfH"], 1.0)
        self.assertAlmostEqual(R1["hfH"] * R1["hfA"], 1.0)
        h, a = teams[0], teams[1]
        rho, mg = c["prediction"]["dixon_coles_rho"], c["prediction"]["max_goals"]
        self.assertGreater(predict(h, a, R1, rho, mg)["pw"], predict(h, a, R0, rho, mg)["pw"])
