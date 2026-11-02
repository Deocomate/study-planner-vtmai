'use strict';
// Monthly evaluation and reset.
// Reporting-month rule: a task belongs to the month of its original deadline; with no deadline, to the month containing the Thursday of its week.
// Safeguards: (1) reports are saved, then verified, BEFORE anything is deleted; (2) the reset is claimed in the database so it
// cannot run twice; (3) if anything fails the details are left untouched and the parent is told.
const { get, all, run, tx } = require('./db');
const T = require('./time');
const M = require('./metrics');
const F = require('./files');
const { notify } = require('./tasks');
const { getSetting } = require('./settings');
const { HttpError, bad, conflict } = require('./util');
const reminders = require('./reminders');

const RESET_DELAY_MIN = 10;   // runs at 00:10 on the 1st (Asia/Ho_Chi_Minh)

const placeholders = (n) => Array(n).fill('?').join(',');

function buildReport(month, childId, policy) {
  const child = get('SELECT * FROM children WHERE id = ?', childId);
  const all_ = all('SELECT * FROM tasks WHERE child_id = ? AND reporting_month = ?', childId, month);
  const tasks = all_.filter((t) => !t.cancelled_at && !t.stats_excluded);
  const ids = tasks.map((t) => t.id);
  const inIds = ids.length ? placeholders(ids.length) : "''";
  const comp = M.completion(tasks);
  const unfinished = tasks.filter((t) => t.status !== 'done');
  const reviewReq = tasks.filter((t) => t.review_required);
  const sessions = ids.length ? all(`SELECT * FROM sessions WHERE task_id IN (${inIds})`, ...ids) : [];
  const withActual = sessions.filter((s) => s.actual_minutes !== null);
  const subjects = {};
  for (const t of tasks) {
    const s = (subjects[t.subject] ||= { subject: t.subject, total: 0, completed: 0, est_minutes_total: 0, est_minutes_completed: 0 });
    s.total++; s.est_minutes_total += t.est_minutes; if (t.status === 'done') { s.completed++; s.est_minutes_completed += t.est_minutes; }
  }
  return {
    month, child: { id: child.id, name: child.name, grade: child.grade }, generated_at: T.nowISO(), unfinished_policy: policy,
    newly_assigned: tasks.filter((t) => !t.carried_in).length, carried_in: tasks.filter((t) => t.carried_in).length, total_eligible: tasks.length,
    cancelled_excluded: all_.filter((t) => t.cancelled_at).length,
    completed: comp.completed, unfinished: { total: unfinished.length, carried_forward: policy === 'carry' ? unfinished.length : 0, closed: policy === 'close' ? unfinished.length : 0 },
    completion_count_pct: comp.count_pct, completion_weighted_pct: comp.weighted_pct,
    est_minutes_total: comp.est_minutes_total, est_minutes_completed: comp.est_minutes_completed,
    on_time: comp.on_time,
    review: {
      required: reviewReq.length, approved: reviewReq.filter((t) => t.review_status === 'approved').length,
      awaiting_at_close: reviewReq.filter((t) => t.review_status === 'awaiting_review').length,
      changes_requested_open_at_close: reviewReq.filter((t) => t.review_status === 'changes_requested').length,
      change_requests_total: ids.length ? get(`SELECT COUNT(*) AS n FROM reviews WHERE decision = 'changes_requested' AND task_id IN (${inIds})`, ...ids).n : 0,
      resubmissions: ids.length ? get(`SELECT COUNT(*) AS n FROM submissions WHERE round > 1 AND task_id IN (${inIds})`, ...ids).n : 0,
    },
    help_requests: ids.length ? get(`SELECT COUNT(*) AS n FROM help_requests WHERE task_id IN (${inIds})`, ...ids).n : 0,
    subjects: Object.values(subjects).sort((a, b) => a.subject.localeCompare(b.subject)),
    planned_minutes_total: sessions.reduce((a, s) => a + s.minutes, 0),
    planned_minutes_done: sessions.filter((s) => s.status === 'done').reduce((a, s) => a + s.minutes, 0),
    actual_minutes: withActual.length
      ? { recorded: true, total: withActual.reduce((a, s) => a + s.actual_minutes, 0), sessions_recorded: withActual.length, sessions_total: sessions.length }
      : { recorded: false },
  };
}

// Independent re-check of a stored report against the live data. Returns a list of problems (empty = verified).
function verifyReport(month, childId) {
  const row = get('SELECT * FROM monthly_reports WHERE month = ? AND child_id = ?', month, childId);
  if (!row) return ['The report was not saved.'];
  const problems = [];
  let d; try { d = JSON.parse(row.data); } catch { return ['The saved report cannot be read.']; }
  const live = get("SELECT COUNT(*) AS n, SUM(status = 'done') AS done FROM tasks WHERE child_id = ? AND reporting_month = ? AND cancelled_at IS NULL AND stats_excluded = 0", childId, month);
  if (d.total_eligible !== live.n) problems.push(`Saved total (${d.total_eligible}) differs from the live count (${live.n}).`);
  if (d.completed !== (live.done || 0)) problems.push(`Saved completed (${d.completed}) differs from the live count (${live.done || 0}).`);
  if (d.newly_assigned + d.carried_in !== d.total_eligible) problems.push('New + carried-in does not add up to the total.');
  if (d.completed + d.unfinished.total !== d.total_eligible) problems.push('Completed + unfinished does not add up to the total.');
  return problems;
}

function pendingMonths() {
  const first = getSetting('first_month');
  const current = T.monthOf(T.todayStr());
  if (!first) return [];
  const out = [];
  for (let m = first; m < current; m = T.addMonths(m, 1)) {
    const r = get('SELECT status FROM monthly_resets WHERE month = ?', m);
    if (!r || r.status !== 'completed') out.push({ month: m, status: r ? r.status : 'pending' });
  }
  return out;
}

function classify(t, policy) {
  if (t.cancelled_at) return 'delete';
  const unfinished = t.status !== 'done';
  if (unfinished) return policy === 'carry' ? 'carry' : 'delete';
  if (['awaiting_review', 'changes_requested'].includes(t.review_status)) return 'carry_review';
  return 'delete';
}

function previewReset(month) {
  if (!T.isMonth(month)) throw bad('Choose a month like 2026-10.');
  const policy = getSetting('reset').policy;
  const tasks = all('SELECT * FROM tasks WHERE reporting_month = ?', month);
  const groups = { delete: [], carry: [], carry_review: [] };
  for (const t of tasks) groups[classify(t, policy || 'close')].push(t);
  const ids = tasks.map((t) => t.id), inIds = ids.length ? placeholders(ids.length) : "''";
  const count = (table) => (ids.length ? get(`SELECT COUNT(*) AS n FROM ${table} WHERE task_id IN (${inIds})`, ...ids).n : 0);
  const delIds = groups.delete.map((t) => t.id);
  const nextStart = T.monthStart(T.addMonths(month, 1));
  const cutoff = new Date(T.parseDate(nextStart) - 7 * 3600000).toISOString();
  const subFiles = delIds.length ? get(`SELECT COUNT(*) AS n, COALESCE(SUM(f.size),0) AS bytes FROM submissions s JOIN files f ON f.id = s.file_id WHERE s.task_id IN (${placeholders(delIds.length)})`, ...delIds) : { n: 0, bytes: 0 };
  const srcFiles = delIds.length ? get(`SELECT COUNT(DISTINCT f.id) AS n, COALESCE(SUM(f.size),0) AS bytes FROM tasks t JOIN files f ON f.id = t.source_file_id WHERE t.id IN (${placeholders(delIds.length)})`, ...delIds) : { n: 0, bytes: 0 };
  return {
    month, policy, policy_chosen: !!policy, month_finished: month < T.monthOf(T.todayStr()), runs_at: `${nextStart} 00:${String(RESET_DELAY_MIN).padStart(2, '0')} (Asia/Ho_Chi_Minh)`,
    status: (get('SELECT * FROM monthly_resets WHERE month = ?', month) || { status: 'pending' }).status,
    reports: ['ben', 'shin'].map((id) => buildReport(month, id, policy || 'close')),
    will_clear: { tasks: groups.delete.length, sessions: delIds.length ? get(`SELECT COUNT(*) AS n FROM sessions WHERE task_id IN (${placeholders(delIds.length)})`, ...delIds).n : 0,
      submissions: delIds.length ? get(`SELECT COUNT(*) AS n FROM submissions WHERE task_id IN (${placeholders(delIds.length)})`, ...delIds).n : 0,
      reviews: delIds.length ? get(`SELECT COUNT(*) AS n FROM reviews WHERE task_id IN (${placeholders(delIds.length)})`, ...delIds).n : 0,
      help_requests: delIds.length ? get(`SELECT COUNT(*) AS n FROM help_requests WHERE task_id IN (${placeholders(delIds.length)})`, ...delIds).n : 0,
      uploaded_files: subFiles.n + srcFiles.n, uploaded_bytes: subFiles.bytes + srcFiles.bytes,
      notifications: get('SELECT COUNT(*) AS n FROM notifications WHERE created_at < ?', cutoff).n, reminder_log: get('SELECT COUNT(*) AS n FROM reminder_log WHERE run_date < ?', nextStart).n },
    carried_forward: groups.carry.map((t) => ({ id: t.id, child_id: t.child_id, title: t.title, deadline: t.deadline, status: t.status })),
    carried_for_review_only: groups.carry_review.map((t) => ({ id: t.id, child_id: t.child_id, title: t.title, review_status: t.review_status })),
    closed_unfinished: policy === 'carry' ? [] : tasks.filter((t) => !t.cancelled_at && t.status !== 'done').map((t) => ({ id: t.id, child_id: t.child_id, title: t.title })),
    kept: { future_month_tasks: get('SELECT COUNT(*) AS n FROM tasks WHERE reporting_month > ?', month).n,
      note: 'Accounts, settings, fixed timetables, weekly templates, earlier monthly reports and parent comments are never cleared. Files in Google Drive are never touched.' },
    task_totals: { in_month: tasks.length, existing_files_total: count('submissions') },
  };
}

function runReset(month, { by = 'auto', hooks = {} } = {}) {
  if (!T.isMonth(month)) throw bad('Choose a month like 2026-10.');
  if (month >= T.monthOf(T.todayStr())) throw conflict('That month has not finished yet. A reset can only run after the month has ended.');
  const resetCfg = getSetting('reset');
  const policy = resetCfg.policy;
  if (!policy) throw conflict('Choose first what happens to unfinished tasks (carry forward or close).');
  if (by === 'auto' && !resetCfg.auto_enabled) return { status: 'disabled' };
  const earlier = pendingMonths().filter((p) => p.month < month);
  if (earlier.length) throw conflict(`Please reset ${earlier[0].month} first.`);

  const claim = tx(() => {
    const r = get('SELECT * FROM monthly_resets WHERE month = ?', month);
    const now = T.nowISO();
    if (r && r.status === 'completed') return 'already_done';
    if (r && r.status === 'running' && T.nowMs() - new Date(r.started_at).getTime() < 30 * 60000) return 'busy';
    run(`INSERT INTO monthly_resets (month, status, policy, started_at) VALUES (?, 'running', ?, ?)
         ON CONFLICT(month) DO UPDATE SET status = 'running', policy = excluded.policy, started_at = excluded.started_at, error = NULL`, month, policy, now);
    return 'ok';
  });
  if (claim !== 'ok') return { status: claim };

  try {
    // 1. build and save the reports
    tx(() => {
      for (const c of all('SELECT id FROM children')) {
        const data = buildReport(month, c.id, policy);
        run(`INSERT INTO monthly_reports (month, child_id, data, created_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(month, child_id) DO UPDATE SET data = excluded.data, created_at = excluded.created_at`, month, c.id, JSON.stringify(data), T.nowISO());
      }
    });
    if (hooks.failReport && process.env.NODE_ENV === 'test') throw new Error('Simulated report failure (test).');
    // 2. verify the saved reports
    const problems = all('SELECT id FROM children').flatMap((c) => verifyReport(month, c.id).map((p) => `${c.id}: ${p}`));
    if (problems.length) throw new Error(`Report check failed: ${problems.join(' ')}`);
    // 3. apply the unfinished-work policy and clear the closed month's details (one all-or-nothing step)
    const filesToDelete = [];
    const summary = tx(() => {
      const nextMonth = T.addMonths(month, 1), monthEnd = T.monthEnd(month);
      const tasks = all('SELECT * FROM tasks WHERE reporting_month = ?', month);
      const sum = { reports: 2, tasks_cleared: 0, carried_forward: 0, carried_for_review_only: 0, sessions_cleared: 0, submissions_cleared: 0, files_cleared: 0, notifications_cleared: 0 };
      const delIds = [];
      for (const t of tasks) {
        const k = classify(t, policy);
        if (k === 'delete') { delIds.push(t.id); continue; }
        if (k === 'carry') {
          run('UPDATE tasks SET reporting_month = ?, carried_in = 1, carried_from_month = COALESCE(carried_from_month, ?), unscheduled_reason = NULL, version = version + 1, updated_at = ? WHERE id = ?', nextMonth, month, T.nowISO(), t.id);
          sum.carried_forward++;
        } else {
          run('UPDATE tasks SET reporting_month = ?, stats_excluded = 1, version = version + 1, updated_at = ? WHERE id = ?', nextMonth, T.nowISO(), t.id);
          sum.carried_for_review_only++;
        }
        sum.sessions_cleared += run("DELETE FROM sessions WHERE task_id = ? AND status = 'planned' AND planned_date <= ?", t.id, monthEnd).changes;
      }
      if (delIds.length) {
        const ph = placeholders(delIds.length);
        for (const r of all(`SELECT file_id FROM submissions WHERE file_id IS NOT NULL AND task_id IN (${ph})`, ...delIds)) filesToDelete.push(r.file_id);
        for (const r of all(`SELECT DISTINCT source_file_id AS f FROM tasks WHERE source_file_id IS NOT NULL AND id IN (${ph})`, ...delIds)) filesToDelete.push(r.f);
        sum.sessions_cleared += get(`SELECT COUNT(*) AS n FROM sessions WHERE task_id IN (${ph})`, ...delIds).n;
        sum.submissions_cleared = get(`SELECT COUNT(*) AS n FROM submissions WHERE task_id IN (${ph})`, ...delIds).n;
        run(`DELETE FROM tasks WHERE id IN (${ph})`, ...delIds);       // sessions, submissions, reviews and help requests go with them
        sum.tasks_cleared = delIds.length;
      }
      const nextStart = T.monthStart(nextMonth);
      const cutoff = new Date(T.parseDate(nextStart) - 7 * 3600000).toISOString();
      sum.notifications_cleared = run('DELETE FROM notifications WHERE created_at < ?', cutoff).changes;
      run('DELETE FROM reminder_log WHERE run_date < ?', nextStart);
      run('DELETE FROM schedule_proposals WHERE created_at < ?', cutoff);
      run("UPDATE monthly_resets SET status = 'completed', finished_at = ?, summary = ? WHERE month = ?", T.nowISO(), JSON.stringify(sum), month);
      return sum;
    });
    // 4. remove the files from disk (after the database change is safely committed); files still used by carried tasks are kept
    const stillUsed = new Set([...all('SELECT source_file_id AS f FROM tasks WHERE source_file_id IS NOT NULL').map((r) => r.f), ...all('SELECT file_id AS f FROM submissions WHERE file_id IS NOT NULL').map((r) => r.f)]);
    const del = F.deleteFileRows([...new Set(filesToDelete)].filter((f) => !stillUsed.has(f)));
    summary.files_cleared = del.files;
    run('UPDATE monthly_resets SET summary = ? WHERE month = ?', JSON.stringify(summary), month);
    notify({ audience: 'parent', kind: 'reset_done', title: `Monthly reports for ${month} are ready`, body: `Ben's and Shin's reports are saved. ${summary.carried_forward} unfinished task(s) carried forward.`, view: 'monthly', dedupe: `reset:${month}` });
    reminders.sendParentAlert(`Monthly reports for ${month} are ready`, `The month ${month} has been closed.\nReports for Ben and Shin are saved in the Parent Dashboard (Monthly).\nUnfinished tasks carried forward: ${summary.carried_forward}.\nDetailed records of that month were cleared as planned.`).catch(() => {});
    return { status: 'completed', summary };
  } catch (e) {
    run("UPDATE monthly_resets SET status = 'failed', finished_at = ?, error = ? WHERE month = ?", T.nowISO(), String(e.message).slice(0, 500), month);
    notify({ audience: 'parent', kind: 'reset_failed', title: `The monthly reset for ${month} was stopped`, body: `Nothing was deleted. Reason: ${e.message}`, view: 'monthly', dedupe: `resetfail:${month}:${T.todayStr()}` });
    reminders.sendParentAlert(`Monthly reset for ${month} was stopped`, `The reset stopped before deleting anything.\nReason: ${e.message}\nOpen the Parent Dashboard > Monthly to retry.`).catch(() => {});
    return { status: 'failed', error: e.message };
  }
}

// Called every minute: starts the reset once the new month has begun (00:10) when the parent turned automatic reset on.
function autoTick() {
  const cfg = getSetting('reset');
  if (!cfg.auto_enabled || !cfg.policy) return null;
  if (T.nowMinutes() < RESET_DELAY_MIN && T.todayStr().endsWith('-01')) return null;
  const next = pendingMonths().find((p) => p.status !== 'failed');
  if (!next) return null;
  if (pendingMonths().some((p) => p.status === 'failed' && p.month < next.month)) return null;
  return runReset(next.month, { by: 'auto' });
}
module.exports = { buildReport, verifyReport, previewReset, runReset, autoTick, pendingMonths, classify };
