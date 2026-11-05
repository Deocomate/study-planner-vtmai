
  /* ---------- UI plumbing ---------- */
  const rerender = () => { save(); render(); };
  const toast = (m) => { document.querySelectorAll('.toast').forEach((x) => x.remove()); const el = h('div', { class: 'toast', role: 'status' }, m); document.body.append(el); setTimeout(() => el.remove(), 2800); };
  const modal = (title, body, actions) => {
    const close = () => { closePop(); ov.remove(); };
    const ov = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === ov) close(); } }, h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('h2', null, title), body, h('div', { class: 'foot' }, (actions || [{ label: t('Close') }]).map((a) => h('button', { class: `btn ${a.primary ? 'primary' : 'ghost'} ${a.danger ? 'danger' : ''}`, onclick: () => { if (!a.fn || a.fn() !== false) close(); } }, a.label)))));
    document.body.append(ov); enhanceIn(ov); const f = ov.querySelector('input:not([type=hidden]):not(.pk-native),textarea,.pk'); if (f) f.focus(); return close;
  };
  const confirmBox = (title, text, label, fn, danger) => modal(title, h('p', { class: 'soft' }, text), [{ label: t('Cancel') }, { label: t(label), primary: !danger, danger, fn }]);
  const field = (label, input, hint) => h('label', { class: 'f' }, h('span', { class: 'label' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
  const inp = (props) => h('input', Object.assign({ class: 'input' }, props));
  const segEl = (opts, val, onchange) => { const wrap = h('div', { class: 'seg', role: 'group' }); opts.forEach(([v, l]) => wrap.append(h('button', { type: 'button', 'aria-pressed': String(v === val), 'data-v': v, onclick: () => { wrap.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v))); onchange(v); } }, l))); return wrap; };
  const burst = (el) => { if (matchMedia('(prefers-reduced-motion: reduce)').matches || !el || !el.animate) return; const r = el.getBoundingClientRect(); const cols = ['#f97316', '#22c55e', '#3b82f6', '#ec4899', '#eab308', '#a855f7'];
    for (let i = 0; i < 16; i++) { const p = document.createElement('i'); p.className = 'conf'; p.style.left = `${r.left + r.width / 2}px`; p.style.top = `${r.top + r.height / 2}px`; p.style.background = cols[i % cols.length]; document.body.append(p);
      const a = (Math.PI * 2 * i) / 16, d = 40 + Math.random() * 50; p.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d + 30}px) rotate(${Math.random() * 360}deg) scale(.6)`, opacity: 0 }], { duration: 700 + Math.random() * 300, easing: 'ease-out' }).onfinish = () => p.remove(); } };
  const ART = {
    logo: '<svg viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e3916f"/><stop offset="1" stop-color="#d086ab"/></linearGradient></defs><rect x="3" y="5" width="34" height="32" rx="9" fill="url(#lg)"/><rect x="3" y="5" width="34" height="10" rx="9" fill="#0d1514" opacity=".28"/><rect x="11" y="2" width="4" height="8" rx="2" fill="#eeedd9"/><rect x="25" y="2" width="4" height="8" rx="2" fill="#eeedd9"/><path d="M12 24l5.5 5.5L28 19" stroke="#fff" stroke-width="3.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    empty: '<svg viewBox="0 0 160 110" aria-hidden="true"><circle cx="122" cy="30" r="17" fill="#fde047"/><g stroke="#fbbf24" stroke-width="4" stroke-linecap="round"><path d="M122 4v6M122 50v6M96 30h6M142 30h6M104 12l4 4M136 44l4 4M140 12l-4 4M108 44l-4 4"/></g><ellipse cx="52" cy="62" rx="34" ry="15" fill="#e0f2fe"/><circle cx="36" cy="55" r="15" fill="#e0f2fe"/><circle cx="62" cy="50" r="19" fill="#e0f2fe"/><circle cx="45" cy="58" r="2.4" fill="#1e293b"/><circle cx="60" cy="58" r="2.4" fill="#1e293b"/><path d="M47 65 Q52 70 58 65" stroke="#1e293b" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M8 98 H152" stroke="#86efac" stroke-width="7" stroke-linecap="round"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>' };

  /* ---------- actions ---------- */
  const canStatus = (k) => UI.role === 'parent' || UI.role === k.child;
  const canEdit = (k) => UI.role === 'parent' || (UI.role === k.child && k.by === 'child');
  const setStatus = (k, st, srcEl) => {
    const before = pointsOf(k.child).balance; k.status = st;
    if (st === 'done') { k.doneAt = new Date().toISOString(); k.review = k.needReview ? 'awaiting' : 'none'; } else { k.doneAt = null; if (k.review === 'awaiting' || k.review === 'approved') k.review = k.needReview ? 'none' : 'none'; }
    rerender();
    if (st === 'done' && k.child === MOM) { if (srcEl) burst(srcEl); toast(t('Done ✓')); return; }
    if (st === 'done') { if (srcEl) burst(srcEl); const gain = pointsOf(k.child).balance - before; toast(k.needReview ? t('Sent to your parent to check. ⭐ +{0}', gain) : t('Great job! ⭐ +{0}', gain)); }
  };
  const reviewTask = (k, ok) => { const fb = h('textarea', { class: 'input', placeholder: ok ? t('Optional praise or note') : t('Tell them exactly what to fix') }); fb.value = k.feedback || '';
    modal(ok ? t('Approve: {0}', k.title) : t('Send back: {0}', k.title), field(ok ? t('Comment (optional)') : t('What needs to change?'), fb), [{ label: t('Cancel') }, { label: ok ? t('Approve') : t('Send back'), primary: true, fn: () => {
      if (!ok && !fb.value.trim()) { toast(t('Please say what to change.')); return false; } k.review = ok ? 'approved' : 'changes'; k.feedback = fb.value.trim(); if (!ok) { k.status = 'doing'; k.doneAt = null; } toast(t('Saved. The child will see it.')); rerender(); } }]); };
  /* ---------- Attached files (worksheets to print) ----------
     Stored with the artifact when this view may upload (assets), otherwise kept in this browser (IndexedDB). */
  const ASSET_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  const capP = (n) => { try { return window.claude && window.claude.use ? window.claude.use(n).catch(() => null) : Promise.resolve(null); } catch (e) { return Promise.resolve(null); } };
  const idb = (() => { let p = null; const open = () => (p = p || new Promise((res, rej) => { try { const r = indexedDB.open('study-planner-files', 1); r.onupgradeneeded = () => r.result.createObjectStore('f'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } }));
    const tx = (mode, fn) => open().then((db) => new Promise((res, rej) => { const s = db.transaction('f', mode).objectStore('f'); const q = fn(s); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }));
    return { put: (k, v) => tx('readwrite', (s) => s.put(v, k)), get: (k) => tx('readonly', (s) => s.get(k)), del: (k) => tx('readwrite', (s) => s.delete(k)) }; })();
  const fileIcon = (f) => (/pdf/.test(f.type) ? '📄' : /image/.test(f.type) ? '🖼️' : /word|document/.test(f.type) || /\.docx?$/i.test(f.name) ? '📝' : '📎');
  const putFile = async (file) => { const type = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : ''); const meta = { name: file.name, type, size: file.size };
    if (SRV.on) { if (file.size > 20 * 1048576) throw new Error(t('That file is bigger than 20 MB.'));
      try { const r = await api('/api/files', { method: 'POST', headers: { 'Content-Type': type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file }); if (r.ok) return { ...meta, asset: (await r.json()).id }; if (r.status === 413) throw new Error(t('That file is bigger than 20 MB.')); } catch (e) { if (e && e.message === t('That file is bigger than 20 MB.')) throw e; } }
    if (ASSET_TYPES.includes(type) && file.size <= 20 * 1048576) { const assets = await capP('assets'); if (assets) { try { const r = await assets.upload(file, { type }); return { ...meta, asset: r.id }; } catch (e) { if (e && e.code === 'too_large') throw new Error(t('That file is bigger than 20 MB.')); } } }
    const key = `f_${uid()}`; await idb.put(key, file); return { ...meta, local: key }; };
  const blobOf = async (f) => { if (f.asset) { const r = await fetch(`/_blob/${f.asset}`); if (!r.ok) throw new Error('missing'); return r.blob(); } const b = await idb.get(f.local); if (!b) throw new Error('missing'); return b; };
  const urlOf = async (f) => (f.asset ? `/_blob/${f.asset}` : URL.createObjectURL(await blobOf(f)));
  const dropFile = async (f) => { const used = D.tasks.some((k) => (k.files || []).some((x) => (f.asset && x.asset === f.asset) || (f.local && x.local === f.local))); if (used) return; try { if (f.local) await idb.del(f.local); else if (f.asset) { if (SRV.on) await api(`/api/files/${f.asset}`, { method: 'DELETE' }); else { const a = await capP('assets'); if (a) await a.delete(f.asset); } } } catch (e) { /* already gone */ } };
  // Files attached before the backend existed live only in this browser (IndexedDB): move them to the server.
  const migrateFiles = async () => { if (!SRV.on) return; let moved = 0;
    for (const k of D.tasks) for (const f of (k.files || [])) { if (!f.local || f.asset) continue;
      try { const b = await idb.get(f.local); if (!b) continue; const r = await api('/api/files', { method: 'POST', headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name) }, body: b });
        if (!r.ok) continue; f.asset = (await r.json()).id; idb.del(f.local).catch(() => {}); delete f.local; moved++; } catch (e) { /* try again next time */ } }
    if (moved) save(); };
  const printFile = async (f) => { try { const url = await urlOf(f);
      if (/image/.test(f.type)) { const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.append(fr); const d = fr.contentDocument; d.open(); d.write(`<!doctype html><title>${f.name.replace(/</g, '')}</title><style>@page{margin:10mm}body{margin:0}img{max-width:100%;max-height:100vh;display:block;margin:auto}</style><img src="${url}">`); d.close(); const img = d.querySelector('img'); const go = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { toast(t('Printing is not available here. Use Download and print the file.')); } setTimeout(() => fr.remove(), 60000); }; img.complete ? go() : (img.onload = go); return; }
      const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; document.body.append(a); a.click(); a.remove(); toast(t('The file opens in a new tab. Press Print there (Ctrl+P / ⌘P).'));
    } catch (e) { toast(e && e.message === 'missing' ? t('This file is not on this device. Attach it again here.') : t('Could not open the file.')); } };
  const saveFile = async (f) => { try { const blob = await blobOf(f); const dl = await capP('downloads');
      if (dl) { try { await dl.save({ filename: f.name, data: blob }); return; } catch (e) { if (e && e.code === 'declined') return; } }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = f.name; document.body.append(a); a.click(); a.remove();
    } catch (e) { toast(e && e.message === 'missing' ? t('This file is not on this device. Attach it again here.') : t('Could not open the file.')); } };
  const printable = (f) => /pdf|image/.test(f.type);
  const fileChips = (files) => h('ul', { class: 'fchips', 'aria-label': t('Files to print') }, files.map((f) => { let pr;
    if (printable(f)) { pr = h('a', { class: 'btn sm primary', href: f.asset ? `/_blob/${f.asset}` : '#', target: '_blank', rel: 'noopener', title: t('Opens the file; press Print there'), onclick: (e) => { if (!f.asset && pr.getAttribute('href') === '#') { e.preventDefault(); toast(t('This file is not on this device. Attach it again here.')); } else toast(t('The file opens in a new tab. Press Print there (Ctrl+P / ⌘P).')); } }, `🖨 ${t('Print')}`);
      if (!f.asset) blobOf(f).then((b) => pr.setAttribute('href', URL.createObjectURL(b))).catch(() => {}); }
    else pr = h('button', { type: 'button', class: 'btn sm primary', title: t('Word files cannot be printed in the browser: download, then print'), onclick: () => saveFile(f) }, `⬇ ${t('Download to print')}`);
    return h('li', null, h('span', { class: 'fn', title: f.name }, `${fileIcon(f)} ${f.name}`), pr, printable(f) ? h('button', { type: 'button', class: 'btn sm ghost icon', 'aria-label': t('Download'), title: t('Download'), onclick: () => saveFile(f) }, '⬇') : null); }));
  /* file picker that uploads right away; returns {el, list} */
  const filePicker = (initial, onChange) => { const list = (initial || []).slice(); const box = h('div', { class: 'stackc', style: 'gap:6px' }); const busy = h('span', { class: 'small muted' });
    const input = h('input', { type: 'file', multiple: true, accept: '.pdf,image/*,.doc,.docx', style: 'display:none', onchange: async () => { const fs = [...input.files]; input.value = ''; for (const file of fs) { busy.textContent = t('Uploading {0}…', file.name); try { list.push(await putFile(file)); } catch (e) { toast(e.message || t('Could not save the file.')); } } busy.textContent = ''; draw(); onChange && onChange(list); } });
    const draw = () => box.replaceChildren(list.length ? h('ul', { class: 'fchips' }, list.map((f, i) => h('li', null, h('span', { class: 'fn', title: f.name }, `${fileIcon(f)} ${f.name}`), h('span', { class: 'small muted' }, `${Math.max(1, Math.round(f.size / 1024))} KB`), h('button', { type: 'button', class: 'btn sm ghost icon', 'aria-label': t('Remove'), title: t('Remove'), onclick: () => { const [x] = list.splice(i, 1); draw(); onChange && onChange(list); setTimeout(() => dropFile(x), 0); } }, '✕')))) : '',
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn secondary sm', onclick: () => input.click() }, `📎 ${t('Attach files')}`), busy), input);
    draw(); return { el: box, list }; };
  const quickAttach = (k) => { const p = filePicker(k.files, (list) => { k.files = list.slice(); rerender(); }); modal(t('Files to print: {0}', k.title), h('div', { class: 'stackc' }, h('p', { class: 'small soft' }, t('PDF or pictures of the worksheet. Your child taps Print on the task.')), p.el), [{ label: t('Close'), primary: true }]); };
  const linkList = (text) => [...new Set(String(text || '').split(/\s+/).map(safeUrl).filter(Boolean))].slice(0, 10);

  const dateField = (init) => inp({ type: 'date', value: init || todayStr(), required: true });

  /* ---------- custom pickers ----------
     Every <select>, date and time input keeps living in the page (hidden) and stays the source of truth:
     code keeps reading .value and listening for "change". A styled button + popover replaces the browser UI. */
  const ICON = {
    date: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
    time: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    select: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>' };
  const POP = { anchor: null, close: null };
  const closePop = () => { if (POP.close) POP.close(); };
  const openPop = (anchor, content, cls) => {
    closePop();
    const pop = h('div', { class: `pk-pop ${cls}` }, content); document.body.append(pop);
    const place = () => { const r = anchor.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
      if (cls === 'pk-pop-list') pop.style.minWidth = `${Math.min(r.width, vw - 16)}px`;
      const w = pop.offsetWidth, ph = pop.offsetHeight; let top = r.bottom + 6;
      if (top + ph > vh - 8) top = r.top - ph - 6 >= 8 ? r.top - ph - 6 : Math.max(8, vh - ph - 8);
      pop.style.left = `${Math.max(8, Math.min(r.left, vw - w - 8))}px`; pop.style.top = `${top}px`; };
    const onDown = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) closePop(); };
    const onScroll = (e) => { if (!pop.contains(e.target)) closePop(); };
    document.addEventListener('pointerdown', onDown, true); document.addEventListener('scroll', onScroll, true); addEventListener('resize', closePop);
    anchor.setAttribute('aria-expanded', 'true'); POP.anchor = anchor;
    POP.close = () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('scroll', onScroll, true); removeEventListener('resize', closePop);
      pop.remove(); anchor.setAttribute('aria-expanded', 'false'); POP.anchor = null; POP.close = null; };
    place(); return pop;
  };
  const NATIVE_VALUE = { SELECT: Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value'), INPUT: Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') };
  /* set the hidden control like a person would: value + input/change events */
  const pkSet = (el, btn, v) => { closePop(); btn.focus(); if (el.value === v) return; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const escClose = (e, btn) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); btn.focus(); return true; } if (e.key === 'Tab') closePop(); return false; };
  const fmtPick = (s) => { const d = parse(s); return LANG === 'vi' ? `${dowS(wd(s))}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : `${dowS(wd(s))}, ${d.getDate()} ${EN_M[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`; };

  const openSelect = (el, btn) => {
    const opts = [...el.options]; let act = Math.max(0, el.selectedIndex); let typed = '', typedAt = 0;
    const list = h('div', { class: 'pk-list', role: 'listbox', tabindex: '-1', 'aria-label': btn.getAttribute('aria-label') || null });
    const items = opts.map((o, i) => h('div', { class: `pk-opt${i === el.selectedIndex ? ' sel' : ''}`, role: 'option', 'aria-selected': String(i === el.selectedIndex), 'aria-disabled': o.disabled ? 'true' : null,
      onclick: () => choose(i), onmousemove: () => { if (act !== i) { act = i; mark(false); } } }, h('span', null, o.textContent), i === el.selectedIndex ? svg(ICON.check) : null));
    const choose = (i) => { if (!opts[i] || opts[i].disabled) return; pkSet(el, btn, opts[i].value); };
    const mark = (scroll) => { items.forEach((it, i) => it.classList.toggle('act', i === act)); if (scroll && items[act]) items[act].scrollIntoView({ block: 'nearest' }); };
    const move = (to) => { const n = items.length; if (!n) return; let i = Math.max(0, Math.min(n - 1, to)); const dir = to < act ? -1 : 1; while (opts[i] && opts[i].disabled && i + dir >= 0 && i + dir < n) i += dir; act = i; mark(true); };
    list.addEventListener('keydown', (e) => { if (escClose(e, btn)) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); move(act + 1); } else if (e.key === 'ArrowUp') { e.preventDefault(); move(act - 1); } else if (e.key === 'Home') { e.preventDefault(); move(0); } else if (e.key === 'End') { e.preventDefault(); move(items.length - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(act); }
      else if (e.key.length === 1) { const now = Date.now(); typed = now - typedAt > 700 ? e.key.toLowerCase() : typed + e.key.toLowerCase(); typedAt = now; const i = opts.findIndex((o) => o.textContent.toLowerCase().replace(/^[^\p{L}\p{N}]+/u, '').startsWith(typed)); if (i >= 0) move(i); } });
    list.append(...items); openPop(btn, list, 'pk-pop-list'); list.focus(); mark(true);
  };

  const openDate = (el, btn) => {
    const today = todayStr(); let cur = el.value || today; let view = cur.slice(0, 7); const min = el.min || '', max = el.max || '';
    const ok = (ds) => (!min || ds >= min) && (!max || ds <= max);
    const box = h('div', { class: 'pk-cal', role: 'dialog', 'aria-label': btn.getAttribute('aria-label') || t('Choose a date') });
    const draw = (focus) => {
      const first = `${view}-01`; const start = addDays(first, 1 - wd(first)); const days = [];
      for (let i = 0; i < 42; i++) { const ds = addDays(start, i); days.push(h('button', { type: 'button', class: `cd${ds.slice(0, 7) !== view ? ' out' : ''}${ds === el.value ? ' sel' : ''}${ds === today ? ' tod' : ''}`, tabindex: ds === cur ? '0' : '-1', disabled: !ok(ds), 'data-d': ds, 'aria-label': fmtLong(ds), 'aria-pressed': String(ds === el.value), onclick: () => pkSet(el, btn, ds) }, String(parse(ds).getDate()))); }
      const shift = (k) => { const [y, m] = view.split('-').map(Number); view = ymd(new Date(y, m - 1 + k, 1)).slice(0, 7); cur = `${view}-${cur.slice(8)}`; while (cur.slice(0, 7) !== view) cur = addDays(cur, -1); draw(false); };
      box.replaceChildren(
        h('div', { class: 'calh' }, h('button', { type: 'button', class: 'pk-nav', onclick: () => shift(-1), 'aria-label': t('Previous month') }, svg(ICON.prev)), h('b', null, monthLabel(view)), h('button', { type: 'button', class: 'pk-nav', onclick: () => shift(1), 'aria-label': t('Next month') }, svg(ICON.next))),
        h('div', { class: 'calg' }, [1, 2, 3, 4, 5, 6, 7].map((i) => h('i', null, dowS(i))), days),
        h('div', { class: 'pk-foot' }, ok(today) ? h('button', { type: 'button', class: 'pk-link', onclick: () => pkSet(el, btn, today) }, t('Today')) : h('span'), el.required ? null : h('button', { type: 'button', class: 'pk-link soft', onclick: () => pkSet(el, btn, '') }, t('Clear'))));
      if (focus !== false) box.querySelector(`[data-d="${cur}"]`)?.focus(); };
    box.addEventListener('keydown', (e) => { if (escClose(e, btn)) return; const k = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (k || e.key === 'PageUp' || e.key === 'PageDown') { if (!e.target.dataset.d) return; e.preventDefault();
        if (k) cur = addDays(cur, k); else { const [y, m] = cur.split('-').map(Number); const d = new Date(y, m - 1 + (e.key === 'PageUp' ? -1 : 1), 1); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); cur = ymd(new Date(d.getFullYear(), d.getMonth(), Math.min(Number(cur.slice(8)), last))); }
        view = cur.slice(0, 7); draw(); } });
    openPop(btn, box, 'pk-pop-cal'); draw();
  };

  const openTime = (el, btn) => {
    const [h0, m0] = (el.value || '').split(':'); let hh = h0 || null;
    const step = Math.max(1, Math.round((Number(el.step) || 300) / 60)); const mins = []; for (let m = 0; m < 60; m += step) mins.push(pad(m)); if (m0 && !mins.includes(m0)) { mins.push(m0); mins.sort(); }
    const cell = (v, on, fn) => h('button', { type: 'button', class: `pk-tc${on ? ' sel' : ''}`, 'aria-pressed': String(on), onclick: fn }, v);
    const box = h('div', { class: 'pk-timebox', role: 'dialog', 'aria-label': btn.getAttribute('aria-label') || t('Choose a time') });
    const draw = () => {
      const hc = h('div', { class: 'pk-col', role: 'group', 'aria-label': t('Hour') }, Array.from({ length: 24 }, (_, i) => pad(i)).map((v) => cell(v, v === hh, () => { hh = v; draw(); box.querySelector('.pk-col.m .pk-tc')?.focus(); })));
      const mc = h('div', { class: 'pk-col m', role: 'group', 'aria-label': t('Minute') }, mins.map((v) => cell(v, hh === h0 && v === m0, () => pkSet(el, btn, `${hh || '00'}:${v}`))));
      box.replaceChildren(...[h('div', { class: 'pk-time' }, h('div', null, h('span', { class: 'pk-th' }, t('Hour')), hc), h('div', null, h('span', { class: 'pk-th' }, t('Minute')), mc)),
        el.required ? null : h('div', { class: 'pk-foot' }, h('span', { class: 'small muted' }, hh ? `${hh}:··` : ''), h('button', { type: 'button', class: 'pk-link soft', onclick: () => pkSet(el, btn, '') }, t('Clear')))].filter(Boolean));
      [hc, mc].forEach((c) => { const s = c.querySelector('.sel') || (c === mc && c.children[0]); if (s) c.scrollTop = s.offsetTop - c.clientHeight / 2 + s.offsetHeight / 2; }); };
    box.addEventListener('keydown', (e) => { if (escClose(e, btn)) return; const col = e.target.closest('.pk-col'); if (!col || !['ArrowDown', 'ArrowUp'].includes(e.key)) return; e.preventDefault();
      const b = e.key === 'ArrowDown' ? e.target.nextElementSibling : e.target.previousElementSibling; if (b) b.focus(); });
    openPop(btn, box, 'pk-pop-time'); draw(); (box.querySelector('.pk-col .sel') || box.querySelector('.pk-col .pk-tc')).focus();
  };

  const enhance = (el) => {
    if (el.dataset.pk) return; const kind = el.tagName === 'SELECT' ? (el.multiple ? '' : 'select') : ['date', 'time'].includes(el.type) ? el.type : ''; if (!kind) return;
    el.dataset.pk = kind;
    const btn = h('button', { type: 'button', class: `input pk pk-${kind}`, 'aria-haspopup': kind === 'select' ? 'listbox' : 'dialog', 'aria-expanded': 'false', 'aria-label': el.getAttribute('aria-label') || null, disabled: el.disabled });
    btn.style.cssText = el.style.cssText; el.classList.add('pk-native'); el.tabIndex = -1; el.setAttribute('aria-hidden', 'true'); el.before(btn);
    const show = () => { const v = el.value; const text = kind === 'select' ? (el.options[el.selectedIndex]?.textContent || '') : kind === 'date' ? (v ? fmtPick(v) : '') : v;
      btn.replaceChildren(h('span', { class: `pk-v${text ? '' : ' ph'}` }, text || (kind === 'date' ? t('Choose a date') : kind === 'time' ? '--:--' : '—')), svg(ICON[kind])); };
    const d = NATIVE_VALUE[el.tagName]; Object.defineProperty(el, 'value', { configurable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, v); show(); } });
    el.addEventListener('change', show);
    btn.addEventListener('click', () => { if (POP.anchor === btn) return closePop(); (kind === 'select' ? openSelect : kind === 'date' ? openDate : openTime)(el, btn); });
    btn.addEventListener('keydown', (e) => { if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && POP.anchor !== btn) { e.preventDefault(); btn.click(); } });
    show();
  };
  const enhanceIn = (root) => { root.querySelectorAll('select, input[type=date], input[type=time]').forEach(enhance); };
  const fld = (l, el) => h('div', { class: 'f' }, h('span', { class: 'label' }, l), el);
  const themeDialog = () => {
    const sw = { lavender: '#a066c8', blue: '#1f6fd1', green: '#2e8b57', teal: '#0e8a8c', gray: '#4b5b6e' }; const nm = { lavender: t('Lavender'), blue: t('Sky blue'), green: t('Green'), teal: t('Teal'), gray: t('Gray') };
    const body = h('div', { class: 'stackc' }, fld(t('Mode'), segEl([['light', t('Light')], ['dark', t('Dark')]], THEME, (x) => { THEME = x; LS.set('sp-theme', x); decorate(); })),
      h('p', { class: 'small soft' }, t('Colours follow who is using the planner: Ben red, Shin blue, Mom brown.')));
    modal(t('Appearance'), body, [{ label: t('Close'), primary: true }]);
  };
  const SUBJECTS = ['Maths', 'EFL', 'Science', 'Daily practice English', 'Shadowing', 'Writing', 'Tiếng Việt', 'Việt Nam học', 'Debate'];
  const TEACHERS = ['Vinschool', 'Cô Linh Cindy', 'Cô Vinh', 'Cô Mẫn', 'Cô Giang', 'EC'];
  /* Order of teachers in every list and every evening: Vinschool first, then the other teachers, practice at home last. */
  const trank = (x) => { const v = String(x || '').trim().toLowerCase(); if (!v) return 40; if (/^home$|ở nhà|tại nhà/.test(v)) return 50; const i = TEACHERS.findIndex((q) => q.toLowerCase() === v); if (i >= 0) return i; const j = (D.customTeachers || []).findIndex((q) => q.toLowerCase() === v); return j >= 0 ? 10 + j : 30; };
  const byTeacher = (a, b) => trank(a.teacher) - trank(b.teacher) || (a.teacher || '').localeCompare(b.teacher || '') || (a.subject || '').localeCompare(b.subject || '');
  const teacherRuns = (arr) => { const out = []; let last = null; const many = new Set(arr.map((k) => k.teacher || '')).size > 1; arr.forEach((k) => { const tt = k.teacher || ''; if (many && tt !== last) out.push({ head: tt || t('Other') }); last = tt; out.push(k); }); return out; };
  const pick = (list, cur, key) => {
    const extra = (D[key] = D[key] || []); const all = [...list, ...extra.filter((x) => !list.includes(x))]; if (cur && !all.includes(cur)) all.push(cur);
    const sel = h('select', { class: 'input' }, h('option', { value: '' }, '—'), all.map((x) => h('option', { value: x, selected: x === cur }, x)), h('option', { value: '__new' }, t('+ Add new…')));
    const txt = h('input', { class: 'input', type: 'text', placeholder: t('Type a new name'), style: 'display:none;margin-top:6px' });
    sel.addEventListener('change', () => { const on = sel.value === '__new'; txt.style.display = on ? '' : 'none'; if (on) txt.focus(); });
    const box = h('div', null, sel, txt);
    Object.defineProperty(box, 'value', { get: () => (sel.value === '__new' ? txt.value.trim() : sel.value) });
    box.remember = () => { const v = box.value; if (sel.value === '__new' && v && !all.includes(v) && !extra.includes(v)) extra.push(v); };
    return box;
  };
  const taskForm = (k, pre) => {
    const isP = UI.role === 'parent'; const e = !!k; const v = k || Object.assign({ title: '', subject: '', teacher: '', note: '', links: [], date: UI.date, start: '', end: '', minutes: 30, priority: 'normal', needReview: false, status: 'todo', child: isP ? (UI.who === 'all' ? 'both' : UI.who) : UI.role }, pre || {});
    let pr = v.priority || 'normal', st = v.status || 'todo', rep = 'no'; const days = new Set([wd(v.date || todayStr())]);
    const f = { title: inp({ value: v.title, placeholder: t('e.g. Maths workbook page 12') }), subject: pick(SUBJECTS, v.subject, 'customSubjects'), teacher: pick(TEACHERS, v.teacher, 'customTeachers'), note: h('textarea', { class: 'input', rows: 2, placeholder: t('Not required: what to do, which pages…') }, v.note || ''),
      links: h('textarea', { class: 'input', rows: 2, placeholder: 'https://…' }, (v.links || []).join('\n')), date: dateField(v.date), start: inp({ type: 'time', value: v.start || '' }), end: inp({ type: 'time', value: v.end || '' }), minutes: inp({ type: 'number', min: 5, step: 5, value: v.minutes || 30 }),
      until: dateField(addDays(v.date || todayStr(), 28)), rv: h('input', { type: 'checkbox', checked: !!v.needReview, style: 'width:auto' }),
      child: h('select', { class: 'input' }, (isP ? PEOPLE : KIDS).map((c) => h('option', { value: c, selected: v.child === c }, c === MOM ? `👩 ${NAME(c)}` : NAME(c))), e ? null : h('option', { value: 'both', selected: v.child === 'both' }, t('Both children (two separate tasks)'))) };
    const fpk = filePicker(v.files || []); const err = h('div', { class: 'err', role: 'alert' }); const dl = h('datalist', { id: 'dl-sub' }, ['Maths', 'ESL', 'Science', 'English', 'Tiếng Việt'].map((x) => h('option', { value: x })));
    const sum = h('span', { class: 'muted' }); const rdays = h('div', { class: 'rdays' }); const names = () => [...days].sort().map((d) => dowL(d));
    const drawDays = () => { rdays.replaceChildren(...[1, 2, 3, 4, 5, 6, 7].map((d) => h('button', { type: 'button', title: dowL(d), 'aria-pressed': String(days.has(d)), onclick: () => { days.has(d) ? days.delete(d) : days.add(d); drawDays(); } }, dowS(d)))); sum.textContent = days.size ? (days.size === 7 ? t('Every day') : t('Every {0}', names().join(', '))) : t('Pick at least one day'); };
    drawDays(); const rbox = h('div', { class: 'stackc', style: 'display:none' }, h('fieldset', { class: 'rbox', style: 'margin:0' }, h('div', { class: 'rh' }, h('b', null, t('Repeat on')), sum), rdays, h('div', { class: 'row', style: 'flex-wrap:wrap;margin-top:8px' }, [[t('Every day'), [1, 2, 3, 4, 5, 6, 7]], [t('Mon–Fri'), [1, 2, 3, 4, 5]], [t('3 times a week (Mon, Wed, Fri)'), [1, 3, 5]], [t('Weekend'), [6, 7]]].map(([l, ds]) => h('button', { type: 'button', class: 'btn ghost sm', onclick: () => { days.clear(); ds.forEach((d) => days.add(d)); drawDays(); } }, l)))), field(t('Repeat until'), f.until, t('At most 3 months. Each day becomes its own task.')));
    const body = h('div', { class: 'stackc' }, dl, err,
      h('div', { class: 'fsec' }, h('h3', null, t('What')), field(t('Task'), f.title), h('div', { class: 'fgrid' }, field(t('Subject'), f.subject), field(t('Teacher'), f.teacher)), field(t('Note'), f.note), field(t('Link to do the work (optional)'), f.links, t('Several links: one per line, up to 10.')), h('div', { class: 'f' }, h('span', { class: 'label' }, t('Files to print (optional)')), fpk.el, h('span', { class: 'hint' }, t('PDF or pictures. Your child can print them from the task.')))),
      h('div', { class: 'fsec' }, h('h3', null, t('Who · When')), isP ? field(t('For'), f.child) : null, h('div', { class: 'fgrid' }, field(t('Due date'), f.date), null)),
      h('div', { class: 'fsec' }, h('h3', null, t('Repeat')), segEl([['no', t('Do not repeat')], ['yes', t('Repeat every week')]], rep, (x) => { rep = x; rbox.style.display = x === 'yes' ? 'grid' : 'none'; }), rbox));
    const run = () => {
      const title = f.title.value.trim(); err.textContent = ''; if (!title) return (err.textContent = t('Please enter a task name.'), false); if (!f.date.value) return (err.textContent = t('Please choose a day.'), false);
      if (f.start.value && f.end.value && hm(f.end.value) <= hm(f.start.value)) return (err.textContent = t('The end time must be after the start time.'), false);
      if (f.end.value && !f.start.value) return (err.textContent = t('Choose a start time too, or clear the end time.'), false);
      if (rep === 'yes' && !days.size) return (err.textContent = t('Pick at least one day to repeat.'), false);
      const base = { title, subject: f.subject.value.trim(), teacher: f.teacher.value.trim(), note: f.note.value.trim(), links: linkList(f.links.value), files: fpk.list.slice(), start: k ? (k.start || '') : (v.start || ''), end: k ? (k.end || '') : (v.end || ''), minutes: Math.max(5, Number(f.minutes.value) || 30), priority: pr, needReview: !!(k && k.needReview) };
      const dates = (rep === 'yes' && !e) ? [] : [f.date.value]; if (rep === 'yes') { const last = f.until.value && f.until.value < addDays(f.date.value, 92) ? f.until.value : addDays(f.date.value, 92); for (let d = e ? addDays(f.date.value, 1) : f.date.value; d <= last; d = addDays(d, 1)) if (days.has(wd(d))) dates.push(d); if (!dates.length) return (err.textContent = t('No matching day before the end date.'), false); }
      const kids = e ? [k.child] : (isP ? (f.child.value === 'both' ? KIDS : [f.child.value]) : [UI.role]); const series = dates.length > 1 ? uid() : null;
      const trial = Object.assign({ child: kids[0], date: dates[0] }, base, e ? { id: k.id } : {}); const w = conflicts(trial);
      const commit = () => { let made = 0; f.subject.remember(); f.teacher.remember();
        if (e) { Object.assign(k, base, { date: dates[0], child: k.child }); if (k.child === MOM) k.due = dates[0]; if (st !== k.status) { k.status = st; k.doneAt = st === 'done' ? new Date().toISOString() : null; if (st === 'done' && k.needReview) k.review = 'awaiting'; } if (series) k.series = series; }
        for (const c of kids) for (const d of dates.slice(e ? 1 : 0)) { D.tasks.push(Object.assign({ id: uid(), child: c, date: d, status: 'todo', review: 'none', feedback: '', doneAt: null, by: isP ? 'parent' : 'child', series }, base, c === MOM ? { due: d } : {})); made++; }
        UI.date = dates[0]; UI.month = dates[0].slice(0, 7); UI.page = UI.page === 'month' ? 'month' : 'today'; toast(e ? (made ? t('Saved. {0} more day(s) added.', made) : t('Saved.')) : t('Added {0} task(s).', made)); rerender(); };
      if (w.length) { confirmBox(t('Please check this'), w.join(' '), 'Save anyway', commit); return true; } commit(); return true; };
    const actions = [{ label: t('Cancel') }]; if (e && canEdit(k)) actions.unshift({ label: t('Delete'), danger: true, fn: () => { confirmBox(t('Delete this task?'), k.title, 'Delete', () => { D.tasks = D.tasks.filter((x) => x.id !== k.id); toast(t('Deleted.')); rerender(); }, true); } });
    actions.push({ label: e ? t('Save changes') : t('Add task'), primary: true, fn: run }); modal(e ? t('Edit task') : t('Add task'), body, actions);
  };

  /* ---------- header, nav, decorations ---------- */
  const NAV = () => (UI.role === 'parent' ? [['today', t('Today')], ['month', t('Month')], ['perf', t('Performance')], ['rewards', t('Rewards')], ['import', t('Import')], ['students', t('Students')], ['resources', t('Resources')]] : [['today', t('Today')], ['month', t('Month')], ['rewards', t('Rewards')], ['import', t('Import')], ['resources', t('Resources')]]);
  const unfinishedToday = () => tasksOn(todayStr()).filter((k) => k.status !== 'done').length;
  const header = () => { const H = holidayOn(todayStr());
    const nav = h('nav', { class: 'nav', 'aria-label': t('Main menu') }, NAV().map(([k, l]) => h('button', { type: 'button', 'aria-current': UI.page === k ? 'page' : null, onclick: () => { UI.page = k; if (k === 'today') UI.date = UI.date; render(); window.scrollTo(0, 0); } }, l, k === 'today' && unfinishedToday() ? h('span', { class: 'cnt', 'aria-label': t('{0} not finished today', unfinishedToday()) }, unfinishedToday()) : null)));
    const el = h('div', { class: 'hbar' },
      h('div', { class: 'hside' }, h('a', { class: 'logo', href: '#', onclick: (ev) => { ev.preventDefault(); UI.page = 'today'; UI.date = todayStr(); render(); }, 'aria-label': 'Study Planner' }, svg(ART.logo), h('span', null, 'Study Planner'))),
      nav,
      h('div', { class: 'hside right' },
        h('button', { class: 'iconbtn', type: 'button', onclick: () => { LANG = LANG === 'vi' ? 'en' : 'vi'; LS.set('sp-lang', LANG); render(); }, 'aria-label': t('Language'), title: t('Language') }, LANG === 'vi' ? 'VI' : 'EN'),
        h('button', { class: 'iconbtn', type: 'button', onclick: askNotif, 'aria-label': t('Reminders'), title: t('Reminders') }, notifOK() ? '🔔' : '🔕'),
        h('button', { class: 'iconbtn', type: 'button', onclick: themeDialog, 'aria-label': t('Appearance'), title: t('Appearance') }, '🎨'),
        SRV.on && UI.role === 'parent' ? h('a', { class: 'iconbtn', href: '/backup', 'aria-label': t('Back up & restore data'), title: t('Back up & restore data') }, '💾') : null,
        h('div', { class: 'who', role: 'group', 'aria-label': t('Who is using the planner?') }, ['ben', 'shin', 'parent'].map((r) => h('button', { type: 'button', 'aria-pressed': String(UI.role === r), onclick: () => { const changed = UI.role !== r; UI.role = r; LS.set('sp-role', r); if (!NAV().some(([k]) => k === UI.page)) UI.page = 'today'; render(); if (changed) showSplash(); } }, r === 'parent' ? NAME(MOM) : NAME(r))))),
      H ? h('span', { class: 'hold l', 'aria-hidden': 'true' }, H.icons[0]) : null,
      H ? h('div', { class: 'hold r', role: 'img', 'aria-label': H.left > 0 ? t('{0} day(s) until {1}', H.left, H.name) : H.name }, h('div', { class: 'htag' }, H.left > 0 ? [h('b', null, H.left), h('span', null, H.left === 1 ? t('day left') : t('days left'))] : h('span', null, t('Have fun!')), h('i', null, H.icons[1]))) : null);
    return el; };
  /* ---------- Person themes: Ben red, Shin blue, Mom brown, on a hand-painted checkerboard ---------- */
  const PERSON_THEME = { ben: 'red', shin: 'blue', parent: 'brown' };
  const themeOf = () => PERSON_THEME[UI.role] || 'brown';
  const CHECK = { red: { light: ['#fbf3ea', '#e0574d'], dark: ['#211514', '#6e2a26'] }, blue: { light: ['#fbf6ec', '#86b4e4'], dark: ['#111a24', '#28496f'] }, brown: { light: ['#fbf5ec', '#c29a72'], dark: ['#1b1511', '#594230'] } };
  const checkerCache = {};
  const checkerUrl = (theme, mode) => { const key = `${theme}-${mode}`; if (checkerCache[key]) return checkerCache[key];
    const [bg, ink] = CHECK[theme][mode]; const n = 8, s = 70; let seed = 7; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280); let g = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { if ((r + c) % 2) continue; const x = c * s + (rnd() - 0.5) * 4, y = r * s + (rnd() - 0.5) * 4, w = s + (rnd() - 0.5) * 5, hh = s + (rnd() - 0.5) * 5;
      g += `<rect x='${x.toFixed(1)}' y='${y.toFixed(1)}' width='${w.toFixed(1)}' height='${hh.toFixed(1)}' fill-opacity='${(0.5 + rnd() * 0.35).toFixed(2)}'/>`;
      for (let k = 0; k < 3; k++) g += `<rect x='${(x + 6 + rnd() * (s - 30)).toFixed(1)}' y='${(y + 6 + rnd() * (s - 20)).toFixed(1)}' width='${(10 + rnd() * 26).toFixed(1)}' height='${(3 + rnd() * 5).toFixed(1)}' fill-opacity='${(0.12 + rnd() * 0.2).toFixed(2)}'/>`; }
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${n * s}' height='${n * s}'><defs><filter id='w' x='-5%' y='-5%' width='110%' height='110%'><feTurbulence type='fractalNoise' baseFrequency='0.04' numOctaves='2' seed='4'/><feDisplacementMap in='SourceGraphic' scale='5'/></filter></defs><rect width='100%' height='100%' fill='${bg}'/><g filter='url(#w)' fill='${ink}'>${g}</g></svg>`;
    return (checkerCache[key] = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`); };
  /* Original stickers (drawn here, not copied from anything) */
  const STK = {
    chick: `<svg viewBox="0 0 80 80"><ellipse cx="40" cy="74" rx="18" ry="3" fill="#000" opacity=".12"/><path d="M33 66l-3 7M47 66l3 7" stroke="#e8902a" stroke-width="3" stroke-linecap="round"/><circle cx="40" cy="44" r="24" fill="#ffd84d" stroke="#3b2a1a" stroke-width="2.5"/><ellipse cx="25" cy="48" rx="7" ry="10" fill="#ffc72c" stroke="#3b2a1a" stroke-width="2" transform="rotate(20 25 48)"/><circle cx="46" cy="38" r="3" fill="#3b2a1a"/><path d="M54 43l9 3-9 4z" fill="#f28c28" stroke="#3b2a1a" stroke-width="1.6" stroke-linejoin="round"/><circle cx="51" cy="48" r="3" fill="#ff9aa2" opacity=".7"/></svg>`,
    cat: `<svg viewBox="0 0 90 80"><path d="M14 30L20 6l18 14M76 30L70 6 52 20" fill="#f4a259" stroke="#3b2a1a" stroke-width="2.5" stroke-linejoin="round"/><ellipse cx="45" cy="44" rx="34" ry="30" fill="#f4a259" stroke="#3b2a1a" stroke-width="2.5"/><path d="M45 15v10M36 17l3 8M54 17l-3 8" stroke="#d9773a" stroke-width="3" stroke-linecap="round"/><path d="M31 42q4-5 8 0M51 42q4-5 8 0" fill="none" stroke="#3b2a1a" stroke-width="2.5" stroke-linecap="round"/><path d="M42 50h6l-3 4z" fill="#e5636b"/><path d="M45 54q-4 5-8 2M45 54q4 5 8 2" fill="none" stroke="#3b2a1a" stroke-width="2" stroke-linecap="round"/><path d="M20 50l-12-2M20 55l-12 3M70 50l12-2M70 55l12 3" stroke="#3b2a1a" stroke-width="1.6" stroke-linecap="round"/><circle cx="27" cy="52" r="4" fill="#ff8f8f" opacity=".5"/><circle cx="63" cy="52" r="4" fill="#ff8f8f" opacity=".5"/></svg>`,
    bunny: `<svg viewBox="0 0 70 90"><ellipse cx="24" cy="22" rx="8" ry="20" fill="#fff" stroke="#3b2a1a" stroke-width="2.5"/><ellipse cx="46" cy="22" rx="8" ry="20" fill="#fff" stroke="#3b2a1a" stroke-width="2.5"/><ellipse cx="24" cy="24" rx="3.5" ry="13" fill="#ffb3c1"/><ellipse cx="46" cy="24" rx="3.5" ry="13" fill="#ffb3c1"/><ellipse cx="35" cy="60" rx="26" ry="24" fill="#fff" stroke="#3b2a1a" stroke-width="2.5"/><circle cx="27" cy="56" r="3" fill="#3b2a1a"/><circle cx="43" cy="56" r="3" fill="#3b2a1a"/><path d="M32 63q3 3 6 0" fill="none" stroke="#3b2a1a" stroke-width="2" stroke-linecap="round"/><circle cx="21" cy="64" r="4" fill="#ffb3c1" opacity=".7"/><circle cx="49" cy="64" r="4" fill="#ffb3c1" opacity=".7"/></svg>`,
    books: `<svg viewBox="0 0 90 70"><rect x="10" y="46" width="70" height="14" rx="3" fill="#5b8bd6" stroke="#3b2a1a" stroke-width="2.5"/><rect x="16" y="32" width="62" height="14" rx="3" fill="#f2c14e" stroke="#3b2a1a" stroke-width="2.5"/><rect x="6" y="18" width="66" height="14" rx="3" fill="#e5636b" stroke="#3b2a1a" stroke-width="2.5"/><path d="M14 53h56M22 39h48M12 25h52" stroke="#fff" stroke-width="2" opacity=".6"/><path d="M60 18v-12l5 4 5-4v12" fill="#7fc8a9" stroke="#3b2a1a" stroke-width="2" stroke-linejoin="round"/></svg>`,
    pencil: `<svg viewBox="0 0 90 30"><path d="M8 15l14-9h58v18H22z" fill="#ffd166" stroke="#3b2a1a" stroke-width="2.5" stroke-linejoin="round"/><path d="M8 15l14-9v18z" fill="#f6d7a7" stroke="#3b2a1a" stroke-width="2.5" stroke-linejoin="round"/><path d="M8 15l6-4v8z" fill="#3b2a1a"/><rect x="72" y="6" width="10" height="18" fill="#ff8fa3" stroke="#3b2a1a" stroke-width="2.5"/></svg>`,
    star: `<svg viewBox="0 0 60 60"><path d="M30 5l7 16 17 2-13 11 4 17-15-9-15 9 4-17L6 23l17-2z" fill="#ffd84d" stroke="#3b2a1a" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
    heart: `<svg viewBox="0 0 60 54"><path d="M30 50S6 35 6 18A12 12 0 0 1 30 12a12 12 0 0 1 24 6c0 17-24 32-24 32z" fill="#ef5b5b" stroke="#3b2a1a" stroke-width="2.5" stroke-linejoin="round"/><path d="M15 17a6 6 0 0 1 6-5" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/></svg>`,
    plane: `<svg viewBox="0 0 80 50"><path d="M4 26L76 4 50 46l-12-14z" fill="#fff" stroke="#3b2a1a" stroke-width="2.5" stroke-linejoin="round"/><path d="M38 32L76 4M38 32l-4 14 10-8" fill="#dfe8f5" stroke="#3b2a1a" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
    cloud: `<svg viewBox="0 0 100 60"><path d="M22 50a14 14 0 0 1 2-28 20 20 0 0 1 38-6 16 16 0 0 1 24 18 10 10 0 0 1-4 16z" fill="#fff" stroke="#3b2a1a" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
    rainbow: `<svg viewBox="0 0 120 64"><g fill="none" stroke-width="7" stroke-linecap="round"><path d="M10 60a50 50 0 0 1 100 0" stroke="#ef5b5b"/><path d="M18 60a42 42 0 0 1 84 0" stroke="#f6a04d"/><path d="M26 60a34 34 0 0 1 68 0" stroke="#ffd84d"/><path d="M34 60a26 26 0 0 1 52 0" stroke="#7fc8a9"/><path d="M42 60a18 18 0 0 1 36 0" stroke="#7fb0e3"/></g></svg>`,
  };
  const sticker = (name, cls, style) => { const el = h('span', { class: `stk ${cls}`, style, 'aria-hidden': 'true' }); el.innerHTML = STK[name]; return el; };
  const showSplash = () => { document.getElementById('splash')?.remove();
    const role = UI.role; const name = role === 'parent' ? NAME(MOM) : NAME(role); const kids = role === 'parent' ? PEOPLE : [role];
    const left = D.tasks.filter((k) => kids.includes(k.child) && k.status !== 'done' && (k.date === todayStr() || (k.due ? k.due < todayStr() : k.date < todayStr()) && !k.repeat)).length;
    const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 350); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') close(); };
    const el = h('div', { id: 'splash', class: 'splash', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Study Planner', onclick: (e) => { if (e.target === el || e.target.closest('.sp-go')) close(); } },
      sticker('rainbow', 'a-bob', 'top:3%;left:50%;width:150px;margin-left:-75px;--d:5s'),
      sticker('books', 'a-wiggle', 'top:5%;left:4%;width:120px'), sticker('cloud', 'a-drift', 'top:14%;left:30%;width:90px'),
      sticker('cat', 'a-peek', 'top:6%;right:4%;width:110px'), sticker('star', 'a-spin', 'top:30%;left:5%;width:60px'),
      sticker('heart', 'a-pop', 'top:24%;right:12%;width:46px'), sticker('heart', 'a-pop', 'top:62%;left:8%;width:38px;--d:2.4s'),
      sticker('bunny', 'a-bob', 'top:44%;right:3%;width:84px;--d:3.4s'), sticker('star', 'a-spin', 'bottom:30%;right:16%;width:40px;--d:9s'),
      sticker('plane', 'a-fly', 'top:18%;left:-10%;width:80px'),
      sticker('pencil', 'a-wiggle', 'bottom:16%;right:6%;width:110px;--d:2.6s'), sticker('books', 'a-bob', 'bottom:6%;right:4%;width:120px;--d:4s'),
      sticker('chick', 'a-walk', 'bottom:3%;left:0;width:74px'), sticker('chick', 'a-hop', 'bottom:18%;left:6%;width:58px'),
      h('div', { class: 'sp-card' }, h('div', { class: 'sp-hello' }, t('Hi {0}!', name), ' 👋'), h('h1', null, 'Study Planner'),
        h('p', null, left ? t('{0} task(s) waiting today', left) : t('Nothing waiting today – great!')),
        h('button', { type: 'button', class: 'btn primary sp-go' }, `${t('Start studying')} →`), h('p', { class: 'sp-tip' }, t('Tap anywhere to continue'))));
    el.dataset.person = themeOf(); document.body.append(el); document.addEventListener('keydown', onKey); setTimeout(() => el.querySelector('.sp-go')?.focus(), 50); };
  /* Animated stickers in the empty space on both sides of the page (wide screens) */
  const sideDeco = () => { if (document.getElementById('sides')) return;
    const L = [['books', 'a-wiggle', 'top:16%;left:2%;width:110px'], ['cat', 'a-peek', 'top:38%;left:3%;width:96px'], ['star', 'a-spin', 'top:58%;left:6%;width:48px'], ['chick', 'a-hop', 'top:72%;left:3%;width:66px'], ['heart', 'a-pop', 'top:88%;left:7%;width:36px']];
    const R = [['rainbow', 'a-bob', 'top:14%;right:2%;width:130px;--d:5s'], ['bunny', 'a-bob', 'top:34%;right:4%;width:78px;--d:3.4s'], ['pencil', 'a-wiggle', 'top:54%;right:2%;width:110px;--d:2.6s'], ['heart', 'a-pop', 'top:66%;right:8%;width:40px;--d:2.4s'], ['chick', 'a-hop', 'top:80%;right:4%;width:60px;--d:1.4s']];
    const box = h('div', { id: 'sides', class: 'sides', 'aria-hidden': 'true' }, [...L, ...R].map(([n, c, st]) => sticker(n, c, st)), sticker('plane', 'a-fly', 'top:8%;left:-10%;width:64px;--d:18s'), sticker('cloud', 'a-drift', 'top:26%;left:5%;width:80px'), sticker('cloud', 'a-drift', 'top:46%;right:6%;width:70px'));
    document.body.prepend(box); };
  const decorate = () => { const H = holidayOn(todayStr()); const root = document.documentElement; root.setAttribute('data-theme', THEME); root.setAttribute('data-accent', themeOf()); root.setAttribute('data-person', themeOf()); root.style.setProperty('--page', checkerUrl(themeOf(), THEME)); sideDeco(); root.lang = LANG;
    if (H) root.setAttribute('data-holiday', H.key); else root.removeAttribute('data-holiday');
    const sky = document.getElementById('sky'); sky.replaceChildren(); if (H && !matchMedia('(prefers-reduced-motion: reduce)').matches) for (let i = 0; i < 16; i++) sky.append(h('span', { class: 'flake', style: `left:${Math.random() * 100}%;animation-duration:${12 + Math.random() * 12}s;animation-delay:-${Math.random() * 20}s;--dr:${(Math.random() - 0.5) * 120}px;--sp:${Math.random() * 360}deg`, 'aria-hidden': 'true' }, H.icons[i % H.icons.length])); };
