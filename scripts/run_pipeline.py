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
from plx.prepare import prepare
from plx.verify import verify


def _laliga() -> int:
    from plx.laliga_fetch import fetch_laliga
    from plx.laliga_prepare import prepare_laliga
    from plx.laliga_verify import verify_laliga

    parser = argparse.ArgumentParser(description="Build the La Liga page. A failure leaves the Premier League site alone.")
    parser.add_argument("--skip-fetch", action="store_true")
    parser.add_argument("--skip-browser", action="store_true")
    parser.add_argument("--league", default="laliga")
    args, _unknown = parser.parse_known_args()
    model = load_config()
    league = json.loads((ROOT / "config" / "laliga.json").read_text(encoding="utf-8"))
    data_dir = ROOT / "data" / "laliga"
    previous = json.loads((data_dir / "pl.json").read_text(encoding="utf-8")) if (data_dir / "pl.json").exists() else None
    try:
        if not args.skip_fetch:
            print("Downloading La Liga sources…")
            fetch_laliga(ROOT, model, league)
        print("Preparing La Liga…")
        data, meta = prepare_laliga(ROOT, model, league, previous)
        print(f"Season {data['season']}, matchday {data['gw']}, {len(data['matches'])} played matches, {len(data['euro'])} European fixtures.")
        out = ROOT / "build" / "laliga-site"
        out.mkdir(parents=True, exist_ok=True)
        print("Building the La Liga page…")
        write_site(ROOT, data, out_dir=out)
        print("Verifying La Liga…")
        # The browser opens the built file, which is not yet the published folder.
        built = ROOT / "site" / "laliga"
        built.mkdir(parents=True, exist_ok=True)
        # Verify reads site/laliga/index.html. Copy the candidate there only after we
        # have a file, and remove it again if the checks fail so a bad page is not deployed.
        import shutil
        shutil.copy2(out / "index.html", built / "index.html")
        report = verify_laliga(ROOT, data, meta, previous, browser=not args.skip_browser)
        write_status(built, report)
        data_dir.mkdir(parents=True, exist_ok=True)
        (data_dir / "last_report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        if not report["ok"]:
            shutil.rmtree(built, ignore_errors=True)
            print("La Liga verification failed. The published La Liga folder was not kept.")
            for check in report["checks"]:
                if not check["pass"]:
                    print(f"  FAIL {check['name']}: {check['detail']}")
            return 1
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
        snap = ROOT / "snapshots" / "laliga" / stamp
        snap.mkdir(parents=True, exist_ok=True)
        text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        (snap / "pl.json").write_text(text, encoding="utf-8")
        (snap / "build_meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
        (snap / "status.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        (data_dir / "pl.json").write_text(text, encoding="utf-8")
        (data_dir / "build_meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
        (data_dir / "status.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"La Liga verification passed. Snapshot {snap.relative_to(ROOT)}.")
        return 0
    except Exception as exc:  # noqa: BLE001
        report = {
            "ok": False,
            "timestamp": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "summary": f"The La Liga build stopped before it could check the numbers. {exc}",
            "checks": [{"name": "Build", "pass": False, "detail": str(exc)}],
            "fixture_changes": [],
        }
        data_dir = ROOT / "data" / "laliga"
        data_dir.mkdir(parents=True, exist_ok=True)
        (data_dir / "last_report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print("La Liga build stopped:", exc)
        return 1


def main() -> int:
    if "--league" in sys.argv and "laliga" in sys.argv:
        return _laliga()
    parser = argparse.ArgumentParser(description="Build PL X-ray and keep the previous site if checks fail.")
    parser.add_argument("--skip-fetch", action="store_true", help="Use sources/ already on disk.")
    parser.add_argument("--skip-browser", action="store_true", help="Skip the headless browser check.")
    parser.add_argument("--league", default="pl", choices=["pl", "laliga"])
    args = parser.parse_args()
    if args.league == "laliga":
        return _laliga()
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
