/* J.A.R.V.I.S. layer: briefing, live news wire, voice commands, command palette, boot */
'use strict';
Chart.defaults.color = '#6f9bb0';
Chart.defaults.font.family = "'Rajdhani', system-ui, sans-serif";
Chart.defaults.font.size = 12;

// ------------------------------------------------------------------ settings
const pref = (k, d) => { try { const v = localStorage.getItem('nt-' + k); return v == null ? d : v === '1'; } catch (e) { return d; } };
const setPref = (k, v) => { try { localStorage.setItem('nt-' + k, v ? '1' : '0'); } catch (e) { } };
$('#setVoice').checked = pref('voice', true); $('#setBoot').checked = pref('brief', true);
$('#setVoice').onchange = e => setPref('voice', e.target.checked);
$('#setBoot').onchange = e => setPref('brief', e.target.checked);

function openTab(t) { const b = document.querySelector(`#tabs button[data-t="${t}"]`); if (b) b.click(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function setSeg(id, key, v) { const b = document.querySelector(`#${id} button[data-v="${v}"]`); if (!b) return; document.querySelectorAll(`#${id} button`).forEach(x => x.classList.remove('on')); b.classList.add('on'); st[key] = v; }
function showBriefing(force) { if (force || pref('brief', true)) openTab('brief'); }
let firstLoad = true;
window.onDataLoaded = ({ fresh }) => { if (firstLoad) { firstLoad = false; endBoot(); if (!location.hash || location.hash === '#brief') showBriefing(); } else if (fresh) showBriefing(); if (st.view === 'brief') renderBrief(); };

// ------------------------------------------------------------------ NEWS
let NEWS = { items: [], sources: [] }, newsAt = 0, newsErr = '';
const seen = new Set(JSON.parse((() => { try { return localStorage.getItem('nt-seen') || '[]'; } catch (e) { return '[]'; } })()));
const nst = { c: '', tone: '', mine: false, q: '' };
const NEWS_MS = 5 * 60 * 1000;
let nextNews = Date.now() + NEWS_MS;
const newsURL = () => `https://raw.githubusercontent.com/${cfg.repo || 'ntacostar/nse-terminal'}/news/news.json`;
const ago = d => { const m = Math.round((Date.now() - new Date(d)) / 60000); return m < 1 ? 'now' : m < 60 ? m + 'm' : m < 1440 ? Math.floor(m / 60) + 'h' : Math.floor(m / 1440) + 'd'; };
const nkey = it => it.u || it.t;
async function loadNews() {
  nextNews = Date.now() + NEWS_MS;
  try {
    const r = await fetch(newsURL() + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('news ' + r.status);
    const j = await r.json();
    const fresh = NEWS.items.length && j.items.filter(it => !NEWS.items.some(o => nkey(o) === nkey(it)));
    NEWS = j; newsAt = Date.now(); newsErr = '';
    if (!seen.size) NEWS.items.forEach(it => seen.add(nkey(it)));
    renderTicker();
    if (st.view === 'news') renderNews(); if (st.view === 'brief') renderBrief();
    if (fresh && fresh.length) { const big = fresh.filter(x => x.imp >= 4); toast(`${fresh.length} new headline${fresh.length > 1 ? 's' : ''} on the wire${big.length ? ': ' + big[0].t : ''}`, 6000); }
  } catch (e) { newsErr = e.message; if (st.view === 'news') renderNews(); }
}
function markSeen() { NEWS.items.forEach(it => seen.add(nkey(it))); try { localStorage.setItem('nt-seen', JSON.stringify([...seen].slice(-1500))); } catch (e) { } }
function renderTicker() {
  const L = NEWS.items.filter(x => x.imp >= 3).slice(0, 40);
  $('#ticker').innerHTML = (L.length ? L : NEWS.items.slice(0, 30)).map((x, i) => `<span data-i="${i}"><b>${esc(x.c.toUpperCase())}</b>${esc(x.t)}${(x.sy || []).length ? ' · ' + x.sy.map(s => esc(s[0])).join(', ') : ''}</span>`).join('') || 'No headlines yet.';
  $('#ticker').onclick = e => { const sp = e.target.closest('span[data-i]'); if (!sp) return; const x = (L.length ? L : NEWS.items)[+sp.dataset.i]; if (x && x.sy && x.sy[0]) select(x.sy[0][0], true); else if (x) window.open(x.u, '_blank', 'noopener'); };
}
setInterval(() => { if (Date.now() >= nextNews && !document.hidden) loadNews(); if (st.view === 'news') { const el = $('#newsCd'); if (el) { const l = Math.max(0, nextNews - Date.now()); el.textContent = `${Math.floor(l / 60000)}:${String(Math.floor(l / 1000) % 60).padStart(2, '0')}`; } } }, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - newsAt > 60000) loadNews(); });

const stem = w => w.toLowerCase().replace(/(ies)$/, 'y').replace(/(es|s)$/, '');
function newsMatch(x, q) { if (!q) return true; const hay = (x.t + ' ' + (x.s || '') + ' ' + (x.sy || []).map(s => s[0]).join(' ')).toLowerCase(); return q.toLowerCase().split(/\s+/).filter(w => w.length > 1).every(w => hay.includes(stem(w))); }
const NCATS = ['Policy', 'Funds & Flows', 'Results', 'Corporate', 'Global', 'Markets'];
function newsItemHTML(x) {
  const isNew = !seen.has(nkey(x));
  return `<div class="nitem imp${x.imp}"><div class="tm">${ago(x.d)}<br>${new Date(x.d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</div><div>
    <a href="${esc(x.u)}" target="_blank" rel="noopener">${isNew ? '<span class="newdot">NEW </span>' : ''}${esc(x.t)}</a>
    ${x.s ? `<div class="sum">${esc(x.s.slice(0, 220))}${x.s.length > 220 ? '…' : ''}</div>` : ''}
    <div class="meta"><span class="badge ${esc(x.c.split(' ')[0])}">${esc(x.c)}</span><span class="dot ${x.tone}" title="${x.tone === 'pos' ? 'Positive tone' : x.tone === 'neg' ? 'Negative tone' : 'Neutral'}"></span><span>${esc(x.src)}${x.sec ? ' · ' + esc(x.sec) : ''}</span>
    ${'★'.repeat(Math.max(0, x.imp - 2))}${(x.sy || []).map(s => `<span class="tag ${s[1]}" style="cursor:pointer" data-sym="${esc(s[0])}">${esc(s[0])}</span>`).join('')}</div></div></div>`;
}
function bindSyms(el) { el.querySelectorAll('[data-sym]').forEach(t => t.onclick = e => { e.preventDefault(); select(t.dataset.sym, true); }); }
function renderNews() {
  const v = $('#v-news'); const q = nst.q.toLowerCase();
  const L = NEWS.items.filter(x => (!nst.c || x.c === nst.c) && (!nst.tone || x.tone === nst.tone) && (!nst.mine || (x.sy || []).length) && newsMatch(x, q));
  const cnt = c => NEWS.items.filter(x => x.c === c).length;
  const ok = (NEWS.sources || []).filter(s => s.n > 0), bad = (NEWS.sources || []).filter(s => !s.n);
  v.innerHTML = `<div class="insights"><h2>LIVE NEWS WIRE</h2><ul>
    <li>${NEWS.items.length} headlines from the last 3 days · wire refreshed ${NEWS.generated ? ago(NEWS.generated) + ' ago' : '—'} · next check in <b id="newsCd">—</b> ${newsErr ? `<span class="stale">(${esc(newsErr)})</span>` : ''}</li>
    <li>Sources live: ${ok.map(s => esc(s.src + (s.sec ? ' ' + s.sec : ''))).join(', ') || '—'}${bad.length ? ` · <span class="mut">silent: ${bad.map(s => esc(s.src + ' ' + s.sec)).join(', ')}</span>` : ''}</li>
    <li>Stock tags link to the terminal. ★ marks headlines most likely to move prices: policy moves, fund flows, results, orders, stake sales.</li></ul></div>
  <div class="newsbar"><button class="chip ${!nst.c ? 'on' : ''}" data-c="">All ${NEWS.items.length}</button>${NCATS.map(c => `<button class="chip ${nst.c === c ? 'on' : ''}" data-c="${c}">${c} ${cnt(c)}</button>`).join('')}</div>
  <div class="newsbar"><button class="chip ${nst.mine ? 'on' : ''}" id="nMine">Only my 500 stocks</button><button class="chip ${nst.tone === 'pos' ? 'on' : ''}" data-t="pos">▲ Positive</button><button class="chip ${nst.tone === 'neg' ? 'on' : ''}" data-t="neg">▼ Negative</button>
    <input id="nQ" placeholder="Search headlines…" value="${esc(nst.q)}" style="background:#04111b;color:var(--text);border:1px solid var(--line);border-radius:14px;padding:5px 12px;font:600 13px var(--sans);min-width:220px">
    <button class="btn ghost" id="nNow">⟳ Check now</button></div>
  <div class="card">${L.slice(0, 300).map(newsItemHTML).join('') || '<div class="empty">No headlines match.</div>'}</div>`;
  v.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { nst.c = b.dataset.c; renderNews(); });
  v.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { nst.tone = nst.tone === b.dataset.t ? '' : b.dataset.t; renderNews(); });
  $('#nMine').onclick = () => { nst.mine = !nst.mine; renderNews(); };
  $('#nQ').oninput = e => { nst.q = e.target.value; clearTimeout(renderNews._t); renderNews._t = setTimeout(() => { renderNews(); const i = $('#nQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 350); };
  $('#nNow').onclick = loadNews;
  bindSyms(v);
  setTimeout(markSeen, 4000);
}

// ------------------------------------------------------------------ BRIEFING
const crore = v => '₹' + (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-IN') : v.toFixed(1)) + ' cr';
function briefData() {
  const ok = S.filter(r => r.r1 != null);
  const up = ok.slice().sort((a, b) => b.r1 - a.r1), dn = ok.slice().sort((a, b) => a.r1 - b.r1);
  const big = ok.filter(r => Math.abs(r.r1) >= 8).sort((a, b) => Math.abs(b.r1) - Math.abs(a.r1));
  const shock = ok.filter(r => r.vr >= 3).sort((a, b) => b.vr - a.vr);
  const lastD = DL.length ? DL.reduce((m, x) => x.d > m ? x.d : m, DL[0].d) : null;
  const recent = DL.filter(x => lastD && x.d >= isoBack(lastD, 3));
  const dealsU = recent.filter(x => x.u).sort((a, b) => b.val - a.val);
  const instU = dealsU.filter(x => INSTCATS.includes(x.cat));
  const dealsAll = recent.slice().sort((a, b) => b.val - a.val);
  const highs = ok.filter(r => r.nh), lows = ok.filter(r => r.nl);
  const ownUp = S.filter(r => r.dfpi != null || r.dmf != null).map(r => ({ ...r, inst: (r.dfpi || 0) + (r.dmf || 0) })).sort((a, b) => b.inst - a.inst);
  const fd = (MK.fiidii || [])[0];
  const br = (MK.breadth || []).slice(-1)[0] || {};
  const ix = n => (MK.indices || []).find(x => x.name === n) || {};
  const news = NEWS.items.filter(x => x.imp >= 4 && Date.now() - new Date(x.d) < 36 * 36e5).slice(0, 10);
  return { ok, up, dn, big, shock, lastD, dealsU, instU, dealsAll, highs, lows, ownUp, fd, br, sc: ix('Nifty Smallcap 250'), mc: ix('Nifty Microcap 250'), n50: ix('Nifty 50'), vix: ix('India VIX'), news };
}
function isoBack(d, n) { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - n); return t.toISOString().slice(0, 10); }
function briefSpeech(B) {
  const p = [];
  const dir = v => v >= 0 ? `up ${v.toFixed(1)} percent` : `down ${(-v).toFixed(1)} percent`;
  if (B.sc.r1 != null) p.push(`Smallcap 250 closed ${dir(B.sc.r1)}, Microcap 250 ${dir(B.mc.r1 ?? 0)}, against the Nifty ${dir(B.n50.r1 ?? 0)}.`);
  if (B.br.S) p.push(`${B.br.S.adv} smallcaps advanced and ${B.br.S.dec} declined.`);
  if (B.up[0]) p.push(`Top gainer is ${B.up[0].n.replace(/ Ltd\.?| Limited/i, '')}, ${dir(B.up[0].r1)}. Worst is ${B.dn[0].n.replace(/ Ltd\.?| Limited/i, '')}, ${dir(B.dn[0].r1)}.`);
  if (B.shock.length) p.push(`${B.shock.length} stocks traded at three times normal volume or more, led by ${B.shock[0].sym}.`);
  if (B.instU[0]) { const x = B.instU[0]; p.push(`Biggest institutional deal: ${x.who} ${x.side === 'B' ? 'bought' : 'sold'} ${x.sym} worth ${Math.round(x.val)} crore.`); }
  if (B.fd && B.fd.FII) p.push(`FIIs were net ${B.fd.FII.net >= 0 ? 'buyers' : 'sellers'} of ${Math.abs(Math.round(B.fd.FII.net))} crore in cash; DIIs net ${B.fd.DII.net >= 0 ? 'bought' : 'sold'} ${Math.abs(Math.round(B.fd.DII.net))} crore.`);
  if (B.news[0]) p.push(`Top headline: ${B.news[0].t}.`);
  return p.join(' ');
}
function renderBrief() {
  const v = $('#v-brief');
  if (!S.length) { v.innerHTML = '<div class="empty">Loading market data…</div>'; return; }
  const B = briefData();
  const hr = new Date().toLocaleString('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' });
  const greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const A = [];
  const a = (k, html, cls_, sym) => A.push(`<div class="alert ${cls_ || ''}" ${sym ? `data-sym="${esc(sym)}"` : ''}><b class="k">${k}</b>${html}</div>`);
  if (B.up[0]) a('Top gainer', `<b>${esc(B.up[0].sym)}</b> ${esc(B.up[0].n)} <b class="up">${fmt(B.up[0].r1)}</b>${B.up[0].vr ? ` on ${B.up[0].vr.toFixed(1)}× volume` : ''}`, 'pos', B.up[0].sym);
  if (B.dn[0]) a('Top loser', `<b>${esc(B.dn[0].sym)}</b> ${esc(B.dn[0].n)} <b class="down">${fmt(B.dn[0].r1)}</b>${B.dn[0].vr ? ` on ${B.dn[0].vr.toFixed(1)}× volume` : ''}`, 'neg', B.dn[0].sym);
  if (B.big.length) a('Big moves (±8% or more)', `${B.big.length} stocks: ${B.big.slice(0, 6).map(r => `<span class="${cls(r.r1)}">${esc(r.sym)} ${fmt(r.r1, 0)}</span>`).join(', ')}`, 'hi');
  if (B.shock[0]) a('Volume shock', `<b>${esc(B.shock[0].sym)}</b> traded <b>${B.shock[0].vr.toFixed(1)}×</b> its 20-day volume (${fmt(B.shock[0].r1)}). ${B.shock.length - 1} more above 3×.`, 'hi', B.shock[0].sym);
  if (B.instU[0]) { const x = B.instU[0]; a('Largest institutional deal', `<b>${esc(x.who)}</b> ${x.side === 'B' ? '<span class="up">bought</span>' : '<span class="down">sold</span>'} <b>${esc(x.sym)}</b> · ${crore(x.val)} @ ₹${fnum(x.px, 1)} (${x.t}, ${x.d.slice(5)})`, x.side === 'B' ? 'pos' : 'neg', x.sym); }
  else if (B.dealsU[0]) { const x = B.dealsU[0]; a('Largest bulk/block deal', `<b>${esc(x.who)}</b> ${x.side === 'B' ? 'bought' : 'sold'} <b>${esc(x.sym)}</b> · ${crore(x.val)}`, '', x.sym); }
  if (B.fd && B.fd.FII) a('FII / DII cash', `FII <b class="${cls(B.fd.FII.net)}">${crore(B.fd.FII.net)}</b> · DII <b class="${cls(B.fd.DII.net)}">${crore(B.fd.DII.net)}</b> <span class="mut">(${fdate(B.fd.d)})</span>`, Math.abs(B.fd.FII.net) > 3000 ? 'hi' : '');
  if (B.br.S) { const s = B.br.S; a('Breadth · Smallcap 250', `<span class="up">${s.adv} up</span> / <span class="down">${s.dec} down</span> · ${s.a50 != null ? s.a50.toFixed(0) + '% above 50-DMA' : ''}${s.a50 >= 70 ? ' — <b>overheated</b>' : s.a50 <= 20 ? ' — <b>washed out</b>' : ''}`, s.a50 >= 70 || s.a50 <= 20 ? 'hi' : ''); }
  a('52-week extremes', `<span class="up">${B.highs.length} new highs</span>${B.highs.length ? ' (' + B.highs.slice(0, 5).map(r => esc(r.sym)).join(', ') + ')' : ''} · <span class="down">${B.lows.length} new lows</span>`);
  if (B.ownUp[0] && B.ownUp[0].inst > 0) a('Biggest institutional stake build (last quarter)', `<b>${esc(B.ownUp[0].sym)}</b> FPI+MF <b class="up">${fpp(B.ownUp[0].inst)}</b>; also ${B.ownUp.slice(1, 4).map(r => esc(r.sym) + ' ' + fpp(r.inst)).join(', ')}`, 'pos', B.ownUp[0].sym);
  if (B.news[0]) a('Top headline', `${esc(B.news[0].t)} <span class="mut">· ${esc(B.news[0].src)}, ${ago(B.news[0].d)} ago</span>`, 'hi', (B.news[0].sy || [])[0] ? B.news[0].sy[0][0] : '');
  const row = (r, k = 'r1') => `<div class="row" data-sym="${esc(r.sym)}"><span class="a"><b style="font-family:var(--mono)">${esc(r.sym)}</b><span class="tag ${r.i}">${r.i === 'S' ? 'SC' : 'MC'}</span> <span class="mut">${esc(r.s)}</span></span><span class="b ${cls(r[k])}">${fmt(r[k])}</span></div>`;
  const deal = x => `<div class="row" data-sym="${esc(x.sym)}"><span class="a"><span class="pill ${x.side === 'B' ? 'b' : 's'}">${x.side === 'B' ? 'BUY' : 'SELL'}</span> <b style="font-family:var(--mono)">${esc(x.sym)}</b> <span class="mut" title="${esc(x.who)}">${esc(x.who)}</span></span><span class="b">${crore(x.val)}</span></div>`;
  v.innerHTML = `
  <div class="hero"><div class="reactor mid"><i></i><i></i><i></i><b></b></div><div>
    <h1>${greet}. Here is your briefing.</h1>
    <p>${esc(briefSpeech(B))}</p>
    <div class="acts"><button class="btn accent" id="bSpeak">🔊 Read it to me</button><button class="btn" id="bTalk">🎙 Give a command</button><button class="btn ghost" id="bNews">Open the news wire →</button></div>
    <div class="mut" style="font-size:12.5px;margin-top:6px">Prices as of ${fdate(META.asof)} close · news wire ${NEWS.generated ? ago(NEWS.generated) + ' old' : 'loading'}</div></div></div>
  <div class="alerts">${A.join('')}</div>
  <div class="grid3">
    <div class="card"><h2>Top gainers · 1D</h2><div class="mini">${B.up.slice(0, 10).map(r => row(r)).join('')}</div></div>
    <div class="card"><h2>Top losers · 1D</h2><div class="mini">${B.dn.slice(0, 10).map(r => row(r)).join('')}</div></div>
    <div class="card"><h2>Volume shocks</h2><div class="mini">${B.shock.slice(0, 10).map(r => `<div class="row" data-sym="${esc(r.sym)}"><span class="a"><b style="font-family:var(--mono)">${esc(r.sym)}</b> <span class="${cls(r.r1)}">${fmt(r.r1)}</span></span><span class="b">${r.vr.toFixed(1)}× · ${r.dp != null ? r.dp.toFixed(0) + '% deliv' : ''}</span></div>`).join('') || '<div class="mut">Nothing above 3× today.</div>'}</div></div>
  </div>
  <div class="grid2">
    <div class="card"><h2>Biggest bulk &amp; block deals · your 500</h2><div class="d">Last few sessions to ${fdate(B.lastD)}, by value</div><div class="mini">${B.dealsU.slice(0, 10).map(deal).join('') || '<div class="mut">No deals in these stocks in the last few sessions.</div>'}</div></div>
    <div class="card"><h2>Biggest deals · all NSE</h2><div class="d">The largest negotiated and bulk trades market-wide</div><div class="mini">${B.dealsAll.slice(0, 10).map(deal).join('')}</div></div>
  </div>
  <div class="grid2">
    <div class="card"><h2>Price-moving headlines</h2><div class="d">★ high-impact items from the last 36 hours</div>${B.news.slice(0, 6).map(newsItemHTML).join('') || '<div class="mut">Waiting for the news wire…</div>'}</div>
    <div class="card"><h2>Smart money: stake builds &amp; cuts</h2><div class="d">Change in FPI + MF holding last quarter (percentage points)</div><div class="mini">${B.ownUp.slice(0, 6).map(r => `<div class="row" data-sym="${esc(r.sym)}"><span class="a"><b style="font-family:var(--mono)">${esc(r.sym)}</b> <span class="mut">${esc(r.n)}</span></span><span class="b up">${fpp(r.inst)}</span></div>`).join('')}${B.ownUp.slice(-4).reverse().map(r => `<div class="row" data-sym="${esc(r.sym)}"><span class="a"><b style="font-family:var(--mono)">${esc(r.sym)}</b> <span class="mut">${esc(r.n)}</span></span><span class="b down">${fpp(r.inst)}</span></div>`).join('')}</div></div>
  </div>`;
  bindSyms(v);
  $('#bSpeak').onclick = () => say(briefSpeech(B), true);
  $('#bTalk').onclick = () => listenOnce();
  $('#bNews').onclick = () => openTab('news');
}

// news inside the stock detail
const _select = select;
select = function (sym, scroll) {
  _select(sym, scroll);
  const box = $('#detail'), L = NEWS.items.filter(x => (x.sy || []).some(s => s[0] === sym)).slice(0, 8);
  const links = box.querySelector('.links'); if (!links) return;
  const sec = document.createElement('div'); sec.className = 'sec';
  sec.innerHTML = `<h4>News &amp; filings · last 3 days</h4>${L.length ? L.map(x => `<div class="hold"><a class="hn" href="${esc(x.u)}" target="_blank" rel="noopener" title="${esc(x.t)}" style="text-decoration:none"><span class="dot ${x.tone}"></span> ${esc(x.t)}</a><span class="hp mut">${ago(x.d)}</span></div>`).join('') : '<div class="mut">No headlines tagged to this stock.</div>'}`;
  links.before(sec);
};

// ------------------------------------------------------------------ VOICE
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false, wake = false, oneShot = false;
function pickVoice() { const vs = speechSynthesis.getVoices(); return vs.find(v => /Daniel|UK English Male|en-GB.*Male/i.test(v.name)) || vs.find(v => v.lang === 'en-GB') || vs.find(v => v.lang === 'en-IN') || vs.find(v => /^en/.test(v.lang)); }
function say(text, force) {
  hud(null, null, text);
  if (!('speechSynthesis' in window) || (!force && !$('#setVoice').checked)) return;
  speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); const v = pickVoice(); if (v) u.voice = v; u.rate = 1.03; u.pitch = .95; speechSynthesis.speak(u);
}
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => { };
let hudT;
function hud(state, heard, reply, keep) {
  const h = $('#hud'); h.classList.remove('hidden');
  if (state != null) $('#hudState').textContent = state;
  if (heard != null) $('#hudHeard').textContent = heard;
  if (reply != null) $('#hudReply').textContent = reply;
  h.querySelector('.reactor').classList.toggle('listening', listening);
  $('#orb').classList.toggle('listening', listening);
  clearTimeout(hudT); if (!keep && !listening) hudT = setTimeout(() => h.classList.add('hidden'), 9000);
}
$('#hud').onclick = () => { $('#hud').classList.add('hidden'); if (oneShot && rec) rec.abort(); };
function makeRec() {
  const r = new SR(); r.lang = 'en-IN'; r.interimResults = true; r.maxAlternatives = 1; r.continuous = wake;
  r.onresult = e => {
    const res = e.results[e.results.length - 1], txt = res[0].transcript.trim();
    if (wake && !oneShot) {
      if (!/\bjarvis\b|\bjervis\b|\bjarvi\b/i.test(txt)) return;
      hud('Listening…', txt, '', true);
      if (res.isFinal) { const cmd = txt.replace(/^.*?\b(jarvis|jervis|jarvi)\b[\s,]*/i, ''); if (cmd) act(cmd); else { say('Yes?'); } }
      return;
    }
    hud('Listening…', txt, '', true);
    if (res.isFinal) act(txt);
  };
  r.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { wake = false; $('#wakeChk').checked = false; hud('Microphone blocked', '', 'Allow microphone access for this site in the browser, then try again. You can also type commands with Ctrl+K.'); } else if (e.error === 'no-speech' && oneShot) hud('Standing by', '', 'I did not hear anything. Click the reactor or press J to try again.'); };
  r.onend = () => { listening = false; $('#orb').classList.remove('listening'); $('#hud .reactor').classList.remove('listening'); if (wake) { setTimeout(() => { try { oneShot = false; rec = makeRec(); rec.start(); listening = true; } catch (e) { } }, 400); } };
  return r;
}
function listenOnce() {
  if (!SR) { openPalette(); toast('Voice needs Chrome, Edge or Safari. Type your command instead.', 6000); return; }
  try { if (rec) rec.abort(); } catch (e) { }
  speechSynthesis && speechSynthesis.cancel();
  oneShot = true; const prevWake = wake; wake = false;
  rec = makeRec(); rec.onend = () => { listening = false; $('#orb').classList.remove('listening'); $('#hud .reactor').classList.remove('listening'); wake = prevWake; if (wake) startWake(); };
  try { rec.start(); listening = true; hud('Listening…', '', '', true); } catch (e) { }
}
function startWake() { if (!SR) return; wake = true; oneShot = false; try { if (rec) rec.abort(); } catch (e) { } rec = makeRec(); try { rec.start(); listening = true; $('#orb').classList.add('listening'); } catch (e) { } }
$('#orb').onclick = listenOnce;
$('#wakeChk').onchange = e => { if (e.target.checked) { if (!SR) { e.target.checked = false; toast('This browser has no speech recognition. Use Chrome or Edge.'); return; } startWake(); toast('Wake word on. Say "Jarvis" followed by a command.', 5000); } else { wake = false; try { rec && rec.abort(); } catch (e) { } } };

// ------------------------------------------------------------------ COMMANDS
const nrm = s => String(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(ltd|limited|the|india|of|co|company|corp|corporation|industries|inds)\b/g, ' ').replace(/\s+/g, ' ').trim();
const NUM = { one: 1, two: 2, three: 3, five: 5, six: 6, fifteen: 15 };
function findStock(q) {
  q = nrm(q); if (!q) return null; const flat = q.replace(/ /g, '').toUpperCase();
  let r = S.find(x => x.sym.replace(/[^A-Z0-9]/g, '') === flat); if (r) return r;
  r = S.find(x => nrm(x.n) === q) || S.find(x => nrm(x.n).startsWith(q)) || (q.length >= 4 && S.find(x => nrm(x.n).includes(q))); if (r) return r;
  const qw = new Set(q.split(' ')); let best = null, bs = 0;
  S.forEach(x => { const w = nrm(x.n).split(' ').filter(t => t.length >= 3); if (!w.length) return; const hit = w.filter(t => qw.has(t)).length; const sc = hit / w.length + (qw.has(w[0]) ? .5 : 0); if (hit && sc > bs) { bs = sc; best = x; } });
  return bs >= .9 ? best : null;
}
const TABS = [[/brief|highlight|summary|what.?s (happening|up|new)|catch me up|overview|morning|update me/, 'brief'], [/news|headline|wire/, 'news'], [/pulse|breadth|market|index|indices|vix|fii|dii|flow/, 'pulse'], [/mover|gainer|loser|top|bottom|heat ?map/, 'movers'],
  [/sector|rotation|theme/, 'sectors'], [/smart money|deal|bulk|block|accumulat|distribut|institution/, 'smart'], [/owner|sharehold|holder|promoter|pledge|mutual fund|fund house/, 'own'], [/screen|scan|breakout|momentum|trend|oversold|compounder|breakdown/, 'screens']];
function act(raw) {
  const reply = runCommand(raw);
  hud('Done', raw, reply);
  say(reply);
}
function runCommand(raw) {
  let t = ' ' + raw.toLowerCase().replace(/\b(hey|ok|okay|please|jarvis|can you|could you|would you|for me|now)\b/g, ' ').replace(/[?.!,]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  if (!t.trim()) return 'Yes?';
  if (/what can you do|\bhelp\b|\bcommands\b/i.test(raw)) t = ' help ';
  if (/\b(stop|cancel|close|never ?mind|quiet|shut up)\b/.test(t)) { speechSynthesis && speechSynthesis.cancel(); $('#hud').classList.add('hidden'); $('#palette').classList.add('hidden'); return 'Standing by.'; }
  if (/\bhelp\b|what can you do/.test(t)) return 'You can say: briefing; open news, movers, sectors, smart money, ownership or screens; microcap or smallcap; one day, five day or one month; show a stock by name; chart a stock; who is buying a stock; news about a topic; refresh; or update from NSE.';
  if (/\bupdate\b.*\b(nse|data|fresh)|fetch (fresh|new|latest)|run (the )?(job|update)/.test(t)) { $('#btnUpdate').click(); return 'Asking GitHub to pull fresh data from NSE. It takes three to five minutes and I will load it automatically.'; }
  if (/\b(refresh|reload)\b/.test(t)) { $('#btnReload').click(); return 'Refreshing. Opening your briefing.'; }
  if (/\b(read|speak|tell me|give me)\b.*\b(brief|highlight|summary)|\bbrief me\b|what.?s happening|catch me up/.test(t)) { openTab('brief'); return briefSpeech(briefData()); }
  // universe and period
  let changed = [];
  if (/\bmicro ?cap/.test(t)) { setSeg('segIdx', 'idx', 'M'); changed.push('Microcap 250'); }
  else if (/\bsmall ?cap/.test(t)) { setSeg('segIdx', 'idx', 'S'); changed.push('Smallcap 250'); }
  else if (/\b(both|all) (indices|indexes|universes|stocks)\b/.test(t)) { setSeg('segIdx', 'idx', 'A'); changed.push('both indices'); }
  const pm = t.match(/\b(1|one|5|five|15|fifteen|3|three|6|six)?[ -]?(day|days|week|month|months|year|quarter)\b/) || (/\btoday\b/.test(t) ? [0, '1', 'day'] : null);
  if (pm) { const n = NUM[pm[1]] || +pm[1] || 1, u = pm[2]; const p = /day/.test(u) ? (n >= 15 ? 'r15' : n >= 5 ? 'r5' : 'r1') : u === 'week' ? 'r5' : /month/.test(u) ? (n >= 6 ? 'r6m' : n >= 3 ? 'r3m' : 'r1m') : u === 'quarter' ? 'r3m' : 'r1y'; setSeg('segPer', 'per', p); changed.push(PER[p]); }
  // news about X
  const nm = t.match(/\b(news|headlines?)\b(?: (?:on|about|for|regarding|related to))? (.+)$/);
  if (/\b(news|headline|wire)\b/.test(t)) {
    const cat = NCATS.find(c => t.includes(c.split(' ')[0].toLowerCase())) || (/\bpolic|government|rbi|sebi|budget\b/.test(t) ? 'Policy' : /\bfund|fii|dii|flow\b/.test(t) ? 'Funds & Flows' : /\bresult|earning\b/.test(t) ? 'Results' : '');
    nst.c = cat; nst.q = '';
    if (nm && !cat) { const topic = nm[2].replace(/\b(news|latest|today|the)\b/g, '').trim(); const stx = findStock(topic); nst.q = stx ? stx.sym : topic; }
    openTab('news'); markSeen();
    const n = NEWS.items.filter(x => (!nst.c || x.c === nst.c) && newsMatch(x, nst.q));
    return n.length ? `${n.length} headlines${nst.c ? ' in ' + nst.c : ''}${nst.q ? ' on ' + nst.q : ''}. Latest: ${n[0].t}.` : `Nothing on the wire${nst.q ? ' about ' + nst.q : ''} in the last three days.`;
  }
  // who is buying / holders of X
  const wb = t.match(/\b(who (?:is|are|s) (?:buying|selling|holding|in)|holders? (?:of|in)|shareholding (?:of|in|for)|deals? (?:in|for|of)|stake in)\b (.+)$/);
  if (wb) {
    const r = findStock(wb[2]);
    if (!r) {
      const q = nrm(wb[2]); const hits = DL.filter(x => nrm(x.nm).includes(q) || nrm(x.who).includes(q) || x.sym.toLowerCase() === q.replace(/ /g, ''));
      if (!hits.length) return `I couldn't find ${wb[2].trim()} among the 500 stocks or in recent bulk and block deals.`;
      const bySym = hits.every(x => x.sym === hits[0].sym);
      st.dealQ = bySym ? hits[0].sym : wb[2].trim(); st.dealScope = 'A'; st.dealCat = ''; st.dealSide = ''; openTab('smart');
      const buys = hits.filter(x => x.side === 'B' && x.cat !== 'Broker/Prop').sort((a, b) => b.val - a.val).slice(0, 3);
      return `${bySym ? hits[0].nm : wb[2].trim()} is outside the two indices, but it shows up in ${hits.length} bulk or block deals. ${buys.length ? 'Biggest buyers: ' + buys.map(x => `${x.who}, ${Math.round(x.val)} crore`).join('; ') + '.' : ''}`;
    }
    select(r.sym, true); const o = OWN[r.sym] || {}; const d = DL.filter(x => x.sym === r.sym);
    if (/deal|buying|selling/.test(wb[1])) { st.dealQ = r.sym; st.dealScope = 'A'; openTab('smart'); }
    const top = (o.holders || []).filter(h => h.c !== 'Promoter').slice(0, 3).map(h => `${h.n} ${h.p.toFixed(1)} percent`);
    const dd = d.slice(0, 2).map(x => `${x.who} ${x.side === 'B' ? 'bought' : 'sold'} ${Math.round(x.val)} crore on ${x.d.slice(5)}`);
    return `${r.n}. ${top.length ? 'Largest outside holders: ' + top.join('; ') + '.' : 'No institution above one percent.'} ${o.chg ? `Last quarter FPI ${o.chg.fpi >= 0 ? 'up' : 'down'} ${Math.abs(o.chg.fpi || 0).toFixed(2)} points, mutual funds ${o.chg.mf >= 0 ? 'up' : 'down'} ${Math.abs(o.chg.mf || 0).toFixed(2)}.` : ''} ${dd.length ? 'Recent deals: ' + dd.join('; ') + '.' : 'No bulk or block deals recorded.'}`;
  }
  // screens by name
  const SKW = [['brk', /breakout/], ['mom', /momentum lead|momentum stock|momentum screen/], ['trend', /stage ?2|trend template|uptrend/], ['vol', /volume shock|unusual volume/], ['acc', /accumulation/], ['inst', /institutions? buying/],
    ['ovs', /oversold|pullback/], ['lowvol', /quiet|compounder|low vol/], ['brkdn', /breakdown/], ['prom', /pledge|promoter sell/]];
  const sk = SKW.find(([, re]) => re.test(t));
  if (sk) { const scr = SCREENS.find(x => x.id === sk[0]); st.screen = scr.id; openTab('screens'); const ctx = { medVol: median(uni().map(r => r.vol)) }; const n = uni().filter(r => { try { return scr.f(r, ctx); } catch (e) { return false; } }); return `${scr.name}: ${n.length} stocks in the ${uname()}${n.length ? ', including ' + n.slice(0, 3).map(r => r.sym).join(', ') : ''}.`; }
  // chart / show stock
  const sm = t.match(/\b(chart|show|open|pull up|find|search|stock|look up|tell me about|how is|how s|what about)\b (.+)$/);
  if (sm) {
    const target = sm[2].replace(/\b(stock|share|shares|chart|price|doing|tab|view|page|section|palette|on tradingview|in tradingview)\b/g, ' ').trim();
    const tabHit = TABS.find(([re]) => re.test(' ' + target + ' '));
    const r = !tabHit || target.split(' ').length > 2 ? findStock(target) : null;
    if (r) {
      select(r.sym, true);
      if (sm[1] === 'chart' || /tradingview|candle/.test(t)) { const w = window.open(LINKS(r.sym).tv, '_blank', 'noopener'); if (!w) toast('Your browser blocked the chart window: use the TradingView button in the terminal.', 6000); }
      return `${r.n}, ${r.s}. ₹${fnum(r.px, 2)}, ${r.r1 >= 0 ? 'up' : 'down'} ${Math.abs(r.r1 ?? 0).toFixed(1)} percent today, ${r.r1m >= 0 ? 'up' : 'down'} ${Math.abs(r.r1m ?? 0).toFixed(1)} percent over a month. Momentum score ${r.mom ?? 'not available'}${r.vr >= 2 ? `, volume ${r.vr.toFixed(1)} times normal` : ''}.`;
    }
  }
  // tabs
  const tb = TABS.find(([re]) => re.test(t));
  if (tb) {
    openTab(tb[1]);
    if (tb[1] === 'movers') { const U = uni().filter(r => r[st.per] != null).sort((a, b) => b[st.per] - a[st.per]); const lose = /loser|bottom|worst|fall/.test(t); const L = lose ? U.slice(-3).reverse() : U.slice(0, 3); return `${lose ? 'Top losers' : 'Top gainers'}, ${uname()}, ${PER[st.per]}: ${L.map(r => `${r.sym} ${fmt(r[st.per])}`).join(', ')}.`; }
    if (tb[1] === 'brief') return briefSpeech(briefData());
    return `Opening ${document.querySelector(`#tabs button[data-t="${tb[1]}"]`).textContent.replace('◆ ', '')}${changed.length ? ' for ' + changed.join(', ') : ''}.`;
  }
  if (changed.length) { renderAll(); return 'Switched to ' + changed.join(', ') + '.'; }
  const r = findStock(t); if (r) { select(r.sym, true); return `${r.n}: ${fmt(r.r1)} today, ${fmt(r.r1m)} over a month.`; }
  return `I didn't catch a command in "${raw.trim()}". Say help for examples.`;
}

// ------------------------------------------------------------------ COMMAND PALETTE
const PCMDS = [['Briefing — today\'s highlights', 'briefing'], ['Read the briefing aloud', 'read the briefing'], ['Open news wire', 'open news'], ['Policy news', 'policy news'], ['Fund-flow news', 'funds news'], ['Results news', 'results news'],
  ['Market pulse', 'open market pulse'], ['Top gainers', 'top gainers'], ['Top losers', 'top losers'], ['Sector rotation', 'open sectors'], ['Smart money: bulk & block deals', 'open smart money'], ['Ownership & fund houses', 'open ownership'],
  ['Screens', 'open screens'], ...SCREENS.map(s => ['Screen: ' + s.name, 'screen ' + s.name.toLowerCase()]), ['Switch to Microcap 250', 'microcap'], ['Switch to Smallcap 250', 'smallcap'], ['Both indices', 'both indices'],
  ['Period: 1 day', '1 day'], ['Period: 5 days', '5 day'], ['Period: 15 days', '15 day'], ['Period: 1 month', '1 month'], ['Period: 3 months', '3 month'], ['Period: 1 year', '1 year'],
  ['Refresh data', 'refresh'], ['Update from NSE now', 'update from nse'], ['Settings', '__settings'], ['Talk to Jarvis (voice)', '__voice']];
let pSel = 0, pItems = [];
function openPalette() { $('#palette').classList.remove('hidden'); $('#pIn').value = ''; drawPalette(); setTimeout(() => $('#pIn').focus(), 20); }
function drawPalette() {
  const q = $('#pIn').value.trim().toLowerCase();
  const cmds = PCMDS.filter(c => !q || c[0].toLowerCase().includes(q) || c[1].includes(q)).map(c => ({ l: c[0], cmd: c[1], k: 'command' }));
  const stks = q.length >= 2 ? S.filter(r => r.sym.toLowerCase().includes(q) || r.n.toLowerCase().includes(q)).slice(0, 8).map(r => ({ l: `${r.sym} · ${r.n}`, sym: r.sym, k: `${fmt(r.r1)} · ${r.i === 'S' ? 'SC' : 'MC'}` })) : [];
  pItems = [...stks, ...cmds].slice(0, 14);
  if (q && !pItems.length) pItems = [{ l: `Run “${q}”`, cmd: q, k: 'ask Jarvis' }];
  pSel = Math.min(pSel, pItems.length - 1); if (pSel < 0) pSel = 0;
  $('#pList').innerHTML = pItems.map((p, i) => `<div class="${i === pSel ? 'on' : ''}" data-i="${i}"><span>${esc(p.l)}</span><small>${esc(p.k)}</small></div>`).join('');
}
function runPalette(i) {
  const p = pItems[i]; const q = $('#pIn').value.trim(); $('#palette').classList.add('hidden');
  if (!p) { if (q) act(q); return; }
  if (p.sym) { select(p.sym, true); return; }
  if (p.cmd === '__settings') return $('#btnSettings').click();
  if (p.cmd === '__voice') return listenOnce();
  const reply = runCommand(p.cmd); hud('Done', p.l, reply); if (/read/.test(p.cmd)) say(reply, true);
}
$('#pIn').oninput = () => { pSel = 0; drawPalette(); };
$('#pIn').onkeydown = e => {
  if (e.key === 'ArrowDown') { pSel = Math.min(pItems.length - 1, pSel + 1); drawPalette(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { pSel = Math.max(0, pSel - 1); drawPalette(); e.preventDefault(); }
  else if (e.key === 'Enter') runPalette(pSel);
  else if (e.key === 'Escape') $('#palette').classList.add('hidden');
};
$('#pList').onclick = e => { const d = e.target.closest('[data-i]'); if (d) runPalette(+d.dataset.i); };
$('#palette').onclick = e => { if (e.target.id === 'palette') $('#palette').classList.add('hidden'); };
$('#btnCmd').onclick = openPalette;
document.addEventListener('keydown', e => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  else if (!typing && e.key === '/') { e.preventDefault(); openPalette(); }
  else if (!typing && (e.key === 'j' || e.key === 'J') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); listenOnce(); }
  else if (e.key === 'Escape') { $('#hud').classList.add('hidden'); $('#modal').classList.add('hidden'); }
});

// ------------------------------------------------------------------ BOOT
const BOOT = ['Initialising market systems…', 'Loading 500 stocks from NSE end-of-day files…', 'Reading bulk & block deals and FII/DII flows…', 'Connecting to the live news wire…', 'Compiling your briefing…'];
let bi = 0; const biv = setInterval(() => { bi = (bi + 1) % BOOT.length; $('#bootLine').textContent = BOOT[bi]; }, 600);
function endBoot() { clearInterval(biv); $('#boot').classList.add('done'); setTimeout(() => $('#boot').remove(), 700); }
setTimeout(() => { if ($('#boot')) endBoot(); }, 6000);
const h0 = location.hash.slice(1);
if (h0 && h0 !== 'brief' && document.querySelector(`#tabs button[data-t="${h0}"]`)) document.querySelector(`#tabs button[data-t="${h0}"]`).click(); else renderBrief();
loadNews();
loadAll(true);
