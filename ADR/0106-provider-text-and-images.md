# ADR-0106: Keep and credit author and series text and images from providers

Status: Accepted
Date: 2026-11-26
Decision owner: Repository owner
Amends: [ADR-0102](0102-editable-lockable-author-data.md), [ADR-0103](0103-series-data-and-missing-books.md), [ADR-0104](0104-author-and-series-page-defaults.md)

## Context

Stage 3 of [ADR-0104](0104-author-and-series-page-defaults.md) brings in author text and photos and covers for books missing from a series. The terms for storing and showing them were open. The [research](../research/author-series-sources.md) records that Hardcover's images are user uploads and that its documentation says anyone showing them publicly needs a DMCA takedown policy, and that no license was found for Open Library author photos or biographies. That research is not legal advice and the question was not confirmed with either provider.

## Decision

On 2026-11-26 the owner chose, from the offered options:

1. **Provider images are stored and credited.** Litara keeps a re-encoded copy on the operator's server, shows it only to signed-in users with library access, names the source with a link, and lets administrators remove or lock an author photo. The documentation warns operators about public sites.
2. **Open Library author data is used as Hardcover's is.** Its biography and photo are offered for review, credited with a link, and nothing is saved until an administrator chooses it.

## Alternatives

- Provider images off until an administrator turns on a server setting: more caution, one more step.
- No provider images: no image terms to consider, but missing books have no covers and photos stay manual.
- Open Library author text only, or no Open Library author data: less unlicensed material, but a weaker fallback.

## Consequences

Stored provider values and images need their provider and source link kept with them. An operator who makes a server publicly reachable takes on the providers' conditions for public display. If a provider's terms turn out not to allow this use, this record is revisited with the owner.

## Verification

Done on 2026-11-26 (`TestAuthorAndSeriesOnline`, web tests): applied values and photos keep their provider and link; a lookup saves nothing; candidate photos, stored photos and missing-book covers come from the server, and are refused to a viewer without a grant. Author and series pages and missing books show the source with a link. The author directory shows an applied photo without a link of its own; the credit is on that author's page. The setup documentation warns operators about public sites.

## Open questions

Whether Hardcover or Open Library permit this use has not been confirmed with either.
