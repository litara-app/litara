# ADR-0088: Decide whether to use Goodreads, Amazon and Audible metadata

Status: Proposed
Date: 2026-11-21
Decision owner: Repository owner

## Context

On 2026-11-21 the owner selected Goodreads, Amazon and Audible when asked which extra providers to add. None offers a supported public book-metadata API for this use. Goodreads retired its public API. Amazon's Product Advertising API requires an approved associate account and is built for affiliate use. Audible has no documented public API; Audnexus (ADR-0049) already serves much Audible-derived audiobook data by ASIN. Reading their web pages or unofficial endpoints is scraping, which ADR-0049 does not select and the providers' terms generally forbid.

## Decision

Proposal, not approval: do not add scraping adapters. Use Audnexus for Audible-derived data, Hardcover (ADR-0087) for community series, edition and rating data, and Open Library and Google Books for bibliographic data. Revisit if the owner holds access to an official API or licence (for example an Amazon associate account).

## Goodreads scraping, checked 2026-11-27

The owner asked on 2026-11-27 to check Goodreads scraping and "see if that looks good to us". This is evidence for
that choice, not a decision. No Goodreads book page was scraped; only the terms, robots file and public reports were read.

- [Terms of Use](https://www.goodreads.com/about/terms) (page says last revised 2021-04-28): the licence is for personal,
  non-commercial use and leaves out collecting book listings, descriptions or reviews, and using robots or similar
  extraction tools. A Litara adapter would do both.
- [robots.txt](https://www.goodreads.com/robots.txt): for general bots, `/search` and most of `/work` are disallowed;
  book, series and author pages are not listed. It does not change what the terms say.
- The [developer pages](https://www.goodreads.com/group/show/8095-goodreads-developers) say no new API keys have been
  issued since 2020-12-08 (read through search results, not opened).
- Other self-hosted tools reported breakage in 2026, from bot protection and changed response formats:
  [Calibre plugin](https://github.com/kiwidude68/calibre_plugins/issues/187),
  [abs-tract](https://github.com/ahobsonsayers/abs-tract/issues/31),
  [Grimmory](https://github.com/grimmory-tools/grimmory/issues/1713). These are user reports; some may be fixed since.

Assessment: scraping does not look good. It goes against the terms, search is closed to bots, and it has been breaking
for projects that maintain it. The recommendation below is unchanged. A different route, a person importing the export
file Goodreads gives them about their own library, involves no scraping and is discussed in
[the physical books report](../research/physical-books/report.md); it would need its own decision.

## Alternatives

- Scrape the sites: fragile, likely to violate terms, and a risk to users' IP addresses and accounts.
- Use third-party scraping services: sends users' queries to another party and shifts the same terms problem.
- Add only providers with a supported API, as proposed.

## Consequences

The Edit metadata tab will not offer Goodreads, Amazon or Audible results or community ratings from them until an official source exists.

## Verification

Not applicable until a decision. Any adapter would need terms evidence, rate limits and fixtures like ADR-0049.

## Open questions

On 2026-11-27 the owner asked for the Goodreads check above. On 2026-11-26 the owner had set this question aside. It stays Proposed: nothing here is accepted or rejected, and no adapter may be built from it.

Does the owner have official API access to any of these, or want a specific supported alternative (for example the Amazon Product Advertising API with their own associate account)?
