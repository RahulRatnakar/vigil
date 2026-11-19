/* <command-wheel>: a radial menu that opens around any element.
   Set .items = [{id, label, icon (svg string)}]. toggle(anchor) / open(anchor) / close().
   Fires a "command" event with detail {id}. Keyboard: arrows move round the wheel, Enter/Space runs, Esc closes.
   Colours: --wheel-accent, --wheel-bg, --wheel-ink, --wheel-line. A shortcut only: never replaces navigation. */
(function () {
  'use strict';
  if (customElements.get('command-wheel')) return;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  class CommandWheel extends HTMLElement {
    constructor() {
      super();
      this._items = [];
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>
        :host{position:fixed;inset:0;z-index:90;display:none}
        :host([open]){display:block}
        .scrim{position:absolute;inset:0;background:rgba(0,0,0,.35)}
        .wheel{position:absolute;width:var(--size);height:var(--size);margin:calc(var(--size) / -2) 0 0 calc(var(--size) / -2);
          transform:scale(.6);opacity:0;transition:transform .22s cubic-bezier(.2,.9,.3,1.2),opacity .18s}
        :host([open][shown]) .wheel{transform:scale(1);opacity:1}
        .ring{position:absolute;inset:14%;border-radius:50%;border:1px solid var(--wheel-line,rgba(120,220,230,.3));
          background:radial-gradient(circle,var(--wheel-bg,rgba(8,18,26,.92)) 55%,transparent 72%);box-shadow:0 0 40px rgba(0,0,0,.5)}
        button{all:unset;box-sizing:border-box;position:absolute;width:76px;height:76px;margin:-38px 0 0 -38px;border-radius:50%;
          display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer;
          color:var(--wheel-ink,#d9e7ee);background:var(--wheel-bg,rgba(8,18,26,.92));border:1px solid var(--wheel-line,rgba(120,220,230,.3));
          font:600 10px/1.1 Rajdhani,'Segoe UI',system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;text-align:center;
          transition:border-color .12s,color .12s,box-shadow .12s,transform .12s}
        button svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
        button:hover,button:focus-visible{color:var(--wheel-accent,#2de2c8);border-color:var(--wheel-accent,#2de2c8);
          box-shadow:0 0 18px color-mix(in srgb,var(--wheel-accent,#2de2c8) 45%,transparent);transform:scale(1.08);outline:none}
        .close{width:44px;height:44px;margin:-22px 0 0 -22px;left:50%;top:50%;font-size:20px}
        @media (prefers-reduced-motion:reduce){.wheel,button{transition:none}}
      </style><div class="scrim" part="scrim"></div><div class="wheel" role="menu" aria-label="Commands"><div class="ring"></div></div>`;
      this.wheel = root.querySelector('.wheel');
      root.querySelector('.scrim').addEventListener('click', () => this.close());
      this.addEventListener('keydown', (e) => this.key(e));
    }
    get items() { return this._items; }
    set items(v) { this._items = Array.isArray(v) ? v : []; this.render(); }
    get isOpen() { return this.hasAttribute('open'); }

    render() {
      this.wheel.querySelectorAll('button').forEach((b) => b.remove());
      this._items.forEach((it) => {
        const b = document.createElement('button');
        b.setAttribute('role', 'menuitem'); b.dataset.id = it.id; b.setAttribute('aria-label', it.label);
        b.innerHTML = `${it.icon || ''}<span>${String(it.label).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</span>`;
        b.addEventListener('click', () => this.run(it.id));
        this.wheel.appendChild(b);
      });
      const c = document.createElement('button');
      c.className = 'close'; c.setAttribute('aria-label', 'Close commands'); c.textContent = '×';
      c.addEventListener('click', () => this.close());
      this.wheel.appendChild(c);
    }
    layout() {
      const n = this._items.length || 1, small = Math.min(innerWidth, innerHeight) < 520;
      const size = small ? 250 : 290, r = size / 2 - 42;
      this.style.setProperty('--size', size + 'px');
      this.wheel.querySelectorAll('button[role=menuitem]').forEach((b, i) => {
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
        b.style.left = (size / 2 + Math.cos(a) * r) + 'px'; b.style.top = (size / 2 + Math.sin(a) * r) + 'px';
      });
      // centre on the anchor, kept fully on screen
      const ar = this.anchor ? this.anchor.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
      const half = size / 2 + 8;
      const x = Math.min(innerWidth - half, Math.max(half, ar.left + ar.width / 2));
      const y = Math.min(innerHeight - half, Math.max(half, ar.top + ar.height / 2));
      this.wheel.style.left = x + 'px'; this.wheel.style.top = y + 'px';
    }
    open(anchor) {
      this.anchor = anchor || null;
      if (!this.wheel.querySelector('button')) this.render();
      this.setAttribute('open', '');
      this.layout();
      anchor && anchor.setAttribute('aria-expanded', 'true');
      requestAnimationFrame(() => { this.setAttribute('shown', ''); const f = this.wheel.querySelector('button[role=menuitem]'); f && f.focus(); });
      this._onResize = () => this.layout(); addEventListener('resize', this._onResize);
    }
    close() {
      if (!this.isOpen) return;
      this.removeAttribute('shown');
      const done = () => { this.removeAttribute('open'); };
      reduced() ? done() : setTimeout(done, 160);
      removeEventListener('resize', this._onResize);
      if (this.anchor) { this.anchor.setAttribute('aria-expanded', 'false'); this.anchor.focus(); }
    }
    toggle(anchor) { this.isOpen ? this.close() : this.open(anchor); }
    run(id) { this.close(); this.dispatchEvent(new CustomEvent('command', { detail: { id }, bubbles: true })); }
    key(e) {
      if (!this.isOpen) return;
      if (e.key === 'Escape') { e.preventDefault(); this.close(); return; }
      const btns = [...this.wheel.querySelectorAll('button[role=menuitem]')];
      const i = btns.indexOf(this.shadowRoot.activeElement);
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (step && btns.length) { e.preventDefault(); btns[(Math.max(0, i) + step + btns.length) % btns.length].focus(); }
      if (e.key === 'Tab') {           // keep focus inside the wheel while open
        e.preventDefault(); btns[(Math.max(0, i) + (e.shiftKey ? -1 : 1) + btns.length) % btns.length].focus();
      }
    }
  }
  customElements.define('command-wheel', CommandWheel);
})();
