# ADR-0113: How Android creates and draws PDF highlights

Status: Accepted
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

On 2026-11-27 the owner chose highlight mode, in their words: "build highlight mode." They had been given this
description of it and its drawbacks:

- **Keep the system reader for reading and add a "Highlight" mode that opens the shown page in the shared web engine.**
  In that mode the person selects text or drags an area, picks a colour and may add a note; the rectangles come from the
  same code as on the web. Reading, search and settings stay as they are.
- Before it ships, a test on the emulator must show that the same selection on rotated and cropped fixture pages gives
  the same rectangles as desktop browsers. If it does not, stop and report.

This does not decide whether PDF reading later moves to the shared engine.

After the trial below failed, the owner answered "Yes, fix and build" on 2026-11-27 to this proposal: fix the web
reader's PDF text layer and update Android's copy of it; check selections against where the text really is, comparing
where each line starts and how long it is strictly while allowing a small difference in box thickness (the experiment
showed up to 1.4% of the page on one rotated page); and, if those checks pass, build highlight mode. Text highlights
saved before the fix stay where they are and have to be recreated.

## Alternatives

- **Switch PDF reading to the shared engine.** One reader and highlights drawn while reading, on every Android version.
  It loses PDF search and the current PDF settings until they are rebuilt.
- **Add selection to the system reader.** Highlights drawn while reading, with search and settings kept. It works only on
  Android 15 and later, needs its own selection handles, and needs a proven coordinate conversion for rotated and cropped
  pages, which the system reader may not give enough information for.
- **Leave highlighting to the web.** Android keeps listing web highlights by page. No more work.

## Consequences

Highlights are drawn on the page only in highlight mode; during normal reading they are listed. The person switches views
to make one. The page can look slightly different, the system reader's zoom and rotation settings do not carry over, and
dragging draws a box while area selection is on. Time and memory for large PDFs in the second view are unmeasured.

## Verification

Planned: matching rectangles on the PDF fixtures (including rotated and cropped pages) between Android and desktop
browsers; a highlight made on each side appears in the right place on the other.

**Trial on 2026-11-27: failed, so work stopped as decided above.** On all seven pages of
`scripts/android/reader-locators/fixtures/edge.pdf`, area boxes drawn by touch on the Android emulator matched desktop
Chromium within 0.13% of the page, and a real long press selected text. Text selections did not match. The cause is in the
web reader, not the Android port: its PDF text layer lacks the style rules PDF.js needs to size the invisible text. The
fixture's first line is about 43% of the page wide; the reader reported 7% in desktop Chromium and WebKit, 6% in Firefox
and 13% on Android. So PDF **text** highlights made on the web today are saved over the wrong part of the page. Area
highlights are not affected.

A temporary experiment added those rules at run time, without changing the reader. On the first page, Chromium, Firefox
and WebKit then reported the correct width and left edge. (An earlier wording here did not say that only the first page
had been compared with the text's true place.) On Android the length along the line matched desktop Chromium; the box
thickness differed by up to 0.7% of the page on six pages and 1.4% on one rotated page. Fixing the reader needs the
owner's go-ahead. Highlight mode and the syncing of text rectangles are not built.

Done before this feature, on an emulator on 2026-11-27: a page note and a bookmark created on Android reached the server
with page locators; an edit and a delete reached it; a web highlight appeared in Android's list.

**Fix, 2026-11-27.** The check now compares each selection with the black pixels of the text drawn on the page, in
addition to comparing browsers. It showed that the sizing rules alone left the rotated pages wrong: PDF.js also relies on
rules that turn the text layer with the page. With both sets of rules in `apps/web/public/reader/bridge.js`, the selection
sits on the drawn text on all seven fixture pages in Chromium, Firefox and WebKit.

**Done, 2026-11-27, on an emulator (Android 16) with a local server.** On all seven fixture pages the Android WebView's
selections sat on the drawn text and differed from desktop Chromium by at most 0.06% of the page along a line and 0.7%
across it, and touch-drawn area boxes by at most 0.13%. In highlight mode: a long press selected a word; a highlight, a
colour change, a note on a drawn box and a delete reached the server; the web reader showed Android's highlights in place
and Android showed one made on the web; a highlight made with the network off was sent when the book was reopened. A tap
on a saved highlight did nothing at first, because the text layer covered it; the shared reader now looks under the text
layer. The release (minified) build was checked for making and recolouring a highlight. Not verified: a physical phone,
older Android versions, large PDFs (time and memory), and encrypted PDFs.

Highlight mode is off when the server's PDF engine profile differs from the one the app's reader copy was built for.
PDF text highlights saved by the web before this fix keep their wrong rectangles and have to be recreated. An unsent
highlight is sent when the book is next opened; there is no background retry for annotations.

## Open questions

None within this record's scope.
