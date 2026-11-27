# ADR-0113: How Android creates and draws PDF highlights

Status: Proposed
Date: 2026-11-27
Decision owner: Repository owner

## Context

On 2026-11-27 the owner asked for highlights and notes in the Android PDF reader. Page notes and bookmarks needed no new
decision: a PDF page locator already syncs ([ADR-0065](0065-ebook-editions-and-reading-state.md),
[ADR-0066](0066-private-annotations-and-shelves.md)), and they are built. Web highlights are listed in Android by page.

Creating or drawing a highlight needs positions inside the page. The contract is rectangles as fractions of the unrotated
crop box. What exists today, from the code:

- The web computes them in `apps/web/public/reader/bridge.js` with PDF.js.
- Android's default PDF reader uses the system `PdfRenderer`. It has search, links, continuous and paged scrolling, zoom,
  rotation and spreads. It can read text only on Android 15 and later. Nothing proves its coordinates match the web's,
  including on rotated or cropped pages.
- The shared web engine ([ADR-0093](0093-android-reader-parity-with-the-web-reader.md)) already runs on Android behind a
  build flag that is off. Its PDF screen is deliberately bare: no search, no PDF settings.

## Decision

None yet. Recommendation: **keep the system reader for reading and add a "Highlight" mode that opens the shown page in the
shared web engine.** In that mode the person selects text or drags an area; the rectangles come from the same code as on
the web. Reading, search and settings stay as they are. Before it ships, a test on the emulator must show that the same
selection on rotated and cropped fixture pages gives the same rectangles as desktop browsers.

## Alternatives

- **Switch PDF reading to the shared engine.** One reader and highlights drawn while reading, on every Android version.
  It loses PDF search and the current PDF settings until they are rebuilt.
- **Add selection to the system reader.** Highlights drawn while reading, with search and settings kept. It works only on
  Android 15 and later, needs its own selection handles, and needs a proven coordinate conversion for rotated and cropped
  pages, which the system reader may not give enough information for.
- **Leave highlighting to the web.** Android keeps listing web highlights by page. No more work.

## Consequences

With the recommendation, highlights are visible on Android only in the highlight mode, and the person switches views to
make one. It does not decide whether PDF reading later moves to the shared engine.

## Verification

Planned for any choice that draws highlights: matching rectangles on the PDF fixtures (including rotated and cropped
pages) between Android and desktop browsers; a highlight made on each side appears in the right place on the other.

Done independently of this record, on an emulator on 2026-11-27: a page note and a bookmark created on Android reached
the server with page locators; an edit and a delete reached it; a web highlight appeared in Android's list.

## Open questions

Which of the four choices the owner wants.
