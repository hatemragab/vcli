-- Explicit preserving lifecycle upgrade. Old bearer/action material requires reauthentication.
ALTER TABLE ref_installations ADD COLUMN IF NOT EXISTS capability_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS ref_installations_capability ON ref_installations(capability_hash) WHERE capability_hash IS NOT NULL;
ALTER TABLE ref_sessions ADD COLUMN IF NOT EXISTS installation_generation integer NOT NULL DEFAULT 1 CHECK(installation_generation>0);
ALTER TABLE ref_sessions ADD COLUMN IF NOT EXISTS enrollment_generation integer NOT NULL DEFAULT 1 CHECK(enrollment_generation>0);
ALTER TABLE ref_identities ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 1 CHECK(generation>0);
ALTER TABLE ref_identities ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE ref_identities ADD COLUMN IF NOT EXISTS methods jsonb NOT NULL DEFAULT '["password","phone","google.com","apple.com"]'::jsonb;
ALTER TABLE ref_identities ADD COLUMN IF NOT EXISTS cleanup_pending boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS ref_provider_cleanup (
 id uuid PRIMARY KEY, identity_key text NOT NULL REFERENCES ref_identities(key), generation integer NOT NULL CHECK(generation>0),
 action text NOT NULL CHECK(action IN ('revoke','delete','unlink')), method text,
 status text NOT NULL CHECK(status IN ('pending','leased','retry','unknown','completed','exhausted')),
 attempts integer NOT NULL CHECK(attempts BETWEEN 0 AND 8), next_attempt_at bigint NOT NULL,
 lease_id uuid, lease_until bigint NOT NULL, last_code text NOT NULL,
 created_at bigint NOT NULL, completed_at bigint
);
CREATE INDEX IF NOT EXISTS ref_provider_cleanup_due ON ref_provider_cleanup(status,next_attempt_at,lease_until);
-- One-time marker must be controlled by the release coordinator, not app startup.
UPDATE ref_sessions SET revoked_at=GREATEST(created_at,CAST(EXTRACT(EPOCH FROM clock_timestamp())*1000 AS bigint)) WHERE revoked_at IS NULL AND installation_id IN (SELECT id FROM ref_installations WHERE capability_hash IS NULL);
