# ADR-0066: Support private annotations and private or shared manual and smart shelves

Status: Accepted
Date: 2026-11-14
Decision owner: Repository owner
Amended by: [ADR-0107](0107-one-filter-format-for-search-and-smart-shelves.md) (2026-11-26): smart shelves use ADR-0085's filter format with more fields; "in progress" follows library search's reading status; shelves may filter on the viewer's rating; and viewers of a shared shelf receive its library rules, including IDs of libraries they cannot access.

## Context

ADR-0011 includes annotations and shelves; ADR-0015 leaves annotation deletion reconciliation unresolved. T005 has no annotation/shelf schema or API. Personal state must remain attributable for the future legacy importer (ADR-0063).

## Decision

Accepted by explicit user choices on 2026-11-14. The selected policy below was approved during T005 preparation.

On 2026-11-14 the user explicitly requested shared and smart shelves in T005, selected owner-edited/viewer-readable sharing and viewer-specific smart filters, and approved revisioned annotation edit/delete conflict retention.

Use private per-user highlights, notes and bookmarks. Administrator status does not expose other users' personal state. Both manual and smart shelves support private or shared visibility. Shared shelves are visible to signed-in users, but only the owner can edit/delete them. Manual shelves contain ordered title IDs; viewing any shelf never bypasses library grants, and inaccessible entries are omitted from titles/counts returned to the viewer. Non-owners cannot see private source membership, unavailable IDs or owner-only counts.

Smart shelves store a bounded validated filter tree over public catalog metadata and the viewing user's own progress/completion. Evaluate each shared smart shelf using that viewer's grants/state, never the owner's private state. A shared shelf therefore may contain different results for different viewers, which the UI must explain. No arbitrary SQL/scripts, external queries or annotation-text predicates. Smart membership is derived, not manually changed.

Anchor annotations to exact file/version and typed locator/range. Text highlights/notes require selectable text and verified range support; PDF highlights use normalized unrotated page rectangles; image comics support page bookmarks/notes, not invented text selections. Unsupported capabilities are visible.

Every personal-state mutation uses a client operation UUID and server revision. Stale edits/deletes return a durable conflict without applying. A deletion produces a tombstone retained indefinitely in this scope; a retry cannot recreate a deleted record. Explicit restore is not part of T005. Preserve conflicting edit content for user recovery. No clock-based last-writer-wins or automatic tombstone pruning. Shelf membership/order changes compare a shelf revision atomically; repeated operations do not duplicate membership.

## Alternatives

- Private annotations and private/shared manual/smart shelves with explicit conflicts and retained tombstones, as selected; shared/smart scope is user-selected.
- Invited shelf collaborators, requiring explicit membership and edit-conflict policies.
- Last-arrival-wins or physical deletion: simpler but can lose notes or resurrect deleted highlights.

## Consequences

Server/schema work and user-visible conflict/recovery controls belong in T005. Personal data remains isolated from the shared administrator-managed catalog. Exact request fields are contract work, not permission to expose users' notes to administrators.

## Verification

Planned: two users plus an administrator; denied cross-user reads/writes; revoked library grants; concurrent edit/delete; stale retry after tombstone; lost responses and identical operation replay; shelf reorder/membership races; format-specific highlight rendering after reload/rotation; preserved source note in conflict recovery.

## Open questions

None within T005. Retention changes beyond T005 require a later decision; no automatic deletion is authorized.
