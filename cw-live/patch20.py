import re
p = 'dashboard.js'; s = open(p, encoding='utf-8').read()
def rep(old, new, n=1):
    global s
    assert s.count(old) >= 1, 'missing: ' + old[:70]
    s = s.replace(old, new, n)
def cut(a, b, new):
    global s
    i = s.index(a); j = s.index(b, i)
    s = s[:i] + new + s[j:]

rep('const VER = 19;', 'const VER = 20;')

# ---- direct read: note every board page request CW makes, replay each one unchanged ----
cut('const hookXHR = w => {', 'const rowFromFeed = o => {', r'''const hookXHR = w => { try { const X = w.XMLHttpRequest && w.XMLHttpRequest.prototype; if (!X || X.__nocHook2) return; X.__nocHook2 = 1; const T = window;
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
''')
rep("res: String(o.Resources || o.ResourceList || '').split(", "res: String([o.ResourceList, o.Resources].find(v => v && !/images\\/|\\.(gif|png)/i.test(v)) || '').split(")
cut("// repeat CW's board request for all tickets", '\nconst read = () => {', r'''// repeat each board page request CW made, unchanged and all at once; null when that can't be trusted to be the whole board
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
  if (pg && total && pg.n !== total) { S.feedWhy = `board count changed (${pg.n} to ${total})`; return null; }
  if (m.size < total) { S.feedWhy = `direct read covered ${m.size} of ${total}`; return null; }
  S.feedWhy = ''; return { rows: m, total };
};
''')
rep('''    if (window.__nocFeed) {
      try { status('fetching'); const f = await fetchAll(); if (f) { S.fast = true; apply(f.rows, first); S.busy = false; S.next = EVERY; tickClock(); return; } }
      catch (e) { S.fast = false; S.feedErr = e.message; }
    }''', '''    try { status('fetching'); const f = await fetchAll(); if (f) { S.fast = true; apply(f.rows, first); S.busy = false; S.next = EVERY; tickClock(); return; } }
    catch (e) { S.feedWhy = 'direct read failed: ' + e.message; }
    S.fast = false; shield();''')
# a sudden pile of unseen tickets means the list changed, not that 100 tickets arrived: load them quietly
rep('  add.forEach(r => S.seen.add(r.id));', '  add.forEach(r => S.seen.add(r.id));\n  if (!first && add.length > 30) first = true;')

# ---- focus shield: while the dashboard is in front CW's page is inert, so it can't pull focus or keystrokes ----
rep("const minimize = on => { S.min = on; ov.classList.toggle('min', on); $('chip').classList.toggle('on', on); };",
    "// lifted whenever the dashboard itself has to click inside ConnectWise (screen sync, actions, board switching)\nconst shield = () => { const on = !S.min && !S.busy && !S.acting && !S.watch; [...document.body.children].forEach(e => { if (e !== host) e.inert = on; }); };\nconst minimize = on => { S.min = on; ov.classList.toggle('min', on); $('chip').classList.toggle('on', on); shield(); };")
rep("function tickClock() {\n", "function tickClock() {\n  shield();\n")
rep("const stop = () => { clearInterval(S.t);", "const stop = () => { [...document.body.children].forEach(e => { e.inert = false; }); clearInterval(S.t);")
rep("else if (!S.busy && !S.acting) { S.next--; if (S.next <= 0) sync(false, true); }", "else if (!S.busy && !S.acting) { S.next--; if (S.next <= 0 && !$('modal').classList.contains('on')) sync(false, true); }")

# ---- actions: pop-up layers are narrow; the main CW page is not one even if it is absolutely positioned ----
rep("return /absolute|fixed/.test(b.ownerDocument.defaultView.getComputedStyle(b).position) ? b : null; };",
    "const w = b.ownerDocument.defaultView; return /absolute|fixed/.test(w.getComputedStyle(b).position) && b.getBoundingClientRect().width < w.innerWidth * .9 ? b : null; };")
rep("  S.acting = true; const done = []; let err = '';", "  S.acting = true; shield(); const done = []; let err = '';")
rep("    let p = pager(), guard = 0;\n    while (p && p.a > 1 && guard++ < 25) { const pv = arrow(p, -1); if (!pv) break; say('Going to board page 1…');",
    "    { const b = docs().map(d => leaves(d, /^SEARCH$/).find(vis2)).find(Boolean), p0 = pager(); if (b) { say('Refreshing the board…'); b.click(); await waitChange(p0 && p0.txt, firstRow(), 8000); } }\n    let p = pager(), guard = 0;\n    while (p && p.a > 1 && guard++ < 25) { const pv = arrow(p, -1); if (!pv) break; say('Going to board page 1…');")
rep("  logE('action', null,", "  S.lastErr = res.err || 'ok';\n  logE('action', null,")

# ---- topology: rings and labels fixed on screen, board name in the hub, steadier node places, 30 frames a second ----
rep("  S.raf = requestAnimationFrame(draw);\n  if (S.min ||", "  S.raf = requestAnimationFrame(draw);\n  if (t - (S.lf2 || 0) < 30) return; S.lf2 = t;\n  if (S.min ||")
cut('  if (zE < 1) RINGS.forEach((R, tr) => {', "  // nodes glide to their ring", r'''  if (zE < 1) RINGS.forEach((R, tr) => {
    const [lab, rc] = RING_LBL[tr]; x.beginPath();
    // sample at screen-fixed angles so the dashes and the label never move while the map turns
    for (let j = 0; j <= 64; j++) { const q = P(Math.cos(j / 64 * TAU - a) * R, 0, Math.sin(j / 64 * TAU - a) * R); j ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y); }
    x.globalAlpha = 1 - zE; x.setLineDash([2, 7]); x.strokeStyle = C(rc, .38); x.lineWidth = 1; x.stroke(); x.setLineDash([]);
    const e = P(Math.cos(-a) * R, 0, Math.sin(-a) * R);
    x.font = '600 9px Bahnschrift, Segoe UI, sans-serif'; x.letterSpacing = '2px'; x.fillStyle = C(rc, .75); x.fillText(lab, e.x + 8, e.y + 3); x.letterSpacing = '0px'; x.globalAlpha = 1;
  });
''')
rep("x.fillText('N O C', hub.x, hub.y + 26);", "x.letterSpacing = '3px'; x.fillText(hubLbl(), hub.x, hub.y + 28); x.letterSpacing = '0px';")
rep("const RINGS = [", "const hashS = t => { let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0; return h; };\nconst hubLbl = () => { const c = S.ctx || {}; return String(c.board && !/view all/i.test(c.board) ? c.board : c.dept || 'NOC').toUpperCase().slice(0, 20); };\nconst RINGS = [")
# order within a ring by name hash, so a company keeps roughly the same place between syncs
rep("const g = NODES.filter(n => n.tier === tr); g.forEach((n, k) => {", "const g = NODES.filter(n => n.tier === tr).sort((p, q) => hashS(p.co) - hashS(q.co)); g.forEach((n, k) => {")
rep("y: (((n.i * 37) % 11) / 11 - .5) * .35 });", "y: ((hashS(n.co) % 11) / 11 - .5) * .35 });")

# ---- pop-ups: below the top bar, with an unmissable close button ----
rep(".toasts{position:fixed;top:16px;right:16px;", ".toasts{position:fixed;top:84px;right:16px;")
rep('.tx{position:absolute;top:6px;right:8px;width:24px;height:24px;border:0;border-radius:6px;background:rgba(255,255,255,.06);color:#B9C5DD;font:16px/1 "Segoe UI",sans-serif;cursor:pointer}',
    '.tx{position:absolute;top:8px;right:8px;width:28px;height:28px;border:1px solid var(--c,#FFB547);border-radius:8px;background:rgba(0,0,0,.45);color:#fff;font:700 18px/1 "Segoe UI",sans-serif;cursor:pointer;z-index:1}')
rep(".toast{padding:12px 36px 12px 14px;", ".toast{padding:12px 46px 12px 14px;")

# ---- self-check ----
rep('''    <button class="ib" data-act="now" title="Sync now" aria-label="Sync now">${ic(I.ref)}</button>''',
    '''    <button class="ib" data-act="now" title="Sync now" aria-label="Sync now">${ic(I.ref)}</button>
    <button class="ib" data-act="check" title="Self-check: test what the dashboard can find in ConnectWise" aria-label="Self-check">${ic('M9 12l2 2 4-4M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z')}</button>''')
rep("    if (k === 'prdiag') {", "    if (k === 'check') selfCheck();\n    if (k === 'prdiag') {")
rep("if (b.dataset.act === 'm-close') $('modal').classList.remove('on'); else if (b.dataset.act === 'm-run') runModal(b.dataset.kind); });",
    "if (b.dataset.act === 'm-close') $('modal').classList.remove('on'); else if (b.dataset.act === 'm-run') runModal(b.dataset.kind);\n  else if (b.dataset.act === 'm-copy') { const t = $('modal').querySelector('pre').textContent; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => { b.textContent = 'Copied ✓'; }, () => prompt('Copy all of this and paste it to Claude:', t)); } });")
rep(".mhint{color:#97A6C2;font-size:12px}", ".mbox pre{margin:0;padding:12px;border-radius:10px;background:#060B16;border:1px solid rgba(120,160,255,.18);color:#DCE6F7;font:12px/1.6 Consolas,monospace;white-space:pre-wrap;word-break:break-word;max-height:50vh;overflow:auto}\n.mhint{color:#97A6C2;font-size:12px}")
rep("function tickClock() {", r'''// read-only test of everything the dashboard relies on in ConnectWise; changes nothing
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
function tickClock() {''')
open(p, 'w', encoding='utf-8').write(s); print('patched')
