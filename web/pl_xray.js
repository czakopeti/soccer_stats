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
const sg = (v, d = 1) => v == null ? "–" : (v > 0.005 ? "+" : v < -0.005 ? "−" : "") + Math.abs(v).toFixed(d);
const pc = (v) => Math.round(v * 100) + "%";
const pc1 = (v) => v > 0 && v < 0.005 ? "<1%" : v > 0.995 && v < 1 ? ">99%" : Math.round(v * 100) + "%";
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
  if (win && pAct < TH.robbery_win_probability) { const rk = robberyRank(m, S.gw); return { tag: "Robbery", cls: "rob", txt: `<b>${esc(win)}</b> won it, but the shots said they only had a ${pc(pAct)} chance${pLoseWin > 0.4 ? `, against ${pc(pLoseWin)} for ${esc(lose)}` : ""}.${rk <= 5 ? ` The ${ord(rk)} biggest robbery of the season so far.` : ""}` }; }
  if (!win && Math.max(m.pw, m.pl) > TH.blown_win_probability) { const t = m.pw > m.pl ? m.h : m.a; return { tag: "Blown win", cls: "rob", txt: `<b>${esc(t)}</b> had a ${pc(Math.max(m.pw, m.pl))} chance of winning and still only drew.` }; }
  if (win && pAct > TH.dominance_win_probability && Math.abs(m.xh - m.xa) > TH.dominance_xg_diff) return { tag: "Deserved", cls: "dom", txt: `<b>${esc(win)}</b> won it and the shots agreed: a ${pc(pAct)} chance.` };
  return { tag: "Fair", cls: "", txt: win ? `${esc(win)} had a ${pc(pAct)} chance of winning, from the shots.` : `The draw was the ${pc(pAct)} outcome from the shots.` };
}

/* ---------- insights ---------- */
function insights() {
  const gw = S.gw, out = [];
  const rows = M.filter(m => m.gw === gw);
  // 1. robbery or dominance of the round
  const rob = rows.map(m => ({ m, ...verdictRaw(m) })).filter(x => x.win).sort((a, b) => a.pAct - b.pAct)[0];
  if (rob && rob.pAct < TH.robbery_win_probability) { const rk = robberyRank(rob.m, gw); out.push({ c: "var(--gold)", h: "Robbery of the round", t: `<b>${esc(rob.win)}</b> beat ${esc(rob.lose)} with only a ${pc(rob.pAct)} chance from the shots. ${rk === 1 ? "The biggest robbery of the season so far." : `The ${ord(rk)} biggest robbery of the season so far.`}` }); }
  else { const dom = rows.map(m => ({ m, d: Math.abs(m.xh - m.xa), t: m.xh > m.xa ? m.h : m.a, o: m.xh > m.xa ? m.a : m.h })).sort((a, b) => b.d - a.d)[0]; out.push({ c: "var(--good)", h: "Control of the round", t: `<b>${esc(dom.t)}</b> created ${nf(dom.d, 1)} xG more than ${esc(dom.o)}. No robbery this weekend.` }); }
  // 2. justice gap
  const tab = table(gw); const worst = tab.slice().sort((a, b) => a.luck - b.luck)[0], best = tab.slice().sort((a, b) => b.luck - a.luck)[0];
  out.push({ c: "var(--home)", h: "The table is lying", t: `<b>${esc(worst.t)}</b> sit ${ord(worst.rank)} and the shots say ${ord(worst.xrank)}: ${sg(worst.luck, 1)} points unlucky. At the other end ${esc(best.t)} are ${sg(best.luck, 1)} points better off than the chances say.` });
  // 3. rotating trend: last-3 form, set-piece dependence or finishing
  const l3 = TEAMS.map(t => { const ms = teamMatches(t, gw).slice(-3).map(m => persp(m, t)); return { t, d: ms.reduce((a, x) => a + x.xg - x.xga, 0), n: ms.length }; }).sort((a, b) => b.d - a.d);
  const sh = shotsUpTo(gw); const spShare = TEAMS.map(t => { const a = sh.filter(s => s[I.team] === t); const tot = a.reduce((q, s) => q + s[I.xg], 0); const sp = a.filter(s => grpOf(s[I.sit]) === "sp").reduce((q, s) => q + s[I.xg], 0); return { t, f: tot ? sp / tot : 0 }; }).sort((a, b) => b.f - a.f);
  const pick = gw % 3;
  if (pick === 0) out.push({ c: "var(--away)", h: "Form", t: `Over the last 3 matches <b>${esc(l3[0].t)}</b> have the best chance difference in the league: ${sg(l3[0].d, 1)} xG. The worst is ${esc(l3[l3.length - 1].t)} (${sg(l3[l3.length - 1].d, 1)}).` });
  else if (pick === 1) out.push({ c: "var(--away)", h: "Set pieces", t: `<b>${esc(spShare[0].t)}</b> get ${pc(spShare[0].f)} of their xG from set pieces, the highest share in the league. ${esc(spShare[spShare.length - 1].t)} rely on them least (${pc(spShare[spShare.length - 1].f)}).` });
  else { const fin = PL.filter(p => p.min >= TH.min_minutes_default).map(p => ({ p, d: p.g - p.xg })).sort((a, b) => b.d - a.d); out.push({ c: "var(--away)", h: "Finishing", t: `<b>${esc(fin[0].p.n)}</b> (${esc(fin[0].p.t)}) has ${fin[0].p.g} goals from ${nf(fin[0].p.xg, 1)} xG, ${sg(fin[0].d, 1)} and the best finishing in the league. At the other end ${esc(fin[fin.length - 1].p.n)}: ${fin[fin.length - 1].p.g} goals from ${nf(fin[fin.length - 1].p.xg, 1)} xG.` }); }
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
  for (const [we, side, v, og] of goals) g += `<circle cx="${x(we).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" fill="${og ? "none" : "var(--gold)"}" stroke="var(--gold)" stroke-width="1.5"><title>${we}. minutes ${og ? "own goal" : "goal"}</title></circle>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Halmozott xG minute">${g}</svg>`;
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
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${form.map((f, i) => { const v = Math.max(-2.5, Math.min(2.5, f.d)), h = Math.abs(v) / 2.5 * (H / 2 - 1); return `<rect x="${(i * bw + 1).toFixed(1)}" width="${(bw - 2).toFixed(1)}" y="${v >= 0 ? H / 2 - h : H / 2}" height="${Math.max(1, h).toFixed(1)}" fill="${v >= 0 ? "var(--good)" : "var(--bad)"}" opacity=".85"><title>${f.gw}. gameweek: ${sg(f.d, 2)}</title></rect>`; }).join("")}<line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="#3a4266"/></svg>`;
}
function slope(rows) {
  const nw = narrow(), W = nw ? 340 : 470, H = rows.length * 22 + 30, L = nw ? 100 : 145, R = nw ? 100 : 140, T = 18, y = (r) => T + (r - 1) * 22;
  const nm = (t) => nw && t.length > 9 ? (D.short[t] || t.slice(0, 9)) : t;
  let g = `<text x="${L - 8}" y="10" text-anchor="end" style="font-size:10px">ACTUAL</text><text x="${W - R + 8}" y="10" style="font-size:10px">deserved</text>`;
  for (const r of rows) { const d = r.rank - r.xrank; const col = d > 2 ? "var(--good)" : d < -2 ? "var(--bad)" : "#56607f"; const sel = S.team === r.t;
    g += `<line x1="${L}" x2="${W - R}" y1="${y(r.rank)}" y2="${y(r.xrank)}" stroke="${col}" stroke-width="${sel ? 3 : 1.6}" opacity="${S.team && !sel ? .35 : .9}"/>`;
    g += `<text x="${L - 8}" y="${y(r.rank) + 3.5}" text-anchor="end" style="fill:${sel ? "var(--gold)" : "var(--ink)"};font-size:11px">${r.rank}. ${esc(nm(r.t))}</text><text x="${W - R + 8}" y="${y(r.xrank) + 3.5}" style="fill:${sel ? "var(--gold)" : "var(--muted)"};font-size:11px">${r.xrank}. ${esc(nm(r.t))}</text><circle cx="${L}" cy="${y(r.rank)}" r="3" fill="${col}"/><circle cx="${W - R}" cy="${y(r.xrank)}" r="3" fill="${col}"/>`; }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Actual and deserved place">${g}</svg>`;
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
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Place by gameweek">${g}</svg>`;
}
function scatter(rows) {
  const W = narrow() ? 360 : 560, H = 340, L = 40, R = 12, T = 14, B = 34;
  const pts = rows.map(r => ({ t: r.t, x: r.xg / Math.max(1, r.P), y: r.xga / Math.max(1, r.P) }));
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y), x0 = Math.min(...xs) * .92, x1 = Math.max(...xs) * 1.05, y0 = Math.min(...ys) * .92, y1 = Math.max(...ys) * 1.05;
  const px = (v) => L + (v - x0) / (x1 - x0) * (W - L - R), py = (v) => T + (v - y0) / (y1 - y0) * (H - T - B);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let g = `<rect x="${px(mx)}" y="${T}" width="${W - R - px(mx)}" height="${py(my) - T}" fill="var(--good)" fill-opacity=".06"/><rect x="${L}" y="${py(my)}" width="${px(mx) - L}" height="${H - B - py(my)}" fill="var(--bad)" fill-opacity=".06"/>`;
  g += `<line x1="${px(mx)}" x2="${px(mx)}" y1="${T}" y2="${H - B}" stroke="#2f3656" stroke-dasharray="3 3"/><line x1="${L}" x2="${W - R}" y1="${py(my)}" y2="${py(my)}" stroke="#2f3656" stroke-dasharray="3 3"/>`;
  g += `<text x="${W - R - 4}" y="${T + 12}" text-anchor="end" style="fill:var(--good)">strong both oldalon</text><text x="${L + 4}" y="${H - B - 6}" style="fill:var(--bad)">weak both oldalon</text>`;
  for (let i = 0; i <= 4; i++) { const v = x0 + (x1 - x0) * i / 4, w = y0 + (y1 - y0) * i / 4; g += `<text x="${px(v)}" y="${H - B + 13}" text-anchor="middle">${nf(v, 1)}</text><text x="${L - 5}" y="${py(w) + 3}" text-anchor="end">${nf(w, 1)}</text>`; }
  g += `<text x="${W - R}" y="${H - 4}" text-anchor="end">created xG / match →</text><text x="${L}" y="${T - 4}">↓ conceded xG / match (fent a fewer)</text>`;
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
  ms.forEach((z, i) => { g += `<circle cx="${x(i)}" cy="${y(z.xg)}" r="2.2" fill="var(--home)" opacity=".55"/><circle cx="${x(i)}" cy="${y(z.xga)}" r="2.2" fill="var(--away)" opacity=".55"/><circle cx="${x(i)}" cy="${H - 8}" r="4.5" fill="${z.p === 3 ? "var(--good)" : z.p === 1 ? "#6b7394" : "var(--bad)"}"><title>${z.gw}. ${z.home ? "home" : "away"} ${esc(z.o)} against: ${z.gf}–${z.ga} (xG ${nf(z.xg, 2)}–${nf(z.xga, 2)})</title></circle>`; });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="gordulo xG">${g}</svg>`;
}

/* ---------- team strength model: opponent-adjusted, recency-weighted xG ratings ---------- */
const RT = {};
function ord(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function ratings(upto, opt) {
  const o = Object.assign({ tau: RTG.tau_rounds, k: RTG.prior_matches, bl: RTG.xg_blend }, opt || {}), key = `${upto}|${o.tau}|${o.k}|${o.bl}`;
  if (RT[key]) return RT[key];
  const ms = M.filter(m => m.gw <= upto), tau = o.tau, k = o.k, bl = o.bl, PR = D.prior || {};
  for (const t of TEAMS) if (PR[t] == null) throw new Error("No pre-season strength for " + t);
  const w = (m) => Math.exp(-(upto - m.gw) / tau), v = (x, g) => bl * x + (1 - bl) * g;
  let sw = 0, sh = 0, sa = 0; for (const m of ms) { const q = w(m); sw += q; sh += q * v(m.xh, m.hs); sa += q * v(m.xa, m.as); }
  const lg = sw ? (sh + sa) / (2 * sw) : DER.league_gpg;
  const homeN = RTG.home_prior_matches;
  const ratio = (sh + homeN * lg * DER.home_factor) / (sa + homeN * lg * DER.away_factor), hfH = Math.sqrt(ratio), hfA = 1 / hfH;
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
  const lgp = (sg2 + RTG.goal_prior_matches * DER.league_gpg) / (2 * sw + RTG.goal_prior_matches);
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
const cleanR = (upto) => ratings(upto, { bl: RTG.clean_xg_blend, tau: RTG.clean_tau_rounds, k: RTG.clean_prior_matches });
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
      <circle cx="${px(r.xgd)}" cy="${y}" r="3.8" fill="var(--bg)" stroke="#8f97b4" stroke-width="1.5"><title>${esc(r.t)} raw xG-gap: ${sg(r.xgd, 2)}/match</title></circle><circle cx="${px(r.axgd)}" cy="${y}" r="4.6" fill="${sel ? "var(--gold)" : "var(--home)"}" data-t="${esc(r.t)}" style="cursor:pointer"><title>${esc(r.t)} adjusted xG-gap: ${sg(r.axgd, 2)}/match</title></circle>
      <text x="${W - Rr + 6}" y="${y + 3.5}" style="fill:${up ? "var(--good)" : "var(--bad)"}">${sg(r.fx, 2)}</text>`; });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Raw and adjusted xG-gap">${g}</svg>`;
}
function cleanSection() {
  const rows = cleanTable(S.gw), hard = rows.slice().sort((a, b) => b.fx - a.fx)[0], easy = rows.slice().sort((a, b) => a.fx - b.fx)[0], R = cleanR(S.gw);
  return `<section class="sec"><div class="sechead"><h2>Adjusted xG</h2><span class="kicker">ground and opponent without · ${S.gw}. after the round</span></div>
    <p class="note">A raw xG torzit: home and weak opponent against easier helyzeteket kialakitani. Itt every match xG-jet elosztjuk azzal, amit a average club the adott opponent against, the adott ground teremteni szokott (a conceded xG-t so the opponent attack). Az result: mennyit created and engedett volna against an average opponent on a neutral pitch. A home ground now ${pc(R.hfH * R.hfH - 1)} more xG-t is worth. Csak the idei xG counts, goals and sulyozas without.</p>
    <div class="insights"><div class="ins" style="--c:var(--good)"><span class="n">Hard ut</span><p><b>${esc(hard.t)}</b> hard schedule and ground conceded: adjusted ${sg(hard.fx, 2)} xG-vel better per match, mint a raw figure show (nyersen ${hard.rr}., adjusted ${hard.ar}.).</p></div>
    <div class="ins" style="--c:var(--bad)"><span class="n">Easy ut</span><p><b>${esc(easy.t)}</b> figure a schedule szepiti: adjusted ${sg(easy.fx, 2)} xG per match (nyersen ${easy.rr}., adjusted ${easy.ar}.).</p></div>
    <div class="ins" style="--c:var(--home)"><span class="n">A best now</span><p>Adjusted <b>${esc(rows[0].t)}</b> a league legjobbja: ${sg(rows[0].axgd, 2)} xG-gap per match a against an average opponent on a neutral pitch.</p></div></div>
    <div class="two eq"><div class="panel"><p class="kicker">Raw → adjusted xG-gap per match</p>${cleanChart(rows)}<p class="note">Grey circle: raw, blue point: adjusted. A better oldali number a gap: green = harder was the utja, mint a raw figure show.</p></div>
    <div class="panel"><div class="tw"><table class="sticky1"><thead><tr><th class="l">#</th><th class="l">Club</th><th>xG/m</th><th>Tiszt.</th><th>xGA/m</th><th>Tiszt.</th><th>kul.</th><th class="hm">Raw place</th><th class="hm">home</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="click ${S.team === r.t ? "sel" : ""}" data-t="${esc(r.t)}"><td class="l mono" style="color:var(--muted)">${r.ar}</td><td class="l"><b>${esc(nm(r.t))}</b></td><td style="color:var(--muted)">${nf(r.xg, 2)}</td><td><b>${nf(r.ax, 2)}</b></td><td style="color:var(--muted)">${nf(r.xga, 2)}</td><td><b>${nf(r.axa, 2)}</b></td><td class="${r.axgd > 0 ? "pos" : "neg"}"><b>${sg(r.axgd, 2)}</b></td><td class="hm">${r.rr}. ${r.rr > r.ar ? `<span class="pos">▲${r.rr - r.ar}</span>` : r.rr < r.ar ? `<span class="neg">▼${r.ar - r.rr}</span>` : ""}</td><td class="hm">${r.home}/${r.P}</td></tr>`).join("")}</tbody></table></div>
    <p class="note">Tiszt.: adjusted value. kul.: adjusted xG − adjusted xGA per match, e according to a rangsor. Raw place: hanyadik lenne raw xG-gap. home: home meccsek figure.</p></div></div></section>`;
}
function cleanMatches(t) {
  const R = cleanR(S.gw), ms = teamMatches(t, S.gw).map(m => adjMatch(m, t, R)); if (!ms.length) return "";
  return `<div class="panel"><p class="kicker">match adjusted: mennyit ert a performance the opponent and a ground ismereteben</p><div class="tw"><table><thead><tr><th class="l">Ford.</th><th class="l">Opponent</th><th>Eredm.</th><th>xG</th><th class="hm">club</th><th>Tiszt.</th><th>xGA</th><th class="hm">club</th><th>Tiszt.</th></tr></thead><tbody>
    ${ms.map(x => `<tr><td class="l mono" style="color:var(--muted)">${x.gw}.</td><td class="l">${esc(nm(x.o))} <span class="note">${x.home ? "H" : "V"} · Power ${R.rank[x.o]}.</span></td><td class="${x.p === 3 ? "pos" : x.p === 0 ? "neg" : ""}">${x.gf}–${x.ga}</td><td style="color:var(--muted)">${nf(x.xg, 2)}</td><td class="hm" style="color:var(--muted)">${nf(x.eF, 2)}</td><td><b class="${x.ax >= R.lgFit ? "pos" : "neg"}">${nf(x.ax, 2)}</b></td><td style="color:var(--muted)">${nf(x.xga, 2)}</td><td class="hm" style="color:var(--muted)">${nf(x.eA, 2)}</td><td><b class="${x.axa <= R.lgFit ? "pos" : "neg"}">${nf(x.axa, 2)}</b></td></tr>`).join("")}</tbody></table></div>
    <p class="note">club: ennyit created (illetve engedett) volna a average club ugyanezen a meccsen, ugyanott. Tiszt.: a actual xG ehhez merve, average opponent and neutral ground figure. Green: better the average (${nf(R.lgFit, 2)} xG).</p></div>`;
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
const DLBL = { sched: "schedule and ground", fin: "finishing", keep: "goalkeeper and defence", other: "other luck" };
function waterfall(rows) {
  const nw = narrow(), W = nw ? 360 : 760, L = nw ? 84 : 190, BW = nw ? 64 : 230, GAP = nw ? 26 : 26, Rr = nw ? 26 : 50, rh = nw ? 24 : 26, T = 30, H = T + rows.length * rh + 10;
  const DX = L + BW + GAP, DW = W - DX - Rr, ks = ["sched", "fin", "keep", "other"];
  const mxN = Math.max(...rows.map(r => r.neutral)) || 1, posS = rows.map(r => ks.reduce((a, k) => a + Math.max(0, r[k]), 0)), negS = rows.map(r => ks.reduce((a, k) => a + Math.min(0, r[k]), 0));
  const ext = Math.max(...posS, ...negS.map(Math.abs), 1) * 1.05, cx = DX + DW / 2, sx = (v) => v / ext * (DW / 2), bx = (v) => v / mxN * BW;
  let g = `<text x="${L}" y="12" style="font-size:9.5px">${nw ? "play" : "play erteke (PONT)"}</text><text x="${cx}" y="12" text-anchor="middle" style="font-size:9.5px">${nw ? "luck" : "luck and schedule"}</text><text x="${W - 2}" y="12" text-anchor="end" style="font-size:9.5px">PONT</text>
    <text x="${cx - 4}" y="${T - 6}" text-anchor="end" style="fill:var(--bad)">− elvitt</text><text x="${cx + 4}" y="${T - 6}" style="fill:var(--good)">hozott +</text>
    <line x1="${cx}" x2="${cx}" y1="${T - 2}" y2="${H - 6}" stroke="#3a4266"/>`;
  rows.forEach((r, i) => { const y = T + i * rh, sel = r.t === S.team; let pp = 0, nn = 0;
    g += `<g data-vt="${esc(r.t)}" style="cursor:pointer"><rect x="0" y="${y - 2}" width="${W}" height="${rh}" fill="${sel ? "rgba(255,210,90,.08)" : "transparent"}"/>`;
    g += `<text x="${L - 8}" y="${y + 13}" text-anchor="end" style="fill:${sel ? "var(--gold)" : "var(--ink)"};font-size:${nw ? 10 : 11}px">${r.vrank}. ${esc(nw ? short(r.t) : r.t)}${nw ? "" : ` <tspan style="fill:var(--muted);font-size:9.5px">tab. ${r.rank}.</tspan>`}</text>`;
    g += `<rect x="${L}" y="${y + 4}" width="${bx(r.neutral).toFixed(1)}" height="12" rx="2" fill="#4a5378"><title>${esc(r.t)}: a play erteke ${nf(r.neutral, 1)} point</title></rect><text x="${L + bx(r.neutral) + 4}" y="${y + 13}" style="font-size:9.5px">${nf(r.neutral, 1)}</text>`;
    for (const k of ks) { const d = r[k]; if (Math.abs(d) < 0.05) continue; const w = Math.abs(sx(d)); const x = d >= 0 ? cx + pp : cx - nn - w; if (d >= 0) pp += w; else nn += w;
      g += `<rect x="${x.toFixed(1)}" y="${y + 4}" width="${Math.max(1, w).toFixed(1)}" height="12" fill="${DCOL[k]}" stroke="var(--panel)" stroke-width=".8"><title>${esc(r.t)} · ${DLBL[k]}: ${sg(d, 1)} point</title></rect>`; }
    const net = r.pts - r.neutral;
    g += `<text x="${W - 2}" y="${y + 13}" text-anchor="end" style="fill:var(--ink);font-weight:700;font-size:11.5px">${r.pts}<tspan style="fill:${net > 0.5 ? "var(--good)" : net < -0.5 ? "var(--bad)" : "var(--muted)"};font-weight:400;font-size:9px"> ${Math.abs(net) < 0.5 ? "±0" : sg(net, 0)}</tspan></text></g>`; });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="point club">${g}</svg>`;
}
function viewValodi() {
  const { rows } = decomp(S.gw), sel = rows.find(r => r.t === S.team) || rows[0];
  const big = (r) => ["sched", "fin", "keep", "other"].map(k => [k, r[k]]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  const victim = rows.slice().sort((a, b) => (a.pts - a.neutral) - (b.pts - b.neutral))[0], lucky = rows.slice().sort((a, b) => (b.pts - b.neutral) - (a.pts - a.neutral))[0];
  const vb = big(victim), lb = big(lucky);
  const ins = [
    { c: "var(--home)", h: "A actual ellovas", t: `<b>${esc(rows[0].t)}</b> play is worth a most: against an average opponent on a neutral pitch ${nf(rows[0].per, 2)} point per match. A table ${rows[0].rank}.` },
    { c: "var(--bad)", h: "A legnagyobb karvallott", t: `<b>${esc(victim.t)}</b> play ${nf(victim.neutral, 1)} pontot ert, and yet only ${victim.pts} pontja also. A most a(z) ${DLBL[vb[0]]} vitte el (${sg(vb[1], 1)}).` },
    { c: "var(--good)", h: "A legnagyobb if", t: `<b>${esc(lucky.t)}</b> ${lucky.pts} pontot gyujtott ${nf(lucky.neutral, 1)} pontnyi play. A most a(z) ${DLBL[lb[0]]} hozta (${sg(lb[1], 1)}).` },
  ];
  const story = `<b>${esc(sel.t)}</b>: ${sel.pts} point, ${sel.rank}. place. A play against an average opponent on a neutral pitch <b>${nf(sel.neutral, 1)} pontot</b> ert, ezzel a actual strong ${sel.vrank}. Ehhez jott: schedule and ground ${sg(sel.sched, 1)}, finishing ${sg(sel.fin, 1)}, goalkeeper and defence ${sg(sel.keep, 1)}, other luck ${sg(sel.other, 1)} point.${Math.abs(big(sel)[1]) >= 2 ? ` A legnagyobb factor a(z) ${DLBL[big(sel)[0]]}.` : " roughly that many pontja also, amennyit a play is worth."}`;
  const cell = (v) => `<td class="${v > .5 ? "pos" : v < -.5 ? "neg" : ""}">${sg(v, 1)}</td>`;
  return `<section class="sec"><div class="insights">${ins.map((o, i) => `<div class="ins" style="--c:${o.c};animation-delay:${i * 60}ms"><span class="n">${i + 1} · ${esc(o.h)}</span><p>${o.t}</p></div>`).join("")}</div></section>
    <section class="sec"><div class="sechead"><h2>True strength</h2><span class="kicker">${S.gw}. after the round</span></div>
    <p class="note">Where from jonnek a pontok? Bal oldalt a play erteke: how many pontot ert volna a club performance against an average opponent on a neutral pitch (adjusted xG-bol). Jobb oldalt, which ehhez hozzaadott or elvett: a schedule and a ground, a finishing, a goalkeeper and a defence, and the other luck (for example when esnek a goals). Jobbra: hozott pontot, balra: elvitt. A szelen a actual point and the and a play erteketol. A sorrend a play erteke according to goes. Click a club.</p>
    <div class="lgd"><span><i style="background:#4a5378"></i>play erteke</span>${Object.keys(DCOL).map(k => `<span><i style="background:${DCOL[k]}"></i>${DLBL[k]}</span>`).join("")}</div>
    <div class="insights" style="grid-template-columns:1fr"><div class="ins" style="--c:var(--gold)"><span class="n">${esc(sel.t)} in short</span><p>${story}</p></div></div>
    <div class="panel">${waterfall(rows)}</div>
    <div class="panel"><div class="tw"><table class="sticky1"><thead><tr><th class="l">#</th><th class="l">Club</th><th>Table</th><th>play erteke</th><th class="hm">/ match</th><th>Schedule</th><th>Finishing</th><th>Goalkeeper</th><th>Other</th><th>Actual point</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="click ${S.team === r.t ? "sel" : ""}" data-vt="${esc(r.t)}"><td class="l mono" style="color:var(--muted)">${r.vrank}</td><td class="l"><b>${esc(nm(r.t))}</b></td><td>${r.rank}. ${r.rank > r.vrank ? `<span class="pos">▲${r.rank - r.vrank}</span>` : r.rank < r.vrank ? `<span class="neg">▼${r.vrank - r.rank}</span>` : ""}</td><td><b>${nf(r.neutral, 1)}</b></td><td class="hm">${nf(r.per, 2)}</td>${cell(r.sched)}${cell(r.fin)}${cell(r.keep)}${cell(r.other)}<td><b>${r.pts}</b></td></tr>`).join("")}</tbody></table></div>
    <p class="note">Table: a actual place; a arrow that mutatja, how many hellyel lenne elorebb (green) or hatrebb (red) a play from. A finishing and a goalkeeper a goals and the xG gap comes, pontra figure (a league adataibol becsult figure). Az other a remainder: a goals time and a chances eloszlasa.</p></div></section>`;
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
  att: { title: "Attack", key: "ax", low: false, cols: [["ax", "Adjusted xG / m", 2], ["lx", "xG / 90 draw state", 2], ["sr", "chance rate: good chance %", 0], ["bc", "explosiveness: big chance / m", 2], ["xgs", "xG / shot", 3], ["sh", "Shot / m", 1], ["sp", "Set piece-xG / m", 2], ["f3", "Form: last 3, adjusted", 2], ["box", "and a 16-oson°", 0]] },
  def: { title: "Defence", key: "axa", low: true, cols: [["axa", "Adjusted xGA / m", 2, 1], ["lxa", "xGA / 90 draw state", 2, 1], ["sra", "Engedett good chance %", 0, 1], ["bca", "Engedett big chance / m", 2, 1], ["xgsa", "Kapott xG / shot", 3, 1], ["sha", "Kapott shot / m", 1, 1], ["spa", "set piece conceded xG / m", 2, 1], ["a3", "Form: last 3, adjusted", 2, 1], ["ppda", "PPDA°", 1, 1], ["hto", "Magas recovery°", 0]] },
};
function adBlurb(r, rk, side) {
  const A = side === "att", g = rk[A ? "sr" : "sra"], b = rk[A ? "bc" : "bca"], tr = A ? r.f3 - r.ax : r.axa - r.a3, lv = rk[A ? "lx" : "lxa"], mn = rk[A ? "ax" : "axa"];
  if (A) { if (g <= 5 && b <= 5 && mn <= 8) return "Efficient and explosive: many good and many big chance."; if (b <= 5 && g >= 10) return "Explosive: ritkabban, but nagyot ut."; if (g <= 5 && b >= 10) return "Egyenletes: many good chance, few true big."; }
  else { if (g <= 5 && b <= 5 && mn <= 8) return "Fal: few good and few big helyzetet enged."; if (b >= 14 && g <= 8) return "Rarely enged, but akkor nagyot: hibakbol concedes."; if (g >= 14 && b <= 8) return "Sok kozepes helyzetet enged, nagyot rarely."; }
  if (tr > 0.35) return A ? "rising ivel: the last 3 match good better the average." : "Javul: the last 3 meccsen good kevesebbet engedett.";
  if (tr < -0.35) return A ? "Visszaesett: the last 3 match gyengebb the average." : "Romlik: the last 3 meccsen more engedett.";
  if (lv - mn >= 6) return "Draw state gyengebb: a figure the result szepiti.";
  if (mn - lv >= 6) return "Draw state strong, mint a full average.";
  return `chance rate ${g}., explosiveness ${b}. a in the league.`;
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
    { c: "var(--good)", h: "A best attack", t: `<b>${esc(best.t)}</b> against an average opponent on a neutral pitch ${nf(best.ax, 2)} xG-t teremt per match (nyersen ${nf(best.xg, 2)}).` },
    { c: "var(--gold)", h: "Explosive or egyenletes", t: `A now big chance <b>${esc(expl.t)}</b> nevehez fuzodik (${nf(expl.bc, 2)}/match). shot legnagyobb and good chance <b>${esc(suc.t)}</b> adja down (${nf(suc.sr, 0)}%).` },
    { c: "var(--home)", h: "rising ivel", t: `<b>${esc(hot.t)}</b> attack the last 3 meccsen ${nf(hot.f3, 2)} adjusted xG-t hozott per match, the average ${nf(hot.ax, 2)}.` }]
  : [
    { c: "var(--good)", h: "A best defence", t: `<b>${esc(best.t)}</b> against an average opponent on a neutral pitch only ${nf(best.axa, 2)} xG-t enged per match (nyersen ${nf(best.xga, 2)}).` },
    { c: "var(--gold)", h: "Ki mit enged", t: `A fewest big helyzetet <b>${esc(expl.t)}</b> engedi (${nf(expl.bca, 2)}/match). A fewest good helyzetet <b>${esc(suc.t)}</b> (a conceded shots ${nf(suc.sra, 0)}%-a).` },
    { c: "var(--home)", h: "improving defence", t: `<b>${esc(hot.t)}</b> the last 3 meccsen ${nf(hot.a3, 2)} adjusted xG-t engedett per match, the average ${nf(hot.axa, 2)}.` }];
  const sk = S.ads && S.ads.side === side && C.cols.some(c => c[0] === S.ads.k) ? S.ads : { k: C.key, asc: C.low };
  const sorted = sortRows(rows, sk.k, sk.asc), heats = Object.fromEntries(C.cols.map(c => [c[0], rankHeat(rows, c[0], c[3])]));
  return `<section class="sec"><div class="insights">${ins.map((o, i) => `<div class="ins" style="--c:${o.c};animation-delay:${i * 60}ms"><span class="n">${i + 1} · ${esc(o.h)}</span><p>${o.t}</p></div>`).join("")}</div></section>
    <section class="sec"><div class="sechead"><h2>${C.title}</h2><span class="kicker">${S.gw}. after the round · adjusted for opponent and ground</span></div>
    <p class="note">${A ? "How much helyzetet teremt a club against an average opponent on a neutral pitch (adjusted xG)." : "How much helyzetet enged a club against an average opponent on a neutral pitch (adjusted xGA)."} A number mellett a league average mert gap. Alatta a mondat a ${A ? "attack" : "defence"} most: efficient (many good chance) or explosive (many big chance), and merre tart. Click a club.</p>
    <div class="panel plist">${list}</div></section>
    <section class="sec"><div class="sechead"><h2>Details</h2></div><div class="panel"><div class="tw"><table class="sticky1 wrapth" id="adt"><thead><tr><th class="l">#</th><th class="l">Club</th>${C.cols.map(([k, l]) => `<th data-ak="${k}" data-side="${side}" ${sk.k === k ? `aria-sort="${sk.asc ? "ascending" : "descending"}"` : ""}>${esc(l)}${sk.k === k ? (sk.asc ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead><tbody>
    ${sorted.map((r, i) => `<tr class="click ${S.team === r.t ? "sel" : ""}" data-t="${esc(r.t)}"><td class="l mono" style="color:var(--muted)">${i + 1}</td><td class="l"><b>${esc(nm(r.t))}</b></td>${C.cols.map(([k, , d]) => { const u = heats[k][r.t]; return `<td style="${u != null ? `background:${heatRGB(u, k === sk.k ? .32 : .14)}` : ""}">${r[k] == null ? "–" : nf(r[k], d)}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>
    <p class="note">Az NFL-and mintajara. <b style="color:var(--ink)">Draw state:</b> only azok a percek, when the scoreline draw was, because a lead club visszaall, a behind levo pedig mindent elore dob (this the „result”). <b style="color:var(--ink)">chance rate:</b> a shots how many szazaleka jott good chance (at least 0,10 xG, penalty without). <b style="color:var(--ink)">explosiveness:</b> big chances (at least 0,30 xG) per match. Green: better, red: worse a in the league. ° Opta season. Click a column heading to sort.</p></div></section>`;
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
        <div class="xg"><span>xG <b>${nf(m.xh, 2)}</b></span><span class="tags"><span class="tag ${v.cls}">${v.tag}</span>${wpCurve(m).minW != null && wpCurve(m).minW < TH.comeback_win_probability && wpCurve(m).trailed ? `<span class="tag cb" title="${pc(wpCurve(m).minW)}-os chance">Comeback</span>` : ""}</span><span>xG <b>${nf(m.xa, 2)}</b></span></div>
        ${flow(m)}
        <div class="jbar"><div class="h ${res === "H" ? "act" : ""}" style="width:${m.pw * 100}%">${m.pw > .12 ? pc(m.pw) : ""}</div><div class="d ${res === "D" ? "act" : ""}" style="width:${m.pd * 100}%">${m.pd > .12 ? pc(m.pd) : ""}</div><div class="a ${res === "A" ? "act" : ""}" style="width:${m.pl * 100}%">${m.pl > .12 ? pc(m.pl) : ""}</div></div>
        ${mkt(m)}<p class="verdict">${v.txt}</p>${open ? matchDetail(m) : ""}</div>`;
}
function viewFordulo() {
  const rows = M.filter(m => m.gw === S.gw);
  return `<section class="sec">${insights()}</section>
    <section class="sec"><div class="sechead"><h2>${S.gw}. gameweek</h2><div class="lgd"><span><i style="background:var(--home)"></i>home</span><span><i style="background:var(--away)"></i>away</span><span><i style="background:var(--gold)"></i>goal</span></div></div>
    <p class="note">The line is each side's chances added up, minute by minute. The bar is who would have won if every shot went in exactly as often as its xG says. The outline marks what actually happened. Click a match for the shot map.</p>
    <div class="mgrid">${rows.map((m, k) => matchCard(m, k)).join("")}</div></section>${tiles()}`;
}
function mkt() { return ""; }
function matchDetail(m) {
  const sh = SH.filter(s => s[I.fid] === m.id); const hs = sh.filter(s => s[I.team] === m.h), as = sh.filter(s => s[I.team] === m.a);
  const list = sh.slice().sort((a, b) => a[I.min] - b[I.min]).map(s => `<div><span class="mono" style="color:var(--muted)">${s[I.min]}'</span><span><b style="color:${s[I.team] === m.h ? "var(--home)" : "var(--away)"}">${esc(s[I.pl])}</b> · ${esc(s[I.sit])}${s[I.last] && s[I.last] !== "None" ? ", " + esc(LAST[s[I.last]] || s[I.last]) + " after" : ""}</span><span class="mono" style="${s[I.res] === "G" ? "color:var(--gold);font-weight:700" : ""}">${s[I.res] === "O" ? "own goal" : nf(s[I.xg], 2) + " · " + RESN[s[I.res]]}</span></div>`).join("");
  const big = (arr) => arr.filter(s => s[I.xg] >= TH.big_chance_xg && s[I.res] !== "O").length;
  return `<div class="wpbox"><p class="kicker">Win chance minute percre</p>${wpChart(m)}<div class="lgd"><span><i style="background:var(--home)"></i>${esc(m.h)} wins</span><span><i style="background:#59607e"></i>draw</span><span><i style="background:var(--away)"></i>${esc(m.a)} wins</span></div><p class="note">${wpSummary(m)}</p></div>
    <div class="mdetail" style="margin-top:6px"><div><div class="row" style="align-items:flex-start;gap:10px;flex-wrap:nowrap"><div style="flex:1;min-width:0"><p class="kicker" style="margin-bottom:4px">${esc(m.h)} · ${m.sh} shot · ${big(hs)} big chance</p>${halfPitch(hs, "var(--home)")}</div><div style="flex:1;min-width:0"><p class="kicker" style="margin-bottom:4px">${esc(m.a)} · ${m.sa} shot · ${big(as)} big chance</p>${halfPitch(as, "var(--away)")}</div></div><p class="note" style="margin-top:6px">A circle merete a chance. Yellow: goal, telt: kaput eltalalo shot, empty: off target or blokkolt. Big chance: at least 0,3 xG.</p></div>
    <div><p class="kicker" style="margin-bottom:6px">Every shot</p><div class="slist">${list}</div></div></div>`;
}
function wpTiles() {
  const ms = M.filter(m => m.gw === S.gw); if (!ms.length) return "";
  const cbm = ms.filter(m => wpCurve(m).minW != null).sort((a, b) => wpCurve(a).minW - wpCurve(b).minW)[0], ex = ms.slice().sort((a, b) => wpCurve(b).excite - wpCurve(a).excite)[0];
  const out = [];
  if (cbm && wpCurve(cbm).minW < TH.exciting_dip_probability) { const C = wpCurve(cbm), w = C.res === 0 ? cbm.h : cbm.a; out.push(`<div class="tile"><span class="kicker">${C.trailed ? "Legnagyobb comeback" : "Legnagyobb fordulat"}</span><span class="big" style="color:var(--home)">${pc(C.minW)}</span><span class="who">${esc(w)}</span><span class="d">${esc(cbm.h)}–${esc(cbm.a)} ${cbm.hs}–${cbm.as}. Ennyi was a win chance a point (${C.minT}. minutes, ${C.minScore[0]}–${C.minScore[1]}), and yet nyert.</span></div>`); }
  const E = wpCurve(ex); out.push(`<div class="tile"><span class="kicker">Legizgalmasabb match</span><span class="big" style="color:var(--away)">${nf(E.excite, 1)}</span><span class="who">${esc(ex.h)}–${esc(ex.a)} ${ex.hs}–${ex.as}</span><span class="d">Izgalmi index: mennyit hullamzott total a win chance a match under.</span></div>`);
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
    ${hard ? `<div class="tile"><span class="kicker">Legnehezebb goal</span><span class="big" style="color:var(--gold)">${nf(hard[I.xg], 2)} xG</span><span class="who">${esc(hard[I.pl])} · ${esc(hard[I.team])}</span><span class="d">${hard[I.min]}. minutes, ${esc(hard[I.opp])} against. Ilyen chance kb. every ${Math.round(1 / Math.max(.005, hard[I.xg]))}. shot goes in.</span></div>` : ""}
    ${miss ? `<div class="tile"><span class="kicker">Big missed</span><span class="big" style="color:var(--bad)">${nf(miss[I.xg], 2)} xG</span><span class="who">${esc(miss[I.pl])} · ${esc(miss[I.team])}</span><span class="d">${miss[I.min]}. minutes, ${esc(miss[I.opp])} against: ${RESN[miss[I.res]]}. ${pc(miss[I.xg])}-os chance was.</span></div>` : ""}
    ${wpTiles()}
    <div class="tile"><span class="kicker">luck nyertese</span><span class="big" style="color:var(--good)">${sg(rob.d, 1)} point</span><span class="who">${esc(rob.t)}</span><span class="d">${esc(rob.m.h)}–${esc(rob.m.a)} ${rob.m.hs}–${rob.m.as}. A vesztes oldalon ${esc(vic.t)} (${sg(vic.d, 1)}).</span></div>
    ${king ? `<div class="tile"><span class="kicker">xG-kiraly</span><span class="big">${nf(king[1], 2)} xG</span><span class="who">${esc(king[0].split("|")[0])} · ${esc(king[0].split("|")[1])}</span><span class="d">${kg.length} shot, ${kgg} goal. ${kgg > king[1] + .5 ? "efficient was, mint a helyzetei." : kgg < king[1] - .5 ? "More goals kellett volna lonie." : "Annyit lott, amennyit a helyzetei ertek."}</span></div>` : ""}</div></section>`;
}
function viewTabella() {
  const rows = table(S.gw, S.mode);
  const cols = [["pts", "Points", 0], ["xpts", "Deserved", 1], ["luck", "±", 1], ["gf", "LG", 0, "hm"], ["xg", "xG", 1], ["ga", "KG", 0, "hm"], ["xga", "xGA", 1]];
  const key = S.tsort, sorted = rows.slice().sort((a, b) => key === "rank" ? a.rank - b.rank : key === "xga" || key === "ga" ? a[key] - b[key] : b[key] - a[key]);
  const MODES = [["all", "Full season"], ["last5", "Last 5"], ["home", "home"], ["away", "Idegenbeli"]];
  const luck = rows.slice().sort((a, b) => a.luck - b.luck);
  return `<section class="sec"><div class="sechead"><h2>The justice table</h2><div class="seg" role="group" aria-label="time">${MODES.map(([k, l]) => `<button data-mode="${k}" aria-pressed="${S.mode === k}">${l}</button>`).join("")}</div></div>
    <p class="note">Bal oldalt a actual table, better oldalt, amit a chances from deserved volna. Green vonal: rosszabbul stands, mint deserved. Piros: jobban. ${S.mode === "all" ? `Now ${esc(luck[0].t)} a legnagyobb vesztes (${sg(luck[0].luck, 1)} point).` : ""}</p>
    <div class="two"><div class="panel">${slope(rows)}</div>
    <div class="panel"><div class="tw"><table id="jt" class="sticky1"><thead><tr><th class="l" data-k="rank">#</th><th class="l">Club</th><th data-k="P" class="hm">M</th>${cols.map(([k, l, , c]) => `<th data-k="${k}" class="${c || ""}" ${S.tsort === k ? 'aria-sort="x"' : ""}>${l}</th>`).join("")}<th class="l hm">xG-gap</th></tr></thead><tbody>
    ${sorted.map(r => `<tr class="click ${S.team === r.t ? "sel" : ""}" data-t="${esc(r.t)}"><td class="l mono" style="color:var(--muted)">${r.rank}</td><td class="l"><b>${esc(narrow() ? D.short[r.t] : r.t)}</b></td><td class="hm">${r.P}</td><td><b>${r.pts}</b></td><td>${nf(r.xpts, 1)}</td><td class="${r.luck > 1 ? "neg" : r.luck < -1 ? "pos" : ""}">${sg(r.luck, 1)}</td><td class="hm">${r.gf}</td><td>${nf(r.xg, 1)}</td><td class="hm">${r.ga}</td><td>${nf(r.xga, 1)}</td><td class="l hm">${spark(r.form)}</td></tr>`).join("")}</tbody></table></div>
    <p class="note">± = actual point − deserved point. Piros: luck, green: pech. Click a club a rontgenhez.</p></div></div></section>
    <section class="sec"><div class="two eq"><div class="panel"><h3 style="font-family:var(--f-display);font-size:26px;text-transform:uppercase">Attack and defence</h3><p class="note">Jobbra: more own chance. Fent: fewer conceded chance. Click a pontra.</p>${scatter(rows)}</div>
    <div class="panel"><h3 style="font-family:var(--f-display);font-size:26px;text-transform:uppercase">Place by gameweek</h3><p class="note">A actual table every after the round. Kiemelve: ${esc(S.team)}.</p>${bump()}</div></div></section>`;
}
function simSection() {
  if (!S.sim || S.simGw !== S.gw) { S.sim = simulate(S.gw); S.simGw = S.gw; }
  const r = S.sim; const rem = FX.filter(f => f[0] > S.gw).length;
  const cell = (p, col) => `<td style="text-align:left"><span class="mono" style="display:inline-block;width:38px;text-align:right">${pc1(p)}</span><span class="pbar" style="width:${Math.max(1, p * (narrow() ? 26 : 60))}px;background:${col};opacity:${p > 0 ? .85 : 0}"></span></td>`;
  return `<section class="sec"><div class="sechead"><h2>Where they finish</h2><span class="kicker">After gameweek ${S.gw} · ${rem} matches left</span></div>
    <p class="note">The remaining ${rem} matches were played ${C.simulation.runs.toLocaleString("en-GB")} times using the Power ratings (opponent-adjusted, with recent matches counting for more). Bad luck so far does not drag a club's chances down. Only the points already dropped do.</p>
    <div class="panel"><div class="tw"><table class="probs sticky1"><thead><tr><th class="l">#</th><th class="l">Club</th><th>Now</th><th>Expected</th><th class="l">Title</th><th class="l">Top 4</th><th class="l hm">Top 6</th><th class="l">Relegated</th></tr></thead><tbody>
    ${r.map((x, i) => `<tr class="click ${S.team === x.t ? "sel" : ""}" data-t="${esc(x.t)}"><td class="l mono" style="color:var(--muted)">${i + 1}</td><td class="l"><b>${esc(narrow() ? D.short[x.t] : x.t)}</b></td><td>${x.now}</td><td><b>${nf(x.exp, 0)}</b></td>${cell(x.title, "var(--gold)")}${cell(x.top4, "var(--home)")}<td class="hm" style="text-align:left"><span class="mono" style="display:inline-block;width:38px;text-align:right">${pc1(x.top6)}</span></td>${cell(x.rel, "var(--bad)")}</tr>`).join("")}</tbody></table></div>
    <p class="note">experimental modell: a home ground elonyet and a goals Poisson-eloszlasat veszi figyelembe; and, true and edzovaltast not. barmelyik korabbi gameweek selected megnezheted, mit mutatott akkor.</p></div></section>`;
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
    .map(s => ({ we: s[I.min], side: s[I.res] === "G" ? (s[I.team] === m.h ? 0 : 1) : (s[I.team] === m.h ? 1 : 0), pid: s[I.res] === "G" ? s[I.pid] : -1, pl: s[I.res] === "G" ? s[I.pl] : s[I.pl] + " (own goal)" }));
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
  for (const e of C.ev) { const xx = x(e.we); g += `<line x1="${xx}" x2="${xx}" y1="${T - 2}" y2="${H - B}" stroke="var(--ink)" stroke-width="1" stroke-opacity=".55"/><circle cx="${xx}" cy="${T - 6}" r="3.6" fill="${e.side === 0 ? "var(--home)" : "var(--away)"}" stroke="var(--ink)" stroke-width="1"><title>${e.we}'. ${esc(e.pl)}: win chance ${pc(e.wBefore)} → ${pc(e.wAfter)}</title></circle>`; }
  for (let t = 0; t < C.end; t += 5) { const q = C.pts[t]; g += `<rect x="${x(t)}" y="${T}" width="${x(5) - x(0)}" height="${H - T - B}" fill="transparent"><title>${t}'. minutes: ${esc(m.h)} ${pc(q[1])} · draw ${pc(q[2])} · ${esc(m.a)} ${pc(q[3])}</title></rect>`; }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Win chance minute percre">${g}</svg>`;
}
function wpSummary(m) {
  const C = wpCurve(m), key = C.ev.slice().sort((a, b) => Math.abs(b.d3) - Math.abs(a.d3))[0], win = C.res === 0 ? m.h : C.res === 2 ? m.a : null;
  const parts = [`kickoff: ${esc(m.h)} ${pc(C.pre[1])} · draw ${pc(C.pre[2])} · ${esc(m.a)} ${pc(C.pre[3])}.`];
  if (key) parts.push(`A match goal: <b>${esc(key.pl)}</b> (${key.we}.), a win chancet ${pc(key.wBefore)}-rol ${pc(key.wAfter)}-ra vitte (${sg(key.d3, 2)} expected point).`);
  if (win && C.minW < TH.comeback_win_probability) parts.push(C.trailed ? `<b>${esc(win)}</b> behind forditott: a point (${C.minT}. minutes, ${C.minScore[0]}–${C.minScore[1]}) only ${pc(C.minW)} was a win chance.` : `<b>${esc(win)}</b> win chance a ${C.minT}. percben ${C.minScore[0]}–${C.minScore[1]}-nel ${pc(C.minW)}-ra esett, and yet nyert.`);
  else if (!win && Math.max(C.maxH, C.maxA) > TH.dominance_win_probability) parts.push(`<b>${esc(C.maxH > C.maxA ? m.h : m.a)}</b> already ${pc(Math.max(C.maxH, C.maxA))}-os chance allt, and yet draw became.`);
  parts.push(`Izgalmi index: <b>${nf(C.excite, 1)}</b>.`);
  return parts.join(" ");
}
function wpTeam(t, upto) { let cb = 0, bl = 0, n = 0; for (const m of teamMatches(t, upto)) { const C = wpCurve(m), h = m.h === t, wi = h ? 1 : 3, z = persp(m, t), mn = Math.min(...C.pts.map(q => q[wi])), mx = Math.max(...C.pts.map(q => q[wi])); if (mn < TH.team_comeback_win_probability && z.p > 0) cb += z.p; if (mx > TH.team_blown_win_probability && z.p < 3) bl += 3 - z.p; n++; } return { cb, bl }; }
const WPA = {}; for (const m of M) for (const e of wpCurve(m).ev) if (e.pid != null && e.pid >= 0) WPA[e.pid] = (WPA[e.pid] || 0) + e.d3;

/* ---------- Preview: next round ---------- */
const DAY = new Intl.DateTimeFormat("en-GB", { timeZone: C.display_timezone, month: "short", day: "numeric" });
const formChips = (t) => teamMatches(t, S.gw).slice(-5).map(m => persp(m, t)).map(x => `<i class="fm ${x.p === 3 ? "w" : x.p === 1 ? "d" : "l"}" title="GW${x.gw} ${x.home ? "home" : "away"} vs ${esc(x.o)}: ${x.gf}–${x.ga}">${x.p === 3 ? "W" : x.p === 1 ? "D" : "L"}</i>`).join("");
function restLine(t, fid) {
  const r = restAround(t, fid); if (!r.prev && !r.next) return "";
  const b = r.before == null ? "season" : `<b class="${restCls(r.before)}">${nf(r.before, 1)} day</b> rest${r.prev && r.prev.c !== "PL" ? ` (before that ${COMP[r.prev.c]}${r.prev.o ? ": " + esc(r.prev.o) : ""})` : ""}`;
  const a = r.next && r.next.c !== "PL" && r.after < TH.europe_soon_days ? ` · <span class="neg">in ${nf(r.after, 1)} days: ${COMP[r.next.c] || r.next.c}${r.next.o ? " v " + esc(r.next.o) : ""}</span>` : "";
  return b + a;
}
function absent(t) {
  if (S.gw !== D.gw) return "";
  const a = PL.filter(q => q.t === t && q.min >= 180 && q.stt !== "a" && q.stt !== "u").sort((x, y) => y.min - x.min).slice(0, 4);
  return a.length ? `<span class="abs">${a.map(q => `<span title="${esc(q.news)}">${esc(q.n)}${q.cop != null ? ` <small>${q.cop}%</small>` : ""}</span>`).join("")}</span>` : `<span class="note">no known absent</span>`;
}
function previewCard(f, R, k) {
  const [, h, a, ko, , fid] = f, p = predict(h, a, R);
  const tr = Object.fromEntries(table(S.gw).map(r => [r.t, r.rank])), real = S.gw < D.gw ? M.find(x => x.id === fid) : null;
  const res = real ? (real.hs > real.as ? 0 : real.hs === real.as ? 1 : 2) : -1, ps = [p.pw, p.pd, p.pl];
  const side = (t) => `<div class="pvside"><div class="row" style="gap:6px;justify-content:space-between;flex-wrap:nowrap"><b style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(nm(t))}</b><span class="forms">${formChips(t)}</span></div><span class="note">${restLine(t, fid)}</span>${absent(t)}</div>`;
  return `<div class="mc pvw" style="animation-delay:${k * 35}ms">
    <div class="pvtop"><span class="kicker">${esc(KO.format(new Date(ko)))}</span><span class="kicker">Power ${R.rank[h]}. – ${R.rank[a]}.</span></div>
    <div class="row1"><span class="tm">${esc(h)}<small>${tr[h] ? tr[h] + ". place" : ""}</small></span><span class="sc pvx" title="expected goals">${nf(p.lh, 1)}<i>–</i>${nf(p.la, 1)}</span><span class="tm r">${esc(a)}<small>${tr[a] ? tr[a] + ". place" : ""}</small></span></div>
    <div class="jbar"><div class="h ${res === 0 ? "act" : ""}" style="width:${p.pw * 100}%">${p.pw > .12 ? pc(p.pw) : ""}</div><div class="d ${res === 1 ? "act" : ""}" style="width:${p.pd * 100}%">${p.pd > .12 ? pc(p.pd) : ""}</div><div class="a ${res === 2 ? "act" : ""}" style="width:${p.pl * 100}%">${p.pl > .12 ? pc(p.pl) : ""}</div></div>
    <p class="mkt"><span class="kicker">Model</span> ${ps.map(pc).join(" · ")}</p>
    <div class="pvstats"><span><b>${pc(p.o25)}</b> 2,5 goal over</span><span><b>${pc(p.btts)}</b> both club goals scores</span><span><b>${p.top.map(s => s[0] + "–" + s[1]).join(", ")}</b> most</span><span><b>${pc(p.csH)} / ${pc(p.csA)}</b> conceded goal without</span></div>
    ${side(h)}${side(a)}
    ${real ? `<p class="verdict">What happened: <b>${real.hs}–${real.as}</b>. The model gave that result a ${pc(ps[res])} chance${ps.indexOf(Math.max(...ps)) === res ? " — <b style=\"color:var(--good)\">the favourite delivered</b>" : ""}.</p>` : ""}</div>`;
}
function previewInsights(fx, R) {
  const P = fx.map(f => ({ f, h: f[1], a: f[2], p: predict(f[1], f[2], R) })), out = [];
  const big = P.slice().sort((x, y) => Math.max(R.rank[x.h], R.rank[x.a]) - Math.max(R.rank[y.h], R.rank[y.a]))[0];
  out.push({ c: "var(--gold)", h: "Match of the round", t: `<b>${esc(big.h)} v ${esc(big.a)}</b>, ${ord(R.rank[big.h])} and ${ord(R.rank[big.a])} on the Power list. The model says ${pc(big.p.pw)} – ${pc(big.p.pd)} – ${pc(big.p.pl)}.` });
  const fav = P.map(x => ({ ...x, m: Math.max(x.p.pw, x.p.pl) })).sort((x, y) => y.m - x.m)[0], ft = fav.p.pw > fav.p.pl ? fav.h : fav.a, fo = ft === fav.h ? fav.a : fav.h;
  out.push({ c: "var(--good)", h: "Clearest favourite", t: `<b>${esc(ft)}</b> has a ${pc(fav.m)} chance of beating ${esc(fo)} ${ft === fav.h ? "at home" : "away"}.` });
  const tired = []; for (const x of P) for (const t of [x.h, x.a]) { const r = restAround(t, x.f[5]); tired.push({ t, o: t === x.h ? x.a : x.h, ...r }); }
  const shortB = tired.filter(z => z.before != null).sort((x, y) => x.before - y.before)[0], euroA = tired.filter(z => z.next && z.next.c !== "PL" && z.after < TH.short_rest_days).sort((x, y) => x.after - y.after);
  if (shortB && shortB.before < TH.short_rest_days) out.push({ c: "var(--away)", h: "Fatigue", t: `<b>${esc(shortB.t)}</b> has only ${nf(shortB.before, 1)} days' rest${shortB.prev && shortB.prev.c !== "PL" ? ` after ${COMP[shortB.prev.c] || shortB.prev.c}${shortB.prev.o ? " against " + esc(shortB.prev.o) : ""}` : ""}.${euroA.length ? ` ${euroA.slice(0, 3).map(z => esc(z.t)).join(", ")} then play in Europe a few days later.` : ""}` });
  else if (euroA.length) out.push({ c: "var(--away)", h: "European week", t: `${euroA.slice(0, 4).map(z => `<b>${esc(z.t)}</b> (${COMP[z.next.c] || z.next.c}${z.next.o ? " v " + esc(z.next.o) : ""}, in ${nf(z.after, 1)} days)`).join(", ")}. A rotated side is likely.` });
  else { const r = tired.filter(z => z.before != null).sort((x, y) => y.before - x.before)[0]; if (r) out.push({ c: "var(--away)", h: "Rest", t: `<b>${esc(r.t)}</b> ${nf(r.before, 1)} day rest after comes, a gameweek most.` }); }
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
    <div class="two eq"><div class="panel"><div class="tw"><table><thead><tr><th class="l">Gameweek</th><th>Match</th><th>Favorit nyert</th><th>Chance a valos kimenetre</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td class="l">${r.g}.</td><td>${r.n}</td><td>${r.hit} / ${r.n}</td><td><b>${pc(r.pa)}</b></td></tr>`).join("")}<tr><td class="l"><b>Total</b></td><td>${N}</td><td><b>${H} / ${N}</b> (${pc(H / N)})</td><td><b>${pc(PA)}</b></td></tr></tbody></table></div>
    <p class="note">Every gameweek only the before that lejatszott match good. „Chance a valos kimenetre”: average how many szazalekot adott a modell to that, which in the end happened. the more magasabb, annal better; a vaktipp 33%.</p></div>
    </div></section>`;
}
function mismatchSection(fx, R) {
  const tb = table(S.gw), T = Object.fromEntries(tb.map(r => [r.t, r]));
  if (!S.gw || fx.some(f => !T[f[1]] || !T[f[2]])) return "";
  const rows = fx.map(f => { const h = f[1], a = f[2], tg = T[a].rank - T[h].rank, pg = T[a].xrank - T[h].xrank, wg = R.rank[a] - R.rank[h], p = predict(h, a, R);
    return { h, a, tg, pg, wg, mm: Math.abs(tg - pg), p, th: T[h], ta: T[a] }; }).sort((x, y) => y.mm - x.mm || Math.abs(y.tg) - Math.abs(x.tg));
  const better = (g, h, a) => g > 0 ? h : g < 0 ? a : null;
  const verdict = (r) => { const tb_ = better(r.tg, r.h, r.a), pb = better(r.pg, r.h, r.a);
    if (tb_ && pb && tb_ !== pb && Math.abs(r.pg) >= TH.mismatch_flip_places) return { cls: "flip", tag: "forditott match", txt: `A table according to <b>${esc(tb_)}</b> a better, a chances according to <b>${esc(pb)}</b>.` };
    if (Math.abs(r.tg) - Math.abs(r.pg) >= TH.mismatch_gap_places) return { cls: "over", tag: "A table tuloz", txt: `A table ${Math.abs(r.tg)} place gap shows, a chances according to only ${Math.abs(r.pg)}: sokkal kiegyenlitettebb match.` };
    if (Math.abs(r.pg) - Math.abs(r.tg) >= TH.mismatch_gap_places) return { cls: "under", tag: "Nagyobb a gap", txt: `<b>${esc(pb)}</b> a chances according to ${Math.abs(r.pg)} hellyel better, a table only ${Math.abs(r.tg)} place gap shows.` };
    return { cls: "", tag: "Egyezik", txt: "A table roughly igazat says." }; };
  const line = (lbl, x, y) => `<div class="mmr"><span>${lbl}</span><b class="${x < y ? "hb" : ""}">${x}.</b><i>–</i><b class="${y < x ? "ab" : ""}">${y}.</b></div>`;
  return `<section class="sec"><div class="sechead"><h2>Where the table misleads</h2><span class="kicker">Gameweek ${S.gw + 1} · biggest gap first</span></div>
    <p class="note">For each match: where the two clubs sit in the real table, in the table their chances deserved, and on the Power list. The big number is how far those two views disagree, in places.${narrow() ? " Swipe sideways for the other matches." : ""}</p>
    <div class="mm">${rows.map((r, i) => { const v = verdict(r); return `<div class="mmc ${v.cls} ${i < 3 && r.mm >= TH.mismatch_gap_places ? "top" : ""}" style="animation-delay:${i * 30}ms">
      <div class="mmh"><b>${esc(r.h)} – ${esc(r.a)}</b><span class="mmv" title="gap in places">${r.mm}</span></div>
      ${line("Actual table", r.th.rank, r.ta.rank)}${line("Deserved", r.th.xrank, r.ta.xrank)}${line("Power", R.rank[r.h], R.rank[r.a])}
      <span class="tag ${v.cls === "flip" ? "rob" : v.cls ? "dom" : ""}">${v.tag}</span><p class="note">${v.txt} Modell: ${pc(r.p.pw)} – ${pc(r.p.pd)} – ${pc(r.p.pl)}.</p></div>`; }).join("")}</div></section>`;
}
function viewElozetes() {
  const R = ratings(S.gw), g = S.gw + 1;
  if (g > D.rounds) return `<section class="sec"><h2>The season is over</h2></section>`;
  const fx = FX.filter(f => f[0] === g).sort((a, b) => a[3].localeCompare(b[3]));
  const ts = fx.map(f => Date.parse(f[3]));
  return `<section class="sec">${previewInsights(fx, R)}</section>${mismatchSection(fx, R)}
    <section class="sec"><div class="sechead"><h2>${g}. gameweek preview</h2><span class="kicker">${esc(DAY.format(new Date(Math.min(...ts))))} – ${esc(DAY.format(new Date(Math.max(...ts))))}${S.gw < D.gw ? ` · ahogy a ${S.gw}. after the round looked` : ""}</span></div>
    <p class="note">A bar a modell chance (home, draw, away), in the middle a expected figure. A modell-odds a modell chance figure „korrekt” odds, and without. A form: last 5 match (GY/D/V). Rest: napok a club previous match ota (BL/EL/KL also). ${S.gw === D.gw ? "Absentees: hivatalos FPL-news, zarojelben a play chance." : ""}${S.gw < D.gw ? " Ez a lejatszott gameweek: keretezve a valos outcome." : ""}</p>
    <div class="mgrid">${fx.map((f, k) => previewCard(f, R, k)).join("")}</div></section>${modelLog()}`;
}

/* ---------- Power rankings ---------- */
function powerBlurb(t, R, tr, mv) {
  if (R.ar[t] === 1 && R.dr[t] === 1) return "A league best attack and defend.";
  if (mv >= 3) return `Big jump: ${mv} helyet lepett elore.`;
  if (mv <= -3) return `drop: ${-mv} helyet esett vissza.`;
  if (tr[t] - R.rank[t] >= TH.mismatch_gap_places) return `Jobb, mint a table mutatja (there ${tr[t]}.).`;
  if (R.rank[t] - tr[t] >= TH.mismatch_gap_places) return `A table tulertekeli (there ${tr[t]}.).`;
  if (R.ar[t] === 1) return "A league most attack.";
  if (R.dr[t] === 1) return "A league best defend.";
  if (R.ar[t] <= 4 && R.dr[t] >= 14) return "Strong up front, sebezheto at the back.";
  if (R.dr[t] <= 4 && R.ar[t] >= 14) return "szilard at the back, fogatlan up front.";
  return `Attack ${R.ar[t]}., defence ${R.dr[t]}.`;
}
function viewPower() {
  const R = ratings(S.gw), P0 = S.gw > 1 ? ratings(S.gw - 1) : null, tr = Object.fromEntries(table(S.gw).map(r => [r.t, r.rank]));
  const mx = Math.max(...TEAMS.map(t => Math.abs(R.pw[t]))) || 1;
  const rows = R.order.map((t, i) => { const v = R.pw[t], mv = P0 ? P0.rank[t] - R.rank[t] : 0;
    return `<div class="prow ${S.team === t ? "sel" : ""}" data-t="${esc(t)}" style="animation-delay:${i * 20}ms"><span class="prk">${R.rank[t]}</span><span class="pmv ${mv > 0 ? "up" : mv < 0 ? "dn" : ""}">${mv > 0 ? "▲" + mv : mv < 0 ? "▼" + -mv : "–"}</span>
      <div class="pnm"><b>${esc(t)}</b><span>${esc(powerBlurb(t, R, tr, mv))}</span></div>
      <div class="pbr" aria-hidden="true"><i style="left:${v >= 0 ? 50 : 50 + v / mx * 50}%;width:${Math.abs(v) / mx * 50}%;background:${v >= 0 ? "var(--good)" : "var(--bad)"}"></i></div><b class="pval ${v >= 0 ? "pos" : "neg"}">${sg(v, 2)}</b></div>`; }).join("");
  return `<section class="sec"><div class="sechead"><h2>Power rankings</h2><span class="kicker">${S.gw}. after the round</span></div>
    <p class="note">Who is strongest right now, regardless of the table? The number is the goal difference a club would expect against an average opponent on a neutral pitch. It accounts for who the chances came against, and recent matches count for more. The starting point is a pre-season strength calculated from earlier league results, and that anchor fades as this season goes on. The arrow is the move since last gameweek. Click a club.</p>
    <div class="panel plist">${rows}</div></section>
    <section class="sec"><div class="two eq"><div class="panel"><h3 class="h3">Power-place by gameweek</h3><p class="note">Kiemelve: ${esc(S.team)}.</p>${bump(g => ratings(g).rank)}</div>
    <div class="panel"><h3 class="h3">Attack and defence ereje</h3><p class="note">opponent true, goal/match the average kepest. Jobbra: veszelyesebb attack. Fent: kevesebbet enged.</p>${powerScatter(R)}</div></div></section>`;
}
function powerScatter(R) {
  const W = narrow() ? 360 : 560, H = 320, L = 36, Rr = 12, T = 14, B = 30;
  const pts = TEAMS.map(t => ({ t, x: R.lg * (R.att[t] - 1), y: R.lg * (1 - R.def[t]) }));
  const ext = (a) => { const m = Math.max(...a.map(Math.abs)) * 1.15 || 1; return [-m, m]; };
  const [x0, x1] = ext(pts.map(p => p.x)), [y0, y1] = ext(pts.map(p => p.y));
  const px = (v) => L + (v - x0) / (x1 - x0) * (W - L - Rr), py = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  let g = `<line x1="${px(0)}" x2="${px(0)}" y1="${T}" y2="${H - B}" stroke="#2f3656" stroke-dasharray="3 3"/><line x1="${L}" x2="${W - Rr}" y1="${py(0)}" y2="${py(0)}" stroke="#2f3656" stroke-dasharray="3 3"/>`;
  g += `<text x="${W - Rr - 4}" y="${T + 10}" text-anchor="end" style="fill:var(--good)">strong both oldalon</text><text x="${L + 4}" y="${H - B - 6}" style="fill:var(--bad)">weak both oldalon</text><text x="${W - Rr}" y="${H - 6}" text-anchor="end">attack →</text><text x="${L}" y="${T - 3}">↑ defence</text>`;
  const boxes = [];
  for (const p of pts.sort((a, b) => (a.t === S.team) - (b.t === S.team))) { const cx = px(p.x), cy = py(p.y), sel = p.t === S.team, col = p.x + p.y >= 0 ? "var(--good)" : "var(--bad)";
    g += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${sel ? 6 : 4.5}" fill="${sel ? "var(--gold)" : col}" fill-opacity="${sel ? 1 : .55}" data-t="${esc(p.t)}" style="cursor:pointer"><title>${esc(p.t)}: attack ${sg(p.x, 2)}, defence ${sg(p.y, 2)}</title></circle>`;
    const lab = short(p.t), w = lab.length * 5.8, left = cx + 8 + w > W - 4, bx = left ? cx - 8 - w : cx + 8, by = cy - 6;
    if (!sel && boxes.some(b => bx < b[0] + b[2] && bx + w > b[0] && by < b[1] + 11 && by + 11 > b[1])) continue; boxes.push([bx, by, w]);
    g += `<text x="${bx.toFixed(1)}" y="${(cy + 3).toFixed(1)}" style="fill:${sel ? "var(--gold)" : "var(--ink)"};font-size:9.5px">${esc(lab)}</text>`; }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="attack and defensive strength">${g}</svg>`;
}

/* ---------- Schedule: fixture ticker, strength of schedule, rest ---------- */
function viewMenetrend() {
  const R = ratings(S.gw), all = S.tick === 99, last = Math.min(D.rounds, S.gw + (all ? D.rounds : S.tick)), rounds = [];
  for (let g = S.gw + 1; g <= last; g++) rounds.push(g);
  const rows = TEAMS.map(t => { const cells = rounds.map(g => FX.filter(f => f[0] === g && (f[1] === t || f[2] === t)).map(f => { const home = f[1] === t, o = home ? f[2] : f[1]; return { o, home, xp: predFor(t, o, home, R).xp }; })); const flat = cells.flat(); return { t, cells, sum: flat.reduce((a, c) => a + c.xp, 0), n: flat.length }; })
    .sort((a, b) => b.sum / Math.max(1, b.n) - a.sum / Math.max(1, a.n));
  const TK = [[3, "Next 3"], [6, "Next 6"], [99, "Rest of the season"]];
  const cell = (c) => `<span class="tk" style="background:${heatRGB((c.xp - .7) / 1.4, .78)}" title="${esc(c.o)} ${c.home ? "home" : "away"}: expected ${nf(c.xp, 2)} point"><b>${esc(short(c.o))}</b><small>${c.home ? "H" : "V"}</small></span>`;
  const tick = rounds.length ? `<div class="tw"><table class="sticky1 ticker"><thead><tr><th class="l">#</th><th class="l">Club</th>${all ? `<th>Match</th><th>Expected point</th><th class="l">Points / match</th>` : rounds.map(g => `<th>${g}.</th>`).join("") + `<th>ossz.</th>`}</tr></thead><tbody>
    ${rows.map((r, i) => `<tr class="click ${S.team === r.t ? "sel" : ""}" data-t="${esc(r.t)}"><td class="l mono" style="color:var(--muted)">${i + 1}</td><td class="l"><b>${esc(nm(r.t))}</b></td>${all ? `<td>${r.n}</td><td><b>${nf(r.sum, 1)}</b></td><td class="l"><span class="mono">${nf(r.sum / Math.max(1, r.n), 2)}</span><span class="pbar" style="width:${Math.max(2, (r.sum / Math.max(1, r.n) - .8) * (narrow() ? 40 : 80))}px;background:${heatRGB((r.sum / Math.max(1, r.n) - 1) / .9)}"></span></td>` : r.cells.map(cs => `<td class="tkc">${cs.length ? cs.map(cell).join("") : `<span class="tk blank">–</span>`}</td>`).join("") + `<td><b>${nf(r.sum, 1)}</b></td>`}</tr>`).join("")}</tbody></table></div>` : `<p class="empty">No remaining gameweek.</p>`;
  const fat = fatigue(S.gw).map(x => { const nx = FX.find(f => f[0] === S.gw + 1 && (f[1] === x.t || f[2] === x.t)); return { ...x, nxt: nx ? restAround(x.t, nx[5]) : null }; }).sort((a, b) => b.eu - a.eu || (a.avg || 9) - (b.avg || 9));
  return `<section class="sec"><div class="sechead"><h2>Schedule</h2><div class="seg" role="group" aria-label="time">${TK.map(([k, l]) => `<button data-tick="${k}" aria-pressed="${S.tick === k}">${l}</button>`).join("")}</div></div>
    <p class="note">Every cella a next match: a modell according to expected point (3 × win chance + draw chance). Green: easy, red: hard. H: home, V: away. Fent a easy schedule. ${S.gw} after the roundi strength.</p>
    <div class="panel">${tick}</div></section>
    <section class="sec"><div class="two eq"><div class="panel"><h3 class="h3">hard: eddig and after</h3><p class="note">Az ellenfelek average Power-ereje. Grey: akik against eddig played, yellow: akik still hatravannak. Fent azok, akiknek easier will be a folytatas.</p>${sosChart()}</div>
    <div class="panel"><h3 class="h3">Rest and load</h3><div class="tw"><table class="sticky1"><thead><tr><th class="l">#</th><th class="l">Club</th><th>Europe</th><th>atl. rest, day</th><th>&lt;4 day</th><th class="hm">xPont/m short after</th><th class="hm">xPont/m egyebkent</th><th>kov. before</th></tr></thead><tbody>
    ${fat.map((x, i) => `<tr class="click ${S.team === x.t ? "sel" : ""}" data-t="${esc(x.t)}"><td class="l mono" style="color:var(--muted)">${i + 1}</td><td class="l"><b>${esc(nm(x.t))}</b></td><td>${x.eu || "–"}</td><td>${x.avg ? nf(x.avg, 1) : "–"}</td><td class="${x.ns ? "neg" : ""}">${x.ns || "–"}</td><td class="hm">${x.xs != null ? nf(x.xs, 2) : "–"}</td><td class="hm">${x.xn != null ? nf(x.xn, 2) : "–"}</td><td>${x.nxt && x.nxt.before != null ? `<span class="${restCls(x.nxt.before)}">${nf(x.nxt.before, 1)}</span>${x.nxt.next && x.nxt.next.c !== "PL" && x.nxt.after < TH.europe_soon_days ? ` <span class="tag rob" title="in ${nf(x.nxt.after, 1)} days">+${esc(x.nxt.next.c)}</span>` : ""}` : "–"}</td></tr>`).join("")}</tbody></table></div>
    <p class="note">Europe: eddigi BL/EL/KL-meccsek. &lt;4 day: how many PL-meccset played 4 napnal fewer rest. xPont/m: deserved point per match short rest after and egyebkent. kov. before: rest a next PL-match before; cimke, if afterwards 5 napon inside European match comes. A Ligakupa and the FA-kupa no benne; EL/KL-nel a play datuma.</p></div></div></section>`;
}
function sosChart() {
  const pts = TEAMS.map(t => ({ t, a: oppPower(t, S.gw, false), b: oppPower(t, S.gw, true) })).filter(p => p.a != null && p.b != null).sort((x, y) => (x.b - x.a) - (y.b - y.a));
  if (!pts.length) return `<p class="empty">No enough adat.</p>`;
  const nw = narrow(), W = nw ? 360 : 520, rh = 19, T = 18, H = T + pts.length * rh + 22, L = nw ? 74 : 112, Rr = 44;
  const vs = pts.flatMap(p => [p.a, p.b]), x0 = Math.min(...vs) - .05, x1 = Math.max(...vs) + .05, px = (v) => L + (v - x0) / (x1 - x0) * (W - L - Rr);
  let g = `<line x1="${px(0)}" x2="${px(0)}" y1="${T - 6}" y2="${H - 20}" stroke="#2f3656" stroke-dasharray="3 3"/><text x="${px(0)}" y="${T - 8}" text-anchor="middle">average</text><text x="${L}" y="${H - 6}">← easier ellenfelek</text><text x="${W - Rr}" y="${H - 6}" text-anchor="end">harder →</text>`;
  pts.forEach((p, i) => { const y = T + i * rh + 8, sel = p.t === S.team, d = p.b - p.a;
    g += `<text x="${L - 8}" y="${y + 3.5}" text-anchor="end" style="fill:${sel ? "var(--gold)" : "var(--ink)"};font-size:10.5px">${esc(nw ? short(p.t) : p.t)}</text><line x1="${px(p.a)}" x2="${px(p.b)}" y1="${y}" y2="${y}" stroke="${d < 0 ? "var(--good)" : "var(--bad)"}" stroke-width="2" opacity=".6"/>
      <circle cx="${px(p.a)}" cy="${y}" r="4" fill="var(--bg)" stroke="#8f97b4" stroke-width="1.5"><title>${esc(p.t)} eddigi ellenfelei: ${sg(p.a, 2)}</title></circle><circle cx="${px(p.b)}" cy="${y}" r="4.5" fill="var(--gold)"><title>${esc(p.t)} remaining ellenfelei: ${sg(p.b, 2)}</title></circle>
      <text x="${W - Rr + 6}" y="${y + 3.5}" style="fill:${d < 0 ? "var(--good)" : "var(--bad)"}">${sg(d, 2)}</text>`; });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ellenfelek ereje eddig and after">${g}</svg>`;
}

/* ---------- show: sortable team metrics ---------- */
const TG = {
  alap: ["Alap", [["pw", "Power", 2], ["pts", "Points", 0], ["xpts", "xPont", 1], ["luck", "Points − xPont", 1], ["xgd", "xG-kul. / m", 2], ["axgd", "Adjusted xG-kul. / m", 2], ["npxgd", "npxG-kul. / m", 2], ["fin", "Finishing G − xG", 1], ["keep", "Defence xGA − KG", 1]]],
  tam: ["Attack", [["xg", "xG / m", 2], ["shf", "Shot / m", 1], ["xgs", "xG / shot", 3], ["bc", "Big chance / m", 2], ["sp", "Set piece-xG %", 0], ["box", "and a 16-oson°", 0], ["crs", "cross°", 0], ["thr", "through ball°", 0], ["head", "Fejes goal°", 0], ["fb", "goal°", 0]]],
  ved: ["Defence", [["xga", "xGA / m", 2, 1], ["sha", "Kapott shot / m", 1, 1], ["xgsa", "Kapott xG / shot", 3, 1], ["bca", "Kapott big chance / m", 2, 1], ["ppda", "PPDA°", 1, 1], ["hto", "Magas recovery°", 0], ["obox", "Opponent and a 16-oson°", 0, 1], ["err", "hibabol conceded goal°", 0, 1]]],
  allas: ["play", [["lead", "lead, time %", 0], ["trail", "behind, time %", 0, 1], ["first", "o szerzi the first goals %", 0], ["dropped", "Elhullajtott point lead", 0, 1], ["won", "Hozott point behind", 0], ["late", "Goal 75' after", 0], ["lateA", "Kapott goal 75' after", 0, 1], ["cgN", "Szoros match (≤1 goal)", 0], ["cgP", "Points szoros meccseken", 0], ["cgL", "Szoros meccsek: point − xPont", 1], ["cbP", "forditasbol szerzett point", 0], ["blP", "strength chance elszort point", 0, 1]]],
  stil: ["Style", [["poss", "possession %°", 1], ["acc", "accuracy %°", 1], ["spd", "attack speed°", 2], ["bu", "build-up attack°", 0], ["da", "Direkt attack°", 0], ["ten", "10+ passzos sorozat°", 0], ["spp", "Pass / sorozat°", 1], ["wood", "Kapufa°", 0]]],
  men: ["Schedule", [["sosA", "Eddigi ellenfelek ereje", 2, 1], ["sosB", "Remaining ellenfelek ereje", 2, 1], ["rest", "Average rest, day", 1], ["short", "Match <4 day rest", 0, 1], ["eu", "European match", 0, 1]]],
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
    { c: "var(--bad)", h: "Elhullajtott pontok", t: `<b>${esc(d.t)}</b> ${d.dropped} pontot veszitett el that kind meccseken, where vezetett. A other end ${esc(w.t)} ${w.won} pontot hozott vissza behind.` },
    { c: "var(--home)", h: "choose", t: `<b>${esc(q.t)}</b> shot ${nf(q.xgs, 2)} xG-t teremt, this a league best chance. Kevesebb, but better shot.` },
    { c: "var(--gold)", h: "Meccskontroll", t: `<b>${esc(ld.t)}</b> a play ${nf(ld.lead, 0)}%-aban vezetett, and only ${nf(ld.trail, 0)}%-aban was behind.` },
  ];
  return `<section class="sec"><div class="insights">${ins.map((o, i) => `<div class="ins" style="--c:${o.c};animation-delay:${i * 60}ms"><span class="n">${i + 1} · ${esc(o.h)}</span><p>${o.t}</p></div>`).join("")}</div></section>
    <section class="sec"><div class="sechead"><h2>Clubs</h2><span class="kicker">After gameweek ${S.gw}</span></div>
    <div class="seg" role="group" aria-label="show">${Object.entries(TG).map(([k, v]) => `<button data-tg="${k}" aria-pressed="${S.tgrp === k}">${v[0]}</button>`).join("")}</div>
    <div class="panel"><div class="tw"><table class="sticky1 wrapth" id="tm"><thead><tr><th class="l">#</th><th class="l">Club</th>${cols.map(([k, l]) => `<th data-tk="${k}" ${sk.k === k ? `aria-sort="${sk.asc ? "ascending" : "descending"}"` : ""}>${esc(l)}${sk.k === k ? (sk.asc ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead><tbody>
    ${sorted.map((r, i) => `<tr class="click ${S.team === r.t ? "sel" : ""}" data-t="${esc(r.t)}"><td class="l mono" style="color:var(--muted)">${i + 1}</td><td class="l"><b>${esc(nm(r.t))}</b></td>${cols.map(([k, , dd]) => { const u = heats[k][r.t]; return `<td style="${u != null ? `background:${heatRGB(u, k === sk.k ? .32 : .14)}` : ""}">${r[k] == null ? "–" : ["pw", "luck", "xgd", "axgd", "npxgd", "fin", "keep", "sosA", "sosB", "cgL"].includes(k) ? sg(r[k], dd) : nf(r[k], dd)}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>
    <p class="note">Click a column heading to sort, still egyszer a forditott sorrendhez. Green: better, red: worse a in the league. /m: per match. Big chance: at least 0,3 xG. npxG: 11-esek without. ° Opta season, always a legfrissebb allapot. A play a goals minute figure. forditasbol szerzett point: where a win chance 20% ala esett, and yet pontot szerzett. elszort point: where 80% above was a win chance, and yet not nyert. Szoros match: legfeljebb goal gap or draw; ezek most the NFL-ben is known luck, because rarely ismetlodik.</p></div></section>`;
}

/* ---------- Database: match finder ---------- */
const MF0 = { team: "", venue: "", tag: "", from: 1, sort: "date", lim: 20 };
const SF0 = { q: "", team: "", opp: "", sit: "", body: "", res: "", zone: "", xmin: 0, mfrom: 0, mto: 120, from: 1, lim: 30 };
S.mf = Object.assign({}, MF0); S.sf = Object.assign({}, SF0);
const MTAGS = [["", "All"], ["rob", "Robberies"], ["elusz", "Blown win"], ["fol", "Control"], ["ford", "Comebacks"], ["izg", "Legizgalmasabbak"], ["golz", "goal (4+)"], ["xgw", "More xG-vel vesztett"]];
const MSORT = [["date", "Date"], ["excite", "Izgalmi index"], ["xg", "Total xG"], ["goals", "Goals"], ["rob", "Robbery merteke"], ["xgd", "xG-gap"]];
function matchTagOf(m) { const v = verdictRaw(m); const C = wpCurve(m); return { rob: !!v.win && v.pAct < TH.robbery_win_probability, elusz: !v.win && Math.max(m.pw, m.pl) > TH.blown_win_probability, fol: !!v.win && v.pAct > TH.dominance_win_probability && Math.abs(m.xh - m.xa) > TH.dominance_xg_diff, ford: C.minW != null && C.minW < TH.comeback_win_probability && C.trailed, golz: m.hs + m.as >= TH.goal_flurry, xgw: (m.hs > m.as && m.xa > m.xh) || (m.as > m.hs && m.xh > m.xa) }; }
function viewMeccsek() {
  const F = S.mf, all = M.filter(m => m.gw <= S.gw && m.gw >= F.from && (!F.team || (F.venue === "home" ? m.h === F.team : F.venue === "away" ? m.a === F.team : m.h === F.team || m.a === F.team)));
  let list = all.filter(m => !F.tag || F.tag === "izg" || matchTagOf(m)[F.tag]);
  const key = { date: (m) => -Date.parse(m.date) - m.id, excite: (m) => -wpCurve(m).excite, xg: (m) => -(m.xh + m.xa), goals: (m) => -(m.hs + m.as), rob: (m) => verdictRaw(m).win ? verdictRaw(m).pAct : 9, xgd: (m) => -Math.abs(m.xh - m.xa) }[F.tag === "izg" && F.sort === "date" ? "excite" : F.sort];
  list = list.slice().sort((a, b) => key(a) - key(b)); if (F.tag === "izg") list = list.slice(0, 10);
  const shown = list.slice(0, F.lim), G = list.reduce((a, m) => a + m.hs + m.as, 0), X = list.reduce((a, m) => a + m.xh + m.xa, 0);
  const row = (m) => { const v = verdict(m), C = wpCurve(m), tg = matchTagOf(m), open = S.open === m.id;
    return `<div class="mrow ${open ? "open" : ""}" data-mo="${m.id}" role="button" tabindex="0" aria-expanded="${open}"><span class="mono note" style="white-space:nowrap">${m.gw}. · ${esc(DAY.format(new Date(m.date)))}</span>
      <span class="mt"><b class="${m.hs > m.as ? "w" : ""}">${esc(nm(m.h))}</b> <span class="msc">${m.hs}–${m.as}</span> <b class="${m.as > m.hs ? "w" : ""}">${esc(nm(m.a))}</b></span>
      <span class="mono mx">xG ${nf(m.xh, 1)}–${nf(m.xa, 1)}</span><span class="tags"><span class="tag ${v.cls}">${v.tag}</span>${tg.ford ? `<span class="tag cb">Comeback</span>` : ""}</span><span class="mono note me" title="izgalmi index">⚡${nf(C.excite, 1)}</span></div>
      ${open ? `<div class="mopen">${matchCard(m, 0)}</div>` : ""}`; };
  return `<section class="sec"><div class="sechead"><h2>Match finder</h2><span class="kicker">${list.length} match · ${G} goal · ${nf(X, 1)} xG</span></div>
    <div class="seg" role="group" aria-label="match">${MTAGS.map(([k, l]) => `<button data-mft="${k}" aria-pressed="${F.tag === k}">${l}</button>`).join("")}</div>
    <div class="row"><select class="sel" data-mf="team" aria-label="Club"><option value="">Every club</option>${TEAMS.map(t => `<option ${t === F.team ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
      <select class="sel" data-mf="venue" aria-label="Ground" ${F.team ? "" : "disabled"}><option value="">home and away</option><option value="home" ${F.venue === "home" ? "selected" : ""}>only home</option><option value="away" ${F.venue === "away" ? "selected" : ""}>only away</option></select>
      <select class="sel" data-mf="from" aria-label="gameweek">${Array.from({ length: S.gw }, (_, i) => i + 1).map(g => `<option value="${g}" ${g === F.from ? "selected" : ""}>${g}. gameweek</option>`).join("")}</select>
      <select class="sel" data-mf="sort" aria-label="Sort">${MSORT.map(([k, l]) => `<option value="${k}" ${k === F.sort ? "selected" : ""}>Sort: ${l}</option>`).join("")}</select>
      <button class="chip" id="mf-reset">Filters and</button></div>
    <div class="panel mlist">${shown.length ? shown.map(row).join("") : `<p class="empty">No this kind match.</p>`}</div>
    <div class="row" style="justify-content:space-between"><span class="note">Click a match: arrow a full match xG-curve, win chancekkel and shot. A GW-choose a upper if (now: ${S.gw}. gameweek).</span>${list.length > F.lim ? `<button class="chip" id="mf-more">Mutass still 20-at</button>` : ""}</div>
    <p class="note">Robbery: a winner a shot from 30%-nal kisebb chance nyert volna. Blown win: draw, pedig valamelyik club 55% over was. Control: deserved win big xG-gap. Comeback: a winner behind was, and 25% ala esett a win chance. ⚡ izgalmi index: mennyit hullamzott a win chance.</p></section>`;
}

/* ---------- Database: shot finder ---------- */
const SITS = ["open play", "corner", "set piece", "free kick", "penalty"], BODY = [["RightFoot", "right foot"], ["LeftFoot", "left foot"], ["Head", "header"], ["OtherBodyPart", "other"]];
const SRES = [["G", "goal"], ["S", "save"], ["M", "off target"], ["B", "block"], ["P", "post"]], ZONES = [["six", "otoson inside"], ["box", "16-oson inside"], ["out", "16-oson outside"]];
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
  const chips = (key, opts) => `<div class="seg" role="group">${[["", "all"], ...opts].map(([k, l]) => `<button data-sfc="${key}:${k}" aria-pressed="${String(F[key]) === String(k)}">${l}</button>`).join("")}</div>`;
  const MINS = [[0, 120, "full match"], [0, 15, "0–15'"], [16, 30, "16–30'"], [31, 45, "31–45+'"], [46, 60, "46–60'"], [61, 75, "61–75'"], [76, 120, "76–90+'"]];
  return `<section class="sec"><div class="sechead"><h2>Shot finder</h2><span class="kicker">${list.length} shot a ${SH.filter(s => s[I.res] !== "O" && s[I.gw] <= S.gw).length}-bol</span></div>
    <div class="row"><input class="sel" id="sq" type="search" placeholder="Player neve" value="${esc(F.q)}" aria-label="Player" style="flex:1 1 160px;max-width:240px;min-width:0">
      <select class="sel" data-sf="team" aria-label="Club"><option value="">shot club: all</option>${TEAMS.map(t => `<option ${t === F.team ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
      <select class="sel" data-sf="opp" aria-label="Opponent"><option value="">Opponent: all</option>${TEAMS.map(t => `<option ${t === F.opp ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
      <select class="sel" data-sf="xmin" aria-label="Minimum xG">${[[0, "any chance"], [0.1, "good chance (0,10+ xG)"], [0.3, "big chance (0,30+ xG)"], [0.5, "oriasi chance (0,50+ xG)"]].map(([v, l]) => `<option value="${v}" ${+F.xmin === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      <select class="sel" data-sf="min" aria-label="time">${MINS.map(([a, b, l]) => `<option value="${a}-${b}" ${F.mfrom === a && F.mto === b ? "selected" : ""}>${l}</option>`).join("")}</select>
      <select class="sel" data-sf="from" aria-label="gameweek">${Array.from({ length: S.gw }, (_, i) => i + 1).map(gg => `<option value="${gg}" ${gg === F.from ? "selected" : ""}>${gg}. gameweek</option>`).join("")}</select>
      <button class="chip" id="sf-reset">Filters and</button></div>
    <div class="fgrid"><span class="kicker">Outcome</span>${chips("res", SRES)}<span class="kicker">Chance</span>${chips("sit", SITS.map(x => [x, x]))}<span class="kicker">Body part</span>${chips("body", BODY)}<span class="kicker">Zone</span>${chips("zone", ZONES)}</div>
    <div class="two wide"><div class="panel"><div class="kv six"><div><b>${list.length}</b><span>shot</span></div><div><b>${g}</b><span>goal</span></div><div><b>${nf(x, 1)}</b><span>xG</span></div><div><b class="${g - x >= 0 ? "pos" : "neg"}">${sg(g - x, 1)}</b><span>goal − xG</span></div><div><b>${list.length ? pc(g / list.length) : "–"}</b><span>conversion</span></div><div><b>${list.length ? nf(dist, 1) : "–"}</b><span>atl. tav, m</span></div></div>
      ${halfPitch(list, "var(--home)", "filtered shots", list.length > 250 ? 0.55 : 1)}
      <p class="note">${list.length ? `Kapura tartott: ${pc(on / list.length)} · average chance: ${nf(x / list.length, 2)} xG. ` : ""}Yellow: goal, telt: save or post, empty: off target or blokkolt. A circle merete a chance.</p></div>
      <div class="panel"><p class="kicker">A filter a now xG</p>${tops.length ? tops.map((o, i) => `<button class="tl" data-sq="${esc(o.n)}"><span class="mono" style="color:var(--muted)">${i + 1}</span><span class="tn">${esc(o.n)} <small>${esc(short(o.t))} · ${o.sh} shot</small></span><b>${o.g} / ${nf(o.x, 1)}</b></button>`).join("") : `<p class="empty">No talalat.</p>`}
      <p class="note">Goal / xG. Click a name: a filter onto it szukul.</p></div></div>
    <div class="panel"><p class="kicker">A legnagyobb chances a filter</p><div class="tw"><table><thead><tr><th class="l">Ford.</th><th class="l">Min</th><th class="l">Player</th><th class="l">Opponent</th><th class="l hm">Chance</th><th class="l hm">Body part</th><th>xG</th><th class="l">Outcome</th></tr></thead><tbody>
    ${shown.map(s => `<tr><td class="l mono" style="color:var(--muted)">${s[I.gw]}.</td><td class="l mono">${s[I.min]}'</td><td class="l"><b>${esc(s[I.pl])}</b> <span class="note">${esc(short(s[I.team]))}</span></td><td class="l">${esc(nm(s[I.opp]))}</td><td class="l hm">${esc(s[I.sit])}</td><td class="l hm">${esc((BODY.find(b => b[0] === s[I.typ]) || [0, s[I.typ]])[1])}</td><td><b>${nf(s[I.xg], 2)}</b></td><td class="l ${s[I.res] === "G" ? "pos" : ""}">${RESN[s[I.res]]}</td></tr>`).join("")}</tbody></table></div>
    ${list.length > F.lim ? `<button class="chip" id="sf-more" style="align-self:flex-start">Mutass still 30-at</button>` : ""}</div></section>`;
}

/* ---------- Player: sortable, filterable leaderboards ---------- */
const PG = {
  gol: ["Goals", [["g", "Goal", 0, 1], ["npg", "Nem penalty", 0, 1], ["xg", "xG", 1, 1], ["npxg", "npxG", 1, 1], ["fin", "G − xG", 1, 0], ["pg", "penalty goal", 0, 1], ["hg", "Fejes", 0, 1], ["ob", "16-oson outside", 0, 1], ["lg", "75' after", 0, 1]]],
  lov: ["Shots", [["sh", "Shot", 0, 1], ["sot", "Kapura", 0, 1], ["acc", "accuracy %", 0, 0], ["xgs", "xG / shot", 2, 0], ["conv", "Conversion %", 0, 0], ["bc", "Big chance", 0, 1], ["bcm", "Kihagyott big", 0, 1, 1], ["dist", "atl. distance m", 1, 0, 1]]],
  kre: ["Creativity", [["a", "Assist", 0, 1], ["xa", "xA", 1, 1], ["xgi", "xG + xA", 1, 1], ["cc", "chance", 0, 1], ["occ", "akciobol", 0, 1], ["kp", "Kulcspassz", 0, 1], ["tb", "through ball", 0, 1], ["cr", "Good cross", 0, 1], ["f3", "Last harmad pass", 0, 1]]],
  lab: ["Labda", [["pas", "Pass", 0, 1], ["pp", "Pass %", 1, 0], ["car", "lead", 0, 1], ["pc", "elorevivo leading", 0, 1], ["pd", "elorevitt tav m", 0, 1], ["gdw", "Nyert ground if", 0, 1], ["gdp", "Ground if %", 0, 0]]],
  ved: ["Defence", [["dc", "Defensive contribution", 0, 1], ["tck", "Tackle", 0, 1], ["itc", "Interception pass", 0, 1], ["rec", "Recovery", 0, 1], ["blk", "Block", 0, 1], ["clr", "Clearance", 0, 1], ["adw", "Nyert aerial duel", 0, 1], ["adp", "Aerial duel %", 0, 0], ["fc", "Foul", 0, 1, 1], ["yc", "Yellow lap", 0, 1, 1]]],
  concedes: ["Goalkeeper", [["gpv", "prevented goal", 1, 1], ["sv", "Save", 0, 1], ["svp", "Save %", 0, 0], ["xgot", "Kapura tarto xG", 1, 1], ["gc", "Kapott goal", 0, 1, 1], ["cs", "Kapott goal without", 0, 1]]],
  kul: ["special", [["wpa", "Win contribution (xPont)", 2, 1], ["padd", "Points added goal", 0, 1], ["dec", "Winner goal", 0, 1], ["ug", "Solo goal", 0, 1], ["share", "Club xG+xA %", 0, 0], ["gi90", "G + GP / 90", 2, 0], ["val", "xG+xA / 10 M€", 2, 0], ["bcm", "Kihagyott big", 0, 1, 1]]],
  fpl: ["FPL and value", [["pts", "FPL point", 0, 1], ["price", "ar £m", 1, 0], ["ppm", "Points / £m", 1, 0], ["sel", "Selected %", 1, 0], ["form", "Form", 1, 0], ["epn", "Expected point kov.", 1, 0], ["mv", "Piaci value M€", 1, 0], ["age", "Age", 0, 0, 1]]],
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
const TOPS = [["goal", "g"], ["Assist", "a"], ["Points added goal", "padd"], ["Win contribution", "wpa"], ["xG", "xg"], ["chance", "cc"], ["Defensive contribution", "dc"], ["prevented goal", "gpv"], ["FPL point", "pts"]];
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
    <div class="row">${S.grp === "concedes" ? "" : `<div class="seg" role="group" aria-label="Poszt">${POS.map(([k, l]) => `<button data-pos="${k}" aria-pressed="${S.ppos === k}">${l}</button>`).join("")}</div>`}
      <select class="sel" id="pteam" aria-label="Club"><option value="">Every club</option>${TEAMS.map(t => `<option ${t === S.pteam ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
      <select class="sel" id="pmin" aria-label="play">${[0, 90, 270, 450, 630].map(v => `<option value="${v}" ${v === S.pmin ? "selected" : ""}>${v ? v + "+ minutes" : "anyone"}</option>`).join("")}</select>
      <button class="chip" id="p90" aria-pressed="${S.p90}">90 percre</button><input class="sel" id="pq" type="search" placeholder="name find" value="${esc(S.q)}" aria-label="name find" style="min-width:0;flex:1 1 140px;max-width:240px"></div>
    <div class="panel"><div class="tw"><table class="sticky1 wrapth" id="pt"><thead><tr><th class="l">#</th><th class="l">Player</th><th class="hm">Min</th>${cols.map(([k, l]) => `<th data-pk="${k}" ${sk.k === k ? `aria-sort="${sk.asc ? "ascending" : "descending"}"` : ""}>${esc(l)}${sk.k === k ? (sk.asc ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead><tbody>
    ${shown.length ? shown.map((r, i) => `<tr class="click ${sel && r.id === sel.id ? "sel" : ""}" data-p="${r.id}"><td class="l mono" style="color:var(--muted)">${i + 1}</td><td class="l pn"><b>${esc(r.p.n)}</b><span class="note">${esc(short(r.p.t))} · ${r.p.pos}</span></td><td class="hm">${r.p.min}</td>${cols.map(([k, , d]) => `<td style="${k === sk.k && heat[r.id] != null ? `background:${heatRGB(heat[r.id], .3)}` : ""}">${k === sk.k ? `<b>${fmt(r, k, d)}</b>` : fmt(r, k, d)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${cols.length + 3}" class="l empty">No talalat.</td></tr>`}</tbody></table></div>
    <div class="row" style="justify-content:space-between"><span class="note">${sorted.length} player · ${S.p90 ? "a figure 90 percre vetitve" : "season"}${S.grp === "concedes" ? " · only kapusok" : ""}</span>${sorted.length > S.plim ? `<button class="chip" id="pmore">Mutass still 25-five</button>` : ""}</div>
    <p class="note">Click a column heading to sort, a sorra a player profiljahoz. Win contribution: a player goal total mennyivel noveltek a club expected point in that a pillanatban (NFL-es WPA mintajara). Points added goal: how many pontot ert a csapatnak (without them fewer point became volna). Winner goal: amelyik most elonyhoz juttatta a win. Solo goal: assist without, penalty without. Defensive contribution: the FPL hivatalos show (tackle, block, and, clearance, recovery). source: FPL, Opta, Understat, Transfermarkt.</p></div></section>
    ${sel ? playerProfile(sel, cmp) : ""}`;
}
function playerProfile(sel, cmp) {
  const psh = (pl) => pl ? SH.filter(s => s[I.pid] === pl.id) : [];
  const ps = percentiles(sel), pc2 = cmp ? percentiles(cmp) : null;
  const peers = PL.filter(q => q.pos === sel.pos && q.min >= TH.min_minutes_default && q.id !== sel.id).sort((a, b) => a.n.localeCompare(b.n));
  const facts = [[sel.g, "goal"], [sel.a, "assist"], [nf(sel.xg, 1), "xG"], [nf(sel.xa, 1), "xA"], [sel.padd, "points added goal"], [sel.pts, "FPL point"]];
  return `<section class="sec" id="profile"><div class="panel"><div class="row" style="justify-content:space-between;align-items:flex-end"><div><p class="kicker">${esc(sel.t)} · ${sel.pos} · ${sel.min} minutes${sel.age ? ` · ${sel.age} years old` : ""}</p><h3 style="font-family:var(--f-display);font-size:34px;text-transform:uppercase;line-height:1">${esc(sel.n)}</h3>${sel.news ? `<p class="note neg">${esc(sel.news)}</p>` : ""}</div>${sel.mv ? `<span class="mono" style="color:var(--muted)">${nf(sel.mv / 1e6, 0)} M€ · £${nf(sel.price, 1)}m</span>` : ""}</div>
    <div class="kv six">${facts.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join("")}</div>
    <div class="two eq"><div style="display:flex;flex-direction:column;gap:8px"><div class="row"><span class="note">and:</span><select class="sel" id="pcmp" aria-label="and other play"><option value="">valassz play…</option>${peers.map(q => `<option value="${q.id}" ${cmp && cmp.id === q.id ? "selected" : ""}>${esc(q.n)} (${esc(short(q.t))})</option>`).join("")}</select></div>
      ${pc2 ? `<div class="lgd"><span><i style="background:var(--gold)"></i>${esc(sel.n)} (upper bar)</span><span><i style="background:var(--away)"></i>${esc(cmp.n)} (lower bar)</span></div>` : ""}
      ${ps.map((z, i) => `<div class="strip ${pc2 ? "cmp" : ""}"><span class="lab">${z.l}</span><span class="bar ${pc2 ? "two" : ""}">${pc2 ? `<span class="dot dn" style="left:${pc2[i].pr * 100}%;background:var(--away)" title="${esc(cmp.n)}: ${nf(pc2[i].v, z.d)}"></span>` : ""}<span class="dot ${pc2 ? "up" : ""}" style="left:${z.pr * 100}%;background:var(--gold)" title="${esc(sel.n)}: ${nf(z.v, z.d)}"></span></span><span class="v">${pc2 ? `<b style="color:var(--gold)">${nf(z.v, z.d)}</b><br><b style="color:var(--away)">${nf(pc2[i].v, z.d)}</b>` : nf(z.v, z.d)}</span></div>`).join("")}
      <p class="note">Percentilis a(z) ${sel.pos} poszton at least 270 percet jatszok among, 90 percre (balra gyengebb, jobbra better).${cmp ? ` Narancs: ${esc(cmp.n)}.` : ""}</p></div>
    <div class="row" style="align-items:flex-start;gap:12px"><div style="flex:1 1 220px;min-width:0"><p class="kicker">${esc(sel.n)} shot · ${psh(sel).length} db</p>${halfPitch(psh(sel), "var(--home)", sel.n)}</div>${cmp ? `<div style="flex:1 1 220px;min-width:0"><p class="kicker">${esc(cmp.n)} shot · ${psh(cmp).length} db</p>${halfPitch(psh(cmp), "var(--away)", cmp.n)}</div>` : ""}</div></div></div></section>`;
}

const OPK = [["possession_pos_perc", "possession", 1, "%", false], ["sequences_ppda", "PPDA (press)", 1, "", true], ["sequences_direct_speed_for", "attack speed", 2, "m/s", false], ["sequences_high_turnovers", "Magas recovery", 0, "", false],
  ["sequences_build_ups", "build-up attack", 0, "", false], ["sequences_direct_attacks", "Direkt attack", 0, "", false], ["attack_set_piece_team_sp_goal_perc", "Goal set piece", 0, "%", false], ["attack_misc_fast_break_goals", "Goal kontrabol", 0, "", false]];
const orank = (k, v, low) => { if (v == null) return null; const a = Object.values(OP).map(o => o[k]).filter(x => x != null); return (low ? a.filter(x => x < v).length : a.filter(x => x > v).length) + 1; };
const ORD = (n) => n === 1 ? "" : n + ". ";
function rankIn(rows, k, t, low) { const v = rows.find(r => r.t === t)[k]; if (v == null) return null; const vals = rows.map(r => r[k]).filter(x => x != null); return (low ? vals.filter(x => x < v).length : vals.filter(x => x > v).length) + 1; }
function trendSentences(t, r) {
  const TM = teamMetrics(S.gw), me = TM.find(z => z.t === t), R = ratings(S.gw), F = [];
  const add = (rk, n, txt) => { if (rk == null) return; F.push({ s: Math.min(rk, n + 1 - rk), txt }); };
  const n = TM.length;
  // set pieces
  { const rk = rankIn(TM, "sp", t); if (me.sp != null) add(rk, n, rk <= 3 ? `xG-jenek ${nf(me.sp, 0)}%-a set piece comes, this a league ${ORD(rk)}legmagasabb aranya.` : rk >= n - 2 ? `set piece hardly veszelyes: xG-jenek only ${nf(me.sp, 0)}%-a comes so, a league ${ORD(n + 1 - rk)}legalacsonyabb aranya.` : `xG-jenek ${nf(me.sp, 0)}%-a set piece comes (${rk}. a in the league).`); }
  // finishing and goalkeeping luck
  { const rk = rankIn(TM, "fin", t); add(rk, n, rk <= 3 ? `finishing a league ${ORD(rk)}legjobbja: ${sg(me.fin, 1)} goal a helyzetei over.` : rk >= n - 2 ? `finishing a league ${ORD(n + 1 - rk)}most: ${sg(me.fin, 1)} goal a helyzeteihez kepest.` : `Finishing: ${sg(me.fin, 1)} goal a helyzeteihez kepest (${rk}. a in the league).`); }
  { const rk = rankIn(TM, "keep", t); add(rk, n, rk <= 3 ? `hatul luck or good a kapusa: ${sg(me.keep, 1)} goal kevesebbet conceded, mint amennyit a chances indokolnak (${rk}. a in the league).` : rk >= n - 2 ? `hatul luck: ${sg(-me.keep, 1)} goal more conceded, mint amennyit a chances indokolnak, a league ${ORD(n + 1 - rk)}worst show.` : `Kapott goal: ${me.keep >= 0 ? nf(me.keep, 1) + " goal fewer a vartnal" : nf(-me.keep, 1) + " goal more a vartnal"} (${rk}. a in the league).`); }
  // game state
  { const rk = rankIn(TM, "dropped", t); if (me.dropped > 0) add(rk, n, rk <= 3 ? `lead ${me.dropped} pontot hullajtott el, ${rk === 1 ? "a most a in the league" : `a league ${rk}. most`}.` : `lead ${me.dropped} pontot hullajtott el (${rk}. now a in the league).`); }
  { const rk = rankIn(TM, "won", t); if (me.won > 0) add(rk, n, rk <= 3 ? `behind ${me.won} pontot hozott vissza, ${rk === 1 ? "a most a in the league" : `a league ${rk}. most`}: not adja up.` : `behind ${me.won} pontot hozott vissza (${rk}. now a in the league).`); }
  { const rk = rankIn(TM, "lead", t); add(rk, n, rk <= 3 ? `A play ${nf(me.lead, 0)}%-aban vezetett, a league ${ORD(rk)}most.` : rk >= n - 2 ? `A play only ${nf(me.lead, 0)}%-aban vezetett, a league ${ORD(n + 1 - rk)}legkevesebbet.` : `A play ${nf(me.lead, 0)}%-aban vezetett (${rk}. a in the league).`); }
  // shot quality
  { const rk = rankIn(TM, "xgs", t); add(rk, n, rk <= 3 ? `good pick a shot: ${nf(me.xgs, 2)} xG shot, a league ${ORD(rk)}best chance.` : rk >= n - 2 ? `Sokat scores poor chance: only ${nf(me.xgs, 2)} xG shot, a league ${ORD(n + 1 - rk)}most chance.` : `shot ${nf(me.xgs, 2)} xG (${rk}. a in the league).`); }
  // pressing
  { const rk = rankIn(TM, "ppda", t, true), ht = rankIn(TM, "hto", t); if (rk) add(rk, n, rk <= 3 && ht >= 12 ? `A league ${ORD(rk)}most press (PPDA), and yet only ${ht}. a magas ball: a press not fizetodik out.` : rk <= 3 ? `A league ${ORD(rk)}most press (PPDA), and a magas ball is ${ht}.` : rk >= n - 2 ? `A league ${ORD(n + 1 - rk)}pass csapata a press: deep var.` : `press a league kozepen is (PPDA: ${rk}.).`); }
  // schedule ahead and behind
  { const nx = TEAMS.map(z => { const fx = FX.filter(f => f[0] > S.gw && (f[1] === z || f[2] === z)).slice(0, 5); return { t: z, v: fx.reduce((a, f) => a + predFor(z, f[1] === z ? f[2] : f[1], f[1] === z, R).xp, 0) }; });
    const rk = nx.slice().sort((a, b) => b.v - a.v).findIndex(z => z.t === t) + 1; if (nx.find(z => z.t === t).v > 0) add(rk, n, rk <= 3 ? `A next 5 meccse a league ${ORD(rk)}easy schedule: here johetnek a pontok.` : rk >= n - 2 ? `A next 5 meccse a league ${ORD(n + 1 - rk)}legnehezebb schedule.` : `A next 5 match hard average (${rk}. easy).`); }
  { const rk = rankIn(TM, "sosA", t, true); add(rk, n, rk >= n - 2 ? `Eddig a league ${ORD(n + 1 - rk)}legnehezebb schedule kapta, this is deserved figyelembe venni a point.` : rk <= 3 ? `Eddig a league ${ORD(rk)}easy schedule kapta, this szepiti a pontjait.` : `Eddigi schedule average (${rk}. easy).`); }
  const out = F.sort((a, b) => a.s - b.s).filter((f, i) => f.s <= 3 || (i < 3 && f.s <= 6)).slice(0, 4).map(f => f.txt);
  const ms = teamMatches(t, S.gw).map(m => persp(m, t)); if (ms.length >= 6) { const a = ms.slice(-3), b = ms.slice(0, -3); const da = a.reduce((q, z) => q + z.xg - z.xga, 0) / a.length, db = b.reduce((q, z) => q + z.xg - z.xga, 0) / b.length; out.push(da - db > 0.5 ? `Javul: the last 3 meccsen ${sg(da, 1)} xG-gap per match, korabban ${sg(db, 1)}.` : da - db < -0.5 ? `Romlik: the last 3 meccsen ${sg(da, 1)} xG-gap per match, korabban ${sg(db, 1)}.` : `Stabil form: per match ${sg(da, 1)} xG-gap the last 3 meccsen.`); }
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
    g += `<text x="${L - 8}" y="${y + 12}" text-anchor="end" style="font-size:10px;fill:var(--ink)">${m.gw}. ${esc(nw ? short(z.o) : z.o)} ${z.home ? "(H)" : "(V)"} <tspan style="font-weight:700;fill:${z.p === 3 ? "var(--good)" : z.p === 1 ? "var(--muted)" : "var(--bad)"}">${z.gf}–${z.ga}</tspan></text>`;
    for (const [a, b, st] of seg) g += `<rect x="${px(a).toFixed(1)}" y="${y + 3}" width="${Math.max(0, px(b) - px(a)).toFixed(1)}" height="12" fill="${COL[st]}" opacity="${st === 0 ? 1 : .8}"><title>${a}–${b}. minutes: ${st > 0 ? "leading" : st < 0 ? "trailing" : "draw scoreline"}</title></rect>`;
    for (const [we, mine] of goals) g += `<circle cx="${px(we).toFixed(1)}" cy="${y + 9}" r="3.4" fill="${mine ? "var(--gold)" : "var(--bg)"}" stroke="${mine ? "var(--bg)" : "var(--ink)"}" stroke-width="1.2"><title>${we}. minutes: ${mine ? "lott goal" : "conceded goal"}</title></circle>`; });
  g += `<line x1="${px(45)}" x2="${px(45)}" y1="${T}" y2="${H - 14}" stroke="#0a0d18" stroke-width="1.5" opacity=".7"/>`;
  const lv = Math.max(0, 100 - gs.lead - gs.trail);
  return `<div class="panel"><p class="kicker">play match meccsre</p>
    <div class="gsbar"><i style="width:${gs.lead}%;background:var(--good)">${gs.lead > 9 ? nf(gs.lead, 0) + "%" : ""}</i><i style="width:${lv}%;background:#3a4266">${lv > 9 ? nf(lv, 0) + "%" : ""}</i><i style="width:${gs.trail}%;background:var(--bad)">${gs.trail > 9 ? nf(gs.trail, 0) + "%" : ""}</i></div>
    <div class="lgd"><span><i style="background:var(--good)"></i>leading</span><span><i style="background:#3a4266"></i>draw scoreline</span><span><i style="background:var(--bad)"></i>trailing</span><span><i style="background:var(--gold)"></i>lott goal</span><span><i style="background:var(--bg);box-shadow:inset 0 0 0 1.5px var(--ink)"></i>conceded goal</span></div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="play per match">${g}</svg>
    <p class="note">lead elhullajtott point: <b style="color:var(--ink)">${gs.dropped}</b> · behind visszahozott point: <b style="color:var(--ink)">${gs.won}</b> · they szerezte the first goals: <b style="color:var(--ink)">${gs.first == null ? "–" : nf(gs.first, 0) + "%"}</b> · goal 75' after: <b style="color:var(--ink)">${gs.late}</b>, conceded: <b style="color:var(--ink)">${gs.lateA}</b>.</p></div>`;
}
function nextFive(t) {
  const R = ratings(S.gw), fx = FX.filter(f => f[0] > S.gw && (f[1] === t || f[2] === t)).slice(0, 5); if (!fx.length) return "";
  return `<div class="panel"><p class="kicker">Next meccsek · expected point a modell according to</p><div class="nf">${fx.map(f => { const home = f[1] === t, o = home ? f[2] : f[1], { p, xp } = predFor(t, o, home, R), r = restAround(t, f[5]);
    return `<div class="nfc" style="border-color:${heatRGB((xp - .7) / 1.4, .8)}"><span class="kicker">${f[0]}. · ${esc(DAY.format(new Date(f[3])))}</span><b>${esc(nm(o))}</b><span class="note">${home ? "home" : "away"} · ${pc(home ? p.pw : p.pl)} win</span><span class="mono" style="font-size:12px">${nf(xp, 2)} point${r.before != null && r.before < TH.short_rest_days ? ` · <span class="${restCls(r.before)}">${nf(r.before, 1)} day rest</span>` : ""}</span></div>`; }).join("")}</div></div>`;
}
function viewCsapat() {
  const rows = table(S.gw); const r = rows.find(x => x.t === S.team) || rows[0];
  const sh = shotsUpTo(S.gw); const forS = sh.filter(s => s[I.team] === r.t), agS = sh.filter(s => s[I.opp] === r.t);
  const g = (a) => a.filter(s => s[I.res] === "G").length, x = (a) => a.reduce((q, s) => q + s[I.xg], 0);
  const o = OP[r.t] || {};
  const split = (arr) => ["op", "sp", "pen"].map(k => { const a = arr.filter(s => s[I.res] !== "O" && grpOf(s[I.sit]) === k); return { k, x: x(a), g: g(a) }; });
  const sf = split(forS), sa = split(agS), mx = Math.max(.1, ...sf.map(z => z.x), ...sa.map(z => z.x));
  const LBL = { op: "open play", sp: "set piece", pen: "penalties" };
  const bars = (arr, col) => arr.map(z => `<div class="row" style="gap:6px;flex-wrap:nowrap"><span style="width:84px;flex:none;font-size:12.5px;color:var(--muted)">${LBL[z.k]}</span><span style="flex:1;height:10px;background:var(--panel2);border-radius:3px;overflow:hidden"><i style="display:block;height:100%;width:${z.x / mx * 100}%;background:${col}"></i></span><span class="mono" style="font-size:11px;flex:none;width:88px;text-align:right;white-space:nowrap">${nf(z.x, 1)} xG · ${z.g} goal</span></div>`).join("");
  const home = table(S.gw, "home").find(z => z.t === r.t), away = table(S.gw, "away").find(z => z.t === r.t);
  return `<section class="sec"><div class="sechead"><h2>${esc(r.t)}</h2><select class="sel" id="tsel" aria-label="Club">${TEAMS.map(t => `<option ${t === r.t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
    <div class="insights" style="grid-template-columns:1fr">${`<div class="ins" style="--c:var(--home)"><span class="n">In short</span><p>A ${r.rank}. helyen stands, a helyzetei from a ${r.xrank}. lenne (${sg(r.luck, 1)} point). A Power-rangsorban ${ratings(S.gw).rank[r.t]}. (attack ${ratings(S.gw).ar[r.t]}., defence ${ratings(S.gw).dr[r.t]}.). ${trendSentences(r.t, r).join(" ")}</p></div>`}</div>
    ${nextFive(r.t)}
    <div class="xray"><div class="panel"><p class="kicker">own shots · ${forS.length} db</p>${halfPitch(forS, "var(--home)", "own shots")}<p class="note">${g(forS)} goal ${nf(x(forS), 1)} xG-bol: ${g(forS) > x(forS) + 1 ? "a helyzetei over scores." : g(forS) < x(forS) - 1 ? "a helyzetei under scores." : "roughly a helyzetei according to scores."}</p></div>
    <div class="panel"><p class="kicker">Kapott shots · ${agS.length} db</p>${halfPitch(agS, "var(--away)", "Kapott shots")}<p class="note">${g(agS)} conceded goal ${nf(x(agS), 1)} xG-bol: ${g(agS) < x(agS) - 1 ? "more defend, mint expected." : g(agS) > x(agS) + 1 ? "more goals concedes, mint amennyit a chances indokolnak." : "annyit concedes, amennyit a chances ernek."}</p></div>
    <div class="panel"><p class="kicker">Profil · Opta season</p><div class="kv">${OPK.map(([k, l, d, u, low]) => { const rk = orank(k, o[k], low); return `<div><b>${nf(o[k], d)}${u && o[k] != null ? `<small style="font-size:13px"> ${u}</small>` : ""}</b><span>${l}</span>${rk ? `<i>${rk}. a in the league</i>` : ""}</div>`; }).join("")}</div></div></div>
    <div class="two wide"><div class="panel"><p class="kicker">form: created and conceded xG (3 meccses average)</p>${rolling(r.t)}<div class="lgd"><span><i style="background:var(--home)"></i>created</span><span><i style="background:var(--away)"></i>conceded</span><span><i style="background:var(--good)"></i>win</span><span><i style="background:#6b7394"></i>draw</span><span><i style="background:var(--bad)"></i>loss</span></div></div>
    <div class="panel"><p class="kicker">Where from jonnek a chances</p>${bars(sf, "var(--home)")}<p class="kicker" style="margin-top:8px">Where from concedes helyzeteket</p>${bars(sa, "var(--away)")}
      <p class="kicker" style="margin-top:8px">Otthon and away</p><div class="kv"><div><b>${home.pts} / ${nf(home.xpts, 1)}</b><span>home point / deserved (${home.P} match)</span></div><div><b>${away.pts} / ${nf(away.xpts, 1)}</b><span>away point / deserved (${away.P} match)</span></div></div></div></div>
    ${cleanMatches(r.t)}${gameStateViz(r.t)}</section>`;
}
const STRIP = [["xG/90", (p) => p.xg / p.min * 90, 2], ["xA/90", (p) => p.xa / p.min * 90, 2], ["Goal − xG", (p) => p.g - p.xg, 2], ["Chance/90", (p) => (p.cc || 0) / p.min * 90, 2], ["Leading/90", (p) => (p.pc || 0) / p.min * 90, 2], ["through ball/90", (p) => (p.tb || 0) / p.min * 90, 2], ["win the ball/90", (p) => (p.rec || 0) / p.min * 90, 2], ["Tackle/90", (p) => (p.tck || 0) / p.min * 90, 2]];
function percentiles(p) {
  const peers = PL.filter(q => q.pos === p.pos && q.min >= TH.min_minutes_default);
  return STRIP.map(([l, f, d]) => { const vals = peers.map(f).sort((a, b) => a - b); const v = f(p); const pr = vals.length > 1 ? vals.filter(z => z < v).length / (vals.length - 1) : .5; return { l, v, d, pr: Math.max(0, Math.min(1, pr)) }; });
}
function method() {
  const runs = C.simulation.runs.toLocaleString("en-GB");
  return `<section class="sec"><details class="panel"><summary class="kicker" style="cursor:pointer">How this is calculated</summary><div class="note" style="max-width:86ch;display:flex;flex-direction:column;gap:8px;margin-top:10px">
    <p><b style="color:var(--ink)">xG</b> is the chance a shot becomes a goal, from where and how it was taken (Understat). A 0.10 shot scores about once in ten.</p>
    <p><b style="color:var(--ink)">The chance bar and points deserved.</b> From the shots in a match we calculate the chance of a home win, a draw and an away win. Points deserved are 3 times the win chance plus the draw chance. A robbery is a win the shots gave less than a ${Math.round(TH.robbery_win_probability * 100)}% chance.</p>
    <p><b style="color:var(--ink)">Power and the forecast.</b> Each club has an attack rating and a defence rating, fit to chances created and conceded (${Math.round(RTG.xg_blend * 100)}% xG, ${Math.round((1 - RTG.xg_blend) * 100)}% actual goals), adjusted for the opponent and for home advantage. Recent matches count for more. Early in the season the ratings lean on a pre-season strength we calculate from earlier Premier League and Championship results, and that anchor fades as this season's matches pile up. Match chances come from the two expected-goal figures (Poisson, with a Dixon–Coles adjustment that adds a few draws). The rest of the season is played ${runs} times.</p>
    <p><b style="color:var(--ink)">Adjusted xG</b> divides a match's xG by what an average side would create against that opponent, at that ground. Opponent strength and home advantage come from this season's xG only. Early on, those ratings are pulled gently toward the pre-season figure so one match cannot swing them.</p>
    <p><b style="color:var(--ink)">True strength</b> turns adjusted xG into the points that performance would be worth against an average opponent on a neutral pitch. Schedule and venue are the gap between that and the same sum from raw xG. Finishing and goalkeeping turn the gap between goals and xG into points. Whatever is left is other luck, so the pieces add up to the real points total.</p>
    <p><b style="color:var(--ink)">Win probability, minute by minute,</b> starts from the strength model before the round, then updates it for the score and the time left. Goals still to come follow a Poisson distribution. It does not see red cards or substitutions. The excitement index adds up how much the home and away win chances move.</p>
    <p><b style="color:var(--ink)">Schedule and rest.</b> The difficulty of a future match is the points the model expects from it. Rest is the time since a club's previous competitive match, including Champions League, Europa League and Conference League games loaded automatically. Domestic cups are not included, so a League Cup or FA Cup week can look quieter than it was. ${esc(D.europe_note || "")}</p>
    <p><b style="color:var(--ink)">Game state</b> is read from the goal times: how long a side led or trailed, points dropped from a winning position, points rescued from a losing one.</p>
    <p><b style="color:var(--ink)">Opta numbers.</b> PPDA is how many passes the opponent is allowed before a defensive action (lower means a more aggressive press). High turnovers are balls won within 40 metres of the opponent's goal. There are also directness and build-up counts.</p>
    <p>Penalty xG used for non-penalty figures is the average of this season's ${DER.pen_n} penalties (${nf(DER.pen_xg, 2)}), not a fixed number. The league goal rate behind the ratings is ${nf(DER.league_gpg, 2)} per team per match, measured from recent Premier League seasons.</p></div></details></section>`;
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
window.__plr = { S, render, ratings, predict };
})();
