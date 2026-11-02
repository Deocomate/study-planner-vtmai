'use strict';
// Daily reminders. The server checks every minute (see index.js), so emails go out even when no browser is open.
// Each (reminder, recipient, day) can be sent only once: a database row is claimed before sending.
const { get, all, run, tx } = require('./db');
const T = require('./time');
const M = require('./metrics');
const mailer = require('./mailer');
const { notify, childContext, childName } = require('./tasks');
const { getSetting } = require('./settings');

const KINDS = ['daily_plan', 'daily_checkin', 'parent_summary'];
const CATCH_UP_MIN = 180;       // if the server was down at the exact time, still send up to 3 hours late
const MAX_ATTEMPTS = 3, RETRY_MIN = 10;
const baseUrl = () => process.env.APP_BASE_URL || '';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dayLabel = (d) => `${T.DOW[T.weekdayOf(d)]} ${d.slice(8)}/${d.slice(5, 7)}`;

function todaySessions(childId, date) {
  return all(`SELECT s.*, t.title, t.subject, t.resource_link, t.work_link, t.status AS task_status FROM sessions s JOIN tasks t ON t.id = s.task_id
              WHERE s.child_id = ? AND s.planned_date = ? AND t.cancelled_at IS NULL ORDER BY s.start_time`, childId, date);
}

// Each builder returns { subject, text, html, empty } for one child (or both, for the parent).
function childSection(childId, date, kind) {
  const name = childName(childId);
  const sessions = todaySessions(childId, date);
  const ctx = childContext(childId);
  const overdue = ctx.tasks.filter((t) => M.isOverdue(t));
  const revisions = ctx.tasks.filter((t) => t.review_status === 'changes_requested' && !t.cancelled_at);
  const lines = [], htm = [];
  if (kind === 'daily_plan') {
    lines.push(sessions.length ? `Today's plan (${dayLabel(date)}):` : `Nothing is planned for ${dayLabel(date)}.`);
    htm.push(`<h3>${esc(name)}: plan for ${dayLabel(date)}</h3>`);
    for (const s of sessions) {
      lines.push(`  ${s.start_time}-${s.end_time}  ${s.title} (${s.subject}, ${s.minutes} min)`);
      if (s.resource_link) lines.push(`      Exercise: ${s.resource_link}`);
      if (s.work_link) lines.push(`      Work file: ${s.work_link}`);
      htm.push(`<p><b>${s.start_time}-${s.end_time}</b> ${esc(s.title)} <i>(${esc(s.subject)}, ${s.minutes} min)</i>${s.resource_link ? ` <a href="${esc(s.resource_link)}">Exercise</a>` : ''}${s.work_link ? ` <a href="${esc(s.work_link)}">Work file</a>` : ''}</p>`);
    }
  } else {
    const open = sessions.filter((s) => s.status !== 'done');
    lines.push(open.length ? `Still to finish today (${open.length}):` : `Everything planned for today is finished.`);
    htm.push(`<h3>${esc(name)}: check-in</h3><p>${open.length ? `Still to finish today: ${open.length}` : 'Everything planned for today is finished. Well done!'}</p>`);
    for (const s of open) { lines.push(`  ${s.start_time}-${s.end_time}  ${s.title}`); htm.push(`<p>${s.start_time}-${s.end_time} ${esc(s.title)}</p>`); }
  }
  if (overdue.length) { lines.push('Overdue:'); htm.push('<p><b>Overdue</b></p>'); for (const t of overdue) { lines.push(`  ${t.title} (was due ${t.deadline.replace('T', ' ')})`); htm.push(`<p>${esc(t.title)} (was due ${esc(t.deadline.replace('T', ' '))})</p>`); } }
  if (revisions.length) { lines.push('Changes requested by your parent:'); htm.push('<p><b>Changes requested</b></p>'); for (const t of revisions) { lines.push(`  ${t.title}`); htm.push(`<p>${esc(t.title)}</p>`); } }
  return { name, lines, htm, empty: !sessions.length && !overdue.length && !revisions.length };
}

function buildChild(childId, date, kind) {
  const sec = childSection(childId, date, kind);
  const label = kind === 'daily_plan' ? 'Your plan for today' : 'Evening check-in';
  const link = baseUrl() ? `\nOpen your board: ${baseUrl()}` : '';
  return { subject: `${label} - ${dayLabel(date)}`, text: `Hi ${sec.name},\n\n${sec.lines.join('\n')}${link}\n`, html: `<p>Hi ${esc(sec.name)},</p>${sec.htm.join('')}${baseUrl() ? `<p><a href="${esc(baseUrl())}">Open your board</a></p>` : ''}`, empty: sec.empty };
}
function buildParentCombined(date, kind) {
  const secs = ['ben', 'shin'].map((id) => childSection(id, date, kind));
  const label = kind === 'daily_plan' ? 'Daily plan' : 'Daily check-in';
  return { subject: `${label} for Ben and Shin - ${dayLabel(date)}`, text: secs.map((s) => `== ${s.name} ==\n${s.lines.join('\n')}`).join('\n\n') + '\n', html: secs.map((s) => s.htm.join('')).join('<hr>'), empty: secs.every((s) => s.empty) };
}
function buildParentSummary(date) {
  const parts = [], htm = [];
  for (const id of ['ben', 'shin']) {
    const s = M.childSummary(id, { weekStart: T.weekStartOf(date) });
    const d = s.today;
    const l = [`${s.child.name}: ${d.tasks_done}/${d.tasks_planned} tasks finished today (${d.done_minutes}/${d.planned_minutes} planned minutes).`,
      `  Week so far: ${s.week.completed}/${s.week.total} tasks done, ${s.week.weighted_pct === null ? 'no' : s.week.weighted_pct + '%'} by estimated time.`,
      `  Needs your attention: ${s.help_open.length} help request(s), ${s.awaiting_review.length} awaiting review, ${s.revisions.length} with changes requested, ${s.overdue.length} overdue, ${s.unscheduled.length} unscheduled.`];
    parts.push(l.join('\n')); htm.push(`<h3>${esc(s.child.name)}</h3>${l.map((x) => `<p>${esc(x.trim())}</p>`).join('')}`);
  }
  const link = baseUrl() ? `\nOpen the Parent Dashboard: ${baseUrl()}` : '';
  return { subject: `Parent summary - ${dayLabel(date)}`, text: parts.join('\n\n') + link + '\n', html: htm.join('') + (baseUrl() ? `<p><a href="${esc(baseUrl())}">Open the Parent Dashboard</a></p>` : ''), empty: false };
}

// Claim the (kind, recipient, day) slot, send, and record the outcome. Returns the log status.
async function deliver({ kind, recipient, childId, runDate, content }) {
  const key = `${kind}|${recipient.toLowerCase()}|${childId || 'all'}|${runDate}`;
  const claim = tx(() => {
    const row = get('SELECT * FROM reminder_log WHERE dedupe_key = ?', key);
    const now = T.nowISO();
    if (!row) { run("INSERT INTO reminder_log (kind, recipient, child_id, run_date, dedupe_key, status, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', 1, ?, ?)", kind, recipient, childId || null, runDate, key, now, now); return 'go'; }
    if (row.status === 'sent' || row.status === 'outbox') return 'skip';
    if (row.status === 'skipped' && !(row.error === 'not_configured' && mailer.status().configured)) return 'skip';
    const ageMin = (T.nowMs() - new Date(row.updated_at).getTime()) / 60000;
    if (row.status === 'pending' && ageMin < 5) return 'skip';
    if (row.status === 'failed' && (row.attempts >= MAX_ATTEMPTS || ageMin < RETRY_MIN)) return 'skip';
    run("UPDATE reminder_log SET status = 'pending', attempts = attempts + 1, updated_at = ? WHERE id = ?", now, row.id);
    return 'go';
  });
  if (claim === 'skip') return 'skipped';
  const finish = (status, error) => run('UPDATE reminder_log SET status = ?, error = ?, updated_at = ? WHERE dedupe_key = ?', status, error || null, T.nowISO(), key);
  if (content.empty && kind !== 'parent_summary') { finish('skipped', 'nothing to report'); return 'skipped'; }
  try {
    const r = await mailer.send({ to: recipient, subject: content.subject, text: content.text, html: content.html });
    finish(r.real ? 'sent' : 'outbox'); return r.real ? 'sent' : 'outbox';
  } catch (e) {
    if (e.code === 'not_configured') { finish('skipped', 'not_configured'); return 'skipped'; }
    finish('failed', String(e.message).slice(0, 500));
    notify({ audience: 'parent', kind: 'email_failed', title: `A reminder email could not be sent to ${recipient}`, body: String(e.message).slice(0, 300), view: 'settings', dedupe: `emailfail:${key}` });
    return 'failed';
  }
}

// One pass: look at every reminder type and send what is due now.
async function runDue() {
  const cfg = getSetting('reminders'), date = T.todayStr(), minutes = T.nowMinutes();
  const parentEmail = getSetting('parent_email');
  const results = [];
  for (const kind of KINDS) {
    const c = cfg[kind];
    if (!c || !c.enabled) continue;
    const due = T.parseHM(c.time);
    if (minutes < due || minutes >= due + CATCH_UP_MIN) continue;
    const children = all('SELECT c.id, cs.email FROM children c JOIN child_settings cs ON cs.child_id = c.id');
    // in-app notifications (once per day)
    if (kind !== 'parent_summary') {
      for (const ch of children) {
        const content = buildChild(ch.id, date, kind);
        if (!content.empty) notify({ audience: ch.id, kind, title: content.subject, body: content.text.split('\n').slice(2, 6).join(' ').slice(0, 300), view: 'today', dedupe: `inapp:${kind}:${ch.id}:${date}` });
      }
    } else {
      const s = buildParentSummary(date);
      notify({ audience: 'parent', kind, title: s.subject, body: s.text.split('\n').slice(0, 4).join(' ').slice(0, 300), view: 'overview', dedupe: `inapp:${kind}:parent:${date}` });
    }
    // emails
    if (kind === 'parent_summary') {
      if (c.to_parent !== false && parentEmail) results.push([kind, parentEmail, await deliver({ kind, recipient: parentEmail, runDate: date, content: buildParentSummary(date) })]);
    } else {
      if (c.to_children) for (const ch of children) if (ch.email) results.push([kind, ch.email, await deliver({ kind, recipient: ch.email, childId: ch.id, runDate: date, content: buildChild(ch.id, date, kind) })]);
      if (c.to_parent && parentEmail) results.push([kind, parentEmail, await deliver({ kind, recipient: parentEmail, runDate: date, content: buildParentCombined(date, kind) })]);
    }
  }
  return results;
}

// Parent presses "Send test email": goes out immediately, is never counted as a reminder, and reports the real outcome.
async function sendTest(to) {
  const r = await mailer.send({ to, subject: 'Test email from the Family Study Planner', text: 'If you can read this, email reminders are connected.\n', html: '<p>If you can read this, email reminders are connected.</p>' });
  return r;
}
async function sendParentAlert(subject, text) {
  const to = getSetting('parent_email');
  if (!to || !mailer.status().configured) return { sent: false };
  try { const r = await mailer.send({ to, subject, text, html: `<pre>${esc(text)}</pre>` }); return { sent: r.real }; } catch { return { sent: false }; }
}
// Manual "send now" from the dashboard (counts as the day's send only if the normal one has not gone out).
function previewContent(kind, childId, date = T.todayStr()) {
  if (kind === 'parent_summary') return buildParentSummary(date);
  return childId ? buildChild(childId, date, kind) : buildParentCombined(date, kind);
}
module.exports = { runDue, deliver, sendTest, sendParentAlert, previewContent, KINDS, CATCH_UP_MIN };
