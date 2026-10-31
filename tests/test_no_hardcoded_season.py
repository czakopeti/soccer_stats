"""Production code must not carry a season, a club roster, or a bookmaker."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCAN = [ROOT / "plx", ROOT / "web", ROOT / "scripts", ROOT / "config"]
BANNED = [
    r"\b202[4-9]\b",
    r"\b203[0-9]\b",
    r"\bArsenal\b",
    r"\bBet365\b",
    r"\bClubElo\b",
    r"\bxgabora\b",
    r"Röntgen",
    r"Europe/Budapest",
]


class NoHardcodedSeasonTest(unittest.TestCase):
    def test_pipeline_and_page_have_no_baked_in_season(self):
        hits = []
        for folder in SCAN:
            for path in folder.rglob("*"):
                if path.suffix not in {".py", ".js", ".html", ".css", ".json", ".yml"}:
                    continue
                # Season data, named for the season the pipeline derives at runtime.
                # The code looks the file up from that season. It does not name a year.
                if path.name.startswith("preseason_prior_") and path.suffix == ".json":
                    continue
                text = path.read_text(encoding="utf-8")
                for pat in BANNED:
                    if re.search(pat, text):
                        hits.append(f"{path.relative_to(ROOT)} matches {pat}")
        self.assertEqual(hits, [], "\n".join(hits))


if __name__ == "__main__":
    unittest.main()
