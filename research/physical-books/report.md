# Physical books in Litara

Exploration for the repository owner, 2026-11-27. The owner wants an option for physical (paper) books. This report
looks at why someone would use it, what Litara already has, and which features make sense. It makes recommendations and
**decides nothing**: building any of it needs an accepted decision record, and ADR-0011 would need to say whether it is
part of the first release.

("Real book collections" in the release checklist means something else: testing with people's actual libraries of
files. That is still open and separate.)

## In short

- The strongest case is **one catalogue for a household that owns books in several forms**: "do we have this, and where
  is it?", and one reading history whether the book was read on paper, on a screen or by ear.
- Much of what that needs already exists per title: rating, review, started and finished dates, shelves, metadata and
  ISBN lookup.
- The main work is that **Litara only knows a book through a file**. A title appears because a person can reach one of
  its ebook files or recordings. A paper-only book would be invisible today.
- Recommendation: add **physical copies** as a new thing beside ebook editions and recordings, not as a kind of ebook.
  Start with adding by ISBN, a location, and "mark as reading / finished". Add phone scanning and import next, lending
  after that.

## Who would use it, and for what

| Use | The question it answers | What it needs |
| --- | --- | --- |
| Owned-books catalogue | "Do we already own this?" (in a shop, on a phone) | Search by title or ISBN, "owned on paper" shown in lists, phone access |
| Finding a book | "Which shelf is it on?" | A location per copy |
| One reading history | "What did I read this year?" including paper | Finished dates and rating without a file; optionally page progress |
| Several forms of one book | "I have the paperback and the audiobook" | Physical copies attached to the same title as files |
| Lending | "Who has my copy, and since when?" | Borrower name, date out, date back |
| Series gaps | "Which volumes am I missing?" | Works with existing series matching once paper volumes count as owned |
| Moving in | "I already listed these elsewhere" | Import from a CSV export |
| Inventory | "What do we own?" for insurance or a move | Export; acquired date and price are optional extras |

The first four are what a media server can do better than a separate app, because the digital library is already there.
A pure paper collector is already served by dedicated apps such as LibraryThing, Libib or CLZ Books.

## What others do

From web search results on 2026-11-27. These are mostly blogs and issue trackers, not checked first-hand.

- BookLore had physical books with a badge and bulk ISBN import, according to a
  [request to add the same to BookOrbit](https://github.com/bookorbit/bookorbit/issues/1849).
- A [BookLore request](https://github.com/booklore-app/BookLore/issues/945) describes creating dummy EPUB files to
  record paper books. That workaround is what people do when a server has no such option.
- Dedicated catalogue apps scan ISBN barcodes. Sources disagree on which offer lending and in which paid tier
  ([comparison](https://www.achriom.com/blog/best-personal-library-app/)).

## What Litara already has

From the code on this branch (`apps/server/migrations/00001_init.sql`).

| Piece | Today | For paper books |
| --- | --- | --- |
| Title (name, authors, series) | Independent of any file | Reusable as it is |
| Ebook edition | Requires exactly one file (`file_id` required and unique) | Cannot hold a paper copy without changing what an edition is |
| Which titles a person sees | Counted from editions and recordings in libraries granted to them (`title_rows`) | Must also count physical copies, or paper-only books never appear |
| Rating, review, started and finished dates | Per person and title | Work once the title is visible |
| Shelves, including smart shelves | Per title | Work once the title is visible; smart filters need an "owned on paper" rule |
| Finished state and reading log | Tied to an edition or recording | Needs a paper equivalent |
| Reading and listening statistics | From reading sessions on editions and listening sessions on recordings | Paper reading is not counted without a new record |
| Metadata and ISBN | ISBN field; Open Library, Google Books and Hardcover lookup | Reusable for adding by ISBN |
| OPDS, KOReader, send-to-device, downloads | About files | Must leave paper copies out |

## How to store it

1. **A physical copy is its own record** (recommended). It belongs to a title and a library, and holds binding
   (hardcover, paperback, other), ISBN, location, an optional note and acquired date. Libraries already control who can
   see what, so access rules stay as they are. Files, ingestion and the readers are untouched.
2. **An edition with no file.** Fewer new tables, but every part of Litara that assumes an edition has a file would need
   an exception: the API, Android, OPDS, KOReader and delivery. The published API describes an edition with its file, so
   this risks breaking third-party clients, which [ADR-0082](../../ADR/0082-api-compatibility-policy-and-enforcement.md) does not allow.
3. **Placeholder files.** No schema change, but false files that scans, readers and downloads would treat as real. Not
   recommended.

With option 1 the API change can be additive: new endpoints for copies, and a new count on titles. Two things need
checking in design, using the API compatibility rules: whether lists may start returning titles that have no edition or
recording, and whether a new value in the list of formats is safe for existing clients. If not, "paper" should be its
own field and filter.

A physical book should live in a library like any other. A household could use a library called "Bookshelves" and grant
it to everyone, or put copies in an existing library.

## Features, in the order I would build them

### First: a usable catalogue

- Add a book by typing its ISBN: look it up, show what was found, let the person correct it and confirm. Add by hand
  when nothing is found.
- If the title already exists (because there is an ebook or audiobook), attach the copy to it. Ask before matching on
  title and author alone, as Litara already does for uncertain links.
- More than one copy of a title.
- A location per copy, as free text with suggestions from earlier entries ("Study, second shelf").
- Show a paper badge in lists, and add an "owned on paper" filter.
- Mark as reading or finished, with dates. Rating, review and shelves as for any title.

### Second: getting a collection in quickly

- **Scan barcodes with the phone**, many in a row, with a list to review before saving. Typing hundreds of ISBNs is what
  would stop people using the feature.
  - The F-Droid version cannot use a proprietary scanning library, so the scanner should be open source. Choose and
    check the license in design.
  - Scanning in a web browser needs the page to be served over HTTPS.
- **Import a CSV file**, starting with the export Goodreads provides for a person's own library, which includes ISBNs
  and an owned-copies column according to
  [a 2026 guide](https://pickupreader.com/blog/how-to-export-goodreads-library-2026). This is a person's own export, not
  scraping ([ADR-0088](../../ADR/0088-goodreads-amazon-and-audible-metadata.md)). Check a real file before designing,
  because I found no official list of its columns. Show a preview and never overwrite existing ratings without asking.
- Lookups for a large batch must be queued and slowed down. Secondary sources put Open Library's limit at about one
  request a second, with a tighter one for covers by ISBN. Confirm with its documentation.

### Third: lending and paper progress

- Lend a copy: borrower as free text, date out, optional due date, date returned, and a "lent out" list. No accounts for
  borrowers and no reminders at first.
- Page progress: "I am on page 120". With a page count it gives a percentage and a line in the reading log. Decide
  whether it counts in statistics: there is no measured reading time, so it should add to books read, not to hours.
- Export the catalogue as CSV.

### Probably not

- A wish list. A shelf already does most of it without pretending the book is owned.
- Prices, valuations, condition grading, signed or first-edition collecting. A note field covers occasional use; real
  collectors need a dedicated tool.
- Library-style circulation (patrons, fines, call numbers) and printed labels.
- Pulling data from Goodreads or Amazon pages (see ADR-0088).

## Effects on the rest of Litara

- **Scans and files:** none. A physical copy is never found or removed by a library scan.
- **Removing files:** deleting a title's last file must not remove a title that still has a paper copy, and the other
  way round.
- **Matching:** a later scan that finds an ebook for a paper title should suggest linking them, through the existing
  review step.
- **Backups:** the copies live in the database, so existing database backups cover them. They cannot be rebuilt by
  rescanning, unlike file records.
- **Android:** browsing needs a connection today, so "do we own this?" in a shop depends on reaching the server. An
  offline copy of the owned list would be a separate decision.
- **2.0.0 migration (T008):** the old Litara may hold nothing about paper books; this does not need to wait for
  migration or block it. Check when T008 is designed.

## Questions for you

1. **Shared or personal?** Should a copy belong to a library that others can see (recommended), or to one person?
2. **First slice:** is "add by ISBN, location, reading status" enough to be useful to you, or is phone scanning needed
   from the start because of the size of your collection?
3. **Lending:** do you lend books often enough to want it early?
4. **Paper progress:** is "reading / finished" enough, or do you want page numbers?
5. **Release:** part of 2.0.0, or after it? It is new scope, and migration and release checks are still open.

If the direction looks right, the next step is a proposed decision record for option 1 with the first slice, covering
the data it stores, who can see it and the API additions.
