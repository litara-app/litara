# ADR-0035: Complete recordings at natural end with manual controls

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0022 accepts completion per recording/edition and title history, while thresholds, manual overrides and rereads remain open. T003 needs audio completion behavior without applying one recording’s status to alternatives.

## Decision

The user selected on 2026-11-13:

- Reaching the natural end marks that recording finished.
- Seeking near the end or backward does not itself change completion.
- Include explicit manual finish and unfinish controls.
- Defer separate reread-history controls.

No percentage threshold is selected. Completion of one recording does not finish its title’s other recordings/editions.

## Alternatives

- Manual completion only.
- A percentage threshold.
- Natural end plus manual finish/unfinish, as selected.

## Consequences

Distinguish an actual playback-end event from a position update, seek or queue change. Merely reporting an offset near duration must not fabricate completion. Preserve the ADR-0022 title history boundary; manual unfinish is not permission to delete history. The deferred reread controls do not remove the requirement to retain recording-level completion events.

## Verification

Test natural end, seek near/end/backward, pause or queue replacement, repeated completion retries, manual finish/unfinish and alternate recordings. Verify title history records the completed recording while other recordings remain unfinished. Planned for T003.

## Open questions

Completion event fields/idempotency and delayed offline completion conflicts must be specified using the revision/retry semantics selected in ADR-0040 and retained under ADR-0043. Manual unfinish must not delete title history. Separate reread-history UI remains deferred.
