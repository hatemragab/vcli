# @vcli/auth-runtime 0.1.0

Private ESM leaf package for reviewed cryptographic mechanics. Node 26.13.1–26.x
is the current contributor baseline. This package has no Nest, database, Firebase,
environment, network or logging integration. It imports maintained
[JOSE](https://github.com/panva/jose) and
[node-argon2](https://github.com/ranisalt/node-argon2) through explicit subpaths.
It does not implement JWT or password cryptography.

## Exports and selected dependencies

| Entry                         | Values                                                                      | Types                                                                                    | External runtime peer  |
| ----------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------- |
| `@vcli/auth-runtime`          | `AuthRuntimeError`                                                          | `AuthRuntimeErrorCode`                                                                   | None                   |
| `@vcli/auth-runtime/errors`   | `AuthRuntimeError`                                                          | `AuthRuntimeErrorCode`                                                                   | None                   |
| `@vcli/auth-runtime/opaque`   | `createOpaqueCapability`, `hashOpaqueCapability`, `opaqueCapabilityMatches` | `OpaquePurpose`                                                                          | None; Node crypto only |
| `@vcli/auth-runtime/password` | `ArgonPasswords`, `DEFAULT_PASSWORD_POLICY`                                 | `PasswordPolicy`                                                                         | `argon2@0.45.2`        |
| `@vcli/auth-runtime/jwt`      | `JoseAccessTokens`, `generateHs256Key`                                      | `TrustedHs256Key`, `JwtPolicy`, `JwtPolicyFacts`, `AccessTokenInput`, `AccessTokenFacts` | `jose@6.2.16`          |

Both exact peers are optional in the manifest. Local-auth output explicitly
selects its peers; Firebase opaque-only output needs neither Argon2 nor a local
JWT key. The main entry exports errors only and never imports SDK subpaths.
There are no runtime dependencies or implicit installations. Development pins
provide tools and peers solely for package verification.

The coordinator builds and vendors this private package at `tools/vcli-auth-runtime`
in generated output and selects a `file:` dependency. A registry publication,
absolute repository import or source-only symlink is not required or implied.

## Opaque capability API

```ts
createOpaqueCapability(): string;
hashOpaqueCapability(capability: string, purpose: OpaquePurpose): string;
opaqueCapabilityMatches(capability: string, expectedHash: string, purpose: OpaquePurpose): boolean;
type OpaquePurpose = 'refresh-token' | 'session-capability' | 'installation-capability' | 'action-token' | 'realtime-ticket';
```

Creation uses 32 native cryptographic random bytes (256 bits), encoded as exactly
43 canonical unpadded base64url characters. Inputs with padding, extra bytes,
invalid characters or noncanonical spare bits fail before hashing. Hashing is
SHA256 over the UTF8 prefix `vcli.auth-runtime:v1:<purpose>\0` followed by the
decoded 32 bytes. The result is 64 lowercase hexadecimal characters. Comparisons
validate this format and use native constant-time equal-length byte comparison.
This does not promise constant-time request processing or application responses.

Only hashes persist. Firebase clients create one capability for each intended
application session and reuse it across bootstrap retries. Durable uniqueness,
cutoffs, binding, expiry, atomic consumption and idempotency belong to the app.
Action subtype (reset versus verification) is also app-owned record authority:
`action-token` isolates action credentials from other runtime purposes but does
not replace that check. Hash format v1 is deliberately different from the old
reference's undomained `secretHash`; do not mix formats without an explicit
data migration or forced reauthentication/invalidation.

## Password API and immutable policy

```ts
await ArgonPasswords.create(policy?: Partial<PasswordPolicy>): Promise<ArgonPasswords>;
passwords.hash(password: string): Promise<string>;
passwords.verify(storedHash: string, password: string): Promise<boolean>;
passwords.needsRehash(storedHash: string): boolean;
passwords.verifyDummy(password: string): Promise<void>;
passwords.policy: Readonly<PasswordPolicy>;
passwords.measuredHashMs: number;
```

The policy and instance are copied/frozen. A random dummy credential is hashed
during creation; `measuredHashMs` measures that actual operation using monotonic
time, including salt/random preparation and stored-format validation. It is a
single creation observation, not a load-test, latency budget or timing guarantee.
The dummy hash/credential are not public. `verifyDummy` runs the same bounded
native verification path and returns no authentication result. The app must
map unknown-account and wrong-password outcomes consistently and avoid exposing
capacity differences through account-specific decisions.

| Policy property         | Default           | Accepted creation range |
| ----------------------- | ----------------- | ----------------------- |
| `algorithm` / `version` | `argon2id` / `19` | Fixed                   |
| `memoryCostKiB`         | 19456             | 19456–65536             |
| `timeCost`              | 2                 | 2–5                     |
| `parallelism`           | 1                 | 1–2                     |
| `hashLength`            | 32 bytes          | 32–64                   |
| `saltLength`            | 16 bytes          | 16–32                   |
| `maxConcurrent`         | 2                 | 1–2                     |
| `maxPasswordBytes`      | 1024 UTF8 bytes   | 64–4096                 |

All numeric settings must be integers. Unknown policy properties are rejected.
Passwords must be well-formed Unicode strings and fit the explicit UTF8 byte
bound. No normalization, trimming, case folding or truncation occurs. Empty
passwords and NUL are accepted by the mechanics; application credential policy
sets minimum strength/length. Ill-formed UTF16 is rejected rather than silently
replaced during UTF8 encoding. Every hash/verify/dummy path checks input first.

Before expensive verification or rehash inspection, stored records must be full,
canonical, unpadded PHC Argon2id v19 records with exactly ordered `m,t,p`, no
extra fields, at most 256 characters, memory 8×lanes–65536 KiB, passes 1–5,
lanes 1–2, salt 8–64 bytes and digest 16–64 bytes. These lower legacy bounds
allow existing weaker records to verify and be upgraded. Inflated, corrupted,
unsupported-version and noncanonical records fail with a safe storage error.

`needsRehash` combines node-argon2's m/t/p/version comparison with digest/salt
length comparison, which upstream does not perform. It reports exact configured
policy differences, including stronger old hashes; operators must review policy
changes. Rehash only after successful authentication and atomically persist it
under current credential authority. It does not write credentials itself.

One shared instance admits at most two native jobs total across hash, verify and
dummy verification; excess work fails immediately with `HASH_CAPACITY`, without
queuing. Slots release on success or failure. Default native memory cost is
38 MiB for two concurrent jobs, up to 128 MiB at the stored-record cap, plus
native/runtime overhead. This is an instance bound, not a global process,
cluster, rate-limit or health guarantee. Compose one instance per process and
measure supported-host pressure separately. Creation itself performs one hash
before the instance exists; applications should create it once during startup.

## JWT API, keys and explicit time

```ts
generateHs256Key(): Uint8Array;
new JoseAccessTokens(policy: JwtPolicy);
tokens.issue(input: AccessTokenInput): Promise<string>;
tokens.verify(token: string, now: number): Promise<Readonly<AccessTokenFacts>>;
```

`JwtPolicy` requires `issuer`, `audience`, `activeSigningKeyId`, and `keys` (1–4
`{ id, key }` entries). `maxLifetimeSeconds` defaults to 900 and accepts 1–86400;
`maxFutureIssuedSeconds` defaults to zero and accepts 0–60. No expiry skew/grace
is applied. Issuer and audience are exact nonempty labels up to 256 characters,
without spaces/control characters. IDs (key/account/session/installation) are
1–128 ASCII characters matching `[A-Za-z0-9][A-Za-z0-9._:-]*`; UUIDv4 IDs fit.
The library does not invent application IDs or enforce their database format.

Keys are exactly 32 independently random bytes from a CSPRNG. Use
`generateHs256Key` and keep key material in the app's secret manager, never in
project selection JSON. The validator rejects wrong length, fewer than 16
distinct octets, duplicate IDs, duplicate material and an unknown active key.
These checks reject obvious mistakes; no validator can establish the entropy or
independence of arbitrary supplied bytes. Do not encode passwords, human phrases
or deterministic application facts as keys. All accepted key bytes are copied;
caller mutations cannot rotate an existing instance. Frozen public policy facts
contain IDs and limits, never key material.

`AccessTokenInput` is `{ accountId, sessionId, installationId, now, expiresAt }`.
All times are explicit nonnegative safe integer epoch milliseconds within the JS
Date range and are floored to JWT seconds. Issue requires expiry strictly after
the floored issue time and within the configured lifetime. Verification returns
`{ accountId, sessionId, installationId, issuedAt, expiresAt }` in milliseconds,
with frozen facts. No ambient domain clock is used.

Only HS256 and exactly `typ: JWT` are accepted. The exact protected header is
`alg,typ,kid`; a kid can select only configured local bytes. `jwk`, `jku`, `x5u`,
certificates, arbitrary headers and algorithms are rejected; no network resolver
exists. Tokens are bounded to 4096 characters. JOSE authenticates them and checks
issuer/audience/type/expiry/required claims at the supplied time. Additional
checks require exactly `sub,sid,iid,iss,aud,iat,exp`, scalar exact issuer/audience,
bounded IDs, integer NumericDates, positive bounded lifetime, nonexpired expiry
and the configured future-issued bound. Extra claims, including `nbf` and `jti`,
are unsupported in this profile.

For planned overlap, deploy a ring accepting old and new keys with the new
active signing ID, wait for the bounded old lifetime, then deploy a new ring
without the old key on every verifier. Removal immediately rejects old tokens
in the new instance. Hard replacement and reauthentication are supported as
well. For compromise, remove the affected key from every verifier immediately,
replace it with independently random material, and apply the app's incident
revocation/reauthentication policy; do not retain it for convenient overlap.
Existing instances hold snapshots and must be replaced/restarted deliberately.
The package does not distribute keys or revoke sessions on its own.

## Safe errors and integration ownership

`AuthRuntimeError` has a fixed `code`, `name: AuthRuntimeError` and a message equal
to that code. No input, raw library error, nested cause, credential, hash, token,
key or HTTP status is retained. Unknown constructor codes become `CRYPTO_FAILURE`.

| Code                         | Meaning                                                          |
| ---------------------------- | ---------------------------------------------------------------- |
| `PASSWORD_INPUT_INVALID`     | Unicode/type/UTF8 limit failure                                  |
| `PASSWORD_POLICY_INVALID`    | Unsupported or unsafe static password configuration              |
| `HASH_CAPACITY`              | Instance admission limit reached                                 |
| `CREDENTIAL_STORAGE_INVALID` | Unsupported/malformed/inflated stored PHC record                 |
| `CRYPTO_FAILURE`             | Internal randomness/hash/sign operation failed                   |
| `JWT_POLICY_INVALID`         | Invalid local keyring/issuer/audience/limit configuration        |
| `TOKEN_INPUT_INVALID`        | Invalid issuance facts/time/lifetime                             |
| `INVALID_ACCESS_TOKEN`       | Any token verification failure, including invalid explicit clock |
| `INVALID_OPAQUE_CAPABILITY`  | Noncanonical capability encoding/length                          |
| `INVALID_CAPABILITY_HASH`    | Invalid persisted hash encoding/length                           |
| `INVALID_OPAQUE_PURPOSE`     | Unsupported domain purpose                                       |

Generated wrappers map these errors to the application's transport and public
enumeration policy. Controllers, accounts, credential versions, current durable
session/installation/binding authority, atomic refresh/action transitions,
provider lifecycle, distributed rate limits, mail, transactions, authorization,
configuration/secret loading and response redaction remain owner-controlled.
A verified JWT is cryptographic evidence only; always check current app authority.

## Patch responsibility and verification

VCLI maintainers own this package's cryptographic policy, exact peer compatibility,
release notes and advisories. Application operators own selecting the patched
local package/peers, reinstalling, checking generated wrappers, rebuilding and
deploying it. Updating the CLI or a package on disk does not remediate a running
deployment. Copied generated security policy/DB code needs its own bounded
migration or manual patch; a runtime dependency bump does not update those copies.
Version 0.1.0 is the initial private format/API; later changes must identify
affected versions, compatibility, hash/key-policy consequences and explicit
remediation. No Phase 03/09 generated-consumer acceptance follows from leaf tests.

Ordinary scripts are `npm run check`, `npm run build`, `npm test`. Tests consume
`dist`, so a coordinator build must precede runtime tests; `typecheck:tests` uses
`rootDirs` to inspect current source before build and is static evidence only.
The worker does not emit dist, install dependencies or publish. `test/password`
and `test/jwt` use actual pinned Argon2/JOSE; `test/capacity` explicitly mocks the
Argon library boundary to prove deterministic capacity/failure release, without
claiming native timing/pressure. Opaque tests forbid SDK resolution for the
main/errors/opaque paths. Coordinator evidence separately covers distribution,
native host pressure and generated application contracts.

The private 0.1.1 entrypoint also exports peer-free `AUTH_RUNTIME_VERSION` for component inventory. Existing explicit crypto subpaths remain unchanged.
