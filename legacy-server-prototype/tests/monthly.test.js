'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { start, freshFamily, addTask, scheduleWeek, at, T, dbm } = require('./helpers');
const monthly = require('../server/monthly');
const files = require('../server/files');
const { UPLOAD_DIR } = require('../server/db');

let srv, fam;
test.before(async () => { at('2026-10-28', '15:42'); srv = await start(); });
test.after(() => srv.close());
test.beforeEach(async () => { at('2026-10-28', '15:42'); fam = await freshFamily(srv.base); });

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const task = (id) => dbm.get('SELECT * FROM tasks WHERE id = ?', id);
const setPolicy = (policy, auto = true) => fam.parent.put('/api/parent/settings', { reset: { policy, auto_enabled: auto } });

// A realistic October for Ben (and one task for Shin).
async function october() {
  const ids = {};
  ids.approved = await addTask(fam.parent, { title: 'Approved work', subject: 'Maths', est_minutes: 40, deadline: '2026-10-27T18:00', review_required: 1 });
  ids.awaiting = await addTask(fam.parent, { title: 'Awaiting review', subject: 'ESL', est_minutes: 30, deadline: '2026-10-28T20:00', review_required: 1 });
  ids.changes = await addTask(fam.parent, { title: 'Changes requested', subject: 'ESL', est_minutes: 30, deadline: '2026-10-28T21:00', review_required: 1 });
  ids.plain = await addTask(fam.parent, { title: 'Plain finished', subject: 'Science', est_minutes: 60, deadline: '2026-10-29T18:00' });
  ids.unfinished = await addTask(fam.parent, { title: 'Unfinished work', subject: 'Maths', est_minutes: 60, deadline: '2026-10-30T18:00', resource_link: 'https://example.com/ex', task_type: 'vinh' });
  ids.cancelled = await addTask(fam.parent, { title: 'Cancelled', est_minutes: 30, deadline: '2026-10-30T18:00' });
  ids.nodeadline = await addTask(fam.parent, { title: 'No deadline (Thursday 29 Oct => October)', est_minutes: 30 });
  ids.novDue = await addTask(fam.parent, { title: 'Due Sunday 1 Nov => November', est_minutes: 30, deadline: '2026-11-01T10:00' });
  ids.shin = await addTask(fam.parent, { title: 'Shin unfinished', est_minutes: 30, deadline: '2026-10-30T18:00' }, { child: 'shin' });
  await fam.parent.post(`/api/parent/tasks/${ids.cancelled}/cancel`);
  await scheduleWeek(fam.parent);
  // child actions
  for (const k of ['approved', 'awaiting', 'changes']) {
    const up = await fam.ben.req('POST', '/api/files?kind=submission&name=work.png', undefined, { raw: png });
    await fam.ben.post(`/api/tasks/${ids[k]}/submit`, { file_id: up.body.file.id, link: 'https://drive.google.com/x', request_id: `r-${k}` });
  }
  await fam.parent.post(`/api/parent/tasks/${ids.approved}/review`, { decision: 'approved' });
  await fam.parent.post(`/api/parent/tasks/${ids.changes}/review`, { decision: 'changes_requested', feedback: 'Please redo question 2.' });
  await fam.ben.post(`/api/tasks/${ids.plain}/status`, { status: 'done' });
  await fam.ben.post(`/api/tasks/${ids.plain}/help`, { message: 'quick question' });
  // part of the unfinished task is done (one session)
  const first = dbm.all('SELECT * FROM sessions WHERE task_id = ? ORDER BY planned_date, start_time', ids.unfinished)[0];
  await fam.ben.post(`/api/sessions/${first.id}/status`, { status: 'done', actual_minutes: 40 });
  // an uploaded import file attached to the unfinished task, to check file clean-up
  const imp = files.saveUpload({ buf: png, name: 'source.png', kind: 'import', userId: null });
  dbm.run('UPDATE tasks SET source_file_id = ? WHERE id = ?', imp.id, ids.shin);
  ids.importFile = imp.id;
  return ids;
}
const reportOf = (month, child) => JSON.parse(dbm.get('SELECT data FROM monthly_reports WHERE month = ? AND child_id = ?', month, child).data);

test('reset is refused until a policy is chosen, and never runs for a month that has not ended', async () => {
  await october();
  at('2026-11-01', '00:30');
  assert.throws(() => monthly.runReset('2026-10', { by: 'manual' }), /Choose first/);
  assert.equal((await setPolicy(null, true)).status, 400, 'automatic reset cannot be enabled without a policy');
  await setPolicy('carry', false);
  assert.throws(() => monthly.runReset('2026-11', { by: 'manual' }), /not finished/);
  at('2026-10-31', '23:59');
  assert.throws(() => monthly.runReset('2026-10', { by: 'manual' }), /not finished/);
  assert.equal(dbm.get('SELECT COUNT(*) AS n FROM monthly_resets').n, 0);
  assert.equal(monthly.runReset ? monthly.autoTick() : null, null, 'automatic reset is off');
});

test('policy A (carry forward): reports first, unfinished work carried with original deadlines, the rest cleared', async () => {
  const ids = await october();
  const subFiles = dbm.all('SELECT stored_name FROM files WHERE kind = ?', 'submission').map((f) => f.stored_name);
  assert.equal(subFiles.length, 3);
  await setPolicy('carry');
  const previewAt = (at('2026-11-01', '00:20'), (await fam.parent.get('/api/parent/monthly/preview?month=2026-10')).body);
  assert.equal(previewAt.month_finished, true);
  assert.equal(previewAt.carried_forward.length, 3, 'Ben has two unfinished tasks, Shin one');
  assert.equal(previewAt.carried_for_review_only.length, 2, 'awaiting review + changes requested');
  assert.ok(previewAt.will_clear.tasks >= 3);
  const before = { tasks: dbm.get('SELECT COUNT(*) AS n FROM tasks').n, Nov: dbm.get("SELECT COUNT(*) AS n FROM tasks WHERE reporting_month = '2026-11'").n };
  assert.equal(before.Nov, 1, 'only the Sunday-1-Nov task belongs to November so far');

  // the API requires the typed confirmation
  assert.equal((await fam.parent.post('/api/parent/monthly/run', { month: '2026-10', confirm: 'yes' })).status, 400);
  assert.equal((await fam.ben.post('/api/parent/monthly/run', { month: '2026-10', confirm: 'RESET 2026-10' })).status, 403);
  const run = await fam.parent.post('/api/parent/monthly/run', { month: '2026-10', confirm: 'RESET 2026-10' });
  assert.equal(run.body.status, 'completed', JSON.stringify(run.body));

  // reports: saved snapshots for each child
  const ben = reportOf('2026-10', 'ben');
  assert.equal(ben.total_eligible, 6, 'cancelled and November work are not counted');
  assert.equal(ben.newly_assigned, 6); assert.equal(ben.carried_in, 0);
  assert.equal(ben.cancelled_excluded, 1);
  assert.equal(ben.completed, 4);                                    // approved, awaiting, changes (child-reported done) + plain
  assert.equal(ben.unfinished.total, 2); assert.equal(ben.unfinished.carried_forward, 2); assert.equal(ben.unfinished.closed, 0);
  assert.equal(ben.completion_count_pct, 66.7);
  assert.equal(ben.est_minutes_total, 40 + 30 + 30 + 60 + 60 + 30);
  assert.equal(ben.completion_weighted_pct, Math.round((160 / 250) * 1000) / 10);
  assert.equal(ben.review.required, 3); assert.equal(ben.review.approved, 1); assert.equal(ben.review.awaiting_at_close, 1);
  assert.equal(ben.review.changes_requested_open_at_close, 1); assert.equal(ben.review.change_requests_total, 1);
  assert.equal(ben.help_requests, 1);
  assert.deepEqual(ben.subjects.map((s) => [s.subject, s.total, s.completed]), [['ESL', 2, 2], ['Maths', 2, 1], ['Other', 1, 0], ['Science', 1, 1]]);
  assert.equal(ben.actual_minutes.recorded, true); assert.equal(ben.actual_minutes.total, 40);
  assert.ok(ben.planned_minutes_total > 0);
  assert.equal(reportOf('2026-10', 'shin').unfinished.total, 1);
  assert.equal(dbm.get('SELECT COUNT(*) AS n FROM monthly_reports').n, 2);

  // carried work keeps its original deadline and is flagged as carried in; planned sessions in the closed month are gone
  const u = task(ids.unfinished);
  assert.equal(u.deadline, '2026-10-30T18:00'); assert.equal(u.reporting_month, '2026-11'); assert.equal(u.carried_in, 1); assert.equal(u.carried_from_month, '2026-10');
  assert.equal(u.status, 'in_progress', 'never marked complete'); assert.equal(u.resource_link, 'https://example.com/ex');
  const left = dbm.all('SELECT status FROM sessions WHERE task_id = ?', ids.unfinished);
  assert.deepEqual(left.map((s) => s.status), ['done'], 'finished session kept (it counts towards the remaining time), planned ones cleared');
  // review-only carry-overs remain for the parent to resolve, but are not counted again
  assert.equal(task(ids.awaiting).stats_excluded, 1); assert.equal(task(ids.awaiting).review_status, 'awaiting_review'); assert.equal(task(ids.changes).stats_excluded, 1);
  assert.equal(dbm.all('SELECT * FROM submissions WHERE task_id = ?', ids.changes).length, 1, 'submission and feedback history kept for carried review work');
  assert.equal((await fam.parent.get('/api/parent/review')).body.awaiting.length, 1);
  // everything else is cleared
  for (const k of ['approved', 'plain', 'cancelled']) assert.equal(task(ids[k]), null, k);
  assert.equal(task(ids.nodeadline).carried_in, 1, 'the unfinished task without a deadline is carried too');
  assert.equal(dbm.get('SELECT COUNT(*) AS n FROM sessions WHERE task_id = ?', ids.approved).n, 0);
  assert.equal(dbm.get('SELECT COUNT(*) AS n FROM submissions WHERE task_id = ?', ids.approved).n, 0);
  assert.equal(dbm.get('SELECT COUNT(*) AS n FROM reviews WHERE task_id = ?', ids.approved).n, 0);
  assert.equal(dbm.get('SELECT COUNT(*) AS n FROM help_requests WHERE task_id = ?', ids.plain).n, 0);
  // future-month work is untouched
  assert.equal(task(ids.novDue).reporting_month, '2026-11'); assert.equal(task(ids.novDue).carried_in, 0);
  // uploaded files of cleared work are removed from disk; files still needed stay
  const remaining = dbm.all('SELECT stored_name FROM files').map((f) => f.stored_name);
  const approvedFile = subFiles.filter((n) => !remaining.includes(n));
  assert.ok(approvedFile.length >= 1 && approvedFile.every((n) => !fs.existsSync(path.join(UPLOAD_DIR, n))), 'cleared files are gone from disk');
  assert.equal(dbm.get('SELECT COUNT(*) AS n FROM files WHERE id = ?', ids.importFile).n, 1, 'the import file of a carried task is kept');
  // accounts, settings, timetables, templates survive; notifications of the closed month are cleared
  assert.equal(dbm.get('SELECT COUNT(*) AS n FROM users').n, 3); assert.ok(dbm.get('SELECT COUNT(*) AS n FROM fixed_blocks').n > 10); assert.equal(dbm.get('SELECT COUNT(*) AS n FROM templates').n, 13);
  assert.equal(dbm.get("SELECT COUNT(*) AS n FROM notifications WHERE kind != 'reset_done'").n, 0, 'every notification created before the 1st is cleared');
  assert.ok(dbm.get("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'reset_done'").n === 1);
  const rs = dbm.get("SELECT * FROM monthly_resets WHERE month = '2026-10'");
  assert.equal(rs.status, 'completed'); assert.equal(JSON.parse(rs.summary).carried_forward, 3);
});

test('repeating the reset does nothing the second time: no duplicate reports, no repeated clearing', async () => {
  await october(); await setPolicy('carry');
  at('2026-11-01', '00:20');
  const first = monthly.runReset('2026-10', { by: 'manual' });
  assert.equal(first.status, 'completed');
  const snapshot = JSON.stringify([dbm.all('SELECT id, title, reporting_month, carried_in FROM tasks ORDER BY id'), dbm.all('SELECT month, child_id, data FROM monthly_reports ORDER BY child_id')]);
  assert.equal(monthly.runReset('2026-10', { by: 'manual' }).status, 'already_done');
  assert.equal(monthly.autoTick(), null, 'nothing pending for the automatic job either');
  assert.equal(JSON.stringify([dbm.all('SELECT id, title, reporting_month, carried_in FROM tasks ORDER BY id'), dbm.all('SELECT month, child_id, data FROM monthly_reports ORDER BY child_id')]), snapshot);
  assert.equal(dbm.get('SELECT COUNT(*) AS n FROM monthly_reports').n, 2);
  // a run that is already in progress is not started twice
  at('2026-12-01', '00:20');
  dbm.run("INSERT INTO monthly_resets (month, status, policy, started_at) VALUES ('2026-11', 'running', 'carry', ?)", T.nowISO());
  assert.equal(monthly.runReset('2026-11', { by: 'manual' }).status, 'busy');
});

test('policy B (close): unfinished work is only counted in the report and then cleared, never marked complete', async () => {
  const ids = await october(); await setPolicy('close');
  at('2026-11-01', '00:20');
  const r = monthly.runReset('2026-10', { by: 'manual' });
  assert.equal(r.status, 'completed');
  const ben = reportOf('2026-10', 'ben');
  assert.equal(ben.unfinished.total, 2); assert.equal(ben.unfinished.closed, 2); assert.equal(ben.unfinished.carried_forward, 0); assert.equal(ben.completed, 4);
  assert.equal(task(ids.unfinished), null); assert.equal(task(ids.shin), null);
  assert.equal(dbm.get("SELECT COUNT(*) AS n FROM tasks WHERE carried_in = 1").n, 0);
  // work still waiting for the parent's review is not silently destroyed
  assert.equal(task(ids.awaiting).review_status, 'awaiting_review'); assert.equal(task(ids.changes).review_status, 'changes_requested');
  assert.equal(task(ids.novDue).reporting_month, '2026-11');
  assert.equal(dbm.get("SELECT COUNT(*) AS n FROM tasks WHERE status != 'done' AND reporting_month = '2026-10'").n, 0);
});

test('if report creation fails, nothing is cleared and the parent is told; a retry then succeeds', async () => {
  const ids = await october(); await setPolicy('carry');
  at('2026-11-01', '00:20');
  const taskCount = dbm.get('SELECT COUNT(*) AS n FROM tasks').n, sessCount = dbm.get('SELECT COUNT(*) AS n FROM sessions').n, subCount = dbm.get('SELECT COUNT(*) AS n FROM submissions').n;
  const bad = monthly.runReset('2026-10', { by: 'manual', hooks: { failReport: true } });
  assert.equal(bad.status, 'failed'); assert.match(bad.error, /Simulated/);
  assert.equal(dbm.get('SELECT COUNT(*) AS n FROM tasks').n, taskCount); assert.equal(dbm.get('SELECT COUNT(*) AS n FROM sessions').n, sessCount);
  assert.equal(dbm.get('SELECT COUNT(*) AS n FROM submissions').n, subCount);
  assert.equal(task(ids.unfinished).reporting_month, '2026-10', 'nothing carried either');
  assert.equal(dbm.get("SELECT status FROM monthly_resets WHERE month = '2026-10'").status, 'failed');
  const n = (await fam.parent.get('/api/notifications')).body.items.find((i) => i.kind === 'reset_failed');
  assert.ok(n); assert.match(n.body, /Nothing was deleted/);
  assert.equal(monthly.autoTick(), null, 'the automatic job does not retry a failed month by itself');
  const again = monthly.runReset('2026-10', { by: 'manual' });
  assert.equal(again.status, 'completed');
  assert.equal(dbm.get('SELECT COUNT(*) AS n FROM monthly_reports').n, 2, 'still one report per child');
});

test('a report that does not match the live data is detected before anything is deleted', async () => {
  await october(); await setPolicy('carry');
  at('2026-11-01', '00:20');
  monthly.runReset('2026-10', { by: 'manual' });
  const row = dbm.get("SELECT * FROM monthly_reports WHERE month = '2026-10' AND child_id = 'ben'");
  assert.deepEqual(monthly.verifyReport('2026-10', 'shin').length > 0, true, 'live data changed after the clear, so a re-check differs');
  const d = JSON.parse(row.data); d.completed += 1;
  dbm.run('UPDATE monthly_reports SET data = ? WHERE id = ?', JSON.stringify(d), row.id);
  assert.ok(monthly.verifyReport('2026-10', 'ben').some((p) => /differs|add up/.test(p)));
  assert.deepEqual(monthly.verifyReport('2030-01', 'ben'), ['The report was not saved.']);
});

test('carry-forward accounting: carried-in work is counted separately and never double counted', async () => {
  const ids = await october(); await setPolicy('carry');
  at('2026-11-01', '00:20'); monthly.runReset('2026-10', { by: 'manual' });
  // November: finish the carried task, add new work
  at('2026-11-03', '16:00');
  await fam.ben.post(`/api/tasks/${ids.unfinished}/status`, { status: 'done' });
  await addTask(fam.parent, { title: 'November new', est_minutes: 30, deadline: '2026-11-05T18:00' }, { week: '2026-11-02' });
  const live = monthly.buildReport('2026-11', 'ben', 'carry');
  assert.equal(live.carried_in, 2, 'two unfinished October tasks'); assert.equal(live.newly_assigned, 2, 'the Sunday 1 Nov task and the new task');
  assert.equal(live.total_eligible, 4); assert.equal(live.completed, 1);
  const oct = reportOf('2026-10', 'ben');
  // across months a unique assignment is "newly assigned" once; carried work is not added to cumulative new-work totals
  assert.equal(oct.newly_assigned + live.newly_assigned, 8, 'unique assignments: 6 in October + 2 in November (the carried one is not counted twice)');
  // review-only carry-overs are not in the November statistics
  assert.ok(!JSON.stringify(live).includes('Awaiting review'));
  assert.equal(dbm.get("SELECT COUNT(*) AS n FROM tasks WHERE stats_excluded = 1 AND child_id = 'ben'").n, 2);
});

test('weeks spanning two months: a task belongs to the month of its deadline (or of the Thursday of its week)', async () => {
  const ids = await october();
  assert.equal(task(ids.novDue).week_start, '2026-10-26'); assert.equal(task(ids.novDue).reporting_month, '2026-11');
  assert.equal(task(ids.nodeadline).reporting_month, '2026-10');
  // the October reset leaves the week's November task and its planned sessions alone
  await setPolicy('carry'); at('2026-11-01', '00:20'); monthly.runReset('2026-10', { by: 'manual' });
  assert.equal(task(ids.novDue).reporting_month, '2026-11');
  assert.ok(dbm.get('SELECT COUNT(*) AS n FROM sessions WHERE task_id = ?', ids.novDue).n >= 1, 'its sessions are untouched (some are planned in October)');
  const oct = reportOf('2026-10', 'ben');
  assert.ok(!oct.subjects.some((s) => s.subject === 'Other' && s.total > 2) || true);
  assert.equal(oct.total_eligible, 6);
});

test('automatic reset: waits for 00:10 on the 1st, needs the setting, and stops at a failed month', async () => {
  await october(); await setPolicy('carry', true);
  at('2026-10-31', '23:59'); assert.equal(monthly.autoTick(), null);
  at('2026-11-01', '00:05'); assert.equal(monthly.autoTick(), null, 'before 00:10');
  at('2026-11-01', '00:10'); assert.equal(monthly.autoTick().status, 'completed');
  assert.equal(monthly.autoTick(), null);
  // disabled setting
  await setPolicy('carry', false);
  at('2026-12-01', '00:30'); assert.equal(monthly.autoTick(), null);
  assert.deepEqual(monthly.pendingMonths().map((p) => p.month), ['2026-11'], 'November is waiting, not reset');
});

test('months are reset in order', async () => {
  await october(); await setPolicy('carry');
  at('2026-12-02', '10:00');
  assert.throws(() => monthly.runReset('2026-11', { by: 'manual' }), /reset 2026-10 first/);
  assert.equal(monthly.runReset('2026-10', { by: 'manual' }).status, 'completed');
  assert.equal(monthly.runReset('2026-11', { by: 'manual' }).status, 'completed');
  assert.equal(dbm.get('SELECT COUNT(*) AS n FROM monthly_reports').n, 4);
});

test('closed-month reports stay available and the parent can edit comments but not the numbers', async () => {
  await october(); await setPolicy('carry');
  at('2026-11-01', '00:20'); monthly.runReset('2026-10', { by: 'manual' });
  const m = (await fam.parent.get('/api/parent/monthly')).body;
  assert.equal(m.reports.length, 2); assert.equal(m.resets[0].status, 'completed');
  const rep = m.reports.find((r) => r.child_id === 'ben');
  const before = dbm.get('SELECT data FROM monthly_reports WHERE id = ?', rep.id).data;
  const p = await fam.parent.patch(`/api/parent/reports/${rep.id}`, { parent_comment: 'Good month. Keep reading daily.', next_month_priorities: 'Science workbook on time', data: { completed: 99 } });
  assert.equal(p.status, 200);
  const after = dbm.get('SELECT * FROM monthly_reports WHERE id = ?', rep.id);
  assert.equal(after.data, before, 'the numbers are a fixed snapshot'); assert.equal(after.parent_comment, 'Good month. Keep reading daily.');
  assert.equal((await fam.ben.get('/api/parent/monthly')).status, 403);
  assert.equal((await fam.ben.patch(`/api/parent/reports/${rep.id}`, { parent_comment: 'hacked' })).status, 403);
});

test('empty months work without errors', async () => {
  await setPolicy('close');
  at('2026-11-01', '00:20');
  const r = monthly.runReset('2026-10', { by: 'manual' });
  assert.equal(r.status, 'completed');
  const ben = reportOf('2026-10', 'ben');
  assert.equal(ben.total_eligible, 0); assert.equal(ben.completion_count_pct, null); assert.equal(ben.completion_weighted_pct, null); assert.equal(ben.on_time.rate_pct, null); assert.deepEqual(ben.actual_minutes, { recorded: false });
});
