> Historical dispatch prompts below describe earlier combined-reference work. Current authority is [the native contract](../../../NATIVE-DATABASE-CONTRACT.md) and [repository semantics](../base-repository.md); these old prompts do not restore runtime database selection.

# Orca worker prompts

These are the actual self-contained briefs used to build and review this reference. They retain task history for the owner's review; current source, AGENTS.md, the implementation contract and capability documents are authoritative. Correction briefs supersede earlier interface assumptions. None authorizes CLI implementation or external provisioning.

| Task                                                     | Prompt                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------- |
| Identity, authentication and both databases              | [Identity](identity.md)                                     |
| Media, local/S3, mail and push                           | [Storage and delivery](storage-delivery.md)                 |
| Realtime, diagnostics and operations artifacts           | [Realtime and operations](realtime-operations.md)           |
| Independent source/SOLID/security review                 | [Read-only review](independent-review.md)                   |
| Real-database integration corrections                    | [Identity database fixes](identity-integration-fixes.md)    |
| Strict test typing and transport review                  | [Realtime integration fixes](realtime-integration-fixes.md) |
| Email-proof credential establishment regression          | [Auth correction](auth-review-fix.md)                       |
| Container directory and complete release setup           | [Operations corrections](operations-review-fixes.md)        |
| Tested service pins and current capability documentation | [Final artifact alignment](service-baseline-alignment.md)   |

The owner-approved compact-module refactor used these later briefs, which supersede the original layered structure:

- [Identity and shared repositories](simplify-identity-database.md)
- [Storage and delivery services](simplify-storage-delivery.md)
- [Realtime and diagnostics services](simplify-realtime-diagnostics.md)
- [Independent final simplification review](simplification-final-review.md)
- [Indexed Mongo repository correction](simplification-mongo-index-fix.md)

Every build brief defines allowed paths, existing contracts, coding rules, public-package reuse, evidence requirements, resource/download boundaries and forbidden unrelated actions. Work used Orca supervised workers in the existing checkout with disjoint ownership, followed by coordinator integration, source review and serial acceptance. No worktree, commit, push, publication or deployment was created.
