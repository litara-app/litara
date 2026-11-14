# ADR-0034: Preserve competing resume positions and ask on resume

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0015/0019 require revision-aware progress and preserve stale offline conflicts rather than choosing solely by device clocks. The user-facing resolution behavior remained open.

## Decision

On 2026-11-13 the user selected preserving both the server position and a stale offline upload, then asking which position to use when resuming. The server position is not silently overwritten by the stale upload. Until a choice is made, keep both candidates and their source context.

## Alternatives

- Silently overwrite by capture time or arrival order; incompatible with the accepted revision rule.
- Keep the server position and expose conflicts only in history.
- Preserve both and ask when resuming, as selected.

## Consequences

Resume UI must show enough recording/file/device/time context to choose meaningfully, and the local pending candidate must survive retries and restarts. User resolution must itself respect current server/content revisions. A new conflict during resolution must not overwrite a third device’s newer state. Do not invent an automatic highest-percentage rule.

## Verification

Test backward seeks as valid current-revision writes, stale offline uploads, two-device conflicts, restart with a pending candidate and a new write racing with resolution. Verify the client asks on resume rather than silently losing a candidate. Planned for T003.

## Open questions

ADR-0040 now selects revision issuance, operation-id idempotency and the 409/412 protocol; ADR-0043 selects retention without automatic pruning. Exact conflict response/UI fields and resolution request shapes must be frozen in T003 shared fixtures.
