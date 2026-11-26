# Author and series data sources (2026-11-25)

Research for [ADR-0102](../ADR/0102-editable-lockable-author-data.md) and [ADR-0103](../ADR/0103-series-data-and-missing-books.md). This research selects nothing by itself. On 2026-11-26 the owner accepted ADR-0103, which uses Hardcover first and Open Library as a fallback for series data; the owner then chose the same order for author data (ADR-0102).

## How this was checked

- Open Library: its developer pages, plus anonymous live requests using well-known public records (Frank Herbert, the Dune series).
- Hardcover: its documentation as returned by Context7 (`/hardcoverapp/hardcover-docs`). The docs.hardcover.app pages refused automated fetching (403). **No live Hardcover request was made**, so its data quality and coverage are unverified.
- Audnexus and Wikidata: their documentation or licensing pages only.
- Existing adapters: `apps/server/internal/metadata/`.

## Author data

| Source | Text | Photo | Notes |
| --- | --- | --- | --- |
| Open Library | Bio, birth and death dates, alternate names, links, external IDs (seen live) | Yes: `covers.openlibrary.org/a/id/{id}-{S,M,L}.jpg` or `/a/olid/{key}-M.jpg` (an image was returned live) | Search by name at `/search/authors.json`. A name search also returns other people with similar names, so a match must be reviewed. |
| Hardcover | Schema has `bio`, born and death dates, `identifiers`, `alternate_names`, `links` | Schema has `image` / `cached_image` | Needs the operator token. |
| Audnexus | `description`, genres | `image` (Amazon-hosted) | Audiobook authors only in practice (Audible-sourced). No terms are stated for the data itself; the GPL v3 notice covers its software. |

Google Books was not checked for author data. Wikidata data is CC0, but that statement does not cover images; it was not tested.

## Series data

| Source | Name | Description | Member list with positions | Covers for members | Total / complete |
| --- | --- | --- | --- | --- | --- |
| Hardcover | Yes | Yes | Yes (`book_series.position`) | Not confirmed for the series query | `books_count`, `primary_books_count`, `is_completed` |
| Open Library | Yes | The one record checked had `null` | Yes: `search.json?q=series_key:{key}` returned Dune 1 to 6 | Yes (`cover_i`) | `seed_count` only |
| Audnexus | A book can name its series and position | No series endpoint seen | No | No | No |
| Book files (EPUB, Calibre) | Name and number only | No | No | No | No |

Open Library coverage looked thin. In a sample of eight well-known series openers (first search result each), only two carried series fields (Foundation, as "Foundation Trilogy", and Leviathan Wakes). The other six had none, including The Eye of the World, The Way of Kings and A Wizard of Earthsea. This is a small sample, not a measurement. Series support there appears recent (the Dune series record is dated April 2026).

## Finding a series from its books

Possible through either source:

1. Match any book in the series to the provider (ISBN or identifier first, then reviewed title and author).
2. Read the series ID from that match (Hardcover `book_series.series.id`; Open Library `series_key`).
3. Fetch the series and its members by that ID.

Using several books guards against a wrong match. Cases that need a rule or a person:

- A book can belong to several series.
- Providers disagree on numbering, novellas (2.5), omnibus editions and duplicates. Hardcover's own example filters out compilations, partial books and merged duplicates and keeps one book per position.
- A listed member the user owns under a different title or edition must not appear as missing.

Today's Hardcover adapter reads only a series name and position, only when a book has exactly one series, and does not request the series ID. It would need to.

## Terms and limits

**Open Library** ([developers](https://openlibrary.org/developers/api), [covers](https://openlibrary.org/dev/docs/api/covers), [licensing](https://openlibrary.org/developers/licensing))

- The API is "not intended to serve as a data backend for third-party services". Cache responses; use the monthly dumps for bulk.
- 1 request per second anonymously, 3 with a User-Agent that includes a contact (already supported through `LITARA_OPEN_LIBRARY_CONTACT`).
- The covers API asks clients not to crawl it; a courtesy link back is appreciated.
- The Internet Archive asserts no new rights over the database but says some contributions may have existing rights issues. No licence was found for author photos or bios.

**Hardcover** ([getting started](https://github.com/hardcoverapp/hardcover-docs/blob/main/src/content/docs/api/Getting-Started.mdx))

- Free plan: 60 requests per minute, burst 10, 5,000 per day.
- The token stays on the server and must not be shared. The API is in beta and may change.
- Images are user uploads. The docs say that anyone showing them publicly needs a DMCA takedown policy.
- Commercial products and public sites may not use user-owned data (libraries, reviews, ratings, lists). Author and series catalog fields are not in that list.
- One passage says the API is "only for offline use at this time" and reachable from "localhost or APIs". A server-side call from a self-hosted install appears to fit, but this has not been confirmed with Hardcover.

## Recommendation (not a decision)

Use Hardcover first for authors and series, because it has series descriptions, member positions and completion fields. Use Open Library as a fallback, including for installs without a Hardcover token. Fetch only on request or for series and authors in the library, cache results, store chosen photos locally, and show where each came from. Leave Audnexus out of the first version. Before building on Hardcover, run a live check with the operator's token to measure coverage and confirm the image fields.
