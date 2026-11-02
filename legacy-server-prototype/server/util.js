'use strict';
class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra || null; }
}
const bad = (m, extra) => new HttpError(400, m, extra);
const forbidden = (m = 'You do not have access to this.') => new HttpError(403, m);
const notFound = (m = 'Not found.') => new HttpError(404, m);
const conflict = (m, extra) => new HttpError(409, m, extra);

function str(v, { max = 2000, required = false, name = 'Value' } = {}) {
  if (v === undefined || v === null || v === '') { if (required) throw bad(`${name} is required.`); return null; }
  if (typeof v !== 'string') throw bad(`${name} must be text.`);
  const s = v.trim();
  if (!s) { if (required) throw bad(`${name} is required.`); return null; }
  if (s.length > max) throw bad(`${name} is too long (maximum ${max} characters).`);
  return s;
}
function int(v, { min = 0, max = 100000, required = false, name = 'Value' } = {}) {
  if (v === undefined || v === null || v === '') { if (required) throw bad(`${name} is required.`); return null; }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be a whole number between ${min} and ${max}.`);
  return n;
}
function oneOf(v, list, name = 'Value') { if (!list.includes(v)) throw bad(`${name} must be one of: ${list.join(', ')}.`); return v; }
function url(v, name = 'Link') {
  const s = str(v, { max: 2000, name }); if (!s) return null;
  let u; try { u = new URL(s); } catch { throw bad(`${name} is not a valid web address.`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw bad(`${name} must start with http:// or https://`);
  return u.toString();
}
const flag = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
module.exports = { HttpError, bad, forbidden, notFound, conflict, str, int, oneOf, url, flag };
