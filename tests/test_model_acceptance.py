"""The strength model must match the backtest on three matches, to two decimals.

Odds are 1 divided by the probability, with no margin. Each match uses only the
rounds before it. The numbers are computed by the page's own ratings and predict.
"""
import json
import tempfile
import unittest
from pathlib import Path

from plx.build_site import write_site

ROOT = Path(__file__).resolve().parents[1]

# gameweek, home, away, home/draw/away odds, home and away expected goals
CASES = [
    (8, "Ipswich Town", "Nott'm Forest", ("4.96", "3.67", "1.90"), ("1.16", "1.92")),
    (8, "Arsenal", "Everton", ("1.65", "3.71", "8.02"), ("1.87", "0.78")),
    (2, "Crystal Palace", "Man City", ("9.73", "4.50", "1.48"), ("0.85", "2.28")),
]


class ModelAcceptanceTest(unittest.TestCase):
    def test_three_matches_match_the_backtest(self):
        data = json.loads((ROOT / "data" / "pl.json").read_text(encoding="utf-8"))
        ratings = data["cfg"]["ratings"]
        self.assertEqual(ratings["tau_rounds"], 6)
        self.assertEqual(ratings["prior_matches"], 4)
        self.assertEqual(ratings["xg_blend"], 0.5)
        self.assertIs(ratings["home_advantage"], False)
        self.assertIs(ratings["clean_home_advantage"], True)
        self.assertAlmostEqual(ratings["goal_level_prior"], 1.4)
        self.assertAlmostEqual(data["cfg"]["prediction"]["dixon_coles_rho"], -0.25)
        self.assertAlmostEqual(data["prior"]["Arsenal"], 0.935)
        self.assertAlmostEqual(data["prior"]["Ipswich Town"], -0.775)

        with tempfile.TemporaryDirectory() as tmp:
            write_site(ROOT, data, out_dir=Path(tmp))
            page = Path(tmp) / "index.html"
            from playwright.sync_api import sync_playwright

            with sync_playwright() as p:
                browser = p.chromium.launch()
                tab = browser.new_page()
                tab.goto(page.resolve().as_uri(), wait_until="domcontentloaded")
                tab.wait_for_function("() => window.__plr && window.__plr.ratings")
                got = tab.evaluate(
                    """(cases) => cases.map(([gw, h, a]) => {
                      const R = window.__plr.ratings(gw - 1);
                      const p = window.__plr.predict(h, a, R);
                      return {
                        gw, h, a,
                        odds: [p.pw, p.pd, p.pl].map(x => (1 / x).toFixed(2)),
                        xg: [p.lh, p.la].map(x => x.toFixed(2))
                      };
                    })""",
                    [list(row[:3]) for row in CASES],
                )
                browser.close()

        lines = []
        ok = True
        for (gw, home, away, odds, xg), row in zip(CASES, got):
            same = list(row["odds"]) == list(odds) and list(row["xg"]) == list(xg)
            ok = ok and same
            lines.append(
                f"GW{gw} {home}–{away}: odds expected {' / '.join(odds)} got {' / '.join(row['odds'])}; "
                f"goals expected {'–'.join(xg)} got {'–'.join(row['xg'])}"
            )
        self.assertTrue(ok, "\n".join(lines))

    def test_preview_cards_show_the_fair_odds_line(self):
        data = json.loads((ROOT / "data" / "pl.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as tmp:
            write_site(ROOT, data, out_dir=Path(tmp))
            page = Path(tmp) / "index.html"
            from playwright.sync_api import sync_playwright

            with sync_playwright() as p:
                browser = p.chromium.launch()
                tab = browser.new_page()
                tab.goto(page.resolve().as_uri(), wait_until="domcontentloaded")
                tab.wait_for_function("() => window.__plr && window.__plr.fairOdd")
                self.assertEqual(tab.evaluate("() => window.__plr.fairOdd(0)"), "–")
                self.assertEqual(tab.evaluate("() => window.__plr.fairOdd(-0.2)"), "–")
                self.assertNotIn("Infinity", tab.evaluate("() => window.__plr.fairOdd(0)"))
                lines = tab.evaluate(
                    """(cases) => {
                      const plr = window.__plr;
                      const out = [];
                      for (const [gw, h, a, odds] of cases) {
                        const R = plr.ratings(gw - 1);
                        const p = plr.predict(h, a, R);
                        const line = "Fair odds " + [p.pw, p.pd, p.pl].map(plr.fairOdd).join(" · ");
                        plr.S.gw = gw - 1;
                        plr.S.tab = "elozetes";
                        plr.S.open = null;
                        plr.render();
                        const text = document.getElementById("app").innerText;
                        out.push({ line, odds, shown: text.includes(line), textHas: text.includes("Fair odds " + odds.join(" · ")) });
                      }
                      return out;
                    }""",
                    [[gw, h, a, list(odds)] for gw, h, a, odds, _xg in CASES],
                )
                browser.close()
        for (gw, home, away, odds, _xg), row in zip(CASES, lines):
            self.assertEqual(row["line"], "Fair odds " + " · ".join(odds), f"GW{gw} {home}–{away}")
            self.assertTrue(row["shown"] and row["textHas"], f"GW{gw} card text missing {row['line']}")


if __name__ == "__main__":
    unittest.main()
