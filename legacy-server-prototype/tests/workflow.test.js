'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { start, freshFamily, addTask, scheduleWeek, at, T, dbm } = require('./helpers');

let srv, fam;
test.before(async () => { at('2026-10-28', '15:42'); srv = await start(); });
test.after(() => srv.close());
test.beforeEach(async () => { at('2026-10-28', '15:42'); fam = await freshFamily(srv.base); });
const task = (id) => dbm.get('SELECT * FROM tasks WHERE id = ?', id);

test('completion and approval are separate: done is not approved', async () => {
  const id = await addTask(fam.parent, { title: 'Essay', est_minutes: 40, deadline: '2026-10-30T18:00', review_required: 1 });
  assert.equal(task(id).review_status, 'not_submitted');
  const r = await fam.ben.post(`/api/tasks/${id}/status`, { status: 'done' });
  assert.equal(r.body.task.status, 'done'); assert.equal(r.body.task.review_status, 'awaiting_review');
  const q = await fam.parent.get('/api/parent/review');
  assert.equal(q.body.awaiting.length, 1);
  assert.equal(q.body.awaiting[0].child_name, 'Ben');
});

test('submit → request changes → revision list → resubmit → approve, without duplicate tasks', async () => {
  const id = await addTask(fam.parent, { title: 'Poster', est_minutes: 40, deadline: '2026-10-30T18:00', review_required: 1, resource_link: 'https://example.com/ex' });
  const s1 = await fam.ben.post(`/api/tasks/${id}/submit`, { link: 'https://drive.google.com/file/d/abc', note: 'first try', request_id: 'req-1' });
  assert.equal(s1.status, 200); assert.equal(s1.body.task.review_status, 'awaiting_review');
  // a double click with the same request id does not create a second submission
  const dup = await fam.ben.post(`/api/tasks/${id}/submit`, { link: 'https://drive.google.com/file/d/abc', note: 'first try', request_id: 'req-1' });
  assert.equal(dup.body.duplicate, true);
  assert.equal(dbm.all('SELECT * FROM submissions WHERE task_id = ?', id).length, 1);
  // changes are requested: feedback is required
  assert.equal((await fam.parent.post(`/api/parent/tasks/${id}/review`, { decision: 'changes_requested', feedback: '' })).status, 400);
  const rev = await fam.parent.post(`/api/parent/tasks/${id}/review`, { decision: 'changes_requested', feedback: 'Please add a title and fix the spelling.' });
  assert.equal(rev.status, 200); assert.equal(rev.body.task.review_status, 'changes_requested');
  // the child sees it prominently on Today and in Feedback; the first submission and the feedback are kept
  const today = await fam.ben.get('/api/board/ben/today');
  assert.equal(today.body.revisions.length, 1);
  const fb = await fam.ben.get('/api/board/ben/feedback');
  assert.equal(fb.body.revisions.length, 1);
  assert.equal(fb.body.revisions[0].reviews[0].feedback, 'Please add a title and fix the spelling.');
  assert.equal(fb.body.revisions[0].submissions.length, 1);
  assert.ok(dbm.all("SELECT * FROM notifications WHERE audience = 'ben' AND kind = 'changes_requested'").length === 1);
  // "Done" is still true, but the unresolved revision stays visible in the parent's numbers
  const ov = await fam.parent.get('/api/parent/overview?week=2026-10-26');
  const ben = ov.body.children.find((c) => c.child.id === 'ben');
  assert.equal(ben.revisions.length, 1);
  assert.equal(ben.week.completed, 1); assert.equal(ben.week.approved, 0); assert.equal(ben.week.changes_requested, 1);
  // resubmit: same task, round 2
  const s2 = await fam.ben.post(`/api/tasks/${id}/submit`, { link: 'https://drive.google.com/file/d/def', note: 'fixed', request_id: 'req-2' });
  assert.equal(s2.body.task.review_status, 'awaiting_review'); assert.equal(s2.body.submission.round, 2);
  assert.equal(dbm.get("SELECT COUNT(*) AS n FROM tasks WHERE title = 'Poster'").n, 1, 'no duplicate task');
  assert.equal(dbm.all('SELECT * FROM submissions WHERE task_id = ?', id).length, 2, 'history kept');
  const ok = await fam.parent.post(`/api/parent/tasks/${id}/review`, { decision: 'approved', feedback: 'Great!' });
  assert.equal(ok.body.task.review_status, 'approved');
  assert.equal(dbm.all('SELECT * FROM reviews WHERE task_id = ?', id).length, 2);
  // approved work is locked for the child
  assert.equal((await fam.ben.post(`/api/tasks/${id}/status`, { status: 'in_progress' })).status, 409);
  assert.equal((await fam.ben.post(`/api/tasks/${id}/submit`, { note: 'again' })).status, 409);
  // reviewing something that is not awaiting review is refused
  assert.equal((await fam.parent.post(`/api/parent/tasks/${id}/review`, { decision: 'approved' })).status, 409);
});

test('review can be requested without any link or file (missing links do not block anything)', async () => {
  const id = await addTask(fam.parent, { title: 'No links at all', est_minutes: 30, review_required: 1 });   // no deadline, no links
  const r = await fam.ben.post(`/api/tasks/${id}/submit`, {});
  assert.equal(r.status, 200); assert.equal(r.body.task.review_status, 'awaiting_review');
  const id2 = await addTask(fam.parent, { title: 'No review, no links', est_minutes: 30 });
  assert.equal((await fam.ben.post(`/api/tasks/${id2}/submit`, {})).status, 400, 'a submission with nothing in it is only allowed for review tasks');
  assert.equal((await fam.ben.post(`/api/tasks/${id2}/status`, { status: 'done' })).status, 200);
  await scheduleWeek(fam.parent, ['ben']);   // scheduling works with missing links and deadlines
});

test('submitting a file works; the file is attached to that submission only once', async () => {
  const id = await addTask(fam.parent, { title: 'With file', est_minutes: 30, review_required: 1 });
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const up = await fam.ben.req('POST', '/api/files?kind=submission&name=my%20work.png', undefined, { raw: png });
  const r = await fam.ben.post(`/api/tasks/${id}/submit`, { file_id: up.body.file.id, request_id: 'f1' });
  assert.equal(r.status, 200);
  assert.equal((await fam.ben.post(`/api/tasks/${id}/submit`, { file_id: up.body.file.id, request_id: 'f2' })).status, 400);
  const detail = await fam.parent.get(`/api/tasks/${id}`);
  assert.equal(detail.body.submissions[0].file_name, 'my work.png');
});

test('help requests: child asks, parent sees and replies, child sees the reply', async () => {
  const id = await addTask(fam.parent, { title: 'Hard sums', est_minutes: 30 });
  const h = await fam.ben.post(`/api/tasks/${id}/help`, { message: 'I do not understand question 3' });
  assert.equal(h.status, 200);
  assert.equal(task(id).status, 'needs_help');
  const list = await fam.parent.get('/api/parent/help');
  assert.equal(list.body.items.filter((x) => x.status === 'open').length, 1);
  assert.equal((await fam.parent.get('/api/parent/overview')).body.children.find((c) => c.child.id === 'ben').help_open.length, 1);
  const rep = await fam.parent.post(`/api/parent/help/${h.body.help.id}/reply`, { reply: 'Draw the picture first.' });
  assert.equal(rep.status, 200);
  assert.equal(task(id).status, 'in_progress'); assert.equal(task(id).help_requested, 0);
  const fb = await fam.ben.get('/api/board/ben/feedback');
  assert.equal(fb.body.help[0].reply, 'Draw the picture first.');
  // choosing "Needs Help" from the status buttons also raises a request
  const id2 = await addTask(fam.parent, { title: 'Hard reading', est_minutes: 30 });
  await fam.ben.post(`/api/tasks/${id2}/status`, { status: 'needs_help' });
  assert.equal(dbm.all("SELECT * FROM help_requests WHERE task_id = ? AND status = 'open'", id2).length, 1);
});

test('finishing sessions updates the task: the task is Done only when every session is finished', async () => {
  const id = await addTask(fam.parent, { title: 'Two parts', est_minutes: 60, deadline: '2026-11-01T18:00', task_type: 'vinh' });
  await scheduleWeek(fam.parent, ['ben']);
  const ss = dbm.all('SELECT * FROM sessions WHERE task_id = ? ORDER BY planned_date, start_time', id);
  assert.ok(ss.length >= 2, 'split into several sessions');
  await fam.ben.post(`/api/sessions/${ss[0].id}/status`, { status: 'done', actual_minutes: 25 });
  assert.equal(task(id).status, 'in_progress');
  for (const s of ss.slice(1)) await fam.ben.post(`/api/sessions/${s.id}/status`, { status: 'done' });
  assert.equal(task(id).status, 'done'); assert.ok(task(id).completed_at);
  await fam.ben.post(`/api/sessions/${ss[0].id}/status`, { status: 'planned' });
  assert.equal(task(id).status, 'in_progress'); assert.equal(task(id).completed_at, null);
});

test('progress: count-based and duration-weighted completion, split sessions not double counted, cancelled and empty handled', async () => {
  const a = await addTask(fam.parent, { title: 'A small', est_minutes: 30, deadline: '2026-10-29T18:00' });
  const b = await addTask(fam.parent, { title: 'B big', est_minutes: 90, deadline: '2026-10-30T18:00', task_type: 'vinh' });
  const c = await addTask(fam.parent, { title: 'C cancelled', est_minutes: 60, deadline: '2026-10-30T18:00' });
  await fam.parent.post(`/api/parent/tasks/${c}/cancel`);
  await scheduleWeek(fam.parent, ['ben']);
  assert.ok(dbm.all('SELECT * FROM sessions WHERE task_id = ?', b).length >= 2, 'B is split');
  await fam.ben.post(`/api/tasks/${a}/status`, { status: 'done' });
  let ov = (await fam.parent.get('/api/parent/overview?week=2026-10-26')).body.children.find((x) => x.child.id === 'ben');
  assert.equal(ov.week.total, 2, 'cancelled work is excluded and split sessions are one assignment');
  assert.equal(ov.week.completed, 1); assert.equal(ov.week.count_pct, 50);
  assert.equal(ov.week.weighted_pct, 25, '30 of 120 estimated minutes');
  // finishing only some of B's sessions does not complete B
  const bs = dbm.all('SELECT * FROM sessions WHERE task_id = ? ORDER BY planned_date, start_time', b);
  await fam.ben.post(`/api/sessions/${bs[0].id}/status`, { status: 'done' });
  ov = (await fam.parent.get('/api/parent/overview?week=2026-10-26')).body.children.find((x) => x.child.id === 'ben');
  assert.equal(ov.week.completed, 1);
  // empty week: no errors, nothing to measure
  const empty = (await fam.parent.get('/api/parent/overview?week=2026-12-07')).body.children.find((x) => x.child.id === 'shin');
  assert.equal(empty.week.total, 0); assert.equal(empty.week.count_pct, null); assert.equal(empty.week.weighted_pct, null); assert.equal(empty.week.on_time.rate_pct, null);
  assert.equal(empty.today.count_pct, null);
});

test('on-time rate compares the completion time with the original deadline', async () => {
  const a = await addTask(fam.parent, { title: 'On time', est_minutes: 30, deadline: '2026-10-28T20:00' });
  const b = await addTask(fam.parent, { title: 'Late', est_minutes: 30, deadline: '2026-10-28T15:00' });
  await fam.ben.post(`/api/tasks/${a}/status`, { status: 'done' });   // done 15:42 < 20:00
  await fam.ben.post(`/api/tasks/${b}/status`, { status: 'done' });   // done 15:42 > 15:00
  const ov = (await fam.parent.get('/api/parent/overview?week=2026-10-26')).body.children.find((x) => x.child.id === 'ben');
  assert.equal(ov.week.on_time.eligible, 2); assert.equal(ov.week.on_time.on_time, 1); assert.equal(ov.week.on_time.rate_pct, 50);
});

test('overdue, unscheduled and actual time: only recorded time is reported', async () => {
  await addTask(fam.parent, { title: 'Overdue one', est_minutes: 30, deadline: '2026-10-27T18:00' });
  await addTask(fam.parent, { title: 'Unplanned', est_minutes: 30, deadline: '2026-11-01T18:00' });
  let p = (await fam.parent.get('/api/parent/progress?week=2026-10-26')).body.children.find((x) => x.child.id === 'ben');
  assert.equal(p.overdue.length, 1); assert.equal(p.unscheduled.length, 2); assert.equal(p.actual.recorded, false, 'no invented study time');
  await scheduleWeek(fam.parent, ['ben']);
  const s = dbm.get("SELECT s.* FROM sessions s JOIN tasks t ON t.id = s.task_id WHERE t.title = 'Unplanned'");
  await fam.ben.post(`/api/sessions/${s.id}/status`, { status: 'done', actual_minutes: 22 });
  p = (await fam.parent.get('/api/parent/progress?week=2026-10-26')).body.children.find((x) => x.child.id === 'ben');
  assert.deepEqual(p.actual, { recorded: true, minutes: 22, sessions: 1 });
});

test('progress can be filtered by child, subject and status', async () => {
  await addTask(fam.parent, { title: 'M1', subject: 'Maths', est_minutes: 30 });
  await addTask(fam.parent, { title: 'S1', subject: 'Science', est_minutes: 30 });
  const all = (await fam.parent.get('/api/parent/progress?week=2026-10-26&child=ben')).body;
  assert.equal(all.children.length, 1); assert.equal(all.children[0].week.total, 2);
  const f = (await fam.parent.get('/api/parent/progress?week=2026-10-26&child=ben&subject=Maths')).body.children[0];
  assert.equal(f.week.total, 1);
  assert.equal((await fam.parent.get('/api/parent/tasks?child=ben&status=done')).body.tasks.length, 0);
});

test('parent can edit, reassign details, cancel and reopen; cancelled tasks leave the child board', async () => {
  const id = await addTask(fam.parent, { title: 'Editable', est_minutes: 30, deadline: '2026-10-30T18:00' });
  const v = task(id).version;
  const e = await fam.parent.patch(`/api/parent/tasks/${id}`, { title: 'Edited title', est_minutes: 50, version: v });
  assert.equal(e.status, 200); assert.equal(e.body.task.est_minutes, 50); assert.equal(e.body.task.est_confirmed, 1);
  assert.equal((await fam.parent.patch(`/api/parent/tasks/${id}`, { title: 'Stale', version: v })).status, 409);
  await scheduleWeek(fam.parent, ['ben']);
  await fam.parent.post(`/api/parent/tasks/${id}/cancel`);
  assert.equal(dbm.all('SELECT * FROM sessions WHERE task_id = ?', id).length, 0);
  const wk = await fam.ben.get('/api/board/ben/week?week=2026-10-26');
  assert.ok(!JSON.stringify(wk.body).includes('Edited title'));
  const id2 = await addTask(fam.parent, { title: 'Reopen me', est_minutes: 30, review_required: 1 });
  await fam.ben.post(`/api/tasks/${id2}/status`, { status: 'done' });
  await fam.parent.post(`/api/parent/tasks/${id2}/review`, { decision: 'approved' });
  const ro = await fam.parent.post(`/api/parent/tasks/${id2}/reopen`);
  assert.equal(ro.body.task.status, 'in_progress'); assert.equal(ro.body.task.review_status, 'not_submitted');
});

test('assigning to both children creates two independent task instances', async () => {
  const r = await fam.parent.post('/api/parent/tasks', { child_ids: ['ben', 'shin'], week_start: '2026-10-26', items: [{ title: 'Both of you: read chapter 4', est_minutes: 30, deadline: '2026-10-30T18:00' }] });
  assert.equal(r.body.created, 2);
  const rows = dbm.all("SELECT * FROM tasks WHERE title LIKE 'Both of you%'");
  assert.equal(new Set(rows.map((x) => x.id)).size, 2); assert.deepEqual(rows.map((x) => x.child_id).sort(), ['ben', 'shin']);
  assert.equal(rows[0].batch_id, rows[1].batch_id);
  await fam.ben.post(`/api/tasks/${rows.find((x) => x.child_id === 'ben').id}/status`, { status: 'done' });
  assert.equal(dbm.get("SELECT status FROM tasks WHERE child_id = 'shin' AND title LIKE 'Both%'").status, 'not_started', 'progress is independent');
});

test("today view shows only today's sessions with links; notifications are per person", async () => {
  await addTask(fam.parent, { title: 'Today thing', est_minutes: 30, deadline: '2026-10-28T21:00', target: '2026-10-28T21:00', resource_link: 'https://example.com/ex', work_link: 'https://drive.google.com/x' });
  await scheduleWeek(fam.parent, ['ben']);
  const today = await fam.ben.get('/api/board/ben/today');
  assert.equal(today.body.date, '2026-10-28');
  assert.ok(today.body.sessions.length >= 1);
  assert.equal(today.body.sessions[0].task.resource_link, 'https://example.com/ex'); assert.equal(today.body.sessions[0].task.work_link, 'https://drive.google.com/x');
  assert.equal(today.body.progress.tasks_planned, today.body.sessions.length);
  const nb = await fam.ben.get('/api/notifications'), ns = await fam.shin.get('/api/notifications');
  assert.ok(nb.body.items.length > 0); assert.equal(ns.body.items.filter((n) => n.title.includes('Today thing')).length, 0);
  await fam.ben.post('/api/notifications/read', {});
  assert.equal((await fam.ben.get('/api/notifications')).body.unread, 0);
});

test('data persists: a second process opening the same database file sees the saved work', async () => {
  const fs = require('node:fs'), os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-persist-'));
  const script = `
    process.env.NODE_ENV='test'; process.env.DATA_DIR=${JSON.stringify(dir)}; delete process.env.DB_PATH;
    const T=require('${path.join(__dirname, '../server/time')}'); T.setClock(()=>Date.UTC(2026,9,28,8,42));
    const d=require('${path.join(__dirname, '../server/db')}'); require('${path.join(__dirname, '../server/seed')}').seedBase();
    const K=require('${path.join(__dirname, '../server/tasks')}');
    const mode=process.argv[1];
    if(mode==='write'){ K.createTasks({items:[{title:'Persisted task',est_minutes:30}],childIds:['ben'],weekStart:'2026-10-26'}); }
    else { console.log(JSON.stringify(d.all('SELECT title, est_minutes FROM tasks'))); }`;
  execFileSync(process.execPath, ['-e', script, 'write'], { env: { ...process.env, NODE_NO_WARNINGS: '1' } });
  const out = execFileSync(process.execPath, ['-e', script, 'read'], { env: { ...process.env, NODE_NO_WARNINGS: '1' } }).toString();
  assert.deepEqual(JSON.parse(out), [{ title: 'Persisted task', est_minutes: 30 }]);
});
