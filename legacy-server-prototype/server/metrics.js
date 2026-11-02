'use strict';
// Progress calculations. Count-based and duration-weighted completion are always reported separately.
// "Completed" means the child reported the task Done. Parent approval is tracked separately (review fields).
const { get, all } = require('./db');
const T = require('./time');
const { childContext } = require('./tasks');

const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);   // null = nothing to measure

// Tasks that count in statistics: not cancelled, not "review-only carry-overs".
const eligible = (tasks) => tasks.filter((t) => !t.cancelled_at && !t.stats_excluded);

function completion(tasks) {
  const el = eligible(tasks);
  const done = el.filter((t) => t.status === 'done');
  const totalMin = el.reduce((a, t) => a + t.est_minutes, 0), doneMin = done.reduce((a, t) => a + t.est_minutes, 0);
  const withDl = done.filter((t) => t.deadline);
  const onTime = withDl.filter((t) => t.completed_at && T.dtKey(T.isoToLocalDT(t.completed_at)) <= T.dtKey(t.deadline));
  return {
    total: el.length, completed: done.length, count_pct: pct(done.length, el.length),
    est_minutes_total: totalMin, est_minutes_completed: doneMin, weighted_pct: pct(doneMin, totalMin),
    on_time: { eligible: withDl.length, on_time: onTime.length, rate_pct: pct(onTime.length, withDl.length) },
    approved: el.filter((t) => t.review_status === 'approved').length,
    awaiting_review: el.filter((t) => t.review_status === 'awaiting_review').length,
    changes_requested: el.filter((t) => t.review_status === 'changes_requested').length,
  };
}

const isOverdue = (t, nowKey = T.nowKey()) => !t.cancelled_at && t.status !== 'done' && t.deadline && T.dtKey(t.deadline) < nowKey;
const plannedMinutes = (sessions) => sessions.reduce((a, s) => a + s.minutes, 0);

// Daily numbers for one child. A task counts on a day when it has a session planned that day; it is complete that day when all of
// that day's sessions of the task are done. Minutes are the planned session minutes.
function daily(ctx, date) {
  const ss = ctx.sessions.filter((s) => s.planned_date === date && !ctx.tasks.find((t) => t.id === s.task_id)?.cancelled_at);
  const byTask = new Map();
  for (const s of ss) { if (!byTask.has(s.task_id)) byTask.set(s.task_id, []); byTask.get(s.task_id).push(s); }
  const tasksDone = [...byTask.values()].filter((l) => l.every((s) => s.status === 'done')).length;
  const minTotal = plannedMinutes(ss), minDone = plannedMinutes(ss.filter((s) => s.status === 'done'));
  const wd = T.weekdayOf(date), cap = wd >= 6 ? ctx.settings.max_weekend_min : ctx.settings.max_weekday_min;
  return { date, tasks_planned: byTask.size, tasks_done: tasksDone, count_pct: pct(tasksDone, byTask.size), planned_minutes: minTotal, done_minutes: minDone,
    weighted_pct: pct(minDone, minTotal), cap, overloaded: minTotal > cap };
}

function unscheduledTasks(ctx) {
  const planned = new Map();
  for (const s of ctx.sessions) planned.set(s.task_id, (planned.get(s.task_id) || 0) + s.minutes);
  return ctx.tasks.filter((t) => !t.cancelled_at && !t.stats_excluded && t.status !== 'done' && (planned.get(t.id) || 0) < t.est_minutes)
    .map((t) => ({ ...t, unscheduled_minutes: t.est_minutes - (planned.get(t.id) || 0) }));
}

function childSummary(childId, { weekStart, subject, status } = {}) {
  const ctx = childContext(childId);
  const ws = T.weekStartOf(weekStart || T.todayStr());
  const filt = (t) => (!subject || t.subject === subject) && (!status || t.status === status);
  const weekTasks = ctx.tasks.filter((t) => t.week_start === ws && filt(t));
  const days = [];
  for (let i = 0; i < 7; i++) days.push(daily(ctx, T.addDays(ws, i)));
  const today = T.todayStr();
  const nowKey = T.nowKey();
  const open = (sql) => all(sql, childId);
  return {
    child: ctx.child, week_start: ws,
    today: daily(ctx, today),
    week: { ...completion(weekTasks), planned_minutes: days.reduce((a, d) => a + d.planned_minutes, 0), days },
    overdue: ctx.tasks.filter((t) => isOverdue(t, nowKey) && !t.stats_excluded && filt(t)),
    unscheduled: unscheduledTasks(ctx).filter(filt),
    overloaded_days: days.filter((d) => d.overloaded),
    help_open: open("SELECT h.*, t.title FROM help_requests h LEFT JOIN tasks t ON t.id = h.task_id WHERE h.child_id = ? AND h.status = 'open' ORDER BY h.created_at"),
    awaiting_review: ctx.tasks.filter((t) => t.review_status === 'awaiting_review' && !t.cancelled_at),
    revisions: ctx.tasks.filter((t) => t.review_status === 'changes_requested' && !t.cancelled_at),
    subjects: [...new Set(ctx.tasks.map((t) => t.subject))].sort(),
    unconfirmed_estimates: ctx.tasks.filter((t) => !t.cancelled_at && t.status !== 'done' && !t.est_confirmed && t.week_start === ws).length,
  };
}

function monthCompletion(childId, month) {
  const tasks = all('SELECT * FROM tasks WHERE child_id = ? AND reporting_month = ?', childId, month);
  return completion(tasks);
}
module.exports = { pct, completion, eligible, isOverdue, daily, unscheduledTasks, childSummary, monthCompletion, plannedMinutes };
