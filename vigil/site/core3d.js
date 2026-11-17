/* VIGIL threat core: a WebGL hologram on the Overview.
   Vendors orbit a holographic sphere; beams run to every exposed client; the hero threat's device floats inside.
   ≤30 fps, paused when hidden or off-screen, one still frame in Lite mode. Falls back to the 2D view without WebGL. */
import * as THREE from './vendor/three.module.min.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COL = { teal: new THREE.Color(0x2de2c8), amber: new THREE.Color(0xffb547), red: new THREE.Color(0xff3d5e), blue: new THREE.Color(0x5aa9ff), white: new THREE.Color(0xe8fbff) };
const SEV = { critical: 4, high: 3, medium: 2, low: 1 };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const snd = () => window.VIGIL_SOUND;
const ADD = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

const canvas = $('#core3d'), stageEl = $('#core');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (e) { renderer = null; }

if (renderer) start();

function start() {
  // move the hero text onto the stage and switch the Overview to 3D
  stageEl.hidden = false;
  stageEl.insertBefore($('#hero'), $('#core-labels'));
  document.body.classList.add('has3d');

  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 2, 0.1, 100);
  camera.position.set(0, 0.55, 7.4);
  camera.lookAt(0, 0, 0);

  /* ---------- textures ---------- */
  function radial(stops, size = 128) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(([o, a]) => gr.addColorStop(o, `rgba(255,255,255,${a})`));
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  const texGlow = radial([[0, 1], [0.18, 0.85], [0.42, 0.25], [1, 0]]);
  const texSoft = radial([[0, 0.55], [0.5, 0.12], [1, 0]]);
  const texRing = (() => {
    const s = 256, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d');
    g.strokeStyle = '#fff'; g.lineWidth = 6; g.shadowColor = '#fff'; g.shadowBlur = 18;
    g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 20, 0, Math.PI * 2); g.stroke();
    return new THREE.CanvasTexture(c);
  })();

  /* ---------- stage ---------- */
  const stage = new THREE.Group(); scene.add(stage);           // shifted right so the hero text has room
  const world = new THREE.Group(); stage.add(world);           // rotates (drag + spin)
  world.rotation.x = 0.18;

  // holographic sphere: wire mesh + fresnel rim + outer atmosphere
  const R = 1.35;
  const wireMat = new THREE.LineBasicMaterial({ color: COL.teal, opacity: 0.13, ...ADD });
  world.add(new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(R, 3)), wireMat));
  const fresnel = (power, strength, side) => new THREE.ShaderMaterial({
    uniforms: { uColor: { value: COL.teal.clone() }, uPower: { value: power }, uStrength: { value: strength }, uBoost: { value: 0 } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }',
    fragmentShader: 'uniform vec3 uColor; uniform float uPower; uniform float uStrength; uniform float uBoost; varying vec3 vN; varying vec3 vV; void main(){ float f=pow(1.0-abs(dot(vN,vV)),uPower)*(uStrength+uBoost); gl_FragColor=vec4(uColor*f,f); }',
    side, ...ADD,
  });
  const rimMat = fresnel(2.6, 1.1, THREE.FrontSide), atmoMat = fresnel(4.0, 0.9, THREE.BackSide);
  world.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.01, 64, 48), rimMat));
  stage.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.22, 64, 48), atmoMat));
  const coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: texSoft, color: COL.teal, opacity: 0.55, ...ADD }));
  coreGlow.scale.setScalar(2.6); stage.add(coreGlow);

  // equator + meridian bands
  function circle(r, seg = 128) { const pts = []; for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); } return new THREE.BufferGeometry().setFromPoints(pts); }
  const bandMat = new THREE.LineBasicMaterial({ color: COL.teal, opacity: 0.45, ...ADD });
  world.add(new THREE.Line(circle(R * 1.002), bandMat));
  const meridian = new THREE.Line(circle(R * 1.002), bandMat); meridian.rotation.z = Math.PI / 2; world.add(meridian);

  // orbit rings, each tilted and turning at its own speed
  const rings = [];
  function orbit(r, tilt, speed, dashed, ticks) {
    const g = new THREE.Group(); g.rotation.set(tilt[0], tilt[1], tilt[2]);
    const geo = circle(r, 220);
    const mat = dashed ? new THREE.LineDashedMaterial({ color: COL.teal, dashSize: 0.09, gapSize: 0.06, opacity: 0.55, ...ADD }) : new THREE.LineBasicMaterial({ color: COL.teal, opacity: 0.35, ...ADD });
    const line = new THREE.Line(geo, mat); if (dashed) line.computeLineDistances(); g.add(line);
    if (ticks) {
      const tp = []; for (let i = 0; i < ticks; i++) { const a = (i / ticks) * Math.PI * 2; tp.push(Math.cos(a) * r, 0, Math.sin(a) * r); }
      const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
      g.add(new THREE.Points(tg, new THREE.PointsMaterial({ color: COL.teal, size: 0.045, map: texGlow, opacity: 0.9, ...ADD })));
    }
    // one bright "runner" travelling the ring
    const run = new THREE.Sprite(new THREE.SpriteMaterial({ map: texGlow, color: COL.white, opacity: 0.9, ...ADD })); run.scale.setScalar(0.14); g.add(run);
    stage.add(g);
    rings.push({ g, speed, r, run, mat, phase: Math.random() * 6 });
  }
  orbit(1.78, [1.15, 0, 0.35], 0.22, false, 0);
  orbit(2.12, [-0.95, 0.4, 0], -0.16, true, 0);
  orbit(2.55, [Math.PI / 2 - 0.12, 0, 0.08], 0.09, false, 72);

  // scan ring sweeping the sphere top to bottom; pings as it crosses the equator
  const scan = new THREE.Line(circle(1, 160), new THREE.LineBasicMaterial({ color: COL.white, opacity: 0.6, ...ADD }));
  world.add(scan);
  let scanPrev = 0;

  // hex platform + light column under the sphere
  const floor = new THREE.Group(); floor.position.y = -2.15; stage.add(floor);
  (() => {
    const pos = [], col = [], s = 0.26, h = Math.sqrt(3) * s;
    for (let q = -9; q <= 9; q++) for (let r = -9; r <= 9; r++) {
      const x = q * 1.5 * s, z = (r + q / 2) * h, d = Math.hypot(x, z); if (d > 2.6) continue;
      const fade = Math.pow(1 - d / 2.6, 1.6);
      for (let i = 0; i < 6; i++) {
        const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2;
        pos.push(x + Math.cos(a0) * s * 0.92, 0, z + Math.sin(a0) * s * 0.92, x + Math.cos(a1) * s * 0.92, 0, z + Math.sin(a1) * s * 0.92);
        col.push(fade * 0.18, fade * 0.88, fade * 0.78, fade * 0.18, fade * 0.88, fade * 0.78);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    floor.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, opacity: 0.8, ...ADD })));
  })();
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 5.4), new THREE.MeshBasicMaterial({ map: texSoft, color: COL.teal, opacity: 0.55, ...ADD }));
  pool.rotation.x = -Math.PI / 2; floor.add(pool);
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: COL.teal.clone() }, uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 uColor; uniform float uTime; varying vec2 vUv; void main(){ float a=pow(1.0-vUv.y,2.2)*0.32; a*=0.75+0.25*sin(vUv.y*40.0-uTime*3.0); gl_FragColor=vec4(uColor*a,a); }',
    side: THREE.DoubleSide, ...ADD,
  });
  const column = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.5, 1.9, 64, 1, true), beamMat);
  column.position.y = 0.95; floor.add(column);

  // drifting dust
  const dust = (() => {
    const n = 420, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { p[i * 3] = (Math.random() - 0.5) * 16; p[i * 3 + 1] = (Math.random() - 0.5) * 8; p[i * 3 + 2] = (Math.random() - 0.5) * 8 - 1; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: COL.teal, size: 0.03, map: texGlow, opacity: 0.5, ...ADD }));
    scene.add(pts); return pts;
  })();

  /* ---------- data-driven parts ---------- */
  const dataGroup = new THREE.Group(); world.add(dataGroup);
  let nodes = [], beams = null, particles = null, beamList = [], device = null, deviceGlow = null, heroKey = null;
  const labelsEl = $('#core-labels'), tip = $('#tip3d');

  function fib(i, n, r) {
    const y = 1 - ((i + 0.5) / n) * 2, rad = Math.sqrt(1 - y * y), th = i * Math.PI * (3 - Math.sqrt(5));
    return new THREE.Vector3(Math.cos(th) * rad * r, y * r, Math.sin(th) * rad * r);
  }
  const sevColor = (w) => (w === 'kev' || w === 'critical' ? COL.red : w === 'high' ? COL.amber : COL.teal);
  function clearGroup(g) { while (g.children.length) { const c = g.children.pop(); c.geometry && c.geometry.dispose(); c.material && c.material.dispose(); } }

  function build(S) {
    const A = window.VIGIL_APP; if (!A) return;
    clearGroup(dataGroup); labelsEl.innerHTML = ''; nodes = []; beamList = [];
    // vendors (from inventory; without inventory, from advisories so the grid is never empty)
    const per = new Map();
    for (const d of S.devices) { if (!per.has(d.vendor)) per.set(d.vendor, { n: 0 }); per.get(d.vendor).n++; }
    if (!per.size) for (const a of S.advisories) if (a.vendor) { if (!per.has(a.vendor)) per.set(a.vendor, { n: 0 }); per.get(a.vendor).n++; }
    const keys = [...per.keys()].sort((a, b) => per.get(b).n - per.get(a).n);
    const maxN = Math.max(1, ...keys.map((k) => per.get(k).n));
    const open = S.advisories.filter((a) => !S.reviewed.has(a.id) && A.relevant(a));
    keys.forEach((k, i) => {
      const mine = open.filter((a) => a.vendor === k);
      const worst = mine.some((a) => a.kev) ? 'kev' : mine.reduce((w, a) => ((SEV[a.severity] || 0) > (SEV[w] || 0) ? a.severity : w), '');
      const c = sevColor(worst), pos = fib(i, Math.max(keys.length, 6), 2.05), size = 0.22 + 0.42 * Math.sqrt(per.get(k).n / maxN);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: texGlow, color: c, opacity: 0.85, ...ADD }));
      halo.position.copy(pos); halo.scale.setScalar(size); halo.userData.k = k; dataGroup.add(halo);
      const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: texGlow, color: COL.white, opacity: 0.95, ...ADD }));
      dot.position.copy(pos); dot.scale.setScalar(size * 0.28); dataGroup.add(dot);
      // a thin spoke tying the node to the sphere
      const sp = new THREE.BufferGeometry().setFromPoints([pos.clone().setLength(R), pos]);
      dataGroup.add(new THREE.Line(sp, new THREE.LineBasicMaterial({ color: c, opacity: 0.35, ...ADD })));
      const label = i < 12 ? Object.assign(document.createElement('span'), { textContent: A.label(k).split(' / ')[0].toUpperCase() }) : null;
      if (label) labelsEl.appendChild(label);
      nodes.push({ k, pos, halo, dot, size, base: size, color: c, n: per.get(k).n, open: mine.length, kev: mine.filter((a) => a.kev).length, label });
    });
    // clients on the sphere surface, beams from each exposed client to its vendor
    const clients = [...new Set(S.devices.map((d) => d.client))].sort();
    const cpos = new Map(clients.map((c, i) => [c, fib(i, Math.max(clients.length, 8), R)]));
    if (clients.length) {
      const cp = new Float32Array(clients.length * 3); clients.forEach((c, i) => cpos.get(c).toArray(cp, i * 3));
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(cp, 3));
      dataGroup.add(new THREE.Points(g, new THREE.PointsMaterial({ color: COL.white, size: 0.06, map: texGlow, opacity: 0.7, ...ADD })));
    }
    const pairs = new Map();
    for (const a of open) for (const d of A.m(a).devices) {
      const key = a.vendor + '|' + d.client, rank = a.kev ? 5 : SEV[a.severity] || 0;
      if (!pairs.has(key) || pairs.get(key).rank < rank) pairs.set(key, { v: a.vendor, c: d.client, rank });
    }
    const list = [...pairs.values()].sort((x, y) => y.rank - x.rank).slice(0, 180);
    if (list.length) {
      const lp = [], lc = [];
      for (const p of list) {
        const n = nodes.find((x) => x.k === p.v), cp = cpos.get(p.c); if (!n || !cp) continue;
        const mid = n.pos.clone().add(cp).multiplyScalar(0.5); mid.setLength(Math.max(mid.length(), R) + 0.55);
        const curve = new THREE.QuadraticBezierCurve3(cp, mid, n.pos), pts = curve.getPoints(28);
        const c = p.rank >= 4 ? COL.red : p.rank === 3 ? COL.amber : COL.teal;
        for (let i = 0; i < pts.length - 1; i++) { lp.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z); lc.push(c.r, c.g, c.b, c.r, c.g, c.b); }
        beamList.push({ curve, c, speed: 0.12 + Math.random() * 0.12, off: Math.random() });
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
      beams = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, opacity: 0.32, ...ADD })); dataGroup.add(beams);
      const pp = new Float32Array(beamList.length * 2 * 3), pc = new Float32Array(beamList.length * 2 * 3);
      beamList.forEach((b, i) => { for (const j of [0, 1]) b.c.toArray(pc, (i * 2 + j) * 3); });
      const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pp, 3)); pg.setAttribute('color', new THREE.BufferAttribute(pc, 3));
      particles = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.09, map: texGlow, vertexColors: true, opacity: 1, ...ADD })); dataGroup.add(particles);
    } else { beams = null; particles = null; }
    // the hero threat's device floats inside the sphere
    const hero = window.VIGIL_FX && window.VIGIL_FX.hero ? window.VIGIL_FX.hero() : null;
    heroKey = hero && hero.adv ? hero.adv.vendor : null;
    buildDevice(hero ? hero.shape : 'firewall', hero && hero.adv ? sevColor(hero.adv.kev ? 'kev' : hero.adv.severity) : COL.teal);
    // globe tint: red while anything exploited is open
    const tint = open.some((a) => a.kev) ? COL.red : COL.teal;
    [rimMat, atmoMat].forEach((m) => m.uniforms.uColor.value.copy(tint)); beamMat.uniforms.uColor.value.copy(tint);
    wireMat.color.copy(tint); bandMat.color.copy(tint); coreGlow.material.color.copy(tint); pool.material.color.copy(tint);
    rings.forEach((r) => r.mat.color.copy(tint));
  }

  function buildDevice(shape, color) {
    if (device) { clearGroup(device); stage.remove(device); }
    device = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({ color, opacity: 0.95, ...ADD });
    const edges = (geo, x = 0, y = 0, z = 0) => { const l = new THREE.LineSegments(new THREE.EdgesGeometry(geo), mat); l.position.set(x, y, z); device.add(l); };
    if (shape === 'server') {
      edges(new THREE.BoxGeometry(0.62, 1.25, 0.8));
      for (let i = 0; i < 5; i++) edges(new THREE.BoxGeometry(0.5, 0.02, 0.01), 0, -0.45 + i * 0.22, 0.41);
    } else if (shape === 'ap') {
      edges(new THREE.CylinderGeometry(0.55, 0.62, 0.16, 28));
      edges(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 6), -0.3, 0.35, 0); edges(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 6), 0.3, 0.35, 0);
    } else {
      const w = shape === 'switch' ? 1.5 : 1.25, h = shape === 'switch' ? 0.2 : 0.32, ports = shape === 'switch' ? 12 : 6;
      edges(new THREE.BoxGeometry(w, h, 0.72));
      for (let i = 0; i < ports; i++) edges(new THREE.BoxGeometry(0.07, 0.07, 0.01), -w / 2 + 0.16 + i * ((w - 0.32) / (ports - 1)), 0, 0.37);
    }
    deviceGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: texSoft, color, opacity: 0.6, ...ADD })); deviceGlow.scale.setScalar(1.8); device.add(deviceGlow);
    device.scale.setScalar(0.62); stage.add(device);
  }

  /* ---------- shockwaves ---------- */
  const waves = [];
  let lastBoom = 0;
  function shock(k, kev) {
    const n = nodes.find((x) => x.k === k);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texRing, color: kev ? COL.red : COL.amber, opacity: 1, ...ADD }));
    if (n) s.position.copy(n.pos);
    (n ? dataGroup : stage).add(s);
    waves.push({ s, t: clock, max: n ? 1.4 : 3.6 });
    rimMat.uniforms.uBoost.value = 1.6;
    const ms = performance.now();
    if (snd() && ms - lastBoom > 500) { lastBoom = ms; snd().shock(kev); }      // a burst of alerts = one boom
  }

  /* ---------- interaction ---------- */
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let drag = null, vel = { x: 0, y: 0 }, hover = null;
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(nodes.map((n) => n.halo))[0];
    return [hit ? nodes.find((n) => n.halo === hit.object) : null, e.clientX - r.left, e.clientY - r.top];
  }
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: 0 }; canvas.classList.add('drag'); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
      vel.y += dx * 0.0022; vel.x += dy * 0.0016; wake(); return;
    }
    const [n, x, y] = pick(e);
    if (n !== hover) { hover = n; if (n && snd()) snd().hover(n.base / 0.64); }
    canvas.style.cursor = n ? 'pointer' : '';
    if (n) {
      const A = window.VIGIL_APP;
      tip.innerHTML = `<b>${esc(A.label(n.k))}</b><br>${n.n} devices · ${n.open} open${n.kev ? ` · <span style="color:#ff3d5e">${n.kev} exploited</span>` : ''}`;
      tip.style.left = Math.min(x + 18, stageEl.clientWidth - 190) + 'px'; tip.style.top = (y + 18) + 'px'; tip.style.opacity = 1;
    } else tip.style.opacity = 0;
    wake();
  });
  const endDrag = (e) => {
    if (!drag) return;
    const click = drag.moved < 5; drag = null; canvas.classList.remove('drag');
    if (click) { const [n] = pick(e); if (n && window.VIGIL_APP) { if (snd()) snd().select(); window.VIGIL_APP.filterVendor(n.k); } }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { hover = null; tip.style.opacity = 0; });

  /* ---------- layout ---------- */
  let W = 1, H = 1;
  function resize() {
    W = stageEl.clientWidth || 1; H = stageEl.clientHeight || 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(W, H, false);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    const halfW = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z * camera.aspect;
    stage.position.x = W > 980 ? Math.min(halfW * 0.42, 2.4) : 0;
    stage.scale.setScalar(W > 980 ? 1 : W > 640 ? 0.85 : 0.7);
    wake();
  }
  new ResizeObserver(resize).observe(stageEl);

  /* ---------- loop ---------- */
  let clock = 0, lastT = 0, raf = 0, intro = reduced ? 1 : 0, introOn = false, view = 'overview', S = null, visible = true;
  const lite = () => reduced || (S && S.settings.lite);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; wake(); }).observe(stageEl);
  const easeOut = (x) => 1 - Math.pow(1 - x, 3), back = (x) => { const c = 1.6; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  const tmp = new THREE.Vector3(), center = new THREE.Vector3();

  function step(dt) {
    clock += dt;
    if (introOn && intro < 1) intro = Math.min(1, intro + dt / 2.4);
    const p = intro, pb = back(Math.min(1, p * 1.1));
    world.scale.setScalar(Math.max(0.001, pb));
    rings.forEach((r, i) => {
      const q = Math.max(0, Math.min(1, (p - 0.15 * i) / 0.6));
      r.g.scale.setScalar(Math.max(0.001, easeOut(q) * (1 + (1 - q) * 0.6)));
      r.g.rotation.y += r.speed * dt;
      const a = clock * (0.6 + i * 0.25) + r.phase; r.run.position.set(Math.cos(a) * r.r, 0, Math.sin(a) * r.r);
    });
    floor.scale.setScalar(Math.max(0.001, easeOut(p)));
    // spin + drag inertia
    world.rotation.y += 0.08 * dt + vel.y; world.rotation.x = Math.max(-0.6, Math.min(0.8, world.rotation.x + vel.x));
    vel.x *= 0.9; vel.y *= 0.92;
    // scan ring
    const sy = Math.sin(clock * 0.55) * R * 0.96, sr = Math.sqrt(Math.max(0.0001, R * R - sy * sy)) * 1.01;
    scan.position.y = sy; scan.scale.set(sr, 1, sr); scan.material.opacity = 0.25 + 0.4 * (1 - Math.abs(sy) / R);
    scanPrev = sy;
    // nodes breathe; the hero vendor pulses
    for (const n of nodes) {
      const pulse = n.k === heroKey ? 1 + 0.35 * (0.5 + 0.5 * Math.sin(clock * 4)) : 1 + 0.06 * Math.sin(clock * 1.3 + n.pos.x * 3);
      n.halo.scale.setScalar(n.base * pulse * (n === hover ? 1.35 : 1));
    }
    // particles along beams
    if (particles) {
      const arr = particles.geometry.attributes.position.array;
      beamList.forEach((b, i) => { for (const j of [0, 1]) { const t = (clock * b.speed + b.off + j * 0.5) % 1; b.curve.getPoint(t, tmp); tmp.toArray(arr, (i * 2 + j) * 3); } });
      particles.geometry.attributes.position.needsUpdate = true;
    }
    if (beams) beams.material.opacity = 0.32 * p;
    // device inside the sphere
    if (device) { device.rotation.y += 0.45 * dt; device.position.y = Math.sin(clock * 0.9) * 0.06; device.scale.setScalar(0.62 * easeOut(Math.max(0, (p - 0.35) / 0.65)) + 0.001); }
    // shockwaves
    for (let i = waves.length - 1; i >= 0; i--) {
      const w = waves[i], k = (clock - w.t) / 1.6;
      if (k >= 1) { w.s.parent.remove(w.s); w.s.material.dispose(); waves.splice(i, 1); continue; }
      w.s.scale.setScalar(0.2 + k * w.max); w.s.material.opacity = 1 - k;
    }
    rimMat.uniforms.uBoost.value *= Math.pow(0.25, dt);
    beamMat.uniforms.uTime.value = clock;
    dust.rotation.y += dt * 0.01;
    coreGlow.material.opacity = 0.45 + 0.1 * Math.sin(clock * 0.8);
  }

  function placeLabels() {
    stage.updateMatrixWorld(true);
    world.getWorldPosition(center); const cz = center.clone().project(camera).z;
    for (const n of nodes) {
      if (!n.label) continue;
      n.halo.getWorldPosition(tmp); const v = tmp.clone().project(camera);
      const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H - n.base * 46;
      n.label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      n.label.style.opacity = intro < 0.9 ? 0 : v.z > cz ? 0.25 : 1;
    }
  }

  function frame(t) {
    raf = 0;
    const active = view === 'overview' && visible && !document.hidden;
    if (!active) { if (snd()) snd().humStop(); return; }
    if (lite()) { intro = 1; step(0); renderer.render(scene, camera); placeLabels(); if (snd()) snd().humStop(); return; }
    raf = requestAnimationFrame(frame);
    if (t - lastT < 33) return;                       // ≤ 30 fps
    const dt = Math.min(0.1, (t - lastT) / 1000 || 0.033); lastT = t;
    step(dt); renderer.render(scene, camera); placeLabels();
  }
  function wake() { if (!raf) raf = requestAnimationFrame(frame); }
  document.addEventListener('visibilitychange', wake);

  function beginIntro() {
    if (introOn) return; introOn = true;
    if (snd() && !lite()) snd().whoosh(true);
    wake();
  }
  window.addEventListener('vigil:booted', beginIntro);

  window.VIGIL_CORE3D = {
    update(state, info) {
      S = state; build(S); resize();
      if (!window.VIGIL_BOOTING) beginIntro();
      wake();
    },
    flare(k, kev) { shock(k, kev); wake(); },
    view(v) { view = v; if (v !== 'overview' && snd()) snd().humStop(); wake(); },
    get state() { return { nodes: nodes.length, beams: beamList.length, intro, running: !!raf, device: !!device }; },
  };
  // data may have arrived before this module loaded
  if (window.VIGIL_STATE && window.VIGIL_STATE.generated && window.VIGIL_FX) window.VIGIL_FX.update(window.VIGIL_STATE, {});
}
