CREATE TABLE IF NOT EXISTS accounts (
 id uuid PRIMARY KEY, email text, email_verified boolean NOT NULL, enabled boolean NOT NULL, created_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS identities (
 key text PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id), password_hash text,
 credential_version integer NOT NULL CHECK (credential_version>=1), enrollment_cutoff bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS identities_account ON identities(account_id);
CREATE TABLE IF NOT EXISTS installations (
 id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id), generation integer NOT NULL CHECK (generation>0), platform text NOT NULL, created_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id), installation_id uuid NOT NULL REFERENCES installations(id),
 kind text NOT NULL CHECK (kind IN ('local','firebase')), identity_key text NOT NULL REFERENCES identities(key), method text NOT NULL, secret_hash text UNIQUE,
 authenticated_at bigint NOT NULL, created_at bigint NOT NULL, expires_at bigint NOT NULL, revoked_at bigint
);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS refresh (
 hash text PRIMARY KEY, session_id uuid NOT NULL REFERENCES sessions(id), expires_at bigint NOT NULL, consumed_at bigint
);
CREATE INDEX IF NOT EXISTS refresh_session ON refresh(session_id);
-- vcli:begin email-actions
CREATE TABLE IF NOT EXISTS actions (
 hash text PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id), purpose text NOT NULL CHECK (purpose IN ('verification','password-reset')),
 credential_version integer NOT NULL, expires_at bigint NOT NULL, consumed_at bigint
);
-- vcli:end email-actions
