'use strict';
// Core task workflow. Every state change (child or parent) goes through these functions so the rules live in one place.
const { get, all, run, tx, uid } = require('./db');
const T = require('./time');
const S = require('./scheduler');
const { HttpError, bad, forbidden, notFound, conflict, str, int, oneOf, url, flag } = require('./util');

const STATUSES = ['not_started', 'in_progress', 'done', 'needs_help'];
const SOFT_WARNINGS = new Set(['short_break']);   // do not need an explicit "go ahead"

// ---------- notifications ----------
function notify({ audience, kind, title, body = null, view = null, dedupe = null }) {
  run(`INSERT OR IGNORE INTO notifications (audience, kind, title, body, view, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    audience, kind, title, body, view, dedupe, T.nowISO());
}

// ---------- context loading ----------
function childContext(childId) {
  const child = get('SELECT * FROM children WHERE id = ?', childId);
  if (!child) throw notFound('Unknown child.');
  return {
    child,
    settings: get('SELECT * FROM child_settings WHERE child_id = ?', childId),
    blocks: all('SELECT * FROM fixed_blocks WHERE child_id = ?', childId),
    defaults: Object.fromEntries(all('SELECT * FROM task_defaults WHERE child_id = ?', childId).map((r) => [r.task_type, r])),
    tasks: all('SELECT * FROM tasks WHERE child_id = ?', childId),
    sessions: all('SELECT * FROM sessions WHERE child_id = ?', childId),
  };
}
const nowParts = () => ({ date: T.todayStr(), minutes: T.nowMinutes() });

// ---------- task creation ----------
function guessType(title = '', subject = '') {
  const s = `${title} ${subject}`.toLowerCase();
  if (/workbook/.test(s)) return 'workbook';
  if (/cindy|linh/.test(s)) return 'cindy';
  if (/vinh/.test(s)) return 'vinh';
  return 'other';
}
function defaultsFor(childId, type) {
  return get('SELECT * FROM task_defaults WHERE child_id = ? AND task_type = ?', childId, type) || get('SELECT * FROM task_defaults WHERE child_id = ? AND task_type = ?', childId, 'other')
    || { minutes: 60, session_min: 30, max_per_day: 2 };
}

// Validates one task description and fills the blanks. Anything the parent did not state is marked as a system suggestion.
function normalizeItem(raw, childId, weekStart) {
  const title = str(raw.title, { required: true, max: 200, name: 'Title' });
  const subject = str(raw.subject, { max: 60, name: 'Subject' }) || 'Other';
  const type = raw.task_type && ['workbook', 'cindy', 'vinh', 'other'].includes(raw.task_type) ? raw.task_type : guessType(title, subject);
  let est = int(raw.est_minutes, { min: 5, max: 900, name: 'Estimated minutes' });
  let estSource = raw.est_source && ['parent', 'source', 'system'].includes(raw.est_source) ? raw.est_source : 'parent';
  let estConfirmed = raw.est_confirmed === undefined ? 1 : flag(raw.est_confirmed);
  if (est === null) { est = defaultsFor(childId, type).minutes; estSource = 'system'; estConfirmed = 0; }
  if (estSource === 'system' && raw.est_confirmed === undefined) estConfirmed = 0;
  const deadline = raw.deadline ? (T.isDT(raw.deadline) ? raw.deadline : (() => { throw bad('Deadline must look like 2026-11-05T07:00.'); })()) : null;
  const target = raw.target ? (T.isDT(raw.target) ? raw.target : (() => { throw bad('Target must look like 2026-11-01T20:00.'); })()) : null;
  const priority = raw.priority === undefined || raw.priority === null ? 2 : int(raw.priority, { min: 1, max: 3, name: 'Priority' });
  return {
    title, subject, task_type: type, instructions: str(raw.instructions, { max: 4000, name: 'Instructions' }),
    est_minutes: est, est_source: estSource, est_confirmed: estConfirmed, deadline, target, priority,
    review_required: flag(raw.review_required), resource_link: url(raw.resource_link, 'Exercise link'), work_link: url(raw.work_link, 'Work file link'),
    notes: str(raw.notes, { max: 2000, name: 'Notes' }), depends_on: raw.depends_on || null,
    reporting_month: T.reportingMonthFor(deadline, weekStart),
  };
}

function createTasks({ items, childIds, weekStart, user, sourceFileId = null, isDemo = 0, sourceRef = null }) {
  if (!T.isDate(weekStart)) throw bad('Choose the intended week.');
  const ws = T.weekStartOf(weekStart);
  if (!Array.isArray(items) || !items.length) throw bad('There is nothing to save.');
  if (items.length > 100) throw bad('Please save at most 100 tasks at a time.');
  const created = [];
  tx(() => {
    for (const raw of items) {
      const kids = raw.child_id ? [raw.child_id] : childIds;
      if (!kids || !kids.length) throw bad('Choose Ben, Shin or both.');
      const batch = kids.length > 1 ? uid() : null;
      for (const childId of kids) {
        if (!get('SELECT 1 AS x FROM children WHERE id = ?', childId)) throw bad('Unknown child.');
        const n = normalizeItem(raw, childId, ws);
        if (sourceFileId && !get('SELECT 1 AS x FROM files WHERE id = ? AND kind = ?', sourceFileId, 'import')) throw bad('Unknown source file.');
        const id = uid(), now = T.nowISO();
        run(`INSERT INTO tasks (id, child_id, batch_id, subject, task_type, title, instructions, assigned_date, week_start, reporting_month, original_month,
              est_minutes, est_source, est_confirmed, deadline, target, priority, depends_on, review_required, review_status, resource_link, work_link,
              source_file_id, notes, is_demo, source_ref, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id, childId, batch, n.subject, n.task_type, n.title, n.instructions, T.todayStr(), ws, n.reporting_month, n.reporting_month,
          n.est_minutes, n.est_source, n.est_confirmed, n.deadline, n.target, n.priority, n.depends_on, n.review_required,
          n.review_required ? 'not_submitted' : 'not_required', n.resource_link, n.work_link,
          raw.source_file_id || sourceFileId, n.notes, isDemo, raw.source_ref || sourceRef, user ? user.id : null, now, now);
        created.push(id);
        notify({ audience: childId, kind: 'new_task', title: `New task: ${n.title}`, body: n.deadline ? `Deadline ${n.deadline.replace('T', ' ')}` : null, view: 'week' });
      }
    }
  });
  return created;
}

function updateTask(id, patch, user) {
  return tx(() => {
    const t = get('SELECT * FROM tasks WHERE id = ?', id);
    if (!t) throw notFound('Task not found.');
    if (patch.version !== undefined && Number(patch.version) !== t.version) throw conflict('This task was changed somewhere else. Please reload and try again.');
    if (t.cancelled_at) throw conflict('This task has been cancelled.');
    const merged = { ...t, ...Object.fromEntries(Object.entries(patch).filter(([k]) => k !== 'version')) };
    if (patch.est_minutes !== undefined && patch.est_source === undefined) { merged.est_source = 'parent'; merged.est_confirmed = 1; }
    const n = normalizeItem({ ...merged, review_required: merged.review_required, est_confirmed: merged.est_confirmed }, t.child_id, t.week_start);
    let reviewStatus = t.review_status;
    if (!n.review_required) reviewStatus = 'not_required';
    else if (t.review_status === 'not_required') reviewStatus = t.status === 'done' ? 'awaiting_review' : 'not_submitted';
    const monthChanged = n.reporting_month !== t.reporting_month && !t.carried_in;
    run(`UPDATE tasks SET title=?, subject=?, task_type=?, instructions=?, est_minutes=?, est_source=?, est_confirmed=?, deadline=?, target=?, priority=?,
         review_required=?, review_status=?, resource_link=?, work_link=?, notes=?, reporting_month=?, original_month=?, version=version+1, updated_at=? WHERE id=?`,
      n.title, n.subject, n.task_type, n.instructions, n.est_minutes, n.est_source, n.est_confirmed, n.deadline, n.target, n.priority,
      n.review_required, reviewStatus, n.resource_link, n.work_link, n.notes,
      t.carried_in ? t.reporting_month : n.reporting_month, monthChanged ? n.reporting_month : t.original_month, T.nowISO(), id);
    if (n.review_required && reviewStatus === 'awaiting_review' && t.review_status === 'not_required') {
      notify({ audience: 'parent', kind: 'review', title: `${childName(t.child_id)}: "${n.title}" is awaiting your review`, view: 'review' });
    }
    return get('SELECT * FROM tasks WHERE id = ?', id);
  });
}
const childName = (id) => (get('SELECT name FROM children WHERE id = ?', id) || {}).name || id;

function cancelTask(id) {
  return tx(() => {
    const t = get('SELECT * FROM tasks WHERE id = ?', id);
    if (!t) throw notFound('Task not found.');
    if (t.cancelled_at) return t;
    run('UPDATE tasks SET cancelled_at = ?, version = version + 1, updated_at = ? WHERE id = ?', T.nowISO(), T.nowISO(), id);
    run("DELETE FROM sessions WHERE task_id = ? AND status = 'planned'", id);
    notify({ audience: t.child_id, kind: 'cancelled', title: `Cancelled: ${t.title}`, view: 'week' });
    return get('SELECT * FROM tasks WHERE id = ?', id);
  });
}
function confirmEstimate(id) {
  const r = run('UPDATE tasks SET est_confirmed = 1, version = version + 1, updated_at = ? WHERE id = ?', T.nowISO(), id);
  if (!r.changes) throw notFound('Task not found.');
}

// ---------- status handling ----------
function markDone(t, { cascadeSessions }) {
  const now = T.nowISO();
  if (cascadeSessions) run("UPDATE sessions SET status = 'done', done_at = COALESCE(done_at, ?), version = version + 1 WHERE task_id = ? AND status != 'done'", now, t.id);
  let review = t.review_status;
  if (t.review_required && ['not_submitted', 'changes_requested', 'awaiting_review'].includes(t.review_status)) review = 'awaiting_review';
  run('UPDATE tasks SET status = ?, completed_at = COALESCE(completed_at, ?), review_status = ?, version = version + 1, updated_at = ? WHERE id = ?', 'done', now, review, now, t.id);
  if (t.review_required && review === 'awaiting_review' && t.review_status !== 'awaiting_review') {
    notify({ audience: 'parent', kind: 'review', title: `${childName(t.child_id)} finished "${t.title}"`, body: 'Waiting for your review.', view: 'review' });
  }
}
function reopen(t, status) {
  let review = t.review_status;
  if (review === 'awaiting_review') review = 'not_submitted';
  run("UPDATE sessions SET status = 'planned', done_at = NULL, version = version + 1 WHERE task_id = ? AND status = 'done'", t.id);
  run('UPDATE tasks SET status = ?, completed_at = NULL, review_status = ?, version = version + 1, updated_at = ? WHERE id = ?', status, review, T.nowISO(), t.id);
}
function assertChildMayChange(t, actor) {
  if (t.cancelled_at) throw conflict('This task was cancelled.');
  if (actor && actor.role === 'child' && t.review_status === 'approved') throw conflict('Your parent already approved this work, so it is locked.');
}

function setTaskStatus(taskId, status, actor) {
  oneOf(status, STATUSES, 'Status');
  return tx(() => {
    const t = get('SELECT * FROM tasks WHERE id = ?', taskId);
    if (!t) throw notFound('Task not found.');
    assertChildMayChange(t, actor);
    if (status === t.status) return get('SELECT * FROM tasks WHERE id = ?', taskId);
    if (status === 'done') markDone(t, { cascadeSessions: true });
    else if (t.status === 'done') reopen(t, status);
    else run('UPDATE tasks SET status = ?, version = version + 1, updated_at = ? WHERE id = ?', status, T.nowISO(), taskId);
    if (status === 'needs_help') {
      run('UPDATE tasks SET help_requested = 1 WHERE id = ?', taskId);
      if (!get("SELECT 1 AS x FROM help_requests WHERE task_id = ? AND status = 'open'", taskId)) addHelp(t.id, t.child_id, 'I need help with this task.');
    }
    return get('SELECT * FROM tasks WHERE id = ?', taskId);
  });
}

function recomputeTask(taskId) {
  const t = get('SELECT * FROM tasks WHERE id = ?', taskId);
  if (!t || t.cancelled_at) return;
  const ss = all('SELECT status FROM sessions WHERE task_id = ?', taskId);
  if (!ss.length) return;
  const doneCount = ss.filter((s) => s.status === 'done').length;
  if (t.status === 'done' && doneCount < ss.length) {
    let review = t.review_status; if (review === 'awaiting_review') review = 'not_submitted';
    run("UPDATE tasks SET status = 'in_progress', completed_at = NULL, review_status = ?, version = version + 1, updated_at = ? WHERE id = ?", review, T.nowISO(), taskId);
  } else if (t.status !== 'done' && doneCount === ss.length) markDone(t, { cascadeSessions: false });
  else if (t.status === 'not_started' && doneCount > 0) run("UPDATE tasks SET status = 'in_progress', version = version + 1, updated_at = ? WHERE id = ?", T.nowISO(), taskId);
}

function setSessionStatus(sessionId, status, actualMinutes, actor) {
  oneOf(status, ['planned', 'done'], 'Session status');
  const actual = int(actualMinutes, { min: 1, max: 600, name: 'Actual minutes' });
  return tx(() => {
    const s = get('SELECT * FROM sessions WHERE id = ?', sessionId);
    if (!s) throw notFound('Session not found.');
    const t = get('SELECT * FROM tasks WHERE id = ?', s.task_id);
    assertChildMayChange(t, actor);
    run('UPDATE sessions SET status = ?, done_at = ?, actual_minutes = ?, version = version + 1 WHERE id = ?',
      status, status === 'done' ? (s.done_at || T.nowISO()) : null, status === 'done' ? actual : null, sessionId);
    recomputeTask(s.task_id);
    return { session: get('SELECT * FROM sessions WHERE id = ?', sessionId), task: get('SELECT * FROM tasks WHERE id = ?', s.task_id) };
  });
}

// ---------- manual schedule changes by the child ----------
function sessionPlacementCheck(s, t, date, start) {
  const ctx = childContext(s.child_id);
  return { ctx, warnings: S.checkPlacement({ settings: ctx.settings, blocks: ctx.blocks, sessions: ctx.sessions, task: t, session: s, date, start, now: nowParts() }) };
}
function needAck(warnings, acknowledged) {
  const hard = warnings.filter((w) => !SOFT_WARNINGS.has(w.code));
  if (hard.length && !acknowledged) throw new HttpError(409, 'Please check the warnings before moving this.', { needs_ack: true, warnings });
}

function moveSession(sessionId, { date, start, version, acknowledged }, actor) {
  if (!T.isDate(date)) throw bad('Choose a valid date.');
  return tx(() => {
    const s = get('SELECT * FROM sessions WHERE id = ?', sessionId);
    if (!s) throw notFound('Session not found.');
    const t = get('SELECT * FROM tasks WHERE id = ?', s.task_id);
    assertChildMayChange(t, actor);
    if (s.status === 'done') throw conflict('This session is already finished, so it cannot be moved.');
    if (version !== undefined && version !== null && Number(version) !== s.version) throw conflict('Someone changed this session. Please reload.');
    let st = start;
    if (!st) {
      const ctx = childContext(s.child_id);
      const slot = S.firstFreeSlot({ settings: ctx.settings, blocks: ctx.blocks, sessions: ctx.sessions, session: s, date, len: s.minutes, now: nowParts() });
      st = slot === null ? (T.isTime(ctx.settings.home_weekday) ? (T.weekdayOf(date) >= 6 ? ctx.settings.weekend_start : ctx.settings.home_weekday) : '17:00') : T.fmtHM(slot);
    }
    if (!T.isTime(st)) throw bad('Choose a valid start time (HH:MM).');
    const end = T.parseHM(st) + s.minutes;
    if (end > 24 * 60) throw bad('That session would run past midnight.');
    const { warnings } = sessionPlacementCheck(s, t, date, st);
    needAck(warnings, acknowledged);
    run("UPDATE sessions SET planned_date = ?, start_time = ?, end_time = ?, locked = 1, origin = 'manual', version = version + 1 WHERE id = ?", date, st, T.fmtHM(end), sessionId);
    return { session: get('SELECT * FROM sessions WHERE id = ?', sessionId), warnings };
  });
}

// Swap a session with its neighbour on the same day (keeps total time and the gap between them).
function shiftSession(sessionId, direction, actor) {
  oneOf(direction, ['up', 'down'], 'Direction');
  return tx(() => {
    const s = get('SELECT * FROM sessions WHERE id = ?', sessionId);
    if (!s) throw notFound('Session not found.');
    assertChildMayChange(get('SELECT * FROM tasks WHERE id = ?', s.task_id), actor);
    const day = all('SELECT * FROM sessions WHERE child_id = ? AND planned_date = ? ORDER BY start_time', s.child_id, s.planned_date);
    const i = day.findIndex((x) => x.id === sessionId);
    const j = direction === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= day.length) throw conflict('It is already at the edge of the day.');
    const [a, b] = i < j ? [day[i], day[j]] : [day[j], day[i]];
    if (a.status === 'done' || b.status === 'done') throw conflict('Finished sessions cannot be reordered.');
    const gap = T.parseHM(b.start_time) - T.parseHM(a.end_time);
    const firstStart = T.parseHM(a.start_time);
    const newFirst = b, newSecond = a;
    const s1 = firstStart, s2 = firstStart + newFirst.minutes + gap;
    run("UPDATE sessions SET start_time = ?, end_time = ?, locked = 1, origin = 'manual', version = version + 1 WHERE id = ?", T.fmtHM(s1), T.fmtHM(s1 + newFirst.minutes), newFirst.id);
    run("UPDATE sessions SET start_time = ?, end_time = ?, locked = 1, origin = 'manual', version = version + 1 WHERE id = ?", T.fmtHM(s2), T.fmtHM(s2 + newSecond.minutes), newSecond.id);
    return all('SELECT * FROM sessions WHERE child_id = ? AND planned_date = ? ORDER BY start_time', s.child_id, s.planned_date);
  });
}
function setLock(sessionId, locked) {
  const r = run('UPDATE sessions SET locked = ?, version = version + 1 WHERE id = ?', flag(locked), sessionId);
  if (!r.changes) throw notFound('Session not found.');
  return get('SELECT * FROM sessions WHERE id = ?', sessionId);
}

// The child places an unscheduled task (or the unscheduled part of one) by choosing a day and time.
function planTask(taskId, { date, start, minutes, acknowledged }, actor) {
  if (!T.isDate(date) || !T.isTime(start)) throw bad('Choose a date and a start time.');
  return tx(() => {
    const t = get('SELECT * FROM tasks WHERE id = ?', taskId);
    if (!t) throw notFound('Task not found.');
    assertChildMayChange(t, actor);
    if (t.status === 'done') throw conflict('This task is already done.');
    const planned = all('SELECT minutes FROM sessions WHERE task_id = ?', taskId).reduce((a, s) => a + s.minutes, 0);
    const left = t.est_minutes - planned;
    if (left <= 0) throw conflict('All of this task is already planned.');
    const len = minutes ? int(minutes, { min: 5, max: left, name: 'Minutes' }) : left;
    const seq = (get('SELECT MAX(seq) AS m FROM sessions WHERE task_id = ?', taskId).m || 0) + 1;
    const probe = { id: 'new', child_id: t.child_id, minutes: len };
    const { warnings } = sessionPlacementCheck(probe, t, date, start);
    needAck(warnings, acknowledged);
    const id = uid();
    run(`INSERT INTO sessions (id, task_id, child_id, seq, planned_date, start_time, end_time, minutes, locked, origin, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'manual', ?)`, id, taskId, t.child_id, seq, date, start, T.fmtHM(T.parseHM(start) + len), len, T.nowISO());
    refreshUnscheduled(taskId);
    return { session: get('SELECT * FROM sessions WHERE id = ?', id), warnings };
  });
}
function refreshUnscheduled(taskId) {
  const t = get('SELECT * FROM tasks WHERE id = ?', taskId);
  const planned = all('SELECT minutes FROM sessions WHERE task_id = ?', taskId).reduce((a, s) => a + s.minutes, 0);
  if (planned >= t.est_minutes && t.unscheduled_reason) run('UPDATE tasks SET unscheduled_reason = NULL WHERE id = ?', taskId);
}

// ---------- submissions, review, help ----------
function submitTask(taskId, { link, note, fileId, requestId }, actor) {
  const cleanLink = url(link, 'Work link'), cleanNote = str(note, { max: 3000, name: 'Note' });
  return tx(() => {
    const t = get('SELECT * FROM tasks WHERE id = ?', taskId);
    if (!t) throw notFound('Task not found.');
    if (requestId) { const dup = get('SELECT * FROM submissions WHERE request_id = ?', requestId); if (dup) return { submission: dup, task: t, duplicate: true }; }
    assertChildMayChange(t, actor);
    if (!cleanLink && !cleanNote && !fileId && !t.review_required) throw bad('Add a link, a file or a note to submit.');
    if (fileId) {
      const f = get('SELECT * FROM files WHERE id = ?', fileId);
      if (!f || f.kind !== 'submission' || f.owner_child_id !== t.child_id) throw bad('That file cannot be attached.');
      if (get('SELECT 1 AS x FROM submissions WHERE file_id = ?', fileId)) throw bad('That file was already submitted.');
    }
    const round = (get('SELECT MAX(round) AS m FROM submissions WHERE task_id = ?', taskId).m || 0) + 1;
    const id = uid();
    run('INSERT INTO submissions (id, task_id, child_id, round, link, file_id, note, request_id, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, taskId, t.child_id, round, cleanLink, fileId || null, cleanNote, requestId || null, T.nowISO());
    if (t.status !== 'done') markDone(t, { cascadeSessions: true });
    else if (t.review_required) {
      run("UPDATE tasks SET review_status = 'awaiting_review', version = version + 1, updated_at = ? WHERE id = ?", T.nowISO(), taskId);
      notify({ audience: 'parent', kind: 'review', title: `${childName(t.child_id)} ${round > 1 ? 're-submitted' : 'submitted'} "${t.title}"`, view: 'review' });
    }
    return { submission: get('SELECT * FROM submissions WHERE id = ?', id), task: get('SELECT * FROM tasks WHERE id = ?', taskId), duplicate: false };
  });
}

function reviewTask(taskId, decision, feedback) {
  oneOf(decision, ['approved', 'changes_requested'], 'Decision');
  const fb = str(feedback, { max: 3000, name: 'Feedback', required: decision === 'changes_requested' });
  return tx(() => {
    const t = get('SELECT * FROM tasks WHERE id = ?', taskId);
    if (!t) throw notFound('Task not found.');
    if (t.review_status !== 'awaiting_review') throw conflict('This task is not waiting for review.');
    const sub = get('SELECT id FROM submissions WHERE task_id = ? ORDER BY round DESC LIMIT 1', taskId);
    run('INSERT INTO reviews (id, task_id, submission_id, decision, feedback, created_at) VALUES (?, ?, ?, ?, ?, ?)', uid(), taskId, sub ? sub.id : null, decision, fb, T.nowISO());
    run('UPDATE tasks SET review_status = ?, version = version + 1, updated_at = ? WHERE id = ?', decision, T.nowISO(), taskId);
    notify({ audience: t.child_id, kind: decision, view: 'feedback',
      title: decision === 'approved' ? `Approved: ${t.title}` : `Changes needed: ${t.title}`, body: fb });
    return get('SELECT * FROM tasks WHERE id = ?', taskId);
  });
}
function reopenByParent(taskId) {
  return tx(() => {
    const t = get('SELECT * FROM tasks WHERE id = ?', taskId);
    if (!t) throw notFound('Task not found.');
    reopen(t, 'in_progress');
    if (t.review_required) run("UPDATE tasks SET review_status = 'not_submitted' WHERE id = ?", taskId);
    notify({ audience: t.child_id, kind: 'reopened', title: `Reopened: ${t.title}`, view: 'today' });
    return get('SELECT * FROM tasks WHERE id = ?', taskId);
  });
}

function addHelp(taskId, childId, message) {
  const id = uid();
  run('INSERT INTO help_requests (id, task_id, child_id, message, created_at) VALUES (?, ?, ?, ?, ?)', id, taskId, childId, message, T.nowISO());
  const t = taskId ? get('SELECT title FROM tasks WHERE id = ?', taskId) : null;
  notify({ audience: 'parent', kind: 'help', title: `${childName(childId)} needs help${t ? ` with "${t.title}"` : ''}`, body: message, view: 'help' });
  return id;
}
function requestHelp(taskId, message, actor) {
  const msg = str(message, { required: true, max: 1500, name: 'Message' });
  return tx(() => {
    const t = get('SELECT * FROM tasks WHERE id = ?', taskId);
    if (!t) throw notFound('Task not found.');
    assertChildMayChange(t, actor);
    const id = addHelp(taskId, t.child_id, msg);
    run("UPDATE tasks SET help_requested = 1, status = CASE WHEN status = 'done' THEN status ELSE 'needs_help' END, version = version + 1, updated_at = ? WHERE id = ?", T.nowISO(), taskId);
    return get('SELECT * FROM help_requests WHERE id = ?', id);
  });
}
function replyHelp(helpId, reply) {
  const text = str(reply, { required: true, max: 3000, name: 'Reply' });
  return tx(() => {
    const h = get('SELECT * FROM help_requests WHERE id = ?', helpId);
    if (!h) throw notFound('Help request not found.');
    run("UPDATE help_requests SET status = 'answered', reply = ?, answered_at = ? WHERE id = ?", text, T.nowISO(), helpId);
    if (h.task_id && !get("SELECT 1 AS x FROM help_requests WHERE task_id = ? AND status = 'open'", h.task_id)) {
      run("UPDATE tasks SET help_requested = 0, status = CASE WHEN status = 'needs_help' THEN 'in_progress' ELSE status END, version = version + 1 WHERE id = ?", h.task_id);
    }
    notify({ audience: h.child_id, kind: 'help_reply', title: 'Your parent replied to your help request', body: text, view: 'feedback' });
    return get('SELECT * FROM help_requests WHERE id = ?', helpId);
  });
}

module.exports = { notify, childContext, nowParts, createTasks, updateTask, cancelTask, confirmEstimate, setTaskStatus, setSessionStatus, moveSession, shiftSession,
  setLock, planTask, submitTask, reviewTask, reopenByParent, requestHelp, replyHelp, guessType, defaultsFor, normalizeItem, childName, STATUSES };
