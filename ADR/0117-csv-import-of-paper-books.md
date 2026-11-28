# ADR-0117: Import paper books from a CSV file

Status: Accepted
Date: 2026-11-27
Decision owner: Repository owner

## Context

[ADR-0116](0116-physical-copy-records.md) puts an optional CSV import in 2.0.0 and leaves its design open. Without it,
paper books are added one at a time.

**The Goodreads export.** A person can download their own Goodreads library as a CSV file. This is their own file, not
collection from the website, so [ADR-0088](0088-goodreads-amazon-and-audible-metadata.md) does not stand in the way.
No official list of its columns was found. A
[Goodreads forum post](https://www.goodreads.com/topic/show/22566592-what-s-in-an-export-file?page=1), corrected in
August 2023, gives these: Book Id, Title, Author, Author l-f, Additional Authors, ISBN, ISBN13, My Rating, Average
Rating, Publisher, Binding, Number of Pages, Year Published, Original Publication Year, Date Read, Date Added,
Bookshelves, Bookshelves with positions, Exclusive Shelf, My Review, Spoiler, Private Notes, Read Count, Owned Copies.
The same thread says columns were removed in 2022. A [2017 script](https://gist.github.com/tmcw/3e268886be83f25cd9728cc6f3bc4184)
suggests ISBN values are wrapped in `="…"`, treats a rating of 0 as unrated and skips the `to-read` shelf. Neither
source gives the date format or says what Owned Copies holds. **None of this has been checked against a current
file.**

**Litara today,** from the code:

- A title exists in the catalogue only through an ebook, a recording or a paper copy. A row for a book that nobody
  holds cannot create a title.
- Only administrators add copies. A copy and its note are seen by everyone with the library.
- Rating, review and reading dates are private to an account. A title shows as finished only through a finished
  edition, recording or paper copy. A personal finish date alone does not change that.
- Adding one copy already asks before joining or duplicating a book with the same name and first author, or the same
  ISBN.
- Managed file imports already work as a plan that is reviewed before anything changes.

## Decision

On 2026-11-27 this record was proposed with a recommendation for each of eight questions. The owner first asked whether
the import should not create physical book records. It does, for every row that is owned on paper; the proposal's
choice of which rows start selected was unclear and weak. The replacement offered was to ask "Which books in this file
do you own on paper?" with no answer preselected. The owner answered: "Ah okay that makes sense everything else looks
good, continue on with the work". What follows is accepted, with that replacement.

### Flow

An import is **uploaded, reviewed, then applied**. Uploading changes nothing in the catalogue.

1. An administrator chooses a library and a file.
2. The server reads it and shows every row with what it would do, and why any row cannot be used.
3. The person adjusts the choices and applies them.
4. A report lists what was added, changed and skipped. It can be downloaded.

### Files

- A Goodreads library export, or a Litara template that can be downloaded from the import screen.
- UTF-8 CSV. Columns are found by their header names, in any order, and unknown columns are ignored. Only a title column
  is required. A file without it is refused with the names that were found.
- Up to 10 MB and 10,000 rows.
- There is no screen for matching your own column names.

| Used for | Goodreads columns |
| --- | --- |
| The book | Title, Author, Additional Authors |
| The copy | ISBN13 (else ISBN), Binding, Number of Pages, Publisher, Year Published |
| How many copies | Owned Copies |
| Choosing rows by shelf | Bookshelves, Exclusive Shelf |
| Your reading, if you ask for it | My Rating, My Review, Exclusive Shelf, Date Read |

A value that cannot be understood is left out and named in the review. It does not reject the row, except for a missing
title.

### Choices in the review

- **Which rows become copies.** The review asks "Which books in this file do you own on paper?" and preselects no
  answer. Nothing can be applied until it is answered.

  | Answer | Rows that start selected |
  | --- | --- |
  | All of them | Every row that can be used |
  | Those marked as owned | Rows with at least one owned copy |
  | Those on shelves I choose | Rows on any chosen shelf |
  | I'll pick them | None |

  Any row can then be selected or cleared. A selected row is a book owned on paper: it creates that book with a paper
  copy, or adds a copy to a matching book. It makes as many copies as Owned Copies says, at least one and at most ten.
  Choosing a shelf only picks rows; it does not create a Litara shelf.
- **Books already in the catalogue.** A row with the same ISBN as a title starts as "add to that book". A row that
  matches only by name and first author has no choice made for it, and is skipped unless the person chooses "add to
  that book" or "add as a separate book". Rows in one file that describe the same new book share one title.
- **Running a file again.** A row whose book already has a paper copy in that library with the same ISBN, or with no
  ISBN on either side, starts as skipped. Applying the same plan twice adds nothing twice.

### Reading data

One choice, **off until ticked**: "These are my ratings, reviews and reading." It applies only to the account running
the import.

- Rating, review and the date read fill fields that are empty. Nothing already saved is replaced.
- On a copy the import creates, `read` marks it finished and `currently-reading` marks it reading. With a Date Read, the
  finish is recorded on that date and counts in "paper books finished". Without one, the copy is finished but is not
  counted in any period. Goodreads does not say whether a book was read on paper.
- A book the account has already finished in any form gets no new reading state.
- A row that makes no copy can still give rating, review and finish date to a book already in the catalogue, when the
  ISBN matches or the person confirms the name match. Otherwise it appears in the report only.

### Left out

- **Private Notes are never imported.** The only note on a copy is seen by everyone with the library.
- Goodreads shelves other than the three reading states are not turned into Litara shelves.
- No online lookups and no cover search run during an import. Only what the file says is saved, and it can be improved
  later book by book.

### Safety and storage

- The file holds private reviews. The uploaded file is not kept. Its rows are stored for the review, visible only to
  the account that uploaded them, and deleted when the person cancels, or seven days after upload. The report keeps
  titles and outcomes, not review text.
- Applying runs as a durable background job ([ADR-0016](0016-backend-process-and-tooling.md)). Each row is applied once,
  so an interrupted import continues without duplicates. A row that fails does not undo the others.
- A book that changed after the review was made is checked again when it is applied, and skipped with the reason if
  the choice no longer holds.
- Cells in a downloaded report that a spreadsheet could run as a formula are made harmless.
- API changes are additions ([ADR-0082](0082-api-compatibility-policy-and-enforcement.md)). New tables go in the
  initial migration ([ADR-0030](0030-consolidate-preproduction-migrations.md)), so development databases must be
  recreated.

## Alternatives

- **Apply on upload.** Fewer steps, but a large file could create many duplicate or wrong books with no easy way back.
- **A column matching screen.** It would accept more files at the cost of a more complex screen and more ways to import
  the wrong data. The template covers other sources.
- **Anyone may import.** People could bring their own ratings without an administrator, but they cannot add copies, so
  it would be a second, different import.
- **Every row becomes a copy without asking.** It needs no selection, but a Goodreads library can also list books that
  were borrowed, wanted or read elsewhere, and they would appear as owned.
- **Preselect the rows marked as owned,** as first proposed. If Owned Copies was never filled in, little or nothing would
  start selected.
- **Look up every book online.** Records would be fuller, but a large file means thousands of requests under provider
  limits, and wrong matches would need cleaning up.

## Consequences

A household can move its list in without typing it, and can see each effect first. The administrator's own reading
comes with it. Other people's ratings and reading are not covered. Books will often arrive without covers or
descriptions. Books that were only read, and are not in the catalogue, are not brought in.

Every import needs one answer about ownership before it can be applied.

## Verification

The import was built on 2026-11-27. The checks planned for it:

- made-up CSV files only are committed; nobody's real export is added to the repository;
- columns in any order, extra and missing columns, wrapped ISBNs, quoted line breaks, a byte order mark and bad values
  are handled as described, and oversized files are refused;
- nothing in the catalogue changes before the import is applied;
- running the same file or plan again adds nothing, and an interrupted import finishes without duplicates;
- name-only matches are never joined or duplicated without a choice;
- existing ratings, reviews, dates and reading state are unchanged;
- one account never sees another's plan or review text, and Private Notes are stored nowhere;
- downloaded reports cannot run formulas;
- an import of 10,000 rows can be reviewed in the browser and applied;
- the API compatibility check accepts the changes.

**Choices made while building,** within this record. Change any of them if they are wrong:

- The Litara template uses the Goodreads column names and adds Location, Series and Series Number.
- Only dates written year first are read. A date such as 03/04/2025 could be either of two days.
- An ISBN wrapped as `="…"` is read whether or not the file quotes it. Any other broken quoting refuses the file.
- An account can have ten imports waiting. A finished report is kept until it is removed; it holds titles, authors and
  outcomes, not the other contents of the file. An import cannot be cancelled while it is being applied.
- Titles are used as the file writes them. If an export adds a series to a title, such a row will not match a book by
  its name. This waits for the check of a real export.

## Open questions

The eight questions in the proposal are answered.

**Not yet checked:** the column names, ISBN wrapping, date format, shelf list and Owned Copies values against a current
Goodreads export. Until then the reader accepts the likely forms, leaves out any value it cannot read for certain and
names it in the review. An export from the owner would settle it. It should stay outside the repository, and only its
header row and the shape of its values are needed.
