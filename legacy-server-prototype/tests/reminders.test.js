'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { start, freshFamily, addTask, scheduleWeek, at, dbm } = require('./helpers');
const reminders = require('../server/reminders');
const mailer = require('../server/mailer');

let srv, fam, sent, failNext;
test.before(async () => { at('2026-10-28', '15:42'); srv = await start(); });
test.after(() => { mailer.setTransportForTests(null); return srv.close(); });
test.beforeEach(async () => {
  at('2026-10-28', '15:42'); fam = await freshFamily(srv.base);
  sent = []; failNext = 0;
  mailer.setTransportForTests(async (m) => { if (failNext > 0) { failNext--; throw new Error('mail server unreachable'); } sent.push(m); return { id: 'x' }; });
  await fam.parent.put('/api/parent/settings', { parent_email: 'parent@example.com', child_emails: { ben: 'ben@example.com', shin: '' } });
  await addTask(fam.parent, { title: 'Evening work', est_minutes: 30, deadline: '2026-10-28T21:30', target: '2026-10-28T21:00', resource_link: 'https://example.com/ex' });
  await addTask(fam.parent, { title: 'Shin work', est_minutes: 30, deadline: '2026-10-28T21:30', target: '2026-10-28T21:00' }, { child: 'shin' });
  await scheduleWeek(fam.parent);
});

test('the daily plan, check-in and parent summary go out at their times, and only once', async () => {
  at('2026-10-28', '18:59'); await reminders.runDue(); assert.equal(sent.length, 0, 'not yet due');
  at('2026-10-28', '19:00'); await reminders.runDue();
  const plan = sent.filter((m) => /plan/i.test(m.subject));
  assert.equal(plan.length, 1, 'Ben has an email address, Shin does not; parent copy is off by default');
  assert.equal(plan[0].to, 'ben@example.com'); assert.match(plan[0].text, /Evening work/); assert.match(plan[0].text, /https:\/\/example.com\/ex/);
  at('2026-10-28', '19:01'); await reminders.runDue(); await reminders.runDue();
  assert.equal(sent.filter((m) => /plan/i.test(m.subject)).length, 1, 'no duplicate on later checks');
  at('2026-10-28', '20:30'); await reminders.runDue();
  assert.equal(sent.filter((m) => /check-in/i.test(m.subject)).length, 1);
  at('2026-10-28', '22:00'); await reminders.runDue();
  const ps = sent.filter((m) => /Parent summary/.test(m.subject));
  assert.equal(ps.length, 1); assert.equal(ps[0].to, 'parent@example.com'); assert.match(ps[0].text, /Ben/); assert.match(ps[0].text, /Shin/);
  const log = dbm.all('SELECT status FROM reminder_log'); assert.ok(log.every((l) => l.status === 'sent'));
});

test('a restarted server does not send twice, and catches up if it was down at the exact time', async () => {
  at('2026-10-28', '19:40'); await reminders.runDue(); assert.equal(sent.length, 1, 'late by 40 minutes: still sent');
  await reminders.runDue(); assert.equal(sent.length, 1);
  at('2026-10-28', '22:30'); await reminders.runDue();
  assert.equal(sent.filter((m) => /plan/i.test(m.subject)).length, 1, 'more than 3 hours late is not sent');
});

test('recipients and each reminder type can be switched on and off; children without email are skipped', async () => {
  await fam.parent.put('/api/parent/settings', { reminders: { daily_plan: { enabled: true, time: '19:00', to_parent: true, to_children: false }, daily_checkin: { enabled: false, time: '20:30', to_parent: true, to_children: true },
    parent_summary: { enabled: false, time: '22:00', to_parent: true } } });
  at('2026-10-28', '19:00'); await reminders.runDue();
  assert.equal(sent.length, 1); assert.equal(sent[0].to, 'parent@example.com'); assert.match(sent[0].text, /Ben/); assert.match(sent[0].text, /Shin/);
  at('2026-10-28', '20:30'); await reminders.runDue(); at('2026-10-28', '22:00'); await reminders.runDue();
  assert.equal(sent.length, 1, 'disabled types are not sent');
  assert.equal((await fam.parent.put('/api/parent/settings', { reminders: { daily_plan: { enabled: true, time: '7pm' } } })).status, 400);
});

test('delivery failures are recorded, shown in the Parent Dashboard, retried, and never counted as sent', async () => {
  failNext = 1;
  at('2026-10-28', '19:00'); await reminders.runDue();
  let st = (await fam.parent.get('/api/parent/settings')).body;
  assert.equal(st.failures.length, 1); assert.match(st.failures[0].error, /unreachable/);
  assert.equal(sent.length, 0);
  assert.ok((await fam.parent.get('/api/notifications')).body.items.some((n) => n.kind === 'email_failed'));
  assert.ok((await fam.parent.get('/api/parent/overview')).body.todo.some((t) => t.code === 'email_failed'));
  at('2026-10-28', '19:05'); await reminders.runDue(); assert.equal(sent.length, 0, 'retry only after 10 minutes');
  at('2026-10-28', '19:12'); await reminders.runDue();
  assert.equal(sent.length, 1, 'retried and delivered'); st = (await fam.parent.get('/api/parent/settings')).body;
  assert.equal(st.failures.length, 0);
  // gives up after 3 attempts
  failNext = 99; dbm.run('DELETE FROM reminder_log');
  for (const m of ['20:30', '20:41', '20:52', '21:03', '21:14']) { at('2026-10-28', m); await reminders.runDue(); }
  assert.ok(dbm.all("SELECT attempts FROM reminder_log WHERE status = 'failed'").every((r) => r.attempts <= 3));
});

test('in-app notifications are created once per day, with no email needed', async () => {
  mailer.setTransportForTests(null);                    // email not connected
  at('2026-10-28', '19:00'); await reminders.runDue(); await reminders.runDue();
  const n = (await fam.ben.get('/api/notifications')).body.items.filter((i) => i.kind === 'daily_plan');
  assert.equal(n.length, 1);
  const log = dbm.all('SELECT status, error FROM reminder_log');
  assert.ok(log.every((l) => l.status === 'skipped' && l.error === 'not_configured'), 'recorded honestly as not sent');
  const st = (await fam.parent.get('/api/parent/settings')).body;
  assert.equal(st.email_status.configured, false);
  assert.ok((await fam.parent.get('/api/parent/overview')).body.todo.some((t) => t.code === 'email'));
  // once email is connected later the same day, the skipped reminders are delivered
  mailer.setTransportForTests(async (m) => { sent.push(m); return {}; });
  at('2026-10-28', '19:30'); await reminders.runDue();
  assert.equal(sent.filter((m) => /plan/i.test(m.subject)).length, 1);
});

test('the test-email button reports the true outcome', async () => {
  const ok = await fam.parent.post('/api/parent/settings/test-email', { to: 'me@example.com' });
  assert.equal(ok.body.ok, true); assert.equal(sent.at(-1).to, 'me@example.com');
  failNext = 1;
  const bad = await fam.parent.post('/api/parent/settings/test-email', {});
  assert.equal(bad.body.ok, false); assert.match(bad.body.error, /unreachable/);
  mailer.setTransportForTests(null);
  const none = await fam.parent.post('/api/parent/settings/test-email', {});
  assert.equal(none.body.ok, false); assert.match(none.body.error, /not connected/i);
  assert.equal((await fam.ben.post('/api/parent/settings/test-email', {})).status, 403);
});

test('the built-in SMTP client talks to a mail server correctly (local fake server)', async () => {
  mailer.setTransportForTests(null);
  const log = []; let data = '';
  const server = net.createServer((sock) => {
    sock.setEncoding('utf8'); sock.write('220 fake ESMTP\r\n'); let inData = false, buf = '';
    sock.on('data', (d) => {
      buf += d;
      while (true) {
        if (inData) { const i = buf.indexOf('\r\n.\r\n'); if (i < 0) return; data = buf.slice(0, i); buf = buf.slice(i + 5); inData = false; sock.write('250 queued as 42\r\n'); continue; }
        const i = buf.indexOf('\r\n'); if (i < 0) return;
        const line = buf.slice(0, i); buf = buf.slice(i + 2); log.push(line);
        if (/^EHLO/.test(line)) sock.write('250-fake\r\n250 AUTH PLAIN\r\n');
        else if (/^AUTH PLAIN/.test(line)) sock.write('235 ok\r\n');
        else if (/^MAIL FROM/.test(line) || /^RCPT TO/.test(line)) sock.write('250 ok\r\n');
        else if (line === 'DATA') { sock.write('354 go\r\n'); inData = true; }
        else if (line === 'QUIT') { sock.end('221 bye\r\n'); }
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(server.address().port), SMTP_SECURE: 'none', SMTP_USER: 'u@example.com', SMTP_PASS: 'secret', MAIL_FROM: 'Planner <u@example.com>' });
  try {
    const r = await mailer.send({ to: 'parent@example.com', subject: 'Plan for Ben – Thứ Tư', text: 'Hello\n.dot line\nLine 3', html: '<p>Hello</p>' });
    assert.equal(r.real, true); assert.equal(r.provider, 'smtp');
    assert.ok(log.some((l) => l === 'MAIL FROM:<u@example.com>')); assert.ok(log.some((l) => l === 'RCPT TO:<parent@example.com>'));
    assert.match(data, /^From: Planner <u@example.com>/m); assert.match(data, /Subject: =\?UTF-8\?B\?/);
    const text = Buffer.from(data.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, ''), 'base64').toString();
    assert.equal(text, 'Hello\n.dot line\nLine 3');
    // wrong login is reported as a failure, not as success
    server.removeAllListeners('connection');
    const bad = net.createServer((s) => { s.write('220 x\r\n'); s.on('data', (d) => { const t = String(d); if (/EHLO/.test(t)) s.write('250 ok\r\n'); else if (/AUTH/.test(t)) s.write('535 5.7.8 Username and Password not accepted\r\n'); }); });
    await new Promise((r2) => bad.listen(0, '127.0.0.1', r2));
    process.env.SMTP_PORT = String(bad.address().port);
    await assert.rejects(() => mailer.send({ to: 'a@b.cc', subject: 's', text: 't' }), /not accepted/);
    bad.close();
  } finally {
    for (const k of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM']) delete process.env[k];
    server.close();
  }
});

test('reminder content is escaped (no HTML injection through task titles)', async () => {
  await addTask(fam.parent, { title: '<img src=x onerror=alert(1)>', est_minutes: 30, deadline: '2026-10-28T21:30', target: '2026-10-28T21:00' });
  await scheduleWeek(fam.parent, ['ben']);
  const c = reminders.previewContent('daily_plan', 'ben', '2026-10-28');
  assert.ok(!c.html.includes('<img'));
});
