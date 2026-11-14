# ADR-0056: Require administrator status and a library grant for catalog management

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0013/0031 separate administrative powers from library read grants. T004 introduces shared catalog/import/configuration mutations that must not accidentally become available to every reader or bypass a library grant.

## Decision

The user selected the following on 2026-11-13:

- Shared catalog edits, merge/split, import approval and library configuration require both administrator status and explicit access to the affected library.
- Ordinary readers retain their own progress/history but cannot change the shared catalog.
- Do not introduce a separate per-library manager role in T004.

## Alternatives

- Add a delegated per-library manager role now.
- Permit every reader to change shared catalog state.
- Require administrator plus explicit library access, as selected.

## Consequences

Check both capabilities on submission and execution of durable catalog/import/write-back jobs. Removing a grant or administrative capability before execution must prevent unauthorized publication. Cross-library operations require the necessary grants for every affected library and must not reveal ungranted duplicate/provider results. Own-user personal state keeps its T003 ownership rules; this decision does not grant access to other users’ progress/history.

## Verification

Planned for T004: admin without grant denied, reader with grant denied catalog writes, admin with grant allowed, queued job after grant/admin removal, and multi-library merge/import boundaries. No authorization implementation was changed during this decision pass.

## Open questions

None within this record’s policy scope. Concrete interfaces/fixtures must be specified in the T004 execution brief.
