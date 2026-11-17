(()=>{
// Copies the layout of open ConnectWise pop-up windows and dropdown lists (labels, buttons, checkboxes, inputs),
// so the dashboard can be taught to drive them. Typed text and field values are never copied.
// CW (GWT) adds pop-ups as floating layers straight under <body>, so only those are captured, not the board.
const docs = () => { const a = [document]; const walk = d => d.querySelectorAll('iframe').forEach(f => { try { const c = f.contentDocument; if (c) { a.push(c); walk(c); } } catch (e) {} }); walk(document); return a; };
const vis = e => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
const attrs = ['id', 'type', 'role', 'name', 'placeholder', 'title', 'aria-label'];
const MAX = 260; let lines = 0;
const own = e => e.tagName === 'TEXTAREA' || e.isContentEditable ? '' : [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').trim().slice(0, 50);
const ser = (e, depth, out) => {
  if (lines >= MAX || !vis(e)) return;
  const tag = e.tagName.toLowerCase();
  if (tag === 'svg') { out.push(`${'  '.repeat(depth)}<svg>`); lines++; return; }
  const cls = typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
  const at = attrs.filter(a => e.getAttribute(a)).map(a => `${a}="${e.getAttribute(a).slice(0, 40)}"`).join(' ');
  const st = tag === 'input' && /checkbox|radio/.test(e.type) ? ` checked=${e.checked}` : '';
  const ed = e.getAttribute('contenteditable') ? ' [editable]' : '', tx = own(e), kids = e.isContentEditable ? [] : [...e.children].filter(vis);
  // fold plain wrappers (no text, no attributes, one child) to keep it short
  if (!tx && !cls && !at && !st && !ed && kids.length === 1 && !/^(input|button|select|textarea|label|a|img)$/.test(tag)) return ser(kids[0], depth, out);
  out.push(`${'  '.repeat(depth)}<${tag}${cls}${at ? ' ' + at : ''}${st}${ed}>${tx ? ' "' + tx + '"' : ''}`); lines++;
  kids.forEach(c => ser(c, depth + 1, out));
};
const out = [`CW Capture v3 · ${location.pathname} · ${new Date().toISOString()}`]; let n = 0;
for (const d of docs()) {
  const win = d.defaultView;
  [...d.body.children].filter(e => vis(e) && /absolute|fixed/.test(win.getComputedStyle(e).position) && e.getBoundingClientRect().width < win.innerWidth * .9 && e.textContent.trim())
    .forEach(e => {
      // heading = first label text found, never the contents of a note box
      const first = [e, ...e.querySelectorAll('*')].filter(x => !x.closest('textarea,[contenteditable]')).map(own).find(Boolean) || '';
      n++; out.push('', `=== floating layer ${n}: "${first}" ===`); ser(e, 0, out); });
}
// first few board rows, tick column and ticket number only (tick the first row before capturing to show a ticked one)
const rowsSeen = new Set();
for (const d of docs()) [...d.querySelectorAll('*')].filter(e => e.children.length === 0 && /^\d{7,9}$/.test(e.textContent.trim()) && vis(e)).forEach(el => {
  const tr = el.closest('tr'); if (!tr || rowsSeen.has(tr) || rowsSeen.size >= 3) return; rowsSeen.add(tr);
  out.push('', `=== board row ${rowsSeen.size} ===`);
  const trc = typeof tr.className === 'string' ? tr.className : '', at = attrs.concat(['aria-selected', 'aria-checked']).filter(a => tr.getAttribute(a)).map(a => `${a}="${tr.getAttribute(a)}"`).join(' ');
  out.push(`<tr${trc ? '.' + trc.trim().split(/\s+/).join('.') : ''}${at ? ' ' + at : ''}> bg=${d.defaultView.getComputedStyle(tr).backgroundColor} cells=${tr.children.length}`); lines++;
  [...tr.children].slice(0, 2).forEach(td => ser(td, 1, out));
});
if (!n && !rowsSeen.size) out.push('Nothing found. Open the ConnectWise window (Ticket Notes, Update Status, Bundle) first, then click CW Capture.');
if (lines >= MAX) out.push('… cut at ' + MAX + ' lines');
const txt = out.join('\n');
const done = () => alert(`CW Capture copied ${lines} lines from ${n} pop-up(s).\nPaste it into the chat with Claude.`);
(navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(done, () => prompt('Copy all of this and paste it to Claude:', txt));
})();
