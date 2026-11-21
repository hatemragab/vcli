# Leaf runtime evidence

Date: 17 November 2026. Scope: initial private `@vcli/auth-runtime@0.1.0`
current source in `packages/auth-runtime`; no commit/publication is claimed.

Environment: Linux Orca VPS, Node 26.13.1, TypeScript 6.0.3, installed
`jose@6.2.16` and `argon2@0.45.2` from the coordinator-provided read-only
`node_modules` symlink. No worker downloads, dependency installation, service
startup, browser execution, package emission or shared build was performed.

Executed from this package root:

- `node --version` and `./node_modules/.bin/tsc --version`: versions above.
- Initial scoped noEmit check: failed on widened Argon2 option type, ES2023
  string library type and a test Buffer method; corrected within this package.
- Initial scoped ESLint: failed on a control-character regex; replaced with
  explicit code-point validation.
- Scoped Prettier writes: applied only within this package.
- `npm run check`: passed format, ESLint, source noEmit and test noEmit against
  current source. Test `rootDirs` resolution is static evidence only.
- A read-only TypeScript AST import/export walk checked all 12 source files:
  acyclic edges including type-only imports, at most one class per file and
  external imports limited to Node crypto/timing, JOSE and Argon2.
- Coordinator reported `npm run build --prefix packages/auth-runtime` passed
  and supplied leaf `dist`; this worker did not emit it.
- `npm test`: passed all 21 tests, zero failures/skips, using that dist and the
  actual installed JOSE/Argon2 peers. Three tests are explicitly controlled
  Argon-boundary tests; seven exercise native Argon behavior, eight exercise
  JWT/key policy and JOSE behavior, and three exercise opaque/closure behavior.
- Node reported the expected experimental module-mocking warning and a deprecated
  `namedExports` option during that run. The test now uses Node 26's `exports`
  option; scoped checks and the three capacity tests passed again afterward.

Runtime tests consume built `dist`; static and native cryptographic checks above
passed. Pack/install, generated wrapper, host-pressure, real database, Firebase
provider, mail, device and deployed acceptance remain coordinator/integration
work. This leaf does not complete Phase 03 or Phase 09.

The runtime test set includes actual Argon2 hash/verify/dummy/rehash and stored
ceiling controls; actual JOSE issue/verify/expiry/future/claims/local-key overlap,
retirement and malicious-header controls; native opaque capability checks and
optional-peer resolution denial. `capacity.test.ts` alone controls the Argon
library boundary to prove deterministic admission, release and early rejection;
it cannot establish native pressure/timing or public enumeration behavior.
