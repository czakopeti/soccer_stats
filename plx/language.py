"""Catch Hungarian and Hungarian-English mix in user-facing copy.

The page used to be translated word by word. Accent-stripped leftovers
(jonnek, erteke, oson) and mixed tokens (chancet, pontot) must fail the build.
Internal view keys are not shown to readers and are ignored only when a string
literal is exactly that key.
"""
from __future__ import annotations

import re
import unicodedata
from pathlib import Path

# Exact tokens after accents are folded. Short English words and name
# fragments (ben, van, most, bar) are intentionally absent.
HU_WORDS = {
    "adat", "adataibol", "adatbol", "ahogy", "allapot", "alatta", "amennyit",
    "annal", "aranya", "azonban", "bajnok", "bajnoki", "bajnoksag", "bal",
    "balra", "barmelyik", "becsult", "belul", "benne", "cella", "chancet",
    "cimke", "csak", "csapat", "csapata", "csapatnak", "csapatot", "db",
    "dontetlen", "eddig", "eddigi", "edzovaltas", "edzovaltast", "ehhez",
    "egyebkent", "egyenletes", "ellenfel", "ellenfelei", "ellenfelek",
    "ellenfelet", "ellenfelnek", "ellovas", "elonyet", "elore", "elorebb",
    "elorevitt", "elorevivo", "eloszlas", "eloszlasa", "elott", "elvitt",
    "engedi", "engedett", "erdemelt", "eredmeny", "eredmenye", "ernek", "erteke",
    "erteket", "erteketol", "ertek", "ertekeli", "esely", "eselye", "eselyek",
    "eselyre", "eselyt", "esett", "ez", "fejes", "figyelembe", "fizetodik",
    "fogatlan", "foleny", "folytatas", "forditas", "forditott", "fordulo",
    "forduloi", "fordulok", "fordulon", "fordulot", "fuzodik", "gol", "gól",
    "gyengebb", "gyozelem", "gyujtott", "hany", "hanyadik", "hatra", "hatrabban",
    "hatrebb", "hatravannak", "hazai", "hely", "helyet", "helyezes", "helyezese",
    "helyezest", "helyzet", "helyzetbol", "helyzetei", "helyzetek", "helyzeteket",
    "helyzetet", "helyzetetol", "hellyel", "hibakbol", "hivatalos", "hogy",
    "hozott", "hozza", "hozzaadott", "hoznak", "hozta", "hullamzott",
    "hullajtott", "ideny", "idei", "idegenbeli", "igazat", "igazsag",
    "indokolnak", "ismerete", "ismereteben", "itt", "izgalmas", "izgalmi",
    "jatszik", "jatszok", "jatszott", "jatekos", "jatekosnak", "jatekosok",
    "jatekost", "javul", "jenek", "jobb", "jobban", "jon", "jonne", "jonnek",
    "kapott", "kapu", "kapufa", "kapura", "kapus", "kapusnak", "kapusok",
    "kaput", "karvallott", "kevesebb", "kevesebbet", "kialakitani", "kiemelve",
    "kiesik", "kiegyenlitettebb", "kimenet", "kiraly", "kiserleti", "koppints",
    "korabban", "kov", "kozepes", "kulcspassz", "labda", "legalacsonyabb",
    "legfrissebb", "legjobb", "legjobbja", "legkevesebb", "legkevesebbet",
    "legmagasabb", "legnehezebb", "legtobb", "lejatszott", "lenne", "lepett",
    "lesz", "ligakupa", "lonie", "loves", "lovese", "lovesek", "lovesekbol",
    "lovest", "lott", "magas", "magasabb", "meccs", "meccse", "meccsei",
    "meccsek", "meccsekkel", "meccsen", "meccses", "meccsre", "meccset",
    "megnezheted", "menetrend", "mennyi", "mennyit", "mert", "merkozes",
    "merkozesek", "merkozesen", "merteke", "merve", "mint", "mulva", "mutass",
    "mutasd", "mutatja", "mutato", "mutatok", "mutatta", "mutatott", "nagyjabol",
    "nagyot", "nak", "nap", "napja", "napnal", "napok", "napon", "napot", "nehez",
    "nek", "nel", "nelkul", "nem", "nevehez", "nincs", "nyersen", "nyert",
    "nyertes", "nyertese", "ongol", "ongolok", "ongolt", "oson", "ott", "otthon",
    "otoson", "oldalon", "oldalt", "pedig", "pech", "perc", "percben", "perccel",
    "percet", "percre", "piheno", "pont", "pontja", "pontjai", "pontnyi",
    "pontok", "pontot", "ponttal", "pontrugas", "poszt", "poszton", "rablas",
    "ra", "rang", "rangadoja", "ranglistaja", "rangsor", "rel", "ritkabban",
    "rol", "romlik", "rontgen", "rontgene", "rontgenhez", "rosszabbul", "sarga",
    "sebezheto", "sorrend", "sorozat", "sorozatok", "stabil", "sulyozas",
    "szabadrugas", "szazalek", "szazaleka", "szazalekban", "szazalekot",
    "szepiti", "szerencse", "szerinti", "szerint", "szerezte", "szerzett",
    "szerzi", "szilard", "szoglet", "szokott", "szukul", "tabella", "talalat",
    "tamadas", "tamadast", "tavolsag", "teremteni", "tiszt", "tisztitott",
    "tizenhatos", "tizenhatoson", "tol", "torzit", "tuloz", "tulertekeli",
    "ugyanezen", "utan", "vagy", "vaktipp", "valassz", "valos", "valoban",
    "vartnal", "vedekezes", "vedekezest", "vel", "vendeg", "vereseg",
    "veszelyesebb", "vesztes", "visszaesett", "vitte", "volt", "volna",
    "vezetett", "xgjenek", "zarojelben",
}

# An English football word with a Hungarian case ending glued on: chancet, pontot.
_ROOTS = (
    "strength", "schedule", "defence", "defense", "chance", "minute", "player",
    "attack", "season", "point", "match", "table", "place", "round", "goal",
    "shot", "club", "game", "form", "rank", "side", "week", "win",
)
_ENDINGS = (
    "rol", "rel", "tol", "bol", "ban", "ben", "nak", "nek", "val", "vel",
    "hoz", "hez", "nal", "nel", "bol", "juk", "unk", "jek", "jek", "ja", "je",
    "ra", "re", "ok", "ek", "ot", "et", "at", "ba", "be", "t",
)
_MIXED = re.compile(
    r"^(?:" + "|".join(sorted(_ROOTS, key=len, reverse=True)) + r")"
    r"(?:" + "|".join(sorted(set(_ENDINGS), key=len, reverse=True)) + r")$"
)
# "format" is form+at, "attacked" is not in the ending list. Drop a few
# English words the pattern would otherwise claim.
_MIXED_ALLOW = {"format", "formatted", "formation", "formations", "attacked"}

# String literals that are view keys, storage keys, or codes. Ignored only
# when the whole literal is exactly one of these.
INTERNAL_KEYS = {
    "adatbazis", "alap", "allas", "all", "att", "away", "box", "club", "concedes",
    "date", "def", "elore", "elozetes", "elusz", "eselyek", "excite", "fol",
    "ford", "fordulo", "fpl", "fwd", "gkp", "goals", "gol", "golz", "home",
    "igazsag", "izg", "jatekos", "kre", "kul", "lab", "last5", "lovesek", "lov",
    "meccsek", "men", "mid", "mutatok", "op", "out", "pen", "plx-v1", "power",
    "rob", "schedule", "six", "sp", "stil", "table", "tam", "tamadas", "tisztitott",
    "valodi", "ved", "vedekezes", "xg", "xgd", "xgw",
}


def fold(text: str) -> str:
    flat = unicodedata.normalize("NFKD", text)
    flat = "".join(ch for ch in flat if not unicodedata.combining(ch))
    return flat.lower()


def mask_names(folded: str, names) -> str:
    for name in sorted({fold(n).strip() for n in names if n}, key=len, reverse=True):
        if len(name) < 3:
            continue
        folded = re.sub(rf"\b{re.escape(name)}\b", " ", folded)
    return folded


def token_problem(token: str) -> str | None:
    if token in _MIXED_ALLOW:
        return None
    if token in HU_WORDS:
        return "Hungarian"
    if _MIXED.match(token):
        return "Hungarian ending on an English word"
    return None


def find_hits(text: str, names=()) -> list[str]:
    folded = mask_names(fold(text), names)
    found: list[str] = []
    seen: set[str] = set()
    for match in re.finditer(r"[a-z0-9]+", folded):
        token = match.group(0)
        reason = token_problem(token)
        if not reason:
            continue
        start = max(0, match.start() - 48)
        end = min(len(folded), match.end() + 48)
        snippet = re.sub(r"\s+", " ", folded[start:end]).strip()
        if token == "rel" and re.search(r"rel\s*=", snippet):
            continue
        key = f"{token}|{snippet}"
        if key in seen:
            continue
        seen.add(key)
        found.append(f"{token} ({reason}): {snippet}")
    return found


def _extract_literals(src: str) -> list[str]:
    """Quoted strings, including the static parts of template literals."""
    out: list[str] = []

    def prev_sig(i: int) -> str:
        j = i - 1
        while j >= 0 and src[j] in " \t\n\r":
            j -= 1
        return src[j] if j >= 0 else ""

    def skip_regex(i: int, end: int) -> int:
        i += 1
        in_class = False
        while i < end:
            if src[i] == "\\":
                i += 2
                continue
            if src[i] == "[":
                in_class = True
            elif src[i] == "]":
                in_class = False
            elif src[i] == "/" and not in_class:
                i += 1
                while i < end and src[i].isalpha():
                    i += 1
                return i
            i += 1
        return end

    def walk(i: int, end: int) -> int:
        while i < end:
            ch = src[i]
            if ch == "/" and i + 1 < end and src[i + 1] == "/":
                nxt = src.find("\n", i)
                i = end if nxt < 0 else nxt
                continue
            if ch == "/" and i + 1 < end and src[i + 1] == "*":
                close = src.find("*/", i + 2)
                i = end if close < 0 else close + 2
                continue
            if ch == "/" and prev_sig(i) in "([=,!&|?:{};":
                i = skip_regex(i, end)
                continue
            if ch in "\"'`":
                quote = ch
                i += 1
                buf: list[str] = []
                while i < end:
                    if src[i] == "\\" and i + 1 < end:
                        buf.append(src[i + 1])
                        i += 2
                        continue
                    if quote == "`" and src[i] == "$" and i + 1 < end and src[i + 1] == "{":
                        buf.append(" ")
                        i = walk(i + 2, _brace_end(src, i + 1))
                        continue
                    if src[i] == quote:
                        i += 1
                        break
                    buf.append(src[i])
                    i += 1
                out.append("".join(buf))
                continue
            i += 1
        return i

    walk(0, len(src))
    return out


def _brace_end(src: str, open_at: int) -> int:
    depth = 0
    i = open_at
    while i < len(src):
        if src[i] in "\"'`":
            quote = src[i]
            i += 1
            while i < len(src):
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == quote:
                    i += 1
                    break
                i += 1
            continue
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return len(src)


def literal_hits(src: str) -> list[str]:
    hits: list[str] = []
    for literal in _extract_literals(src):
        folded = fold(literal).strip()
        if folded in INTERNAL_KEYS:
            continue
        if re.fullmatch(r"[a-z0-9_]+", folded) and "_" in folded:
            continue
        hits.extend(find_hits(literal))
    return hits


def scan_user_facing(root: Path) -> list[str]:
    """Source scan of copy a reader can see. Does not open the browser."""
    hits: list[str] = []
    js = root / "web" / "pl_xray.js"
    if js.exists():
        for hit in literal_hits(js.read_text(encoding="utf-8")):
            hits.append(f"web/pl_xray.js: {hit}")
    html = root / "web" / "index.html"
    if html.exists():
        visible = re.sub(r"<script[\s\S]*?</script>", " ", html.read_text(encoding="utf-8"), flags=re.I)
        visible = re.sub(r"<style[\s\S]*?</style>", " ", visible, flags=re.I)
        visible = re.sub(r"<[^>]+>", " ", visible)
        for hit in find_hits(visible):
            hits.append(f"web/index.html: {hit}")
    status = root / "plx" / "build_site.py"
    if status.exists():
        for hit in literal_hits(status.read_text(encoding="utf-8")):
            hits.append(f"plx/build_site.py: {hit}")
    for name in ("README.md", "MODELS.md"):
        path = root / name
        if not path.exists():
            continue
        for hit in find_hits(path.read_text(encoding="utf-8")):
            hits.append(f"{name}: {hit}")
    return hits
