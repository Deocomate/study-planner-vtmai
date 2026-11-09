// SQLite storage: the whole planner state (one JSON document) + attached files + admin auth.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function openStore(dataDir, defaultUser = 'thanhmai', defaultPassword = 'thanhmai1') {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'study_planner.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      json TEXT NOT NULL,
      rev INTEGER NOT NULL,
      epoch TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      size INTEGER NOT NULL,
      data BLOB NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_auth (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);
  const now = () => new Date().toISOString();
  const newId = () => randomBytes(16).toString('hex');
  const hashPassword = (password, salt) => scryptSync(String(password), String(salt), 32).toString('hex');

  const q = {
    getState: db.prepare('SELECT json, rev, epoch, updated_at FROM app_state WHERE id = 1'),
    upsertState: db.prepare(`INSERT INTO app_state (id, json, rev, epoch, updated_at) VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET json = excluded.json, rev = excluded.rev, epoch = excluded.epoch, updated_at = excluded.updated_at`),
    getFile: db.prepare('SELECT id, name, type, size, data, created_at FROM files WHERE id = ?'),
    listFiles: db.prepare('SELECT id, name, type, size, created_at FROM files ORDER BY created_at'),
    addFile: db.prepare('INSERT INTO files (id, name, type, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    delFile: db.prepare('DELETE FROM files WHERE id = ?'),
    delAllFiles: db.prepare('DELETE FROM files'),
    stats: db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM files'),
    getAdmin: db.prepare('SELECT username, password_hash, salt, updated_at FROM admin_auth WHERE id = 1'),
    upsertAdmin: db.prepare(`INSERT INTO admin_auth (id, username, password_hash, salt, updated_at) VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash, salt = excluded.salt, updated_at = excluded.updated_at`),
    getSession: db.prepare('SELECT token, created_at, expires_at FROM sessions WHERE token = ?'),
    addSession: db.prepare('INSERT INTO sessions (token, created_at, expires_at) VALUES (?, ?, ?)'),
    delSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
    cleanSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
  };
  const tx = (fn) => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  const meta = () => { const r = q.getState.get(); return r ? { rev: r.rev, epoch: r.epoch, updatedAt: r.updated_at } : { rev: 0, epoch: '', updatedAt: null }; };

  // Initialize admin auth if not present
  const initAuth = (user, pass) => {
    const row = q.getAdmin.get();
    if (!row) {
      const salt = randomBytes(16).toString('hex');
      const hash = hashPassword(pass || 'thanhmai1', salt);
      q.upsertAdmin.run(String(user || 'thanhmai').trim(), hash, salt, now());
    }
  };
  initAuth(defaultUser, defaultPassword);

  return {
    meta,
    getState() {
      const r = q.getState.get();
      return r ? { state: JSON.parse(r.json), rev: r.rev, epoch: r.epoch, updatedAt: r.updated_at } : { state: null, rev: 0, epoch: '', updatedAt: null };
    },
    // Saves the state. A different epoch means the data was replaced by an import
    // after this client loaded it: refuse, so stale tabs cannot undo the import.
    putState(state, epoch) {
      return tx(() => {
        const cur = meta();
        if (cur.epoch && epoch !== undefined && epoch !== cur.epoch) return { conflict: true, ...this.getState() };
        const next = { rev: cur.rev + 1, epoch: cur.epoch || newId(), updatedAt: now() };
        q.upsertState.run(JSON.stringify(state), next.rev, next.epoch, next.updatedAt);
        return next;
      });
    },
    addFile({ name, type, data }) {
      const f = { id: newId(), name: name || 'file', type: type || 'application/octet-stream', size: data.length, created_at: now() };
      q.addFile.run(f.id, f.name, f.type, f.size, data, f.created_at);
      return { id: f.id, name: f.name, type: f.type, size: f.size };
    },
    getFile: (id) => q.getFile.get(id),
    listFiles: () => q.listFiles.all(),
    deleteFile: (id) => q.delFile.run(id).changes > 0,
    stats() { const s = q.stats.get(); const m = meta(); const st = this.getState().state; return { ...m, tasks: st && Array.isArray(st.tasks) ? st.tasks.length : 0, files: s.n, fileBytes: s.bytes }; },
    // Replaces everything (used by import). New epoch so open tabs reload instead of overwriting.
    replaceAll(state, files) {
      return tx(() => {
        const cur = meta();
        q.delAllFiles.run();
        for (const f of files) q.addFile.run(f.id, f.name, f.type, f.data.length, f.data, f.created_at || now());
        const next = { rev: cur.rev + 1, epoch: newId(), updatedAt: now() };
        q.upsertState.run(JSON.stringify(state), next.rev, next.epoch, next.updatedAt);
        return next;
      });
    },
    // Admin auth methods
    getAdminUser() {
      const r = q.getAdmin.get();
      return r ? { username: r.username, updatedAt: r.updated_at } : { username: 'thanhmai', updatedAt: null };
    },
    verifyAdminPassword(password, username = null) {
      if (!password) return false;
      const r = q.getAdmin.get();
      if (!r) return false;
      if (username !== null && username !== undefined && String(username).trim() !== '') {
        if (r.username.toLowerCase() !== String(username).toLowerCase().trim()) return false;
      }
      const calc = hashPassword(password, r.salt);
      try {
        return timingSafeEqual(Buffer.from(calc, 'hex'), Buffer.from(r.password_hash, 'hex'));
      } catch (e) {
        return false;
      }
    },
    updateAdminCredentials(newUsername, newPassword) {
      const salt = randomBytes(16).toString('hex');
      const hash = hashPassword(newPassword, salt);
      const user = String(newUsername || 'thanhmai').trim();
      const t = now();
      q.upsertAdmin.run(user, hash, salt, t);
      return { username: user, updatedAt: t };
    },
    createSession() {
      const token = randomBytes(32).toString('hex');
      const created = now();
      const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      q.addSession.run(token, created, expires);
      return token;
    },
    verifySession(token) {
      if (!token || typeof token !== 'string') return false;
      const s = q.getSession.get(token);
      if (!s) return false;
      if (new Date(s.expires_at).getTime() < Date.now()) {
        q.delSession.run(token);
        return false;
      }
      return true;
    },
    deleteSession(token) {
      if (!token) return;
      q.delSession.run(token);
    },
    close: () => db.close(),
  };
}
