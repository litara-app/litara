# ADR-0116: Store physical copies as their own records

Status: Accepted
Date: 2026-11-27
Decision owner: Repository owner

## Context

This record was drafted as ADR-0115. It is 0116 because the Goodreads change, opened first, also added a record 0115.

[ADR-0114](0114-physical-books-in-2-0-0.md) puts physical books in 2.0.0 and leaves open how they are stored. The
[physical books report](../research/physical-books/report.md) has the uses. This record rests on the following,
read from the code on 2026-11-27:

- An ebook edition requires exactly one file (`editions.file_id` is required and unique). A title is listed only when
  the account can reach one of its editions or recordings.
- Reading positions, finished state, reading sessions and history point at an edition or a recording. The published
  history entries require an edition and file, or a recording, so a paper event cannot be returned in either.
- Rating, review, started and finished dates and shelves belong to a title.
- Book details are changed by administrators, through an edition or a recording. A title with neither has no way to
  have its details changed.
- Every library created through the API needs a folder path.
- OPDS publications are built from editions and recording files.
- In the title list, `formats` is a list of free strings. `editionCount` and `recordingCount` say what a title holds.
  Android asks for the audiobook cover when `editionCount` is zero.

## Decision

On 2026-11-27 this record was proposed with a recommendation for each of eight questions. The owner answered: "Dont
worry about older app versions. Fine, add OPTIONAL csv import. Accept all the other recs". What follows is accepted.

- **Older app versions** need no special handling. Paper-only titles appear in the existing lists. This does not relax
  [ADR-0082](0082-api-compatibility-policy-and-enforcement.md): API changes stay additive.
- **CSV import** is added as an optional way to enter books. Adding books by ISBN or by hand never depends on it. It is
  part of 2.0.0. This record reads "optional" as meaning that nobody has to use it.
- **Phone scanning** is not required for 2.0.0.

### Copies

A **physical copy** is a new record beside ebook editions and recordings. It is not an edition.

Administrators add, change and remove copies, as they do other book details. Anyone with access to a copy's library can
track their own reading of it.

| Field | Rule |
| --- | --- |
| Title | Required. Several copies may share one title. |
| Library | Required. Access to the library decides who sees the copy, as for files ([ADR-0013](0013-library-access-local-login.md)). |
| Binding | Hardcover, paperback or other. Optional. |
| ISBN, language | Optional. They describe this printing. |
| Page count | Optional. It belongs to the copy because printings differ. |
| Location | Optional free text, with suggestions from earlier entries. |
| Note | Optional. Everyone who sees the copy sees it. |
| Acquired date | Optional. |
| Revision | A change based on an older revision is refused, not applied over the newer one. |
| Removed at | Removing a copy hides it and keeps the record, so people keep their reading history. |

A title is listed when the account can reach an edition, a recording **or a copy that has not been removed**. Nothing
that tidies up unused titles may delete a title that has a copy. Library scans never create, change or remove copies.

### Paper reading

Each account has its own state for each copy, as completion is already kept per edition or recording
([ADR-0022](0022-edition-recording-completion.md)):

- not started, reading or finished, with no page number needed;
- an optional current page, a whole number from 1, no higher than the copy's page count when one is entered;
- a history of started, finished and not-finished events, which counts toward the title's history;
- writes that carry an operation ID and the revision they were based on, so a retry does nothing twice and a stale
  change does not silently replace a newer one ([ADR-0015](0015-reading-state-and-sync.md)).

This state lives in new tables. Paper reading creates no reading sessions, because no time is measured. The title's
status counts it with ebook and audiobook state. Rating, review, dates and shelves work as they do today.

### Statistics

Finished paper books are counted in a separate "paper books finished" figure. Paper reading adds no reading time and no
page totals, and does not affect streaks. Existing statistics keep their meaning.

### First slice

- add a book by ISBN, with lookup, or by hand;
- attach a copy to an existing title, asking first when only the name and author match;
- several copies of a title, each with a location;
- a paper badge and an "owned on paper" filter;
- reading status, with an optional page.

Libraries without a folder are left out of the first slice, so a library that holds only paper books needs an empty
folder. Supporting them would need its own API design.

### API

Every change is an addition, as [ADR-0082](0082-api-compatibility-policy-and-enforcement.md) requires:

- new operations to list, add, change and remove copies, including adding a copy that creates its title;
- a new operation to change the details of a title that has no edition or recording;
- new operations for an account's paper reading state and history. Existing history responses do not change;
- `physicalCopyCount` on titles, the value `paper` in the title list's `formats`, and a filter field for "owned on
  paper".

Existing operations and fields keep their meaning. Paper-only titles appear in the existing lists for every client.
CSV import will need further additions, designed with that feature. The change is checked with the compatibility test
before it is accepted into the baseline.

### Other parts of Litara

- Author and series pages include paper-only titles, and a paper volume counts as owned in a series.
- A paper-only title uses the existing book-shaped (ebook) cover. Web and Android must choose it when there is no
  recording, instead of choosing the audiobook cover whenever there is no edition.
- OPDS, KOReader, downloads and sending to a device stay about files and show no copies.
- When a scan finds a file that may be the same book as a paper title, it is suggested for review and not merged
  silently. An administrator can move a copy to another title.
- The tables go into the initial migration ([ADR-0030](0030-consolidate-preproduction-migrations.md)), so
  development databases must be recreated.

## Alternatives

- **An edition with no file.** It needs fewer new tables and could share edition history. Every part that expects an
  edition to have a file would need an exception, and published edition responses include the file, so third-party
  clients could break.
- **A placeholder file.** It needs no schema change, but scans, readers and downloads would treat it as a real book.
- **Reading state per title instead of per copy.** It is simpler when two copies of a book are alike, but it cannot
  say which copy was read or use that copy's page count.
- **Paper-only titles only for clients that ask.** Older clients would never see a book with nothing to open. Each list
  that returns titles would need the option, and clients could disagree about what is on a shelf.

## Consequences

Files, ingestion and the readers stay as they are. Statistics, history and the title screens must read a third source
of reading state. Unlike file records, copies cannot be rebuilt by rescanning, so database backups are their only
protection.

An older app version may show a paper-only title with nothing to open and ask for the wrong cover. The owner chose not to
handle this. The current Android app needs the cover and title screen changes described above.

Apart from CSV import, books are entered one at a time.

This record does not cover lending, which [ADR-0114](0114-physical-books-in-2-0-0.md) leaves out, or offline access
to the owned list on Android.

## Verification

The first slice was built on 2026-11-27, without CSV import. The checks planned for it:

- a paper-only title is listed, searched and shelved for an account with its library, and is invisible without it;
- adding or removing files never deletes a title with a copy, and removing a copy never affects files;
- reading and finishing work with no page number, and a page above the copy's page count is refused;
- one account never sees another's paper reading state;
- a repeated write changes nothing, and a stale write is reported as a conflict;
- removing a copy keeps each reader's history;
- the compatibility test accepts the API as additive, and OPDS output is unchanged;
- web and Android show a paper-only title with a suitable cover and no read, listen or download actions;
- only an administrator can add, change or remove a copy;
- paper finishes appear in their own figure and change no reading time or streak;
- books can be added by ISBN and by hand without ever using CSV import.

**Choices made while building,** within this record. Change any of them if they are wrong:

- Reading a finished copy again keeps the earlier finish. "Mark not finished" takes the latest finish back, so it
  leaves the paper-books-finished figure.
- A paper-only title is never offered by "continue reading", because there is nothing to open.
- A scan offers a paper title held in **any** library for review, because a household may keep paper books in a library
  of their own. A paper title has no scan identifier, so a shared ISBN never joins them without review.
- The title response now also carries the title's own publisher, publication date and description. A paper-only title
  has no edition or recording to read them from.
- The listening history of a title with no recording is now empty instead of "not found". By the code, this also
  affected titles with only an ebook.
- Android shows that a title is on paper and how many copies there are. Locations, managing copies and paper reading
  are in the web app.

## Open questions

The eight questions in the proposal are answered. These are not decided:

- **CSV import design,** needed before the import is built: which files and columns it accepts, whether it starts from a
  Goodreads library export as the report suggested, what the person reviews before saving, how it treats existing
  ratings, reading dates and books already in the catalogue, who may run it, and whether it comes with the first slice or
  after it.
- **Phone scanning:** when it is added.
- **Libraries without a folder:** whether and when to support them.
