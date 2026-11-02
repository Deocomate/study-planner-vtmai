// Small UI toolkit: safe DOM building (never innerHTML), API calls with a visible saving indicator, dialogs, toasts, formatting.
export const state = { user: null, csrf: null, children: [], config: {}, today: null };

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'required' || k === 'multiple' || k === 'draggable') el[k] = !!v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => { if (c === null || c === undefined || c === false) return; if (Array.isArray(c)) c.forEach(add); else el.append(c instanceof Node ? c : document.createTextNode(String(c))); };
  kids.forEach(add);
  return el;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const mount = (el, ...kids) => { clear(el); kids.flat(Infinity).forEach((k) => { if (k !== null && k !== undefined && k !== false) el.append(k); }); return el; };

// ---------- saving indicator ----------
let pending = 0, savedTimer = null;
function setIndicator(kind, text) {
  const el = document.getElementById('save-indicator'); if (!el) return;
  el.dataset.kind = kind; el.textContent = text;
}
export async function api(method, url, body, opts = {}) {
  const isWrite = method !== 'GET';
  if (isWrite) { pending++; clearTimeout(savedTimer); setIndicator('saving', 'Saving…'); }
  try {
    const headers = {};
    if (state.csrf) headers['X-CSRF-Token'] = state.csrf;
    let payload;
    if (opts.raw) { payload = opts.raw; headers['Content-Type'] = 'application/octet-stream'; }
    else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    const res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
    let data = null; try { data = await res.json(); } catch {}
    if (!res.ok) {
      if (res.status === 401 && !opts.quiet401) { state.user = null; location.hash = '#/login'; }
      const err = new Error((data && data.error) || `Something went wrong (${res.status}).`); err.status = res.status; err.data = data || {};
      throw err;
    }
    if (isWrite) { pending--; if (!pending) { setIndicator('saved', 'Saved ✓'); savedTimer = setTimeout(() => setIndicator('idle', ''), 2500); } }
    return data;
  } catch (e) {
    if (isWrite) { pending = Math.max(0, pending - 1); if (!pending) { if (e.status === 409 && e.data && e.data.needs_ack) setIndicator('idle', ''); else setIndicator('error', 'Not saved'); } }
    throw e;
  }
}
export const get = (u) => api('GET', u);
export const post = (u, b) => api('POST', u, b ?? {});
export const put = (u, b) => api('PUT', u, b ?? {});
export const patch = (u, b) => api('PATCH', u, b ?? {});
export const del = (u) => api('DELETE', u);

// ---------- toasts and errors ----------
export function toast(message, kind = 'ok') {
  const box = document.getElementById('toasts');
  const t = h('div', { class: `toast ${kind}` }, message);
  box.append(t); setTimeout(() => t.remove(), kind === 'error' ? 8000 : 3500);
}
export const fail = (e) => toast(e && e.message ? e.message : 'Something went wrong.', 'error');
// Wrap a click handler: disables the button while working (prevents double clicks) and reports errors.
export function action(fn) {
  return async (ev) => {
    const btn = ev.currentTarget; if (btn.disabled) return;
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try { await fn(ev); } catch (e) { fail(e); } finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
  };
}

// ---------- dialogs ----------
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const previous = document.activeElement;
  const overlay = h('div', { class: 'overlay', role: 'presentation' });
  const close = () => { overlay.remove(); document.body.classList.remove('modal-open'); if (previous && previous.focus) previous.focus(); if (onClose) onClose(); };
  const titleId = `dlg-${Math.random().toString(36).slice(2)}`;
  const dlg = h('div', { class: `dialog ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('div', { class: 'dialog-head' }, h('h2', { id: titleId }, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, '✕')),
    h('div', { class: 'dialog-body' }, body),
    actions.length ? h('div', { class: 'dialog-actions' }, actions.map((a) => h('button', { type: 'button', class: `btn ${a.primary ? 'primary' : a.danger ? 'danger' : ''}`, onclick: action(async (ev) => { const r = await a.onclick(ev, close); if (r !== false && !a.keepOpen) close(); }) }, a.label))) : null);
  overlay.append(dlg);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Tab') {   // keep keyboard focus inside the dialog
      const f = [...dlg.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return; const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  document.body.append(overlay); document.body.classList.add('modal-open');
  const first = dlg.querySelector('input, select, textarea') || dlg.querySelector('.dialog-actions .btn.primary') || dlg.querySelector('button');
  if (first) first.focus();
  return { close, dlg };
}
export function confirmDialog({ title, message, confirm = 'Yes', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    modal({ title, body: h('p', null, message), onClose: () => { if (!answered) resolve(false); },
      actions: [{ label: 'Cancel', onclick: () => { answered = true; resolve(false); } }, { label: confirm, primary: !danger, danger, onclick: () => { answered = true; resolve(true); } }] });
  });
}

// ---------- formatting ----------
export const DOW = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const isoDate = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => isoDate(new Date(parseDate(s).getTime() + n * 86400000));
export const weekdayOf = (s) => { const w = parseDate(s).getUTCDay(); return w === 0 ? 7 : w; };
export const weekStartOf = (s) => addDays(s, 1 - weekdayOf(s));
export const fmtDay = (s) => { const d = parseDate(s); return `${DOW[weekdayOf(s)]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
export const fmtDayShort = (s) => { const d = parseDate(s); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
export const fmtDT = (dt) => (dt ? `${fmtDay(dt.slice(0, 10))} ${dt.slice(11, 16)}` : '');
export const monthLabel = (m) => { const [y, mo] = m.split('-').map(Number); return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][mo - 1]} ${y}`; };
export const mins = (m) => { m = Math.round(m); if (m < 60) return `${m} min`; const h2 = Math.floor(m / 60), r = m % 60; return r ? `${h2} h ${r} min` : `${h2} h`; };
export const pct = (v) => (v === null || v === undefined ? '–' : `${v}%`);
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

export const STATUS = { not_started: ['Not started', 'st-none'], in_progress: ['In progress', 'st-prog'], done: ['Done', 'st-done'], needs_help: ['Needs help', 'st-help'] };
export const REVIEW = { not_required: ['No review needed', 'rv-none'], not_submitted: ['Review: not submitted', 'rv-none'], awaiting_review: ['Awaiting review', 'rv-wait'], changes_requested: ['Changes requested', 'rv-change'], approved: ['Approved', 'rv-ok'] };
export const statusBadge = (s) => h('span', { class: `badge ${STATUS[s][1]}` }, STATUS[s][0]);
export const reviewBadge = (s) => (s === 'not_required' ? null : h('span', { class: `badge ${REVIEW[s][1]}` }, REVIEW[s][0]));
export const bar = (value, label, cls = '') => h('div', { class: `bar ${cls}`, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': value ?? 0, 'aria-label': label },
  h('div', { class: 'bar-fill', style: { width: `${value ?? 0}%` } }));

export const field = (label, input, hint) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
export const linkBtn = (text, href, cls = 'btn') => h('a', { class: cls, href, target: '_blank', rel: 'noopener noreferrer' }, text);
export const empty = (text) => h('div', { class: 'empty' }, text);
