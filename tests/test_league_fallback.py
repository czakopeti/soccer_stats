"""The other leagues keep going on the kept Understat copy plus football-data, and fresh Understat always wins."""
import json
import shutil
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from plx import league_fallback as lf
from plx.config import load_config
from plx.leagues import build_all

ROOT = Path(__file__).resolve().parents[1]
US = ["Athletic Club", "Atletico Madrid", "Real Betis", "Celta Vigo"]
FD = {"Athletic Club": "Ath Bilbao", "Atletico Madrid": "Ath Madrid", "Real Betis": "Betis", "Celta Vigo": "Celta"}
# A double round robin of four clubs, one round a week.
ROUNDS = [[(0, 1), (2, 3)], [(0, 2), (1, 3)], [(0, 3), (1, 2)], [(1, 0), (3, 2)], [(2, 0), (3, 1)], [(3, 0), (2, 1)]]


def _season(played_rounds: int):
    us, fd = [], []
    start = date(2026, 8, 15)
    for r, games in enumerate(ROUNDS):
        d = start + timedelta(days=7 * r)
        for k, (h, a) in enumerate(games):
            hs, as_ = (r + k) % 3, (r * 2 + k + 1) % 3
            xh, xa = 1.0 + 0.1 * r, 0.8 + 0.1 * k
            m = {"id": f"{r}{k}", "isResult": r < played_rounds, "h": {"title": US[h]}, "a": {"title": US[a]}, "datetime": f"{d.isoformat()} 18:00:00"}
            if r < played_rounds:
                m["goals"] = {"h": str(hs), "a": str(as_)}
                m["xG"] = {"h": str(xh), "a": str(xa)}
            us.append(m)
            fd.append({"date": d, "h": FD[US[h]], "a": FD[US[a]], "hs": hs, "as": as_, "xh": xh / 1.25, "xa": xa / 1.25})
    return us, fd


class LeagueFallbackTest(unittest.TestCase):
    def test_names_pair_off_from_results(self):
        us, fd = _season(6)
        mapping, why = lf.map_names(us, fd, min_votes=3)
        self.assertEqual(mapping, FD, why)

    def test_fills_matches_played_since_the_kept_copy(self):
        kept, _ = _season(4)
        _, fd = _season(6)
        out, info = lf.fill(kept, fd, min_overlap=4)
        self.assertEqual(info["filled"], 4)
        self.assertAlmostEqual(info["scale"], 1.25)
        filled = [m for m in out if m.get("src") == "fd"]
        self.assertTrue(all(m["isResult"] for m in filled))
        full, _ = _season(6)
        truth = {m["id"]: m for m in full}
        for m in filled:
            self.assertEqual(m["goals"], truth[m["id"]]["goals"])
            self.assertAlmostEqual(float(m["xG"]["h"]), float(truth[m["id"]]["xG"]["h"]), places=3)
        # The kept copy itself is untouched.
        self.assertFalse(any(m.get("src") for m in kept))

    def test_nothing_to_fill_when_the_copy_is_current(self):
        kept, fd = _season(6)
        out, info = lf.fill(kept, fd, min_overlap=4)
        self.assertEqual(info["filled"], 0)

    def test_a_match_the_copy_has_with_home_and_away_swapped_is_not_filled_again(self):
        kept, _ = _season(4)
        _, fd = _season(6)
        # football-data lists round 1's first match the other way round; the copy's
        # unplayed return fixture must not be filled with it.
        fd = [dict(r) for r in fd]
        fd[0]["h"], fd[0]["a"] = fd[0]["a"], fd[0]["h"]
        out, _ = lf.fill(kept, fd, min_overlap=3)
        ret = next(m for m in out if m["h"]["title"] == "Atletico Madrid" and m["a"]["title"] == "Athletic Club")
        self.assertNotEqual(ret.get("src"), "fd")

    def test_too_little_overlap_fills_nothing(self):
        kept, _ = _season(4)
        _, fd = _season(6)
        _out, info = lf.fill(kept, fd, min_overlap=30)
        self.assertEqual(info["filled"], 0)


class FreshUnderstatWinsTest(unittest.TestCase):
    def test_fresh_download_is_used_over_the_kept_copy(self):
        cfg = load_config(ROOT / "config" / "model.json")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copytree(ROOT / "config", root / "config")
            (root / "sources" / "leagues").mkdir(parents=True)
            (root / "data" / "understat").mkdir(parents=True)
            for code in cfg["leagues"]["understat_codes"]:
                real = json.loads((ROOT / "data" / "understat" / f"{code}.json").read_text(encoding="utf-8"))
                (root / "sources" / "leagues" / f"{code}.json").write_text(json.dumps(real), encoding="utf-8")
                (root / "data" / "understat" / f"{code}.json").write_text(json.dumps(real[:50]), encoding="utf-8")
            out = build_all(root, cfg, "2026/27", 2026, fetch_first=False)
            for lg in out["leagues"]:
                self.assertEqual(lg["source"], {"understat": "fresh"})
                self.assertFalse(any(m.get("fb") for rd in lg["rounds"] for m in rd["matches"]))


if __name__ == "__main__":
    unittest.main()
