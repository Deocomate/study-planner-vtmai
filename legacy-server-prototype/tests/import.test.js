'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, freshFamily, addTask, at, T, dbm } = require('./helpers');
const importer = require('../server/importer');
const files = require('../server/files');

let srv, fam;
test.before(async () => { at('2026-10-28', '15:42'); srv = await start(); });
test.after(() => srv.close());
test.beforeEach(async () => { at('2026-10-28', '15:42'); fam = await freshFamily(srv.base); });

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
const extract = (body) => fam.parent.post('/api/parent/import/extract', { child_ids: ['ben'], week_start: '2026-10-26', ...body });

test('pasted text becomes an editable preview that saves nothing until confirmed', async () => {
  const text = `1. Maths workbook p12-15 due Thu 7:00 45m https://drive.google.com/file/d/maths
- Writing essay (cô Ngô Bla) Wed 20h30 1.5h
Read chapter 3`;
  const r = await extract({ text });
  assert.equal(r.status, 200); assert.equal(r.body.status, 'ok'); assert.equal(r.body.items.length, 3);
  assert.equal(dbm.get('SELECT COUNT(*) AS n FROM tasks').n, 0, 'nothing saved yet');
  const [m, w, c] = r.body.items;
  assert.equal(m.deadline, '2026-10-29T07:00'); assert.equal(m.est_minutes, 45); assert.equal(m.est_source, 'source'); assert.equal(m.resource_link, 'https://drive.google.com/file/d/maths'); assert.equal(m.task_type, 'workbook');
  assert.equal(w.deadline, '2026-10-28T20:30'); assert.equal(w.est_minutes, 90);
  // what was missing is flagged, and system estimates are labelled as such
  assert.ok(c.flags.some((f) => /No deadline/.test(f))); assert.equal(c.est_source, 'system'); assert.ok(c.flags.some((f) => /system estimate/.test(f)));
  assert.ok(m.flags.some((f) => /worked out from the weekday/.test(f)));
  const save = await fam.parent.post('/api/parent/import/confirm', { week_start: '2026-10-26', items: r.body.items });
  assert.equal(save.body.created, 3);
  const saved = dbm.get("SELECT * FROM tasks WHERE title LIKE 'Maths workbook%'");
  assert.equal(saved.est_confirmed, 1, 'a duration read from the source needs no confirmation');
  assert.equal(dbm.get("SELECT est_confirmed FROM tasks WHERE title = 'Read chapter 3'").est_confirmed, 0);
});

test('"Both" creates separate preview items and separate tasks for each child, with each child\'s own default durations', async () => {
  const r = await fam.parent.post('/api/parent/import/extract', { child_ids: ['ben', 'shin'], week_start: '2026-10-26', text: 'Workbook Science due Mon 7:00' });
  assert.equal(r.body.items.length, 2);
  assert.deepEqual(r.body.items.map((i) => [i.child_id, i.est_minutes]), [['ben', 45], ['shin', 60]]);
  await fam.parent.post('/api/parent/import/confirm', { week_start: '2026-10-26', items: r.body.items });
  assert.equal(dbm.all("SELECT * FROM tasks WHERE title LIKE 'Workbook Science%'").length, 2);
});

test('possible duplicates are flagged and must be confirmed explicitly', async () => {
  await addTask(fam.parent, { title: 'Maths workbook', est_minutes: 45, deadline: '2026-10-29T07:00' });
  const r = await extract({ text: 'Maths workbook due Thu 7:00 45m\nMaths workbook due Thu 7:00\nNew different thing Fri 18:00' });
  const dupExisting = r.body.items.filter((i) => i.duplicate_of);
  assert.equal(dupExisting.length, 2); assert.ok(dupExisting[0].flags.some((f) => /Possible duplicate/.test(f)));
  assert.ok(r.body.items[1].flags.some((f) => /Looks the same as item 1/.test(f)));
  const blocked = await fam.parent.post('/api/parent/import/confirm', { week_start: '2026-10-26', items: r.body.items });
  assert.equal(blocked.status, 409);
  const ok = await fam.parent.post('/api/parent/import/confirm', { week_start: '2026-10-26', items: r.body.items.map((i) => (i.duplicate_of ? { ...i, include: false } : i)) });
  assert.equal(ok.body.created, 1);
  const forced = await fam.parent.post('/api/parent/import/confirm', { week_start: '2026-10-26', items: [{ ...dupExisting[0], confirm_duplicate: true }] });
  assert.equal(forced.body.created, 1);
});

test('images and PDFs are never "read" when no extraction service is connected', async () => {
  for (const [name, buf] of [['shot.png', png], ['sheet.pdf', pdf]]) {
    const up = await fam.parent.req('POST', `/api/files?kind=import&name=${name}`, undefined, { raw: buf });
    assert.equal(up.status, 200);
    const r = await extract({ file_ids: [up.body.file.id] });
    assert.equal(r.body.status, 'not_connected', name); assert.equal(r.body.items.length, 0);
    assert.match(r.body.notes[0], /not connected/);
  }
  const st = await fam.parent.get('/api/parent/import/status');
  assert.equal(st.body.extraction_connected, false);
});

test('import accepts only PDF/PNG/JPG/WEBP files; fake files are rejected', async () => {
  assert.equal((await fam.parent.req('POST', '/api/files?kind=import&name=a.txt', undefined, { raw: Buffer.from('hello') })).status, 400);
  assert.equal((await fam.parent.req('POST', '/api/files?kind=import&name=a.pdf', undefined, { raw: Buffer.from('not really a pdf') })).status, 400);
  assert.equal((await fam.parent.req('POST', '/api/files?kind=import&name=a.docx', undefined, { raw: Buffer.from([0x50, 0x4b, 3, 4, 0, 0]) })).status, 400, 'office files are for submissions, not for import');
});

test('with an extraction service, screenshots/PDFs give an editable preview (model call mocked)', async () => {
  const f = files.saveUpload({ buf: png, name: 'shot.png', kind: 'import', userId: null });
  const row = dbm.get('SELECT * FROM files WHERE id = ?', f.id);
  let sent;
  const call = async (content) => { sent = content; return '```json\n' + JSON.stringify({ tasks: [
    { title: 'Science workbook pages 10-12', subject: 'Science', deadline_weekday: 4, deadline_time: '07:00', estimated_minutes: null, links: ['https://drive.google.com/x'], applies_to: null, unclear: ['page numbers'] },
    { title: 'Debate speech', subject: 'Debate', deadline_date: '2026-10-30', deadline_time: null, estimated_minutes: 60, links: [], applies_to: 'shin', unclear: [] },
    { title: '', subject: null }] , unreadable: ['bottom right corner'] }) + '\n```'; };
  const r = await importer.extract({ childIds: ['ben', 'shin'], weekStart: '2026-10-26', text: '', fileRows: [row], call });
  assert.equal(r.status, 'ok');
  assert.equal(sent[0].type, 'image'); assert.equal(sent[0].source.media_type, 'image/png');
  assert.equal(r.items.length, 3, 'untitled item dropped; item 1 for both children; item 2 only for shin');
  const sci = r.items.filter((i) => i.title.startsWith('Science'));
  assert.deepEqual(sci.map((i) => i.child_id), ['ben', 'shin']);
  assert.equal(sci[0].deadline, '2026-10-29T07:00'); assert.ok(sci[0].flags.some((x) => /page numbers/.test(x)));
  assert.equal(sci[0].est_source, 'system', 'no duration in the source => system suggestion'); assert.equal(sci[0].est_minutes, 45);
  const deb = r.items.find((i) => i.title === 'Debate speech');
  assert.equal(deb.child_id, 'shin'); assert.equal(deb.est_source, 'source'); assert.ok(deb.flags.some((x) => /end of day/.test(x)));
  assert.ok(r.notes.some((n) => /bottom right corner/.test(n)));
  assert.equal(r.source_file_id, f.id, 'the source file stays attached to the tasks');
});

test('a failing or nonsensical extraction service never produces fake tasks', async () => {
  const f = files.saveUpload({ buf: pdf, name: 'x.pdf', kind: 'import', userId: null });
  const row = dbm.get('SELECT * FROM files WHERE id = ?', f.id);
  const bad = await importer.extract({ childIds: ['ben'], weekStart: '2026-10-26', text: '', fileRows: [row], call: async () => 'Sorry, I cannot help with that.' });
  assert.equal(bad.status, 'failed'); assert.equal(bad.items.length, 0);
  const err = await importer.extract({ childIds: ['ben'], weekStart: '2026-10-26', text: '', fileRows: [row], call: async () => { throw new Error('The extraction service answered with an error (401): invalid key'); } });
  assert.equal(err.status, 'failed'); assert.match(err.notes[0], /invalid key/);
});

test('a source file stays attached to its tasks; children can open it only for their own tasks', async () => {
  const up = await fam.parent.req('POST', '/api/files?kind=import&name=worksheet.pdf', undefined, { raw: pdf });
  const fid = up.body.file.id;
  const item = { child_id: 'ben', title: 'From worksheet', est_minutes: 30, source_file_id: fid };
  await fam.parent.post('/api/parent/import/confirm', { week_start: '2026-10-26', items: [item] });
  assert.equal(dbm.get("SELECT source_file_id FROM tasks WHERE title = 'From worksheet'").source_file_id, fid);
  assert.equal((await fam.ben.get(`/api/files/${fid}`)).status, 200);
  assert.equal((await fam.shin.get(`/api/files/${fid}`)).status, 404);
});

test('Drive links alone are attached to a new task for the parent to describe', async () => {
  const r = await extract({ drive_links: ['https://drive.google.com/file/d/xyz'] });
  assert.equal(r.body.items.length, 1); assert.equal(r.body.items[0].resource_link, 'https://drive.google.com/file/d/xyz');
  assert.ok(r.body.items[0].flags.some((f) => /Only a link/.test(f)));
  assert.equal((await extract({ drive_links: ['javascript:alert(1)'] })).status, 400);
});

test('manual entry works with nothing connected', async () => {
  const r = await fam.parent.post('/api/parent/tasks', { child_ids: ['shin'], week_start: '2026-10-26', items: [{ title: 'Manual', subject: 'Maths', est_minutes: 20, priority: 3, deadline: '2026-10-30T18:00' }] });
  assert.equal(r.status, 200);
  const t = dbm.get("SELECT * FROM tasks WHERE title = 'Manual'");
  assert.equal(t.priority, 3); assert.equal(t.reporting_month, '2026-10'); assert.equal(t.week_start, '2026-10-26');
});

test('weekly template: target inside the work week, deadline after it', async () => {
  const items = importer.templateItems('2026-10-26', ['ben', 'shin']);
  const by = (c, t) => items.find((i) => i.child_id === c && i.title.startsWith(t));
  assert.equal(by('ben', 'Workbook Maths').deadline, '2026-11-05T07:00'); assert.equal(by('ben', 'Workbook Maths').target, '2026-11-01T20:00');
  assert.equal(by('shin', 'Workbook Science').deadline, '2026-11-02T07:00', 'Monday 07:00 after Sunday evening');
  assert.equal(by('ben', 'Writing').deadline, '2026-10-29T20:00'); assert.equal(by('ben', 'Writing').target, '2026-10-28T21:00');
  assert.equal(by('shin', 'Maths (cô Mẫn)').deadline, '2026-11-01T19:30');
  assert.equal(by('shin', 'Cô Linh Cindy').deadline, '2026-10-28T19:40');
  assert.equal(items.length, 13);
});

test('reporting month: deadline month, or the month of the Thursday of the week', async () => {
  assert.equal(T.reportingMonthFor('2026-11-01T10:00', '2026-10-26'), '2026-11');
  assert.equal(T.reportingMonthFor('2026-10-31T10:00', '2026-10-26'), '2026-10');
  assert.equal(T.reportingMonthFor(null, '2026-10-26'), '2026-10');   // Thursday 29 Oct
  assert.equal(T.reportingMonthFor(null, '2026-11-30'), '2026-12');   // week Nov 30 - Dec 6: Thursday is 3 Dec
});
