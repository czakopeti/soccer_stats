#!/usr/bin/env python3
"""Open or update one GitHub issue when the weekly build fails. Plain language, no stack traces."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TITLE = "[PL X-ray] Weekly update did not publish"


def _api(method: str, url: str, token: str, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "pl-xray",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def _body(report: dict) -> str:
    lines = [
        "The automatic Wednesday update did not publish a new version of the site.",
        "The previous version is still the one visitors see.",
        "",
        report.get("summary") or "The build failed.",
        "",
        "What failed:",
    ]
    for check in report.get("checks") or []:
        if check.get("pass"):
            continue
        lines.append(f"- {check.get('name')}: {check.get('detail')}")
    if not any(not c.get("pass") for c in report.get("checks") or []):
        lines.append("- The build stopped before the checks could finish. See the Actions log.")
    lines += [
        "",
        "You do not need to change the site by hand. The next successful run will publish on its own.",
        "If this issue is still open next week, the same problem is still blocking the update.",
    ]
    return "\n".join(lines)


def main() -> int:
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    repo = os.environ.get("GITHUB_REPOSITORY")
    if not token or not repo:
        print("No GitHub token or repository; skipping the issue.")
        return 0
    report_path = ROOT / "data" / "last_report.json"
    report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else {
        "summary": "The workflow failed and did not leave a report.",
        "checks": [],
    }
    body = _body(report)
    listed = _api("GET", f"https://api.github.com/repos/{repo}/issues?state=open&per_page=50", token)
    existing = next((item for item in listed if item.get("title") == TITLE), None)
    if existing:
        _api("POST", f"https://api.github.com/repos/{repo}/issues/{existing['number']}/comments", token, {"body": body})
        print(f"Updated issue #{existing['number']}")
    else:
        created = _api("POST", f"https://api.github.com/repos/{repo}/issues", token, {"title": TITLE, "body": body})
        print(f"Opened issue #{created['number']}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except urllib.error.HTTPError as exc:
        print(exc.read().decode()[:500])
        sys.exit(1)
