(() => {
/* Fair odds for the other leagues. Data: data/leagues.json, built by plx/leagues.py. */
const D = JSON.parse(document.getElementById("data").textContent);
const app = document.getElementById("app");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const odd = (p) => (p > 0 ? (1 / p).toFixed(2) : "–");
const pc = (p) => Math.round(p * 100) + "%";
const S = { lg: 0, r: null };
try { const s = JSON.parse(localStorage.getItem("plx-odds") || "{}"); if (Number.isInteger(s.lg) && s.lg < D.leagues.length) S.lg = s.lg; } catch (e) { /* storage blocked */ }
function save() { try { localStorage.setItem("plx-odds", JSON.stringify({ lg: S.lg })); } catch (e) { /* storage blocked */ } }
function day(dt) { const d = new Date(dt.replace(" ", "T") + "Z"); return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" }); }
function span(x) { const ds = x.matches.map((m) => m.dt).sort(), a = day(ds[0]), b = day(ds[ds.length - 1]); return a === b ? a : `${a} – ${b}`; }
function render() {
  const L = D.leagues[S.lg];
  const rounds = L.rounds.map((x) => x.r);
  if (S.r == null || !rounds.includes(S.r)) S.r = L.next_round || rounds[rounds.length - 1];
  const R = L.rounds.find((x) => x.r === S.r);
  const done = R.matches.filter((m) => m.hs != null);
  const fav = done.filter((m) => { const p = [m.pw, m.pd, m.pl], i = p.indexOf(Math.max(...p)), res = m.hs > m.as ? 0 : m.hs === m.as ? 1 : 2; return i === res; }).length;
  app.innerHTML = `
  <section class="sec" style="padding-top:18px"><span class="kicker">PL X-ray · ${esc(D.season)}</span>
    <h2 style="font-family:var(--f-display);font-weight:900;font-size:clamp(34px,8vw,64px);line-height:.95;text-transform:uppercase;margin-top:6px">Fair odds</h2>
    <p class="note" style="margin-top:8px">The same model as the Premier League forecast. Each round is predicted only from the rounds before it, using match xG and goals (50/50), with recent matches counting for more. Early rounds lean on pre-season strength. No home advantage is used. Fair odds are 1 ÷ chance, with no bookmaker margin. <a href="index.html" style="color:var(--ink)">Back to the Premier League</a></p></section>
  <section class="sec"><div class="tabs" role="tablist">${D.leagues.map((l, i) => `<button role="tab" aria-selected="${i === S.lg}" data-lg="${i}">${esc(l.label)}</button>`).join("")}</div>
    <div class="row" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px"><span class="kicker">Matches</span>
      <select id="rd" style="background:var(--panel);border:1px solid var(--faint);border-radius:8px;padding:5px 8px">${L.rounds.map((x) => `<option value="${x.r}" ${x.r === S.r ? "selected" : ""}>${span(x)}${x.r === L.next_round ? " (next)" : ""}</option>`).join("")}</select>
      ${done.length ? `<span class="note">Favourite won ${fav} of ${done.length}</span>` : ""}</div>
    <div class="panel" style="margin-top:12px"><div class="tw"><table class="probs"><thead><tr><th class="l">Match</th><th>1</th><th>X</th><th>2</th><th>Expected goals</th><th>Over 2.5</th><th>Result</th></tr></thead><tbody>
    ${R.matches.map((m) => `<tr><td class="l"><span class="note" style="display:block">${day(m.dt)}</span><b>${esc(m.h)}</b> – <b>${esc(m.a)}</b></td><td class="mono">${odd(m.pw)}</td><td class="mono">${odd(m.pd)}</td><td class="mono">${odd(m.pl)}</td><td class="mono">${m.lh.toFixed(2)}–${m.la.toFixed(2)}</td><td class="mono">${pc(m.o25)}</td><td class="mono">${m.hs != null ? m.hs + "–" + m.as : "–"}</td></tr>`).join("")}
    </tbody></table></div></div>
    ${L.postponed && L.postponed.length ? `<p class="note" style="margin-top:10px">Postponed, waiting for a new date: ${L.postponed.map((m) => esc(m.h) + " – " + esc(m.a)).join(", ")}.</p>` : ""}
    <p class="note" style="margin-top:10px">Matches are grouped by kickoff: a group closes when a club would play twice in it, or after a gap of more than two and a half days. A group can differ from the official matchday. Data: match xG from Understat, refreshed weekly. The model does not know about injuries, suspensions or a change of manager.</p></section>`;
}
app.addEventListener("click", (e) => { const b = e.target.closest("[data-lg]"); if (!b) return; S.lg = +b.dataset.lg; S.r = null; save(); render(); });
app.addEventListener("change", (e) => { if (e.target.id === "rd") { S.r = +e.target.value; render(); } });
render();
window.__odds = { S, render };
})();
