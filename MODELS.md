# How the numbers are worked out

Measured facts are downloaded or calculated on every run. Choices (how fast recent matches fade, how many simulations, the cut-offs for a "robbery") live only in `config/model.json`.

## Pre-season strength

When `config/preseason_prior_<season>.json` exists for the season the fixtures imply, that file is the pre-season strength and the computed Elo prior is not used. For 2026/27 the file is a ClubElo snapshot of 15 August 2026, converted with the same Poisson formula at a goal level of 1.40. The pipeline matches those names onto the current clubs and stops if any club in the file is unmatched or any current club is missing. Seasons without a file still use the Elo calculation below.

Every run downloads several past seasons of Premier League (`E0`) and Championship (`E1`) results from football-data.co.uk. How many seasons is `elo.history_seasons` (currently 8). Matches from the current season are left out, so the rating really is a pre-season figure. Promoted clubs are included, because their Championship matches are in the same files.

Each club starts at `elo.initial_rating` (1500). Results are replayed in date order. A home win scores 1, a draw 0.5, an away win 0. The expected score is the usual Elo formula, with a home advantage of H points added to the home club. Both clubs then move by `K` times (result − expected). `K` is `elo.k_factor` (20). The 400-point scale is `elo.scale`.

H is not typed in. For each candidate on a grid (`elo.hfa_grid_min` to `elo.hfa_grid_max`), the whole history is replayed and we keep the H with the smallest average squared error. If the best H sits on the edge of the grid, the build stops instead of clipping it. On the current history that value is 45 Elo points.

The twenty Premier League clubs are then compared with their own average rating. The gap is turned into the strength number `s` the match model expects: the value where a Poisson match against an average side (goal level 1.40, the same `ratings.goal_level_prior` the strength rating uses) has the same expected points share as the Elo expected score. The search step and the limit are `elo.strength_step` and `elo.strength_limit`. Hitting the limit stops the build. The 2026/27 file already holds those converted numbers, so this step is what produced them, not a second conversion at build time.

Club names are not mapped by a hand-written list. Each run collects the spellings on the Premier League feed and on the ESPN club list (full name and short name). Comparison is generic: ignore punctuation, read "Utd" as "United", drop a leading "FC". "Man Utd" and "Man United" meet that way. "Spurs" and "Tottenham" meet because ESPN lists both spellings for the same club. If a name still matches nobody, or matches two clubs, the build stops and names the club.

## League goal rate and home advantage inside the season

The ratings model needs a prior for how many goals a team scores per match, and for how much home ground is worth. Both are measured from the same historical Premier League files (`elo.goal_rate_seasons`, currently the last 3 complete seasons):

- goals per team per match (currently about 1.49)
- home goals relative to that average, and away goals relative to that average (currently about 1.08 and 0.92)

## Penalty xG

Non-penalty xG subtracts a penalty's xG. That figure is the average xG of the penalties in this season's shot file (currently 0.76 from 12 penalties). There is no standby value. If the file contains no penalties, the build stops.

## Match chances from the shots, and points deserved

`prep` in Python, function names `poisson_binomial` and the match loop.

Each shot is an independent coin-toss with probability equal to its xG. Own goals are left out of xG. Home win, draw and away win are read off the two resulting distributions. Points deserved are 3 times the win chance plus the draw chance.

A **robbery** is a win whose chance was under `thresholds.robbery_win_probability` (0.30). A **blown win** is a draw where one side was over `thresholds.blown_win_probability` (0.55). **Deserved** is a win over `thresholds.dominance_win_probability` (0.70) with an xG gap over `thresholds.dominance_xg_diff` (1.1).

## Power

In the browser, `ratings`. Expected goals are goal level × attack × opponent's defence, and × the home factor only when `ratings.home_advantage` is on. It is off for the forecast (`home_advantage: false`), so that ratio is 1. The cleaned-xG view keeps it (`clean_home_advantage: true`). The input to each match is `ratings.xg_blend` xG and the rest actual goals (0.50 / 0.50). A match from `ratings.tau_rounds` (6) gameweeks ago counts about a third as much as this week's. Before any matches, each club is given `ratings.prior_matches` (4) games against an average side at its pre-season strength. When home advantage is on, it uses `ratings.home_prior_matches` (15) games at the measured home and away factors. Attack and defence are re-estimated `ratings.iterations` (40) times and scaled so their geometric mean is 1. The goal level is `ratings.goal_level_prior` (1.40), pulled with a weight of `ratings.goal_prior_matches` (50) team-matches. It is not the measured league rate. Power is that goal level times (attack − defence): the goal difference expected against an average opponent on a neutral pitch.

These settings are the variant that produced the most correct 1X2 favourites in a backtest of 1440 parameter combinations on gameweeks 1–9, each round predicted only from the matches before it.

## Match forecast

`predict`. Independent Poisson goals from 0 to `prediction.max_goals` (10), then a Dixon–Coles adjustment (`prediction.dixon_coles_rho`, −0.25) that makes 0–0, 1–0, 0–1 and 1–1 a little more common. The page shows the 1X2 chances, over 2.5, both teams to score, a clean sheet for each side, and the three most likely scorelines. Expected goals are shown to two decimals. Under the model chances, each preview card shows fair odds: 1 divided by the unrounded probability, to two decimals, with no margin. A probability of 0 is a dash. It does not show a bookmaker price.

The model log (`backtest`) re-forecasts every finished round using only the matches before it.

## Season simulation

`simulate`. `simulation.runs` (6000) seasons of the remaining fixtures, with the current Power ratings held fixed. Output: expected points, and the chance of the title, the European places, and relegation. How many places those are is `places` in the config (1, 4, 6, and 3). Those are competition rules, not something the feeds state, so they stay in the config rather than in the page code. Change them there if the league changes the prize or relegation structure.

## Adjusted xG

`cleanR`, `adjMatch`, `cleanTable`. Same ratings model with only xG, no recency (`ratings.clean_tau_rounds`), a lighter pre-season pull (`ratings.clean_prior_matches`, 4), and home advantage left on (`ratings.clean_home_advantage`). A match's xG is divided by what an average side would create against that opponent at that ground.

## Points, pulled apart

`decomp`. The value of the performances is the sum of Poisson points from adjusted xG. Schedule and ground are the same sum from raw xG, minus that. Finishing and goalkeeping turn (goals − xG) and (xG against − goals against) into points. The points-per-goal rate is fitted on this season's clubs and kept between `thresholds.points_per_goal_clip_low` and `thresholds.points_per_goal_clip_high` (0.1 and 0.6). Whatever is left is other luck. The pieces add up to the real points.

## Win chance through a match

`wpAt`, `wpCurve`. Pre-match expected goals come from the Power model as it stood before the round. With the current score and the fraction of the match left, the remaining goals are Poisson. Added time runs at least `thresholds.regulation_minutes` (94), or to the last shot. A goal's swing is the change in the scoring side's expected points at that moment, summed by player. The excitement index adds up the minute-by-minute movement. A comeback is a win whose chance dipped under `thresholds.comeback_win_probability` (0.25) while the side was behind. The model does not see red cards or substitutions.

## Game state, set pieces, chance quality

Time spent leading, level and trailing comes from the goal minutes. Set pieces are the situations listed in `set_piece_situations`. A good chance is at least `thresholds.good_chance_xg` (0.10), a big chance at least `thresholds.big_chance_xg` (0.30). The penalty-area lines on the shot map are `thresholds.box_x_on_shot_scale`, `six_yard_x_on_shot_scale` and `six_yard_half_width_on_shot_scale`, on Understat's pitch scaled by `shot_x_scale` and `shot_y_scale`. "Outside the box" for headed and long-range goals uses `thresholds.outside_box_understat_x` (0.835 on the 0–1 scale). Those two definitions are not the same line; both are the ones the original page used, and both are now in the config.

## Fixture list, rest, Europe

The fixture list, kickoffs and gameweeks come from the Premier League feed on every run, and are compared with the previous build. A moved kickoff, a blank date, or a gameweek change is written onto the status report.

Rest is the time since a club's previous competitive match. Short rest is under `thresholds.short_rest_days` (4); very short, under `thresholds.very_short_rest_days` (3). European matches are included when the public schedule returns them.

European kickoffs are read from ESPN's public JSON for the Champions League, Europa League and Conference League (`sources.european_competitions`). Times arrive in UTC, so daylight-saving dates are not typed in. A match name that is not "Away at Home" stops the build rather than storing a blank opponent. In the current season this returns 72 matches for 9 Premier League clubs, each with an opponent and a kickoff. Domestic cups are not on this feed and are not included, so a League Cup or FA Cup week will not show in the rest figures. If the feed returns nothing during the months in `sources.europe_required_months`, the build stops, because publishing rest days that quietly ignore Europe would be wrong. ESPN is a public page, not an official UEFA feed; if it blocks the weekly runner, the build fails and the previous page stays up.

## Sentences

Headlines and the short club notes are written templates filled in with this week's ranks and numbers. The cut-offs for "top few" and "bottom few" are `thresholds.trend_rank_window` and the related place gaps in the config.
