"""La Liga matchdays come from the matchday file, and the counts have to add up."""
import unittest

from plx.laliga_calendar import audit_published_rounds, parse_matchday_file
from plx.laliga_prepare import learn_aliases


CALENDAR = """
= Sample league 2031/32

▪ Matchday 1
  Sat Aug 15 2031
    19:30  Northport FC            v Southbridge FC           3-0
  Sun Aug 16
    17:00  Eastwick                v Westmere                 1-1

▪ Matchday 2
  Sat Aug 22
    19:30  Southbridge FC          v Northport FC             0-1
  Sun Aug 23
           Westmere                v Eastwick

▪ Matchday 1
  Wed Dec 9
           Northport FC            v Eastwick
"""


class LaLigaRoundTest(unittest.TestCase):
    def test_matchday_headers_merge_and_the_year_rolls(self):
        rows = parse_matchday_file(CALENDAR)
        self.assertEqual(len(rows), 5)
        self.assertEqual([row["matchday"] for row in rows], [1, 1, 2, 2, 1])
        self.assertEqual(rows[1]["day"], "2031-08-16")
        self.assertEqual(rows[3]["day"], "2031-08-23")
        self.assertEqual(rows[3]["hg"], None)
        self.assertEqual(rows[4]["day"], "2031-12-09")
        self.assertEqual(rows[0]["home_raw"], "Northport FC")
        self.assertEqual(rows[0]["hg"], 3)

    def test_a_split_calendar_fails_the_round_audit(self):
        # 4 clubs, so a proper league has 6 rounds of 2. A date window that
        # invented 8 rounds of uneven size must not pass.
        fx = []
        for gw, count in enumerate([1, 2, 1, 2, 2, 1, 2, 1], start=1):
            for n in range(count):
                fx.append([gw, f"H{gw}{n}", f"A{gw}{n}", "2031-08-01T15:00:00Z", 1, gw * 10 + n])
        problems = audit_published_rounds(fx, [], [], 4, 4, 5, 5)
        self.assertTrue(problems)

    def test_completed_matches_have_to_fill_completed_rounds(self):
        fx = []
        matches = []
        number = 0
        for gw in range(1, 7):
            for n in range(2):
                number += 1
                finished = not (gw == 3 and n == 1)
                fx.append([gw, f"H{gw}{n}", f"A{gw}{n}", "2031-08-01T15:00:00Z", 1 if finished else 0, number])
                if finished and gw <= 4:
                    matches.append({"gw": gw})
        unresolved = [{"id": 6, "gameweek": 3, "status": "abandoned", "home": "H31", "away": "A31"}]
        # Match 6 is the unfinished one in round 3. Rounds 1-4 then hold 7 results and that flag.
        problems = audit_published_rounds(fx, matches, unresolved, 4, 4, 5, 5)
        self.assertEqual(problems, [])
        short = audit_published_rounds(fx, matches[:-1], unresolved, 4, 4, 5, 5)
        self.assertTrue(any("do not equal" in item for item in short))
        wrong_round = audit_published_rounds(fx, matches, unresolved, 4, 4, 5, 6)
        self.assertTrue(any("current round" in item for item in wrong_round))

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
