/* VIGIL sound: every sound is synthesized live with Web Audio (no audio files).
   Browsers start audio "locked" until the first click/key unless autoplay is allowed for the site. */
(function () {
  'use strict';
  let ctx = null, master, wet, comp, hum = null, enabled = true;
  try { enabled = localStorage.getItem('vigil-mute') !== '1'; } catch (e) { /* storage blocked */ }

  function init() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4;
    master = ctx.createGain(); master.gain.value = enabled ? 0.7 : 0;
    // short generated room tail for a spacious, "control room" sound
    const conv = ctx.createConvolver(), len = Math.floor(ctx.sampleRate * 2.2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    conv.buffer = ir;
    wet = ctx.createGain(); wet.gain.value = 0.28;
    master.connect(comp); master.connect(conv); conv.connect(wet); wet.connect(comp); comp.connect(ctx.destination);
    return ctx;
  }
  const ready = () => !!(ctx && ctx.state === 'running' && enabled);
  const now = () => ctx.currentTime;

  function env(g, t, a, peak, d) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function tone(freq, { type = 'sine', at = 0, a = 0.005, peak = 0.12, d = 0.15, to = null, dest = master } = {}) {
    if (!ready()) return;
    const t = now() + at, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + a + d);
    o.connect(g); g.connect(dest); env(g, t, a, peak, d);
    o.start(t); o.stop(t + a + d + 0.05);
  }
  let noiseBuf = null;
  function noise({ at = 0, a = 0.01, peak = 0.1, d = 0.3, type = 'bandpass', f0 = 800, f1 = 3000, q = 1.2 } = {}) {
    if (!ready()) return;
    if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const x = noiseBuf.getChannelData(0); for (let i = 0; i < x.length; i++) x[i] = Math.random() * 2 - 1; }
    const t = now() + at, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; s.loop = true; f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + a + d);
    s.connect(f); f.connect(g); g.connect(master); env(g, t, a, peak, d);
    s.start(t); s.stop(t + a + d + 0.05);
  }

  const S = window.VIGIL_SOUND = {
    init,
    get locked() { init(); return !ctx || ctx.state !== 'running'; },
    get enabled() { return enabled; },
    unlock() { init(); return ctx ? ctx.resume().then(() => ctx.state === 'running').catch(() => false) : Promise.resolve(false); },
    setEnabled(on) {
      enabled = !!on;
      try { localStorage.setItem('vigil-mute', enabled ? '' : '1'); } catch (e) { /* fine */ }
      if (ctx) master.gain.setTargetAtTime(enabled ? 0.7 : 0, ctx.currentTime, 0.05);
    },

    /* boot */
    drone(dur = 4) {          // rising power-up drone under the boot sequence
      if (!ready()) return;
      const t = now(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = 'lowpass'; f.Q.value = 6; f.frequency.setValueAtTime(140, t); f.frequency.exponentialRampToValueAtTime(1800, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6);
      for (const [fr, det] of [[55, 0], [55, 7], [110, -5]]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.detune.value = det;
        o.frequency.exponentialRampToValueAtTime(fr * 1.5, t + dur); o.connect(f); o.start(t); o.stop(t + dur + 0.7);
      }
      f.connect(g); g.connect(master);
    },
    lock(i = 0) { tone(900 + i * 140, { type: 'square', peak: 0.035, d: 0.06 }); tone(1800 + i * 280, { peak: 0.05, d: 0.18, at: 0.01 }); noise({ peak: 0.04, d: 0.05, type: 'highpass', f0: 4000, f1: 6000 }); },
    tick() { tone(2400 + Math.random() * 400, { peak: 0.03, d: 0.03 }); },
    decode() { tone(600 + Math.random() * 1600, { type: 'square', peak: 0.012, d: 0.025 }); },
    chord() {                 // "online" power chord
      [220, 277.2, 329.6, 440, 659.3].forEach((f, i) => tone(f, { type: i < 2 ? 'triangle' : 'sine', a: 0.08 + i * 0.03, peak: 0.07, d: 1.8 }));
      tone(55, { a: 0.05, peak: 0.18, d: 1.2, to: 41 });
    },
    whoosh(up = true) { noise({ a: 0.25, peak: 0.08, d: 0.55, f0: up ? 300 : 4000, f1: up ? 5000 : 250, q: 0.9 }); },

    /* core */
    humStart() {             // low ambient hum whose filter follows the core's movement
      if (!ready() || hum) return;
      const t = now(), f = ctx.createBiquadFilter(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
      f.type = 'lowpass'; f.frequency.value = 260; f.Q.value = 3;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.045, t + 2.5);
      const oscs = [[55, 'sine'], [110, 'triangle'], [164.8, 'sine']].map(([fr, ty]) => { const o = ctx.createOscillator(); o.type = ty; o.frequency.value = fr; o.connect(f); o.start(t); return o; });
      lfo.frequency.value = 0.18; lg.gain.value = 60; lfo.connect(lg); lg.connect(f.frequency); lfo.start(t);
      f.connect(g); g.connect(master);
      hum = { f, g, oscs, lfo };
    },
    humStop() {
      if (!hum || !ctx) return;
      const h = hum, t = ctx.currentTime; hum = null;
      h.g.gain.setTargetAtTime(0.0001, t, 0.3);
      setTimeout(() => { h.oscs.forEach((o) => o.stop()); h.lfo.stop(); }, 1500);
    },
    motion(speed) {           // speed 0..1: how fast the core is turning (drag/inertia)
      if (!hum) return;
      const t = ctx.currentTime, s = Math.min(1, Math.max(0, speed));
      hum.f.frequency.setTargetAtTime(260 + s * 1600, t, 0.08);
      hum.g.gain.setTargetAtTime(0.045 + s * 0.05, t, 0.1);
    },
    ping() { tone(1320, { peak: 0.04, d: 0.9, to: 1240 }); tone(1980, { peak: 0.015, d: 0.6, at: 0.02 }); },
    hover(size = 0.5) { tone(500 + (1 - size) * 900, { peak: 0.04, d: 0.12, to: 700 + (1 - size) * 1200 }); },
    select() { tone(880, { peak: 0.06, d: 0.1 }); tone(1320, { peak: 0.05, d: 0.2, at: 0.06 }); },
    shock(kev) {              // new advisory lands: low boom + sweep
      tone(kev ? 70 : 90, { a: 0.01, peak: 0.25, d: 0.9, to: 38 });
      noise({ a: 0.02, peak: 0.07, d: 0.8, f0: 3000, f1: 200, q: 0.7 });
    },
    alert(kev) {
      const seq = kev ? [880, 660, 880, 660] : [740, 990];
      seq.forEach((f, i) => tone(f, { type: kev ? 'square' : 'sine', peak: kev ? 0.05 : 0.09, d: 0.13, at: i * 0.17 }));
    },
  };

  // the first click or key anywhere unlocks audio for the rest of the visit
  const unlockOnce = () => { S.unlock(); window.removeEventListener('pointerdown', unlockOnce, true); window.removeEventListener('keydown', unlockOnce, true); };
  window.addEventListener('pointerdown', unlockOnce, true);
  window.addEventListener('keydown', unlockOnce, true);
  init();
})();
