-- Bind new OAuth attempts to the authenticated browser session that initiated them.
-- Existing in-flight attempts (NULL session_hash) expire safely; stored Google connections are unchanged.
ALTER TABLE oauth_states ADD COLUMN session_hash TEXT;
CREATE INDEX oauth_states_created_at ON oauth_states(created_at);

-- Records the configured administrator responsible for a session (no password material).
ALTER TABLE sessions ADD COLUMN admin_username TEXT;
