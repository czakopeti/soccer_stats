"""Python copy of the browser strength model (ratings + predict in web/pl_xray.js).

Used for the other leagues' fair odds. tests/test_strength_port.py checks it
against the Premier League acceptance cases, so the two cannot drift apart.
"""
from __future__ import annotations

import math


def ratings(matches: list[dict], teams: list[str], prior: dict[str, float], upto: int, rtg: dict, goal_level: float) -> dict:
    """matches: dicts with gw, h, a, hs, as, xh, xa (played only). Mirrors ratings() in pl_xray.js."""
    tau, k, bl = rtg["tau_rounds"], rtg["prior_matches"], rtg["xg_blend"]
    home = rtg.get("home_advantage", True) is not False
    ms = [m for m in matches if m["gw"] <= upto]
    w = lambda m: math.exp(-(upto - m["gw"]) / tau)
    v = lambda x, g: bl * x + (1 - bl) * g
    sw = sh = sa = 0.0
    for m in ms:
        q = w(m); sw += q; sh += q * v(m["xh"], m["hs"]); sa += q * v(m["xa"], m["as"])
    lg = (sh + sa) / (2 * sw) if sw else goal_level
    if home:
        raise ValueError("home advantage is off in the tested model; the port does not support it")
    hfh = hfa = 1.0
    att = {t: 1.0 for t in teams}; de = {t: 1.0 for t in teams}; by = {t: [] for t in teams}
    for m in ms:
        q = w(m)
        by[m["h"]].append((m["a"], q, v(m["xh"], m["hs"]), v(m["xa"], m["as"]), hfh, hfa))
        by[m["a"]].append((m["h"], q, v(m["xa"], m["as"]), v(m["xh"], m["hs"]), hfa, hfh))

    def norm(o):
        g = math.exp(sum(math.log(o[t]) for t in teams) / len(teams))
        for t in teams:
            o[t] /= g

    for _ in range(rtg["iterations"]):
        for t in teams:
            n = k * lg * math.exp(prior[t] / 2); d = k * lg
            for o, q, f, a, hf, ohf in by[t]:
                n += q * f; d += q * lg * de[o] * hf
            att[t] = n / d
        norm(att)
        for t in teams:
            n = k * lg * math.exp(-prior[t] / 2); d = k * lg
            for o, q, f, a, hf, ohf in by[t]:
                n += q * a; d += q * lg * att[o] * ohf
            de[t] = n / d
        norm(de)
    sg2 = sum(w(m) * (m["hs"] + m["as"]) for m in ms)
    lgp = (sg2 + rtg["goal_prior_matches"] * goal_level) / (2 * sw + rtg["goal_prior_matches"])
    return {"lg": lgp, "att": att, "def": de, "hfH": hfh, "hfA": hfa}


def predict(h: str, a: str, R: dict, rho: float, max_goals: int) -> dict:
    lh = R["lg"] * R["att"][h] * R["def"][a] * R["hfH"]
    la = R["lg"] * R["att"][a] * R["def"][h] * R["hfA"]
    pois = lambda l, n: math.exp(-l) * l ** n / math.factorial(n)
    ph = [pois(lh, i) for i in range(max_goals + 1)]; pa = [pois(la, i) for i in range(max_goals + 1)]

    def tau(i, j):
        if i == 0 and j == 0: return 1 - lh * la * rho
        if i == 0 and j == 1: return 1 + lh * rho
        if i == 1 and j == 0: return 1 + la * rho
        if i == 1 and j == 1: return 1 - rho
        return 1.0

    pw = pd = pl = o25 = 0.0
    for i in range(max_goals + 1):
        for j in range(max_goals + 1):
            p = ph[i] * pa[j] * tau(i, j)
            if i > j: pw += p
            elif i == j: pd += p
            else: pl += p
            if i + j > 2: o25 += p
    tot = pw + pd + pl
    return {"lh": lh, "la": la, "pw": pw / tot, "pd": pd / tot, "pl": pl / tot, "o25": o25 / tot}
