"""The status line has to follow the fixture list, not assume a break."""
import unittest
from datetime import datetime, timezone

from plx.round_status import describe_round, summary_problems


def _at(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def _fx(event, kickoff, *, finished=False, started=False, home="Northport", away="Southbridge"):
    return {
        "event": event,
        "kickoff": kickoff,
        "finished": finished,
        "started": started,
        "home": home,
        "away": away,
    }


def _round(n, kickoff, *, finished=False, started=False):
    """Ten matches in one gameweek, identical state, distinct pairs."""
    homes = [f"Home {i}" for i in range(n)]
    return [
        _fx(9, kickoff, finished=finished, started=started, home=home, away=f"Away {i}")
        for i, home in enumerate(homes)
    ]


class RoundStatusTest(unittest.TestCase):
    def test_gameweek_in_progress(self):
        now = _at("2031-10-31T18:00:00Z")
        previous = [_fx(8, "2031-10-25T16:30:00Z", finished=True, home=f"H{i}", away=f"A{i}") for i in range(10)]
        current = _round(4, "2031-10-31T12:30:00Z") + _round(6, "2031-11-01T16:30:00Z")
        for row in current[:3]:
            row["finished"] = True
            row["started"] = True
        current[3]["started"] = True
        note = describe_round(previous + current, 8, now, "UTC")
        self.assertEqual(note.kind, "in_progress")
        self.assertIn("GW9 in progress (4 of 10 matches played)", note.summary)
        self.assertIn("the page will update once the round is complete", note.summary)
        self.assertNotIn("break", note.summary.lower())
        self.assertEqual(summary_problems(note.summary, note), [])
        self.assertTrue(summary_problems("This is an international break.", note))

    def test_kickoff_soon_is_not_a_break(self):
        now = _at("2031-10-31T12:00:00Z")
        previous = [_fx(8, "2031-10-25T16:30:00Z", finished=True)]
        upcoming = [_fx(9, "2031-10-31T15:00:00Z", home="Northport", away="Southbridge")]
        note = describe_round(previous + upcoming, 8, now, "UTC")
        self.assertEqual(note.kind, "not_started")
        self.assertIn("GW9 starts 31 Oct 2031, 15:00 UTC", note.summary)
        self.assertIn("no new results yet", note.summary)
        self.assertNotIn("break", note.summary.lower())
        self.assertNotIn("in progress", note.summary.lower())
        self.assertEqual(summary_problems(note.summary, note), [])

    def test_long_gap_names_the_dates(self):
        now = _at("2031-11-10T12:00:00Z")
        previous = [_fx(8, "2031-10-18T16:30:00Z", finished=True)]
        upcoming = [_fx(9, "2031-11-14T15:00:00Z")]
        note = describe_round(previous + upcoming, 8, now, "Europe/London", gap_days=12)
        self.assertEqual(note.kind, "gap")
        self.assertIn("No Premier League matches since", note.summary)
        self.assertIn("GW9 starts", note.summary)
        self.assertIn("Europe/London", note.summary)
        self.assertIn("UTC", note.summary)
        self.assertNotIn("break", note.summary.lower())
        self.assertTrue(summary_problems("International break, nothing to do.", note))

    def test_postponed_and_rescheduled_are_named(self):
        now = _at("2031-10-31T18:00:00Z")
        rows = [
            _fx(8, "2031-10-25T16:30:00Z", finished=True),
            _fx(9, "2031-10-31T12:30:00Z", finished=True, home="Northport", away="Southbridge"),
            _fx(9, None, home="Eastwick", away="Westmere"),
        ]
        changes = [
            {"kind": "rescheduled", "gameweek": 9, "home": "Northport", "away": "Southbridge", "was": "2031-10-30T15:00:00Z", "now": "2031-10-31T12:30:00Z"},
            {"kind": "postponed", "gameweek": 9, "home": "Eastwick", "away": "Westmere", "was": "2031-10-31T15:00:00Z", "now": None},
        ]
        note = describe_round(rows, 8, now, "UTC", changes)
        self.assertEqual(note.kind, "in_progress")
        self.assertIn("Northport v Southbridge was rescheduled", note.summary)
        self.assertIn("Eastwick v Westmere was postponed", note.summary)
        self.assertEqual(summary_problems(note.summary, note), [])

    def test_catalogue_lag_is_explicit(self):
        now = _at("2031-11-03T12:00:00Z")
        rows = [_fx(8, "2031-10-25T16:30:00Z", finished=True)]
        rows += [_fx(9, "2031-11-02T20:00:00Z", finished=True, home=f"H{i}", away=f"A{i}") for i in range(10)]
        note = describe_round(rows, 8, now, "UTC")
        self.assertEqual(note.kind, "lag")
        self.assertIn("GW9 complete (10 of 10 matches played)", note.summary)
        self.assertIn("match file still stops at GW8", note.summary)
        self.assertNotIn("break", note.summary.lower())
        self.assertEqual(summary_problems(note.summary, note), [])
        self.assertTrue(summary_problems("No new round. International break.", note))

    def test_a_started_flag_counts_before_the_kickoff_clock(self):
        now = _at("2031-10-31T12:00:00Z")
        rows = [
            _fx(8, "2031-10-25T16:30:00Z", finished=True),
            _fx(9, "2031-10-31T20:00:00Z", started=True),
        ]
        note = describe_round(rows, 8, now, "UTC")
        self.assertEqual(note.kind, "in_progress")
        self.assertTrue(note.started)
        self.assertIn("1 of 1 match played", note.summary)


if __name__ == "__main__":
    unittest.main()
