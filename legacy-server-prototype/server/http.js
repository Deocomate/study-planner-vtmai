'use strict';
// A very small web framework built on node:http (no third-party packages needed).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { HttpError } = require('./util');

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

class App {
  constructor() { this.routes = []; this.middleware = []; }
  use(fn) { this.middleware.push(fn); }
  route(method, pattern, ...handlers) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handlers });
  }
  get(p, ...h) { this.route('GET', p, ...h); }
  post(p, ...h) { this.route('POST', p, ...h); }
  put(p, ...h) { this.route('PUT', p, ...h); }
  patch(p, ...h) { this.route('PATCH', p, ...h); }
  delete(p, ...h) { this.route('DELETE', p, ...h); }

  decorate(req, res) {
    const u = new URL(req.url, 'http://localhost');
    req.path = u.pathname; req.query = Object.fromEntries(u.searchParams);
    req.cookies = {};
    for (const part of (req.headers.cookie || '').split(';')) { const i = part.indexOf('='); if (i > 0) req.cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
    req.ip = req.socket.remoteAddress;
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (obj) => { if (!res.headersSent) { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); } res.end(JSON.stringify(obj)); };
    res.send = (buf, type) => { if (type) res.setHeader('Content-Type', type); res.end(buf); };
    res.cookie = (name, value, o = {}) => {
      const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
      if (o.maxAge !== undefined) parts.push(`Max-Age=${o.maxAge}`);
      if (o.secure) parts.push('Secure');
      res.setHeader('Set-Cookie', parts.join('; '));
    };
  }

  async handle(req, res) {
    this.decorate(req, res);
    try {
      for (const mw of this.middleware) { await mw(req, res); if (res.writableEnded) return; }
      for (const r of this.routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(req.path);
        if (!m) continue;
        req.params = {};
        r.keys.forEach((k, i) => { req.params[k] = decodeURIComponent(m[i + 1]); });
        for (const h of r.handlers) { await h(req, res); if (res.writableEnded) return; }
        if (!res.writableEnded) res.end();
        return;
      }
      throw new HttpError(404, 'Not found.');
    } catch (e) {
      if (res.writableEnded) return;
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error('[error]', req.method, req.path, e);
      res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: status === 500 ? 'Something went wrong on the server. Please try again.' : e.message, ...(e.extra || {}) }));
    }
  }
  listen(port, host, cb) { const s = http.createServer((q, r) => this.handle(q, r)); return s.listen(port, host, cb); }
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, `The upload is too large (limit ${Math.round(limit / 1048576)} MB).`)); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req, limit = 1024 * 1024) {
  if (req.body !== undefined) return req.body;
  const buf = await readBody(req, limit);
  if (!buf.length) return (req.body = {});
  try { req.body = JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'The request was not valid JSON.'); }
  if (req.body === null || typeof req.body !== 'object') throw new HttpError(400, 'The request body must be a JSON object.');
  return req.body;
}

function serveStatic(root) {
  const base = path.resolve(root);
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return;
    if (req.path.startsWith('/api/')) return;
    let rel = decodeURIComponent(req.path);
    if (rel === '/' || !path.extname(rel)) rel = '/index.html';      // single-page app
    const file = path.resolve(path.join(base, rel));
    if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new HttpError(404, 'Not found.');
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(fs.readFileSync(file));
  };
}
module.exports = { App, readBody, readJson, serveStatic };
