# ADR-0082: Keep the versioned API compatible, and enforce it mechanically

Status: Accepted
Date: 2026-11-20
Decision owner: Repository owner
Amended by: [ADR-0108](0108-schema-names-in-api-compatibility.md) (2026-11-26): published schema names are part of the `v1` promise; renaming, adding or removing the name of a schema where a client already reaches it is breaking.

## Context

ADR-0009 commits Litara to a documented, versioned API open to third-party clients, and leaves the compatibility policy open. The API is served under `/api/v1`, `GET /api/v1/discovery` lists `apiVersions`, and the generated OpenAPI is compared with the contract files, but nothing stops a change from breaking a client that was written against an earlier shape. The owner's requirement is that third-party clients must never be broken by an ordinary change. Self-hosted servers are upgraded on their owners' schedules and third-party apps lag behind servers, so the commitment has to hold mechanically and not by review.

## Decision

The user selected the defaults below, the 12-month support window, and a security exception to it with a 90-day minimum, and ledger removal after the window, on 2026-11-20.

- **What counts as breaking.** Within `v1`, only additive change is allowed: new endpoints, new optional request parameters and properties, new response properties, new response status codes for new conditions, and new enum values. Breaking is anything else: removing or renaming a path, operation, `operationId`, parameter or property; changing a type, format or location; making an optional request field required or adding a required one; narrowing what a request accepts (removing an enum value, tightening a length, range, pattern or size limit); making a response property optional or removing it from a response; changing or removing a success status; and changing or adding security requirements. A breaking change needs a new major version served beside the old one (`/api/v2`). Clients must ignore unknown response properties and unknown enum values; this is part of the contract.
- **When it stops being "development".** The API is `development` until the first tagged release. During development a breaking change is refused unless a recorded waiver names it and gives a reason; waivers are listed in the repository and the check fails on a waiver that no longer applies. Releasing freezes the version (below), after which waivers are not permitted and the check cannot be bypassed.
- **Support window.** When a new major version (`/api/v2`) is released, the previous major keeps working, unchanged, for at least 12 months after that release. From the day the new major is released, every route of the old major carries the `Deprecation` and `Sunset` response headers (the Sunset date is no earlier than 12 months after release) and discovery reports the old major's end date. Nothing in the old major is removed or changed before that date, and the compatibility check keeps guarding it until the old major is actually retired.
- **Security exception.** The window may be shortened for a security fix that cannot be made compatible, but never below 90 days from the day the shortened `Sunset` date is published. The user selected the exception and the 90-day minimum; the user confirmed these conditions: the shortened `Sunset` date is published in the headers and in discovery as soon as the fix is decided, only the affected operations are affected, and the reason is recorded in the repository.
- **Retiring a version.** Once an old major's `Sunset` date (12 months, or the shortened date for a security fix) has passed and the server no longer serves it, its releases may be removed from the ledger, together with their snapshots, in one explicit change; until then every release stays in the ledger and the check keeps guarding it. The removal is a deliberate operator command, never a side effect, and the tooling for it is built when the first major version is retired.
- **Enforcement.** The generated OpenAPI document is checked against committed snapshots by a structural comparison that understands the rules above, as part of `go test ./...` (GitHub Actions stay off under ADR-0064, so nothing depends on CI). Every released API version is an immutable snapshot, listed with its SHA-256 in a ledger; the current API must be backward compatible with every snapshot in the ledger, so a break cannot be hidden by editing the newest one. A change to the surface that is not breaking still has to be recorded by regenerating the baseline, so each API change appears in the diff. The `info.version` of the generated document and the `apiVersion` and `stability` that discovery reports come from one recorded state, so they cannot drift apart. Releasing an API version is an explicit operator command that writes the snapshot and ledger entry.

## Alternatives

- Treat added enum values in responses as breaking (stricter, as some diff tools do). Rejected here because it would make most useful changes impossible; clients are instead required to tolerate unknown values.
- Review-only enforcement, or a CI-only check. Rejected: Actions are off, and review misses breaks.
- Version by date header instead of by path. Not chosen; `/api/v1` is already in use.

## Consequences

Every future API change is either additive and recorded, or it is a new major version. Developers cannot remove or rename something a released client could use. Pre-release breaking changes remain possible but are visible and justified. A second major version, once it exists, doubles what the server maintains for as long as the support window runs.

## Verification

The comparison has table tests for every rule above (each breaking case fails; each additive case passes). The repository test fails when the generated API is not backward compatible with the baseline and every released snapshot, when a snapshot was altered, when the baseline is stale, when a waiver is unused or present after release, and when discovery or `info.version` disagrees with the recorded state.

## Open questions

None.
