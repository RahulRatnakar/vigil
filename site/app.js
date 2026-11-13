/* VIGIL dashboard. Advisories come from data/advisories.json (public). The inventory is read and kept only in this browser. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : null);
  const REFRESH_MS = 5 * 60 * 1000;
  const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
  const SOURCE_NAMES = { kev: 'CISA KEV', cvelist: 'CVE List', nvd: 'NVD', epss: 'EPSS', fortinet: 'Fortinet', cisco: 'Cisco', paloalto: 'Palo Alto',
    microsoft: 'Microsoft', sophos: 'Sophos' };

  // ?src= lets a test point the page at a fixture; only same-site relative paths are accepted
  const qs = new URLSearchParams(location.search);
  const SRC = /^[\w./-]+\.json$/.test(qs.get('src') || '') && !(qs.get('src') || '').includes('..') ? qs.get('src') : 'data/advisories.json';

  const S = window.VIGIL_STATE = {
    advisories: [], sources: {}, generated: null, vmap: null,
    devices: [], unmatched: [], inventoryMeta: null,
    matches: new Map(), reviewed: new Set(), known: null, lastSeen: null, fresh: new Set(),
    settings: { kev: true, cvssMin: 9.0, sound: true, notify: false, lite: false },
    view: 'overview', open: new Set(), tix: new Set(),
  };

  /* ---------- storage (IndexedDB "vigil": stores inventory + prefs) ---------- */
  const DB = (() => {
    let p;
    const open = () => p || (p = new Promise((res, rej) => {
      const r = indexedDB.open('vigil', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('inventory'); r.result.createObjectStore('prefs'); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const tx = (store, mode, fn) => open().then((db) => new Promise((res, rej) => {
      const t = db.transaction(store, mode), q = fn(t.objectStore(store));
      t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error);
    }));
    return {
      get: (s, k) => tx(s, 'readonly', (o) => o.get(k)).catch(() => undefined),
      set: (s, k, v) => tx(s, 'readwrite', (o) => o.put(v, k)).catch(() => undefined),
      clear: (s) => tx(s, 'readwrite', (o) => o.clear()).catch(() => undefined),
    };
  })();
  const savePrefs = () => DB.set('prefs', 'main', { reviewed: [...S.reviewed], known: S.known, lastSeen: S.lastSeen, settings: S.settings });

  /* ---------- data ---------- */
  async function getJSON(url) {
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(url + ' ' + r.status);
    return r.json();
  }
  async function loadVendors() {
    for (const u of ['data/vendors.json', '../collector/vendors.json']) {
      try { return await getJSON(u); } catch (e) { /* try next */ }
    }
    return { vendors: {}, ignore: [] };
  }
  const label = (k) => (k && S.vmap && S.vmap.vendors[k] && S.vmap.vendors[k].label) || (k ? k : 'Other vendor');

  function rematch() {
    S.matches = new Map();
    for (const a of S.advisories) S.matches.set(a.id, VIGIL.matchAdvisory(a, S.devices, S.vmap));
  }
  const m = (a) => S.matches.get(a.id) || { confidence: null, devices: [], clients: [], teams: [] };
  const alerting = (a) => VIGIL.isAlert(a, m(a), { kev: S.settings.kev, cvssMin: Number(S.settings.cvssMin) || 9 });
  const stamp = (a) => a.modified || a.published || '';

  let busy = null;
  function refresh(first) {               // one refresh at a time, so a double click can't alert twice
    if (!busy) busy = doRefresh(first).finally(() => { busy = null; });
    return busy;
  }
  async function doRefresh(first) {
    let data;
    try { data = await getJSON(SRC); } catch (e) {
      $('#age').textContent = 'data unavailable · retrying';
      return;
    }
    S.advisories = data.advisories || []; S.sources = data.sources || {}; S.generated = data.generated;
    rematch();
    // "new" = an id we have not seen in this browser, or one whose modified date moved on
    const prevKnown = S.known;
    const known = {};
    for (const a of S.advisories) known[a.id] = stamp(a);
    S.fresh = new Set();
    if (prevKnown) for (const a of S.advisories) if (!(a.id in prevKnown) || prevKnown[a.id] < stamp(a)) S.fresh.add(a.id);
    S.known = known; S.lastSeen = new Date().toISOString();
    savePrefs();
    render();
    const hits = S.advisories.filter((a) => S.fresh.has(a.id) && alerting(a));
    if (hits.length) raise(hits);
    if (window.VIGIL_FX) window.VIGIL_FX.update(S, { first, fresh: S.fresh });
  }

  /* ---------- inventory ---------- */
  async function readInventory(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: false });
    const name = wb.SheetNames.find((n) => n.trim().toLowerCase() === 'ptm tracker') || wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: false });
    const inv = VIGIL.loadInventory(rows, S.vmap);
    if (!rows.length || !('Manufacturer' in rows[0] || Object.keys(rows[0]).some((k) => k.trim().toLowerCase() === 'manufacturer'))) {
      toast({ title: 'That file has no Manufacturer column', text: `Sheet "${name}" was read, but VIGIL needs the PTM Tracker columns.` }, 'warn');
      return;
    }
    S.devices = inv.devices; S.unmatched = inv.unmatched;
    S.inventoryMeta = { file: file.name, sheet: name, loaded: new Date().toISOString(), rows: rows.length };
    await DB.set('inventory', 'current', { devices: S.devices, unmatched: S.unmatched, meta: S.inventoryMeta });
    rematch(); render();
    toast({ title: 'Inventory loaded', text: `${S.devices.length} devices matched to vendors · ${S.unmatched.reduce((n, u) => n + u.count, 0)} rows unmatched` });
    if (window.VIGIL_FX) window.VIGIL_FX.update(S, {});
  }
  async function forgetInventory() {
    await DB.clear('inventory');
    S.devices = []; S.unmatched = []; S.inventoryMeta = null;
    rematch(); render();
    toast({ title: 'Inventory forgotten', text: 'Nothing about your devices is stored in this browser now.' });
    if (window.VIGIL_FX) window.VIGIL_FX.update(S, {});
  }

  /* ---------- rendering helpers ---------- */
  const ago = (iso) => {
    if (!iso) return '';
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 90) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400 * 2) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' days ago';
  };
  const sevOf = (a) => a.severity || (a.kev ? 'critical' : 'none');
  const rank = (a) => [S.reviewed.has(a.id) ? 0 : 1, alerting(a) ? 1 : 0, a.kev ? 1 : 0,
    { Confirmed: 3, Likely: 2, 'Vendor only': 1 }[m(a).confidence] || 0, a.cvss || 0, stamp(a)];
  const byRank = (x, y) => { const a = rank(x), b = rank(y); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? -1 : 1; return 0; };

  function rowHTML(a) {
    const mm = m(a), sev = sevOf(a), open = S.open.has(a.id), rev = S.reviewed.has(a.id);
    const conf = mm.confidence ? `<span class="chip c-${mm.confidence.split(' ')[0]}" title="Match confidence">${esc(mm.confidence)}</span>` : '';
    const url = safeUrl((a.urls || [])[0]);
    const exposure = mm.confidence ? `<span>${mm.devices.length} device${mm.devices.length === 1 ? '' : 's'} · ${mm.clients.length} client${mm.clients.length === 1 ? '' : 's'}</span>` : '';
    let detail = '';
    if (open) {
      const devs = mm.devices.slice(0, 50).map((d) => `<li class="mono">${esc(d.client)} · ${esc(d.device)} · ${esc(d.model)} · ${esc(d.version || 'no version')}</li>`).join('');
      const ranges = (a.affected || []).slice(0, 8).map((x) => `<li class="mono">${esc(x.product)}: ${(x.versions || []).map((v) =>
        esc([v.from ? '≥ ' + v.from : '', v.to_excl ? '< ' + v.to_excl : '', v.to_incl ? '≤ ' + v.to_incl : ''].filter(Boolean).join(' ') || 'all versions')).join('; ') || 'versions not stated'}</li>`).join('');
      const links = (a.urls || []).map(safeUrl).filter(Boolean).map((u) => `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u.replace(/^https?:\/\//, '').slice(0, 70))}</a></li>`).join('');
      detail = `<div class="detail">
        <div><h4>Affected devices (${mm.devices.length})</h4>${devs ? `<ul>${devs}</ul>` : '<p class="mono">No inventory match.</p>'}${mm.devices.length > 50 ? `<p class="mono">…and ${mm.devices.length - 50} more</p>` : ''}</div>
        <div><h4>Affected versions</h4>${ranges ? `<ul>${ranges}</ul>` : '<p class="mono">Not stated by the vendor yet.</p>'}
          <h4 style="margin-top:10px">Signals</h4><p class="mono">CVSS ${a.cvss ?? '—'} · EPSS ${a.epss != null ? (a.epss * 100).toFixed(1) + '%' : '—'} · sources: ${esc((a.sources || []).map((s) => SOURCE_NAMES[s] || s).join(', '))}</p></div>
        <div><h4>Links</h4><ul>${links || '<li>none</li>'}</ul></div></div>`;
    }
    return `<article class="row glass sev-${sev}${a.kev ? ' kev' : ''}${rev ? ' reviewed' : ''}${S.fresh.has(a.id) ? ' new' : ''}" data-id="${esc(a.id)}">
      <div class="score ${sev}">${a.cvss != null ? Number(a.cvss).toFixed(1) : '—'}<small>${esc(sev === 'none' ? 'n/a' : sev)}</small></div>
      <div class="main">
        <div class="l1"><button class="cve" data-act="toggle" aria-expanded="${open}">${esc(a.id)}</button>${a.kev ? '<span class="chip kev">Exploited</span>' : ''}${alerting(a) ? '<span class="chip alert">Alert</span>' : ''}${conf}</div>
        <div class="ttl">${esc(a.title || '(no title yet)')}</div>
        <div class="l3"><span>${esc(label(a.vendor))}${(a.products || []).length ? ' · ' + esc(a.products.slice(0, 3).join(', ')) : ''}</span>${exposure}<span>${esc(ago(stamp(a)))}</span></div>
      </div>
      <div class="acts">
        <button class="btn${rev ? ' on' : ''}" data-act="review" aria-pressed="${rev}">${rev ? '✓ Reviewed' : 'Review'}</button>
        ${mm.clients.length ? `<button class="btn${S.tix.has(a.id) ? ' on' : ''}" data-act="tickets" aria-expanded="${S.tix.has(a.id)}">Tickets (${mm.clients.length})</button>` : ''}
        ${url ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open advisory ↗</a>` : ''}
      </div>${detail}${S.tix.has(a.id) ? ticketsHTML(a) : ''}</article>`;
  }

  // one ticket per client
  const tickets = (a) => VIGIL.clientTickets(a, m(a), label);
  function ticketsHTML(a) {
    const t = tickets(a);
    return `<div class="tix"><div class="tix-h"><span>${t.length} client ticket${t.length === 1 ? '' : 's'} · each lists only that client's devices</span>
      <button class="btn" data-act="copy-all">Copy all ${t.length}</button></div>
      ${t.map((x, i) => `<div class="tix-c"><div class="tix-n"><b>${esc(x.client)}</b><span>${esc(x.team)} · ${x.devices.length} device${x.devices.length === 1 ? '' : 's'}</span></div>
        <div class="tix-s mono">${esc(x.subject)}</div>
        <div class="acts"><button class="btn" data-act="copy-subj" data-i="${i}">Copy subject</button><button class="btn primary" data-act="copy-one" data-i="${i}">Copy ticket</button></div></div>`).join('')}</div>`;
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
      const ok = document.execCommand('copy'); t.remove(); return ok;
    }
  }

  /* ---------- views ---------- */
  function renderHeader() {
    const ours = S.advisories.filter((a) => m(a).confidence);
    const open = ours.filter((a) => !S.reviewed.has(a.id));
    const kevOpen = open.filter((a) => a.kev).length, alerts = open.filter(alerting).length;
    const st = $('#status');
    if (!S.devices.length) { st.className = 'status warn'; st.innerHTML = 'Load inventory to see exposure'; }
    else if (kevOpen) { st.className = 'status hot'; st.innerHTML = `<span class="n">${kevOpen}</span> exploited · <span class="n">${alerts}</span> alert${alerts === 1 ? '' : 's'} open`; }
    else if (alerts) { st.className = 'status warn'; st.innerHTML = `<span class="n">${alerts}</span> alert${alerts === 1 ? '' : 's'} open`; }
    else { st.className = 'status calm'; st.innerHTML = `All clear · <span class="n">${open.length}</span> to review`; }
    document.body.classList.toggle('kev-open', kevOpen > 0);
    const src = Object.values(S.sources), stale = src.filter((s) => s.status !== 'ok').length;
    $('#feeds').innerHTML = `<span class="dot ${stale ? 'amber' : ''}"></span>${src.length - stale}/${src.length} feeds ok`;
    $('#age').textContent = S.generated ? 'data ' + ago(S.generated) : '';
    const tab = $('nav [data-view=overview]');
    tab.innerHTML = 'Overview' + (alerts ? `<span class="count">${alerts}</span>` : '');
  }

  function invPrompt() {
    return `<div class="glass empty-state"><strong>Load your inventory</strong>Drop the PTM inventory .xlsx anywhere on this page, or open <button class="btn" data-goto="settings">Settings</button>. It stays in this browser.</div>`;
  }

  function renderOverview() {
    const hide = $('#ov-hide').checked;
    let list = S.advisories.filter((a) => m(a).confidence && !(hide && S.reviewed.has(a.id))).sort(byRank);
    let html = '';
    if (!S.devices.length) {
      html = invPrompt();
      list = S.advisories.filter((a) => a.vendor).sort(byRank).slice(0, 25);
    } else if (!list.length) html = `<div class="glass empty-state"><strong>Nothing affects you right now</strong>New advisories for your vendors will show here.</div>`;
    $('#triage').innerHTML = html + list.slice(0, 150).map(rowHTML).join('');
    // panels
    const latest = [...S.advisories].filter((a) => a.vendor || a.kev).sort((x, y) => (stamp(y) > stamp(x) ? 1 : -1)).slice(0, 6);
    $('#p-latest').innerHTML = latest.map((a) => `<li><span class="dot ${a.kev || sevOf(a) === 'critical' ? 'red' : sevOf(a) === 'high' ? 'amber' : ''}"></span><button data-open="${esc(a.id)}">${esc(a.id)} · ${esc(label(a.vendor))}</button><span class="num">${esc(ago(stamp(a)))}</span></li>`).join('') || '<li>No advisories yet</li>';
    const ex = exposure('client').slice(0, 6);
    $('#p-clients').innerHTML = S.devices.length ? (ex.map((c) => `<li><span class="dot ${c.kev ? 'red' : c.worst === 'critical' ? 'red' : c.worst === 'high' ? 'amber' : ''}"></span><span class="grow">${esc(c.name)}</span><span class="num">${c.ids.size} adv · ${c.devices.size} dev</span></li>`).join('') || '<li>No exposure</li>') : '<li>Load inventory</li>';
    $('#p-feeds').innerHTML = Object.entries(S.sources).map(([k, s]) => `<li><span class="dot ${s.status === 'ok' ? '' : 'amber'}"></span><span class="grow">${esc(SOURCE_NAMES[k] || k)}</span><span class="num">${esc(s.status === 'ok' ? ago(s.checked) : 'stale')}</span></li>`).join('') || '<li>No feed data</li>';
  }

  function renderAdvisories() {
    const q = $('#f-q').value.trim().toLowerCase(), v = $('#f-vendor').value, sev = $('#f-sev').value, days = +$('#f-days').value;
    const since = new Date(Date.now() - days * 864e5).toISOString().replace(/\.\d+Z$/, 'Z');
    const min = { critical: 4, high: 3, medium: 2 }[sev] || 0;
    const list = S.advisories.filter((a) => (!v || a.vendor === v || (v === '_other' && !a.vendor))
      && (!min || (SEV_RANK[a.severity] || 0) >= min)
      && (!$('#f-kev').checked || a.kev) && (!$('#f-us').checked || m(a).confidence) && (!$('#f-rev').checked || !S.reviewed.has(a.id))
      && stamp(a) >= since
      && (!q || (a.id + ' ' + a.title + ' ' + (a.products || []).join(' ') + ' ' + label(a.vendor)).toLowerCase().includes(q))).sort(byRank);
    $('#adv-list').innerHTML = list.slice(0, 300).map(rowHTML).join('') || '<div class="glass empty-state"><strong>No advisories match these filters</strong></div>';
    const sel = $('#f-vendor'), cur = sel.value;
    const keys = [...new Set(S.advisories.map((a) => a.vendor).filter(Boolean))].sort((x, y) => label(x).localeCompare(label(y)));
    sel.innerHTML = '<option value="">All vendors</option>' + keys.map((k) => `<option value="${esc(k)}">${esc(label(k))}</option>`).join('') + '<option value="_other">Other (exploited, not ours)</option>';
    sel.value = cur;
  }

  function exposure(by) {
    const out = new Map();
    for (const a of S.advisories) {
      const mm = m(a);
      if (!mm.confidence || S.reviewed.has(a.id)) continue;
      for (const d of mm.devices) {
        const k = by === 'team' ? d.team || '(no team)' : d.client || '(no client)';
        if (!out.has(k)) out.set(k, { name: k, ids: new Set(), devices: new Set(), kev: 0, worst: 'low', adv: [] });
        const e = out.get(k);
        if (!e.ids.has(a.id)) { e.ids.add(a.id); e.adv.push(a); if (a.kev) e.kev++; if ((SEV_RANK[a.severity] || 0) > (SEV_RANK[e.worst] || 0)) e.worst = a.severity; }
        e.devices.add(d.client + '|' + d.device);
      }
    }
    return [...out.values()].sort((x, y) => y.kev - x.kev || (SEV_RANK[y.worst] || 0) - (SEV_RANK[x.worst] || 0) || y.ids.size - x.ids.size);
  }
  function renderExposure() {
    if (!S.devices.length) { $('#exp').innerHTML = invPrompt(); return; }
    const by = $('input[name=exp]:checked').value, rows = exposure(by);
    $('#exp').innerHTML = rows.length ? `<table><thead><tr><th>${by === 'team' ? 'Team' : 'Client'}</th><th class="num">Exploited</th><th>Worst</th><th class="num">Advisories</th><th class="num">Devices</th><th>Top items</th></tr></thead><tbody>${
      rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num" style="color:${r.kev ? 'var(--red)' : 'inherit'}">${r.kev}</td><td><span class="score ${esc(r.worst)}" style="font-size:13px">${esc(r.worst)}</span></td><td class="num">${r.ids.size}</td><td class="num">${r.devices.size}</td><td>${
        r.adv.sort(byRank).slice(0, 4).map((a) => `<button class="cve" data-open="${esc(a.id)}">${esc(a.id)}</button>`).join(' · ')}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty-state"><strong>No open exposure</strong></div>';
  }

  function renderVendors() {
    const counts = new Map();
    for (const d of S.devices) counts.set(d.vendor, (counts.get(d.vendor) || 0) + 1);
    const rows = [...counts].map(([k, n]) => {
      const open = S.advisories.filter((a) => a.vendor === k && m(a).confidence && !S.reviewed.has(a.id));
      const worst = open.reduce((w, a) => (a.kev ? 'critical' : (SEV_RANK[a.severity] || 0) > (SEV_RANK[w] || 0) ? a.severity : w), '');
      return { k, n, open: open.length, kev: open.filter((a) => a.kev).length, worst };
    }).sort((x, y) => y.kev - x.kev || y.open - x.open || y.n - x.n);
    $('#vendors').innerHTML = S.devices.length ? `<table><thead><tr><th>Vendor</th><th class="num">Devices</th><th class="num">Open</th><th class="num">Exploited</th><th>Worst</th></tr></thead><tbody>${
      rows.map((r) => `<tr><td><button class="cve" data-vendor="${esc(r.k)}">${esc(label(r.k))}</button></td><td class="num">${r.n}</td><td class="num">${r.open}</td><td class="num" style="color:${r.kev ? 'var(--red)' : 'inherit'}">${r.kev}</td><td>${r.worst ? `<span class="score ${esc(r.worst)}" style="font-size:13px">${esc(r.worst)}</span>` : '—'}</td></tr>`).join('')}</tbody></table>` : invPrompt();
    $('#feedtbl').innerHTML = `<table><thead><tr><th>Feed</th><th>Status</th><th>Checked</th></tr></thead><tbody>${Object.entries(S.sources).map(([k, s]) =>
      `<tr><td>${esc(SOURCE_NAMES[k] || k)}</td><td style="color:${s.status === 'ok' ? 'var(--teal)' : 'var(--amber)'}"><span class="dot ${s.status === 'ok' ? '' : 'amber'}"></span>${esc(s.status)}${s.error ? `<div class="mono" style="color:var(--muted);font-size:11px">${esc(s.error)}</div>` : ''}</td><td>${esc(ago(s.checked))}</td></tr>`).join('')}</tbody></table>`;
    $('#unmatched').innerHTML = S.unmatched.length ? `<table><thead><tr><th>Manufacturer value</th><th class="num">Rows</th></tr></thead><tbody>${S.unmatched.map((u) => `<tr><td class="mono">${esc(u.raw)}</td><td class="num">${u.count}</td></tr>`).join('')}</tbody></table>` : `<p style="color:var(--muted)">${S.devices.length ? 'None. Every row has a known vendor.' : 'Load inventory first.'}</p>`;
  }

  function renderSettings() {
    const im = S.inventoryMeta;
    $('#inv-info').innerHTML = im ? `<b>${esc(im.file)}</b> · sheet “${esc(im.sheet)}” · ${S.devices.length} devices · loaded ${esc(ago(im.loaded))}` : 'No inventory loaded.';
    $('#s-kev').checked = S.settings.kev; $('#s-cvss').value = S.settings.cvssMin; $('#s-sound').checked = S.settings.sound; $('#s-lite').checked = S.settings.lite;
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    $('#s-notify').textContent = S.settings.notify && perm === 'granted' ? 'Turn off Windows notifications' : 'Turn on Windows notifications';
    $('#s-notify-st').textContent = perm === 'denied' ? 'Blocked in browser settings' : perm === 'unsupported' ? 'Not supported here' : '';
  }

  function render() {
    renderHeader();
    ({ overview: renderOverview, advisories: renderAdvisories, exposure: renderExposure, vendors: renderVendors, settings: renderSettings })[S.view]();
  }
  function go(view) {
    S.view = view;
    $$('nav [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === view)));
    $$('section[role=tabpanel]').forEach((s) => { s.hidden = s.id !== 'v-' + view; });
    render();
    if (window.VIGIL_FX) window.VIGIL_FX.view(view);
  }
  function openAdvisory(id) {
    S.open.add(id); $('#f-q').value = id; $('#f-vendor').value = ''; $('#f-sev').value = ''; $('#f-days').value = '90';
    ['#f-kev', '#f-us', '#f-rev'].forEach((s) => { $(s).checked = false; });
    go('advisories');
  }
  window.VIGIL_APP = { go, openAdvisory, filterVendor: (k) => { $('#f-q').value = ''; go('advisories'); $('#f-vendor').value = k; renderAdvisories(); }, label, alerting, m };

  /* ---------- alerts ---------- */
  function beep(kev) { if (S.settings.sound && window.VIGIL_SOUND) window.VIGIL_SOUND.alert(kev); }
  function setSound(on) {
    S.settings.sound = !!on;
    if (window.VIGIL_SOUND) { window.VIGIL_SOUND.setEnabled(on); if (on) window.VIGIL_SOUND.unlock(); }
    const b = $('#mute'); b.textContent = on ? '🔊 Sound' : '🔇 Muted'; b.setAttribute('aria-pressed', String(!on)); b.classList.toggle('on', !on);
  }
  function toast(t, kind) {
    const el = document.createElement('div');
    el.className = 'toast glass' + (kind === 'kev' ? ' kev' : '');
    el.innerHTML = `<button class="go"><b>${esc(t.title)}</b><p>${esc(t.text || '')}</p></button><button class="x" aria-label="Dismiss">×</button>`;
    el.querySelector('.x').onclick = () => el.remove();
    el.querySelector('.go').onclick = () => { if (t.onClick) t.onClick(); el.remove(); };
    $('#toasts').prepend(el);
    while ($('#toasts').children.length > 4) $('#toasts').lastElementChild.remove();
    if (!t.sticky) setTimeout(() => el.remove(), kind === 'kev' ? 30000 : 12000);
    return el;
  }
  function raise(hits) {
    const kev = hits.some((a) => a.kev);
    if (hits.length > 5) {
      toast({ title: `${hits.length} new alert advisories`, text: hits.slice(0, 4).map((a) => a.id).join(', ') + '…', sticky: true,
        onClick: () => { $('#f-q').value = ''; $('#f-us').checked = true; go('advisories'); } }, kev ? 'kev' : '');
    } else {
      for (const a of hits) toast({ title: `${a.kev ? 'EXPLOITED · ' : ''}${a.id}`, text: `${label(a.vendor)} · ${m(a).devices.length} device(s) · ${a.title || ''}`.slice(0, 140),
        onClick: () => openAdvisory(a.id) }, a.kev ? 'kev' : '');
    }
    beep(kev);
    if (kev) { const p = $('#pulse'); p.classList.remove('on'); void p.offsetWidth; p.classList.add('on'); }
    if (S.settings.notify && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const n = new Notification(hits.length > 1 ? `VIGIL: ${hits.length} new alerts` : `VIGIL: ${hits[0].id}`,
          { body: hits.slice(0, 3).map((a) => `${a.id} · ${label(a.vendor)}${a.kev ? ' · EXPLOITED' : ''}`).join('\n'), tag: 'vigil' });
        n.onclick = () => { window.focus(); n.close(); };
      } catch (e) { /* ignore */ }
    }
    if (window.VIGIL_FX) hits.forEach((a) => window.VIGIL_FX.flare(a.vendor, a.kev));
  }

  /* ---------- events ---------- */
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button, a'); if (!t) return;
    if (t.dataset.view) return go(t.dataset.view);
    if (t.dataset.goto) return go(t.dataset.goto);
    if (t.dataset.open) return openAdvisory(t.dataset.open);
    if (t.dataset.vendor) return window.VIGIL_APP.filterVendor(t.dataset.vendor);
    const row = t.closest('.row'); if (!row || !t.dataset.act) return;
    const id = row.dataset.id, a = S.advisories.find((x) => x.id === id);
    if (t.dataset.act === 'toggle') { S.open.has(id) ? S.open.delete(id) : S.open.add(id); render(); }
    if (t.dataset.act === 'review') { S.reviewed.has(id) ? S.reviewed.delete(id) : S.reviewed.add(id); savePrefs(); render(); if (window.VIGIL_FX) window.VIGIL_FX.update(S, {}); }
    if (t.dataset.act === 'tickets') { S.tix.has(id) ? S.tix.delete(id) : S.tix.add(id); render(); }
    if (/^copy-/.test(t.dataset.act) && a) {
      const all = tickets(a), x = all[+t.dataset.i || 0];
      const text = t.dataset.act === 'copy-all' ? all.map((k) => `Subject: ${k.subject}\n\n${k.body}`).join('\n\n==========\n\n')
        : t.dataset.act === 'copy-subj' ? x.subject : `Subject: ${x.subject}\n\n${x.body}`;
      const was = t.textContent, ok = await copy(text);
      t.textContent = ok ? 'Copied ✓' : 'Copy failed'; setTimeout(() => { t.textContent = was; }, 1600);
      if (window.VIGIL_SOUND) window.VIGIL_SOUND.tick();
    }
  });
  ['#f-q', '#f-vendor', '#f-sev', '#f-days', '#f-kev', '#f-us', '#f-rev'].forEach((s) => $(s).addEventListener('input', renderAdvisories));
  $('#ov-hide').addEventListener('change', renderOverview);
  $$('input[name=exp]').forEach((r) => r.addEventListener('change', renderExposure));
  $('#refresh').onclick = () => refresh(false);
  $('#file').onchange = (e) => e.target.files[0] && readInventory(e.target.files[0]);
  $('#forget').onclick = forgetInventory;
  const setChange = (sel, fn) => $(sel).addEventListener('change', () => { fn(); savePrefs(); render(); if (window.VIGIL_FX) window.VIGIL_FX.update(S, {}); });
  setChange('#s-kev', () => { S.settings.kev = $('#s-kev').checked; });
  setChange('#s-cvss', () => { const v = parseFloat($('#s-cvss').value); S.settings.cvssMin = isNaN(v) ? 9 : Math.min(10, Math.max(0, v)); });
  setChange('#s-sound', () => setSound($('#s-sound').checked));
  $('#mute').onclick = () => { setSound(!S.settings.sound); savePrefs(); renderSettings(); };
  setChange('#s-lite', () => {
    S.settings.lite = $('#s-lite').checked; document.body.classList.toggle('lite', S.settings.lite);
    try { localStorage.setItem('vigil-lite', S.settings.lite ? '1' : ''); } catch (e) { /* fine */ }   // read by the boot screen before IndexedDB is ready
  });
  $('#s-notify').onclick = async () => {
    if (!('Notification' in window)) return;
    if (S.settings.notify) S.settings.notify = false;
    else S.settings.notify = (Notification.permission === 'granted' || (await Notification.requestPermission()) === 'granted');
    savePrefs(); renderSettings();
  };
  $('#s-unreview').onclick = () => { S.reviewed.clear(); savePrefs(); render(); };
  // drop the inventory anywhere
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('#drop').classList.add('over'); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop').classList.remove('over'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; $('#drop').classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) readInventory(f); });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/input|select|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); go('advisories'); $('#f-q').focus(); }
  });

  /* ---------- start ---------- */
  (async function start() {
    const [vmap, inv, prefs] = await Promise.all([loadVendors(), DB.get('inventory', 'current'), DB.get('prefs', 'main')]);
    S.vmap = vmap; window.VIGIL_VENDORS = vmap;
    if (prefs) {
      S.reviewed = new Set(prefs.reviewed || []); S.known = prefs.known || null; S.lastSeen = prefs.lastSeen || null;
      Object.assign(S.settings, prefs.settings || {});
      setSound(S.settings.sound);
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) S.settings.lite = true;
    document.body.classList.toggle('lite', S.settings.lite);
    if (inv) { S.devices = inv.devices || []; S.unmatched = inv.unmatched || []; S.inventoryMeta = inv.meta || null; }
    await refresh(true);
    setInterval(() => { if (!document.hidden) refresh(false); }, REFRESH_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - new Date(S.lastSeen || 0) > REFRESH_MS) refresh(false); });
  })();
})();
