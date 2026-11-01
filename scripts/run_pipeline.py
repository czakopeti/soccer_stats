#!/usr/bin/env python3
"""Fetch, build, and verify. Exits 0 only when every check passed."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from plx.build_site import write_site, write_status
from plx.config import load_config
from plx.fetch import fetch_all
from plx.leagues import build_all as build_leagues, write_page as write_odds_page
from plx.prepare import prepare
from plx.verify import verify


def _other_leagues(cfg: dict, data: dict, fetch_first: bool) -> None:
    """Fair odds for the other leagues. A failure here never blocks the Premier League page."""
    try:
        out = build_leagues(ROOT, cfg, data["season"], int(data["season_start_year"]), fetch_first=fetch_first)
        (ROOT / "data" / "leagues.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        write_odds_page(ROOT, out, ROOT / "site")
        print("Other leagues: " + ", ".join(f"{lg['label']} {lg['played']} played" for lg in out["leagues"]) + ".")
    except Exception as exc:  # noqa: BLE001 - reported, the PL build still stands
        print(f"Other leagues were not updated: {exc}")
        previous = ROOT / "data" / "leagues.json"
        if previous.exists():
            write_odds_page(ROOT, json.loads(previous.read_text(encoding="utf-8")), ROOT / "site")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build PL X-ray and keep the previous site if checks fail.")
    parser.add_argument("--skip-fetch", action="store_true", help="Use sources/ already on disk.")
    parser.add_argument("--skip-browser", action="store_true", help="Skip the headless browser check.")
    args = parser.parse_args()
    cfg = load_config()
    previous = None
    previous_path = ROOT / "data" / "pl.json"
    if previous_path.exists():
        previous = json.loads(previous_path.read_text(encoding="utf-8"))
    try:
        if not args.skip_fetch:
            print("Downloading sources…")
            fetch_all(ROOT, cfg)
        print("Preparing data…")
        data, meta = prepare(ROOT, cfg, previous)
        print(
            f"Season {data['season']}, gameweek {data['gw']}, "
            f"{len(data['matches'])} played matches, {len(data['euro'])} European fixtures."
        )
        # Write the page before verification so the browser can open it.
        # data/pl.json is replaced only after the checks pass.
        build_dir = ROOT / "build"
        build_dir.mkdir(exist_ok=True)
        (build_dir / "pl.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        (build_dir / "build_meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
        print("Building the page…")
        # The site writer reads web/ next to the project root, and writes site/.
        write_site(ROOT, data)
        print("Verifying…")
        report = verify(ROOT, data, meta, previous, browser=not args.skip_browser)
        write_status(ROOT / "site", report)
        (ROOT / "data").mkdir(exist_ok=True)
        (ROOT / "data" / "last_report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        if not report["ok"]:
            print("Verification failed. The previous published files were left untouched.")
            for check in report["checks"]:
                if not check["pass"]:
                    print(f"  FAIL {check['name']}: {check['detail']}")
            return 1
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
        snap = ROOT / "snapshots" / stamp
        snap.mkdir(parents=True, exist_ok=True)
        text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        (snap / "pl.json").write_text(text, encoding="utf-8")
        (snap / "build_meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
        (snap / "status.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        (ROOT / "data" / "pl.json").write_text(text, encoding="utf-8")
        (ROOT / "data" / "build_meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
        (ROOT / "data" / "status.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"Verification passed. Snapshot {snap.relative_to(ROOT)}.")
        _other_leagues(cfg, data, fetch_first=not args.skip_fetch)
        return 0
    except Exception as exc:  # noqa: BLE001 - the weekly job must say what broke, in plain language
        report = {
            "ok": False,
            "timestamp": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "season": None,
            "gameweek": None,
            "summary": f"The weekly build stopped before it could check the numbers. {exc}",
            "checks": [{"name": "Build", "pass": False, "detail": str(exc)}],
            "fixture_changes": [],
        }
        (ROOT / "data").mkdir(exist_ok=True)
        (ROOT / "data" / "last_report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print("Build stopped:", exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())
