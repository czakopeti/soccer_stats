(() => {
/* Home value: our odds with home advantage against the bookmakers' average. Data: built by plx/value.py. */
const D = JSON.parse(document.getElementById("data").textContent);
const app = document.getElementById("app");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const o2 = (x) => (x ? Number(x).toFixed(2) : "–");
const odd = (p) => (p > 0 ? (1 / p).toFixed(2) : "–");
const pct = (x, d = 0) => (x == null ? "–" : (x > 0 ? "+" : "") + (x * 100).toFixed(d) + "%");
const sgn = (x) => (x > 0 ? "+" : "") + Number(x).toFixed(2);
const S = { lg: 0 };
try { const s = JSON.parse(localStorage.getItem("plx-value") || "{}"); if (Number.isInteger(s.lg) && s.lg < D.leagues.length) S.lg = s.lg; } catch (e) { /* storage blocked */ }
function save() { try { localStorage.setItem("plx-value", JSON.stringify({ lg: S.lg })); } catch (e) { /* storage blocked */ } }
function day(dt) { const d = new Date(dt.slice(0, 10) + "T12:00:00Z"); return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }); }
const since = D.tracking_from;
const won = (r) => r.hs > r.as;
const profit = (r) => (won(r) ? r.bk[0] - 1 : -1);
function tile(label, s, note) {
  return `<div class="panel" style="padding:14px 16px;flex:1 1 260px"><span class="kicker">${esc(label)}</span>
    <div style="font-family:var(--f-display);font-weight:900;font-size:34px;line-height:1.1;margin-top:6px">${s.n ? sgn(s.profit) : "–"}</div>
    <p class="note" style="margin-top:4px">${s.n ? `${s.n} bets, ${s.won} won · return ${pct(s.roi, 1)} · price move to kickoff ${pct(s.clv, 1)}` : "No bets yet."}</p>
    <p class="note" style="margin-top:4px">${note}</p></div>`;
}
function render() {
  const picks = D.leagues.flatMap((L) => L.upcoming.filter((m) => m.pick).map((m) => ({ ...m, lg: L.label }))).sort((a, b) => (a.dt < b.dt ? -1 : 1));
  const live = D.leagues.flatMap((L) => L.history.filter((m) => m.pick && m.dt.slice(0, 10) >= since).map((m) => ({ ...m, lg: L.label }))).sort((a, b) => (a.dt < b.dt ? 1 : -1));
  const L = D.leagues[S.lg];
  const hist = L.history.filter((m) => m.pick).sort((a, b) => (a.dt < b.dt ? 1 : -1));
  app.innerHTML = `
  <section class="sec" style="padding-top:18px"><span class="kicker">PL X-ray · ${esc(D.season)}</span>
    <h2 style="font-family:var(--f-display);font-weight:900;font-size:clamp(34px,8vw,64px);line-height:.95;text-transform:uppercase;margin-top:6px">Home value</h2>
    <p class="note" style="margin-top:8px">The same xG model as the fair-odds pages, with home advantage put back in so it can be set against bookmaker prices. Home advantage comes from each league's previous three seasons. <b>The rule:</b> our home side has the higher expected goals, and the bookmakers' average home price is above our fair home odds. Bet the home side, single bets only.</p>
    <p class="note" style="margin-top:6px">This is a test, not a proven edge. The rule was found on this season's matches before ${esc(day(since))}, so those flatter it. Only bets from then on count as a real test. Prices are the average of several bookmakers, collected one to three days before kickoff. Your bookmaker may pay less: only bet when your price is above our fair home odds. <a href="index.html" style="color:var(--ink)">Premier League</a> · <a href="odds.html" style="color:var(--ink)">Fair odds</a></p></section>
  <section class="sec"><h3 class="kicker">Next round's picks</h3>
    ${picks.length ? `<div class="panel" style="margin-top:10px"><div class="tw"><table class="probs"><thead><tr><th class="l">Match</th><th>Expected goals</th><th>Our home odds</th><th>Bookmaker average</th><th>Edge</th></tr></thead><tbody>
    ${picks.map((m) => `<tr><td class="l"><span class="note" style="display:block">${esc(m.lg)} · ${day(m.dt)}</span><b>${esc(m.h)}</b> – ${esc(m.a)}</td><td class="mono">${m.lh.toFixed(2)}–${m.la.toFixed(2)}</td><td class="mono">${odd(m.p[0])}</td><td class="mono">${o2(m.bk[0])}</td><td class="mono">${pct(m.edge, 1)}</td></tr>`).join("")}
    </tbody></table></div></div>` : `<p class="note" style="margin-top:8px">${D.leagues.some((x) => x.upcoming.some((m) => m.bk)) ? "No match in the next round fits the rule." : "Bookmaker prices for the next round are not out yet. They usually appear on Tuesday for midweek games and on Friday for the weekend."}</p>`}
    <p class="note" style="margin-top:8px">Edge is our chance × the bookmaker price − 1: how much the bet returns per unit if our chance is right.</p></section>
  <section class="sec"><h3 class="kicker">Track record</h3>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px">
      ${tile(`From ${day(since)}: the real test`, D.live_summary, "Profit in units, one unit a bet, at the bookmaker average.")}
      ${tile("Whole season so far", D.season_summary, "Includes the matches the rule was found on.")}
    </div>
    <p class="note" style="margin-top:8px">Price move to kickoff: how much the price on our picks dropped by kickoff, on average. A positive number means the market moved towards our pick, a sign the edge is real even when results swing.</p>
    ${live.length ? `<div class="panel" style="margin-top:12px"><div class="tw"><table class="probs"><thead><tr><th class="l">Bet since ${esc(day(since))}</th><th>Price</th><th>At kickoff</th><th>Result</th><th>Profit</th></tr></thead><tbody>
    ${live.map((m) => `<tr><td class="l"><span class="note" style="display:block">${esc(m.lg)} · ${day(m.dt)}</span><b>${esc(m.h)}</b> – ${esc(m.a)}</td><td class="mono">${o2(m.bk[0])}</td><td class="mono">${m.cl ? o2(m.cl[0]) : "–"}</td><td class="mono">${m.hs}–${m.as}</td><td class="mono" style="color:var(${won(m) ? "--good" : "--bad"})">${sgn(profit(m))}</td></tr>`).join("")}
    </tbody></table></div></div>` : ""}</section>
  <section class="sec"><div class="tabs" role="tablist">${D.leagues.map((x, i) => `<button role="tab" aria-selected="${i === S.lg}" data-lg="${i}">${esc(x.label)}</button>`).join("")}</div>
    ${L.error ? `<p class="note" style="margin-top:10px">${esc(L.label)} is missing this time: ${esc(L.error)}</p>` : `
    <p class="note" style="margin-top:10px">Home advantage ${pct(Math.exp(L.h_adv) - 1)} goals for the home side, ${pct(Math.exp(-L.h_adv) - 1)} for the away side. Season so far: ${L.summary.n} bets, ${L.summary.won} won, ${L.summary.n ? sgn(L.summary.profit) : "0"} units.</p>
    <div class="panel" style="margin-top:12px"><div class="tw"><table class="probs"><thead><tr><th class="l">Next round</th><th>Expected goals</th><th>Our 1 · X · 2</th><th>Bookmakers 1 · X · 2</th><th>Pick</th></tr></thead><tbody>
    ${L.upcoming.map((m) => `<tr><td class="l"><span class="note" style="display:block">${day(m.dt)}</span><b>${esc(m.h)}</b> – ${esc(m.a)}</td><td class="mono">${m.lh.toFixed(2)}–${m.la.toFixed(2)}</td><td class="mono">${m.p.map(odd).join(" · ")}</td><td class="mono">${m.bk ? m.bk.map(o2).join(" · ") : "–"}</td><td class="mono">${m.pick ? "Home" : ""}</td></tr>`).join("") || `<tr><td class="l" colspan="5">No upcoming matches.</td></tr>`}
    </tbody></table></div></div>
    ${hist.length ? `<div class="panel" style="margin-top:12px"><div class="tw"><table class="probs"><thead><tr><th class="l">Earlier picks</th><th>Our home odds</th><th>Price</th><th>At kickoff</th><th>Result</th><th>Profit</th></tr></thead><tbody>
    ${hist.map((m) => `<tr><td class="l"><span class="note" style="display:block">${day(m.dt)}${m.dt.slice(0, 10) >= since ? " · test" : ""}</span><b>${esc(m.h)}</b> – ${esc(m.a)}</td><td class="mono">${odd(m.p[0])}</td><td class="mono">${o2(m.bk[0])}</td><td class="mono">${m.cl ? o2(m.cl[0]) : "–"}</td><td class="mono">${m.hs}–${m.as}</td><td class="mono" style="color:var(${won(m) ? "--good" : "--bad"})">${sgn(profit(m))}</td></tr>`).join("")}
    </tbody></table></div></div>` : ""}`}
    <p class="note" style="margin-top:10px">Prices: football-data.co.uk. Every past match uses the prediction made before its round. The model does not know about injuries, suspensions or a change of manager. Updated ${esc(new Date(D.updated).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}.</p></section>`;
}
app.addEventListener("click", (e) => { const b = e.target.closest("[data-lg]"); if (!b) return; S.lg = +b.dataset.lg; save(); render(); });
render();
window.__value = { S, render };
})();
