# ADR-0099: An annotations hub with search and export

Status: Accepted
Date: 2026-11-25
Decision owner: Repository owner

## Context

[ADR-0066](0066-private-annotations-and-shelves.md) makes highlights, notes and bookmarks private per user, anchored to an edition, revisioned, and deleted by tombstone. Today they can only be listed per edition (`GET /editions/{id}/annotations`), so the web shows them only on a title's Highlights tab. There is no way to see, search or take out everything a person has written across books. The 2026-11-25 sweep ranked an annotations hub with cross-book search, filters and Markdown, CSV and JSON export second among BookOrbit features (`research/sweep-2026-11-25.md`).

Nothing yet decides whether annotations on books the person can no longer access appear, where search and export run, or what can be done from the hub. These change what a person sees and what other clients can do, so they are the owner's.

## Decision

On 2026-11-25 the owner chose:

1. **Annotations on books the person can no longer access are hidden**, in the list, the counts and the export. This is the same rule as shelves (ADR-0066) and reading stats (ADR-0098). They return if access is restored; nothing is deleted.
2. **Search and filtering run on the server.** A new read endpoint lists the caller's own live (not deleted) annotations across every edition they can see, paged, newest change first. It searches note text, quoted text, book title and author, and filters by kind and by title.
3. **Export is a server endpoint.** It returns Markdown, CSV or JSON for the same filters as the list, so any client gets the same file.
4. **The hub can edit a note, delete an entry, and open the reader or the title page.** Edits and deletes use the existing revisioned annotation writes (ADR-0066). A stale edit or delete is a conflict, as everywhere else.

It is a page in the main navigation, built with UI SDK (ADR-0079).

The following are implementation defaults, open to the owner's change (see Open questions):

- Endpoints (additive under ADR-0082): `GET /annotations?q=&kind=&titleId=` (paged), `GET /annotations/titles` (the books that have annotations, with counts, for the book filter), and `GET /annotations/export?format=markdown|csv|json&q=&kind=&titleId=`.
- Search is a case-insensitive substring match, with wildcard characters taken literally. The query is limited to 200 characters.
- Markdown groups entries by book, with the quote as a block quote and the note beneath. CSV has one row per entry, and a cell that starts with `=`, `+`, `-` or `@` is prefixed with `'` so spreadsheets don't run it as a formula. JSON lists entries with their IDs, book, kind, quote, note and times. None of the formats includes reader locators.
- The export has no size limit beyond what the person can see.

## Alternatives

- Show annotations from books the person lost access to, marked unavailable: they are the person's own words, but it would show titles and quoted text from a library they were removed from.
- Filter in the browser over everything loaded: simpler, but slow with thousands of entries and of no use to other clients.
- Build export files in the browser: no new endpoint, but only the web app could export.
- A read-only hub: fewer moving parts, but edits would mean going to each title page.

## Consequences

Annotations become searchable and exportable across the whole collection by any client. Access changes affect what the hub and its exports show. The export holds private notes, so it is served only to the owner of those notes and is never cached. Search uses a sequential scan of the caller's own annotations, which is fine at personal scale; a text index can be added later without an API change.

## Verification

Planned: listing across two editions of different titles; another account's annotations and tombstones excluded; annotations on a library whose grant was removed excluded from list, titles and export; search matching note, quote, title and author, with `%` and `_` taken literally; kind and title filters; each export format's content type, attachment name and contents, including a CSV formula cell; anonymous requests refused; the web page searching, filtering, editing a note, deleting and exporting.

## Open questions

Not chosen by the owner: the endpoint shapes and the 200-character query limit, substring rather than word search, the export layouts and the CSV formula guard, leaving locators out of exports, and the lack of an export size limit.
