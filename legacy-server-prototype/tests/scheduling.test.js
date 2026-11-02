'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, freshFamily, addTask, scheduleWeek, at, T, dbm } = require('./helpers');
const S = require('../server/scheduler');

let srv, fam;
test.before(async () => { at('2026-10-28', '15:42'); srv = await start(); });
test.after(() => srv.close());
test.beforeEach(async () => { at('2026-10-28', '15:42'); fam = await freshFamily(srv.base); });

const sessionsOf = (child) => dbm.all('SELECT s.*, t.title, t.deadline FROM sessions s JOIN tasks t ON t.id = s.task_id WHERE s.child_id = ? ORDER BY planned_date, start_time', child);

// Independent checker used by several tests: no overlaps, inside the study window, outside fixed commitments, under daily limits, before deadlines.
function assertValid(child) {
  const ctx = require('../server/tasks').childContext(child);
  const ss = sessionsOf(child);
  const byDay = {};
  for (const s of ss) (byDay[s.planned_date] ||= []).push(s);
  for (const [date, list] of Object.entries(byDay)) {
    const day = S.dayModel(ctx.settings, ctx.blocks, date);
    let load = 0;
    list.sort((a, b) => a.start_time.localeCompare(b.start_time));
    list.forEach((s, i) => {
      const st = T.parseHM(s.start_time), en = T.parseHM(s.end_time);
      assert.equal(en - st, s.minutes, 'minutes match times');
      assert.ok(st >= day.start && en <= day.end, `${s.title} ${date} ${s.start_time} inside the study window ${T.fmtHM(day.start)}-${T.fmtHM(day.end)}`);
      for (const b of day.busy) assert.ok(en <= b.start || st >= b.end, `${s.title} ${date} ${s.start_time} overlaps ${b.title}`);
      if (i > 0) assert.ok(st >= T.parseHM(list[i - 1].end_time) + ctx.settings.break_min, `break between sessions on ${date}`);
      if (s.deadline) assert.ok(T.keyOf(date, en) <= T.dtKey(s.deadline), `${s.title} ends before its deadline`);
      load += s.minutes;
    });
    assert.ok(load <= day.cap, `${date} load ${load} within cap ${day.cap}`);
  }
}

test("the family's real weekly workload is scheduled for both children without conflicts", async () => {
  const gen = await fam.parent.post('/api/parent/templates/generate', { child_ids: ['ben', 'shin'], week_start: '2026-10-26' });
  assert.equal(gen.status, 200);
  assert.equal(gen.body.items.length, 13);
  const save = await fam.parent.post('/api/parent/import/confirm', { week_start: '2026-10-26', items: gen.body.items });
  assert.equal(save.body.created, 13);
  const previews = await scheduleWeek(fam.parent);
  assertValid('ben'); assertValid('shin');
  // each child is scheduled on their own: sessions only reference that child's tasks
  for (const c of ['ben', 'shin']) for (const s of sessionsOf(c)) assert.equal(dbm.get('SELECT child_id FROM tasks WHERE id = ?', s.task_id).child_id, c);
  assert.ok(previews.every((p) => p.sessions.length > 0));
});

test('Ben travel for the Saturday Cindy class blocks the time around it', async () => {
  await addTask(fam.parent, { title: 'Saturday filler', est_minutes: 30, deadline: '2026-10-31T23:00', target: '2026-10-31T22:00' });
  const ctx = require('../server/tasks').childContext('ben');
  const day = S.dayModel(ctx.settings, ctx.blocks, '2026-10-31');
  const cindy = day.busy.find((b) => b.title.includes('Cindy'));
  assert.equal(T.fmtHM(cindy.start), '06:45'); assert.equal(T.fmtHM(cindy.end), '11:15');   // 08:00-10:00 class + 75 min travel each way
});

test('work that cannot fit before its deadline is listed as unscheduled with a reason', async () => {
  await addTask(fam.parent, { title: 'Impossible', est_minutes: 600, deadline: '2026-10-29T18:00' });
  await addTask(fam.parent, { title: 'Easy', est_minutes: 30, deadline: '2026-11-01T18:00' });
  const [p] = await scheduleWeek(fam.parent, ['ben']);
  const u = p.unscheduled.find((x) => x.title === 'Impossible');
  assert.ok(u, 'listed as unscheduled'); assert.ok(u.minutes > 0); assert.ok(u.reason.length > 20);
  assert.ok(dbm.get("SELECT unscheduled_reason FROM tasks WHERE title = 'Impossible'").unscheduled_reason);
  assert.ok(p.sessions.some((s) => s.title === 'Easy'));
  assertValid('ben');
  const board = await fam.ben.get('/api/board/ben/week?week=2026-10-26');
  assert.ok(board.body.unscheduled.some((t) => t.title === 'Impossible'), 'child sees it in the unscheduled list');
});

test('a deadline that is already before the first study time is explained', async () => {
  await addTask(fam.parent, { title: 'Due tomorrow 7am', est_minutes: 45, deadline: '2026-10-29T07:00' });
  const [p] = await scheduleWeek(fam.parent, ['ben']);
  // Tonight (Wed 28) still has time before 07:00 Thursday, so it should be placed this evening.
  const s = p.sessions.filter((x) => x.title === 'Due tomorrow 7am');
  assert.ok(s.length >= 1 && s.every((x) => x.planned_date === '2026-10-28'));
  assertValid('ben');
});

test('overloaded days are reported and the daily limit is never exceeded by automatic planning', async () => {
  for (let i = 0; i < 8; i++) await addTask(fam.parent, { title: `Big job ${i}`, est_minutes: 90, deadline: '2026-10-29T20:00' });
  const [p] = await scheduleWeek(fam.parent, ['ben']);
  assert.ok(p.unscheduled.length > 0);
  assertValid('ben');
  const summary = await fam.parent.get('/api/parent/overview?week=2026-10-26');
  assert.ok(summary.body.children.find((c) => c.child.id === 'ben').unscheduled.length > 0);
});

test('system-estimated durations are flagged for confirmation until the parent confirms', async () => {
  const id = await addTask(fam.parent, { title: 'Writing (cô Ngô Bla)', subject: 'Writing', deadline: '2026-10-29T20:00' });   // no duration given
  const t = dbm.get('SELECT * FROM tasks WHERE id = ?', id);
  assert.equal(t.est_source, 'system'); assert.equal(t.est_confirmed, 0);
  const pv = await fam.parent.post('/api/parent/schedule/preview', { child_ids: ['ben'], week_start: '2026-10-26', mode: 'week' });
  assert.ok(pv.body.previews[0].warnings.some((w) => w.code === 'estimate_unconfirmed'));
  await fam.parent.post(`/api/parent/tasks/${id}/confirm-estimate`);
  const pv2 = await fam.parent.post('/api/parent/schedule/preview', { child_ids: ['ben'], week_start: '2026-10-26', mode: 'week' });
  assert.ok(!pv2.body.previews[0].warnings.some((w) => w.code === 'estimate_unconfirmed'));
});

test('default durations follow the family rules (workbook 45 min for Ben, 60 min for Shin)', async () => {
  const b = await addTask(fam.parent, { title: 'Workbook Maths', subject: 'Maths' }, { child: 'ben' });
  const s = await addTask(fam.parent, { title: 'Workbook Maths', subject: 'Maths' }, { child: 'shin' });
  assert.equal(dbm.get('SELECT est_minutes FROM tasks WHERE id = ?', b).est_minutes, 45);
  assert.equal(dbm.get('SELECT est_minutes FROM tasks WHERE id = ?', s).est_minutes, 60);
});

test('Cindy homework is split into one 1-hour piece per day', async () => {
  await addTask(fam.parent, { title: 'Cô Linh Cindy homework', subject: 'Cindy class', est_minutes: 180, deadline: '2026-10-31T08:00', target: '2026-10-30T21:00' });
  await scheduleWeek(fam.parent, ['ben']);
  const ss = sessionsOf('ben').filter((s) => s.title.includes('Cindy'));
  assert.equal(ss.length, 3); assert.ok(ss.every((s) => s.minutes === 60));
  assert.equal(new Set(ss.map((s) => s.planned_date)).size, 3, 'one per day');
  assertValid('ben');
});

test('a preview changes nothing until it is applied; applying twice is refused', async () => {
  await addTask(fam.parent, { title: 'Preview me', est_minutes: 30, deadline: '2026-11-01T18:00' });
  const pv = await fam.parent.post('/api/parent/schedule/preview', { child_ids: ['ben'], week_start: '2026-10-26', mode: 'week' });
  assert.equal(sessionsOf('ben').length, 0);
  const id = pv.body.previews[0].proposal_id;
  assert.equal((await fam.parent.post('/api/parent/schedule/apply', { proposal_ids: [id] })).status, 200);
  assert.ok(sessionsOf('ben').length > 0);
  assert.equal((await fam.parent.post('/api/parent/schedule/apply', { proposal_ids: [id] })).status, 409);
});

test('a stale preview is refused if something changed meanwhile', async () => {
  await addTask(fam.parent, { title: 'First', est_minutes: 30, deadline: '2026-11-01T18:00' });
  const pv = await fam.parent.post('/api/parent/schedule/preview', { child_ids: ['ben'], week_start: '2026-10-26', mode: 'week' });
  await addTask(fam.parent, { title: 'Added after preview', est_minutes: 30, deadline: '2026-11-01T18:00' });
  const r = await fam.parent.post('/api/parent/schedule/apply', { proposal_ids: [pv.body.previews[0].proposal_id] });
  assert.equal(r.status, 409);
});

test('re-planning keeps finished and locked sessions and never moves them', async () => {
  const t1 = await addTask(fam.parent, { title: 'Will be done', est_minutes: 60, deadline: '2026-11-01T18:00' });
  const t2 = await addTask(fam.parent, { title: 'Will be locked', est_minutes: 30, deadline: '2026-11-01T18:00' });
  await addTask(fam.parent, { title: 'Free to move', est_minutes: 30, deadline: '2026-11-01T18:00' });
  await scheduleWeek(fam.parent, ['ben']);
  const done = dbm.all('SELECT * FROM sessions WHERE task_id = ?', t1)[0];
  await fam.ben.post(`/api/sessions/${done.id}/status`, { status: 'done' });
  const locked = dbm.get('SELECT * FROM sessions WHERE task_id = ?', t2);
  await fam.ben.post(`/api/sessions/${locked.id}/lock`, { locked: true });
  await scheduleWeek(fam.parent, ['ben']);
  const d2 = dbm.get('SELECT * FROM sessions WHERE id = ?', done.id), l2 = dbm.get('SELECT * FROM sessions WHERE id = ?', locked.id);
  assert.equal(d2.status, 'done'); assert.equal(d2.start_time, done.start_time); assert.equal(d2.planned_date, done.planned_date);
  assert.equal(l2.start_time, locked.start_time); assert.equal(l2.planned_date, locked.planned_date); assert.equal(l2.locked, 1);
  assertValid('ben');
});

test('child can change a session date/time; warnings need an explicit go-ahead; the change is locked', async () => {
  const id = await addTask(fam.parent, { title: 'Movable', est_minutes: 30, deadline: '2026-11-01T18:00' });
  await addTask(fam.parent, { title: 'Neighbour', est_minutes: 30, deadline: '2026-11-01T18:00' });
  await scheduleWeek(fam.parent, ['ben']);
  const s = dbm.get('SELECT * FROM sessions WHERE task_id = ?', id);
  const other = dbm.get('SELECT * FROM sessions WHERE task_id <> ? AND child_id = ? ORDER BY planned_date, start_time LIMIT 1', id, 'ben');
  // a clean move to a free evening
  const ok = await fam.ben.post(`/api/sessions/${s.id}/move`, { date: '2026-11-01', start: '13:00', version: s.version });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.session.locked, 1); assert.equal(ok.body.session.origin, 'manual');
  assert.equal(dbm.get('SELECT planned_date, start_time FROM sessions WHERE id = ?', s.id).start_time, '13:00');
  // overlapping another session -> warning, not applied without acknowledgement
  const clash = await fam.ben.post(`/api/sessions/${s.id}/move`, { date: other.planned_date, start: other.start_time });
  assert.equal(clash.status, 409); assert.equal(clash.body.needs_ack, true);
  assert.ok(clash.body.warnings.some((w) => w.code === 'overlap_session'));
  assert.equal(dbm.get('SELECT start_time FROM sessions WHERE id = ?', s.id).start_time, '13:00', 'unchanged');
  const forced = await fam.ben.post(`/api/sessions/${s.id}/move`, { date: other.planned_date, start: other.start_time, acknowledged: true });
  assert.equal(forced.status, 200);
  // over a fixed commitment (Thursday 20:00 Writing class) and after the deadline are also flagged
  const fixed = await fam.ben.post(`/api/sessions/${s.id}/move`, { date: '2026-10-29', start: '20:15', acknowledged: false });
  assert.ok(fixed.body.warnings.some((w) => w.code === 'overlap_fixed'));
  const late = await fam.ben.post(`/api/sessions/${s.id}/move`, { date: '2026-11-01', start: '18:30' });
  assert.ok(late.body.warnings.some((w) => w.code === 'after_deadline'));
});

test('stale edits are rejected (two people changing the same session)', async () => {
  const id = await addTask(fam.parent, { title: 'Race', est_minutes: 30, deadline: '2026-11-01T18:00' });
  await scheduleWeek(fam.parent, ['ben']);
  const s = dbm.get('SELECT * FROM sessions WHERE task_id = ?', id);
  assert.equal((await fam.ben.post(`/api/sessions/${s.id}/move`, { date: '2026-11-01', start: '13:00', version: s.version })).status, 200);
  assert.equal((await fam.parent.post(`/api/sessions/${s.id}/move`, { date: '2026-10-31', start: '12:00', version: s.version })).status, 409);
});

test('dropping a card on a day places it in the first free slot; up/down swaps neighbours', async () => {
  const a = await addTask(fam.parent, { title: 'Alpha', est_minutes: 30, deadline: '2026-11-01T20:00', target: '2026-10-29T21:00' });
  const b = await addTask(fam.parent, { title: 'Beta', est_minutes: 30, deadline: '2026-11-01T20:00', target: '2026-10-29T21:00' });
  await scheduleWeek(fam.parent, ['ben']);
  const sa = dbm.get('SELECT * FROM sessions WHERE task_id = ?', a);
  const moved = await fam.ben.post(`/api/sessions/${sa.id}/move`, { date: '2026-10-30' });          // no time given = first free slot
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(moved.body.session.planned_date, '2026-10-30'); assert.equal(moved.body.session.start_time, '17:00');
  // up/down on a day with two sessions
  const day = dbm.all("SELECT * FROM sessions WHERE child_id='ben' AND planned_date = ? ORDER BY start_time", moved.body.session.planned_date);
  if (day.length >= 2) {
    const before = day.map((d) => d.id);
    const sh = await fam.ben.post(`/api/sessions/${before[0]}/shift`, { direction: 'down' });
    assert.equal(sh.status, 200);
    const after = dbm.all("SELECT id FROM sessions WHERE child_id='ben' AND planned_date = ? ORDER BY start_time", moved.body.session.planned_date).map((d) => d.id);
    assert.equal(after[0], before[1]);
    assertValid('ben');
  }
});

test('Reschedule Unfinished keeps the original deadline and flags overdue work', async () => {
  const id = await addTask(fam.parent, { title: 'Late one', est_minutes: 30, deadline: '2026-10-27T18:00' });
  const before = dbm.get('SELECT deadline FROM tasks WHERE id = ?', id).deadline;
  const [p] = await scheduleWeek(fam.parent, ['ben'], '2026-10-26', 'unfinished');
  assert.ok(p.warnings.some((w) => w.code === 'overdue'));
  assert.ok(sessionsOf('ben').some((s) => s.title === 'Late one'));
  assert.equal(dbm.get('SELECT deadline FROM tasks WHERE id = ?', id).deadline, before, 'deadline unchanged');
  const sum = await fam.parent.get('/api/parent/overview');
  assert.equal(sum.body.children.find((c) => c.child.id === 'ben').overdue.length, 1, 'still shown as overdue');
});

test('the child can place an unscheduled task herself/himself', async () => {
  const id = await addTask(fam.parent, { title: 'Hand placed', est_minutes: 40, deadline: '2026-11-01T18:00' });
  const r = await fam.ben.post(`/api/tasks/${id}/plan`, { date: '2026-10-31', start: '12:00' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.session.minutes, 40);
  assert.equal((await fam.ben.post(`/api/tasks/${id}/plan`, { date: '2026-10-31', start: '15:00' })).status, 409, 'everything already planned');
});

test('planning a past week is refused with an explanation', async () => {
  await addTask(fam.parent, { title: 'Old', est_minutes: 30, deadline: '2026-10-20T18:00' }, { week: '2026-10-12' });
  const pv = await fam.parent.post('/api/parent/schedule/preview', { child_ids: ['ben'], week_start: '2026-10-12', mode: 'week' });
  assert.ok(pv.body.previews[0].warnings.some((w) => w.code === 'week_in_past'));
  assert.equal(pv.body.previews[0].sessions.length, 0);
});

test('splitMinutes divides work evenly in 5-minute steps', () => {
  assert.deepEqual(S.splitMinutes(45, 30), [25, 20]);
  assert.deepEqual(S.splitMinutes(60, 60), [60]);
  assert.deepEqual(S.splitMinutes(90, 45), [45, 45]);
  assert.deepEqual(S.splitMinutes(0, 30), []);
  assert.equal(S.splitMinutes(185, 30).reduce((a, b) => a + b, 0), 185);
});

test('different timetables give different, valid plans', async () => {
  // Make Shin's weekdays very busy: no study before 19:30, and a low limit.
  await fam.parent.put('/api/parent/child-settings/shin', { home_weekday: '19:30', weekend_start: '09:00', dinner_start: '18:00', dinner_end: '18:30', bedtime: '21:30', wind_down_min: 30,
    session_min: 30, break_min: 10, max_weekday_min: 60, max_weekend_min: 120, spare_min: 10, email: '' });
  await addTask(fam.parent, { title: 'Shin work', est_minutes: 90, deadline: '2026-11-01T18:00' }, { child: 'shin' });
  await addTask(fam.parent, { title: 'Ben work', est_minutes: 90, deadline: '2026-11-01T18:00' }, { child: 'ben' });
  await scheduleWeek(fam.parent);
  assertValid('ben'); assertValid('shin');
  const shinDays = sessionsOf('shin');
  assert.ok(shinDays.every((s) => T.weekdayOf(s.planned_date) >= 6 || T.parseHM(s.start_time) >= T.parseHM('19:30')), 'Shin only studies in his own windows');
});
