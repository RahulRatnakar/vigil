(()=>{
const VER = 21;
// same version already running: just show/hide it; an older copy gets replaced
if (window.__cwD) { if (window.__cwD.ver === VER) { window.__cwD.toggle(); return; } try { window.__cwD.stop(); } catch (e) {} }
const EVERY = 30, HOUR = 3600e3, DAY = 24 * HOUR;
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const docs = () => { const a = [document]; const walk = d => d.querySelectorAll('iframe').forEach(f => { try { const c = f.contentDocument; if (c) { a.push(c); walk(c); } } catch (e) {} }); walk(document); return a; };
const leaves = (d, re) => [...d.querySelectorAll('*')].filter(e => e.children.length === 0 && re.test(e.textContent.trim()));
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = n => Number(n).toLocaleString();
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; };
const parseSla = s => { const m = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(s || ''); if (!m) return null; const d = new Date(); let y = m[3] ? +m[3] : d.getFullYear(); if (y < 100) y += 2000; let h = +m[4] % 12; if (/pm/i.test(m[6])) h += 12; const r = new Date(y, m[1] - 1, +m[2], h, +m[5]); if (!m[3] && d - r > 180 * DAY) r.setFullYear(y + 1); return r.getTime(); };
const parseD = s => { const m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s || ''); if (!m) return null; let y = +m[3]; if (y < 100) y += 2000; return new Date(y, m[1] - 1, +m[2]).getTime(); };
const hue = c => { const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(c || ''); if (!m) return null; const r = m[1] / 255, g = m[2] / 255, b = m[3] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx - mn < .15) return null; const h = mx === r ? (g - b) / (mx - mn) : mx === g ? 2 + (b - r) / (mx - mn) : 4 + (r - g) / (mx - mn); return (h * 60 + 360) % 360; };

// average colour of the saturated pixels in a picture (CW may draw the priority square as an image)
const IMGC = new Map(); let PRDIAG = '';
const picColor = im => {
  if (!im.naturalWidth) return '';
  try {
    const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d'); g.drawImage(im, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data; let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 128) continue; const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); if (mx - mn < 50) continue; r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
    return n ? `rgb(${r / n | 0}, ${gg / n | 0}, ${b / n | 0})` : '';
  } catch (e) { return ''; }
};
const urlColor = u => { if (IMGC.has(u)) return IMGC.get(u); IMGC.set(u, ''); const im = new Image(); im.onload = () => IMGC.set(u, picColor(im)); im.src = u; return ''; };
// the priority colour, wherever CW puts it: a coloured box, a ::before square, a border, an SVG, a gradient or a picture
const prColor = (pc, win) => {
  for (const el of [...pc.querySelectorAll('*'), pc]) {
    const cs = win.getComputedStyle(el), bf = win.getComputedStyle(el, '::before'), af = win.getComputedStyle(el, '::after');
    const vals = el === pc ? [cs.borderLeftColor, bf.backgroundColor, af.backgroundColor] : [cs.backgroundColor, bf.backgroundColor, af.backgroundColor, cs.borderLeftColor, cs.borderTopColor, cs.fill, cs.stroke, cs.color];
    for (const v of vals) if (hue(v) != null) return v;
    if (el.tagName === 'IMG') { const c = el.complete ? picColor(el) : urlColor(el.src); if (hue(c) != null) return c; }
    for (const bi of [cs.backgroundImage, bf.backgroundImage]) {
      if (!bi || bi === 'none') continue;
      const m = bi.match(/rgba?\([^)]+\)/); if (m && hue(m[0]) != null) return m[0];
      const u = bi.match(/url\(["']?([^"')]+)/); if (u) { const c = urlColor(u[1]); if (hue(c) != null) return c; }
    }
  }
  return '';
};

// Meriplex priorities by the colour name in CW's urgency picture
const prFromName = n => { const k = String(n).toLowerCase(); return /magenta|fuchsia|purple|violet|pink/.test(k) ? 0 : /red|maroon|crimson/.test(k) ? 1 : /orange/.test(k) ? 2 : /yellow|gold/.test(k) ? 3 : /lime|green/.test(k) ? 4 : /blue|navy|aqua|cyan|teal/.test(k) ? 5 : 9; };
const PRL = ['Core Outage', 'Critical', 'Urgent', 'Degraded', 'General', 'Scheduled'];

// ---------- fast sync: read the board's data the way ConnectWise's own page does ----------
// CW's page loads the board with one JSON request (GetMultilineDataAction_srboard). When the page makes it, we note its
// address, headers and form, then repeat it ourselves asking for every ticket at once. Read-only, inside your own session.
// The note is kept on the top window so a newer dashboard version keeps using it.
const hookXHR = w => { try { const X = w.XMLHttpRequest && w.XMLHttpRequest.prototype; if (!X || X.__nocHook2) return; X.__nocHook2 = 1; const T = window;
  const op = X.open, sh = X.setRequestHeader, sd = X.send;
  X.open = function (m, u) { this.__noc2 = /GetMultilineDataAction_srboard/i.test(String(u)) ? { url: String(u), headers: {} } : null; return op.apply(this, arguments); };
  X.setRequestHeader = function (k, v) { if (this.__noc2) this.__noc2.headers[k] = v; return sh.apply(this, arguments); };
  X.send = function (b) { try { if (this.__noc2 && typeof b === 'string') { const q = this.__noc2; q.body = b;
      const pl = JSON.parse(JSON.parse(new URLSearchParams(b).get('actionMessage')).payload);
      // same list = same filters, sort and page size; a different list (another view, the ticket picker) starts a new set
      const sig = [pl.multilineName, pl.screenId, pl.jsonQueryExpression, JSON.stringify(pl.multilineUserParams), pl.sortField, pl.sortDirection, pl.maxResult].join('|');
      let st = T.__nocFeedSet; if (!st || st.sig !== sig || st.pages.size > 12) st = T.__nocFeedSet = { sig, pages: new Map() };
      st.pages.set(b, q); } } catch (e) {}
    return sd.apply(this, arguments); };
} catch (e) {} };
const rowFromFeed = o => {
  const id = String(o.SR_Service_RecID || ''); if (!/^\d+$/.test(id)) return null;
  const cn = (String(o.Urgency_Sort_Order || o.Image_Link || '').match(/urgencyColors\/([A-Za-z]+)\./) || [])[1] || '', prank = prFromName(cn);
  const st = String(o.Description || ''), sla = String(o.SLA_Status_Text || '');
  return { id, st, grp: st.replace(/\s*\(.*$/, '') || '—', age: parseFloat(o.Age) || 0, co: o.Company_Name || '—', sum: o.Summary || '',
    res: String([o.ResourceList, o.Resources].find(v => v && !/images\/|\.(gif|png)/i.test(v)) || '').split(/\s*,\s*/).filter(x => x && !/\.\.\.$|…$/.test(x)), ent: +o.Date_Entered || null, sla, due: parseSla(sla),
    pcol: cn.toLowerCase(), ptitle: cn, prank, pname: `${prank < 9 ? 'P' + prank : 'P?'} · ${PRL[prank] || cn || 'Unreadable'}`, hotP: prank <= 1 };
};
// repeat each board page request CW made, unchanged and all at once; null when that can't be trusted to be the whole board
const fetchAll = async () => {
  const st = window.__nocFeedSet; if (!st || !st.pages.size) { S.feedWhy = 'no board request seen yet'; return null; }
  const m = new Map(); let total = 0;
  await Promise.all([...st.pages.values()].map(async q => {
    const r = await fetch(q.url, { method: 'POST', credentials: 'include', headers: q.headers, body: q.body });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(), a = j && j.data && j.data.action;
    if (!j || !j.success || !a || !Array.isArray(a.multilineRows)) throw new Error('unexpected reply');
    a.multilineRows.forEach(x => { try { const t = rowFromFeed(JSON.parse(x.row)); if (t) m.set(t.id, t); } catch (e) {} });
    total = Math.max(total, +(a.totalRecords != null ? a.totalRecords : a.allCount) || 0);
  }));
  const pg = pager();
  if (pg && total && Math.abs(pg.n - total) > Math.max(30, pg.n * .15)) { S.feedWhy = `board count changed (${pg.n} to ${total})`; return null; }
  if (m.size < total) { S.feedWhy = `direct read covered ${m.size} of ${total}`; return null; }
  S.feedWhy = ''; return { rows: m, total };
};

const read = () => {
  const m = new Map();
  for (const d of docs()) {
    const h = leaves(d, /^Summary Description$/)[0], hr = h && h.closest('tr');
    if (!hr) continue;
    const hc = [...hr.children].map(c => c.textContent.trim()), ti = hc.indexOf('Ticket #'), rows = new Set(), win = d.defaultView;
    for (const el of leaves(d, /^\d{7,9}$/)) {
      const tr = el.closest('tr');
      if (!tr || tr === hr || rows.has(tr)) continue;
      rows.add(tr);
      const cells = [...tr.children], off = cells.findIndex(c => c.contains(el)) - ti;
      const cell = k => { const i = hc.indexOf(k); return i < 0 ? null : cells[i + off]; };
      const g = k => { const c = cell(k); return c ? (c.title || c.textContent).trim() : ''; };
      const pc = cell('Priority');
      // CW shows priority as a picture named after its colour: .../urgencyColors/Lime.gif
      const cn = pc ? ((pc.innerHTML.match(/urgencyColors\/([A-Za-z]+)\./) || [])[1] || '') : '';
      const pcol = cn ? cn.toLowerCase() : pc ? prColor(pc, win) : '';
      const ptitle = pc ? ((pc.querySelector('[title]') || {}).title || (pc.querySelector('img[alt]') || {}).alt || pc.title || pc.textContent.trim()) : '';
      // keep what the first unreadable priority cell looked like, so it can be copied and sent for a fix
      if (!pcol && !/\d/.test(ptitle) && !PRDIAG) { const kid = pc && pc.querySelector('*'), ks = kid && win.getComputedStyle(kid);
        PRDIAG = `headers: ${hc.join(' | ')}\npriority col: ${hc.indexOf('Priority')} offset: ${off}\ncell: ${pc ? pc.outerHTML.slice(0, 700) : 'none'}\nfirst child style: ${ks ? [ks.backgroundColor, ks.backgroundImage.slice(0, 120), ks.width, ks.height, ks.borderLeftColor].join(' · ') : 'none'}`; }
      const id = el.textContent.trim(), st = g('Status'), sla = g('SLA Status'), ph = hue(pcol);
      // priority: use CW's own name when the cell has one ("P1 - Critical"), else map the colour to Meriplex's list:
      // magenta P0 Core Outage, red P1 Critical, orange P2 Urgent, yellow P3 Degraded, green P4 General, blue P5 Scheduled
      // ponytail: colour can't tell P1 VIP / Sales-only priorities apart from the main ones; they show under the same colour's name
      const pm = /(?:priority\s*|^P)(\d)/i.exec(ptitle), prank = pm ? +pm[1] : cn ? prFromName(cn) : ph == null ? 9 : (ph >= 270 && ph <= 330) ? 0 : (ph < 20 || ph > 330) ? 1 : ph < 45 ? 2 : ph < 70 ? 3 : ph < 170 ? 4 : 5;
      const plabel = pm ? (ptitle.replace(/^.*?(?:priority\s*|^P)\d\s*[-–:]?\s*/i, '').trim() || 'Priority ' + prank) : ['Core Outage', 'Critical', 'Urgent', 'Degraded', 'General', 'Scheduled'][prank] || 'Unreadable';
      m.set(id, { id, st, grp: st.replace(/\s*\(.*$/, '') || '—', age: parseFloat(g('Age')) || 0, co: g('Company') || '—', sum: g('Summary Description'),
        res: g('Resources').split(/\s*,\s*/).filter(x => x && !/\.\.\.$|…$/.test(x)), ent: parseD(g('Entered')), sla, due: parseSla(sla), pcol, ptitle, prank, pname: `${prank < 9 ? 'P' + prank : 'P?'} · ${plabel}`, hotP: prank <= 1 });
    }
  }
  return m;
};

// a ConnectWise dropdown found by its label: the input sitting just right of it on the same line
const field = re => {
  for (const d of docs()) for (const lab of leaves(d, re)) {
    const l = lab.getBoundingClientRect(), y = l.top + l.height / 2;
    const inp = [...d.querySelectorAll('input')].find(i => { const q = i.getBoundingClientRect(); return q.width && Math.abs(q.top + q.height / 2 - y) < 14 && q.left >= l.right - 2 && q.left - l.right < 160; });
    if (inp) return { inp, d, val: inp.value.trim() };
  }
  return null;
};
const F = { loc: /^Location:?$/, dept: /^Department:?$/, board: /^Service Board:?$/, view: /^View:?$/ };
const readCtx = () => { const o = {}; for (const k in F) { const f = field(F[k]); o[k] = f ? f.val : ''; } return o; };

const ac = new (window.AudioContext || window.webkitAudioContext)();
const beep = () => { if (S.mute) return; [0, .18].forEach((d, i) => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = i ? 1320 : 880; g.gain.setValueAtTime(.12, ac.currentTime + d); g.gain.exponentialRampToValueAtTime(.001, ac.currentTime + d + .35); o.connect(g).connect(ac.destination); o.start(ac.currentTime + d); o.stop(ac.currentTime + d + .35); }); };

const ic = p => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${p}"/></svg>`;
const I = { grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', co: 'M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M8 7h4M8 11h4M8 15h4M2 21h20',
  eng: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75', ref: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5', min: 'M5 12h14', x: 'M6 6l12 12M18 6 6 18',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0', mute: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0M3 3l18 18', mon: 'M3 4h18v12H3zM8 20h8M12 16v4',
  q: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3', chev: 'M6 9l6 6 6-6' };

const host = document.createElement('div');
const root = host.attachShadow({ mode: 'open' });
document.body.appendChild(host);
const S = { rows: new Map(), seen: new Set(), fresh: new Set(), hist: [], page: 'overview', tab: 'all', range: 'all', q: '', sort: null, focus: null, ctx: {}, next: EVERY, last: '—', lastTs: 0, note: '', me: store('nocLiveMe') || '',
  mute: store('nocLiveMute') === '1', notify: store('nocLiveNotify') === '1', min: false, raf: 0, t: 0, title: document.title, pv: {}, watch: null, fx: [], log: [], boot: 0, pos: new Map(), zoom: null, sel: new Set(), acting: false };

root.innerHTML = `<style>
:host{all:initial}
*{box-sizing:border-box}
.ov{position:fixed;inset:0;z-index:2147483646;overflow:auto;overscroll-behavior:contain;scroll-behavior:smooth;color:#DCE6F7;font:13px/1.45 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;background:radial-gradient(1200px 600px at 12% -10%,rgba(45,225,194,.11),transparent 60%),radial-gradient(900px 520px at 100% 0%,rgba(255,181,71,.07),transparent 60%),radial-gradient(800px 600px at 50% 120%,rgba(77,139,255,.10),transparent 60%),#04070E}
.ov::before{content:"";position:fixed;inset:0;pointer-events:none;background-image:linear-gradient(rgba(120,160,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(120,160,255,.04) 1px,transparent 1px);background-size:44px 44px;-webkit-mask-image:radial-gradient(ellipse at 50% 0%,#000 30%,transparent 85%);mask-image:radial-gradient(ellipse at 50% 0%,#000 30%,transparent 85%)}
.ov::after{content:"";position:fixed;left:0;right:0;top:0;height:160px;pointer-events:none;background:linear-gradient(transparent,rgba(45,225,194,.045),transparent);transform:translateY(-160px);animation:scan 10s linear infinite;will-change:transform}
@keyframes scan{to{transform:translateY(100vh)}}
.ov.min{display:none}
.wrap{position:relative;max-width:1720px;margin:0 auto;padding:14px 22px 30px}
.D{font-family:Bahnschrift,"DIN Alternate","Segoe UI",sans-serif}
.top{position:sticky;top:10px;z-index:5;display:flex;align-items:center;gap:14px;padding:8px 10px 8px 14px;border:1px solid rgba(120,160,255,.13);border-radius:14px;background:rgba(7,12,24,.96);box-shadow:0 10px 30px rgba(0,0,0,.4)}
.brand{display:flex;align-items:center;gap:11px;min-width:0}
.brand i{flex:none;width:11px;height:11px;border-radius:2px;background:#2DE1C2;box-shadow:0 0 14px #2DE1C2;transform:rotate(45deg);animation:pulse 2s infinite}
.brand b{display:block;font:600 14px/1.1 Bahnschrift,"Segoe UI",sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#fff;white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis}
.brand small{display:block;font-size:10px;letter-spacing:.14em;color:#97A6C2;text-transform:uppercase}
.pages{display:flex;gap:2px;margin-left:8px}
.pg{position:relative;display:flex;align-items:center;gap:8px;padding:8px 12px;border:0;border-radius:10px;background:none;color:#97A6C2;font:600 13px "Segoe UI",sans-serif;cursor:pointer;transition:color .2s,background .2s}
.pg:hover{color:#fff;background:rgba(255,255,255,.04)}
.pg.on{color:#fff;background:linear-gradient(180deg,rgba(45,225,194,.16),rgba(45,225,194,.04))}
.pg.on::after{content:"";position:absolute;left:14px;right:14px;bottom:-9px;height:2px;border-radius:2px;background:#2DE1C2;box-shadow:0 0 10px #2DE1C2}
.pg b{font:600 11px Bahnschrift,Consolas,monospace;padding:1px 7px;border-radius:99px;background:rgba(120,160,255,.13);color:#B9C5DD}
.sp{flex:1}
.search{display:flex;align-items:center;gap:8px;width:250px;padding:0 10px;height:34px;border-radius:10px;border:1px solid rgba(120,160,255,.15);background:rgba(16,24,46,.8);color:#97A6C2;transition:border-color .2s,box-shadow .2s}
.search:focus-within{border-color:#2DE1C2;box-shadow:0 0 0 3px rgba(45,225,194,.15)}
.isoq{flex:1;min-width:0;height:22px}
iframe.iso{display:block;width:100%;height:100%;border:0;border-radius:8px}
.isobox{height:150px;border-radius:10px;border:1px solid rgba(120,160,255,.25);background:#0A1122;transition:border-color .2s,box-shadow .2s}
.isobox:focus-within{border-color:#2DE1C2;box-shadow:0 0 0 3px rgba(45,225,194,.15)}
.search kbd{font:11px Consolas,monospace;padding:0 5px;border:1px solid rgba(120,160,255,.25);border-radius:4px;color:#97A6C2}
.sync{display:flex;align-items:center;gap:8px;color:#97A6C2;font-size:11px;line-height:1.25;white-space:nowrap}
.sync svg{width:24px;height:24px;transform:rotate(-90deg)}
.sync b{color:#DCE6F7;font-weight:600}
.sync.stale b{color:#FFB547}
.clock{font:600 15px Bahnschrift,Consolas,monospace;color:#fff;letter-spacing:.08em}
.ib{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;border:1px solid rgba(120,160,255,.16);background:rgba(20,30,58,.6);color:#B9C5DD;cursor:pointer;transition:all .2s}
.ib:hover{border-color:#2DE1C2;color:#fff;box-shadow:0 0 14px rgba(45,225,194,.3)}
.ib.on{color:#2DE1C2;border-color:rgba(45,225,194,.5)}
.av{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#2DE1C2,#4D8BFF);color:#04070E;font:700 12px Bahnschrift,"Segoe UI",sans-serif;cursor:pointer;border:0}
.ctx{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:18px 4px 0}
.crumb{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:#97A6C2;font-size:12.5px}
.crumb .sep{color:#3E4C6B}
.crumb b{color:#DCE6F7;font-weight:600}
.pick{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:9px;border:1px solid rgba(45,225,194,.35);background:rgba(45,225,194,.08);color:#DCE6F7;font:600 12.5px "Segoe UI",sans-serif;cursor:pointer;transition:all .2s}
.pick:hover{background:rgba(45,225,194,.18);box-shadow:0 0 14px rgba(45,225,194,.2)}
.pick small{color:#97A6C2;font-weight:500}
.seg{display:inline-flex;padding:3px;border-radius:10px;background:rgba(16,24,46,.8);border:1px solid rgba(120,160,255,.13)}
.seg button{border:0;background:none;color:#97A6C2;font:600 12px "Segoe UI",sans-serif;padding:5px 11px;border-radius:7px;cursor:pointer;transition:all .2s}
.seg button.on{background:#2DE1C2;color:#04070E;box-shadow:0 0 14px rgba(45,225,194,.4)}
.head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap;margin:16px 4px 16px}
.kick{font:600 12px Bahnschrift,"Segoe UI",sans-serif;letter-spacing:.28em;text-transform:uppercase;color:#2DE1C2}
.kick i{display:inline-block;width:7px;height:7px;margin-right:9px;border-radius:50%;background:#2DE1C2;box-shadow:0 0 10px #2DE1C2;vertical-align:1px;animation:pulse 1.6s infinite}
.title{margin:6px 0 0;font:600 38px/1.05 Bahnschrift,"DIN Alternate","Segoe UI",sans-serif;font-stretch:condensed;letter-spacing:.07em;text-transform:uppercase;background:linear-gradient(90deg,#F2FFFC 0%,#2DE1C2 35%,#7FD8FF 60%,#F2FFFC 100%);background-size:220% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 18px rgba(45,225,194,.28));animation:sheen 9s linear infinite}
.title::after{content:"";display:inline-block;width:.42em;height:.12em;margin-left:.3em;background:#2DE1C2;box-shadow:0 0 12px #2DE1C2;animation:blink 1.1s steps(1) infinite;vertical-align:.1em}
@keyframes sheen{to{background-position:-220% 0}}
@keyframes blink{50%{opacity:0}}
.sub{margin:8px 0 0;color:#97A6C2}
.me{background:none;border:0;padding:0;font:inherit;color:#2DE1C2;cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px}
.chips{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.chip2{display:inline-flex;align-items:center;gap:7px;padding:6px 11px;border-radius:99px;border:1px solid rgba(120,160,255,.15);background:rgba(16,24,46,.7);color:#B9C5DD;font:600 12.5px "Segoe UI",sans-serif;cursor:pointer;transition:all .2s}
.chip2:hover{color:#fff;border-color:rgba(120,160,255,.35)}
.chip2 b{font:600 11px Bahnschrift,Consolas,monospace;color:var(--c,#B9C5DD)}
.chip2.on{color:#04070E;background:var(--c,#2DE1C2);border-color:transparent;box-shadow:0 0 16px color-mix(in srgb,var(--c,#2DE1C2) 45%,transparent)}
.chip2.on b{color:#04070E}
.fchip{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:99px;border:1px dashed rgba(45,225,194,.6);background:rgba(45,225,194,.1);color:#DCE6F7;font:600 12.5px "Segoe UI",sans-serif;cursor:pointer}
.note{width:100%;margin:6px 0 0;color:#FFB547;font-weight:600}
.page{display:none}
.page.on{display:block;animation:pgin .35s cubic-bezier(.2,.8,.2,1)}
@keyframes pgin{from{opacity:0;transform:translateY(8px)}}
.grid{display:grid;grid-template-columns:minmax(0,1.85fr) minmax(340px,1fr);gap:16px}
.col{display:grid;gap:16px;align-content:start}
.card{position:relative;border:1px solid rgba(120,160,255,.11);border-radius:16px;background:linear-gradient(180deg,rgba(14,22,42,.92),rgba(8,13,26,.92));padding:16px;overflow:hidden;transition:border-color .3s,box-shadow .3s,transform .3s}
.card:hover{border-color:rgba(45,225,194,.32);box-shadow:0 0 30px rgba(45,225,194,.06)}
.card::before{content:"";position:absolute;left:0;top:0;width:60px;height:1px;background:linear-gradient(90deg,#2DE1C2,transparent)}
.card::after{content:"";position:absolute;inset:7px;pointer-events:none;--hb:rgba(45,225,194,.55);background:linear-gradient(var(--hb),var(--hb)) top left/14px 1.5px,linear-gradient(var(--hb),var(--hb)) top left/1.5px 14px,linear-gradient(var(--hb),var(--hb)) top right/14px 1.5px,linear-gradient(var(--hb),var(--hb)) top right/1.5px 14px,linear-gradient(var(--hb),var(--hb)) bottom left/14px 1.5px,linear-gradient(var(--hb),var(--hb)) bottom left/1.5px 14px,linear-gradient(var(--hb),var(--hb)) bottom right/14px 1.5px,linear-gradient(var(--hb),var(--hb)) bottom right/1.5px 14px;background-repeat:no-repeat;opacity:.55;transition:inset .35s cubic-bezier(.2,.8,.2,1),background-size .35s cubic-bezier(.2,.8,.2,1),opacity .35s}
.card:hover::after{inset:3px;opacity:1;background-size:26px 1.5px,1.5px 26px,26px 1.5px,1.5px 26px,26px 1.5px,1.5px 26px,26px 1.5px,1.5px 26px}
.risk::after{--hb:rgba(255,181,71,.7)}.k2::after{--hb:rgba(255,77,106,.7)}
.topo .tm{margin-left:10px}.topo .tm button{padding:4px 10px;font-size:11.5px}
.alertfx{position:fixed;inset:0;z-index:2147483647;pointer-events:none;box-shadow:inset 0 0 0 2px rgba(255,77,106,.9),inset 0 0 160px rgba(255,77,106,.5);animation:alarm 1s ease-in-out 5 both}
.alertfx b{position:absolute;top:70px;left:50%;transform:translateX(-50%);padding:9px 20px;border-radius:99px;background:rgba(40,6,14,.94);border:1px solid #FF4D6A;color:#FF8EA2;font:700 13px Bahnschrift,"Segoe UI",sans-serif;letter-spacing:.3em;box-shadow:0 0 30px rgba(255,77,106,.55);white-space:nowrap}
@keyframes alarm{50%{opacity:.2}}
.ch{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.ch h3{margin:0;font:600 12px Bahnschrift,"Segoe UI",sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#B9C5DD}
.ch span{font-size:11.5px;color:#97A6C2}
.topo{height:440px;padding:0}
.topo .ch{position:absolute;left:16px;right:16px;top:14px;z-index:1}
.topo canvas{width:100%;height:100%;display:block}
.legend{position:absolute;left:16px;bottom:12px;display:flex;gap:16px;font-size:11.5px;color:#97A6C2}
.legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:-1px}
.risk{background:radial-gradient(130% 120% at 100% 0%,rgba(255,181,71,.22),transparent 55%),linear-gradient(180deg,rgba(32,22,12,.94),rgba(12,9,10,.94));border-color:rgba(255,181,71,.28)}
.risk::before{background:linear-gradient(90deg,#FFB547,transparent)}
.rb{display:grid;grid-template-columns:210px minmax(0,1fr);gap:18px;align-items:center}
.gw{position:relative}.gw svg{width:100%;display:block;overflow:visible}
.gn{position:absolute;left:0;right:0;bottom:0;text-align:center}
.gn b{display:block;font:600 48px/1 Bahnschrift,"Segoe UI",sans-serif;color:#fff;text-shadow:0 0 26px var(--c)}
.lvl{display:inline-block;margin-top:4px;font:700 11px Bahnschrift,"Segoe UI",sans-serif;letter-spacing:.24em;color:var(--c);text-shadow:0 0 12px var(--c)}
.fx{display:grid;gap:8px}
button.f,button.ri{display:grid;background:none;border:0;padding:4px 6px;margin:-4px -6px;border-radius:8px;font:inherit;color:inherit;text-align:left;cursor:pointer;width:calc(100% + 12px);transition:background .2s}
button.f:hover:not(:disabled),button.ri:hover{background:rgba(255,255,255,.06)}
button.f:disabled{cursor:default;opacity:.55}
.f{grid-template-columns:minmax(0,1fr) auto;gap:3px 8px;font-size:12.5px;color:#B9C5DD}
.f b{font:600 12.5px Bahnschrift,Consolas,monospace;color:#fff}
.f i{grid-column:1/-1;height:4px;border-radius:4px;background:rgba(255,255,255,.07);overflow:hidden}
.f i em{display:block;height:100%;border-radius:4px;transform-origin:left}
.cap{margin:12px 0 0;font-size:12px;line-height:1.5;color:#A3B1CC}
.kp{display:grid;grid-template-columns:1fr 1fr;gap:16px}
button.card{display:block;width:100%;text-align:left;font:inherit;color:inherit;cursor:pointer}
.k1{background:radial-gradient(120% 120% at 0% 100%,rgba(45,225,194,.28),transparent 60%),linear-gradient(180deg,rgba(8,32,34,.94),rgba(5,15,19,.94));border-color:rgba(45,225,194,.30)}
.k2{background:radial-gradient(120% 120% at 100% 100%,rgba(255,77,106,.22),transparent 60%),linear-gradient(180deg,rgba(32,11,20,.94),rgba(14,7,13,.94));border-color:rgba(255,77,106,.28)}
.k2::before{background:linear-gradient(90deg,#FF4D6A,transparent)}
.kh{font:600 11px Bahnschrift,"Segoe UI",sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#B9C5DD}
.kn{font:600 40px/1.05 Bahnschrift,"Segoe UI",sans-serif;color:#fff;margin:6px 0 2px}
.ks{font-size:11.5px;color:#A3B1CC}
.kp svg{display:block;width:100%;height:58px;margin-top:10px;overflow:visible}
.vb{transform-box:fill-box;transform-origin:bottom}
.tbl{padding:0}
.tbl .ch{padding:14px 16px 0}
.ts{max-height:520px;overflow:auto}
.ts.tall{max-height:calc(100vh - 290px)}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th{position:sticky;top:0;z-index:1;background:#0A1122;text-align:left;font:600 11px Bahnschrift,"Segoe UI",sans-serif;color:#97A6C2;letter-spacing:.12em;text-transform:uppercase;padding:10px;border-bottom:1px solid rgba(120,160,255,.12);white-space:nowrap}
th[data-sort]{cursor:pointer}th[data-sort]:hover{color:#fff}
th .ar{color:#2DE1C2;margin-left:4px}
td{padding:9px 10px;border-bottom:1px solid rgba(120,160,255,.06);white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis;color:#B9C5DD}
tr.row{cursor:pointer}
tr.row:hover td{background:rgba(45,225,194,.07);color:#fff}
tr.fresh td{animation:flash 3s}
tr.fresh td:first-child{box-shadow:inset 3px 0 0 #FFB547}
tr.rep td:first-child{box-shadow:inset 3px 0 0 #F472B6}
tr.br td:first-child{box-shadow:inset 3px 0 0 #FF4D6A}
@keyframes flash{0%,35%{background:rgba(255,181,71,.24)}}
.id{font:600 12.5px Bahnschrift,Consolas,monospace;color:#7FD8FF;letter-spacing:.04em}
.prio{display:inline-flex;align-items:center;gap:6px;padding:1px 8px 1px 6px;border-radius:6px;font:600 11.5px Bahnschrift,"Segoe UI",sans-serif;letter-spacing:.02em;color:#E6ECF7;background:color-mix(in srgb,var(--c) 18%,transparent);border:1px solid color-mix(in srgb,var(--c) 45%,transparent);white-space:nowrap}
.prio::before{content:"";width:8px;height:8px;border-radius:2px;background:var(--c);box-shadow:0 0 8px var(--c)}
.pill{display:inline-flex;align-items:center;gap:6px;padding:2px 9px;border-radius:99px;font-size:11.5px;font-weight:600;color:var(--c);background:color-mix(in srgb,var(--c) 14%,transparent);border:1px solid color-mix(in srgb,var(--c) 32%,transparent)}
.pill::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--c);box-shadow:0 0 6px var(--c)}
.new{font:700 9.5px Bahnschrift,"Segoe UI",sans-serif;letter-spacing:.14em;color:#04070E;background:#FFB547;border-radius:4px;padding:1px 5px;margin-left:6px;box-shadow:0 0 10px rgba(255,181,71,.6)}
.sla.bad{color:#FF6B84;font-weight:600}.sla.warn{color:#FFB547;font-weight:600}
.more{display:block;width:100%;padding:12px;border:0;border-top:1px solid rgba(120,160,255,.1);background:none;color:#2DE1C2;font:600 12.5px "Segoe UI",sans-serif;cursor:pointer}
.more:hover{background:rgba(45,225,194,.06)}
.rl{display:grid;gap:10px}
.ri{grid-template-columns:minmax(0,1fr) 34px;gap:4px 10px;font-size:12.5px}
.ri span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#B9C5DD}
.ri b{text-align:right;font:600 12.5px Bahnschrift,Consolas,monospace;color:#fff}
.ri i{grid-column:1/-1;display:flex;height:5px;border-radius:5px;background:rgba(255,255,255,.06);overflow:hidden}
.ri i em{display:block;height:100%;transform-origin:left}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:14px}
.ec{cursor:pointer}
.ec:hover{transform:translateY(-2px)}
.ec h4{margin:0 0 2px;font:600 14px "Segoe UI",sans-serif;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ec .big{font:600 34px/1.1 Bahnschrift,"Segoe UI",sans-serif;color:#fff}
.ec .big small{font-size:12px;color:#97A6C2;margin-left:6px;letter-spacing:.1em;text-transform:uppercase}
.mix{display:flex;height:6px;border-radius:6px;overflow:hidden;background:rgba(255,255,255,.06);margin:10px 0}
.mix em{display:block;height:100%}
.meta{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:#A3B1CC}
.meta b{color:#fff;font-weight:600}
.empty{padding:34px;text-align:center;color:#97A6C2}
.intro .page.on .card{animation:up .8s cubic-bezier(.2,.8,.2,1) both}
.intro .col>.card:nth-child(2),.intro .kp .card:nth-child(1){animation-delay:.1s}
.intro .kp .card:nth-child(2),.intro .tbl{animation-delay:.18s}
@keyframes up{from{opacity:0;transform:translateY(16px)}}
.intro .f i em,.intro .ri i em{animation:grow 1.2s .3s cubic-bezier(.2,.8,.2,1) both}
.intro .vb{animation:growy 1s cubic-bezier(.2,.8,.2,1) both}
@keyframes grow{from{transform:scaleX(0)}}
@keyframes growy{from{transform:scaleY(0)}}
.tk{animation:tk .45s both}
@keyframes tk{from{opacity:0}}
.dash{stroke-dasharray:400;animation:draw 1.6s ease-out both}
@keyframes draw{from{stroke-dashoffset:400}}
@keyframes pulse{50%{opacity:.35}}
.strip{position:sticky;bottom:0;z-index:4;display:flex;align-items:center;gap:12px;height:44px;padding:0 22px;background:linear-gradient(180deg,rgba(4,7,14,0),rgba(4,7,14,.97) 35%);border-top:1px solid rgba(45,225,194,.12)}
.strip .lbl{flex:none;display:flex;align-items:center;gap:8px;font:600 11px Bahnschrift,"Segoe UI",sans-serif;letter-spacing:.24em;color:#2DE1C2}
.strip .lbl i{width:7px;height:7px;border-radius:50%;background:#2DE1C2;box-shadow:0 0 10px #2DE1C2;animation:pulse 1.6s infinite}
.evs{flex:1;min-width:0;display:flex;gap:8px;overflow:hidden;-webkit-mask-image:linear-gradient(90deg,#000 85%,transparent);mask-image:linear-gradient(90deg,#000 85%,transparent)}
.ev{flex:none;display:inline-flex;align-items:center;gap:8px;max-width:440px;padding:4px 11px;border-radius:8px;border:1px solid color-mix(in srgb,var(--c) 30%,transparent);background:rgba(12,18,36,.92);color:#B9C5DD;font:12px "Segoe UI",sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:default}
.ev[data-id]{cursor:pointer}.ev[data-id]:hover{border-color:var(--c);color:#fff}
.ev.in{animation:evin .6s cubic-bezier(.2,.9,.3,1.2)}
.ev i{flex:none;width:7px;height:7px;border-radius:50%;background:var(--c);box-shadow:0 0 8px var(--c)}
.ev time{font:600 11px Bahnschrift,Consolas,monospace;color:#97A6C2}
.ev b{font:700 10.5px Bahnschrift,"Segoe UI",sans-serif;letter-spacing:.12em;color:var(--c)}
.evq{color:#97A6C2;font-size:12px}
@keyframes evin{from{opacity:0;transform:translateX(-24px)}}
.ck{width:34px;text-align:center}.ck input{width:15px;height:15px;accent-color:#2DE1C2;cursor:pointer}
tr.row.sel td{background:rgba(45,225,194,.10)}
.abar{position:sticky;bottom:52px;z-index:5;display:none;align-items:center;gap:8px;width:max-content;max-width:calc(100% - 44px);margin:0 auto;padding:8px 10px 8px 16px;border-radius:14px;border:1px solid rgba(45,225,194,.45);background:rgba(6,12,24,.97);box-shadow:0 14px 40px rgba(0,0,0,.5),0 0 30px rgba(45,225,194,.15);animation:up .3s}
.abar.on{display:flex}
.abar b{font:600 13px Bahnschrift,"Segoe UI",sans-serif;color:#2DE1C2;margin-right:6px}
.abar button,.mbtn button{display:inline-flex;align-items:center;gap:7px;padding:8px 14px;border-radius:10px;border:1px solid rgba(120,160,255,.2);background:rgba(20,30,58,.8);color:#fff;font:600 13px "Segoe UI",sans-serif;cursor:pointer;transition:all .2s}
.abar button:hover:not(:disabled),.mbtn button:hover:not(:disabled){border-color:#2DE1C2;box-shadow:0 0 14px rgba(45,225,194,.25)}
.abar button:disabled,.mbtn button:disabled{opacity:.45;cursor:default}
.abar .ghost,.mbtn .ghost{background:none;color:#B9C5DD}
.mbtn .go{background:#2DE1C2;color:#04070E;border-color:#2DE1C2}
.modal{position:fixed;inset:0;z-index:2147483647;display:none;place-items:center;background:rgba(2,4,10,.7)}
.modal.on{display:grid}
.mbox{width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;padding:22px;border-radius:18px;border:1px solid rgba(45,225,194,.35);background:linear-gradient(180deg,#0E1830,#070C18);color:#DCE6F7;font:13px/1.5 "Segoe UI",sans-serif;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 40px rgba(45,225,194,.12);animation:up .3s}
.mbox h2{margin:0 0 14px;font:600 20px Bahnschrift,"Segoe UI",sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#fff}
.mlab{display:block;margin:0 0 6px;font-weight:600;color:#B9C5DD}
.mbox textarea,.mbox select{width:100%;padding:10px;border-radius:10px;border:1px solid rgba(120,160,255,.25);background:#0A1122;color:#fff;font:13px/1.5 "Segoe UI",sans-serif;outline:0}
.mbox textarea:focus,.mbox select:focus{border-color:#2DE1C2;box-shadow:0 0 0 3px rgba(45,225,194,.15)}
.mbox fieldset{margin:14px 0 0;padding:10px 12px;border:1px solid rgba(120,160,255,.18);border-radius:10px}
.mbox legend{padding:0 6px;color:#B9C5DD;font-weight:600}
.mbox fieldset label{display:inline-flex;align-items:center;gap:6px;margin:4px 18px 4px 0;cursor:pointer}
.mbox fieldset.par label{display:flex;margin:6px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mbox input[type=checkbox],.mbox input[type=radio]{accent-color:#2DE1C2;width:15px;height:15px}
.mbox details{margin-top:14px;color:#B9C5DD}.mbox summary{cursor:pointer;font-weight:600}
.mlist{margin:8px 0 0;padding-left:18px;max-height:140px;overflow:auto}.mlist li{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mbox pre{margin:0;padding:12px;border-radius:10px;background:#060B16;border:1px solid rgba(120,160,255,.18);color:#DCE6F7;font:12px/1.6 Consolas,monospace;white-space:pre-wrap;word-break:break-word;max-height:50vh;overflow:auto}
.mhint{color:#97A6C2;font-size:12px}.mwarn{color:#FFB547;font-weight:600}
.mstat{min-height:20px;margin:12px 0 0;color:#2DE1C2;font-weight:600}
.modal.busy .mstat::before{content:"";display:inline-block;width:10px;height:10px;margin-right:8px;border:2px solid #2DE1C2;border-right-color:transparent;border-radius:50%;animation:spin .8s linear infinite;vertical-align:-1px}
@keyframes spin{to{transform:rotate(360deg)}}
.mbtn{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
.chip{position:fixed;right:18px;bottom:18px;z-index:2147483646;display:none;align-items:center;gap:10px;padding:10px 16px;border-radius:99px;border:1px solid rgba(45,225,194,.4);background:rgba(5,9,18,.95);color:#DCE6F7;font:600 12px "Segoe UI",sans-serif;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.45),0 0 22px rgba(45,225,194,.18)}
.chip.on{display:flex}
.chip i{width:8px;height:8px;border-radius:50%;background:#2DE1C2;box-shadow:0 0 10px #2DE1C2;animation:pulse 1.6s infinite}
.chip em{font-style:normal;color:#FF8EA2}
.toasts{position:fixed;top:84px;right:16px;z-index:2147483647;display:grid;gap:10px;width:350px}
.toast{position:relative}
.tx{position:absolute;top:8px;right:8px;width:28px;height:28px;border:1px solid var(--c,#FFB547);border-radius:8px;background:rgba(0,0,0,.45);color:#fff;font:700 18px/1 "Segoe UI",sans-serif;cursor:pointer;z-index:1}
.tx:hover{background:rgba(255,255,255,.16);color:#fff}
.toast{padding:12px 46px 12px 14px;border-radius:14px;background:rgba(9,14,28,.97);border:1px solid var(--c,rgba(255,181,71,.5));box-shadow:0 14px 40px rgba(0,0,0,.5),0 0 32px color-mix(in srgb,var(--c,#FFB547) 25%,transparent);color:#DCE6F7;font:12px/1.45 "Segoe UI",sans-serif;cursor:pointer;animation:tin .55s cubic-bezier(.2,.9,.3,1.25)}
.toast b{color:var(--c,#FFB547);font:700 13px Bahnschrift,Consolas,monospace}
.toast div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.toast small{display:block;color:var(--c,#FFB547);letter-spacing:.16em;text-transform:uppercase;font:700 10px Bahnschrift,"Segoe UI",sans-serif;margin-bottom:2px}
.toast.hint{cursor:default;--c:#2DE1C2}
.toast.hint button{margin-top:8px;padding:4px 10px;border-radius:7px;border:1px solid rgba(45,225,194,.5);background:none;color:#2DE1C2;font:600 12px "Segoe UI",sans-serif;cursor:pointer}
@keyframes tin{from{opacity:0;transform:translateX(50px)}}
button:focus-visible,tr.row:focus-visible,.search:focus-visible{outline:2px solid #2DE1C2;outline-offset:2px}
tr.row:focus-visible td{background:rgba(45,225,194,.08)}
@media (max-width:1250px){.search{width:170px}.sync div{display:none}}
@media (max-width:1150px){.grid{grid-template-columns:1fr}.pg span{display:none}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
<div class="ov intro" id="ov"><div class="wrap">
  <header class="top">
    <div class="brand"><i></i><div><b id="bname">NOC</b><small>Live · ConnectWise</small></div></div>
    <nav class="pages" id="pages" aria-label="Pages"></nav>
    <div class="sp"></div>
    <label class="search">${ic(I.q)}<div class="isoq" id="qbox"></div></label>
    <div class="sync" id="sync"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="rgba(120,160,255,.15)" stroke-width="2.5"/><circle id="ring" cx="12" cy="12" r="9" fill="none" stroke="#2DE1C2" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="56.55" stroke-dashoffset="0"/></svg><div>Next sync <b id="nx">60s</b><br>Last <b id="last">—</b></div></div>
    <div class="clock" id="clock"></div>
    <button class="ib" data-act="now" title="Sync now" aria-label="Sync now">${ic(I.ref)}</button>
    <button class="ib" data-act="check" title="Self-check: test what the dashboard can find in ConnectWise" aria-label="Self-check">${ic('M9 12l2 2 4-4M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z')}</button>
    <button class="ib" id="snd" data-act="sound"></button>
    <button class="ib" id="ntf" data-act="notify"></button>
    <button class="ib" data-act="min" title="Minimize (Esc)" aria-label="Minimize">${ic(I.min)}</button>
    <button class="ib" data-act="stop" title="Close" aria-label="Close dashboard">${ic(I.x)}</button>
    <button class="av" id="av" data-act="me" title="Change who “Mine” means"></button>
  </header>
  <div class="ctx"><div class="crumb" id="crumb"></div><div class="sp"></div><div class="seg" id="range" role="group" aria-label="Entered within"></div></div>
  <div class="head" id="head"></div>
  <section class="page" id="pg-overview"><div class="grid">
    <div class="col">
      <div class="card topo"><div class="ch"><h3>Topology</h3><div class="sp"></div><span id="tsub"></span><div class="seg tm" id="tmode" role="group" aria-label="Topology shows"></div></div><canvas id="cv" aria-label="Companies as a live network; click one to filter"></canvas>
        <div class="legend"><span><i style="background:#2DE1C2;box-shadow:0 0 8px #2DE1C2"></i>Steady</span><span><i style="background:#FFB547;box-shadow:0 0 8px #FFB547"></i>New or client replied</span><span><i style="background:#FF4D6A;box-shadow:0 0 8px #FF4D6A"></i>SLA breached or urgent</span><span><i style="background:#B87048;box-shadow:0 0 8px #B87048"></i>Tickets ageing</span></div></div>
      <div class="card tbl"><div class="ch"><h3>Most urgent</h3><span id="qsub"></span></div><div class="ts" id="tbl"></div></div>
    </div>
    <div class="col"><div class="card risk" id="risk"></div><div class="kp" id="kp"></div><div class="col" id="rank"></div></div>
  </div></section>
  <section class="page" id="pg-queue"><div class="card tbl"><div class="ch"><h3>Queue</h3><span id="qsub2"></span></div><div class="ts tall" id="qfull"></div></div></section>
  <section class="page" id="pg-companies"><div class="cards" id="cgrid"></div></section>
  <section class="page" id="pg-engineers"><div class="cards" id="egrid"></div></section>
</div><div class="abar" id="abar" role="toolbar" aria-label="Actions on selected tickets"></div><div class="strip" aria-label="Live events"><span class="lbl"><i></i>EVENTS</span><div class="evs" id="strip"></div></div></div>
<button class="chip" id="chip"></button>
<div class="toasts" id="toasts" aria-live="polite"></div>
<div class="modal" id="modal" role="dialog" aria-modal="true" aria-labelledby="mtitle"></div>`;

const $ = id => root.getElementById(id), ov = $('ov');
const stColor = g => /respond|replied|updated/i.test(g) ? '#F472B6' : /^cleared/i.test(g) ? '#7CF29A' : /^escalation/i.test(g) ? '#FF7A45' : /^new/i.test(g) ? '#4D8BFF' : /progress/i.test(g) ? '#2DE1C2' : /schedul/i.test(g) ? '#9B7BFF' : /^wait/i.test(g) ? '#FFB547' : /complet|resolv|clos/i.test(g) ? '#3DDC84' : '#8EA0C2';
const isBr = r => r.due && r.due < Date.now();
const isSoon = r => r.due && r.due >= Date.now() && r.due - Date.now() < 4 * HOUR;
const isNew = r => /^new/i.test(r.grp) || S.fresh.has(r.id);
// "Client Responded" / "Customer Updated" style statuses; "Waiting (Client Response)" does not match
const isReply = r => /respond|replied|updated/i.test(r.st);
// "Cleared": the alert behind the ticket has cleared, so it likely just needs closing
const isCleared = r => /^cleared/i.test(r.st);
const isEsc = r => /^escalation/i.test(r.st);
const isHot = r => isBr(r) || r.hotP;
const isMine = r => S.me && r.res.some(p => p.toLowerCase() === S.me.toLowerCase());
const TABS = [['all', 'All', () => true, '#2DE1C2'], ['reply', 'Client replied', isReply, '#F472B6'], ['clr', 'Cleared', isCleared, '#7CF29A'], ['esc', 'Escalation', isEsc, '#FF7A45'], ['new', 'New', isNew, '#4D8BFF'], ['risk', 'At risk', r => isBr(r) || isSoon(r), '#FF4D6A'], ['wait', 'Waiting', r => /^wait/i.test(r.grp), '#FFB547'], ['mine', 'Mine', isMine, '#9B7BFF']];
const RANGES = [['all', 'Any time', 0], ['24h', '24h', 1], ['7d', '7d', 7], ['30d', '30d', 30]];
const PAGES = [['overview', 'Overview', I.grid], ['queue', 'Queue', I.list], ['companies', 'Companies', I.co], ['engineers', 'Engineers', I.eng]];
const rel = ms => { const a = Math.abs(ms), h = Math.floor(a / HOUR), m = Math.floor(a % HOUR / 60e3); return h >= 24 ? Math.floor(h / 24) + 'd ' + (h % 24) + 'h' : h ? h + 'h ' + m + 'm' : m + 'm'; };
const mix = (a, b, f) => a.map((v, i) => Math.round(v + (b[i] - v) * f));
const tickCol = p => p < .5 ? mix([45, 225, 194], [255, 181, 71], p * 2) : mix([255, 181, 71], [255, 77, 106], (p - .5) * 2);
const initials = s => (s || '?').split(/[.\s_-]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
const urgency = (a, b) => (isReply(b) - isReply(a)) || (isCleared(b) - isCleared(a)) || (S.fresh.has(b.id) - S.fresh.has(a.id)) || (isBr(b) - isBr(a)) || (isSoon(b) - isSoon(a)) || (a.prank - b.prank) || ((b.ent || 0) - (a.ent || 0)) || (b.id - a.id);
const SORTS = { id: r => +r.id, pr: r => r.prank, st: r => r.grp, age: r => r.age, co: r => r.co.toLowerCase(), sum: r => r.sum.toLowerCase(), res: r => r.res.join(', ').toLowerCase(), sla: r => r.due || Infinity };

const gauge = (score, col) => {
  const N = 44, cx = 105, cy = 104; let s = `<path d="M ${cx - 62} ${cy} A 62 62 0 0 1 ${cx + 62} ${cy}" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="2"/>`;
  for (let i = 0; i <= N; i++) { const p = i / N, a = Math.PI * (1 - p), c = Math.cos(a), sn = Math.sin(a), lng = i % 11 === 0, r1 = lng ? 72 : 78, on = score > 0 && p <= score / 100, tc = tickCol(p);
    s += `<line class="tk" style="animation-delay:${i * 22}ms${on ? `;filter:drop-shadow(0 0 3px rgb(${tc}))` : ''}" x1="${(cx + r1 * c).toFixed(1)}" y1="${(cy - r1 * sn).toFixed(1)}" x2="${(cx + 95 * c).toFixed(1)}" y2="${(cy - 95 * sn).toFixed(1)}" stroke="${on ? `rgb(${tc})` : 'rgba(255,255,255,.10)'}" stroke-width="${lng ? 3.4 : 2.6}" stroke-linecap="round"/>`; }
  const a = Math.PI * (1 - score / 100);
  s += `<circle cx="${(cx + 62 * Math.cos(a)).toFixed(1)}" cy="${(cy - 62 * Math.sin(a)).toFixed(1)}" r="4" fill="${col}" style="filter:drop-shadow(0 0 6px ${col})"/>`;
  return `<svg viewBox="0 0 210 112">${s}</svg>`;
};

const countUp = () => root.querySelectorAll('.page.on [data-n]').forEach(e => {
  const k = e.dataset.k, to = +e.dataset.n, from = S.pv[k] == null ? 0 : S.pv[k]; S.pv[k] = to;
  if (RM || from === to) { e.textContent = fmt(to); return; }
  const t0 = performance.now(), step = t => { const p = Math.min(1, (t - t0) / 1100), q = 1 - Math.pow(1 - p, 3); e.textContent = fmt(Math.round(from + (to - from) * q)); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
});

let NODES = [];
const hashS = t => { let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0; return h; };
const hubLbl = () => { const c = S.ctx || {}; return String(c.board && !/view all/i.test(c.board) ? c.board : c.dept || 'NOC').toUpperCase().slice(0, 20); };
const RINGS = [.45, .78, 1.08], RING_LBL = [['URGENT', [255, 77, 106]], ['ACTIVE', [45, 225, 194]], ['WAITING', [142, 160, 194]]];
// topology nodes are companies, or engineers in engineer mode ("Unassigned" collects tickets with no one)
const nodeKeys = r => S.topo === 'eng' ? (r.res.length ? r.res : ['Unassigned']) : [r.co];
const otherKeys = r => S.topo === 'eng' ? [r.co] : r.res;
const nodeFn = k => S.topo !== 'eng' ? r => r.co === k : k === 'Unassigned' ? r => !r.res.length : r => r.res.some(p => p.toLowerCase() === k.toLowerCase());
let LINKS = [];
const buildNodes = list => {
  const by = new Map();
  list.forEach(r => nodeKeys(r).forEach(k => { const n = by.get(k) || { co: k, n: 0, hot: 0, fresh: 0, rows: [] }; n.n++; n.rows.push(r); if (isHot(r)) n.hot++; if (S.fresh.has(r.id) || isReply(r)) n.fresh++; by.set(k, n); }));
  NODES = [...by.values()].sort((a, b) => b.n - a.n).slice(0, 18).map((n, i) => {
    const mx = new Map(), en = new Map();
    n.rows.forEach(r => { const c = stColor(r.st); mx.set(c, (mx.get(c) || 0) + 1); otherKeys(r).forEach(p => en.set(p, (en.get(p) || 0) + 1)); });
    n.set = new Set(en.keys());
    // ring by urgency: 0 = client replied / SLA / urgent, 1 = new or in progress, 2 = only waiting or scheduled
    const tier = n.rows.some(r => isReply(r) || isBr(r) || isSoon(r) || r.hotP) ? 0 : n.rows.some(r => isNew(r) || /progress/i.test(r.grp)) ? 1 : 2;
    return Object.assign(n, { i, tier, rep: n.rows.filter(isReply).length, risk: n.rows.filter(r => isBr(r) || isSoon(r)).length, avg: n.rows.reduce((a, r) => a + r.age, 0) / n.rows.length,
      old: Math.max(...n.rows.map(r => r.age)), mix: [...mx].sort((a, b) => b[1] - a[1]), eng: ([...en].sort((a, b) => b[1] - a[1])[0] || [''])[0] });
  });
  [0, 1, 2].forEach(tr => { const g = NODES.filter(n => n.tier === tr).sort((p, q) => hashS(p.co) - hashS(q.co)); g.forEach((n, k) => {
    // crowded rings stagger in and out a little so nodes don't touch
    const ph = k / g.length * Math.PI * 2 + tr * .7, R = RINGS[tr] + (g.length > 7 ? (k % 2 ? .1 : -.06) : 0), prev = S.pos.get(n.co);
    Object.assign(n, { x: Math.cos(ph) * R, z: Math.sin(ph) * R, y: ((hashS(n.co) % 11) / 11 - .5) * .35 });
    Object.assign(n, prev || { px: n.x, py: n.y, pz: n.z });
  }); });
  // links: companies that share engineers (or engineers that share companies), strongest 30
  LINKS = [];
  for (let i = 0; i < NODES.length; i++) for (let j = i + 1; j < NODES.length; j++) { let w = 0; NODES[i].set.forEach(k => { if (NODES[j].set.has(k)) w++; }); if (w) LINKS.push([i, j, w]); }
  LINKS = LINKS.sort((a, b) => b[2] - a[2]).slice(0, 30);
  if (NODES.length && !S.boot) S.boot = performance.now();
};
const logE = (kind, r, text) => { S.log.unshift({ kind, id: r && r.id, co: r && r.co, sum: r && r.sum, text, at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), anim: true }); S.log.length = Math.min(S.log.length, 40); };
const EV = { new: ['NEW', '#FFB547'], reply: ['CLIENT REPLIED', '#F472B6'], gone: ['LEFT BOARD', '#8EA0C2'], sync: ['SYNC', '#2DE1C2'], breach: ['SLA BREACH', '#FF4D6A'], cleared: ['CLEARED', '#7CF29A'], esc: ['ESCALATION', '#FF7A45'], action: ['ACTION', '#7FD8FF'] };
const redAlert = n => { if (RM) return; const el = document.createElement('div'); el.className = 'alertfx'; el.innerHTML = `<b>SLA BREACH · ${n} TICKET${n > 1 ? 'S' : ''}</b>`; root.appendChild(el); setTimeout(() => el.remove(), 5200); beep(); };
// title "decrypts": random glyphs resolve left to right
const scramble = (el, text) => { if (RM || !el) return; const G = '█▓▒░<>/\\#*01ΞΔ', t0 = performance.now();
  const step = t => { const p = Math.min(1, (t - t0) / 750), n = Math.floor(p * text.length); el.textContent = text.slice(0, n) + [...text.slice(n)].map(c => c === ' ' ? ' ' : G[Math.random() * G.length | 0]).join(''); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step); };

const rowHTML = (r, pick) => {
  const b = isBr(r), w = isSoon(r), rp = isReply(r), fr = S.fresh.has(r.id), sl = b ? `Breached ${rel(Date.now() - r.due)} ago` : w ? `Due in ${rel(r.due - Date.now())}` : r.sla, on = S.sel.has(r.id);
  return `<tr class="row${fr ? ' fresh' : ''}${rp ? ' rep' : ''}${b ? ' br' : ''}${on ? ' sel' : ''}" data-id="${esc(r.id)}" tabindex="0" aria-label="Open ticket ${esc(r.id)}, ${esc(r.co)}, ${esc(r.sum)} in a new tab" title="${esc(r.sum)}">
    ${pick ? `<td class="ck"><input type="checkbox" data-sel="${esc(r.id)}"${on ? ' checked' : ''} aria-label="Select ticket ${esc(r.id)}"></td>` : ''}<td><span class="id">#${esc(r.id)}</span>${fr ? '<span class="new">NEW</span>' : ''}</td><td><span class="prio" style="--c:${esc(r.pcol || '#5B6B8C')}" title="${esc(r.ptitle || r.pname)}">${esc(r.pname)}</span></td>
    <td><span class="pill" style="--c:${stColor(r.st)}">${esc(rp ? r.st : r.grp)}</span></td><td>${r.age.toFixed(1)}d</td><td>${esc(r.co)}</td><td style="color:#DCE6F7">${esc(r.sum)}</td><td>${esc(r.res.join(', ') || 'Unassigned')}</td><td class="sla${b ? ' bad' : w ? ' warn' : ''}">${esc(sl)}</td></tr>`;
};
const tableHTML = (rows, sortable) => {
  const H = [['id', 'Ticket'], ['pr', 'Priority'], ['st', 'Status'], ['age', 'Age'], ['co', 'Company'], ['sum', 'Summary'], ['res', 'Resources'], ['sla', 'SLA']];
  const all = sortable && rows.length && rows.every(r => S.sel.has(r.id));
  return `<table><thead><tr>${sortable ? `<th class="ck"><input type="checkbox" data-selall="1"${all ? ' checked' : ''} aria-label="Select all tickets shown"></th>` : ''}${H.map(([k, l]) => sortable && k ? `<th data-sort="${k}" aria-sort="${S.sort && S.sort.k === k ? (S.sort.dir > 0 ? 'ascending' : 'descending') : 'none'}">${l}${S.sort && S.sort.k === k ? `<span class="ar">${S.sort.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>` : `<th>${l}</th>`).join('')}</tr></thead><tbody>${rows.map(r => rowHTML(r, sortable)).join('')}</tbody></table>`;
};
const mixBar = rows => { const m = new Map(); rows.forEach(r => { const k = isReply(r) ? r.st : r.grp; m.set(k, (m.get(k) || 0) + 1); }); return `<div class="mix" title="${esc([...m].map(([k, n]) => k + ': ' + n).join(' · '))}">${[...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `<em style="width:${(n / rows.length * 100).toFixed(1)}%;background:${stColor(k)}"></em>`).join('')}</div>`; };
const groupCards = (groups, attr) => groups.length ? groups.map(([k, rows]) => {
  const rp = rows.filter(isReply).length, rk = rows.filter(r => isBr(r) || isSoon(r)).length, old = Math.max(...rows.map(r => r.age));
  return `<button class="card ec" data-${attr}="${esc(k)}" aria-label="${esc(k)}: ${rows.length} tickets. Show them in the queue"><h4>${esc(k)}</h4><div class="big">${rows.length}<small>open</small></div>${mixBar(rows)}
    <div class="meta">${rp ? `<span style="color:#F9A8D4"><b style="color:#F472B6">${rp}</b> client replied</span>` : ''}${rk ? `<span><b style="color:#FF6B84">${rk}</b> at risk</span>` : ''}<span>top <b>${esc(rows.reduce((m, r) => r.prank < m.prank ? r : m).pname)}</b></span><span>oldest <b>${old.toFixed(1)}d</b></span></div></button>`; }).join('') : '<div class="empty">Nothing in this view.</div>';

const render = () => {
  const all = [...S.rows.values()], tab = TABS.find(t => t[0] === S.tab), rg = RANGES.find(x => x[0] === S.range), cut = rg[2] ? Date.now() - rg[2] * DAY : 0, q = S.q.toLowerCase();
  if (S.zoom && !(S.focus && S.focus.zoom && S.focus.label === S.zoom.co)) S.zoom = null;
  const base = all.filter(r => (!cut || (r.ent && r.ent >= cut - DAY)) && (!q || `${r.id} ${r.co} ${r.sum} ${r.st} ${r.res.join(' ')}`.toLowerCase().includes(q)) && (!S.focus || S.focus.fn(r)));
  const list = base.filter(tab[2]);
  const c = S.ctx, boardLbl = c.board && !/view all/i.test(c.board) ? c.board : 'All boards';
  $('bname').textContent = c.dept || 'NOC';
  $('pages').innerHTML = PAGES.map(([k, l, p], i) => `<button class="pg${S.page === k ? ' on' : ''}" data-page="${k}" title="${l}">${ic(p)}<span>${l}</span>${k === 'queue' ? `<b>${fmt(list.length)}</b>` : ''}</button>`).join('');
  $('crumb').innerHTML = `${c.loc ? `<span>${esc(c.loc)}</span><span class="sep">›</span>` : ''}${c.dept ? `<b>${esc(c.dept)}</b><span class="sep">›</span>` : ''}<button class="pick" data-act="board" title="Change the ConnectWise service board"><small>Board</small>${esc(boardLbl)}${ic(I.chev)}</button>
    <button class="pick" data-act="view" title="Change the ConnectWise board View"><small>View</small>${esc(c.view || 'No view')}${ic(I.chev)}</button>`;
  $('range').innerHTML = RANGES.map(([k, l]) => `<button class="${S.range === k ? 'on' : ''}" data-range="${k}" aria-pressed="${S.range === k}">${l}</button>`).join('');
  $('head').innerHTML = `<div><div class="kick"><i></i>${esc(boardLbl)} · live</div><h1 class="title">${esc(boardLbl !== 'All boards' ? boardLbl : c.dept || 'Service board')}</h1>
    <p class="sub">${fmt(list.length)} tickets in this view · ${fmt(all.length)} on the board · syncs every ${EVERY}s${S.fast ? ' · direct read' : ''}</p></div>
    <div class="chips">${TABS.map(([k, l, f, col]) => `<button class="chip2${S.tab === k ? ' on' : ''}" style="--c:${col}" data-tab="${k}" aria-pressed="${S.tab === k}">${l}<b>${base.filter(f).length}</b></button>`).join('')}
      ${S.focus ? `<button class="fchip" data-act="clearf" aria-label="Remove filter ${esc(S.focus.label)}">Only: <b>${esc(S.focus.label)}</b> ✕</button>` : ''}</div>
    ${S.note ? `<p class="note" role="status">${esc(S.note)}</p>` : ''}`;
  const tEl = root.querySelector('.title'); if (tEl && tEl.textContent !== S.titleTxt) { S.titleTxt = tEl.textContent; scramble(tEl, S.titleTxt); }
  root.querySelectorAll('.page').forEach(p => p.classList.toggle('on', p.id === 'pg-' + S.page));
  $('av').textContent = initials(S.me); $('av').setAttribute('aria-label', `You are ${S.me || 'not set'}. Change`);
  $('snd').innerHTML = ic(S.mute ? I.mute : I.bell); $('snd').title = S.mute ? 'Sound off. Click to turn on' : 'Sound on. Click to mute'; $('snd').setAttribute('aria-label', $('snd').title); $('snd').classList.toggle('on', !S.mute);
  $('ntf').innerHTML = ic(I.mon); $('ntf').title = S.notify ? 'Windows alerts on. Click to turn off' : 'Turn on Windows alerts for new tickets and replies'; $('ntf').setAttribute('aria-label', $('ntf').title); $('ntf').classList.toggle('on', S.notify);

  if (S.page === 'overview') {
    buildNodes(list);
    const eng = S.topo === 'eng';
    $('tsub').textContent = `${NODES.length} ${eng ? 'engineers' : 'companies'} · ${fmt(list.length)} tickets · ${S.zoom ? 'click a ticket to open it' : `click ${eng ? 'an engineer' : 'a company'} to zoom in · drag to rotate`}`;
    $('tmode').innerHTML = [['co', 'Companies'], ['eng', 'Engineers']].map(([k, l]) => `<button class="${(S.topo || 'co') === k ? 'on' : ''}" data-topo="${k}" aria-pressed="${(S.topo || 'co') === k}">${l}</button>`).join('');
    const br = list.filter(isBr), soon = list.filter(isSoon), neu = list.filter(isNew), un = list.filter(r => !r.res.length), old = list.filter(r => r.age > 14);
    const fac = [['SLA breached', br.length, Math.min(40, br.length * 12), '#FF4D6A', isBr], ['Due within 4 hours', soon.length, Math.min(20, soon.length * 5), '#FFB547', isSoon], ['New, not picked up', neu.length, Math.min(15, neu.length * 4), '#4D8BFF', isNew],
      ['Unassigned', un.length, Math.min(10, un.length * 3), '#9B7BFF', r => !r.res.length], ['Open over 14 days', old.length, list.length ? Math.min(15, old.length / list.length * 30) : 0, '#8EA0C2', r => r.age > 14]];
    S.fac = fac;
    const score = Math.round(Math.min(100, fac.reduce((a, f) => a + f[2], 0)));
    const [lvl, lc] = score < 25 ? ['CALM', '#2DE1C2'] : score < 50 ? ['BUSY', '#FFD166'] : score < 75 ? ['STRAINED', '#FFB547'] : ['CRITICAL', '#FF4D6A'];
    $('risk').innerHTML = `<div class="ch"><h3>Queue pressure</h3><span>0 = calm · 100 = critical</span></div><div class="rb"><div class="gw" style="--c:${lc}" role="img" aria-label="Queue pressure ${score} of 100, ${lvl.toLowerCase()}">${gauge(score, lc)}<div class="gn"><b data-n="${score}" data-k="score">0</b><span class="lvl">${lvl}</span></div></div>
      <div class="fx">${fac.map(([l, n, p, col], i) => `<button class="f" data-ffac="${i}" ${n ? '' : 'disabled'} aria-label="${esc(l)}: ${n} tickets. Show them"><span>${l}</span><b>${n}</b><i><em style="width:${Math.max(n ? 4 : 0, p / 40 * 100).toFixed(1)}%;background:${col};box-shadow:0 0 8px ${col}"></em></i></button>`).join('')}</div></div>
      <p class="cap">Points for each problem on the right, up to 100. Calm under 25, busy 25–49, strained 50–74, critical 75+. Click a line to see those tickets.</p>`;
    const DAYS = 21, d0 = new Date(); d0.setHours(0, 0, 0, 0); const day = Array(DAYS).fill(0);
    list.forEach(r => { if (r.ent) { const k = DAYS - 1 - Math.round((d0 - r.ent) / DAY); if (k >= 0 && k < DAYS) day[k]++; } });
    const mx = Math.max(1, ...day), bw = 100 / DAYS;
    const bars = day.map((v, i) => `<rect class="vb" style="animation-delay:${i * 30}ms" x="${(i * bw + .6).toFixed(2)}" y="${(56 - v / mx * 52).toFixed(1)}" width="${(bw - 1.2).toFixed(2)}" height="${Math.max(1, v / mx * 52).toFixed(1)}" rx=".6" fill="${i === DAYS - 1 ? '#7FFFE6' : 'url(#tg)'}"/>`).join('');
    const risk = br.length + soon.length, hs = S.hist.slice(-30), hm = Math.max(1, ...hs.map(h => h.risk)), hx = i => hs.length > 1 ? i / (hs.length - 1) * 100 : 0;
    const pts = hs.length > 1 ? hs.map((h, i) => `${hx(i).toFixed(1)},${(52 - h.risk / hm * 44).toFixed(1)}`).join(' ') : '0,40 100,40';
    $('kp').innerHTML = `<button class="card k1" data-page="queue" aria-label="${list.length} open in view. Open the queue"><div class="kh">Open in view</div><div class="kn" data-n="${list.length}" data-k="open">0</div><div class="ks">${day[DAYS - 1]} entered today · intake, last 21 days</div>
        <svg viewBox="0 0 100 56" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2DE1C2"/><stop offset="1" stop-color="#2DE1C2" stop-opacity=".15"/></linearGradient></defs>${bars}</svg></button>
      <button class="card k2" data-tab="risk" aria-label="SLA at risk: ${risk}. Show at-risk tickets"><div class="kh">SLA at risk</div><div class="kn" data-n="${risk}" data-k="risk">0</div><div class="ks">${list.some(r => r.due) ? `${br.length} breached · ${soon.length} due within 4h` : 'No SLA deadlines in this view'}</div>
        <div class="ks" style="margin-top:4px">From the SLA Status column. “Waiting” means the SLA clock is paused.</div>
        <svg viewBox="0 0 100 56" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="rg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF4D6A" stop-opacity=".35"/><stop offset="1" stop-color="#FF4D6A" stop-opacity="0"/></linearGradient></defs>
        <polygon points="0,56 ${pts} 100,56" fill="url(#rg)"/><polyline class="dash" points="${pts}" fill="none" stroke="#FF4D6A" stroke-width="1.6" vector-effect="non-scaling-stroke" style="filter:drop-shadow(0 0 4px #FF4D6A)"/></svg></button>`;
    const top = list.slice().sort(urgency).slice(0, 12);
    $('qsub').textContent = 'client replies, new and SLA first · click a ticket to open it';
    $('tbl').innerHTML = top.length ? tableHTML(top, false) + (list.length > top.length ? `<button class="more" data-page="queue">See all ${fmt(list.length)} in the queue →</button>` : '') : '<div class="empty">Nothing in this view right now.</div>';
    const cs = new Map(), es = new Map();
    list.forEach(r => { const x = cs.get(r.co) || { n: 0, hot: 0 }; x.n++; if (isHot(r)) x.hot++; cs.set(r.co, x); r.res.forEach(p => es.set(p, (es.get(p) || 0) + 1)); });
    const topC = [...cs].sort((a, b) => b[1].n - a[1].n).slice(0, 6), topE = [...es].sort((a, b) => b[1] - a[1]).slice(0, 6), cm = Math.max(1, ...topC.map(x => x[1].n)), em = Math.max(1, ...topE.map(x => x[1]));
    const pm = new Map(); list.forEach(r => { const p = pm.get(r.pname) || { n: 0, rank: r.prank, col: r.pcol || '#5B6B8C' }; p.n++; pm.set(r.pname, p); });
    const prs = [...pm].sort((a, b) => a[1].rank - b[1].rank), pmx = Math.max(1, ...prs.map(p => p[1].n));
    const unr = list.filter(r => r.prank === 9).length;
    $('rank').innerHTML = `<div class="card"><div class="ch"><h3>By priority</h3><span>click one to filter</span></div>${unr ? `<p class="cap" style="margin:0 0 10px;color:#FFB547">Couldn't read the priority colour for ${unr} ticket${unr > 1 ? 's' : ''}. <button class="me" data-act="prdiag">Copy details</button> and paste them to Claude.</p>` : ''}<div class="rl">${prs.map(([k, p]) => `<button class="ri" data-fpr="${esc(k)}" aria-label="${esc(k)}: ${p.n} tickets. Show them"><span><span class="prio" style="--c:${esc(p.col)}">${esc(k)}</span></span><b>${p.n}</b><i><em style="width:${(p.n / pmx * 100).toFixed(1)}%;background:${esc(p.col)};box-shadow:0 0 8px ${esc(p.col)}"></em></i></button>`).join('') || '<div class="empty">No tickets</div>'}</div></div>
    <div class="card"><div class="ch"><h3>Hottest companies</h3><button class="me" data-page="companies">All companies →</button></div><div class="rl">${topC.map(([k, x]) => `<button class="ri" data-fco="${esc(k)}" aria-label="${esc(k)}: ${x.n} tickets. Show them"><span>${esc(k)}</span><b>${x.n}</b><i><em style="width:${((x.n - x.hot) / cm * 100).toFixed(1)}%;background:linear-gradient(90deg,#1B8F80,#2DE1C2)"></em><em style="width:${(x.hot / cm * 100).toFixed(1)}%;background:#FF4D6A;box-shadow:0 0 8px #FF4D6A"></em></i></button>`).join('') || '<div class="empty">No tickets</div>'}</div></div>
      <div class="card"><div class="ch"><h3>Engineer load</h3><button class="me" data-page="engineers">All engineers →</button></div><div class="rl">${topE.map(([k, n]) => `<button class="ri" data-feng="${esc(k)}" aria-label="${esc(k)}: ${n} tickets. Show them"><span>${esc(k)}${S.me && k.toLowerCase() === S.me.toLowerCase() ? ' <b style="color:#2DE1C2;font:inherit">· you</b>' : ''}</span><b>${n}</b><i><em style="width:${(n / em * 100).toFixed(1)}%;background:linear-gradient(90deg,#3A5BD9,#9B7BFF)"></em></i></button>`).join('') || '<div class="empty">No one assigned</div>'}</div></div>`;
  } else if (S.page === 'queue') {
    const rows = list.slice().sort(S.sort ? (a, b) => { const f = SORTS[S.sort.k], x = f(a), y = f(b); return (x < y ? -1 : x > y ? 1 : 0) * S.sort.dir; } : urgency);
    $('qsub2').textContent = `${fmt(rows.length)} tickets · ${S.sort ? 'click a column again to flip, three times for urgency order' : 'urgency order · click a column to sort'} · click a ticket to open it`;
    $('qfull').innerHTML = rows.length ? tableHTML(rows.slice(0, 600), true) : '<div class="empty">Nothing in this view right now.</div>';
  } else if (S.page === 'companies') {
    const m = new Map(); list.forEach(r => { if (!m.has(r.co)) m.set(r.co, []); m.get(r.co).push(r); });
    $('cgrid').innerHTML = groupCards([...m].sort((a, b) => b[1].length - a[1].length), 'fco');
  } else {
    const m = new Map(); list.forEach(r => (r.res.length ? r.res : ['Unassigned']).forEach(p => { if (!m.has(p)) m.set(p, []); m.get(p).push(r); }));
    $('egrid').innerHTML = groupCards([...m].sort((a, b) => b[1].length - a[1].length), 'feng');
  }
  const risk = all.filter(r => isBr(r) || isSoon(r)).length, rep = all.filter(isReply).length;
  $('chip').innerHTML = `<i></i>LIVE · ${fmt(all.length)} open${rep ? ` · <em style="color:#F9A8D4">${rep} replied</em>` : ''}${risk ? ` · <em>${risk} at risk</em>` : ''}${S.fresh.size ? ` · <em style="color:#FFB547">${S.fresh.size} new</em>` : ''}`;
  $('last').textContent = S.last;
  const ns = S.sel.size; $('abar').classList.toggle('on', ns > 0);
  $('abar').innerHTML = ns ? `<b>${ns} selected</b><button data-act="a-note">${ic('M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z')}Add note</button><button data-act="a-status">${ic('M20 6 9 17l-5-5')}Set status</button><button data-act="a-bundle"${ns < 2 ? ' disabled title="Select at least 2 tickets"' : ''}>${ic('M21 8 12 3 3 8l9 5zM3 8v8l9 5 9-5V8')}Bundle</button><button class="ghost" data-act="a-clear">Clear</button>` : '';
  $('strip').innerHTML = S.log.length ? S.log.map(e => { const [lab, col] = EV[e.kind]; const h = `<button class="ev${e.anim ? ' in' : ''}" style="--c:${col}"${e.id ? ` data-id="${esc(e.id)}" title="Open ticket ${esc(e.id)}"` : ''}><i></i><time>${e.at}</time><b>${lab}</b>${e.id ? `<span class="id">#${esc(e.id)}</span> ${esc(e.co)} · ${esc(e.sum)}` : esc(e.text)}</button>`; e.anim = false; return h; }).join('') : '<span class="evq">Waiting for the first sync…</span>';
  countUp();
};

// CW's standalone ticket page, so the dashboard stays open in this tab
const ticketUrl = id => { const m = location.pathname.match(/^(.*?\/v\d+_\d+_release)\//i); return `${location.origin}${m ? m[1] : '/v4_6_release'}/services/system_io/Service/fv_sr100_request.rails?service_recid=${encodeURIComponent(id)}`; };
const openT = id => { if (S.rows.has(id)) window.open(ticketUrl(id), '_blank'); };
// lifted whenever the dashboard itself has to click inside ConnectWise (screen sync, actions, board switching)
const shield = () => { const on = !S.min && !S.busy && !S.acting && !S.watch; [...document.body.children].forEach(e => { if (e !== host) e.inert = on; }); };
const minimize = on => { S.min = on; ov.classList.toggle('min', on); $('chip').classList.toggle('on', on); shield(); };
const toast = (r, lab, col) => {
  const el = document.createElement('div'); el.className = 'toast'; el.style.setProperty('--c', col);
  el.innerHTML = `<button class="tx" aria-label="Dismiss">×</button><small>${esc(lab)}</small><b>#${esc(r.id)}</b> · ${esc(r.pname)} · ${esc(r.st)}<div>${esc(r.co)}</div><div style="color:#B9C5DD">${esc(r.sum)}</div>`;
  el.onclick = e => { el.remove(); if (!e.target.closest('.tx')) openT(r.id); };
  // gone after 8s; hovering keeps it while you read
  let tm = setTimeout(() => el.remove(), 8000); el.onmouseenter = () => clearTimeout(tm); el.onmouseleave = () => { tm = setTimeout(() => el.remove(), 3000); };
  $('toasts').prepend(el); [...$('toasts').children].slice(4).forEach(x => x.remove());
  if (S.notify && window.Notification && Notification.permission === 'granted') { try { const n = new Notification(`${lab}: #${r.id}`, { body: `${r.co}\n${r.sum}`, tag: 'noclive-' + r.id }); n.onclick = () => { window.focus(); openT(r.id); n.close(); }; } catch (e) {} }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
let PG = null;
const pager = () => {
  const parse = el => { const m = el.textContent.trim().match(/^(\d+)\s*-\s*(\d+)\s+of\s+(\d+)$/); return m ? { el, d: el.ownerDocument, a: +m[1], b: +m[2], n: +m[3], txt: el.textContent.trim() } : null; };
  if (PG && PG.isConnected) { const p = parse(PG); if (p) return p; }
  for (const d of docs()) { const el = leaves(d, /^\d+\s*-\s*\d+\s+of\s+\d+$/)[0]; if (el) { PG = el; return parse(el); } }
  return null;
};
const arrow = (p, dir) => {
  const r = p.el.getBoundingClientRect(), cy = r.top + r.height / 2, HE = p.d.defaultView.HTMLElement; let best = null, bd = 1e9;
  p.d.querySelectorAll('*').forEach(e => {
    if (!(e instanceof HE) || e === p.el || e.contains(p.el) || e.textContent.trim().length > 2) return;
    const q = e.getBoundingClientRect(); if (!q.width || q.width > 40 || q.height > 40 || Math.abs(q.top + q.height / 2 - cy) > 14) return;
    const dx = dir > 0 ? q.left - r.right : r.left - q.right; if (dx < -2 || dx > 70) return;
    if (dx < bd - .5 || (Math.abs(dx - bd) <= .5 && best && best.contains(e))) { bd = dx; best = e; }
  });
  return best;
};
const firstRow = () => { for (const d of docs()) { const el = leaves(d, /^\d{7,9}$/)[0]; if (el) return el.closest('tr'); } return null; };
const waitChange = async (txt, tr, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { await sleep(150); const p = pager(); if ((p && p.txt !== txt) || (tr && !tr.isConnected)) { await sleep(250); return true; } } return false; };
const status = t => { $('nx').textContent = t; };
const sync = async (first, press) => {
  if (S.busy || S.acting) return; S.busy = true; S.note = '';
  try {
    docs().forEach(d => hookXHR(d.defaultView));
    // fast path: one request for the whole board, no clicking
    try { status('fetching'); const f = await fetchAll(); if (f) { S.fast = true; apply(f.rows, first); S.busy = false; S.next = EVERY; tickClock(); return; } }
    catch (e) { S.feedWhy = 'direct read failed: ' + e.message; }
    S.fast = false; shield();
    // slow path (also how the first request gets noticed): every page load fetches fresh data,
    // so walk forward on one sync and backward on the next: each page loads once
    let p = pager(), guard = 0;
    const back = !!(p && p.a > 1 && p.b >= p.n);
    if (!back) {
      if (!p || p.a === 1) { const b = docs().map(d => leaves(d, /^SEARCH$/)[0]).find(Boolean); status('refreshing');
        if (b) { b.click(); await waitChange(p && p.txt, firstRow(), 6000); } else S.note = 'SEARCH button not found, reading the board as it is.'; }
      else while (p && p.a > 1 && guard++ < 25) { const pv = arrow(p, -1); if (!pv) break; status('page 1…'); pv.click(); if (!await waitChange(p.txt, firstRow(), 20000)) break; p = pager(); }
      p = pager();
    }
    const cur = read(); guard = 0;
    while (p && guard++ < 25 && (back ? p.a > 1 : p.b < p.n)) {
      const dir = back ? -1 : 1, ar = arrow(p, dir); if (!ar) { S.note = 'Could not find the board page arrows, so only one page is counted.'; break; }
      status(back ? `${Math.max(1, p.a - (p.b - p.a + 1))}–${p.a - 1} of ${p.n}` : `${p.b + 1}–${Math.min(p.n, 2 * p.b - p.a + 1)} of ${p.n}`); ar.click();
      if (!await waitChange(p.txt, firstRow(), 20000)) {
        const p2 = pager(), ar2 = p2 && p2.txt === p.txt && arrow(p2, dir);
        if (ar2) { status('retrying'); ar2.click(); }
        if (!ar2 || !await waitChange(p.txt, firstRow(), 20000)) { S.note = `A board page didn't load after two tries (board shows “${pager() ? pager().txt : 'no pager'}”), so ${fmt(cur.size)} of ${fmt(p.n)} are counted.`; break; }
      }
      read().forEach((v, k) => cur.set(k, v)); p = pager();
    }
    apply(cur, first);
  } catch (e) { S.note = 'Sync error: ' + e.message; render(); }
  S.busy = false; S.next = EVERY; tickClock();
};
const apply = (cur, first) => {
  S.last = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); S.lastTs = Date.now(); S.ctx = readCtx();
  if (!cur.size) {
    // "No Records Found" usually means one of the board's filter boxes (e.g. Ticket #) has text in it
    const nr = docs().some(d => leaves(d, /^No Records Found$/i).some(vis2));
    S.note = nr ? 'ConnectWise shows "No Records Found". A filter box on the board (e.g. Ticket #) probably has text in it. Press Esc, click CLEAR on the ConnectWise board, then SEARCH.' : 'Board not visible, or this board has no tickets. Open the Service Board List.';
    S.rows = cur; render(); return; }
  const prev = S.rows; S.rows = cur; [...S.sel].forEach(id => { if (!cur.has(id)) S.sel.delete(id); });
  [...S.fresh].forEach(id => { if (!cur.has(id)) S.fresh.delete(id); });
  const add = [...cur.values()].filter(r => !S.seen.has(r.id));
  add.forEach(r => S.seen.add(r.id));
  if (!first && add.length > 30) first = true;
  if (!first && add.length) { add.forEach(r => S.fresh.add(r.id)); add.slice(0, 3).forEach(r => toast(r, 'New ticket', '#FFB547')); beep(); }
  const rep = first ? [] : [...cur.values()].filter(r => isReply(r) && prev.has(r.id) && !isReply(prev.get(r.id)));
  if (rep.length) { rep.slice(0, 3).forEach(r => toast(r, 'Client replied', '#F472B6')); beep(); }
  const clr = first ? [] : [...cur.values()].filter(r => isCleared(r) && prev.has(r.id) && !isCleared(prev.get(r.id)));
  if (clr.length) { clr.slice(0, 3).forEach(r => toast(r, 'Ticket cleared', '#7CF29A')); beep(); clr.forEach(r => logE('cleared', r)); }
  const esc2 = first ? [] : [...cur.values()].filter(r => isEsc(r) && prev.has(r.id) && !isEsc(prev.get(r.id)));
  if (esc2.length) { esc2.slice(0, 3).forEach(r => toast(r, 'Escalated (inbound)', '#FF7A45')); beep(); esc2.forEach(r => logE('esc', r)); }
  const gone = first || !prev.size ? [] : [...prev.keys()].filter(id => !cur.has(id));
  if (first) logE('sync', null, `Board loaded · ${fmt(cur.size)} tickets`);
  else { gone.slice(0, 5).forEach(id => logE('gone', prev.get(id))); add.forEach(r => logE('new', r)); rep.forEach(r => logE('reply', r)); }
  const t0 = performance.now(); if (!first) { add.slice(0, 3).forEach((r, i) => S.fx.push({ co: r.co, kind: 'new', t0: t0 + i * 500 })); rep.slice(0, 3).forEach((r, i) => S.fx.push({ co: r.co, kind: 'reply', t0: t0 + 300 + i * 500 })); }
  // red alert when a ticket newly breaches its SLA
  const brNow = [...cur.values()].filter(isBr), newBr = first || !S.brSet ? [] : brNow.filter(r => !S.brSet.has(r.id));
  S.brSet = new Set(brNow.map(r => r.id));
  if (newBr.length) { newBr.slice(0, 3).forEach(r => logE('breach', r)); redAlert(newBr.length); }
  S.hist.push({ open: cur.size, risk: [...cur.values()].filter(r => isBr(r) || isSoon(r)).length });
  document.title = S.fresh.size ? `(${S.fresh.size}) New ticket · ${S.title}` : S.title;
  render();
};

// ---------- bulk actions: the dashboard drives ConnectWise's own Actions menu behind the overlay ----------
const STATUSES = ['New', 'New*', 'Dispatching', 'Triaged', 'Assigned', 'Scheduled (By Client)', 'Scheduled (Internal)', 'In Progress', 'Elevation (Internal Team)*', 'Escalation (Inbound)*', 'Waiting (3rd Party)',
  'Waiting (Client - 1st Notice)*', 'Waiting (Process/Maintenance)', 'Waiting (Client Approval)', 'Remote Hands Dispatched', 'Monitor', 'Completed*', 'Closed (Silent)', 'Closed (Canceled)*', 'Closed (Child/Merge/Bundle)',
  'Closed (Escalated to 3rd Party)*', 'Closed-Reopen 30 Days*', 'Internal Status Request', '#Closed (Survey)*', '#Closed (No Response)*', '#Closed (Notification)*', '#Client Responded*', '#Waiting (Client - 2nd Notice)*', '#Waiting (Client - 3rd Notice)*', '#Re-Opened*'];
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const vis2 = e => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
// a real-looking click: GXT widgets listen to mousedown as well as click
const fire = (el, mods) => { const w = el.ownerDocument.defaultView, r = el.getBoundingClientRect(), o = { ...(mods || {}), bubbles: true, cancelable: true, view: w, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
  [['pointerdown', w.PointerEvent], ['mousedown', w.MouseEvent], ['pointerup', w.PointerEvent], ['mouseup', w.MouseEvent], ['click', w.MouseEvent]].forEach(([t, E]) => { try { el.dispatchEvent(new (E || w.MouseEvent)(t, o)); } catch (e) {} }); };
const typeInto = (inp, v) => { const w = inp.ownerDocument.defaultView, k = (v.slice(-1) || 'a'), code = k.toUpperCase().charCodeAt(0); inp.focus();
  Object.getOwnPropertyDescriptor(w[inp.tagName === 'TEXTAREA' ? 'HTMLTextAreaElement' : 'HTMLInputElement'].prototype, 'value').set.call(inp, v);
  ['keydown', 'keypress', 'input', 'keyup', 'change'].forEach(t => inp.dispatchEvent(t.startsWith('key') ? new w.KeyboardEvent(t, { bubbles: true, key: k, keyCode: code, which: code }) : new w.Event(t, { bubbles: true }))); };
const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(150); } return null; };
// floating = inside one of the layers CW adds straight under <body> (menus, windows, dropdown lists)
const floatOf = el => { let b = el; while (b.parentElement && b.parentElement !== b.ownerDocument.body) b = b.parentElement; const w = b.ownerDocument.defaultView; return /absolute|fixed/.test(w.getComputedStyle(b).position) && b.getBoundingClientRect().width < w.innerWidth * .9 ? b : null; };
const floatLeaf = (re, not) => { for (const d of docs()) { const el = leaves(d, re).find(e => vis2(e) && floatOf(e) && !(not && not.contains(e))); if (el) return el; } return null; };
const cwWin = title => { const t = floatLeaf(new RegExp('^' + reEsc(title) + '$')); return t && t.closest('.cw-gxt-wnd'); };
const btnIn = (w, re) => { const l = [...w.querySelectorAll('*')].find(e => e.children.length === 0 && re.test(e.textContent.trim()) && vis2(e)); return l && (l.closest('.mm_button') || l); };
const gone = async w => !!await waitFor(() => !w.isConnected || !vis2(w), 8000);
const cancelWin = w => { const c = w && (btnIn(w, /^Cancel$/) || w.querySelector('.cw-gxt-wnd-cls')); if (c) fire(c); };
// ticket id -> its board row on the page currently loaded
// only rows you can see and that have a real tick control: never anything in a hidden grid, never a ticket link
const pageRows = () => { const m = new Map(); for (const d of docs()) leaves(d, /^\d{7,9}$/).forEach(el => { const tr = el.closest('tr'); if (tr && vis2(el) && !floatOf(tr) && tickEl(tr) && !m.has(el.textContent.trim())) m.set(el.textContent.trim(), tr); }); return m; };
// the row's tick control: CW draws a div.x-grid-row-checker in the first cell (a real checkbox is used if one exists)
const tickEl = tr => tr.querySelector('input[type=checkbox]') || tr.querySelector('.x-grid-row-checker');
// CW marks a ticked row only with scrambled class names, so learn them: tick a row, untick it, keep the classes that came and went
const learnTick = async rows => {
  if (S.selCls) return;
  const ids = [...rows.keys()].filter(k => rows.get(k).querySelector('.x-grid-row-checker')).slice(0, 2); if (ids.length < 2) return;
  const row = id => { const tr = rows.get(id); return tr.isConnected ? tr : pageRows().get(id); };
  const click = id => { fire(tickEl(row(id)), S.tickCtrl ? { ctrlKey: true } : null); return sleep(250); };
  // plain clicks first; if ticking a second row unticks the first, try again holding Ctrl
  for (const ctrl of [false, true]) {
    S.tickCtrl = ctrl;
    const a = new Set(row(ids[0]).classList); await click(ids[0]);
    const cand = [...row(ids[0]).classList].filter(k => !a.has(k));
    await click(ids[1]);
    // what row 1 still carries after row 2 was ticked is the real "ticked" mark; a mark that moved on is only the cursor
    const keep = cand.filter(k => row(ids[0]).classList.contains(k));
    await click(ids[1]);
    if (!keep.length) continue;
    await click(ids[0]);
    if (!keep.some(k => row(ids[0]).classList.contains(k)) && !keep.some(k => row(ids[1]).classList.contains(k))) { S.selCls = keep; return; }
  }
};
const isTicked = tr => { const cb = tr.querySelector('input[type=checkbox]'); if (cb) return cb.checked;
  if (S.selCls) return S.selCls.every(k => tr.classList.contains(k));
  return tr.getAttribute('aria-selected') === 'true' || /\b(selected|checked)\b/i.test(tr.className); };
const setChecked = async (el, on, tr) => { const st = () => tr ? isTicked(tr) : el.checked; if (st() === on) return; fire(el, tr && S.tickCtrl ? { ctrlKey: true } : null); await sleep(80); if (st() !== on && el.tagName === 'INPUT') el.click(); await sleep(40); };
// tick exactly these tickets on the board page and nothing else, then prove it
const selectOnly = async (rows, ids) => {
  await learnTick(rows);
  if (!S.selCls && ![...rows.values()].some(tr => tr.querySelector('input[type=checkbox]'))) throw new Error('Couldn\'t work out how ConnectWise marks a ticked row, so nothing was changed. Please send Claude a CW Capture with one row ticked.');
  for (const id of rows.keys()) { let tr = rows.get(id); if (!tr.isConnected) { rows = pageRows(); tr = rows.get(id); if (!tr) continue; }
    const el = tickEl(tr); if (!el) throw new Error('Couldn\'t find the tick boxes on the ConnectWise board rows, so nothing was changed.'); await setChecked(el, ids.includes(id), tr); }
  if ([...rows.values()].some(tr => !tr.isConnected)) rows = pageRows();
  const got = [...rows].filter(([, tr]) => isTicked(tr)).map(([id]) => id);
  if (got.length !== ids.length || got.some(i => !ids.includes(i))) throw new Error(`Ticking tickets on the ConnectWise board didn't work (wanted ${ids.length}, saw ${got.length} ticked), so nothing was changed. Please tick one ticket on the ConnectWise board yourself, click CW Capture, and paste the result to Claude.`);
};
const openAction = async (label, sub) => {
  const act = (() => { for (const d of docs()) { const el = leaves(d, /^Actions$/).find(e => vis2(e) && !floatOf(e)); if (el) return el; } return null; })();
  if (!act) throw new Error('Couldn\'t find the Actions menu on the ConnectWise board.');
  fire(act.closest('.mm_button') || act);
  const it = await waitFor(() => floatLeaf(new RegExp('^' + reEsc(label) + '$')), 5000); if (!it) throw new Error(`Couldn't find "${label}" in the Actions menu.`);
  fire(it);
  if (sub) { const s2 = await waitFor(() => floatLeaf(new RegExp('^' + reEsc(sub) + '$')), 5000); if (!s2) throw new Error(`Couldn't find "${sub}" under "${label}".`); fire(s2); }
};
const doOne = async (kind, ids, opt, say) => {
  if (kind === 'note') {
    say('Opening Add Ticket Notes…'); await openAction('Add Ticket Notes');
    const w = await waitFor(() => cwWin('Ticket Notes'), 8000); if (!w) throw new Error('The Ticket Notes window didn\'t open.');
    for (const [cls, on] of [['cw_discussion', opt.disc], ['cw_internal', opt.int], ['cw_resolution', opt.res]]) { const cb = w.querySelector(`.${cls} input[type=checkbox]`); if (!cb) { cancelWin(w); throw new Error(`Couldn't find the ${cls.slice(3)} tick box.`); } await setChecked(cb, on); }
    const ta = w.querySelector('textarea'); if (!ta) { cancelWin(w); throw new Error('Couldn\'t find the note box.'); }
    typeInto(ta, opt.text); await sleep(200);
    // toolbar: new, save, save & close, delete
    const btns = [...w.querySelectorAll('.cw_NoteViewImpl .mm_button')]; if (btns.length < 3) { cancelWin(w); throw new Error('Couldn\'t find the note Save & Close button.'); }
    say('Saving the note…'); fire(btns[2]);
    if (!await gone(w)) throw new Error('The Ticket Notes window didn\'t close after saving. Check it in ConnectWise.');
  } else if (kind === 'status') {
    say('Opening Update Status…'); await openAction('Update Status');
    const w = await waitFor(() => cwWin('Update Service Ticket Status'), 8000); if (!w) throw new Error('The Update Status window didn\'t open.');
    const cnt = btnIn(w, /^You are about to update \d+ tickets?\.?$/), n = cnt ? +cnt.textContent.match(/\d+/)[0] : -1;
    if (n !== ids.length) { cancelWin(w); throw new Error(`ConnectWise was about to update ${n} tickets but ${ids.length} were selected, so it was cancelled.`); }
    const inp = w.querySelector('input.cw_CwComboBox') || w.querySelector('input[type=text]'); typeInto(inp, opt.status);
    let it = await waitFor(() => floatLeaf(new RegExp('^' + reEsc(opt.status) + '$'), w), 3000);
    if (!it) { const ar = inp.parentElement && inp.parentElement.querySelector('.cwsvg'); if (ar) fire(ar.parentElement || ar); it = await waitFor(() => floatLeaf(new RegExp('^' + reEsc(opt.status) + '$'), w), 3000); }
    if (!it) { cancelWin(w); throw new Error(`Couldn't find "${opt.status}" in ConnectWise's status list.`); }
    fire(it); await sleep(300);
    if (inp.value.trim() !== opt.status) { cancelWin(w); throw new Error(`The status box shows "${inp.value}" instead of "${opt.status}", so it was cancelled.`); }
    say('Saving…'); fire(btnIn(w, /^Save$/));
    if (!await gone(w)) throw new Error('The Update Status window didn\'t close after saving. Check it in ConnectWise.');
  } else {
    say('Opening Bundle…'); await openAction('Combine Tickets', 'Bundle');
    const w = await waitFor(() => cwWin('Confirm Bundle'), 8000); if (!w) throw new Error('The Confirm Bundle window didn\'t open.');
    const inp = w.querySelector('input.cw_ServiceTicketPickerComboBox') || w.querySelector('input[type=text]'); typeInto(inp, opt.parent);
    const it = await waitFor(() => floatLeaf(new RegExp('(^|\\D)' + opt.parent + '(\\D|$)'), w), 5000);
    if (!it) { cancelWin(w); throw new Error(`Couldn't pick parent ticket #${opt.parent} in ConnectWise's list.`); }
    fire(it); await sleep(400);
    if (!inp.value.includes(opt.parent) && !/\S/.test(inp.value)) { cancelWin(w); throw new Error('The parent ticket didn\'t get set, so it was cancelled.'); }
    say('Bundling…'); fire(btnIn(w, /^OK$/));
    if (!await gone(w)) throw new Error('The Confirm Bundle window didn\'t close. Check it in ConnectWise.');
  }
};
// walk the board pages from the first, acting on the selected tickets found on each page
const runAction = async (kind, ids, opt, say) => {
  S.acting = true; shield(); const done = []; let err = '';
  try {
    if (await waitFor(() => !S.busy, 60000) === null) throw new Error('The dashboard was still syncing. Try again.');
    { const b = docs().map(d => leaves(d, /^SEARCH$/).find(vis2)).find(Boolean), p0 = pager(); if (b) { say('Refreshing the board…'); b.click(); await waitChange(p0 && p0.txt, firstRow(), 8000); } }
    let p = pager(), guard = 0;
    while (p && p.a > 1 && guard++ < 25) { const pv = arrow(p, -1); if (!pv) break; say('Going to board page 1…'); pv.click(); if (!await waitChange(p.txt, firstRow(), 20000)) break; p = pager(); }
    const left = new Set(ids); guard = 0;
    for (;;) {
      const rows = pageRows(), here = [...left].filter(id => rows.has(id));
      if (kind === 'bundle' && here.length && here.length < left.size) throw new Error('Bundling needs all its tickets on the same ConnectWise board page. Filter the board to that company and try again.');
      if (here.length) { say(`Ticking ${here.length} ticket(s) on the board…`); await selectOnly(rows, here); await doOne(kind, here, opt, say); here.forEach(id => { left.delete(id); done.push(id); }); await sleep(1500); }
      if (!left.size) break;
      p = pager(); if (!p || p.b >= p.n || guard++ > 25) break;
      const nx = arrow(p, 1); if (!nx) break; say('Looking on the next board page…'); nx.click(); if (!await waitChange(p.txt, firstRow(), 20000)) break;
    }
    if (left.size && !err) err = `${left.size} ticket(s) weren't found on the board: #${[...left].join(', #')}`;
  } catch (e) { err = e.message; }
  try { const rows = pageRows(); for (const [, tr] of rows) if (isTicked(tr)) await setChecked(tickEl(tr), false, tr); } catch (e) {}
  S.acting = false; S.next = 2;
  return { done, err };
};
const ACT = { note: 'Add note', status: 'Set status', bundle: 'Bundle' };
const openModal = kind => {
  const rows = [...S.sel].map(id => S.rows.get(id)).filter(Boolean).sort((a, b) => a.id - b.id); if (!rows.length) return;
  const cos = new Set(rows.map(r => r.co)), list = rows.slice(0, 8).map(r => `<li><b>#${esc(r.id)}</b> ${esc(r.co)} · ${esc(r.sum)}</li>`).join('') + (rows.length > 8 ? `<li>…and ${rows.length - 8} more</li>` : '');
  const body = kind === 'note' ? `<div class="mlab">Note</div><div class="isobox" id="mtextbox"></div>
      <fieldset><legend>Show note in</legend><label><input type="checkbox" id="mdisc"> Discussion</label><label><input type="checkbox" id="mint" checked> Internal</label><label><input type="checkbox" id="mres"> Resolution</label></fieldset>`
    : kind === 'status' ? `<label class="mlab" for="mst">New status</label><select id="mst"><option value="">Choose a status…</option>${STATUSES.map(s => `<option>${esc(s)}</option>`).join('')}</select><p class="mhint">Only parent tickets are updated (ConnectWise rule).</p>`
    : `<fieldset class="par"><legend>Parent ticket (the others are bundled under it)</legend>${rows.map((r, i) => `<label><input type="radio" name="mpar" value="${esc(r.id)}"${i ? '' : ' checked'}> <b>#${esc(r.id)}</b> ${esc(r.sum)}</label>`).join('')}</fieldset>
       ${cos.size > 1 ? `<p class="mwarn">These tickets belong to ${cos.size} different companies. ConnectWise may refuse to bundle them.</p>` : ''}`;
  $('modal').innerHTML = `<div class="mbox"><h2 id="mtitle">${ACT[kind]} · ${rows.length} ticket${rows.length > 1 ? 's' : ''}</h2>${body}
    <details><summary>Tickets that will change</summary><ul class="mlist">${list}</ul></details>
    <p class="mstat" id="mstat" role="status"></p>
    <div class="mbtn"><button class="ghost" data-act="m-close">Cancel</button><button class="go" data-act="m-run" data-kind="${kind}">${ACT[kind]} on ${rows.length} ticket${rows.length > 1 ? 's' : ''}</button></div></div>`;
  $('modal').classList.add('on');
  if (kind === 'note') { S.noteTa = isoField($('mtextbox'), true, 'Type the note once. It is added to every selected ticket.', { Escape: () => $('modal').classList.remove('on') }); setTimeout(() => S.noteTa.focus(), 60); }
  else { const f = $('modal').querySelector('select,input'); if (f) f.focus(); }
};
const runModal = async kind => {
  const m = $('modal'), ids = [...S.sel].filter(id => S.rows.has(id)), say = t => { $('mstat').textContent = t; }; let opt = {};
  if (kind === 'note') { opt = { text: S.noteTa.value.trim(), disc: $('mdisc').checked, int: $('mint').checked, res: $('mres').checked }; if (!opt.text) return say('Type a note first.'); if (!opt.disc && !opt.int && !opt.res) return say('Tick at least one of Discussion, Internal or Resolution.'); }
  if (kind === 'status') { opt = { status: $('mst').value }; if (!opt.status) return say('Choose a status first.'); }
  if (kind === 'bundle') { const p = m.querySelector('input[name=mpar]:checked'); opt = { parent: p && p.value }; if (ids.length < 2) return say('Select at least 2 tickets to bundle.'); }
  m.querySelectorAll('button,input,select,textarea').forEach(x => x.disabled = true); m.classList.add('busy');
  const res = await runAction(kind, kind === 'bundle' ? ids : ids, opt, say);
  m.classList.remove('busy');
  const ok = res.done.length, what = kind === 'note' ? 'note added to' : kind === 'status' ? `set to ${opt.status}:` : `bundled under #${opt.parent}:`;
  S.lastErr = res.err || 'ok';
  logE('action', null, `${ACT[kind]} · ${ok ? `${what} ${ok} ticket${ok > 1 ? 's' : ''}` : 'nothing changed'}${res.err ? ' · ' + res.err : ''}`);
  if (ok && !res.err) { S.sel.clear(); }
  $('modal').querySelector('.mbox').innerHTML = `<h2 id="mtitle">${res.err ? (ok ? 'Partly done' : 'Stopped') : 'Done ✓'}</h2>
    ${ok ? `<p>${ACT[kind]}: ${what} <b>${ok}</b> ticket${ok > 1 ? 's' : ''}: #${res.done.join(', #')}.</p>` : ''}${res.err ? `<p class="mwarn">${esc(res.err)}</p>` : ''}
    <p class="mhint">The board re-syncs in a moment so the dashboard shows the change.</p><div class="mbtn"><button class="go" data-act="m-close">Close</button></div>`;
  render();
};

// board / view switching: open ConnectWise's own dropdown, come back when its value changes
const nearArrow = inp => { const r = inp.getBoundingClientRect(), cy = r.top + r.height / 2, HE = inp.ownerDocument.defaultView.HTMLElement; let best = null, bd = 1e9;
  inp.ownerDocument.querySelectorAll('*').forEach(e => { if (!(e instanceof HE) || e === inp || e.contains(inp) || e.textContent.trim()) return; const q = e.getBoundingClientRect(); if (!q.width || q.width > 30 || q.height > 30 || Math.abs(q.top + q.height / 2 - cy) > 10) return; const dx = q.left - r.right; if (dx < -30 || dx > 30) return; const d = Math.abs(dx); if (d < bd) { bd = d; best = e; } });
  return best; };
const openField = (k, what) => {
  const f = field(F[k]); if (!f) { S.note = `Couldn't find the ${what} dropdown on the ConnectWise page. Is the Service Board List open?`; render(); return; }
  S.watch = { k, val: f.val }; minimize(true);
  const el = document.createElement('div'); el.className = 'toast hint'; el.innerHTML = `<small>Change ${esc(what)}</small><div>Pick a ${esc(what)} in ConnectWise.</div><div style="color:#B9C5DD">The dashboard comes back by itself.</div><button>Cancel</button>`;
  el.querySelector('button').onclick = () => { S.watch = null; el.remove(); minimize(false); render(); };
  $('toasts').prepend(el); S.hintEl = el;
  try { f.inp.scrollIntoView({ block: 'center' }); f.inp.focus(); (nearArrow(f.inp) || f.inp).click(); } catch (e) {}
};
const checkWatch = () => {
  const f = field(F[S.watch.k]); if (!f || f.val === S.watch.val) return;
  S.watch = null; if (S.hintEl) S.hintEl.remove();
  S.seen.clear(); S.fresh.clear(); S.hist = []; S.focus = null; S.rows = new Map(); S.boot = 0; S.fx = []; document.title = S.title;
  minimize(false); S.note = 'Loading the new board…'; S.ctx = readCtx(); render();
  setTimeout(() => sync(true, true), 1500);
};

const cv = $('cv'), x = cv.getContext('2d'); let W = 0, H = 0, DPR = 1;
const fit = () => { const b = cv.getBoundingClientRect(); DPR = Math.min(1.5, window.devicePixelRatio || 1); W = b.width; H = b.height; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); };
const ro = new ResizeObserver(fit); ro.observe(cv);
const C = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const TAU = Math.PI * 2, ease = v => 1 - Math.pow(1 - v, 3), clamp = v => Math.max(0, Math.min(1, v));
const draw = t => {
  S.raf = requestAnimationFrame(draw);
  if (t - (S.lf2 || 0) < 30) return; S.lf2 = t;
  if (S.min || S.page !== 'overview' || document.hidden || !W) { S.lt = t; return; }
  const sp = RM ? 0 : 1;
  const dt = Math.min(100, t - (S.lt || t)); S.lt = t; if (!S.hov && !S.zoom) S.ang = (S.ang || 0) + dt * .00008 * sp;
  x.setTransform(DPR, 0, 0, DPR, 0, 0); x.clearRect(0, 0, W, H); x.globalAlpha = 1;
  const zE = S.zoom ? (RM ? 1 : ease(clamp((t - S.zoom.t0) / 700))) : 0;
  const cx = W * .52, cy = H * .5, a = S.ang || 0, ca = Math.cos(a), sa = Math.sin(a), SX = Math.min(W * .42, H * 1.05) * (1 + zE * .5), sw0 = (t * .0005 * sp) % TAU;
  const P = (px, py, pz) => { const rx = px * ca - pz * sa, rz = px * sa + pz * ca, k = 1 / (1.55 - rz * .45); return { x: cx + rx * SX * k, y: cy + py * H * .40 * k + rz * H * (.11 + (S.tilt || 0)), k, z: rz, na: Math.atan2(rz, rx) }; };
  x.save(); x.translate(cx, cy + H * .30); x.scale(1, .3);
  for (let i = 1; i <= 6; i++) { x.beginPath(); x.arc(0, 0, SX * .16 * i, 0, TAU); x.strokeStyle = C([45, 225, 194], .03 + .018 * (6 - i)); x.lineWidth = 1; x.stroke(); }
  x.rotate(sw0); const swg = x.createLinearGradient(0, 0, SX, 0); swg.addColorStop(0, C([45, 225, 194], 0)); swg.addColorStop(1, C([45, 225, 194], .22));
  x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, SX * .96, 0, .5); x.closePath(); x.fillStyle = swg; x.fill();
  x.restore();
  // urgency ring guides
  if (zE < 1) RINGS.forEach((R, tr) => {
    const [lab, rc] = RING_LBL[tr]; x.beginPath();
    // sample at screen-fixed angles so the dashes and the label never move while the map turns
    for (let j = 0; j <= 64; j++) { const q = P(Math.cos(j / 64 * TAU - a) * R, 0, Math.sin(j / 64 * TAU - a) * R); j ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y); }
    x.globalAlpha = 1 - zE; x.setLineDash([2, 7]); x.strokeStyle = C(rc, .38); x.lineWidth = 1; x.stroke(); x.setLineDash([]);
    const e = P(Math.cos(-a) * R, 0, Math.sin(-a) * R);
    x.font = '600 9px Bahnschrift, Segoe UI, sans-serif'; x.letterSpacing = '2px'; x.fillStyle = C(rc, .75); x.fillText(lab, e.x + 8, e.y + 3); x.letterSpacing = '0px'; x.globalAlpha = 1;
  });
  // nodes glide to their ring when urgency changes
  const hub = P(0, 0, 0), ps = NODES.map(n => { const k = Math.min(1, dt * .003); n.px += (n.x - n.px) * k; n.py += (n.y - n.py) * k; n.pz += (n.z - n.pz) * k; S.pos.set(n.co, { px: n.px, py: n.py, pz: n.pz }); return Object.assign(P(n.px, n.py, n.pz), { n }); });
  const zp = S.zoom && ps.find(q => q.n.co === S.zoom.co);
  if (zp) { zp.x += (cx - zp.x) * zE; zp.y += (cy - 14 - zp.y) * zE; zp.k *= 1 + zE * 1.3; }
  // startup: nodes pop in one by one, spokes draw out, labels type
  const bt = S.boot ? clamp((t - S.boot) / 2400) : 0;
  const ap = i => RM ? 1 : ease(clamp((bt * 1.9 - i * .06) / .35));
  const hv = S.hovCo, dimOf = n => hv && n.co !== hv ? .28 : 1;
  // radar: a node brightens as the sweep passes it, then fades
  const ping = p => { if (RM) return 0; const f = ((sw0 + .5 - p.na) % TAU + TAU) % TAU; return f < 1.8 ? 1 - f / 1.8 : 0; };
  // steady companies rust as their tickets age (average 7 days fresh → 45 days rusted)
  const colOf = n => n.hot ? [255, 77, 106] : n.fresh ? [255, 181, 71] : mix([45, 225, 194], [184, 112, 72], clamp((n.avg - 7) / 38));
  x.lineWidth = 1;
  // shared-coverage links; hovering a node lights up only its links
  LINKS.forEach(([i, j, w]) => { const p = ps[i], q = ps[j]; if (!p || !q) return; const mine = hv && (p.n.co === hv || q.n.co === hv);
    x.globalAlpha = Math.min(ap(p.n.i), ap(q.n.i)) * (hv ? (mine ? 1 : .15) : 1) * (1 - zE); x.lineWidth = Math.min(3, .6 + w * .35);
    x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(q.x, q.y); x.strokeStyle = C(mine ? [127, 216, 255] : [77, 139, 255], mine ? .7 : .08 + Math.min(.3, w * .04)); x.stroke(); });
  x.lineWidth = 1;
  ps.forEach((p, i) => {
    const A = ap(p.n.i); if (!A) return;
    const col = colOf(p.n), ex = hub.x + (p.x - hub.x) * A, ey = hub.y + (p.y - hub.y) * A;
    x.globalAlpha = dimOf(p.n) * (1 - zE); x.beginPath(); x.moveTo(hub.x, hub.y); x.lineTo(ex, ey); x.strokeStyle = C(col, .28); x.lineWidth = 1.2; x.stroke();
    if (A < 1) return;
    // comets with fading tails; urgent lines run faster
    const k = Math.min(4, 1 + (p.n.n >> 2)), spd = p.n.tier === 0 ? 1.9 : p.n.tier === 1 ? 1.2 : .8;
    for (let j = 0; j < k; j++) {
      const f = (t * .00022 * sp * spd * (1 + i % 3 * .2) + j / k) % 1, f0 = Math.max(0, f - .14), hx = hub.x + (p.x - hub.x) * f, hy = hub.y + (p.y - hub.y) * f, tx = hub.x + (p.x - hub.x) * f0, ty = hub.y + (p.y - hub.y) * f0;
      const g = x.createLinearGradient(tx, ty, hx, hy); g.addColorStop(0, C(col, 0)); g.addColorStop(1, C(col, .9 - f * .3));
      x.strokeStyle = g; x.lineWidth = 2; x.beginPath(); x.moveTo(tx, ty); x.lineTo(hx, hy); x.stroke();
      x.beginPath(); x.arc(hx, hy, 1.8, 0, TAU); x.fillStyle = '#fff'; x.fill();
    }
  });
  x.globalAlpha = 1 - zE;
  x.fillStyle = C([45, 225, 194], .12); x.beginPath(); x.arc(hub.x, hub.y, 30, 0, TAU); x.fill();
  x.save(); x.translate(hub.x, hub.y); x.rotate(t * .0009 * sp + .785); x.strokeStyle = C([45, 225, 194], .95); x.lineWidth = 1.6; x.strokeRect(-9, -9, 18, 18); x.rotate(-t * .0018 * sp); x.strokeStyle = C([77, 139, 255], .8); x.strokeRect(-5.5, -5.5, 11, 11); x.restore();
  x.font = '700 10px Bahnschrift, Segoe UI, sans-serif'; x.fillStyle = '#9FF5E5'; x.textAlign = 'center'; x.letterSpacing = '3px'; x.fillText(hubLbl(), hub.x, hub.y + 28); x.letterSpacing = '0px'; x.textAlign = 'left'; x.globalAlpha = 1;
  x.font = '600 11px Segoe UI, sans-serif';
  const placed = [], nr = p => (3 + Math.sqrt(p.n.n) * 2.3) * p.k;
  ps.slice().sort((p, q) => (q.n.hot - p.n.hot) || (q.n.fresh - p.n.fresh) || (q.n.n - p.n.n)).forEach(p => {
    p.lab = null; if (placed.length >= 7 || ap(p.n.i) < 1 || p === zp) return;
    const n = p.n, name = n.co.length > 24 ? n.co.slice(0, 23) + '…' : n.co, w = x.measureText(name).width + 38, r = nr(p);
    const offs = [[16, -r - 26], [-w - 16, -r - 26], [16, r + 8], [-w - 16, r + 8]];
    for (const o of (n.lo != null ? [n.lo, 0, 1, 2, 3] : [0, 1, 2, 3])) {
      const L = { x: p.x + offs[o][0], y: p.y + offs[o][1], w, h: 18, name };
      if (L.x < 6 || L.y < 40 || L.x + w > W - 6 || L.y + 18 > H - 32) continue;
      if (placed.some(q => L.x < q.x + q.w + 6 && q.x < L.x + L.w + 6 && L.y < q.y + q.h + 4 && q.y < L.y + L.h + 4)) continue;
      placed.push(L); p.lab = L; n.lo = o; break;
    }
  });
  S.hits = ps.filter(p => ap(p.n.i) === 1).map(p => ({ x: p.x, y: p.y, r: nr(p) + 10, co: p.n.co, L: p.lab }));
  ps.slice().sort((p, q) => p.z - q.z).forEach(p => {
    const n = p.n, A = ap(n.i); if (!A) return;
    const col = colOf(n), r = nr(p) * (A < 1 ? A * 1.15 : 1), pg = ping(p);
    x.globalAlpha = dimOf(n);
    x.fillStyle = C(col, .10 + pg * .15); x.beginPath(); x.arc(p.x, p.y, r * 3.2, 0, TAU); x.fill();
    x.fillStyle = C(col, .18 + pg * .2); x.beginPath(); x.arc(p.x, p.y, r * 1.9, 0, TAU); x.fill();
    x.beginPath(); x.arc(p.x, p.y, r, 0, TAU); x.fillStyle = C(col, .95); x.fill();
    x.beginPath(); x.arc(p.x, p.y, r * (.42 + pg * .25), 0, TAU); x.fillStyle = '#fff'; x.fill();
    if (pg > .02) { x.beginPath(); x.arc(p.x, p.y, r + (1 - pg) * r * 5, 0, TAU); x.strokeStyle = C(col, pg * .7); x.lineWidth = 1.2; x.stroke(); }
    if (A === 1 && (n.hot || n.fresh)) { const f = (t * .0011 * sp + n.i * .27) % 1; x.beginPath(); x.arc(p.x, p.y, r + f * r * 4, 0, TAU); x.strokeStyle = C(col, (1 - f) * .85); x.lineWidth = 1.5; x.stroke(); }
    if (A === 1) { const sat = Math.min(n.n, 10); for (let j = 0; j < sat; j++) { const an = t * .0007 * sp * (1 + j % 3 * .25) + j * TAU / sat, rr = r + 8 * p.k; x.beginPath(); x.arc(p.x + Math.cos(an) * rr, p.y + Math.sin(an) * rr * .45, 1.3, 0, TAU); x.fillStyle = C(col, .75); x.fill(); } }
    if (p.lab) {
      const { x: lx, y: ly, w } = p.lab, tp = RM ? 1 : clamp((bt * 1.9 - n.i * .06 - .35) / .4), name = p.lab.name.slice(0, Math.ceil(p.lab.name.length * tp)), ex = lx > p.x ? lx : lx + w, sy = ly < p.y ? p.y - r : p.y + r;
      x.beginPath(); x.moveTo(p.x, sy); x.lineTo(p.x + (ex > p.x ? 8 : -8), ly + 9); x.lineTo(ex, ly + 9); x.strokeStyle = C(col, .55); x.lineWidth = 1; x.stroke();
      x.font = '600 11px Segoe UI, sans-serif'; x.fillStyle = 'rgba(6,11,22,.9)'; x.fillRect(lx, ly, w, 18); x.strokeStyle = C(col, .55 + pg * .4); x.strokeRect(lx + .5, ly + .5, w - 1, 17);
      x.fillStyle = C(col, 1); x.fillRect(lx, ly, 2, 18);
      x.fillStyle = '#E6ECF7'; x.fillText(name, lx + 8, ly + 13); if (tp === 1) { x.fillStyle = C(col, 1); x.font = '700 11px Bahnschrift, Consolas, monospace'; x.fillText(n.n, lx + w - 24, ly + 13); }
    } else if (pg > .55 && A === 1 && p !== zp) { x.font = '600 10px Segoe UI, sans-serif'; x.fillStyle = C(col, pg); x.fillText(n.co.length > 22 ? n.co.slice(0, 21) + '…' : n.co, p.x + r + 6, p.y - r - 4); }
  });
  x.globalAlpha = 1;
  // new ticket: beam strikes the company, shockwave rings out. client reply: pink pulse runs up to the hub
  S.fx = S.fx.filter(f => t - f.t0 < 2600);
  S.fx.forEach(f => {
    const e = t - f.t0; if (e < 0) return;
    const p = ps.find(q => q.n.co === f.co) || hub, col = f.kind === 'reply' ? [244, 114, 182] : [255, 181, 71];
    if (f.kind !== 'reply') {
      const sx = W - 30, sy = 30, k = ease(clamp(e / 450)), hx = sx + (p.x - sx) * k, hy = sy + (p.y - sy) * k, fade = e < 450 ? 1 : clamp(1 - (e - 450) / 700);
      if (fade > 0) { x.globalAlpha = fade; const g = x.createLinearGradient(sx, sy, hx, hy); g.addColorStop(0, C(col, 0)); g.addColorStop(1, C(col, 1)); x.strokeStyle = g; x.lineWidth = 2.5; x.beginPath(); x.moveTo(sx, sy); x.lineTo(hx, hy); x.stroke(); x.fillStyle = '#fff'; x.beginPath(); x.arc(hx, hy, 3.5, 0, TAU); x.fill(); }
      for (let j = 0; j < 3; j++) { const rr = (e - 420 - j * 200) / 1500; if (rr <= 0 || rr >= 1) continue; x.globalAlpha = 1 - rr; x.strokeStyle = C(col, .9); x.lineWidth = 2 - rr; x.beginPath(); x.ellipse(p.x, p.y, rr * 170, rr * 60, 0, 0, TAU); x.stroke(); }
      if (e > 420 && e < 900) { x.globalAlpha = 1 - (e - 420) / 480; x.fillStyle = '#fff'; x.beginPath(); x.arc(p.x, p.y, 14, 0, TAU); x.fill(); }
    } else {
      const k = ease(clamp(e / 900)), qx = p.x + (hub.x - p.x) * k, qy = p.y + (hub.y - p.y) * k;
      if (e < 900) { x.globalAlpha = 1; const g = x.createLinearGradient(p.x, p.y, qx, qy); g.addColorStop(0, C(col, 0)); g.addColorStop(1, C(col, .9)); x.strokeStyle = g; x.lineWidth = 2.5; x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(qx, qy); x.stroke(); x.fillStyle = C(col, .35); x.beginPath(); x.arc(qx, qy, 9, 0, TAU); x.fill(); x.fillStyle = '#fff'; x.beginPath(); x.arc(qx, qy, 3, 0, TAU); x.fill(); }
      const rr = (e - 900) / 1200; if (rr > 0 && rr < 1) { x.globalAlpha = 1 - rr; x.strokeStyle = C(col, .9); x.lineWidth = 2; x.beginPath(); x.ellipse(hub.x, hub.y, 20 + rr * 120, (20 + rr * 120) * .4, 0, 0, TAU); x.stroke(); }
    }
    x.globalAlpha = 1;
  });
  // hover: target brackets lock on, the rest dims, a readout panel shows the company's numbers
  // zoomed in: the company sits in the middle with its tickets fanned out around it
  S.satHits = [];
  if (zp) {
    const n = zp.n, col = colOf(n), rows = n.rows.slice().sort(urgency).slice(0, 24), r0 = nr(zp);
    x.font = '600 15px Segoe UI, sans-serif'; x.textAlign = 'center'; x.globalAlpha = zE; x.fillStyle = '#fff'; x.fillText(n.co, zp.x, zp.y - r0 - 18);
    x.font = '12px Segoe UI, sans-serif'; x.fillStyle = C(col, 1); x.fillText(`${n.n} open · ${n.risk} at risk · ${n.rep} replied${n.n > rows.length ? ` · showing ${rows.length} most urgent` : ''}`, zp.x, zp.y + r0 + 26); x.textAlign = 'left';
    rows.forEach((r, j) => {
      const A = RM ? 1 : ease(clamp((t - S.zoom.t0 - 350 - j * 35) / 420)); if (!A) return;
      const an = -Math.PI / 2 + j / rows.length * TAU, rad = (rows.length > 12 && j % 2 ? 175 : 125) * A, sx2 = zp.x + Math.cos(an) * rad * 1.25, sy2 = zp.y + Math.sin(an) * rad * .78;
      const sc = stColor(r.st), on = S.hovSat === r.id, rr = on ? 7 : 5;
      x.globalAlpha = A; x.strokeStyle = sc; x.globalAlpha = A * .3; x.lineWidth = 1; x.beginPath(); x.moveTo(zp.x, zp.y); x.lineTo(sx2, sy2); x.stroke();
      x.globalAlpha = A; x.fillStyle = sc; x.globalAlpha = A * .25; x.beginPath(); x.arc(sx2, sy2, rr * 2.6, 0, TAU); x.fill();
      x.globalAlpha = A; x.beginPath(); x.arc(sx2, sy2, rr, 0, TAU); x.fill(); x.fillStyle = '#fff'; x.beginPath(); x.arc(sx2, sy2, rr * .4, 0, TAU); x.fill();
      if (isBr(r) || S.fresh.has(r.id) || isReply(r)) { const f = (t * .0012 + j * .2) % 1; x.strokeStyle = sc; x.globalAlpha = A * (1 - f) * .8; x.beginPath(); x.arc(sx2, sy2, rr + f * 14, 0, TAU); x.stroke(); }
      x.globalAlpha = A; x.font = '600 10.5px Bahnschrift, Consolas, monospace'; x.fillStyle = on ? '#fff' : '#9FB2D4'; const right = Math.cos(an) >= 0; x.textAlign = right ? 'left' : 'right'; x.fillText('#' + r.id, sx2 + (right ? 10 : -10), sy2 + 4); x.textAlign = 'left';
      S.satHits.push({ x: sx2, y: sy2, id: r.id });
      if (on) {
        const w = 280, h = 64, bx = Math.max(8, Math.min(W - w - 8, sx2 + (right ? 16 : -16 - w))), by = Math.max(40, Math.min(H - h - 34, sy2 - h / 2)), sm = r.sum.length > 42 ? r.sum.slice(0, 41) + '…' : r.sum;
        x.fillStyle = 'rgba(6,11,22,.96)'; x.fillRect(bx, by, w, h); x.strokeStyle = sc; x.strokeRect(bx + .5, by + .5, w - 1, h - 1); x.fillStyle = sc; x.fillRect(bx, by, 2, h);
        x.font = '600 12px Segoe UI, sans-serif'; x.fillStyle = '#fff'; x.fillText(sm, bx + 12, by + 20); x.font = '11.5px Segoe UI, sans-serif'; x.fillStyle = '#B9C5DD';
        x.fillText(`${r.pname} · ${r.st.length > 22 ? r.st.slice(0, 21) + '…' : r.st} · ${r.age.toFixed(1)}d`, bx + 12, by + 38); x.fillStyle = sc; x.font = '600 11px Segoe UI, sans-serif'; x.fillText('Click to open ticket #' + r.id, bx + 12, by + 55);
      }
    });
    x.globalAlpha = zE * .8; x.font = '600 11px Segoe UI, sans-serif'; x.fillStyle = '#97A6C2'; x.textAlign = 'center'; x.fillText('Esc or click empty space to zoom out', cx, H - 40); x.textAlign = 'left'; x.globalAlpha = 1;
  }
  const hp = !zp && hv && ps.find(q => q.n.co === hv);
  if (hp && ap(hp.n.i) === 1) {
    const n = hp.n, col = colOf(n), e2 = RM ? 1 : ease(clamp((t - S.hovT) / 280)), s = (nr(hp) + 12) * (2.4 - 1.4 * e2), L = 9;
    x.globalAlpha = e2; x.strokeStyle = C(col, 1); x.lineWidth = 2;
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([dx, dy]) => { const X = hp.x + dx * s, Y = hp.y + dy * s; x.beginPath(); x.moveTo(X, Y - dy * L); x.lineTo(X, Y); x.lineTo(X - dx * L, Y); x.stroke(); });
    x.save(); x.translate(hp.x, hp.y); x.rotate(t * .002 * sp); x.setLineDash([3, 6]); x.lineWidth = 1; x.beginPath(); x.arc(0, 0, s * 1.35, 0, TAU); x.stroke(); x.restore(); x.setLineDash([]);
    const w = 240, h = 108; let px = hp.x + s + 22; if (px + w > W - 8) px = hp.x - s - 22 - w; const py = Math.max(40, Math.min(H - h - 34, hp.y - h / 2));
    x.beginPath(); x.moveTo(hp.x + (px > hp.x ? s : -s), hp.y); x.lineTo(px > hp.x ? px : px + w, py + 16); x.strokeStyle = C(col, .6); x.lineWidth = 1; x.stroke();
    x.fillStyle = 'rgba(6,11,22,.95)'; x.fillRect(px, py, w, h); x.strokeStyle = C(col, .65); x.strokeRect(px + .5, py + .5, w - 1, h - 1); x.fillStyle = C(col, 1); x.fillRect(px, py, w, 2);
    x.fillStyle = '#fff'; x.font = '600 12.5px Segoe UI, sans-serif'; x.fillText(n.co.length > 30 ? n.co.slice(0, 29) + '…' : n.co, px + 12, py + 22);
    x.font = '12px Segoe UI, sans-serif'; x.fillStyle = '#B9C5DD'; x.fillText(`${n.n} open · ${n.risk} at risk · ${n.rep} replied`, px + 12, py + 42);
    let bx = px + 12; const bw = w - 24; n.mix.forEach(([c2, k2]) => { const ww = bw * k2 / n.n; x.fillStyle = c2; x.fillRect(bx, py + 52, ww, 5); bx += ww; });
    const tp = n.rows.reduce((m, r) => r.prank < m.prank ? r : m);
    x.fillStyle = tp.pcol || '#97A6C2'; x.fillRect(px + 12, py + 68, 8, 8); x.fillStyle = '#DCE6F7'; x.fillText(`Top ${tp.pname} · oldest ${n.old.toFixed(1)}d`.slice(0, 40), px + 26, py + 77);
    x.fillStyle = C(col, 1); x.font = '600 11px Segoe UI, sans-serif'; x.fillText(`${n.eng ? 'Mostly ' + (n.eng.length > 18 ? n.eng.slice(0, 17) + '…' : n.eng) + ' · ' : ''}click to zoom in`, px + 12, py + 96);
    x.globalAlpha = 1;
  }
  if (!NODES.length || bt < 1) {
    x.font = '600 12px Bahnschrift, Segoe UI, sans-serif'; x.textAlign = 'center'; x.letterSpacing = '4px';
    x.fillStyle = C([45, 225, 194], .55 + .35 * Math.sin(t * .006)); x.fillText(NODES.length ? `INITIALISING TOPOLOGY  ${Math.round(bt * 100)}%` : 'SCANNING BOARD…', cx, H - 46);
    x.letterSpacing = '0px'; x.textAlign = 'left';
  }
};

// a text box inside its own little frame: keystrokes typed there never reach ConnectWise's page,
// whose "type anywhere" handler otherwise grabs them (it put note text into the board's Ticket # filter)
function isoField(holder, multi, placeholder, keys) {
  const f = document.createElement('iframe'); f.className = 'iso'; f.title = placeholder; holder.appendChild(f);
  const d = f.contentDocument, tag = multi ? 'textarea' : 'input';
  d.open(); d.write(`<!doctype html><html><head><style>html,body{margin:0;height:100%;background:${multi ? '#0A1122' : '#0E1630'}}
    ${tag}{box-sizing:border-box;width:100%;height:100%;border:0;outline:0;resize:none;background:transparent;color:#fff;font:13px/1.5 "Segoe UI",sans-serif;padding:${multi ? '10px' : '0'}}
    ${tag}::placeholder{color:#7C8BA8}</style></head><body><${tag} aria-label="${esc(placeholder)}" placeholder="${esc(placeholder)}"></${tag}></body></html>`); d.close();
  const el = d.querySelector(tag);
  d.addEventListener('keydown', e => { const k = keys && keys[e.key]; if (k) { e.preventDefault(); k(); } });
  return el;
}
// CW blocks Backspace/Delete outside its own fields (to stop "browser back"), which also kills them in our boxes.
// So in our text boxes we do the deletion ourselves, and keep our keystrokes from reaching CW's handlers.
const editable = t => t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && /^(text|search)$/.test(t.type)));
root.addEventListener('keydown', e => {
  const t = e.composedPath()[0]; if (!editable(t)) return;
  e.stopPropagation();
  if (e.key === 'Escape' && t.id === 'q') { t.blur(); return; }
  if (e.key !== 'Backspace' && e.key !== 'Delete') return;
  e.preventDefault();
  const v = t.value; let a = t.selectionStart, b = t.selectionEnd; if (a == null) return;
  if (a === b) {
    if (e.key === 'Backspace') { if (!a) return; a = e.ctrlKey ? v.slice(0, a).replace(/\s*\S*\s*$/, '').length : a - 1; }
    else { if (b >= v.length) return; b = e.ctrlKey ? v.length - v.slice(b).replace(/^\s*\S*/, '').length : b + 1; }
  }
  t.setRangeText('', a, b, 'end'); t.dispatchEvent(new Event('input', { bubbles: true }));
});
['keypress', 'keyup'].forEach(k => root.addEventListener(k, e => { if (editable(e.composedPath()[0])) e.stopPropagation(); }));
let qT = 0;
S.qIn = isoField($('qbox'), false, 'Search tickets, companies…', { Escape: () => { S.qIn.blur(); window.focus(); } });
S.qIn.addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(() => { S.q = S.qIn.value.trim(); render(); }, 150); });
const typing = e => { const t = e.composedPath()[0]; return t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName); };
const onKey = e => {
  if (S.min) return;
  if (e.key === 'Escape') { if (typing(e)) return; if (S.zoom) { zoomOut(); return; } minimize(true); return; }
  if (typing(e) || e.ctrlKey || e.altKey || e.metaKey) return;
};
document.addEventListener('keydown', onKey);
const go = page => { S.page = page; render(); ov.scrollTo({ top: 0 }); };
ov.addEventListener('click', e => {
  const t = e.target.closest('[data-sel],[data-selall],[data-topo],[data-tab],[data-page],[data-range],[data-act],[data-fco],[data-feng],[data-ffac],[data-fpr],[data-sort],[data-id]'); if (!t) return;
  // ticking tickets in the Queue (shift-click ticks a range)
  if (t.dataset.sel) { const id = t.dataset.sel, ids = [...root.querySelectorAll('#qfull [data-sel]')].map(x => x.dataset.sel);
    if (e.shiftKey && S.lastSel && ids.includes(S.lastSel)) { const [a, b] = [ids.indexOf(S.lastSel), ids.indexOf(id)].sort((x, y) => x - y); ids.slice(a, b + 1).forEach(i => S.sel.add(i)); }
    else S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id);
    S.lastSel = id; render(); return; }
  if (t.dataset.selall) { const ids = [...root.querySelectorAll('#qfull [data-sel]')].map(x => x.dataset.sel), all = ids.every(i => S.sel.has(i)); ids.forEach(i => all ? S.sel.delete(i) : S.sel.add(i)); render(); return; }
  if (t.dataset.topo) { S.topo = t.dataset.topo === 'eng' ? 'eng' : null; if (S.focus && S.focus.zoom) S.focus = null; S.zoom = null; S.hovCo = null; S.boot = 0; render(); return; }
  const d = t.dataset;
  if (d.tab) { S.tab = d.tab; render(); return; }
  if (d.page) { go(d.page); return; }
  if (d.range) { S.range = d.range; render(); return; }
  if (d.sort) { const k = d.sort; S.sort = !S.sort || S.sort.k !== k ? { k, dir: 1 } : S.sort.dir > 0 ? { k, dir: -1 } : null; render(); return; }
  if (d.act) { const k = d.act;
    if (k === 'now') S.next = 1; if (k === 'min') minimize(true); if (k === 'stop') stop(); if (k === 'me') askMe(); if (k === 'clearf') { S.focus = null; render(); }
    if (k === 'check') selfCheck();
    if (k === 'prdiag') { const txt = PRDIAG || 'no details captured'; (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => { S.note = 'Priority details copied. Paste them to Claude.'; render(); }, () => prompt('Copy this and paste it to Claude:', txt)); }
    if (k === 'board') openField('board', 'service board'); if (k === 'view') openField('view', 'view');
    if (k === 'sound') { S.mute = !S.mute; store('nocLiveMute', S.mute ? '1' : '0'); if (!S.mute) beep(); render(); }
    if (k === 'notify') { if (S.notify) { S.notify = false; store('nocLiveNotify', '0'); render(); } else if (window.Notification) Notification.requestPermission().then(p => { S.notify = p === 'granted'; store('nocLiveNotify', S.notify ? '1' : '0'); if (!S.notify) S.note = 'Windows alerts are blocked in this browser, so only the in-page alerts will show.'; render(); }); }
    return; }
  if (d.fco) { const v = d.fco; S.focus = { label: v, fn: r => r.co === v }; go(S.page === 'companies' ? 'queue' : S.page); return; }
  if (d.feng) { const v = d.feng.toLowerCase(); S.focus = { label: d.feng, fn: v === 'unassigned' ? r => !r.res.length : r => r.res.some(p => p.toLowerCase() === v) }; go(S.page === 'engineers' ? 'queue' : S.page); return; }
  if (d.fpr) { const v = d.fpr; S.focus = { label: v, fn: r => r.pname === v }; render(); return; }
  if (d.ffac && S.fac) { const f = S.fac[+d.ffac]; S.focus = { label: f[0], fn: f[4] }; render(); return; }
  if (d.id) openT(d.id);
});
ov.addEventListener('keydown', e => { const tr = e.target.closest && e.target.closest('tr[data-id]'); if (tr && e.target.tagName !== 'INPUT' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openT(tr.dataset.id); } });
const askMe = () => { const v = prompt('Your ConnectWise member name, exactly as it shows in the Resources column (for example radley.ratnakar):', S.me || ''); if (v == null) return; S.me = v.trim(); store('nocLiveMe', S.me); render(); };
const hitAt = e => { const b = cv.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top; return (S.hits || []).find(h => Math.hypot(h.x - mx, h.y - my) < h.r || (h.L && mx >= h.L.x && mx <= h.L.x + h.L.w && my >= h.L.y && my <= h.L.y + h.L.h)); };
const zoomIn = co => { S.zoom = { co, t0: performance.now() }; S.focus = { label: co, fn: nodeFn(co), zoom: true }; S.hovCo = null; render(); };
const zoomOut = () => { S.zoom = null; S.hovSat = null; if (S.focus && S.focus.zoom) S.focus = null; render(); };
const satAt = e => { const b = cv.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top; return (S.satHits || []).find(q => Math.hypot(q.x - mx, q.y - my) < 12); };
// drag to rotate (left-right) and tilt (up-down); a drag doesn't count as a click
cv.addEventListener('pointerdown', e => { S.drag = { x: e.clientX, y: e.clientY, moved: 0 }; try { cv.setPointerCapture(e.pointerId); } catch (er) {} });
cv.addEventListener('pointermove', e => { if (!S.drag || !e.buttons) return; const dx = e.clientX - S.drag.x, dy = e.clientY - S.drag.y; S.drag.x = e.clientX; S.drag.y = e.clientY; S.drag.moved += Math.abs(dx) + Math.abs(dy);
  if (S.zoom || S.drag.moved < 5) return; S.ang = (S.ang || 0) + dx * .008; S.tilt = Math.max(-.08, Math.min(.14, (S.tilt || 0) + dy * .001)); cv.style.cursor = 'grabbing'; });
cv.addEventListener('pointerup', () => setTimeout(() => { S.drag = null; }, 0));
cv.addEventListener('click', e => {
  if (S.drag && S.drag.moved >= 5) return;
  if (S.zoom) { const s = satAt(e); if (s) openT(s.id); else if (!hitAt(e)) zoomOut(); return; }
  const h = hitAt(e); if (h) zoomIn(h.co);
});
cv.addEventListener('mousemove', e => {
  if (S.zoom) { const s = satAt(e); S.hovSat = s ? s.id : null; cv.style.cursor = s ? 'pointer' : hitAt(e) ? 'default' : 'zoom-out'; return; }
  S.hov = true; const h = hitAt(e), co = h ? h.co : null; cv.style.cursor = h ? 'pointer' : 'default'; if (co !== S.hovCo) { S.hovCo = co; S.hovT = performance.now(); } });
cv.addEventListener('mouseleave', () => { S.hov = false; S.hovCo = null; });
// action bar and action windows
$('abar').addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (!b) return; const k = b.dataset.act;
  if (k === 'a-clear') { S.sel.clear(); render(); } else openModal(k.slice(2)); });
$('modal').addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (e.target === $('modal') && !$('modal').classList.contains('busy')) { $('modal').classList.remove('on'); return; } if (!b) return;
  if (b.dataset.act === 'm-close') $('modal').classList.remove('on'); else if (b.dataset.act === 'm-run') runModal(b.dataset.kind);
  else if (b.dataset.act === 'm-copy') { const t = $('modal').querySelector('pre').textContent; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => { b.textContent = 'Copied ✓'; }, () => prompt('Copy all of this and paste it to Claude:', t)); } });
$('modal').addEventListener('keydown', e => { if (e.key === 'Escape' && !$('modal').classList.contains('busy')) { e.stopPropagation(); $('modal').classList.remove('on'); } });
$('chip').onclick = () => { if (S.watch) { S.watch = null; if (S.hintEl) S.hintEl.remove(); } minimize(false); render(); };
const stop = () => { [...document.body.children].forEach(e => { e.inert = false; }); clearInterval(S.t); cancelAnimationFrame(S.raf); ro.disconnect(); document.removeEventListener('keydown', onKey); host.remove(); document.title = S.title; delete window.__cwD; };
window.__cwD = { ver: VER, toggle: () => { minimize(!S.min); if (!S.min) render(); }, stop };

// read-only test of everything the dashboard relies on in ConnectWise; changes nothing
function selfCheck() {
  const rows = pageRows(), p = pager(), st = window.__nocFeedSet, L = [], add = (ok, t) => L.push(`${ok ? 'OK  ' : 'FAIL'} ${t}`);
  const ids = docs().reduce((n, d) => n + leaves(d, /^\d{7,9}$/).filter(vis2).length, 0);
  const layers = [...document.body.children].filter(e => e !== host).slice(0, 8).map(e => { const r = e.getBoundingClientRect(); return `${e.tagName.toLowerCase()} ${getComputedStyle(e).position} ${Math.round(r.width)}x${Math.round(r.height)}`; });
  L.push(`NOC Live v${VER} · ${S.rows.size} tickets loaded · ${S.fast ? 'direct read' : 'screen read'}${S.feedWhy ? ' (' + S.feedWhy + ')' : ''}`);
  add(ids > 0, `ticket numbers visible on the ConnectWise board: ${ids}`);
  add(rows.size > 0, `board rows with a tick box: ${rows.size}`);
  add(docs().some(d => leaves(d, /^Actions$/).some(e => vis2(e) && !floatOf(e))), 'Actions menu found');
  add(docs().some(d => leaves(d, /^SEARCH$/).some(vis2)), 'SEARCH button found');
  add(!!p, `page counter: ${p ? p.txt : 'not found'}`);
  add(!p || (p.a === 1 && p.b >= p.n) || !!arrow(p, 1) || !!arrow(p, -1), 'page arrows found');
  add(!docs().some(d => leaves(d, /^No Records Found$/i).some(vis2)), 'board is not showing "No Records Found"');
  add(!!(st && st.pages.size), `board data requests noted: ${st ? st.pages.size : 0}`);
  add('inert' in document.body, 'focus shield supported by this browser');
  L.push(`tick style: ${S.selCls ? S.selCls.length + ' style names learned' : 'not learned yet (happens on the first action)'}`);
  L.push(`last action: ${S.lastErr || 'none yet'}`);
  L.push(`board: ${JSON.stringify(S.ctx)}`);
  L.push(`page layers: ${layers.join(' | ')}`);
  $('modal').innerHTML = `<div class="mbox"><h2 id="mtitle">Self-check</h2><pre>${esc(L.join('\n'))}</pre><p class="mhint">Nothing was changed in ConnectWise. If any line says FAIL, copy this and paste it to Claude.</p>
    <div class="mbtn"><button class="ghost" data-act="m-close">Close</button><button class="go" data-act="m-copy">Copy details</button></div></div>`;
  $('modal').classList.add('on');
}
function tickClock() {
  shield();
  $('clock').textContent = new Date().toLocaleTimeString([], { hour12: false });
  if (!S.busy) $('nx').textContent = S.next + 's';
  $('ring').setAttribute('stroke-dashoffset', (56.55 * (1 - S.next / EVERY)).toFixed(2));
  const stale = S.lastTs && Date.now() - S.lastTs > 3 * EVERY * 1000; $('sync').classList.toggle('stale', !!stale); $('sync').title = stale ? 'Data is more than 3 minutes old' : '';
}
S.ctx = readCtx(); S.note = 'Reading the board…'; render(); fit(); tickClock();
S.raf = requestAnimationFrame(draw);
setTimeout(() => ov.classList.remove('intro'), 2600);
if (!S.me) setTimeout(askMe, 300);
sync(true, false);
S.t = setInterval(() => { if (S.watch) checkWatch(); else if (!S.busy && !S.acting) { S.next--; if (S.next <= 0 && !$('modal').classList.contains('on')) sync(false, true); } tickClock(); }, 1000);
})();
