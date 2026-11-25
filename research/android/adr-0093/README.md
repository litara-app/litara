# ADR-0093 step 2: do saved Android locators resolve the same in the shared engine?

Run 2026-11-23, desktop Chromium (Playwright), `node scripts/android/reader-locators/check.mjs`. Raw numbers: `locator-results.json`.

Setup. "Legacy" is the AGPL-modified Foliate in `apps/android/app/src/main/assets/reader/foliate`. "Shared" is pristine foliate-js and PDF.js as bundled in
`assets/reader-shared` (byte-identical to `apps/web/public/reader`, checked by `./gradlew checkSharedReader`). Locators were **recorded by the legacy engine**
(`saved-locators.json`, regenerate with `check.mjs record`) on two synthetic books (`fixtures/stress.epub`, `fixtures/stress.fb2`: nested inline markup, `<br/>`, lists,
tables, ruby, comments, emoji surrogate pairs, combining marks, RTL, an image) at two layouts (320x520 17px, 360x640 12px), then read back at a third (820x1100 24px)
in both engines. Each locator is reduced to (spine index, UTF-16 text offset, text).

| Check | EPUB legacy | EPUB shared | FB2 legacy | FB2 shared |
| --- | --- | --- | --- | --- |
| 54 / 18 saved page positions resolve to the same text | 54/54 | 54/54 | 18/18 | 18/18 |
| ... and navigating to them shows that text on the page | 54/54 | 54/54 | 18/18 | 18/18 |
| 84 / 42 saved highlight ranges: same index, offsets, text | 84/84 | 84/84 | 42/42 | 42/42 |
| 84 / 42 collapsed points (bookmarks) resolve to the same offset | 84/84 | 84/84 | 42/42 | 42/42 |

**PDF.** The Android PDF reader is native (`PdfRenderer`, `feature/reader/pdf`); it never used Foliate, so there is no legacy CFI to compare. Its saved form is a
1-based page number and a percentage. Checked: PDF.js 6.5.438 reads page index *i* of `fixtures/edge.pdf` (nested page tree, mixed sizes, /Rotate 90 and 270, CropBox,
labels i, ii, 1..5) as "PAGE i+1" for all 7 pages, and the Android percentage maps back to the same index for all 7 (the `PdfProgress.fractionToPage` arithmetic,
re-implemented in the script). That `PdfRenderer` orders the same file the same way was shown by eye and by search on an emulator in T007
(`research/t007/evidence/m1-locators/pdf-device`); it is not re-run by this script.

**Result: every locator resolved identically; nothing disagreed, so no migration is needed or written.** This repeats and extends the T007 slice-5 finding
(`research/t007/evidence/m1-locators/README.md`), now against the actual bundled copy and with locators frozen from the legacy engine.

## What this does not show

- Synthetic books only. No real-world corpus (calibre output, publisher EPUBs, fixed-layout, vertical text, footnote structures).
- KEPUB, MOBI, AZW, AZW3: no fixtures. T007 found `MOBI6` conversion differs between the engines, so they are **not** covered and stay on the legacy engine.
- Desktop Chromium only. The legacy engine was shown on the device WebView in T007; the shared engine on a device WebView is covered by the emulator test in step 3 (see handoff).
- PDF sub-page coordinates and area highlights (`pdf-rectangles`): the native reader never produced them, so there is nothing to carry over.
- Features the legacy Android bridge has and the shared protocol does not: in-book search (`searchResults`), page-tap zones (`tap`), selection rect in viewport coordinates
  (the shared `selection` carries a frame-local `rect`). Switching to the shared engine loses these until the protocol grows them (web-side change, MIT).
