"""Club-name matching must work from the feeds, and must refuse a guess."""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from plx.config import load_config
from plx.names import AmbiguousName, UnmappedName, link_feeds
from plx.names import ClubIndex


CFG = load_config()

# Spellings observed on the live feeds in 2026/27. The matcher must bridge them
# with no club-by-club table in the code.
FPL = [
    ("Arsenal", "ARS"),
    ("Aston Villa", "AVL"),
    ("Bournemouth", "BOU"),
    ("Brentford", "BRE"),
    ("Brighton", "BHA"),
    ("Chelsea", "CHE"),
    ("Coventry City", "COV"),
    ("Crystal Palace", "CRY"),
    ("Everton", "EVE"),
    ("Fulham", "FUL"),
    ("Hull City", "HUL"),
    ("Ipswich Town", "IPS"),
    ("Leeds", "LEE"),
    ("Liverpool", "LIV"),
    ("Man City", "MCI"),
    ("Man Utd", "MUN"),
    ("Newcastle", "NEW"),
    ("Nott'm Forest", "NFO"),
    ("Spurs", "TOT"),
    ("Sunderland", "SUN"),
]
ESPN = [
    ("AFC Bournemouth", "Bournemouth", "BOU"),
    ("Arsenal", "Arsenal", "ARS"),
    ("Aston Villa", "Aston Villa", "AVL"),
    ("Brentford", "Brentford", "BRE"),
    ("Brighton & Hove Albion", "Brighton", "BHA"),
    ("Chelsea", "Chelsea", "CHE"),
    ("Coventry City", "Coventry", "COV"),
    ("Crystal Palace", "C Palace", "CRY"),
    ("Everton", "Everton", "EVE"),
    ("Fulham", "Fulham", "FUL"),
    ("Hull City", "Hull", "HUL"),
    ("Ipswich Town", "Ipswich", "IPS"),
    ("Leeds United", "Leeds", "LEE"),
    ("Liverpool", "Liverpool", "LIV"),
    ("Manchester City", "Man City", "MNC"),
    ("Manchester United", "Man Utd", "MAN"),
    ("Newcastle United", "Newcastle", "NEW"),
    ("Nottingham Forest", "Nottm Forest", "NFO"),
    ("Sunderland", "Sunderland", "SUN"),
    ("Tottenham Hotspur", "Spurs", "TOT"),
]
# How football-data.co.uk spelled these clubs across 2018-2026.
FD = {
    "Arsenal": "Arsenal",
    "Aston Villa": "Aston Villa",
    "Bournemouth": "Bournemouth",
    "Brentford": "Brentford",
    "Brighton": "Brighton",
    "Chelsea": "Chelsea",
    "Coventry City": "Coventry",
    "Crystal Palace": "Crystal Palace",
    "Everton": "Everton",
    "Fulham": "Fulham",
    "Hull City": "Hull",
    "Ipswich Town": "Ipswich",
    "Leeds": "Leeds",
    "Liverpool": "Liverpool",
    "Man City": "Man City",
    "Man Utd": "Man United",
    "Newcastle": "Newcastle",
    "Nott'm Forest": "Nott'm Forest",
    "Spurs": "Tottenham",
    "Sunderland": "Sunderland",
}


def espn_clubs():
    return [
        {"display": display, "aliases": [display, short, code]}
        for display, short, code in ESPN
    ]


class NamesTest(unittest.TestCase):
    def test_live_spellings_all_resolve(self):
        aliases = link_feeds(FPL, espn_clubs(), CFG)
        index = ClubIndex(CFG)
        for name, als in aliases.items():
            index.add(name, als)
        for canonical, fd_name in FD.items():
            self.assertEqual(index.match(fd_name), canonical, fd_name)

    def test_unknown_club_is_refused(self):
        aliases = link_feeds(FPL, espn_clubs(), CFG)
        index = ClubIndex(CFG)
        for name, als in aliases.items():
            index.add(name, als)
        with self.assertRaises(UnmappedName):
            index.match("Zorbex Wanderers")

    def test_bare_united_is_not_a_guess(self):
        aliases = link_feeds(FPL, espn_clubs(), CFG)
        index = ClubIndex(CFG)
        for name, als in aliases.items():
            index.add(name, als)
        with self.assertRaises((UnmappedName, AmbiguousName)):
            index.match("United")

    def test_config_has_no_season_or_club_roster(self):
        raw = json.dumps(CFG)
        for banned in ("Arsenal", "2026", "2027", "Bet365", "ClubElo", "Spurs"):
            self.assertNotIn(banned, raw)


if __name__ == "__main__":
    unittest.main()
