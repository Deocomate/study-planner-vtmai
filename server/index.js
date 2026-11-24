// Study Planner backend: serves the web app and stores its data in SQLite.
//   GET  /api/health              – health check (no password)
//   GET  /api/auth/status         – check current admin auth status { authenticated, user }
//   POST /api/auth/login          – login with { user, password } → { ok, token, user }
//   POST /api/auth/logout         – log out admin session
//   POST /api/auth/change-password– change admin password { currentPassword, newPassword, newUser }
//   POST /api/auth/kid            – check a child's PIN { kid, pin } → { ok } (a few wrong tries pause it)
//   POST /api/auth/kid-pin        – set a child's PIN { kid, pin } (admin)
//   GET  /api/state               – the whole planner state  { app, state, rev, epoch, updatedAt } (public)
//   GET  /api/state/rev           – only { rev, epoch } (cheap polling, public)
//   PUT  /api/state               – save { state, epoch } (POST works too, for sendBeacon)
//   POST /api/files               – upload an attached file (raw body, X-File-Name header) → { id, … }
//   GET  /_blob/:id               – download an attached file (public)
//   DELETE /api/files/:id         – delete an attached file (admin)
//   GET  /api/stats               – counts for the backup page (admin)
//   GET  /api/export              – download everything as study-planner-backup_DD-MM-YYYY_HH-mm-ss.zip (admin)
//   POST /api/import              – replace everything with an uploaded backup .zip (admin)
//   GET  /api/backups[/:name]     – automatic backups kept on the server (admin)
//   GET  /backup                  – backup & admin page
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { join, dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.js';
import { exportZip, importZip, makeBackupDir } from './backup.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const PORT = Number(env.PORT || 3000);
const HOST = env.HOST || '0.0.0.0';
const DATA_DIR = resolve(env.DATA_DIR || join(HERE, '..', 'data'));
const WEB_DIR = resolve(env.WEB_DIR || join(HERE, '..', 'web-app'));
const MB = 1048576;
const MAX_UPLOAD = Number(env.MAX_UPLOAD_MB || 20) * MB;
const MAX_IMPORT = Number(env.MAX_IMPORT_MB || 1024) * MB;
const MAX_STATE = 50 * MB;
const KEEP_BACKUPS = Number(env.KEEP_BACKUPS || 30);
const APP_USER = env.APP_USER || '';
const APP_PASSWORD = env.APP_PASSWORD || '';

const store = openStore(DATA_DIR, APP_USER || 'thanhmai', APP_PASSWORD || 'thanhmai1');
const backups = makeBackupDir(DATA_DIR);
const pinFails = new Map();   // ip -> { n: wrong PINs in a row, until: paused until (ms) }

const STATIC = {
  '/': join(WEB_DIR, 'dist', 'index.html'),
  '/index.html': join(WEB_DIR, 'dist', 'index.html'),
  '/web-app.html': join(WEB_DIR, 'dist', 'index.html'),
  '/backup': join(HERE, 'public', 'backup.html'),
  '/backup.html': join(HERE, 'public', 'backup.html'),
};
const DIRS = { '/samples/': join(WEB_DIR, 'samples'), '/screenshots/': join(WEB_DIR, 'docs', 'screenshots') };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.csv': 'text/csv; charset=utf-8', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.zip': 'application/zip' };
// Attached files are shown inline only for these types; anything else is downloaded (no HTML/SVG from uploads).
const INLINE = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const send = (res, code, body, headers = {}) => {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(code, { 'Content-Type': typeof body === 'string' || Buffer.isBuffer(body) ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Content-Length': buf.length, ...headers });
  res.end(buf);
};
const json = (res, code, obj, headers = {}) => send(res, code, obj, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const readBody = (req, limit) => new Promise((ok, fail) => {
  const len = Number(req.headers['content-length'] || 0);
  if (len > limit) { req.resume(); return fail(new HttpError(413, 'too_large')); }
  const chunks = []; let size = 0;
  req.on('data', (c) => { size += c.length; if (size > limit) { req.destroy(); fail(new HttpError(413, 'too_large')); } else chunks.push(c); });
  req.on('end', () => ok(Buffer.concat(chunks)));
  req.on('error', fail);
});
const readJson = async (req, limit) => { try { return JSON.parse((await readBody(req, limit)).toString('utf8')); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'bad_json'); } };

const extractToken = (req) => {
  const auth = req.headers.authorization || '';
  const bm = /^Bearer\s+(.+)$/i.exec(auth);
  if (bm) return bm[1].trim();

  const xToken = req.headers['x-admin-token'];
  if (xToken) return String(xToken).trim();

  const cookie = req.headers.cookie || '';
  const cm = /(?:^|;\s*)sp_session=([A-Za-z0-9_-]+)/.exec(cookie);
  if (cm) return cm[1];

  return null;
};

const authorized = (req) => {
  const token = extractToken(req);
  if (token && store.verifySession(token)) return true;

  const auth = req.headers.authorization || '';
  const bm = /^Basic\s+(.+)$/i.exec(auth);
  if (bm) {
    try {
      const raw = Buffer.from(bm[1], 'base64').toString('utf8');
      const i = raw.indexOf(':');
      if (i !== -1) {
        const user = raw.slice(0, i), pass = raw.slice(i + 1);
        return store.verifyAdminPassword(pass, user);
      }
    } catch (e) {
      return false;
    }
  }

  return false;
};

const serveFile = (req, res, path, extra = {}) => {
  if (!path || !existsSync(path) || !statSync(path).isFile()) return send(res, 404, 'Not found');
  const type = MIME[extname(path).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': statSync(path).size, 'Cache-Control': type.startsWith('text/html') ? 'no-cache' : 'public, max-age=3600', ...extra });
  if (req.method === 'HEAD') return res.end();
  createReadStream(path).pipe(res);
};
const attachment = (name) => `attachment; filename="${name.replace(/[^\w.-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const M = req.method;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');

  if (p === '/api/health') return json(res, 200, { ok: true });

  // Admin auth endpoints
  if (p === '/api/auth/status' && M === 'GET') {
    const isAuth = authorized(req);
    return json(res, 200, { authenticated: isAuth, user: isAuth ? store.getAdminUser().username : null });
  }

  if (p === '/api/auth/login' && M === 'POST') {
    const body = await readJson(req, 64 * 1024);
    const user = (body && body.user) || '';
    const pass = (body && body.password) || '';
    if (!store.verifyAdminPassword(pass, user)) {
      return json(res, 401, { ok: false, error: 'Tên đăng nhập hoặc mật khẩu không chính xác' });
    }
    const token = store.createSession();
    const admin = store.getAdminUser();
    res.setHeader('Set-Cookie', `sp_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`);
    return json(res, 200, { ok: true, token, user: admin.username });
  }

  if (p === '/api/auth/logout' && M === 'POST') {
    const token = extractToken(req);
    if (token) store.deleteSession(token);
    res.setHeader('Set-Cookie', 'sp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return json(res, 200, { ok: true });
  }

  if (p === '/api/auth/change-password' && M === 'POST') {
    if (!authorized(req)) return json(res, 401, { ok: false, error: 'Cần đăng nhập quản trị' });
    const body = await readJson(req, 64 * 1024);
    const { currentPassword, newPassword, newUser } = body || {};
    if (!store.verifyAdminPassword(currentPassword)) {
      return json(res, 400, { ok: false, error: 'Mật khẩu hiện tại không chính xác' });
    }
    if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 4) {
      return json(res, 400, { ok: false, error: 'Mật khẩu mới phải có ít nhất 4 ký tự' });
    }
    const targetUser = newUser && typeof newUser === 'string' && newUser.trim() ? newUser.trim() : store.getAdminUser().username;
    const r = store.updateAdminCredentials(targetUser, newPassword.trim());
    return json(res, 200, { ok: true, message: 'Đổi mật khẩu thành công', user: r.username });
  }

  if (p === '/api/auth/kid' && M === 'POST') {
    const ip = req.socket.remoteAddress || '';
    const f = pinFails.get(ip);
    if (f && f.until > Date.now()) return json(res, 429, { ok: false, error: 'Sai quá nhiều lần, đợi 1 phút rồi thử lại' });
    const body = await readJson(req, 4 * 1024);
    if (store.verifyKidPin(body && body.kid, String((body && body.pin) || ''))) { pinFails.delete(ip); return json(res, 200, { ok: true }); }
    const n = (f && f.until <= Date.now() && f.n >= 5 ? 0 : (f ? f.n : 0)) + 1;
    pinFails.set(ip, { n, until: n >= 5 ? Date.now() + 60 * 1000 : 0 });
    return json(res, 401, { ok: false, error: 'Sai mật khẩu' });
  }

  if (p === '/api/auth/kid-pin' && M === 'POST') {
    if (!authorized(req)) return json(res, 401, { ok: false, error: 'Cần đăng nhập quản trị' });
    const body = await readJson(req, 4 * 1024);
    const kid = body && body.kid, pin = String((body && body.pin) || '').trim();
    if (!store.isKid(kid)) return json(res, 400, { ok: false, error: 'Không rõ là bạn nào' });
    if (!/^\d{4,8}$/.test(pin)) return json(res, 400, { ok: false, error: 'Mật khẩu phải là 4 đến 8 chữ số' });
    store.setKidPin(kid, pin);
    return json(res, 200, { ok: true });
  }

  // State endpoints (public for viewing by Ben & Shin, and saving updates)
  if (p === '/api/state' && M === 'GET') return json(res, 200, { app: 'study-planner', ...store.getState() });
  if (p === '/api/state/rev' && M === 'GET') { const m = store.meta(); return json(res, 200, { rev: m.rev, epoch: m.epoch }); }
  if (p === '/api/state' && (M === 'PUT' || M === 'POST')) {
    const body = await readJson(req, MAX_STATE);
    if (!body || typeof body.state !== 'object' || body.state === null || !Array.isArray(body.state.tasks)) throw new HttpError(400, 'bad_state');
    const r = store.putState(body.state, body.epoch);
    return r.conflict ? json(res, 409, { app: 'study-planner', ...r }) : json(res, 200, r);
  }

  // File uploads and downloads
  if (p === '/api/files' && M === 'POST') {
    const data = await readBody(req, MAX_UPLOAD);
    let name = 'file'; try { name = decodeURIComponent(String(req.headers['x-file-name'] || 'file')); } catch (e) { /* keep default */ }
    const type = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    return json(res, 200, store.addFile({ name: name.slice(0, 255), type, data }));
  }
  let m;
  if ((m = /^\/(?:_blob|api\/files)\/([A-Za-z0-9_-]{1,64})$/.exec(p))) {
    if (M === 'DELETE') {
      if (!authorized(req)) return json(res, 401, { error: 'unauthorized' });
      return json(res, 200, { ok: store.deleteFile(m[1]) });
    }
    if (M !== 'GET' && M !== 'HEAD') return send(res, 405, 'Method not allowed');
    const f = store.getFile(m[1]);
    if (!f) return send(res, 404, 'Not found');
    const inline = INLINE.has(f.type);
    const data = Buffer.from(f.data);
    res.writeHead(200, { 'Content-Type': inline ? f.type : 'application/octet-stream', 'Content-Length': data.length, 'Content-Disposition': inline ? `inline; filename*=UTF-8''${encodeURIComponent(f.name)}` : attachment(f.name), 'Cache-Control': 'private, max-age=31536000, immutable' });
    return M === 'HEAD' ? res.end() : res.end(data);
  }

  // Admin-protected backup & system endpoints
  if (p === '/api/stats' && M === 'GET') {
    if (!authorized(req)) return json(res, 401, { error: 'unauthorized', message: 'Cần đăng nhập quản trị' });
    return json(res, 200, store.stats());
  }
  if (p === '/api/export' && M === 'GET') {
    if (!authorized(req)) return send(res, 401, 'Cần đăng nhập quản trị');
    const { buffer, name } = exportZip(store);
    return send(res, 200, buffer, { 'Content-Type': 'application/zip', 'Content-Disposition': attachment(name), 'Cache-Control': 'no-store' });
  }
  if (p === '/api/import' && M === 'POST') {
    if (!authorized(req)) return json(res, 401, { ok: false, error: 'Cần đăng nhập quản trị' });
    const buf = await readBody(req, MAX_IMPORT);
    let before = null;
    try { before = backups.save(store, 'before-import', KEEP_BACKUPS); } catch (e) { console.error('backup before import failed', e); }
    try { return json(res, 200, { ok: true, backupBefore: before, ...importZip(store, buf) }); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  if (p === '/api/backups' && M === 'GET') {
    if (!authorized(req)) return json(res, 401, { error: 'unauthorized', message: 'Cần đăng nhập quản trị' });
    return json(res, 200, backups.list());
  }
  if ((m = /^\/api\/backups\/([\w.-]+\.zip)$/.exec(p)) && M === 'GET') {
    if (!authorized(req)) return send(res, 401, 'Cần đăng nhập quản trị');
    const f = backups.path(m[1]);
    return f ? serveFile(req, res, f, { 'Content-Disposition': attachment(m[1]), 'Cache-Control': 'no-store' }) : send(res, 404, 'Not found');
  }

  // Static pages and assets
  if (M !== 'GET' && M !== 'HEAD') return send(res, 404, 'Not found');
  if (STATIC[p]) return serveFile(req, res, STATIC[p]);
  for (const [prefix, dir] of Object.entries(DIRS)) {
    if (p.startsWith(prefix)) {
      const f = resolve(dir, decodeURIComponent(p.slice(prefix.length)));
      return f.startsWith(dir + sep) ? serveFile(req, res, f) : send(res, 404, 'Not found');
    }
  }
  return send(res, 404, 'Not found');
}

// One automatic backup per day (kept in DATA_DIR/backups).
const dailyBackup = () => {
  try {
    const d = new Date(); const pad = (n) => String(n).padStart(2, '0');
    const today = `auto-backup_${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}_`;
    if (!backups.list().some((f) => f.name.startsWith(today))) backups.save(store, 'auto-backup', KEEP_BACKUPS);
  } catch (e) { console.error('daily backup failed', e); }
};

const server = createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (e instanceof HttpError) return json(res, e.code, { error: e.message });
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: 'server_error' }); else res.end();
  });
});
server.requestTimeout = 10 * 60 * 1000;
server.listen(PORT, HOST, () => {
  console.log(`Study Planner on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  data: ${DATA_DIR}`);
  if (!existsSync(STATIC['/'])) console.warn(`Missing ${STATIC['/']} – build the web app first (node web-app/build.mjs).`);
});
setTimeout(dailyBackup, 60 * 1000).unref();
setInterval(dailyBackup, 60 * 60 * 1000).unref();
const stop = () => { server.close(); try { store.close(); } catch (e) { /* ignore */ } process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
