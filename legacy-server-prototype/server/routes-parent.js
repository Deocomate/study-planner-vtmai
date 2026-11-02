'use strict';
// Parent-only routes. Every route starts with requireParent: children get a 403 no matter what the browser shows.
const { get, all, run, tx, uid } = require('./db');
const T = require('./time');
const A = require('./auth');
const K = require('./tasks');
const M = require('./metrics');
const F = require('./files');
const P = require('./planner');
const mailer = require('./mailer');
const importer = require('./importer');
const monthly = require('./monthly');
const reminders = require('./reminders');
const demo = require('./demo');
const { readJson } = require('./http');
const { HttpError, bad, conflict, notFound, str, int, oneOf, flag } = require('./util');
const { getSetting, setSetting } = require('./settings');
const { taskPublic } = require('./routes-common');

const CHILD_IDS = () => all('SELECT id FROM children').map((c) => c.id);
function childIdsFrom(v) {
  const list = Array.isArray(v) ? v : v === 'both' ? CHILD_IDS() : v ? [v] : [];
  const ids = [...new Set(list)];
  if (!ids.length) throw bad('Choose Ben, Shin or both.');
  for (const id of ids) if (!CHILD_IDS().includes(id)) throw bad('Unknown child.');
  return ids;
}
const emailOk = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
const guard = (fn) => async (req, res) => { A.requireParent(req); await fn(req, res); };

function taskRow(t) {
  const sess = all('SELECT minutes, status, planned_date FROM sessions WHERE task_id = ?', t.id);
  const sub = get('SELECT COUNT(*) AS n, MAX(submitted_at) AS last FROM submissions WHERE task_id = ?', t.id);
  return { ...t, sessions_count: sess.length, sessions_done: sess.filter((s) => s.status === 'done').length, planned_minutes: sess.reduce((a, s) => a + s.minutes, 0),
    overdue: M.isOverdue(t), submissions: sub.n, last_submission: sub.last };
}

function register(app) {
  const g = (method, path, fn) => app[method](path, guard(fn));

  // ---------- overview ----------
  g('get', '/api/parent/overview', async (req, res) => {
    const week = req.query.week && T.isDate(req.query.week) ? T.weekStartOf(req.query.week) : T.weekStartOf(T.todayStr());
    const children = CHILD_IDS().map((id) => M.childSummary(id, { weekStart: week }));
    const todo = [];
    const needsConfirm = get('SELECT COUNT(*) AS n FROM fixed_blocks WHERE needs_confirmation = 1').n;
    if (needsConfirm) todo.push({ code: 'timetable', message: `${needsConfirm} timetable item(s) need your confirmation.`, view: 'timetable' });
    const unconfirmedSettings = get('SELECT COUNT(*) AS n FROM child_settings WHERE confirmed = 0').n;
    if (unconfirmedSettings) todo.push({ code: 'study_settings', message: 'Study hours and limits are still default suggestions. Please check them for each child.', view: 'timetable' });
    if (!getSetting('reset').policy) todo.push({ code: 'reset_policy', message: 'Choose what happens to unfinished tasks at month-end before automatic reset can be enabled.', view: 'monthly' });
    if (!mailer.status().configured) todo.push({ code: 'email', message: mailer.status().note, view: 'settings' });
    if (!getSetting('parent_email')) todo.push({ code: 'parent_email', message: 'Add your email address to receive the parent summary.', view: 'settings' });
    const failed = get("SELECT COUNT(*) AS n FROM reminder_log WHERE status = 'failed'").n;
    if (failed) todo.push({ code: 'email_failed', message: `${failed} reminder email(s) could not be delivered.`, view: 'settings' });
    const pending = monthly.pendingMonths();
    res.json({ week_start: week, children, todo, demo_loaded: !!get('SELECT 1 AS x FROM tasks WHERE is_demo = 1 LIMIT 1'), pending_months: pending, today: T.todayStr() });
  });

  // ---------- tasks ----------
  g('get', '/api/parent/tasks', async (req, res) => {
    const q = req.query;
    const where = ['1=1'], params = [];
    if (q.child) { where.push('child_id = ?'); params.push(q.child); }
    if (q.week && T.isDate(q.week)) { where.push('week_start = ?'); params.push(T.weekStartOf(q.week)); }
    if (q.month && T.isMonth(q.month)) { where.push('reporting_month = ?'); params.push(q.month); }
    if (q.subject) { where.push('subject = ?'); params.push(q.subject); }
    if (q.status && K.STATUSES.includes(q.status)) { where.push('status = ?'); params.push(q.status); }
    if (q.review && ['not_required', 'not_submitted', 'awaiting_review', 'changes_requested', 'approved'].includes(q.review)) { where.push('review_status = ?'); params.push(q.review); }
    if (q.cancelled !== '1') where.push('cancelled_at IS NULL');
    const rows = all(`SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY COALESCE(deadline, '9999') , title LIMIT 500`, ...params).map(taskRow);
    const filtered = q.overdue === '1' ? rows.filter((r) => r.overdue) : q.unscheduled === '1' ? rows.filter((r) => r.status !== 'done' && r.planned_minutes < r.est_minutes) : rows;
    res.json({ tasks: filtered, subjects: all('SELECT DISTINCT subject FROM tasks ORDER BY subject').map((r) => r.subject) });
  });
  g('post', '/api/parent/tasks', async (req, res) => {
    const b = await readJson(req);
    const ids = K.createTasks({ items: b.items, childIds: b.child_ids ? childIdsFrom(b.child_ids) : null, weekStart: b.week_start, user: req.user });
    res.json({ created: ids.length, ids });
  });
  g('patch', '/api/parent/tasks/:id', async (req, res) => {
    const b = await readJson(req);
    const allowed = ['title', 'subject', 'task_type', 'instructions', 'est_minutes', 'deadline', 'target', 'priority', 'review_required', 'resource_link', 'work_link', 'notes', 'version'];
    const patch = Object.fromEntries(Object.entries(b).filter(([k]) => allowed.includes(k)));
    if (patch.deadline === '') patch.deadline = null; if (patch.target === '') patch.target = null;
    res.json({ task: K.updateTask(req.params.id, patch, req.user) });
  });
  g('post', '/api/parent/tasks/:id/cancel', async (req, res) => res.json({ task: K.cancelTask(req.params.id) }));
  g('post', '/api/parent/tasks/:id/confirm-estimate', async (req, res) => { K.confirmEstimate(req.params.id); res.json({ ok: true }); });
  g('post', '/api/parent/tasks/:id/reopen', async (req, res) => res.json({ task: K.reopenByParent(req.params.id) }));
  g('post', '/api/parent/tasks/:id/review', async (req, res) => {
    const b = await readJson(req);
    res.json({ task: K.reviewTask(req.params.id, b.decision, b.feedback) });
  });

  // ---------- review queue and help ----------
  g('get', '/api/parent/review', async (req, res) => {
    const decorate = (t) => ({ ...taskPublic(t), child_name: K.childName(t.child_id),
      submissions: all(`SELECT s.id, s.round, s.link, s.note, s.file_id, s.submitted_at, f.original_name AS file_name FROM submissions s LEFT JOIN files f ON f.id = s.file_id WHERE s.task_id = ? ORDER BY s.round`, t.id),
      reviews: all('SELECT decision, feedback, created_at FROM reviews WHERE task_id = ? ORDER BY created_at', t.id) });
    res.json({
      awaiting: all("SELECT * FROM tasks WHERE review_status = 'awaiting_review' AND cancelled_at IS NULL ORDER BY completed_at").map(decorate),
      revisions: all("SELECT * FROM tasks WHERE review_status = 'changes_requested' AND cancelled_at IS NULL ORDER BY updated_at").map(decorate),
      recent_approved: all("SELECT * FROM tasks WHERE review_status = 'approved' AND cancelled_at IS NULL ORDER BY updated_at DESC LIMIT 10").map(decorate),
    });
  });
  g('get', '/api/parent/help', async (req, res) => {
    res.json({ items: all(`SELECT h.*, t.title, c.name AS child_name FROM help_requests h LEFT JOIN tasks t ON t.id = h.task_id JOIN children c ON c.id = h.child_id
                           ORDER BY (h.status = 'open') DESC, h.created_at DESC LIMIT 60`) });
  });
  g('post', '/api/parent/help/:id/reply', async (req, res) => {
    const b = await readJson(req);
    res.json({ help: K.replyHelp(req.params.id, b.reply) });
  });

  // ---------- import (text, uploaded files, Drive links) ----------
  g('get', '/api/parent/import/status', async (req, res) => res.json({ text_parser: true }));
  g('post', '/api/parent/import/extract', async (req, res) => {
    const b = await readJson(req, 100 * 1024);
    const childIds = childIdsFrom(b.child_ids);
    if (!T.isDate(b.week_start)) throw bad('Choose the intended week.');
    const ws = T.weekStartOf(b.week_start);
    const fileRows = (Array.isArray(b.file_ids) ? b.file_ids : []).slice(0, 8).map((id) => {
      const f = get("SELECT * FROM files WHERE id = ? AND kind = 'import'", id); if (!f) throw bad('One of the uploaded files was not found.'); return f;
    });
    const links = (Array.isArray(b.drive_links) ? b.drive_links : []).map((l) => String(l).trim()).filter(Boolean).slice(0, 30);
    for (const l of links) if (!/^https?:\/\//i.test(l)) throw bad('Drive links must start with http:// or https://');
    if (!fileRows.length && !str(b.text, { max: 20000 }) && !links.length) throw bad('Add some text, a file or a link first.');
    const r = await importer.extract({ childIds, weekStart: ws, text: b.text || '', fileRows, driveLinks: links });
    // Links without any text/file: offer them as a single task per link, kept as a resource.
    if (!fileRows.length && !(b.text || '').trim() && links.length) {
      r.items = []; r.status = 'ok'; r.notes = r.notes || [];
      for (const l of links) for (const childId of childIds) r.items.push({ child_id: childId, title: 'New task (rename me)', subject: 'Other', task_type: 'other', est_minutes: K.defaultsFor(childId, 'other').minutes, est_source: 'system',
        deadline: null, target: null, priority: 2, review_required: 0, resource_link: l, work_link: null, flags: ['Only a link was given. Please type the title and deadline.'], from_source: [] });
      r.notes = ['The link was attached to a new task. Drive files are not opened automatically: please type what the task is.'];
    }
    res.json({ ...r, week_start: ws });
  });
  g('post', '/api/parent/import/confirm', async (req, res) => {
    const b = await readJson(req);
    if (!T.isDate(b.week_start)) throw bad('Choose the intended week.');
    const items = (Array.isArray(b.items) ? b.items : []).filter((i) => i && i.include !== false);
    const dups = items.filter((i) => i.duplicate_of && !i.confirm_duplicate);
    if (dups.length) throw new HttpError(409, `${dups.length} item(s) look like tasks that already exist. Untick them, or tick "Add anyway".`, { duplicates: dups.map((d) => d.title) });
    const ids = K.createTasks({ items, childIds: b.child_ids ? childIdsFrom(b.child_ids) : null, weekStart: b.week_start, user: req.user, sourceRef: b.source_ref || 'import' });
    res.json({ created: ids.length, ids });
  });

  // ---------- weekly templates ----------
  g('get', '/api/parent/templates', async (req, res) => res.json({ templates: all('SELECT * FROM templates ORDER BY child_id, id') }));
  const tplFields = (b) => ({
    child_id: oneOf(b.child_id, CHILD_IDS(), 'Child'), title: str(b.title, { required: true, max: 200, name: 'Title' }), subject: str(b.subject, { max: 60 }) || 'Other',
    task_type: oneOf(b.task_type || 'other', ['workbook', 'cindy', 'vinh', 'other'], 'Type'), deadline_weekday: int(b.deadline_weekday, { min: 1, max: 7, required: true, name: 'Deadline day' }),
    deadline_time: T.isTime(b.deadline_time) ? b.deadline_time : (() => { throw bad('Deadline time must look like 07:00.'); })(),
    target_weekday: b.target_weekday ? int(b.target_weekday, { min: 1, max: 7 }) : null, target_time: b.target_weekday ? (T.isTime(b.target_time) ? b.target_time : '21:00') : null,
    estimate_min: b.estimate_min ? int(b.estimate_min, { min: 5, max: 900 }) : null, priority: b.priority ? int(b.priority, { min: 1, max: 3 }) : 2,
    review_required: flag(b.review_required), active: b.active === undefined ? 1 : flag(b.active), note: str(b.note, { max: 500 }) });
  g('post', '/api/parent/templates', async (req, res) => {
    const f = tplFields(await readJson(req));
    const r = run(`INSERT INTO templates (child_id, title, subject, task_type, deadline_weekday, deadline_time, target_weekday, target_time, estimate_min, priority, review_required, active, note)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, f.child_id, f.title, f.subject, f.task_type, f.deadline_weekday, f.deadline_time, f.target_weekday, f.target_time, f.estimate_min, f.priority, f.review_required, f.active, f.note);
    res.json({ id: Number(r.lastInsertRowid) });
  });
  g('put', '/api/parent/templates/:id', async (req, res) => {
    const f = tplFields(await readJson(req));
    const r = run(`UPDATE templates SET child_id=?, title=?, subject=?, task_type=?, deadline_weekday=?, deadline_time=?, target_weekday=?, target_time=?, estimate_min=?, priority=?, review_required=?, active=?, note=? WHERE id=?`,
      f.child_id, f.title, f.subject, f.task_type, f.deadline_weekday, f.deadline_time, f.target_weekday, f.target_time, f.estimate_min, f.priority, f.review_required, f.active, f.note, Number(req.params.id));
    if (!r.changes) throw notFound('Template not found.'); res.json({ ok: true });
  });
  g('delete', '/api/parent/templates/:id', async (req, res) => { run('DELETE FROM templates WHERE id = ?', Number(req.params.id)); res.json({ ok: true }); });
  g('post', '/api/parent/templates/generate', async (req, res) => {
    const b = await readJson(req);
    const childIds = childIdsFrom(b.child_ids);
    if (!T.isDate(b.week_start)) throw bad('Choose the intended week.');
    const ws = T.weekStartOf(b.week_start);
    res.json({ status: 'ok', week_start: ws, items: importer.templateItems(ws, childIds), notes: ['Created from your weekly template. Review, then save.'] });
  });

  // ---------- scheduling ----------
  g('post', '/api/parent/schedule/preview', async (req, res) => {
    const b = await readJson(req);
    res.json({ previews: P.preview({ childIds: childIdsFrom(b.child_ids), weekStart: b.week_start && T.isDate(b.week_start) ? b.week_start : T.todayStr(), mode: b.mode || 'week' }) });
  });
  g('post', '/api/parent/schedule/apply', async (req, res) => {
    const b = await readJson(req);
    const ids = Array.isArray(b.proposal_ids) ? b.proposal_ids : [];
    if (!ids.length) throw bad('There is no proposal to apply.');
    const results = tx(() => ids.map((id) => P.apply(id)));
    res.json({ results });
  });

  // ---------- timetables and study settings ----------
  g('get', '/api/parent/timetable/:child', async (req, res) => {
    const id = oneOf(req.params.child, CHILD_IDS(), 'Child');
    res.json({ settings: get('SELECT * FROM child_settings WHERE child_id = ?', id), blocks: all('SELECT * FROM fixed_blocks WHERE child_id = ? ORDER BY weekday, start_time', id),
      defaults: all('SELECT * FROM task_defaults WHERE child_id = ? ORDER BY task_type', id), week_parity_now: T.weekParity(T.weekStartOf(T.todayStr())) });
  });
  const blockFields = (b) => {
    const start = T.isTime(b.start_time) ? b.start_time : (() => { throw bad('Start time must look like 16:00.'); })();
    const end = T.isTime(b.end_time) ? b.end_time : (() => { throw bad('End time must look like 17:30.'); })();
    if (T.parseHM(end) <= T.parseHM(start)) throw bad('The end time must be after the start time.');
    return { child_id: oneOf(b.child_id, CHILD_IDS(), 'Child'), kind: oneOf(b.kind || 'class', ['school', 'class', 'activity', 'meal', 'rest', 'other'], 'Kind'),
      title: str(b.title, { required: true, max: 100, name: 'Title' }), weekday: int(b.weekday, { min: 1, max: 7, required: true, name: 'Day' }), start_time: start, end_time: end,
      mode: b.mode ? oneOf(b.mode, ['online', 'offline'], 'Mode') : null, travel_before_min: int(b.travel_before_min || 0, { min: 0, max: 300 }), travel_after_min: int(b.travel_after_min || 0, { min: 0, max: 300 }),
      week_parity: oneOf(b.week_parity || 'every', ['every', 'odd', 'even'], 'Repeat'), needs_confirmation: flag(b.needs_confirmation), note: str(b.note, { max: 500 }) };
  };
  const insertBlock = (f) => run(`INSERT INTO fixed_blocks (child_id, kind, title, weekday, start_time, end_time, mode, travel_before_min, travel_after_min, week_parity, needs_confirmation, note)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, f.child_id, f.kind, f.title, f.weekday, f.start_time, f.end_time, f.mode, f.travel_before_min, f.travel_after_min, f.week_parity, f.needs_confirmation, f.note);
  g('post', '/api/parent/blocks', async (req, res) => { const r = insertBlock(blockFields(await readJson(req))); res.json({ id: Number(r.lastInsertRowid) }); });
  g('post', '/api/parent/blocks/bulk', async (req, res) => {
    const b = await readJson(req);
    const list = (Array.isArray(b.blocks) ? b.blocks : []).slice(0, 100).map(blockFields);
    tx(() => list.forEach(insertBlock)); res.json({ created: list.length });
  });
  g('put', '/api/parent/blocks/:id', async (req, res) => {
    const f = blockFields(await readJson(req));
    const r = run(`UPDATE fixed_blocks SET child_id=?, kind=?, title=?, weekday=?, start_time=?, end_time=?, mode=?, travel_before_min=?, travel_after_min=?, week_parity=?, needs_confirmation=?, note=? WHERE id=?`,
      f.child_id, f.kind, f.title, f.weekday, f.start_time, f.end_time, f.mode, f.travel_before_min, f.travel_after_min, f.week_parity, f.needs_confirmation, f.note, Number(req.params.id));
    if (!r.changes) throw notFound('Timetable item not found.'); res.json({ ok: true });
  });
  g('delete', '/api/parent/blocks/:id', async (req, res) => { run('DELETE FROM fixed_blocks WHERE id = ?', Number(req.params.id)); res.json({ ok: true }); });
  g('put', '/api/parent/child-settings/:child', async (req, res) => {
    const id = oneOf(req.params.child, CHILD_IDS(), 'Child');
    const b = await readJson(req);
    const time = (v, n) => (T.isTime(v) ? v : (() => { throw bad(`${n} must look like 17:00.`); })());
    const s = { home_weekday: time(b.home_weekday, 'Home-study start (school days)'), weekend_start: time(b.weekend_start, 'Weekend start'), dinner_start: time(b.dinner_start, 'Dinner start'),
      dinner_end: time(b.dinner_end, 'Dinner end'), bedtime: time(b.bedtime, 'Bedtime'), wind_down_min: int(b.wind_down_min, { min: 0, max: 180, required: true, name: 'Wind-down' }),
      session_min: int(b.session_min, { min: 10, max: 120, required: true, name: 'Session length' }), break_min: int(b.break_min, { min: 0, max: 60, required: true, name: 'Break' }),
      max_weekday_min: int(b.max_weekday_min, { min: 15, max: 600, required: true, name: 'School-day limit' }), max_weekend_min: int(b.max_weekend_min, { min: 15, max: 720, required: true, name: 'Weekend limit' }),
      spare_min: int(b.spare_min, { min: 0, max: 240, required: true, name: 'Spare time' }) };
    if (T.parseHM(s.dinner_end) <= T.parseHM(s.dinner_start)) throw bad('Dinner must end after it starts.');
    const email = str(b.email, { max: 200 }); if (email && !emailOk(email)) throw bad('That email address does not look right.');
    run(`UPDATE child_settings SET home_weekday=?, weekend_start=?, dinner_start=?, dinner_end=?, bedtime=?, wind_down_min=?, session_min=?, break_min=?, max_weekday_min=?, max_weekend_min=?, spare_min=?, email=?, confirmed=1 WHERE child_id=?`,
      s.home_weekday, s.weekend_start, s.dinner_start, s.dinner_end, s.bedtime, s.wind_down_min, s.session_min, s.break_min, s.max_weekday_min, s.max_weekend_min, s.spare_min, email, id);
    res.json({ ok: true });
  });
  g('put', '/api/parent/task-defaults/:child', async (req, res) => {
    const id = oneOf(req.params.child, CHILD_IDS(), 'Child');
    const b = await readJson(req);
    tx(() => {
      for (const d of Array.isArray(b.defaults) ? b.defaults : []) {
        const type = oneOf(d.task_type, ['workbook', 'cindy', 'vinh', 'other'], 'Type');
        run('UPDATE task_defaults SET minutes = ?, session_min = ?, max_per_day = ? WHERE child_id = ? AND task_type = ?',
          int(d.minutes, { min: 5, max: 900, required: true, name: 'Minutes' }), int(d.session_min, { min: 10, max: 240, required: true, name: 'Session length' }), int(d.max_per_day, { min: 1, max: 6, required: true, name: 'Per day' }), id, type);
      }
    });
    res.json({ ok: true });
  });
  g('post', '/api/parent/timetable/extract', async (req, res) => {
    res.json({ status: 'ok', blocks: [], notes: ['Timetable picture extraction is disabled. Please add timetable items manually.'] });
  });

  // ---------- settings, reminders, accounts ----------
  g('get', '/api/parent/settings', async (req, res) => {
    res.json({ parent_email: getSetting('parent_email'), reminders: getSetting('reminders'), reset: getSetting('reset'), email_status: mailer.status(),
      child_emails: Object.fromEntries(all('SELECT child_id, email FROM child_settings').map((r) => [r.child_id, r.email])),
      reminder_log: all('SELECT id, kind, recipient, child_id, run_date, status, attempts, error, updated_at FROM reminder_log ORDER BY id DESC LIMIT 40'),
      failures: all("SELECT id, kind, recipient, run_date, attempts, error, updated_at FROM reminder_log WHERE status = 'failed' ORDER BY id DESC LIMIT 20") });
  });
  g('put', '/api/parent/settings', async (req, res) => {
    const b = await readJson(req);
    tx(() => {
      if (b.parent_email !== undefined) { const e = str(b.parent_email, { max: 200 }); if (e && !emailOk(e)) throw bad('That email address does not look right.'); setSetting('parent_email', e); }
      if (b.child_emails) for (const [id, e0] of Object.entries(b.child_emails)) {
        if (!CHILD_IDS().includes(id)) continue; const e = str(e0, { max: 200 }); if (e && !emailOk(e)) throw bad(`The email for ${id} does not look right.`);
        run('UPDATE child_settings SET email = ? WHERE child_id = ?', e, id);
      }
      if (b.reminders) {
        const cur = getSetting('reminders');
        for (const k of reminders.KINDS) {
          const n = b.reminders[k]; if (!n) continue;
          if (!T.isTime(n.time)) throw bad('Reminder times must look like 19:00.');
          cur[k] = k === 'parent_summary' ? { enabled: !!n.enabled, time: n.time, to_parent: n.to_parent !== false }
            : { enabled: !!n.enabled, time: n.time, to_parent: !!n.to_parent, to_children: !!n.to_children };
        }
        setSetting('reminders', cur);
      }
      if (b.reset) {
        const cur = getSetting('reset');
        if (b.reset.policy !== undefined) cur.policy = b.reset.policy === null ? null : oneOf(b.reset.policy, ['carry', 'close'], 'Policy');
        if (b.reset.auto_enabled !== undefined) cur.auto_enabled = !!b.reset.auto_enabled;
        if (cur.auto_enabled && !cur.policy) throw bad('Choose how unfinished tasks are handled before turning on automatic reset.');
        setSetting('reset', cur);
      }
    });
    res.json({ ok: true });
  });
  g('post', '/api/parent/settings/test-email', async (req, res) => {
    const b = await readJson(req);
    const to = str(b.to, { max: 200 }) || getSetting('parent_email');
    if (!to || !emailOk(to)) throw bad('Enter an email address to send the test to.');
    try { const r = await reminders.sendTest(to); res.json({ ok: true, provider: r.provider, real: r.real, note: r.real ? `A test email was handed to the mail service (${r.provider}).` : 'Developer outbox: the email was written to a file, not really sent.' }); }
    catch (e) { res.status(200).json({ ok: false, error: e.code === 'not_configured' ? 'Email is not connected yet. See the setup guide (SMTP or Resend).' : e.message }); }
  });
  g('post', '/api/parent/reminders/preview', async (req, res) => {
    const b = await readJson(req);
    res.json(reminders.previewContent(oneOf(b.kind, reminders.KINDS, 'Reminder'), b.child_id || null));
  });
  g('post', '/api/parent/users/:child/password', async (req, res) => {
    const id = oneOf(req.params.child, CHILD_IDS(), 'Child');
    const b = await readJson(req);
    const u = get('SELECT * FROM users WHERE child_id = ?', id);
    if (!u) throw notFound('No account for that child.');
    A.setPassword(u.id, 'child', b.password);
    res.json({ ok: true });
  });
  g('post', '/api/parent/demo/load', async (req, res) => res.json(demo.loadDemo(req.user)));
  g('delete', '/api/parent/demo', async (req, res) => res.json(demo.removeDemo()));

  // ---------- progress and reports ----------
  g('get', '/api/parent/progress', async (req, res) => {
    const week = req.query.week && T.isDate(req.query.week) ? req.query.week : T.todayStr();
    const ids = req.query.child && CHILD_IDS().includes(req.query.child) ? [req.query.child] : CHILD_IDS();
    const month = req.query.month && T.isMonth(req.query.month) ? req.query.month : T.monthOf(T.todayStr());
    const out = ids.map((id) => {
      const s = M.childSummary(id, { weekStart: week, subject: req.query.subject || null, status: req.query.status || null });
      const tasks = all('SELECT * FROM tasks WHERE child_id = ? AND week_start = ? AND cancelled_at IS NULL AND stats_excluded = 0', id, s.week_start);
      const subjects = {};
      for (const t of tasks) { const x = (subjects[t.subject] ||= { subject: t.subject, total: 0, completed: 0, minutes: 0, minutes_done: 0 }); x.total++; x.minutes += t.est_minutes; if (t.status === 'done') { x.completed++; x.minutes_done += t.est_minutes; } }
      return { ...s, subject_breakdown: Object.values(subjects), month: { month, ...M.monthCompletion(id, month) },
        actual: (() => { const a = all('SELECT actual_minutes FROM sessions s JOIN tasks t ON t.id = s.task_id WHERE s.child_id = ? AND t.week_start = ? AND s.actual_minutes IS NOT NULL', id, s.week_start); return a.length ? { recorded: true, minutes: a.reduce((x, r) => x + r.actual_minutes, 0), sessions: a.length } : { recorded: false }; })() };
    });
    res.json({ children: out, week_start: T.weekStartOf(week), month });
  });

  // ---------- monthly ----------
  g('get', '/api/parent/monthly', async (req, res) => {
    res.json({ reports: all('SELECT id, month, child_id, data, parent_comment, next_month_priorities, created_at, comment_updated_at FROM monthly_reports ORDER BY month DESC, child_id').map((r) => ({ ...r, data: JSON.parse(r.data) })),
      resets: all('SELECT month, status, policy, started_at, finished_at, summary, error FROM monthly_resets ORDER BY month DESC').map((r) => ({ ...r, summary: r.summary ? JSON.parse(r.summary) : null })),
      pending: monthly.pendingMonths(), reset: getSetting('reset'), current_month: T.monthOf(T.todayStr()) });
  });
  g('get', '/api/parent/monthly/preview', async (req, res) => res.json(monthly.previewReset(req.query.month || T.monthOf(T.todayStr()))));
  g('post', '/api/parent/monthly/run', async (req, res) => {
    const b = await readJson(req);
    if (!T.isMonth(b.month)) throw bad('Choose a month.');
    if (b.confirm !== `RESET ${b.month}`) throw bad(`Type RESET ${b.month} to confirm. This permanently clears that month's detailed records.`);
    res.json(monthly.runReset(b.month, { by: 'manual' }));
  });
  g('patch', '/api/parent/reports/:id', async (req, res) => {
    const b = await readJson(req);
    const r = run('UPDATE monthly_reports SET parent_comment = ?, next_month_priorities = ?, comment_updated_at = ? WHERE id = ?',
      str(b.parent_comment, { max: 4000, name: 'Comment' }), str(b.next_month_priorities, { max: 2000, name: 'Priorities' }), T.nowISO(), Number(req.params.id));
    if (!r.changes) throw notFound('Report not found.'); res.json({ ok: true });
  });
}
module.exports = { register };
