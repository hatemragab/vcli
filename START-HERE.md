# Start work in the VCLI repository

The CLI source under `src/` is the current implementation. Planning documents, phase task lists and files under `docs/archive/` and `docs/agent-prompts/` are historical or local review context. Ignored evidence under `var/` is local and is not a phase result. Hosted provider, device and deployment acceptance remain pending. Do not start new work at Phase 00.

## Task to file to check

| Task | Start here | Check |
| --- | --- | --- |
| Change an init choice or default | `src/commands/generation-workflows.ts`, `src/commands/selection-options.ts`, `src/recipes/catalog.ts` | `node --test test/cli.test.ts` after `npm run build` |
| Diagnose a write, drift or recovery | `src/engine/planning.ts`, `src/engine/apply-plan.ts`, `src/engine/recovery.ts` | `node --test test/engine.test.ts` |
| Change generated username auth | `src/recipes/render-identity.ts`, `templates/runtime/common/src/modules/identity/username-credentials.service.ts` | `node --test test/username-rendering.test.ts` |
| Follow a note request | generated `src/modules/notes/notes.controller.ts`, service, entity | `node --test test/notes-example-runtime.test.ts` |
| Trace a runtime failure | generated `src/main.ts`, `src/create-app.ts`, `src/modules/diagnostics/diagnostic-reader.service.ts` | `node --test test/cli-operations.test.ts` |
| Explain one generated file | `vcli explain <path>` | owner, renderer and the printed check |
| Validate private config | `vcli config check --config-file <file>` | names and the next command only |
| Find a request | `vcli logs query --request-id <uuid>` | retained reader, after `npm run build` |

`npm test` uses the built `dist`. An installed-bin check runs `./bin/vcli.mjs` and is the one that can see Node flag handling. Direct handler tests cannot.

Prepared 16 November 2026. Status: standalone repository containing the planning package and owner-authorized independent hand-built references under `examples/reference-api` (MongoDB) and `examples/reference-api-postgres` (PostgreSQL); the private CLI and selected catalog are implemented, with local acceptance and pending external resources recorded per profile.

## Repository setup

The planning package has been copied into the root of its own `vcli` repository, with an independent Git history. This directory contains `AGENTS.md`, `docs/`, and `phases/`; begin work here. The original SuperUp checkout and planning copy are preserved.

Only the planning documents were transferred. SuperUp Git history, application projects, environment files, provider credentials, private chat history, memories, local caches, containers, and global agent settings are not part of this repository. The owner authorized this repository setup and private GitHub publication separately from CLI implementation.

The repository is named `vcli`. The npm package name and scope are still an owner decision; private GitHub hosting does not select an npm distribution policy or imply that `vcli` is available on a registry.

## Read in this order

1. [README.md](README.md): scope and navigation.
2. [AGENTS.md](AGENTS.md): standalone contributor rules.
3. [PRODUCT.md](docs/PRODUCT.md): full requested scope and phase mapping.
4. [DECISIONS.md](docs/DECISIONS.md): current recommendations, rationale, and unresolved decisions.
5. [ARCHITECTURE.md](docs/ARCHITECTURE.md): shared implementation contracts.
6. [VERIFICATION.md](docs/VERIFICATION.md): evidence, compatibility, and phase completion rules.
7. [Phase index](phases/README.md) and [status board](phases/STATUS.md).
8. The selected phase's `README.md`, `TASKS.md`, and `ACCEPTANCE.md`.

The archived original proposal is optional background. The active documents carry the requirements and current recommended design independently; an engineer does not need the old project or chat transcript.

## What exists and what does not

This package provides design contracts, task order, failure cases, and acceptance requirements for every phase. The separate MongoDB and PostgreSQL projects under [examples](examples/README.md) are owner-authorized hand-built expected-output references. Each contains one native database; package manifests, implementation and recorded checks belong to that individual reference. Native database, HTTP/protocol and browser/restart acceptance passed separately in each reference; earlier combined-catalog checks remain historical. It is not CLI-generated output or proof of CLI phase completion. The repository now contains the private CLI, selected runtime templates, narrow authentication workspace and native operations; it has no published npm release or generated production deployment. Read the reference's own verification record for actual runtime evidence.

Commands listed by the current CLI --help are executable. Service/operator/maintenance commands follow their recorded profile and acceptance limits; planning examples alone do not make them executable. Phase 00 is historical baseline context. Current dependency pins live in the repository manifests.

## First implementation session

Confirm that the working directory is the standalone VCLI repository and inspect its current instructions and Git status. Do not begin in the SuperUp application directories. If the destination has changed since this package was prepared, preserve those changes and reconcile the plan with the actual source.

Use the task map above for current CLI work. [Phase 00](phases/00-design-baseline/README.md) records the accepted baseline and is historical. Do not claim a design review completed merely because the tasks were written.

The first code milestone is [Phase 01](phases/01-project-foundation/README.md), followed by [Phase 02](phases/02-safe-generation/README.md). It must prove a minimal generated application and a safe incremental addition before the larger provider catalog.

Create only the directories needed for the active work. A possible future source layout appears in the architecture document; it is not an instruction to create every package or feature upfront.

## Launch prompt for another engineer or agent

Copy this prompt and replace the scope line with the phase or phases actually authorized:

```text
You are working in the standalone VCLI repository.

Authorized scope: [for example, complete Phase 00 design baseline only; or,
after its recorded gate, implement Phases 01 and 02].

Read AGENTS.md, START-HERE.md, docs/PRODUCT.md, docs/DECISIONS.md,
docs/ARCHITECTURE.md, docs/VERIFICATION.md, phases/STATUS.md, and the selected
phase's README.md, TASKS.md and ACCEPTANCE.md.

Verify the actual repository and environment. This planning package is not
evidence that source, scripts, provider accounts, or deployments already exist.
Use the recorded implementation baseline; identify material unresolved choices.
Keep provider choices extendable through small contracts. Preserve one
handwritten class per file and the documented owner boundaries.

Work only within the authorized scope. Track completed tasks and actual
acceptance evidence. Keep local/fake/provider/device/deployed results distinct.
Do not silently remove unfinished providers from target scope, invent passing
tests, copy credentials, modify an unrelated product, or publish/deploy without
authorization for those actions.

At completion, report files changed, commands actually run, test results,
remaining gaps, and the next eligible phase. Do not ask for approval again
for work already authorized; ask only for material missing decisions or
permissions that are actually required.
```

## Status and evidence updates

Task IDs use `P03-T01`; acceptance IDs use `P03-A01`. These are planned items until implementation supplies evidence. Check a task only after its deliverable exists. Link acceptance results to an identified revision, environment, command/run, and sanitized artifact.

A phase may be implemented locally while external provider/device acceptance remains pending. It is not fully verified in that case. Later independent work can proceed when its documented entry conditions are satisfied and the user authorized it, but the missing acceptance remains visible and blocks related support claims.

## Local operating constraints

Engineers must use the current host's resource policy. For Hatem's present Orca VPS, the host rules include the shared 8 GiB budget, bounded workspace containers under the configured cgroup, at most two concurrent Playwright sessions, and authorization before a download batch exceeds 500 MB. Those are host constraints, not universal defaults to insert into generated NestJS projects. A physical phone or Mac-only build requires actual access to that machine/device.

Do not transfer machine secrets or tools to make this document portable. Record missing infrastructure as setup requirements and use explicit development test doubles only where the phase permits them.
