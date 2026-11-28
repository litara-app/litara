# ADR-0115: Add Goodreads as a metadata and cover source through its GraphQL endpoint

Status: Accepted
Date: 2026-11-27
Decision owner: Repository owner
Amends: [ADR-0086](0086-cover-replacement.md) (adds Goodreads to online cover search for libraries that enable it). Answers the Goodreads part of [ADR-0088](0088-goodreads-amazon-and-audible-metadata.md).

## Context

Goodreads retired its public API. [ADR-0088](0088-goodreads-amazon-and-audible-metadata.md) records that its terms of use leave out automated collection of book listings and descriptions, that `/search` is closed to general bots in `robots.txt`, and that tools reading its HTML pages broke in 2026. It recommended not adding an adapter.

Grimmory changed its adapter in [grimmory-tools/grimmory#1734](https://github.com/grimmory-tools/grimmory/pull/1734) from reading HTML to the GraphQL (AWS AppSync) endpoint that Goodreads' own website calls, using the public API key that website ships. It finds a book's Goodreads ID with two ordinary `www.goodreads.com` addresses: `/book/isbn/{isbn}` (a redirect) and `/book/auto_complete` (JSON). Grimmory replaced the key on 2026-08-29 after the first one stopped working.

Checked live on 2026-11-27: the PR's original key answered `401`; Grimmory's current key returned the queried fields; a known ISBN redirected to `/book/show/{id}-slug`, an unknown one answered `404`; an unknown ID answered `200` with a `RESOURCE_NOT_FOUND` error. Each contributor carries a role, and an introduction writer is listed beside the author.

## Decision

On 2026-11-27 the repository owner instructed that Goodreads be implemented as a metadata source "using the grimmory gql method". The owner was told that ADR-0088 recorded the terms problem, and then chose in answer to questions on the same day:

- **Method.** Book details come from the GraphQL endpoint, asking only for the fields Litara uses. ISBN and title searches use the two `www.goodreads.com` addresses above to find the ID. Goodreads HTML pages are not parsed.
- **Key.** The public web key and the endpoint are built into the server, and `LITARA_GOODREADS_API_KEY` and `LITARA_GOODREADS_ENDPOINT` replace them when Goodreads changes them.
- **Scope.** Book metadata through the existing search, review and auto-fill, and Goodreads images as choices in the online cover search.
- **Off by default.** The provider is named `goodreads`. As with every provider (ADR-0049), nothing is sent to Goodreads until a library lists it. For covers, the server's online cover search must also be on.

Existing rules apply unchanged: provider priority and review (ADR-0060), the search cache (ADR-0087), title-and-author auto-fill (ADR-0090), reviewed apply and protected edits (ADR-0095, ADR-0097) and the cover fetch and storage rules (ADR-0086).

How the adapter applies those rules:

- Only an ISBN or a title is sent. Authors are used locally to rank results.
- An ISBN result counts as an identifier match only when the returned record states that same ISBN. Otherwise, and for title searches, results are for review. An ISBN that Goodreads does not know falls back to a title search.
- Authors are the primary contributor and others whose role is `Author`.
- All Goodreads requests share one budget of one request per second, honouring `Retry-After`. A title search reads at most three books. A failed request fails the whole lookup, so a partial result is never cached.
- Public reviews are not requested. Author and series pages (ADR-0102, ADR-0103) do not use Goodreads.

Grimmory is AGPL. Only facts about the service (addresses, key, field names and observed behaviour) were taken from it; the MIT server code, its query and its test data are written independently.

## Alternatives

- Do not add Goodreads (ADR-0088's recommendation).
- Require each operator to supply the key, so none is committed. Not selected.
- Metadata only, without covers. Not selected.
- Read Goodreads HTML pages, which has been breaking in other projects.

## Consequences

Goodreads does not offer or support this interface for third parties, and its terms of use do not permit automated collection. The owner chose to add it knowing this. Goodreads can block it, change it or revoke the key without notice, and may object to the key being published in this repository. A failure shows Goodreads as unavailable and affects no other provider and no stored value. Whoever turns it on sends requests from their own server address.

Pre-production schema history is consolidated (ADR-0030): `provider_lookups` in the init migration now allows `goodreads`, and also `hardcover`, which it had wrongly refused. A database initialised earlier does not get this change by itself.

## Verification

Synthetic-response tests: request shape and key header; ISBN redirect, unknown ISBN and mismatched ISBN; title ranking and the three-book limit; contributor roles, HTML text, date and language mapping; missing book against rejected key; configuration overrides; covers only for a library that lists the provider. A live check is run by hand and reported separately; it does not show that the service will keep working.

## Open questions

None within this record's scope. Amazon and Audible remain open in ADR-0088.
