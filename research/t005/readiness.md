# T005 implementation readiness

Updated 2026-11-14. **Ready for one implementation owner; unassigned.** Use the coordinator-supplied committed checkpoint containing this brief and contract, not the older main-only source. Final checkpoint metadata is in TASKS.md and the coordinator handoff.

## Accepted scope

The user explicitly approved ADR-0065–0070: separate file-anchored ebook editions and manual completion; private revisioned annotations with retained deletion/conflict evidence; private/shared owner-edited manual and viewer-specific smart shelves; an isolated credential-free reader at one Litara address; bounded Go-based extraction; online web with recoverable pending writes; Go-served Vite/React/TypeScript/Mantine; and one end-to-end web/server owner including successor-based recording repair.

Shared/smart shelves are included. Browser offline book downloads and Android ebook adaptation are not part of T005. Metadata writers, live-provider qualification, watchers and physical NAS/Cast/Auto acceptance remain separately tracked release work, never implicitly completed by this readiness decision. CI remains disabled and 2.0.0 still requires verified personal-state migration.

## Prepared artifacts

- [Execution brief](../../handoffs/T005-assignment.md): exact scope, milestones, dependencies, non-goals and required verification/handoff.
- [API contract](../../contracts/t005/README.md): additive OpenAPI, semantic requirements and transaction/access rules.
- [Persistence boundary](../../contracts/t005/model.md), positive/negative examples, synthetic identity fixtures and 38 acceptance scenarios.
- [Fixture plan](../../contracts/t005/fixtures.md) and standard-library generator for eight tiny synthetic reader inputs. Broader licensed/synthetic corpus and real format/engine/browser proof are implementation deliverables.
- [Preparation evidence](preparation.md): explicit user choices, current upstream documentation and concrete source gaps.

## Why this owns server work

The integrated T003/T004 tree has browser auth/audio/management foundations but no ebook edition/reader/annotation/shelf APIs or tables. Its file resolver authorizes recording membership only, metadata endpoints are recording-scoped, and title completion history requires recording IDs. The T005 brief explicitly owns those extensions instead of treating reading as frontend-only work. Existing recording/auth behavior remains a compatibility constraint.

## Start conditions and verification boundary

The accepted decisions, exact contract/fixtures and complete brief remove the previously identified policy/assignment blockers. One owner must start from the exact committed preparation checkpoint in an isolated checkout and record that base in handoffs/T005.md. Supporting dependency pins and actual engine/CSP/browser integration are first-milestone work within the accepted architecture; they are not silently assumed tested.

Static preparation verification covers the ADR index, standalone OpenAPI/JSON Schema examples, route/schema uniqueness with T003/T004, auth/CSRF/admin declarations, scenario references and deterministic fixture generation. Application runtime, database transactions, parsing/isolation, codec and physical-device behavior are unverified by preparation and explicitly required from implementation. Ready to implement is not Ready to release.
