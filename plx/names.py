"""Match club names across feeds without a hand-maintained roster.

Each run collects the spellings the feeds actually use (Premier League name,
short name, ESPN display name and short name). Comparison itself is generic:
ignore punctuation and accents, read 'utd' as 'united', drop a leading 'fc'
or 'afc', and treat 'Man' as the start of 'Manchester' only when the rest of
the word continues that way. If a name still does not line up with exactly
one club, the build stops and says which name failed.
"""
from __future__ import annotations

import re
import unicodedata


class NameError(RuntimeError):
    pass


class UnmappedName(NameError):
    pass


class AmbiguousName(NameError):
    pass


def _rules(cfg: dict) -> tuple[set[str], dict[str, str], set[str]]:
    block = cfg.get("name_matching", {})
    return set(block.get("drop_tokens", [])), dict(block.get("token_map", {})), set(block.get("generic_tokens", []))


def normalize(raw: str, cfg: dict) -> str:
    drop, token_map, _generic = _rules(cfg)
    text = unicodedata.normalize("NFKD", str(raw or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower().replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    tokens = []
    for tok in text.split():
        tok = token_map.get(tok, tok)
        if tok in drop:
            continue
        tokens.append(tok)
    return " ".join(tokens)


def _vowelless(token: str) -> str:
    return "".join(ch for ch in token if ch not in "aeiou")


def token_compatible(a: str, b: str) -> bool:
    if a == b:
        return True
    short, long = (a, b) if len(a) <= len(b) else (b, a)
    if len(short) >= 4 and long.startswith(short):
        return True
    # "man" / "manchester" only. A 3-letter prefix is too loose for anything else.
    if short == "man" and long.startswith("manch"):
        return True
    vs, vl = _vowelless(short), _vowelless(long)
    if len(vs) >= 4 and (vl.startswith(vs) or vs.startswith(vl)):
        return True
    return False


def lists_compatible(a: list[str], b: list[str]) -> bool:
    """True when the shorter token list can be paired, one-to-one, with the longer."""
    if not a or not b:
        return False
    if len(a) > len(b):
        a, b = b, a
    used: set[int] = set()
    for ta in a:
        found = None
        for i, tb in enumerate(b):
            if i in used:
                continue
            if token_compatible(ta, tb):
                found = i
                break
        if found is None:
            return False
        used.add(found)
    return True


def _soft_ok(query: list[str], alias: list[str], generic: set[str]) -> bool:
    if query == alias:
        return False
    short = query if len(query) <= len(alias) else alias
    if len(short) == 1 and short[0] in generic:
        return False
    return lists_compatible(query, alias)


class ClubIndex:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self._groups: list[tuple[str, set[str]]] = []

    def add(self, canonical: str, aliases: list[str]) -> None:
        cleaned = {a.strip() for a in aliases if a and str(a).strip()}
        cleaned.add(canonical)
        # Replace an existing group for the same canonical so callers can add aliases twice.
        self._groups = [(cid, als) for cid, als in self._groups if cid != canonical]
        self._groups.append((canonical, cleaned))

    def match(self, raw: str) -> str:
        _drop, _map, generic = _rules(self.cfg)
        nq = normalize(raw, self.cfg)
        if not nq:
            raise UnmappedName(f"Blank club name cannot be matched (raw value {raw!r}).")
        tq = nq.split()
        exact: list[str] = []
        soft: list[str] = []
        for cid, aliases in self._groups:
            norms = {normalize(a, self.cfg) for a in aliases}
            norms.discard("")
            if nq in norms:
                exact.append(cid)
                continue
            for alias in norms:
                if _soft_ok(tq, alias.split(), generic):
                    soft.append(cid)
                    break
        exact_u = list(dict.fromkeys(exact))
        soft_u = list(dict.fromkeys(soft))
        if len(exact_u) == 1:
            return exact_u[0]
        if len(exact_u) > 1:
            raise AmbiguousName(
                f"Club name {raw!r} matches more than one current club: {exact_u}. "
                "The build stopped so two clubs would not be merged."
            )
        if len(soft_u) == 1:
            return soft_u[0]
        if len(soft_u) > 1:
            raise AmbiguousName(
                f"Club name {raw!r} is close to more than one current club: {soft_u}. "
                "The build stopped rather than guess."
            )
        known = ", ".join(sorted(cid for cid, _ in self._groups)[:8])
        raise UnmappedName(
            f"Club name {raw!r} (normalised to {nq!r}) does not match any current club. "
            f"No guess was made. Clubs on file include: {known}."
        )


def link_feeds(fpl_teams: list[tuple[str, str]], espn_clubs: list[dict], cfg: dict) -> dict[str, list[str]]:
    """Tie ESPN's spellings to the Premier League names, then return one alias list per club.

    fpl_teams is (official name, short code). Each ESPN club is
    {"display": str, "aliases": [str, ...]}.
    """
    index = ClubIndex(cfg)
    sets: dict[str, list[str]] = {}
    for name, short in fpl_teams:
        sets[name] = [name] + ([short] if short else [])
        index.add(name, sets[name])
    claimed: dict[str, str] = {}
    for club in espn_clubs:
        aliases = [a for a in club.get("aliases", []) if a and str(a).strip()]
        match = None
        for alias in aliases:
            try:
                match = index.match(alias)
                break
            except UnmappedName:
                continue
        if match is None:
            raise UnmappedName(
                f"ESPN lists {club.get('display')!r}, and none of its names match a Premier League club. "
                "The build stopped instead of guessing."
            )
        if match in claimed:
            raise AmbiguousName(
                f"ESPN clubs {claimed[match]!r} and {club.get('display')!r} both look like {match}."
            )
        claimed[match] = club.get("display") or match
        sets[match].extend(aliases)
        index.add(match, sets[match])
    if espn_clubs:
        missing = [name for name, _short in fpl_teams if name not in claimed]
        if missing:
            raise UnmappedName(
                "These Premier League clubs are missing from the ESPN list, so their other spellings "
                f"are unknown: {missing}."
            )
    return sets


def cluster_historical_names(names: list[str], cfg: dict) -> dict[str, str]:
    """Group spellings inside the historical CSVs. A short name joins a longer one only when unique."""
    _drop, _map, generic = _rules(cfg)
    unique = sorted({n for n in names if n})
    parent = {n: n for n in unique}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    norms = {n: normalize(n, cfg) for n in unique}
    buckets: dict[str, list[str]] = {}
    for name, norm in norms.items():
        buckets.setdefault(norm, []).append(name)
    for group in buckets.values():
        for other in group[1:]:
            union(group[0], other)

    for name in unique:
        ta = norms[name].split()
        hits = []
        for other in unique:
            if other == name:
                continue
            if _soft_ok(ta, norms[other].split(), generic):
                hits.append(other)
        # Unique partner only. A name that is close to two clubs stays on its own.
        if len(hits) == 1:
            union(name, hits[0])
    return {n: find(n) for n in unique}
