# ADR-0013: Enforce per-user library access and start with local login

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner

## Context

Current Litara primarily has user/admin roles. BookOrbit has finer permissions and OIDC support. Access boundaries must cover more than catalog pages.

## Decision

The user selected library access per user, separate administrative powers, and local login for the first release. Defer OIDC. Personal reading state remains owned by its user.

## Alternatives

- Shared libraries with only admin/user roles.
- Per-library access plus OIDC from the first release.
- Per-library access and local login first, as selected.

## Consequences

Authorization must apply to search, covers, metadata, downloads, streams, OPDS, sync, and jobs as well as browsing. Administrative capability and library access require explicit semantics; do not silently equate one with the other. Android cached data and media references must retain account/server scope. The completed Android audit identifies existing per-server-only downloads/progress as a defect: local data and pending writes must also be isolated by account during adaptation, not retained as reference behavior.

## Verification

Planned: a user without library access cannot retrieve its entries or assets through any delivery path. One user cannot read another's annotations/progress. Test access removal and account switching in online and cached paths. Exact offline revocation limits require a later decision.

## Open questions

Default access for new users, administrator read access, session/token design, and offline revocation behavior remain open.
