'use strict';
// Turns pasted text, screenshots and PDFs into an editable list of proposed tasks. Nothing is saved until the parent confirms.
//  - Text: a built-in rule-based reader (works offline, no cost).
//  - Images / PDFs: the Claude API, only when ANTHROPIC_API_KEY is set. Otherwise the feature reports "not connected" (no fake results).
const { get, all } = require('./db');
const T = require('./time');
const { readFile } = require('./files');
const { defaultsFor, guessType } = require('./tasks');

const EXTRACTION_MODEL = () => process.env.EXTRACTION_MODEL || 'claude-sonnet-5-5';
const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY;

// ---------- helpers ----------
const WEEKDAYS = [
  [1, /\b(mon(day)?|t2|thứ\s*(hai|2))\b/i], [2, /\b(tue(s(day)?)?|t3|thứ\s*(ba|3))\b/i], [3, /\b(wed(nesday)?|t4|thứ\s*(tư|4))\b/i],
  [4, /\b(thu(r(s(day)?)?)?|t5|thứ\s*(năm|5))\b/i], [5, /\b(fri(day)?|t6|thứ\s*(sáu|6))\b/i], [6, /\b(sat(urday)?|t7|thứ\s*(bảy|7))\b/i], [7, /\b(sun(day)?|cn|chủ\s*nhật)\b/i],
];
const SUBJECTS = [
  ['Maths', /\b(maths?|toán|toan)\b/i], ['ESL', /\b(esl|english|tiếng\s*anh)\b/i], ['Science', /\b(science|khoa\s*học)\b/i],
  ['Writing', /\bwriting\b/i], ['Debate', /\bdebate\b/i], ['Cindy class', /\b(cindy|linh)\b/i],
];
const URL_RE = /https?:\/\/[^\s<>"')]+/gi;

function normTitle(s) { return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim(); }
function similarity(a, b) {
  const A = new Set(normTitle(a).split(' ').filter(Boolean)), B = new Set(normTitle(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// Durations: "45m", "45 min", "1.5h", "2 hours", "1h30m", "90 phút". A bare "20h30" or "7h" is a clock time, not a duration.
function parseDuration(line) {
  let m = line.match(/(\d+(?:[.,]\d+)?)\s*(?:hours?|hrs?|giờ|tiếng)\s*(?:(\d{1,2})\s*(?:m|min|mins|phút)?)?(?![a-z])/i);
  if (m) return { minutes: Math.round(parseFloat(m[1].replace(',', '.')) * 60 + (m[2] ? parseInt(m[2], 10) : 0)), text: m[0] };
  m = line.match(/(\d+)\s*h\s*(\d{1,2})\s*(?:m|min|mins|phút)\b/i);
  if (m && parseInt(m[1], 10) <= 12) return { minutes: parseInt(m[1], 10) * 60 + parseInt(m[2], 10), text: m[0] };
  m = line.match(/(\d+[.,]\d+)\s*h\b/i);
  if (m) return { minutes: Math.round(parseFloat(m[1].replace(',', '.')) * 60), text: m[0] };
  m = line.match(/(\d{1,3})\s*(?:m|min|mins|minutes?|phút|')(?![a-z])/i);
  if (m) return { minutes: parseInt(m[1], 10), text: m[0] };
  m = line.match(/\b([1-5])\s*h\b(?!\s*\d)/i);          // "2h" on its own is read as two hours
  if (m) return { minutes: parseInt(m[1], 10) * 60, text: m[0] };
  return null;
}
function parseTime(line) {
  let m = line.match(/\b(\d{1,2})[:h](\d{2})\b/i) || line.match(/\b(\d{1,2})\s*h\b(?!\w)/i);
  if (m) { const h = parseInt(m[1], 10), mi = m[2] ? parseInt(m[2], 10) : 0; if (h < 24 && mi < 60) return { h, mi, text: m[0] }; }
  m = line.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (m) { let h = parseInt(m[1], 10) % 12; if (/pm/i.test(m[3])) h += 12; return { h, mi: m[2] ? parseInt(m[2], 10) : 0, text: m[0] }; }
  return null;
}

// Reads one assignment per line. Reports exactly what it found and what it had to assume.
function parseText(text, weekStart) {
  const items = [];
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);
  for (const raw of lines) {
    let rest = raw;
    const links = rest.match(URL_RE) || [];
    rest = rest.replace(URL_RE, ' ');
    const flags = [], fromSource = [];
    const dur = parseDuration(rest); if (dur) { rest = rest.replace(dur.text, ' '); fromSource.push('est_minutes'); }
    const time = parseTime(rest); if (time) rest = rest.replace(time.text, ' ');
    let wd = null;
    for (const [n, re] of WEEKDAYS) { const m = rest.match(re); if (m) { wd = n; rest = rest.replace(m[0], ' '); break; } }
    let dateStr = null;
    const dm = rest.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (dm && T.isDate(dm[0])) { dateStr = dm[0]; rest = rest.replace(dm[0], ' '); }
    rest = rest.replace(/\b(due|deadline|by|hạn|nộp)\b[:\s]*/gi, ' ').replace(/[()|]/g, ' ').replace(/\s{2,}/g, ' ').replace(/^[\s:,\-–—]+|[\s:,\-–—]+$/g, '').trim();
    const title = rest || raw.slice(0, 80);
    let subject = 'Other';
    for (const [name, re] of SUBJECTS) if (re.test(raw)) { subject = name; break; }
    let deadline = null;
    if (dateStr) { deadline = `${dateStr}T${time ? `${String(time.h).padStart(2, '0')}:${String(time.mi).padStart(2, '0')}` : '23:59'}`; fromSource.push('deadline'); if (!time) flags.push('No deadline time was written; end of day (23:59) was assumed.'); }
    else if (wd) {
      deadline = `${T.addDays(weekStart, wd - 1)}T${time ? `${String(time.h).padStart(2, '0')}:${String(time.mi).padStart(2, '0')}` : '23:59'}`;
      fromSource.push('deadline');
      flags.push(`Deadline date worked out from the weekday and the selected week (${T.DOW[wd]} ${T.addDays(weekStart, wd - 1)}).`);
      if (!time) flags.push('No deadline time was written; end of day (23:59) was assumed.');
    } else flags.push('No deadline found in the text.');
    if (!dur) flags.push('No duration written; a system estimate will be used (please confirm).');
    if (title.length < 3) flags.push('The title is very short or unclear; please check it.');
    const type = guessType(title, subject);
    items.push({ title, subject, task_type: type, instructions: null, est_minutes: dur ? dur.minutes : null, est_source: dur ? 'source' : 'system',
      deadline, target: null, priority: 2, review_required: 0, resource_link: links[0] || null, work_link: null,
      flags, from_source: fromSource, source_text: raw, extra_links: links.slice(1) });
  }
  return items;
}

// ---------- AI extraction (images / PDFs / complicated text) ----------
const AI_PROMPT = (weekStart, names) => `You read school homework assignments for parents. The attached material (images, PDFs and/or text) lists weekly work for ${names.join(' and ')}.
Extract each separate assignment. Respond with ONLY a JSON object, no commentary, in exactly this shape:
{"tasks":[{"title":string,"subject":string|null,"instructions":string|null,"deadline_date":"YYYY-MM-DD"|null,"deadline_weekday":1-7|null,"deadline_time":"HH:MM"|null,"estimated_minutes":number|null,"links":[string],"applies_to":"ben"|"shin"|"both"|null,"unclear":[string]}],"unreadable":[string]}
Rules: copy only what is written. Use null when something is not stated - never guess. "estimated_minutes" only if a duration is explicitly written.
Use "deadline_date" only for a full date in the source; if only a weekday is written use "deadline_weekday" (1=Monday..7=Sunday). The intended week starts on Monday ${weekStart}.
List in "unclear" any field you could not read confidently, and in "unreadable" any parts of the material you could not read.`;

async function callClaude(content) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: EXTRACTION_MODEL(), max_tokens: 4096, messages: [{ role: 'user', content }] }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`The extraction service answered with an error (${res.status}): ${(body.error && body.error.message) || 'unknown'}`);
  return (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

function parseAIJson(text, key = 'tasks') {
  const cleaned = String(text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('The extraction service did not return readable data.');
  const obj = JSON.parse(cleaned.slice(start, end + 1));
  if (!obj || !Array.isArray(obj[key])) throw new Error('The extraction service returned data in an unexpected shape.');
  return obj;
}

function aiToItems(obj, weekStart) {
  const items = [];
  for (const r of obj.tasks.slice(0, 100)) {
    const title = typeof r.title === 'string' ? r.title.trim().slice(0, 200) : '';
    if (!title) continue;
    const flags = [], fromSource = [];
    let deadline = null;
    const time = typeof r.deadline_time === 'string' && T.isTime(r.deadline_time) ? r.deadline_time : null;
    if (typeof r.deadline_date === 'string' && T.isDate(r.deadline_date)) { deadline = `${r.deadline_date}T${time || '23:59'}`; fromSource.push('deadline'); }
    else if (Number.isInteger(r.deadline_weekday) && r.deadline_weekday >= 1 && r.deadline_weekday <= 7) {
      deadline = `${T.addDays(weekStart, r.deadline_weekday - 1)}T${time || '23:59'}`; fromSource.push('deadline');
      flags.push(`Deadline date worked out from the weekday and the selected week.`);
    } else flags.push('No deadline was found in the source.');
    if (deadline && !time) flags.push('No deadline time in the source; end of day (23:59) was assumed.');
    const minutes = Number.isFinite(r.estimated_minutes) && r.estimated_minutes >= 5 && r.estimated_minutes <= 900 ? Math.round(r.estimated_minutes) : null;
    if (minutes) fromSource.push('est_minutes'); else flags.push('No duration in the source; a system estimate will be used (please confirm).');
    for (const u of Array.isArray(r.unclear) ? r.unclear.slice(0, 5) : []) if (typeof u === 'string') flags.push(`Unclear in the source: ${u.slice(0, 200)}`);
    const links = (Array.isArray(r.links) ? r.links : []).filter((l) => typeof l === 'string' && /^https?:\/\//i.test(l));
    const subject = typeof r.subject === 'string' && r.subject.trim() ? r.subject.trim().slice(0, 60) : 'Other';
    items.push({ title, subject, task_type: guessType(title, subject), instructions: typeof r.instructions === 'string' ? r.instructions.slice(0, 4000) : null,
      est_minutes: minutes, est_source: minutes ? 'source' : 'system', deadline, target: null, priority: 2, review_required: 0,
      resource_link: links[0] || null, work_link: null, flags, from_source: fromSource, applies_to: ['ben', 'shin', 'both'].includes(r.applies_to) ? r.applies_to : null, extra_links: links.slice(1) });
  }
  return { items, unreadable: (Array.isArray(obj.unreadable) ? obj.unreadable : []).filter((x) => typeof x === 'string').slice(0, 10) };
}

async function extractWithAI({ text, files, childNames, weekStart, call = callClaude }) {
  const content = [];
  for (const f of files) {
    const data = readFile(f).toString('base64');
    content.push(f.mime === 'application/pdf' ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
      : { type: 'image', source: { type: 'base64', media_type: f.mime, data } });
  }
  if (text && text.trim()) content.push({ type: 'text', text: `Pasted text:\n${text.slice(0, 20000)}` });
  content.push({ type: 'text', text: AI_PROMPT(weekStart, childNames) });
  return aiToItems(parseAIJson(await call(content)), weekStart);
}

// ---------- main entry ----------
// Returns { status, items[], notes[] }.  Each item is for exactly one child; "both" creates one item per child.
async function extract({ childIds, weekStart, text, fileRows, driveLinks = [], call }) {
  const notes = [];
  let items = [], unreadable = [];
  const names = childIds.map((id) => get('SELECT name FROM children WHERE id = ?', id).name);
  const hasFiles = fileRows.length > 0;
  let ai = 'not_used';
  if (hasFiles) {
    if (!aiConfigured() && !call) {
      return { status: 'not_connected', items: [], notes: ['Reading images and PDFs needs the extraction service, which is not connected yet (ANTHROPIC_API_KEY is missing). Nothing was extracted from the files. You can paste the text or add tasks manually instead.'] };
    }
    try { const r = await extractWithAI({ text, files: fileRows, childNames: names, weekStart, call }); items = r.items; unreadable = r.unreadable; ai = 'ok'; }
    catch (e) { return { status: 'failed', items: [], notes: [`The files could not be read: ${e.message} You can paste the text or add tasks manually instead.`] }; }
  } else if (text && text.trim()) {
    items = parseText(text, weekStart);
  }
  if (unreadable.length) notes.push(...unreadable.map((u) => `Could not read: ${u}`));
  if (!items.length) notes.push('No tasks were found. Add them manually below.');
  const sourceFileId = fileRows.length === 1 ? fileRows[0].id : null;
  // Fan out to children; attach Drive links given for the whole import when an item has no link of its own.
  const out = [];
  for (const it of items) {
    const targets = it.applies_to && it.applies_to !== 'both' && childIds.includes(it.applies_to) ? [it.applies_to] : childIds;
    for (const childId of targets) {
      const copy = { ...it, child_id: childId, flags: [...it.flags], source_file_id: sourceFileId };
      if (!copy.resource_link && driveLinks.length === 1) { copy.resource_link = driveLinks[0]; copy.flags.push('Link taken from the Drive link you pasted.'); }
      if (copy.est_minutes === null) { copy.est_minutes = defaultsFor(childId, copy.task_type).minutes; copy.est_source = 'system'; }
      out.push(copy);
    }
  }
  flagDuplicates(out, weekStart);
  if (driveLinks.length > 1) notes.push('Several Drive links were pasted: they are not matched to tasks automatically. Paste each link into the right task below.');
  return { status: 'ok', ai, items: out, notes, source_file_id: sourceFileId };
}

// Marks items that look like something already saved for that child, or like another item in the same batch.
function flagDuplicates(items, weekStart) {
  items.forEach((it, i) => {
    const existing = all("SELECT id, title, deadline FROM tasks WHERE child_id = ? AND cancelled_at IS NULL AND (week_start = ? OR reporting_month = ?)", it.child_id, weekStart, T.monthOf(it.deadline || weekStart));
    for (const e of existing) {
      if (similarity(e.title, it.title) >= 0.8 && (!it.deadline || !e.deadline || e.deadline.slice(0, 10) === it.deadline.slice(0, 10))) { it.duplicate_of = e.id; it.flags.push(`Possible duplicate of the saved task "${e.title}".`); break; }
    }
    for (let j = 0; j < i; j++) {
      if (items[j].child_id === it.child_id && similarity(items[j].title, it.title) >= 0.9) { it.flags.push(`Looks the same as item ${j + 1} in this list.`); it.duplicate_in_batch = j; break; }
    }
  });
}

// ---------- weekly templates ----------
// Work week W: the target falls inside W; the deadline is the first matching weekday date after the target.
function templateItems(weekStart, childIds) {
  const items = [];
  const tpls = all(`SELECT * FROM templates WHERE active = 1 AND child_id IN (${childIds.map(() => '?').join(',')}) ORDER BY child_id, id`, ...childIds);
  for (const t of tpls) {
    let deadline, target = null;
    if (t.target_weekday) {
      const tDate = T.addDays(weekStart, t.target_weekday - 1);
      target = `${tDate}T${t.target_time || '21:00'}`;
      let d = tDate;
      for (let i = 0; i < 8; i++, d = T.addDays(d, 1)) {
        if (T.weekdayOf(d) === t.deadline_weekday && T.dtKey(`${d}T${t.deadline_time}`) > T.dtKey(target)) break;
      }
      deadline = `${d}T${t.deadline_time}`;
    } else deadline = `${T.addDays(weekStart, t.deadline_weekday - 1)}T${t.deadline_time}`;
    const est = t.estimate_min;
    const type = t.task_type;
    items.push({ child_id: t.child_id, title: t.title, subject: t.subject, task_type: type, instructions: t.instructions, est_minutes: est || defaultsFor(t.child_id, type).minutes,
      est_source: est ? 'parent' : 'system', deadline, target, priority: t.priority, review_required: t.review_required, resource_link: null, work_link: null,
      flags: [...(est ? [] : ['Duration is a system estimate for this kind of work. Please confirm.']), ...(t.note ? [t.note] : [])], from_source: ['deadline'], source_ref: `template:${t.id}` });
  }
  flagDuplicates(items, weekStart);
  return items;
}
// ---------- timetable image / PDF -> editable table ----------
const TT_PROMPT = `This is a weekly school or activity timetable for children. Extract every block. Respond with ONLY JSON:
{"blocks":[{"child":string|null,"title":string,"weekday":1-7,"start":"HH:MM","end":"HH:MM","mode":"online"|"offline"|null,"unclear":[string]}],"unreadable":[string]}
weekday: 1=Monday..7=Sunday. Use null where something is not shown - never guess. Put anything hard to read in "unclear".`;
async function extractTimetable({ fileRows, call = callClaude }) {
  if (!aiConfigured() && call === callClaude) return { status: 'not_connected', blocks: [], notes: ['Reading timetable images needs the extraction service (ANTHROPIC_API_KEY), which is not connected. Please add the timetable items by hand.'] };
  try {
    const content = fileRows.map((f) => { const data = readFile(f).toString('base64'); return f.mime === 'application/pdf' ? { type: 'document', source: { type: 'base64', media_type: f.mime, data } } : { type: 'image', source: { type: 'base64', media_type: f.mime, data } }; });
    content.push({ type: 'text', text: TT_PROMPT });
    const obj = parseAIJson(await call(content), 'blocks');
    const blocks = [];
    for (const r of obj.blocks.slice(0, 100)) {
      const flags = Array.isArray(r.unclear) ? r.unclear.map((u) => `Unclear: ${u}`) : [];
      const ok = typeof r.title === 'string' && Number.isInteger(r.weekday) && r.weekday >= 1 && r.weekday <= 7 && T.isTime(r.start) && T.isTime(r.end);
      if (!ok) { flags.push('Some details could not be read; please complete this row.'); }
      blocks.push({ child_id: ['ben', 'shin'].includes(String(r.child || '').toLowerCase()) ? String(r.child).toLowerCase() : null, title: String(r.title || '').slice(0, 100), weekday: r.weekday || 1,
        start_time: T.isTime(r.start) ? r.start : '', end_time: T.isTime(r.end) ? r.end : '', mode: ['online', 'offline'].includes(r.mode) ? r.mode : null, kind: 'class', flags });
    }
    return { status: 'ok', blocks, notes: ['Check every row before saving. Nothing has been saved yet.'] };
  } catch (e) { return { status: 'failed', blocks: [], notes: [`The timetable could not be read: ${e.message}`] }; }
}
module.exports = { extract, parseText, parseAIJson, aiToItems, extractWithAI, templateItems, flagDuplicates, similarity, aiConfigured, EXTRACTION_MODEL, extractTimetable };
