'use strict';
const path = require('node:path');
const { App, serveStatic } = require('./http');
const A = require('./auth');
const { seedBase } = require('./seed');

function buildApp() {
  seedBase();
  const app = new App();
  app.use((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  });
  app.use((req) => { A.loadUser(req); });
  app.use((req) => { A.csrfGuard(req); });
  require('./routes-common').register(app);
  require('./routes-parent').register(app);
  app.use(serveStatic(path.join(__dirname, '..', 'public')));
  return app;
}
module.exports = { buildApp };
