# ADR-0102: Pull, edit and lock author data as for books

Status: Accepted
Date: 2026-11-25
Decision owner: Repository owner
Amends: [ADR-0100](0100-author-and-series-directories.md)
Amended by: [ADR-0104](0104-author-and-series-page-defaults.md) (2026-11-26): answers several open questions below. Also amended by [ADR-0105](0105-author-photos-and-concurrent-edits.md) (2026-11-26): photo storage and limits, and refusing out-of-date edits.

## Context

[ADR-0100](0100-author-and-series-directories.md) keeps no author records: an author is a name taken from title metadata. The [Authors and Series mockups](../design/mockups/reading-room-authors-series.html) give each author a photo and a biography, which need a source and somewhere to be stored, and [ADR-0101](0101-authors-by-last-name.md) lets a guessed last name be corrected. Book metadata already has per-field editing, locks, provenance and reviewed provider apply ([ADR-0095](0095-field-level-metadata-editing-and-provider-review.md), amended by [ADR-0096](0096-reconcile-metadata-editing-with-provider-and-cover-decisions.md) and [ADR-0097](0097-metadata-field-locks.md)).

## Decision

On 2026-11-25 the owner chose, in their words: "for authors, just like for books, we need to be able to pull author data, lock fields, etc."

1. Author data can be pulled from online sources.
2. Author fields can be locked.
3. Book metadata editing is the model for how this behaves.

On 2026-11-26 the owner chose the sources: author data uses **Hardcover first and Open Library as a fallback**, the same order [ADR-0103](0103-series-data-and-missing-books.md) uses for series.

This amends only ADR-0100's statement that there are no author records, to the extent that author data must now be stored. An author is still identified by name ignoring case. Aliases and merging remain unselected.

## Alternatives

- Manual entry only: needs no provider integration, but every author is filled in by hand.
- A separate, simpler editing model for authors: less work, but behaves differently from books.

## Consequences

Stored author data, API operations (additive under [ADR-0082](0082-api-compatibility-policy-and-enforcement.md)), provider integration and an author edit screen are needed; none exists. The schema follows [ADR-0030](0030-consolidate-preproduction-migrations.md). Hardcover has not been tested live for authors, and the [research](../research/author-series-sources.md) records unconfirmed points about its terms of use; no license was found for Open Library author photos or biographies. Books belong to libraries and providers are enabled per library, while one author can span several libraries, so the book rules do not settle which providers apply to an author or who may edit one.

The mockup applies these book rules to authors as its reading of "just like for books": click-to-edit fields with their source shown; a locked field must be unlocked before any change; unlock keeps the value; Reset to source discards a saved value; online results are reviewed field by field before applying; "Use all" skips locked and edited fields. Its provider names and results are invented samples.

## Verification

Planned, not yet done: author data survives rescans; the server refuses changes to a locked author field; unlock keeps the value; applying online values changes only the chosen fields; access to author data respects library grants ([ADR-0013](0013-library-access-local-login.md)).

## Open questions

- The terms for storing and showing author text and photos from the two sources, and how provider enablement works for an author in several libraries.
- Which fields authors have (the mockup shows last name, introduction, biography and photo).
- Which other book behaviors "etc." covers, including auto-fill and its matching rule (authors have no equivalent of an ISBN), provider search caching, and revision conflict handling.
- Who may edit author data, and what happens to it when the author's name changes in title metadata.
- Storage and limits for photos.
- This record covers authors only. Series lookup, editing and locking are covered by [ADR-0103](0103-series-data-and-missing-books.md).
