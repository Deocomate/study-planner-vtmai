-- Study Planner – relational schema for moving the web app to a real backend.
-- Mirrors the browser data model described in web-app/docs/DATA_MODEL.md.
-- Written for SQLite; works on PostgreSQL with minor type changes (TEXT ids, BOOLEAN, TIMESTAMPTZ).
-- Dates 'YYYY-MM-DD', times 'HH:MM' (Asia/Ho_Chi_Minh). Weekday: 1 = Monday … 7 = Sunday.

CREATE TABLE people (            -- Ben, Shin and Mom (Mom has tasks but no points)
  id    TEXT PRIMARY KEY,        -- 'ben' | 'shin' | 'mom'
  name  TEXT NOT NULL,
  role  TEXT NOT NULL CHECK (role IN ('child','parent')),
  grade INTEGER
);

CREATE TABLE teachers (          -- sort_order drives list order: Vinschool first, Home (practice) last
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE subjects (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE class_blocks (      -- weekly timetable: school + extra classes ("Lịch học thêm")
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id  TEXT NOT NULL REFERENCES people(id),
  weekday    INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL,
  title      TEXT NOT NULL       -- 'Vinschool' rows are used for planning only, not shown in the Extra classes panel
);

CREATE TABLE task_series (       -- repeating practice (Everyday, Mon/Wed/Fri …); one tasks row per occurrence
  id        TEXT PRIMARY KEY,
  weekdays  TEXT NOT NULL,       -- e.g. '1,3,5'
  starts_on TEXT NOT NULL,
  ends_on   TEXT NOT NULL
);

CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  person_id   TEXT NOT NULL REFERENCES people(id),
  title       TEXT NOT NULL,
  subject     TEXT,              -- free text (matches subjects.name when picked from the list)
  teacher     TEXT,              -- free text (matches teachers.name when picked from the list)
  note        TEXT,
  work_date   TEXT NOT NULL,     -- the day it is done. Excel column "Due date" fills this (and due_date)
  due_date    TEXT,              -- deadline; Mom's tasks: due_date = work_date
  start_time  TEXT,              -- no longer shown (children arrange their own time); kept for ordering
  end_time    TEXT,
  sort_order  INTEGER,           -- order inside a day (teacher order, then subject)
  minutes     INTEGER NOT NULL DEFAULT 30,  -- not shown any more; used for points and daily load
  priority    TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high')),
  optional    INTEGER NOT NULL DEFAULT 0,
  is_repeat   INTEGER NOT NULL DEFAULT 0,   -- 1 = daily practice ("Luyện tập hằng ngày")
  series_id   TEXT REFERENCES task_series(id),
  status      TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
  done_at     TEXT,
  need_review INTEGER NOT NULL DEFAULT 0,
  review      TEXT NOT NULL DEFAULT 'none' CHECK (review IN ('none','awaiting','approved','changes')),
  feedback    TEXT,
  created_by  TEXT NOT NULL DEFAULT 'parent' CHECK (created_by IN ('parent','child'))
);
CREATE INDEX tasks_person_day ON tasks (person_id, work_date);
CREATE INDEX tasks_due ON tasks (due_date);

CREATE TABLE task_links (        -- "Link làm bài", up to 10 per task
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  url     TEXT NOT NULL,
  PRIMARY KEY (task_id, url)
);

CREATE TABLE files (             -- worksheets to print (PDF, images, Word)
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  mime_type  TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage    TEXT NOT NULL       -- object-storage key / path (in the web app: claude.ai asset id or IndexedDB key)
);
CREATE TABLE task_files (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id),
  PRIMARY KEY (task_id, file_id)
);

CREATE TABLE resources (         -- "Tài liệu": useful study links
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url  TEXT NOT NULL,
  note TEXT
);

CREATE TABLE rewards (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  emoji        TEXT NOT NULL,
  name         TEXT NOT NULL,
  cost         INTEGER NOT NULL,
  ipad_minutes INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE redemptions (       -- a child asks for a reward; parent says yes/no
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id    TEXT NOT NULL REFERENCES people(id),
  reward_name  TEXT NOT NULL,
  emoji        TEXT,
  cost         INTEGER NOT NULL,
  ipad_minutes INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  requested_at TEXT NOT NULL,
  decided_on   TEXT
);

CREATE TABLE point_adjustments ( -- manual +/- points by the parent
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id TEXT NOT NULL REFERENCES people(id),
  points    INTEGER NOT NULL,
  reason    TEXT,
  on_date   TEXT NOT NULL
);

CREATE TABLE point_rules (       -- points are computed from finished tasks, never stored per task
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  per_5_minutes    INTEGER NOT NULL,
  on_time_bonus    INTEGER NOT NULL,
  approved_bonus   INTEGER NOT NULL,
  full_day_bonus   INTEGER NOT NULL,
  ipad_cap_minutes INTEGER NOT NULL
);
