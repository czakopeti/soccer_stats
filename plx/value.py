"""Value picks: the bookmaker average, adjusted by recent shots and form.

The market prices recent results a little too strongly and recent shots a
little too weakly. config/value_model.json holds a small model fitted on older
seasons of the top five leagues: for each outcome,
    logit(chance) = logit(bookmaker average, margin removed) + z · coef
where z are four standardised inputs from each side's last league matches
(shots on target, shots, goals, form). The three chances are then scaled to
add up to 1.

Rules are listed in the model file and marked at the end of each row. Rule C:
edge ≥ 5% against the average price, average price 2.50–5.00, and our own Elo
rating (elofootball.com's method, replayed from league results) gives that side
no more than the market does. Edge = our chance × average price − 1. Only
home and away wins are bet.

Every finished match this season is scored the same way, from the matches
before it and the price collected before kickoff, so the page measures every
pick. Prices and results: football-data.co.uk.
"""
from __future__ import annotations

import csv
import json
import math
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

UK = ZoneInfo("Europe/London")


class ValueBuildError(Exception):
    pass


def _num(x):
    try:
        v = float(str(x).strip())
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _rows(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    with path.open(encoding="utf-8-sig", newline="") as fh:
        return [r for r in csv.DictReader(fh) if r.get("HomeTeam") and r.get("Date")]


def kickoff(date_s: str, time_s: str | None) -> datetime:
    """football-data dates are DD/MM/YYYY (or YY) with UK local time."""
    d = None
    for fmt in ("%d/%m/%Y", "%d/%m/%y"):
        try:
            d = datetime.strptime(date_s.strip(), fmt)
            break
        except ValueError:
            continue
    if d is None:
        raise ValueBuildError(f"Unreadable date {date_s!r}")
    hh, mm = 15, 0
    if time_s and ":" in time_s:
        hh, mm = (int(x) for x in time_s.strip().split(":")[:2])
    return d.replace(hour=hh, minute=mm, tzinfo=UK).astimezone(timezone.utc)


def _iso(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%MZ")


class Form:
    """Each club's recent league matches, fed in kickoff order."""

    def __init__(self, window: int, form_window: int):
        self.games = defaultdict(lambda: deque(maxlen=window))
        self.points = defaultdict(lambda: deque(maxlen=form_window))

    def add(self, r: dict) -> None:
        hg, ag = _num(r.get("FTHG")), _num(r.get("FTAG"))
        if hg is None or ag is None:
            return
        h, a = r["HomeTeam"].strip(), r["AwayTeam"].strip()
        self.points[h].append(3 if hg > ag else 1 if hg == ag else 0)
        self.points[a].append(3 if ag > hg else 1 if hg == ag else 0)
        hst, ast, hs, as_ = (_num(r.get(k)) for k in ("HST", "AST", "HS", "AS"))
        if None in (hst, ast, hs, as_):
            return
        self.games[h].append((hst, ast, hs, as_, hg, ag))
        self.games[a].append((ast, hst, as_, hs, ag, hg))

    def inputs(self, h: str, a: str, min_matches: int) -> dict | None:
        gh, ga = self.games[h], self.games[a]
        if len(gh) < min_matches or len(ga) < min_matches:
            return None
        mh = [sum(x[i] for x in gh) / len(gh) for i in range(6)]
        ma = [sum(x[i] for x in ga) / len(ga) for i in range(6)]
        return {
            "sotd": (mh[0] - mh[1]) - (ma[0] - ma[1]),
            "shd": (mh[2] - mh[3]) - (ma[2] - ma[3]),
            "gd": (mh[4] - mh[5]) - (ma[4] - ma[5]),
            "form": sum(self.points[h]) - sum(self.points[a]),
        }


def chances(avg: list[float], x: dict, model: dict) -> list[float]:
    inv = [1 / o for o in avg]
    s = sum(inv)
    q = [v / s for v in inv]
    z = [(x[f] - model["mean"][f]) / model["sd"][f] for f in model["features"]]
    out = []
    for i, k in enumerate(("home", "draw", "away")):
        logit = math.log(q[i] / (1 - q[i])) + sum(c * v for c, v in zip(model["coef"][k], z))
        out.append(1 / (1 + math.exp(-logit)))
    t = sum(out)
    return [p / t for p in out]


def market(avg: list[float]) -> list[float]:
    inv = [1 / o for o in avg]
    s = sum(inv)
    return [v / s for v in inv]


def elo_chances(d: float, model: dict) -> list[float]:
    """Home, draw, away chance from the Elo difference d (home advantage included)."""
    x = d / 100
    f = model["elo"]["fit"]
    sig = lambda c: 1 / (1 + math.exp(-(c[0] + c[1] * x + c[2] * x * x)))  # noqa: E731
    h, a = sig(f["home"]), sig(f["away"])
    dr = max(1 - h - a, 0.05)
    t = h + dr + a
    return [h / t, dr / t, a / t]


def marks(p: list[float], avg: list[float], rules: dict, elo: list[float] | None = None) -> list[dict]:
    """Picks on the home (1) or away (2) side."""
    out = []
    q = market(avg)
    for i, side in ((0, "1"), (2, "2")):
        edge = p[i] * avg[i] - 1
        for name, r in rules.items():
            if edge < r["min_edge"]:
                continue
            if "min_odds" in r and not (r["min_odds"] <= avg[i] < r["max_odds"]):
                continue
            if r.get("elo_not_higher") and (elo is None or elo[i] > q[i]):
                continue
            out.append({"rule": name, "side": side, "edge": round(edge, 4)})
    return out


class Elo:
    """elofootball.com's method on league results, from the season-start ratings."""

    def __init__(self, start: dict, model: dict):
        self.r = dict(start.get("teams", {}))
        self.newcomer = float(start["newcomer"])
        self.hfa = float(model["elo"]["home_advantage"])
        self.k = float(model["elo"]["k"])

    def diff(self, h: str, a: str) -> float:
        return self.r.setdefault(h, self.newcomer) + self.hfa - self.r.setdefault(a, self.newcomer)

    def add(self, r: dict) -> None:
        hg, ag = _num(r.get("FTHG")), _num(r.get("FTAG"))
        if hg is None or ag is None:
            return
        h, a = r["HomeTeam"].strip(), r["AwayTeam"].strip()
        we = 1 / (10 ** (-self.diff(h, a) / 400) + 1)
        gd = abs(hg - ag)
        gdm = 1 if gd <= 1 else 1.5 if gd == 2 else (11 + gd) / 8
        res = 1 if hg > ag else 0.5 if hg == ag else 0
        d = self.k * gdm * (res - we)
        self.r[h] += d
        self.r[a] -= d


def score_league(season_rows: list[dict], fixtures: list[dict], label: str, model: dict, elo_start: dict | None = None) -> dict:
    """Past matches scored from the matches before them; next matches from all played so far."""
    rules = model["rules"]
    form = Form(model["window"], model["form_window"])
    elo = Elo(elo_start, model) if elo_start else None
    rows = []
    for r in season_rows:
        try:
            t = kickoff(r["Date"], r.get("Time"))
        except ValueBuildError:
            continue
        rows.append((t, r))
    rows.sort(key=lambda x: x[0])
    history = []
    i = 0
    while i < len(rows):
        # Matches at the same kickoff time see only earlier ones.
        j = i
        while j < len(rows) and rows[j][0] == rows[i][0]:
            j += 1
        batch = rows[i:j]
        for t, r in batch:
            h, a = r["HomeTeam"].strip(), r["AwayTeam"].strip()
            avg = [_num(r.get(k)) for k in ("AvgH", "AvgD", "AvgA")]
            best = [_num(r.get(k)) for k in ("MaxH", "MaxD", "MaxA")]
            x = form.inputs(h, a, model["min_matches"])
            if x is None or not all(v and v > 1 for v in avg):
                continue
            p = chances(avg, x, model)
            mk = marks(p, avg, rules, elo_chances(elo.diff(h, a), model) if elo else None)
            if not mk:
                continue
            hg, ag = _num(r.get("FTHG")), _num(r.get("FTAG"))
            if hg is None or ag is None:
                continue
            res = "1" if hg > ag else "X" if hg == ag else "2"
            for k in mk:
                idx = 0 if k["side"] == "1" else 2
                price = avg[idx] if rules[k["rule"]]["paid_at"] == "average" else (best[idx] or avg[idx])
                history.append({"lg": label, "t": _iso(t), "h": h, "a": a, "rule": k["rule"], "side": k["side"],
                                "edge": k["edge"], "fair": round(1 / p[idx], 3), "price": price, "avg": avg[idx],
                                "hs": int(hg), "as": int(ag), "won": res == k["side"],
                                "profit": round(price - 1, 3) if res == k["side"] else -1.0})
        for _t, r in batch:
            form.add(r)
            if elo:
                elo.add(r)
        i = j
    upcoming = []
    for r in fixtures:
        h, a = r["HomeTeam"].strip(), r["AwayTeam"].strip()
        try:
            t = kickoff(r["Date"], r.get("Time"))
        except ValueBuildError:
            continue
        avg = [_num(r.get(k)) for k in ("AvgH", "AvgD", "AvgA")]
        best = [_num(r.get(k)) for k in ("MaxH", "MaxD", "MaxA")]
        row = {"lg": label, "t": _iso(t), "h": h, "a": a, "avg": avg if all(v and v > 1 for v in avg) else None, "best": best}
        x = form.inputs(h, a, model["min_matches"]) if row["avg"] else None
        if x is not None:
            p = chances(row["avg"], x, model)
            row["p"] = [round(v, 4) for v in p]
            row["edge"] = [round(p[0] * row["avg"][0] - 1, 4), round(p[2] * row["avg"][2] - 1, 4)]
            e = elo_chances(elo.diff(h, a), model) if elo else None
            if e:
                row["elo"] = [round(v, 4) for v in e]
            row["marks"] = marks(p, row["avg"], rules, e)
        upcoming.append(row)
    upcoming.sort(key=lambda m: m["t"])
    return {"label": label, "history": history, "upcoming": upcoming}


def summary(history: list[dict], rule: str, since: str | None = None) -> dict:
    picks = [h for h in history if h["rule"] == rule and (since is None or h["t"][:10] >= since)]
    n = len(picks)
    profit = sum(h["profit"] for h in picks)
    return {"n": n, "won": sum(1 for h in picks if h["won"]), "profit": round(profit, 2), "roi": round(profit / n, 4) if n else None}


def season_code(start_year: int) -> str:
    return f"{start_year % 100:02d}{(start_year + 1) % 100:02d}"


def fetch(root: Path, cfg: dict, start_year: int, model: dict) -> list[str]:
    from plx.leagues import LeagueError, _get

    vc = cfg["value"]
    dest = root / "sources" / "value"
    dest.mkdir(parents=True, exist_ok=True)
    problems = []
    jobs = [("fixtures.csv", vc["fixtures_url"])] + [
        (f"{div}.csv", vc["season_template"].format(code=season_code(start_year), division=div)) for div in model["divisions"]
    ]
    for name, url in jobs:
        path = dest / name
        try:
            path.write_bytes(_get(url, cfg["http_user_agent"], url, attempts=2))
        except LeagueError as exc:
            if path.exists():
                path.unlink()
            problems.append(f"{name}: {exc}"[:200])
    return problems


def build(root: Path, cfg: dict, season_label: str, start_year: int, fetch_first: bool) -> dict:
    model = json.loads((root / cfg["value"]["model_file"]).read_text(encoding="utf-8"))
    season_file = root / "config" / f"preseason_prior_value_{season_label.replace('/', '-')}.json"
    if not season_file.exists():
        raise ValueBuildError(f"No value season file for {season_label}: {season_file.name}")
    season = json.loads(season_file.read_text(encoding="utf-8"))
    problems = fetch(root, cfg, start_year, model) if fetch_first else []
    src = root / "sources" / "value"
    fixtures = _rows(src / "fixtures.csv")
    leagues = []
    for div, label in model["divisions"].items():
        rows = _rows(src / f"{div}.csv")
        if not rows:
            problems.append(f"{label}: no season file")
            continue
        leagues.append(score_league(rows, [r for r in fixtures if r.get("Div") == div], label, model, season.get("elo_start", {}).get(div)))
    if not leagues:
        raise ValueBuildError("No league could be scored. " + "; ".join(problems))
    history = sorted((h for L in leagues for h in L["history"]), key=lambda h: h["t"], reverse=True)
    upcoming = sorted((m for L in leagues for m in L["upcoming"]), key=lambda m: m["t"])
    since = season["tracking_from"]
    return {
        "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "season": season_label,
        "tracking_from": since,
        "rules": model["rules"],
        "model": {"trained_on": model["trained_on"], "checked_on": model["checked_on"]},
        "problems": problems,
        "upcoming": upcoming,
        "history": history,
        "summary": {r: {"test": summary(history, r, since), "season": summary(history, r)} for r in model["rules"]},
    }


def write_page(root: Path, data: dict, site: Path) -> Path:
    web = root / "web"
    css = (web / "style.css").read_text(encoding="utf-8")
    js = (web / "value.js").read_text(encoding="utf-8")
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False).replace("</", "<\\/")
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Value picks</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@600;800;900&family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap">
<style>{css}</style></head>
<body><div class="wrap" id="app"></div>
<script id="data" type="application/json">{payload}</script>
<script>{js}</script></body></html>"""
    site.mkdir(parents=True, exist_ok=True)
    path = site / "value.html"
    path.write_text(html, encoding="utf-8")
    return path
