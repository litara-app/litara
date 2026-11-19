# ADR-0077: Use optional Open Library identification and shared provider rate limits

Status: Accepted
Date: 2026-11-18
Decision owner: Repository owner

## Context

ADR-0049 makes external lookup opt-in per library. T007 found that concurrent library jobs could exceed upstream quotas and that the Open Library user agent had no contact information. [Provider evidence](../research/t007/evidence/m2-providers/README.md)

## Decision

The repository owner approved an optional operator Open Library contact, one request budget per provider across the server, bounded caching and retries that honor provider guidance, and retaining Audnexus as the audiobook provider. Open Library receives its own configured contact only. Individual account email addresses are outside this setting.

## Alternatives

A mandatory contact would increase setup friction. A limiter per library or worker would multiply the upstream request rate. AudiobookDB offers search and release separation with different data-use terms.

## Consequences

A single process shares each provider budget. Open Library uses one request per second anonymously and up to three with a contact. Google Books and Audnexus start at a conservative local ceiling of one request per second each. The in-memory Open Library cache honors response cache directives. Audnexus keeps its ASIN lookup and existing opt-in boundary. A replicated deployment sharing upstream quotas needs a coordinated budget.

## Verification

Test contact isolation and the anonymous and identified budgets. Exercise bounded caching, concurrent admission, both forms of Retry-After, cancellation and bounded retry with synthetic HTTP fixtures. Confirm defaults and opt-in behavior through the backend suite.

## Open questions

Shared quota coordination for replicated deployments and any future AudiobookDB integration remain open.
