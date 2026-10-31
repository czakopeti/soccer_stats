"""European fixtures from ESPN's public football JSON.

No key is required. Kickoff times arrive in UTC, so daylight-saving dates are
not typed in. Domestic cups are not on this feed and are left out on purpose.
"""
from __future__ import annotations

from plx.http_client import get_json
from plx.names import ClubIndex, UnmappedName


class EuropeError(RuntimeError):
    pass


def split_event_name(name: str) -> tuple[str, str]:
    """ESPN labels matches 'Away at Home' when lang=en."""
    if " at " not in name:
        raise EuropeError(
            f"Could not read who played in European match {name!r}. Expected the form 'Away at Home'. The build stopped rather than store a blank opponent."
        )
    away, home = name.rsplit(" at ", 1)
    away, home = away.strip(), home.strip()
    if not away or not home:
        raise EuropeError(f"European match name {name!r} is missing a team.")
    return home, away


def fetch_competitions(season_start_year: int, cfg: dict, user_agent: str) -> list[dict]:
    src = cfg["sources"]
    teams_payload = get_json(src["espn_teams"], user_agent)
    try:
        espn_teams = teams_payload["sports"][0]["leagues"][0]["teams"]
    except (KeyError, IndexError, TypeError) as exc:
        raise EuropeError("The ESPN Premier League team list did not look like the usual feed.") from exc

    aliases = []
    id_by_display = {}
    for wrap in espn_teams:
        tm = wrap.get("team") or wrap
        label = tm.get("displayName") or tm.get("name")
        if not label or not tm.get("id"):
            continue
        id_by_display[label] = str(tm["id"])
        aliases.append(
            {
                "display": label,
                "aliases": [
                    label,
                    tm.get("shortDisplayName") or "",
                    tm.get("name") or "",
                    tm.get("location") or "",
                    tm.get("abbreviation") or "",
                ],
                "id": str(tm["id"]),
            }
        )

    events = []
    errors = []
    for comp in src["european_competitions"]:
        slug = comp["espn_slug"]
        code = comp["code"]
        for info in aliases:
            url = src["espn_events_template"].format(slug=slug, year=season_start_year, team_id=info["id"])
            try:
                payload = get_json(url, user_agent)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{code} team {info['display']}: {exc}")
                continue
            items = payload.get("items") if isinstance(payload, dict) else None
            if items is None:
                errors.append(f"{code} team {info['display']}: event list had no items")
                continue
            for item in items:
                ref = item.get("$ref") if isinstance(item, dict) else None
                if not ref:
                    continue
                event_id = ref.rstrip("/").split("/")[-1].split("?")[0]
                events.append({"competition": code, "event_id": event_id, "slug": slug, "espn_team": info["display"]})

    # Unique events.
    seen = set()
    unique = []
    for ev in events:
        key = (ev["competition"], ev["event_id"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(ev)

    detailed = []
    for ev in unique:
        url = src["espn_event_template"].format(slug=ev["slug"], event_id=ev["event_id"])
        try:
            payload = get_json(url, user_agent)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{ev['competition']} event {ev['event_id']}: {exc}")
            continue
        name = payload.get("name") or ""
        date = payload.get("date") or ""
        if not name or not date:
            errors.append(f"{ev['competition']} event {ev['event_id']} had no name or date")
            continue
        home, away = split_event_name(name)
        detailed.append(
            {
                "competition": ev["competition"],
                "event_id": ev["event_id"],
                "kickoff": date.replace("Z", "+00:00") if date.endswith("Z") else date,
                "kickoff_utc": date if date.endswith("Z") else date,
                "home": home,
                "away": away,
                "time_valid": bool(payload.get("timeValid", True)),
                "name": name,
            }
        )
    return detailed, aliases, errors


def to_team_rows(events: list[dict], canonical_teams: list[str], alias_sets: dict[str, list[str]], cfg: dict) -> tuple[list, dict]:
    index = ClubIndex(cfg)
    for team, aliases in alias_sets.items():
        index.add(team, aliases)
    rows = []
    unmatched_opponents = []
    pl_teams_seen = set()
    for ev in events:
        kick = ev["kickoff_utc"]
        if kick.endswith("+00:00"):
            kick = kick.replace("+00:00", "Z")
        sides = []
        for name, home_flag in ((ev["home"], 1), (ev["away"], 0)):
            try:
                team = index.match(name)
            except UnmappedName:
                continue
            sides.append((team, home_flag, name))
        if not sides:
            continue
        for team, home_flag, _name in sides:
            opp_name = ev["away"] if home_flag == 1 else ev["home"]
            try:
                opp = index.match(opp_name)
            except UnmappedName:
                opp = opp_name
                unmatched_opponents.append(opp_name)
            rows.append([team, kick, ev["competition"], opp, home_flag, bool(ev.get("time_valid", True))])
            pl_teams_seen.add(team)
    # Dedupe (team, kickoff, competition).
    dedup = []
    seen = set()
    for row in sorted(rows, key=lambda r: (r[1], r[0], r[2])):
        key = (row[0], row[1], row[2], row[3])
        if key in seen:
            continue
        seen.add(key)
        dedup.append(row)
    missing_opponent = [r for r in dedup if not r[3]]
    if missing_opponent:
        raise EuropeError(f"{len(missing_opponent)} European fixtures still have no opponent. The build stopped.")
    coverage = {
        "fixtures": len(dedup),
        "teams": sorted(pl_teams_seen),
        "teams_without_europe": sorted(set(canonical_teams) - pl_teams_seen),
        "opponent_names_outside_premier_league": sorted(set(unmatched_opponents)),
        "competitions": sorted({r[2] for r in dedup}),
        "kickoffs_marked_unconfirmed": sum(1 for r in dedup if not r[5]),
    }
    # Client rows drop the internal time_valid flag; it stays in coverage.
    client = [[r[0], r[1], r[2], r[3], r[4]] for r in dedup]
    return client, coverage
