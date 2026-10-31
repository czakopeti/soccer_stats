"""La Liga rounds and club spellings are learned from the files, not typed in."""
import unittest
from datetime import datetime, timezone

from plx.laliga_prepare import assign_rounds, learn_aliases


def _kick(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)


class LaLigaRoundTest(unittest.TestCase):
    def test_four_clubs_make_six_matchdays(self):
        clubs = ["North", "South", "East", "West"]
        # One match per slot, each club once per round, home and away.
        pairs = [(h, a) for h in clubs for a in clubs if h != a]
        fixtures = []
        for index, (home, away) in enumerate(pairs):
            fixtures.append({"id": str(index), "home": home, "away": away, "kick": _kick(f"2031-08-{1 + index:02d} 15:00:00")})
        rounds = assign_rounds(fixtures)
        self.assertEqual(len(rounds), 12)
        # No club is asked to play two matches in the same matchday.
        by_round = {}
        for fixture in fixtures:
            by_round.setdefault(rounds[fixture["id"]], []).append(fixture)
        for group in by_round.values():
            seen = []
            for fixture in group:
                seen.extend([fixture["home"], fixture["away"]])
            self.assertEqual(len(seen), len(set(seen)))

    def test_a_later_weekend_does_not_join_this_one(self):
        fixtures = [
            {"id": "1", "home": "North", "away": "South", "kick": _kick("2031-10-31 15:00:00")},
            {"id": "2", "home": "East", "away": "West", "kick": _kick("2031-11-01 15:00:00")},
            {"id": "3", "home": "North", "away": "East", "kick": _kick("2031-11-07 15:00:00")},
            {"id": "4", "home": "South", "away": "West", "kick": _kick("2031-11-08 15:00:00")},
        ]
        rounds = assign_rounds(fixtures, window_days=3)
        self.assertEqual(rounds["1"], rounds["2"])
        self.assertNotEqual(rounds["1"], rounds["3"])
        self.assertEqual(rounds["3"], rounds["4"])

    def test_aliases_come_from_a_unique_score_and_date(self):
        matches = [
            {"day": "2031-08-15", "hg": 3, "ag": 0, "home": "Northport", "away": "Southbridge", "result": True},
            {"day": "2031-08-15", "hg": 1, "ag": 1, "home": "Eastwick", "away": "Westmere", "result": True},
        ]
        rows = [
            {"Date": "15/08/2031", "FTHG": "3", "FTAG": "0", "HomeTeam": "North", "AwayTeam": "South"},
            {"Date": "15/08/2031", "FTHG": "1", "FTAG": "1", "HomeTeam": "East", "AwayTeam": "West"},
        ]
        learned = learn_aliases(rows, matches)
        self.assertEqual(learned["North"], "Northport")
        self.assertEqual(learned["South"], "Southbridge")
        self.assertEqual(learned["West"], "Westmere")


if __name__ == "__main__":
    unittest.main()
