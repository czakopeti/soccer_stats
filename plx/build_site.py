"""Write the standalone page and a plain-language status page."""
from __future__ import annotations

import json
from pathlib import Path


def write_site(root: Path, data: dict, report: dict | None = None, out_dir: Path | None = None) -> Path:
    web = root / "web"
    css = (web / "style.css").read_text(encoding="utf-8")
    js = (web / "pl_xray.js").read_text(encoding="utf-8")
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False).replace("</", "<\\/")
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>PL X-ray</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@600;800;900&family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap">
<style>{css}</style></head>
<body><div class="wrap" id="app"></div>
<script id="data" type="application/json">{payload}</script>
<script>{js}</script></body></html>"""
    site = out_dir or (root / "site")
    site.mkdir(parents=True, exist_ok=True)
    path = site / "index.html"
    path.write_text(html, encoding="utf-8")
    if report is not None:
        write_status(site, report)
    return path


def write_status(site: Path, report: dict) -> None:
    (site / "status.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    rows = []
    for check in report.get("checks", []):
        mark = "Pass" if check.get("pass") else "Fail"
        rows.append(
            f"<tr><td>{mark}</td><td>{_esc(check.get('name'))}</td><td>{_esc(check.get('detail'))}</td></tr>"
        )
    changes = report.get("fixture_changes") or []
    change_html = "".join(
        f"<li>{_esc(c.get('kind'))}: {_esc(c.get('home'))} vs {_esc(c.get('away'))}"
        + (f" ({_esc(c.get('was'))} → {_esc(c.get('now'))})" if c.get("was") or c.get("now") else "")
        + "</li>"
        for c in changes
    ) or "<li>No fixture dates changed since the previous build.</li>"
    overall = "Everything checked out." if report.get("ok") else "This build was not published."
    note = report.get("summary") or ""
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>PL X-ray status</title>
<style>
body {{ margin: 0; background: #0a0d18; color: #edf0fa; font: 16px/1.5 "Segoe UI", sans-serif; }}
main {{ max-width: 860px; margin: 0 auto; padding: 32px 18px 64px; }}
h1 {{ font-size: 40px; margin: 0 0 8px; }}
.ok {{ color: #57d99a; }} .bad {{ color: #ff6b7a; }}
table {{ width: 100%; border-collapse: collapse; margin-top: 18px; }}
td {{ border-top: 1px solid #252b45; padding: 8px 6px; vertical-align: top; }}
td:first-child {{ width: 64px; font-weight: 700; }}
a {{ color: #ffd25a; }}
</style></head>
<body><main>
<p>PL X-ray · automatic weekly check</p>
<h1 class="{"ok" if report.get("ok") else "bad"}">{_esc(overall)}</h1>
<p>{_esc(note)}</p>
<p>Season {_esc(report.get("season"))} · gameweek {_esc(report.get("gameweek"))} · built {_esc(report.get("timestamp"))}.</p>
<p><a href="./">Open the site</a> · <a href="./status.json">status.json</a></p>
<h2>Fixture changes</h2>
<ul>{change_html}</ul>
<h2>Checks</h2>
<table>{''.join(rows)}</table>
</main></body></html>"""
    (site / "status.html").write_text(html, encoding="utf-8")


def _esc(value) -> str:
    return (
        str("" if value is None else value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
