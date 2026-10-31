"""The English check has to catch Hungarian with the accents stripped."""
import unittest

from plx.language import find_hits, literal_hits


class LanguageCheckTest(unittest.TestCase):
    def test_owner_examples_fail(self):
        samples = [
            "Mutass still 25-five",
            "a win chancet 8%-rol 26%-ra vitte",
            "Where from jonnek a pontok? Bal oldalt a play erteke",
            "Jobb, mint a table mutatja (there 13.)",
            "NEM PENALTY",
            "FEJES",
            "16-OSON OUTSIDE",
            "merkozes tabella gol fordulo",
        ]
        for sample in samples:
            self.assertTrue(find_hits(sample), sample)

    def test_ordinary_football_english_passes(self):
        sample = (
            "Show 25 more. The win probability went from 8% to 26%. "
            "Goals, matches, points, chances and shots. Ben White. Van Dijk. "
            "Outside the box. Headers. Non-penalty goals. A 0.10 chance. "
            "They sit 13th. Forest are level. 1 shot, 4 shots, 1 day, 3.2 days."
        )
        self.assertEqual(find_hits(sample), [])

    def test_internal_view_keys_are_not_copy(self):
        src = 'const NAV = [["fordulo", "Results"], ["lovesek", "Shots"]];'
        self.assertEqual(literal_hits(src), [])

    def test_a_hungarian_word_inside_a_sentence_still_fails(self):
        src = 'const note = "Click fordulo for the round";'
        self.assertTrue(literal_hits(src))


if __name__ == "__main__":
    unittest.main()
