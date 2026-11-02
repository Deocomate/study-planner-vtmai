'use strict';
const { get, run } = require('./db');
const DEFAULTS = {
  reminders: {
    daily_plan:     { enabled: true, time: '19:00', to_parent: false, to_children: true },
    daily_checkin:  { enabled: true, time: '20:30', to_parent: false, to_children: true },
    parent_summary: { enabled: true, time: '22:00', to_parent: true },
  },
  parent_email: null,
  reset: { policy: null, auto_enabled: false },   // policy: 'carry' | 'close'
  first_month: null,
};
function getSetting(key) {
  const r = get('SELECT value FROM settings WHERE key = ?', key);
  return r ? JSON.parse(r.value) : structuredClone(DEFAULTS[key] ?? null);
}
function setSetting(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}
module.exports = { getSetting, setSetting, DEFAULTS };
