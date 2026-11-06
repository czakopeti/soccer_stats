(() => {
/* Value picks: the bookmaker average adjusted by recent shots and form. Data: built by plx/value.py. */
const D = JSON.parse(document.getElementById("data").textContent);
const app = document.getElementById("app");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const o2 = (x) => (x ? Number(x).toFixed(2) : "–");
const fair = (p) => (p > 0 ? (1 / p).toFixed(2) : "–");
const pct = (x, d = 1) => (x == null ? "–" : (x > 0 ? "+" : "") + (x * 100).toFixed(d) + "%");
const sgn = (x) => (x > 0 ? "+" : "") + Number(x).toFixed(2);
const S = { only: false };
try { const s = JSON.parse(localStorage.getItem("plx-value2") || "{}"); S.only = !!s.only; } catch (e) { /* storage blocked */ }
const save = () => { try { localStorage.setItem("plx-value2", JSON.stringify({ only: S.only })); } catch (e) { /* storage blocked */ } };
const when = (t) => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dayOf = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const R = D.rules;
const ruleText = {
  A: `edge at least ${Math.round(R.A.min_edge * 100)}% and an average price of ${o2(R.A.min_odds)}–${o2(R.A.max_odds)}. Measured at the average price.`,
  B: `edge at least ${Math.round(R.B.min_edge * 100)}%, at any price. Measured at the best price on offer.`,
};
const mark = (m) => (m.marks || []).map((k) => `<span style="display:inline-block;padding:1px 7px;border-radius:6px;background:var(--gold);color:var(--bg);font-weight:700;margin-left:4px">${k.rule} · ${k.side}</span>`).join("");
function line(s) { return s.n ? `${s.n} bets, ${s.won} won, <b>${sgn(s.profit)}</b> units (${pct(s.roi)})` : "no bets yet"; }
function render() {
  const up = D.upcoming.filter((m) => !S.only || (m.marks && m.marks.length));
  const nMarked = D.upcoming.filter((m) => m.marks && m.marks.length).length;
  let run = 0;
  const hist = [...D.history].reverse().map((h) => { run += h.profit; return { ...h, run }; }).reverse();
  app.innerHTML = `
  <section class="sec" style="padding-top:18px"><span class="kicker">PL X-ray · ${esc(D.season)}</span>
    <h2 style="font-family:var(--f-display);font-weight:900;font-size:clamp(34px,8vw,64px);line-height:.95;text-transform:uppercase;margin-top:6px">Value picks</h2>
    <p class="note" style="margin-top:8px">The bookmakers price recent results a little too strongly and recent shots a little too weakly. We start from their average price, with the margin taken out, and shift it by each side's last eight league matches: shots on target, shots, goals, and points from the last five. Edge is our chance × the average price − 1. Only home and away wins are marked. <a href="index.html" style="color:var(--ink)">Premier League</a> · <a href="odds.html" style="color:var(--ink)">Fair odds</a></p></section>
  <section class="sec"><h3 class="kicker">The two rules</h3>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
    ${["A", "B"].map((k) => `<div class="panel" style="padding:14px 16px;flex:1 1 280px"><span style="align-self:flex-start;display:inline-block;padding:1px 9px;border-radius:6px;background:var(--gold);color:var(--bg);font-weight:800">${k}</span>
      <p class="note" style="margin-top:8px">${ruleText[k]}</p>
      <p class="note" style="margin-top:6px">Ten earlier seasons the model never saw: ${R[k].checked.bets} bets, ${sgn(R[k].checked.units)} units (${pct(R[k].checked.return)}), up in ${esc(R[k].checked.seasons_up)} seasons.</p>
      <p class="note" style="margin-top:6px">From ${dayOf(D.tracking_from)}, the real test: ${line(D.summary[k].test)}.</p>
      <p class="note" style="margin-top:6px">This season so far: ${line(D.summary[k].season)}.</p></div>`).join("")}
    </div>
    <p class="note">${esc(D.model.trained_on)} ${esc(D.model.checked_on)} A season of a few dozen bets can easily end in the red even if the rule works; judge it over hundreds. Your bookmaker may pay less than the average: a pick only holds if your price is at least our fair odds × (1 + the rule's edge).</p></section>
  <section class="sec"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><h3 class="kicker" style="margin:0">Next matches</h3>
    <span class="note">${nMarked} marked of ${D.upcoming.length}</span>
    <label class="note" style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" id="only" ${S.only ? "checked" : ""}> Only marked</label></div>
    <div class="panel"><div class="tw"><table class="probs"><thead><tr><th class="l">Match</th><th>Average 1 · X · 2</th><th>Our odds 1 · X · 2</th><th>Edge 1 / 2</th><th>Mark</th></tr></thead><tbody>
    ${up.map((m) => `<tr${m.marks && m.marks.length ? ' style="background:var(--panel2)"' : ""}><td class="l"><span class="note" style="display:block">${esc(m.lg)} · ${esc(when(m.t))}</span><b>${esc(m.h)}</b> – <b>${esc(m.a)}</b></td>
      <td class="mono">${m.avg ? m.avg.map(o2).join(" · ") : "–"}</td><td class="mono">${m.p ? m.p.map(fair).join(" · ") : "–"}</td>
      <td class="mono">${m.edge ? pct(m.edge[0]) + " / " + pct(m.edge[1]) : "–"}</td><td class="mono" style="white-space:nowrap">${mark(m)}</td></tr>`).join("") || `<tr><td class="l" colspan="5">${D.upcoming.length ? "No match is marked." : "Prices for the next matches are not out yet. They usually appear on Tuesday for midweek games and on Friday for the weekend."}</td></tr>`}
    </tbody></table></div></div>
    <p class="note">Mark: the rule and the side, 1 = home win, 2 = away win. "–" in our odds: one side has played fewer than five league matches this season.</p></section>
  <section class="sec"><h3 class="kicker">Every pick so far</h3>
    ${hist.length ? `<div class="panel"><div class="tw"><table class="probs"><thead><tr><th class="l">Match</th><th>Pick</th><th>Our odds</th><th>Price</th><th>Result</th><th>Profit</th><th>Running</th></tr></thead><tbody>
    ${hist.map((h) => `<tr><td class="l"><span class="note" style="display:block">${esc(h.lg)} · ${esc(when(h.t))}${h.t.slice(0, 10) >= D.tracking_from ? " · test" : ""}</span><b>${esc(h.h)}</b> – <b>${esc(h.a)}</b></td>
      <td class="mono">${h.rule} · ${h.side}</td><td class="mono">${o2(h.fair)}</td><td class="mono">${o2(h.price)}</td><td class="mono">${h.hs}–${h.as}</td>
      <td class="mono" style="color:var(${h.won ? "--good" : "--bad"})">${sgn(h.profit)}</td><td class="mono">${sgn(h.run)}</td></tr>`).join("")}
    </tbody></table></div></div>` : `<p class="note">No picks yet this season.</p>`}
    <p class="note">One unit a bet. Rule A is paid at the average price, rule B at the best price, both as collected one to three days before kickoff. "Running" adds up both rules from the start of the season. Prices and results: football-data.co.uk. Updated ${esc(new Date(D.updated).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}.${D.problems && D.problems.length ? ` Problems on this update: ${D.problems.map(esc).join("; ")}.` : ""}</p></section>`;
}
app.addEventListener("change", (e) => { if (e.target.id === "only") { S.only = e.target.checked; save(); render(); } });
render();
window.__value = { S, render };
})();
