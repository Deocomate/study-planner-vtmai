'use strict';
// Shared test harness: real server on a random port, in-memory database, controllable clock.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
process.env.NODE_ENV = 'test';
process.env.DB_PATH = process.env.DB_PATH || ':memory:';
process.env.DATA_DIR = process.env.DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'fp-test-'));
delete process.env.SETUP_CODE; delete process.env.ANTHROPIC_API_KEY; delete process.env.SMTP_HOST; delete process.env.RESEND_API_KEY; delete process.env.EMAIL_DEV_OUTBOX;

const T = require('../server/time');
const dbm = require('../server/db');
const { buildApp } = require('../server/app');

// Local time (Asia/Ho_Chi_Minh) -> clock. e.g. at('2026-10-28', '15:42')
const at = (date, hm = '12:00') => T.setClock(() => T.parseDate(date) + T.parseHM(hm) * 60000 - 7 * 3600000);

class Client {
  constructor(base) { this.base = base; this.cookie = ''; this.csrf = ''; }
  async req(method, url, body, opts = {}) {
    const headers = { cookie: this.cookie };
    if (this.csrf && !opts.noCsrf) headers['x-csrf-token'] = this.csrf;
    let payload;
    if (opts.raw) { payload = opts.raw; headers['content-type'] = 'application/octet-stream'; }
    else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const r = await fetch(this.base + url, { method, headers, body: payload });
    const sc = r.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const buf = Buffer.from(await r.arrayBuffer());
    let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch {}
    return { status: r.status, body: json, buf, headers: r.headers };
  }
  get(u) { return this.req('GET', u); }
  post(u, b) { return this.req('POST', u, b ?? {}); }
  put(u, b) { return this.req('PUT', u, b ?? {}); }
  patch(u, b) { return this.req('PATCH', u, b ?? {}); }
  del(u) { return this.req('DELETE', u); }
  async login(username, password) {
    const r = await this.req('POST', '/api/login', { username, password }, { noCsrf: true });
    if (r.status === 200) this.csrf = r.body.csrf;
    return r;
  }
}

async function start() {
  const app = buildApp();
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.close(r); server.closeAllConnections && server.closeAllConnections(); }) };
}
const PW = { parent: 'parent-pass-1', ben: 'ben-pass-1', shin: 'shin-pass-1' };
// Fresh family: wipes the database, runs first-time setup, returns logged-in clients for parent, Ben and Shin.
async function freshFamily(base, { demo = false } = {}) {
  dbm.wipeAll(); require('../server/seed').seedBase();
  const p = new Client(base);
  const s = await p.req('POST', '/api/setup', { parent_password: PW.parent, ben_password: PW.ben, shin_password: PW.shin, parent_email: 'parent@example.com', load_demo: demo }, { noCsrf: true });
  if (s.status !== 200) throw new Error('setup failed: ' + JSON.stringify(s.body));
  p.csrf = s.body.csrf;
  const ben = new Client(base), shin = new Client(base);
  await ben.login('ben', PW.ben); await shin.login('shin', PW.shin);
  return { parent: p, ben, shin };
}
// Create a task through the real API as the parent.
async function addTask(parent, item, { child = 'ben', week = '2026-10-26' } = {}) {
  const r = await parent.post('/api/parent/tasks', { child_ids: [child], week_start: week, items: [item] });
  if (r.status !== 200) throw new Error('addTask failed: ' + JSON.stringify(r.body));
  return r.body.ids[0];
}
async function scheduleWeek(parent, childIds = ['ben', 'shin'], week = '2026-10-26', mode = 'week') {
  const pv = await parent.post('/api/parent/schedule/preview', { child_ids: childIds, week_start: week, mode });
  if (pv.status !== 200) throw new Error('preview failed ' + JSON.stringify(pv.body));
  const ap = await parent.post('/api/parent/schedule/apply', { proposal_ids: pv.body.previews.map((p) => p.proposal_id) });
  if (ap.status !== 200) throw new Error('apply failed ' + JSON.stringify(ap.body));
  return pv.body.previews;
}
module.exports = { T, dbm, Client, start, freshFamily, addTask, scheduleWeek, at, PW };
