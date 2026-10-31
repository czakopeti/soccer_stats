"""Pre-season strength from historical league results.

No outside rating file is used. We replay Premier League (E0) and Championship (E1)
results from football-data.co.uk, rate every club with Elo, and turn each
current Premier League club's rating into the goal-strength prior the
match model expects. Promoted clubs are rated from their Championship
matches, so they are not treated as average by default.
"""
from __future__ import annotations

import csv
import math
from datetime import datetime
from pathlib import Path

from plx.names import AmbiguousName, UnmappedName, cluster_historical_names, normalize


class EloError(RuntimeError):
    pass


def season_code(start_year: int) -> str:
    return f"{start_year % 100:02d}{(start_year + 1) % 100:02d}"


def parse_fd_date(value: str) -> datetime:
    value = value.strip()
    for fmt in ("%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    raise EloError(f"Could not read a match date {value!r} in the historical results. Expected DD/MM/YYYY.")


def load_history_matches(history_dir: Path, codes: list[str], divisions: list[str]) -> list[dict]:
    rows = []
    missing = []
    for code in codes:
        for div in divisions:
            path = history_dir / f"{div}_{code}.csv"
            if not path.exists():
                missing.append(str(path.name))
                continue
            with path.open(encoding="utf-8-sig", newline="") as fh:
                reader = csv.DictReader(fh)
                if not reader.fieldnames or "HomeTeam" not in reader.fieldnames or "FTHG" not in reader.fieldnames:
                    raise EloError(f"{path.name} is not a football-data match file (missing HomeTeam/FTHG).")
                file_rows = 0
                for rec in reader:
                    if not rec.get("HomeTeam") or not rec.get("AwayTeam"):
                        continue
                    if rec.get("FTHG") in (None, "") or rec.get("FTAG") in (None, ""):
                        continue
                    file_rows += 1
                    rows.append(
                        {
                            "date": parse_fd_date(rec["Date"]),
                            "division": div,
                            "season": code,
                            "home": rec["HomeTeam"].strip(),
                            "away": rec["AwayTeam"].strip(),
                            "hg": int(rec["FTHG"]),
                            "ag": int(rec["FTAG"]),
                        }
                    )
                if file_rows < 1:
                    raise EloError(f"{path.name} contained no finished matches.")
    if missing:
        raise EloError(
            "Historical result files are missing, so pre-season strength was not guessed. Missing: "
            + ", ".join(missing)
        )
    rows.sort(key=lambda r: (r["date"], r["division"], r["home"], r["away"]))
    return rows


def _replay(matches: list[dict], hfa: float, k: float, initial: float, scale: float) -> tuple[dict[str, float], float]:
    ratings: dict[str, float] = {}
    sse = 0.0

    def R(name: str) -> float:
        return ratings.setdefault(name, initial)

    for m in matches:
        rh, ra = R(m["home"]), R(m["away"])
        expected = 1.0 / (1.0 + 10 ** (-((rh + hfa) - ra) / scale))
        if m["hg"] > m["ag"]:
            score = 1.0
        elif m["hg"] == m["ag"]:
            score = 0.5
        else:
            score = 0.0
        sse += (score - expected) ** 2
        ratings[m["home"]] = rh + k * (score - expected)
        ratings[m["away"]] = ra + k * ((1.0 - score) - (1.0 - expected))
    return ratings, sse / max(1, len(matches))


def fit_home_advantage(matches: list[dict], elo_cfg: dict) -> tuple[float, dict[str, float]]:
    k = float(elo_cfg["k_factor"])
    initial = float(elo_cfg["initial_rating"])
    scale = float(elo_cfg["scale"])
    start = int(elo_cfg["hfa_grid_min"])
    stop = int(elo_cfg["hfa_grid_max"])
    step = int(elo_cfg["hfa_grid_step"])
    if step <= 0 or stop <= start:
        raise EloError("Home-advantage search grid in the model config is empty.")
    grid = list(range(start, stop + 1, step))
    best = None
    for hfa in grid:
        ratings, sse = _replay(matches, hfa, k, initial, scale)
        if best is None or sse < best[0]:
            best = (sse, float(hfa), ratings)
    assert best is not None
    if best[1] in (float(grid[0]), float(grid[-1])):
        raise EloError(
            f"Home advantage landed on the edge of the search grid ({best[1]:.0f} Elo points). "
            "Widen elo.hfa_grid_min/max in config/model.json. The build stopped rather than clip it."
        )
    return best[1], best[2]


def _exp_points_share(strength: float, league_gpg: float, goals_max: int) -> float:
    lf = league_gpg * math.exp(strength / 2)
    la = league_gpg * math.exp(-strength / 2)

    def pois(lam: float) -> list[float]:
        p = math.exp(-lam)
        out = [p]
        for k in range(1, goals_max):
            p *= lam / k
            out.append(p)
        return out

    ph, pa = pois(lf), pois(la)
    win = draw = 0.0
    for i, pi in enumerate(ph):
        for j, pj in enumerate(pa):
            p = pi * pj
            if i > j:
                win += p
            elif i == j:
                draw += p
    return win + draw / 2


def strength_from_elo(elo: float, mean_elo: float, league_gpg: float, elo_cfg: dict) -> float:
    scale = float(elo_cfg["scale"])
    target = 1.0 / (1.0 + 10 ** (-(elo - mean_elo) / scale))
    step = float(elo_cfg["strength_step"])
    limit = float(elo_cfg["strength_limit"])
    goals_max = int(elo_cfg["poisson_goals_max"])
    n = int(round(limit / step))
    grid = [i * step for i in range(-n, n + 1)]
    scored = [(_exp_points_share(s, league_gpg, goals_max), s) for s in grid]
    best = min(scored, key=lambda q: abs(q[0] - target))
    if best[1] in (grid[0], grid[-1]):
        raise EloError(
            f"A club's pre-season strength hit the edge of the scale ({best[1]}). "
            "Raise elo.strength_limit in config/model.json. The build stopped rather than clip it."
        )
    return round(best[1], 3)


def goal_rates(matches: list[dict], division: str, season_codes: list[str]) -> dict:
    chosen = [m for m in matches if m["division"] == division and m["season"] in season_codes]
    if not chosen:
        raise EloError(f"No {division} matches in seasons {season_codes} to measure the league goal rate.")
    goals = sum(m["hg"] + m["ag"] for m in chosen)
    home = sum(m["hg"] for m in chosen)
    away = sum(m["ag"] for m in chosen)
    n = len(chosen)
    league = goals / (2 * n)
    if league <= 0:
        raise EloError("Historical goal rate was zero, which cannot be used as a prior.")
    return {
        "matches": n,
        "seasons": list(season_codes),
        "league_gpg": league,
        "home_gpg": home / n,
        "away_gpg": away / n,
        "home_factor": (home / n) / league,
        "away_factor": (away / n) / league,
    }


def build_priors(
    matches: list[dict],
    current_teams: list[str],
    alias_sets: dict[str, list[str]],
    season_start: datetime,
    cfg: dict,
    division: str = "E0",
) -> dict:
    """alias_sets maps the canonical Premier League name to every spelling we saw for it this run."""
    from plx.names import ClubIndex

    before = [m for m in matches if m["date"] < season_start]
    if len(before) < 20:
        raise EloError(
            f"Only {len(before)} historical matches fall before {season_start.date()}. "
            "That is not enough to rate clubs. Check the football-data download."
        )
    elo_cfg = cfg["elo"]
    names = [m["home"] for m in before] + [m["away"] for m in before]
    clusters = cluster_historical_names(names, cfg)
    index = ClubIndex(cfg)
    for team, aliases in alias_sets.items():
        index.add(team, aliases)

    def club_id(raw: str) -> str:
        try:
            return "team:" + index.match(raw)
        except UnmappedName:
            return "hist:" + clusters[raw]
        except AmbiguousName:
            raise

    seen = set()
    for raw in names:
        try:
            seen.add(index.match(raw))
        except UnmappedName:
            continue
    missing = [t for t in current_teams if t not in seen]
    if missing:
        raise UnmappedName(
            "No historical league results matched: "
            + ", ".join(missing)
            + ". Their pre-season strength was not set to average, because that would be a silent guess."
        )

    clustered = [{**m, "home": club_id(m["home"]), "away": club_id(m["away"])} for m in before]
    hfa, ratings = fit_home_advantage(clustered, elo_cfg)
    elos = {t: ratings["team:" + t] for t in current_teams}
    mean_elo = sum(elos.values()) / len(elos)
    codes = sorted({m["season"] for m in before if m["division"] == division})
    use = codes[-int(elo_cfg["goal_rate_seasons"]) :]
    rates = goal_rates(before, division, use)
    priors = {
        t: strength_from_elo(elos[t], mean_elo, rates["league_gpg"], elo_cfg) for t in current_teams
    }
    return {
        "prior": priors,
        "elo": {t: round(elos[t], 1) for t in current_teams},
        "home_advantage": hfa,
        "mean_elo": round(mean_elo, 1),
        "matches_used": len(before),
        "goal_rates": rates,
        "history_through": max(m["date"] for m in before).date().isoformat(),
    }
