"""Download every source the build is allowed to trust."""
from __future__ import annotations

import json
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

from plx.elo import season_code
from plx.europe import EuropeError, fetch_competitions
from plx.http_client import DownloadError, get_bytes, get_json


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _clone(repo: str, dest: Path) -> dict:
    if dest.exists():
        shutil.rmtree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "clone", "--depth", "1", repo, str(dest)], check=True)
    commit = subprocess.check_output(["git", "-C", str(dest), "rev-parse", "HEAD"], text=True).strip()
    committed = subprocess.check_output(["git", "-C", str(dest), "log", "-1", "--format=%cI"], text=True).strip()
    return {"commit": commit, "committed_at": committed, "fetched_at": _now(), "repo": repo}


def _fpl(cfg: dict, dest: Path, user_agent: str) -> dict:
    dest.mkdir(parents=True, exist_ok=True)
    boot = get_json(cfg["sources"]["fpl_bootstrap"], user_agent)
    (dest / "bootstrap.json").write_text(json.dumps(boot), encoding="utf-8")
    events = boot["events"]
    base = cfg["sources"]["fpl_fixtures"]

    def one(event_id: int):
        url = f"{base}?event={event_id}"
        return event_id, get_json(url, user_agent)

    fixtures = []
    errors = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(one, ev["id"]) for ev in events]
        for fut in as_completed(futures):
            try:
                event_id, rows = fut.result()
            except Exception as exc:  # noqa: BLE001
                errors.append(str(exc))
                continue
            if not isinstance(rows, list):
                errors.append(f"Gameweek {event_id} did not return a fixture list.")
                continue
            fixtures.extend(rows)
    if errors:
        raise DownloadError(
            "The Premier League fixture list could not be downloaded in full. "
            + " ".join(errors[:4])
        )
    fixtures.sort(key=lambda r: (r.get("event") or 0, r.get("kickoff_time") or "", r.get("id") or 0))
    (dest / "fixtures.json").write_text(json.dumps(fixtures), encoding="utf-8")
    return {
        "fetched_at": _now(),
        "events": len(events),
        "fixtures": len(fixtures),
        "bootstrap_bytes": (dest / "bootstrap.json").stat().st_size,
    }


def _history(cfg: dict, dest: Path, user_agent: str, start_year: int) -> dict:
    dest.mkdir(parents=True, exist_ok=True)
    n = int(cfg["elo"]["history_seasons"])
    codes = [season_code(start_year - i) for i in range(1, n + 1)]
    divisions = cfg["sources"]["football_data_divisions"]
    template = cfg["sources"]["football_data_template"]
    saved = []
    for code in codes:
        for div in divisions:
            url = template.format(code=code, division=div)
            try:
                raw = get_bytes(url, user_agent)
            except DownloadError as exc:
                raise DownloadError(
                    f"Historical {div} results for season code {code} could not be downloaded ({url}). {exc}"
                ) from exc
            path = dest / f"{div}_{code}.csv"
            path.write_bytes(raw)
            saved.append(path.name)
    return {"fetched_at": _now(), "files": saved, "season_codes": codes}


def _europe(cfg: dict, dest: Path, user_agent: str, start_year: int) -> dict:
    dest.mkdir(parents=True, exist_ok=True)
    try:
        events, aliases, errors = fetch_competitions(start_year, cfg, user_agent)
    except TypeError:
        # fetch_competitions returns three values; a failure inside raises EuropeError.
        raise
    except EuropeError:
        raise
    if errors:
        raise EuropeError(
            "European fixtures were only partly downloaded, so none were used. "
            + "; ".join(errors[:5])
        )
    (dest / "events.json").write_text(json.dumps(events), encoding="utf-8")
    (dest / "aliases.json").write_text(json.dumps(aliases), encoding="utf-8")
    return {"fetched_at": _now(), "events": len(events), "espn_clubs": len(aliases)}


def season_start_year_from_bootstrap(bootstrap: dict) -> int:
    """First gameweek deadline, in UTC. July–December starts that year; January–June the previous one."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    first = min(bootstrap["events"], key=lambda e: e["id"])
    deadline = first.get("deadline_time")
    if not deadline:
        raise DownloadError("The Premier League feed has no gameweek deadlines, so the season cannot be identified.")
    dt = datetime.fromisoformat(deadline.replace("Z", "+00:00")).astimezone(ZoneInfo("UTC"))
    return dt.year if dt.month >= 7 else dt.year - 1


def fetch_all(root: Path, cfg: dict) -> dict:
    """Download catalogue, FPL, historical results and European fixtures into sources/."""
    user_agent = cfg["http_user_agent"]
    sources = root / "sources"
    sources.mkdir(parents=True, exist_ok=True)
    catalogue = _clone(cfg["sources"]["catalogue_repo"], sources / "pl-catalogue")
    fpl = _fpl(cfg, sources / "fpl", user_agent)
    bootstrap = json.loads((sources / "fpl" / "bootstrap.json").read_text(encoding="utf-8"))
    start_year = season_start_year_from_bootstrap(bootstrap)
    history = _history(cfg, sources / "football-data", user_agent, start_year)
    europe = _europe(cfg, sources / "europe", user_agent, start_year)
    manifest = {
        "fetched_at": _now(),
        "season_start_year": start_year,
        "catalogue": catalogue,
        "fpl": fpl,
        "history": history,
        "europe": europe,
    }
    (sources / "fetch_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest
