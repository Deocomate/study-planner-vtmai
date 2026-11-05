// Study Planner backend: serves the web app and stores its data in SQLite.
//   GET  /api/health              – health check (no password)
//   GET  /api/state               – the whole planner state  { app, state, rev, epoch, updatedAt }
//   GET  /api/state/rev           – only { rev, epoch } (cheap polling)
//   PUT  /api/state               – save { state, epoch }   (POST works too, for sendBeacon)
//   POST /api/files               – upload an attached file (raw body, X-File-Name header) → { id, … }
//   GET  /_blob/:id               – download an attached file
//   DELETE /api/files/:id         – delete an attached file
//   GET  /api/stats               – counts for the backup page
//   GET  /api/export              – download everything as study-planner-backup_DD-MM-YYYY_HH-mm-ss.zip
//   POST /api/import              – replace everything with an uploaded backup .zip
//   GET  /api/backups[/:name]     – automatic backups kept on the server
//   GET  /backup                  – backup page (export / import)
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { join, dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual, createHash } from 'node:crypto';
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

const store = openStore(DATA_DIR);
const backups = makeBackupDir(DATA_DIR);

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
const json = (res, code, obj) => send(res, code, obj, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });

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

const sha = (s) => createHash('sha256').update(String(s)).digest();
const authorized = (req) => {
  if (!APP_PASSWORD) return true;
  const m = /^Basic (.+)$/i.exec(req.headers.authorization || '');
  if (!m) return false;
  const raw = Buffer.from(m[1], 'base64').toString('utf8'); const i = raw.indexOf(':');
  const user = raw.slice(0, i), pass = raw.slice(i + 1);
  const okPass = timingSafeEqual(sha(pass), sha(APP_PASSWORD));
  const okUser = !APP_USER || timingSafeEqual(sha(user), sha(APP_USER));
  return okPass && okUser;
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
  if (!authorized(req)) return send(res, 401, 'Cần đăng nhập / Login required', { 'WWW-Authenticate': 'Basic realm="Study Planner", charset="UTF-8"' });

  if (p === '/api/state' && M === 'GET') return json(res, 200, { app: 'study-planner', ...store.getState() });
  if (p === '/api/state/rev' && M === 'GET') { const m = store.meta(); return json(res, 200, { rev: m.rev, epoch: m.epoch }); }
  if (p === '/api/state' && (M === 'PUT' || M === 'POST')) {
    const body = await readJson(req, MAX_STATE);
    if (!body || typeof body.state !== 'object' || body.state === null || !Array.isArray(body.state.tasks)) throw new HttpError(400, 'bad_state');
    const r = store.putState(body.state, body.epoch);
    return r.conflict ? json(res, 409, { app: 'study-planner', ...r }) : json(res, 200, r);
  }

  if (p === '/api/files' && M === 'POST') {
    const data = await readBody(req, MAX_UPLOAD);
    let name = 'file'; try { name = decodeURIComponent(String(req.headers['x-file-name'] || 'file')); } catch (e) { /* keep default */ }
    const type = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    return json(res, 200, store.addFile({ name: name.slice(0, 255), type, data }));
  }
  let m;
  if ((m = /^\/(?:_blob|api\/files)\/([A-Za-z0-9_-]{1,64})$/.exec(p))) {
    if (M === 'DELETE') return json(res, 200, { ok: store.deleteFile(m[1]) });
    if (M !== 'GET' && M !== 'HEAD') return send(res, 405, 'Method not allowed');
    const f = store.getFile(m[1]);
    if (!f) return send(res, 404, 'Not found');
    const inline = INLINE.has(f.type);
    const data = Buffer.from(f.data);
    res.writeHead(200, { 'Content-Type': inline ? f.type : 'application/octet-stream', 'Content-Length': data.length, 'Content-Disposition': inline ? `inline; filename*=UTF-8''${encodeURIComponent(f.name)}` : attachment(f.name), 'Cache-Control': 'private, max-age=31536000, immutable' });
    return M === 'HEAD' ? res.end() : res.end(data);
  }

  if (p === '/api/stats' && M === 'GET') return json(res, 200, store.stats());
  if (p === '/api/export' && M === 'GET') {
    const { buffer, name } = exportZip(store);
    return send(res, 200, buffer, { 'Content-Type': 'application/zip', 'Content-Disposition': attachment(name), 'Cache-Control': 'no-store' });
  }
  if (p === '/api/import' && M === 'POST') {
    const buf = await readBody(req, MAX_IMPORT);
    let before = null;
    try { before = backups.save(store, 'before-import', KEEP_BACKUPS); } catch (e) { console.error('backup before import failed', e); }
    try { return json(res, 200, { ok: true, backupBefore: before, ...importZip(store, buf) }); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  if (p === '/api/backups' && M === 'GET') return json(res, 200, backups.list());
  if ((m = /^\/api\/backups\/([\w.-]+\.zip)$/.exec(p)) && M === 'GET') {
    const f = backups.path(m[1]);
    return f ? serveFile(req, res, f, { 'Content-Disposition': attachment(m[1]), 'Cache-Control': 'no-store' }) : send(res, 404, 'Not found');
  }

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
  console.log(`Study Planner on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  data: ${DATA_DIR}${APP_PASSWORD ? '  (password on)' : ''}`);
  if (!existsSync(STATIC['/'])) console.warn(`Missing ${STATIC['/']} – build the web app first (node web-app/build.mjs).`);
});
setTimeout(dailyBackup, 60 * 1000).unref();
setInterval(dailyBackup, 60 * 60 * 1000).unref();
const stop = () => { server.close(); try { store.close(); } catch (e) { /* ignore */ } process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
