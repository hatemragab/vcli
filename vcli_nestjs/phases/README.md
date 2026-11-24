# Phase workflow and dependencies

Each phase has `README.md` for design, `TASKS.md` for ordered implementation, and `ACCEPTANCE.md` for proof. Shared rules: [architecture](../docs/ARCHITECTURE.md), [decisions](../docs/DECISIONS.md), [verification](../docs/VERIFICATION.md). Read [START-HERE](../START-HERE.md) before working outside this checkout.

| Phase | Entry dependency | Exit outcome |
| --- | --- | --- |
| [00](00-design-baseline/README.md) | Planning package and owner scope | Recorded baseline, sample contract, compatibility/provenance setup |
| [01](01-project-foundation/README.md) | 00 minimal-starter decisions | Generated app installs, checks, boots, reports health |
| [02](02-safe-generation/README.md) | 01 | Safe add/generate on customized app; dev capture mail |
| [03](03-authentication-databases/README.md) | 02 | Both auth modes on both databases with shared security contracts |
| [04](04-realtime/README.md) | 03 account/session contracts | Three transports with admission, revocation, lifecycle, tested scale profiles |
| [05](05-email-push/README.md) | 03 accounts/installations; 02 mail capture | SMTP/action emails, FCM/APNs, provider/device evidence |
| [06](06-storage-media/README.md) | 03 ownership/persistence; 02 installer | Local/S3/compatible media with safe finalization |
| [07](07-diagnostics-ai/README.md) | 01 logs; implemented service sources | Retained evidence, Logdy, permission-scoped MCP |
| [08](08-deployment/README.md) | 00 feasibility; selected implemented recipes | Verified platform profiles, deploy operation, migration/restore proof |
| [09](09-upgrades-extensibility/README.md) | 02 ownership; real versioned recipes | Customized-project upgrade and independent extension proof |

Recommended order is numeric. Phases 04–06 may proceed independently after shared Phase 03 contracts stabilize. Phase 07 can begin on the early log baseline and add sources later. Deployment feasibility belongs in Phase 00; early artifact smoke checks need not wait for the full catalog. Maintenance starts in Phases 02/03; Phase 09 proves the complete upgrade workflow.

## Avoid circular gates

Phase 02 provides transport-neutral development mail capture. Phase 03 uses it for local-auth verification/reset tests. Phase 05 adds SMTP and external mail acceptance. Local auth correctness can be established before SMTP, while production email flows remain pending until Phase 05/provider setup pass.

Realtime and push do not depend on each other. Storage requires neither. Diagnostics must not be required for the app to boot or log to stdout. Deployment accepts selected services and rejects unsupported target profiles explicitly.

## Work sequence

1. Confirm authorized scope and actual standalone repository state.
2. Read entry conditions; resolve decisions needed by this work.
3. Implement a coherent task, preserving developer edits and small contracts.
4. Run meaningful checks and record actual commands/results.
5. Check tasks only when delivered; update [STATUS](STATUS.md) with evidence and gaps.
6. Continue authorized work whose entry conditions are met; ask only for missing decisions or authority.

Unavailable provider/device checks are `external_acceptance_pending`, not mock passes. Independent work may continue while the gap remains visible and blocks related support claims.

IDs use `P00-T01` and `P00-A01`. Keep them stable; new scenarios receive new IDs. Do not create a second competing tracker unless requested.
