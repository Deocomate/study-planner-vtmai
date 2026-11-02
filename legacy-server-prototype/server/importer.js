'use strict';
// Turns pasted text and uploaded files into an editable list of proposed tasks. Nothing is saved until the parent confirms.
// Fully offline rule-based parser: no external AI, zero dependencies, no third-party API calls.
const { get, all } = require('./db');
const T = require('./time');
const { defaultsFor, guessType } = require('./tasks');

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

// Times: "7:00", "07:00", "20h30", "8pm", "8:30 pm", "21h".
function parseTime(line) {
  let m = line.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m) return { time: `${String(m[1]).padStart(2, '0')}:${m[2]}`, text: m[0] };
  m = line.match(/\b([01]?\d|2[0-3])h([0-5]\d)\b/i);
  if (m) return { time: `${String(m[1]).padStart(2, '0')}:${m[2]}`, text: m[0] };
  m = line.match(/\b(1[0-2]|[1-9])(?::([0-5]\d))?\s*(am|pm)\b/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const pm = m[3].toLowerCase() === 'pm';
    if (pm && h < 12) h += 12; else if (!pm && h === 12) h = 0;
    return { time: `${String(h).padStart(2, '0')}:${m[2] || '00'}`, text: m[0] };
  }
  return null;
}

// Dates: full ISO date 2026-10-29, 29/10, or weekday name relative to weekStart.
function parseDeadline(line, weekStart) {
  let m = line.match(/\b(20\d\d-[01]\d-[0-3]\d)\b/);
  if (m) return { date: m[1], weekday: T.weekdayOf(m[1]), text: m[0], fromIso: true };
  m = line.match(/\b([0-3]?\d)[/-]([01]?\d)(?:[/-](20\d\d))?\b/);
  if (m) {
    const y = m[3] ? parseInt(m[3], 10) : parseInt(weekStart.slice(0, 4), 10);
    const date = `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    if (T.isDate(date)) return { date, weekday: T.weekdayOf(date), text: m[0], fromDayMonth: true };
  }
  for (const [w, re] of WEEKDAYS) {
    if (re.test(line)) {
      const date = T.addDays(weekStart, w - 1);
      return { date, weekday: w, text: line.match(re)[0], fromWeekday: true };
    }
  }
  return null;
}

// ---------- offline rule-based text reader ----------
function parseText(raw, weekStart) {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items = [];
  for (const original of lines) {
    let line = original.replace(/^[-*•\d.)\s]+/, '').trim();
    if (!line) continue;
    const flags = [], fromSource = [];
    const urls = line.match(URL_RE) || [];
    const resourceLink = urls[0] || null;
    for (const u of urls) line = line.replace(u, ' ');
    line = line.replace(/\s+/g, ' ').trim();

    let subject = 'Other';
    for (const [s, re] of SUBJECTS) { if (re.test(line)) { subject = s; break; } }

    const dur = parseDuration(line);
    let estMinutes = null;
    if (dur) { estMinutes = dur.minutes; fromSource.push('est_minutes'); line = line.replace(dur.text, ' '); }

    const tm = parseTime(line);
    const timeStr = tm ? tm.time : null;
    if (tm) line = line.replace(tm.text, ' ');

    const dl = parseDeadline(line, weekStart);
    let deadline = null;
    if (dl) {
      fromSource.push('deadline');
      deadline = `${dl.date}T${timeStr || '23:59'}`;
      if (dl.fromWeekday) flags.push(`Deadline date worked out from the weekday (${dl.text}) and the selected week.`);
      if (!timeStr) flags.push('No deadline time given; end of day (23:59) was assumed.');
      line = line.replace(dl.text, ' ');
    } else flags.push('No deadline was found in this line.');

    const title = line.replace(/\b(due|by|hạn|nop|trước|nop lúc|nop truoc)\b/gi, ' ').replace(/[\s\-_,:;()]+$/, '').replace(/^[\s\-_,:;()]+/, '').replace(/\s+/g, ' ').trim() || original.slice(0, 100);
    const taskType = guessType(title, subject);
    if (!estMinutes) flags.push('No duration in the line; a system estimate will be used (please confirm).');

    items.push({
      title, subject, task_type: taskType, instructions: null,
      est_minutes: estMinutes, est_source: estMinutes ? 'source' : 'system',
      deadline, target: null, priority: 2, review_required: 0,
      resource_link: resourceLink, work_link: null, flags, from_source: fromSource,
      applies_to: null,
    });
  }
  return items;
}

// ---------- main entry ----------
// Returns { status, items[], notes[] }. Each item is for exactly one child; "both" creates one item per child.
async function extract({ childIds, weekStart, text, fileRows = [], driveLinks = [] }) {
  const notes = [];
  let items = [];
  if (text && text.trim()) {
    items = parseText(text, weekStart);
  } else if (fileRows.length > 0) {
    notes.push('Uploaded file(s) attached as reference material. Please enter task details below.');
  }
  if (!items.length) notes.push('No tasks were found in the text. Add them manually below.');
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
  return { status: 'ok', items: out, notes, source_file_id: sourceFileId };
}

// Marks items that look like something already saved for that child, or like another item in the same batch.
function flagDuplicates(items, weekStart) {
  items.forEach((it, i) => {
    const existing = all("SELECT id, title, deadline FROM tasks WHERE child_id = ? AND cancelled_at IS NULL AND (week_start = ? OR reporting_month = ?)", it.child_id, weekStart, T.monthOf(it.deadline || weekStart));
    for (const e of existing) {
      if (similarity(e.title, it.title) >= 0.8 && (!it.deadline || !e.deadline || e.deadline.slice(0, 10) === e.deadline.slice(0, 10))) { it.duplicate_of = e.id; it.flags.push(`Possible duplicate of the saved task "${e.title}".`); break; }
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

module.exports = { extract, parseText, templateItems, flagDuplicates, similarity };
