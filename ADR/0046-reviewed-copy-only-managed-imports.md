# ADR-0046: Copy verified managed imports after explicit review

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0004 accepts existing-folder scanning plus optional managed imports, but leaves copy/move, approval and collision behavior open. T004 must avoid treating a watched-folder arrival as permission to relocate or overwrite user files.

## Decision

The user selected the following on 2026-11-13:

- Managed imports copy into Litara-managed storage and retain the source. Verify copied content before publishing it; destructive move imports are deferred.
- Require a review showing proposed grouping and destination paths before publication; bulk approval is allowed. Watched-folder arrivals are not automatically approved. Existing-folder scans remain automatic and non-destructive.
- Warn about byte-identical duplicates and let the user skip or explicitly keep another copy. Never delete or merge them automatically.
- Never overwrite a destination-name collision. Offer a deterministic numbered suffix and show it before approval.

## Alternatives

- Support destructive moves immediately.
- Automatically publish confident arrivals or skip duplicates without user choice.
- Copy/verify and review, with explicit duplicate choices and visible collision suffixes, as selected.

## Consequences

A review is permission for the concrete plan, not for a silently changed destination/grouping/duplicate decision. Revalidate destination existence and source content before executing; changed plans return for review. Copy under durable job supervision into staging, verify bytes, then publish a complete result; a restart must neither lose the source nor expose partial media as ready. Destination claims/collision suffix allocation must be concurrency-safe. A still-present byte-identical source is a duplicate, not a missing-file rename under ADR-0044. Duplicate warnings must not reveal ungranted libraries.

## Verification

Planned for T004: source retained unchanged, failed/interrupted copy, restart recovery, duplicate skip/keep, concurrent destination collisions, suffix preview, changed source/plan after approval, bulk approvals and watched-folder arrivals waiting for review. No runtime behavior was implemented/tested in this decision session.

## Open questions

ADR-0054 now selects per-library modes/templates and naming; ADR-0053 covers reviewed sidecar export; ADR-0051/0057 govern optional-backup metadata write-back. Managed-import staging/publication and review-plan schemas must be specified without destructive moves or source deletion.
