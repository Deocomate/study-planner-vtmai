'use strict';
// Time helpers. Everything the family sees is Asia/Ho_Chi_Minh (UTC+7, no daylight saving),
// so local time = UTC + 7 hours. Weeks run Monday..Sunday.
const OFFSET_MS = 7 * 3600 * 1000;
const TZ = 'Asia/Ho_Chi_Minh';
let clock = () => Date.now();

const pad = (n) => String(n).padStart(2, '0');
function setClock(fn) { clock = fn || (() => Date.now()); }
const nowMs = () => clock();
const nowISO = () => new Date(clock()).toISOString();
const vn = (ms = clock()) => new Date(ms + OFFSET_MS);

function fmtDate(ms) { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }
const todayStr = () => fmtDate(vn().getTime());
const nowMinutes = () => { const d = vn(); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const addDays = (s, n) => fmtDate(parseDate(s) + n * 86400000);
const weekdayOf = (s) => { const w = new Date(parseDate(s)).getUTCDay(); return w === 0 ? 7 : w; };
const weekStartOf = (s) => addDays(s, 1 - weekdayOf(s));
const monthOf = (s) => s.slice(0, 7);
const maxDate = (a, b) => (a >= b ? a : b);
const parseHM = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fmtHM = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
function addMonths(m, n) { const [y, mo] = m.split('-').map(Number); const t = y * 12 + (mo - 1) + n; return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`; }
const monthStart = (m) => `${m}-01`;
const monthEnd = (m) => addDays(monthStart(addMonths(m, 1)), -1);
const splitDT = (dt) => { const [d, t] = dt.split('T'); return { date: d, minutes: parseHM(t || '00:00') }; };
const dtKey = (dt) => { const p = splitDT(dt); return parseDate(p.date) / 60000 + p.minutes; };   // comparable minutes
const keyOf = (date, minutes) => parseDate(date) / 60000 + minutes;
const localKeyFromMs = (ms) => Math.floor((ms + OFFSET_MS) / 60000);
const nowKey = () => localKeyFromMs(clock());
const isoToLocalDT = (iso) => { const d = new Date(new Date(iso).getTime() + OFFSET_MS); return `${fmtDate(d.getTime())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };

// Alternating-week support: week index counted from Monday 2024-01-01. Even index => 'even'.
function weekParity(weekStart) {
  const days = Math.round((parseDate(weekStart) - parseDate('2024-01-01')) / 86400000);
  return Math.floor(days / 7) % 2 === 0 ? 'even' : 'odd';
}
// The reporting month of a task: month of its deadline; with no deadline, the month containing the Thursday of its week.
const reportingMonthFor = (deadline, weekStart) => (deadline ? monthOf(deadline.slice(0, 10)) : monthOf(addDays(weekStart, 3)));

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseDate(s)) && fmtDate(parseDate(s)) === s;
const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const isDT = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(s) && isDate(s.slice(0, 10));
const isMonth = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const DOW = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

module.exports = { TZ, setClock, nowMs, nowISO, todayStr, nowMinutes, addDays, weekdayOf, weekStartOf, monthOf, maxDate, parseHM, fmtHM,
  addMonths, monthStart, monthEnd, splitDT, dtKey, keyOf, localKeyFromMs, nowKey, isoToLocalDT, weekParity, reportingMonthFor,
  isDate, isTime, isDT, isMonth, parseDate, fmtDate, DOW };
