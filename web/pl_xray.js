/* PL X-ray — views, charts and models. Reads the JSON in <script id="data">. */
(function () {
"use strict";
const D = JSON.parse(document.getElementById("data").textContent);
if (!D.cfg || !D.derived) throw new Error("This page is missing its model settings or its measured values.");
const C = D.cfg, TH = C.thresholds, RTG = C.ratings, DER = D.derived, PLACES = C.places;
const M = D.matches, SH = D.shots, OP = D.opta, PL = D.players, FX = D.fx, EURO = D.euro || [];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = (v, d = 1) => v == null || Number.isNaN(+v) ? "–" : (+v).toFixed(d);
const sg = (v, d = 1) => {
  if (v == null) return "–";
  const shown = Math.abs(v).toFixed(d);
  if (+shown === 0) return shown;
  return (v > 0 ? "+" : "−") + shown;
};
const poss = (name) => /s$/i.test(name) ? name + "'" : name + "'s";
const pc = (v) => Math.round(v * 100) + "%";
const pc1 = (v) => v > 0 && v < 0.005 ? "<1%" : v > 0.995 && v < 1 ? ">99%" : Math.round(v * 100) + "%";
function qty(n, one, many, digits) {
  const shown = digits == null ? String(n) : nf(n, digits);
  const singular = Math.abs(+shown) === 1 && !String(shown).includes(".");
  return `${shown} ${singular ? one : many}`;
}
function dayCount(days) {
  const whole = Math.abs(days - Math.round(days)) < 0.05;
  const shown = whole ? String(Math.round(days)) : nf(days, 1);
  return `${shown} ${shown === "1" ? "day" : "days"}`;
}
function restDays(days) {
  return Math.abs(+nf(days, 1)) === 1 ? `${dayCount(days)}'s rest` : `${dayCount(days)}' rest`;
}
function nthBiggest(n) { return n === 1 ? "the biggest" : `the ${ord(n)} biggest`; }
const TEAMS = Object.keys(D.short).sort();
const narrow = () => window.innerWidth < 640;
let saved = {}; try { saved = JSON.parse(localStorage.getItem("plx-v1") || "{}"); } catch (e) { saved = {}; }
const NAV = [["fordulo", "Round", "This week's matches, the next round, and the run of fixtures.", [["fordulo", "Results"], ["elozetes", "Preview"], ["schedule", "Schedule"]]],
  ["igazsag", "Justice", "The table is not the whole story. Who is actually playing well, and why.", [["valodi", "True strength"], ["tamadas", "Attack"], ["vedekezes", "Defence"], ["table", "Justice table"], ["tisztitott", "Adjusted xG"], ["power", "Power"], ["eselyek", "Chances"]]],
  ["adatbazis", "Database", "Every club, player, match and shot. Search, filter, sort.", [["mutatok", "Clubs"], ["club", "Club X-ray"], ["jatekos", "Players"], ["meccsek", "Matches"], ["lovesek", "Shots"]]]];
const TABK = NAV.flatMap(n => n[3].map(x => x[0]));
const mainOf = (k) => (NAV.find(n => n[3].some(x => x[0] === k)) || NAV[0]);
const S = { gw: D.gw, tab: TABK.includes(saved.tab) ? saved.tab : saved.tab === "elore" ? "eselyek" : "fordulo", lastSub: {}, open: null, team: saved.team || null, mode: "all", p90: false, pmin: TH.min_minutes_default, pteam: "", psel: null, pcmp: null, tsort: "rank", sim: null, simGw: null,
  grp: "gol", ppos: "", psort: null, q: "", plim: 25, tgrp: "alap", tms: null, tick: 6 };
const persist = () => { try { localStorage.setItem("plx-v1", JSON.stringify({ tab: S.tab, team: S.team })); } catch (e) { /* ignore */ } };
const I = { gw: 0, fid: 1, team: 2, opp: 3, pl: 4, as: 5, min: 6, x: 7, y: 8, xg: 9, res: 10, sit: 11, typ: 12, last: 13, pid: 14 };
const short = (t) => D.short[t] || t;
const nm = (t) => narrow() ? short(t) : t;
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const KO = new Intl.DateTimeFormat("en-GB", { timeZone: C.display_timezone, weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
function heatRGB(u, a = 1) { u = Math.max(0, Math.min(1, u)); const A = [255, 107, 122], Mi = [58, 64, 94], G = [87, 217, 154]; const [c1, c2, v] = u < .5 ? [A, Mi, u * 2] : [Mi, G, (u - .5) * 2]; return `rgba(${c1.map((c, i) => Math.round(c + (c2[i] - c) * v)).join(",")},${a})`; }
const RESN = { G: "goal", S: "saved", M: "off target", B: "blocked", P: "post", O: "own goal" };
const LAST = { Pass: "a pass", Cross: "a cross", Aerial: "an aerial", Rebound: "a rebound", TakeOn: "a take-on", Chipped: "a chip", Standard: "a set piece", BallTouch: "a touch", BallRecovery: "a recovery", HeadPass: "a headed pass", Throughball: "a through ball", LayOff: "a lay-off", Dispossessed: "losing the ball", CornerAwarded: "a corner", BlockedPass: "a blocked pass", None: "no assist" };
const SETP = new Set(C.set_piece_situations);
const grpOf = (sit) => sit === "penalty" ? "pen" : SETP.has(sit) ? "sp" : "op";

/* ---------- core aggregation ---------- */
function teamMatches(t, upto) { return M.filter(m => m.gw <= upto && (m.h === t || m.a === t)).sort((a, b) => a.gw - b.gw); }
function persp(m, t) { const h = m.h === t; return { t, o: h ? m.a : m.h, home: h, gf: h ? m.hs : m.as, ga: h ? m.as : m.hs, xg: h ? m.xh : m.xa, xga: h ? m.xa : m.xh, p: h ? m.ph : m.pa, xp: h ? m.xph : m.xpa, gw: m.gw, m }; }
function table(upto, mode = "all") {
  const rows = TEAMS.map(t => {
    let ms = teamMatches(t, upto).map(m => persp(m, t));
    if (mode === "home") ms = ms.filter(x => x.home); else if (mode === "away") ms = ms.filter(x => !x.home); else if (mode === "last5") ms = ms.slice(-5);
    const r = { t, P: ms.length, W: 0, D: 0, L: 0, pts: 0, xpts: 0, gf: 0, ga: 0, xg: 0, xga: 0, form: [] };
    for (const x of ms) { r.pts += x.p; r.xpts += x.xp; r.gf += x.gf; r.ga += x.ga; r.xg += x.xg; r.xga += x.xga; if (x.p === 3) r.W++; else if (x.p === 1) r.D++; else r.L++; r.form.push({ gw: x.gw, d: x.xg - x.xga, p: x.p }); }
    r.gd = r.gf - r.ga; r.luck = r.pts - r.xpts; return r;
  });
  const act = rows.slice().sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf); act.forEach((r, i) => r.rank = i + 1);
  rows.slice().sort((a, b) => b.xpts - a.xpts || (b.xg - b.xga) - (a.xg - a.xga)).forEach((r, i) => r.xrank = i + 1);
  return act;
}
const shotsUpTo = (gw) => SH.filter(s => s[I.gw] <= gw);
function verdictRaw(m) { const res = m.hs > m.as ? "H" : m.hs < m.as ? "A" : "D"; return { res, pAct: res === "H" ? m.pw : res === "A" ? m.pl : m.pd, win: res === "H" ? m.h : res === "A" ? m.a : null, lose: res === "H" ? m.a : res === "A" ? m.h : null }; }
// season-long robbery ranking (lowest winning probability among all wins so far)
function robberyRank(m, upto) { const wins = M.filter(x => x.gw <= upto && x.hs !== x.as).map(x => verdictRaw(x).pAct).sort((a, b) => a - b); const v = verdictRaw(m).pAct; return wins.filter(p => p < v).length + 1; }
function verdict(m) {
  const { res, pAct, win, lose } = verdictRaw(m);
  const pLoseWin = res === "H" ? m.pl : res === "A" ? m.pw : 0;
  if (win && pAct < TH.robbery_win_probability) { const rk = robberyRank(m, S.gw); return { tag: "Robbery", cls: "rob", txt: `<b>${esc(win)}</b> won, though the shots gave them only a ${pc(pAct)} chance${pLoseWin > 0.4 ? `, against ${pc(pLoseWin)} for ${esc(lose)}` : ""}.${rk <= 5 ? ` ${nthBiggest(rk)[0].toUpperCase()}${nthBiggest(rk).slice(1)} robbery of the season so far.` : ""}` }; }
  if (!win && Math.max(m.pw, m.pl) > TH.blown_win_probability) { const t = m.pw > m.pl ? m.h : m.a; return { tag: "Blown win", cls: "rob", txt: `<b>${esc(t)}</b> had a ${pc(Math.max(m.pw, m.pl))} chance of winning and only drew.` }; }
  if (win && pAct > TH.dominance_win_probability && Math.abs(m.xh - m.xa) > TH.dominance_xg_diff) return { tag: "Deserved", cls: "dom", txt: `<b>${esc(win)}</b> won, and the shots agreed: a ${pc(pAct)} chance.` };
  return { tag: "Fair", cls: "", txt: win ? `The shots gave ${esc(win)} a ${pc(pAct)} chance of winning.` : `From the shots, the draw was a ${pc(pAct)} chance.` };
}

/* ---------- insights ---------- */
function insights() {
  const gw = S.gw, out = [];
  const rows = M.filter(m => m.gw === gw);
  // 1. robbery or dominance of the round
  const rob = rows.map(m => ({ m, ...verdictRaw(m) })).filter(x => x.win).sort((a, b) => a.pAct - b.pAct)[0];
  if (rob && rob.pAct < TH.robbery_win_probability) { const rk = robberyRank(rob.m, gw); out.push({ c: "var(--gold)", h: "Robbery of the round", t: `<b>${esc(rob.win)}</b> beat ${esc(rob.lose)} with only a ${pc(rob.pAct)} chance from the shots. ${rk === 1 ? "The biggest robbery of the season so far." : `${nthBiggest(rk)[0].toUpperCase()}${nthBiggest(rk).slice(1)} robbery of the season so far.`}` }); }
  else { const dom = rows.map(m => ({ m, d: Math.abs(m.xh - m.xa), t: m.xh > m.xa ? m.h : m.a, o: m.xh > m.xa ? m.a : m.h })).sort((a, b) => b.d - a.d)[0]; out.push({ c: "var(--good)", h: "Control of the round", t: `<b>${esc(dom.t)}</b> created ${nf(dom.d, 1)} xG more than ${esc(dom.o)}. No robbery this weekend.` }); }
  // 2. justice gap
  const tab = table(gw); const worst = tab.slice().sort((a, b) => a.luck - b.luck)[0], best = tab.slice().sort((a, b) => b.luck - a.luck)[0];
  out.push({ c: "var(--home)", h: "The table is lying", t: `<b>${esc(worst.t)}</b> sit ${ord(worst.rank)}. The shots put them ${ord(worst.xrank)}: ${nf(Math.abs(worst.luck), 1)} points ${worst.luck < 0 ? "short of" : "ahead of"} the chances. At the other end, ${esc(best.t)} are ${nf(Math.abs(best.luck), 1)} points ${best.luck > 0 ? "better off" : "worse off"} than the chances say.` });
  // 3. rotating trend: last-3 form, set-piece dependence or finishing
  const l3 = TEAMS.map(t => { const ms = teamMatches(t, gw).slice(-3).map(m => persp(m, t)); return { t, d: ms.reduce((a, x) => a + x.xg - x.xga, 0), n: ms.length }; }).sort((a, b) => b.d - a.d);
  const sh = shotsUpTo(gw); const spShare = TEAMS.map(t => { const a = sh.filter(s => s[I.team] === t); const tot = a.reduce((q, s) => q + s[I.xg], 0); const sp = a.filter(s => grpOf(s[I.sit]) === "sp").reduce((q, s) => q + s[I.xg], 0); return { t, f: tot ? sp / tot : 0 }; }).sort((a, b) => b.f - a.f);
  const pick = gw % 3;
  if (pick === 0) out.push({ c: "var(--away)", h: "Form", t: `Over the last three matches <b>${esc(l3[0].t)}</b> have the best chance difference in the league: ${sg(l3[0].d, 1)} xG. The worst is ${esc(l3[l3.length - 1].t)} (${sg(l3[l3.length - 1].d, 1)}).` });
  else if (pick === 1) out.push({ c: "var(--away)", h: "Set pieces", t: `<b>${esc(spShare[0].t)}</b> get ${pc(spShare[0].f)} of their xG from set pieces, the highest share in the league. ${esc(spShare[spShare.length - 1].t)} rely on them least (${pc(spShare[spShare.length - 1].f)}).` });
  else { const fin = PL.filter(p => p.min >= TH.min_minutes_default).map(p => ({ p, d: p.g - p.xg })).sort((a, b) => b.d - a.d); const top = fin[0], bot = fin[fin.length - 1]; const versus = (d) => `${nf(Math.abs(d), 1)} ${d >= 0 ? "ahead of" : "short of"} the chances`; out.push({ c: "var(--away)", h: "Finishing", t: `<b>${esc(top.p.n)}</b> (${esc(top.p.t)}) has ${qty(top.p.g, "goal", "goals")} from ${nf(top.p.xg, 1)} xG, ${versus(top.d)}, the best finishing in the league. At the other end, ${esc(bot.p.n)}: ${qty(bot.p.g, "goal", "goals")} from ${nf(bot.p.xg, 1)} xG, ${versus(bot.d)}.` }); }
  return `<div class="insights">${out.map((o, i) => `<div class="ins" style="--c:${o.c};animation-delay:${i * 60}ms"><span class="n">${i + 1} · ${esc(o.h)}</span><p>${o.t}</p></div>`).join("")}</div>`;
}

/* ---------- SVG pieces ---------- */
function flow(m) {
  const W = 320, H = 96, L = 4, R = 30, T = 8, B = 14;
  const sh = m.shots; const maxMin = Math.max(95, ...sh.map(s => s[0] + 1));
  let ch = 0, ca = 0; const ph = [[0, 0]], pa = [[0, 0]], goals = [];
  for (const [we, side, xg, res] of sh) {
    if (res === "O") { goals.push([we, side === 0 ? 1 : 0, side === 0 ? ca : ch, true]); continue; }
    if (side === 0) { ph.push([we, ch]); ch += xg; ph.push([we, ch]); if (res === "G") goals.push([we, 0, ch, false]); }
    else { pa.push([we, ca]); ca += xg; pa.push([we, ca]); if (res === "G") goals.push([we, 1, ca, false]); }
  }
  ph.push([maxMin, ch]); pa.push([maxMin, ca]);
  const ym = Math.max(1.2, ch, ca) * 1.08;
  const x = (v) => L + v / maxMin * (W - L - R), y = (v) => T + (1 - v / ym) * (H - T - B);
  const path = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const area = (pts, col) => `<path d="${path(pts)}L${x(maxMin)},${y(0)}L${x(0)},${y(0)}Z" fill="${col}" fill-opacity=".07"/>`;
  let g = `<line x1="${x(45)}" x2="${x(45)}" y1="${T}" y2="${H - B}" stroke="#252b45" stroke-dasharray="2 3"/><text x="${x(45)}" y="${H - 3}" text-anchor="middle">45'</text><text x="${x(90)}" y="${H - 3}" text-anchor="middle">90'</text>`;
  g += area(ph, "var(--home)") + area(pa, "var(--away)") + `<path d="${path(ph)}" fill="none" stroke="var(--home)" stroke-width="2"/><path d="${path(pa)}" fill="none" stroke="var(--away)" stroke-width="2"/>`;
  const dy = Math.abs(y(ca) - y(ch)) < 10 ? (ca > ch ? -6 : 12) : 3;
  g += `<text x="${W - R + 4}" y="${y(ch) + 3}" style="fill:var(--home);font-weight:700">${nf(ch, 2)}</text><text x="${W - R + 4}" y="${y(ca) + dy}" style="fill:var(--away);font-weight:700">${nf(ca, 2)}</text>`;
  for (const [we, side, v, og] of goals) g += `<circle cx="${x(we).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" fill="${og ? "none" : "var(--gold)"}" stroke="var(--gold)" stroke-width="1.5"><title>${we}' ${og ? "own goal" : "goal"}</title></circle>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative xG by minute">${g}</svg>`;
}
function halfPitch(shots, col, label, rs = 1) {
  const W = 80, H = 50;
  let g = `<rect x="0" y="0" width="${W}" height="${H}" fill="var(--pitch)"/><g fill="none" stroke="#ffffff" stroke-opacity=".18" stroke-width=".35"><rect x=".2" y=".2" width="79.6" height="49.6"/><rect x="18" y=".2" width="44" height="18"/><rect x="30" y=".2" width="20" height="6"/><path d="M32.7 18 A10 10 0 0 0 47.3 18"/><circle cx="40" cy="12" r=".4" fill="#fff"/></g><rect x="36" y="-1.6" width="8" height="1.8" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width=".35"/>`;
  const sorted = shots.slice().sort((a, b) => (a[I.res] === "G") - (b[I.res] === "G") || a[I.xg] - b[I.xg]);
  for (const s of sorted) { if (s[I.res] === "O") continue;
    const cx = s[I.y], cy = Math.min(H - 1, Math.max(0.6, 120 - s[I.x])), r = (0.7 + Math.sqrt(s[I.xg]) * 5.2) * rs, goal = s[I.res] === "G";
    g += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(2)}" fill="${goal ? "var(--gold)" : col}" fill-opacity="${goal ? .95 : s[I.res] === "S" || s[I.res] === "P" ? .35 : .1}" stroke="${goal ? "#0a0d18" : col}" stroke-width="${goal ? .3 : .35}" stroke-opacity="${goal ? 1 : .8}"><title>${esc(s[I.pl])} ${s[I.min]}' · xG ${nf(s[I.xg], 2)} · ${RESN[s[I.res]]} · ${esc(s[I.sit])}</title></circle>`; }
  return `<svg class="chart" viewBox="-1 -2 82 52" role="img" aria-label="${esc(label || "Shot map")}">${g}</svg>`;
}
function spark(form) {
  const W = 90, H = 22, n = Math.max(1, form.length), bw = W / Math.max(8, n);
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${form.map((f, i) => { const v = Math.max(-2.5, Math.min(2.5, f.d)), h = Math.abs(v) / 2.5 * (H / 2 - 1); return `<rect x="${(i * bw + 1).toFixed(1)}" width="${(bw - 2).toFixed(1)}" y="${v >= 0 ? H / 2 - h : H / 2}" height="${Math.max(1, h).toFixed(1)}" fill="${v >= 0 ? "var(--good)" : "var(--bad)"}" opacity=".85"><title>Gameweek ${f.gw}: ${sg(f.d, 2)} xG</title></rect>`; }).join("")}<line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="#3a4266"/></svg>`;
}
function slope(rows) {
  const nw = narrow(), W = nw ? 340 : 470, H = rows.length * 22 + 30, L = nw ? 100 : 145, R = nw ? 100 : 140, T = 18, y = (r) => T + (r - 1) * 22;
  const nm = (t) => nw && t.length > 9 ? (D.short[t] || t.slice(0, 9)) : t;
  let g = `<text x="${L - 8}" y="10" text-anchor="end" style="font-size:10px">TABLE</text><text x="${W - R + 8}" y="10" style="font-size:10px">ON THE CHANCES</text>`;
  for (const r of rows) { const d = r.rank - r.xrank; const col = d > 2 ? "var(--good)" : d < -2 ? "var(--bad)" : "#56607f"; const sel = S.team === r.t;
    g += `<line x1="${L}" x2="${W - R}" y1="${y(r.rank)}" y2="${y(r.xrank)}" stroke="${col}" stroke-width="${sel ? 3 : 1.6}" opacity="${S.team && !sel ? .35 : .9}"/>`;
    g += `<text x="${L - 8}" y="${y(r.rank) + 3.5}" text-anchor="end" style="fill:${sel ? "var(--gold)" : "var(--ink)"};font-size:11px">${r.rank}. ${esc(nm(r.t))}</text><text x="${W - R + 8}" y="${y(r.xrank) + 3.5}" style="fill:${sel ? "var(--gold)" : "var(--muted)"};font-size:11px">${r.xrank}. ${esc(nm(r.t))}</text><circle cx="${L}" cy="${y(r.rank)}" r="3" fill="${col}"/><circle cx="${W - R}" cy="${y(r.xrank)}" r="3" fill="${col}"/>`; }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="League place against place on the chances">${g}</svg>`;
}
function bump(rankFn) {
  const nw = narrow(), W = nw ? 360 : 640, H = TEAMS.length * 16 + 30, L = 10, R = nw ? 46 : 120, T = 12;
  const ranks = {}; for (const t of TEAMS) ranks[t] = [];
  for (let g = 1; g <= S.gw; g++) { if (rankFn) { const rk = rankFn(g); for (const t of TEAMS) ranks[t].push(rk[t]); } else table(g).forEach(r => ranks[r.t].push(r.rank)); }
  const x = (i) => L + (S.gw === 1 ? 0 : i / (S.gw - 1)) * (W - L - R), y = (r) => T + (r - 1) * 16;
  let g = ""; for (let i = 0; i < S.gw; i++) g += `<text x="${x(i)}" y="${H - 4}" text-anchor="middle">${i + 1}.</text>`;
  const order = TEAMS.slice().sort((a, b) => (a === S.team) - (b === S.team));
  for (const t of order) { const rr = ranks[t]; const sel = t === S.team; const col = sel ? "var(--gold)" : "#4a5378";
    g += `<path d="${rr.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r)}`).join("")}" fill="none" stroke="${col}" stroke-width="${sel ? 3 : 1.3}" opacity="${sel ? 1 : .6}" stroke-linejoin="round"/>`;
    const lr = rr[rr.length - 1]; g += `<circle cx="${x(S.gw - 1)}" cy="${y(lr)}" r="${sel ? 4 : 2.5}" fill="${col}"/><text x="${x(S.gw - 1) + 7}" y="${y(lr) + 3.5}" style="fill:${sel ? "var(--gold)" : "var(--muted)"};font-size:10px">${esc(nw ? D.short[t] : t)}</text>`; }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Place after each gameweek">${g}</svg>`;
}
function scatter(rows) {
  const W = narrow() ? 360 : 560, H = 340, L = 40, R = 12, T = 14, B = 34;
  const pts = rows.map(r => ({ t: r.t, x: r.xg / Math.max(1, r.P), y: r.xga / Math.max(1, r.P) }));
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y), x0 = Math.min(...xs) * .92, x1 = Math.max(...xs) * 1.05, y0 = Math.min(...ys) * .92, y1 = Math.max(...ys) * 1.05;
  const px = (v) => L + (v - x0) / (x1 - x0) * (W - L - R), py = (v) => T + (v - y0) / (y1 - y0) * (H - T - B);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let g = `<rect x="${px(mx)}" y="${T}" width="${W - R - px(mx)}" height="${py(my) - T}" fill="var(--good)" fill-opacity=".06"/><rect x="${L}" y="${py(my)}" width="${px(mx) - L}" height="${H - B - py(my)}" fill="var(--bad)" fill-opacity=".06"/>`;
  g += `<line x1="${px(mx)}" x2="${px(mx)}" y1="${T}" y2="${H - B}" stroke="#2f3656" stroke-dasharray="3 3"/><line x1="${L}" x2="${W - R}" y1="${py(my)}" y2="${py(my)}" stroke="#2f3656" stroke-dasharray="3 3"/>`;
  g += `<text x="${W - R - 4}" y="${T + 12}" text-anchor="end" style="fill:var(--good)">strong at both ends</text><text x="${L + 4}" y="${H - B - 6}" style="fill:var(--bad)">weak at both ends</text>`;
  for (let i = 0; i <= 4; i++) { const v = x0 + (x1 - x0) * i / 4, w = y0 + (y1 - y0) * i / 4; g += `<text x="${px(v)}" y="${H - B + 13}" text-anchor="middle">${nf(v, 1)}</text><text x="${L - 5}" y="${py(w) + 3}" text-anchor="end">${nf(w, 1)}</text>`; }
  g += `<text x="${W - R}" y="${H - 4}" text-anchor="end">xG created per match →</text><text x="${L}" y="${T - 4}">xG conceded per match, down is more</text>`;
  const boxes = [];
  for (const p of pts.sort((a, b) => (a.t === S.team) - (b.t === S.team))) { const cx = px(p.x), cy = py(p.y), sel = p.t === S.team;
    g += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${sel ? 6 : 4.5}" fill="${sel ? "var(--gold)" : "var(--home)"}" fill-opacity="${sel ? 1 : .5}" stroke="${sel ? "var(--gold)" : "var(--home)"}" data-t="${esc(p.t)}" style="cursor:pointer"><title>${esc(p.t)}: ${nf(p.x, 2)} xG, ${nf(p.y, 2)} xGA per match</title></circle>`;
    const lab = narrow() ? D.short[p.t] : p.t, w = lab.length * 5.6, left = cx + 8 + w > W - 4, bx = left ? cx - 8 - w : cx + 8, by = cy - 6;
    if (!sel && boxes.some(b => bx < b[0] + b[2] && bx + w > b[0] && by < b[1] + 11 && by + 11 > b[1])) continue; boxes.push([bx, by, w]);
    g += `<text x="${bx.toFixed(1)}" y="${(cy + 3).toFixed(1)}" style="fill:${sel ? "var(--gold)" : "var(--ink)"};font-size:9.5px">${esc(lab)}</text>`; }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Attack and defence">${g}</svg>`;
}
function rolling(t) {
  const ms = teamMatches(t, S.gw).map(m => persp(m, t)); if (!ms.length) return "";
  const W = narrow() ? 360 : 560, H = 170, L = 30, R = 10, T = 12, B = 26;
  const mx = Math.max(2.5, ...ms.map(x => Math.max(x.xg, x.xga))) * 1.1, n = ms.length;
  const x = (i) => L + (n === 1 ? .5 : i / (n - 1)) * (W - L - R), y = (v) => T + (1 - v / mx) * (H - T - B);
  const roll = (k) => ms.map((_, i) => { const a = ms.slice(Math.max(0, i - 2), i + 1); return a.reduce((q, z) => q + z[k], 0) / a.length; });
  const rf = roll("xg"), ra = roll("xga");
  let g = ""; for (const v of [0, 1, 2, 3]) if (v <= mx) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#1f2440"/><text x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
  const band = rf.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("") + ra.slice().reverse().map((v, j) => `L${x(n - 1 - j).toFixed(1)},${y(v).toFixed(1)}`).join("") + "Z";
  g += `<path d="${band}" fill="${rf[n - 1] >= ra[n - 1] ? "var(--good)" : "var(--bad)"}" fill-opacity=".08"/>`;
  g += `<path d="${rf.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("")}" fill="none" stroke="var(--home)" stroke-width="2.4"/><path d="${ra.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("")}" fill="none" stroke="var(--away)" stroke-width="2.4"/>`;
  ms.forEach((z, i) => { g += `<circle cx="${x(i)}" cy="${y(z.xg)}" r="2.2" fill="var(--home)" opacity=".55"/><circle cx="${x(i)}" cy="${y(z.xga)}" r="2.2" fill="var(--away)" opacity=".55"/><circle cx="${x(i)}" cy="${H - 8}" r="4.5" fill="${z.p === 3 ? "var(--good)" : z.p === 1 ? "#6b7394" : "var(--bad)"}"><title>Gameweek ${z.gw}, ${z.home ? "home" : "away"} against ${esc(z.o)}: ${z.gf}–${z.ga} (xG ${nf(z.xg, 2)}–${nf(z.xga, 2)})</title></circle>`; });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Rolling xG, created and conceded">${g}</svg>`;
}

/* ---------- team strength model: opponent-adjusted, recency-weighted xG ratings ---------- */
const RT = {};
function ord(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function ratings(upto, opt) {
  const o = Object.assign({ tau: RTG.tau_rounds, k: RTG.prior_matches, bl: RTG.xg_blend, home: RTG.home_advantage !== false }, opt || {}), key = `${upto}|${o.tau}|${o.k}|${o.bl}|${o.home}`;
  if (RT[key]) return RT[key];
  const ms = M.filter(m => m.gw <= upto), tau = o.tau, k = o.k, bl = o.bl, PR = D.prior || {};
  for (const t of TEAMS) if (PR[t] == null) throw new Error("No pre-season strength for " + t);
  const w = (m) => Math.exp(-(upto - m.gw) / tau), v = (x, g) => bl * x + (1 - bl) * g;
  let sw = 0, sh = 0, sa = 0; for (const m of ms) { const q = w(m); sw += q; sh += q * v(m.xh, m.hs); sa += q * v(m.xa, m.as); }
  const lg = sw ? (sh + sa) / (2 * sw) : RTG.goal_level_prior;
  const homeN = RTG.home_prior_matches;
  const ratio = o.home ? (sh + homeN * lg * DER.home_factor) / (sa + homeN * lg * DER.away_factor) : 1, hfH = Math.sqrt(ratio), hfA = 1 / hfH;
  const att = {}, def = {}, by = {}; for (const t of TEAMS) { att[t] = 1; def[t] = 1; by[t] = []; }
  for (const m of ms) { const q = w(m); by[m.h].push({ o: m.a, q, f: v(m.xh, m.hs), a: v(m.xa, m.as), hf: hfH, ohf: hfA }); by[m.a].push({ o: m.h, q, f: v(m.xa, m.as), a: v(m.xh, m.hs), hf: hfA, ohf: hfH }); }
  const norm = (o) => { const g = Math.exp(TEAMS.reduce((s, t) => s + Math.log(o[t]), 0) / TEAMS.length); for (const t of TEAMS) o[t] /= g; };
  for (let it = 0; it < RTG.iterations; it++) {
    for (const t of TEAMS) { let n = k * lg * Math.exp((PR[t] || 0) / 2), d = k * lg; for (const x of by[t]) { n += x.q * x.f; d += x.q * lg * def[x.o] * x.hf; } att[t] = n / d; }
    norm(att);
    for (const t of TEAMS) { let n = k * lg * Math.exp(-(PR[t] || 0) / 2), d = k * lg; for (const x of by[t]) { n += x.q * x.a; d += x.q * lg * att[x.o] * x.ohf; } def[t] = n / d; }
    norm(def);
  }
  // goal scale: calibrated to real goals per team-match (prior 1.40), xG only sets the ratios
  let sg2 = 0; for (const m of ms) sg2 += w(m) * (m.hs + m.as);
  const lgp = (sg2 + RTG.goal_prior_matches * RTG.goal_level_prior) / (2 * sw + RTG.goal_prior_matches);
  const pw = {}; for (const t of TEAMS) pw[t] = lgp * (att[t] - def[t]);
  const order = TEAMS.slice().sort((a, b) => pw[b] - pw[a]), rank = {}, ar = {}, dr = {};
  order.forEach((t, i) => rank[t] = i + 1);
  TEAMS.slice().sort((a, b) => att[b] - att[a]).forEach((t, i) => ar[t] = i + 1); TEAMS.slice().sort((a, b) => def[a] - def[b]).forEach((t, i) => dr[t] = i + 1);
  return (RT[key] = { lg: lgp, lgFit: lg, hfH, hfA, att, def, pw, rank, order, ar, dr });
}
const FACT = [1]; for (let i = 1; i < 12; i++) FACT[i] = FACT[i - 1] * i;
const pois = (l, k) => Math.exp(-l) * Math.pow(l, k) / FACT[k];
function predict(h, a, R) {
  const lh = R.lg * R.att[h] * R.def[a] * R.hfH, la = R.lg * R.att[a] * R.def[h] * R.hfA;
  const ph = [], pa = [], maxG = C.prediction.max_goals; for (let i = 0; i <= maxG; i++) { ph[i] = pois(lh, i); pa[i] = pois(la, i); }
  let pw = 0, pd = 0, pl = 0, o25 = 0, btts = 0; const sc = [];
  const rho = C.prediction.dixon_coles_rho, tau = (i, j) => i === 0 && j === 0 ? 1 - lh * la * rho : i === 0 && j === 1 ? 1 + lh * rho : i === 1 && j === 0 ? 1 + la * rho : i === 1 && j === 1 ? 1 - rho : 1;
  for (let i = 0; i <= maxG; i++) for (let j = 0; j <= maxG; j++) { const p = ph[i] * pa[j] * tau(i, j); if (i > j) pw += p; else if (i === j) pd += p; else pl += p; if (i + j > 2) o25 += p; if (i && j) btts += p; sc.push([i, j, p]); }
  const tot = pw + pd + pl; sc.sort((x, y) => y[2] - x[2]);
  const c0 = (z) => sc.filter(q => z(q)).reduce((a, q) => a + q[2], 0) / tot;
  return { lh, la, pw: pw / tot, pd: pd / tot, pl: pl / tot, o25: o25 / tot, btts: btts / tot, csH: c0(q => q[1] === 0), csA: c0(q => q[0] === 0), top: sc.slice(0, 3).map(q => [q[0], q[1], q[2] / tot]), cells: sc.map(q => [q[0], q[1], q[2] / tot]) };
}
const xpOf = (p, home) => home ? 3 * p.pw + p.pd : 3 * p.pl + p.pd;
function predFor(t, o, home, R) { const p = home ? predict(t, o, R) : predict(o, t, R); return { p, xp: xpOf(p, home) }; }

/* ---------- cleaned xG: venue- and opponent-adjusted ---------- */
// xG divided by what an average team creates against this opponent at this venue (xG-only model, no goals, no recency)
const cleanR = (upto) => ratings(upto, { bl: RTG.clean_xg_blend, tau: RTG.clean_tau_rounds, k: RTG.clean_prior_matches, home: RTG.clean_home_advantage !== false });
function adjMatch(m, t, R) {
  const z = persp(m, t), o = z.o, hf = z.home ? R.hfH : R.hfA, ohf = z.home ? R.hfA : R.hfH;
  return { ...z, ax: z.xg / (R.def[o] * hf), axa: z.xga / (R.att[o] * ohf), eF: R.lgFit * R.def[o] * hf, eA: R.lgFit * R.att[o] * ohf };
}
function cleanTable(upto) {
  const R = cleanR(upto);
  const rows = TEAMS.map(t => { const ms = teamMatches(t, upto).map(m => adjMatch(m, t, R)), n = Math.max(1, ms.length), sum = (k) => ms.reduce((a, x) => a + x[k], 0);
    return { t, P: ms.length, xg: sum("xg") / n, xga: sum("xga") / n, ax: sum("ax") / n, axa: sum("axa") / n, home: ms.filter(x => x.home).length }; });
  for (const r of rows) { r.xgd = r.xg - r.xga; r.axgd = r.ax - r.axa; r.fx = r.axgd - r.xgd; }
  rows.slice().sort((a, b) => b.xgd - a.xgd).forEach((r, i) => r.rr = i + 1); rows.slice().sort((a, b) => b.axgd - a.axgd).forEach((r, i) => r.ar = i + 1);
  return rows.sort((a, b) => a.ar - b.ar);
}
function cleanChart(rows) {
  const nw = narrow(), W = nw ? 360 : 560, rh = 19, T = 22, H = T + rows.length * rh + 24, L = nw ? 74 : 116, Rr = 50;
  const vs = rows.flatMap(r => [r.xgd, r.axgd]), x0 = Math.min(...vs) - .1, x1 = Math.max(...vs) + .1, px = (v) => L + (v - x0) / (x1 - x0) * (W - L - Rr);
  let g = `<line x1="${px(0)}" x2="${px(0)}" y1="${T - 8}" y2="${H - 22}" stroke="#2f3656" stroke-dasharray="3 3"/><text x="${px(0)}" y="${T - 10}" text-anchor="middle">0</text><text x="${L}" y="${H - 6}">← worse</text><text x="${W - Rr}" y="${H - 6}" text-anchor="end">better →</text>`;
  rows.forEach((r, i) => { const y = T + i * rh + 6, sel = r.t === S.team, up = r.axgd >= r.xgd;
    g += `<text x="${L - 8}" y="${y + 3.5}" text-anchor="end" style="fill:${sel ? "var(--gold)" : "var(--ink)"};font-size:10.5px">${r.ar}. ${esc(nw ? short(r.t) : r.t)}</text><line x1="${px(r.xgd)}" x2="${px(r.axgd)}" y1="${y}" y2="${y}" stroke="${up ? "var(--good)" : "var(--bad)"}" stroke-width="2" opacity=".65"/>
      <circle cx="${px(r.xgd)}" cy="${y}" r="3.8" fill="var(--bg)" stroke="#8f97b4" stroke-width="1.5"><title>${esc(r.t)} raw xG difference: ${sg(r.xgd, 2)} per match</title></circle><circle cx="${px(r.axgd)}" cy="${y}" r="4.6" fill="${sel ? "var(--gold)" : "var(--home)"}" data-t="${esc(r.t)}" style="cursor:pointer"><title>${esc(r.t)} adjusted xG difference: ${sg(r.axgd, 2)} per match</title></circle>
      <text x="${W - Rr + 6}" y="${y + 3.5}" style="fill:${up ? "var(--good)" : "var(--bad)"}">${sg(r.fx, 2)}</text>`; });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Raw and adjusted xG difference">${g}</svg>`;
}
function cleanSection() {
  const rows = cleanTable(S.gw), hard = rows.slice().sort((a, b) => b.fx - a.fx)[0], easy = rows.slice().sort((a, b) => a.fx - b.fx)[0], R = cleanR(S.gw);
  const moved = (r) => `${ord(r.rr)} on raw xG, ${ord(r.ar)} once adjusted`;
  return `<section class="sec"><div class="sechead"><h2>Adjusted xG</h2><span class="kicker">Opponent and venue removed · after gameweek ${S.gw}</span></div>
    <p class="note">Raw xG flatters a side that plays at home, or that keeps meeting a weak defence. Each match here is divided by what an average club would create against that opponent, at that ground. Chances conceded are divided by that opponent's attack. What is left is the xG a club would have created and allowed against an average opponent on a neutral pitch. Home advantage is worth about ${pc(R.hfH * R.hfH - 1)} more xG at the moment. Only this season's xG is used: not goals, and with no recency weighting.</p>
    <div class="insights"><div class="ins" style="--c:var(--good)"><span class="n">Hardest run</span><p><b>${esc(hard.t)}</b> have faced tougher grounds and tougher opponents than the rest. Adjusted, they are ${nf(Math.abs(hard.fx), 2)} xG per match better than the raw numbers (${moved(hard)}).</p></div>
    <div class="ins" style="--c:var(--bad)"><span class="n">Easiest run</span><p>The schedule flatters <b>${esc(easy.t)}</b>. Adjusted, they are ${nf(Math.abs(easy.fx), 2)} xG per match worse than the raw numbers (${moved(easy)}).</p></div>
    <div class="ins" style="--c:var(--home)"><span class="n">Best right now</span><p>Adjusted, <b>${esc(rows[0].t)}</b> lead the league: an xG difference of ${sg(rows[0].axgd, 2)} per match against an average opponent on a neutral pitch.</p></div></div>
    <div class="two eq"><div class="panel"><p class="kicker">Raw xG difference, then adjusted, per match</p>${cleanChart(rows)}<p class="note">Grey is the raw difference, blue the adjusted one. The number on the right is the gap between them. Green means the run was harder than the raw figure suggests.</p></div>
    <div class="panel"><div class="tw"><table class="sticky1"><thead><tr><th class="l">#</th><th class="l">Club</th><th>xG/match</th><th>Adj.</th><th>xGA/match</th><th>Adj.</th><th>Diff.</th><th class="hm">Raw place</th><th class="hm">Home</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="click ${S.team === r.t ? "sel" : ""}" data-t="${esc(r.t)}"><td class="l mono" style="color:var(--muted)">${r.ar}</td><td class="l"><b>${esc(nm(r.t))}</b></td><td style="color:var(--muted)">${nf(r.xg, 2)}</td><td><b>${nf(r.ax, 2)}</b></td><td style="color:var(--muted)">${nf(r.xga, 2)}</td><td><b>${nf(r.axa, 2)}</b></td><td class="${r.axgd > 0 ? "pos" : "neg"}"><b>${sg(r.axgd, 2)}</b></td><td class="hm">${r.rr}${r.rr > r.ar ? ` <span class="pos">▲${r.rr - r.ar}</span>` : r.rr < r.ar ? ` <span class="neg">▼${r.ar - r.rr}</span>` : ""}</td><td class="hm">${r.home}/${r.P}</td></tr>`).join("")}</tbody></table></div>
    <p class="note">Adj. is the opponent- and venue-adjusted figure. Diff. is adjusted xG minus adjusted xGA per match, which is what the ranking uses. Raw place is where the club would sit on the unadjusted xG difference. Home is home matches out of matches played.</p></div></div></section>`;
}
function cleanMatches(t) {
  const R = cleanR(S.gw), ms = teamMatches(t, S.gw).map(m => adjMatch(m, t, R)); if (!ms.length) return "";
  return `<div class="panel"><p class="kicker">Match by match, adjusted for the opponent and the ground</p><div class="tw"><table><thead><tr><th class="l">GW</th><th class="l">Opponent</th><th>Score</th><th>xG</th><th class="hm">Avg. side</th><th>Adj.</th><th>xGA</th><th class="hm">Avg. side</th><th>Adj.</th></tr></thead><tbody>
    ${ms.map(x => `<tr><td class="l mono" style="color:var(--muted)">${x.gw}</td><td class="l">${esc(nm(x.o))} <span class="note">${x.home ? "H" : "A"} · Power ${ord(R.rank[x.o])}</span></td><td class="${x.p === 3 ? "pos" : x.p === 0 ? "neg" : ""}">${x.gf}–${x.ga}</td><td style="color:var(--muted)">${nf(x.xg, 2)}</td><td class="hm" style="color:var(--muted)">${nf(x.eF, 2)}</td><td><b class="${x.ax >= R.lgFit ? "pos" : "neg"}">${nf(x.ax, 2)}</b></td><td style="color:var(--muted)">${nf(x.xga, 2)}</td><td class="hm" style="color:var(--muted)">${nf(x.eA, 2)}</td><td><b class="${x.axa <= R.lgFit ? "pos" : "neg"}">${nf(x.axa, 2)}</b></td></tr>`).join("")}</tbody></table></div>
    <p class="note">Avg. side is what a typical club would have created, or allowed, in that same match at that ground. Adj. is the actual xG rescaled to an average opponent on a neutral pitch. Green is better than the league average of ${nf(R.lgFit, 2)} xG.</p></div>`;
}

/* ---------- Justice: actual strong with points decomposition ---------- */
function poisPts(lf, la) { const pf = [], pa = []; for (let i = 0; i <= C.prediction.max_goals; i++) { pf[i] = pois(lf, i); pa[i] = pois(la, i); } let w = 0, d = 0; for (let i = 0; i <= C.prediction.max_goals; i++) for (let j = 0; j <= 10; j++) { const p = pf[i] * pa[j]; if (i > j) w += p; else if (i === j) d += p; } return 3 * w + d; }
function decomp(upto) {
  const R = cleanR(upto), tb = table(upto);
  const rows = tb.map(r => { const ms = teamMatches(r.t, upto).map(m => adjMatch(m, r.t, R));
    const neutral = ms.reduce((a, x) => a + poisPts(x.ax, x.axa), 0), rawP = ms.reduce((a, x) => a + poisPts(x.xg, x.xga), 0);
    return { t: r.t, P: r.P, pts: r.pts, rank: r.rank, xpts: r.xpts, neutral, sched: rawP - neutral, f: r.gf - r.xg, k: r.xga - r.ga }; });
  let num = 0, den = 0; for (const r of rows) { const e = r.f + r.k; num += (r.pts - r.xpts) * e; den += e * e; }
  const c = den ? Math.max(TH.points_per_goal_clip_low, Math.min(TH.points_per_goal_clip_high, num / den)) : (TH.points_per_goal_clip_low + TH.points_per_goal_clip_high) / 2;
  for (const r of rows) { r.fin = c * r.f; r.keep = c * r.k; r.other = r.pts - r.neutral - r.sched - r.fin - r.keep; r.luck = r.fin + r.keep + r.other; r.per = r.neutral / Math.max(1, r.P); }
  rows.sort((a, b) => b.per - a.per).forEach((r, i) => r.vrank = i + 1);
  return { rows, c };
}
const DCOL = { sched: "var(--home)", fin: "var(--gold)", keep: "var(--away)", other: "#8f97b4" };
const DLBL = { sched: "schedule and venue", fin: "finishing", keep: "goalkeeping and defending", other: "other luck" };
function waterfall(rows) {
  const nw = narrow(), W = nw ? 360 : 760, L = nw ? 84 : 190, BW = nw ? 64 : 230, GAP = nw ? 26 : 26, Rr = nw ? 26 : 50, rh = nw ? 24 : 26, T = 30, H = T + rows.length * rh + 10;
  const DX = L + BW + GAP, DW = W - DX - Rr, ks = ["sched", "fin", "keep", "other"];
  const mxN = Math.max(...rows.map(r => r.neutral)) || 1, posS = rows.map(r => ks.reduce((a, k) => a + Math.max(0, r[k]), 0)), negS = rows.map(r => ks.reduce((a, k) => a + Math.min(0, r[k]), 0));
  const ext = Math.max(...posS, ...negS.map(Math.abs), 1) * 1.05, cx = DX + DW / 2, sx = (v) => v / ext * (DW / 2), bx = (v) => v / mxN * BW;
  let g = `<text x="${L}" y="12" style="font-size:9.5px">${nw ? "Worth" : "Worth of the performances (pts)"}</text><text x="${cx}" y="12" text-anchor="middle" style="font-size:9.5px">${nw ? "Luck" : "Luck and schedule"}</text><text x="${W - 2}" y="12" text-anchor="end" style="font-size:9.5px">PTS</text>
    <text x="${cx - 4}" y="${T - 6}" text-anchor="end" style="fill:var(--bad)">− taken</text><text x="${cx + 4}" y="${T - 6}" style="fill:var(--good)">added +</text>
    <line x1="${cx}" x2="${cx}" y1="${T - 2}" y2="${H - 6}" stroke="#3a4266"/>`;
  rows.forEach((r, i) => { const y = T + i * rh, sel = r.t === S.team; let pp = 0, nn = 0;
    g += `<g data-vt="${esc(r.t)}" style="cursor:pointer"><rect x="0" y="${y - 2}" width="${W}" height="${rh}" fill="${sel ? "rgba(255,210,90,.08)" : "transparent"}"/>`;
    g += `<text x="${L - 8}" y="${y + 13}" text-anchor="end" style="fill:${sel ? "var(--gold)" : "var(--ink)"};font-size:${nw ? 10 : 11}px">${r.vrank}. ${esc(nw ? short(r.t) : r.t)}${nw ? "" : ` <tspan style="fill:var(--muted);font-size:9.5px">table ${r.rank}</tspan>`}</text>`;
    g += `<rect x="${L}" y="${y + 4}" width="${bx(r.neutral).toFixed(1)}" height="12" rx="2" fill="#4a5378"><title>${esc(r.t)}: the performances were worth ${qty(nf(r.neutral, 1), "point", "points")}</title></rect><text x="${L + bx(r.neutral) + 4}" y="${y + 13}" style="font-size:9.5px">${nf(r.neutral, 1)}</text>`;
    for (const k of ks) { const d = r[k]; if (Math.abs(d) < 0.05) continue; const w = Math.abs(sx(d)); const x = d >= 0 ? cx + pp : cx - nn - w; if (d >= 0) pp += w; else nn += w;
      g += `<rect x="${x.toFixed(1)}" y="${y + 4}" width="${Math.max(1, w).toFixed(1)}" height="12" fill="${DCOL[k]}" stroke="var(--panel)" stroke-width=".8"><title>${esc(r.t)} · ${DLBL[k]}: ${sg(d, 1)} ${Math.abs(+nf(d, 1)) === 1 ? "point" : "points"}</title></rect>`; }
    const net = r.pts - r.neutral;
    g += `<text x="${W - 2}" y="${y + 13}" text-anchor="end" style="fill:var(--ink);font-weight:700;font-size:11.5px">${r.pts}<tspan style="fill:${net > 0.5 ? "var(--good)" : net < -0.5 ? "var(--bad)" : "var(--muted)"};font-weight:400;font-size:9px"> ${Math.abs(net) < 0.5 ? "±0" : sg(net, 0)}</tspan></text></g>`; });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Where the points come from">${g}</svg>`;
}
function viewValodi() {
  const { rows } = decomp(S.gw), sel = rows.find(r => r.t === S.team) || rows[0];
  const big = (r) => ["sched", "fin", "keep", "other"].map(k => [k, r[k]]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  const victim = rows.slice().sort((a, b) => (a.pts - a.neutral) - (b.pts - b.neutral))[0], lucky = rows.slice().sort((a, b) => (b.pts - b.neutral) - (a.pts - a.neutral))[0];
  const vb = big(victim), lb = big(lucky);
  const ins = [
    { c: "var(--home)", h: "The real leader", t: `<b>${esc(rows[0].t)}</b> have produced the most valuable football: ${nf(rows[0].per, 2)} points per match against an average opponent on a neutral pitch. They sit ${ord(rows[0].rank)} in the table.` },
    { c: "var(--bad)", h: "Hardest done by", t: `<b>${esc(victim.t)}</b> have played like a ${nf(victim.neutral, 1)}-point side and have ${qty(victim.pts, "point", "points")}. Most of the gap is ${DLBL[vb[0]]} (${sg(vb[1], 1)}).` },
    { c: "var(--good)", h: "Most helped", t: `<b>${esc(lucky.t)}</b> have ${qty(lucky.pts, "point", "points")} from performances worth ${qty(nf(lucky.neutral, 1), "point", "points")}. Most of the surplus is ${DLBL[lb[0]]} (${sg(lb[1], 1)}).` },
  ];
  const story = `<b>${esc(sel.t)}</b> have ${qty(sel.pts, "point", "points")} and sit ${ord(sel.rank)}. Against an average opponent on a neutral pitch those performances were worth <b>${qty(nf(sel.neutral, 1), "point", "points")}</b>, which ranks them ${ord(sel.vrank)} on true strength. On top of that: schedule and venue ${sg(sel.sched, 1)}, finishing ${sg(sel.fin, 1)}, goalkeeping and defending ${sg(sel.keep, 1)}, other luck ${sg(sel.other, 1)}.${Math.abs(big(sel)[1]) >= 2 ? ` The largest piece is ${DLBL[big(sel)[0]]}.` : " That is roughly what the performances were worth."}`;
  const cell = (v) => `<td class="${v > .5 ? "pos" : v < -.5 ? "neg" : ""}">${sg(v, 1)}</td>`;
  return `<section class="sec"><div class="insights">${ins.map((o, i) => `<div class="ins" style="--c:${o.c};animation-delay:${i * 60}ms"><span class="n">${i + 1} · ${esc(o.h)}</span><p>${o.t}</p></div>`).join("")}</div></section>
    <section class="sec"><div class="sechead"><h2>True strength</h2><span class="kicker">After gameweek ${S.gw}</span></div>
    <p class="note">Where do the points come from? On the left, what the performances were worth: the points that adjusted xG would have earned against an average opponent on a neutral pitch. To the right, what was added or taken away: the schedule and the grounds, the finishing, the goalkeeping and the defending, and the rest of the luck, including when the goals happened to fall. Bars to the right are points gained. Bars to the left are points lost. The figure at the edge is the actual points total, and how far it sits from the performances. Clubs are ordered by what the performances were worth. Click a club.</p>
    <div class="lgd"><span><i style="background:#4a5378"></i>worth of the performances</span>${Object.keys(DCOL).map(k => `<span><i style="background:${DCOL[k]}"></i>${DLBL[k]}</span>`).join("")}</div>
    <div class="insights" style="grid-template-columns:1fr"><div class="ins" style="--c:var(--gold)"><span class="n">${esc(sel.t)} in short</span><p>${story}</p></div></div>
    <div class="panel">${waterfall(rows)}</div>
    <div class="panel"><div class="tw"><table class="sticky1"><thead><tr><th class="l">#</th><th class="l">Club</th><th>Table</th><th>Worth</th><th class="hm">Per match</th><th>Schedule</th><th>Finishing</th><th>Goalkeeping</th><th>Other</th><th>Points</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="click ${S.team === r.t ? "sel" : ""}" data-vt="${esc(r.t)}"><td class="l mono" style="color:var(--muted)">${r.vrank}</td><td class="l"><b>${esc(nm(r.t))}</b></td><td>${r.rank}${r.rank > r.vrank ? ` <span class="pos">▲${r.rank - r.vrank}</span>` : r.rank < r.vrank ? ` <span class="neg">▼${r.vrank - r.rank}</span>` : ""}</td><td><b>${nf(r.neutral, 1)}</b></td><td class="hm">${nf(r.per, 2)}</td>${cell(r.sched)}${cell(r.fin)}${cell(r.keep)}${cell(r.other)}<td><b>${r.pts}</b></td></tr>`).join("")}</tbody></table></div>
    <p class="note">Table is the actual place. The arrow is how many places the performances would move the club: green is higher than the table, red is lower. Finishing and goalkeeping turn the gap between goals and xG into points, using a rate estimated from this season. Other is whatever is left, mostly the timing of the goals and the spread of the chances.</p></div></section>`;
}

/* ---------- Justice: attack and defence rankings (NFL-style efficiency) ---------- */
const MBYID = Object.fromEntries(M.map(m => [m.id, m]));
function shotState(s) { // score difference for the shooting team just before the shot
  const m = MBYID[s[I.fid]]; if (!m) return 0; const me = m.h === s[I.team] ? 0 : 1; let d = 0;
  for (const [we, side, , res] of m.shots) { if (we >= s[I.min]) break; if (res === "G") d += side === me ? 1 : -1; else if (res === "O") d += side === me ? -1 : 1; }
  return d;
}
function adTable(upto) {
  const CL = Object.fromEntries(cleanTable(upto).map(x => [x.t, x])), sh = shotsUpTo(upto).filter(s => s[I.res] !== "O"), R = cleanR(upto);
  const st = new Map(sh.map(s => [s, shotState(s)]));
  return TEAMS.map(t => {
    const ms = teamMatches(t, upto), P = Math.max(1, ms.length), fo = sh.filter(s => s[I.team] === t), ag = sh.filter(s => s[I.opp] === t);
    let lvl = 0; for (const m of ms) for (const [a, b, z] of stateSegs(m, t).seg) if (z === 0) lvl += b - a;
    const x = (a) => a.reduce((q, s) => q + s[I.xg], 0), np = (a) => a.filter(s => s[I.sit] !== "penalty");
    const fl = fo.filter(s => st.get(s) === 0), al = ag.filter(s => st.get(s) === 0);
    const adj = ms.map(m => adjMatch(m, t, R)), l3 = adj.slice(-3), ln = Math.max(1, l3.length);
    const o = OP[t] || {};
    return { t, P: ms.length, ax: CL[t].ax, axa: CL[t].axa, xg: CL[t].xg, xga: CL[t].xga,
      lx: lvl ? x(fl) / lvl * 90 : null, lxa: lvl ? x(al) / lvl * 90 : null, lvlPct: lvl / Math.max(1, ms.reduce((a, m) => a + stateSegs(m, t).end, 0)) * 100,
      sr: np(fo).length ? np(fo).filter(s => s[I.xg] >= TH.good_chance_xg).length / np(fo).length * 100 : null, sra: np(ag).length ? np(ag).filter(s => s[I.xg] >= TH.good_chance_xg).length / np(ag).length * 100 : null,
      bc: fo.filter(s => s[I.xg] >= TH.big_chance_xg).length / P, bca: ag.filter(s => s[I.xg] >= TH.big_chance_xg).length / P,
      sp: x(fo.filter(s => grpOf(s[I.sit]) === "sp")) / P, spa: x(ag.filter(s => grpOf(s[I.sit]) === "sp")) / P,
      xgs: np(fo).length ? x(np(fo)) / np(fo).length : null, xgsa: np(ag).length ? x(np(ag)) / np(ag).length : null,
      sh: fo.length / P, sha: ag.length / P,
      f3: l3.reduce((a, z) => a + z.ax, 0) / ln, a3: l3.reduce((a, z) => a + z.axa, 0) / ln,
      box: o.attack_misc_tch_in_box, ppda: o.sequences_ppda, hto: o.sequences_high_turnovers };
  });
}
const ADC = {
  att: { title: "Attack", key: "ax", low: false, cols: [["ax", "Adjusted xG / match", 2], ["lx", "xG/90 when level", 2], ["sr", "Good chances %", 0], ["bc", "Big chances / match", 2], ["xgs", "xG / shot", 3], ["sh", "Shots / match", 1], ["sp", "Set-piece xG / match", 2], ["f3", "Last 3, adj. xG", 2], ["box", "Touches in the box°", 0]] },
  def: { title: "Defence", key: "axa", low: true, cols: [["axa", "Adjusted xGA / match", 2, 1], ["lxa", "xGA/90 when level", 2, 1], ["sra", "Good chances allowed %", 0, 1], ["bca", "Big chances allowed / match", 2, 1], ["xgsa", "xG per shot faced", 3, 1], ["sha", "Shots faced / match", 1, 1], ["spa", "Set-piece xG allowed / match", 2, 1], ["a3", "Last 3, adj. xGA", 2, 1], ["ppda", "PPDA°", 1, 1], ["hto", "High turnovers°", 0]] },
};
function adBlurb(r, rk, side) {
  const A = side === "att", g = rk[A ? "sr" : "sra"], b = rk[A ? "bc" : "bca"], tr = A ? r.f3 - r.ax : r.axa - r.a3, lv = rk[A ? "lx" : "lxa"], mn = rk[A ? "ax" : "axa"];
  if (A) { if (g <= 5 && b <= 5 && mn <= 8) return "Efficient and explosive: plenty of good chances, and plenty of big ones."; if (b <= 5 && g >= 10) return "Explosive: fewer shots, but they tend to be big chances."; if (g <= 5 && b >= 10) return "Steady: lots of good chances, few genuine big ones."; }
  else { if (g <= 5 && b <= 5 && mn <= 8) return "A wall: few good chances and few big ones."; if (b >= 14 && g <= 8) return "Rarely carved open, but the mistakes are expensive."; if (g >= 14 && b <= 8) return "Allows a lot of ordinary chances, and rarely a big one."; }
  if (tr > 0.35) return A ? "On the rise: the last three matches are better than the season average." : "Tightening up: the last three matches are better than the season average.";
  if (tr < -0.35) return A ? "Dropped off: the last three matches are below the season average." : "Looser lately: the last three matches are worse than the season average.";
  if (lv - mn >= 6) return "Weaker when the score is level. The overall numbers are flattered by the state of the game.";
  if (mn - lv >= 6) return "Better when the score is level than over the match as a whole.";
  return `${ord(g)} for chance quality, ${ord(b)} for explosiveness.`;
}
function viewAD(side) {
  const C = ADC[side], rows = adTable(S.gw), A = side === "att";
  const rk = {}; for (const [k, , , low] of C.cols) { const hs = rankHeat(rows, k, low); rk[k] = Object.fromEntries(rows.map(r => [r.t, r[k] == null ? null : rows.filter(z => z[k] != null && (low ? z[k] < r[k] : z[k] > r[k])).length + 1])); void hs; }
  const ord = rows.slice().sort((a, b) => A ? b[C.key] - a[C.key] : a[C.key] - b[C.key]), lg = rows.reduce((a, r) => a + r[C.key], 0) / rows.length;
  const mx = Math.max(...rows.map(r => Math.abs(r[C.key] - lg))) || 1;
  const list = ord.map((r, i) => { const v = A ? r[C.key] - lg : lg - r[C.key], blurb = adBlurb(r, Object.fromEntries(Object.keys(rk).map(k => [k, rk[k][r.t]])), side);
    return `<div class="prow ${S.team === r.t ? "sel" : ""}" data-t="${esc(r.t)}" style="animation-delay:${i * 20}ms"><span class="prk">${i + 1}</span><span class="pmv mono">${nf(r[C.key], 2)}</span>
      <div class="pnm"><b>${esc(r.t)}</b><span>${esc(blurb)}</span></div><div class="pbr" aria-hidden="true"><i style="left:${v >= 0 ? 50 : 50 + v / mx * 50}%;width:${Math.abs(v) / mx * 50}%;background:${v >= 0 ? "var(--good)" : "var(--bad)"}"></i></div><b class="pval ${v >= 0 ? "pos" : "neg"}">${sg(v, 2)}</b></div>`; }).join("");
  const best = ord[0], hot = rows.slice().sort((a, b) => A ? (b.f3 - b.ax) - (a.f3 - a.ax) : (b.axa - b.a3) - (a.axa - a.a3))[0];
  const bk = A ? "bc" : "bca", gk = A ? "sr" : "sra", lk = A ? "lx" : "lxa";
  const expl = rows.filter(r => r[bk] != null).sort((a, b) => A ? b[bk] - a[bk] : a[bk] - b[bk])[0], suc = rows.filter(r => r[gk] != null).sort((a, b) => A ? b[gk] - a[gk] : a[gk] - b[gk])[0];
  const ins = A ? [
    { c: "var(--good)", h: "Best attack", t: `Against an average opponent on a neutral pitch, <b>${esc(best.t)}</b> create ${nf(best.ax, 2)} xG per match (raw: ${nf(best.xg, 2)}).` },
    { c: "var(--gold)", h: "Explosive or steady", t: `<b>${esc(expl.t)}</b> create more big chances than anyone else (${nf(expl.bc, 2)} per match). <b>${esc(suc.t)}</b> have the highest share of good chances (${nf(suc.sr, 0)}% of shots).` },
    { c: "var(--home)", h: "On the rise", t: `Over the last three matches <b>${esc(hot.t)}</b> have created ${nf(hot.f3, 2)} adjusted xG per match, against a season figure of ${nf(hot.ax, 2)}.` }]
  : [
    { c: "var(--good)", h: "Best defence", t: `Against an average opponent on a neutral pitch, <b>${esc(best.t)}</b> allow only ${nf(best.axa, 2)} xG per match (raw: ${nf(best.xga, 2)}).` },
    { c: "var(--gold)", h: "What they give up", t: `<b>${esc(expl.t)}</b> allow the fewest big chances (${nf(expl.bca, 2)} per match). <b>${esc(suc.t)}</b> allow the fewest good ones (${nf(suc.sra, 0)}% of shots faced).` },
    { c: "var(--home)", h: "Tightening up", t: `Over the last three matches <b>${esc(hot.t)}</b> have allowed ${nf(hot.a3, 2)} adjusted xG per match, against a season figure of ${nf(hot.axa, 2)}.` }];
  const sk = S.ads && S.ads.side === side && C.cols.some(c => c[0] === S.ads.k) ? S.ads : { k: C.key, asc: C.low };
  const sorted = sortRows(rows, sk.k, sk.asc), heats = Object.fromEntries(C.cols.map(c => [c[0], rankHeat(rows, c[0], c[3])]));
  return `<section class="sec"><div class="insights">${ins.map((o, i) => `<div class="ins" style="--c:${o.c};animation-delay:${i * 60}ms"><span class="n">${i + 1} · ${esc(o.h)}</span><p>${o.t}</p></div>`).join("")}</div></section>
    <section class="sec"><div class="sechead"><h2>${C.title}</h2><span class="kicker">After gameweek ${S.gw} · adjusted for opponent and venue</span></div>
    <p class="note">${A ? "How many chances a club creates against an average opponent on a neutral pitch (adjusted xG). The number beside the bar is the gap to the league average. The line underneath says whether the attack is efficient (lots of good chances) or explosive (lots of big chances), and which way it is heading." : "How many chances a club allows against an average opponent on a neutral pitch (adjusted xGA). The number beside the bar is the gap to the league average. The line underneath says whether the defence is tight (few good chances, few big ones) or open, and which way it is heading."} Click a club.</p>
    <div class="panel plist">${list}</div></section>
    <section class="sec"><div class="sechead"><h2>Details</h2></div><div class="panel"><div class="tw"><table class="sticky1 wrapth" id="adt"><thead><tr><th class="l">#</th><th class="l">Club</th>${C.cols.map(([k, l]) => `<th data-ak="${k}" data-side="${side}" ${sk.k === k ? `aria-sort="${sk.asc ? "ascending" : "descending"}"` : ""}>${esc(l)}${sk.k === k ? (sk.asc ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead><tbody>
    ${sorted.map((r, i) => `<tr class="click ${S.team === r.t ? "sel" : ""}" data-t="${esc(r.t)}"><td class="l mono" style="color:var(--muted)">${i + 1}</td><td class="l"><b>${esc(nm(r.t))}</b></td>${C.cols.map(([k, , d]) => { const u = heats[k][r.t]; return `<td style="${u != null ? `background:${heatRGB(u, k === sk.k ? .32 : .14)}` : ""}">${r[k] == null ? "–" : nf(r[k], d)}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>
    <p class="note">Read it the way an NFL efficiency table is read. <b style="color:var(--ink)">When level:</b> only the minutes the score was level. A side in front sits off, and a side behind commits players forward, so the score changes the chances they get. <b style="color:var(--ink)">Good chances:</b> the share of shots worth at least 0.10 xG, penalties excluded. <b style="color:var(--ink)">Big chances:</b> shots of at least 0.30 xG, per match. Green is better in the league, red is worse. A ° marks an Opta season total. Click a column heading to sort.</p></div></section>`;
}
function closeGames(t, upto) { let n = 0, pts = 0, xp = 0; for (const m of teamMatches(t, upto)) { const z = persp(m, t); if (Math.abs(z.gf - z.ga) <= 1) { n++; pts += z.p; xp += z.xp; } } return { n, pts, xp, luck: pts - xp }; }

/* ---------- schedule: PL + European fixtures, rest days ---------- */
const SCHED = {}; for (const t of TEAMS) SCHED[t] = [];
for (const f of FX) { const ts = Date.parse(f[3]); SCHED[f[1]].push({ ts, c: "PL", o: f[2], h: 1, gw: f[0], fid: f[5] }); SCHED[f[2]].push({ ts, c: "PL", o: f[1], h: 0, gw: f[0], fid: f[5] }); }
for (const e of EURO) if (SCHED[e[0]]) SCHED[e[0]].push({ ts: Date.parse(e[1]), c: e[2], o: e[3], h: e[4] });
for (const t of TEAMS) SCHED[t].sort((a, b) => a.ts - b.ts);
const COMP = Object.assign({ PL: "Premier League" }, C.competitions);
const restCls = (d) => d < TH.very_short_rest_days ? "neg" : d < TH.short_rest_days ? "warn" : "";
function restAround(t, fid) { const s = SCHED[t], i = s.findIndex(e => e.fid === fid); if (i < 0) return {}; const prev = i > 0 ? s[i - 1] : null, next = i < s.length - 1 ? s[i + 1] : null; return { prev, next, before: prev ? (s[i].ts - prev.ts) / 864e5 : null, after: next ? (next.ts - s[i].ts) / 864e5 : null }; }
const roundEnd = (g) => Math.max(...FX.filter(f => f[0] <= g).map(f => Date.parse(f[3])), 0);
function fatigue(upto) {
  const end = roundEnd(upto);
  return TEAMS.map(t => { let ns = 0, xs = 0, nn = 0, xn = 0, rs = 0, rn = 0;
    for (const x of teamMatches(t, upto).map(m => persp(m, t))) { const r = restAround(t, x.m.id); if (r.before == null) continue; rs += r.before; rn++; if (r.before < TH.short_rest_days) { ns++; xs += x.xp; } else { nn++; xn += x.xp; } }
    return { t, eu: SCHED[t].filter(e => e.c !== "PL" && e.ts <= end + 864e5 * 4).length, avg: rn ? rs / rn : null, ns, xs: ns ? xs / ns : null, xn: nn ? xn / nn : null }; });
}
function oppPower(t, upto, future) {
  const R = ratings(upto); const opp = future ? FX.filter(f => f[0] > upto && (f[1] === t || f[2] === t)).map(f => f[1] === t ? f[2] : f[1]) : teamMatches(t, upto).map(m => m.h === t ? m.a : m.h);
  return opp.length ? opp.reduce((a, o) => a + R.pw[o], 0) / opp.length : null;
}

/* ---------- game state from the goal timeline ---------- */
function gameState(t, upto) {
  let lead = 0, trail = 0, tot = 0, dropped = 0, won = 0, first = 0, firstN = 0, late = 0, lateA = 0;
  for (const m of teamMatches(t, upto)) {
    const home = m.h === t, me = home ? 0 : 1, ev = [];
    for (const [we, side, , res] of m.shots) { if (res === "G") ev.push([we, side]); else if (res === "O") ev.push([we, 1 - side]); }
    const end = Math.max(TH.regulation_minutes, ...m.shots.map(s => s[0] + 1)); let gf = 0, ga = 0, last = 0, everLead = false, everTrail = false;
    for (const [we, side] of ev) { const dur = Math.max(0, we - last); if (gf > ga) lead += dur; else if (gf < ga) trail += dur; last = Math.max(last, we);
      if (side === me) gf++; else ga++; if (gf > ga) everLead = true; if (gf < ga) everTrail = true; if (we >= TH.late_goal_minute) { if (side === me) late++; else lateA++; } }
    const dur = Math.max(0, end - last); if (gf > ga) lead += dur; else if (gf < ga) trail += dur; tot += end;
    const p = persp(m, t).p; if (everLead && p < 3) dropped += 3 - p; if (everTrail && p > 0) won += p;
    if (ev.length) { firstN++; if (ev[0][1] === me) first++; }
  }
  return { lead: tot ? lead / tot * 100 : 0, trail: tot ? trail / tot * 100 : 0, dropped, won, first: firstN ? first / firstN * 100 : null, late, lateA };
}

/* ---------- season simulation from the selected round ---------- */
function poisson(l) { let L = Math.exp(-l), k = 0, p = 1; do { k++; p *= Math.random(); } while (p > L); return k - 1; }
function simulate(gw) {
  const tab = table(gw); const base = Object.fromEntries(tab.map(r => [r.t, r]));
  const R = ratings(gw);
  const N = C.simulation.runs, n = TEAMS.length, idx = Object.fromEntries(TEAMS.map((t, i) => [t, i]));
  const rem = FX.filter(f => f[0] > gw).map(f => [idx[f[1]], idx[f[2]], R.lg * R.att[f[1]] * R.def[f[2]] * R.hfH, R.lg * R.att[f[2]] * R.def[f[1]] * R.hfA]);
  const cnt = TEAMS.map(() => ({ title: 0, top4: 0, top6: 0, rel: 0, pts: 0 }));
  const pts = new Float64Array(n);
  for (let s = 0; s < N; s++) {
    for (let i = 0; i < n; i++) pts[i] = base[TEAMS[i]].pts + Math.random() * C.simulation.tie_break_epsilon;
    for (const [h, a, lh, la] of rem) { const gh = poisson(lh), ga = poisson(la); if (gh > ga) pts[h] += 3; else if (gh < ga) pts[a] += 3; else { pts[h]++; pts[a]++; } }
    const ord = TEAMS.map((_, i) => i).sort((a, b) => pts[b] - pts[a]);
    ord.forEach((i, r) => { const c = cnt[i]; c.pts += pts[i]; if (r < PLACES.title) c.title++; if (r < PLACES.european) c.top4++; if (r < PLACES.europe_secondary) c.top6++; if (r >= n - PLACES.relegation) c.rel++; });
  }
  return TEAMS.map((t, i) => ({ t, now: base[t].pts, exp: cnt[i].pts / N, title: cnt[i].title / N, top4: cnt[i].top4 / N, top6: cnt[i].top6 / N, rel: cnt[i].rel / N })).sort((a, b) => b.exp - a.exp);
}

/* ---------- views ---------- */
function header() {
  const rows = M.filter(m => m.gw === S.gw); const goals = rows.reduce((a, m) => a + m.hs + m.as, 0), xg = rows.reduce((a, m) => a + m.xh + m.xa, 0);
  const cur = mainOf(S.tab);
  return `<header style="display:flex;flex-direction:column;gap:10px"><span class="kicker">Premier League ${D.season} · independent · rebuilt every week</span><h1>PL <span>X-ray</span></h1>
    <p class="lede">What the scoreline leaves out. Gameweek ${S.gw} produced <b>${goals} goals</b> from <b>${nf(xg, 1)} xG</b>.</p></header>
    <div class="sticky"><div class="gws" role="group" aria-label="Gameweek">${Array.from({ length: D.gw }, (_, i) => i + 1).map(g => `<button data-gw="${g}" aria-pressed="${g === S.gw}" aria-label="Gameweek ${g}">${g}</button>`).join("")}</div>
    <div class="mains" role="tablist">${NAV.map(n => `<button role="tab" data-main="${n[0]}" aria-selected="${cur[0] === n[0]}">${n[1]}</button>`).join("")}</div>
    <div class="subs" role="tablist">${cur[3].map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${l}</button>`).join("")}</div></div>
    <p class="sublede">${esc(cur[2])}</p>`;
}
function matchCard(m, k) {
  const v = verdict(m); const res = m.hs > m.as ? "H" : m.hs < m.as ? "A" : "D"; const open = S.open === m.id;
      return `<div class="mc ${open ? "open" : ""}" data-m="${m.id}" style="animation-delay:${k * 35}ms" role="button" tabindex="0" aria-expanded="${open}">
        <div class="row1"><span class="tm">${esc(m.h)}</span><span class="sc">${m.hs}–${m.as}</span><span class="tm r">${esc(m.a)}</span></div>
        <div class="xg"><span>xG <b>${nf(m.xh, 2)}</b></span><span class="tags"><span class="tag ${v.cls}">${v.tag}</span>${wpCurve(m).minW != null && wpCurve(m).minW < TH.comeback_win_probability && wpCurve(m).trailed ? `<span class="tag cb" title="Win probability fell to ${pc(wpCurve(m).minW)}">Comeback</span>` : ""}</span><span>xG <b>${nf(m.xa, 2)}</b></span></div>
        ${flow(m)}
        <div class="jbar"><div class="h ${res === "H" ? "act" : ""}" style="width:${m.pw * 100}%">${m.pw > .12 ? pc(m.pw) : ""}</div><div class="d ${res === "D" ? "act" : ""}" style="width:${m.pd * 100}%">${m.pd > .12 ? pc(m.pd) : ""}</div><div class="a ${res === "A" ? "act" : ""}" style="width:${m.pl * 100}%">${m.pl > .12 ? pc(m.pl) : ""}</div></div>
        ${mkt(m)}<p class="verdict">${v.txt}</p>${open ? matchDetail(m) : ""}</div>`;
}
function viewFordulo() {
  const rows = M.filter(m => m.gw === S.gw);
  return `<section class="sec">${insights()}</section>
    <section class="sec"><div class="sechead"><h2>Gameweek ${S.gw}</h2><div class="lgd"><span><i style="background:var(--home)"></i>home</span><span><i style="background:var(--away)"></i>away</span><span><i style="background:var(--gold)"></i>goal</span></div></div>
    <p class="note">The line is each side's chances added up, minute by minute. The bar is who would have won if every shot went in exactly as often as its xG says. The outline marks what actually happened. Click a match for the shot map.</p>
    <div class="mgrid">${rows.map((m, k) => matchCard(m, k)).join("")}</div></section>${tiles()}`;
}
function mkt() { return ""; }
function matchDetail(m) {
  const sh = SH.filter(s => s[I.fid] === m.id); const hs = sh.filter(s => s[I.team] === m.h), as = sh.filter(s => s[I.team] === m.a);
  const list = sh.slice().sort((a, b) => a[I.min] - b[I.min]).map(s => `<div><span class="mono" style="color:var(--muted)">${s[I.min]}'</span><span><b style="color:${s[I.team] === m.h ? "var(--home)" : "var(--away)"}">${esc(s[I.pl])}</b> · ${esc(SIT_LABEL[s[I.sit]] || s[I.sit])}${s[I.last] && s[I.last] !== "None" ? ", from " + esc(LAST[s[I.last]] || s[I.last]) : ""}</span><span class="mono" style="${s[I.res] === "G" ? "color:var(--gold);font-weight:700" : ""}">${s[I.res] === "O" ? "own goal" : nf(s[I.xg], 2) + " · " + RESN[s[I.res]]}</span></div>`).join("");
  const big = (arr) => arr.filter(s => s[I.xg] >= TH.big_chance_xg && s[I.res] !== "O").length;
  return `<div class="wpbox"><p class="kicker">Win probability by minute</p>${wpChart(m)}<div class="lgd"><span><i style="background:var(--home)"></i>${esc(m.h)} win</span><span><i style="background:#59607e"></i>draw</span><span><i style="background:var(--away)"></i>${esc(m.a)} win</span></div><p class="note">${wpSummary(m)}</p></div>
    <div class="mdetail" style="margin-top:6px"><div><div class="row" style="align-items:flex-start;gap:10px;flex-wrap:nowrap"><div style="flex:1;min-width:0"><p class="kicker" style="margin-bottom:4px">${esc(m.h)} · ${qty(m.sh, "shot", "shots")} · ${qty(big(hs), "big chance", "big chances")}</p>${halfPitch(hs, "var(--home)")}</div><div style="flex:1;min-width:0"><p class="kicker" style="margin-bottom:4px">${esc(m.a)} · ${qty(m.sa, "shot", "shots")} · ${qty(big(as), "big chance", "big chances")}</p>${halfPitch(as, "var(--away)")}</div></div><p class="note" style="margin-top:6px">Size is the chance of a goal. Gold is a goal. Filled is a shot on target. Empty is off target or blocked. A big chance is at least 0.30 xG.</p></div>
    <div><p class="kicker" style="margin-bottom:6px">Every shot</p><div class="slist">${list}</div></div></div>`;
}
function wpTiles() {
  const ms = M.filter(m => m.gw === S.gw); if (!ms.length) return "";
  const cbm = ms.filter(m => wpCurve(m).minW != null).sort((a, b) => wpCurve(a).minW - wpCurve(b).minW)[0], ex = ms.slice().sort((a, b) => wpCurve(b).excite - wpCurve(a).excite)[0];
  const out = [];
  if (cbm && wpCurve(cbm).minW < TH.exciting_dip_probability) { const C = wpCurve(cbm), w = C.res === 0 ? cbm.h : cbm.a; out.push(`<div class="tile"><span class="kicker">${C.trailed ? "Biggest comeback" : "Biggest swing"}</span><span class="big" style="color:var(--home)">${pc(C.minW)}</span><span class="who">${esc(w)}</span><span class="d">${esc(cbm.h)} ${cbm.hs}–${cbm.as} ${esc(cbm.a)}. At ${C.minT}', with the score ${C.minScore[0]}–${C.minScore[1]}, ${esc(poss(w))} win probability was only ${pc(C.minW)}, and they still won.</span></div>`); }
  const E = wpCurve(ex); out.push(`<div class="tile"><span class="kicker">Most exciting match</span><span class="big" style="color:var(--away)">${nf(E.excite, 1)}</span><span class="who">${esc(ex.h)} ${ex.hs}–${ex.as} ${esc(ex.a)}</span><span class="d">Excitement index: how far the two win probabilities swung during the match.</span></div>`);
  return out.join("");
}
function tiles() {
  const sh = SH.filter(s => s[I.gw] === S.gw && s[I.res] !== "O");
  const hard = sh.filter(s => s[I.res] === "G" && s[I.sit] !== "penalty").sort((a, b) => a[I.xg] - b[I.xg])[0];
  const miss = sh.filter(s => s[I.res] !== "G").sort((a, b) => b[I.xg] - a[I.xg])[0];
  const robs = []; for (const m of M.filter(m => m.gw === S.gw)) { robs.push({ t: m.h, d: m.ph - m.xph, m }); robs.push({ t: m.a, d: m.pa - m.xpa, m }); } robs.sort((a, b) => b.d - a.d);
  const by = {}; for (const s of sh) { const k = s[I.pl] + "|" + s[I.team]; by[k] = (by[k] || 0) + s[I.xg]; } const king = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
  const kg = king ? sh.filter(s => s[I.pl] + "|" + s[I.team] === king[0]) : [], kgg = kg.filter(s => s[I.res] === "G").length;
  const rob = robs[0], vic = robs[robs.length - 1];
  return `<section class="sec"><div class="sechead"><h2>Highlights</h2></div><div class="tiles">
    ${hard ? `<div class="tile"><span class="kicker">Unlikeliest goal</span><span class="big" style="color:var(--gold)">${nf(hard[I.xg], 2)} xG</span><span class="who">${esc(hard[I.pl])} · ${esc(hard[I.team])}</span><span class="d">${hard[I.min]}' against ${esc(hard[I.opp])}. A chance that small goes in about once every ${Math.round(1 / Math.max(.005, hard[I.xg]))} shots.</span></div>` : ""}
    ${miss ? `<div class="tile"><span class="kicker">Biggest miss</span><span class="big" style="color:var(--bad)">${nf(miss[I.xg], 2)} xG</span><span class="who">${esc(miss[I.pl])} · ${esc(miss[I.team])}</span><span class="d">${miss[I.min]}' against ${esc(miss[I.opp])}: ${RESN[miss[I.res]]}. That was a ${pc(miss[I.xg])} chance.</span></div>` : ""}
    ${wpTiles()}
    <div class="tile"><span class="kicker">Luckiest result</span><span class="big" style="color:var(--good)">${sg(rob.d, 1)} ${Math.abs(+nf(rob.d, 1)) === 1 ? "point" : "points"}</span><span class="who">${esc(rob.t)}</span><span class="d">${esc(rob.m.h)} ${rob.m.hs}–${rob.m.as} ${esc(rob.m.a)}. On the other side, ${esc(vic.t)} (${sg(vic.d, 1)}).</span></div>
    ${king ? `<div class="tile"><span class="kicker">Most xG</span><span class="big">${nf(king[1], 2)} xG</span><span class="who">${esc(king[0].split("|")[0])} · ${esc(king[0].split("|")[1])}</span><span class="d">${qty(kg.length, "shot", "shots")}, ${qty(kgg, "goal", "goals")}. ${kgg > king[1] + .5 ? "Clinical: well ahead of the chances." : kgg < king[1] - .5 ? "The chances deserved more goals." : "The goals match the chances."}</span></div>` : ""}</div></section>`;
}
function viewTabella() {
  const rows = table(S.gw, S.mode);
  const cols = [["pts", "Points", 0], ["xpts", "Deserved", 1], ["luck", "±", 1], ["gf", "GF", 0, "hm"], ["xg", "xG", 1], ["ga", "GA", 0, "hm"], ["xga", "xGA", 1]];
  const key = S.tsort, sorted = rows.slice().sort((a, b) => key === "rank" ? a.rank - b.rank : key === "xga" || key === "ga" ? a[key] - b[key] : b[key] - a[key]);
  const MODES = [["all", "Full season"], ["last5", "Last 5"], ["home", "Home"], ["away", "Away"]];
  const luck = rows.slice().sort((a, b) => a.luck - b.luck);
  return `<section class="sec"><div class="sechead"><h2>The justice table</h2><div class="seg" role="group" aria-label="time">${MODES.map(([k, l]) => `<button data-mode="${k}" aria-pressed="${S.mode === k}">${l}</button>`).join("")}</div></div>
    <p class="note">On the left, the real table. On the right, where the chances say each club should sit. A green line means the club is worse off than the chances deserved. A red line means it is better off. ${S.mode === "all" ? `The biggest losers so far are ${esc(luck[0].t)} (${sg(luck[0].luck, 1)} ${Math.abs(+nf(luck[0].luck, 1)) === 1 ? "point" : "points"}).` : ""}</p>
    <div class="two"><div class="panel">${slope(rows)}</div>
    <div class="panel"><div class="tw"><table id="jt" class="sticky1"><thead><tr><th class="l" data-k="rank">#</th><th class="l">Club</th><th data-k="P" class="hm">M</th>${cols.map(([k, l, , c]) => `<th data-k="${k}" class="${c || ""}" ${S.tsort === k ? 'aria-sort="x"' : ""}>${l}</th>`).join("")}<th class="l hm">xG-gap</th></tr></thead><tbody>
    ${sorted.map(r => `<tr class="click ${S.team === r.t ? "sel" : ""}" data-t="${esc(r.t)}"><td class="l mono" style="color:var(--muted)">${r.rank}</td><td class="l"><b>${esc(narrow() ? D.short[r.t] : r.t)}</b></td><td class="hm">${r.P}</td><td><b>${r.pts}</b></td><td>${nf(r.xpts, 1)}</td><td class="${r.luck > 1 ? "neg" : r.luck < -1 ? "pos" : ""}">${sg(r.luck, 1)}</td><td class="hm">${r.gf}</td><td>${nf(r.xg, 1)}</td><td class="hm">${r.ga}</td><td>${nf(r.xga, 1)}</td><td class="l hm">${spark(r.form)}</td></tr>`).join("")}</tbody></table></div>
    <p class="note">± is actual points minus points deserved. Red is luck on the club's side. Green is luck against it. Click a club for its X-ray.</p></div></div></section>
    <section class="sec"><div class="two eq"><div class="panel"><h3 style="font-family:var(--f-display);font-size:26px;text-transform:uppercase">Attack and defence</h3><p class="note">Further right means more chances created. Higher up means fewer chances conceded. Click a point.</p>${scatter(rows)}</div>
    <div class="panel"><h3 style="font-family:var(--f-display);font-size:26px;text-transform:uppercase">Place by gameweek</h3><p class="note">The real table after every round. Highlighted: ${esc(S.team)}.</p>${bump()}</div></div></section>`;
}
function simSection() {
  if (!S.sim || S.simGw !== S.gw) { S.sim = simulate(S.gw); S.simGw = S.gw; }
  const r = S.sim; const rem = FX.filter(f => f[0] > S.gw).length;
  const cell = (p, col) => `<td style="text-align:left"><span class="mono" style="display:inline-block;width:38px;text-align:right">${pc1(p)}</span><span class="pbar" style="width:${Math.max(1, p * (narrow() ? 26 : 60))}px;background:${col};opacity:${p > 0 ? .85 : 0}"></span></td>`;
  return `<section class="sec"><div class="sechead"><h2>Where they finish</h2><span class="kicker">After gameweek ${S.gw} · ${rem} matches left</span></div>
    <p class="note">The remaining ${rem} matches were played ${C.simulation.runs.toLocaleString("en-GB")} times using the Power ratings (opponent-adjusted, with recent matches counting for more). Bad luck so far does not drag a club's chances down. Only the points already dropped do.</p>
    <div class="panel"><div class="tw"><table class="probs sticky1"><thead><tr><th class="l">#</th><th class="l">Club</th><th>Now</th><th>Expected</th><th class="l">Title</th><th class="l">Top 4</th><th class="l hm">Top 6</th><th class="l">Relegated</th></tr></thead><tbody>
    ${r.map((x, i) => `<tr class="click ${S.team === x.t ? "sel" : ""}" data-t="${esc(x.t)}"><td class="l mono" style="color:var(--muted)">${i + 1}</td><td class="l"><b>${esc(narrow() ? D.short[x.t] : x.t)}</b></td><td>${x.now}</td><td><b>${nf(x.exp, 0)}</b></td>${cell(x.title, "var(--gold)")}${cell(x.top4, "var(--home)")}<td class="hm" style="text-align:left"><span class="mono" style="display:inline-block;width:38px;text-align:right">${pc1(x.top6)}</span></td>${cell(x.rel, "var(--bad)")}</tr>`).join("")}</tbody></table></div>
    <p class="note">This is a simple model. ${RTG.home_advantage === false ? "It does not use home advantage." : "It uses home advantage."} It uses a Poisson spread of goals. It does not know about injuries or a change of manager. Pick an earlier gameweek above to see what the model said at the time.</p></div></section>`;
}
/* ---------- win probability minute by minute (NFL-style) ---------- */
// pre-match strength (Power model before the round) + score + time left; goals left ~ Poisson
function wpAt(lh, la, frac, d) {
  const a = lh * frac, b = la * frac, ph = [], pa = []; for (let i = 0; i <= C.prediction.max_goals; i++) { ph[i] = pois(a, i); pa[i] = pois(b, i); }
  let w = 0, dr = 0; for (let i = 0; i <= C.prediction.max_goals; i++) for (let j = 0; j <= 10; j++) { const f = d + i - j, p = ph[i] * pa[j]; if (f > 0) w += p; else if (f === 0) dr += p; }
  return [w, dr, Math.max(0, 1 - w - dr)];
}
const WPC = {};
function wpCurve(m) {
  if (WPC[m.id]) return WPC[m.id];
  const R = ratings(Math.max(0, m.gw - 1)), lh = R.lg * R.att[m.h] * R.def[m.a] * R.hfH, la = R.lg * R.att[m.a] * R.def[m.h] * R.hfA;
  const end = Math.max(TH.regulation_minutes, ...m.shots.map(s => s[0] + 1));
  const ev = SH.filter(s => s[I.fid] === m.id && (s[I.res] === "G" || s[I.res] === "O")).sort((a, b) => a[I.min] - b[I.min])
    .map(s => ({ we: s[I.min], side: s[I.res] === "G" ? (s[I.team] === m.h ? 0 : 1) : (s[I.team] === m.h ? 1 : 0), pid: s[I.res] === "G" ? s[I.pid] : -1, pl: s[I.pl], og: s[I.res] === "O" }));
  const pts = []; let d = 0, k = 0, excite = 0, prev = null;
  for (let t = 0; t <= end; t++) {
    while (k < ev.length && ev[k].we <= t) { const e = ev[k], fr = Math.max(0, (end - e.we) / end), before = wpAt(lh, la, fr, d); d += e.side === 0 ? 1 : -1; const after = wpAt(lh, la, fr, d);
      const xb = e.side === 0 ? 3 * before[0] + before[1] : 3 * before[2] + before[1], xa = e.side === 0 ? 3 * after[0] + after[1] : 3 * after[2] + after[1];
      e.d3 = xa - xb; e.wBefore = e.side === 0 ? before[0] : before[2]; e.wAfter = e.side === 0 ? after[0] : after[2]; k++; }
    const p = wpAt(lh, la, Math.max(0, (end - t) / end), d); pts.push([t, ...p]); if (prev) excite += Math.abs(p[0] - prev[0]) + Math.abs(p[2] - prev[2]); prev = p;
  }
  const res = m.hs > m.as ? 0 : m.hs < m.as ? 2 : 1, wi = res === 0 ? 1 : res === 2 ? 3 : null;
  const minW = wi ? Math.min(...pts.map(q => q[wi])) : null, ctrl = wi ? pts.reduce((a, q) => a + q[wi], 0) / pts.length : null;
  const minT = wi ? pts.findIndex(q => q[wi] === minW) : null, scoreAt = (t) => { let h = 0, a = 0; for (const e of ev) if (e.we <= t) { if (e.side === 0) h++; else a++; } return [h, a]; };
  let trailed = false; if (wi) { let h = 0, a = 0; for (const e of ev) { if (e.side === 0) h++; else a++; if (res === 0 ? h < a : a < h) trailed = true; } }
  const minScore = wi ? scoreAt(minT) : null;
  const maxH = Math.max(...pts.map(q => q[1])), maxA = Math.max(...pts.map(q => q[3]));
  return (WPC[m.id] = { pts, ev, end, minW, minT, minScore, trailed, ctrl, excite, maxH, maxA, pre: pts[0], res });
}
function wpChart(m) {
  const C = wpCurve(m), W = 320, H = 104, L = 4, Rr = 4, T = 14, B = 14, x = (t) => L + t / C.end * (W - L - Rr), y = (v) => T + v * (H - T - B);
  const top = C.pts.map(q => [x(q[0]), y(q[1])]), mid = C.pts.map(q => [x(q[0]), y(q[1] + q[2])]);
  const P = (a) => a.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  const rev = (a) => a.slice().reverse().map(p => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  let g = `<path d="M${x(0)},${y(0)}L${x(C.end)},${y(0)}${rev(top).replace(/^L/, "L")}Z" fill="var(--home)" fill-opacity=".75"/>`;
  g += `<path d="${P(top)}${rev(mid)}Z" fill="#59607e" fill-opacity=".7"/><path d="${P(mid)}L${x(C.end)},${y(1)}L${x(0)},${y(1)}Z" fill="var(--away)" fill-opacity=".75"/>`;
  g += `<line x1="${x(45)}" x2="${x(45)}" y1="${T}" y2="${H - B}" stroke="#0a0d18" stroke-dasharray="2 3" stroke-opacity=".7"/><text x="${x(45)}" y="${H - 3}" text-anchor="middle">45'</text><text x="${x(90)}" y="${H - 3}" text-anchor="middle">90'</text>`;
  g += `<line x1="${x(0)}" x2="${x(C.end)}" y1="${y(.5)}" y2="${y(.5)}" stroke="#0a0d18" stroke-opacity=".25"/>`;
  for (const e of C.ev) { const xx = x(e.we), team = e.side === 0 ? m.h : m.a; g += `<line x1="${xx}" x2="${xx}" y1="${T - 2}" y2="${H - B}" stroke="var(--ink)" stroke-width="1" stroke-opacity=".55"/><circle cx="${xx}" cy="${T - 6}" r="3.6" fill="${e.side === 0 ? "var(--home)" : "var(--away)"}" stroke="var(--ink)" stroke-width="1"><title>${e.we}'. ${esc(poss(e.pl))} ${e.og ? "own goal" : "goal"}: ${esc(poss(team))} win probability ${pc(e.wBefore)} → ${pc(e.wAfter)}</title></circle>`; }
  for (let t = 0; t < C.end; t += 5) { const q = C.pts[t]; g += `<rect x="${x(t)}" y="${T}" width="${x(5) - x(0)}" height="${H - T - B}" fill="transparent"><title>${t}': ${esc(m.h)} ${pc(q[1])} · draw ${pc(q[2])} · ${esc(m.a)} ${pc(q[3])}</title></rect>`; }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Win probability by minute">${g}</svg>`;
}
function wpSummary(m) {
  const C = wpCurve(m), key = C.ev.slice().sort((a, b) => Math.abs(b.d3) - Math.abs(a.d3))[0], win = C.res === 0 ? m.h : C.res === 2 ? m.a : null;
  const parts = [`At kick-off: ${esc(m.h)} ${pc(C.pre[1])}, the draw ${pc(C.pre[2])}, ${esc(m.a)} ${pc(C.pre[3])}.`];
  if (key) { const team = key.side === 0 ? m.h : m.a, verb = key.wAfter + 0.005 >= key.wBefore ? "lifted" : "cut"; parts.push(`The goal that moved the match most: <b>${esc(poss(key.pl))} ${key.og ? "own goal" : "goal"}</b> (${key.we}') ${verb} ${esc(poss(team))} win probability from ${pc(key.wBefore)} to ${pc(key.wAfter)} (${sg(key.d3, 2)} expected ${Math.abs(+nf(key.d3, 2)) === 1 ? "point" : "points"}).`); }
  if (win && C.minW < TH.comeback_win_probability) parts.push(C.trailed ? `<b>${esc(win)}</b> came from behind. At ${C.minT}', with the score ${C.minScore[0]}–${C.minScore[1]}, their win probability was only ${pc(C.minW)}.` : `<b>${esc(win)}</b> saw their win probability fall to ${pc(C.minW)} at ${C.minT}' (${C.minScore[0]}–${C.minScore[1]}) and still won.`);
  else if (!win && Math.max(C.maxH, C.maxA) > TH.dominance_win_probability) parts.push(`<b>${esc(C.maxH > C.maxA ? m.h : m.a)}</b> reached a ${pc(Math.max(C.maxH, C.maxA))} chance of winning, and the match still finished level.`);
  parts.push(`Excitement index: <b>${nf(C.excite, 1)}</b>.`);
  return parts.join(" ");
}
function wpTeam(t, upto) { let cb = 0, bl = 0, n = 0; for (const m of teamMatches(t, upto)) { const C = wpCurve(m), h = m.h === t, wi = h ? 1 : 3, z = persp(m, t), mn = Math.min(...C.pts.map(q => q[wi])), mx = Math.max(...C.pts.map(q => q[wi])); if (mn < TH.team_comeback_win_probability && z.p > 0) cb += z.p; if (mx > TH.team_blown_win_probability && z.p < 3) bl += 3 - z.p; n++; } return { cb, bl }; }
const WPA = {}; for (const m of M) for (const e of wpCurve(m).ev) if (e.pid != null && e.pid >= 0) WPA[e.pid] = (WPA[e.pid] || 0) + e.d3;

/* ---------- Preview: next round ---------- */
const DAY = new Intl.DateTimeFormat("en-GB", { timeZone: C.display_timezone, month: "short", day: "numeric" });
const formChips = (t) => teamMatches(t, S.gw).slice(-5).map(m => persp(m, t)).map(x => `<i class="fm ${x.p === 3 ? "w" : x.p === 1 ? "d" : "l"}" title="GW${x.gw} ${x.home ? "home" : "away"} vs ${esc(x.o)}: ${x.gf}–${x.ga}">${x.p === 3 ? "W" : x.p === 1 ? "D" : "L"}</i>`).join("");
function restLine(t, fid) {
  const r = restAround(t, fid); if (!r.prev && !r.next) return "";
  const b = r.before == null ? "first match of the season" : `<b class="${restCls(r.before)}">${restDays(r.before)}</b>${r.prev && r.prev.c !== "PL" ? ` (before that, ${COMP[r.prev.c] || r.prev.c}${r.prev.o ? " against " + esc(r.prev.o) : ""})` : ""}`;
  const a = r.next && r.next.c !== "PL" && r.after < TH.europe_soon_days ? ` · <span class="neg">then ${COMP[r.next.c] || r.next.c}${r.next.o ? " v " + esc(r.next.o) : ""} in ${dayCount(r.after)}</span>` : "";
  return b + a;
}
function absent(t) {
  if (S.gw !== D.gw) return "";
  const a = PL.filter(q => q.t === t && q.min >= 180 && q.stt !== "a" && q.stt !== "u").sort((x, y) => y.min - x.min).slice(0, 4);
  return a.length ? `<span class="abs">${a.map(q => `<span title="${esc(q.news)}">${esc(q.n)}${q.cop != null ? ` <small>${q.cop}%</small>` : ""}</span>`).join("")}</span>` : `<span class="note">No flagged absentees</span>`;
}
function fairOdd(p) {
  if (!(p > 0) || !Number.isFinite(p)) return "–";
  const shown = (1 / p).toFixed(2);
  return shown === "Infinity" ? "–" : shown;
}
function previewCard(f, R, k) {
  const [, h, a, ko, , fid] = f, p = predict(h, a, R);
  const tr = Object.fromEntries(table(S.gw).map(r => [r.t, r.rank])), real = S.gw < D.gw ? M.find(x => x.id === fid) : null;
  const res = real ? (real.hs > real.as ? 0 : real.hs === real.as ? 1 : 2) : -1, ps = [p.pw, p.pd, p.pl];
  const side = (t) => `<div class="pvside"><div class="row" style="gap:6px;justify-content:space-between;flex-wrap:nowrap"><b style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(nm(t))}</b><span class="forms">${formChips(t)}</span></div><span class="note">${restLine(t, fid)}</span>${absent(t)}</div>`;
  return `<div class="mc pvw" style="animation-delay:${k * 35}ms">
    <div class="pvtop"><span class="kicker">${esc(KO.format(new Date(ko)))}</span><span class="kicker">Power ${ord(R.rank[h])} – ${ord(R.rank[a])}</span></div>
    <div class="row1"><span class="tm">${esc(h)}<small>${tr[h] ? ord(tr[h]) : ""}</small></span><span class="sc pvx" title="Expected goals">${nf(p.lh, 2)}<i>–</i>${nf(p.la, 2)}</span><span class="tm r">${esc(a)}<small>${tr[a] ? ord(tr[a]) : ""}</small></span></div>
    <div class="jbar"><div class="h ${res === 0 ? "act" : ""}" style="width:${p.pw * 100}%">${p.pw > .12 ? pc(p.pw) : ""}</div><div class="d ${res === 1 ? "act" : ""}" style="width:${p.pd * 100}%">${p.pd > .12 ? pc(p.pd) : ""}</div><div class="a ${res === 2 ? "act" : ""}" style="width:${p.pl * 100}%">${p.pl > .12 ? pc(p.pl) : ""}</div></div>
    <p class="mkt"><span class="kicker">Model</span> ${ps.map(pc).join(" · ")}</p>
    <p class="mkt">Fair odds ${ps.map(fairOdd).join(" · ")}</p>
    <div class="pvstats"><span><b>${pc(p.o25)}</b> over 2.5 goals</span><span><b>${pc(p.btts)}</b> both teams to score</span><span><b>${p.top.map(s => s[0] + "–" + s[1]).join(", ")}</b> most likely</span><span><b>${pc(p.csH)} / ${pc(p.csA)}</b> clean sheet, home / away</span></div>
    ${side(h)}${side(a)}
    ${real ? `<p class="verdict">What happened: <b>${real.hs}–${real.as}</b>. The model gave ${["the home win", "the draw", "the away win"][res]} a ${pc(ps[res])} chance${ps.indexOf(Math.max(...ps)) === res ? ". <b style=\"color:var(--good)\">The favourite delivered.</b>" : "."}</p>` : ""}</div>`;
}
function previewInsights(fx, R) {
  const P = fx.map(f => ({ f, h: f[1], a: f[2], p: predict(f[1], f[2], R) })), out = [];
  const big = P.slice().sort((x, y) => Math.max(R.rank[x.h], R.rank[x.a]) - Math.max(R.rank[y.h], R.rank[y.a]))[0];
  out.push({ c: "var(--gold)", h: "Match of the round", t: `<b>${esc(big.h)} v ${esc(big.a)}</b>, ${ord(R.rank[big.h])} and ${ord(R.rank[big.a])} on the Power list. The model says ${pc(big.p.pw)} – ${pc(big.p.pd)} – ${pc(big.p.pl)}.` });
  const fav = P.map(x => ({ ...x, m: Math.max(x.p.pw, x.p.pl) })).sort((x, y) => y.m - x.m)[0], ft = fav.p.pw > fav.p.pl ? fav.h : fav.a, fo = ft === fav.h ? fav.a : fav.h;
  out.push({ c: "var(--good)", h: "Clearest favourite", t: `<b>${esc(ft)}</b> have a ${pc(fav.m)} chance of beating ${esc(fo)} ${ft === fav.h ? "at home" : "away"}.` });
  const tired = []; for (const x of P) for (const t of [x.h, x.a]) { const r = restAround(t, x.f[5]); tired.push({ t, o: t === x.h ? x.a : x.h, ...r }); }
  const shortB = tired.filter(z => z.before != null).sort((x, y) => x.before - y.before)[0], euroA = tired.filter(z => z.next && z.next.c !== "PL" && z.after < TH.short_rest_days).sort((x, y) => x.after - y.after);
  if (shortB && shortB.before < TH.short_rest_days) out.push({ c: "var(--away)", h: "Fatigue", t: `<b>${esc(shortB.t)}</b> have only ${restDays(shortB.before)}${shortB.prev && shortB.prev.c !== "PL" ? ` after ${COMP[shortB.prev.c] || shortB.prev.c}${shortB.prev.o ? " against " + esc(shortB.prev.o) : ""}` : ""}.${euroA.length ? ` ${euroA.slice(0, 3).map(z => esc(z.t)).join(", ")} then play in Europe a few days later.` : ""}` });
  else if (euroA.length) out.push({ c: "var(--away)", h: "European week", t: `${euroA.slice(0, 4).map(z => `<b>${esc(z.t)}</b> (${COMP[z.next.c] || z.next.c}${z.next.o ? " v " + esc(z.next.o) : ""}, in ${dayCount(z.after)})`).join(", ")}. A rotated side is likely.` });
  else { const r = tired.filter(z => z.before != null).sort((x, y) => y.before - x.before)[0]; if (r) out.push({ c: "var(--away)", h: "Rest", t: `<b>${esc(r.t)}</b> have had the longest break in the round, ${restDays(r.before)}.` }); }
  return `<div class="insights">${out.map((o, i) => `<div class="ins" style="--c:${o.c};animation-delay:${i * 60}ms"><span class="n">${i + 1} · ${esc(o.h)}</span><p>${o.t}</p></div>`).join("")}</div>`;
}
function backtest(upto) {
  const rows = [];
  for (let g = 2; g <= upto; g++) { const R = ratings(g - 1); let n = 0, hit = 0, pa = 0, mn = 0, mhit = 0, mpa = 0, mpm = 0;
    for (const m of M.filter(x => x.gw === g)) { const p = predict(m.h, m.a, R), ps = [p.pw, p.pd, p.pl], act = m.hs > m.as ? 0 : m.hs === m.as ? 1 : 2; n++; if (ps.indexOf(Math.max(...ps)) === act) hit++; pa += ps[act];
       }
    rows.push({ g, n, hit, pa: pa / n, mn, mhit, mpa: mn ? mpa / mn : null, mpm: mn ? mpm / mn : null }); }
  return rows;
}
function modelLog() {
  const rows = backtest(S.gw); if (!rows.length) return "";
  const N = rows.reduce((a, r) => a + r.n, 0), H = rows.reduce((a, r) => a + r.hit, 0), PA = rows.reduce((a, r) => a + r.pa * r.n, 0) / N;
  const mk = rows.filter(r => r.mn);
  return `<section class="sec"><div class="sechead"><h2>Model log</h2><span class="kicker">each round uses only the matches already played</span></div>
    <div class="two eq"><div class="panel"><div class="tw"><table><thead><tr><th class="l">Gameweek</th><th>Matches</th><th>Favourite won</th><th>Chance of the actual result</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td class="l">${r.g}</td><td>${r.n}</td><td>${r.hit} / ${r.n}</td><td><b>${pc(r.pa)}</b></td></tr>`).join("")}<tr><td class="l"><b>Total</b></td><td>${N}</td><td><b>${H} / ${N}</b> (${pc(H / N)})</td><td><b>${pc(PA)}</b></td></tr></tbody></table></div>
    <p class="note">Each gameweek uses only the matches played before it. "Chance of the actual result" is the probability the model gave to what happened, averaged across the matches. Higher is better. Guessing at random lands near 33%.</p></div>
    </div></section>`;
}
function mismatchSection(fx, R) {
  const tb = table(S.gw), T = Object.fromEntries(tb.map(r => [r.t, r]));
  if (!S.gw || fx.some(f => !T[f[1]] || !T[f[2]])) return "";
  const rows = fx.map(f => { const h = f[1], a = f[2], tg = T[a].rank - T[h].rank, pg = T[a].xrank - T[h].xrank, wg = R.rank[a] - R.rank[h], p = predict(h, a, R);
    return { h, a, tg, pg, wg, mm: Math.abs(tg - pg), p, th: T[h], ta: T[a] }; }).sort((x, y) => y.mm - x.mm || Math.abs(y.tg) - Math.abs(x.tg));
  const better = (g, h, a) => g > 0 ? h : g < 0 ? a : null;
  const verdict = (r) => { const tb_ = better(r.tg, r.h, r.a), pb = better(r.pg, r.h, r.a);
    if (tb_ && pb && tb_ !== pb && Math.abs(r.pg) >= TH.mismatch_flip_places) return { cls: "flip", tag: "Rankings disagree", txt: `The table says <b>${esc(tb_)}</b> are the stronger side. The chances say <b>${esc(pb)}</b>.` };
    if (Math.abs(r.tg) - Math.abs(r.pg) >= TH.mismatch_gap_places) return { cls: "over", tag: "Table overstates it", txt: `The table shows a gap of ${qty(Math.abs(r.tg), "place", "places")}. The chances say ${qty(Math.abs(r.pg), "place", "places")}. This is a closer match than the table suggests.` };
    if (Math.abs(r.pg) - Math.abs(r.tg) >= TH.mismatch_gap_places) return { cls: "under", tag: "Gap is wider", txt: `<b>${esc(pb)}</b> are ${qty(Math.abs(r.pg), "place", "places")} better on the chances. The table shows a gap of only ${qty(Math.abs(r.tg), "place", "places")}.` };
    return { cls: "", tag: "They agree", txt: "The table and the chances roughly agree." }; };
  const line = (lbl, x, y) => `<div class="mmr"><span>${lbl}</span><b class="${x < y ? "hb" : ""}">${x}.</b><i>–</i><b class="${y < x ? "ab" : ""}">${y}.</b></div>`;
  return `<section class="sec"><div class="sechead"><h2>Where the table misleads</h2><span class="kicker">Gameweek ${S.gw + 1} · biggest gap first</span></div>
    <p class="note">For each match: where the two clubs sit in the real table, in the table their chances deserved, and on the Power list. The big number is how far those two views disagree, in places.${narrow() ? " Swipe sideways for the other matches." : ""}</p>
    <div class="mm">${rows.map((r, i) => { const v = verdict(r); return `<div class="mmc ${v.cls} ${i < 3 && r.mm >= TH.mismatch_gap_places ? "top" : ""}" style="animation-delay:${i * 30}ms">
      <div class="mmh"><b>${esc(r.h)} – ${esc(r.a)}</b><span class="mmv" title="gap in places">${r.mm}</span></div>
      ${line("Actual table", r.th.rank, r.ta.rank)}${line("Deserved", r.th.xrank, r.ta.xrank)}${line("Power", R.rank[r.h], R.rank[r.a])}
      <span class="tag ${v.cls === "flip" ? "rob" : v.cls ? "dom" : ""}">${v.tag}</span><p class="note">${v.txt} Model: ${pc(r.p.pw)} – ${pc(r.p.pd)} – ${pc(r.p.pl)}.</p></div>`; }).join("")}</div></section>`;
}
function viewElozetes() {
  const R = ratings(S.gw), g = S.gw + 1;
  if (g > D.rounds) return `<section class="sec"><h2>The season is over</h2></section>`;
  const fx = FX.filter(f => f[0] === g).sort((a, b) => a[3].localeCompare(b[3]));
  const ts = fx.map(f => Date.parse(f[3]));
  return `<section class="sec">${previewInsights(fx, R)}</section>${mismatchSection(fx, R)}
    <section class="sec"><div class="sechead"><h2>Gameweek ${g} preview</h2><span class="kicker">${esc(DAY.format(new Date(Math.min(...ts))))} – ${esc(DAY.format(new Date(Math.max(...ts))))}${S.gw < D.gw ? ` · as it looked after gameweek ${S.gw}` : ""}</span></div>
    <p class="note">The bar is the model's chance of a home win, a draw and an away win. The numbers in the middle are expected goals. Form is the last five matches (W, D, L). Rest is the days since the club's previous match, including Europe. ${S.gw === D.gw ? "Absentees come from the official Fantasy Premier League injury list. The percentage is the chance of playing." : ""}${S.gw < D.gw ? " This gameweek has been played. The actual score is on the card." : ""}</p>
    <div class="mgrid">${fx.map((f, k) => previewCard(f, R, k)).join("")}</div></section>${modelLog()}`;
}

/* ---------- Power rankings ---------- */
function powerBlurb(t, R, tr, mv) {
  if (R.ar[t] === 1 && R.dr[t] === 1) return "The best attack and the best defence in the league.";
  if (mv >= 3) return `Big jump: up ${qty(mv, "place", "places")}.`;
  if (mv <= -3) return `Dropped ${qty(-mv, "place", "places")}.`;
  if (tr[t] - R.rank[t] >= TH.mismatch_gap_places) return `Better than the table. They sit ${ord(tr[t])}.`;
  if (R.rank[t] - tr[t] >= TH.mismatch_gap_places) return `The table rates them higher than the model. They sit ${ord(tr[t])}.`;
  if (R.ar[t] === 1) return "The best attack in the league.";
  if (R.dr[t] === 1) return "The best defence in the league.";
  if (R.ar[t] <= 4 && R.dr[t] >= 14) return "Strong going forward, open at the back.";
  if (R.dr[t] <= 4 && R.ar[t] >= 14) return "Solid at the back, blunt going forward.";
  return `Attack ${ord(R.ar[t])}, defence ${ord(R.dr[t])}.`;
}
function viewPower() {
  const R = ratings(S.gw), P0 = S.gw > 1 ? ratings(S.gw - 1) : null, tr = Object.fromEntries(table(S.gw).map(r => [r.t, r.rank]));
  const mx = Math.max(...TEAMS.map(t => Math.abs(R.pw[t]))) || 1;
  const rows = R.order.map((t, i) => { const v = R.pw[t], mv = P0 ? P0.rank[t] - R.rank[t] : 0;
    return `<div class="prow ${S.team === t ? "sel" : ""}" data-t="${esc(t)}" style="animation-delay:${i * 20}ms"><span class="prk">${R.rank[t]}</span><span class="pmv ${mv > 0 ? "up" : mv < 0 ? "dn" : ""}">${mv > 0 ? "▲" + mv : mv < 0 ? "▼" + -mv : "–"}</span>
      <div class="pnm"><b>${esc(t)}</b><span>${esc(powerBlurb(t, R, tr, mv))}</span></div>
      <div class="pbr" aria-hidden="true"><i style="left:${v >= 0 ? 50 : 50 + v / mx * 50}%;width:${Math.abs(v) / mx * 50}%;background:${v >= 0 ? "var(--good)" : "var(--bad)"}"></i></div><b class="pval ${v >= 0 ? "pos" : "neg"}">${sg(v, 2)}</b></div>`; }).join("");
  return `<section class="sec"><div class="sechead"><h2>Power rankings</h2><span class="kicker">After gameweek ${S.gw}</span></div>
    <p class="note">Who is strongest right now, regardless of the table? The number is the goal difference a club would expect against an average opponent on a neutral pitch. It accounts for who the chances came against, and recent matches count for more. The starting point is a pre-season strength calculated from earlier league results, and that anchor fades as this season goes on. The arrow is the move since last gameweek. Click a club.</p>
    <div class="panel plist">${rows}</div></section>
    <section class="sec"><div class="two eq"><div class="panel"><h3 class="h3">Power place by gameweek</h3><p class="note">Highlighted: ${esc(S.team)}.</p>${bump(g => ratings(g).rank)}</div>
    <div class="panel"><h3 class="h3">Attack and defensive strength</h3><p class="note">Goals per match against an average side, adjusted for the opponent. Further right is a more dangerous attack. Higher up is a tighter defence.</p>${powerScatter(R)}</div></div></section>`;
}
function powerScatter(R) {
  const W = narrow() ? 360 : 560, H = 320, L = 36, Rr = 12, T = 14, B = 30;
  const pts = TEAMS.map(t => ({ t, x: R.lg * (R.att[t] - 1), y: R.lg * (1 - R.def[t]) }));
  const ext = (a) => { const m = Math.max(...a.map(Math.abs)) * 1.15 || 1; return [-m, m]; };
  const [x0, x1] = ext(pts.map(p => p.x)), [y0, y1] = ext(pts.map(p => p.y));
  const px = (v) => L + (v - x0) / (x1 - x0) * (W - L - Rr), py = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  let g = `<line x1="${px(0)}" x2="${px(0)}" y1="${T}" y2="${H - B}" stroke="#2f3656" stroke-dasharray="3 3"/><line x1="${L}" x2="${W - Rr}" y1="${py(0)}" y2="${py(0)}" stroke="#2f3656" stroke-dasharray="3 3"/>`;
  g += `<text x="${W - Rr - 4}" y="${T + 10}" text-anchor="end" style="fill:var(--good)">strong at both ends</text><text x="${L + 4}" y="${H - B - 6}" style="fill:var(--bad)">weak at both ends</text><text x="${W - Rr}" y="${H - 6}" text-anchor="end">attack →</text><text x="${L}" y="${T - 3}">defence ↑</text>`;
  const boxes = [];
  for (const p of pts.sort((a, b) => (a.t === S.team) - (b.t === S.team))) { const cx = px(p.x), cy = py(p.y), sel = p.t === S.team, col = p.x + p.y >= 0 ? "var(--good)" : "var(--bad)";
    g += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${sel ? 6 : 4.5}" fill="${sel ? "var(--gold)" : col}" fill-opacity="${sel ? 1 : .55}" data-t="${esc(p.t)}" style="cursor:pointer"><title>${esc(p.t)}: attack ${sg(p.x, 2)}, defence ${sg(p.y, 2)}</title></circle>`;
    const lab = short(p.t), w = lab.length * 5.8, left = cx + 8 + w > W - 4, bx = left ? cx - 8 - w : cx + 8, by = cy - 6;
    if (!sel && boxes.some(b => bx < b[0] + b[2] && bx + w > b[0] && by < b[1] + 11 && by + 11 > b[1])) continue; boxes.push([bx, by, w]);
    g += `<text x="${bx.toFixed(1)}" y="${(cy + 3).toFixed(1)}" style="fill:${sel ? "var(--gold)" : "var(--ink)"};font-size:9.5px">${esc(lab)}</text>`; }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Attack and defensive strength">${g}</svg>`;
}

/* ---------- Schedule: fixture ticker, strength of schedule, rest ---------- */
function viewMenetrend() {
  const R = ratings(S.gw), all = S.tick === 99, last = Math.min(D.rounds, S.gw + (all ? D.rounds : S.tick)), rounds = [];
  for (let g = S.gw + 1; g <= last; g++) rounds.push(g);
  const rows = TEAMS.map(t => { const cells = rounds.map(g => FX.filter(f => f[0] === g && (f[1] === t || f[2] === t)).map(f => { const home = f[1] === t, o = home ? f[2] : f[1]; return { o, home, xp: predFor(t, o, home, R).xp }; })); const flat = cells.flat(); return { t, cells, sum: flat.reduce((a, c) => a + c.xp, 0), n: flat.length }; })
    .sort((a, b) => b.sum / Math.max(1, b.n) - a.sum / Math.max(1, a.n));
  const TK = [[3, "Next 3"], [6, "Next 6"], [99, "Rest of the season"]];
  const cell = (c) => `<span class="tk" style="background:${heatRGB((c.xp - .7) / 1.4, .78)}" title="${esc(c.o)}, ${c.home ? "home" : "away"}: ${qty(nf(c.xp, 2), "expected point", "expected points")}"><b>${esc(short(c.o))}</b><small>${c.home ? "H" : "A"}</small></span>`;
  const tick = rounds.length ? `<div class="tw"><table class="sticky1 ticker"><thead><tr><th class="l">#</th><th class="l">Club</th>${all ? `<th>Matches</th><th>Expected points</th><th class="l">Points per match</th>` : rounds.map(g => `<th>${g}</th>`).join("") + `<th>Total</th>`}</tr></thead><tbody>
    ${rows.map((r, i) => `<tr class="click ${S.team === r.t ? "sel" : ""}" data-t="${esc(r.t)}"><td class="l mono" style="color:var(--muted)">${i + 1}</td><td class="l"><b>${esc(nm(r.t))}</b></td>${all ? `<td>${r.n}</td><td><b>${nf(r.sum, 1)}</b></td><td class="l"><span class="mono">${nf(r.sum / Math.max(1, r.n), 2)}</span><span class="pbar" style="width:${Math.max(2, (r.sum / Math.max(1, r.n) - .8) * (narrow() ? 40 : 80))}px;background:${heatRGB((r.sum / Math.max(1, r.n) - 1) / .9)}"></span></td>` : r.cells.map(cs => `<td class="tkc">${cs.length ? cs.map(cell).join("") : `<span class="tk blank">–</span>`}</td>`).join("") + `<td><b>${nf(r.sum, 1)}</b></td>`}</tr>`).join("")}</tbody></table></div>` : `<p class="empty">No gameweeks left.</p>`;
  const fat = fatigue(S.gw).map(x => { const nx = FX.find(f => f[0] === S.gw + 1 && (f[1] === x.t || f[2] === x.t)); return { ...x, nxt: nx ? restAround(x.t, nx[5]) : null }; }).sort((a, b) => b.eu - a.eu || (a.avg || 9) - (b.avg || 9));
  return `<section class="sec"><div class="sechead"><h2>Schedule</h2><div class="seg" role="group" aria-label="time">${TK.map(([k, l]) => `<button data-tick="${k}" aria-pressed="${S.tick === k}">${l}</button>`).join("")}</div></div>
    <p class="note">Each cell is the next match and the points the model expects from it: three times the win probability, plus the draw probability. Green is an easier game, red a harder one. H is home, A is away. The easiest run is at the top. The ratings are from after gameweek ${S.gw}.</p>
    <div class="panel">${tick}</div></section>
    <section class="sec"><div class="two eq"><div class="panel"><h3 class="h3">Difficulty, so far and still to come</h3><p class="note">Average Power of the opponents. Grey marks opponents already faced. Gold marks opponents still to come. Clubs whose run gets easier are at the top.</p>${sosChart()}</div>
    <div class="panel"><h3 class="h3">Rest and workload</h3><div class="tw"><table class="sticky1"><thead><tr><th class="l">#</th><th class="l">Club</th><th>Europe</th><th>Avg. rest, days</th><th>Under 4 days</th><th class="hm">xPts/match, short rest</th><th class="hm">xPts/match, otherwise</th><th>Before next</th></tr></thead><tbody>
    ${fat.map((x, i) => `<tr class="click ${S.team === x.t ? "sel" : ""}" data-t="${esc(x.t)}"><td class="l mono" style="color:var(--muted)">${i + 1}</td><td class="l"><b>${esc(nm(x.t))}</b></td><td>${x.eu || "–"}</td><td>${x.avg ? nf(x.avg, 1) : "–"}</td><td class="${x.ns ? "neg" : ""}">${x.ns || "–"}</td><td class="hm">${x.xs != null ? nf(x.xs, 2) : "–"}</td><td class="hm">${x.xn != null ? nf(x.xn, 2) : "–"}</td><td>${x.nxt && x.nxt.before != null ? `<span class="${restCls(x.nxt.before)}">${nf(x.nxt.before, 1)}</span>${x.nxt.next && x.nxt.next.c !== "PL" && x.nxt.after < TH.europe_soon_days ? ` <span class="tag rob" title="In ${dayCount(x.nxt.after)}">+${esc(x.nxt.next.c)}</span>` : ""}` : "–"}</td></tr>`).join("")}</tbody></table></div>
    <p class="note">Europe is Champions League, Europa League and Conference League matches so far. "Under 4 days" is how many league matches were played on fewer than four days' rest. xPts per match is points deserved on short rest, and on a normal week. The last column is rest before the next league match. The tag means a European game follows within five days. The League Cup and the FA Cup are not included.</p></div></div></section>`;
}
function sosChart() {
  const pts = TEAMS.map(t => ({ t, a: oppPower(t, S.gw, false), b: oppPower(t, S.gw, true) })).filter(p => p.a != null && p.b != null).sort((x, y) => (x.b - x.a) - (y.b - y.a));
  if (!pts.length) return `<p class="empty">Not enough matches yet.</p>`;
  const nw = narrow(), W = nw ? 360 : 520, rh = 19, T = 18, H = T + pts.length * rh + 22, L = nw ? 74 : 112, Rr = 44;
  const vs = pts.flatMap(p => [p.a, p.b]), x0 = Math.min(...vs) - .05, x1 = Math.max(...vs) + .05, px = (v) => L + (v - x0) / (x1 - x0) * (W - L - Rr);
  let g = `<line x1="${px(0)}" x2="${px(0)}" y1="${T - 6}" y2="${H - 20}" stroke="#2f3656" stroke-dasharray="3 3"/><text x="${px(0)}" y="${T - 8}" text-anchor="middle">average</text><text x="${L}" y="${H - 6}">← easier opponents</text><text x="${W - Rr}" y="${H - 6}" text-anchor="end">harder →</text>`;
  pts.forEach((p, i) => { const y = T + i * rh + 8, sel = p.t === S.team, d = p.b - p.a;
    g += `<text x="${L - 8}" y="${y + 3.5}" text-anchor="end" style="fill:${sel ? "var(--gold)" : "var(--ink)"};font-size:10.5px">${esc(nw ? short(p.t) : p.t)}</text><line x1="${px(p.a)}" x2="${px(p.b)}" y1="${y}" y2="${y}" stroke="${d < 0 ? "var(--good)" : "var(--bad)"}" stroke-width="2" opacity=".6"/>
      <circle cx="${px(p.a)}" cy="${y}" r="4" fill="var(--bg)" stroke="#8f97b4" stroke-width="1.5"><title>${esc(p.t)}, opponents so far: ${sg(p.a, 2)}</title></circle><circle cx="${px(p.b)}" cy="${y}" r="4.5" fill="var(--gold)"><title>${esc(p.t)}, opponents still to come: ${sg(p.b, 2)}</title></circle>
      <text x="${W - Rr + 6}" y="${y + 3.5}" style="fill:${d < 0 ? "var(--good)" : "var(--bad)"}">${sg(d, 2)}</text>`; });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Opponent strength, so far and still to come">${g}</svg>`;
}

/* ---------- show: sortable team metrics ---------- */
const TG = {
  alap: ["Overview", [["pw", "Power", 2], ["pts", "Points", 0], ["xpts", "xPts", 1], ["luck", "Points − xPts", 1], ["xgd", "xG diff. / match", 2], ["axgd", "Adj. xG diff. / match", 2], ["npxgd", "npxG diff. / match", 2], ["fin", "Finishing, G − xG", 1], ["keep", "Goals prevented", 1]]],
  tam: ["Attack", [["xg", "xG / match", 2], ["shf", "Shots / match", 1], ["xgs", "xG / shot", 3], ["bc", "Big chances / match", 2], ["sp", "Set-piece xG %", 0], ["box", "Touches in the box°", 0], ["crs", "Crosses°", 0], ["thr", "Through balls°", 0], ["head", "Headed goals°", 0], ["fb", "Fast-break goals°", 0]]],
  ved: ["Defence", [["xga", "xGA / match", 2, 1], ["sha", "Shots faced / match", 1, 1], ["xgsa", "xG per shot faced", 3, 1], ["bca", "Big chances faced / match", 2, 1], ["ppda", "PPDA°", 1, 1], ["hto", "High turnovers°", 0], ["obox", "Opp. touches in the box°", 0, 1], ["err", "Errors leading to a goal°", 0, 1]]],
  allas: ["Game state", [["lead", "Time leading %", 0], ["trail", "Time trailing %", 0, 1], ["first", "Scored first %", 0], ["dropped", "Points dropped from a lead", 0, 1], ["won", "Points rescued from behind", 0], ["late", "Goals after 75'", 0], ["lateA", "Conceded after 75'", 0, 1], ["cgN", "Close matches", 0], ["cgP", "Points from close matches", 0], ["cgL", "Close matches, pts − xPts", 1], ["cbP", "Points from comebacks", 0], ["blP", "Points spurned", 0, 1]]],
  stil: ["Style", [["poss", "Possession %°", 1], ["acc", "Pass accuracy %°", 1], ["spd", "Attack speed°", 2], ["bu", "Build-up attacks°", 0], ["da", "Direct attacks°", 0], ["ten", "Sequences of 10+ passes°", 0], ["spp", "Passes per sequence°", 1], ["wood", "Hit the woodwork°", 0]]],
  men: ["Schedule", [["sosA", "Opponents so far", 2, 1], ["sosB", "Opponents to come", 2, 1], ["rest", "Average rest, days", 1], ["short", "Matches on under 4 days", 0, 1], ["eu", "European matches", 0, 1]]],
};
function teamMetrics(upto) {
  const R = ratings(upto), sh = shotsUpTo(upto), fat = Object.fromEntries(fatigue(upto).map(x => [x.t, x])), CL = Object.fromEntries(cleanTable(upto).map(x => [x.t, x]));
  const sx = (a) => a.reduce((q, s) => q + s[I.xg], 0), np = (a) => a.filter(s => s[I.sit] !== "penalty");
  return table(upto).map(r => { const t = r.t, P = Math.max(1, r.P), fo = sh.filter(s => s[I.team] === t && s[I.res] !== "O"), ag = sh.filter(s => s[I.opp] === t && s[I.res] !== "O"), gs = gameState(t, upto), o = OP[t] || {};
    return { t, P: r.P, pw: R.pw[t], pts: r.pts, xpts: r.xpts, luck: r.luck, xgd: (r.xg - r.xga) / P, axgd: CL[t].axgd, npxgd: (sx(np(fo)) - sx(np(ag))) / P, fin: r.gf - r.xg, keep: r.xga - r.ga,
      xg: r.xg / P, shf: fo.length / P, xgs: fo.length ? sx(fo) / fo.length : null, bc: fo.filter(s => s[I.xg] >= TH.big_chance_xg).length / P, sp: sx(fo) ? sx(fo.filter(s => grpOf(s[I.sit]) === "sp")) / sx(fo) * 100 : null,
      box: o.attack_misc_tch_in_box, crs: o.possession_op_crosses, thr: o.possession_through_balls, head: o.attack_misc_headed_goals, fb: o.attack_misc_fast_break_goals, wood: o.attack_misc_hit_woodwork,
      xga: r.xga / P, sha: ag.length / P, xgsa: ag.length ? sx(ag) / ag.length : null, bca: ag.filter(s => s[I.xg] >= TH.big_chance_xg).length / P, ppda: o.sequences_ppda, hto: o.sequences_high_turnovers, obox: o.defending_misc_opp_tch_in_box, err: o.misc_errors_lead_to_goal,
      cbP: wpTeam(t, upto).cb, blP: wpTeam(t, upto).bl, cgN: closeGames(t, upto).n, cgP: closeGames(t, upto).pts, cgL: closeGames(t, upto).luck, lead: gs.lead, trail: gs.trail, first: gs.first, dropped: gs.dropped, won: gs.won, late: gs.late, lateA: gs.lateA,
      poss: o.possession_pos_perc, acc: o.possession_accuracy, spd: o.sequences_direct_speed_for, bu: o.sequences_build_ups, da: o.sequences_direct_attacks, ten: o.sequences_ten_plus_passes, spp: o.sequences_passes_for,
      sosA: oppPower(t, upto, false), sosB: oppPower(t, upto, true), rest: fat[t].avg, short: fat[t].ns, eu: fat[t].eu };
  });
}
function rankHeat(rows, k, low) { const vals = rows.map(r => r[k]).filter(v => v != null); const out = {}; for (const r of rows) { const v = r[k]; if (v == null) continue; const better = vals.filter(x => low ? x < v : x > v).length; out[r.t || r.id] = vals.length > 1 ? 1 - better / (vals.length - 1) : .5; } return out; }
function sortRows(rows, k, asc) { return rows.slice().sort((a, b) => { const x = a[k], y = b[k]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return asc ? x - y : y - x; }); }
function viewMutatok() {
  const rows = teamMetrics(S.gw), [, cols] = TG[S.tgrp];
  const sk = S.tms && cols.some(c => c[0] === S.tms.k) ? S.tms : { k: cols[0][0], asc: !!cols[0][3] };
  const sorted = sortRows(rows, sk.k, sk.asc), heats = Object.fromEntries(cols.map(c => [c[0], rankHeat(rows, c[0], c[3])]));
  const best = (k, low) => sortRows(rows.filter(r => r[k] != null), k, !!low)[0];
  const d = best("dropped"), w = best("won"), q = best("xgs"), ld = best("lead");
  const ins = [
    { c: "var(--bad)", h: "Points left behind", t: `<b>${esc(d.t)}</b> have dropped ${qty(d.dropped, "point", "points")} from matches in which they led. At the other end, ${esc(w.t)} have rescued ${qty(w.won, "point", "points")} from behind.` },
    { c: "var(--home)", h: "Shot quality", t: `<b>${esc(q.t)}</b> average ${nf(q.xgs, 2)} xG per shot, the best chance quality in the league. Fewer shots, better ones.` },
    { c: "var(--gold)", h: "Control", t: `<b>${esc(ld.t)}</b> have led for ${nf(ld.lead, 0)}% of playing time, and trailed for only ${nf(ld.trail, 0)}%.` },
  ];
  return `<section class="sec"><div class="insights">${ins.map((o, i) => `<div class="ins" style="--c:${o.c};animation-delay:${i * 60}ms"><span class="n">${i + 1} · ${esc(o.h)}</span><p>${o.t}</p></div>`).join("")}</div></section>
    <section class="sec"><div class="sechead"><h2>Clubs</h2><span class="kicker">After gameweek ${S.gw}</span></div>
    <div class="seg" role="group" aria-label="show">${Object.entries(TG).map(([k, v]) => `<button data-tg="${k}" aria-pressed="${S.tgrp === k}">${v[0]}</button>`).join("")}</div>
    <div class="panel"><div class="tw"><table class="sticky1 wrapth" id="tm"><thead><tr><th class="l">#</th><th class="l">Club</th>${cols.map(([k, l]) => `<th data-tk="${k}" ${sk.k === k ? `aria-sort="${sk.asc ? "ascending" : "descending"}"` : ""}>${esc(l)}${sk.k === k ? (sk.asc ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead><tbody>
    ${sorted.map((r, i) => `<tr class="click ${S.team === r.t ? "sel" : ""}" data-t="${esc(r.t)}"><td class="l mono" style="color:var(--muted)">${i + 1}</td><td class="l"><b>${esc(nm(r.t))}</b></td>${cols.map(([k, , dd]) => { const u = heats[k][r.t]; return `<td style="${u != null ? `background:${heatRGB(u, k === sk.k ? .32 : .14)}` : ""}">${r[k] == null ? "–" : ["pw", "luck", "xgd", "axgd", "npxgd", "fin", "keep", "sosA", "sosB", "cgL"].includes(k) ? sg(r[k], dd) : nf(r[k], dd)}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>
    <p class="note">Click a column heading to sort, and click it again to reverse the order. Green is better in the league, red is worse. A big chance is at least 0.30 xG. npxG leaves penalties out. A ° marks an Opta season total, always from the latest file. Game state uses the minute of each goal. Points from comebacks: the win probability fell under 20% and the club still took something. Points spurned: the win probability was over 80% and the club did not win. A close match is a draw or a one-goal game. Those results are noisy, the same way close games are in the NFL, because they rarely repeat.</p></div></section>`;
}

/* ---------- Database: match finder ---------- */
const MF0 = { team: "", venue: "", tag: "", from: 1, sort: "date", lim: 20 };
const SF0 = { q: "", team: "", opp: "", sit: "", body: "", res: "", zone: "", xmin: 0, mfrom: 0, mto: 120, from: 1, lim: 30 };
S.mf = Object.assign({}, MF0); S.sf = Object.assign({}, SF0);
const MTAGS = [["", "All"], ["rob", "Robberies"], ["elusz", "Blown wins"], ["fol", "Control"], ["ford", "Comebacks"], ["izg", "Most exciting"], ["golz", "Goal feasts (4+)"], ["xgw", "Lost with more xG"]];
const MSORT = [["date", "Date"], ["excite", "Excitement"], ["xg", "Total xG"], ["goals", "Goals"], ["rob", "How unlikely the win was"], ["xgd", "xG difference"]];
function matchTagOf(m) { const v = verdictRaw(m); const C = wpCurve(m); return { rob: !!v.win && v.pAct < TH.robbery_win_probability, elusz: !v.win && Math.max(m.pw, m.pl) > TH.blown_win_probability, fol: !!v.win && v.pAct > TH.dominance_win_probability && Math.abs(m.xh - m.xa) > TH.dominance_xg_diff, ford: C.minW != null && C.minW < TH.comeback_win_probability && C.trailed, golz: m.hs + m.as >= TH.goal_flurry, xgw: (m.hs > m.as && m.xa > m.xh) || (m.as > m.hs && m.xh > m.xa) }; }
function viewMeccsek() {
  const F = S.mf, all = M.filter(m => m.gw <= S.gw && m.gw >= F.from && (!F.team || (F.venue === "home" ? m.h === F.team : F.venue === "away" ? m.a === F.team : m.h === F.team || m.a === F.team)));
  let list = all.filter(m => !F.tag || F.tag === "izg" || matchTagOf(m)[F.tag]);
  const key = { date: (m) => -Date.parse(m.date) - m.id, excite: (m) => -wpCurve(m).excite, xg: (m) => -(m.xh + m.xa), goals: (m) => -(m.hs + m.as), rob: (m) => verdictRaw(m).win ? verdictRaw(m).pAct : 9, xgd: (m) => -Math.abs(m.xh - m.xa) }[F.tag === "izg" && F.sort === "date" ? "excite" : F.sort];
  list = list.slice().sort((a, b) => key(a) - key(b)); if (F.tag === "izg") list = list.slice(0, 10);
  const shown = list.slice(0, F.lim), G = list.reduce((a, m) => a + m.hs + m.as, 0), X = list.reduce((a, m) => a + m.xh + m.xa, 0);
  const row = (m) => { const v = verdict(m), C = wpCurve(m), tg = matchTagOf(m), open = S.open === m.id;
    return `<div class="mrow ${open ? "open" : ""}" data-mo="${m.id}" role="button" tabindex="0" aria-expanded="${open}"><span class="mono note" style="white-space:nowrap">GW${m.gw} · ${esc(DAY.format(new Date(m.date)))}</span>
      <span class="mt"><b class="${m.hs > m.as ? "w" : ""}">${esc(nm(m.h))}</b> <span class="msc">${m.hs}–${m.as}</span> <b class="${m.as > m.hs ? "w" : ""}">${esc(nm(m.a))}</b></span>
      <span class="mono mx">xG ${nf(m.xh, 1)}–${nf(m.xa, 1)}</span><span class="tags"><span class="tag ${v.cls}">${v.tag}</span>${tg.ford ? `<span class="tag cb">Comeback</span>` : ""}</span><span class="mono note me" title="Excitement index">⚡${nf(C.excite, 1)}</span></div>
      ${open ? `<div class="mopen">${matchCard(m, 0)}</div>` : ""}`; };
  return `<section class="sec"><div class="sechead"><h2>Match finder</h2><span class="kicker">${qty(list.length, "match", "matches")} · ${qty(G, "goal", "goals")} · ${nf(X, 1)} xG</span></div>
    <div class="seg" role="group" aria-label="match">${MTAGS.map(([k, l]) => `<button data-mft="${k}" aria-pressed="${F.tag === k}">${l}</button>`).join("")}</div>
    <div class="row"><select class="sel" data-mf="team" aria-label="Club"><option value="">Every club</option>${TEAMS.map(t => `<option ${t === F.team ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
      <select class="sel" data-mf="venue" aria-label="Venue" ${F.team ? "" : "disabled"}><option value="">Home and away</option><option value="home" ${F.venue === "home" ? "selected" : ""}>Home only</option><option value="away" ${F.venue === "away" ? "selected" : ""}>Away only</option></select>
      <select class="sel" data-mf="from" aria-label="From gameweek">${Array.from({ length: S.gw }, (_, i) => i + 1).map(g => `<option value="${g}" ${g === F.from ? "selected" : ""}>From gameweek ${g}</option>`).join("")}</select>
      <select class="sel" data-mf="sort" aria-label="Sort">${MSORT.map(([k, l]) => `<option value="${k}" ${k === F.sort ? "selected" : ""}>Sort: ${l}</option>`).join("")}</select>
      <button class="chip" id="mf-reset">Clear filters</button></div>
    <div class="panel mlist">${shown.length ? shown.map(row).join("") : `<p class="empty">No matches of this kind.</p>`}</div>
    <div class="row" style="justify-content:space-between"><span class="note">Click a match for the xG chart, the win-probability chart and every shot. The gameweek buttons at the top set the latest round included (now gameweek ${S.gw}).</span>${list.length > F.lim ? `<button class="chip" id="mf-more">Show 20 more</button>` : ""}</div>
    <p class="note">A robbery is a win the shots rated below 30%. A blown win is a draw in which one club was above 55% to win. Control is a deserved win with a clear xG gap. A comeback is a win in which the winner had been behind and their win probability had fallen below 25%. The lightning bolt is the excitement index: how far the win probabilities swung.</p></section>`;
}

/* ---------- Database: shot finder ---------- */
const SITS = ["open play", "corner", "set piece", "free kick", "penalty"], BODY = [["RightFoot", "Right foot"], ["LeftFoot", "Left foot"], ["Head", "Header"], ["OtherBodyPart", "Other"]];
const SIT_LABEL = { "open play": "Open play", corner: "Corner", "set piece": "Set piece", "free kick": "Free kick", penalty: "Penalty" };
const SRES = [["G", "Goal"], ["S", "Saved"], ["M", "Off target"], ["B", "Blocked"], ["P", "Post"]], ZONES = [["six", "Inside the six-yard box"], ["box", "Inside the penalty area"], ["out", "Outside the box"]];
const zoneOf = (s) => s[I.x] >= TH.box_x_on_shot_scale ? (s[I.x] >= TH.six_yard_x_on_shot_scale && Math.abs(s[I.y] - TH.centre_y_on_shot_scale) <= TH.six_yard_half_width_on_shot_scale ? "six" : "box") : "out";
const PBYID = Object.fromEntries(PL.map(p => [p.id, p]));
function viewLovesek() {
  const F = S.sf, q = fold(F.q);
  const list = SH.filter(s => s[I.res] !== "O" && s[I.gw] <= S.gw && s[I.gw] >= F.from && (!F.team || s[I.team] === F.team) && (!F.opp || s[I.opp] === F.opp) && (!F.sit || s[I.sit] === F.sit) && (!F.body || s[I.typ] === F.body) && (!F.res || s[I.res] === F.res)
    && (!F.zone || (F.zone === "box" ? zoneOf(s) !== "out" : zoneOf(s) === F.zone)) && s[I.xg] >= F.xmin && s[I.min] >= F.mfrom && s[I.min] <= F.mto && (!q || fold(s[I.pl] + " " + ((PBYID[s[I.pid]] || {}).full || "")).includes(q)));
  const g = list.filter(s => s[I.res] === "G").length, x = list.reduce((a, s) => a + s[I.xg], 0), on = list.filter(s => s[I.res] === "G" || s[I.res] === "S").length;
  const dist = list.length ? list.reduce((a, s) => a + Math.hypot((TH.shot_x_scale - s[I.x]) / TH.shot_x_scale * TH.pitch_length_m, (s[I.y] - TH.centre_y_on_shot_scale) / TH.shot_y_scale * TH.pitch_width_m), 0) / list.length : 0;
  const byP = {}; for (const s of list) { const k = s[I.pid] >= 0 ? s[I.pid] : s[I.pl]; const o = byP[k] || (byP[k] = { n: s[I.pl], t: s[I.team], sh: 0, g: 0, x: 0 }); o.sh++; o.x += s[I.xg]; if (s[I.res] === "G") o.g++; }
  const tops = Object.values(byP).sort((a, b) => b.x - a.x).slice(0, 8);
  const shown = list.slice().sort((a, b) => b[I.xg] - a[I.xg]).slice(0, F.lim);
  const chips = (key, opts) => `<div class="seg" role="group">${[["", "Any"], ...opts].map(([k, l]) => `<button data-sfc="${key}:${k}" aria-pressed="${String(F[key]) === String(k)}">${l}</button>`).join("")}</div>`;
  const MINS = [[0, 120, "Full match"], [0, 15, "0–15'"], [16, 30, "16–30'"], [31, 45, "31–45+'"], [46, 60, "46–60'"], [61, 75, "61–75'"], [76, 120, "76–90+'"]];
  const pool = SH.filter(s => s[I.res] !== "O" && s[I.gw] <= S.gw).length;
  return `<section class="sec"><div class="sechead"><h2>Shot finder</h2><span class="kicker">${qty(list.length, "shot", "shots")} of ${pool}</span></div>
    <div class="row"><input class="sel" id="sq" type="search" placeholder="Player name" value="${esc(F.q)}" aria-label="Player" style="flex:1 1 160px;max-width:240px;min-width:0">
      <select class="sel" data-sf="team" aria-label="Shooting club"><option value="">Shooting club: any</option>${TEAMS.map(t => `<option ${t === F.team ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
      <select class="sel" data-sf="opp" aria-label="Opponent"><option value="">Opponent: any</option>${TEAMS.map(t => `<option ${t === F.opp ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
      <select class="sel" data-sf="xmin" aria-label="Minimum xG">${[[0, "Any chance"], [0.1, "Good chance (0.10+ xG)"], [0.3, "Big chance (0.30+ xG)"], [0.5, "Huge chance (0.50+ xG)"]].map(([v, l]) => `<option value="${v}" ${+F.xmin === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      <select class="sel" data-sf="min" aria-label="Minute">${MINS.map(([a, b, l]) => `<option value="${a}-${b}" ${F.mfrom === a && F.mto === b ? "selected" : ""}>${l}</option>`).join("")}</select>
      <select class="sel" data-sf="from" aria-label="From gameweek">${Array.from({ length: S.gw }, (_, i) => i + 1).map(gg => `<option value="${gg}" ${gg === F.from ? "selected" : ""}>From gameweek ${gg}</option>`).join("")}</select>
      <button class="chip" id="sf-reset">Clear filters</button></div>
    <div class="fgrid"><span class="kicker">Outcome</span>${chips("res", SRES)}<span class="kicker">Situation</span>${chips("sit", SITS.map(x => [x, SIT_LABEL[x] || x]))}<span class="kicker">Body part</span>${chips("body", BODY)}<span class="kicker">Zone</span>${chips("zone", ZONES)}</div>
    <div class="two wide"><div class="panel"><div class="kv six"><div><b>${list.length}</b><span>${list.length === 1 ? "shot" : "shots"}</span></div><div><b>${g}</b><span>${g === 1 ? "goal" : "goals"}</span></div><div><b>${nf(x, 1)}</b><span>xG</span></div><div><b class="${g - x >= 0 ? "pos" : "neg"}">${sg(g - x, 1)}</b><span>goals − xG</span></div><div><b>${list.length ? pc(g / list.length) : "–"}</b><span>conversion</span></div><div><b>${list.length ? nf(dist, 1) : "–"}</b><span>avg. distance, m</span></div></div>
      ${halfPitch(list, "var(--home)", "Shots in this filter", list.length > 250 ? 0.55 : 1)}
      <p class="note">${list.length ? `On target: ${pc(on / list.length)}. Average chance: ${nf(x / list.length, 2)} xG. ` : ""}Gold is a goal. Filled is a save or a post. Empty is off target or blocked. Size is the chance of a goal.</p></div>
      <div class="panel"><p class="kicker">Most xG in this filter</p>${tops.length ? tops.map((o, i) => `<button class="tl" data-sq="${esc(o.n)}"><span class="mono" style="color:var(--muted)">${i + 1}</span><span class="tn">${esc(o.n)} <small>${esc(short(o.t))} · ${qty(o.sh, "shot", "shots")}</small></span><b>${o.g} / ${nf(o.x, 1)}</b></button>`).join("") : `<p class="empty">No shots match.</p>`}
      <p class="note">Goals / xG. Click a name to filter to that player.</p></div></div>
    <div class="panel"><p class="kicker">The biggest chances in this filter</p><div class="tw"><table><thead><tr><th class="l">GW</th><th class="l">Min</th><th class="l">Player</th><th class="l">Opponent</th><th class="l hm">Situation</th><th class="l hm">Body part</th><th>xG</th><th class="l">Outcome</th></tr></thead><tbody>
    ${shown.map(s => `<tr><td class="l mono" style="color:var(--muted)">${s[I.gw]}</td><td class="l mono">${s[I.min]}'</td><td class="l"><b>${esc(s[I.pl])}</b> <span class="note">${esc(short(s[I.team]))}</span></td><td class="l">${esc(nm(s[I.opp]))}</td><td class="l hm">${esc(s[I.sit])}</td><td class="l hm">${esc((BODY.find(b => b[0] === s[I.typ]) || [0, s[I.typ]])[1])}</td><td><b>${nf(s[I.xg], 2)}</b></td><td class="l ${s[I.res] === "G" ? "pos" : ""}">${RESN[s[I.res]]}</td></tr>`).join("")}</tbody></table></div>
    ${list.length > F.lim ? `<button class="chip" id="sf-more" style="align-self:flex-start">Show 30 more</button>` : ""}</div></section>`;
}

/* ---------- Player: sortable, filterable leaderboards ---------- */
const PG = {
  gol: ["Goals", [["g", "Goals", 0, 1], ["npg", "Non-penalty", 0, 1], ["xg", "xG", 1, 1], ["npxg", "npxG", 1, 1], ["fin", "G − xG", 1, 0], ["pg", "Penalties", 0, 1], ["hg", "Headers", 0, 1], ["ob", "Outside the box", 0, 1], ["lg", "After 75'", 0, 1]]],
  lov: ["Shots", [["sh", "Shots", 0, 1], ["sot", "On target", 0, 1], ["acc", "Accuracy %", 0, 0], ["xgs", "xG / shot", 2, 0], ["conv", "Conversion %", 0, 0], ["bc", "Big chances", 0, 1], ["bcm", "Big chances missed", 0, 1, 1], ["dist", "Avg. distance, m", 1, 0, 1]]],
  kre: ["Creativity", [["a", "Assists", 0, 1], ["xa", "xA", 1, 1], ["xgi", "xG + xA", 1, 1], ["cc", "Chances created", 0, 1], ["occ", "Open-play chances", 0, 1], ["kp", "Key passes", 0, 1], ["tb", "Through balls", 0, 1], ["cr", "Successful crosses", 0, 1], ["f3", "Passes into the final third", 0, 1]]],
  lab: ["On the ball", [["pas", "Passes", 0, 1], ["pp", "Pass completion %", 1, 0], ["car", "Carries", 0, 1], ["pc", "Progressive carries", 0, 1], ["pd", "Progressive distance, m", 0, 1], ["gdw", "Ground duels won", 0, 1], ["gdp", "Ground duels won %", 0, 0]]],
  ved: ["Defence", [["dc", "Defensive contribution", 0, 1], ["tck", "Tackles", 0, 1], ["itc", "Interceptions", 0, 1], ["rec", "Recoveries", 0, 1], ["blk", "Blocks", 0, 1], ["clr", "Clearances", 0, 1], ["adw", "Aerial duels won", 0, 1], ["adp", "Aerial duels won %", 0, 0], ["fc", "Fouls", 0, 1, 1], ["yc", "Yellow cards", 0, 1, 1]]],
  concedes: ["Goalkeeper", [["gpv", "Goals prevented", 1, 1], ["sv", "Saves", 0, 1], ["svp", "Save %", 0, 0], ["xgot", "xG on target faced", 1, 1], ["gc", "Goals conceded", 0, 1, 1], ["cs", "Clean sheets", 0, 1]]],
  kul: ["Special", [["wpa", "Win probability added", 2, 1], ["padd", "Points added by goals", 0, 1], ["dec", "Winning goals", 0, 1], ["ug", "Solo goals", 0, 1], ["share", "Share of club xG+xA", 0, 0], ["gi90", "G+A / 90", 2, 0], ["val", "xG+xA per €10m", 2, 0], ["bcm", "Big chances missed", 0, 1, 1]]],
  fpl: ["FPL and value", [["pts", "FPL points", 0, 1], ["price", "Price, £m", 1, 0], ["ppm", "Points per £m", 1, 0], ["sel", "Selected %", 1, 0], ["form", "Form", 1, 0], ["epn", "Expected points, next", 1, 0], ["mv", "Market value, €m", 1, 0], ["age", "Age", 0, 0, 1]]],
};
const TEAMXGI = {}; for (const p of PL) TEAMXGI[p.t] = (TEAMXGI[p.t] || 0) + p.xg + p.xa;
function pv(p, k) {
  switch (k) {
    case "fin": return p.g - p.xg; case "acc": return p.sh ? p.sot / p.sh * 100 : null; case "xgs": return p.sh ? p.xg / p.sh : null; case "conv": return p.sh ? p.g / p.sh * 100 : null;
    case "xgi": return p.xg + p.xa; case "gdp": return p.gdt >= 10 ? p.gdw / p.gdt * 100 : null; case "adp": return p.adt >= 10 ? p.adw / p.adt * 100 : null;
    case "share": return TEAMXGI[p.t] && p.xg + p.xa > 0 ? (p.xg + p.xa) / TEAMXGI[p.t] * 100 : null; case "gi90": return p.min >= TH.min_minutes_default ? (p.g + p.a) / p.min * 90 : null;
    case "val": return p.mv && (p.xg + p.xa) > 0.5 ? (p.xg + p.xa) / (p.mv / 1e7) : null; case "ppm": return p.price ? p.pts / p.price : null; case "mv": return p.mv ? p.mv / 1e6 : null;
    case "wpa": return WPA[p.id] != null ? WPA[p.id] : null;
    case "svp": return p.sv != null && p.sv + (p.gc || 0) >= 10 ? p.svp : null;
    default: return p[k] == null ? null : +p[k];
  }
}
const POS = [["", "All"], ["GKP", "Goalkeeper"], ["DEF", "Defender"], ["MID", "Midfielder"], ["FWD", "Forward"]];
const TOPS = [["Goals", "g"], ["Assists", "a"], ["Points added by goals", "padd"], ["Win probability added", "wpa"], ["xG", "xg"], ["Chances created", "cc"], ["Defensive contribution", "dc"], ["Goals prevented", "gpv"], ["FPL points", "pts"]];
function topCards() {
  return `<div class="tops">${TOPS.map(([l, key]) => { const list = PL.map(p => ({ p, v: pv(p, key) })).filter(x => x.v != null && x.v > 0).sort((a, b) => b.v - a.v || a.p.min - b.p.min).slice(0, 5);
    return `<div class="topc"><span class="kicker">${esc(l)}</span>${list.map((x, i) => `<button class="tl" data-p="${x.p.id}"><span class="mono" style="color:var(--muted)">${i + 1}</span><span class="tn">${esc(x.p.n)} <small>${esc(short(x.p.t))}</small></span><b>${nf(x.v, Number.isInteger(x.v) ? 0 : 1)}</b></button>`).join("")}</div>`; }).join("")}</div>`;
}
function viewJatekos() {
  const [, cols] = PG[S.grp], cnt = Object.fromEntries(cols.map(c => [c[0], c[3]]));
  const pos = S.grp === "concedes" ? "GKP" : S.ppos, q = fold(S.q);
  const val = (p, k, d) => { let v = pv(p, k); if (v != null && S.p90 && cnt[k] && p.min > 0) v = v / p.min * 90; return v; };
  const sk = S.psort && cols.some(c => c[0] === S.psort.k) ? S.psort : { k: cols[0][0], asc: !!cols[0][4] };
  const base = PL.filter(p => p.min >= S.pmin && (!S.pteam || p.t === S.pteam) && (!pos || p.pos === pos) && (!q || fold(p.n + " " + p.full).includes(q)));
  const rows = base.map(p => { const r = { id: p.id, p }; for (const [k] of cols) r[k] = val(p, k); return r; });
  const sorted = sortRows(rows, sk.k, sk.asc), shown = sorted.slice(0, S.plim);
  const heat = rankHeat(rows, sk.k, (cols.find(c => c[0] === sk.k) || [])[4]);
  const fmt = (r, k, d) => { const v = r[k]; if (v == null) return "–"; const dd = S.p90 && cnt[k] ? Math.max(2, d) : d; return k === "fin" ? sg(v, dd) : nf(v, dd); };
  const sel = PL.find(p => p.id === S.psel) || (shown[0] && shown[0].p), cmp = PL.find(p => p.id === S.pcmp);
  return `<section class="sec"><div class="sechead"><h2>Leaderboards</h2><span class="kicker">season so far · updated ${esc((D.exported || "").slice(0, 10))}</span></div>${topCards()}</section>
    <section class="sec"><div class="sechead"><h2>Players</h2></div>
    <div class="seg" role="group" aria-label="show">${Object.entries(PG).map(([k, v]) => `<button data-pg="${k}" aria-pressed="${S.grp === k}">${v[0]}</button>`).join("")}</div>
    <div class="row">${S.grp === "concedes" ? "" : `<div class="seg" role="group" aria-label="Position">${POS.map(([k, l]) => `<button data-pos="${k}" aria-pressed="${S.ppos === k}">${l}</button>`).join("")}</div>`}
      <select class="sel" id="pteam" aria-label="Club"><option value="">Every club</option>${TEAMS.map(t => `<option ${t === S.pteam ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
      <select class="sel" id="pmin" aria-label="Minutes">${[0, 90, 270, 450, 630].map(v => `<option value="${v}" ${v === S.pmin ? "selected" : ""}>${v ? v + "+ minutes" : "Any minutes"}</option>`).join("")}</select>
      <button class="chip" id="p90" aria-pressed="${S.p90}">Per 90</button><input class="sel" id="pq" type="search" placeholder="Search by name" value="${esc(S.q)}" aria-label="Search by name" style="min-width:0;flex:1 1 140px;max-width:240px"></div>
    <div class="panel"><div class="tw"><table class="sticky1 wrapth" id="pt"><thead><tr><th class="l">#</th><th class="l">Player</th><th class="hm">Min</th>${cols.map(([k, l]) => `<th data-pk="${k}" ${sk.k === k ? `aria-sort="${sk.asc ? "ascending" : "descending"}"` : ""}>${esc(l)}${sk.k === k ? (sk.asc ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead><tbody>
    ${shown.length ? shown.map((r, i) => `<tr class="click ${sel && r.id === sel.id ? "sel" : ""}" data-p="${r.id}"><td class="l mono" style="color:var(--muted)">${i + 1}</td><td class="l pn"><b>${esc(r.p.n)}</b><span class="note">${esc(short(r.p.t))} · ${r.p.pos}</span></td><td class="hm">${r.p.min}</td>${cols.map(([k, , d]) => `<td style="${k === sk.k && heat[r.id] != null ? `background:${heatRGB(heat[r.id], .3)}` : ""}">${k === sk.k ? `<b>${fmt(r, k, d)}</b>` : fmt(r, k, d)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${cols.length + 3}" class="l empty">No players match.</td></tr>`}</tbody></table></div>
    <div class="row" style="justify-content:space-between"><span class="note">${qty(sorted.length, "player", "players")} · ${S.p90 ? "scaled to 90 minutes" : "season totals"}${S.grp === "concedes" ? " · goalkeepers only" : ""}</span>${sorted.length > S.plim ? `<button class="chip" id="pmore">Show 25 more</button>` : ""}</div>
    <p class="note">Click a column heading to sort, and a row for the player's profile. Win probability added is how many expected points the player's goals were worth to the club at that moment, in the style of NFL win-probability added. Points added by goals is how many league points those goals were worth. Without them, the club would have had fewer. A winning goal is the one that put the club ahead for good. A solo goal has no assist and is not a penalty. Defensive contribution is the official Fantasy Premier League measure of tackles, blocks, clearances and recoveries. Sources: Fantasy Premier League, Opta, Understat, Transfermarkt.</p></div></section>
    ${sel ? playerProfile(sel, cmp) : ""}`;
}
function playerProfile(sel, cmp) {
  const psh = (pl) => pl ? SH.filter(s => s[I.pid] === pl.id) : [];
  const ps = percentiles(sel), pc2 = cmp ? percentiles(cmp) : null;
  const peers = PL.filter(q => q.pos === sel.pos && q.min >= TH.min_minutes_default && q.id !== sel.id).sort((a, b) => a.n.localeCompare(b.n));
  const facts = [[sel.g, sel.g === 1 ? "goal" : "goals"], [sel.a, sel.a === 1 ? "assist" : "assists"], [nf(sel.xg, 1), "xG"], [nf(sel.xa, 1), "xA"], [sel.padd, sel.padd === 1 ? "point added by goals" : "points added by goals"], [sel.pts, sel.pts === 1 ? "FPL point" : "FPL points"]];
  return `<section class="sec" id="profile"><div class="panel"><div class="row" style="justify-content:space-between;align-items:flex-end"><div><p class="kicker">${esc(sel.t)} · ${sel.pos} · ${sel.min} minutes${sel.age ? ` · ${sel.age} years old` : ""}</p><h3 style="font-family:var(--f-display);font-size:34px;text-transform:uppercase;line-height:1">${esc(sel.n)}</h3>${sel.news ? `<p class="note neg">${esc(sel.news)}</p>` : ""}</div>${sel.mv ? `<span class="mono" style="color:var(--muted)">${nf(sel.mv / 1e6, 0)} M€ · £${nf(sel.price, 1)}m</span>` : ""}</div>
    <div class="kv six">${facts.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join("")}</div>
    <div class="two eq"><div style="display:flex;flex-direction:column;gap:8px"><div class="row"><span class="note">Compare with</span><select class="sel" id="pcmp" aria-label="Compare with another player"><option value="">Choose a player…</option>${peers.map(q => `<option value="${q.id}" ${cmp && cmp.id === q.id ? "selected" : ""}>${esc(q.n)} (${esc(short(q.t))})</option>`).join("")}</select></div>
      ${pc2 ? `<div class="lgd"><span><i style="background:var(--gold)"></i>${esc(sel.n)} (upper bar)</span><span><i style="background:var(--away)"></i>${esc(cmp.n)} (lower bar)</span></div>` : ""}
      ${ps.map((z, i) => `<div class="strip ${pc2 ? "cmp" : ""}"><span class="lab">${z.l}</span><span class="bar ${pc2 ? "two" : ""}">${pc2 ? `<span class="dot dn" style="left:${pc2[i].pr * 100}%;background:var(--away)" title="${esc(cmp.n)}: ${nf(pc2[i].v, z.d)}"></span>` : ""}<span class="dot ${pc2 ? "up" : ""}" style="left:${z.pr * 100}%;background:var(--gold)" title="${esc(sel.n)}: ${nf(z.v, z.d)}"></span></span><span class="v">${pc2 ? `<b style="color:var(--gold)">${nf(z.v, z.d)}</b><br><b style="color:var(--away)">${nf(pc2[i].v, z.d)}</b>` : nf(z.v, z.d)}</span></div>`).join("")}
      <p class="note">Percentile among ${sel.pos === "GKP" ? "goalkeepers" : sel.pos === "DEF" ? "defenders" : sel.pos === "MID" ? "midfielders" : sel.pos === "FWD" ? "forwards" : "players"} with at least 270 minutes, per 90. Left is lower, right is higher.${cmp ? ` The lower mark is ${esc(cmp.n)}.` : ""}</p></div>
    <div class="row" style="align-items:flex-start;gap:12px"><div style="flex:1 1 220px;min-width:0"><p class="kicker">${esc(sel.n)} · ${qty(psh(sel).length, "shot", "shots")}</p>${halfPitch(psh(sel), "var(--home)", sel.n)}</div>${cmp ? `<div style="flex:1 1 220px;min-width:0"><p class="kicker">${esc(cmp.n)} · ${qty(psh(cmp).length, "shot", "shots")}</p>${halfPitch(psh(cmp), "var(--away)", cmp.n)}</div>` : ""}</div></div></div></section>`;
}

const OPK = [["possession_pos_perc", "Possession", 1, "%", false], ["sequences_ppda", "PPDA (pressing)", 1, "", true], ["sequences_direct_speed_for", "Attack speed", 2, "m/s", false], ["sequences_high_turnovers", "High turnovers", 0, "", false],
  ["sequences_build_ups", "Build-up attacks", 0, "", false], ["sequences_direct_attacks", "Direct attacks", 0, "", false], ["attack_set_piece_team_sp_goal_perc", "Set-piece goals", 0, "%", false], ["attack_misc_fast_break_goals", "Fast-break goals", 0, "", false]];
const orank = (k, v, low) => { if (v == null) return null; const a = Object.values(OP).map(o => o[k]).filter(x => x != null); return (low ? a.filter(x => x < v).length : a.filter(x => x > v).length) + 1; };
function rankIn(rows, k, t, low) { const v = rows.find(r => r.t === t)[k]; if (v == null) return null; const vals = rows.map(r => r[k]).filter(x => x != null); return (low ? vals.filter(x => x < v).length : vals.filter(x => x > v).length) + 1; }
function trendSentences(t, r) {
  const TM = teamMetrics(S.gw), me = TM.find(z => z.t === t), R = ratings(S.gw), F = [];
  const add = (rk, n, txt) => { if (rk == null) return; F.push({ s: Math.min(rk, n + 1 - rk), txt }); };
  const n = TM.length;
  const howHigh = (rk, word) => rk === 1 ? `the ${word} in the league` : `the ${ord(rk)} ${word} in the league`;
  const howLow = (rk, word) => { const fromEnd = n + 1 - rk; return fromEnd === 1 ? `the ${word} in the league` : `the ${ord(fromEnd)} ${word} in the league`; };
  { const rk = rankIn(TM, "sp", t); if (me.sp != null) add(rk, n, rk <= 3 ? `${nf(me.sp, 0)}% of their xG comes from set pieces, ${howHigh(rk, "highest share")}.` : rk >= n - 2 ? `Set pieces are barely a threat: only ${nf(me.sp, 0)}% of their xG comes from them, ${howLow(rk, "lowest share")}.` : `${nf(me.sp, 0)}% of their xG comes from set pieces (${ord(rk)} in the league).`); }
  { const rk = rankIn(TM, "fin", t); const gap = qty(nf(Math.abs(me.fin), 1), "goal", "goals"); const side = me.fin >= 0 ? "above" : "short of"; add(rk, n, rk <= 3 ? `Finishing is ${howHigh(rk, "best")}: ${gap} ${side} the chances.` : rk >= n - 2 ? `Finishing is ${howLow(rk, "worst")}: ${gap} ${side} the chances.` : `Finishing is ${gap} ${side} the chances (${ord(rk)} in the league).`); }
  { const rk = rankIn(TM, "keep", t); const versus = me.keep >= 0 ? `${qty(nf(me.keep, 1), "goal", "goals")} fewer than the chances allowed` : `${qty(nf(-me.keep, 1), "goal", "goals")} more than the chances allowed`; add(rk, n, rk <= 3 ? `Excellent at the back: they have conceded ${versus}, ${howHigh(rk, "best record")}.` : rk >= n - 2 ? `Leaky at the back: they have conceded ${versus}, ${howLow(rk, "worst record")}.` : `They have conceded ${versus} (${ord(rk)} in the league).`); }
  { const rk = rankIn(TM, "dropped", t); if (me.dropped > 0) add(rk, n, `They have dropped ${qty(me.dropped, "point", "points")} from winning positions${rk <= 3 ? `, ${rk === 1 ? "the most in the league" : `the ${ord(rk)} most in the league`}` : ` (${ord(rk)} most)`}.`); }
  { const rk = rankIn(TM, "won", t); if (me.won > 0) add(rk, n, `They have rescued ${qty(me.won, "point", "points")} from losing positions${rk <= 3 ? `, ${rk === 1 ? "the most in the league" : `the ${ord(rk)} most in the league`}. They keep coming back` : ` (${ord(rk)} most)`}.`); }
  { const rk = rankIn(TM, "lead", t); add(rk, n, rk <= 3 ? `They have led for ${nf(me.lead, 0)}% of playing time, ${howHigh(rk, "most")}.` : rk >= n - 2 ? `They have led for only ${nf(me.lead, 0)}% of playing time, ${howLow(rk, "least")}.` : `They have led for ${nf(me.lead, 0)}% of playing time (${ord(rk)} in the league).`); }
  { const rk = rankIn(TM, "xgs", t); add(rk, n, rk <= 3 ? `They pick their shots: ${nf(me.xgs, 2)} xG per shot, ${howHigh(rk, "best chance quality")}.` : rk >= n - 2 ? `A lot of poor chances: only ${nf(me.xgs, 2)} xG per shot, ${howLow(rk, "lowest chance quality")}.` : `Shots average ${nf(me.xgs, 2)} xG (${ord(rk)} in the league).`); }
  { const rk = rankIn(TM, "ppda", t, true), ht = rankIn(TM, "hto", t); if (rk) add(rk, n, rk <= 3 && ht >= 12 ? `The press is ${howHigh(rk, "most aggressive")} by PPDA, but only ${ord(ht)} for winning the ball high. It is not paying off.` : rk <= 3 ? `The press is ${howHigh(rk, "most aggressive")} by PPDA, and they rank ${ord(ht)} for winning the ball high.` : rk >= n - 2 ? `The press is ${howLow(rk, "most passive")}: they sit off and wait.` : `The press sits in the middle of the league (PPDA ${ord(rk)}).`); }
  { const nx = TEAMS.map(z => { const fx = FX.filter(f => f[0] > S.gw && (f[1] === z || f[2] === z)).slice(0, 5); return { t: z, v: fx.reduce((a, f) => a + predFor(z, f[1] === z ? f[2] : f[1], f[1] === z, R).xp, 0) }; });
    const rk = nx.slice().sort((a, b) => b.v - a.v).findIndex(z => z.t === t) + 1; if (nx.find(z => z.t === t).v > 0) add(rk, n, rk <= 3 ? `The next five matches are ${howHigh(rk, "easiest run")}. Points are there to be taken.` : rk >= n - 2 ? `The next five matches are ${howLow(rk, "hardest run")}.` : `The next five matches are about average for difficulty (${ord(rk)} easiest).`); }
  { const rk = rankIn(TM, "sosA", t, true); add(rk, n, rk >= n - 2 ? `They have had ${howLow(rk, "hardest run")} so far. That belongs in any reading of the points.` : rk <= 3 ? `They have had ${howHigh(rk, "easiest run")} so far, which flatters the points.` : `The run so far has been about average (${ord(rk)} easiest).`); }
  const out = F.sort((a, b) => a.s - b.s).filter((f, i) => f.s <= 3 || (i < 3 && f.s <= 6)).slice(0, 4).map(f => f.txt);
  const ms = teamMatches(t, S.gw).map(m => persp(m, t)); if (ms.length >= 6) { const a = ms.slice(-3), b = ms.slice(0, -3); const da = a.reduce((q, z) => q + z.xg - z.xga, 0) / a.length, db = b.reduce((q, z) => q + z.xg - z.xga, 0) / b.length; out.push(da - db > 0.5 ? `Improving: an xG difference of ${sg(da, 1)} per match over the last three, after ${sg(db, 1)} before that.` : da - db < -0.5 ? `Falling off: an xG difference of ${sg(da, 1)} per match over the last three, after ${sg(db, 1)} before that.` : `Steady: an xG difference of ${sg(da, 1)} per match over the last three.`); }
  void r; return out;
}
function stateSegs(m, t) {
  const me = m.h === t ? 0 : 1, ev = [];
  for (const [we, side, , res] of m.shots) { if (res === "G") ev.push([we, side]); else if (res === "O") ev.push([we, 1 - side]); }
  const end = Math.max(TH.regulation_minutes, ...m.shots.map(s => s[0] + 1)); let gf = 0, ga = 0, last = 0; const seg = [], goals = [];
  for (const [we, side] of ev) { if (we > last) seg.push([last, we, Math.sign(gf - ga)]); last = Math.max(last, we); if (side === me) gf++; else ga++; goals.push([we, side === me]); }
  seg.push([last, end, Math.sign(gf - ga)]); return { seg, goals, end };
}
function gameStateViz(t) {
  const ms = teamMatches(t, S.gw); if (!ms.length) return "";
  const gs = gameState(t, S.gw), nw = narrow(), W = nw ? 360 : 620, L = nw ? 96 : 150, Rr = 8, rh = 22, T = 16, H = T + ms.length * rh + 14, mx = 98;
  const px = (v) => L + Math.min(v, mx) / mx * (W - L - Rr), COL = { 1: "var(--good)", 0: "#3a4266", "-1": "var(--bad)" };
  let g = `<text x="${px(0)}" y="10">0'</text><text x="${px(45)}" y="10" text-anchor="middle">45'</text><text x="${px(90)}" y="10" text-anchor="middle">90'</text>`;
  ms.forEach((m, i) => { const z = persp(m, t), { seg, goals } = stateSegs(m, t), y = T + i * rh;
    g += `<text x="${L - 8}" y="${y + 12}" text-anchor="end" style="font-size:10px;fill:var(--ink)">GW${m.gw} ${esc(nw ? short(z.o) : z.o)} ${z.home ? "(H)" : "(A)"} <tspan style="font-weight:700;fill:${z.p === 3 ? "var(--good)" : z.p === 1 ? "var(--muted)" : "var(--bad)"}">${z.gf}–${z.ga}</tspan></text>`;
    for (const [a, b, st] of seg) g += `<rect x="${px(a).toFixed(1)}" y="${y + 3}" width="${Math.max(0, px(b) - px(a)).toFixed(1)}" height="12" fill="${COL[st]}" opacity="${st === 0 ? 1 : .8}"><title>${a}–${b}': ${st > 0 ? "leading" : st < 0 ? "trailing" : "level"}</title></rect>`;
    for (const [we, mine] of goals) g += `<circle cx="${px(we).toFixed(1)}" cy="${y + 9}" r="3.4" fill="${mine ? "var(--gold)" : "var(--bg)"}" stroke="${mine ? "var(--bg)" : "var(--ink)"}" stroke-width="1.2"><title>${we}': ${mine ? "goal scored" : "goal conceded"}</title></circle>`; });
  g += `<line x1="${px(45)}" x2="${px(45)}" y1="${T}" y2="${H - 14}" stroke="#0a0d18" stroke-width="1.5" opacity=".7"/>`;
  const lv = Math.max(0, 100 - gs.lead - gs.trail);
  return `<div class="panel"><p class="kicker">Game state, match by match</p>
    <div class="gsbar"><i style="width:${gs.lead}%;background:var(--good)">${gs.lead > 9 ? nf(gs.lead, 0) + "%" : ""}</i><i style="width:${lv}%;background:#3a4266">${lv > 9 ? nf(lv, 0) + "%" : ""}</i><i style="width:${gs.trail}%;background:var(--bad)">${gs.trail > 9 ? nf(gs.trail, 0) + "%" : ""}</i></div>
    <div class="lgd"><span><i style="background:var(--good)"></i>leading</span><span><i style="background:#3a4266"></i>level</span><span><i style="background:var(--bad)"></i>trailing</span><span><i style="background:var(--gold)"></i>goal scored</span><span><i style="background:var(--bg);box-shadow:inset 0 0 0 1.5px var(--ink)"></i>goal conceded</span></div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Game state in each match">${g}</svg>
    <p class="note">Points dropped from a lead: <b style="color:var(--ink)">${gs.dropped}</b> · points rescued from behind: <b style="color:var(--ink)">${gs.won}</b> · scored first: <b style="color:var(--ink)">${gs.first == null ? "–" : nf(gs.first, 0) + "%"}</b> · goals after 75': <b style="color:var(--ink)">${gs.late}</b> scored, <b style="color:var(--ink)">${gs.lateA}</b> conceded.</p></div>`;
}
function nextFive(t) {
  const R = ratings(S.gw), fx = FX.filter(f => f[0] > S.gw && (f[1] === t || f[2] === t)).slice(0, 5); if (!fx.length) return "";
  return `<div class="panel"><p class="kicker">Next matches · expected points from the model</p><div class="nf">${fx.map(f => { const home = f[1] === t, o = home ? f[2] : f[1], { p, xp } = predFor(t, o, home, R), r = restAround(t, f[5]);
    return `<div class="nfc" style="border-color:${heatRGB((xp - .7) / 1.4, .8)}"><span class="kicker">GW${f[0]} · ${esc(DAY.format(new Date(f[3])))}</span><b>${esc(nm(o))}</b><span class="note">${home ? "Home" : "Away"} · ${pc(home ? p.pw : p.pl)} win</span><span class="mono" style="font-size:12px">${qty(nf(xp, 2), "point", "points")}${r.before != null && r.before < TH.short_rest_days ? ` · <span class="${restCls(r.before)}">${restDays(r.before)}</span>` : ""}</span></div>`; }).join("")}</div></div>`;
}
function viewCsapat() {
  const rows = table(S.gw); const r = rows.find(x => x.t === S.team) || rows[0];
  const sh = shotsUpTo(S.gw); const forS = sh.filter(s => s[I.team] === r.t), agS = sh.filter(s => s[I.opp] === r.t);
  const g = (a) => a.filter(s => s[I.res] === "G").length, x = (a) => a.reduce((q, s) => q + s[I.xg], 0);
  const o = OP[r.t] || {};
  const split = (arr) => ["op", "sp", "pen"].map(k => { const a = arr.filter(s => s[I.res] !== "O" && grpOf(s[I.sit]) === k); return { k, x: x(a), g: g(a) }; });
  const sf = split(forS), sa = split(agS), mx = Math.max(.1, ...sf.map(z => z.x), ...sa.map(z => z.x));
  const LBL = { op: "Open play", sp: "Set piece", pen: "Penalties" };
  const bars = (arr, col) => arr.map(z => `<div class="row" style="gap:6px;flex-wrap:nowrap"><span style="width:84px;flex:none;font-size:12.5px;color:var(--muted)">${LBL[z.k]}</span><span style="flex:1;height:10px;background:var(--panel2);border-radius:3px;overflow:hidden"><i style="display:block;height:100%;width:${z.x / mx * 100}%;background:${col}"></i></span><span class="mono" style="font-size:11px;flex:none;width:108px;text-align:right;white-space:nowrap">${nf(z.x, 1)} xG · ${qty(z.g, "goal", "goals")}</span></div>`).join("");
  const home = table(S.gw, "home").find(z => z.t === r.t), away = table(S.gw, "away").find(z => z.t === r.t);
  const Rnow = ratings(S.gw);
  const forNote = g(forS) > x(forS) + 1 ? "scoring more than the chances." : g(forS) < x(forS) - 1 ? "scoring less than the chances." : "about what the chances were worth.";
  const agNote = g(agS) < x(agS) - 1 ? "defending better than the chances." : g(agS) > x(agS) + 1 ? "conceding more than the chances allowed." : "about what the chances were worth.";
  return `<section class="sec"><div class="sechead"><h2>${esc(r.t)}</h2><select class="sel" id="tsel" aria-label="Club">${TEAMS.map(t => `<option ${t === r.t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
    <div class="insights" style="grid-template-columns:1fr">${`<div class="ins" style="--c:var(--home)"><span class="n">In short</span><p>They sit ${ord(r.rank)}. On the chances they would be ${ord(r.xrank)} (${sg(r.luck, 1)} points). On the Power list they are ${ord(Rnow.rank[r.t])} (attack ${ord(Rnow.ar[r.t])}, defence ${ord(Rnow.dr[r.t])}). ${trendSentences(r.t, r).join(" ")}</p></div>`}</div>
    ${nextFive(r.t)}
    <div class="xray"><div class="panel"><p class="kicker">Shots for · ${qty(forS.length, "shot", "shots")}</p>${halfPitch(forS, "var(--home)", "Shots for")}<p class="note">${qty(g(forS), "goal", "goals")} from ${nf(x(forS), 1)} xG: ${forNote}</p></div>
    <div class="panel"><p class="kicker">Shots faced · ${qty(agS.length, "shot", "shots")}</p>${halfPitch(agS, "var(--away)", "Shots faced")}<p class="note">${qty(g(agS), "goal", "goals")} conceded from ${nf(x(agS), 1)} xG: ${agNote}</p></div>
    <div class="panel"><p class="kicker">Profile · Opta, this season</p><div class="kv">${OPK.map(([k, l, d, u, low]) => { const rk = orank(k, o[k], low); return `<div><b>${nf(o[k], d)}${u && o[k] != null ? `<small style="font-size:13px"> ${u}</small>` : ""}</b><span>${l}</span>${rk ? `<i>${ord(rk)} in the league</i>` : ""}</div>`; }).join("")}</div></div></div>
    <div class="two wide"><div class="panel"><p class="kicker">Form: xG created and conceded, three-match average</p>${rolling(r.t)}<div class="lgd"><span><i style="background:var(--home)"></i>created</span><span><i style="background:var(--away)"></i>conceded</span><span><i style="background:var(--good)"></i>win</span><span><i style="background:#6b7394"></i>draw</span><span><i style="background:var(--bad)"></i>loss</span></div></div>
    <div class="panel"><p class="kicker">Where the chances come from</p>${bars(sf, "var(--home)")}<p class="kicker" style="margin-top:8px">Where the chances they concede come from</p>${bars(sa, "var(--away)")}
      <p class="kicker" style="margin-top:8px">Home and away</p><div class="kv"><div><b>${home.pts} / ${nf(home.xpts, 1)}</b><span>home points / deserved (${qty(home.P, "match", "matches")})</span></div><div><b>${away.pts} / ${nf(away.xpts, 1)}</b><span>away points / deserved (${qty(away.P, "match", "matches")})</span></div></div></div></div>
    ${cleanMatches(r.t)}${gameStateViz(r.t)}</section>`;
}
const STRIP = [["xG/90", (p) => p.xg / p.min * 90, 2], ["xA/90", (p) => p.xa / p.min * 90, 2], ["Goals − xG", (p) => p.g - p.xg, 2], ["Chances/90", (p) => (p.cc || 0) / p.min * 90, 2], ["Progressive carries/90", (p) => (p.pc || 0) / p.min * 90, 2], ["Through balls/90", (p) => (p.tb || 0) / p.min * 90, 2], ["Recoveries/90", (p) => (p.rec || 0) / p.min * 90, 2], ["Tackles/90", (p) => (p.tck || 0) / p.min * 90, 2]];
function percentiles(p) {
  const peers = PL.filter(q => q.pos === p.pos && q.min >= TH.min_minutes_default);
  return STRIP.map(([l, f, d]) => { const vals = peers.map(f).sort((a, b) => a - b); const v = f(p); const pr = vals.length > 1 ? vals.filter(z => z < v).length / (vals.length - 1) : .5; return { l, v, d, pr: Math.max(0, Math.min(1, pr)) }; });
}
function method() {
  const runs = C.simulation.runs.toLocaleString("en-GB");
  return `<section class="sec"><details class="panel"><summary class="kicker" style="cursor:pointer">How this is calculated</summary><div class="note" style="max-width:86ch;display:flex;flex-direction:column;gap:8px;margin-top:10px">
    <p><b style="color:var(--ink)">xG</b> is the chance a shot becomes a goal, from where and how it was taken (Understat). A 0.10 shot scores about once in ten.</p>
    <p><b style="color:var(--ink)">The chance bar and points deserved.</b> From the shots in a match we calculate the chance of a home win, a draw and an away win. Points deserved are 3 times the win chance plus the draw chance. A robbery is a win the shots rated below ${Math.round(TH.robbery_win_probability * 100)}%.</p>
    <p><b style="color:var(--ink)">Power and the forecast.</b> Each club has an attack rating and a defence rating, fit to chances created and conceded (${Math.round(RTG.xg_blend * 100)}% xG, ${Math.round((1 - RTG.xg_blend) * 100)}% actual goals), adjusted for the opponent${RTG.home_advantage === false ? "" : " and for home advantage"}. Recent matches count for more, with a ${RTG.tau_rounds}-round half-life. Early in the season the ratings lean on a pre-season strength (the season file when one is supplied, otherwise earlier league results), and that anchor fades as this season's matches pile up. Match chances come from the two expected-goal figures (Poisson, with a Dixon–Coles adjustment that adds a few draws). The rest of the season is played ${runs} times.</p>
    <p><b style="color:var(--ink)">Adjusted xG</b> divides a match's xG by what an average side would create against that opponent, at that ground. Opponent strength and home advantage come from this season's xG only. Early on, those ratings are pulled gently towards the pre-season figure so one match cannot swing them.</p>
    <p><b style="color:var(--ink)">True strength</b> turns adjusted xG into the points that performance would be worth against an average opponent on a neutral pitch. Schedule and venue are the gap between that and the same sum from raw xG. Finishing and goalkeeping turn the gap between goals and xG into points. Whatever is left is other luck, so the pieces add up to the real points total.</p>
    <p><b style="color:var(--ink)">Win probability, minute by minute,</b> starts from the strength model before the round, then updates it for the score and the time left. Goals still to come follow a Poisson distribution. It does not see red cards or substitutions. The excitement index adds up how much the home and away win chances move.</p>
    <p><b style="color:var(--ink)">Schedule and rest.</b> The difficulty of a future match is the points the model expects from it. Rest is the time since a club's previous competitive match, including Champions League, Europa League and Conference League games loaded automatically. Domestic cups are not included, so a League Cup or FA Cup week can look quieter than it was. ${esc(D.europe_note || "")}</p>
    <p><b style="color:var(--ink)">Game state</b> is read from the goal times: how long a side led or trailed, points dropped from a winning position, points rescued from a losing one.</p>
    <p><b style="color:var(--ink)">Opta numbers.</b> PPDA is how many passes the opponent is allowed before a defensive action (lower means a more aggressive press). High turnovers are balls won within 40 metres of the opponent's goal. There are also directness and build-up counts.</p>
    <p>Penalty xG used for non-penalty figures is the average of this season's ${DER.pen_n} penalties (${nf(DER.pen_xg, 2)}), not a fixed number. The strength rating uses a goal level of ${nf(RTG.goal_level_prior, 2)} per team per match.</p></div></details></section>`;
}
function render() {
  if (!S.team) { const r = table(S.gw).slice().sort((a, b) => a.luck - b.luck)[0]; S.team = r.t; }
  const V = { fordulo: viewFordulo, elozetes: viewElozetes, schedule: viewMenetrend, valodi: viewValodi, tamadas: () => viewAD("att"), vedekezes: () => viewAD("def"), table: viewTabella, tisztitott: cleanSection, power: viewPower, eselyek: simSection, mutatok: viewMutatok, club: viewCsapat, jatekos: viewJatekos, meccsek: viewMeccsek, lovesek: viewLovesek }[S.tab] || viewFordulo;
  const changes = (D.fixture_changes || []).filter(c => c.kind !== "added" || false);
  const changeNote = changes.length ? ` Fixture changes since the last build: ${changes.slice(0, 4).map(c => `${c.home} vs ${c.away} (${c.kind})`).join("; ")}.` : "";
  $("app").innerHTML = header() + V() + method() + `<p class="credit">Data: <a href="https://github.com/oladeeayo/pl-catalogue">pl-catalogue</a> (Fantasy Premier League, Understat, Opta via The Analyst, Transfermarkt), non-commercial, with attribution. Kickoff times and scores are checked against the Premier League's own fixture feed. European dates come from ESPN's public football schedule. Pre-season strength is calculated here from historical Premier League and Championship results (football-data.co.uk). No bookmaker prices. Updated ${esc((D.exported || "").slice(0, 10))}, gameweeks 1–${D.gw}. Independent, unofficial.${esc(changeNote)} <a href="./status.html">Build status</a>.</p>`;
}
function rerender(keepScroll = true) { const y = scrollY; render(); if (keepScroll) scrollTo(0, y); }
const toTop = () => { const st = document.querySelector(".sticky"); if (st && scrollY > st.offsetTop) scrollTo(0, st.offsetTop - 4); };
document.addEventListener("click", (e) => {
  const t = e.target;
  const gw = t.closest("[data-gw]"); if (gw) { S.gw = +gw.dataset.gw; S.open = null; rerender(); return; }
  const mn = t.closest("[data-main]"); if (mn) { const n = NAV.find(x => x[0] === mn.dataset.main); S.tab = S.lastSub[n[0]] || n[3][0][0]; persist(); rerender(false); toTop(); return; }
  const tab = t.closest("[data-tab]"); if (tab) { S.tab = tab.dataset.tab; S.lastSub[mainOf(S.tab)[0]] = S.tab; persist(); rerender(false); toTop(); return; }
  const vt = t.closest("[data-vt]"); if (vt) { S.team = vt.dataset.vt; persist(); rerender(); return; }
  const md = t.closest("[data-mode]"); if (md) { S.mode = md.dataset.mode; rerender(); return; }
  const tk = t.closest("[data-tick]"); if (tk) { S.tick = +tk.dataset.tick; rerender(); return; }
  const tg = t.closest("[data-tg]"); if (tg) { S.tgrp = tg.dataset.tg; S.tms = null; rerender(); return; }
  const pg = t.closest("[data-pg]"); if (pg) { S.grp = pg.dataset.pg; S.psort = null; S.plim = 25; rerender(); return; }
  const ps = t.closest("[data-pos]"); if (ps) { S.ppos = ps.dataset.pos; S.plim = 25; rerender(); return; }
  const thp = t.closest("th[data-pk]"); if (thp) { const k = thp.dataset.pk; S.psort = S.psort && S.psort.k === k ? { k, asc: !S.psort.asc } : { k, asc: !!((PG[S.grp][1].find(c => c[0] === k) || [])[4]) }; rerender(); return; }
  const tha = t.closest("th[data-ak]"); if (tha) { const k = tha.dataset.ak, sd = tha.dataset.side, low = !!((ADC[sd].cols.find(c => c[0] === k) || [])[3]); S.ads = S.ads && S.ads.side === sd && S.ads.k === k ? { side: sd, k, asc: !S.ads.asc } : { side: sd, k, asc: low }; rerender(); return; }
  const tht = t.closest("th[data-tk]"); if (tht) { const k = tht.dataset.tk; S.tms = S.tms && S.tms.k === k ? { k, asc: !S.tms.asc } : { k, asc: !!((TG[S.tgrp][1].find(c => c[0] === k) || [])[3]) }; rerender(); return; }
  const mo = t.closest("[data-mo]"); if (mo) { const id = +mo.dataset.mo; S.open = S.open === id ? null : id; rerender(); return; }
  const mft = t.closest("[data-mft]"); if (mft) { S.mf.tag = mft.dataset.mft; S.mf.lim = 20; S.open = null; rerender(); return; }
  const sfc = t.closest("[data-sfc]"); if (sfc) { const [k, v] = sfc.dataset.sfc.split(":"); S.sf[k] = v; S.sf.lim = 30; rerender(); return; }
  const sqb = t.closest("[data-sq]"); if (sqb) { S.sf.q = sqb.dataset.sq; S.sf.lim = 30; rerender(); return; }
  if (t.id === "mf-more") { S.mf.lim += 20; rerender(); return; }
  if (t.id === "sf-more") { S.sf.lim += 30; rerender(); return; }
  if (t.id === "mf-reset") { S.mf = Object.assign({}, MF0); S.open = null; rerender(); return; }
  if (t.id === "sf-reset") { S.sf = Object.assign({}, SF0); rerender(); return; }
  const mc = t.closest(".mc:not(.pvw)"); if (mc && !t.closest(".mdetail")) { const id = +mc.dataset.m; S.open = S.open === id ? null : id; rerender(); if (S.open) document.querySelector(`.mc[data-m="${id}"]`).scrollIntoView({ block: "nearest", behavior: "smooth" }); return; }
  const th = t.closest("#jt th[data-k]"); if (th) { S.tsort = th.dataset.k; rerender(); return; }
  const tr = t.closest("tr[data-t], circle[data-t], .prow[data-t]"); if (tr) { S.team = tr.dataset.t; persist(); S.tab = "club"; S.lastSub.adatbazis = "club"; rerender(false); toTop(); return; }
  const pr = t.closest("[data-p]"); if (pr) { S.psel = +pr.dataset.p; S.pcmp = null; rerender(); const el = $("profile"); if (el) el.scrollIntoView({ block: "start", behavior: "smooth" }); return; }
  if (t.id === "pmore") { S.plim += 25; rerender(); return; }
  if (t.id === "p90") { S.p90 = !S.p90; rerender(); }
});
document.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.classList && ((e.target.classList.contains("mc") && !e.target.classList.contains("pvw")) || e.target.classList.contains("mrow"))) { e.preventDefault(); e.target.click(); } });
document.addEventListener("change", (e) => {
  const id = e.target.id, dm = e.target.dataset || {};
  if (dm.mf) { const v = e.target.value; S.mf[dm.mf] = dm.mf === "from" ? +v : v; if (dm.mf === "team" && !v) S.mf.venue = ""; S.mf.lim = 20; S.open = null; rerender(); return; }
  if (dm.sf) { const v = e.target.value; if (dm.sf === "min") { const [a, b] = v.split("-").map(Number); S.sf.mfrom = a; S.sf.mto = b; } else S.sf[dm.sf] = dm.sf === "from" || dm.sf === "xmin" ? +v : v; S.sf.lim = 30; rerender(); return; }
  if (id === "tsel") { S.team = e.target.value; persist(); } else if (id === "pmin") { S.pmin = +e.target.value; S.plim = 25; } else if (id === "pteam") { S.pteam = e.target.value; S.psel = null; S.plim = 25; } else if (id === "pcmp") S.pcmp = e.target.value ? +e.target.value : null; else return;
  rerender();
});
let qt; document.addEventListener("input", (e) => {
  if (e.target.id === "sq") { const v = e.target.value; clearTimeout(qt); qt = setTimeout(() => { S.sf.q = v; S.sf.lim = 30; rerender(); const el = $("sq"); if (el) { el.focus(); el.setSelectionRange(v.length, v.length); } }, 200); return; }
  if (e.target.id !== "pq") return; const v = e.target.value; clearTimeout(qt);
  qt = setTimeout(() => { S.q = v; S.plim = 25; rerender(); const el = $("pq"); if (el) { el.focus(); el.setSelectionRange(v.length, v.length); } }, 180);
});
let rz, lastW = window.innerWidth; addEventListener("resize", () => { if (window.innerWidth === lastW) return; lastW = window.innerWidth; clearTimeout(rz); rz = setTimeout(() => rerender(), 250); });
render();
window.__plr = { S, render, ratings, predict, fairOdd };
})();
