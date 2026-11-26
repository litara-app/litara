# ADR-0100: Author and series directories

Status: Accepted
Date: 2026-11-25
Decision owner: Repository owner
Amended by: [ADR-0101](0101-authors-by-last-name.md) (2026-11-25): authors sort and filter by last name by default. Also amended by [ADR-0102](0102-editable-lockable-author-data.md) (2026-11-25): author data can be pulled online and its fields locked, so author data is stored. Also amended by [ADR-0103](0103-series-data-and-missing-books.md) (2026-11-26): series data can be fetched and stored, edited and locked, and a matched series shows its missing books.

## Context

Titles carry their authors as a list of names and an optional series name and number (`titles.authors`, `series_name`, `series_index`). The Library can filter by author or series and sort by series number ([ADR-0085](0085-stackable-filter-groups.md)), but nothing lists the authors or series in the catalog, and a title page offers no way to reach other books by the same author or in the same series. The 2026-11-25 sweep ranked author and series directories with "more by this author / in this series" third among BookOrbit features (`research/sweep-2026-11-25.md`).

Nothing yet decides what an author is, what opening one shows, where the directories live, or where related books appear on a title page. These shape the catalog's navigation, so they are the owner's.

## Decision

On 2026-11-25 the owner chose:

1. **An author is a name, matched ignoring case.** Titles whose author lists contain the same name, ignoring case, belong to the same author. There are no author records, aliases or merging; name variants ("J.R.R. Tolkien" and "J. R. R. Tolkien") stay separate until the metadata is edited. A series is identified the same way, by its name ignoring case. This matches the Library's existing "is" filter for these fields.
2. **Authors and series have their own pages.** An author page lists that author's books grouped by series, in series order, with standalone books after. A series page lists its books in series order and says which whole numbers are missing between the first and the last.
3. **Authors and Series are entries in the main navigation**, built with UI SDK ([ADR-0079](0079-ui-sdk-only-web-interface.md)).
4. **A title page shows "More by this author" and "In this series" below its tabs**, whichever tab is open, and hides each when there is nothing else to show.

Every list covers only titles the viewer can see through their library grants ([ADR-0013](0013-library-access-local-login.md)), counting ebooks and audiobooks alike.

The following are implementation defaults, open to the owner's change (see Open questions):

- Additive endpoints (ADR-0082): `GET /authors?q=` and `GET /series?q=`, paged, sorted by name. Each entry gives the name, the number of visible titles and the ID of one title for a cover. A series also gives up to three of its authors. When names differ only in case, the most common spelling is shown. The author and series pages and the title page rows use the existing title search with an "author is" or "series is" filter.
- Authors are sorted by name as written (by first name for "Ada Author"), not by surname.
- The title page shows one row for each of its first two authors and one row for its series, each with up to 12 books.

## Alternatives

- Author records with aliases: handles name variants, but needs schema, an administration interface and a migration path.
- Open the Library with a filter instead of own pages: no new pages, but no grouping by series and no default series order.
- Authors and Series under the Library group in the navigation, keeping the main list short.
- Related books only in the Details tab: less visible.

## Consequences

Browsing by author and series needs no new stored data, and metadata edits change the directories immediately. Name variants and typos split an author or series until the metadata is corrected, which the directories make easy to spot. The main navigation grows by two entries.

## Verification

Planned: authors grouped across case differences and split by spelling; a title with several authors counted under each; series counts and cover IDs; titles in libraries without a grant excluded from lists and counts; search and paging; anonymous requests refused; the web author page grouping by series, the series page order and missing numbers, and the title page rows excluding the current title and hiding when empty.

## Open questions

Not chosen by the owner: the endpoint shapes, sorting authors by name as written rather than by surname, the spelling shown for case variants, how many authors and books the title page rows show, and listing missing series numbers only as whole numbers.
