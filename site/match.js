/* VIGIL matching: runs in the browser (window.VIGIL) and in Node tests. The inventory never leaves the page. */
(function (root) {
  'use strict';
  const DROP = new Set(['inc', 'corp', 'corporation', 'co', 'ltd', 'llc', 'limited', 'systems', 'networks', 'network',
    'technologies', 'technology', 'the', 'communications', 'wireless']);
  const IGNORED_STATUS = new Set(['decommissioned', 'client offboarded']);

  // same rules as collector/vendors.py norm()
  function norm(raw) {
    const words = String(raw == null ? '' : raw).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
    const kept = words.filter((w) => !DROP.has(w));
    return (kept.length ? kept : words).join(' ');
  }

  const cache = new WeakMap();
  function idx(vmap) {
    let i = cache.get(vmap);
    if (!i) {
      i = { alias: new Map(), ignore: new Set((vmap.ignore || []).map(norm)) };
      for (const [key, v] of Object.entries(vmap.vendors)) for (const a of v.aliases) i.alias.set(norm(a), key);
      cache.set(vmap, i);
    }
    return i;
  }

  function normalizeVendor(raw, vmap) {
    const n = norm(raw), i = idx(vmap);
    if (!n || i.ignore.has(n)) return null;
    return i.alias.get(n) || null;
  }

  // first 1.2[.3[.4]] run; "7.2.x" style wildcards count as unparseable
  function parseVersion(s) {
    const m = /(\d+(?:\.\d+){1,3})(\.?[x*])?/i.exec(String(s == null ? '' : s));
    return !m || m[2] ? null : m[1].split('.').map(Number);
  }

  function cmpVersion(a, b) {
    const x = parseVersion(a), y = parseVersion(b);
    if (!x || !y) return null;
    for (let k = 0; k < Math.max(x.length, y.length); k++) {
      const d = (x[k] || 0) - (y[k] || 0);
      if (d) return d < 0 ? -1 : 1;
    }
    return 0;
  }

  function cell(r, name) {
    if (name in r) return r[name];
    const want = name.toLowerCase();
    const k = Object.keys(r).find((h) => h.trim().toLowerCase() === want);
    return k ? r[k] : '';
  }

  function loadInventory(rows, vmap) {
    vmap = vmap || root.VIGIL_VENDORS;
    const devices = [], miss = new Map();
    for (const r of rows || []) {
      if (IGNORED_STATUS.has(String(cell(r, 'Status Q4') || '').trim().toLowerCase())) continue;
      const raw = String(cell(r, 'Manufacturer') == null ? '' : cell(r, 'Manufacturer')).trim();
      const vendor = normalizeVendor(raw, vmap);
      if (!vendor) { const k = raw || '(blank)'; miss.set(k, (miss.get(k) || 0) + 1); continue; }
      const s = (n) => String(cell(r, n) == null ? '' : cell(r, n)).trim();
      devices.push({ client: s('Client'), team: s('Team'), device: s('Device'), vendor, type: s('Device Type'), model: s('Model'), version: s('Current version') });
    }
    const unmatched = [...miss].map(([raw, count]) => ({ raw, count })).sort((a, b) => b.count - a.count);
    return { devices, unmatched };
  }

  // words too general to identify a product on their own (vendor names are added from vendors.json)
  const GENERIC = ['application', 'software', 'firmware', 'os', 'series', 'appliance', 'management', 'manager', 'network', 'networks',
    'server', 'client', 'agent', 'and', 'for', 'the', 'platform', 'system', 'systems', 'service', 'services', 'web', 'cloud', 'edition', 'plus', 'pro'];
  const genCache = new WeakMap();
  function generic(vmap) {
    let g = genCache.get(vmap || {});
    if (!g) {
      g = new Set(GENERIC);
      for (const v of Object.values((vmap && vmap.vendors) || {})) for (const s of [v.label, ...(v.aliases || []), ...(v.cve_names || [])]) norm(s).split(' ').forEach((w) => g.add(w));
      if (vmap) genCache.set(vmap, g);
    }
    return g;
  }

  // does advisory product p describe this device? Compares against Device Type + Model, using vendors.json product_aliases
  function productHits(p, dev, vmap) {
    const n = norm(p);
    if (!n) return false;
    const pa = (vmap && vmap.product_aliases) || {};
    const tokens = norm(dev.type + ' ' + dev.model).split(' ');
    const text = ' ' + tokens.join(' ') + ' ';
    const cands = [n, ...(pa[n] || [])];
    const g = generic(vmap);
    for (const w of n.split(' ')) {
      const base = w.replace(/\d+$/, '');                   // "idrac9" -> "idrac"
      if (g.has(w) || w.length < 2) continue;
      if (pa[w]) cands.push(...pa[w]); else if (pa[base]) cands.push(...pa[base]);
      cands.push(w);
    }
    return cands.map(norm).some((c) => {
      if (c.includes(' ')) return text.includes(' ' + c + ' ') || text.includes(' ' + c.replace(/ /g, '') + ' ');
      // whole word, or a model number that starts with it ("mx" -> "mx68", "fortigate" -> "fortigate60f")
      return tokens.some((t) => t === c || (t.startsWith(c) && /^\d/.test(t.slice(c.length))));
    });
  }

  function inRange(v, r) {
    const checks = [];
    if (r.from && r.from === r.to_incl) checks.push(cmpVersion(v, r.from) === 0 ? 0 : 1);
    else {
      if (r.from) { const c = cmpVersion(v, r.from); checks.push(c == null ? null : c >= 0 ? 0 : 1); }
      if (r.to_excl) { const c = cmpVersion(v, r.to_excl); checks.push(c == null ? null : c < 0 ? 0 : 1); }
      if (r.to_incl) { const c = cmpVersion(v, r.to_incl); checks.push(c == null ? null : c <= 0 ? 0 : 1); }
    }
    if (!checks.length || checks.includes(null)) return null;   // can't tell
    return checks.every((c) => c === 0);
  }

  // per device: 'Confirmed' | 'Likely' | 'Vendor only' | null (not affected)
  function rate(adv, dev, vmap) {
    const products = [...new Set([...(adv.products || []), ...(adv.affected || []).map((a) => a.product).filter(Boolean)])];
    if (!products.length) return 'Vendor only';
    const hit = products.filter((p) => productHits(p, dev, vmap));
    if (!hit.length) return 'Vendor only';
    if (!parseVersion(dev.version)) return 'Likely';
    const ranges = (adv.affected || []).filter((a) => hit.includes(a.product)).flatMap((a) => a.versions || []);
    if (!ranges.length) return 'Likely';
    const res = ranges.map((r) => inRange(dev.version, r));
    if (res.includes(true)) return 'Confirmed';
    if (res.includes(null)) return 'Likely';
    return null;
  }

  const RANK = { Confirmed: 3, Likely: 2, 'Vendor only': 1 };

  function matchAdvisory(adv, devices, vmap) {
    vmap = vmap || root.VIGIL_VENDORS;
    const rated = [];
    for (const d of devices || []) {
      if (!adv.vendor || d.vendor !== adv.vendor) continue;
      const c = rate(adv, d, vmap);
      if (c) rated.push([d, c]);
    }
    const best = rated.reduce((b, [, c]) => (!b || RANK[c] > RANK[b] ? c : b), null);
    // product-level matches (Confirmed + Likely) list together; "Vendor only" devices only when nothing better exists
    const list = rated.filter(([, c]) => (RANK[best] >= 2 ? RANK[c] >= 2 : true)).map(([d]) => d);
    const uniq = (k) => [...new Set(list.map((d) => d[k]).filter(Boolean))].sort();
    return { confidence: best, devices: list, clients: uniq('client'), teams: uniq('team') };
  }

  function isAlert(adv, match, rule) {
    rule = rule || { kev: true, cvssMin: 9.0 };
    if (!match || !match.confidence || !match.devices.length) return false;
    return (rule.kev && !!adv.kev) || (adv.cvss || 0) >= rule.cvssMin;
  }

  // one ticket per client: each lists only that client's devices, ready to paste into that client's ticket
  function clientTickets(adv, match, label) {
    if (!match || !match.devices || !match.devices.length) return [];
    label = label || ((k) => k);
    const sev = (adv.kev ? 'critical' : adv.severity || 'unrated').toUpperCase();
    const vendor = label(adv.vendor) + ((adv.products || []).length ? ' ' + adv.products.slice(0, 2).join(', ') : '');
    const fixes = [...new Set((adv.affected || []).flatMap((a) => (a.versions || []).map((v) =>
      v.to_excl ? `${a.product}: upgrade to ${v.to_excl} or later` : v.to_incl && v.to_incl !== v.from ? `${a.product}: upgrade to a release newer than ${v.to_incl}` : null)).filter(Boolean))];
    const urls = (adv.urls || []).filter((u) => /^https?:\/\//i.test(String(u)));
    const byClient = new Map();
    for (const d of match.devices) {
      const k = d.client || '(no client)';
      if (!byClient.has(k)) byClient.set(k, []);
      byClient.get(k).push(d);
    }
    return [...byClient].sort(([a], [b]) => a.localeCompare(b)).map(([client, devices]) => {
      const subject = `[${sev}] ${adv.id} – ${vendor} – ${client}`;
      const lines = [
        `Security advisory: ${adv.id}${adv.title ? ' – ' + adv.title : ''}`, '',
        `Severity: ${sev}${adv.cvss != null ? ` (CVSS ${adv.cvss})` : ''}`,
        adv.kev ? 'Status: ACTIVELY EXPLOITED in the wild (listed by CISA KEV). Treat as urgent.' : 'Status: no known active exploitation yet.',
        `Vendor / product: ${vendor}`,
        `Match: ${match.confidence}`, '',
        `Affected devices for ${client} (${devices.length}):`,
        ...devices.map((d) => `- ${d.device || '(unnamed)'} · ${[d.type, d.model].filter(Boolean).join(' ') || 'device'} · version ${d.version || 'unknown'}`), '',
        'Recommended action:',
        ...(fixes.length ? fixes.map((f) => `- ${f}`) : ['- Apply the fixed release or workaround from the vendor advisory below.']),
        '- Confirm the running version on each device after the change.',
      ];
      if (urls.length) lines.push('', 'Vendor advisory:', ...urls);
      return { client, team: devices[0].team || '', subject, body: lines.join('\n'), devices };
    });
  }

  const api = { norm, normalizeVendor, parseVersion, cmpVersion, loadInventory, matchAdvisory, isAlert, clientTickets };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VIGIL = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
