/* <ai-presence>: a particle presence that shows an assistant's state.
   Attributes: state = idle | listening | thinking | speaking | offline, label, shape = orb | figure, still (no motion).
   Methods: pulse(strength 0..1), attachAudio(MediaStream | HTMLMediaElement), detachAudio().
   Colours: --presence-color, --presence-alert. Square; fills its container's width.
   Decoration plus status: role="img" with a live label. Pauses when hidden; respects prefers-reduced-motion. No network. */
(function () {
  'use strict';
  if (customElements.get('ai-presence')) return;
  const STATES = ['idle', 'listening', 'thinking', 'speaking', 'offline'];
  const SAY = { idle: 'standing by', listening: 'listening', thinking: 'working', speaking: 'reporting', offline: 'offline' };
  const reducedMQ = matchMedia('(prefers-reduced-motion: reduce)');

  function rgb(css, fallback) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(css || '').trim());
    if (m) { const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
    const r = /rgba?\(([^)]+)\)/.exec(css || '');
    return r ? r[1].split(',').slice(0, 3).map(Number) : fallback;
  }

  class AiPresence extends HTMLElement {
    static get observedAttributes() { return ['state', 'label', 'shape', 'still']; }
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = '<style>:host{display:block;width:100%;aspect-ratio:1;position:relative;contain:strict}canvas{width:100%;height:100%;display:block}</style><canvas></canvas>';
      this.cv = root.querySelector('canvas');
      this.energy = 0; this.t = 0; this.last = 0; this.raf = 0; this.mix = 0; this.audio = null;
      this.pts = [];
      const N = 220;
      for (let i = 0; i < N; i++) {            // points on a sphere (golden spiral)
        const y = 1 - (i + 0.5) / N * 2, r = Math.sqrt(1 - y * y), th = i * Math.PI * (3 - Math.sqrt(5));
        this.pts.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r, j: Math.random() * 6.28, s: 0.6 + Math.random() * 0.8 });
      }
      this._vis = () => this.kick();
    }
    connectedCallback() {
      this.setAttribute('role', 'img');
      if (!this.hasAttribute('state')) this.setAttribute('state', 'idle');
      this.updateLabel();
      this.ro = new ResizeObserver(() => { this.fit(); this.kick(true); });
      this.ro.observe(this);
      this.io = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; this.kick(); });
      this.io.observe(this);
      document.addEventListener('visibilitychange', this._vis);
      reducedMQ.addEventListener && reducedMQ.addEventListener('change', this._vis);
      this.kick(true);
    }
    disconnectedCallback() {
      this.ro && this.ro.disconnect(); this.io && this.io.disconnect();
      document.removeEventListener('visibilitychange', this._vis);
      cancelAnimationFrame(this.raf); this.raf = 0; this.detachAudio();
    }
    attributeChangedCallback(n) { if (n === 'state' || n === 'label') this.updateLabel(); this.kick(true); }

    get state() { const s = this.getAttribute('state'); return STATES.includes(s) ? s : 'idle'; }
    set state(v) { this.setAttribute('state', STATES.includes(v) ? v : 'idle'); }
    updateLabel() { this.setAttribute('aria-label', `${this.getAttribute('label') || 'Assistant'}: ${SAY[this.state]}`); }

    pulse(strength = 0.7) { this.energy = Math.min(1.4, this.energy + Math.max(0, strength)); this.kick(); }
    attachAudio(src) {
      this.detachAudio();
      try {
        const AC = window.AudioContext || window.webkitAudioContext; const ctx = new AC();
        const node = src instanceof MediaStream ? ctx.createMediaStreamSource(src) : ctx.createMediaElementSource(src);
        const an = ctx.createAnalyser(); an.fftSize = 256; node.connect(an);
        if (!(src instanceof MediaStream)) an.connect(ctx.destination);
        this.audio = { ctx, an, buf: new Uint8Array(an.frequencyBinCount) };
      } catch (e) { this.audio = null; }
      this.kick();
    }
    detachAudio() { if (this.audio) { try { this.audio.ctx.close(); } catch (e) { /* fine */ } this.audio = null; } }

    still() { return this.hasAttribute('still') || reducedMQ.matches; }
    fit() {
      const r = this.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
      this.cv.width = Math.round(this.W * dpr); this.cv.height = Math.round(this.H * dpr);
      this.g = this.cv.getContext('2d'); this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    kick(force) {
      if (!this.g) this.fit();
      if (this.still() || document.hidden || this.visible === false) {
        cancelAnimationFrame(this.raf); this.raf = 0;
        if (force || this.still()) this.draw(0);     // one honest frame
        return;
      }
      if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
    }
    frame(t) {
      this.raf = 0;
      if (this.still() || document.hidden || this.visible === false) return this.kick(true);
      this.raf = requestAnimationFrame((n) => this.frame(n));
      if (t - this.last < 33) return;                 // at most 30 fps
      const dt = Math.min(0.1, (t - this.last) / 1000 || 0.033); this.last = t;
      if (this.audio) {
        this.audio.an.getByteFrequencyData(this.audio.buf);
        let s = 0; for (const v of this.audio.buf) s += v;
        this.energy = Math.max(this.energy, s / this.audio.buf.length / 160);
      }
      this.t += dt; this.energy *= Math.pow(0.12, dt);
      this.draw(dt);
    }
    draw() {
      const g = this.g, W = this.W, H = this.H, st = this.state, cs = getComputedStyle(this);
      const base = rgb(cs.getPropertyValue('--presence-color'), [45, 226, 200]);
      const alert = rgb(cs.getPropertyValue('--presence-alert'), [255, 61, 94]);
      const col = st === 'offline' ? alert : base, c = col.join(',');
      const t = this.still() ? 0.6 : this.t, e = this.energy, cx = W / 2, cy = H / 2;
      const R = Math.min(W, H) * 0.34;
      g.clearRect(0, 0, W, H);
      // halo
      const breathe = st === 'idle' ? 0.06 * Math.sin(t * 1.2) : 0;
      const glow = g.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * (1.5 + e * 0.4));
      glow.addColorStop(0, `rgba(${c},${st === 'offline' ? 0.12 : 0.28 + e * 0.25})`); glow.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = glow; g.beginPath(); g.arc(cx, cy, R * (1.6 + e * 0.4), 0, 6.283); g.fill();
      // particles
      const spin = st === 'thinking' ? 1.6 : st === 'offline' ? 0.08 : st === 'listening' ? 0.5 : 0.25;
      const a = t * spin, ca = Math.cos(a), sa = Math.sin(a), tilt = 0.35, ct = Math.cos(tilt), stt = Math.sin(tilt);
      const shrink = st === 'listening' ? 0.88 + 0.05 * Math.sin(t * 5) : 1;
      for (const p of this.pts) {
        let x = p.x * ca - p.z * sa, z = p.x * sa + p.z * ca, y = p.y;
        if (this.getAttribute('shape') === 'figure') { y = y * 1.15; x *= (y < 0.15 ? 0.55 : 1.05); }
        const y2 = y * ct - z * stt, z2 = y * stt + z * ct;
        let rr = R * (1 + breathe + e * 0.18 * Math.sin(p.j + t * 9) + (st === 'speaking' ? 0.05 * Math.sin(t * 6 + p.y * 4) : 0)) * shrink;
        if (st === 'offline') rr *= 0.92 + 0.04 * Math.sin(p.j + t);
        const depth = (z2 + 1) / 2, px = cx + x * rr, py = cy + y2 * rr;
        const alpha = (st === 'offline' ? 0.25 : 0.35) + depth * 0.6;
        g.fillStyle = `rgba(${c},${Math.min(1, alpha)})`;
        g.beginPath(); g.arc(px, py, (0.6 + depth * 1.3) * p.s * Math.max(1, W / 120), 0, 6.283); g.fill();
      }
      // thinking arc / listening ring / core
      g.lineWidth = Math.max(1, W / 90);
      if (st === 'thinking') {
        g.strokeStyle = `rgba(${c},.85)`; g.beginPath(); g.arc(cx, cy, R * 1.25, t * 3, t * 3 + 1.4); g.stroke();
      } else if (st === 'listening') {
        const k = (t * 0.8) % 1; g.strokeStyle = `rgba(${c},${0.6 * (1 - k)})`;
        g.beginPath(); g.arc(cx, cy, R * (1.5 - k * 0.5), 0, 6.283); g.stroke();
      }
      const core = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.45);
      core.addColorStop(0, `rgba(255,255,255,${st === 'offline' ? 0.15 : 0.55 + e * 0.4})`); core.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = core; g.beginPath(); g.arc(cx, cy, R * 0.45, 0, 6.283); g.fill();
    }
  }
  customElements.define('ai-presence', AiPresence);
})();
