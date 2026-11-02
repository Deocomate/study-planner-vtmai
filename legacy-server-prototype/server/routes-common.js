'use strict';
// Routes used by both children and the parent. Authorisation is enforced here, on the server, for every request.
const { get, all, run, tx } = require('./db');
const T = require('./time');
const A = require('./auth');
const K = require('./tasks');
const M = require('./metrics');
const F = require('./files');
const S = require('./scheduler');
const mailer = require('./mailer');
const importer = require('./importer');
const { readJson, readBody } = require('./http');
const { HttpError, bad, forbidden, notFound, str, int, oneOf } = require('./util');
const { getSetting, setSetting } = require('./settings');
const demo = require('./demo');

const secureCookie = (req) => process.env.COOKIE_SECURE === '1' || req.headers['x-forwarded-proto'] === 'https';

// ---------- serializers ----------
const taskPublic = (t) => ({ id: t.id, child_id: t.child_id, title: t.title, subject: t.subject, instructions: t.instructions, notes: t.notes, status: t.status,
  review_required: t.review_required, review_status: t.review_status, resource_link: t.resource_link, work_link: t.work_link, deadline: t.deadline,
  target: t.target, priority: t.priority, est_minutes: t.est_minutes, est_source: t.est_source, est_confirmed: t.est_confirmed, help_requested: t.help_requested,
  version: t.version, is_demo: t.is_demo, carried_in: t.carried_in, week_start: t.week_start, source_file_id: t.source_file_id, unscheduled_reason: t.unscheduled_reason,
  completed_at: t.completed_at, has_source_file: !!t.source_file_id });

function sessionItem(s, taskMap, totals) {
  const t = taskMap.get(s.task_id);
  return { id: s.id, task_id: s.task_id, planned_date: s.planned_date, start_time: s.start_time, end_time: s.end_time, minutes: s.minutes, status: s.status,
    locked: s.locked, version: s.version, seq: s.seq, seq_total: totals.get(s.task_id) || 1, actual_minutes: s.actual_minutes, origin: s.origin, task: taskPublic(t) };
}
function loadBoard(childId) {
  const ctx = K.childContext(childId);
  const taskMap = new Map(ctx.tasks.map((t) => [t.id, t]));
  const totals = new Map();
  for (const s of ctx.sessions) totals.set(s.task_id, (totals.get(s.task_id) || 0) + 1);
  return { ctx, taskMap, totals };
}
function fixedForDate(ctx, date) {
  const wd = T.weekdayOf(date), parity = T.weekParity(T.weekStartOf(date));
  return ctx.blocks.filter((b) => b.weekday === wd && (b.week_parity === 'every' || b.week_parity === parity) && b.kind !== 'school')
    .map((b) => ({ title: b.title, start: b.start_time, end: b.end_time, kind: b.kind, mode: b.mode, travel_before_min: b.travel_before_min, travel_after_min: b.travel_after_min }))
    .sort((a, b) => a.start.localeCompare(b.start));
}
const schoolForDate = (ctx, date) => ctx.blocks.filter((b) => b.kind === 'school' && b.weekday === T.weekdayOf(date)).map((b) => ({ title: b.title, start: b.start_time, end: b.end_time }));

function sessionAccess(req, sessionId) {
  A.requireLogin(req);
  const s = get('SELECT * FROM sessions WHERE id = ?', sessionId);
  if (!s) throw notFound('Session not found.');
  if (req.user.role === 'child' && s.child_id !== req.user.child_id) throw forbidden('This session belongs to someone else.');
  return s;
}

function register(app) {
  // ---------- setup / login ----------
  app.get('/api/health', (req, res) => res.json({ ok: true, time: T.nowISO() }));
  app.get('/api/setup/status', (req, res) => res.json({ needs_setup: !get('SELECT 1 AS x FROM users LIMIT 1'), needs_code: !!process.env.SETUP_CODE || process.env.NODE_ENV === 'production',
    production_without_code: process.env.NODE_ENV === 'production' && !process.env.SETUP_CODE }));
  app.post('/api/setup', async (req, res) => {
    const b = await readJson(req);
    if (get('SELECT 1 AS x FROM users LIMIT 1')) throw new HttpError(409, 'The family is already set up. Please sign in.');
    if (process.env.NODE_ENV === 'production' && !process.env.SETUP_CODE) throw new HttpError(403, 'For safety, set the SETUP_CODE environment variable before first-time setup on a public server.');
    if (process.env.SETUP_CODE && b.setup_code !== process.env.SETUP_CODE) throw new HttpError(403, 'The setup code is not right.');
    const email = str(b.parent_email, { max: 200, name: 'Parent email' });
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('That email address does not look right.');
    A.checkPasswordRules('parent', b.parent_password); A.checkPasswordRules('child', b.ben_password); A.checkPasswordRules('child', b.shin_password);
    tx(() => {
      const ins = (u, role, name, pw, child, mail) => run('INSERT INTO users (username, role, display_name, email, password_hash, child_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        u, role, name, mail, A.hashPassword(pw), child, T.nowISO());
      ins('parent', 'parent', 'Parent', b.parent_password, null, email);
      ins('ben', 'child', 'Ben', b.ben_password, 'ben', null);
      ins('shin', 'child', 'Shin', b.shin_password, 'shin', null);
      setSetting('parent_email', email);
      setSetting('first_month', T.monthOf(T.todayStr()));
    });
    if (b.load_demo) demo.loadDemo(get("SELECT * FROM users WHERE username = 'parent'"));
    req.body = { username: 'parent', password: b.parent_password };
    const out = await A.login(req, res, secureCookie(req));
    res.json(out);
  });
  app.post('/api/login', async (req, res) => res.json(await A.login(req, res, secureCookie(req))));
  app.post('/api/logout', (req, res) => { A.logout(req, res); res.json({ ok: true }); });
  app.get('/api/me', (req, res) => {
    if (!req.user) return res.json({ user: null, needs_setup: !get('SELECT 1 AS x FROM users LIMIT 1') });
    const children = all('SELECT * FROM children').filter((c) => req.user.role === 'parent' || c.id === req.user.child_id);
    res.json({ user: req.user, csrf: req.csrf, children, today: T.todayStr(), now_minutes: T.nowMinutes(),
      config: { email: mailer.status(), timezone: T.TZ, demo_loaded: !!get('SELECT 1 AS x FROM tasks WHERE is_demo = 1 LIMIT 1') } });
  });
  app.post('/api/me/password', async (req, res) => {
    A.requireLogin(req);
    const b = await readJson(req);
    const u = get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!A.verifyPassword(String(b.current || ''), u.password_hash)) throw new HttpError(403, 'Your current password is not right.');
    A.setPassword(u.id, u.role, b.new);
    const s = A.createSession(u.id);
    res.cookie('sid', s.token, { maxAge: 14 * 86400, secure: secureCookie(req) });
    res.json({ ok: true, csrf: s.csrf });
  });

  // ---------- boards ----------
  app.get('/api/board/:child/today', (req, res) => {
    const childId = A.childScope(req, req.params.child);
    const { ctx, taskMap, totals } = loadBoard(childId);
    const date = T.todayStr(), nowKey = T.nowKey();
    const sessions = ctx.sessions.filter((s) => s.planned_date === date && !taskMap.get(s.task_id).cancelled_at)
      .sort((a, b) => a.start_time.localeCompare(b.start_time)).map((s) => sessionItem(s, taskMap, totals));
    const live = ctx.tasks.filter((t) => !t.cancelled_at && !t.stats_excluded);
    res.json({
      date, child: ctx.child, sessions, progress: M.daily(ctx, date), fixed: fixedForDate(ctx, date), school: schoolForDate(ctx, date),
      overdue: live.filter((t) => M.isOverdue(t, nowKey)).map(taskPublic),
      revisions: ctx.tasks.filter((t) => t.review_status === 'changes_requested' && !t.cancelled_at).map(taskPublic),
      unscheduled_count: M.unscheduledTasks(ctx).length,
      help_open: get("SELECT COUNT(*) AS n FROM help_requests WHERE child_id = ? AND status = 'open'", childId).n,
    });
  });

  app.get('/api/board/:child/week', (req, res) => {
    const childId = A.childScope(req, req.params.child);
    const week = req.query.week && T.isDate(req.query.week) ? T.weekStartOf(req.query.week) : T.weekStartOf(T.todayStr());
    const { ctx, taskMap, totals } = loadBoard(childId);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = T.addDays(week, i), d = M.daily(ctx, date);
      days.push({ date, weekday: T.weekdayOf(date), fixed: fixedForDate(ctx, date), planned_minutes: d.planned_minutes, done_minutes: d.done_minutes, cap: d.cap, overloaded: d.overloaded,
        sessions: ctx.sessions.filter((s) => s.planned_date === date && !taskMap.get(s.task_id).cancelled_at).sort((a, b) => a.start_time.localeCompare(b.start_time)).map((s) => sessionItem(s, taskMap, totals)) });
    }
    const weekEnd = T.addDays(week, 6), nowKey = T.nowKey();
    const unscheduled = M.unscheduledTasks(ctx).filter((t) => t.week_start <= weekEnd).map((t) => ({ ...taskPublic(t), unscheduled_minutes: t.unscheduled_minutes }));
    const sum = M.completion(ctx.tasks.filter((t) => t.week_start === week));
    res.json({ week_start: week, week_end: weekEnd, child: ctx.child, days, unscheduled,
      overdue: ctx.tasks.filter((t) => M.isOverdue(t, nowKey) && !t.stats_excluded).map(taskPublic), summary: sum, weekly_planned_minutes: days.reduce((a, d) => a + d.planned_minutes, 0),
      settings: { break_min: ctx.settings.break_min } });
  });

  app.get('/api/board/:child/feedback', (req, res) => {
    const childId = A.childScope(req, req.params.child);
    const ctx = K.childContext(childId);
    const decorate = (t) => ({ ...taskPublic(t),
      reviews: all('SELECT decision, feedback, created_at FROM reviews WHERE task_id = ? ORDER BY created_at', t.id),
      submissions: all('SELECT id, round, link, note, file_id, submitted_at FROM submissions WHERE task_id = ? ORDER BY round', t.id) });
    const live = ctx.tasks.filter((t) => !t.cancelled_at);
    res.json({
      revisions: live.filter((t) => t.review_status === 'changes_requested').map(decorate),
      awaiting: live.filter((t) => t.review_status === 'awaiting_review').map(decorate),
      approved: live.filter((t) => t.review_status === 'approved').map(decorate).slice(-10),
      help: all(`SELECT h.id, h.message, h.status, h.reply, h.created_at, h.answered_at, t.title FROM help_requests h LEFT JOIN tasks t ON t.id = h.task_id WHERE h.child_id = ? ORDER BY h.created_at DESC LIMIT 30`, childId),
    });
  });

  app.get('/api/tasks/:id', (req, res) => {
    const t = A.taskAccess(req, req.params.id);
    res.json({ task: req.user.role === 'parent' ? t : taskPublic(t),
      sessions: all('SELECT * FROM sessions WHERE task_id = ? ORDER BY planned_date, start_time', t.id),
      submissions: all(`SELECT s.id, s.round, s.link, s.note, s.file_id, s.submitted_at, f.original_name AS file_name FROM submissions s LEFT JOIN files f ON f.id = s.file_id WHERE s.task_id = ? ORDER BY s.round`, t.id),
      reviews: all('SELECT decision, feedback, created_at FROM reviews WHERE task_id = ? ORDER BY created_at', t.id),
      help: all('SELECT id, message, status, reply, created_at, answered_at FROM help_requests WHERE task_id = ? ORDER BY created_at', t.id) });
  });

  // ---------- child / parent actions on tasks and sessions ----------
  app.post('/api/tasks/:id/status', async (req, res) => {
    const t = A.taskAccess(req, req.params.id);
    const b = await readJson(req);
    const task = K.setTaskStatus(t.id, b.status, req.user);
    res.json({ task: taskPublic(task) });
  });
  app.post('/api/tasks/:id/submit', async (req, res) => {
    const t = A.taskAccess(req, req.params.id);
    const b = await readJson(req);
    const r = K.submitTask(t.id, { link: b.link, note: b.note, fileId: b.file_id, requestId: str(b.request_id, { max: 80 }) }, req.user);
    res.json({ task: taskPublic(r.task), submission: r.submission, duplicate: r.duplicate });
  });
  app.post('/api/tasks/:id/help', async (req, res) => {
    const t = A.taskAccess(req, req.params.id);
    const b = await readJson(req);
    res.json({ help: K.requestHelp(t.id, b.message, req.user) });
  });
  app.post('/api/tasks/:id/plan', async (req, res) => {
    const t = A.taskAccess(req, req.params.id);
    const b = await readJson(req);
    res.json(K.planTask(t.id, { date: b.date, start: b.start, minutes: b.minutes, acknowledged: !!b.acknowledged }, req.user));
  });
  app.post('/api/sessions/:id/status', async (req, res) => {
    const s = sessionAccess(req, req.params.id);
    const b = await readJson(req);
    const r = K.setSessionStatus(s.id, b.status, b.actual_minutes, req.user);
    res.json({ session: r.session, task: taskPublic(r.task) });
  });
  app.post('/api/sessions/:id/move', async (req, res) => {
    const s = sessionAccess(req, req.params.id);
    const b = await readJson(req);
    res.json(K.moveSession(s.id, { date: b.date, start: b.start || null, version: b.version, acknowledged: !!b.acknowledged }, req.user));
  });
  app.post('/api/sessions/:id/shift', async (req, res) => {
    const s = sessionAccess(req, req.params.id);
    const b = await readJson(req);
    res.json({ sessions: K.shiftSession(s.id, b.direction, req.user) });
  });
  app.post('/api/sessions/:id/lock', async (req, res) => {
    const s = sessionAccess(req, req.params.id);
    const b = await readJson(req);
    res.json({ session: K.setLock(s.id, !!b.locked) });
  });

  // ---------- files (private; raw upload, never public) ----------
  app.post('/api/files', async (req, res) => {
    A.requireLogin(req);
    const kind = oneOf(req.query.kind, ['import', 'submission'], 'kind');
    let owner = null;
    if (kind === 'import') A.requireParent(req);
    else owner = req.user.role === 'child' ? req.user.child_id : A.childScope(req, req.query.child);
    const buf = await readBody(req, F.MAX_BYTES + 1024);
    res.json({ file: F.saveUpload({ buf, name: req.query.name, kind, ownerChildId: owner, userId: req.user.id }) });
  });
  app.get('/api/files/:id', (req, res) => {
    A.requireLogin(req);
    const f = get('SELECT * FROM files WHERE id = ?', req.params.id);
    if (!f || !F.canRead(req.user, f)) throw notFound('File not found.');
    const inline = f.mime === 'application/pdf' || f.mime.startsWith('image/');
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    res.end(F.readFile(f));
  });

  // ---------- notifications ----------
  const audienceOf = (req) => { A.requireLogin(req); return req.user.role === 'parent' ? 'parent' : req.user.child_id; };
  app.get('/api/notifications', (req, res) => {
    const a = audienceOf(req);
    res.json({ items: all('SELECT id, kind, title, body, view, created_at, read_at FROM notifications WHERE audience = ? ORDER BY id DESC LIMIT 50', a),
      unread: get('SELECT COUNT(*) AS n FROM notifications WHERE audience = ? AND read_at IS NULL', a).n });
  });
  app.post('/api/notifications/read', async (req, res) => {
    const a = audienceOf(req);
    const b = await readJson(req);
    if (Array.isArray(b.ids)) for (const id of b.ids.slice(0, 100)) run('UPDATE notifications SET read_at = ? WHERE id = ? AND audience = ? AND read_at IS NULL', T.nowISO(), Number(id), a);
    else run('UPDATE notifications SET read_at = ? WHERE audience = ? AND read_at IS NULL', T.nowISO(), a);
    res.json({ ok: true });
  });
}
module.exports = { register, taskPublic, loadBoard };
