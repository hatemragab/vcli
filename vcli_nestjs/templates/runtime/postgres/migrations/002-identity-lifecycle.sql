-- Explicit preserving lifecycle upgrade. Old bearer/action material requires reauthentication.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS capability_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS installations_capability ON installations(capability_hash) WHERE capability_hash IS NOT NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS installation_generation integer NOT NULL DEFAULT 1 CHECK(installation_generation>0);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS enrollment_generation integer NOT NULL DEFAULT 1 CHECK(enrollment_generation>0);
ALTER TABLE identities ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 1 CHECK(generation>0);
ALTER TABLE identities ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE identities ADD COLUMN IF NOT EXISTS methods jsonb NOT NULL DEFAULT '["password","phone","google.com","apple.com"]'::jsonb;
ALTER TABLE identities ADD COLUMN IF NOT EXISTS cleanup_pending boolean NOT NULL DEFAULT false;
-- vcli:begin provider-cleanup
CREATE TABLE IF NOT EXISTS provider_cleanup (
 id uuid PRIMARY KEY, identity_key text NOT NULL REFERENCES identities(key), generation integer NOT NULL CHECK(generation>0),
 action text NOT NULL CHECK(action IN ('revoke','delete','unlink')), method text,
 status text NOT NULL CHECK(status IN ('pending','leased','retry','unknown','completed','exhausted')),
 attempts integer NOT NULL CHECK(attempts BETWEEN 0 AND 8), next_attempt_at bigint NOT NULL,
 lease_id uuid, lease_until bigint NOT NULL, last_code text NOT NULL,
 created_at bigint NOT NULL, completed_at bigint
);
CREATE INDEX IF NOT EXISTS provider_cleanup_due ON provider_cleanup(status,next_attempt_at,lease_until);
-- vcli:end provider-cleanup
-- One-time marker must be controlled by the release coordinator, not app startup.
UPDATE sessions SET revoked_at=GREATEST(created_at,CAST(EXTRACT(EPOCH FROM clock_timestamp())*1000 AS bigint)) WHERE revoked_at IS NULL AND installation_id IN (SELECT id FROM installations WHERE capability_hash IS NULL);
