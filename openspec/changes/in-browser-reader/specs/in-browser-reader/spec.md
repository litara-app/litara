## Foliate.js File Reference

The reader uses [Foliate.js](https://github.com/johnfactotum/foliate-js) (v1.0.1, MIT) vendored into `apps/web/public/foliate-js/`. The library is served as static files and loaded via ES module imports — it cannot be bundled because it uses dynamic relative imports internally.

`reader.html` imports only `view.js` directly. Everything else is loaded on-demand by the library itself.

### Files in `apps/web/public/foliate-js/`

#### `view.js` — Main entry point ✅ Actively used

The `<foliate-view>` custom element (Web Component). `reader.html` imports this file and registers the element. Handles file type detection, lazy-loads the appropriate format module, manages annotations via `Overlayer`, tracks section/TOC progress via `progress.js`, and exposes the high-level API (`init`, `next`, `prev`, `goTo`, `search`, `addAnnotation`, etc.) that `reader.html` calls directly.

#### `epubcfi.js` — EPUB CFI parser/generator ✅ Actively used

Statically imported by both `view.js` and `epub.js`. Implements the EPUB Canonical Fragment Identifier (CFI) spec — the string format used to record and restore a reader's position (e.g. `epubcfi(/6/4[chap01]!/4/2/1:0)`). All reading-progress save/restore in `ReaderPage.tsx` depends on CFIs produced by this module.

#### `epub.js` — EPUB renderer ✅ Actively used

Dynamically imported by `view.js` when the opened file is an EPUB. Parses the OPF manifest/spine, resolves resources, handles encryption, and provides the book object passed to the paginator. The most heavily exercised module for this project's primary use case.

#### `paginator.js` — Reflowable layout engine ✅ Actively used

Dynamically imported by `view.js` for reflowable (non-fixed-layout) EPUBs. Manages the columnar/scrolling layout inside an iframe, handles page turns, and fires `relocate` events carrying the CFI and progress fraction that `reader.html` forwards to `ReaderPage.tsx`.

#### `fixed-layout.js` — Fixed-layout renderer ✅ Actively used (conditionally)

Dynamically imported by `view.js` for fixed-layout EPUBs (e.g. children's books, manga with pre-rendered pages). If a book's OPF declares `rendition:layout pre-paginated`, this module is used instead of `paginator.js`.

#### `search.js` — Full-text search ✅ Actively used

Dynamically imported by `view.js` when `view.search()` is called. Provides `searchMatcher`, which walks the book's text nodes and yields CFI-anchored match ranges. `reader.html`'s search bar drives this.

#### `overlayer.js` — Highlight/annotation layer ✅ Actively used

Statically imported by `view.js`. Renders SVG overlay shapes on top of book content for highlights, search result markers, and text selections. Required even when no annotations exist because `view.js` always instantiates it.

#### `progress.js` — TOC/section progress tracker ✅ Actively used

Statically imported by `view.js`. `TOCProgress` maps a CFI to a TOC entry; `SectionProgress` computes the fractional progress within the current spine section. The `fraction` value in `relocate` events comes from this module.

#### `text-walker.js` — Text node traversal ✅ Actively used

Statically imported by `view.js`. Provides `textWalker`, a utility that iterates text nodes across document frames. Used internally by the search and annotation subsystems.

#### `mobi.js` — MOBI/AZW/AZW3 renderer ✅ Actively used (conditionally)

Dynamically imported by `view.js` when the file's MIME type is `application/x-mobipocket-ebook` or `application/vnd.amazon.ebook`. Decodes the proprietary Mobipocket/Kindle container and converts it to an EPUB-like structure for rendering.

#### `fb2.js` — FictionBook 2.0 renderer ✅ Actively used (conditionally)

Dynamically imported by `view.js` for `.fb2` files. FictionBook is an XML-based Russian ebook format. The API currently does not assign a MIME type for FB2, but the module is present and reachable if a file matches.

#### `comic-book.js` — CBZ/CBR renderer ✅ Actively used (conditionally)

Dynamically imported by `view.js` for comic-book ZIP archives (`.cbz`). The file-serving endpoint maps `.cbz` to `application/x-cbz`; `view.js` uses this type to load the module.

#### `vendor/zip.js` — ZIP reader ✅ Actively used

Dynamically imported by `view.js` before any format module is loaded, as EPUBs and CBZ files are ZIP archives. Provides the low-level archive reader used by `epub.js` and `comic-book.js`.

#### `vendor/fflate.js` — Decompression library ✅ Actively used (conditionally)

Dynamically imported by `view.js` specifically for MOBI files that use Huffman/CDIC compression. Not needed for standard EPUBs.

#### `footnotes.js` — Footnote popup enhancement ✅ Actively used

Imported by `reader.html`. EPUBs mark footnote references with `epub:type="noteref"` and targets with `epub:type="footnote"` or `epub:type="endnote"`. Without this module, clicking a footnote reference would navigate away from the current page. With it, a `FootnoteHandler` intercepts the `link` event from `view.js`, extracts the footnote content into a mini `<foliate-view>`, and dispatches a `render` event. `reader.html` handles that event by displaying the content in a slide-up panel at the bottom of the screen. Escape or the × button dismisses it. The handler also heuristically detects superscript links that aren't explicitly marked, so it works with less strictly-tagged EPUBs.

#### Files not used at runtime

| File      | Purpose                                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dict.js` | Local StarDict/dictd dictionary reader — reads binary `.dict.dz` + `.idx` files; no web calls; requires user-supplied dictionary files and a separate word-selection UI; out of scope |

---

## ADDED Requirements

### Requirement: Reader page renders EPUB in the browser

The system SHALL provide a full-page reader route at `/read/:bookId` that renders the book's EPUB file using Foliate.js inside a sandboxed iframe. The page SHALL replace the main application layout (no navbar/sidebar).

#### Scenario: Opening the reader for an EPUB book

- **WHEN** an authenticated user navigates to `/read/:bookId`
- **THEN** the reader page loads, fetches the ebook file via `GET /api/v1/books/:id/file`, and renders the first page (or the saved position if one exists)

#### Scenario: Reader is not accessible without authentication

- **WHEN** an unauthenticated request is made to `GET /api/v1/books/:id/file`
- **THEN** the API returns 401 Unauthorized

#### Scenario: Book has no supported file

- **WHEN** a user navigates to `/read/:bookId` for a book with no EPUB file
- **THEN** the reader page displays an error message explaining the format is not supported for in-browser reading

### Requirement: File serving endpoint

The system SHALL expose `GET /api/v1/books/:id/file` that streams the raw ebook file to the client. If the book has multiple files, the endpoint SHALL prefer EPUB; if no EPUB exists it SHALL return the first available file.

#### Scenario: Serving an EPUB file

- **WHEN** an authenticated request is made to `GET /api/v1/books/:id/file`
- **THEN** the API streams the file with the correct `Content-Type` (`application/epub+zip` for EPUB) and `Content-Disposition: inline`

#### Scenario: Book not found

- **WHEN** `GET /api/v1/books/:id/file` is called with an unknown book ID
- **THEN** the API returns 404 Not Found

### Requirement: Reader navigation controls

The system SHALL provide previous page, next page, and exit controls. Keyboard arrow keys SHALL also navigate pages.

#### Scenario: Navigating forward

- **WHEN** the user clicks the next-page button or presses the right arrow key
- **THEN** the reader advances to the next page/section

#### Scenario: Navigating backward

- **WHEN** the user clicks the previous-page button or presses the left arrow key
- **THEN** the reader moves to the previous page/section

#### Scenario: Exiting the reader

- **WHEN** the user clicks the exit button
- **THEN** the user is returned to the previous page (book detail or library)

### Requirement: Reader appearance settings

The system SHALL allow the user to adjust font size and select a theme (light, sepia, dark). These preferences SHALL be persisted in localStorage and applied on every reader open.

#### Scenario: Changing font size

- **WHEN** the user adjusts the font size control in the reader toolbar
- **THEN** the rendered text reflows at the new size immediately

#### Scenario: Changing theme

- **WHEN** the user selects a theme (light / sepia / dark)
- **THEN** the reader background and text colour update immediately

#### Scenario: Preferences are restored on next open

- **WHEN** the user opens the reader after previously setting a font size and theme
- **THEN** the same font size and theme are applied without the user needing to reselect them
