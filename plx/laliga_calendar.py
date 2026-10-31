"""Official La Liga matchdays, checked against a second feed.

The matchday file (openfootball, public domain) says which jornada a fixture
belongs to. ESPN's public scoreboard says the kickoff and whether the match
was abandoned, postponed, cancelled or suspended. A missing result on the
shot feed is not enough to call a match postponed.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from plx.names import ClubIndex, NameError
from plx.prepare import PrepareError

_MONTHS = {
    "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
    "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12,
}
_DATE = re.compile(
    r"^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Za-z]{3})\s+(\d{1,2})(?:\s+(\d{4}))?\s*$"
)
_MATCHDAY = re.compile(r"Matchday\s+(\d+)\s*$")
_TIME = re.compile(r"^\d{1,2}:\d{2}\s+")
_SCORE = re.compile(r"\s+(\d+)-(\d+)(?:\s+\([^)]+\))?\s*$")

# ESPN status names that mean the match has a final score.
FINAL_STATUSES = {"STATUS_FULL_TIME", "STATUS_FINAL"}
# ESPN status names that mean the fixture will not be completed on its original date.
FLAGGED_STATUSES = {
    "STATUS_POSTPONED": "postponed",
    "STATUS_CANCELED": "cancelled",
    "STATUS_CANCELLED": "cancelled",
    "STATUS_ABANDONED": "abandoned",
    "STATUS_SUSPENDED": "suspended",
    "STATUS_FORFEIT": "forfeited",
}
LIVE_STATUSES = {
    "STATUS_IN_PROGRESS",
    "STATUS_FIRST_HALF",
    "STATUS_HALFTIME",
    "STATUS_SECOND_HALF",
    "STATUS_EXTRA_TIME",
    "STATUS_DELAYED",
}


def parse_matchday_file(text: str) -> list[dict]:
    """Read a Football.TXT season. Duplicate matchday headers are the same jornada."""
    rows = []
    matchday = None
    year = None
    month = None
    day = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("=") or line.startswith("#"):
            continue
        found = _MATCHDAY.search(line)
        if found and " v " not in line:
            matchday = int(found.group(1))
            continue
        dated = _DATE.match(line)
        if dated:
            name = dated.group(1)
            if name not in _MONTHS:
                raise PrepareError(f"The matchday file has a date the build cannot read: {line!r}.")
            new_month = _MONTHS[name]
            if dated.group(3):
                year = int(dated.group(3))
            elif year is not None and month is not None and new_month < month:
                year += 1
            month = new_month
            day = int(dated.group(2))
            continue
        if " v " not in line:
            continue
        if matchday is None or year is None or day is None or month is None:
            raise PrepareError(f"A fixture appears before its matchday and date: {line!r}.")
        body = _TIME.sub("", line)
        score = _SCORE.search(body)
        hg = ag = None
        if score:
            hg, ag = int(score.group(1)), int(score.group(2))
            body = body[: score.start()]
        home_raw, away_raw = body.split(" v ", 1)
        rows.append(
            {
                "matchday": matchday,
                "day": f"{year:04d}-{month:02d}-{day:02d}",
                "home_raw": " ".join(home_raw.split()),
                "away_raw": " ".join(away_raw.split()),
                "hg": hg,
                "ag": ag,
            }
        )
    if not rows:
        raise PrepareError("The matchday file did not contain any fixtures.")
    return rows


def _fd_date(iso_day: str) -> str:
    year, month, day = iso_day.split("-")
    return f"{day}/{month}/{year}"


def _index(model: dict, titles: list[str], extra: dict[str, list[str]]) -> ClubIndex:
    index = ClubIndex(model)
    for title in titles:
        names = [title] + list(extra.get(title) or [])
        index.add(title, names)
    return index


def _learn(rows: list[dict], fixtures: list[dict]) -> dict[str, str]:
    shaped = []
    for row in rows:
        if row.get("hg") is None or row.get("ag") is None:
            continue
        shaped.append(
            {
                "Date": _fd_date(row["day"]),
                "FTHG": str(row["hg"]),
                "FTAG": str(row["ag"]),
                "HomeTeam": row["home_raw"],
                "AwayTeam": row["away_raw"],
            }
        )
    from plx.laliga_prepare import learn_aliases

    return learn_aliases(shaped, fixtures)


def _bind(index: ClubIndex, raw: str) -> str:
    try:
        return index.match(raw)
    except NameError as exc:
        raise PrepareError(str(exc)) from exc


def apply_official_rounds(
    fixtures: list[dict],
    calendar_text: str,
    espn_events: list[dict],
    model: dict,
    slack_days: int = 2,
) -> dict:
    """Set each fixture's jornada from the matchday file and its kickoff from ESPN.

    `fixtures` are the shot-feed rows (id, home, away, kick, result, hg, ag, day).
    Kickoffs on those rows are replaced with the ESPN kickoff.
    """
    calendar = parse_matchday_file(calendar_text)
    titles = sorted({row["home"] for row in fixtures} | {row["away"] for row in fixtures})
    learned = _learn(calendar, fixtures)
    espn_rows = []
    for event in espn_events:
        if event.get("status") not in FINAL_STATUSES:
            continue
        if event.get("hs") is None or event.get("as") is None:
            continue
        espn_rows.append(
            {
                "day": str(event["date"])[:10],
                "hg": int(event["hs"]),
                "ag": int(event["as"]),
                "home_raw": event["home"],
                "away_raw": event["away"],
            }
        )
    learned.update(_learn(espn_rows, fixtures))
    grouped: dict[str, list[str]] = {}
    for spelling, canonical in learned.items():
        grouped.setdefault(canonical, []).append(spelling)
    index = _index(model, titles, grouped)

    by_pair: dict[tuple[str, str], dict] = {}
    for row in calendar:
        home = _bind(index, row["home_raw"])
        away = _bind(index, row["away_raw"])
        key = (home, away)
        if key in by_pair:
            raise PrepareError(
                f"The matchday file lists {home} v {away} more than once. The build stopped rather than pick a jornada."
            )
        row = dict(row)
        row["home"] = home
        row["away"] = away
        by_pair[key] = row

    espn_by_pair: dict[tuple[str, str], dict] = {}
    for event in espn_events:
        home = _bind(index, event["home"])
        away = _bind(index, event["away"])
        key = (home, away)
        if key in espn_by_pair:
            raise PrepareError(
                f"ESPN lists {home} v {away} more than once. The build stopped rather than pick a kickoff."
            )
        espn_by_pair[key] = event

    shot_pairs = {(row["home"], row["away"]) for row in fixtures}
    if shot_pairs != set(by_pair):
        missing = sorted(f"{h} v {a}" for h, a in shot_pairs - set(by_pair))[:4]
        extra = sorted(f"{h} v {a}" for h, a in set(by_pair) - shot_pairs)[:4]
        raise PrepareError(
            "The shot feed and the matchday file do not list the same fixtures. "
            f"Missing from the matchday file: {missing or 'none'}. Missing from the shot feed: {extra or 'none'}."
        )
    if shot_pairs != set(espn_by_pair):
        missing = sorted(f"{h} v {a}" for h, a in shot_pairs - set(espn_by_pair))[:4]
        extra = sorted(f"{h} v {a}" for h, a in set(espn_by_pair) - shot_pairs)[:4]
        raise PrepareError(
            "ESPN and the shot feed do not list the same fixtures. "
            f"Missing from ESPN: {missing or 'none'}. Missing from the shot feed: {extra or 'none'}."
        )

    span: dict[int, list] = {}
    for row in by_pair.values():
        span.setdefault(row["matchday"], []).append(datetime.strptime(row["day"], "%Y-%m-%d").date())
    span_bounds = {gw: (min(days), max(days)) for gw, days in span.items()}
    slack = timedelta(days=int(slack_days))

    rounds: dict[str, int] = {}
    unresolved = []
    for row in fixtures:
        key = (row["home"], row["away"])
        official = by_pair[key]
        event = espn_by_pair[key]
        status = event.get("status") or ""
        flag = FLAGGED_STATUSES.get(status)
        kick = _parse_espn_time(event.get("date"))
        if kick is None:
            raise PrepareError(f"ESPN has no kickoff for {row['home']} v {row['away']}.")
        lo, hi = span_bounds[official["matchday"]]
        if flag is None and not (lo - slack <= kick.date() <= hi + slack):
            raise PrepareError(
                f"{row['home']} v {row['away']} is matchday {official['matchday']} "
                f"({lo.isoformat()} to {hi.isoformat()} in the matchday file), but ESPN lists {kick.date().isoformat()}. "
                "The two sources disagree, so the build stopped."
            )
        if status in FINAL_STATUSES:
            if not row["result"]:
                raise PrepareError(
                    f"ESPN says {row['home']} v {row['away']} is finished, but the shot feed has no result."
                )
            if event.get("hs") is not None and (int(event["hs"]), int(event["as"])) != (row["hg"], row["ag"]):
                raise PrepareError(
                    f"{row['home']} v {row['away']} is {row['hg']}-{row['ag']} on the shot feed "
                    f"and {event['hs']}-{event['as']} on ESPN."
                )
        elif flag:
            if row["result"]:
                raise PrepareError(
                    f"The shot feed has a result for {row['home']} v {row['away']}, but ESPN says the match was {flag}."
                )
            unresolved.append(
                {
                    "id": int(row["id"]),
                    "gameweek": official["matchday"],
                    "home": row["home"],
                    "away": row["away"],
                    "status": flag,
                    "kickoff": kick.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
                    "listed_on": official["day"],
                }
            )
        elif row["result"]:
            raise PrepareError(
                f"The shot feed has a result for {row['home']} v {row['away']}, but ESPN status is {status or 'missing'}."
            )
        row["kick"] = kick
        row["flag"] = flag
        row["live"] = status in LIVE_STATUSES
        rounds[row["id"]] = official["matchday"]

    clubs = len(titles)
    expected = 2 * (clubs - 1)
    per_round: dict[int, list] = {}
    for row in fixtures:
        per_round.setdefault(rounds[row["id"]], []).append(row)
    if set(per_round) != set(range(1, expected + 1)):
        raise PrepareError(
            f"The matchday file does not number rounds 1 to {expected}. It has {sorted(per_round)}."
        )
    half = clubs // 2
    for gw, rows in per_round.items():
        if len(rows) != half:
            raise PrepareError(f"Matchday {gw} has {len(rows)} matches. A round of {clubs} clubs has {half}.")
        seen = [name for row in rows for name in (row["home"], row["away"])]
        if len(seen) != len(set(seen)):
            raise PrepareError(f"Matchday {gw} lists a club more than once.")

    official_current = None
    for gw in range(1, expected + 1):
        if any(not row["result"] and not row.get("flag") for row in per_round[gw]):
            official_current = gw
            break
    return {"rounds": rounds, "unresolved": unresolved, "official_current": official_current, "round_count": expected}


def _parse_espn_time(value: str | None) -> datetime | None:
    if not value:
        return None
    text = str(value).replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def audit_published_rounds(fx: list, matches: list[dict], unresolved: list[dict], published_gw: int, clubs: int, official_current, status_event) -> list[str]:
    """Fail closed when matchday numbers would not add up."""
    problems = []
    expected = 2 * (clubs - 1)
    half = clubs // 2
    by_round: dict[int, list] = {}
    for row in fx:
        by_round.setdefault(int(row[0]), []).append(row)
    if set(by_round) != set(range(1, expected + 1)):
        problems.append(f"Rounds run {sorted(by_round)} instead of 1 to {expected}.")
        return problems
    flagged = {int(item["id"]) for item in unresolved}
    for gw, rows in by_round.items():
        if len(rows) != half:
            problems.append(f"Matchday {gw} has {len(rows)} matches, not {half}.")
        names = [name for row in rows for name in row[1:3]]
        if len(names) != len(set(names)):
            problems.append(f"Matchday {gw} lists a club more than once.")
    if problems:
        return problems
    resolved = []
    for gw in range(1, expected + 1):
        open_rows = [row for row in by_round[gw] if row[4] != 1 and int(row[5]) not in flagged]
        if not open_rows:
            resolved.append(gw)
    if published_gw and any(gw not in resolved for gw in range(1, published_gw + 1)):
        problems.append(f"Matchday {published_gw} is published while an earlier matchday is still unresolved.")
    slots = published_gw * half
    results = sum(1 for match in matches if int(match["gw"]) <= published_gw)
    flags = sum(1 for item in unresolved if int(item["gameweek"]) <= published_gw)
    if results + flags != slots:
        problems.append(
            f"Completed matches ({results}) plus flagged matches ({flags}) "
            f"do not equal the {slots} matches in the first {published_gw} rounds."
        )
    if official_current is None:
        if status_event is not None:
            problems.append("The season is complete in the matchday file, but the status line still names a round.")
    elif status_event != official_current:
        problems.append(
            f"The status line is about matchday {status_event}, but the matchday file says the current round is {official_current}."
        )
    return problems
