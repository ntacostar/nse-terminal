/* Smallcap & Microcap Terminal — front end. Reads data/*.json written by pipeline/update.py. */
'use strict';
let S = [], MK = {}, DL = [], OWN = {}, META = {};
const st = { idx: 'S', per: 'r1', view: 'pulse', sel: null, screen: 'mom', dealScope: 'U', dealSide: '', dealCat: '', dealQ: '', ownSort: { k: 'dmf', d: -1 }, ownQ: '' };
const PER = { r1: '1-day', r5: '5-day', r15: '15-day', r1m: '1-month', r3m: '3-month', r6m: '6-month', r1y: '1-year' };
const SCALE = { r1: 6, r5: 12, r15: 20, r1m: 25, r3m: 40, r6m: 60, r1y: 80 };
const PAL = ['#3b82f6', '#f5a524', '#22c55e', '#ef4444', '#a855f7', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6', '#eab308', '#8b5cf6', '#64748b'];
const SECCOL = {};
const POLL_MS = 5 * 60 * 1000;
let nextPoll = Date.now() + POLL_MS;

// ------------------------------------------------------------------ helpers
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 1) => v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(d) + '%';
const fnum = (v, d = 1) => v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
const fpp = v => v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(2) + ' pp';
const cls = v => v == null ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '';
const median = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const mean = a => { const s = a.filter(x => x != null); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : null; };
const fdate = s => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', weekday: 'short' }) : '—';
const uni = () => S.filter(r => st.idx === 'A' || r.i === st.idx);
const uname = () => st.idx === 'S' ? 'Smallcap 250' : st.idx === 'M' ? 'Microcap 250' : 'both indices';
const tvSym = s => s.replace(/&/g, '_').replace(/-/g, '_');
const LINKS = s => ({
  tv: 'https://www.tradingview.com/chart/?symbol=NSE%3A' + encodeURIComponent(tvSym(s)),
  nse: 'https://www.nseindia.com/get-quotes/equity?symbol=' + encodeURIComponent(s),
  scr: 'https://www.screener.in/company/' + encodeURIComponent(s) + '/',
  shp: 'https://www.nseindia.com/companies-listing/corporate-filings-shareholding-pattern?symbol=' + encodeURIComponent(s),
});
function heat(v, scale) {
  if (v == null) return '#2a3340';
  const t = Math.max(-1, Math.min(1, v / scale));
  return t >= 0 ? `rgba(22,163,74,${0.15 + 0.8 * t})` : `rgba(220,38,38,${0.15 + 0.8 * -t})`;
}
function toast(msg, ms = 4000) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), ms); }

Chart.defaults.color = '#8b98a9'; Chart.defaults.borderColor = '#233041';
Chart.defaults.font.family = "'Inter', system-ui, sans-serif"; Chart.defaults.font.size = 11;
const charts = {};
function mk(id, cfg) { if (charts[id]) charts[id].destroy(); const el = document.getElementById(id); if (!el) return; charts[id] = new Chart(el, cfg); return charts[id]; }
const pctTick = { callback: v => v + '%' };

// generic sortable table
function table(el, cols, rows, opts = {}) {
  const key = opts.sortKey || el.id;
  table._s = table._s || {};
  const s = table._s[key] || (table._s[key] = { k: opts.sort || null, d: opts.dir || -1 });
  const sorted = rows.slice();
  if (s.k) {
    const col = cols.find(c => c.k === s.k);
    const getv = col && col.v ? col.v : r => r[s.k];
    sorted.sort((a, b) => { const x = getv(a), y = getv(b); if (x == null) return 1; if (y == null) return -1; return typeof x === 'string' ? s.d * x.localeCompare(y) : s.d * (x - y); });
  }
  const lim = opts.limit ? sorted.slice(0, opts.limit) : sorted;
  el.innerHTML = `<table><thead><tr>${cols.map(c => `<th class="${c.l ? 'l' : ''}" data-k="${c.k}">${c.h}${s.k === c.k ? (s.d < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead><tbody>${lim.map(r => `<tr class="${opts.click ? 'click' : ''}" data-s="${esc(opts.click ? opts.click(r) : '')}">${cols.map(c => {
    const v = c.v ? c.v(r) : r[c.k];
    return `<td class="${c.l ? 'l' : ''} ${c.wrap ? 'wrap' : ''} ${c.c ? c.c(v, r) : ''}">${c.f ? c.f(v, r) : esc(v ?? '—')}</td>`;
  }).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="empty">Nothing matches.</td></tr>`}</tbody></table>`;
  el.querySelectorAll('th').forEach(th => th.onclick = () => { const k = th.dataset.k; table._s[key] = { k, d: s.k === k ? -s.d : -1 }; table(el, cols, rows, opts); });
  if (opts.click) el.querySelectorAll('tr.click').forEach(tr => tr.onclick = () => select(tr.dataset.s, true));
}
const stockCell = (v, r) => `<b style="font-family:var(--mono)">${esc(r.sym)}</b><span class="tag ${r.i}">${r.i === 'S' ? 'SC' : 'MC'}</span><div class="mut" style="font-size:11px;max-width:230px;overflow:hidden;text-overflow:ellipsis">${esc(r.n)}</div>`;
const pctF = (v) => fmt(v); const pctC = v => cls(v);

// ------------------------------------------------------------------ data loading + refresh
async function getJSON(name) {
  const r = await fetch(`data/${name}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(name + ' ' + r.status);
  return r.json();
}
async function loadAll(quiet) {
  try {
    const [m, s, mk_, d, o] = await Promise.all([getJSON('meta.json'), getJSON('stocks.json'), getJSON('market.json'), getJSON('deals.json'), getJSON('ownership.json')]);
    const fresh = META.generated && m.generated !== META.generated;
    META = m; S = s; MK = mk_; DL = d; OWN = o;
    [...new Set(S.map(r => r.s))].sort().forEach(x => { if (!SECCOL[x]) SECCOL[x] = PAL[Object.keys(SECCOL).length % PAL.length]; });
    fillSec(); renderStatus(); renderAll(); renderTerm();
    if (st.sel) select(st.sel, false); else { const top = uni().filter(r => r.r1 != null).sort((a, b) => b.r1 - a.r1)[0]; if (top) select(top.sym, false); }
    if (fresh && !quiet) toast(`New data loaded: as of ${fdate(META.asof)}`);
  } catch (e) {
    $('#status').innerHTML = `<span class="stale">Could not load data (${esc(e.message)}). Try Refresh in a minute.</span>`;
  }
}
async function poll() {
  nextPoll = Date.now() + POLL_MS;
  try { const m = await getJSON('meta.json'); if (m.generated !== META.generated) await loadAll(); } catch (e) { /* offline: try again later */ }
}
function renderStatus() {
  const gen = new Date(META.generated);
  const genTxt = gen.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) + ' IST';
  const ageH = (Date.now() - new Date(META.asof + 'T16:00:00+05:30')) / 36e5;
  const day = new Date().getDay();
  const stale = ageH > (day === 1 ? 80 : day === 0 || day === 6 ? 72 : 32);
  $('#status').innerHTML = `Prices as of <b>${fdate(META.asof)}</b> close · updated ${genTxt}${stale ? ' · <span class="stale">older than expected — the last update may have failed</span>' : ''}`;
  const w = META.windows || {};
  $('#foot').innerHTML = `Source: NSE end-of-day files (bhavcopy with delivery data, index closes, participant-wise open interest), NSE bulk and block deal files, NSE provisional FII/DII cash flows and quarterly shareholding-pattern filings (XBRL). Returns are adjusted for splits and bonuses${(META.adjusted || []).length ? ` (${META.adjusted.length} adjustments in the last year)` : ''}; holidays where NSE re-publishes the previous day's file are skipped. Windows: 1D vs ${fdate(w['1D'])}, 5D vs ${fdate(w['5D'])}, 15D vs ${fdate(w['15D'])}, 1M vs ${fdate(w['1M'])}. Shareholding covers ${META.own_count || 0} of ${S.length} stocks; named holders are those above 1% that companies must disclose. Bulk/block deal history builds up from the day this terminal started collecting (${(DL[DL.length - 1] || {}).d || '—'}). For information only, not investment advice.`;
}
setInterval(() => {
  const left = Math.max(0, nextPoll - Date.now());
  $('#countdown').textContent = $('#autoChk').checked ? `· ${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}` : '';
  if ($('#autoChk').checked && left <= 0) poll();
}, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && $('#autoChk').checked) poll(); });
$('#btnReload').onclick = async () => { $('#btnReload').disabled = true; await loadAll(); $('#btnReload').disabled = false; nextPoll = Date.now() + POLL_MS; toast('Showing the latest published data.'); };

// on-demand update through GitHub Actions
function repoGuess() {
  const h = location.hostname, p = location.pathname.split('/').filter(Boolean);
  if (h.endsWith('.github.io') && p.length) return h.split('.')[0] + '/' + p[0];
  return '';
}
const cfg = { get repo() { try { return localStorage.getItem('nt-repo') || repoGuess(); } catch (e) { return repoGuess(); } }, get tok() { try { return localStorage.getItem('nt-token') || ''; } catch (e) { return ''; } } };
$('#btnSettings').onclick = () => { $('#setRepo').value = cfg.repo; $('#setTok').value = ''; $('#setTok').placeholder = cfg.tok ? 'Token saved — paste a new one to replace' : 'github_pat_…'; $('#modal').classList.remove('hidden'); };
$('#setClose').onclick = () => $('#modal').classList.add('hidden');
$('#setSave').onclick = () => { try { localStorage.setItem('nt-repo', $('#setRepo').value.trim()); if ($('#setTok').value.trim()) localStorage.setItem('nt-token', $('#setTok').value.trim()); toast('Saved in this browser.'); } catch (e) { toast('This browser blocked saving.'); } $('#modal').classList.add('hidden'); };
$('#setClear').onclick = () => { try { localStorage.removeItem('nt-token'); } catch (e) { } toast('Token removed from this browser.'); };
$('#btnUpdate').onclick = async () => {
  const repo = cfg.repo, tok = cfg.tok;
  if (!repo) { $('#btnSettings').click(); return; }
  const page = `https://github.com/${repo}/actions/workflows/update.yml`;
  if (!tok) { window.open(page, '_blank', 'noopener'); toast('Opened the update job on GitHub: press "Run workflow". Add a token in ⚙ to do this in one click.', 7000); return; }
  const b = $('#btnUpdate'); b.disabled = true;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/update.yml/dispatches`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json' }, body: JSON.stringify({ ref: 'main' }) });
    if (r.status === 204) {
      toast('Update started. Fresh data usually appears in 3–5 minutes; this page will load it automatically.', 8000);
      const t0 = Date.now(), before = META.generated;
      const iv = setInterval(async () => { try { const m = await getJSON('meta.json'); if (m.generated !== before) { clearInterval(iv); await loadAll(); b.disabled = false; } } catch (e) { } if (Date.now() - t0 > 12 * 60000) { clearInterval(iv); b.disabled = false; toast('The update is taking longer than usual. Check the job on GitHub.'); } }, 30000);
      return;
    }
    toast(r.status === 401 || r.status === 403 ? 'GitHub refused the token. Check it has Actions: Read and write on this repository.' : `GitHub answered ${r.status}. Check the repository name in ⚙.`, 8000);
  } catch (e) { toast('Could not reach GitHub.'); }
  b.disabled = false;
};

// ------------------------------------------------------------------ controls
function seg(id, key) { document.querySelectorAll(`#${id} button`).forEach(b => b.onclick = () => { document.querySelectorAll(`#${id} button`).forEach(x => x.classList.remove('on')); b.classList.add('on'); st[key] = b.dataset.v; renderAll(); }); }
seg('segIdx', 'idx'); seg('segPer', 'per');
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#tabs button').forEach(x => x.classList.remove('on')); b.classList.add('on');
  document.querySelectorAll('.view').forEach(v => v.classList.remove('on')); $('#v-' + b.dataset.t).classList.add('on');
  st.view = b.dataset.t; renderAll(); try { history.replaceState(null, '', '#' + st.view); } catch (e) { }
});
function renderAll() { ({ pulse: renderPulse, movers: renderMovers, sectors: renderSectors, smart: renderSmart, own: renderOwn, screens: renderScreens })[st.view](); }

// ------------------------------------------------------------------ MARKET PULSE
function renderPulse() {
  const v = $('#v-pulse');
  const ix = n => (MK.indices || []).find(x => x.name === n) || {};
  const sc = ix('Nifty Smallcap 250'), mc = ix('Nifty Microcap 250'), n50 = ix('Nifty 50'), mid = ix('Nifty Midcap 150'), vix = ix('India VIX');
  const br = MK.breadth || [], last = br[br.length - 1] || {}, hl = MK.hl || {};
  const code = st.idx === 'A' ? 'S' : st.idx;
  const bl = last[code] || {}, h = hl[code] || {};
  const fd = (MK.fiidii || [])[0];
  const poi = MK.poi || [];
  const lp = p => p && p.FII ? p.FII.fil / (p.FII.fil + p.FII.fis) * 100 : null;
  const fiiL = lp(poi[0]), fiiL5 = lp(poi[5]);
  const perKey = { r1: 'r1', r5: 'r5', r15: 'r1m', r1m: 'r1m', r3m: 'r3m', r6m: 'r1y', r1y: 'r1y' }[st.per];
  const tile = (name, o) => `<div class="kpi"><div class="k">${name}</div><div class="v">${fnum(o.last, 0)}</div><div class="n"><span class="${cls(o.r1)}">${fmt(o.r1, 2)}</span> today · <span class="${cls(o[perKey])}">${fmt(o[perKey])}</span> ${perKey === 'r1' ? '' : perKey.replace('r', '')}</div></div>`;
  const a50s = br.map(b => b[code] && b[code].a50).filter(x => x != null);
  const regime = bl.a50 == null ? '—' : bl.a50 >= 60 ? 'Broad uptrend' : bl.a50 >= 40 ? 'Mixed / rotational' : bl.a50 >= 20 ? 'Weak breadth' : 'Washed out (often near lows)';
  v.innerHTML = `
  <div class="kpis">${tile('Nifty 50', n50)}${tile('Nifty Midcap 150', mid)}${tile('Nifty Smallcap 250', sc)}${tile('Nifty Microcap 250', mc)}
    <div class="kpi"><div class="k">India VIX</div><div class="v">${fnum(vix.last, 2)}</div><div class="n"><span class="${cls(-vix.r1)}">${fmt(vix.r1)}</span> today</div></div></div>
  <div class="kpis">
    <div class="kpi"><div class="k">Advancers / decliners · ${code === 'S' ? 'SC250' : 'MC250'}</div><div class="v"><span class="up">${bl.adv ?? '—'}</span> / <span class="down">${bl.dec ?? '—'}</span></div><div class="n">on ${fdate(META.asof)}</div></div>
    <div class="kpi"><div class="k">% above 50-day avg</div><div class="v">${bl.a50 == null ? '—' : bl.a50.toFixed(1) + '%'}</div><div class="n">${regime}</div></div>
    <div class="kpi"><div class="k">% above 200-day avg</div><div class="v">${h.a200 ?? '—'}%</div><div class="n">long-term trend health</div></div>
    <div class="kpi"><div class="k">52-week highs / lows</div><div class="v"><span class="up">${h.nh ?? '—'}</span> / <span class="down">${h.nl ?? '—'}</span></div><div class="n">stocks at a new high or low today</div></div>
    <div class="kpi"><div class="k">FII / DII cash (₹ cr)</div><div class="v" style="font-size:16px"><span class="${cls(fd && fd.FII && fd.FII.net)}">${fd && fd.FII ? fnum(fd.FII.net, 0) : '—'}</span> / <span class="${cls(fd && fd.DII && fd.DII.net)}">${fd && fd.DII ? fnum(fd.DII.net, 0) : '—'}</span></div><div class="n">provisional, ${fd ? fdate(fd.d) : '—'}</div></div>
    <div class="kpi"><div class="k">FII index futures long</div><div class="v">${fiiL == null ? '—' : fiiL.toFixed(1) + '%'}</div><div class="n">${fiiL5 == null ? '' : (fiiL >= fiiL5 ? '▲ ' : '▼ ') + (fiiL - fiiL5).toFixed(1) + ' pts vs 5 sessions ago'}</div></div>
  </div>
  <div class="insights" id="pulseIns"></div>
  <div class="grid2">
    <div class="card"><h2>Relative performance, 1 year</h2><div class="d">Each index rebased to 100 a year ago. Small and micro caps beating the Nifty 50 means risk appetite is strong.</div><div class="chartbox"><canvas id="cPerf"></canvas></div></div>
    <div class="card"><h2>Breadth: % of stocks above their 50-day average</h2><div class="d">Readings above 60% mark a healthy uptrend; below 20% has often marked washed-out lows.</div><div class="chartbox"><canvas id="cBreadth"></canvas></div></div>
  </div>
  <div class="grid2">
    <div class="card"><h2>Derivatives positioning: index futures long %</h2><div class="d">Share of index-futures open interest that is long, by participant (NSE participant-wise OI). FIIs at extremes (below 20% or above 70%) are a widely watched contrarian signal.</div><div class="chartbox"><canvas id="cPoi"></canvas></div></div>
    <div class="card"><h2>FII / DII net cash flows (₹ cr)</h2><div class="d">Provisional daily figures from NSE. History builds up from the day this terminal started collecting.</div><div class="chartbox"><canvas id="cFlows"></canvas></div></div>
  </div>
  <div class="card"><h2>Sector and theme indices</h2><div class="d">Colour shows return over each window. Click a column to sort.</div><div class="tablewrap" id="tIdxs"></div></div>`;

  // insights
  const rel = sc.r1m != null && n50.r1m != null ? sc.r1m - n50.r1m : null;
  const relm = mc.r1m != null && n50.r1m != null ? mc.r1m - n50.r1m : null;
  const a50prev = a50s.length > 10 ? a50s[a50s.length - 11] : null;
  $('#pulseIns').innerHTML = `<h2>Read of the tape</h2><ul>
    <li>Breadth in the ${code === 'S' ? 'Smallcap 250' : 'Microcap 250'}: <b>${bl.a50 == null ? '—' : bl.a50.toFixed(1) + '%'}</b> of stocks are above their 50-day average${a50prev != null ? ` (${bl.a50 >= a50prev ? 'up' : 'down'} from ${a50prev.toFixed(1)}% two weeks ago)` : ''}, and <b>${h.a200 ?? '—'}%</b> are above the 200-day. Regime: <b>${regime}</b>.</li>
    <li>Over the past month the Smallcap 250 ${rel == null ? '—' : rel >= 0 ? `beat the Nifty 50 by <b class="up">${rel.toFixed(1)} pts</b>` : `lagged the Nifty 50 by <b class="down">${(-rel).toFixed(1)} pts</b>`}, and the Microcap 250 ${relm == null ? '—' : relm >= 0 ? `beat it by <b class="up">${relm.toFixed(1)} pts</b>` : `lagged it by <b class="down">${(-relm).toFixed(1)} pts</b>`}.</li>
    <li>FIIs are <b>${fiiL == null ? '—' : fiiL.toFixed(0) + '%'} long</b> in index futures${fiiL == null ? '' : fiiL < 25 ? ' — heavily short, which has often preceded short-covering rallies' : fiiL > 65 ? ' — heavily long, leaving room for unwinding' : ''}. India VIX is <b>${fnum(vix.last, 1)}</b>.</li>
    <li>${h.nh ?? 0} stocks made a new 52-week high today versus ${h.nl ?? 0} new lows.</li></ul>`;

  // charts
  const ser = [['Nifty 50', '#e6edf3'], ['Nifty Midcap 150', '#3b82f6'], ['Nifty Smallcap 250', '#f5a524'], ['Nifty Microcap 250', '#a855f7']];
  const base = ix('Nifty 50').series || [];
  mk('cPerf', { type: 'line', data: { labels: base.map(x => x[0]), datasets: ser.map(([n, c]) => { const s = ix(n).series || []; const m = new Map(s.map(x => [x[0], x[1]])); const b0 = s.length ? s[0][1] : 1; return { label: n.replace('Nifty Midcap', 'Midcap').replace('Nifty Smallcap', 'Smallcap').replace('Nifty Microcap', 'Microcap'), data: base.map(x => m.has(x[0]) ? +(m.get(x[0]) / b0 * 100).toFixed(2) : null), borderColor: c, pointRadius: 0, borderWidth: 1.6, tension: .15, spanGaps: true }; }) },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { boxWidth: 10, color: '#e6edf3' } } }, scales: { x: { ticks: { maxTicksLimit: 8 }, grid: { display: false } }, y: { grid: { color: '#1b2532' } } } } });
  mk('cBreadth', { type: 'line', data: { labels: br.map(b => b.d), datasets: [{ label: 'Smallcap 250', data: br.map(b => b.S && b.S.a50), borderColor: '#f5a524', pointRadius: 0, borderWidth: 1.6 }, { label: 'Microcap 250', data: br.map(b => b.M && b.M.a50), borderColor: '#a855f7', pointRadius: 0, borderWidth: 1.6 }] },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { boxWidth: 10, color: '#e6edf3' } } }, scales: { x: { ticks: { maxTicksLimit: 8 }, grid: { display: false } }, y: { min: 0, max: 100, ticks: pctTick, grid: { color: c => [20, 60].includes(c.tick.value) ? '#4b5b70' : '#1b2532' } } } } });
  const pr = poi.slice().reverse();
  const lpc = (p, k) => p[k] ? +(p[k].fil / (p[k].fil + p[k].fis) * 100).toFixed(1) : null;
  mk('cPoi', { type: 'line', data: { labels: pr.map(p => p.d), datasets: [['FII', '#3b82f6'], ['Client', '#f5a524'], ['Pro', '#22c55e'], ['DII', '#a855f7']].map(([k, c]) => ({ label: k, data: pr.map(p => lpc(p, k)), borderColor: c, pointRadius: 0, borderWidth: k === 'FII' ? 2.4 : 1.3 })) },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { boxWidth: 10, color: '#e6edf3' } } }, scales: { x: { ticks: { maxTicksLimit: 8 }, grid: { display: false } }, y: { min: 0, max: 100, ticks: pctTick, grid: { color: '#1b2532' } } } } });
  const fl = (MK.fiidii || []).slice(0, 60).reverse();
  mk('cFlows', { type: 'bar', data: { labels: fl.map(x => x.d), datasets: [{ label: 'FII/FPI', data: fl.map(x => x.FII && x.FII.net), backgroundColor: '#3b82f6' }, { label: 'DII', data: fl.map(x => x.DII && x.DII.net), backgroundColor: '#f5a524' }] },
    options: { maintainAspectRatio: false, plugins: { legend: { labels: { boxWidth: 10, color: '#e6edf3' } } }, scales: { x: { grid: { display: false } }, y: { grid: { color: '#1b2532' } } } } });
  const idxRows = (MK.indices || []).filter(x => x.name !== 'India VIX');
  const hc = (k, sc_) => (v) => `" style="background:${heat(v, sc_)}`;
  table($('#tIdxs'), [{ k: 'name', h: 'Index', l: 1 }, { k: 'last', h: 'Close', f: v => fnum(v, 1) },
    { k: 'r1', h: '1D', f: pctF, c: hc('r1', 3) }, { k: 'r5', h: '1W', f: pctF, c: hc('r5', 6) }, { k: 'r1m', h: '1M', f: pctF, c: hc('r1m', 10) },
    { k: 'r3m', h: '3M', f: pctF, c: hc('r3m', 18) }, { k: 'r1y', h: '1Y', f: pctF, c: hc('r1y', 35) }], idxRows, { sort: 'r1m', sortKey: 'idx' });
}

// ------------------------------------------------------------------ MOVERS
function renderMovers() {
  const v = $('#v-movers'); const P = PER[st.per]; const k = st.per;
  const U = uni().filter(r => r[k] != null);
  if (!U.length) { v.innerHTML = '<div class="empty">No stocks have enough history for this window.</div>'; return; }
  const sorted = U.slice().sort((a, b) => b[k] - a[k]);
  const topN = Math.round(U.length * 0.2), topSet = new Set(sorted.slice(0, topN).map(r => r.sym)), base = topN / U.length;
  const vals = U.map(r => r[k]), adv = vals.filter(x => x > 0).length;
  const secs = {};
  U.forEach(r => { const s = secs[r.s] || (secs[r.s] = { n: 0, hits: 0, vals: [], adv: 0 }); s.n++; s.vals.push(r[k]); if (r[k] > 0) s.adv++; if (topSet.has(r.sym)) s.hits++; });
  const rows = Object.entries(secs).map(([sec, s]) => ({ sec, n: s.n, share: s.n / U.length * 100, hits: s.hits, hit: s.hits / s.n * 100, lift: s.hits / s.n / base, med: median(s.vals), avg: mean(s.vals), br: s.adv / s.n * 100 }));
  const ranked = rows.filter(s => s.n >= 5).sort((a, b) => b.med - a.med);
  const lead = ranked[0] || rows[0], lag = ranked[ranked.length - 1] || rows[0];
  const best = rows.filter(s => s.n >= 5).sort((a, b) => b.lift - a.lift)[0] || rows[0];
  const conc = rows.slice().sort((a, b) => b.hits - a.hits).slice(0, 3);
  v.innerHTML = `
  <div class="kpis">
    <div class="kpi"><div class="k">Stocks</div><div class="v">${U.length}</div><div class="n">${uname()}</div></div>
    <div class="kpi"><div class="k">Rose / fell</div><div class="v"><span class="up">${adv}</span> / <span class="down">${U.length - adv}</span></div><div class="n">${(adv / U.length * 100).toFixed(0)}% rose over ${P}</div></div>
    <div class="kpi"><div class="k">Median return</div><div class="v ${cls(median(vals))}">${fmt(median(vals))}</div><div class="n">average ${fmt(mean(vals))}</div></div>
    <div class="kpi"><div class="k">Best</div><div class="v up">${fmt(sorted[0][k])}</div><div class="n">${sorted[0].sym}</div></div>
    <div class="kpi"><div class="k">Worst</div><div class="v down">${fmt(sorted[sorted.length - 1][k])}</div><div class="n">${sorted[sorted.length - 1].sym}</div></div>
    <div class="kpi"><div class="k">Leading sector</div><div class="v" style="font:600 15px var(--sans)">${esc(lead.sec)}</div><div class="n">median ${fmt(lead.med)} · ${lead.n} stocks</div></div></div>
  <div class="insights"><h2>What stands out (${P}, ${uname()})</h2><ul>
    <li><b>${esc(lead.sec)}</b> led on median return (<b class="${cls(lead.med)}">${fmt(lead.med)}</b>); <b>${esc(lag.sec)}</b> lagged (<b class="${cls(lag.med)}">${fmt(lag.med)}</b>). Sectors with 5+ stocks are ranked.</li>
    <li>Top-20% cut-off: <b>${fmt(sorted[topN - 1][k])}</b>. <b>${esc(best.sec)}</b> had the best hit rate: <b>${best.hit.toFixed(0)}%</b> of its ${best.n} stocks made the top 20%, <b>${best.lift.toFixed(1)}×</b> its fair share.</li>
    <li>${conc.map(c => `<b>${esc(c.sec)}</b> (${c.hits})`).join(', ')} supplied ${(conc.reduce((s, x) => s + x.hits, 0) / topN * 100).toFixed(0)}% of the ${topN} top movers.</li></ul></div>
  <div class="grid2"><div class="card"><h2>Top 15</h2><div class="d">Highest ${P} returns · click a bar for the stock</div><div class="chartbox"><canvas id="cTop"></canvas></div></div>
    <div class="card"><h2>Bottom 15</h2><div class="d">Lowest ${P} returns</div><div class="chartbox"><canvas id="cBot"></canvas></div></div></div>
  <div class="grid2"><div class="card"><h2>Stocks per sector</h2><div class="d">Share of the universe by count</div><div class="chartbox"><canvas id="cPie1"></canvas></div></div>
    <div class="card"><h2>Where the top movers came from</h2><div class="d">Sector mix of the top 20% (${topN} stocks)</div><div class="chartbox"><canvas id="cPie2"></canvas></div></div></div>
  <div class="card"><h2>Sector leadership</h2><div class="d">Bars: median ${P} return. Line: hit rate (% of the sector's stocks in the top 20%). Dashed: ${(base * 100).toFixed(0)}%, an even spread.</div><div class="chartbox tall"><canvas id="cLead"></canvas></div></div>
  <div class="card"><h2>Sector scorecard</h2><div class="d">Lift above 1.0× = more top movers than the sector's size predicts. Click a column to sort.</div><div class="tablewrap" id="tSecs"></div></div>
  <div class="grid2"><div class="card"><h2>Momentum map: ${P} vs 1-month</h2><div class="d">Top-right = strong on both horizons. Click a dot for the stock.</div><div class="chartbox tall"><canvas id="cScat"></canvas></div></div>
    <div class="card"><h2>Return distribution</h2><div class="d">Number of stocks per return band</div><div class="chartbox tall"><canvas id="cHist"></canvas></div></div></div>
  <div class="card"><h2>Every stock, by sector</h2><div class="d">Each tile is a stock, coloured by ${P} return. Sectors ordered by median. Click a tile to open it in the terminal.</div><div class="heat" id="heatmap"></div></div>`;
  const bar = (list, col) => ({ type: 'bar', data: { labels: list.map(r => r.sym), datasets: [{ data: list.map(r => r[k]), backgroundColor: col, borderRadius: 3, barThickness: 13 }] },
    options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { title: i => list[i[0].dataIndex].n, label: i => `${fmt(i.raw)} · ${list[i.dataIndex].s}` } } },
      scales: { x: { ticks: pctTick, grid: { color: '#1b2532' } }, y: { ticks: { font: { family: "'IBM Plex Mono'" }, color: '#e6edf3' }, grid: { display: false } } }, onClick: (e, els) => { if (els.length) select(list[els[0].index].sym, true); } } });
  mk('cTop', bar(sorted.slice(0, 15), '#22c55e')); mk('cBot', bar(sorted.slice(-15).reverse(), '#ef4444'));
  const pie = (key, total) => { const arr = rows.map(r => [r.sec, r[key]]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]); const h = arr.slice(0, 9); const rest = arr.slice(9).reduce((s, x) => s + x[1], 0); if (rest) h.push(['Other', rest]);
    return { type: 'doughnut', data: { labels: h.map(x => x[0]), datasets: [{ data: h.map(x => x[1]), backgroundColor: h.map(x => x[0] === 'Other' ? '#475569' : SECCOL[x[0]]), borderColor: '#111821', borderWidth: 2 }] },
      options: { maintainAspectRatio: false, cutout: '55%', plugins: { legend: { position: 'right', labels: { boxWidth: 10, color: '#e6edf3', generateLabels: ch => ch.data.labels.map((l, i) => ({ text: `${l}  ${(ch.data.datasets[0].data[i] / total * 100).toFixed(0)}%`, fillStyle: ch.data.datasets[0].backgroundColor[i], strokeStyle: ch.data.datasets[0].backgroundColor[i], fontColor: '#e6edf3', index: i })) } }, tooltip: { callbacks: { label: i => `${i.label}: ${i.raw} (${(i.raw / total * 100).toFixed(1)}%)` } } } } }; };
  mk('cPie1', pie('n', U.length)); mk('cPie2', pie('hits', topN));
  const L = rows.slice().sort((a, b) => b.med - a.med);
  mk('cLead', { data: { labels: L.map(s => `${s.sec} (${s.n})`), datasets: [
    { type: 'bar', label: 'Median return %', data: L.map(s => +s.med.toFixed(2)), backgroundColor: L.map(s => s.med >= 0 ? '#22c55e' : '#ef4444'), borderRadius: 3, yAxisID: 'y' },
    { type: 'line', label: 'Hit rate %', data: L.map(s => +s.hit.toFixed(1)), borderColor: '#f5a524', backgroundColor: '#f5a524', pointRadius: 4, tension: .25, yAxisID: 'y2' },
    { type: 'line', label: 'Even spread', data: L.map(() => base * 100), borderColor: '#f5a52466', borderDash: [5, 4], pointRadius: 0, yAxisID: 'y2' }] },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { color: '#e6edf3', boxWidth: 12 } } },
      scales: { x: { ticks: { maxRotation: 55, minRotation: 45, color: '#e6edf3' }, grid: { display: false } }, y: { ticks: pctTick, grid: { color: '#1b2532' } }, y2: { position: 'right', min: 0, ticks: pctTick, grid: { display: false } } } } });
  table($('#tSecs'), [{ k: 'sec', h: 'Sector', l: 1, f: (v) => `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${SECCOL[v]};margin-right:7px"></span>${esc(v)}` },
    { k: 'n', h: 'Stocks' }, { k: 'share', h: '% of universe', f: v => v.toFixed(1) + '%' }, { k: 'hits', h: 'Top-20%' }, { k: 'hit', h: 'Hit rate', f: v => v.toFixed(0) + '%' },
    { k: 'lift', h: 'Lift', f: v => v.toFixed(2) + '×', c: v => v >= 1.2 ? 'up' : v <= .8 ? 'down' : '' }, { k: 'med', h: 'Median', f: pctF, c: pctC }, { k: 'avg', h: 'Average', f: pctF, c: pctC }, { k: 'br', h: '% rising', f: v => v.toFixed(0) + '%' }], rows, { sort: 'med', sortKey: 'secs' });
  const UA = uni().filter(r => r[k] != null && r.r1m != null); const bySec = {}; UA.forEach(r => (bySec[r.s] = bySec[r.s] || []).push(r));
  mk('cScat', { type: 'scatter', data: { datasets: Object.entries(bySec).sort((a, b) => b[1].length - a[1].length).map(([s, list], i) => ({ label: s, data: list.map(r => ({ x: r[k], y: r.r1m, r })), backgroundColor: (i < 10 ? SECCOL[s] : '#64748b') + 'cc', pointRadius: 3.5, pointHoverRadius: 7 })) },
    options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, color: '#e6edf3', font: { size: 10 } } }, tooltip: { callbacks: { label: i => `${i.raw.r.sym} · ${P} ${fmt(i.raw.x)} · 1M ${fmt(i.raw.y)}` } } },
      scales: { x: { title: { display: true, text: P + ' return %' }, grid: { color: c => c.tick.value === 0 ? '#4b5b70' : '#1b2532' } }, y: { title: { display: true, text: '1-month return %' }, grid: { color: c => c.tick.value === 0 ? '#4b5b70' : '#1b2532' } } },
      onClick: (e, els) => { if (els.length) { const p = charts.cScat.data.datasets[els[0].datasetIndex].data[els[0].index]; select(p.r.sym, true); } } } });
  const step = { r1: 1, r5: 2, r15: 3, r1m: 4, r3m: 5, r6m: 10, r1y: 10 }[k];
  const lo = Math.floor(Math.min(...vals) / step) * step, hi = Math.ceil(Math.max(...vals) / step) * step; const bins = []; for (let b = lo; b < hi; b += step) bins.push(b);
  mk('cHist', { type: 'bar', data: { labels: bins.map(b => b + '%'), datasets: [{ data: bins.map(b => vals.filter(x => x >= b && x < b + step).length), backgroundColor: bins.map(b => b + step <= 0 ? '#ef4444' : b >= 0 ? '#22c55e' : '#94a3b8'), barPercentage: 1, categoryPercentage: .95 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { title: { display: true, text: 'Stocks' }, grid: { color: '#1b2532' } } } } });
  const groups = {}; uni().forEach(r => (groups[r.s] = groups[r.s] || []).push(r));
  $('#heatmap').innerHTML = Object.entries(groups).sort((a, b) => median(b[1].map(r => r[k])) - median(a[1].map(r => r[k]))).map(([s, list]) => {
    list.sort((a, b) => (b[k] ?? -999) - (a[k] ?? -999)); const m = median(list.map(r => r[k]));
    return `<div class="hsec"><div class="nm"><b>${esc(s)}</b><br>${list.length} · <span class="${cls(m)}">${fmt(m)}</span></div><div class="tiles">${list.map(r => `<span class="tile" data-s="${esc(r.sym)}" title="${esc(r.n)} · ${fmt(r[k])}" style="background:${heat(r[k], SCALE[k])}">${esc(r.sym)} ${r[k] == null ? '' : (r[k] > 0 ? '+' : '') + r[k].toFixed(1)}</span>`).join('')}</div></div>`;
  }).join('');
  $('#heatmap').onclick = e => { const t = e.target.closest('.tile'); if (t) select(t.dataset.s, true); };
}

// ------------------------------------------------------------------ SECTOR ROTATION
function renderSectors() {
  const v = $('#v-sectors'); const U = uni();
  const per = ['r1', 'r5', 'r1m', 'r3m', 'r6m', 'r1y'];
  const g = {}; U.forEach(r => (g[r.s] = g[r.s] || []).push(r));
  const uMed = Object.fromEntries(per.map(p => [p, median(U.map(r => r[p]))]));
  const rows = Object.entries(g).map(([s, l]) => {
    const o = { sec: s, n: l.length }; per.forEach(p => o[p] = median(l.map(r => r[p])));
    o.a50 = l.filter(r => r.a50).length / Math.max(1, l.filter(r => r.a50 != null).length) * 100;
    o.a200 = l.filter(r => r.a200).length / Math.max(1, l.filter(r => r.a200 != null).length) * 100;
    o.rs = median(l.map(r => r.rs3m)); o.mom = median(l.map(r => r.mom)); o.vr = median(l.map(r => r.vr));
    o.x = o.r3m != null && uMed.r3m != null ? o.r3m - uMed.r3m : null; o.y = o.r1m != null && uMed.r1m != null ? o.r1m - uMed.r1m : null;
    return o;
  });
  const quad = o => o.x == null ? '—' : o.x >= 0 && o.y >= 0 ? 'Leading' : o.x >= 0 ? 'Weakening' : o.y >= 0 ? 'Improving' : 'Lagging';
  rows.forEach(o => o.q = quad(o));
  const byQ = q => rows.filter(o => o.q === q && o.n >= 4).sort((a, b) => b.n - a.n).map(o => esc(o.sec)).join(', ') || 'none';
  v.innerHTML = `
  <div class="insights"><h2>Rotation read (${uname()})</h2><ul>
    <li><b>Leading</b> (beating the universe over both 3 months and 1 month): ${byQ('Leading')}.</li>
    <li><b>Improving</b> (weak over 3 months but turning up over the last month — where rotation often starts): ${byQ('Improving')}.</li>
    <li><b>Weakening</b> (strong over 3 months but fading lately): ${byQ('Weakening')}. <b>Lagging</b>: ${byQ('Lagging')}.</li></ul></div>
  <div class="grid2"><div class="card"><h2>Rotation map</h2><div class="d">Horizontal: sector's median 3-month return minus the universe's. Vertical: the same for 1 month. Bubble size = number of stocks. Sectors typically travel clockwise: Improving → Leading → Weakening → Lagging.</div><div class="chartbox tall"><canvas id="cRrg"></canvas></div></div>
  <div class="card"><h2>Sector breadth</h2><div class="d">% of each sector's stocks above their 50-day and 200-day averages</div><div class="chartbox tall"><canvas id="cSecBr"></canvas></div></div></div>
  <div class="card"><h2>Median return by sector and window</h2><div class="d">Each cell is the median stock return in that sector. Click a column to sort.</div><div class="tablewrap" id="tRot"></div></div>`;
  const col = o => ({ Leading: '#22c55e', Improving: '#3b82f6', Weakening: '#f5a524', Lagging: '#ef4444' })[o.q] || '#64748b';
  const pts = rows.filter(o => o.x != null && o.y != null);
  mk('cRrg', { type: 'bubble', data: { datasets: [{ data: pts.map(o => ({ x: +o.x.toFixed(2), y: +o.y.toFixed(2), r: 4 + Math.sqrt(o.n) * 2, o })), backgroundColor: pts.map(o => col(o) + 'aa'), borderColor: pts.map(col) }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: i => `${i.raw.o.sec} (${i.raw.o.n}) · 3M ${fmt(i.raw.x)} · 1M ${fmt(i.raw.y)} vs universe · ${i.raw.o.q}` } } },
      scales: { x: { title: { display: true, text: '3-month relative return (pts)' }, grid: { color: c => c.tick.value === 0 ? '#5b6b80' : '#1b2532' } }, y: { title: { display: true, text: '1-month relative return (pts)' }, grid: { color: c => c.tick.value === 0 ? '#5b6b80' : '#1b2532' } } } },
    plugins: [{ id: 'lbl', afterDatasetsDraw(ch) { const c = ch.ctx; c.save(); c.font = '10px Inter'; c.fillStyle = '#cbd5e1'; ch.getDatasetMeta(0).data.forEach((p, i) => { const o = pts[i]; if (o.n >= 4) c.fillText(o.sec, p.x + 6, p.y - 6); }); c.restore(); } }] });
  const sb = rows.filter(o => o.n >= 3).sort((a, b) => b.a50 - a.a50);
  mk('cSecBr', { type: 'bar', data: { labels: sb.map(o => `${o.sec} (${o.n})`), datasets: [{ label: '> 50-day', data: sb.map(o => +o.a50.toFixed(0)), backgroundColor: '#3b82f6' }, { label: '> 200-day', data: sb.map(o => +o.a200.toFixed(0)), backgroundColor: '#f5a524' }] },
    options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { labels: { color: '#e6edf3', boxWidth: 10 } } }, scales: { x: { min: 0, max: 100, ticks: pctTick, grid: { color: '#1b2532' } }, y: { ticks: { color: '#e6edf3', font: { size: 10.5 } }, grid: { display: false } } } } });
  const hc = s => v => `" style="background:${heat(v, s)}`;
  table($('#tRot'), [{ k: 'sec', h: 'Sector', l: 1 }, { k: 'n', h: 'Stocks' }, { k: 'q', h: 'Quadrant', l: 1, f: (v, o) => `<span style="color:${col(o)}">${v}</span>` },
    { k: 'r1', h: '1D', f: pctF, c: hc(3) }, { k: 'r5', h: '1W', f: pctF, c: hc(6) }, { k: 'r1m', h: '1M', f: pctF, c: hc(10) }, { k: 'r3m', h: '3M', f: pctF, c: hc(20) },
    { k: 'r6m', h: '6M', f: pctF, c: hc(30) }, { k: 'r1y', h: '1Y', f: pctF, c: hc(40) }, { k: 'a50', h: '>50DMA', f: v => v.toFixed(0) + '%' }, { k: 'mom', h: 'Momentum', f: v => v == null ? '—' : v.toFixed(0) }, { k: 'vr', h: 'Vol ×', f: v => v == null ? '—' : v.toFixed(2) + '×' }], rows, { sort: 'r1m', sortKey: 'rot' });
}

// ------------------------------------------------------------------ SMART MONEY
const INSTCATS = ['MF', 'Insurance', 'FPI/Foreign fund', 'AIF/PMS', 'Bank/NBFC'];
function renderSmart() {
  const v = $('#v-smart'); const U = uni();
  const usyms = new Set(U.map(r => r.sym));
  const first = DL.length ? DL[DL.length - 1].d : null;
  const acc = U.filter(r => r.r1 > 0 && r.dp != null && r.dp20 && r.dp >= r.dp20 * 1.25 && r.vr >= 1.5).sort((a, b) => b.vr * b.dp - a.vr * a.dp);
  const dis = U.filter(r => r.r1 < 0 && r.dp != null && r.dp20 && r.dp >= r.dp20 * 1.25 && r.vr >= 1.5).sort((a, b) => b.vr * b.dp - a.vr * a.dp);
  const inScope = DL.filter(x => st.dealScope === 'A' ? true : usyms.has(x.sym));
  const inst = inScope.filter(x => INSTCATS.includes(x.cat));
  const byStock = {}; inst.forEach(x => { const o = byStock[x.sym] || (byStock[x.sym] = { sym: x.sym, nm: x.nm, buy: 0, sell: 0, n: 0, who: new Set() }); o[x.side === 'B' ? 'buy' : 'sell'] += x.val; o.n++; o.who.add(x.who); });
  const stockAgg = Object.values(byStock).map(o => ({ ...o, net: o.buy - o.sell, whoS: [...o.who].slice(0, 3).join('; ') }));
  const byWho = {}; inScope.forEach(x => { if (x.cat === 'Individual' || x.cat === 'Broker/Prop') return; const o = byWho[x.who] || (byWho[x.who] = { who: x.who, cat: x.cat, buy: 0, sell: 0, n: 0, syms: new Set() }); o[x.side === 'B' ? 'buy' : 'sell'] += x.val; o.n++; o.syms.add(x.sym); });
  const whoAgg = Object.values(byWho).map(o => ({ ...o, net: o.buy - o.sell, symS: [...o.syms].slice(0, 6).join(', ') }));
  v.innerHTML = `
  <div class="insights"><h2>Where the money is moving</h2><ul>
    <li><b>${acc.length}</b> stocks in the ${uname()} show <b>accumulation</b> today: price up on at least 1.5× normal volume with delivery well above its 20-day norm (buyers taking shares home rather than trading intraday). <b>${dis.length}</b> show the same pattern on a down day (distribution).</li>
    <li>${inst.length} institutional bulk/block trades ${st.dealScope === 'A' ? 'across NSE' : 'in this universe'} since ${fdate(first)}${stockAgg.length ? `; biggest net institutional buying: <b>${stockAgg.slice().sort((a, b) => b.net - a.net).slice(0, 3).map(o => esc(o.sym) + ' (₹' + o.net.toFixed(1) + ' cr)').join(', ')}</b>` : ''}.</li>
    <li>Bulk deals are trades over 0.5% of a company's shares, reported with the buyer's or seller's name; block deals are large negotiated trades in the morning window.</li></ul></div>
  <div class="grid2">
    <div class="card"><h2>Accumulation today</h2><div class="d">Up day · volume ≥ 1.5× 20-day average · delivery % ≥ 1.25× its 20-day average</div><div class="tablewrap" id="tAcc"></div></div>
    <div class="card"><h2>Distribution today</h2><div class="d">Down day with the same heavy, high-delivery volume</div><div class="tablewrap" id="tDis"></div></div></div>
  <div class="card"><h2>Bulk &amp; block deals</h2>
    <div class="controlsrow"><div class="seg" id="segScope"><button data-v="U" class="${st.dealScope === 'U' ? 'on' : ''}">This universe</button><button data-v="A" class="${st.dealScope === 'A' ? 'on' : ''}">All NSE</button></div>
      <select id="dSide"><option value="">Buys & sells</option><option value="B">Buys</option><option value="S">Sells</option></select>
      <select id="dCat"><option value="">All parties</option><option value="INST">Institutions only</option>${['MF', 'Insurance', 'FPI/Foreign fund', 'AIF/PMS', 'Bank/NBFC', 'Corporate/Other', 'Broker/Prop', 'Individual'].map(c => `<option>${c}</option>`).join('')}</select>
      <input id="dQ" placeholder="Search stock or party…" value="${esc(st.dealQ)}"></div>
    <div class="d">Party type is inferred from the name, so treat it as a guide. Value in ₹ crore.</div><div class="tablewrap" id="tDeals"></div></div>
  <div class="grid2">
    <div class="card"><h2>Net institutional buying by stock</h2><div class="d">MF, insurance, foreign funds, AIFs and banks combined, from bulk/block deals since ${fdate(first)}</div><div class="tablewrap" id="tStockAgg"></div></div>
    <div class="card"><h2>Most active institutions &amp; investors</h2><div class="d">Funds, corporates and other non-broker parties by deal value</div><div class="tablewrap" id="tWho"></div></div></div>`;
  const accCols = [{ k: 'sym', h: 'Stock', l: 1, f: stockCell }, { k: 'r1', h: '1D', f: pctF, c: pctC }, { k: 'vr', h: 'Vol ×', f: v => v == null ? '—' : v.toFixed(1) + '×' }, { k: 'dp', h: 'Deliv %', f: v => v == null ? '—' : v.toFixed(0) + '%' }, { k: 'dp20', h: '20D avg', f: v => v == null ? '—' : v.toFixed(0) + '%' }, { k: 'to', h: '₹ cr', f: v => fnum(v, 1) }];
  table($('#tAcc'), accCols, acc, { sort: 'vr', click: r => r.sym, sortKey: 'acc' });
  table($('#tDis'), accCols, dis, { sort: 'vr', click: r => r.sym, sortKey: 'dis' });
  const drawDeals = () => {
    const q = st.dealQ.toLowerCase();
    const rows = inScope.filter(x => (!st.dealSide || x.side === st.dealSide) && (!st.dealCat || (st.dealCat === 'INST' ? INSTCATS.includes(x.cat) : x.cat === st.dealCat)) && (!q || x.sym.toLowerCase().includes(q) || x.who.toLowerCase().includes(q) || x.nm.toLowerCase().includes(q)));
    table($('#tDeals'), [{ k: 'd', h: 'Date', l: 1 }, { k: 'sym', h: 'Stock', l: 1, f: (v, r) => `<b style="font-family:var(--mono)">${esc(v)}</b>${r.u ? `<span class="tag ${r.u}">${r.u === 'S' ? 'SC' : 'MC'}</span>` : ''}` },
      { k: 'who', h: 'Party', l: 1, wrap: 1 }, { k: 'cat', h: 'Type', l: 1 }, { k: 'side', h: 'Side', f: v => `<span class="pill ${v === 'B' ? 'b' : 's'}">${v === 'B' ? 'BUY' : 'SELL'}</span>` },
      { k: 'qty', h: 'Shares', f: v => v.toLocaleString('en-IN') }, { k: 'px', h: 'Price', f: v => fnum(v, 2) }, { k: 'val', h: '₹ cr', f: v => fnum(v, 2) }, { k: 't', h: 'Kind', l: 1 }], rows, { sort: 'd', limit: 400, click: r => r.sym, sortKey: 'deals' });
  };
  drawDeals();
  document.querySelectorAll('#segScope button').forEach(b => b.onclick = () => { st.dealScope = b.dataset.v; renderSmart(); });
  $('#dSide').value = st.dealSide; $('#dCat').value = st.dealCat;
  $('#dSide').onchange = e => { st.dealSide = e.target.value; drawDeals(); };
  $('#dCat').onchange = e => { st.dealCat = e.target.value; drawDeals(); };
  $('#dQ').oninput = e => { st.dealQ = e.target.value; drawDeals(); };
  table($('#tStockAgg'), [{ k: 'sym', h: 'Stock', l: 1, f: v => `<b style="font-family:var(--mono)">${esc(v)}</b>` }, { k: 'net', h: 'Net ₹ cr', f: v => fnum(v, 2), c: pctC }, { k: 'buy', h: 'Bought', f: v => fnum(v, 1) }, { k: 'sell', h: 'Sold', f: v => fnum(v, 1) }, { k: 'whoS', h: 'Who', l: 1, wrap: 1 }], stockAgg, { sort: 'net', click: r => r.sym, sortKey: 'sagg' });
  table($('#tWho'), [{ k: 'who', h: 'Party', l: 1, wrap: 1 }, { k: 'cat', h: 'Type', l: 1 }, { k: 'net', h: 'Net ₹ cr', f: v => fnum(v, 2), c: pctC }, { k: 'n', h: 'Deals' }, { k: 'symS', h: 'Stocks', l: 1, wrap: 1 }], whoAgg, { sort: 'net', sortKey: 'who', v: 1 });
}

// ------------------------------------------------------------------ OWNERSHIP
function renderOwn() {
  const v = $('#v-own'); const U = uni().filter(r => r.prom != null);
  const q0 = Object.values(OWN).find(o => o.date) || {};
  const holderRows = [];
  uni().forEach(r => { const o = OWN[r.sym]; if (!o || !o.holders) return; o.holders.forEach(h => holderRows.push({ sym: r.sym, i: r.i, n: r.n, who: h.n, c: h.c, p: h.p, d: h.d, isNew: h.d === null && !!o.prev_date })); (o.exited || []).forEach(h => holderRows.push({ sym: r.sym, i: r.i, n: r.n, who: h.n, c: h.c, p: 0, d: -h.p, exit: true })); });
  const newIn = holderRows.filter(x => x.isNew && ['MF', 'FPI', 'Insurance', 'AIF', 'Pension fund', 'Sovereign fund', 'Foreign inst.'].includes(x.c));
  const up = k => U.filter(r => r[k] > 0).length;
  v.innerHTML = `
  <div class="kpis">
    <div class="kpi"><div class="k">Latest quarter</div><div class="v" style="font-size:16px">${fdate(q0.date)}</div><div class="n">vs ${fdate(q0.prev_date)} · ${U.length} stocks covered</div></div>
    <div class="kpi"><div class="k">FPIs raised stake</div><div class="v up">${up('dfpi')}</div><div class="n">of ${U.length} stocks</div></div>
    <div class="kpi"><div class="k">MFs raised stake</div><div class="v up">${up('dmf')}</div><div class="n">of ${U.length} stocks</div></div>
    <div class="kpi"><div class="k">Promoters cut stake</div><div class="v down">${U.filter(r => r.dprom < -0.1).length}</div><div class="n">by more than 0.1 pp</div></div>
    <div class="kpi"><div class="k">New institutional holders &gt;1%</div><div class="v">${newIn.length}</div><div class="n">funds that crossed 1% this quarter</div></div>
    <div class="kpi"><div class="k">Promoter pledge &gt; 0</div><div class="v">${U.filter(r => r.pledge > 0).length}</div><div class="n">stocks</div></div></div>
  <div class="grid3">
    <div class="card"><h2>Mutual funds added most</h2><div class="d">QoQ change in MF holding, percentage points</div><div class="chartbox"><canvas id="cMf"></canvas></div></div>
    <div class="card"><h2>Foreign investors added most</h2><div class="d">QoQ change in FPI holding, pp</div><div class="chartbox"><canvas id="cFpi"></canvas></div></div>
    <div class="card"><h2>Promoters sold most</h2><div class="d">QoQ change in promoter holding, pp</div><div class="chartbox"><canvas id="cProm"></canvas></div></div></div>
  <div class="card"><h2>Mutual fund houses: where they added and cut</h2><div class="d">Each fund house's named holdings (above 1%) summed across its schemes, compared with the previous quarter. Summing by fund house avoids false "new" or "exit" signals when a house moves shares between its own schemes. Click a row to see its stocks.</div><div class="tablewrap" id="tHouse"></div></div>
  <div class="card"><h2>Which fund is buying what</h2><div class="d">Named shareholders above 1% from the latest filings. "New" = crossed 1% this quarter; Δ = change in their stake. Search a fund house (e.g. Nippon, SBI, HDFC, Goldman, Norges) to see its positions.</div>
    <div class="controlsrow"><input id="hQ" placeholder="Search fund or stock…" value="${esc(st.ownQ)}" style="min-width:260px"><select id="hC"><option value="">All holder types</option>${['MF', 'FPI', 'Insurance', 'AIF', 'Pension fund', 'Sovereign fund', 'Corporate', 'FDI', 'Individual (HNI)'].map(c => `<option>${c}</option>`).join('')}</select>
    <select id="hF"><option value="">All</option><option value="new">New entries only</option><option value="add">Added stake</option><option value="cut">Cut stake / exited</option></select></div>
    <div class="tablewrap" id="tHold"></div></div>
  <div class="card"><h2>Ownership table</h2><div class="d">Latest quarter. Δ columns are change vs the previous quarter in percentage points. Click a column to sort.</div><div class="tablewrap" id="tOwn"></div></div>`;
  const hagg = {};
  uni().forEach(r => { const o = OWN[r.sym]; (o && o.houses || []).forEach(h => { const a = hagg[h.f] || (hagg[h.f] = { f: h.f, n: 0, add: 0, cut: 0, net: 0, newIn: [], out: [], top: [] }); if (h.p > 0) a.n++; a.net += h.d || 0; if (h.d > 0.05) { a.add++; a.top.push([r.sym, h.d]); } if (h.d < -0.05) a.cut++; if (h.new) a.newIn.push(r.sym); if (h.gone) a.out.push(r.sym); }); });
  const hrows = Object.values(hagg).map(a => ({ ...a, topS: a.top.sort((x, y) => y[1] - x[1]).slice(0, 5).map(x => `${x[0]} (+${x[1].toFixed(2)})`).join(', '), newS: a.newIn.slice(0, 8).join(', '), outS: a.out.slice(0, 8).join(', ') }));
  table($('#tHouse'), [{ k: 'f', h: 'Fund house', l: 1 }, { k: 'n', h: 'Stocks >1%' }, { k: 'add', h: 'Added', c: () => 'up' }, { k: 'cut', h: 'Cut', c: () => 'down' }, { k: 'net', h: 'Net Δ pp', f: fpp, c: pctC },
    { k: 'topS', h: 'Biggest adds', l: 1, wrap: 1 }, { k: 'newS', h: 'New positions', l: 1, wrap: 1 }, { k: 'outS', h: 'Exited / below 1%', l: 1, wrap: 1 }], hrows, { sort: 'net', sortKey: 'house' });
  $('#tHouse').querySelectorAll('tbody tr').forEach(tr => { tr.style.cursor = 'pointer'; tr.onclick = () => { const f = tr.cells[0].textContent; st.ownQ = f.split(' ')[0]; $('#hQ').value = st.ownQ; drawH(); $('#tHold').scrollIntoView({ block: 'center' }); }; });
  const bar = (id, k, asc) => { const l = U.filter(r => r[k] != null).sort((a, b) => asc ? a[k] - b[k] : b[k] - a[k]).slice(0, 12);
    mk(id, { type: 'bar', data: { labels: l.map(r => r.sym), datasets: [{ data: l.map(r => r[k]), backgroundColor: asc ? '#ef4444' : '#22c55e', borderRadius: 3 }] },
      options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: i => fpp(i.raw) } } }, scales: { x: { grid: { color: '#1b2532' } }, y: { ticks: { color: '#e6edf3', font: { family: "'IBM Plex Mono'" } }, grid: { display: false } } }, onClick: (e, els) => { if (els.length) select(l[els[0].index].sym, true); } } }); };
  bar('cMf', 'dmf'); bar('cFpi', 'dfpi'); bar('cProm', 'dprom', true);
  function drawH() {
    const q = st.ownQ.toLowerCase(), c = $('#hC').value, f = $('#hF').value;
    const rows = holderRows.filter(x => (!q || x.who.toLowerCase().includes(q) || x.sym.toLowerCase().includes(q)) && (!c || x.c === c) && (!f || (f === 'new' ? x.isNew : f === 'add' ? (x.d > 0 || x.isNew) : (x.d < 0 || x.exit))));
    table($('#tHold'), [{ k: 'who', h: 'Holder', l: 1, wrap: 1, f: (v, r) => esc(v) + (r.isNew ? ' <span class="pill b">NEW</span>' : '') + (r.exit ? ' <span class="pill s">BELOW 1%</span>' : '') }, { k: 'c', h: 'Type', l: 1 },
      { k: 'sym', h: 'Stock', l: 1, f: (v, r) => `<b style="font-family:var(--mono)">${esc(v)}</b><span class="tag ${r.i}">${r.i === 'S' ? 'SC' : 'MC'}</span>` }, { k: 'p', h: 'Stake', f: v => v ? v.toFixed(2) + '%' : '<1%' }, { k: 'd', h: 'Δ pp', f: (v, r) => r.isNew ? 'new' : fpp(v), c: (v, r) => r.isNew ? 'up' : pctC(v) }], rows, { sort: 'd', limit: 600, click: r => r.sym, sortKey: 'hold' });
  };
  drawH(); $('#hQ').oninput = e => { st.ownQ = e.target.value; drawH(); }; $('#hC').onchange = drawH; $('#hF').onchange = drawH;
  const dc = v => pctC(v);
  table($('#tOwn'), [{ k: 'sym', h: 'Stock', l: 1, f: stockCell }, { k: 'prom', h: 'Promoter', f: v => v == null ? '—' : v.toFixed(1) + '%' }, { k: 'dprom', h: 'Δ', f: fpp, c: dc },
    { k: 'fpi', h: 'FPI', f: v => v == null ? '—' : v.toFixed(1) + '%' }, { k: 'dfpi', h: 'Δ', f: fpp, c: dc }, { k: 'dii', h: 'DII', f: v => v == null ? '—' : v.toFixed(1) + '%' }, { k: 'ddii', h: 'Δ', f: fpp, c: dc },
    { k: 'mf', h: 'MF', f: v => v == null ? '—' : v.toFixed(1) + '%' }, { k: 'dmf', h: 'Δ', f: fpp, c: dc }, { k: 'pledge', h: 'Pledge', f: v => v ? v.toFixed(1) + '%' : '—', c: v => v > 0 ? 'down' : '' }, { k: st.per, h: PER[st.per], f: pctF, c: pctC }], U, { sort: 'dmf', click: r => r.sym, sortKey: 'own' });
}

// ------------------------------------------------------------------ SCREENS
const SCREENS = [
  { id: 'mom', name: 'Momentum leaders', desc: 'Top momentum score: 1M/3M/6M returns ranked within the index, plus closeness to the 52-week high.', f: r => r.mom >= 85, sort: 'mom' },
  { id: 'trend', name: 'Stage-2 trend template', desc: 'Above rising 200-day and 50-day averages, within 25% of the 52-week high, 30%+ above the low, strong relative strength.', f: r => r.a50 && r.a200 && r.d200up && r.fhi >= -25 && r.flo >= 30 && r.rs3m >= 70, sort: 'rs3m' },
  { id: 'brk', name: '52-week breakout on volume', desc: 'Within 2% of the 52-week high with volume at least 1.5× normal.', f: r => r.fhi >= -2 && r.vr >= 1.5 && r.hist >= 200, sort: 'vr' },
  { id: 'vol', name: 'Volume shock', desc: 'Volume 3× or more the 20-day average: news, results or a large investor at work.', f: r => r.vr >= 3, sort: 'vr' },
  { id: 'acc', name: 'Delivery accumulation (5D)', desc: 'Up over 5 days with today\'s delivery % well above normal and rising volume.', f: r => r.r5 > 2 && r.dp >= r.dp20 * 1.2 && r.vr >= 1.2, sort: 'dp' },
  { id: 'inst', name: 'Institutions buying + momentum', desc: 'FPI + MF stake up last quarter and momentum score 60+.', f: r => (r.dfpi || 0) + (r.dmf || 0) > 0.3 && r.mom >= 60, sort: 'dmf' },
  { id: 'ovs', name: 'Oversold in an uptrend', desc: 'RSI below 35 while still above the 200-day average: pullbacks in strong names.', f: r => r.rsi < 35 && r.a200, sort: 'rsi', dir: 1 },
  { id: 'lowvol', name: 'Quiet compounders', desc: 'Up over 6 months with below-median volatility.', f: (r, ctx) => r.r6m > 15 && r.vol != null && r.vol < ctx.medVol, sort: 'r6m' },
  { id: 'brkdn', name: 'Breakdowns', desc: 'Below falling 200-day average and within 5% of the 52-week low.', f: r => r.a200 === false && r.d200up === false && r.flo <= 5, sort: 'flo', dir: 1 },
  { id: 'prom', name: 'Promoter selling / pledge', desc: 'Promoter stake cut by more than 0.5 pp last quarter, or any promoter pledge.', f: r => r.dprom < -0.5 || r.pledge > 0, sort: 'dprom', dir: 1 },
];
function renderScreens() {
  const v = $('#v-screens'); const U = uni(); const ctx = { medVol: median(U.map(r => r.vol)) };
  const res = Object.fromEntries(SCREENS.map(s => [s.id, U.filter(r => { try { return s.f(r, ctx); } catch (e) { return false; } })]));
  const cur = SCREENS.find(s => s.id === st.screen) || SCREENS[0];
  v.innerHTML = `<div class="screens">${SCREENS.map(s => `<div class="scr ${s.id === cur.id ? 'on' : ''}" data-id="${s.id}"><span class="cnt">${res[s.id].length}</span><b>${s.name}</b><span>${s.desc}</span></div>`).join('')}</div>
    <div class="card"><h2>${cur.name} · ${uname()}</h2><div class="d">${cur.desc} Click a column to sort, or a row to open the stock.</div><div class="tablewrap" id="tScr" style="max-height:640px"></div></div>`;
  v.querySelectorAll('.scr').forEach(el => el.onclick = () => { st.screen = el.dataset.id; renderScreens(); });
  table($('#tScr'), [{ k: 'sym', h: 'Stock', l: 1, f: stockCell }, { k: 's', h: 'Sector', l: 1 }, { k: 'px', h: 'Price', f: v => fnum(v, 2) }, { k: 'r1', h: '1D', f: pctF, c: pctC }, { k: 'r1m', h: '1M', f: pctF, c: pctC }, { k: 'r3m', h: '3M', f: pctF, c: pctC },
    { k: 'r6m', h: '6M', f: pctF, c: pctC }, { k: 'mom', h: 'Mom', f: v => v ?? '—' }, { k: 'rs3m', h: 'RS', f: v => v ?? '—' }, { k: 'fhi', h: 'vs 52W hi', f: v => fmt(v) }, { k: 'vr', h: 'Vol ×', f: v => v == null ? '—' : v.toFixed(1) + '×' },
    { k: 'dp', h: 'Deliv %', f: v => v == null ? '—' : v.toFixed(0) + '%' }, { k: 'rsi', h: 'RSI', f: v => v == null ? '—' : v.toFixed(0) }, { k: 'dfpi', h: 'ΔFPI', f: fpp, c: pctC }, { k: 'dmf', h: 'ΔMF', f: fpp, c: pctC }, { k: 'dprom', h: 'ΔProm', f: fpp, c: pctC }],
    res[cur.id], { sort: cur.sort, dir: cur.dir || -1, click: r => r.sym, sortKey: 'scr-' + cur.id });
}

// ------------------------------------------------------------------ TERMINAL
const secSel = $('#tSec');
function fillSec() { const c = secSel.value; secSel.innerHTML = '<option value="">All sectors</option>' + [...new Set(S.map(r => r.s))].sort().map(s => `<option>${esc(s)}</option>`).join(''); secSel.value = c; }
function renderTerm() {
  const q = $('#q').value.trim().toLowerCase(), ix = $('#tIdx').value, [k, d] = $('#tSort').value.split(':'), sc = secSel.value;
  let fundHits = null;
  if (q.length >= 3) { fundHits = new Set(); Object.entries(OWN).forEach(([s, o]) => (o.holders || []).forEach(h => { if (h.n.toLowerCase().includes(q)) fundHits.add(s); })); }
  const L = S.filter(r => (ix === 'A' || r.i === ix) && (!sc || r.s === sc) && (!q || r.sym.toLowerCase().includes(q) || r.n.toLowerCase().includes(q) || r.s.toLowerCase().includes(q) || (fundHits && fundHits.has(r.sym))));
  L.sort((a, b) => { const x = a[k], y = b[k]; if (x == null) return 1; if (y == null) return -1; return typeof x === 'string' ? (d === 'a' ? 1 : -1) * x.localeCompare(y) : (d === 'a' ? 1 : -1) * (x - y); });
  $('#termList').innerHTML = L.map(r => `<div class="trow${r.sym === st.sel ? ' sel' : ''}" data-s="${esc(r.sym)}"><div style="min-width:0"><div class="s">${esc(r.sym)}<span class="tag ${r.i}">${r.i === 'S' ? 'SC' : 'MC'}</span></div><div class="c">${esc(r.n)} · ${esc(r.s)}</div></div><div class="r ${cls(r.r1)}">${fmt(r.r1)}</div><div class="r ${cls(r.r5)}">${fmt(r.r5)}</div></div>`).join('') || '<div class="empty">No match</div>';
}
$('#termList').addEventListener('click', e => { const row = e.target.closest('.trow'); if (row && row.dataset.s) select(row.dataset.s, false); });
['q', 'tIdx', 'tSort', 'tSec'].forEach(id => document.getElementById(id).addEventListener('input', renderTerm));

function select(sym, scroll) {
  const r = S.find(x => x.sym === sym); if (!r) return;
  st.sel = sym; const o = OWN[sym] || {}; const L = LINKS(sym);
  const deals = DL.filter(x => x.sym === sym).slice(0, 12);
  const box = $('#detail'); box.style.display = 'block';
  const m = (lbl, val, c = '') => `<div><small>${lbl}</small><b class="${c}">${val}</b></div>`;
  const now = o.now || {}, chg = o.chg || {};
  box.innerHTML = `<div class="dh"><div><div class="t">${esc(r.sym)} <span class="tag ${r.i}">${r.i === 'S' ? 'SMALLCAP 250' : 'MICROCAP 250'}</span></div><div class="c">${esc(r.n)} · ${esc(r.s)}</div></div><button class="x" title="Close">×</button></div>
  <div class="sec"><div class="mgrid">${m('Close', '₹' + fnum(r.px, 2))}${m('1D', fmt(r.r1), cls(r.r1))}${m('5D', fmt(r.r5), cls(r.r5))}${m('1M', fmt(r.r1m), cls(r.r1m))}${m('3M', fmt(r.r3m), cls(r.r3m))}${m('6M', fmt(r.r6m), cls(r.r6m))}${m('1Y', fmt(r.r1y), cls(r.r1y))}${m('Momentum', r.mom ?? '—')}</div></div>
  <div class="sec"><h4>Price, 6 months · 20 &amp; 50-day averages</h4><div style="height:170px;position:relative"><canvas id="cStk"></canvas></div><div style="height:60px;position:relative;margin-top:4px"><canvas id="cStkV"></canvas></div></div>
  <div class="sec"><h4>Technicals</h4><div class="mgrid">${m('52W high', fnum(r.hi52, 1))}${m('vs high', fmt(r.fhi), cls(r.fhi))}${m('52W low', fnum(r.lo52, 1))}${m('vs low', fmt(r.flo), cls(r.flo))}${m('RSI 14', r.rsi ?? '—')}${m('Volatility', r.vol == null ? '—' : r.vol.toFixed(0) + '%')}${m('> 50 DMA', r.a50 == null ? '—' : r.a50 ? 'Yes' : 'No', r.a50 ? 'up' : 'down')}${m('> 200 DMA', r.a200 == null ? '—' : r.a200 ? 'Yes' : 'No', r.a200 ? 'up' : 'down')}${m('Vol vs 20D', r.vr == null ? '—' : r.vr.toFixed(2) + '×')}${m('Delivery', r.dp == null ? '—' : r.dp.toFixed(0) + '%')}${m('Deliv 20D', r.dp20 == null ? '—' : r.dp20.toFixed(0) + '%')}${m('Turnover', '₹' + fnum(r.to, 1) + ' cr')}</div></div>
  <div class="sec"><h4>Shareholding ${o.date ? '· ' + fdate(o.date) : ''}</h4>${o.now ? `<div class="mgrid">${m('Promoter', (now.promoter ?? 0).toFixed(1) + '%')}${m('FPI', (now.fpi ?? 0).toFixed(1) + '%')}${m('MF', (now.mf ?? 0).toFixed(1) + '%')}${m('Insurance', (now.ins ?? 0).toFixed(1) + '%')}${m('Δ Promoter', fpp(chg.promoter), cls(chg.promoter))}${m('Δ FPI', fpp(chg.fpi), cls(chg.fpi))}${m('Δ MF', fpp(chg.mf), cls(chg.mf))}${m('Pledge', now.pledge ? now.pledge.toFixed(1) + '%' : '0%', now.pledge ? 'down' : '')}${m('Retail', (now.retail ?? 0).toFixed(1) + '%')}${m('HNI', (now.hni ?? 0).toFixed(1) + '%')}${m('Corporates', (now.corp ?? 0).toFixed(1) + '%')}${m('AIF', (now.aif ?? 0).toFixed(1) + '%')}</div>
    <h4 style="margin-top:10px">Largest named holders (above 1%)</h4>${(o.holders || []).map(h => `<div class="hold"><span class="hn" title="${esc(h.n)}"><span class="tag ${h.c === 'MF' ? 'MF' : h.c === 'FPI' ? 'FPI' : h.c === 'Insurance' ? 'Ins' : ''}">${esc(h.c)}</span> ${esc(h.n)}</span><span class="hp">${h.p.toFixed(2)}% ${h.d === null && o.prev_date ? '<span class="up">new</span>' : h.d != null ? `<span class="${cls(h.d)}">${h.d > 0 ? '+' : ''}${h.d.toFixed(2)}</span>` : ''}</span></div>`).join('') || '<div class="mut">No institution above 1%.</div>'}
    ${(o.houses || []).length ? `<h4 style="margin-top:10px">Mutual fund houses (sum of schemes above 1%)</h4>${o.houses.map(h => `<div class="hold"><span class="hn">${esc(h.f)}</span><span class="hp">${h.p.toFixed(2)}% <span class="${h.new ? 'up' : cls(h.d)}">${h.new ? 'new' : h.gone ? 'exited' : (h.d > 0 ? '+' : '') + h.d.toFixed(2)}</span></span></div>`).join('')}` : ''}
    ${(o.exited || []).length ? `<div class="mut" style="margin-top:6px;font-size:11.5px">Fell below 1%: ${o.exited.map(h => esc(h.n)).join('; ')}</div>` : ''}` : '<div class="mut">Shareholding not loaded yet for this stock.</div>'}</div>
  <div class="sec"><h4>Bulk &amp; block deals</h4>${deals.length ? deals.map(x => `<div class="hold"><span class="hn" title="${esc(x.who)}"><span class="pill ${x.side === 'B' ? 'b' : 's'}">${x.side === 'B' ? 'B' : 'S'}</span> ${esc(x.who)}</span><span class="hp">${x.d.slice(5)} · ₹${fnum(x.val, 1)} cr @ ${fnum(x.px, 1)}</span></div>`).join('') : '<div class="mut">None recorded since collection began.</div>'}</div>
  <div class="links"><a class="tv" href="${L.tv}" target="_blank" rel="noopener">Open candlestick chart on TradingView ↗</a><a href="${L.nse}" target="_blank" rel="noopener">NSE quote ↗</a><a href="${L.scr}" target="_blank" rel="noopener">Screener.in ↗</a><a href="${L.shp}" target="_blank" rel="noopener" style="grid-column:1/-1">NSE shareholding filings ↗</a></div>`;
  box.querySelector('.x').onclick = () => { box.style.display = 'none'; st.sel = null; renderTerm(); };
  const c = r.spark || [], n = c.length, sm = (w, i) => i + 1 >= w ? c.slice(i + 1 - w, i + 1).reduce((a, b) => a + b, 0) / w : null;
  const lbl = c.map((_, i) => i - n + 1);
  mk('cStk', { type: 'line', data: { labels: lbl, datasets: [{ data: c, borderColor: (r.r6m ?? 0) >= 0 ? '#22c55e' : '#ef4444', pointRadius: 0, borderWidth: 1.6, label: 'Close' }, { data: c.map((_, i) => sm(20, i)), borderColor: '#3b82f6', pointRadius: 0, borderWidth: 1, label: '20D' }, { data: c.map((_, i) => sm(50, i)), borderColor: '#f5a524', pointRadius: 0, borderWidth: 1, label: '50D' }] },
    options: { maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false, callbacks: { title: i => `${-i[0].label} sessions ago` } } }, scales: { x: { display: false }, y: { grid: { color: '#1b2532' }, ticks: { maxTicksLimit: 5 } } } } });
  const vv = r.vspark || [];
  mk('cStkV', { type: 'bar', data: { labels: vv.map((_, i) => i), datasets: [{ data: vv, backgroundColor: '#64748b' }] }, options: { maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } } } });
  renderTerm();
  if (scroll) { const el = document.querySelector(`.trow[data-s="${CSS.escape(sym)}"]`); if (el) el.scrollIntoView({ block: 'nearest' }); box.scrollTop = 0; }
}

// ------------------------------------------------------------------ boot
const h0 = location.hash.slice(1); if (h0 && document.querySelector(`#tabs button[data-t="${h0}"]`)) document.querySelector(`#tabs button[data-t="${h0}"]`).click();
loadAll(true);
