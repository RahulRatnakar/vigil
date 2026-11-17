/* VIGIL dashboard. Advisories come from data/advisories.json (public). The inventory is read and kept only in this browser. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : null);
  const REFRESH_MS = 5 * 60 * 1000;
  const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
  const SOURCE_NAMES = { kev: 'CISA KEV', cvelist: 'CVE List', nvd: 'NVD', epss: 'EPSS', fortinet: 'Fortinet', cisco: 'Cisco', paloalto: 'Palo Alto', sonicwall: 'SonicWall',
    microsoft: 'Microsoft', sophos: 'Sophos' };

  // ?src= lets a test point the page at a fixture; only same-site relative paths are accepted
  const qs = new URLSearchParams(location.search);
  const SRC = /^[\w./-]+\.json$/.test(qs.get('src') || '') && !(qs.get('src') || '').includes('..') ? qs.get('src') : 'data/advisories.json';

  const S = window.VIGIL_STATE = {
    advisories: [], sources: {}, generated: null, vmap: null,
    devices: [], unmatched: [], inventoryMeta: null,
    matches: new Map(), reviewed: new Set(), known: null, lastSeen: null, fresh: new Set(),
    settings: { kev: true, cvssMin: 9.0, sound: true, notify: false, lite: false },
    view: 'overview', open: new Map(),
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
  async function firstJSON(urls, fallback) {
    for (const u of urls) { try { return await getJSON(u); } catch (e) { /* try next */ } }
    return fallback;
  }
  // vendor map + the hand-kept watch list (same merge the collector does)
  async function loadVendors() {
    const [base, watch] = await Promise.all([firstJSON(['data/vendors.json', '../collector/vendors.json'], { vendors: {}, ignore: [] }),
      firstJSON(['data/watch.json', '../collector/watch.json'], { vendors: {} })]);
    S.watch = watch && watch.vendors && typeof watch.vendors === 'object' ? watch : { vendors: {} };
    S.watchDraft = null;
    return VIGIL.mergeWatch(base, S.watch);
  }
  const label = (k) => (k && S.vmap && S.vmap.vendors[k] && S.vmap.vendors[k].label) || (k ? k : 'Other vendor');

  // matching runs in small slices so animations (boot, 3D core) keep drawing smoothly in between
  async function rematch() {
    const out = new Map(), list = S.advisories, devices = S.devices;
    let t = performance.now();
    for (let i = 0; i < list.length; i++) {
      out.set(list[i].id, VIGIL.matchAdvisory(list[i], devices, S.vmap));
      if (performance.now() - t > 12) { await new Promise((r) => setTimeout(r, 0)); t = performance.now(); }
    }
    S.matches = out;
  }
  const m = (a) => S.matches.get(a.id) || { confidence: null, devices: [], clients: [], teams: [] };
  // what counts as affecting us: product-level matches and watched vendors; vendor-only matches only when exploited (or when asked for)
  const relevant = (a) => { const c = m(a).confidence; return c === 'Confirmed' || c === 'Likely' || c === 'Watched' || (c === 'Vendor only' && (a.kev || !!S.settings.vendorOnly)); };
  const alerting = (a) => VIGIL.isAlert(a, m(a), { kev: S.settings.kev, cvssMin: Number(S.settings.cvssMin) || 9, snwl: S.settings.snwl !== false });
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
    await rematch();
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
    await rematch(); render();
    toast({ title: 'Inventory loaded', text: `${S.devices.length} devices matched to vendors · ${S.unmatched.reduce((n, u) => n + u.count, 0)} rows unmatched` });
    if (window.VIGIL_FX) window.VIGIL_FX.update(S, {});
  }
  async function forgetInventory() {
    await DB.clear('inventory');
    S.devices = []; S.unmatched = []; S.inventoryMeta = null;
    await rematch(); render();
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

  // a compact row; details live in a tabbed drawer with a fixed height (Devices · Tickets · Details)
  function rowHTML(a) {
    const mm = m(a), sev = sevOf(a), tab = S.open.get(a.id), rev = S.reviewed.has(a.id);
    const conf = mm.confidence ? `<span class="chip c-${mm.confidence.split(' ')[0]}" title="Match confidence">${esc(mm.confidence)}</span>` : '';
    const url = safeUrl((a.urls || [])[0]), fix = VIGIL.advisoryFix(a);
    const nd = mm.devices.length, nc = mm.clients.length;
    const exposure = nd ? `<span>${nd} device${nd === 1 ? '' : 's'} · ${nc} client${nc === 1 ? '' : 's'}</span>` : '';
    const tabBtn = (id, text) => `<button class="btn${tab === id ? ' on' : ''}" data-act="tab" data-tab="${id}" aria-expanded="${tab === id}">${text}</button>`;
    return `<article class="row glass sev-${sev}${a.kev ? ' kev' : ''}${rev ? ' reviewed' : ''}${S.fresh.has(a.id) ? ' new' : ''}" data-id="${esc(a.id)}">
      <div class="score ${sev}">${a.cvss != null ? Number(a.cvss).toFixed(1) : '—'}<small>${esc(sev === 'none' ? 'n/a' : sev)}</small></div>
      <div class="main">
        <div class="l1"><button class="cve" data-act="tab" data-tab="details" aria-expanded="${!!tab}">${esc(a.id)}</button>${(a.refs || []).slice(0, 2).map((r) => `<span class="chip ref" title="Vendor advisory">${esc(r)}</span>`).join('')}${a.kev ? '<span class="chip kev">Exploited</span>' : ''}${alerting(a) ? '<span class="chip alert">Alert</span>' : ''}${conf}</div>
        <div class="ttl">${esc(a.title || '(no title yet)')}</div>
        <div class="fix"><b>Fix</b><span>${esc(fix || 'See the vendor advisory: fixed versions not published yet')}</span></div>
        <div class="l3"><span>${esc(label(a.vendor))}${(a.products || []).length ? ' · ' + esc(a.products.slice(0, 3).join(', ')) : ''}</span>${exposure}<span>${esc(ago(stamp(a)))}</span></div>
      </div>
      <div class="acts">
        <button class="btn${rev ? ' on' : ''}" data-act="review" aria-pressed="${rev}">${rev ? '✓ Reviewed' : 'Review'}</button>
        ${nd ? tabBtn('devices', `Devices (${nd})`) + tabBtn('tickets', `Tickets (${nc})`) : ''}
        ${url ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Advisory ↗</a>` : ''}
      </div>${tab ? drawerHTML(a, tab) : ''}</article>`;
  }

  function drawerHTML(a, tab) {
    const mm = m(a), nd = mm.devices.length;
    const tabs = [['devices', `Devices (${nd})`], ['tickets', `Tickets (${mm.clients.length})`], ['details', 'Details']].filter(([id]) => nd || id === 'details');
    let body = '';
    if (tab === 'devices') {
      const byC = new Map();
      for (const d of mm.devices) { if (!byC.has(d.client)) byC.set(d.client, []); byC.get(d.client).push(d); }
      const groups = [...byC].sort((x, y) => y[1].length - x[1].length);
      body = groups.map(([c, ds], gi) => `<details class="dgrp"${groups.length <= 3 || gi === 0 ? ' open' : ''}><summary><b>${esc(c)}</b><span>${esc(ds[0].team)} · ${ds.length} device${ds.length === 1 ? '' : 's'}</span></summary>
        <ul>${ds.slice(0, 200).map((d) => `<li><span class="dn">${esc(d.device || '(unnamed)')}</span><span class="dm">${esc([d.type, d.model].filter(Boolean).join(' '))}</span><span class="dv">${esc(d.version || 'no version')}</span><span class="df">${esc(VIGIL.remediation(a, d))}</span></li>`).join('')}${ds.length > 200 ? `<li class="more">…and ${ds.length - 200} more</li>` : ''}</ul></details>`).join('');
    } else if (tab === 'tickets') {
      const t = tickets(a);
      body = `<div class="tk-h"><span>One ticket per client · each lists only that client's devices and their upgrade</span><button class="btn" data-act="copy-all">Copy all ${t.length}</button></div>
        ${t.map((x, i) => `<div class="tk"><div class="tk-n"><b>${esc(x.client)}</b><span>${esc(x.team)} · ${x.devices.length} device${x.devices.length === 1 ? '' : 's'}</span></div>
          <div class="acts"><button class="btn" data-act="copy-subj" data-i="${i}">Copy subject</button><button class="btn primary" data-act="copy-one" data-i="${i}">Copy ticket</button></div></div>`).join('')}`;
    } else {
      const ranges = (a.affected || []).slice(0, 8).map((x) => `<li>${esc(x.product)}: ${(x.versions || []).map((v) =>
        esc([v.from ? '≥ ' + v.from : '', v.to_excl ? '< ' + v.to_excl : '', v.to_incl ? '≤ ' + v.to_incl : ''].filter(Boolean).join(' ') || 'all versions')).join('; ') || 'versions not stated'}</li>`).join('');
      const links = (a.urls || []).map(safeUrl).filter(Boolean).map((u) => `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u.replace(/^https?:\/\//, '').slice(0, 80))}</a></li>`).join('');
      body = `<div class="detail">
        <div><h4>Remediation</h4><p>${esc(VIGIL.advisoryFix(a) || 'Fixed versions not published yet. Check the vendor advisory.')}</p>
          ${a.fix ? `<h4>Vendor solution</h4><p>${esc(a.fix)}</p>` : ''}${a.workaround ? `<h4>Workaround</h4><p>${esc(a.workaround)}</p>` : ''}</div>
        <div><h4>Affected versions</h4>${ranges ? `<ul class="mono">${ranges}</ul>` : '<p class="mono">Not stated by the vendor yet.</p>'}
          <h4>Signals</h4><p class="mono">CVSS ${a.cvss ?? '—'} · EPSS ${a.epss != null ? (a.epss * 100).toFixed(1) + '%' : '—'} · ${esc((a.sources || []).map((s) => SOURCE_NAMES[s] || s).join(', '))}</p></div>
        <div><h4>Links</h4><ul>${links || '<li>none</li>'}</ul></div></div>`;
    }
    return `<div class="drawer"><div class="dtabs" role="tablist">${tabs.map(([id, txt]) => `<button role="tab" aria-selected="${tab === id}" data-act="tab" data-tab="${id}" data-keep="1">${txt}</button>`).join('')}
      <button class="dclose" data-act="close" aria-label="Close">×</button></div><div class="dbody">${body}</div></div>`;
  }

  // one ticket per client
  const tickets = (a) => VIGIL.clientTickets(a, m(a), label);

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
      const ok = document.execCommand('copy'); t.remove(); return ok;
    }
  }

  /* ---------- views ---------- */
  function renderHeader() {
    const ours = S.advisories.filter(relevant);
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
    $('#ov-vo').checked = !!S.settings.vendorOnly;
    const hide = $('#ov-hide').checked;
    let list = S.advisories.filter((a) => relevant(a) && !(hide && S.reviewed.has(a.id))).sort(byRank);
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

  // nothing found: say why, and offer one-click lookups at the official sources
  function notFoundHTML(q) {
    if (!q) return '<div class="glass empty-state"><strong>No advisories match these filters</strong></div>';
    const raw = $('#f-q').value.trim(), up = raw.toUpperCase(), links = [];
    const cve = /^CVE-\d{4}-\d{4,}$/.test(up), snw = /^SNWLID-\d{4}-\d{4}$/.test(up);
    if (cve) links.push([`https://nvd.nist.gov/vuln/detail/${up}`, `${up} on NVD`], [`https://www.cve.org/CVERecord?id=${up}`, `${up} on CVE.org`]);
    if (snw) links.push([`https://psirt.global.sonicwall.com/vuln-detail/${up}`, `${up} on SonicWall PSIRT`]);
    links.push([`https://nvd.nist.gov/vuln/search/results?form_type=Basic&results_type=overview&query=${encodeURIComponent(raw)}&search_type=all`, `Search NVD for “${raw}”`]);
    const filtered = $('#f-vendor').value || $('#f-sev').value || $('#f-kev').checked || $('#f-us').checked || $('#f-rev').checked || $('#f-days').value !== '90';
    return `<div class="glass empty-state"><strong>“${esc(raw)}” isn’t in VIGIL${filtered ? ' with these filters' : ''}</strong>
      <p>VIGIL keeps the last 90 days of advisories for vendors in your inventory and watch list${filtered ? '. Try clearing the filters' : ''}.</p>
      <p class="lookups">${links.map(([u, t]) => `<a class="btn" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t)} ↗</a>`).join(' ')}</p></div>`;
  }
  // the top-bar search: always searches everything (filters cleared)
  function globalSearch(q) {
    $('#f-q').value = q; $('#f-vendor').value = ''; $('#f-sev').value = ''; $('#f-days').value = '90';
    ['#f-kev', '#f-us', '#f-rev'].forEach((s) => { $(s).checked = false; });
    if (S.view !== 'advisories') go('advisories'); else renderAdvisories();
  }

  function renderAdvisories() {
    const q = $('#f-q').value.trim().toLowerCase(), v = $('#f-vendor').value, sev = $('#f-sev').value, days = +$('#f-days').value;
    const since = new Date(Date.now() - days * 864e5).toISOString().replace(/\.\d+Z$/, 'Z');
    const min = { critical: 4, high: 3, medium: 2 }[sev] || 0;
    const list = VIGIL.searchAdvisories(S.advisories, q, label).filter((a) => (!v || a.vendor === v || (v === '_other' && !a.vendor))
      && (!min || (SEV_RANK[a.severity] || 0) >= min)
      && (!$('#f-kev').checked || a.kev) && (!$('#f-us').checked || relevant(a)) && (!$('#f-rev').checked || !S.reviewed.has(a.id))
      && stamp(a) >= since).sort(byRank);
    $('#adv-list').innerHTML = list.slice(0, 300).map(rowHTML).join('') || notFoundHTML(q);
    const sel = $('#f-vendor'), cur = sel.value;
    const keys = [...new Set(S.advisories.map((a) => a.vendor).filter(Boolean))].sort((x, y) => label(x).localeCompare(label(y)));
    sel.innerHTML = '<option value="">All vendors</option>' + keys.map((k) => `<option value="${esc(k)}">${esc(label(k))}</option>`).join('') + '<option value="_other">Other (exploited, not ours)</option>';
    sel.value = cur;
  }

  function exposure(by) {
    const out = new Map();
    for (const a of S.advisories) {
      const mm = m(a);
      if (!relevant(a) || S.reviewed.has(a.id)) continue;
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
      const open = S.advisories.filter((a) => a.vendor === k && relevant(a) && !S.reviewed.has(a.id));
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
    soundLabel();
    renderWatch();
    const im = S.inventoryMeta;
    $('#inv-info').innerHTML = im ? `<b>${esc(im.file)}</b> · sheet “${esc(im.sheet)}” · ${S.devices.length} devices · loaded ${esc(ago(im.loaded))}` : 'No inventory loaded.';
    $('#s-kev').checked = S.settings.kev; $('#s-snwl').checked = S.settings.snwl !== false; $('#s-cvss').value = S.settings.cvssMin; $('#s-sound').checked = S.settings.sound; $('#s-lite').checked = S.settings.lite;
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    const on = S.settings.notify && perm === 'granted';
    const pill = $('#s-notify-pill');
    pill.textContent = on ? 'On ✓' : perm === 'denied' ? 'Blocked' : perm === 'unsupported' ? 'Not supported' : 'Off';
    pill.className = 'pill ' + (on ? 'ok' : perm === 'denied' ? 'bad' : '');
    $('#s-notify').textContent = on ? 'Turn off' : 'Turn on';
    $('#s-notify').hidden = perm === 'denied' || perm === 'unsupported';
    $('#s-notify-test').hidden = !on;
    $('#s-notify-st').innerHTML = on ? 'Exploited or critical advisories for your vendors pop up in the Windows corner, even when this tab is in the background. The tab must stay open.'
      : perm === 'denied' ? 'Edge is blocking notifications for this site. To allow them: click the <b>lock icon</b> left of the address bar → <b>Permissions for this site</b> → <b>Notifications: Allow</b>, then reload.'
      : perm === 'unsupported' ? 'This browser can’t show Windows notifications.'
      : 'Off. Turn on to get a Windows pop-up for new alerts. Edge will ask once; choose <b>Allow</b>.';
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
    S.open.set(id, 'details'); $('#f-q').value = id; $('#f-vendor').value = ''; $('#f-sev').value = ''; $('#f-days').value = '90';
    ['#f-kev', '#f-us', '#f-rev'].forEach((s) => { $(s).checked = false; });
    go('advisories');
  }
  window.VIGIL_APP = { go, openAdvisory, filterVendor: (k) => { $('#f-q').value = ''; go('advisories'); $('#f-vendor').value = k; renderAdvisories(); }, label, alerting, m, relevant };

  /* ---------- alerts ---------- */
  function beep(kev) { if (S.settings.sound && window.VIGIL_SOUND) window.VIGIL_SOUND.alert(kev); }
  function setSound(on) {
    S.settings.sound = !!on;
    if (window.VIGIL_SOUND) { window.VIGIL_SOUND.setEnabled(on); if (on) window.VIGIL_SOUND.unlock().then(soundLabel); }
    soundLabel();
  }
  // the header button tells the truth: on, muted by you, or blocked by the browser until a click
  function soundState() {
    const s = window.VIGIL_SOUND;
    if (!s) return 'unsupported';
    if (!S.settings.sound) return 'muted';
    return s.locked ? 'blocked' : 'on';
  }
  function soundLabel() {
    const b = $('#mute'), st = soundState();
    b.textContent = st === 'on' ? '🔊 Sound' : st === 'muted' ? '🔇 Muted' : st === 'blocked' ? '🔈 Enable sound' : '🔇 No audio';
    b.setAttribute('aria-pressed', String(st === 'muted'));
    b.classList.toggle('on', st === 'muted');
    b.classList.toggle('warn', st === 'blocked');
    const p = $('#s-sound-st');
    if (p) p.textContent = { on: 'Audio is on.', muted: 'Muted in VIGIL.', blocked: 'The browser is holding sound until you click. Press Test sound.', unsupported: 'This browser has no audio support.' }[st];
  }
  async function testSound() {
    const s = window.VIGIL_SOUND; if (!s) return;
    if (!S.settings.sound) { setSound(true); savePrefs(); }
    await s.unlock(); soundLabel();
    s.alert(false);
    if (s.locked) toast({ title: 'Sound is blocked', text: 'Edge did not allow audio. Check the tab is not muted (right-click the tab → Unmute site) and the Windows volume mixer for Edge.' });
  }
  window.addEventListener('pointerdown', () => setTimeout(soundLabel, 300), true);
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
    if (t.dataset.act === 'tab') { if (S.open.get(id) === t.dataset.tab && !t.dataset.keep) S.open.delete(id); else S.open.set(id, t.dataset.tab); render(); }
    if (t.dataset.act === 'close') { S.open.delete(id); render(); }
    if (t.dataset.act === 'review') { S.reviewed.has(id) ? S.reviewed.delete(id) : S.reviewed.add(id); savePrefs(); render(); if (window.VIGIL_FX) window.VIGIL_FX.update(S, {}); }
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
  // top-bar search: searches everything as you type; Esc clears
  let gTimer = 0;
  $('#g-q').addEventListener('input', () => {
    clearTimeout(gTimer);
    gTimer = setTimeout(() => { const q = $('#g-q').value.trim(); if (q) globalSearch(q); else if (S.view === 'advisories') globalSearch(''); }, 220);
  });
  $('#g-form').addEventListener('submit', (e) => { e.preventDefault(); globalSearch($('#g-q').value.trim()); });
  $('#g-q').addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('#g-q').value = ''; globalSearch(''); $('#g-q').blur(); } });
  $('#f-q').addEventListener('input', () => { $('#g-q').value = $('#f-q').value; });
  $('#ov-hide').addEventListener('change', renderOverview);
  $('#ov-vo').addEventListener('change', () => { S.settings.vendorOnly = $('#ov-vo').checked; savePrefs(); render(); if (window.VIGIL_FX) window.VIGIL_FX.update(S, {}); });
  $$('input[name=exp]').forEach((r) => r.addEventListener('change', renderExposure));
  $('#refresh').onclick = () => refresh(false);
  $('#file').onchange = (e) => e.target.files[0] && readInventory(e.target.files[0]);
  $('#forget').onclick = forgetInventory;
  const setChange = (sel, fn) => $(sel).addEventListener('change', () => { fn(); savePrefs(); render(); if (window.VIGIL_FX) window.VIGIL_FX.update(S, {}); });
  setChange('#s-kev', () => { S.settings.kev = $('#s-kev').checked; });
  setChange('#s-snwl', () => { S.settings.snwl = $('#s-snwl').checked; });
  setChange('#s-cvss', () => { const v = parseFloat($('#s-cvss').value); S.settings.cvssMin = isNaN(v) ? 9 : Math.min(10, Math.max(0, v)); });
  setChange('#s-sound', () => setSound($('#s-sound').checked));
  $('#mute').onclick = async () => {
    if (soundState() === 'blocked') { await testSound(); return; }     // first click just switches audio on
    setSound(!S.settings.sound); savePrefs(); renderSettings();
    if (S.settings.sound && window.VIGIL_SOUND) window.VIGIL_SOUND.select();
  };
  $('#s-sound-test').onclick = testSound;
  setChange('#s-lite', () => {
    S.settings.lite = $('#s-lite').checked; document.body.classList.toggle('lite', S.settings.lite);
    try { localStorage.setItem('vigil-lite', S.settings.lite ? '1' : ''); } catch (e) { /* fine */ }   // read by the boot screen before IndexedDB is ready
  });
  function testNotify() {
    try {
      const n = new Notification('VIGIL: notifications are on ✓', { body: 'New exploited or critical advisories for your vendors will pop up here, even when this tab is in the background.', tag: 'vigil-test' });
      n.onclick = () => { window.focus(); n.close(); };
      return true;
    } catch (e) { return false; }
  }
  $('#s-notify').onclick = async () => {
    if (!('Notification' in window)) return;
    if (S.settings.notify) { S.settings.notify = false; savePrefs(); renderSettings(); return; }
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    S.settings.notify = perm === 'granted';
    savePrefs(); renderSettings();
    if (S.settings.notify) { const ok = testNotify(); toast({ title: ok ? 'Windows notifications on' : 'Could not show a notification', text: ok ? 'A test notification was just sent. If you did not see it, check Windows Settings → Notifications → Microsoft Edge, and Focus/Do not disturb.' : 'Your browser refused. See the steps under the button.' }); }
  };
  $('#s-notify-test').onclick = () => { const ok = testNotify(); toast({ title: ok ? 'Test notification sent' : 'Test failed', text: ok ? 'No pop-up? Check Windows Settings → System → Notifications → Microsoft Edge is On, and Do not disturb is off.' : 'Permission is not granted for this site.' }); };
  $('#s-unreview').onclick = () => { S.reviewed.clear(); savePrefs(); render(); };

  /* ---------- watched vendors (kept in collector/watch.json in the repository) ---------- */
  const repo = (() => {           // rahulratnakar.github.io/vigil/ -> owner + repo
    const h = location.hostname;
    if (!h.endsWith('.github.io')) return null;
    const owner = h.split('.')[0], name = location.pathname.split('/').filter(Boolean)[0] || h;
    return { owner, name };
  })();
  function watchJSON(w) {
    return JSON.stringify({ _help: 'Extra vendors VIGIL watches even when they are not in the inventory tracker. Format: "Name": ["other names it goes by"]. Edit on GitHub, commit, and the next run (within 15 min) starts collecting them.', vendors: w.vendors }, null, 2) + '\n';
  }
  function renderWatch() {
    const cur = S.watchDraft || S.watch || { vendors: {} }, saved = (S.watch && S.watch.vendors) || {};
    const entries = Object.entries(cur.vendors || {});
    $('#w-list').innerHTML = entries.length ? entries.map(([name, al]) => `<span class="w-chip${name in saved ? '' : ' new'}"><b>${esc(name)}</b>${(al || []).length ? `<small>${esc(al.join(', '))}</small>` : ''}<button type="button" data-unwatch="${esc(name)}" aria-label="Stop watching ${esc(name)}">×</button></span>`).join('')
      : '<p>No extra vendors yet.</p>';
    $('#w-save').hidden = !S.watchDraft;
    const edit = $('#w-edit');
    if (repo) { edit.href = `https://github.com/${repo.owner}/${repo.name}/edit/main/collector/watch.json`; edit.hidden = false; }
    else { edit.hidden = true; }
    $('#w-how').innerHTML = repo ? 'On GitHub: select all the text in the file (Ctrl+A), paste (Ctrl+V), then <b>Commit changes</b>. New advisories for it arrive within 15 minutes.'
      : 'Open <b>collector/watch.json</b> in your GitHub repository, click the pencil to edit, select all, paste, then <b>Commit changes</b>.';
  }
  const draft = () => (S.watchDraft = S.watchDraft || JSON.parse(JSON.stringify(S.watch || { vendors: {} })));
  $('#w-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#w-name').value.trim(); if (!name) return;
    const names = $('#w-alias').value.split(',').map((s) => s.trim()).filter(Boolean);
    const d = draft();
    const same = Object.keys(d.vendors).find((k) => k.toLowerCase() === name.toLowerCase());
    d.vendors[same || name] = [...new Set([...(d.vendors[same] || []), ...names])];
    $('#w-name').value = ''; $('#w-alias').value = '';
    renderWatch();
  });
  $('#w-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-unwatch]'); if (!b) return;
    delete draft().vendors[b.dataset.unwatch]; renderWatch();
  });
  $('#w-copy').onclick = async () => {
    const ok = await copy(watchJSON(draft()));
    $('#w-copy').textContent = ok ? 'Copied ✓ now step 2' : 'Copy failed';
    setTimeout(() => { $('#w-copy').textContent = '1 · Copy updated list'; }, 2500);
  };
  $('#w-undo').onclick = () => { S.watchDraft = null; renderWatch(); };
  // drop the inventory anywhere
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('#drop').classList.add('over'); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop').classList.remove('over'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; $('#drop').classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) readInventory(f); });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/input|select|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); $('#g-q').focus(); }
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
