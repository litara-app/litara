# ADR-0032: Allow offline downloads until the next online access check

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0013 requires account/server isolation but leaves offline revocation behavior open. Android baseline defect L6 currently partitions some downloads and progress only by server. A disconnected client cannot learn about server-side access removal.

## Decision

The user selected these choices on 2026-11-13:

- Downloaded books remain playable offline until the app next contacts the server and checks current access. No periodic online lease is required for ordinary offline playback.
- Once an online check detects library access removal, the client blocks access to that library’s cached content.
- Logout immediately locks that account’s local content. Switching to another account never exposes it or sends its pending operations under the new account.

The user approved offline playback with this explicit revocation limit. This does not promise remote deletion or cryptographic revocation of bytes already downloaded.

## Alternatives

- Require a periodic online lease, preventing long offline trips once it expires.
- Permit offline playback until the next online access check, as selected.
- Delete all cached content on logout instead of locking it; not selected.

## Consequences

Preserve local content, progress, metadata, restore state and pending writes under server/account scope; lock the signed-out scope immediately. Network failure alone does not prove revoked access. Before accepting new online content operations, validate current authorization; when a check definitively rejects access, stop affected playback/download operations and hide or lock those resources. Do not auto-delete downloaded bytes or unsent personal progress merely because access is lost. Retention and deletion remain separate choices. The scope of local locking is application access, not protection against an operator extracting files outside the app.

## Verification

Write an L6 regression that fails against the imported baseline: account A’s dirty progress/download/cache cannot be read or submitted as B. Test offline playback without timed lease, online detection of revoked library access, immediate logout locking, account switching during active requests and downloads, and network failure preserving local state. Planned for T003; hardware/offline runtime behavior has not been tested in this decision session.

## Open questions

ADR-0043 now selects no automatic pruning of locked account data or sync evidence during T003. Explicit deletion/retention policy remains production follow-up. Native session limits and revision conflicts are separately selected in ADR-0033/0034/0036/0040/0041.
