# ADR-0087: Add Hardcover, cache provider searches and offer reviewed auto-fill

Status: Accepted
Date: 2026-11-21
Decision owner: Repository owner
Amended by: [ADR-0090](0090-auto-fill-from-a-single-title-and-author-match.md) (2026-11-22): adds a per-library title-and-author case and review before saving. The identifier rule stays.

## Context

ADR-0049 and ADR-0060 select Open Library, Google Books and Audnexus, opt-in per library, with gap-only automatic filling on an unambiguous identifier match and review for everything else. The edition Edit metadata tab can now search those providers and apply reviewed fields. On 2026-11-21 the owner asked to extend that: search for audiobooks as well, return more Open Library detail, add an auto-fill action, cache search results for a few minutes, and add more providers.

Hardcover documents a public GraphQL API at `api.hardcover.app/v1/graphql` with a per-user token, edition lookup by ISBN, and a search query. Its published limits for a free token are 60 requests per minute with a burst of 10 and a daily cap, and it answers `429` with `Retry-After`. Goodreads closed its public API, and Amazon and Audible offer no public keyless book-metadata API; the owner also selected them, which this record does not cover (see ADR-0088).

## Decision

The owner chose Hardcover and a 10-minute configurable cache in answer to questions on 2026-11-21, and accepted this record as written on 2026-11-21:

- **Hardcover** is an additional provider, named `hardcover`. It is off until a library lists it, and it also needs a token the operator sets in server configuration (`LITARA_HARDCOVER_TOKEN`). Without a token it reports as not configured and is never contacted. The token is never logged, returned by the API or stored in the database.
- **Search results are cached in memory for 10 minutes** per provider and query, with the duration configurable by the operator (`LITARA_PROVIDER_SEARCH_CACHE_MINUTES`; 0 turns it off). Only successful results are cached; a failure, rate limit or timeout is never cached. A person can force a fresh search.
- **Audiobook recordings** get the same search and reviewed apply as ebook editions, using the providers a library has enabled, including Audnexus when the title has an ASIN.
- **Auto-fill** is an explicit administrator action on one edition or recording. It applies ADR-0060 exactly: it fills only fields with no stored value, only from a single unique identifier match whose title and authors agree with what is stored. It never replaces a protected edit, an intentional clear or a value from a sidecar or file, never selects a search hit, and reports what it filled or sends the result to review.

## Alternatives

- Skip Hardcover until a public keyless API exists: leaves no maintained source of series and edition detail.
- Cache for 60 minutes or not at all: a longer cache delays corrected provider records, and none costs a provider request per search.
- Make auto-fill run on every rescan: conflicts with ADR-0060's requirement for explicit, review-first handling of uncertain results.

## Consequences

Hardcover terms and limits must be respected: one request budget shared across the server, honoring `Retry-After`, and no bulk harvesting. The token is operator-supplied and may expire. The search cache is per process and is lost on restart, which is acceptable because it is only an optimisation. A search sends only title, authors, ISBN and (for Audnexus) ASIN. Applying a reviewed value is a protected edit, as in ADR-0047.

## Verification

Planned: Hardcover requests built and parsed against recorded synthetic responses; an unconfigured provider is reported and not contacted; cache hit, expiry, bypass and failure-not-cached behavior; recording search and apply; auto-fill fills only gaps, never protected values, never a non-unique or inconsistent match. No live Hardcover request can be made without a token, and its text-search response shape is unverified against the live service.

## Open questions

Hardcover's live response fields for text search and the token format must be confirmed with a real token. Goodreads, Amazon and Audible are not covered here.
