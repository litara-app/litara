# ADR-0001: Enforce architectural decisions in the repository

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner

## Context

The user requested a fresh stack, an archive of current Litara, and enforced ADRs directly in an ADR folder. Prior recommendations are not accepted architecture by themselves.

## Decision

Use `ADR/` as the architectural source of truth. Archive the existing working tree in `archive/litara-v1/`, retaining Git history. Require explicit user acceptance before implementing architectural proposals. Enforce this through root agent instructions, an indexed decision workflow, structural validation in CI, and architecture review against accepted ADRs.

## Alternatives

- Informal chat decisions: easy to lose and hard to audit.
- External-only decision records: do not travel with the source.
- Automatic acceptance of recommendations: would confuse proposals with user choices.

## Consequences

The old build and release workflows are no longer active. Already missing files stay missing. The archive preserves local ignored assets without making them publishable. Structural checks cannot prove semantic compliance or user approval; review remains required.

## Verification

Check that all original root entries except Git metadata were moved; preserve original status and HEAD. Validate ADR structure and index in local checks and CI. These archive checks do not validate an external database backup.

## Open questions

None within this record's scope.
