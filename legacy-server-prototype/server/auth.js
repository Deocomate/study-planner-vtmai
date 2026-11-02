'use strict';
const crypto = require('node:crypto');
const { get, run, all, tx } = require('./db');
const T = require('./time');
const { HttpError, bad, forbidden, str } = require('./util');
const { readJson } = require('./http');

const SESSION_DAYS = 14;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}
function checkPasswordRules(role, pw) {
  const min = role === 'parent' ? 8 : 6;
  if (typeof pw !== 'string' || pw.length < min) throw bad(`The ${role === 'parent' ? 'password' : 'PIN/password'} must be at least ${min} characters.`);
  if (pw.length > 200) throw bad('That password is too long.');
}

// --- login throttling: 5 wrong attempts => 15-minute pause (per username + address). Kept in memory. ---
const attempts = new Map();
function throttleKey(req, username) { return `${req.ip}|${String(username).toLowerCase()}`; }
function checkThrottle(key) {
  const a = attempts.get(key);
  if (a && a.until && a.until > T.nowMs()) throw new HttpError(429, 'Too many wrong attempts. Please wait 15 minutes and try again.');
}
function recordFailure(key) {
  const a = attempts.get(key) || { n: 0 };
  a.n += 1; if (a.n >= 5) { a.until = T.nowMs() + 15 * 60000; a.n = 0; }
  attempts.set(key, a);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const now = T.nowMs();
  run('INSERT INTO auth_sessions (token_hash, user_id, csrf, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    sha(token), userId, csrf, new Date(now).toISOString(), new Date(now + SESSION_DAYS * 86400000).toISOString());
  return { token, csrf };
}

// Middleware: attach req.user (id, role, child_id, display_name) and req.csrf if the cookie is valid.
function loadUser(req) {
  const token = req.cookies.sid;
  if (!token) return;
  const row = get(`SELECT s.csrf, s.expires_at, u.id, u.username, u.role, u.child_id, u.display_name, u.email
                   FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, sha(token));
  if (!row) return;
  if (new Date(row.expires_at).getTime() < T.nowMs()) { run('DELETE FROM auth_sessions WHERE token_hash = ?', sha(token)); return; }
  req.user = { id: row.id, username: row.username, role: row.role, child_id: row.child_id, display_name: row.display_name, email: row.email };
  req.csrf = row.csrf; req.sessionHash = sha(token);
}
// Every change (POST/PUT/PATCH/DELETE) must carry the session's CSRF token.
function csrfGuard(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || !req.path.startsWith('/api/')) return;
  if (req.path === '/api/login' || req.path === '/api/setup') return;
  if (!req.user) return;
  if (req.headers['x-csrf-token'] !== req.csrf) throw forbidden('Your session has expired. Please reload the page and sign in again.');
}
const requireLogin = (req) => { if (!req.user) throw new HttpError(401, 'Please sign in.'); };
const requireParent = (req) => { requireLogin(req); if (req.user.role !== 'parent') throw forbidden('Only a parent can do this.'); };

// Resolve which child's data the caller may access. Children can only ever reach their own.
function childScope(req, childId) {
  requireLogin(req);
  if (!get('SELECT 1 AS x FROM children WHERE id = ?', childId)) throw new HttpError(404, 'Unknown child.');
  if (req.user.role === 'child' && req.user.child_id !== childId) throw forbidden('You can only open your own board.');
  return childId;
}
function taskAccess(req, taskId) {
  requireLogin(req);
  const t = get('SELECT * FROM tasks WHERE id = ?', taskId);
  if (!t) throw new HttpError(404, 'Task not found.');
  if (req.user.role === 'child' && t.child_id !== req.user.child_id) throw forbidden('This task belongs to someone else.');
  return t;
}

async function login(req, res, secure) {
  const b = await readJson(req);
  const username = str(b.username, { required: true, name: 'Username', max: 60 });
  const password = str(b.password, { required: true, name: 'Password', max: 200 });
  const key = throttleKey(req, username);
  checkThrottle(key);
  const u = get('SELECT * FROM users WHERE username = ?', username);
  if (!u || !verifyPassword(password, u.password_hash)) { recordFailure(key); throw new HttpError(401, 'That name or password is not right.'); }
  attempts.delete(key);
  const s = createSession(u.id);
  res.cookie('sid', s.token, { maxAge: SESSION_DAYS * 86400, secure });
  return { csrf: s.csrf, user: { id: u.id, username: u.username, role: u.role, child_id: u.child_id, display_name: u.display_name } };
}
function logout(req, res) {
  if (req.sessionHash) run('DELETE FROM auth_sessions WHERE token_hash = ?', req.sessionHash);
  res.cookie('sid', '', { maxAge: 0 });
}
function setPassword(userId, role, pw) {
  checkPasswordRules(role, pw);
  tx(() => { run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(pw), userId); run('DELETE FROM auth_sessions WHERE user_id = ?', userId); });
}
module.exports = { hashPassword, verifyPassword, checkPasswordRules, createSession, loadUser, csrfGuard, requireLogin, requireParent, childScope, taskAccess, login, logout, setPassword };
