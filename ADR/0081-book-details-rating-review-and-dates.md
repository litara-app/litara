# ADR-0081: Add descriptive book details and personal rating, review and reading dates

Status: Accepted
Date: 2026-11-20
Decision owner: Repository owner

## Context

The dense title page needs publisher, published date, page count, ISBN and a synopsis, plus a star rating, a written review, and dates started and finished. The server stores only title, authors, series, language and tags (ADR-0047 selects source priority; ADR-0065 puts metadata on editions). ADR-0011 lists the first-release scope and does not list ratings, reviews or reading dates, so personal reading state beyond position, completion and annotations needed an explicit decision.

## Decision

The user selected the following on 2026-11-20:

- **Descriptive fields.** Add `publisher`, `published`, `page_count`, `isbn` and `description` (the synopsis) as edition metadata fields. They follow ADR-0047 exactly: protected user edits and clears, then an associated sidecar, then the file's own tags (EPUB/OPF, FB2, ComicInfo), with provenance and conflicts kept. Page count has no source in most files, so it is usually entered by hand. Online providers stay a later opt-in (ADR-0049). "Added" is the edition's creation time and is not editable.
- **Rating.** A private per-account rating per title in half-star steps from half a star to five stars. It is stored as an integer count of half stars, 1 to 10, and absent means unrated.
- **Review.** A written review is private to its author. It is never returned to another account and never appears in library listings.
- **Dates started and finished.** Derived from reading history (first saved position or opened edition; latest finish event), with an optional per-account override that Litara keeps until the person clears it.

## Alternatives

- Whole stars only, a shared average rating, or ten-point ratings.
- Reviews visible to everyone with library access.
- Dates only derived, or only entered by hand.
- Estimating page count from file text.

## Consequences

Rating, review and date overrides are personal state: they are keyed by account and title, written with a base revision and an operation ID like other personal writes, and a stale write is refused with the current revision rather than replaced. Half stars are a new integer wire unit; a client that only knows whole stars must round, and KOReader's synchronization protocol (progress only) and the Android client (which does not use ratings yet) are unaffected. The metadata field list is extended in the database constraint, the OpenAPI contract and the sidecar and write-back mappings, so those must be kept in step. Existing files and sidecars without the fields are unaffected.

## Verification

Planned: embedded values read from an EPUB, FB2 and ComicInfo file; a protected edit and a clear surviving a rescan; a half-star rating set, replayed with the same operation ID, refused when stale and cleared; a review that no other account can read; derived dates, then overridden, then cleared; the new fields in the OpenAPI contract check. These are planned checks, not completed tests.

## Update 2026-11-20 (implementation, requested by the user)

The user asked for OPDS exposure, sidecar support and in-file write-back of the descriptive fields. Implemented: the OPDS Atom and JSON feeds carry publisher, published date, page count (JSON only) and ISBN (Atom only), and the real synopsis replaces the generic "Ebook original file." line (for an audio file the synopsis follows the file facts); Litara JSON and OPF sidecars read and export publisher, published, isbn and description for recordings; and the EPUB writer writes publisher, published, isbn and description (a page count cannot be written to an EPUB and is refused). Ebooks have no sidecar flow today, so there is nothing to extend there. The synopsis treatment in OPDS and the refusal to write a description containing `<` or `>` are implementation defaults, not user selections.

## Update 2026-11-20 (page counts, ebook sidecars, audiobook details and tag write-back, requested by the user)

- **Page counts in prior work.** Old Litara (`archive/litara-v1`) never read a page count from a file: it came from online providers (Open Library `number_of_pages_median`, Google Books `pageCount`, Hardcover `pages`, Goodreads `numberOfPages`) or manual entry. BookOrbit also relies on providers, plus its own markers in the book: it reads `bookorbit:page_count` (a `<meta property>` or name/content pair) and a Calibre custom column named `#pagecount` or `#page_count`, and writes `bookorbit:page_count` back. Neither estimates pages from text. Litara follows the same shape: it reads `litara:page_count`, then `bookorbit:page_count`, then the Calibre column; it writes `<meta name="litara:page_count" content="N"/>` (no vocabulary prefix is needed for the name/content form) and keeps an existing `bookorbit:page_count` in step; it will not clear a count held only in a Calibre column. A page count from a provider remains a later opt-in (ADR-0049).
- **Ebook sidecars.** `<book>.litara.json`, `<book>.opf`, or any Litara JSON or OPF in a folder that holds exactly one ebook, is associated with that edition (otherwise it needs review; nothing is guessed). Its values become "sidecar" evidence between your edits and the file's own tags, and are removed again when the sidecar goes. The Litara JSON sidecar also carries `language`, `tags` and `pageCount` for ebooks. An administrator can plan, approve and run an export to `<book>.litara.json` (`POST /admin/editions/{id}/writebacks/sidecar`). A sidecar that could belong to both a recording and an ebook, or to several ebooks, is left for the person to rename.
- **Audiobook details.** `GET /recordings/{id}/details` returns the title's effective publisher, published date, ISBN and synopsis (an audiobook has no page count), and the web Details and Edit metadata tabs use it.
- **MP3, M4B, M4A and FLAC tag write-back.** The audio writers now also write publisher, published date, ISBN and description, or remove them when cleared, without touching audio packets, chapters, artwork or any other tag: ID3 `TPUB`, `TDRC` (a year-only `TYER` in ID3v2.3), and `TXXX` descriptors `DESCRIPTION` and `ISBN`; MP4 `©day`, `desc` and freeform `----` items `PUBLISHER` and `ISBN`; Vorbis comments `PUBLISHER`, `DATE`, `DESCRIPTION` and `ISBN`. As before, a writer runs only after its format has recorded fidelity evidence (ADR-0052).

## Open questions

Whether providers should fill page counts (ADR-0049 opt-in), whether an ebook sidecar that is ambiguous should get a review screen instead of a rename, whether the JSON feed should carry the ISBN (Readium has a single `identifier`, which Litara keeps as the stable publication ID), and a derived "reading status" label are not decided here.
