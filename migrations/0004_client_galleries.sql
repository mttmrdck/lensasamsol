-- Client-specific galleries: unguessable share links + explicit photo membership.
-- Non-destructive: only adds columns/indexes and backfills. Existing collections, photos, styles,
-- Drive references and featured selections are preserved.

-- 1. Share links. The public URL is /g/<share_token>; the slug is no longer used publicly.
--    Backfilled tokens use SQLite randomblob (128 bits); new tokens come from crypto.getRandomValues in the Worker.
ALTER TABLE collections ADD COLUMN share_token TEXT;
ALTER TABLE collections ADD COLUMN share_token_created_at TEXT;
UPDATE collections
SET share_token = lower(hex(randomblob(16))),
    share_token_created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE share_token IS NULL;
CREATE UNIQUE INDEX collections_share_token ON collections (share_token) WHERE share_token IS NOT NULL;

-- 2. Internal client label (admin-only; never sent to visitors).
ALTER TABLE collections ADD COLUMN client_name TEXT;

-- 3. Assignment mode: 'all' = folder belongs to this client (new files join automatically);
--    'selected' = shared folder, new files stay unassigned until the photographer assigns them.
ALTER TABLE collections ADD COLUMN assignment_mode TEXT NOT NULL DEFAULT 'all' CHECK (assignment_mode IN ('all', 'selected'));

-- 4. Explicit membership. Each photos row is one Drive file's membership in one gallery (metadata only;
--    originals are never copied). Replaces the old `hidden` flag, which is kept but no longer read.
ALTER TABLE photos ADD COLUMN assigned INTEGER NOT NULL DEFAULT 1;
UPDATE photos SET assigned = CASE WHEN hidden = 1 THEN 0 ELSE 1 END;
CREATE INDEX photos_collection_assigned ON photos (collection_id, assigned, sort_order);

-- 5. Folder-wide Drive buttons are off by default (a folder link can expose files outside the gallery).
UPDATE collections SET style_draft_json = json_set(style_draft_json, '$.actions.showFolderButton', json('false'))
WHERE json_valid(style_draft_json);
UPDATE collections SET style_published_json = json_set(style_published_json, '$.actions.showFolderButton', json('false'))
WHERE style_published_json IS NOT NULL AND json_valid(style_published_json);
UPDATE studio_settings SET default_style_json = json_set(default_style_json, '$.actions.showFolderButton', json('false'))
WHERE default_style_json IS NOT NULL AND json_valid(default_style_json);
