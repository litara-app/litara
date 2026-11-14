# ADR-0060: Configure provider priority and review uncertain metadata matches

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0049 selects opt-in Open Library/Google Books/Audnexus, while ADR-0047 protects edits/clears and restricts providers to gap-filling. Provider preference and match acceptance remained open.

## Decision

The user selected the following on 2026-11-13:

- Provider preference is configurable per library.
- Start with Open Library then Google Books for ebook gaps and Audnexus for audio.
- Automatically fill gaps only for an unambiguous identifier match with consistent metadata.
- Send uncertain or conflicting search matches to review; never select merely the first search result.

## Alternatives

- Review every external result.
- Accept the top relevance result automatically.
- Configurable order with constrained identifier matches and review, as selected.

## Consequences

Provider order does not override protected values, intentional clears, sidecar/embedded precedence or contradictory identity evidence. Keep provider candidate/provenance and matching explanation. Different edition/recording identifiers are not interchangeable work identifiers; a matching title alone cannot merge translations/narrations. A manually reviewed match is not blanket authorization to overwrite protected fields or write files. Respect per-library opt-in and grants for all queued work.

## Verification

Planned for T004: library-specific provider order, unique consistent ISBN/provider identifier match, conflicting identifiers/edition details, several search hits, protected clears, provider outage and manual match review without unauthorized overwrite. No live enrichment or runtime tests were performed in this decision session.

## Open questions

Exact source field mappings, matching examples, cache/quota configuration and review endpoint/schema details belong in the T004 contract/brief. Provider availability and terms require current checks during implementation.
