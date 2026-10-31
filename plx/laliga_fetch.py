"""Download La Liga shots, results and European dates. No key, no prices."""
from __future__ import annotations

import gzip
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

from plx.laliga_calendar import parse_matchday_file

from plx.elo import season_code
from plx.europe import EuropeError, fetch_competitions
from plx.http_client import DownloadError, get_bytes, get_json


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _understat(url: str, referer: str, user_agent: str) -> dict | list:
    raw = get_bytes(
        url,
        user_agent,
        extra_headers={"X-Requested-With": "XMLHttpRequest", "Referer": referer, "Accept": "application/json"},
    )
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return json.loads(raw.decode("utf-8"))


def _season_year_from_league(payload: dict) -> int:
    dates = [row.get("datetime") or "" for row in payload.get("dates") or []]
    dates = [d for d in dates if len(d) >= 7]
    if not dates:
        raise DownloadError("The shot feed returned no fixtures, so the season cannot be identified.")
    first = min(dates)
    year = int(first[:4])
    month = int(first[5:7])
    return year if month >= 7 else year - 1


def _espn_fixtures(days: list[str], template: str, user_agent: str) -> list[dict]:
    found: dict[str, dict] = {}

    def one(day: str) -> list[dict]:
        payload = get_json(template.format(day=day), user_agent)
        rows = []
        for event in payload.get("events") or []:
            comp = (event.get("competitions") or [{}])[0]
            sides = {}
            for club in comp.get("competitors") or []:
                score = club.get("score")
                sides[club.get("homeAway")] = {
                    "name": (club.get("team") or {}).get("displayName") or "",
                    "score": None if score in (None, "") else int(score),
                }
            if "home" not in sides or "away" not in sides:
                continue
            status = ((comp.get("status") or {}).get("type") or {})
            rows.append(
                {
                    "id": str(event.get("id") or ""),
                    "date": event.get("date") or comp.get("date"),
                    "status": status.get("name") or "",
                    "completed": bool(status.get("completed")),
                    "home": sides["home"]["name"],
                    "away": sides["away"]["name"],
                    "hs": sides["home"]["score"],
                    "as": sides["away"]["score"],
                }
            )
        return rows

    failures = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(one, day): day for day in days}
        for fut in as_completed(futures):
            try:
                for row in fut.result():
                    found.setdefault(row["id"], row)
            except Exception as exc:  # noqa: BLE001
                failures.append(f"{futures[fut]}: {exc}")
    if failures:
        raise DownloadError(
            f"ESPN did not return {len(failures)} La Liga dates. The build stopped rather than guess the jornada. "
            + " ".join(failures[:3])
        )
    return list(found.values())


def fetch_laliga(root: Path, model: dict, league: dict) -> dict:
    ua = model["http_user_agent"]
    dest = root / "sources" / "laliga"
    if dest.exists():
        # Keep nothing stale from a half-finished run.
        pass
    dest.mkdir(parents=True, exist_ok=True)
    # The season in the URL is the start year. Try the year implied by "now", then the previous one,
    # and keep the file that actually contains fixtures. The year is not stored as a constant.
    now = datetime.now(timezone.utc)
    guess = now.year if now.month >= 7 else now.year - 1
    payload = None
    used = None
    errors = []
    for year in (guess, guess - 1):
        referer = league["understat_referer"].format(league=league["understat_league"], season=year)
        url = league["understat_league_url"].format(league=league["understat_league"], season=year)
        try:
            candidate = _understat(url, referer, ua)
        except DownloadError as exc:
            errors.append(str(exc))
            continue
        if isinstance(candidate, dict) and candidate.get("dates"):
            payload = candidate
            used = year
            break
    if payload is None or used is None:
        raise DownloadError("La Liga shot feed could not be downloaded. " + " ".join(errors[:3]))
    start_year = _season_year_from_league(payload)
    (dest / "league.json").write_text(json.dumps(payload), encoding="utf-8")

    finished_ids = [str(row["id"]) for row in payload["dates"] if row.get("isResult")]
    match_dir = dest / "matches"
    match_dir.mkdir(exist_ok=True)
    referer = league["understat_referer"].format(league=league["understat_league"], season=used)

    def one(match_id: str):
        url = league["understat_match_url"].format(match_id=match_id)
        body = _understat(url, referer, ua)
        (match_dir / f"{match_id}.json").write_text(json.dumps(body), encoding="utf-8")
        return match_id

    failures = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(one, mid) for mid in finished_ids]
        for fut in as_completed(futures):
            try:
                fut.result()
            except Exception as exc:  # noqa: BLE001
                failures.append(str(exc))
    if failures:
        raise DownloadError(
            f"{len(failures)} finished matches had no shot file. The build stopped rather than skip them. "
            + " ".join(failures[:3])
        )

    hist = dest / "history"
    hist.mkdir(exist_ok=True)
    n = int(model["elo"]["history_seasons"])
    codes = [season_code(start_year - i) for i in range(1, n + 1)]
    template = model["sources"]["football_data_template"]
    saved = []
    for code in codes:
        for div in league["history_divisions"]:
            url = template.format(code=code, division=div)
            try:
                raw = get_bytes(url, ua)
            except DownloadError as exc:
                raise DownloadError(f"Historical {div} file {code} could not be downloaded. {exc}") from exc
            path = hist / f"{div}_{code}.csv"
            path.write_bytes(raw)
            saved.append(path.name)
    current_code = season_code(start_year)
    current_url = template.format(code=current_code, division=league["current_results_division"])
    current_raw = get_bytes(current_url, ua)
    (dest / "current_results.csv").write_bytes(current_raw)

    end = str(start_year + 1)[-2:]
    calendar_url = league["openfootball_calendar"].format(start=start_year, end=end)
    try:
        calendar_raw = get_bytes(calendar_url, ua)
    except DownloadError as exc:
        raise DownloadError(f"The La Liga matchday file could not be downloaded. {exc}") from exc
    calendar_text = calendar_raw.decode("utf-8")
    (dest / "matchdays.txt").write_text(calendar_text, encoding="utf-8")
    calendar_rows = parse_matchday_file(calendar_text)
    days = {row["day"].replace("-", "") for row in calendar_rows}

    board = get_json(league["espn_scoreboard"].format(day=min(days)), ua)
    league_block = ((board.get("leagues") or [{}])[0]) if isinstance(board, dict) else {}
    for stamp in league_block.get("calendar") or []:
        if isinstance(stamp, str) and len(stamp) >= 10:
            days.add(stamp[:10].replace("-", ""))
    espn_rows = _espn_fixtures(sorted(days), league["espn_scoreboard"], ua)
    (dest / "espn_fixtures.json").write_text(json.dumps(espn_rows), encoding="utf-8")

    europe_cfg = json.loads(json.dumps(model))
    europe_cfg["sources"]["espn_teams"] = league["espn_teams"]
    try:
        events, aliases, errors = fetch_competitions(start_year, europe_cfg, ua)
    except EuropeError:
        raise
    if errors:
        raise EuropeError("European fixtures were only partly downloaded, so none were used. " + "; ".join(errors[:5]))
    (dest / "europe_events.json").write_text(json.dumps(events), encoding="utf-8")
    (dest / "europe_aliases.json").write_text(json.dumps(aliases), encoding="utf-8")
    manifest = {
        "fetched_at": _now(),
        "season_start_year": start_year,
        "understat_season": used,
        "fixtures": len(payload["dates"]),
        "finished": len(finished_ids),
        "history": {"files": saved, "season_codes": codes, "fetched_at": _now()},
        "europe": {"events": len(events), "fetched_at": _now()},
        "matchdays": len(calendar_rows),
        "espn_fixtures": len(espn_rows),
        "current_results_bytes": (dest / "current_results.csv").stat().st_size,
    }
    (dest / "fetch_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest
