CREATE TABLE IF NOT EXISTS ref_accounts (
 id uuid PRIMARY KEY, email text, email_verified boolean NOT NULL, enabled boolean NOT NULL, created_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS ref_identities (
 key text PRIMARY KEY, account_id uuid NOT NULL REFERENCES ref_accounts(id), password_hash text,
 credential_version integer NOT NULL CHECK (credential_version>=1), enrollment_cutoff bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS ref_identities_account ON ref_identities(account_id);
CREATE TABLE IF NOT EXISTS ref_installations (
 id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES ref_accounts(id), generation integer NOT NULL CHECK (generation>0), platform text NOT NULL, created_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS ref_sessions (
 id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES ref_accounts(id), installation_id uuid NOT NULL REFERENCES ref_installations(id),
 kind text NOT NULL CHECK (kind IN ('local','firebase')), identity_key text NOT NULL REFERENCES ref_identities(key), method text NOT NULL, secret_hash text UNIQUE,
 authenticated_at bigint NOT NULL, created_at bigint NOT NULL, expires_at bigint NOT NULL, revoked_at bigint
);
CREATE INDEX IF NOT EXISTS ref_sessions_account ON ref_sessions(account_id,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS ref_refresh (
 hash text PRIMARY KEY, session_id uuid NOT NULL REFERENCES ref_sessions(id), expires_at bigint NOT NULL, consumed_at bigint
);
CREATE INDEX IF NOT EXISTS ref_refresh_session ON ref_refresh(session_id);
CREATE TABLE IF NOT EXISTS ref_actions (
 hash text PRIMARY KEY, account_id uuid NOT NULL REFERENCES ref_accounts(id), purpose text NOT NULL CHECK (purpose IN ('verification','password-reset')),
 credential_version integer NOT NULL, expires_at bigint NOT NULL, consumed_at bigint
);
CREATE TABLE IF NOT EXISTS ref_identity_rates (key text PRIMARY KEY, window_id bigint NOT NULL, used integer NOT NULL);
CREATE INDEX IF NOT EXISTS ref_identity_rates_window_id ON ref_identity_rates(window_id);
