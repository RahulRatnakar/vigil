(()=>{
  if (window.__cwW) { clearInterval(window.__cwW.t); window.__cwW.host.remove(); document.title = window.__cwW.title; delete window.__cwW; return; }
  const EVERY = 60;
  const docs = () => { const a = [document]; const walk = d => d.querySelectorAll('iframe').forEach(f => { try { const c = f.contentDocument; if (c) { a.push(c); walk(c); } } catch (e) {} }); walk(document); return a; };
  const leaves = (d, re) => [...d.querySelectorAll('*')].filter(e => e.children.length === 0 && re.test(e.textContent.trim()));
  const read = () => {
    const m = new Map();
    for (const d of docs()) {
      const h = leaves(d, /^Summary Description$/)[0], hr = h && h.closest('tr');
      if (!hr) continue;
      const hc = [...hr.children].map(c => c.textContent.trim()), ti = hc.indexOf('Ticket #'), rows = new Set();
      for (const el of leaves(d, /^\d{7,9}$/)) {
        const tr = el.closest('tr');
        if (!tr || tr === hr || rows.has(tr)) continue;
        rows.add(tr);
        const cells = [...tr.children], off = cells.findIndex(c => c.contains(el)) - ti;
        const g = k => { const c = cells[hc.indexOf(k) + off]; return c ? c.textContent.trim() : ''; };
        const id = el.textContent.trim();
        m.set(id, { id, status: g('Status'), company: g('Company'), summary: g('Summary Description'), sla: g('SLA Status') });
      }
    }
    return m;
  };
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const beep = () => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(.15, ac.currentTime); g.gain.exponentialRampToValueAtTime(.001, ac.currentTime + .4); o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + .4); };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:70px;right:16px;z-index:2147483647';
  const root = host.attachShadow({ mode: 'open' });
  document.body.appendChild(host);
  const S = { t: 0, host, title: document.title, seen: new Set(), fresh: [], count: 0, next: EVERY, last: '', note: '' };
  window.__cwW = S;
  const paint = () => {
    root.innerHTML = `<style>
      .p{width:340px;font:13px/1.4 Segoe UI,system-ui,sans-serif;color:#E6ECF7;background:#0B1324;border:1px solid #23314F;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.45);overflow:hidden}
      .h{display:flex;align-items:center;gap:10px;padding:12px 14px;background:linear-gradient(120deg,rgba(39,176,160,.22),transparent 70%)}
      .dot{width:9px;height:9px;border-radius:50%;background:#27B0A0;box-shadow:0 0 0 0 rgba(39,176,160,.7);animation:pl 2s infinite}
      @keyframes pl{70%{box-shadow:0 0 0 8px rgba(39,176,160,0)}}
      .h b{flex:1;font-size:14px}.h button{background:none;border:0;color:#8EA0C2;font-size:18px;cursor:pointer}
      .n{padding:2px 14px 10px;color:#8EA0C2;font-size:12px}.n em{font-style:normal;color:#E6ECF7;font-weight:600}
      .l{max-height:320px;overflow:auto;border-top:1px solid #23314F}
      .t{padding:10px 14px;border-bottom:1px solid #1A2540;animation:in .5s}
      @keyframes in{from{background:rgba(242,194,48,.25)}}
      .t b{color:#F2C230}.t div{color:#B9C5DD;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.t small{color:#6F7FA0}
      .e{padding:14px;color:#6F7FA0;text-align:center}
      .f{display:flex;gap:8px;padding:10px 14px}.f button{flex:1;padding:7px;border-radius:9px;border:1px solid #2C3C60;background:#14203A;color:#E6ECF7;cursor:pointer;font:inherit}
      .w{color:#F2C230}
    </style>
    <div class="p"><div class="h"><span class="dot"></span><b>Live tickets</b><button id="x" title="Stop watching">×</button></div>
      <div class="n"><em>${S.count}</em> on board · checked ${S.last || '—'} · next in <em id="nx">${S.next}s</em>${S.note ? `<div class="w">${esc(S.note)}</div>` : ''}</div>
      <div class="l">${S.fresh.length ? S.fresh.map(r => `<div class="t"><b>#${esc(r.id)}</b> <small>${esc(r.at)} · ${esc(r.status)}</small><div>${esc(r.company)}</div><div>${esc(r.summary)}</div></div>`).join('') : '<div class="e">Watching. New tickets will pop up here.</div>'}</div>
      <div class="f"><button id="c">Check now</button><button id="k">Clear list</button></div></div>`;
    root.getElementById('x').onclick = () => { clearInterval(S.t); host.remove(); document.title = S.title; delete window.__cwW; };
    root.getElementById('c').onclick = () => { S.next = 0; };
    root.getElementById('k').onclick = () => { S.fresh = []; document.title = S.title; paint(); };
  };
  const scan = first => {
    const cur = read();
    S.last = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (!cur.size) { S.note = 'Board not visible. Open the Service Board List.'; paint(); return; }
    S.note = ''; S.count = cur.size;
    S.fresh = S.fresh.filter(r => cur.has(r.id));
    document.title = S.fresh.length ? `(${S.fresh.length}) New ticket · ${S.title}` : S.title;
    const add = [...cur.values()].filter(r => !S.seen.has(r.id));
    add.forEach(r => S.seen.add(r.id));
    if (!first && add.length) {
      S.fresh.unshift(...add.map(r => Object.assign({ at: S.last }, r)));
      S.fresh = S.fresh.slice(0, 50);
      document.title = `(${S.fresh.length}) New ticket · ${S.title}`;
      beep();
    }
    paint();
  };
  const refresh = () => { const b = docs().map(d => leaves(d, /^SEARCH$/)[0]).find(Boolean); if (b) b.click(); else S.note = 'SEARCH button not found, reading the board as it is.'; setTimeout(() => scan(false), 5000); };
  scan(true);
  S.t = setInterval(() => { S.next--; if (S.next <= 0) { S.next = EVERY; refresh(); } const e = root.getElementById('nx'); if (e) e.textContent = S.next + 's'; }, 1000);
})();
