import { h, mount, state, get, post, put, patch, del, api, modal, toast, fail, action, confirmDialog, field, empty,
  fmtDay, fmtDT, mins, pct, weekStartOf, monthLabel, DOW } from './ui.js';

const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
const kidName = (id) => (state.children.find((c) => c.id === id) || { name: id }).name;
const subjectsList = ['Maths', 'ESL', 'Science', 'English', 'Writing', 'Debate', 'Other'];

// ================= IMPORT =================
export async function renderImport(body) {
  const st = await get('/api/parent/import/status');
  const kids = h('div', { class: 'row', role: 'group', 'aria-label': 'Which child?' }, [['ben', 'Ben'], ['shin', 'Shin'], ['both', 'Both']].map(([v, l], i) =>
    h('label', { class: 'check' }, h('input', { type: 'radio', name: 'who', value: v, checked: i === 2 }), l)));
  const week = h('input', { type: 'date', value: weekStartOf(state.today) });
  const text = h('textarea', { rows: 8, placeholder: 'Paste the weekly task list here, one task per line.\nExample: Maths workbook – due Thu 07:00 – 45 min' });
  const files = h('input', { type: 'file', multiple: true, accept: '.pdf,.png,.jpg,.jpeg,.webp,.gif,.txt' });
  const links = h('textarea', { rows: 3, placeholder: 'Paste Google Drive links, one per line' });
  const out = h('div');
  const chosen = () => { const v = kids.querySelector('input:checked').value; return v === 'both' ? ['ben', 'shin'] : [v]; };
  const go = h('button', { class: 'btn primary', type: 'button', onclick: action(async () => {
    const ids = [];
    for (const f of files.files) { const r = await api('POST', `/api/files?kind=import&name=${encodeURIComponent(f.name)}`, undefined, { raw: f }); ids.push(r.file.id); }
    const r = await post('/api/parent/import/extract', { child_ids: chosen(), week_start: week.value, text: text.value, file_ids: ids, drive_links: links.value.split('\n').map((s) => s.trim()).filter(Boolean) });
    showPreview(out, r, chosen(), week.value);
  }) }, 'Read and preview');
  const tpl = h('button', { class: 'btn', type: 'button', onclick: action(async () => { const r = await post('/api/parent/templates/generate', { child_ids: chosen(), week_start: week.value }); showPreview(out, r, chosen(), week.value); }) }, 'Start from my weekly template');
  const manual = h('button', { class: 'btn', type: 'button', onclick: () => showPreview(out, { status: 'ok', items: [blankItem(chosen()[0])], notes: ['Enter the task by hand.'] }, chosen(), week.value) }, 'Type a task by hand');
  mount(body, h('div', { class: 'stack' }, h('div', { class: 'card stack' }, h('h2', null, 'Add this week’s work'),
    h('p', { class: 'muted small' }, 'Paste weekly tasks, use your weekly template, or type tasks by hand. Uploaded files (PDFs, images) are attached as reference materials for children.'),
    h('fieldset', null, h('legend', null, 'For whom?'), kids), field('Intended week (any day in it)', week), field('Pasted text', text), field('Pictures, PDFs or text files to attach (up to 10 MB each)', files), field('Google Drive links (not opened automatically)', links),
    h('div', { class: 'row' }, go, tpl, manual)), out));
}
const blankItem = (child) => ({ child_id: child, title: '', subject: 'Other', task_type: 'other', est_minutes: 60, est_source: 'parent', deadline: null, target: null, priority: 2, review_required: 0, resource_link: null, work_link: null, flags: [], from_source: [] });

function showPreview(out, r, childIds, weekStart) {
  const items = r.items.map((i) => ({ ...i, include: true }));
  const notes = (r.notes || []).map((n) => h('li', null, n));
  const rowsEl = h('div', { class: 'stack' });
  const draw = () => mount(rowsEl, items.map((it, idx) => itemEditor(it, idx, items, draw)));
  draw();
  mount(out, h('div', { class: 'card stack' }, h('h2', null, `Preview (${items.length})`), notes.length ? h('ul', { class: 'small' }, notes) : null,
    h('p', { class: 'hint' }, 'Values marked “from source” were read from your material. “Suggested” values (like estimated minutes) come from the app’s defaults. Please check them. Nothing is saved until you press Save.'),
    rowsEl,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => { items.push({ ...blankItem(childIds[0]), include: true }); draw(); } }, '+ Add another row'),
      h('button', { class: 'btn primary', type: 'button', onclick: action(async () => {
        const chosen = items.filter((i) => i.include);
        if (!chosen.length) return toast('Nothing is ticked.', 'error');
        if (chosen.some((i) => !i.title.trim())) return toast('Every ticked row needs a title.', 'error');
        try { const res = await post('/api/parent/import/confirm', { items: chosen.map(({ include, ...x }) => x), week_start: weekStart, source_ref: 'import' }); toast(`Saved ${res.created} task(s).`); mount(out, h('div', { class: 'card okbox' }, `Saved ${res.created} task(s). `, h('a', { href: '#/parent/tasks' }, 'See tasks'), ' · ', h('a', { href: '#/parent/overview' }, 'Suggest a schedule'))); }
        catch (e) { if (e.status === 409) { toast(e.message, 'error'); } else throw e; }
      }) }, 'Save ticked tasks'))));
}
function itemEditor(it, idx, items, draw) {
  const src = (k) => (it.from_source || []).includes(k) ? ' (from source)' : '';
  const inp = (k, type = 'text', extra = {}) => h('input', { type, value: it[k] ?? '', ...extra, oninput: (e) => { it[k] = type === 'number' ? Number(e.target.value) : (e.target.value || (type === 'text' ? '' : null)); if (k === 'est_minutes') it.est_source = 'parent'; } });
  const flags = [...(it.flags || [])];
  if (it.duplicate_of) flags.push(`Looks like an existing task: “${it.duplicate_of.title || it.duplicate_of}”.`);
  return h('div', { class: `card ${flags.length ? 'warnbox' : ''}` },
    h('div', { class: 'row between' }, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: it.include, onchange: (e) => (it.include = e.target.checked) }), h('strong', null, `Row ${idx + 1}`)),
      h('button', { class: 'btn small', type: 'button', onclick: () => { items.splice(idx, 1); draw(); } }, 'Remove row')),
    flags.length ? h('ul', { class: 'small warn-line' }, flags.map((f) => h('li', null, f))) : null,
    it.duplicate_of ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!it.confirm_duplicate, onchange: (e) => (it.confirm_duplicate = e.target.checked) }), 'Add anyway (it is not a duplicate)') : null,
    h('div', { class: 'form-grid' },
      field('Child', h('select', { onchange: (e) => (it.child_id = e.target.value) }, state.children.map((c) => h('option', { value: c.id, selected: it.child_id === c.id }, c.name)))),
      field(`Title${src('title')}`, inp('title')), field(`Subject${src('subject')}`, inp('subject', 'text', { list: 'subjects' })),
      field('Type', h('select', { onchange: (e) => (it.task_type = e.target.value) }, [['workbook', 'Workbook'], ['cindy', 'Cindy homework'], ['vinh', 'Cô Vinh homework'], ['other', 'Other']].map(([v, l]) => h('option', { value: v, selected: it.task_type === v }, l)))),
      field(`Minutes${it.est_source === 'system' ? ' (suggested, not from source)' : it.est_source === 'source' ? ' (from source)' : ''}`, inp('est_minutes', 'number', { min: 5, max: 900 })),
      field(`Deadline${src('deadline')}`, inp('deadline', 'datetime-local')), field(`Target finish${src('target')}`, inp('target', 'datetime-local')),
      field('Exercise link', inp('resource_link', 'url')), field('Work file link', inp('work_link', 'url')),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!it.review_required, onchange: (e) => (it.review_required = e.target.checked ? 1 : 0) }), 'I will review this')));
}

// ================= TIMETABLES =================
export async function renderTimetables(body) {
  const data = Object.fromEntries(await Promise.all(state.children.map(async (c) => [c.id, await get(`/api/parent/timetable/${c.id}`)])));
  const tpls = await get('/api/parent/templates');
  const parts = [h('p', { class: 'muted' }, 'Everything the planner needs to know about the week.')];
  for (const c of state.children) parts.push(childTimetable(c, data[c.id]));
  parts.push(templatesCard(tpls.templates));
  mount(body, h('div', { class: 'stack' }, parts));
}
function childTimetable(c, d) {
  const s = d.settings;
  const f = {};
  const t = (k) => (f[k] = h('input', { type: 'time', value: s[k] })); const n = (k, min, max) => (f[k] = h('input', { type: 'number', value: s[k], min, max }));
  const save = action(async () => {
    const v = {}; for (const k of Object.keys(f)) v[k] = f[k].value; v.email = s.email || '';
    await put(`/api/parent/child-settings/${c.id}`, v); toast('Study settings saved and confirmed.'); rerender();
  });
  const blocks = d.blocks.map((b) => h('tr', { class: b.needs_confirmation ? 'unconf' : '' },
    h('td', null, DOW[b.weekday]), h('td', null, `${b.start_time}–${b.end_time}`), h('td', null, b.needs_confirmation ? '⚠ ' : '', b.title, b.note ? h('div', { class: 'small muted' }, b.note) : null),
    h('td', null, b.mode || '–', (b.travel_before_min + b.travel_after_min) ? ` (+${mins(b.travel_before_min + b.travel_after_min)} travel)` : ''), h('td', null, b.week_parity === 'every' ? 'Every week' : `${b.week_parity} weeks only`),
    h('td', { class: 'actions' }, h('button', { class: 'btn small', type: 'button', onclick: () => blockDialog(c.id, b) }, 'Edit'),
      b.needs_confirmation ? h('button', { class: 'btn small', type: 'button', onclick: action(async () => { await put(`/api/parent/blocks/${b.id}`, { ...b, needs_confirmation: 0 }); rerender(); }) }, 'Confirm') : null,
      h('button', { class: 'btn small danger', type: 'button', onclick: action(async () => { if (await confirmDialog({ title: 'Delete this item?', message: b.title, confirm: 'Delete', danger: true })) { await del(`/api/parent/blocks/${b.id}`); rerender(); } }) }, 'Delete'))));
  const defs = d.defaults.map((x) => {
    const m = h('input', { type: 'number', value: x.minutes, min: 5, 'aria-label': `${x.task_type} minutes` }), sm = h('input', { type: 'number', value: x.session_min, min: 10, 'aria-label': `${x.task_type} session minutes` }), pd = h('input', { type: 'number', value: x.max_per_day, min: 1, max: 6, 'aria-label': `${x.task_type} per day` });
    x._m = m; x._s = sm; x._p = pd;
    return h('tr', null, h('td', null, { workbook: 'Workbook (per subject)', cindy: 'Cindy homework', vinh: 'Cô Vinh homework', other: 'Other tasks' }[x.task_type]), h('td', null, m), h('td', null, sm), h('td', null, pd));
  });
  return h('section', { class: 'card stack', style: { '--accent': `var(--${c.id})` } }, h('h2', null, c.name),
    !s.confirmed ? h('p', { class: 'warnbox card small' }, '⚠ These study hours and limits are default suggestions. Please check and press Save.') : null,
    h('h3', null, 'Study hours and limits'),
    h('div', { class: 'form-grid' }, field('Home and ready to study (school days)', t('home_weekday')), field('Weekend start', t('weekend_start')), field('Dinner starts', t('dinner_start')), field('Dinner ends', t('dinner_end')), field('Bedtime', t('bedtime')),
      field('Wind-down before bed (min)', n('wind_down_min', 0, 180)), field('Session length (min)', n('session_min', 10, 120)), field('Break between sessions (min)', n('break_min', 0, 60)), field('Max study, school day (min)', n('max_weekday_min', 15, 600)),
      field('Max study, weekend day (min)', n('max_weekend_min', 15, 720)), field('Spare time kept free each day (min)', n('spare_min', 0, 240))),
    h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Save study settings'),
    h('h3', null, 'Weekly fixed commitments'),
    h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Day', 'Time', 'What', 'Where', 'Repeats', ''].map((x) => h('th', { scope: 'col' }, x)))), h('tbody', null, blocks))),
    h('button', { class: 'btn', type: 'button', onclick: () => blockDialog(c.id, null) }, '+ Add timetable item'),
    h('h3', null, 'Default task lengths'),
    h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Kind', 'Total minutes', 'Session minutes', 'Max per day'].map((x) => h('th', { scope: 'col' }, x)))), h('tbody', null, defs))),
    h('button', { class: 'btn', type: 'button', onclick: action(async () => { await put(`/api/parent/task-defaults/${c.id}`, { defaults: d.defaults.map((x) => ({ task_type: x.task_type, minutes: Number(x._m.value), session_min: Number(x._s.value), max_per_day: Number(x._p.value) })) }); toast('Defaults saved.'); }) }, 'Save default lengths'));
}
function blockDialog(childId, b) {
  const f = {
    child: h('select', null, state.children.map((c) => h('option', { value: c.id, selected: (b?.child_id || childId) === c.id }, c.name))), title: h('input', { value: b?.title || '' }),
    kind: h('select', null, ['school', 'class', 'activity', 'meal', 'rest', 'other'].map((k) => h('option', { value: k, selected: (b?.kind || 'class') === k }, k))),
    day: h('select', null, [1, 2, 3, 4, 5, 6, 7].map((d) => h('option', { value: d, selected: (b?.weekday || 1) === d }, DOW[d]))), start: h('input', { type: 'time', value: b?.start_time || '' }), end: h('input', { type: 'time', value: b?.end_time || '' }),
    mode: h('select', null, h('option', { value: '' }, 'Not set'), ['online', 'offline'].map((m) => h('option', { value: m, selected: b?.mode === m }, m))),
    tb: h('input', { type: 'number', min: 0, value: b?.travel_before_min || 0 }), ta: h('input', { type: 'number', min: 0, value: b?.travel_after_min || 0 }),
    par: h('select', null, [['every', 'Every week'], ['odd', 'Odd weeks only'], ['even', 'Even weeks only']].map(([v, l]) => h('option', { value: v, selected: (b?.week_parity || 'every') === v }, l))), note: h('input', { value: b?.note || '' }) };
  modal({ title: b ? 'Edit timetable item' : 'Add timetable item', body: h('div', { class: 'form-grid' }, field('Child', f.child), field('What', f.title), field('Kind', f.kind), field('Day', f.day), field('Start', f.start), field('End', f.end), field('Online / offline', f.mode),
    field('Travel before (min)', f.tb), field('Travel after (min)', f.ta), field('Repeats', f.par), field('Note', f.note)),
    actions: [{ label: 'Cancel', onclick: () => {} }, { label: 'Save', primary: true, onclick: async () => {
      const v = { child_id: f.child.value, title: f.title.value, kind: f.kind.value, weekday: Number(f.day.value), start_time: f.start.value, end_time: f.end.value, mode: f.mode.value || null, travel_before_min: Number(f.tb.value), travel_after_min: Number(f.ta.value), week_parity: f.par.value, note: f.note.value, needs_confirmation: 0 };
      if (b) await put(`/api/parent/blocks/${b.id}`, v); else await post('/api/parent/blocks', v); toast('Saved.'); rerender(); } }] });
}
function templatesCard(list) {
  const rows = list.map((t) => h('tr', { class: t.active ? '' : 'cancelled' }, h('td', null, kidName(t.child_id)), h('td', null, t.title, h('div', { class: 'small muted' }, t.subject)),
    h('td', null, `${DOW[t.deadline_weekday]} ${t.deadline_time}`), h('td', null, t.target_weekday ? `${DOW[t.target_weekday]} ${t.target_time}` : '–'), h('td', null, t.estimate_min ? mins(t.estimate_min) : 'default'),
    h('td', { class: 'actions' }, h('button', { class: 'btn small', type: 'button', onclick: () => templateDialog(t) }, 'Edit'),
      h('button', { class: 'btn small danger', type: 'button', onclick: action(async () => { if (await confirmDialog({ title: 'Delete template?', message: t.title, confirm: 'Delete', danger: true })) { await del(`/api/parent/templates/${t.id}`); rerender(); } }) }, 'Delete'))));
  return h('section', { class: 'card stack' }, h('h2', null, 'Weekly templates'), h('p', { class: 'muted small' }, 'These repeat every week. Use Import → “Start from my weekly template” to create a week’s tasks from them.'),
    h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Child', 'Task', 'Deadline', 'Target', 'Time', ''].map((x) => h('th', { scope: 'col' }, x)))), h('tbody', null, rows))),
    h('button', { class: 'btn', type: 'button', onclick: () => templateDialog(null) }, '+ Add template'));
}
function templateDialog(t) {
  const dayOpts = (cur, blank) => [blank ? h('option', { value: '' }, 'None') : null, ...[1, 2, 3, 4, 5, 6, 7].map((d) => h('option', { value: d, selected: cur === d }, DOW[d]))];
  const f = { child: h('select', null, state.children.map((c) => h('option', { value: c.id, selected: t?.child_id === c.id }, c.name))), title: h('input', { value: t?.title || '' }), subject: h('input', { value: t?.subject || '' }),
    type: h('select', null, ['workbook', 'cindy', 'vinh', 'other'].map((k) => h('option', { value: k, selected: t?.task_type === k }, k))), dd: h('select', null, dayOpts(t?.deadline_weekday)), dt: h('input', { type: 'time', value: t?.deadline_time || '07:00' }),
    td: h('select', null, dayOpts(t?.target_weekday, true)), tt: h('input', { type: 'time', value: t?.target_time || '21:00' }), est: h('input', { type: 'number', min: 5, value: t?.estimate_min || '' }), rv: h('input', { type: 'checkbox', checked: !!t?.review_required }), act: h('input', { type: 'checkbox', checked: t ? !!t.active : true }) };
  modal({ title: t ? 'Edit template' : 'Add template', body: h('div', { class: 'form-grid' }, field('Child', f.child), field('Title', f.title), field('Subject', f.subject), field('Type', f.type), field('Deadline day', f.dd), field('Deadline time', f.dt), field('Target day', f.td), field('Target time', f.tt),
    field('Minutes (blank = default)', f.est), h('label', { class: 'check' }, f.rv, 'Needs my review'), h('label', { class: 'check' }, f.act, 'Active')),
    actions: [{ label: 'Cancel', onclick: () => {} }, { label: 'Save', primary: true, onclick: async () => {
      const v = { child_id: f.child.value, title: f.title.value, subject: f.subject.value, task_type: f.type.value, deadline_weekday: Number(f.dd.value), deadline_time: f.dt.value, target_weekday: f.td.value ? Number(f.td.value) : null, target_time: f.tt.value, estimate_min: f.est.value ? Number(f.est.value) : null, review_required: f.rv.checked ? 1 : 0, active: f.act.checked ? 1 : 0 };
      if (t) await put(`/api/parent/templates/${t.id}`, v); else await post('/api/parent/templates', v); toast('Saved.'); rerender(); } }] });
}


// ================= SETTINGS =================
export async function renderSettings(body) {
  const s = await get('/api/parent/settings');
  const st = s.email_status;
  const rem = s.reminders;
  const labels = { daily_plan: 'Daily plan (to the children)', check_in: 'Evening check-in', parent_summary: 'Parent summary' };
  const f = { email: h('input', { type: 'email', value: s.parent_email || '' }), kids: {} };
  state.children.forEach((c) => (f.kids[c.id] = h('input', { type: 'email', value: s.child_emails[c.id] || '', placeholder: 'optional' })));
  const rr = {};
  const remRows = Object.keys(labels).filter((k) => rem[k]).map((k) => {
    const r = rem[k]; rr[k] = { en: h('input', { type: 'checkbox', checked: !!r.enabled }), time: h('input', { type: 'time', value: r.time }), par: h('input', { type: 'checkbox', checked: r.to_parent !== false && !!r.to_parent || k === 'parent_summary' }), kid: k === 'parent_summary' ? null : h('input', { type: 'checkbox', checked: !!r.to_children }) };
    return h('tr', null, h('td', null, labels[k]), h('td', null, h('label', { class: 'check' }, rr[k].en, 'On')), h('td', null, rr[k].time), h('td', null, h('label', { class: 'check' }, rr[k].par, 'Parent')), h('td', null, rr[k].kid ? h('label', { class: 'check' }, rr[k].kid, 'Children') : '–'),
      h('td', null, h('button', { class: 'btn small', type: 'button', onclick: action(async () => { const p = await post('/api/parent/reminders/preview', { kind: k, child_id: k === 'parent_summary' ? null : 'ben' }); modal({ title: 'Preview', body: h('div', null, h('strong', null, p.subject), h('pre', { class: 'preview-text' }, p.text || p.body || '')), actions: [{ label: 'Close', primary: true, onclick: () => {} }] }); }) }, 'Preview')));
  });
  const testTo = h('input', { type: 'email', value: s.parent_email || '' });
  const save = action(async () => {
    const reminders = {}; for (const k of Object.keys(rr)) reminders[k] = { enabled: rr[k].en.checked, time: rr[k].time.value, to_parent: rr[k].par.checked, to_children: rr[k].kid ? rr[k].kid.checked : undefined };
    await put('/api/parent/settings', { parent_email: f.email.value, child_emails: Object.fromEntries(Object.entries(f.kids).map(([k, v]) => [k, v.value])), reminders }); toast('Settings saved.'); rerender();
  });
  const pw = (c) => { const p = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'New PIN or password (6+ characters)' }); return h('div', { class: 'row' }, h('strong', null, c.name), p, h('button', { class: 'btn small', type: 'button', onclick: action(async () => { await post(`/api/parent/users/${c.id}/password`, { password: p.value }); p.value = ''; toast(`${c.name}'s sign-in was changed.`); }) }, 'Change')); };
  mount(body, h('div', { class: 'stack' },
    h('section', { class: 'card stack' }, h('h2', null, 'Email'), st.configured ? h('p', { class: st.real ? 'okbox card' : 'warnbox card' }, st.real ? `Connected: ${st.provider}.` : `Developer outbox only: emails are written to a file and NOT really sent. ${st.note || ''}`)
      : h('p', { class: 'warnbox card' }, `Not connected. ${st.note || ''} Reminders are created as in-app notifications only. See the setup guide for SMTP or Resend.`),
      h('div', { class: 'form-grid' }, field('Your email (parent)', f.email), state.children.map((c) => field(`${c.name}'s email (optional)`, f.kids[c.id]))),
      h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Reminder', '', 'Time', '', '', ''].map((x) => h('th', null, x)))), h('tbody', null, remRows))),
      h('p', { class: 'hint' }, 'Times are Vietnam time (Asia/Ho_Chi_Minh). Emails go out from the server even when the website is closed, once email is connected. Push notifications and Zalo are not part of this app.'),
      h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Save'),
      h('div', { class: 'row' }, testTo, h('button', { class: 'btn', type: 'button', onclick: action(async () => { const r = await post('/api/parent/settings/test-email', { to: testTo.value }); toast(r.ok ? r.note : r.error, r.ok && /^A test/.test(r.note) ? 'ok' : 'error'); }) }, 'Send test email'))),
    h('section', { class: 'card stack' }, h('h2', null, 'Delivery log'), s.failures.length ? h('div', { class: 'card alert' }, h('strong', null, `${s.failures.length} failed delivery(ies):`), h('ul', null, s.failures.map((x) => h('li', null, `${x.run_date} ${x.kind} → ${x.recipient}: ${x.error || 'unknown error'} (${x.attempts} attempts)`)))) : h('p', { class: 'muted' }, 'No failed deliveries.'),
      s.reminder_log.length ? h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Date', 'Kind', 'To', 'Status'].map((x) => h('th', null, x)))), h('tbody', null, s.reminder_log.map((x) => h('tr', null, h('td', null, x.run_date), h('td', null, x.kind), h('td', null, x.recipient), h('td', null, x.status)))))) : null),
    h('section', { class: 'card stack' }, h('h2', null, 'Sign-ins'), state.children.map(pw), h('p', { class: 'hint' }, 'Your own password can be changed from the menu at the top right.')),
    h('section', { class: 'card stack' }, h('h2', null, 'Demo data'), h('p', { class: 'muted' }, 'Demo tasks are marked and can be removed in one click without touching your real tasks.'),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: action(async () => { await post('/api/parent/demo/load'); toast('Demo tasks added for this week.'); }) }, 'Load demo tasks'),
        h('button', { class: 'btn danger', type: 'button', onclick: action(async () => { if (await confirmDialog({ title: 'Remove demo data?', message: 'Only demo tasks are removed.', confirm: 'Remove', danger: true })) { await del('/api/parent/demo'); toast('Demo data removed.'); } }) }, 'Remove demo data')))));
}

// ================= MONTHLY =================
export async function renderMonthly(body) {
  const d = await get('/api/parent/monthly');
  const reset = d.reset;
  const pol = (v, title, text) => h('label', { class: 'card check policy' }, h('input', { type: 'radio', name: 'pol', value: v, checked: reset.policy === v }), h('div', null, h('strong', null, title), h('div', { class: 'small' }, text)));
  const polBox = h('div', { class: 'stack' }, pol('carry', 'A: Carry unfinished tasks forward', 'Unfinished tasks move to the new month with their original deadlines. They are never marked complete.'),
    pol('close', 'B: Close unfinished tasks', 'Unfinished tasks are counted as not finished in the report, then removed. Nothing is marked complete.'));
  const auto = h('input', { type: 'checkbox', checked: !!reset.auto_enabled });
  const monthSel = h('input', { type: 'month', value: d.pending[0] || d.current_month });
  const parts = [h('section', { class: 'card stack' }, h('h2', null, 'Month-end policy'), reset.policy ? null : h('p', { class: 'warnbox card' }, 'No policy chosen yet. Automatic reset stays off until you choose one.'), polBox,
    h('label', { class: 'check' }, auto, 'Run the reset automatically at 00:10 on the 1st of each month (Vietnam time)'),
    h('button', { class: 'btn primary', type: 'button', onclick: action(async () => { const v = polBox.querySelector('input:checked'); await put('/api/parent/settings', { reset: { policy: v ? v.value : null, auto_enabled: auto.checked } }); toast('Saved.'); rerender(); }) }, 'Save policy'))];
  parts.push(h('section', { class: 'card stack' }, h('h2', null, 'Monthly reset'), d.pending.length ? h('p', { class: 'warnbox card' }, `Waiting: ${d.pending.map(monthLabel).join(', ')}`) : h('p', { class: 'muted' }, 'No finished month is waiting.'),
    h('p', { class: 'small' }, 'A report for each child is saved and checked first. Only then are detailed records cleared. Accounts, timetables, templates, earlier reports and Google Drive files are never touched.'),
    h('div', { class: 'row' }, field('Month', monthSel), h('button', { class: 'btn primary', type: 'button', onclick: action(async () => { await resetPreview(monthSel.value); }) }, 'Preview monthly reset'))));
  parts.push(h('h2', null, 'Saved reports'));
  if (!d.reports.length) parts.push(empty('No monthly reports yet. They appear after the first reset.'));
  d.reports.forEach((r) => parts.push(reportCard(r)));
  mount(body, h('div', { class: 'stack' }, parts));
}
async function resetPreview(month) {
  const p = await get(`/api/parent/monthly/preview?month=${month}`);
  const w = p.will_clear;
  const body = h('div', { class: 'stack' },
    !p.policy_chosen ? h('p', { class: 'warnbox card' }, 'No policy chosen yet: the preview assumes “close”. Choose a policy before running.') : null,
    !p.month_finished ? h('p', { class: 'warnbox card' }, 'This month is not finished yet.') : null,
    h('p', null, `Status: ${p.status}. Automatic run would be at ${p.runs_at}.`),
    p.reports.map(reportSummary),
    h('div', { class: 'card' }, h('h3', null, 'Will be cleared after the reports are saved and checked'), h('ul', null, [`${w.tasks} task(s)`, `${w.sessions} session(s)`, `${w.submissions} submission(s)`, `${w.reviews} review(s)`, `${w.help_requests} help request(s)`, `${w.uploaded_files} uploaded file(s) (${Math.round(w.uploaded_bytes / 1024)} KB) on this server`].map((x) => h('li', null, x)))),
    p.carried_forward.length ? h('div', { class: 'card' }, h('h3', null, 'Carried forward'), h('ul', null, p.carried_forward.map((t) => h('li', null, `${kidName(t.child_id)}: ${t.title}${t.deadline ? ` (due ${fmtDT(t.deadline)})` : ''}`)))) : null,
    p.carried_for_review_only.length ? h('div', { class: 'card' }, h('h3', null, 'Kept only for your review'), h('ul', null, p.carried_for_review_only.map((t) => h('li', null, `${kidName(t.child_id)}: ${t.title}`)))) : null,
    p.closed_unfinished.length ? h('div', { class: 'card warnbox' }, h('h3', null, 'Unfinished and closed'), h('ul', null, p.closed_unfinished.map((t) => h('li', null, `${kidName(t.child_id)}: ${t.title}`)))) : null,
    h('p', { class: 'small muted' }, p.kept.note));
  const confirmIn = h('input', { placeholder: `RESET ${month}`, 'aria-label': 'Type the confirmation words' });
  modal({ title: `Monthly reset preview: ${monthLabel(month)}`, wide: true, body: h('div', { class: 'stack' }, body, field(`To run it now, type RESET ${month}`, confirmIn)),
    actions: [{ label: 'Close', onclick: () => {} }, { label: 'Run reset now', primary: true, onclick: async () => {
      if (!p.policy_chosen) { toast('Choose a policy first.', 'error'); return false; }
      const r = await post('/api/parent/monthly/run', { month, confirm: confirmIn.value.trim() }); toast(r.status === 'done' ? 'Reset finished.' : `Reset: ${r.status}`); rerender(); } }] });
}
const reportSummary = (r) => h('div', { class: 'card' }, h('h3', null, r.child.name),
  h('ul', null, [`Tasks: ${r.total_eligible} (${r.newly_assigned} new, ${r.carried_in} carried in)`, `Finished: ${r.completed} (${pct(r.completion_count_pct)} by count, ${pct(r.completion_weighted_pct)} by estimated time)`,
    `Unfinished: ${r.unfinished.total}`, `On time: ${r.on_time.eligible ? `${r.on_time.on_time} of ${r.on_time.eligible}` : 'no data'}`, `Review: ${r.review.approved} approved of ${r.review.required} needing review; ${r.review.change_requests_total} change request(s)`, `Help requests: ${r.help_requests}`,
    r.actual_minutes.recorded ? `Recorded actual time: ${mins(r.actual_minutes.total)}` : 'Actual study time was not recorded.'].map((x) => h('li', null, x))));
function reportCard(r) {
  const c = h('textarea', { rows: 3, placeholder: 'Your comment on this month' }); c.value = r.parent_comment || '';
  const p = h('textarea', { rows: 3, placeholder: 'Priorities for next month' }); p.value = r.next_month_priorities || '';
  return h('details', { class: 'card' }, h('summary', null, h('strong', null, `${monthLabel(r.month)} · ${r.data.child.name}`), ` · ${pct(r.data.completion_count_pct)} finished`),
    reportSummary(r.data), r.data.subjects.length ? h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Subject', 'Finished'].map((x) => h('th', null, x)))), h('tbody', null, r.data.subjects.map((s) => h('tr', null, h('td', null, s.subject), h('td', null, `${s.completed} of ${s.total}`)))))) : null,
    field('Parent comment', c), field('Next month’s priorities', p), h('button', { class: 'btn small primary', type: 'button', onclick: action(async () => { await patch(`/api/parent/reports/${r.id}`, { parent_comment: c.value, next_month_priorities: p.value }); toast('Comment saved.'); }) }, 'Save comment'));
}
