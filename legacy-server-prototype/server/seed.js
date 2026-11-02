'use strict';
// Base data entered from the family's timetable images. Everything uncertain is flagged needs_confirmation
// so the parent sees it in the Timetables screen and can correct it.
const { get, all, run, tx } = require('./db');
const T = require('./time');
const { getSetting, setSetting } = require('./settings');

const CHILDREN = [
  { id: 'ben', name: 'Ben', color: '#3b5bdb', grade: 5 },
  { id: 'shin', name: 'Shin', color: '#c2255c', grade: 4 },
];

// [kind, title, weekday, start, end, mode, travelBefore, travelAfter, needsConfirmation, note]
const school = (child) => [1, 2, 3, 4, 5].map((d) => [child, 'school', 'Vinschool', d, '07:00', '16:30', 'offline', 0, 0, 0, null]);
const BLOCKS = [
  ...school('ben'),
  ['ben', 'class', 'Cô Linh Cindy', 6, '08:00', '10:00', 'offline', 75, 75, 1, 'Travel: 4.5 h in total including the 2-hour class, split evenly before/after (assumption). Subject not stated.'],
  ['ben', 'activity', 'Piano', 6, '14:00', '15:00', null, 0, 0, 1, 'Online or offline, and travel time, not stated.'],
  ['ben', 'class', 'Science / Math', 7, '10:30', '12:00', 'online', 0, 0, 0, null],
  ['ben', 'activity', 'Basketball / Badminton', 7, '16:00', '18:00', null, 0, 0, 1, 'Is this alternating (basketball one week, badminton the next)? Travel time not stated.'],
  ['ben', 'class', 'Writing (cô Ngô Bla)', 4, '20:00', '21:30', 'online', 0, 0, 0, null],
  ['ben', 'class', 'Debate EC', 5, '19:30', '21:30', 'online', 0, 0, 0, null],
  ...school('shin'),
  ['shin', 'class', 'Cô Linh Cindy', 3, '19:40', '21:40', 'online', 0, 0, 1, 'Assumed online (only the Saturday class needs travel). Please confirm.'],
  ['shin', 'class', 'Science (cô Giang)', 4, '18:00', '19:00', 'online', 0, 0, 0, null],
  ['shin', 'activity', 'Basketball', 7, '16:30', '18:00', null, 0, 0, 1, 'Travel time not stated.'],
  ['shin', 'class', 'Maths (cô Mẫn)', 7, '19:30', '20:30', 'online', 0, 0, 0, null],
];

// Default durations (minutes) per task type. 'cindy': long homework is split into one ~1-hour piece per day.
const DEFAULTS_TYPES = [
  ['ben', 'workbook', 45, 45, 1], ['shin', 'workbook', 60, 60, 1],
  ['ben', 'cindy', 60, 60, 1], ['shin', 'cindy', 60, 60, 1],
  ['ben', 'vinh', 90, 45, 3], ['shin', 'vinh', 90, 45, 3],
  ['ben', 'other', 60, 30, 3], ['shin', 'other', 60, 30, 3],
];

// Recurring weekly work, from the "Bài / Hạn / Mục tiêu làm xong" table. Weekdays: 1=Mon .. 7=Sun.
// [child, title, subject, type, deadlineDay, deadlineTime, targetDay, targetTime, estimate(null=default), note]
const TEMPLATES = [
  ['ben', 'Workbook Maths', 'Maths', 'workbook', 4, '07:00', 7, '20:00', null, 'Deadline Thu 07:00; aim to finish Sunday evening.'],
  ['ben', 'Workbook ESL', 'ESL', 'workbook', 4, '07:00', 7, '20:00', null, null],
  ['ben', 'Workbook Science', 'Science', 'workbook', 4, '07:00', 7, '20:00', null, null],
  ['ben', 'Writing (cô Ngô Bla)', 'Writing', 'other', 4, '20:00', 3, '21:00', null, 'Duration not given: system estimate, please confirm.'],
  ['ben', 'Debate EC', 'Debate', 'other', 5, '19:30', 4, '21:00', null, 'Duration not given: system estimate, please confirm.'],
  ['ben', 'Cô Linh Cindy homework', 'Cindy class', 'cindy', 6, '08:00', 5, '21:00', null, 'Raise the estimate if there is more work: it is split into daily 1-hour pieces.'],
  ['ben', 'Science / Math (Sunday class)', 'Science/Math', 'other', 7, '10:30', 7, '20:00', null, 'Target is the Sunday evening before the class.'],
  ['shin', 'Workbook Science', 'Science', 'workbook', 1, '07:00', 7, '20:00', null, 'Deadline Mon 07:00; aim to finish Sunday evening.'],
  ['shin', 'Workbook Maths', 'Maths', 'workbook', 4, '07:00', 7, '20:00', null, null],
  ['shin', 'Workbook ESL', 'ESL', 'workbook', 4, '07:00', 7, '20:00', null, null],
  ['shin', 'Cô Linh Cindy homework', 'Cindy class', 'cindy', 3, '19:40', 2, '21:00', null, 'Raise the estimate if there is more work.'],
  ['shin', 'Science (cô Giang)', 'Science', 'other', 4, '18:00', 3, '21:00', null, 'Duration not given: system estimate, please confirm.'],
  ['shin', 'Maths (cô Mẫn)', 'Maths', 'other', 7, '19:30', 6, '21:00', null, 'Duration not given: system estimate, please confirm.'],
];

function seedBase() {
  tx(() => {
    if (get('SELECT 1 AS x FROM children LIMIT 1')) return;
    for (const c of CHILDREN) {
      run('INSERT INTO children (id, name, color, grade) VALUES (?, ?, ?, ?)', c.id, c.name, c.color, c.grade);
      run('INSERT INTO child_settings (child_id) VALUES (?)', c.id);
    }
    for (const b of BLOCKS) {
      run(`INSERT INTO fixed_blocks (child_id, kind, title, weekday, start_time, end_time, mode, travel_before_min, travel_after_min, needs_confirmation, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...b);
    }
    for (const d of DEFAULTS_TYPES) run('INSERT INTO task_defaults (child_id, task_type, minutes, session_min, max_per_day) VALUES (?, ?, ?, ?, ?)', ...d);
    for (const t of TEMPLATES) {
      run(`INSERT INTO templates (child_id, title, subject, task_type, deadline_weekday, deadline_time, target_weekday, target_time, estimate_min, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8], t[9]);
    }
    setSetting('first_month', T.monthOf(T.todayStr()));
  });
}
module.exports = { seedBase, CHILDREN };
