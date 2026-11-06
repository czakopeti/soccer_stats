"""Home value: our odds with home advantage, against the bookmakers' average.

The fair-odds pages use no home advantage, by design (it tested best for
forecasting the table). To compare with bookmakers, home advantage has to go
back in. It comes from the three seasons before this one, per league
(config/preseason_prior_home_<season>.json): h = ½·ln(home goals ÷ away goals),
home expected goals × e^h, away × e^−h. Chances then come from the same
Dixon–Coles score grid as everywhere else.

The rule tracked here: our home expected goals are higher than the away
side's, and the bookmakers' average home price is higher than our fair home
odds. Bet the home side.

Every past match uses the prediction made before its round and the average
price football-data.co.uk collected before kickoff, with the closing average
for comparison. Club names are paired with football-data's from the results
(same date, same score), as in plx.league_fallback.
"""
from __future__ import annotations

import csv
import json
import math
from datetime import date, datetime, timezone
from pathlib import Path

from plx import league_fallback as lf
from plx.strength import predict, ratings


class HomeValueError(Exception):
    pass


def home_advantage(root: Path, season_label: str) -> dict:
    path = root / "config" / f"preseason_prior_home_{season_label.replace('/', '-')}.json"
    if not path.exists():
        raise HomeValueError(f"No home-advantage file for {season_label}: {path.name}")
    return json.loads(path.read_text(encoding="utf-8"))


def probs(lh: float, la: float, rho: float, max_goals: int) -> tuple[float, float, float]:
    po = lambda l, n: math.exp(-l) * l**n / math.factorial(n)  # noqa: E731
    ph = [po(lh, i) for i in range(max_goals + 1)]
    pa = [po(la, i) for i in range(max_goals + 1)]

    def tau(i, j):
        if i == 0 and j == 0:
            return 1 - lh * la * rho
        if i == 0 and j == 1:
            return 1 + lh * rho
        if i == 1 and j == 0:
            return 1 + la * rho
        if i == 1 and j == 1:
            return 1 - rho
        return 1.0

    w = d = l = 0.0
    for i in range(max_goals + 1):
        for j in range(max_goals + 1):
            p = ph[i] * pa[j] * tau(i, j)
            if i > j:
                w += p
            elif i == j:
                d += p
            else:
                l += p
    t = w + d + l
    return w / t, d / t, l / t


def _num(x):
    try:
        v = float(str(x).strip())
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) and v > 1 else None


def _rows(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    with path.open(encoding="utf-8-sig", newline="") as fh:
        return [r for r in csv.DictReader(fh) if r.get("HomeTeam")]


def _prices(r: dict | None, keys: tuple[str, str, str]) -> list | None:
    if not r:
        return None
    v = [_num(r.get(k)) for k in keys]
    return v if all(v) else None


def _fake_dates(played: list[dict]) -> list[dict]:
    """Our played matches in the shape plx.league_fallback.map_names reads."""
    return [{"h": {"title": m["h"]}, "a": {"title": m["a"]}, "datetime": m["dt"], "isResult": True,
             "goals": {"h": m["hs"], "a": m["as"]}} for m in played]


def league_rows(label: str, played: list[dict], upcoming: list[dict], fd_season: Path, fixtures: list[dict], div: str,
                h_adv: float, rule: dict, rho: float, max_goals: int) -> dict:
    """played/upcoming: dicts with h, a, dt, lh, la (no home advantage) and hs/as when played."""
    season_rows = _rows(fd_season)
    fd_res = lf.load_fd(fd_season)
    mapping, why = lf.map_names(_fake_dates(played), fd_res) if fd_res else (None, "No football-data file.")
    if mapping is None:
        return {"label": label, "error": why, "upcoming": [], "history": []}
    by_pair = {(r["HomeTeam"].strip(), r["AwayTeam"].strip()): r for r in season_rows}
    fx = {(r["HomeTeam"].strip(), r["AwayTeam"].strip()): r for r in fixtures if r.get("Div") == div}
    eh, ea = math.exp(h_adv), math.exp(-h_adv)

    def one(m: dict, fdrow: dict | None) -> dict:
        lh, la = m["lh"] * eh, m["la"] * ea
        p = probs(lh, la, rho, max_goals)
        bk = _prices(fdrow, ("AvgH", "AvgD", "AvgA"))
        out = {"h": m["h"], "a": m["a"], "dt": m["dt"], "lh": round(lh, 3), "la": round(la, 3),
               "p": [round(x, 4) for x in p], "bk": bk}
        if bk:
            out["edge"] = round(p[0] * bk[0] - 1, 4)
            out["pick"] = bool(lh > la and bk[0] * p[0] > 1 and (rule.get("max_home_odds") is None or bk[0] < rule["max_home_odds"]))
        return out

    history = []
    for m in played:
        r = by_pair.get((mapping.get(m["h"]), mapping.get(m["a"])))
        row = one(m, r)
        row.update(hs=m["hs"], **{"as": m["as"]})
        cl = _prices(r, ("AvgCH", "AvgCD", "AvgCA"))
        if cl:
            row["cl"] = cl
        history.append(row)
    up = [one(m, fx.get((mapping.get(m["h"]), mapping.get(m["a"])))) for m in upcoming]
    return {"label": label, "h_adv": round(h_adv, 4), "upcoming": up, "history": history}


def summary(rows: list[dict], since: str | None = None) -> dict:
    picks = [r for r in rows if r.get("pick") and (since is None or r["dt"][:10] >= since)]
    n = len(picks)
    won = sum(1 for r in picks if r["hs"] > r["as"])
    profit = sum((r["bk"][0] - 1) if r["hs"] > r["as"] else -1 for r in picks)
    clv = [math.log(r["bk"][0] / r["cl"][0]) for r in picks if r.get("cl")]
    return {"n": n, "won": won, "profit": round(profit, 2), "roi": round(profit / n, 4) if n else None,
            "clv": round(sum(clv) / len(clv), 4) if clv else None}


def pl_inputs(data: dict) -> tuple[list[dict], list[dict]]:
    c = data["cfg"]
    rtg = c["ratings"]
    teams = list(data["short"])
    played, upcoming = [], []
    by_gw: dict[int, list] = {}
    for m in data["matches"]:
        by_gw.setdefault(int(m["gw"]), []).append(m)
    for g in sorted(by_gw):
        R = ratings(data["matches"], teams, data["prior"], g - 1, rtg, rtg["goal_level_prior"])
        for m in by_gw[g]:
            p = predict(m["h"], m["a"], R, c["prediction"]["dixon_coles_rho"], c["prediction"]["max_goals"])
            played.append({"h": m["h"], "a": m["a"], "dt": m["date"] + " 00:00:00", "lh": p["lh"], "la": p["la"], "hs": m["hs"], "as": m["as"]})
    done = {(m["h"], m["a"]) for m in data["matches"]}
    future = [f for f in data["fx"] if (f[1], f[2]) not in done]
    if future:
        nxt = min(f[0] for f in future)
        R = ratings(data["matches"], teams, data["prior"], nxt - 1, rtg, rtg["goal_level_prior"])
        for f in future:
            if f[0] != nxt:
                continue
            p = predict(f[1], f[2], R, c["prediction"]["dixon_coles_rho"], c["prediction"]["max_goals"])
            upcoming.append({"h": f[1], "a": f[2], "dt": str(f[3]).replace("T", " ").replace("Z", "")[:19], "lh": p["lh"], "la": p["la"]})
    return played, upcoming


def league_inputs(lg: dict) -> tuple[list[dict], list[dict]]:
    played, upcoming = [], []
    for rd in lg["rounds"]:
        for m in rd["matches"]:
            row = {"h": m["h"], "a": m["a"], "dt": m["dt"], "lh": m["lh"], "la": m["la"]}
            if m.get("hs") is not None:
                row.update(hs=m["hs"], **{"as": m["as"]})
                played.append(row)
            elif rd["r"] == lg.get("next_round"):
                upcoming.append(row)
    return played, upcoming


def fetch(root: Path, cfg: dict) -> str:
    from plx.leagues import LeagueError, _get

    vc = cfg["home_value"]
    dest = root / "sources" / "value"
    dest.mkdir(parents=True, exist_ok=True)
    path = dest / "fixtures.csv"
    try:
        path.write_bytes(_get(vc["fixtures_url"], cfg["http_user_agent"], vc["fixtures_url"], attempts=2))
    except LeagueError as exc:
        if path.exists():
            path.unlink()
        return str(exc)[:300]
    return ""


def build(root: Path, cfg: dict, data: dict, leagues: dict | None, fetch_first: bool) -> dict:
    vc = cfg["home_value"]
    problem = fetch(root, cfg) if fetch_first else ""
    ha = home_advantage(root, data["season"])
    fixtures = _rows(root / "sources" / "value" / "fixtures.csv")
    rho, mg = float(cfg["prediction"]["dixon_coles_rho"]), int(cfg["prediction"]["max_goals"])
    out = {"updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
           "season": data["season"], "tracking_from": ha["tracking_from"], "rule": vc["rule"],
           "fixtures_problem": problem, "fixtures_rows": len(fixtures), "leagues": []}
    played, upcoming = pl_inputs(data)
    out["leagues"].append(league_rows("Premier League", played, upcoming, root / "sources" / "football-data-current" / "E0.csv",
                                      fixtures, "E0", ha["leagues"]["Premier League"], vc["rule"], rho, mg))
    # leagues.json lists the leagues in the order of understat_codes (plx.leagues.build_all).
    for code, lg in zip(cfg["leagues"]["understat_codes"], (leagues or {}).get("leagues", [])):
        div = cfg["leagues"]["football_data_divisions"].get(code)
        if not div or lg["label"] not in ha["leagues"]:
            continue
        p, u = league_inputs(lg)
        out["leagues"].append(league_rows(lg["label"], p, u, root / "sources" / "leagues" / f"fd_{div}.csv",
                                          fixtures, div, ha["leagues"][lg["label"]], vc["rule"], rho, mg))
    allrows = [r for L in out["leagues"] for r in L["history"]]
    out["season_summary"] = summary(allrows)
    out["live_summary"] = summary(allrows, ha["tracking_from"])
    for L in out["leagues"]:
        L["summary"] = summary(L["history"])
    return out


def write_page(root: Path, data: dict, site: Path) -> Path:
    web = root / "web"
    css = (web / "style.css").read_text(encoding="utf-8")
    js = (web / "value.js").read_text(encoding="utf-8")
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False).replace("</", "<\\/")
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Home value</title>
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
