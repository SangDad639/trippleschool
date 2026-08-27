-- Manual billboard pin for the home page hero.
-- No row pinned = the storefront keeps its automatic rule (newest course,
-- tips excluded). Pinning one course overrides that until it is unpinned.

ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_billboard BOOLEAN NOT NULL DEFAULT false;

-- At most one pinned course — the API clears the others in a transaction, and
-- this index keeps that invariant true even if a row is edited directly.
CREATE UNIQUE INDEX IF NOT EXISTS courses_one_billboard
  ON courses ((is_billboard))
  WHERE is_billboard;
