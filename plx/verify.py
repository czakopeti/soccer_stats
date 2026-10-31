"""Fail-closed checks. A failed check keeps the previous site online."""
from __future__ import annotations

import json
import re
import shutil
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from plx.config import load_config
from plx.language import find_hits, scan_user_facing
from plx.round_status import RoundNote, describe_round, summary_problems


def _check(checks: list, name: str, ok: bool, detail: str) -> None:
    checks.append({"name": name, "pass": bool(ok), "detail": detail})


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    text = value.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _shot_goals(shots_for_match: list, home: str) -> tuple[int, int]:
    hs = as_ = 0
    for s in shots_for_match:
        res = s[10]
        team = s[2]
        if res == "G":
            if team == home:
                hs += 1
            else:
                as_ += 1
        elif res == "O":
            if team == home:
                as_ += 1
            else:
                hs += 1
    return hs, as_


def _round_note(root: Path, data: dict, meta: dict) -> RoundNote:
    tz_name = ((data.get("cfg") or {}).get("display_timezone")) or "UTC"
    gap_days = 12
    try:
        gap_days = int(load_config(root / "config" / "model.json")["verify"]["quiet_gap_days"])
    except (OSError, KeyError, TypeError, ValueError):
        gap_days = 12
    try:
        raw = json.loads((root / "sources" / "fpl" / "fixtures.json").read_text(encoding="utf-8"))
        boot = json.loads((root / "sources" / "fpl" / "bootstrap.json").read_text(encoding="utf-8"))
        names = {int(team["id"]): team["name"] for team in boot.get("teams") or []}
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError):
        return RoundNote(
            "unknown",
            "The Premier League fixture file could not be read, so this run cannot say whether a round is under way.",
            None,
            False,
        )
    rows = []
    for fixture in raw:
        try:
            home = names.get(int(fixture["team_h"]), "Home")
            away = names.get(int(fixture["team_a"]), "Away")
        except (KeyError, TypeError, ValueError):
            continue
        rows.append(
            {
                "event": fixture.get("event"),
                "kickoff": fixture.get("kickoff_time"),
                "finished": bool(fixture.get("finished")),
                "started": bool(fixture.get("started")),
                "home": home,
                "away": away,
            }
        )
    return describe_round(
        rows,
        int(data["gw"]),
        datetime.now(timezone.utc),
        tz_name,
        meta.get("fixture_changes") or [],
        gap_days,
    )


def verify(root: Path, data: dict, meta: dict, previous: dict | None, browser: bool = True) -> dict:
    checks: list[dict] = []
    if "cfg" not in data or "derived" not in data:
        raise RuntimeError("The page data has no model config or measured priors.")
    teams = list(data["short"])
    n_teams = len(teams)
    rounds = int(data["rounds"])
    expected_each = 2 * (n_teams - 1)
    expected_fx = n_teams * (n_teams - 1)

    _check(
        checks,
        "League shape",
        n_teams >= 2 and rounds == expected_each and len(data["fx"]) == expected_fx,
        f"{n_teams} clubs, {rounds} gameweeks, {len(data['fx'])} fixtures. "
        f"A home-and-away league should have {expected_each} gameweeks and {expected_fx} fixtures.",
    )
    per = Counter()
    pairs = Counter()
    for row in data["fx"]:
        per[row[1]] += 1
        per[row[2]] += 1
        pairs[(row[1], row[2])] += 1
    bad_n = [t for t in teams if per[t] != expected_each]
    bad_pairs = [p for p, n in pairs.items() if n != 1]
    _check(
        checks,
        "Every club plays every other club home and away",
        not bad_n and not bad_pairs and set(per) == set(teams),
        "Fixture counts are uneven." if bad_n or bad_pairs else f"Each club has {expected_each} fixtures, one home and one away against each opponent.",
    )

    # Finished matches carry a score, xG and shots.
    missing_bits = []
    for m in data["matches"]:
        if m.get("hs") is None or m.get("as") is None or m.get("xh") is None or m.get("xa") is None:
            missing_bits.append(f"{m.get('h')} vs {m.get('a')}: missing score or xG")
        if not m.get("shots"):
            missing_bits.append(f"{m.get('h')} vs {m.get('a')}: no shots")
    _check(
        checks,
        "Finished matches have a score, xG and shots",
        not missing_bits and not meta.get("finished_missing_shots"),
        "All finished matches in this file have a score, xG and at least one shot."
        if not missing_bits and not meta.get("finished_missing_shots")
        else "; ".join((missing_bits + [str(x) for x in meta.get("finished_missing_shots", [])])[:8]),
    )

    by_fid = defaultdict(list)
    for s in data["shots"]:
        by_fid[s[1]].append(s)
    xg_bad = []
    goal_bad = []
    tol = 0.05
    verify_cfg_path = root / "config" / "model.json"
    if verify_cfg_path.exists():
        tol = float(json.loads(verify_cfg_path.read_text(encoding="utf-8"))["verify"]["xg_sum_tolerance"])
    for m in data["matches"]:
        shots = by_fid.get(m["id"], [])
        hx = sum(s[9] for s in shots if s[2] == m["h"] and s[10] != "O")
        ax = sum(s[9] for s in shots if s[2] == m["a"] and s[10] != "O")
        if abs(hx - m["xh"]) > tol or abs(ax - m["xa"]) > tol:
            xg_bad.append(f"{m['h']} {m['hs']}-{m['as']} {m['a']}: shots {hx:.2f}-{ax:.2f} vs match {m['xh']}-{m['xa']}")
        gh, ga = _shot_goals(shots, m["h"])
        if (gh, ga) != (m["hs"], m["as"]):
            goal_bad.append(f"{m['h']} {m['hs']}-{m['as']} {m['a']}: shots imply {gh}-{ga}")
    _check(
        checks,
        "Shot xG adds up to the match xG",
        not xg_bad,
        f"Within {tol} on every match." if not xg_bad else "; ".join(xg_bad[:6]),
    )
    _check(
        checks,
        "Goals from shots and own goals match the score",
        not goal_bad,
        "Every score matches the shot list." if not goal_bad else "; ".join(goal_bad[:6]),
    )

    unknown_teams = []
    for m in data["matches"]:
        if m["h"] not in data["short"] or m["a"] not in data["short"]:
            unknown_teams.append(f"{m['h']} / {m['a']}")
    for s in data["shots"]:
        if s[2] not in data["short"] or s[3] not in data["short"]:
            unknown_teams.append(f"shot {s[4]} {s[2]}")
            break
    for p in data["players"]:
        if p["t"] not in data["short"]:
            unknown_teams.append(p["n"])
            break
    prior_missing = [t for t in teams if t not in data.get("prior", {})]
    _check(
        checks,
        "No unmapped club",
        not unknown_teams and not prior_missing,
        "Every club in the matches is on the season list and has a pre-season strength."
        if not unknown_teams and not prior_missing
        else f"Unmapped: {unknown_teams[:5]} missing strength: {prior_missing}",
    )

    share = (meta.get("unmapped_shots") or 0) / max(1, len(data["shots"]))
    max_share = 0.02
    if verify_cfg_path.exists():
        max_share = float(json.loads(verify_cfg_path.read_text(encoding="utf-8"))["verify"]["max_unmapped_shot_share"])
    _check(
        checks,
        "Shots link to a player",
        share <= max_share,
        f"{meta.get('unmapped_shots', 0)} of {len(data['shots'])} shots have no player id ({share:.1%}). Limit {max_share:.0%}.",
    )

    def blank(value) -> bool:
        return value is None or (isinstance(value, float) and value != value)

    nulls = []
    for m in data["matches"]:
        for key in ("id", "gw", "date", "h", "a", "hs", "as", "xh", "xa", "sh", "sa", "pw", "pd", "pl"):
            if blank(m.get(key)):
                nulls.append(f"match {m.get('id')} {key}")
                break
    for p in data["players"]:
        for key in ("id", "n", "t", "pos", "min", "g", "a", "xg", "xa"):
            if blank(p.get(key)):
                nulls.append(f"player {p.get('id')} {key}")
                break
    _check(
        checks,
        "No empty values in the required fields",
        not nulls,
        "Scores, xG, names, minutes and goals are filled in." if not nulls else "; ".join(nulls[:8]),
    )

    # Monotonic player totals.
    if not previous:
        _check(checks, "Player totals did not shrink", True, "First build: there is no earlier week to compare.")
        _check(checks, "Gameweek did not go backwards", True, "First build.")
    else:
        old_players = {p["id"]: p for p in previous.get("players", [])}
        shrunk = []
        for p in data["players"]:
            old = old_players.get(p["id"])
            if not old:
                continue
            if p["min"] < old["min"] or p["g"] < old["g"]:
                shrunk.append(f"{p['n']}: minutes {old['min']}→{p['min']}, goals {old['g']}→{p['g']}")
        _check(
            checks,
            "Player totals did not shrink",
            not shrunk,
            "Minutes and goals are the same or higher for every player who was already listed."
            if not shrunk
            else "; ".join(shrunk[:8]),
        )
        _check(
            checks,
            "Gameweek did not go backwards",
            int(data["gw"]) >= int(previous.get("gw") or 0),
            f"Was gameweek {previous.get('gw')}, now {data['gw']}.",
        )

    note = _round_note(root, data, meta)

    # Sources actually refreshed, or an explanation.
    fetch = meta.get("fetch") or {}
    fetched_at = _parse_time(fetch.get("fetched_at"))
    fresh = fetched_at is not None and (datetime.now(timezone.utc) - fetched_at).total_seconds() < 36 * 3600
    prev_meta_path = root / "data" / "build_meta.json"
    prev_meta = json.loads(prev_meta_path.read_text(encoding="utf-8")) if prev_meta_path.exists() and previous else None
    source_detail = []
    source_ok = fresh
    if not fresh:
        source_detail.append("The download record is missing or older than 36 hours, so this run did not prove it fetched new files.")
    if prev_meta:
        old_commit = (prev_meta.get("catalogue") or {}).get("commit")
        new_commit = (meta.get("catalogue") or {}).get("commit")
        if new_commit and new_commit != old_commit:
            source_detail.append(f"pl-catalogue moved to a new commit {new_commit[:8]}.")
        elif meta.get("no_new_round"):
            source_detail.append(note.summary)
        elif int(data["gw"]) == int((prev_meta.get("gameweek") or 0)):
            source_detail.append("The gameweek is unchanged and pl-catalogue's commit is unchanged.")
        else:
            source_ok = False
            source_detail.append(
                "A new gameweek is in the Premier League feed but pl-catalogue has not published a new commit. The table would be stale, so this build is rejected."
            )
        old_fpl = _parse_time(((prev_meta.get("fetch") or {}).get("fpl") or {}).get("fetched_at"))
        new_fpl = _parse_time(((fetch.get("fpl") or {}).get("fetched_at")))
        if new_fpl and old_fpl and new_fpl <= old_fpl:
            source_ok = False
            source_detail.append("The Premier League fixture feed was not downloaded again.")
        else:
            source_detail.append("Premier League fixtures were downloaded again.")
        if not (fetch.get("europe") or {}).get("fetched_at"):
            source_ok = False
            source_detail.append("European fixtures were not downloaded.")
        else:
            source_detail.append("European fixtures were downloaded again.")
        if not (fetch.get("history") or {}).get("files"):
            source_ok = False
            source_detail.append("Historical results were not downloaded.")
        else:
            source_detail.append(f"Historical results: {len(fetch['history']['files'])} files.")
    else:
        source_detail.append("First build: there is no earlier download to compare. This run's download times are on the record.")
    fpl_gw = int(meta.get("fpl_finished_gameweek") or 0)
    cat_gw = int(data["gw"])
    if note.kind == "lag" or fpl_gw > cat_gw:
        source_ok = False
        if note.summary not in source_detail:
            source_detail.append(
                note.summary
                if note.kind == "lag"
                else f"The Premier League says gameweek {fpl_gw} is finished, but the match file only has shots through gameweek {cat_gw}."
            )
    elif meta.get("no_new_round") and note.summary not in source_detail:
        source_detail.append(note.summary)
    _check(
        checks,
        "Sources were refreshed, or the pause is explained",
        source_ok and fpl_gw <= cat_gw and note.kind != "lag",
        " ".join(source_detail),
    )

    _check(
        checks,
        "Official scores match the match file",
        not meta.get("score_disagreements"),
        "Every finished score matches the Premier League feed."
        if not meta.get("score_disagreements")
        else "Scores disagree: " + "; ".join(
            f"{d['home']} {d['fpl']} vs file {d['catalogue']}" for d in meta["score_disagreements"][:6]
        ),
    )

    changes = meta.get("fixture_changes") or []
    _check(
        checks,
        "Fixture changes are recorded",
        isinstance(changes, list),
        meta.get("change_note")
        or (f"{len(changes)} change(s) since the previous build." if changes else "No kickoff or gameweek changes since the previous build."),
    )

    _check(
        checks,
        "Bookmaker prices are not in the data",
        "odds" not in data,
        "The page data has no bookmaker block.",
    )

    europe = meta.get("europe") or {}
    _check(
        checks,
        "European fixtures loaded",
        int(europe.get("fixtures") or 0) > 0 and not any(not r[3] for r in data.get("euro", [])),
        data.get("europe_note") or "No European fixtures.",
    )

    pen_n = int((data.get("derived") or {}).get("pen_n") or 0)
    pen = (data.get("derived") or {}).get("pen_xg")
    _check(
        checks,
        "Penalty xG was measured from this season's penalties",
        pen_n >= 1 and isinstance(pen, (int, float)) and 0.4 <= float(pen) <= 0.95,
        f"Average of {pen_n} penalties is {pen}.",
    )

    # Re-check a sample of official scores straight from the raw download, not from the summary.
    raw_ok = True
    raw_detail = "Official scores were checked against the downloaded fixture file."
    try:
        fpl_fx = json.loads((root / "sources" / "fpl" / "fixtures.json").read_text(encoding="utf-8"))
        boot = json.loads((root / "sources" / "fpl" / "bootstrap.json").read_text(encoding="utf-8"))
        names = {int(t["id"]): t["name"] for t in boot["teams"]}
        ours = {(m["h"], m["a"]): (m["hs"], m["as"]) for m in data["matches"]}
        mismatches = []
        for f in fpl_fx:
            if not f.get("finished"):
                continue
            pair = (names[int(f["team_h"])], names[int(f["team_a"])])
            if pair not in ours:
                mismatches.append(f"{pair[0]} vs {pair[1]} finished on the Premier League feed but has no match in the page")
                continue
            official = (int(f["team_h_score"]), int(f["team_a_score"]))
            if ours[pair] != official:
                mismatches.append(f"{pair[0]} {ours[pair]} vs official {official}")
        if mismatches:
            raw_ok = False
            raw_detail = "; ".join(mismatches[:6])
    except Exception as exc:  # noqa: BLE001
        raw_ok = False
        raw_detail = f"Could not re-read the Premier League download: {exc}"
    _check(checks, "Cross-check against the Premier League feed", raw_ok, raw_detail)

    js = (root / "web" / "pl_xray.js").read_text(encoding="utf-8")
    html_shell = (root / "web" / "index.html").read_text(encoding="utf-8") if (root / "web" / "index.html").exists() else ""
    blob = (js + "\n" + html_shell).lower()
    found = scan_user_facing(root)
    banned_brands = ("bet" + "365", "club" + "elo", "rönt" + "gen", "xga" + "bora")
    leftovers = [w for w in banned_brands if w in blob]
    _check(
        checks,
        "The page text is English",
        not found and not leftovers,
        "No Hungarian phrases and no bookmaker branding in the page code."
        if not found and not leftovers
        else "Still present: " + "; ".join((found + leftovers)[:8]),
    )

    names = list(data.get("short") or [])
    names += [p.get("n") or "" for p in data.get("players") or []]
    names += [p.get("full") or "" for p in data.get("players") or []]
    names += [row[3] for row in data.get("euro") or [] if len(row) > 3]
    if browser:
        b_ok, b_detail = _browser(root / "site" / "index.html", names, root / "review" / "rendered-copy.txt")
        _check(checks, "The page opens and every tab has content", b_ok, b_detail)
    else:
        _check(checks, "The page opens and every tab has content", False, "Browser check was skipped, so this build cannot be published.")

    def _status_summary(passed: bool) -> str:
        if not passed:
            failed = [c["name"] for c in checks if not c["pass"]]
            lead = f"{note.summary} " if meta.get("no_new_round") or note.kind == "lag" else ""
            return "The new build was not published. " + lead + "Failed checks: " + ", ".join(failed) + "."
        if meta.get("no_new_round") or note.kind == "lag":
            return f"{note.summary} Fixtures were checked again and the site was refreshed. This is not an error."
        return (
            f"{data['season']} through gameweek {data['gw']} passed every check "
            f"({len(data['matches'])} matches, {len(data['fx'])} fixtures)."
        )

    provisional_ok = all(c["pass"] for c in checks)
    summary = _status_summary(provisional_ok)
    problems = summary_problems(summary, note)
    _check(
        checks,
        "The status line matches the fixtures",
        not problems,
        summary if not problems else " ".join(problems),
    )
    ok = all(c["pass"] for c in checks)
    if ok != provisional_ok:
        summary = _status_summary(ok)
    return {
        "ok": ok,
        "timestamp": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "season": data.get("season"),
        "gameweek": data.get("gw"),
        "no_new_round": bool(meta.get("no_new_round")),
        "summary": summary,
        "data_dates": {
            "catalogue_commit": (meta.get("catalogue") or {}).get("commit"),
            "catalogue_exported_at": (meta.get("catalogue") or {}).get("exported_at"),
            "fpl_fetched_at": ((fetch.get("fpl") or {}).get("fetched_at")),
            "history_fetched_at": ((fetch.get("history") or {}).get("fetched_at")),
            "europe_fetched_at": ((fetch.get("europe") or {}).get("fetched_at")),
            "generated_at": data.get("generated_at"),
        },
        "checks": checks,
        "fixture_changes": changes,
        "europe": {
            "fixtures": europe.get("fixtures"),
            "teams": europe.get("teams"),
            "note": data.get("europe_note"),
        },
    }


_COLLECT = """() => {
  const bits = [];
  document.querySelectorAll("details").forEach(d => { d.open = true; });
  const root = document.getElementById("app") || document.body;
  bits.push(root.innerText || "");
  root.querySelectorAll("[title],[aria-label],[placeholder],[alt]").forEach(el => {
    for (const attr of ["title", "aria-label", "placeholder", "alt"]) {
      const value = el.getAttribute(attr);
      if (value) bits.push(value);
    }
  });
  root.querySelectorAll("title").forEach(el => { if (el.textContent) bits.push(el.textContent); });
  root.querySelectorAll("option").forEach(el => bits.push(el.textContent || ""));
  return bits.join("\\n");
}"""


def _browser(html: Path, names: list[str], dump_path: Path) -> tuple[bool, str]:
    if not html.exists():
        return False, "The page file was not built."
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return False, "The browser checker (Playwright) is not installed, so the page was not opened."
    errors: list[str] = []
    sections: list[tuple[str, str]] = []
    seen = 0
    language_hits: list[str] = []

    def grab(page, label: str) -> None:
        nonlocal seen
        seen += 1
        text = page.evaluate(_COLLECT)
        sections.append((label, text))
        if len(text) < 80:
            errors.append(f"{label} was almost empty.")
        if re.search(r"\bNaN\b", text) or re.search(r"\bundefined\b", text):
            errors.append(f"{label} shows NaN or undefined.")
        hits = find_hits(text, names)
        if hits:
            language_hits.append(f"{label}: {hits[0]}")

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            page.on("pageerror", lambda exc: errors.append(str(exc)))
            page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
            page.set_default_timeout(120000)
            page.goto(html.resolve().as_uri(), wait_until="domcontentloaded")
            page.wait_for_selector("h1")
            title = page.locator("h1").inner_text()
            if "X-RAY" not in title.upper():
                errors.append(f"The title does not say X-ray (saw {title!r}).")
            main_count = page.locator("[data-main]").count()
            if main_count < 3:
                errors.append(f"Only {main_count} sections were found.")
            for m in range(main_count):
                page.locator("[data-main]").nth(m).click()
                main_label = page.locator("[data-main]").nth(m).inner_text().strip()
                sub_count = page.locator("[data-tab]").count()
                for i in range(sub_count):
                    subs = page.locator("[data-tab]")
                    label = subs.nth(i).inner_text().strip()
                    subs.nth(i).click()
                    grab(page, f"{main_label} / {label}")
                    low = label.lower()
                    if "justice table" in low:
                        for mode in range(page.locator("[data-mode]").count()):
                            page.locator("[data-mode]").nth(mode).click()
                            grab(page, f"{label} / mode {mode + 1}")
                    elif low == "schedule":
                        for tick in range(page.locator("[data-tick]").count()):
                            page.locator("[data-tick]").nth(tick).click()
                            grab(page, f"{label} / range {tick + 1}")
                    elif low == "players":
                        for grp in range(page.locator("[data-pg]").count()):
                            page.locator("[data-pg]").nth(grp).click()
                            grab(page, f"Players / group {grp + 1}")
                        if page.locator("#p90").count():
                            page.locator("#p90").click()
                            grab(page, "Players / per 90")
                            page.locator("#p90").click()
                        if page.locator("#pmin").count():
                            page.select_option("#pmin", "0")
                            grab(page, "Players / any minutes")
                        if page.locator("[data-p]").count():
                            page.locator("[data-p]").first.click()
                            grab(page, "Players / profile")
                    elif low == "matches":
                        for tag in range(page.locator("[data-mft]").count()):
                            page.locator("[data-mft]").nth(tag).click()
                            grab(page, f"Matches / filter {tag + 1}")
                            if page.locator("[data-mo]").count():
                                page.locator("[data-mo]").first.click()
                                grab(page, f"Matches / filter {tag + 1} open")
                                page.locator("[data-mo]").first.click()
                    elif low == "shots":
                        for key in ("res:G", "sit:penalty", "body:Head", "zone:six", "zone:box", "zone:out"):
                            if page.locator("#sf-reset").count():
                                page.locator("#sf-reset").click()
                            btn = page.locator(f'[data-sfc="{key}"]')
                            if btn.count():
                                btn.first.click()
                                grab(page, f"Shots / {key}")
                    elif "x-ray" in low or "xray" in low:
                        options = page.locator("#tsel option")
                        for n in range(options.count()):
                            name = options.nth(n).inner_text().strip()
                            page.select_option("#tsel", label=name)
                            grab(page, f"Club X-ray / {name}")
            # Edge cases the filters do not guarantee: own goals, draws, a player with no minutes, gameweek 1.
            page.evaluate("""() => {
              const D = JSON.parse(document.getElementById("data").textContent);
              const plr = window.__plr;
              const og = (D.shots || []).find(s => s[10] === "O");
              const draw = (D.matches || []).find(m => m.hs === m.as);
              const pen = (D.shots || []).find(s => s[11] === "penalty");
              const quiet = (D.players || []).slice().sort((a, b) => a.min - b.min)[0];
              const keeper = (D.players || []).find(p => p.pos === "GKP");
              plr.S.gw = 1; plr.S.tab = "fordulo"; plr.S.open = null; plr.render();
              window.__edge = { og: og && og[1], draw: draw && draw.id, pen: pen && pen[1], quiet: quiet && quiet.id, keeper: keeper && keeper.id, gw: D.gw };
            }""")
            grab(page, "Gameweek 1 / Results")
            page.evaluate("""() => { const plr = window.__plr; plr.S.tab = "elozetes"; plr.render(); }""")
            grab(page, "Gameweek 1 / Preview")
            page.evaluate("""() => {
              const plr = window.__plr;
              const edge = window.__edge;
              plr.S.gw = edge.gw;
              plr.S.tab = "meccsek";
              plr.S.mf = { team: "", venue: "", tag: "", from: 1, sort: "date", lim: 400 };
              plr.S.open = edge.og || edge.draw;
              plr.render();
            }""")
            grab(page, "Edge / own goal or draw")
            page.evaluate("""() => {
              const plr = window.__plr;
              const edge = window.__edge;
              plr.S.open = edge.draw;
              plr.render();
            }""")
            grab(page, "Edge / draw")
            page.evaluate("""() => {
              const plr = window.__plr;
              const edge = window.__edge;
              plr.S.tab = "jatekos";
              plr.S.grp = "gol";
              plr.S.pmin = 0;
              plr.S.ppos = "";
              plr.S.q = "";
              plr.S.psel = edge.quiet;
              plr.S.pcmp = edge.keeper;
              plr.S.plim = 25;
              plr.render();
            }""")
            grab(page, "Edge / low-minute player")
            page.evaluate("""() => {
              const plr = window.__plr;
              const edge = window.__edge;
              plr.S.grp = "concedes";
              plr.S.psel = edge.keeper;
              plr.S.pcmp = null;
              plr.render();
            }""")
            grab(page, "Edge / goalkeeper")
            if page.locator(".mc").count():
                page.locator("[data-main]").first.click()
                page.locator("[data-tab]").first.click()
                for i in range(min(10, page.locator(".mc").count())):
                    page.locator(".mc").nth(i).click()
                    grab(page, f"Results / match {i + 1}")
                    page.locator(".mc").nth(i).click()
            if seen < 12:
                errors.append(f"Only {seen} views were opened.")
            browser.close()
    except Exception as exc:  # noqa: BLE001
        return False, f"The page did not open cleanly: {exc}"
    dump_path.parent.mkdir(parents=True, exist_ok=True)
    body = []
    for label, text in sections:
        body.append(f"\n===== {label} =====\n")
        body.append(text.rstrip() + "\n")
    dump_path.write_text("".join(body), encoding="utf-8")
    artifact = Path("/opt/cursor/artifacts/copy-review.txt")
    try:
        artifact.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(dump_path, artifact)
    except OSError:
        pass
    if language_hits:
        errors.append("Hungarian or mixed English still on the page: " + " | ".join(language_hits[:6]))
    if errors:
        return False, " ".join(errors[:8])
    return True, f"Opened in a browser with no script errors. {seen} views have English text and no Hungarian leftovers."
