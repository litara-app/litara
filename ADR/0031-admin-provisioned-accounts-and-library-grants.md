# ADR-0031: Admin-provisioned accounts and explicit library grants

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0013 selects local login, per-user library access and separate administrative powers. It leaves account creation, default access and administrator read access open. T003 needs these rules before implementing authorization.

## Decision

The user selected these choices on 2026-11-13:

- Administrators create user accounts; first-administrator setup is performed locally. Public self-registration is outside T003.
- New users begin with no library access.
- Administrators also need explicit library grants to read library content. Administrative capability does not itself authorize catalog/media access.

This closes those ADR-0013 questions without selecting a token protocol or expanding the first-release auth scope beyond local login.

## Alternatives

- Public registration, with or without default library grants.
- Administrator-created users with all-library defaults or an administrator read-access bypass.
- Administrator-created users and explicit grants for everyone, as selected.

## Consequences

Administrative management and library content authorization must be checked separately. A newly created administrator may manage users/grants but cannot browse, stream or download an ungranted library. A content request from an administrative workflow must not accidentally inherit a read-access bypass. OIDC remains deferred. A local bootstrap operation is required; its exact command name and input handling are routine implementation details, while any remote public setup flow would need a new decision.

## Verification

Test local first-admin creation, administrator-created users, denied self-registration, users with zero grants, and administrators denied catalog/artwork/media/download access without a grant. Grant and remove access and verify every delivery path checks the same rule. Cross-account requests must not expose another user’s reading state. Planned for T003; no auth implementation was added in this decision session.

## Open questions

Password recovery and account-management UI beyond the T003 administrative operations remain later scope. Session/token and offline behavior are now selected in ADR-0032/0033/0036/0037/0041; this record does not change those choices.
