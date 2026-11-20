-- ARCHIVE gallery — initial schema.
-- Originals live in Google Drive. This database stores metadata only.

CREATE TABLE studio_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  studio_name TEXT NOT NULL DEFAULT 'Studio',
  intro TEXT,
  contact_url TEXT,
  contact_label TEXT,
  homepage_enabled INTEGER NOT NULL DEFAULT 1,
  default_style_json TEXT,
  updated_at TEXT NOT NULL
);

INSERT INTO studio_settings (id, studio_name, homepage_enabled, updated_at)
VALUES (1, 'Studio', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- Admin sessions. Only a SHA-256 hash of the random cookie token is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX sessions_expires ON sessions (expires_at);

-- Login throttling (per client IP).
CREATE TABLE login_attempts (
  ip TEXT NOT NULL,
  attempted_at INTEGER NOT NULL,
  success INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX login_attempts_ip ON login_attempts (ip, attempted_at);

-- Short-lived OAuth state + PKCE verifier.
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Single Google connection. Tokens are AES-GCM encrypted with TOKEN_ENCRYPTION_KEY (never plaintext).
CREATE TABLE google_connections (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT,
  scopes TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  access_token_enc TEXT,
  access_expires_at INTEGER,
  connected_at TEXT NOT NULL,
  last_checked_at TEXT,
  last_error TEXT
);

CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  event_date TEXT,
  location TEXT,
  source TEXT NOT NULL CHECK (source IN ('drive', 'demo')),
  drive_folder_id TEXT NOT NULL,
  drive_resource_key TEXT,
  drive_folder_name TEXT,
  folder_access TEXT NOT NULL DEFAULT 'unknown' CHECK (folder_access IN ('anyone_with_link', 'restricted', 'unknown')),
  cover_photo_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  homepage_visible INTEGER NOT NULL DEFAULT 1,
  style_draft_json TEXT NOT NULL,
  style_published_json TEXT,
  style_draft_updated_at TEXT,
  style_published_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'never' CHECK (sync_status IN ('never', 'syncing', 'synced', 'partial', 'error')),
  sync_error TEXT,
  last_synced_at TEXT,
  photo_count INTEGER NOT NULL DEFAULT 0,
  hidden_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);
CREATE INDEX collections_status ON collections (status, homepage_visible);

CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
  drive_file_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  dims_known INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  featured_order INTEGER,
  source_version TEXT NOT NULL,
  modified_time TEXT,
  view_url TEXT,
  resource_key TEXT,
  demo_asset TEXT,
  demo_credit TEXT,
  unavailable INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (collection_id, drive_file_id)
);
CREATE INDEX photos_collection_order ON photos (collection_id, hidden, sort_order);

CREATE TABLE sync_runs (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
  trigger TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'error')),
  added INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  renamed INTEGER NOT NULL DEFAULT 0,
  unchanged INTEGER NOT NULL DEFAULT 0,
  skipped_unsupported INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX sync_runs_collection ON sync_runs (collection_id, started_at);
