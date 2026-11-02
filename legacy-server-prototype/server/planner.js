'use strict';
// Connects the pure scheduler to the database: preview a proposal, then apply it only if nothing changed in between.
const crypto = require('node:crypto');
const { get, all, run, tx, uid } = require('./db');
const T = require('./time');
const S = require('./scheduler');
const { childContext, nowParts, notify } = require('./tasks');
const { HttpError, bad, conflict } = require('./util');

function stateHash(childId) {
  const rows = [
    ...all('SELECT id, version FROM tasks WHERE child_id = ? ORDER BY id', childId).map((r) => `t${r.id}:${r.version}`),
    ...all('SELECT id, version, planned_date, start_time FROM sessions WHERE child_id = ? ORDER BY id', childId).map((r) => `s${r.id}:${r.version}:${r.planned_date}:${r.start_time}`),
    JSON.stringify(get('SELECT * FROM child_settings WHERE child_id = ?', childId)),
    JSON.stringify(all('SELECT * FROM fixed_blocks WHERE child_id = ? ORDER BY id', childId)),
  ];
  return crypto.createHash('sha256').update(rows.join('|')).digest('hex');
}

function preview({ childIds, weekStart, mode }) {
  if (!['week', 'unfinished'].includes(mode)) throw bad('Unknown planning mode.');
  const ws = T.weekStartOf(weekStart || T.todayStr());
  const out = [];
  for (const childId of childIds) {
    const ctx = childContext(childId);
    const proposal = S.suggest({ ...ctx, weekStart: ws, mode, now: nowParts() });
    const titles = new Map(ctx.tasks.map((t) => [t.id, t]));
    const id = uid();
    run('INSERT INTO schedule_proposals (id, child_id, week_start, mode, state_hash, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, childId, ws, mode, stateHash(childId), JSON.stringify(proposal), T.nowISO());
    out.push({
      proposal_id: id, child: ctx.child, week_start: ws, mode,
      sessions: proposal.sessions.map((s) => ({ ...s, title: titles.get(s.task_id).title, subject: titles.get(s.task_id).subject })),
      removed_count: proposal.removed.length, unscheduled: proposal.unscheduled, warnings: proposal.warnings, days: proposal.days,
      locked_kept: ctx.sessions.filter((s) => s.locked && s.status === 'planned' && s.planned_date >= ws && s.planned_date <= T.addDays(ws, 6)).length,
      done_kept: ctx.sessions.filter((s) => s.status === 'done' && s.planned_date >= ws && s.planned_date <= T.addDays(ws, 6)).length,
    });
  }
  return out;
}

function apply(proposalId) {
  return tx(() => {
    const row = get('SELECT * FROM schedule_proposals WHERE id = ?', proposalId);
    if (!row) throw new HttpError(404, 'That proposal no longer exists. Please create a new one.');
    if (row.applied_at) throw conflict('This proposal was already applied.');
    if (row.state_hash !== stateHash(row.child_id)) throw conflict('Something changed since this proposal was made (a task, a timetable or a session). Please create a new proposal.');
    const p = JSON.parse(row.data);
    for (const id of p.removed) run("DELETE FROM sessions WHERE id = ? AND status = 'planned' AND locked = 0", id);
    const now = T.nowISO();
    const touched = new Set(p.sessions.map((s) => s.task_id));
    for (const s of p.sessions) {
      run(`INSERT INTO sessions (id, task_id, child_id, seq, planned_date, start_time, end_time, minutes, origin, created_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?, 'auto', ?)`,
        uid(), s.task_id, row.child_id, s.planned_date, s.start_time, s.end_time, s.minutes, now);
    }
    // number each task's sessions in time order
    const taskIds = new Set([...touched, ...p.unscheduled.map((u) => u.task_id)]);
    for (const tid of taskIds) {
      const list = all('SELECT id FROM sessions WHERE task_id = ? ORDER BY planned_date, start_time', tid);
      list.forEach((s, i) => run('UPDATE sessions SET seq = ? WHERE id = ?', i + 1, s.id));
    }
    // reasons for anything that did not fit; clear the reason for everything that now fits
    const reasons = new Map(p.unscheduled.map((u) => [u.task_id, u.reason]));
    for (const t of all('SELECT id FROM tasks WHERE child_id = ?', row.child_id)) {
      if (reasons.has(t.id)) run('UPDATE tasks SET unscheduled_reason = ? WHERE id = ?', reasons.get(t.id), t.id);
      else if (touched.has(t.id)) run('UPDATE tasks SET unscheduled_reason = NULL WHERE id = ?', t.id);
    }
    run('UPDATE schedule_proposals SET applied_at = ? WHERE id = ?', now, proposalId);
    notify({ audience: row.child_id, kind: 'schedule', title: 'Your plan for the week is ready', body: 'Check it, and move anything that does not suit you.', view: 'week' });
    return { child_id: row.child_id, added: p.sessions.length, removed: p.removed.length, unscheduled: p.unscheduled.length };
  });
}
module.exports = { preview, apply, stateHash };
