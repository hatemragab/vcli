# Selected capability integration

- auth: auth.local
- database: database.mongodb
- diagnostics: diagnostics.local
- foundation: foundation.nest
- media: media.private
- notes: example.notes
- storage: storage.local

- Configure MongoDB replica set or sharded transactional topology; initialize selected schemas before boot.
- Supply private JWT_KEYS_JSON and JWT_ACTIVE_KID with independently generated keys. Retain overlap keys through token and backup lifetimes; clients singleflight refresh and reauthenticate after an ambiguous response.
- Provide a private writable durable local storage directory.

- Username/password authentication has no email verification or forgotten-password recovery. No email ownership is claimed; authenticated current-password change is available.
- Storage emits only the selected transfer modes. Named AWS/R2 provider acceptance and permissions remain separate; arbitrary custom S3 profiles are unsupported.
- Diagnostic evidence is bounded, sanitized and may contain gaps. Restricted remote reads require a private scoped profile and independently verified HTTPS boundary; isolated/shared-production profiles are unsupported.
