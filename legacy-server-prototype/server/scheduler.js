'use strict';
// Rule-based weekly scheduler. Pure functions: no database, no clock (the caller passes `now`).
// No paid AI service is involved. The same inputs always give the same proposal.
const T = require('./time');

const GRID = 5;                       // sessions start on 5-minute marks
const roundUp = (m) => Math.ceil(m / GRID) * GRID;

// Split `total` minutes into the fewest pieces no longer than `max`, as evenly as possible (5-minute steps).
function splitMinutes(total, max) {
  if (total <= 0) return [];
  const n = Math.max(1, Math.ceil(total / Math.max(GRID, max)));
  const base = Math.floor(total / n / GRID) * GRID;
  const sizes = Array(n).fill(base);
  let rem = total - base * n, i = 0;
  while (rem > 0) { const add = Math.min(GRID, rem); sizes[i % n] += add; rem -= add; i++; }
  return sizes.filter((x) => x > 0);
}

function subtractIv(list, s, e) {
  const out = [];
  for (const iv of list) {
    if (e <= iv.s || s >= iv.e) { out.push(iv); continue; }
    if (s > iv.s) out.push({ s: iv.s, e: s });
    if (e < iv.e) out.push({ s: e, e: iv.e });
  }
  return out;
}

// Study window, fixed commitments (with travel) and daily limit for one date.
function dayModel(settings, blocks, date) {
  const wd = T.weekdayOf(date), weekend = wd >= 6, parity = T.weekParity(T.weekStartOf(date));
  const busy = [];
  for (const b of blocks) {
    if (b.weekday !== wd) continue;
    if (b.week_parity !== 'every' && b.week_parity !== parity) continue;
    busy.push({ start: T.parseHM(b.start_time) - (b.travel_before_min || 0), end: T.parseHM(b.end_time) + (b.travel_after_min || 0),
      kind: b.kind, title: b.title, classStart: T.parseHM(b.start_time), classEnd: T.parseHM(b.end_time) });
  }
  busy.push({ start: T.parseHM(settings.dinner_start), end: T.parseHM(settings.dinner_end), kind: 'meal', title: 'Dinner' });
  return {
    date, wd, weekend,
    start: T.parseHM(weekend ? settings.weekend_start : settings.home_weekday),
    end: T.parseHM(settings.bedtime) - settings.wind_down_min,
    busy, cap: weekend ? settings.max_weekend_min : settings.max_weekday_min,
  };
}

// Free intervals of a day after removing fixed commitments and already-placed sessions (padded by the break length).
function freeIntervals(day, placed, breakMin) {
  let ivs = [{ s: day.start, e: day.end }];
  for (const b of day.busy) ivs = subtractIv(ivs, b.start, b.end);
  for (const p of placed) ivs = subtractIv(ivs, p.start - breakMin, p.end + breakMin);
  return ivs.filter((iv) => iv.e > iv.s);
}

function findSlot(day, placed, len, minStart, latestEnd, breakMin) {
  for (const iv of freeIntervals(day, placed, breakMin)) {
    const s = roundUp(Math.max(iv.s, minStart));
    if (s + len <= iv.e && s + len <= latestEnd) return s;
  }
  return null;
}

// Latest allowed end (minutes into `date`) for a placement that must finish by `endKey`; null if the date is already too late.
function limitFor(date, endKey) {
  if (endKey === Infinity) return 24 * 60;
  const dayStartKey = T.keyOf(date, 0);
  if (endKey <= dayStartKey) return null;
  return Math.min(24 * 60, endKey - dayStartKey);
}

/**
 * suggest(input) -> proposal
 *  input: { child, settings, blocks, tasks, sessions, defaults, weekStart, mode: 'week'|'unfinished', now: {date, minutes} }
 *  tasks: rows from `tasks` (all of the child's tasks); sessions: rows from `sessions` (all of the child's sessions)
 *  Completed sessions and locked sessions are always preserved.
 */
function suggest(input) {
  const { child, settings, blocks, tasks, sessions, defaults, weekStart, mode, now } = input;
  const weekEnd = T.addDays(weekStart, 6);
  const today = now.date;
  const nowKey = T.keyOf(today, now.minutes);
  const firstDate = T.maxDate(weekStart, today);
  const dates = [];
  for (let d = firstDate; d <= weekEnd; d = T.addDays(d, 1)) dates.push(d);

  const proposal = { child_id: child.id, week_start: weekStart, mode, sessions: [], removed: [], unscheduled: [], warnings: [], notes: {}, days: [] };

  const inScope = (t) => !t.cancelled_at && t.status !== 'done' &&
    (mode === 'unfinished' ? t.week_start <= weekEnd : t.week_start === weekStart);
  const scope = tasks.filter(inScope);
  const scopeIds = new Set(scope.map((t) => t.id));

  // Sessions we keep: everything except planned, unlocked sessions of in-scope tasks (those get re-planned).
  const removable = sessions.filter((s) => scopeIds.has(s.task_id) && s.status === 'planned' && !s.locked);
  const removableIds = new Set(removable.map((s) => s.id));
  const kept = sessions.filter((s) => !removableIds.has(s.id));
  proposal.removed = removable.map((s) => s.id);

  const placedByDate = new Map();      // date -> [{start,end,minutes,taskId}]
  const addPlaced = (m, date, start, end, minutes, taskId) => { if (!m.has(date)) m.set(date, []); m.get(date).push({ start, end, minutes, taskId }); };
  for (const s of kept) addPlaced(placedByDate, s.planned_date, T.parseHM(s.start_time), T.parseHM(s.end_time), s.minutes, s.task_id);

  if (!dates.length) {
    proposal.warnings.push({ code: 'week_in_past', message: 'That week is over, so nothing can be planned in it. Use "Reschedule unfinished tasks" for the current week instead.' });
    for (const t of scope) proposal.unscheduled.push({ task_id: t.id, title: t.title, minutes: t.est_minutes, reason: 'The selected week is already over.' });
    return proposal;
  }

  const dayModels = new Map(dates.map((d) => [d, dayModel(settings, blocks, d)]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  // Jobs: what is still to be planned for each task.
  const jobs = [];
  for (const t of scope) {
    const credit = kept.filter((s) => s.task_id === t.id && (s.status === 'done' || (s.planned_date >= today && s.status === 'planned')))
      .reduce((a, s) => a + s.minutes, 0);
    const remaining = Math.max(0, t.est_minutes - credit);
    if (remaining <= 0) continue;
    const def = defaults[t.task_type] || defaults.other || { session_min: settings.session_min, max_per_day: 2 };
    const deadlineKey = t.deadline ? T.dtKey(t.deadline) : Infinity;
    const overdue = deadlineKey !== Infinity && deadlineKey <= nowKey;
    let targetKey = t.target ? T.dtKey(t.target) : null;
    if (targetKey !== null && targetKey > deadlineKey) targetKey = deadlineKey;
    const effective = overdue ? -Infinity : Math.min(targetKey ?? Infinity, deadlineKey, T.keyOf(weekEnd, 24 * 60));
    jobs.push({ task: t, remaining, def, deadlineKey, targetKey, overdue, effective, chunks: splitMinutes(remaining, def.session_min || settings.session_min) });
    if (!t.est_confirmed) proposal.warnings.push({ code: 'estimate_unconfirmed', task_id: t.id, message: `"${t.title}": the ${t.est_minutes}-minute length is a system estimate. Please confirm or edit it.` });
  }

  // Order: soonest effective due first, then higher priority, then longer work; dependencies always before dependants.
  jobs.sort((a, b) => a.effective - b.effective || b.task.priority - a.task.priority || b.remaining - a.remaining || a.task.title.localeCompare(b.task.title));
  const ordered = [], pending = new Set(jobs.map((j) => j.task.id));
  while (ordered.length < jobs.length) {
    const next = jobs.find((j) => pending.has(j.task.id) && !(j.task.depends_on && pending.has(j.task.depends_on) && j.task.depends_on !== j.task.id));
    const pick = next || jobs.find((j) => pending.has(j.task.id));
    ordered.push(pick); pending.delete(pick.task.id);
  }

  const lastEndOf = new Map();         // taskId -> latest end key among planned sessions (for prerequisites)
  for (const s of kept) {
    const k = T.keyOf(s.planned_date, T.parseHM(s.end_time));
    if (!lastEndOf.has(s.task_id) || lastEndOf.get(s.task_id) < k) lastEndOf.set(s.task_id, k);
  }

  const loadOf = (m, date) => (m.get(date) || []).reduce((a, p) => a + p.minutes, 0);
  const cloneMap = (m) => new Map([...m].map(([k, v]) => [k, v.map((x) => ({ ...x }))]));

  function attempt(job, occ, opts) {
    const placements = [];
    const usedDates = new Map();
    const depKey = job.task.depends_on && lastEndOf.has(job.task.depends_on) ? lastEndOf.get(job.task.depends_on) : null;
    for (const len of job.chunks) {
      const cands = [];
      for (const date of dates) {
        const lim = limitFor(date, opts.end);
        if (lim === null) continue;
        const used = usedDates.get(date) || 0;
        if (opts.spread && used > 0) continue;
        if (used >= job.def.max_per_day && !(opts.relaxPerDay)) continue;
        const day = dayModels.get(date);
        const load = loadOf(occ, date);
        const capacity = opts.useSpare ? day.cap : day.cap - settings.spare_min;
        if (load + len > capacity) continue;
        let minStart = date === today ? roundUp(now.minutes) : 0;
        if (depKey !== null) { const dayStartKey = T.keyOf(date, 0); minStart = Math.max(minStart, roundUp(depKey - dayStartKey + settings.break_min)); }
        const slot = findSlot(day, occ.get(date) || [], len, minStart, lim, settings.break_min);
        if (slot !== null) cands.push({ date, slot, load });
      }
      if (!cands.length) return { placements, failed: job.chunks.length - placements.length };
      cands.sort((a, b) => (opts.asap ? 0 : a.load - b.load) || (a.date < b.date ? -1 : 1));
      const c = cands[0];
      addPlaced(occ, c.date, c.slot, c.slot + len, len, job.task.id);
      usedDates.set(c.date, (usedDates.get(c.date) || 0) + 1);
      placements.push({ date: c.date, start: c.slot, end: c.slot + len, minutes: len });
    }
    return { placements, failed: 0 };
  }

  for (const job of ordered) {
    const t = job.task;
    const hasPreferred = job.targetKey !== null && job.targetKey > nowKey && job.targetKey < job.deadlineKey;
    const asap = job.overdue || (job.targetKey !== null && job.targetKey <= nowKey);
    const deadlineEnd = job.overdue ? Infinity : job.deadlineKey;
    const passes = [];
    if (hasPreferred) {
      passes.push({ end: job.targetKey, useSpare: false, spread: true, asap });
      passes.push({ end: job.targetKey, useSpare: false, spread: false, asap });
    }
    passes.push({ end: deadlineEnd, useSpare: false, spread: true, asap, flag: hasPreferred ? 'after_target' : null });
    passes.push({ end: deadlineEnd, useSpare: false, spread: false, asap, flag: hasPreferred ? 'after_target' : null });
    passes.push({ end: deadlineEnd, useSpare: true, spread: true, asap, flag: 'used_spare' });
    passes.push({ end: deadlineEnd, useSpare: true, spread: false, asap, flag: 'used_spare' });
    passes.push({ end: deadlineEnd, useSpare: true, spread: false, asap, flag: 'used_spare', relaxPerDay: true });

    let done = null, partial = null, usedFlag = null;
    for (const p of passes) {
      const trial = cloneMap(placedByDate);
      const r = attempt(job, trial, p);
      if (r.failed === 0) { done = { occ: trial, placements: r.placements }; usedFlag = p.flag; break; }
      if (!partial || r.placements.length > partial.placements.length) partial = { occ: trial, placements: r.placements, flag: p.flag };
    }
    const accept = done || (partial && partial.placements.length ? partial : null);
    if (accept) {
      for (const [k, v] of accept.occ) placedByDate.set(k, v);
      for (const pl of accept.placements) proposal.sessions.push({ task_id: t.id, planned_date: pl.date, start_time: T.fmtHM(pl.start), end_time: T.fmtHM(pl.end), minutes: pl.minutes });
      const endKeys = accept.placements.map((pl) => T.keyOf(pl.date, pl.end));
      const prev = lastEndOf.get(t.id) || 0;
      lastEndOf.set(t.id, Math.max(prev, ...endKeys));
    }
    const flag = done ? usedFlag : partial && partial.flag;
    if (flag === 'after_target') proposal.warnings.push({ code: 'after_target', task_id: t.id, message: `"${t.title}" could not be finished by its target time, so it is planned closer to the deadline.` });
    if (flag === 'used_spare') proposal.warnings.push({ code: 'used_spare', task_id: t.id, message: `"${t.title}" needed the spare capacity of a day to fit before its deadline.` });
    if (job.overdue) proposal.warnings.push({ code: 'overdue', task_id: t.id, message: `"${t.title}" is past its original deadline (${t.deadline.replace('T', ' ')}). The deadline is unchanged; the work is planned as early as possible.` });

    if (!done) {
      const placedMin = accept ? accept.placements.reduce((a, p) => a + p.minutes, 0) : 0;
      const left = job.remaining - placedMin;
      proposal.unscheduled.push({ task_id: t.id, title: t.title, minutes: left, reason: diagnose(job, dates, dayModels, placedByDate, settings, now, nowKey, deadlineEnd) });
    }
  }

  // Summary of every day of the range (including preserved sessions).
  for (const d of dates) {
    const day = dayModels.get(d), load = loadOf(placedByDate, d);
    proposal.days.push({ date: d, planned_minutes: load, cap: day.cap, overloaded: load > day.cap });
    if (load > day.cap) proposal.warnings.push({ code: 'overload', date: d, message: `${d}: ${load} minutes planned, above the daily limit of ${day.cap} (locked sessions may cause this).` });
  }
  proposal.notes = { unconfirmed_estimates: proposal.warnings.filter((w) => w.code === 'estimate_unconfirmed').length };
  return proposal;
}

function diagnose(job, dates, dayModels, placedByDate, settings, now, nowKey, endKey) {
  if (endKey !== Infinity) {
    const firstSlotKey = T.keyOf(dates[0], dayModels.get(dates[0]).start);
    if (endKey <= Math.max(nowKey, firstSlotKey)) return `The deadline (${job.task.deadline.replace('T', ' ')}) falls before the first available study time in this week.`;
  }
  const usable = dates.filter((d) => limitFor(d, endKey) !== null);
  if (!usable.length) return 'No study days are available before the deadline.';
  if (job.def.max_per_day * usable.length < job.chunks.length) {
    return `This kind of work allows at most ${job.def.max_per_day} session(s) per day and only ${usable.length} day(s) remain before the deadline.`;
  }
  const full = usable.filter((d) => (placedByDate.get(d) || []).reduce((a, p) => a + p.minutes, 0) + Math.min(...job.chunks) > dayModels.get(d).cap);
  if (full.length === usable.length) return 'Every available day before the deadline has reached its daily study limit.';
  return `No free time slot long enough (${Math.max(...job.chunks)} min) is left before the deadline once classes, meals, travel and breaks are taken out.`;
}

// Checks a manual placement. Returns a list of warnings (never blocks by itself).
function checkPlacement({ settings, blocks, sessions, task, session, date, start, now }) {
  const warnings = [];
  const len = session.minutes, s = T.parseHM(start), e = s + len;
  const day = dayModel(settings, blocks, date);
  const others = sessions.filter((x) => x.id !== session.id && x.planned_date === date);
  if (T.keyOf(date, s) < T.keyOf(now.date, now.minutes)) warnings.push({ code: 'in_past', message: 'This time is already in the past.' });
  for (const o of others) {
    const os = T.parseHM(o.start_time), oe = T.parseHM(o.end_time);
    if (s < oe && os < e) warnings.push({ code: 'overlap_session', message: `Overlaps another study session (${o.start_time}-${o.end_time}).` });
    else if (s < oe + settings.break_min && os < e + settings.break_min) warnings.push({ code: 'short_break', message: `Less than ${settings.break_min} minutes of break next to another session.` });
  }
  for (const b of day.busy) {
    if (s < b.end && b.start < e) warnings.push({ code: 'overlap_fixed', message: `Overlaps ${b.title} (${T.fmtHM(b.start)}-${T.fmtHM(b.end)}${b.start !== b.classStart && b.classStart !== undefined ? ', including travel' : ''}).` });
  }
  if (s < day.start || e > day.end) warnings.push({ code: 'outside_window', message: `Outside the usual study time for this day (${T.fmtHM(day.start)}-${T.fmtHM(day.end)}).` });
  const load = others.reduce((a, o) => a + o.minutes, 0) + len;
  if (load > day.cap) warnings.push({ code: 'over_limit', message: `That day would have ${load} minutes of study, above the limit of ${day.cap}.` });
  if (task.deadline && T.keyOf(date, e) > T.dtKey(task.deadline)) warnings.push({ code: 'after_deadline', message: `Ends after the deadline (${task.deadline.replace('T', ' ')}).` });
  return warnings;
}

// First free slot on `date` for `len` minutes (used when a card is dropped on a day). Returns minutes or null.
function firstFreeSlot({ settings, blocks, sessions, session, date, len, now }) {
  const day = dayModel(settings, blocks, date);
  const placed = sessions.filter((x) => x.id !== session.id && x.planned_date === date).map((x) => ({ start: T.parseHM(x.start_time), end: T.parseHM(x.end_time) }));
  const minStart = date === now.date ? roundUp(now.minutes) : 0;
  return findSlot(day, placed, len, minStart, 24 * 60, settings.break_min);
}

module.exports = { suggest, splitMinutes, dayModel, checkPlacement, firstFreeSlot, GRID };
