-- Atomic sync lock + bind sessions to the current admin password hash.
ALTER TABLE collections ADD COLUMN sync_started_at INTEGER;
ALTER TABLE sessions ADD COLUMN pw_fp TEXT;
-- Existing sessions (no fingerprint) are invalidated.
DELETE FROM sessions;
