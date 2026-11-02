'use strict';
const { buildApp } = require('./app');
const reminders = require('./reminders');
const monthly = require('./monthly');
const files = require('./files');
const { run } = require('./db');
const T = require('./time');

const app = buildApp();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
app.listen(PORT, HOST, () => {
  console.log(`Family Study Planner is running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (time zone Asia/Ho_Chi_Minh, now ${T.nowISO()})`);
});

// ----- Background jobs: no browser needed. Checked once a minute. -----
let busy = false, lastClean = '';
async function tick() {
  if (busy) return; busy = true;
  try {
    await reminders.runDue();                                   // daily plan / check-in / parent summary (email + in-app)
    monthly.autoTick();                                         // month-end reports and reset, when enabled
    const day = T.todayStr();
    if (lastClean !== day && T.nowMinutes() >= 180) {            // once a day, ~03:00: tidy up
      lastClean = day;
      run('DELETE FROM auth_sessions WHERE expires_at < ?', T.nowISO());
      run('DELETE FROM schedule_proposals WHERE created_at < ?', new Date(T.nowMs() - 86400000).toISOString());
      files.cleanOrphanImports(7);
    }
  } catch (e) { console.error('[background job]', e); }
  finally { busy = false; }
}
setInterval(tick, 60 * 1000);
setTimeout(tick, 5000);
process.on('unhandledRejection', (e) => console.error('[unhandled]', e));
