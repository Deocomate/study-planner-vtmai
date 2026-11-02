'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'planner.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const cache = new Map();
const prep = (sql) => { let s = cache.get(sql); if (!s) { s = db.prepare(sql); cache.set(sql, s); } return s; };
const clean = (p) => p.map((x) => (x === undefined ? null : typeof x === 'boolean' ? (x ? 1 : 0) : x));
const get = (sql, ...p) => prep(sql).get(...clean(p)) || null;
const all = (sql, ...p) => prep(sql).all(...clean(p));
const run = (sql, ...p) => prep(sql).run(...clean(p));

let depth = 0;
// Run fn inside a transaction (re-entrant). Everything inside commits together or not at all.
function tx(fn) {
  if (depth > 0) return fn();
  db.exec('BEGIN IMMEDIATE'); depth = 1;
  try { const r = fn(); db.exec('COMMIT'); depth = 0; return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch {} depth = 0; throw e; }
}

function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const dir = path.join(__dirname, '..', 'migrations');
  const done = new Set(all('SELECT version FROM schema_migrations').map((r) => r.version));
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    tx(() => { db.exec(sql); run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', f, new Date().toISOString()); });
  }
}
migrate();

const uid = () => crypto.randomUUID();
// Test helper: empty every table (never used by the running app).
function wipeAll() {
  if (process.env.NODE_ENV !== 'test') throw new Error('wipeAll is only available in tests');
  for (const t of ['schedule_proposals', 'monthly_resets', 'monthly_reports', 'reminder_log', 'notifications', 'help_requests', 'reviews', 'submissions',
    'sessions', 'tasks', 'files', 'templates', 'task_defaults', 'fixed_blocks', 'child_settings', 'auth_sessions', 'users', 'children', 'settings']) {
    db.exec(`DELETE FROM ${t}`);
  }
}
module.exports = { db, get, all, run, tx, uid, DATA_DIR, UPLOAD_DIR: path.join(DATA_DIR, 'uploads'), wipeAll };
