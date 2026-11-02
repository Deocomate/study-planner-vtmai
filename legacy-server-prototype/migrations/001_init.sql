-- Family Study Planner: initial schema.
-- Dates are 'YYYY-MM-DD', times 'HH:MM', date-times 'YYYY-MM-DDTHH:MM' -- all in Asia/Ho_Chi_Minh local time.
-- Timestamps ending in *_at are ISO-8601 UTC strings.

CREATE TABLE children (
  id    TEXT PRIMARY KEY,           -- 'ben' | 'shin'
  name  TEXT NOT NULL,
  color TEXT NOT NULL,
  grade INTEGER
);

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role          TEXT NOT NULL CHECK (role IN ('parent','child')),
  display_name  TEXT NOT NULL,
  email         TEXT,
  password_hash TEXT NOT NULL,
  child_id      TEXT REFERENCES children(id),
  created_at    TEXT NOT NULL,
  CHECK ((role = 'child' AND child_id IS NOT NULL) OR (role = 'parent' AND child_id IS NULL))
);

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL              -- JSON
);

CREATE TABLE child_settings (
  child_id         TEXT PRIMARY KEY REFERENCES children(id),
  home_weekday     TEXT NOT NULL DEFAULT '17:00',  -- earliest home-study time on school days
  weekend_start    TEXT NOT NULL DEFAULT '08:00',  -- earliest study time on Sat/Sun
  dinner_start     TEXT NOT NULL DEFAULT '18:00',
  dinner_end       TEXT NOT NULL DEFAULT '18:30',
  bedtime          TEXT NOT NULL DEFAULT '22:30',
  wind_down_min    INTEGER NOT NULL DEFAULT 30,    -- no study in the last N minutes before bedtime
  session_min      INTEGER NOT NULL DEFAULT 30,    -- default maximum study-session length
  break_min        INTEGER NOT NULL DEFAULT 10,    -- minimum gap between two sessions
  max_weekday_min  INTEGER NOT NULL DEFAULT 120,
  max_weekend_min  INTEGER NOT NULL DEFAULT 180,
  spare_min        INTEGER NOT NULL DEFAULT 20,    -- capacity kept free per day by the automatic scheduler
  email            TEXT,
  confirmed        INTEGER NOT NULL DEFAULT 0      -- parent confirmed these values
);

CREATE TABLE fixed_blocks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id          TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL,                 -- school|class|activity|meal|rest|other
  title             TEXT NOT NULL,
  weekday           INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),  -- 1=Monday ... 7=Sunday
  start_time        TEXT NOT NULL,
  end_time          TEXT NOT NULL,
  mode              TEXT,                          -- online|offline|NULL
  travel_before_min INTEGER NOT NULL DEFAULT 0,
  travel_after_min  INTEGER NOT NULL DEFAULT 0,
  week_parity       TEXT NOT NULL DEFAULT 'every' CHECK (week_parity IN ('every','odd','even')),
  needs_confirmation INTEGER NOT NULL DEFAULT 0,
  note              TEXT
);

CREATE TABLE task_defaults (
  child_id    TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  task_type   TEXT NOT NULL,
  minutes     INTEGER NOT NULL,        -- default estimated duration
  session_min INTEGER NOT NULL,        -- longest single session for this type
  max_per_day INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (child_id, task_type)
);

CREATE TABLE templates (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id         TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  subject          TEXT NOT NULL,
  task_type        TEXT NOT NULL DEFAULT 'other',
  instructions     TEXT,
  deadline_weekday INTEGER NOT NULL,
  deadline_time    TEXT NOT NULL,
  target_weekday   INTEGER,
  target_time      TEXT,
  estimate_min     INTEGER,            -- NULL = use the child's default for the task type
  priority         INTEGER NOT NULL DEFAULT 2,
  review_required  INTEGER NOT NULL DEFAULT 0,
  active           INTEGER NOT NULL DEFAULT 1,
  note             TEXT
);

CREATE TABLE files (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('import','submission')),
  owner_child_id TEXT REFERENCES children(id),
  original_name  TEXT NOT NULL,
  stored_name    TEXT NOT NULL,
  mime           TEXT NOT NULL,
  size           INTEGER NOT NULL,
  uploaded_by    INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL
);

CREATE TABLE tasks (
  id               TEXT PRIMARY KEY,
  child_id         TEXT NOT NULL REFERENCES children(id),
  batch_id         TEXT,                          -- groups instances created from one assignment for several children
  subject          TEXT NOT NULL DEFAULT 'Other',
  task_type        TEXT NOT NULL DEFAULT 'other',
  title            TEXT NOT NULL,
  instructions     TEXT,
  assigned_date    TEXT NOT NULL,
  week_start       TEXT NOT NULL,                 -- Monday of the intended week
  reporting_month  TEXT NOT NULL,                 -- 'YYYY-MM'
  original_month   TEXT NOT NULL,
  carried_in       INTEGER NOT NULL DEFAULT 0,
  carried_from_month TEXT,
  stats_excluded   INTEGER NOT NULL DEFAULT 0,    -- kept only for pending review; not counted in statistics
  est_minutes      INTEGER NOT NULL,
  est_source       TEXT NOT NULL DEFAULT 'parent' CHECK (est_source IN ('parent','source','system')),
  est_confirmed    INTEGER NOT NULL DEFAULT 1,
  deadline         TEXT,                          -- original deadline (never changed by rescheduling)
  target           TEXT,                          -- soft "aim to finish by" date-time
  priority         INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  depends_on       TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','done','needs_help')),
  review_required  INTEGER NOT NULL DEFAULT 0,
  review_status    TEXT NOT NULL DEFAULT 'not_required'
                   CHECK (review_status IN ('not_required','not_submitted','awaiting_review','changes_requested','approved')),
  resource_link    TEXT,                          -- exercise link
  work_link        TEXT,                          -- Google Drive work file link
  source_file_id   TEXT REFERENCES files(id) ON DELETE SET NULL,
  notes            TEXT,
  help_requested   INTEGER NOT NULL DEFAULT 0,
  completed_at     TEXT,
  cancelled_at     TEXT,
  is_demo          INTEGER NOT NULL DEFAULT 0,
  source_ref       TEXT,
  unscheduled_reason TEXT,
  version          INTEGER NOT NULL DEFAULT 1,
  created_by       INTEGER REFERENCES users(id),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_tasks_child_week ON tasks(child_id, week_start);
CREATE INDEX idx_tasks_month ON tasks(reporting_month);

CREATE TABLE sessions (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  child_id       TEXT NOT NULL REFERENCES children(id),
  seq            INTEGER NOT NULL DEFAULT 1,
  planned_date   TEXT NOT NULL,
  start_time     TEXT NOT NULL,
  end_time       TEXT NOT NULL,
  minutes        INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','done')),
  locked         INTEGER NOT NULL DEFAULT 0,
  done_at        TEXT,
  actual_minutes INTEGER,                         -- only if the child records it
  origin         TEXT NOT NULL DEFAULT 'auto' CHECK (origin IN ('auto','manual')),
  version        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_sessions_child_date ON sessions(child_id, planned_date);
CREATE INDEX idx_sessions_task ON sessions(task_id);

CREATE TABLE submissions (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  child_id     TEXT NOT NULL REFERENCES children(id),
  round        INTEGER NOT NULL,
  link         TEXT,
  file_id      TEXT REFERENCES files(id) ON DELETE SET NULL,
  note         TEXT,
  request_id   TEXT UNIQUE,                       -- idempotency key from the browser
  submitted_at TEXT NOT NULL
);

CREATE TABLE reviews (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  submission_id TEXT REFERENCES submissions(id) ON DELETE SET NULL,
  decision      TEXT NOT NULL CHECK (decision IN ('approved','changes_requested')),
  feedback      TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE help_requests (
  id          TEXT PRIMARY KEY,
  task_id     TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  child_id    TEXT NOT NULL REFERENCES children(id),
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered')),
  reply       TEXT,
  created_at  TEXT NOT NULL,
  answered_at TEXT
);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  audience   TEXT NOT NULL,                      -- 'parent' | child id
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  view       TEXT,                               -- screen to open when clicked
  dedupe_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  read_at    TEXT
);

CREATE TABLE reminder_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,                      -- daily_plan | daily_checkin | parent_summary
  recipient  TEXT NOT NULL,
  child_id   TEXT,
  run_date   TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status     TEXT NOT NULL CHECK (status IN ('pending','sent','failed','skipped','outbox')),
  attempts   INTEGER NOT NULL DEFAULT 0,
  error      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE monthly_reports (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  month                TEXT NOT NULL,
  child_id             TEXT NOT NULL REFERENCES children(id),
  data                 TEXT NOT NULL,            -- fixed JSON snapshot
  parent_comment       TEXT,
  next_month_priorities TEXT,
  created_at           TEXT NOT NULL,
  comment_updated_at   TEXT,
  UNIQUE (month, child_id)
);

CREATE TABLE monthly_resets (
  month       TEXT PRIMARY KEY,
  status      TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  policy      TEXT,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  summary     TEXT,
  error       TEXT
);

CREATE TABLE schedule_proposals (
  id         TEXT PRIMARY KEY,
  child_id   TEXT NOT NULL,
  week_start TEXT NOT NULL,
  mode       TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  applied_at TEXT
);
