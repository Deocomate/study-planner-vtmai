import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../store.js';

// Helper to make HTTP requests
const request = (port, path, opt = {}) => new Promise((resolve, reject) => {
  const headers = opt.headers || {};
  const req = http.request({
    hostname: '127.0.0.1',
    port,
    path,
    method: opt.method || 'GET',
    headers,
  }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      let json = null;
      try { json = JSON.parse(body); } catch (e) {}
      resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body,
        json,
      });
    });
  });
  req.on('error', reject);
  if (opt.body) req.write(typeof opt.body === 'string' ? opt.body : JSON.stringify(opt.body));
  req.end();
});

test('HTTP API auth, public access, login, change password, and logout', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-server-'));
  const webDir = join(dir, 'web-app');
  mkdirSync(join(webDir, 'dist'), { recursive: true });
  writeFileSync(join(webDir, 'dist', 'index.html'), '<html><body>Study Planner</body></html>');

  // Set environment variables for this test
  const defaultUser = 'thanhmai';
  const defaultPass = 'thanhmai1';

  // Dynamically start server with custom DATA_DIR and WEB_DIR
  process.env.DATA_DIR = join(dir, 'data');
  process.env.WEB_DIR = webDir;
  process.env.APP_USER = defaultUser;
  process.env.APP_PASSWORD = defaultPass;
  process.env.PORT = '0'; // pick random available port

  const store = openStore(process.env.DATA_DIR, defaultUser, defaultPass);

  // Simple test server reproducing handle() logic or importing server
  const { makeBackupDir, exportZip, importZip } = await import('../backup.js');
  const backups = makeBackupDir(process.env.DATA_DIR);

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

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const M = req.method;

    const send = (code, body, headers = {}) => {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': buf.length, ...headers });
      res.end(buf);
    };

    const readJson = () => new Promise((ok, fail) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { fail(e); }
      });
    });

    if (p === '/api/health') return send(200, { ok: true });
    if (p === '/api/auth/status') {
      const isAuth = authorized(req);
      return send(200, { authenticated: isAuth, user: isAuth ? store.getAdminUser().username : null });
    }
    if (p === '/api/auth/login' && M === 'POST') {
      const body = await readJson();
      if (!store.verifyAdminPassword(body.password, body.user)) {
        return send(401, { ok: false, error: 'Tên đăng nhập hoặc mật khẩu không chính xác' });
      }
      const token = store.createSession();
      res.setHeader('Set-Cookie', `sp_session=${token}; Path=/; HttpOnly`);
      return send(200, { ok: true, token, user: store.getAdminUser().username });
    }
    if (p === '/api/auth/logout' && M === 'POST') {
      const token = extractToken(req);
      if (token) store.deleteSession(token);
      res.setHeader('Set-Cookie', `sp_session=; Path=/; Max-Age=0`);
      return send(200, { ok: true });
    }
    if (p === '/api/auth/change-password' && M === 'POST') {
      if (!authorized(req)) return send(401, { ok: false, error: 'Cần đăng nhập quản trị' });
      const body = await readJson();
      if (!store.verifyAdminPassword(body.currentPassword)) {
        return send(400, { ok: false, error: 'Mật khẩu hiện tại không chính xác' });
      }
      if (!body.newPassword || body.newPassword.length < 4) {
        return send(400, { ok: false, error: 'Mật khẩu mới phải có ít nhất 4 ký tự' });
      }
      const r = store.updateAdminCredentials(body.newUser || store.getAdminUser().username, body.newPassword);
      return send(200, { ok: true, message: 'Đổi mật khẩu thành công', user: r.username });
    }
    if (p === '/api/state' && M === 'GET') {
      return send(200, { app: 'study-planner', ...store.getState() });
    }
    if (p === '/api/stats' && M === 'GET') {
      if (!authorized(req)) return send(401, { error: 'unauthorized' });
      return send(200, store.stats());
    }
    send(404, 'Not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    // 1. Ben and Shin view without login:
    const health = await request(port, '/api/health');
    assert.equal(health.statusCode, 200);

    const state = await request(port, '/api/state');
    assert.equal(state.statusCode, 200);
    assert.equal(state.json.app, 'study-planner');

    const statusUnauth = await request(port, '/api/auth/status');
    assert.equal(statusUnauth.statusCode, 200);
    assert.equal(statusUnauth.json.authenticated, false);

    // 2. Protected endpoint blocked for unauthenticated:
    const statsUnauth = await request(port, '/api/stats');
    assert.equal(statsUnauth.statusCode, 401);

    // 3. Login with wrong password:
    const wrongLogin = await request(port, '/api/auth/login', {
      method: 'POST',
      body: { user: 'thanhmai', password: 'wrongpassword' },
    });
    assert.equal(wrongLogin.statusCode, 401);
    assert.equal(wrongLogin.json.ok, false);

    // 4. Login with correct credentials:
    const loginOk = await request(port, '/api/auth/login', {
      method: 'POST',
      body: { user: 'thanhmai', password: 'thanhmai1' },
    });
    assert.equal(loginOk.statusCode, 200);
    assert.equal(loginOk.json.ok, true);
    assert.equal(loginOk.json.user, 'thanhmai');
    const token = loginOk.json.token;
    assert.ok(token);

    // 5. Check auth status with token:
    const statusAuth = await request(port, '/api/auth/status', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(statusAuth.statusCode, 200);
    assert.equal(statusAuth.json.authenticated, true);
    assert.equal(statusAuth.json.user, 'thanhmai');

    // 6. Access protected stats with token:
    const statsAuth = await request(port, '/api/stats', {
      headers: { 'X-Admin-Token': token },
    });
    assert.equal(statsAuth.statusCode, 200);

    // 7. Change password:
    const changeFail = await request(port, '/api/auth/change-password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { currentPassword: 'wrong', newPassword: 'newPassword123' },
    });
    assert.equal(changeFail.statusCode, 400);

    const changeOk = await request(port, '/api/auth/change-password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { currentPassword: 'thanhmai1', newPassword: 'newPassword123', newUser: 'thanhmai' },
    });
    assert.equal(changeOk.statusCode, 200);
    assert.equal(changeOk.json.ok, true);

    // 8. Old password no longer works:
    const oldLogin = await request(port, '/api/auth/login', {
      method: 'POST',
      body: { user: 'thanhmai', password: 'thanhmai1' },
    });
    assert.equal(oldLogin.statusCode, 401);

    // 9. New password works:
    const newLogin = await request(port, '/api/auth/login', {
      method: 'POST',
      body: { user: 'thanhmai', password: 'newPassword123' },
    });
    assert.equal(newLogin.statusCode, 200);
    assert.equal(newLogin.json.ok, true);
    const newToken = newLogin.json.token;

    // 10. Logout:
    const logout = await request(port, '/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${newToken}` },
    });
    assert.equal(logout.statusCode, 200);

    // Token is now revoked:
    const statsRevoked = await request(port, '/api/stats', {
      headers: { Authorization: `Bearer ${newToken}` },
    });
    assert.equal(statsRevoked.statusCode, 401);
  } finally {
    server.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
