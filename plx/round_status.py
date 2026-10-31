"""Say why the page did not move to a new round, using the fixture list.

The sentence is computed from kickoff times and finished flags. It does not
assume an international break, and it does not contain a season or a club.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

_BREAK = re.compile(r"\bbreak\b", re.I)


@dataclass(frozen=True)
class RoundNote:
    kind: str
    summary: str
    event: int | None
    started: bool


def _parse_time(value: str | None) -> datetime | None:
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


def _played(row: dict, now: datetime) -> bool:
    if row.get("finished") or row.get("started"):
        return True
    kick = _parse_time(row.get("kickoff"))
    return kick is not None and kick <= now


def _fmt_when(moment: datetime, tz_name: str) -> str:
    local = moment.astimezone(ZoneInfo(tz_name))
    clock = local.strftime("%d %b %Y, %H:%M").lstrip("0")
    if tz_name.upper() == "UTC":
        return f"{clock} UTC"
    utc_clock = moment.astimezone(timezone.utc).strftime("%H:%M")
    return f"{clock} {tz_name} ({utc_clock} UTC)"


def _fmt_day(moment: datetime, tz_name: str) -> str:
    return moment.astimezone(ZoneInfo(tz_name)).strftime("%d %b %Y").lstrip("0")


def _matches(n: int) -> str:
    return "1 match" if n == 1 else f"{n} matches"


def _by_event(fixtures: list[dict]) -> dict[int, list[dict]]:
    grouped: dict[int, list[dict]] = {}
    for row in fixtures:
        event = row.get("event")
        if event is None:
            continue
        grouped.setdefault(int(event), []).append(row)
    return grouped


def _disruptions(event: int, fixtures: list[dict], changes: list[dict]) -> str:
    named = []
    for change in changes or []:
        kind = change.get("kind")
        if kind not in {"postponed", "rescheduled", "moved_gameweek"}:
            continue
        touched = {change.get("gameweek"), change.get("was"), change.get("now")}
        if event not in touched and str(event) not in {str(x) for x in touched if x is not None}:
            continue
        home = change.get("home") or "A club"
        away = change.get("away") or "another club"
        if kind == "rescheduled":
            named.append(f"{home} v {away} was rescheduled")
        elif kind == "moved_gameweek":
            named.append(f"{home} v {away} moved from GW{change.get('was')} to GW{change.get('now')}")
        else:
            named.append(f"{home} v {away} was postponed")
    if named:
        extra = len(named) - 3
        shown = named[:3]
        if extra > 0:
            shown.append(f"{extra} more in this round")
        return " ".join(bit if bit.endswith(".") else bit + "." for bit in shown)
    undated = [row for row in fixtures if row.get("event") is not None and int(row["event"]) == event and not row.get("kickoff")]
    if not undated:
        return ""
    word = "match has" if len(undated) == 1 else "matches have"
    return f"{len(undated)} {word} no kickoff in this round."


def _quiet_since(fixtures: list[dict], published_gw: int, now: datetime, gap_days: int) -> datetime | None:
    grouped = _by_event(fixtures)
    completed = [event for event, rows in grouped.items() if rows and all(row.get("finished") for row in rows)]
    anchor = [event for event in completed if event <= published_gw]
    if not anchor:
        anchor = completed
    if not anchor:
        return None
    last = max(anchor)
    kickoffs = [_parse_time(row.get("kickoff")) for row in grouped[last]]
    kickoffs = [kick for kick in kickoffs if kick is not None]
    if not kickoffs:
        return None
    final = max(kickoffs)
    if (now - final).total_seconds() < gap_days * 86400:
        return None
    between = False
    for row in fixtures:
        kick = _parse_time(row.get("kickoff"))
        if kick is not None and final < kick <= now:
            between = True
            break
    if between:
        return None
    return final


def describe_round(
    fixtures: list[dict],
    published_gw: int,
    now: datetime,
    tz_name: str,
    changes: list[dict] | None = None,
    gap_days: int = 12,
) -> RoundNote:
    """One plain-English sentence for the fixture state after `published_gw`."""
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    else:
        now = now.astimezone(timezone.utc)
    grouped = _by_event(fixtures)
    later = sorted(event for event in grouped if event > published_gw)

    def pack(kind: str, event: int | None, sentence: str) -> RoundNote:
        rows = grouped.get(event or -1, [])
        started = any(_played(row, now) for row in rows) if event is not None else False
        return RoundNote(kind, sentence, event, started)

    for event in later:
        rows = grouped[event]
        if rows and all(row.get("finished") for row in rows):
            played = sum(1 for row in rows if row.get("finished"))
            sentence = (
                f"The Premier League feed shows GW{event} complete ({played} of {len(rows)} "
                f"{'match' if len(rows) == 1 else 'matches'} played), but the match file still stops at GW{published_gw}."
            )
            extra = _disruptions(event, fixtures, changes or [])
            if extra:
                sentence = f"{sentence} {extra}"
            return pack("lag", event, sentence)

    for event in later:
        rows = grouped[event]
        played = sum(1 for row in rows if _played(row, now))
        if played and not all(row.get("finished") for row in rows):
            noun = "match" if len(rows) == 1 else "matches"
            sentence = f"GW{event} in progress ({played} of {len(rows)} {noun} played)"
            extra = _disruptions(event, fixtures, changes or [])
            if extra:
                sentence = f"{sentence}. {extra} The page will update once the round is complete."
            else:
                sentence = f"{sentence} – the page will update once the round is complete."
            return pack("in_progress", event, sentence)

    for event in later:
        rows = grouped[event]
        if any(_played(row, now) for row in rows):
            continue
        kickoffs = [_parse_time(row.get("kickoff")) for row in rows]
        kickoffs = [kick for kick in kickoffs if kick is not None and kick > now]
        extra = _disruptions(event, fixtures, changes or [])
        quiet = _quiet_since(fixtures, published_gw, now, gap_days)
        if quiet is not None and kickoffs:
            sentence = (
                f"No Premier League matches since {_fmt_day(quiet, tz_name)}. "
                f"GW{event} starts {_fmt_when(min(kickoffs), tz_name)}."
            )
            if extra:
                sentence = f"{sentence} {extra}"
            return pack("gap", event, sentence)
        if kickoffs:
            sentence = f"GW{event} starts {_fmt_when(min(kickoffs), tz_name)} – no new results yet."
            if extra:
                sentence = f"{sentence} {extra}"
            return pack("not_started", event, sentence)
        sentence = f"GW{event} has no kickoff times yet. No new results yet."
        if extra:
            sentence = f"{sentence} {extra}"
        return pack("not_started", event, sentence)

    return pack(
        "season_over",
        None,
        f"No further Premier League rounds are scheduled after GW{published_gw}.",
    )


def summary_problems(summary: str, note: RoundNote) -> list[str]:
    """Fail closed if the published sentence disagrees with the fixture state."""
    text = summary or ""
    low = text.lower()
    problems = []
    if note.started and _BREAK.search(text):
        problems.append(
            "The status line says break, but a fixture in the current gameweek has already started."
        )
    if note.kind == "in_progress" and "in progress" not in low:
        problems.append("A gameweek is under way, but the status line does not say so.")
    if note.kind in {"not_started", "gap"} and "in progress" in low:
        problems.append("No match has kicked off, but the status line says a gameweek is in progress.")
    if note.kind == "lag" and "match file" not in low:
        problems.append(
            "The Premier League feed is ahead of the match file, but the status line does not say so."
        )
    if note.kind == "gap" and _BREAK.search(text):
        problems.append("The status line calls a gap in the fixture list a break. Name the dates instead.")
    return problems
