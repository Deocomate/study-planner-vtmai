import { h, mount, state, get, post, api, modal, toast, fail, action, confirmDialog, field, linkBtn, empty, bar, statusBadge, reviewBadge, STATUS,
  fmtDay, fmtDayShort, fmtDT, mins, pct, addDays, weekStartOf, uuid, DOW } from './ui.js';

const nameOf = (id) => (state.children.find((c) => c.id === id) || { name: id }).name;
const tabsFor = (childId, tab, counts) => h('nav', { class: 'tabs', 'aria-label': 'Board sections' }, [
  ['today', 'Today'], ['week', 'This Week'], ['feedback', 'Feedback & Revisions']].map(([id, label]) =>
  h('a', { class: 'tab', href: `#/${childId}/${id}`, 'aria-current': tab === id ? 'page' : null }, label, id === 'feedback' && counts ? h('span', { class: 'pill', 'aria-label': `${counts} need attention` }, counts) : null)));

export async function renderChildBoard(main, childId, tab, query) {
  const c = state.children.find((x) => x.id === childId);
  const feedback = await get(`/api/board/${childId}/feedback`);
  const attention = feedback.revisions.length;
  const head = h('div', { class: 'page-title' }, h('span', { class: 'avatar' }, c.name[0]), h('div', null, h('h1', null, `${c.name}'s Board`),
    state.user.role === 'parent' ? h('div', { class: 'muted small' }, 'You are viewing this board as a parent. You can adjust the plan here too.') : null));
  const body = h('div');
  mount(main, head, tabsFor(childId, tab, attention), body);
  if (tab === 'week') await renderWeek(body, childId, query.week);
  else if (tab === 'feedback') renderFeedback(body, childId, feedback);
  else await renderToday(body, childId);
  document.getElementById('main').focus({ preventScroll: true });
}

// ---------- shared dialogs ----------
export async function openTaskDetail(taskId) {
  const d = await get(`/api/tasks/${taskId}`);
  const t = d.task;
  const body = h('div', { class: 'stack' },
    h('div', { class: 'row' }, statusBadge(t.status), reviewBadge(t.review_status), t.is_demo ? h('span', { class: 'chip demo' }, 'Demo') : null, h('span', { class: 'chip' }, t.subject)),
    t.instructions ? h('div', null, h('strong', null, 'Instructions'), h('p', { style: { whiteSpace: 'pre-wrap' } }, t.instructions)) : null,
    t.notes ? h('div', null, h('strong', null, 'Note from your parent'), h('p', { style: { whiteSpace: 'pre-wrap' } }, t.notes)) : null,
    h('p', null, h('strong', null, 'Deadline: '), t.deadline ? fmtDT(t.deadline) : 'none', '  ·  ', h('strong', null, 'Estimated: '), mins(t.est_minutes), t.est_source === 'system' && !t.est_confirmed ? ' (suggested, not confirmed yet)' : ''),
    h('div', { class: 'row' }, t.resource_link ? linkBtn('Open Exercise', t.resource_link, 'btn primary') : h('span', { class: 'muted' }, 'No exercise link yet.'),
      t.work_link ? linkBtn('Open Work File', t.work_link) : h('span', { class: 'muted' }, 'No work file link yet.'),
      t.source_file_id ? h('a', { class: 'btn', href: `/api/files/${t.source_file_id}`, target: '_blank', rel: 'noopener' }, 'Open original sheet') : null),
    d.sessions.length ? h('div', null, h('strong', null, 'Planned sessions'), h('ul', null, d.sessions.map((s) => h('li', null, `${fmtDay(s.planned_date)} ${s.start_time}-${s.end_time} (${mins(s.minutes)}) – ${s.status === 'done' ? 'finished' : 'planned'}${s.locked ? ', locked' : ''}`)))) : h('p', { class: 'muted' }, 'Not planned yet.'),
    d.reviews.length || d.submissions.length ? h('div', null, h('strong', null, 'History'), h('ul', null,
      [...d.submissions.map((s) => ({ at: s.submitted_at, el: h('li', null, `Submitted (round ${s.round}) `, s.link ? h('a', { href: s.link, target: '_blank', rel: 'noopener noreferrer' }, 'link') : null, s.file_id ? h('a', { href: `/api/files/${s.file_id}`, target: '_blank', rel: 'noopener' }, ` ${s.file_name || 'file'}`) : null, s.note ? ` – “${s.note}”` : '') })),
        ...d.reviews.map((r) => ({ at: r.created_at, el: h('li', null, r.decision === 'approved' ? 'Approved' : 'Changes requested', r.feedback ? `: ${r.feedback}` : '') }))].sort((a, b) => a.at.localeCompare(b.at)).map((x) => x.el))) : null);
  modal({ title: t.title, body, actions: [{ label: 'Close', primary: true, onclick: () => {} }] });
}

export function submitDialog(task, onDone) {
  const link = h('input', { type: 'url', placeholder: 'https://drive.google.com/…', value: task.work_link || '' });
  const note = h('textarea', { placeholder: 'Anything your parent should know? (optional)' });
  const file = h('input', { type: 'file', accept: '.pdf,.png,.jpg,.jpeg,.webp,.gif,.docx,.xlsx,.pptx,.txt' });
  const rid = uuid();
  modal({ title: task.review_status === 'changes_requested' ? `Resubmit: ${task.title}` : `Submit for review: ${task.title}`,
    body: h('div', null, h('p', { class: 'muted' }, 'Add a link or a file if you have one. You can also submit with just a note.'), field('Link to your work (Google Drive)', link), field('Or upload a file (up to 10 MB)', file), field('Note', note)),
    actions: [{ label: 'Cancel', onclick: () => {} }, { label: task.review_status === 'changes_requested' ? 'Resubmit' : 'Submit for review', primary: true, onclick: async () => {
      let fileId = null;
      if (file.files[0]) { const f = file.files[0]; const r = await api('POST', `/api/files?kind=submission&child=${task.child_id}&name=${encodeURIComponent(f.name)}`, undefined, { raw: f }); fileId = r.file.id; }
      await post(`/api/tasks/${task.id}/submit`, { link: link.value || null, note: note.value || null, file_id: fileId, request_id: rid });
      toast('Submitted. Your parent will take a look.'); if (onDone) onDone(); } }] });
}
export function helpDialog(task, onDone) {
  const msg = h('textarea', { placeholder: 'What are you stuck on?', required: true });
  modal({ title: `Ask for help: ${task.title}`, body: h('div', null, h('p', { class: 'muted' }, 'Your parent will see this and reply here.'), field('Your message', msg)),
    actions: [{ label: 'Cancel', onclick: () => {} }, { label: 'Send help request', primary: true, onclick: async () => { if (!msg.value.trim()) { toast('Please write a short message.', 'error'); return false; } await post(`/api/tasks/${task.id}/help`, { message: msg.value }); toast('Help request sent.'); if (onDone) onDone(); } }] });
}
// Moves a session; if the server reports warnings, shows them and asks before going ahead.
export async function moveSession(session, date, start, onDone) {
  const send = (ack) => post(`/api/sessions/${session.id}/move`, { date, start: start || undefined, version: session.version, acknowledged: ack });
  try { await send(false); toast('Moved. It is now locked so the plan will not change it.'); onDone(); }
  catch (e) {
    if (e.status === 409 && e.data.needs_ack) {
      const ok = await confirmDialog({ title: 'Please check this', confirm: 'Move it anyway',
        message: h('div', null, h('p', null, 'Moving it here causes:'), h('ul', null, e.data.warnings.map((w) => h('li', null, w.message)))) });
      if (ok) { try { await send(true); toast('Moved.'); } catch (e2) { fail(e2); } onDone(); }
    } else { fail(e); if (e.status === 409) onDone(); }
  }
}
export function moveDialog(session, onDone) {
  const date = h('input', { type: 'date', value: session.planned_date }), time = h('input', { type: 'time', value: session.start_time });
  modal({ title: 'Change date / time', body: h('div', null, h('p', { class: 'muted' }, `${session.task.title} · ${mins(session.minutes)}`), h('div', { class: 'form-grid' }, field('Day', date), field('Start time', time)),
    h('p', { class: 'hint' }, 'If the new time clashes with something, you will see a warning first.')),
    actions: [{ label: 'Cancel', onclick: () => {} }, { label: 'Move', primary: true, onclick: async () => { await moveSession(session, date.value, time.value, onDone); } }] });
}

// ---------- Today ----------
async function renderToday(body, childId) {
  const d = await get(`/api/board/${childId}/today`);
  const reload = () => renderToday(body, childId);
  const p = d.progress;
  const done = p.tasks_done, total = p.tasks_planned;
  const ringVal = p.planned_minutes ? Math.round((p.done_minutes / p.planned_minutes) * 100) : 0;
  const parts = [];
  if (d.revisions.length) parts.push(h('div', { class: 'card alert' }, h('h2', null, `⚠ ${d.revisions.length} task${d.revisions.length > 1 ? 's' : ''} need changes`), h('p', null, d.revisions.map((t) => t.title).join(', ')),
    h('a', { class: 'btn danger', href: `#/${childId}/feedback` }, 'See what to change')));
  if (d.overdue.length) parts.push(h('div', { class: 'card warnbox' }, h('h3', null, `Overdue (${d.overdue.length})`), h('ul', null, d.overdue.map((t) => h('li', null, h('strong', null, t.title), ` – was due ${fmtDT(t.deadline)} `, statusBadge(t.status))))));
  parts.push(h('div', { class: 'card accent progress-card' },
    h('div', { class: 'ring', style: { '--p': ringVal }, role: 'img', 'aria-label': `${ringVal} percent of today's planned time finished` }, h('span', null, `${ringVal}%`)),
    h('div', { class: 'grow' }, h('div', { class: 'big-number' }, total ? `${done} of ${total}` : '0'), h('div', null, total === 1 ? 'task finished today' : 'tasks finished today'),
      h('div', { class: 'muted small' }, `${mins(p.done_minutes)} of ${mins(p.planned_minutes)} planned`)),
    d.fixed.length ? h('div', null, h('div', { class: 'small muted' }, 'Also today'), h('div', { class: 'fixed-chips' }, d.fixed.map((f) => h('span', { class: 'fixed-chip' }, `${f.start}–${f.end} ${f.title}${f.mode ? ` (${f.mode})` : ''}`)))) : null));
  parts.push(h('h2', null, `Today, ${fmtDay(d.date)}`));
  if (!d.sessions.length) parts.push(empty(d.unscheduled_count ? `Nothing is planned for today. ${d.unscheduled_count} task(s) still need a time: open “This Week”.` : 'Nothing is planned for today. Enjoy your free time! 🎉'));
  for (const s of d.sessions) parts.push(sessionCard(s, reload));
  if (d.unscheduled_count && d.sessions.length) parts.push(h('div', { class: 'card infobox' }, `${d.unscheduled_count} task(s) do not have a time yet. `, h('a', { href: `#/${childId}/week` }, 'Plan them in This Week')));
  mount(body, h('div', { class: 'stack' }, parts));
}

function sessionCard(s, reload) {
  const t = s.task, isDone = s.status === 'done';
  const setStatus = (status) => action(async () => {
    if (status === 'done' && t.status !== 'done') {
      if (s.seq_total > 1 && !(await confirmDialog({ title: 'Finish the whole task?', message: `This marks all ${s.seq_total} sessions of “${t.title}” as finished. To finish only this session, use “Finish this session”.`, confirm: 'Yes, all done' }))) return;
      await post(`/api/tasks/${t.id}/status`, { status });
      if (t.review_required) { reload(); return submitDialog({ ...t, child_id: t.child_id }, reload); }
    } else await post(`/api/tasks/${t.id}/status`, { status });
    reload();
  });
  const finish = action(async () => {
    const r = await post(`/api/sessions/${s.id}/status`, { status: isDone ? 'planned' : 'done' });
    if (!isDone && r.task.status === 'done' && r.task.review_required && r.task.review_status === 'awaiting_review') { reload(); return submitDialog(r.task, reload); }
    reload();
  });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': `Status of ${t.title}` }, Object.entries(STATUS).map(([k, [label]]) =>
    h('button', { type: 'button', 'data-s': k, 'aria-pressed': t.status === k ? 'true' : 'false', onclick: k === 'needs_help' ? action(async () => { helpDialog(t, reload); }) : setStatus(k) }, label)));
  return h('article', { class: `session ${isDone ? 'done' : ''} ${t.status === 'needs_help' ? 'help' : ''}`, 'aria-label': t.title },
    h('div', { class: 'session-time' }, `${s.start_time}`, h('small', null, `to ${s.end_time}`), h('small', null, mins(s.minutes))),
    h('div', null,
      h('h3', null, t.title, t.is_demo ? h('span', { class: 'chip demo', style: { marginLeft: '.5rem' } }, 'Demo') : null),
      h('div', { class: 'row' }, h('span', { class: 'chip' }, t.subject), s.seq_total > 1 ? h('span', { class: 'chip' }, `Session ${s.seq} of ${s.seq_total}`) : null, statusBadge(t.status), reviewBadge(t.review_status),
        t.deadline ? h('span', { class: 'small muted' }, `Due ${fmtDT(t.deadline)}`) : null, s.locked ? h('span', { class: 'small muted', title: 'You or your parent chose this time' }, '🔒 your choice') : null),
      t.instructions ? h('p', { class: 'small', style: { margin: '.4rem 0 0', whiteSpace: 'pre-wrap' } }, t.instructions.length > 140 ? `${t.instructions.slice(0, 140)}…` : t.instructions) : null,
      h('div', { class: 'links' }, t.resource_link ? linkBtn('Open Exercise', t.resource_link, 'btn primary big') : h('span', { class: 'muted small' }, 'No exercise link yet'),
        t.work_link ? linkBtn('Open Work File', t.work_link, 'btn big') : h('span', { class: 'muted small' }, 'No work file link yet'),
        t.source_file_id ? h('a', { class: 'btn big', href: `/api/files/${t.source_file_id}`, target: '_blank', rel: 'noopener' }, 'Original sheet') : null),
      h('div', { class: 'controls' },
        h('button', { class: `btn ${isDone ? '' : 'primary'}`, type: 'button', onclick: finish }, isDone ? '↩ Not finished after all' : (s.seq_total > 1 ? '✓ Finish this session' : '✓ I finished this')), seg),
      h('div', { class: 'controls' },
        t.review_required && t.status === 'done' && t.review_status !== 'approved' ? h('button', { class: 'btn', type: 'button', onclick: () => submitDialog(t, reload) }, t.review_status === 'awaiting_review' ? 'Add to my submission' : 'Submit for review') : null,
        t.review_required && t.status !== 'done' ? h('button', { class: 'btn', type: 'button', onclick: () => submitDialog(t, reload) }, 'Submit for review') : null,
        h('button', { class: 'btn', type: 'button', onclick: () => helpDialog(t, reload) }, '🙋 Ask for help'),
        h('button', { class: 'btn link', type: 'button', onclick: action(() => openTaskDetail(t.id)) }, 'Details'))));
}

// ---------- This Week ----------
export async function renderWeek(body, childId, weekParam, { compact = false, readonly = false } = {}) {
  const week = weekParam || undefined;
  const d = await get(`/api/board/${childId}/week${week ? `?week=${week}` : ''}`);
  const reload = () => renderWeek(body, childId, d.week_start, { compact, readonly });
  const go = (w) => { if (compact) renderWeek(body, childId, w, { compact, readonly }); else location.hash = `#/${childId}/week?week=${w}`; };
  const todayStr = state.today;
  const nav = h('div', { class: 'row between' },
    h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: () => go(addDays(d.week_start, -7)), 'aria-label': 'Previous week' }, '◀'),
      h('strong', null, `${fmtDayShort(d.week_start)} – ${fmtDay(d.week_end)}`),
      h('button', { class: 'btn small', type: 'button', onclick: () => go(addDays(d.week_start, 7)), 'aria-label': 'Next week' }, '▶'),
      h('button', { class: 'btn small', type: 'button', onclick: () => go(weekStartOf(todayStr)) }, 'This week')),
    h('div', { class: 'muted small' }, `Planned ${mins(d.weekly_planned_minutes)} · ${d.summary.completed} of ${d.summary.total} tasks finished`));
  const cols = d.days.map((day) => {
    const col = h('section', { class: `day ${day.date === todayStr ? 'today' : ''} ${day.overloaded ? 'over' : ''}`, 'aria-label': fmtDay(day.date), dataset: { date: day.date } },
      h('div', { class: 'day-head' }, h('span', null, fmtDay(day.date)), h('span', { class: `day-load ${day.overloaded ? 'over' : ''}` }, `${mins(day.planned_minutes)} / ${mins(day.cap)}`)),
      day.overloaded ? h('div', { class: 'warn-line' }, '⚠ Too much for one day') : null,
      day.fixed.map((f) => h('div', { class: 'fixed-line' }, `${f.start}–${f.end} ${f.title}${f.mode === 'offline' && (f.travel_before_min + f.travel_after_min) ? ` (+${mins(f.travel_before_min + f.travel_after_min)} travel)` : ''}`)),
      day.sessions.length ? day.sessions.map((s, i) => miniCard(s, day, i, reload, readonly || compact)) : h('div', { class: 'muted small' }, 'Free'));
    if (!readonly && !compact) {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
      col.addEventListener('dragleave', () => col.classList.remove('drop'));
      col.addEventListener('drop', async (e) => {
        e.preventDefault(); col.classList.remove('drop');
        const id = e.dataTransfer.getData('text/plain'); const s = d.days.flatMap((x) => x.sessions).find((x) => x.id === id);
        if (s && s.planned_date !== day.date) await moveSession(s, day.date, null, reload);
      });
    }
    return col;
  });
  const parts = [nav];
  if (d.overdue.length) parts.push(h('div', { class: 'card warnbox' }, h('strong', null, `Overdue (${d.overdue.length}): `), d.overdue.map((t) => `${t.title} (was due ${fmtDT(t.deadline)})`).join(' · ')));
  parts.push(h('div', { class: compact ? 'compact' : '' }, h('div', { class: 'week-grid' }, cols)));
  if (!compact && !readonly) parts.push(h('p', { class: 'hint' }, 'Tip: drag a card to another day, or use ▲ ▼ and the 📅 button. Cards you move are locked (🔒) so the plan will not change them.'));
  if (d.unscheduled.length) parts.push(h('div', { class: 'card warnbox' }, h('h3', null, `Waiting for a time (${d.unscheduled.length})`),
    h('div', { class: 'stack' }, d.unscheduled.map((t) => h('div', { class: 'row between' }, h('div', null, h('strong', null, t.title), h('div', { class: 'small muted' }, `${mins(t.unscheduled_minutes)} left to plan${t.deadline ? ` · due ${fmtDT(t.deadline)}` : ''}`), t.unscheduled_reason ? h('div', { class: 'small' }, t.unscheduled_reason) : null),
      readonly || compact ? null : h('button', { class: 'btn small', type: 'button', onclick: () => planDialog(t, childId, reload) }, 'Choose a time'))))));
  mount(body, h('div', { class: 'stack' }, parts));
}

function miniCard(s, day, i, reload, ro) {
  const t = s.task;
  const card = h('div', { class: `mini ${s.status === 'done' ? 'done' : ''} ${s.locked ? 'locked' : ''}`, draggable: !ro && s.status !== 'done' });
  if (!ro && s.status !== 'done') {
    card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', s.id); e.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging'); });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  }
  card.append(h('div', { class: 't' }, `${s.start_time}–${s.end_time}`), h('div', { class: 'name' }, t.title, t.is_demo ? h('span', { class: 'chip demo', style: { marginLeft: '.3rem' } }, 'Demo') : null),
    h('div', { class: 'small muted' }, `${mins(s.minutes)}${s.seq_total > 1 ? ` · ${s.seq}/${s.seq_total}` : ''}${s.status === 'done' ? ' · finished ✓' : ''}${t.deadline ? ` · due ${fmtDT(t.deadline)}` : ''}`));
  if (!ro && s.status !== 'done') {
    card.append(h('div', { class: 'acts' },
      h('button', { type: 'button', 'aria-label': `Move ${t.title} earlier in the day`, title: 'Earlier', disabled: i === 0, onclick: action(async () => { try { await post(`/api/sessions/${s.id}/shift`, { direction: 'up' }); } finally { reload(); } }) }, '▲'),
      h('button', { type: 'button', 'aria-label': `Move ${t.title} later in the day`, title: 'Later', disabled: i === day.sessions.length - 1, onclick: action(async () => { try { await post(`/api/sessions/${s.id}/shift`, { direction: 'down' }); } finally { reload(); } }) }, '▼'),
      h('button', { type: 'button', 'aria-label': `Change date or time of ${t.title}`, title: 'Change date/time', onclick: () => moveDialog(s, reload) }, '📅'),
      h('button', { type: 'button', 'aria-pressed': s.locked ? 'true' : 'false', 'aria-label': `Lock ${t.title} in place`, title: s.locked ? 'Locked: the plan will not move this' : 'Lock this in place', onclick: action(async () => { await post(`/api/sessions/${s.id}/lock`, { locked: !s.locked }); reload(); }) }, s.locked ? '🔒' : '🔓'),
      h('button', { type: 'button', 'aria-label': `Details of ${t.title}`, title: 'Details', onclick: action(() => openTaskDetail(t.id)) }, 'ℹ')));
  } else card.append(h('div', { class: 'acts' }, h('button', { type: 'button', 'aria-label': `Details of ${t.title}`, onclick: action(() => openTaskDetail(t.id)) }, 'ℹ Details')));
  return card;
}

function planDialog(t, childId, reload) {
  const date = h('input', { type: 'date', value: state.today }), time = h('input', { type: 'time', value: '17:00' }), m = h('input', { type: 'number', min: 5, max: t.unscheduled_minutes, value: t.unscheduled_minutes });
  const send = (ack) => post(`/api/tasks/${t.id}/plan`, { date: date.value, start: time.value, minutes: Number(m.value), acknowledged: ack });
  modal({ title: `Choose a time: ${t.title}`, body: h('div', { class: 'form-grid' }, field('Day', date), field('Start time', time), field('Minutes', m, `Up to ${t.unscheduled_minutes}`)),
    actions: [{ label: 'Cancel', onclick: () => {} }, { label: 'Add to my plan', primary: true, onclick: async () => {
      try { await send(false); } catch (e) {
        if (e.status === 409 && e.data.needs_ack) { if (!(await confirmDialog({ title: 'Please check this', confirm: 'Add it anyway', message: h('ul', null, e.data.warnings.map((w) => h('li', null, w.message))) }))) return false; await send(true); } else throw e; }
      reload(); } }] });
}

// ---------- Feedback & revisions ----------
function renderFeedback(body, childId, f) {
  const reload = () => location.reload ? route2() : null;
  const route2 = () => { window.dispatchEvent(new HashChangeEvent('hashchange')); };
  const parts = [];
  parts.push(h('h2', null, 'Tasks that need changes'));
  if (!f.revisions.length) parts.push(empty('Nothing needs changing right now. 👍'));
  for (const t of f.revisions) {
    const last = t.reviews.filter((r) => r.decision === 'changes_requested').at(-1);
    parts.push(h('article', { class: 'card alert' }, h('div', { class: 'row between' }, h('h3', null, t.title), reviewBadge(t.review_status)),
      h('p', { class: 'small muted' }, `${t.subject}${t.deadline ? ` · due ${fmtDT(t.deadline)}` : ''}`),
      h('div', { class: 'card', style: { background: '#fff' } }, h('strong', null, 'What to change'), h('p', { style: { whiteSpace: 'pre-wrap', margin: '.3rem 0 0' } }, last ? last.feedback : '')),
      h('p', { class: 'small' }, `Submitted ${t.submissions.length} time${t.submissions.length === 1 ? '' : 's'}. Action needed: fix it, then resubmit.`),
      h('div', { class: 'row' }, t.work_link ? linkBtn('Open Work File', t.work_link) : null, t.resource_link ? linkBtn('Open Exercise', t.resource_link) : null,
        h('button', { class: 'btn primary', type: 'button', onclick: () => submitDialog(t, route2) }, 'Resubmit'), h('button', { class: 'btn link', type: 'button', onclick: action(() => openTaskDetail(t.id)) }, 'History'))));
  }
  parts.push(h('h2', null, 'Waiting for your parent'));
  if (!f.awaiting.length) parts.push(empty('Nothing is waiting for review.'));
  for (const t of f.awaiting) parts.push(h('article', { class: 'card infobox' }, h('div', { class: 'row between' }, h('strong', null, t.title), reviewBadge(t.review_status)), h('div', { class: 'small muted' }, `Submitted ${t.submissions.length ? new Date(t.submissions.at(-1).submitted_at).toLocaleDateString('en-GB') : 'without a file'}`),
    h('button', { class: 'btn small', type: 'button', onclick: () => submitDialog(t, route2) }, 'Add a link or file')));
  if (f.approved.length) { parts.push(h('h2', null, 'Approved recently')); for (const t of f.approved.slice().reverse()) parts.push(h('article', { class: 'card okbox' }, h('div', { class: 'row between' }, h('strong', null, t.title), reviewBadge(t.review_status)), t.reviews.at(-1) && t.reviews.at(-1).feedback ? h('p', { class: 'small', style: { margin: '.3rem 0 0' } }, `“${t.reviews.at(-1).feedback}”`) : null)); }
  parts.push(h('h2', null, 'My help requests'));
  if (!f.help.length) parts.push(empty('You have not asked for help yet.'));
  for (const hh of f.help) parts.push(h('article', { class: `card ${hh.status === 'open' ? 'warnbox' : 'okbox'}` }, h('div', { class: 'row between' }, h('strong', null, hh.title || 'General question'), h('span', { class: `badge ${hh.status === 'open' ? 'st-prog' : 'st-done'}` }, hh.status === 'open' ? 'Waiting for reply' : 'Answered')),
    h('p', { style: { margin: '.3rem 0' } }, `You: ${hh.message}`), hh.reply ? h('p', { style: { margin: 0 } }, h('strong', null, 'Parent: '), hh.reply) : null));
  mount(body, h('div', { class: 'stack' }, parts));
}
