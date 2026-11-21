# ADR-0086: Let administrators replace a title's cover

Status: Accepted
Date: 2026-11-20
Decision owner: Repository owner

## Context

Ebook covers in the web app today are generated placeholders drawn from the title and author; only recordings have real artwork (`/recordings/{id}/artwork/cover` and `/thumbnail`, extracted at inspection). The owner wants covers that can be replaced as BookOrbit allows: search online, upload a file, enter a URL, or regenerate from the ebook or audiobook file. Hovering the cover on the book page shows an edit icon that opens the metadata tab, where the cover and the other metadata are edited.

BookOrbit, pinned in [research](RESEARCH.md), exposes `GET cover/search` (iTunes and DuckDuckGo image providers, with a `cover/proxy` for previews), `POST :id/cover` (multipart upload), `POST :id/cover/from-url` (server-side fetch behind an SSRF guard with byte, redirect and time limits), `DELETE :id/cover` (revert to the extracted cover) and `POST re-extract-cover`, with a separate "medium" for ebook and audiobook covers. This is a code observation of the BookOrbit source, not Litara behavior.

Covers touch several accepted decisions: originals are preserved and write-back is explicit and reviewed ([ADR-0048](0048-reviewed-in-file-metadata-writeback.md) and the ADRs it names), library access limits every media route ([ADR-0013](0013-library-access-local-login.md)), and the API is additive within `v1` ([ADR-0082](0082-api-compatibility-policy-and-enforcement.md)).

## Decision

On 2026-11-20 the repository owner chose:

- **Storage.** A chosen cover is kept in a server-managed image store, a database table holding the bounded JPEG (a few hundred kilobytes at most, so no new data folder is needed and backups include it); library folders and book files are never changed by choosing a cover. The owner also wants the cover written into the book file; that goes through the existing reviewed write-back flow as a second phase (below), not as a side effect of choosing a cover.
- **Scope.** One cover per title and medium: an ebook cover (portrait) and an audiobook cover (often square). Editions and recordings of a title share its slot for their medium. An uploaded or chosen cover overrides the file-extracted one until it is reverted.
- **Sources.** Upload an image; give a URL the server fetches; search online; or regenerate from the file (the cover inside the EPUB, PDF first page, comic first page, or the audiobook's embedded art) with "revert" returning to that extracted cover.
- **Online search.** Open Library and iTunes, queried server-side with only the title and author. It is off until an administrator enables it in server settings. No DuckDuckGo image scraping.
- **Fetch by URL.** The server fetches only public addresses over http or https (loopback, private, link-local and metadata addresses refused, re-checked on every redirect), at most 3 redirects, 10 seconds, 10 MiB, JPEG, PNG or WebP by content sniffing (the declared type is not trusted).
- **Stored image.** Every source is decoded and re-encoded as a bounded JPEG (longest side at most 1600 px) with metadata stripped, so a hostile or oversized file is never served as uploaded. Uploads are limited to 10 MiB.
- **Authority.** Administrators with access to the title's library change covers; every member with access sees them. Changing a cover replaces the slot atomically and gives it a new version (used as the ETag); the last write wins, since only administrators write and the change is a whole-image replacement.
- **API.** New additive routes under `/titles/{titleId}/cover` and `/cover-search`, recorded with `ctl api-baseline update` and the contracts. The title list and detail gain a `coverVersion` so clients can cache by version.
- **Phase 2, in-file cover (2026-11-20).** Embedding the stored cover reuses the staged, validated, version-checked write-back flow with its approval step; nothing is written unless an administrator reviews and approves it, and the format's writer must be enabled with recorded fidelity evidence ([ADR-0052](0052-fidelity-tested-tag-writing-formats.md)). The plan stores a reference and a SHA-256 of the stored cover, not the image, and the write is refused if the cover changed after review. Writers: **EPUB** replaces the image the package already declares as its cover, in that image's own format (JPEG as is, PNG re-encoded), or, when none is declared, adds one `litara-cover.jpg` entry, one manifest item (with `cover-image` in EPUB 3) and one `<meta name="cover">`, and validation proves nothing else in the package or archive changed; **M4B and M4A** replace or add the single `covr` picture; **MP3** replaces the front-cover `APIC` frame (or the only picture there is), or adds a front-cover frame beside other pictures. Audio files keep their packets, chapters and other tags byte for byte, and the engine accepts at most one more picture and one more attached-picture stream. An audiobook with several files gets one plan per file, each with its own approval. Refused as unsupported: FLAC, an EPUB with an empty manifest or a dangling cover reference, a declared cover that is not JPEG or PNG, an MP4 `covr` item holding several pictures, and the other formats.

## Alternatives

- Store covers only in the database (a blob). Simpler backups, but it bloats the database and complicates caching.
- Write covers beside books as `cover.jpg`. Visible to other tools, but needs write access to library folders, which NAS-backed libraries ([ADR-0007](0007-support-nas-book-storage.md)) may not give.
- Per-edition covers. More control, more to manage; not needed now.
- DuckDuckGo image search. More results, but it scrapes an unofficial endpoint and breaks easily.

## Consequences

The server now stores and serves images, so it needs an image pipeline (decode, bound, re-encode), a bounded outbound fetch client with an address guard, and a settings switch for online search. Serving a cover is a media route and must enforce library grants like every other media route. Re-encoding means a stored cover is not byte-identical to the source. Phase 2 inherits the write-back evidence requirements, so it may land later than phase 1.

## Verification

Planned: upload, URL fetch, search and regenerate each produce a served cover; a cover is refused to a user without library access; hostile inputs (an SVG, a polyglot, an oversized image, a decompression bomb, a redirect to a private address, a URL that resolves to loopback) are refused and nothing is stored; revert returns to the extracted cover; originals are byte-identical after every operation; the hover edit control opens the metadata tab; `go test ./...`, `tsc`, `vitest`, the API baseline and the contract comparison pass. Nothing is verified yet.

## Open questions

- FLAC picture blocks and other formats (MOBI, AZW3, FB2, PDF, CBZ) each need their own writer and fidelity evidence.
- Whether non-administrators may propose a cover.
- Cover search result ranking and whether OPDS feeds should serve the stored cover.
