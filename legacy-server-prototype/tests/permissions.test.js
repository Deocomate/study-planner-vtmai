'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, freshFamily, addTask, at, Client, PW, dbm } = require('./helpers');

let srv, fam;
test.before(async () => { at('2026-10-28', '15:42'); srv = await start(); fam = await freshFamily(srv.base); });
test.after(() => srv.close());

test('unauthenticated requests are refused', async () => {
  const c = new Client(srv.base);
  for (const u of ['/api/board/ben/today', '/api/parent/overview', '/api/notifications']) assert.equal((await c.get(u)).status, 401, u);
  assert.equal((await c.get('/api/me')).body.user, null);
});

test('children cannot open a board other than their own; the parent can open both', async () => {
  assert.equal((await fam.ben.get('/api/board/ben/today')).status, 200);
  assert.equal((await fam.ben.get('/api/board/shin/today')).status, 403);
  assert.equal((await fam.ben.get('/api/board/shin/week')).status, 403);
  assert.equal((await fam.ben.get('/api/board/shin/feedback')).status, 403);
  assert.equal((await fam.shin.get('/api/board/ben/today')).status, 403);
  assert.equal((await fam.parent.get('/api/board/ben/today')).status, 200);
  assert.equal((await fam.parent.get('/api/board/shin/today')).status, 200);
});

test('children cannot reach any parent endpoint', async () => {
  for (const [m, u, b] of [['get', '/api/parent/overview'], ['get', '/api/parent/tasks'], ['post', '/api/parent/tasks', { items: [] }], ['get', '/api/parent/settings'],
    ['get', '/api/parent/monthly'], ['post', '/api/parent/schedule/preview', { child_ids: ['ben'] }], ['put', '/api/parent/settings', { parent_email: 'x@y.zz' }], ['post', '/api/parent/demo/load', {}],
    ['get', '/api/parent/review'], ['post', '/api/parent/import/extract', {}], ['get', '/api/parent/timetable/ben']]) {
    const r = await fam.ben[m](u, b);
    assert.equal(r.status, 403, `${m} ${u}`);
  }
});

test("a child cannot read, change, submit for or ask help on another child's task", async () => {
  const id = await addTask(fam.parent, { title: 'Shin only', est_minutes: 30, deadline: '2026-10-30T18:00' }, { child: 'shin' });
  assert.equal((await fam.ben.get(`/api/tasks/${id}`)).status, 403);
  assert.equal((await fam.ben.post(`/api/tasks/${id}/status`, { status: 'done' })).status, 403);
  assert.equal((await fam.ben.post(`/api/tasks/${id}/submit`, { note: 'x' })).status, 403);
  assert.equal((await fam.ben.post(`/api/tasks/${id}/help`, { message: 'x' })).status, 403);
  assert.equal((await fam.shin.get(`/api/tasks/${id}`)).status, 200);
});

test('children cannot change deadlines, instructions or review results', async () => {
  const id = await addTask(fam.parent, { title: 'Locked deadline', est_minutes: 30, deadline: '2026-10-30T18:00', review_required: 1 }, { child: 'ben' });
  assert.equal((await fam.ben.patch(`/api/parent/tasks/${id}`, { deadline: '2026-12-01T10:00' })).status, 403);
  assert.equal((await fam.ben.post(`/api/parent/tasks/${id}/review`, { decision: 'approved' })).status, 403);
  await fam.ben.post(`/api/tasks/${id}/status`, { status: 'in_progress', deadline: '2030-01-01T00:00', review_status: 'approved' });   // extra fields are ignored
  const t = dbm.get('SELECT deadline, review_status, status FROM tasks WHERE id = ?', id);
  assert.equal(t.deadline, '2026-10-30T18:00'); assert.equal(t.review_status, 'not_submitted'); assert.equal(t.status, 'in_progress');
});

test('every change needs the CSRF token', async () => {
  const c = new Client(srv.base); await c.login('ben', PW.ben);
  assert.equal((await c.req('POST', '/api/notifications/read', {}, { noCsrf: true })).status, 403);
  assert.equal((await c.post('/api/notifications/read', {})).status, 200);
});

test('files are private: only the owner child or the parent can open them', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const up = await fam.ben.req('POST', '/api/files?kind=submission&name=work.png', undefined, { raw: png });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const fid = up.body.file.id;
  assert.equal((await fam.ben.get(`/api/files/${fid}`)).status, 200);
  assert.equal((await fam.parent.get(`/api/files/${fid}`)).status, 200);
  assert.equal((await fam.shin.get(`/api/files/${fid}`)).status, 404);
  assert.equal((await new Client(srv.base).get(`/api/files/${fid}`)).status, 401);
  assert.equal((await fam.ben.req('POST', '/api/files?kind=import&name=a.png', undefined, { raw: png })).status, 403, 'children cannot upload import files');
});

test('uploads are validated by content, not by file name', async () => {
  const bad = (name, buf) => fam.ben.req('POST', `/api/files?kind=submission&name=${name}`, undefined, { raw: buf });
  assert.equal((await bad('homework.pdf', Buffer.from('MZ this is a program pretending to be a pdf'))).status, 400);
  assert.equal((await bad('x.html', Buffer.from('<script>alert(1)</script>'))).status, 400);
  assert.equal((await bad('x.png', Buffer.alloc(0))).status, 400);
});

test('links must be web addresses (no javascript: links)', async () => {
  const r = await fam.parent.post('/api/parent/tasks', { child_ids: ['ben'], week_start: '2026-10-26', items: [{ title: 'Bad link', resource_link: 'javascript:alert(1)' }] });
  assert.equal(r.status, 400);
});

test('first-time setup cannot be repeated once accounts exist', async () => {
  const c = new Client(srv.base);
  const r = await c.req('POST', '/api/setup', { parent_password: 'another-pass-1', ben_password: 'abcdef', shin_password: 'abcdef' }, { noCsrf: true });
  assert.equal(r.status, 409);
});

test('passwords are stored hashed, never in plain text', () => {
  const rows = dbm.all('SELECT password_hash FROM users');
  assert.equal(rows.length, 3);
  for (const r of rows) assert.match(r.password_hash, /^scrypt\$/);
});

test('wrong password is refused, and repeated failures are throttled', async () => {
  const c = new Client(srv.base);
  assert.equal((await c.login('shin', 'wrong-one')).status, 401);
  for (let i = 0; i < 4; i++) await c.login('shin', 'wrong-one');
  assert.equal((await c.login('shin', PW.shin)).status, 429, 'locked after 5 failures, even with the right password');
});
