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
