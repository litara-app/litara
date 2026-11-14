# ADR-0022: Track completion per edition or recording and retain title history

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner

## Context

Titles can contain translations and multiple recordings. Marking every related edition complete after finishing one would erase meaningful distinctions and complicate rereads.

## Decision

The user selected completion per edition/recording. Roll completed reads/listens into the title's history without marking every edition/recording finished. Precise file locations remain separate from completion and history.

## Alternatives

- Mark the title and all editions/recordings finished together.
- Store only title-level status.
- Separate edition/recording completion with title history, as selected.

## Consequences

An unfinished alternate recording can remain available even after another was completed. Rereads/listens need distinct history entries. Title history aggregation is not a rule that forces one status onto every child. Moving backward in a recording does not by itself define whether to undo a completed read.

## Verification

Planned: finish one of two recordings and verify the other remains unfinished; show the completed listen in title history; preserve separate reread attempts and exact file positions.

## Open questions

Automatic completion thresholds, manual override, abandoned/on-hold states, reread creation, deletion retention, and title summary presentation remain open.
