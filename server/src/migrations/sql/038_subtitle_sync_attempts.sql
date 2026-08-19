-- Audit trail for subtitle fetching.
-- A whole-site sync failure once left no trace at all: every failure reason
-- collapsed into one message and nothing was logged, so "why did it fail for me
-- but work for you?" was unanswerable. One row per lesson, overwritten on each
-- attempt, keeps the last outcome (success or failure, with its reason) visible
-- in the admin dialog.

CREATE TABLE IF NOT EXISTS subtitle_sync_attempts (
  id SERIAL PRIMARY KEY,
  lesson_id INTEGER NOT NULL UNIQUE REFERENCES lessons(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL,       -- ok | no_captions | too_short | failed
  reason VARCHAR(40),                -- no_captions | unavailable | blocked | http_error | timeout | empty | db_error
  detail TEXT,                       -- YouTube's reason text / HTTP status
  chars INTEGER,
  language VARCHAR(10),
  attempted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  attempted_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subtitle_attempts_course ON subtitle_sync_attempts(course_id);
