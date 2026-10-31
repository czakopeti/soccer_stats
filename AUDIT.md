# What used to be typed in

This is every literal that carried a fact about the season in the original `prep_data.py` and `pl_rontgen.js`, and what happened to it. Layout numbers (chart widths, colours, animation delays) are not facts about football and stayed in the page code.

The test `tests/test_no_hardcoded_season.py` fails if a year, a club name, or a bookmaker name appears in `plx/`, `web/`, `scripts/` or `config/`. `tests/test_simulated_season.py` runs the whole preparation against a made-up 2031/32 league of four clubs, including one whose historical name is spelled differently, and a second run that must stop because a club has no history.

## Removed

| Original | Where | What we did |
|---|---|---|
| Bet365, maximum prices, over/under, handicap, from football-data via xgabora | `prep_data.py` odds block, `ODDS`, `mkt()`, preview "Bet365", model-versus-bookmaker panel | Deleted. The download no longer fetches those files. The page data has no odds block. |
| ClubElo snapshot on a fixed date, and the name table that pointed at it | `ELO_DATE`, `ELO_NAME`, `EloRatings.csv` | Deleted. Pre-season strength is calculated from results. See MODELS.md. |
| Hand-typed Champions League list, Europa and Conference dates, and the empty opponents | `CL`, `EL_DATES`, `ECL_DATES` | Deleted. Replaced by ESPN's public schedule, which includes the opponent and a UTC kickoff. |
| Daylight-saving switch on 25 Oct 2026 and 28 Mar 2027 | `cet()` | Deleted. Kickoffs arrive in UTC. Display uses `zoneinfo` / `Intl` with `display_timezone` (`Europe/London`). |
| Season label `"2026/27"`, odds division `E0`, season start `2026-08-01` | top of `prep_data.py` | The season is read from the first kickoff. The catalogue folder has to match it or the build stops. |
| Penalty xG `0.79` | `PEN_XG` | Replaced by the average xG of this season's penalties. No standby number. |
| League goal prior `1.40`, and the home/away prior `1.1` / `0.9` | `ratings()` and the Elo conversion | Replaced by the measured rate and home/away split from recent Premier League seasons. |
| Fallback goal rate `1.35` when a filter has no matches | `ratings()` | Uses the measured league rate. |
| "38 gameweeks", chart height `20` teams | `viewElozetes`, `viewMenetrend`, `slope`, `bump` | Gameweeks, clubs and fixtures are counted from the feed. Charts size themselves from the club list. |
| Name tables `ODDS_NAME` | `prep_data.py` | Replaced by generic matching plus the spellings the feeds publish this run. An unmatched or double-matched name stops the build. |
| Bookmaker words in the footer and the "how we calculate" note | `pl_rontgen.js` | Rewritten. The footer credits pl-catalogue, the Premier League feed, ESPN and football-data.co.uk results. |

## Moved into `config/model.json`

These are choices, not measurements. They are the same numbers the original page used. They are not repeated in the page code; the page reads them from the data file, which copies this config. If one is missing, the page throws instead of guessing.

| Original | Config key |
|---|---|
| Recency τ = 12, prior matches k = 8, 80% xG, 40 iterations, 50-match goal prior, 15-match home prior | `ratings` |
| Adjusted-xG settings (xG only, no recency, k = 4) | `ratings.clean_*` |
| Dixon–Coles ρ = −0.12, goals 0–10 | `prediction` |
| 6000 simulations | `simulation.runs` |
| Title / top 4 / top 6 / 3 relegated | `places` |
| Robbery 0.30, blown win 0.55, dominance 0.70 and 1.1 xG | `thresholds.robbery_win_probability`, `blown_win_probability`, `dominance_*` |
| Good chance 0.10, big chance 0.30 | `thresholds.good_chance_xg`, `big_chance_xg` |
| Comeback 0.25, team comeback 0.20, blown lead 0.80 | `thresholds.comeback_win_probability`, `team_comeback_win_probability`, `team_blown_win_probability` |
| Short rest 4 days, very short 3, Europe soon 5 | `thresholds.short_rest_days`, `very_short_rest_days`, `europe_soon_days` |
| Added time 94, late goal 75 | `thresholds.regulation_minutes`, `late_goal_minute` |
| Points-per-goal clip 0.1 to 0.6 | `thresholds.points_per_goal_clip_*` |
| Mismatch: flip at 2 places, "exaggerates" at 5 | `thresholds.mismatch_flip_places`, `mismatch_gap_places` |
| Minimum minutes 270, duels 10, value xG+xA 0.5 | `thresholds.min_minutes_default`, `duel_min`, `value_min_xgi` |
| Pitch scale 120×80, box and six-yard lines, 105×68 metres, outside-box x = 0.835 | `thresholds.shot_*`, `box_x_on_shot_scale`, `six_yard_*`, `pitch_*`, `outside_box_understat_x` |
| Elo K, start rating, scale, history length, search grids | `elo` |
| Which Opta team metrics to keep, and the shot result / situation vocabulary | `opta_team_metrics`, `shot_results`, `shot_situations` |
| An unrecognised shot result or situation | The build stops and names it, instead of copying the raw label through. |

`places` is a competition rule the feeds do not state. It is documented here so a change of the European or relegation places is an edit in one file, not a silent assumption.

## Still computed, and checked

| Fact | How |
|---|---|
| 20 clubs, 38 gameweeks, 380 fixtures, one home and one away | Counted from the fixture feed and checked against a home-and-away league of that many clubs. Not written down as 20 or 380. |
| Kickoff moved, postponed, or gameweek changed | Compared with the previous snapshot and listed on the status page. |
| Scores | Every finished score is compared with the Premier League feed. A disagreement fails the build. |
| Shot xG versus match xG, goals versus the score | Recomputed. Tolerance for xG rounding is `verify.xg_sum_tolerance` (0.05). |
| Player minutes and goals shrinking | Compared with the previous snapshot. The first build has nothing to compare, and says so. |
| 14 shots with no player id | Same gap as the original file (0.6%). The build fails if that share exceeds `verify.max_unmapped_shot_share` (2%). |
| Hungarian text, bookmaker names, a page that does not open | The checks scan the page code and open every tab in a browser. |

## What the original page did in the browser that is not a fact

`localStorage` key renamed to `plx-v1` (last tab and club only). Number format is a decimal point. Dates use `Europe/London`, including daylight saving, via the platform timezone database.
