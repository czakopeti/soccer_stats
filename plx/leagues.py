"""Fair odds for the other big leagues, from match xG only.

Same strength model as the Premier League forecast (plx/strength.py mirrors
web/pl_xray.js). Each round is predicted only from the rounds before it.
Measured facts (matches, xG, kickoffs) are downloaded on every run. The
pre-season strength and goal level come from a season file in config/.
"""
from __future__ import annotations

import gzip
import json
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from plx.strength import predict, ratings


class LeagueError(RuntimeError):
    pass


def _get(url: str, user_agent: str, referer: str, attempts: int = 4) -> bytes:
    last = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": user_agent,
                "X-Requested-With": "XMLHttpRequest",
                "Referer": referer,
                "Accept-Encoding": "gzip",
            })
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read()
            return gzip.decompress(body) if body[:2] == b"\x1f\x8b" else body
        except Exception as exc:  # noqa: BLE001 - retried, then reported
            last = exc
            time.sleep(2 * (i + 1))
    raise LeagueError(f"Could not download {url}: {last}")


def fetch(root: Path, cfg: dict, start_year: int) -> None:
    lc = cfg["leagues"]
    dest = root / "sources" / "leagues"
    dest.mkdir(parents=True, exist_ok=True)
    for code in lc["understat_codes"]:
        url = lc["understat_data_template"].format(league=code, year=start_year)
        ref = lc["understat_page_template"].format(league=code, year=start_year)
        body = _get(url, cfg["http_user_agent"], ref)
        data = json.loads(body)
        if "dates" not in data:
            raise LeagueError(f"{code}: the download has no match list.")
        (dest / f"{code}.json").write_text(json.dumps(data["dates"], ensure_ascii=False), encoding="utf-8")


def _assign_rounds(rows: list[dict], gap_days: float) -> None:
    """Group matches into rounds in order of kickoff.

    Understat has no matchday. A round closes when a club would play in it a
    second time, or when no match kicks off for more than `gap_days`. Every
    match is predicted only from rounds that closed before its own.
    """
    from datetime import datetime as _dt

    rnd, seen, prev = 0, set(), None
    for m in sorted(rows, key=lambda r: (r["dt"], r["h"])):
        t = _dt.fromisoformat(m["dt"])
        gap = (t - prev).total_seconds() / 86400 if prev is not None else 0
        if rnd == 0 or m["h"] in seen or m["a"] in seen or gap > gap_days:
            rnd += 1
            seen = set()
        seen.update((m["h"], m["a"]))
        m["gw"] = rnd
        prev = max(prev, t) if prev is not None else t


def build_league(dates: list[dict], season_file: dict, cfg: dict) -> dict:
    rows = []
    for d in dates:
        row = {"h": d["h"]["title"], "a": d["a"]["title"], "dt": d["datetime"], "played": bool(d["isResult"])}
        if row["played"]:
            row.update(hs=int(d["goals"]["h"]), **{"as": int(d["goals"]["a"])}, xh=float(d["xG"]["h"]), xa=float(d["xG"]["a"]))
        rows.append(row)
    teams = sorted({r["h"] for r in rows} | {r["a"] for r in rows})
    prior = season_file["prior"]
    missing = [t for t in teams if t not in prior]
    if missing:
        raise LeagueError("No pre-season strength for: " + ", ".join(missing))
    # An unplayed match dated before the latest result was postponed and has no new date yet.
    # It is left out until it is rescheduled.
    last = max((r["dt"] for r in rows if r["played"]), default="")
    postponed = [r for r in rows if not r["played"] and r["dt"] <= last]
    rows = [r for r in rows if r["played"] or r["dt"] > last]
    _assign_rounds(rows, float(cfg["leagues"]["round_gap_days"]))
    played = [r for r in rows if r["played"]]
    rtg, pred = cfg["ratings"], cfg["prediction"]
    gl = float(season_file["goal_level"])
    cache: dict[int, dict] = {}
    out_rounds: dict[int, list] = {}
    for r in sorted(rows, key=lambda r: (r["gw"], r["dt"])):
        up = r["gw"] - 1
        if up not in cache:
            cache[up] = ratings(played, teams, prior, up, rtg, gl)
        p = predict(r["h"], r["a"], cache[up], pred["dixon_coles_rho"], pred["max_goals"])
        item = {"h": r["h"], "a": r["a"], "dt": r["dt"], "lh": round(p["lh"], 4), "la": round(p["la"], 4),
                "pw": round(p["pw"], 5), "pd": round(p["pd"], 5), "pl": round(p["pl"], 5), "o25": round(p["o25"], 4)}
        if r["played"]:
            item.update(hs=r["hs"], **{"as": r["as"]})
        out_rounds.setdefault(r["gw"], []).append(item)
    open_rounds = [g for g, ms in out_rounds.items() if any("hs" not in m for m in ms)]
    return {
        "code": season_file["code"],
        "label": season_file["label"],
        "teams": len(teams),
        "played": len(played),
        "next_round": min(open_rounds) if open_rounds else None,
        "postponed": [{"h": r["h"], "a": r["a"], "dt": r["dt"]} for r in postponed],
        "rounds": [{"r": g, "matches": out_rounds[g]} for g in sorted(out_rounds)],
    }


def check(league: dict) -> list[str]:
    problems = []
    if league["teams"] not in (18, 20):
        problems.append(f"{league['label']}: {league['teams']} clubs, expected 18 or 20.")
    if league["played"] == 0:
        problems.append(f"{league['label']}: no played matches.")
    for rd in league["rounds"]:
        for m in rd["matches"]:
            s = m["pw"] + m["pd"] + m["pl"]
            if abs(s - 1) > 1e-3 or min(m["pw"], m["pd"], m["pl"]) <= 0:
                problems.append(f"{league['label']} {m['h']}–{m['a']}: chances do not add up.")
    return problems


def build_all(root: Path, cfg: dict, season_label: str, start_year: int, fetch_first: bool = True) -> dict:
    path = root / "config" / f"preseason_prior_leagues_{season_label.replace('/', '-')}.json"
    if not path.is_file():
        raise LeagueError(f"{path.name} is missing, so the other leagues were not built.")
    season = json.loads(path.read_text(encoding="utf-8"))["leagues"]
    if fetch_first:
        fetch(root, cfg, start_year)
    out = {"season": season_label, "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
           "model": {k: cfg["ratings"][k] for k in ("tau_rounds", "prior_matches", "xg_blend", "home_advantage")} | {"dixon_coles_rho": cfg["prediction"]["dixon_coles_rho"]},
           "leagues": []}
    problems = []
    for code in cfg["leagues"]["understat_codes"]:
        dates = json.loads((root / "sources" / "leagues" / f"{code}.json").read_text(encoding="utf-8"))
        lg = build_league(dates, season[code], cfg)
        problems += check(lg)
        out["leagues"].append(lg)
    if problems:
        raise LeagueError(" ".join(problems))
    return out


def write_page(root: Path, data: dict, site: Path) -> Path:
    web = root / "web"
    css = (web / "style.css").read_text(encoding="utf-8")
    js = (web / "odds.js").read_text(encoding="utf-8")
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False).replace("</", "<\\/")
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Fair odds: other leagues</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@600;800;900&family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap">
<style>{css}</style></head>
<body><div class="wrap" id="app"></div>
<script id="data" type="application/json">{payload}</script>
<script>{js}</script></body></html>"""
    site.mkdir(parents=True, exist_ok=True)
    path = site / "odds.html"
    path.write_text(html, encoding="utf-8")
    return path
