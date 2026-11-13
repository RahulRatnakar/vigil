/* VIGIL visual layer: boot screen, hero threat wireframe, vendor bubble grid, flowing background.
   One animation loop, at most 30 fps, stopped while the page is hidden or in Lite mode. Data only flows in from app.js. */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const C = { teal: '45,226,200', amber: '255,181,71', red: '255,61,94', blue: '90,169,255' };
  const SEV = { critical: 4, high: 3, medium: 2, low: 1 };
  const SOURCE_NAMES = { kev: 'CISA KEV', cvelist: 'CVE List', nvd: 'NVD', epss: 'EPSS', fortinet: 'Fortinet', cisco: 'Cisco', paloalto: 'Palo Alto', microsoft: 'Microsoft', sophos: 'Sophos' };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let S = null, view = 'overview', raf = 0, last = 0, t0 = performance.now();
  const lite = () => reduced || (S && S.settings.lite);
  const stamp = (a) => a.modified || a.published || '';

  /* ---------- canvas helpers ---------- */
  function fit(cv) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), r = cv.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w: r.width, h: r.height };
  }

  /* ---------- boot sequence (every open; Lite skips it) ---------- */
  let liteSaved = false;
  try { liteSaved = !!localStorage.getItem('vigil-lite'); } catch (e) { /* storage blocked */ }
  let boot = null, bootClock = 0, bootInfo = null, bootRun = null, booted = false;
  window.VIGIL_BOOTING = false;
  const SND = () => window.VIGIL_SOUND;
  if (!lite() && !liteSaved) {
    window.VIGIL_BOOTING = true;
    boot = document.createElement('div');
    boot.id = 'boot';
    boot.innerHTML = `<canvas id="boot-cv" aria-hidden="true"></canvas>
      <div class="b-center"><div class="bt" id="boot-title" aria-label="VIGIL">VIGIL</div><div class="bs">THREAT GRID</div><div class="b-pct" id="boot-pct">000</div></div>
      <div class="b-side b-left"><div class="b-clock" id="boot-clock"></div><pre id="boot-sys"></pre></div>
      <pre class="b-side b-right" id="boot-log" aria-live="polite"></pre>
      <button class="engage" id="engage" hidden><span>ENGAGE</span><small>click or press any key · sound on</small></button>
      <button class="btn skip">Skip ›</button>`;
    document.body.appendChild(boot);
    const tick = () => {
      const c = $('#boot-clock'); if (!c) return;
      const d = new Date();
      c.textContent = d.toLocaleTimeString([], { hour12: false }) + ' · ' + d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
    };
    tick(); bootClock = setInterval(tick, 1000);
    boot.querySelector('.skip').onclick = (e) => { e.stopPropagation(); endBoot(); };
    setTimeout(() => {
      const s = SND();
      if (s && s.enabled && s.locked) {
        // the browser blocks sound until a click or key: offer ENGAGE, carry on silently if nobody is there
        const btn = $('#engage'); btn.hidden = false;
        let started = false;
        const go = () => { if (started) return; started = true; btn.classList.add('fire'); s.unlock().then(() => setTimeout(runBoot, 250)); };
        btn.onclick = go;
        document.addEventListener('keydown', go, { once: true });
        setTimeout(() => { if (!started) { started = true; btn.hidden = true; runBoot(); } }, 6000);
      } else runBoot();
    }, 120);
    setTimeout(endBoot, 16000);                      // hard stop: never block the page
  }

  function runBoot() {
    if (!boot || bootRun) return;
    $('#engage').hidden = true;
    const s = SND(); if (s) s.drone(4.2);
    const cv = $('#boot-cv'), title = $('#boot-title'), pct = $('#boot-pct'), sys = $('#boot-sys'), log = $('#boot-log');
    const RINGS = 6, GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@<>/+', WORD = 'VIGIL';
    const sysLines = ['CORE KERNEL', 'HOLO GRID', 'MATCH ENGINE', 'SIGNAL BUS', 'CRYPTO LINK'];
    const locked = new Set(), t0b = performance.now();
    let lastDecode = 0, lastPct = -1, sysShown = 0, feedsStarted = false, outro = false;
    bootRun = { stop: false };
    function feeds() {
      if (feedsStarted) return; feedsStarted = true;
      const src = (bootInfo && bootInfo.sources) || {};
      const lines = Object.entries(src).map(([k, v]) => `${esc((SOURCE_NAMES[k] || k).toUpperCase().padEnd(13, '·'))} ${v.status === 'ok' ? '<span class="ok">LOCKED</span>' : '<span class="bad">STALE</span>'}`);
      lines.push(`${'INVENTORY'.padEnd(13, '·')} <span class="ok">${bootInfo && bootInfo.devices ? bootInfo.devices + ' DEVICES' : 'NOT LOADED'}</span>`);
      let i = 0;
      const next = () => {
        if (!boot) return;
        if (i < lines.length) { log.innerHTML += (i ? '\n' : '') + lines[i++]; if (s) s.tick(); setTimeout(next, 130); } else setTimeout(finish, 450);
      };
      next();
    }
    function finish() {
      if (!boot || outro) return; outro = true;
      if (s) { s.chord(); s.whoosh(true); }
      boot.classList.add('out');
      setTimeout(endBoot, 1000);
    }
    function draw(now) {
      if (!boot || bootRun.stop) return;
      requestAnimationFrame(draw);
      const t = (now - t0b) / 1000;
      const { g, w, h } = fit(cv), cx = w / 2, cy = h / 2, u = Math.min(w, h) / 620;
      g.clearRect(0, 0, w, h);
      const col = '45,226,200';
      // rings assemble one by one, alternate directions, and lock with a click
      for (let i = 0; i < RINGS; i++) {
        const start = 0.15 + i * 0.32, k = Math.max(0, Math.min(1, (t - start) / 0.55)); if (!k) continue;
        const r = (70 + i * 42) * u, dir = i % 2 ? -1 : 1, rot = dir * t * (0.25 + i * 0.07), e = 1 - Math.pow(1 - k, 3);
        g.save(); g.translate(cx, cy); g.rotate(rot);
        g.strokeStyle = `rgba(${col},${0.25 + 0.5 * e})`; g.lineWidth = i === 0 ? 2.5 : 1.4; g.shadowColor = `rgba(${col},.9)`; g.shadowBlur = 10;
        g.setLineDash(i % 2 ? [] : [14 * u, 8 * u]);
        g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2 * e); g.stroke();
        g.setLineDash([]);
        if (i % 2) {
          for (let a = 0; a < 72 * e; a++) {
            const ang = (a / 72) * Math.PI * 2, l = a % 6 ? 4 : 10;
            g.beginPath(); g.moveTo(Math.cos(ang) * r, Math.sin(ang) * r); g.lineTo(Math.cos(ang) * (r + l * u), Math.sin(ang) * (r + l * u)); g.stroke();
          }
        }
        if (i === 3 || i === 5) { g.lineWidth = 5; g.strokeStyle = `rgba(${col},.85)`; for (const a0 of [0.2, 2.3, 4.4]) { g.beginPath(); g.arc(0, 0, r + 6 * u, a0, a0 + 0.55 * e); g.stroke(); } }
        g.restore();
        if (k >= 1 && !locked.has(i)) { locked.add(i); if (s) s.lock(i); }
      }
      // radar sweep
      const R = (70 + 5 * 42) * u;
      if (g.createConicGradient) {
        const sg = g.createConicGradient(t * 2.2, cx, cy);
        sg.addColorStop(0, `rgba(${col},.28)`); sg.addColorStop(0.08, `rgba(${col},0)`); sg.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = sg; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
      }
      // crosshair
      g.strokeStyle = `rgba(${col},.25)`; g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx - R - 40 * u, cy); g.lineTo(cx - 52 * u, cy); g.moveTo(cx + 52 * u, cy); g.lineTo(cx + R + 40 * u, cy); g.stroke();
      // percent counter
      const p = Math.min(100, Math.floor(Math.max(0, (t - 0.15) / (0.15 + RINGS * 0.32)) * 100));
      pct.textContent = String(p).padStart(3, '0');
      if (p > 0 && Math.floor(p / 10) !== Math.floor(lastPct / 10) && s) s.tick();
      lastPct = p;
      // the title decodes letter by letter
      if (t > 0.35) {
        let out = '';
        for (let i = 0; i < WORD.length; i++) out += t > 0.6 + i * 0.22 ? WORD[i] : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        title.textContent = out;
        if (out !== WORD && now - lastDecode > 55 && s) { s.decode(); lastDecode = now; }
        title.classList.toggle('lit', out === WORD);
      }
      // system checks on the left
      while (sysShown < sysLines.length && t > 0.5 + sysShown * 0.36) { sys.innerHTML += (sysShown ? '\n' : '') + `${sysLines[sysShown].padEnd(13, '·')} <span class="ok">OK</span>`; sysShown++; }
      // feeds once the rings are done (waits up to 3 s for data)
      if (p >= 100 && !feedsStarted && (bootInfo || t > 0.15 + RINGS * 0.32 + 3)) feeds();
    }
    requestAnimationFrame(draw);
  }
  function bootData(state) { bootInfo = { sources: state.sources, devices: state.devices.length }; }
  function endBoot() {
    if (booted) return; booted = true;
    clearInterval(bootClock);
    if (bootRun) bootRun.stop = true;
    window.VIGIL_BOOTING = false;
    window.dispatchEvent(new Event('vigil:booted'));
    if (!boot) return;
    boot.classList.add('gone');
    const b = boot; boot = null; setTimeout(() => b.remove(), 700);
  }
  if (!boot) setTimeout(endBoot, 0);

  /* ---------- hero threat ---------- */
  let hero = null;          // {adv, shape, color}
  function pickHero() {
    const A = window.VIGIL_APP; if (!A) return null;
    const open = S.advisories.filter((a) => !S.reviewed.has(a.id));
    const alerts = open.filter(A.alerting).sort((x, y) => (stamp(y) > stamp(x) ? 1 : -1));
    if (alerts.length) return alerts[0];
    const ours = open.filter((a) => A.m(a).confidence).sort((x, y) => (y.cvss || 0) - (x.cvss || 0));
    return ours[0] || null;
  }
  function shapeFor(adv) {
    const devs = window.VIGIL_APP.m(adv).devices, t = (devs.map((d) => d.type + ' ' + d.model).join(' ') + ' ' + (adv.products || []).join(' ')).toLowerCase();
    if (/access point|\bap\b|unifi|aironet|wireless|\bmr\d/.test(t)) return 'ap';
    if (/server|esxi|host|poweredge|proliant|idrac|nas|storage/.test(t)) return 'server';
    if (/switch|\bms\d|catalyst|icx/.test(t)) return 'switch';
    return 'firewall';
  }
  function renderHero() {
    const el = $('#hero'), A = window.VIGIL_APP;
    const a = pickHero();
    if (!a) {
      hero = { adv: null, shape: 'firewall', color: C.teal };
      el.className = 'hero glass empty';
      el.innerHTML = `<canvas id="herocv" aria-hidden="true"></canvas><div class="h-k">Threat grid</div><div class="h-id">ALL QUIET</div>
        <div class="h-t">${S.devices.length ? 'No open advisory affects your inventory right now.' : 'Load the inventory to see what affects you.'}</div>`;
      return;
    }
    const mm = A.m(a), color = a.kev || a.severity === 'critical' ? C.red : a.severity === 'high' ? C.amber : C.teal;
    hero = { adv: a, shape: shapeFor(a), color };
    el.className = 'hero glass';
    el.innerHTML = `<canvas id="herocv" aria-hidden="true"></canvas>
      <div class="h-k">${A.alerting(a) ? 'Newest alert' : 'Top exposure'} · ${esc(A.label(a.vendor))}</div>
      <div class="h-id" style="color:rgb(${color});text-shadow:0 0 28px rgba(${color},.35)">${esc(a.id)}</div>
      <div class="h-t">${esc(a.title || '')}</div>
      <div class="h-x">
        ${a.kev ? '<span class="chip kev">Exploited</span>' : ''}${mm.confidence ? `<span class="chip c-${mm.confidence.split(' ')[0]}">${esc(mm.confidence)}</span>` : ''}
        <span class="chip">CVSS ${a.cvss != null ? Number(a.cvss).toFixed(1) : '—'}</span>
      </div>
      <div class="h-x"><span class="h-big">${mm.devices.length} device${mm.devices.length === 1 ? '' : 's'} · ${mm.clients.length} client${mm.clients.length === 1 ? '' : 's'}</span></div>
      <div class="h-x"><button class="btn primary" data-open="${esc(a.id)}">Open details</button></div>`;
  }

  // wireframe models: [vertices, edges]; units roughly −1..1
  function box(w, h, d, y0 = 0) {
    const v = [];
    for (const x of [-w, w]) for (const y of [y0, y0 + h]) for (const z of [-d, d]) v.push([x, y, z]);
    const e = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    return [v, e];
  }
  function merge(...parts) {
    const v = [], e = [];
    for (const [pv, pe] of parts) { const o = v.length; v.push(...pv); e.push(...pe.map(([a, b]) => [a + o, b + o])); }
    return [v, e];
  }
  const MODELS = {
    firewall: () => { const parts = [box(1.1, 0.34, 0.62)]; for (let i = 0; i < 6; i++) parts.push(box(0.07, 0.07, 0.02, 0.12).map((x, k) => k ? x : x.map(([a, b, c]) => [a - 0.75 + i * 0.22, b, c + 0.62]))); return merge(...parts); },
    switch: () => { const parts = [box(1.25, 0.2, 0.55)]; for (let i = 0; i < 12; i++) parts.push(box(0.05, 0.05, 0.02, 0.07).map((x, k) => k ? x : x.map(([a, b, c]) => [a - 1.05 + i * 0.19, b, c + 0.55]))); return merge(...parts); },
    server: () => merge(box(0.55, 1.5, 0.7), ...[0.3, 0.6, 0.9, 1.2].map((y) => [[[-0.55, y, 0.7], [0.55, y, 0.7]], [[0, 1]]])),
    ap: () => {
      const v = [], e = [], n = 20;
      for (let r of [0.85, 0.85]) for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; v.push([Math.cos(a) * r, v.length >= n ? 0.18 : 0, Math.sin(a) * r]); }
      for (let i = 0; i < n; i++) { e.push([i, (i + 1) % n], [n + i, n + ((i + 1) % n)]); if (i % 4 === 0) e.push([i, n + i]); }
      const o = v.length; v.push([-0.5, 0.18, 0], [-0.5, 0.95, 0], [0.5, 0.18, 0], [0.5, 0.95, 0]); e.push([o, o + 1], [o + 2, o + 3]);
      return [v, e];
    },
  };
  function drawHero(t) {
    const cv = $('#herocv'); if (!cv || !hero) return;
    const { g, w, h } = fit(cv); g.clearRect(0, 0, w, h);
    const col = hero.color, cx = w * 0.55, cy = h * 0.72, sc = Math.min(w, h) * 0.3;
    // lit platform
    const pg = g.createRadialGradient(cx, cy, 2, cx, cy, sc * 1.6);
    pg.addColorStop(0, `rgba(${col},.35)`); pg.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = pg; g.beginPath(); g.ellipse(cx, cy, sc * 1.6, sc * 0.42, 0, 0, Math.PI * 2); g.fill();
    for (let i = 1; i <= 3; i++) {
      const k = ((t / 2600 + i / 3) % 1);
      g.strokeStyle = `rgba(${col},${0.35 * (1 - k)})`; g.lineWidth = 1;
      g.beginPath(); g.ellipse(cx, cy, sc * (0.6 + k), sc * (0.16 + k * 0.27), 0, 0, Math.PI * 2); g.stroke();
    }
    // rotating model with a light bob
    const [V, E] = MODELS[hero.shape](), ang = t / 4200, bob = Math.sin(t / 900) * 4;
    const cos = Math.cos(ang), sin = Math.sin(ang), tilt = 0.32;
    const P = V.map(([x, y, z]) => {
      const X = x * cos - z * sin, Z = x * sin + z * cos;
      const Y = y * Math.cos(tilt) - Z * Math.sin(tilt), Z2 = y * Math.sin(tilt) + Z * Math.cos(tilt);
      const p = 3.2 / (3.2 + Z2);
      return [cx + X * sc * p, cy - 10 + bob - Y * sc * p, Z2];
    });
    g.lineWidth = 1.3; g.shadowColor = `rgba(${col},.8)`; g.shadowBlur = 8;
    for (const [a, b] of E) {
      const z = (P[a][2] + P[b][2]) / 2;
      g.strokeStyle = `rgba(${col},${0.5 + Math.max(-0.4, Math.min(0.4, -z * 0.3))})`;
      g.beginPath(); g.moveTo(P[a][0], P[a][1]); g.lineTo(P[b][0], P[b][1]); g.stroke();
    }
    g.shadowBlur = 0;
    // scan line
    const sy = cy - sc * 1.7 + ((t / 2400) % 1) * sc * 1.9;
    const sg = g.createLinearGradient(0, sy - 10, 0, sy + 10);
    sg.addColorStop(0, `rgba(${col},0)`); sg.addColorStop(0.5, `rgba(${col},.18)`); sg.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = sg; g.fillRect(cx - sc * 1.5, sy - 10, sc * 3, 20);
  }

  /* ---------- vendor bubble grid ---------- */
  let nodes = [], links = [], hover = null, flares = [];
  function buildCloud() {
    const A = window.VIGIL_APP; if (!A) return;
    const per = new Map();
    for (const d of S.devices) {
      if (!per.has(d.vendor)) per.set(d.vendor, { n: 0, clients: new Set() });
      const p = per.get(d.vendor); p.n++; p.clients.add(d.client);
    }
    const old = new Map(nodes.map((n) => [n.k, n]));
    const cv = $('#cloud'), W = cv.clientWidth || 400, H = cv.clientHeight || 260;
    const maxN = Math.max(1, ...[...per.values()].map((p) => p.n));
    nodes = [...per].map(([k, p], i) => {
      const open = S.advisories.filter((a) => a.vendor === k && A.m(a).confidence && !S.reviewed.has(a.id));
      const worst = open.some((a) => a.kev) ? 'kev' : open.reduce((w, a) => ((SEV[a.severity] || 0) > (SEV[w] || 0) ? a.severity : w), '');
      const color = worst === 'kev' || worst === 'critical' ? C.red : worst === 'high' ? C.amber : C.teal;
      const r = 10 + 34 * Math.sqrt(p.n / maxN) * Math.min(1, W / 520);
      const o = old.get(k);
      const ang = (i / Math.max(1, per.size)) * Math.PI * 2;
      return { k, label: A.label(k), n: p.n, clients: p.clients, open: open.length, kev: open.filter((a) => a.kev).length, color, r,
        x: o ? o.x : W / 2 + Math.cos(ang) * W * 0.3, y: o ? o.y : H / 2 + Math.sin(ang) * H * 0.3, vx: 0, vy: 0 };
    });
    links = [];
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      let shared = 0; for (const c of nodes[i].clients) if (nodes[j].clients.has(c)) shared++;
      if (shared) links.push([nodes[i], nodes[j], shared]);
    }
    if (lite()) for (let i = 0; i < 300; i++) settle(W, H);
  }
  function settle(W, H) {
    for (const a of nodes) {
      a.vx += (W / 2 - a.x) * 0.0016; a.vy += (H / 2 - a.y) * 0.0024;
      for (const b of nodes) {
        if (a === b) continue;
        const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy) || 0.01, min = a.r + b.r + 10;
        if (d < min) { const f = (min - d) / d * 0.08; a.vx += dx * f; a.vy += dy * f; }
      }
    }
    for (const a of nodes) {
      a.vx *= 0.82; a.vy *= 0.82; a.x += a.vx; a.y += a.vy;
      a.x = Math.max(a.r + 2, Math.min(W - a.r - 2, a.x)); a.y = Math.max(a.r + 2, Math.min(H - a.r - 2, a.y));
    }
  }
  function drawCloud(t) {
    const cv = $('#cloud'); if (!cv) return;
    const { g, w, h } = fit(cv); g.clearRect(0, 0, w, h);
    if (!nodes.length) {
      g.fillStyle = 'rgba(130,153,168,.8)'; g.font = '13px "JetBrains Mono", Consolas, monospace'; g.textAlign = 'center';
      g.fillText(S && S.devices.length === 0 ? 'Load inventory to map vendors' : 'No vendors', w / 2, h / 2); return;
    }
    if (!lite()) settle(w, h);
    for (const [a, b, s] of links) {
      g.strokeStyle = `rgba(120,220,230,${Math.min(0.28, 0.06 + s * 0.03)})`; g.lineWidth = 1;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    for (const n of nodes) {
      const breathe = lite() ? 0 : Math.sin(t / 1400 + n.x * 0.05) * 1.5, r = n.r + breathe + (hover === n ? 3 : 0);
      const gr = g.createRadialGradient(n.x - r * 0.3, n.y - r * 0.35, r * 0.1, n.x, n.y, r);
      gr.addColorStop(0, `rgba(${n.color},.55)`); gr.addColorStop(1, `rgba(${n.color},.08)`);
      g.fillStyle = gr; g.beginPath(); g.arc(n.x, n.y, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = `rgba(${n.color},${hover === n ? 1 : 0.7})`; g.lineWidth = n.kev ? 2 : 1; g.stroke();
      if (n.r > 16) {
        g.fillStyle = '#d9e7ee'; g.font = `600 ${n.r > 28 ? 12 : 10}px Rajdhani, "Segoe UI", sans-serif`; g.textAlign = 'center';
        g.fillText(n.label.split(' / ')[0].toUpperCase(), n.x, n.y + 4);
      }
    }
    flares = flares.filter((f) => t - f.t < 2200);
    for (const f of flares) {
      const n = nodes.find((x) => x.k === f.k); if (!n) continue;
      const k = (t - f.t) / 2200;
      g.strokeStyle = `rgba(${C.red},${1 - k})`; g.lineWidth = 2;
      g.beginPath(); g.arc(n.x, n.y, n.r + k * 40, 0, Math.PI * 2); g.stroke();
    }
  }
  const cloudCv = $('#cloud'), tip = $('#tip');
  const hit = (e) => { const r = cloudCv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; return [nodes.find((n) => Math.hypot(n.x - x, n.y - y) <= n.r + 2) || null, x, y]; };
  cloudCv.addEventListener('mousemove', (e) => {
    const [n, x, y] = hit(e); hover = n; cloudCv.style.cursor = n ? 'pointer' : 'default';
    if (n) {
      tip.innerHTML = `<b>${esc(n.label)}</b><br>${n.n} devices · ${n.open} open${n.kev ? ` · <span style="color:rgb(${C.red})">${n.kev} exploited</span>` : ''}`;
      tip.style.left = Math.min(x + 26, cloudCv.clientWidth - 150) + 'px'; tip.style.top = y + 30 + 'px'; tip.style.opacity = 1;
    } else tip.style.opacity = 0;
    if (lite()) drawCloud(performance.now());
  });
  cloudCv.addEventListener('mouseleave', () => { hover = null; tip.style.opacity = 0; });
  cloudCv.addEventListener('click', (e) => { const [n] = hit(e); if (n && window.VIGIL_APP) window.VIGIL_APP.filterVendor(n.k); });

  /* ---------- flowing background ---------- */
  function drawBg(t) {
    const cv = $('#fxbg'); if (!cv) return;
    const { g, w, h } = fit(cv); g.clearRect(0, 0, w, h);
    const hot = document.body.classList.contains('kev-open'), col = hot ? C.red : C.teal;
    for (let i = 0; i < 7; i++) {
      const base = h * (0.18 + i * 0.11), amp = 18 + i * 6, sp = t / (9000 + i * 1500), freq = 0.0022 + i * 0.0003;
      g.strokeStyle = `rgba(${col},${0.035 + (i % 3) * 0.012})`; g.lineWidth = 1;
      g.beginPath();
      for (let x = 0; x <= w; x += 16) {
        const y = base + Math.sin(x * freq + sp * 6 + i) * amp + Math.sin(x * freq * 2.3 - sp * 4) * amp * 0.4;
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
    // drifting grid points
    g.fillStyle = `rgba(${col},.12)`;
    const step = 64, off = (t / 120) % step;
    for (let x = -step; x < w + step; x += step) for (let y = 0; y < h; y += step) g.fillRect(x + off, y + Math.sin((x + t / 40) / 90) * 6, 1.4, 1.4);
  }

  /* ---------- loop ---------- */
  const has3d = () => !!window.VIGIL_CORE3D;
  function frame(now) {
    raf = 0;
    if (document.hidden || lite()) return;
    raf = requestAnimationFrame(frame);
    if (now - last < 33) return;                     // ≤ 30 fps
    last = now;
    const t = now - t0;
    drawBg(t);
    if (view === 'overview' && !has3d()) { drawHero(t); drawCloud(t); }
  }
  function kick() {
    if (lite()) { drawStatic(); return; }
    if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function drawStatic() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    const cv = $('#fxbg'); if (cv) { const { g, w, h } = fit(cv); g.clearRect(0, 0, w, h); }
    if (view === 'overview' && !has3d()) { drawHero(0); drawCloud(0); }
  }
  document.addEventListener('visibilitychange', kick);
  window.addEventListener('resize', () => { if (S) { buildCloud(); if (lite()) drawStatic(); } });

  window.VIGIL_FX = {
    update(state, info) {
      S = state;
      renderHero(); buildCloud();
      if (info && info.first) bootData(S);
      if (info && info.fresh && !has3d()) info.fresh.forEach((id) => { const a = S.advisories.find((x) => x.id === id); if (a && a.vendor) flares.push({ k: a.vendor, t: performance.now() - t0 }); });
      if (has3d()) window.VIGIL_CORE3D.update(S, info);
      kick();
    },
    flare(k, kev) { if (!k) return; if (has3d()) window.VIGIL_CORE3D.flare(k, kev); else flares.push({ k, t: performance.now() - t0 }); kick(); },
    view(v) { view = v; if (S && v === 'overview') { renderHero(); buildCloud(); } if (has3d()) window.VIGIL_CORE3D.view(v); kick(); },
    hero: () => hero,
  };
})();
