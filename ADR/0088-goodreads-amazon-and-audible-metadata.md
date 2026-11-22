# ADR-0088: Decide whether to use Goodreads, Amazon and Audible metadata

Status: Proposed
Date: 2026-11-21
Decision owner: Repository owner

## Context

On 2026-11-21 the owner selected Goodreads, Amazon and Audible when asked which extra providers to add. None offers a supported public book-metadata API for this use. Goodreads retired its public API. Amazon's Product Advertising API requires an approved associate account and is built for affiliate use. Audible has no documented public API; Audnexus (ADR-0049) already serves much Audible-derived audiobook data by ASIN. Reading their web pages or unofficial endpoints is scraping, which ADR-0049 does not select and the providers' terms generally forbid.

## Decision

Proposal, not approval: do not add scraping adapters. Use Audnexus for Audible-derived data, Hardcover (ADR-0087) for community series, edition and rating data, and Open Library and Google Books for bibliographic data. Revisit if the owner holds access to an official API or licence (for example an Amazon associate account).

## Alternatives

- Scrape the sites: fragile, likely to violate terms, and a risk to users' IP addresses and accounts.
- Use third-party scraping services: sends users' queries to another party and shifts the same terms problem.
- Add only providers with a supported API, as proposed.

## Consequences

The Edit metadata tab will not offer Goodreads, Amazon or Audible results or community ratings from them until an official source exists.

## Verification

Not applicable until a decision. Any adapter would need terms evidence, rate limits and fixtures like ADR-0049.

## Open questions

Does the owner have official API access to any of these, or want a specific supported alternative (for example the Amazon Product Advertising API with their own associate account)?
