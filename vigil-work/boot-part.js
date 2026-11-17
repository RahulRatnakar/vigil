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

