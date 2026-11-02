'use strict';
// Email sending without third-party packages. Providers (first one configured wins):
//   1. Resend HTTP API  : RESEND_API_KEY + MAIL_FROM
//   2. SMTP (e.g. Gmail): SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS + MAIL_FROM
//   3. Dev outbox       : EMAIL_DEV_OUTBOX=1 writes .eml files to data/outbox (NOT a real send)
const net = require('node:net');
const tls = require('node:tls');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DATA_DIR } = require('./db');

let testTransport = null;
const setTransportForTests = (fn) => { testTransport = fn; };

function provider() {
  if (testTransport) return 'test';
  if (process.env.RESEND_API_KEY && process.env.MAIL_FROM) return 'resend';
  if (process.env.SMTP_HOST && process.env.MAIL_FROM) return 'smtp';
  if (process.env.EMAIL_DEV_OUTBOX === '1') return 'outbox';
  return 'none';
}
function status() {
  const p = provider();
  return { provider: p, configured: p !== 'none', real: p === 'resend' || p === 'smtp' || p === 'test', from: process.env.MAIL_FROM || null,
    note: p === 'none' ? 'Email is not connected. Reminders are shown inside the website only.' : p === 'outbox' ? 'Developer outbox: emails are written to files and are NOT really sent.' : null };
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const wrap = (s) => s.replace(/.{1,76}/g, '$&\r\n').trimEnd();
const encHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
function buildMime({ from, to, subject, text, html }) {
  const boundary = `b_${crypto.randomBytes(12).toString('hex')}`;
  const fromAddr = from.match(/<([^>]+)>/) ? from : from;
  return [
    `From: ${fromAddr}`, `To: ${to}`, `Subject: ${encHeader(subject)}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomBytes(12).toString('hex')}@family-planner>`, 'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(b64(text)),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(b64(html || `<pre>${text}</pre>`)),
    `--${boundary}--`, '',
  ].join('\r\n');
}
const bareAddress = (s) => (s.match(/<([^>]+)>/) || [null, s])[1].trim();

// ---------- minimal SMTP client ----------
function smtpSend({ host, port, user, pass, secure, from, to, mime }) {
  return new Promise((resolve, reject) => {
    let socket, buf = '', waiter = null, done = false;
    const fail = (e) => { if (done) return; done = true; try { socket && socket.destroy(); } catch {} reject(e instanceof Error ? e : new Error(String(e))); };
    const timer = setTimeout(() => fail(new Error('The mail server did not answer in time.')), 30000);
    const attach = (s) => {
      socket = s; s.setEncoding('utf8');
      s.on('data', (d) => { buf += d; pump(); });
      s.on('error', fail);
      s.on('close', () => { if (!done) fail(new Error('The mail server closed the connection.')); });
    };
    function pump() {
      const lines = buf.split('\r\n');
      // a full reply ends with a line like "250 text" (code + space)
      let last = -1;
      for (let i = 0; i < lines.length - 1; i++) if (/^\d{3} /.test(lines[i])) { last = i; break; }
      if (last >= 0 && waiter) {
        const reply = lines.slice(0, last + 1);
        buf = lines.slice(last + 1).join('\r\n');
        const w = waiter; waiter = null; w({ code: parseInt(reply[last].slice(0, 3), 10), text: reply.join('\n') });
      }
    }
    const read = () => new Promise((res) => { waiter = res; pump(); });
    const cmd = async (line, ok) => { socket.write(line + '\r\n'); const r = await read(); if (!ok.includes(r.code)) throw new Error(`Mail server said: ${r.text.split('\n').pop()}`); return r; };
    (async () => {
      const connect = secure === 'tls' ? (cb) => tls.connect({ host, port }, cb) : (cb) => net.connect({ host, port }, cb);
      await new Promise((res, rej) => { const s = connect(res); s.once('error', rej); attach(s); });
      let r = await read(); if (r.code !== 220) throw new Error(`Mail server said: ${r.text}`);
      r = await cmd('EHLO family-planner', [250]);
      if (secure === 'starttls') {
        if (!/STARTTLS/i.test(r.text)) throw new Error('The mail server does not offer a secure (STARTTLS) connection.');
        await cmd('STARTTLS', [220]);
        await new Promise((res, rej) => { const plain = socket; plain.removeAllListeners('data'); plain.removeAllListeners('close'); plain.removeAllListeners('error'); const s = tls.connect({ socket: plain, host }, res); s.once('error', rej); attach(s); buf = ''; });
        r = await cmd('EHLO family-planner', [250]);
      }
      if (user) await cmd(`AUTH PLAIN ${b64(`\0${user}\0${pass}`)}`, [235]);
      await cmd(`MAIL FROM:<${bareAddress(from)}>`, [250]);
      await cmd(`RCPT TO:<${bareAddress(to)}>`, [250, 251]);
      await cmd('DATA', [354]);
      socket.write(mime.replace(/\r\n\./g, '\r\n..').replace(/^\./, '..') + '\r\n.\r\n');
      r = await read(); if (r.code !== 250) throw new Error(`Mail server said: ${r.text.split('\n').pop()}`);
      socket.write('QUIT\r\n'); done = true; clearTimeout(timer); socket.end(); resolve({ id: r.text.split('\n').pop() });
    })().catch((e) => { clearTimeout(timer); fail(e); });
  });
}

// Returns { ok, provider, real, id } or throws Error with a plain-language message. Never reports success without a real hand-over.
async function send({ to, subject, text, html }) {
  const p = provider();
  if (p === 'none') { const e = new Error('Email is not connected.'); e.code = 'not_configured'; throw e; }
  if (p === 'test') return { ok: true, provider: 'test', real: true, ...(await testTransport({ to, subject, text, html })) };
  const from = process.env.MAIL_FROM;
  if (p === 'outbox') {
    const dir = path.join(DATA_DIR, 'outbox'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}.eml`);
    fs.writeFileSync(file, buildMime({ from: from || 'planner@localhost', to, subject, text, html }));
    return { ok: true, provider: 'outbox', real: false, id: path.basename(file) };
  }
  if (p === 'resend') {
    const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text, html }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Resend refused the email (${res.status}): ${body.message || 'unknown reason'}`);
    return { ok: true, provider: 'resend', real: true, id: body.id };
  }
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE || (port === 465 ? 'tls' : 'starttls');     // tls | starttls | none (none is for local testing only)
  const r = await smtpSend({ host: process.env.SMTP_HOST, port, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, secure, from, to, mime: buildMime({ from, to, subject, text, html }) });
  return { ok: true, provider: 'smtp', real: true, id: r.id };
}
module.exports = { send, status, provider, setTransportForTests, buildMime };
