import { h, mount, state, get, post, put, patch, del, modal, toast, fail, action, confirmDialog, field, linkBtn, empty, bar, statusBadge, reviewBadge, STATUS, REVIEW,
  fmtDay, fmtDayShort, fmtDT, mins, pct, addDays, weekStartOf, monthLabel } from './ui.js';
import { renderWeek } from './child.js';
import { renderImport, renderTimetables, renderSettings, renderMonthly } from './parent2.js';

const TABS = [['overview', 'Overview'], ['schedules', 'Schedules'], ['tasks', 'Tasks'], ['import', 'Import'], ['review', 'Review & Help'], ['progress', 'Progress'], ['timetables', 'Timetables'], ['settings', 'Reminders & Settings'], ['monthly', 'Monthly']];
const kidName = (id) => (state.children.find((c) => c.id === id) || { name: id }).name;
const kidColor = (id) => `var(--${id})`;

export async function renderParent(main, tab, query) {
  const body = h('div');
  mount(main, h('div', { class: 'page-title' }, h('h1', null, 'Parent Dashboard')),
    h('nav', { class: 'tabs', 'aria-label': 'Dashboard sections' }, TABS.map(([id, label]) => h('a', { class: 'tab', href: `#/parent/${id}`, 'aria-current': tab === id ? 'page' : null }, label))), body);
  const fn = { overview: renderOverview, schedules: renderSchedules, tasks: renderTasks, import: renderImport, review: renderReview, progress: renderProgress, timetables: renderTimetables, settings: renderSettings, monthly: renderMonthly }[tab] || renderOverview;
  await fn(body, query);
  document.getElementById('main').focus({ preventScroll: true });
}
const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

// ---------- Overview ----------
async function renderOverview(body, query) {
  const d = await get(`/api/parent/overview${query.week ? `?week=${query.week}` : ''}`);
  const parts = [];
  if (d.demo_loaded) parts.push(h('div', { class: 'card warnbox row between' }, h('span', null, '🧪 Demo tasks are loaded. They are marked “Demo” and are not part of your real records.'),
    h('button', { class: 'btn small danger', type: 'button', onclick: action(async () => { if (await confirmDialog({ title: 'Remove demo data?', message: 'Only the demo tasks are removed. Your own tasks stay.', confirm: 'Remove demo data', danger: true })) { const r = await del('/api/parent/demo'); toast(`Removed ${r.removed ?? ''} demo item(s).`); rerender(); } }) }, 'Remove demo data')));
  if (d.pending_months && d.pending_months.length) parts.push(h('div', { class: 'card warnbox' }, `A month-end reset is waiting: ${d.pending_months.map(monthLabel).join(', ')}. `, h('a', { href: '#/parent/monthly' }, 'Open Monthly')));
  if (d.todo.length) parts.push(h('div', { class: 'card' }, h('h2', null, 'Things to do'), h('ul', null, d.todo.map((t) => h('li', null, t.message, ' ', h('a', { href: `#/parent/${t.view}` }, 'Open'))))));
  const nav = h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: () => (location.hash = `#/parent/overview?week=${addDays(d.week_start, -7)}`) }, '◀ Previous week'),
    h('strong', null, `Week of ${fmtDay(d.week_start)}`), h('button', { class: 'btn small', type: 'button', onclick: () => (location.hash = `#/parent/overview?week=${addDays(d.week_start, 7)}`) }, 'Next week ▶'));
  parts.push(nav);
  parts.push(h('div', { class: 'two-col' }, d.children.map((c) => childCard(c, d))));
  parts.push(h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => previewDialog(['ben', 'shin'], d.week_start, 'week') }, 'Suggest weekly schedule (both)'),
    h('button', { class: 'btn', type: 'button', onclick: () => previewDialog(['ben', 'shin'], d.today, 'unfinished') }, 'Reschedule unfinished tasks (both)')));
  mount(body, h('div', { class: 'stack' }, parts));
}

function childCard(c, d) {
  const w = c.week, id = c.child.id;
  const cnt = (label, n, href, cls = '') => h('a', { class: `counter ${n ? cls : ''}`, href }, h('strong', null, n), h('span', null, label));
  return h('section', { class: 'card child-card', style: { '--accent': kidColor(id) }, 'aria-label': `${c.child.name} this week` },
    h('div', { class: 'row between' }, h('h2', null, c.child.name), h('a', { class: 'btn small', href: `#/${id}/today` }, `Open ${c.child.name}'s board`)),
    h('div', null, h('div', { class: 'row between small' }, h('span', null, 'Tasks finished'), h('strong', null, `${w.completed} of ${w.total} (${pct(w.count_pct)})`)), bar(w.count_pct, `${c.child.name} task completion`),
      h('div', { class: 'row between small' }, h('span', null, 'By time'), h('strong', null, pct(w.weighted_pct))), bar(w.weighted_pct, `${c.child.name} time-weighted completion`, 'alt'),
      h('div', { class: 'small muted' }, `On time: ${w.on_time.eligible ? `${w.on_time.on_time} of ${w.on_time.eligible} (${pct(w.on_time.rate_pct)})` : 'nothing finished with a deadline yet'}`)),
    h('div', { class: 'counters' },
      cnt('Overdue', c.overdue.length, '#/parent/tasks?child=' + id + '&overdue=1', 'bad'), cnt('Unscheduled', c.unscheduled.length, '#/parent/tasks?child=' + id + '&unscheduled=1', 'warn'),
      cnt('Awaiting review', c.awaiting_review.length, '#/parent/review', 'warn'), cnt('Changes requested', c.revisions.length, '#/parent/review'), cnt('Help requests', c.help_open.length, '#/parent/review', 'bad'),
      cnt('Overloaded days', c.overloaded_days.length, '#/parent/schedules', 'warn')),
    c.unconfirmed_estimates ? h('p', { class: 'small warn-line' }, `${c.unconfirmed_estimates} task(s) use a suggested time that you have not confirmed.`) : null,
    h('div', { class: 'workload', role: 'img', 'aria-label': `${c.child.name} planned minutes per day` }, w.days.map((x) => {
      const hh = Math.min(100, Math.round((x.planned_minutes / Math.max(x.cap, 1)) * 100));
      return h('div', { class: 'wl-col', title: `${fmtDay(x.date)}: ${mins(x.planned_minutes)} of ${mins(x.cap)}` }, h('div', { class: `wl-bar ${x.overloaded ? 'over' : ''}`, style: { height: `${Math.max(hh, 3)}%` } }), h('span', { class: 'small' }, fmtDay(x.date).slice(0, 3)));
    })),
    h('div', { class: 'row' }, h('button', { class: 'btn small primary', type: 'button', onclick: () => previewDialog([id], d.week_start, 'week') }, `Suggest schedule for ${c.child.name}`),
      h('button', { class: 'btn small', type: 'button', onclick: () => previewDialog([id], d.today, 'unfinished') }, 'Reschedule unfinished')));
}

// ---------- scheduling preview ----------
export async function previewDialog(childIds, weekStart, mode) {
  let res;
  try { res = await post('/api/parent/schedule/preview', { child_ids: childIds, week_start: weekStart, mode }); } catch (e) { return fail(e); }
  const body = h('div', { class: 'stack' }, h('p', { class: 'muted' }, mode === 'week' ? 'This is only a preview. Nothing changes until you press “Apply”. Finished and locked sessions are always kept.' : 'Only unfinished tasks are moved to the future. Original deadlines are kept.'));
  for (const p of res.previews) {
    const byDay = {};
    for (const s of p.sessions) (byDay[s.planned_date] ||= []).push(s);
    body.append(h('section', { class: 'card', style: { '--accent': kidColor(p.child.id) } }, h('h3', null, p.child.name),
      h('p', { class: 'small' }, `${p.sessions.length} new session(s), ${p.removed_count} old planned session(s) will be replaced. Kept: ${p.done_kept} finished, ${p.locked_kept} locked.`),
      Object.keys(byDay).sort().map((day) => h('div', null, h('strong', null, fmtDay(day)), h('ul', null, byDay[day].map((s) => h('li', null, `${s.start_time}–${s.end_time} ${s.title} (${mins(s.minutes)})`))))),
      p.sessions.length ? null : h('p', { class: 'muted' }, 'Nothing new to plan.'),
      p.unscheduled.length ? h('div', { class: 'warnbox card' }, h('strong', null, 'Could not be placed:'), h('ul', null, p.unscheduled.map((u) => h('li', null, `${u.title || u.task_id}: ${u.reason}`)))) : null,
      p.warnings && p.warnings.length ? h('ul', { class: 'warn-line' }, p.warnings.map((w) => h('li', null, w.message || w))) : null));
  }
  modal({ title: mode === 'week' ? 'Suggested weekly schedule' : 'Reschedule unfinished tasks', wide: true, body,
    actions: [{ label: 'Cancel', onclick: () => {} }, { label: 'Apply', primary: true, onclick: async () => {
      const r = await post('/api/parent/schedule/apply', { proposal_ids: res.previews.map((p) => p.proposal_id) });
      toast('Schedule applied.'); rerender(); return r; } }] });
}

// ---------- Schedules (side by side) ----------
async function renderSchedules(body, query) {
  const week = query.week || weekStartOf(state.today);
  const cols = ['ben', 'shin'].map((id) => h('div', { class: 'card', style: { '--accent': kidColor(id) } }, h('h2', null, kidName(id)), h('div', { 'data-slot': id })));
  const nav = h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: () => (location.hash = `#/parent/schedules?week=${addDays(week, -7)}`) }, '◀'),
    h('strong', null, `Week of ${fmtDay(week)}`), h('button', { class: 'btn small', type: 'button', onclick: () => (location.hash = `#/parent/schedules?week=${addDays(week, 7)}`) }, '▶'),
    h('button', { class: 'btn small primary', type: 'button', onclick: () => previewDialog(['ben', 'shin'], week, 'week') }, 'Suggest schedule (both)'));
  mount(body, h('div', { class: 'stack' }, nav, h('div', { class: 'two-col' }, cols)));
  await Promise.all(['ben', 'shin'].map((id) => renderWeek(body.querySelector(`[data-slot=${id}]`), id, week, { compact: true, readonly: true })));
  body.append(h('p', { class: 'hint' }, 'To change one session, open the child’s board: the same data is shown there. Children can drag, lock and re-time their own sessions.'));
}

// ---------- Tasks ----------
async function renderTasks(body, query) {
  const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v));
  const d = await get(`/api/parent/tasks?${q}`);
  const sel = (name, opts, cur) => h('select', { 'aria-label': name, onchange: (e) => { const p = new URLSearchParams(Object.entries(query).filter(([, v]) => v)); e.target.value ? p.set(name, e.target.value) : p.delete(name); location.hash = `#/parent/tasks?${p}`; } },
    h('option', { value: '' }, `All (${name})`), opts.map(([v, l]) => h('option', { value: v, selected: cur === v }, l)));
  const filters = h('div', { class: 'row filters' }, sel('child', state.children.map((c) => [c.id, c.name]), query.child), sel('subject', d.subjects.map((s) => [s, s]), query.subject),
    sel('status', Object.entries(STATUS).map(([k, [l]]) => [k, l]), query.status), sel('review', Object.entries(REVIEW).map(([k, [l]]) => [k, l]), query.review),
    h('input', { type: 'date', 'aria-label': 'Week containing', value: query.week || '', onchange: (e) => { const p = new URLSearchParams(Object.entries(query).filter(([, v]) => v)); e.target.value ? p.set('week', e.target.value) : p.delete('week'); location.hash = `#/parent/tasks?${p}`; } }),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: query.overdue === '1', onchange: (e) => { const p = new URLSearchParams(Object.entries(query).filter(([, v]) => v)); e.target.checked ? p.set('overdue', '1') : p.delete('overdue'); location.hash = `#/parent/tasks?${p}`; } }), 'Overdue only'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: query.unscheduled === '1', onchange: (e) => { const p = new URLSearchParams(Object.entries(query).filter(([, v]) => v)); e.target.checked ? p.set('unscheduled', '1') : p.delete('unscheduled'); location.hash = `#/parent/tasks?${p}`; } }), 'Unscheduled only'));
  const rows = d.tasks.map((t) => h('tr', { class: t.cancelled_at ? 'cancelled' : '' },
    h('td', null, h('span', { class: 'dot', style: { background: kidColor(t.child_id) }, 'aria-hidden': 'true' }), ' ', kidName(t.child_id)),
    h('td', null, h('strong', null, t.title), t.is_demo ? h('span', { class: 'chip demo', style: { marginLeft: '.3rem' } }, 'Demo') : null, h('div', { class: 'small muted' }, t.subject)),
    h('td', null, t.deadline ? fmtDT(t.deadline) : '–', t.overdue ? h('div', { class: 'warn-line small' }, 'Overdue') : null),
    h('td', null, mins(t.est_minutes), t.est_source === 'system' && !t.est_confirmed ? h('div', { class: 'small warn-line' }, 'suggested') : null),
    h('td', null, statusBadge(t.status), ' ', reviewBadge(t.review_status), t.planned_minutes < t.est_minutes && t.status !== 'done' ? h('div', { class: 'small warn-line' }, 'not fully scheduled') : null),
    h('td', { class: 'actions' }, h('button', { class: 'btn small', type: 'button', onclick: () => taskDialog(t) }, 'Edit'),
      t.est_source === 'system' && !t.est_confirmed ? h('button', { class: 'btn small', type: 'button', onclick: action(async () => { await post(`/api/parent/tasks/${t.id}/confirm-estimate`); toast('Time confirmed.'); rerender(); }) }, 'Confirm time') : null,
      t.status === 'done' && !t.cancelled_at ? h('button', { class: 'btn small', type: 'button', onclick: action(async () => { await post(`/api/parent/tasks/${t.id}/reopen`); toast('Task reopened.'); rerender(); }) }, 'Reopen') : null,
      !t.cancelled_at ? h('button', { class: 'btn small danger', type: 'button', onclick: action(async () => { if (await confirmDialog({ title: 'Cancel this task?', message: `“${t.title}” will be removed from the plan and from statistics.`, confirm: 'Cancel task', danger: true })) { await post(`/api/parent/tasks/${t.id}/cancel`); rerender(); } }) }, 'Cancel') : h('span', { class: 'muted small' }, 'Cancelled'))));
  mount(body, h('div', { class: 'stack' }, h('div', { class: 'row between' }, h('h2', null, `Tasks (${d.tasks.length})`), h('button', { class: 'btn primary', type: 'button', onclick: () => taskDialog(null) }, '+ Add task')), filters,
    d.tasks.length ? h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Child', 'Task', 'Deadline', 'Time', 'Status', ''].map((x) => h('th', { scope: 'col' }, x)))), h('tbody', null, rows))) : empty('No tasks match. Try Import or “Add task”.')));
}

export function taskDialog(t, after = rerender) {
  const isNew = !t;
  const f = {
    child: h('select', null, state.children.map((c) => h('option', { value: c.id, selected: t && t.child_id === c.id }, c.name)), isNew ? h('option', { value: 'both' }, 'Both (two separate tasks)') : null),
    title: h('input', { value: t?.title || '', required: true }), subject: h('input', { value: t?.subject || '', list: 'subjects' }),
    type: h('select', null, [['workbook', 'Workbook'], ['cindy', 'Cindy class homework'], ['vinh', 'Cô Vinh homework'], ['other', 'Other']].map(([v, l]) => h('option', { value: v, selected: t?.task_type === v }, l))),
    ins: h('textarea', null, t?.instructions || ''), est: h('input', { type: 'number', min: 5, max: 900, value: t?.est_minutes || 60 }), dl: h('input', { type: 'datetime-local', value: t?.deadline || '' }), tg: h('input', { type: 'datetime-local', value: t?.target || '' }),
    week: h('input', { type: 'date', value: state.today }), rv: h('input', { type: 'checkbox', checked: t ? !!t.review_required : false }),
    link: h('input', { type: 'url', value: t?.resource_link || '', placeholder: 'https://…' }), work: h('input', { type: 'url', value: t?.work_link || '', placeholder: 'https://…' }), notes: h('textarea', null, t?.notes || '') };
  if (!isNew) f.child.disabled = true;
  modal({ title: isNew ? 'Add a task' : 'Edit task', wide: true, body: h('div', { class: 'form-grid' },
    field('Child', f.child), isNew ? field('Week (any day in it)', f.week) : null, field('Title', f.title), field('Subject', f.subject), field('Type', f.type), field('Estimated minutes', f.est),
    field('Deadline', f.dl), field('Target finish date', f.tg), field('Exercise link', f.link), field('Work file link', f.work), field('Instructions', f.ins), field('Note for the child', f.notes),
    h('label', { class: 'check' }, f.rv, 'I want to review this task before it counts as approved')),
    actions: [{ label: 'Cancel', onclick: () => {} }, { label: 'Save', primary: true, onclick: async () => {
      if (!f.title.value.trim()) { toast('Please enter a title.', 'error'); return false; }
      const item = { title: f.title.value, subject: f.subject.value || 'Other', task_type: f.type.value, instructions: f.ins.value, est_minutes: Number(f.est.value), est_source: 'parent', deadline: f.dl.value || null, target: f.tg.value || null,
        review_required: f.rv.checked ? 1 : 0, resource_link: f.link.value || null, work_link: f.work.value || null, notes: f.notes.value };
      if (isNew) await post('/api/parent/tasks', { items: [item], child_ids: f.child.value === 'both' ? 'both' : [f.child.value], week_start: f.week.value });
      else await patch(`/api/parent/tasks/${t.id}`, { ...item, est_source: undefined, version: t.version });
      toast('Saved.'); after(); } }] });
}

// ---------- Review & Help ----------
async function renderReview(body) {
  const [r, hp] = await Promise.all([get('/api/parent/review'), get('/api/parent/help')]);
  const card = (t, actionsEl) => h('article', { class: 'card', style: { '--accent': kidColor(t.child_id) } }, h('div', { class: 'row between' }, h('h3', null, `${t.child_name}: ${t.title}`), reviewBadge(t.review_status)),
    h('p', { class: 'small muted' }, `${t.subject}${t.deadline ? ` · due ${fmtDT(t.deadline)}` : ''}`),
    t.submissions.length ? h('ul', null, t.submissions.map((s) => h('li', null, `Round ${s.round}: `, s.link ? h('a', { href: s.link, target: '_blank', rel: 'noopener noreferrer' }, 'link') : null, s.file_id ? h('a', { href: `/api/files/${s.file_id}`, target: '_blank', rel: 'noopener' }, ` ${s.file_name || 'file'} `) : null, s.note ? `“${s.note}”` : ''))) : h('p', { class: 'muted small' }, 'No file or link was attached.'),
    t.reviews.length ? h('p', { class: 'small' }, `Earlier feedback: ${t.reviews.map((x) => x.feedback || x.decision).join(' | ')}`) : null,
    h('div', { class: 'row' }, t.resource_link ? linkBtn('Exercise', t.resource_link, 'btn small') : null, t.work_link ? linkBtn('Work file', t.work_link, 'btn small') : null, actionsEl));
  const decide = (t, decision) => async () => {
    const fb = h('textarea', { placeholder: decision === 'approved' ? 'Optional praise or note' : 'Tell them exactly what to fix' });
    modal({ title: decision === 'approved' ? `Approve: ${t.title}` : `Request changes: ${t.title}`, body: field(decision === 'approved' ? 'Comment (optional)' : 'What needs to change?', fb),
      actions: [{ label: 'Cancel', onclick: () => {} }, { label: decision === 'approved' ? 'Approve' : 'Send back for changes', primary: true, onclick: async () => {
        if (decision !== 'approved' && !fb.value.trim()) { toast('Please say what to change.', 'error'); return false; }
        await post(`/api/parent/tasks/${t.id}/review`, { decision, feedback: fb.value }); toast('Saved. The child has been notified.'); rerender(); } }] });
  };
  const parts = [h('h2', null, `Awaiting your review (${r.awaiting.length})`)];
  if (!r.awaiting.length) parts.push(empty('Nothing to review.'));
  r.awaiting.forEach((t) => parts.push(card(t, [h('button', { class: 'btn small primary', type: 'button', onclick: decide(t, 'approved') }, 'Approve'), h('button', { class: 'btn small danger', type: 'button', onclick: decide(t, 'changes_requested') }, 'Request changes')])));
  parts.push(h('h2', null, `Waiting for the child to fix (${r.revisions.length})`));
  if (!r.revisions.length) parts.push(empty('No open revision requests.'));
  r.revisions.forEach((t) => parts.push(card(t, null)));
  parts.push(h('h2', null, 'Help requests'));
  if (!hp.items.length) parts.push(empty('No help requests.'));
  hp.items.forEach((x) => {
    const reply = h('textarea', { placeholder: 'Write a reply', value: x.reply || '' }); reply.value = x.reply || '';
    parts.push(h('article', { class: `card ${x.status === 'open' ? 'warnbox' : ''}`, style: { '--accent': kidColor(x.child_id) } }, h('div', { class: 'row between' }, h('strong', null, `${x.child_name}${x.title ? `: ${x.title}` : ''}`), h('span', { class: 'small muted' }, x.status === 'open' ? 'Waiting for you' : 'Answered')),
      h('p', null, `“${x.message}”`), field('Your reply', reply), h('button', { class: 'btn small primary', type: 'button', onclick: action(async () => { if (!reply.value.trim()) { toast('Write a reply first.', 'error'); return; } await post(`/api/parent/help/${x.id}/reply`, { reply: reply.value }); toast('Reply sent.'); rerender(); }) }, x.status === 'open' ? 'Send reply' : 'Update reply')));
  });
  if (r.recent_approved.length) { parts.push(h('h2', null, 'Recently approved')); r.recent_approved.forEach((t) => parts.push(h('div', { class: 'card okbox small' }, `${t.child_name}: ${t.title}`))); }
  mount(body, h('div', { class: 'stack' }, parts));
}

// ---------- Progress ----------
async function renderProgress(body, query) {
  const p = new URLSearchParams(Object.entries(query).filter(([, v]) => v));
  const d = await get(`/api/parent/progress?${p}`);
  const set = (k, v) => { const n = new URLSearchParams(Object.entries(query).filter(([, x]) => x)); v ? n.set(k, v) : n.delete(k); location.hash = `#/parent/progress?${n}`; };
  const filters = h('div', { class: 'row filters' }, h('select', { 'aria-label': 'Child', onchange: (e) => set('child', e.target.value) }, h('option', { value: '' }, 'Both children'), state.children.map((c) => h('option', { value: c.id, selected: query.child === c.id }, c.name))),
    h('input', { type: 'date', 'aria-label': 'Week containing', value: query.week || d.week_start, onchange: (e) => set('week', e.target.value) }), h('input', { type: 'month', 'aria-label': 'Month', value: query.month || d.month, onchange: (e) => set('month', e.target.value) }),
    h('select', { 'aria-label': 'Status', onchange: (e) => set('status', e.target.value) }, h('option', { value: '' }, 'All statuses'), Object.entries(STATUS).map(([k, [l]]) => h('option', { value: k, selected: query.status === k }, l))));
  const cards = d.children.map((c) => {
    const w = c.week;
    const chart = h('div', { class: 'daychart', role: 'img', 'aria-label': `${c.child.name}: finished minutes versus planned minutes each day` }, w.days.map((x) => h('div', { class: 'dc-col' },
      h('div', { class: 'dc-bars', title: `${fmtDay(x.date)}: ${mins(x.done_minutes)} of ${mins(x.planned_minutes)} done` }, h('div', { class: 'dc-plan', style: { height: `${Math.min(100, (x.planned_minutes / Math.max(x.cap, 1)) * 100)}%` } }, h('div', { class: 'dc-done', style: { height: `${x.planned_minutes ? (x.done_minutes / x.planned_minutes) * 100 : 0}%` } })), ),
      h('span', { class: 'small' }, fmtDay(x.date).slice(0, 3)), h('span', { class: 'small muted' }, pct(x.weighted_pct)))));
    return h('section', { class: 'card', style: { '--accent': kidColor(c.child.id) } }, h('h2', null, c.child.name),
      h('div', { class: 'stats' },
        stat('This week, by tasks', `${w.completed} of ${w.total}`, pct(w.count_pct)), stat('This week, by time', `${mins(w.est_minutes_completed)} of ${mins(w.est_minutes_total)}`, pct(w.weighted_pct)),
        stat('On time', w.on_time.eligible ? `${w.on_time.on_time} of ${w.on_time.eligible}` : 'no data yet', pct(w.on_time.rate_pct)), stat(`Month ${monthLabel(c.month.month)}`, `${c.month.completed} of ${c.month.total}`, pct(c.month.count_pct))),
      h('h3', null, 'Each day (dark = finished, light = planned)'), chart,
      h('h3', null, 'By subject'), c.subject_breakdown.length ? h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Subject', 'Tasks finished', 'Time finished'].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', null, c.subject_breakdown.map((s) => h('tr', null, h('td', null, s.subject), h('td', null, `${s.completed} of ${s.total}`), h('td', null, `${mins(s.minutes_done)} of ${mins(s.minutes)}`)))))) : empty('No tasks this week.'),
      h('p', { class: 'small muted' }, c.actual && c.actual.recorded ? `Recorded actual study time: ${mins(c.actual.minutes)}.` : 'Actual study time is not recorded, so none is shown. “Time” above means the planned estimate of finished tasks.'),
      h('p', { class: 'small' }, `Awaiting review: ${w.awaiting_review} · Approved: ${w.approved} · Changes requested: ${w.changes_requested}`));
  });
  mount(body, h('div', { class: 'stack' }, filters, h('div', { class: 'two-col' }, cards)));
}
const stat = (label, value, p) => h('div', { class: 'stat' }, h('div', { class: 'small muted' }, label), h('strong', null, p), h('div', { class: 'small' }, value));
