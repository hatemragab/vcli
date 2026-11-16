# Phase 08 — Deployment artifacts and operations

**Status: Planned — implementation not started.** All platform profiles, operators, state guarantees, and recovery procedures below require implementation and evidence. No deployment or provider compatibility is established here.

Read [START-HERE](../../START-HERE.md), [phase status](../STATUS.md), [product scope](../../docs/PRODUCT.md), [architecture](../../docs/ARCHITECTURE.md), [decisions](../../docs/DECISIONS.md), and [verification](../../docs/VERIFICATION.md). Use [TASKS.md](TASKS.md) and [ACCEPTANCE.md](ACCEPTANCE.md) together.

## Outcome and prerequisites

Generate reviewable deployment artifacts and runbooks for Dokploy, Coolify, and CapRover, accounting for the application's selected services and durable state. Keep artifact rendering independent from authenticated platform operations. Dokploy is the first API-apply implementation reference; Coolify and CapRover operators remain explicit planned deliverables until actually implemented and verified. Sequencing does not remove any requested target or imply cross-platform acceptance.

Phase 00 and the foundation phase already establish supported toolchain versions, a viable reproducible container/release shape, configuration boundaries, and health/shutdown contracts. This phase specializes those decisions rather than discovering basic container feasibility late. Database, realtime, storage, and diagnostics recipes supply deployment requirements. Reverify current official platform behavior and version constraints before implementation; historical source examples are extraction inputs, not approved universal recipes.

## Contracts and service plan

`DeploymentArtifactRenderer` translates a validated, realized application/service plan into target files, variable mappings, and instructions without platform credentials or hidden network mutations. `DeploymentOperator` separately discovers, applies, and verifies supported resources through deliberately invoked authenticated operations. An artifact-only profile must not claim automated provisioning. Diagnostic readers receive neither operator credentials nor mutation capabilities.

The service plan is a finite description of selected services, images, commands, ports, ingress, WebSocket/proxy requirements, secret references, health dependencies, volumes, and release jobs. Dependencies can be bundled or explicitly preprovisioned/external. Account for API, workers, scheduler ownership, database, appropriate Redis roles, Centrifugo, storage, Vector, Logdy, and evidence backend when selected. Validate references and unsupported combinations before writing/applying output.

This plan is not a replacement orchestrator: no continuous VCLI controller, cluster scheduler, custom autoscaler, or universal repair loop. Delegate deployment lifecycle to platform-native facilities. Likewise, local development wrappers delegate watching/services to Nest scripts and Compose/native tooling; they are not a production process supervisor.

## Target profiles and output

Maintain separate support rows for target/version, artifact format, dependency mode, operator implementation, and acceptance evidence. One unchanged Compose file cannot describe every platform's semantics.

| Target | Required profile behavior |
| --- | --- |
| Dokploy | Render supported application/Compose/Stack configuration with explicit runtime environment injection, volume semantics, ingress, and release procedure. Implement authenticated API apply first using tested platform behavior. |
| Coolify | Render the chosen source/image/Compose path and its native settings/runbook. Validate persistence, replacement, readiness, variables, and release behavior for that path. Keep its operator pending until separately verified. |
| CapRover | Start with a supported app/container profile plus explicit external or preprovisioned dependencies. Generate its app entry artifact and native configuration/runbook; reject unsupported topology early. Add supported native dependency provisioning recipes deliberately instead of pretending arbitrary Compose is preserved. |

Proposed generated output includes a selected container recipe, `ops/deploy/<target>/` artifacts and runbook, private-variable checklist, release/migration commands, state/backup inventory, and verification instructions. Shared production examples contain names and safe placeholders only. Exact filenames and platform fields become contractual after tests. No template copies private environment values, service accounts, domains, deployment tokens, or credentials from the extraction project.

## Configuration and release workflow

Use the shared conditional configuration schema to produce development/production examples and platform variable mappings. Explicit injected environment overrides a selected private file; safe code defaults apply only where declared. Production may operate entirely from injected secret references. Preserve existing private values; generate missing application-owned secrets only during explicit setup. Exclude private files from source control/build context and avoid secrets in image layers, build arguments, plans, and diagnostics.

Plan first: bind project/environment, capability/recipe versions, target resource identities, image digest/release identity, ingress, volumes, dependencies, migrations, and expected current settings. Show unresolved external setup. Rendered files do not create accounts, DNS, services, or credentials. Apply rechecks relevant preconditions and requires a supported target profile and appropriate authority.

Use one dedicated release migration command/coordinator with database-native locking/history or equivalent reviewed controls. Do not execute migrations independently on every application boot or promise global exactly-once execution. Coordinate concurrent releases, preserve acknowledged migration history, and reconcile uncertain outcomes before retries. Reject unsupported Mongo transaction topology; SQL migrations use the selected adapter's approved tooling. Expand/contract compatibility and failures belong in the runbook.

Start/replace through native platform behavior, then verify identified services, readiness, routes, selected realtime interaction, and release identity. Image build, process start, and useful application behavior are different evidence. Operators record created/reused resource IDs and completed steps. If provisioning times out, discover whether the original operation succeeded before repeating it. Stale settings require a refreshed plan; partial apply is reported, not disguised as success or reversed through broad deletion.

## State, permissions, and failure behavior

Persist database and local uploads explicitly; retain stable volume identities across redeployment. Keep internal database/cache/provider/diagnostic APIs private by default, expose only required ingress, and run non-root application containers. Generate appropriate resource/body limits, graceful termination, liveness/readiness, and dependency timeouts. Host-specific resource policies are contributor/profile settings, not universal downstream assumptions.

Multiple replicas require evidence for shared storage, publication/fan-out, session revocation, worker/scheduler ownership, and selected proxy routing/stickiness. A local filesystem volume attached to one node is not shared storage. One successful replica does not certify scaling. Select persistent cache/queue policies intentionally rather than sharing conflicting Redis roles silently.

Record backup owner, frequency/retention, encryption/access requirements, consistent database/object-state coverage, and restore instructions. Exercise restore into isolated state before advertising a backup recipe. Application image rollback does not reverse migrations or recover deleted data. Ordinary stop/redeploy never drops databases, rotates credentials, or recreates volumes; destructive reset is a separate identified action.

Define errors for unsupported profile/version/topology, missing configuration/authority, stale plans, failed migrations, uncertain apply, failed readiness, and incomplete verification. Preserve useful sanitized recovery information without automatic destructive compensation. Open decisions include platform API/authentication mechanisms, image registry, secret references, migration locks, backup backend, and supported scale profiles. Keep pending target/operator rows visible until their own acceptance passes.
