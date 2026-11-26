# ADR-0103: Series data and books missing from the library

Status: Accepted
Date: 2026-11-26
Decision owner: Repository owner
Amends: [ADR-0100](0100-author-and-series-directories.md)
Amended by: [ADR-0104](0104-author-and-series-page-defaults.md) (2026-11-26): answers several open questions below. Also amended by [ADR-0106](0106-provider-text-and-images.md) (2026-11-26): provider text and images are stored and credited.

## Context

[ADR-0100](0100-author-and-series-directories.md) identifies a series by name, stores nothing about it, and lists only missing whole numbers between the first and last owned books. On 2026-11-25 the owner asked whether series details can be fetched, including through any book in the series, and said it "would be nice to also fetch missing book details and put a greyed out cover for the missing series book". [Research](../research/author-series-sources.md) found that Hardcover and Open Library both link a book to a series with member positions, that Hardcover's schema also has a series description and completion fields, and that book files carry only a series name and number.

## Decision

On 2026-11-26 the owner accepted this proposal as written:

1. Litara can fetch series details online. It finds the series through the books already in it, using any member that matches a provider, and a person reviews the match before it is used.
2. When a series has been matched, the series page shows each member that is not in the library as a greyed-out cover with its number, title and a "Not in your libraries" label. Without a match, the page keeps ADR-0100's missing-number list.
3. Details of missing books are display information only. They do not create catalog titles, editions or files.
4. Hardcover is used first and Open Library as a fallback.
5. Stored series fields can be edited and locked as books and authors can ([ADR-0102](0102-editable-lockable-author-data.md) covers authors only).

This amends ADR-0100 for series: series data may be fetched and stored, and a matched series shows its missing books. A series is still identified as ADR-0100 describes. The choice of Hardcover and Open Library here covers series data only; it does not select sources for author data under ADR-0102.

## Alternatives

- Keep ADR-0100's missing numbers only: no provider calls or stored series data, but no titles, covers or description, and books after the last owned one stay unknown.
- Open Library only: needs no token, but its series coverage looked thin in a small sample and the one series record checked had no description.
- Fetch automatically for every series: less effort for the user, but wrong matches would show wrong missing books, and it uses more of the providers' limits.

## Consequences

Stored series data, missing-member records and cached cover images are needed, with additive API changes ([ADR-0082](0082-api-compatibility-policy-and-enforcement.md)). A wrong match or provider numbering can show books as missing that are owned. Member lists must be filtered for compilations and duplicates. Hardcover has not been tested live, and the research records unconfirmed points about its covers for series members and its terms of use.

## Verification

Planned, none done: a series is found from any matching member; an owned book is never shown as missing, including under another edition; omnibus and duplicate entries are excluded; the greyed cover always has a text label; an unmatched series still lists missing numbers; nothing is created in the catalog for a missing book; only libraries the viewer can see affect what counts as owned ([ADR-0013](0013-library-access-local-login.md)).

## Open questions

- How provider enablement works for a series spanning several libraries.
- Whether novellas (2.5), companions and announced, unpublished books are shown.
- Whether books after the last owned one are shown.
- Which series fields exist, who may edit them, and how far the book lock rules apply.
- Whether and how results are refreshed.
