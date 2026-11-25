# Handoff: ADR-0093 option 3b, first increment (shared reader engine on Android)

Branch `claude/adr-0093-shared-engine`, cut from the tip of `codex/edit-metadata` (0311e59). Governing ADR: ADR-0093 (and 0017, 0027, 0067, 0071). Its Verification section has the tested / not-tested list; the locator evidence is in `README.md` beside this file.

## What exists now

| Piece | Where |
| --- | --- |
| Copy + check of the web engine | `apps/android/shared-reader.gradle.kts` (`syncSharedReader`, `checkSharedReader` before every build); output `app/src/main/assets/reader-shared/` (checked in, never hand-edit) |
| Build flag | `-Plitara.sharedReader=true` -> `BuildConfig.SHARED_READER` (default false) |
| Host page for the frame (AGPL, Android-owned) | `app/src/main/assets/reader-shared-host/index.html` |
| Kotlin protocol, book responder (`/litara-book/<start>-<end>`) | `feature/reader/SharedReader.kt`; `ReaderController` has a shared mode (`openShared`, `sharedListener`, `setFont`, `sendShared`) |
| EPUB/FB2 behind the flag | `ReaderScreen` (WebView created after the format is known) |
| PDF behind the flag | `PdfReaderScreen` -> `SharedPdfReaderScreen` (bare: back, page n/N, tap zones); `PdfReaderViewModel.UiState.ref` added for it |
| Locator fixtures | `scripts/android/reader-locators/` (`check.mjs`, `saved-locators.json` recorded by the legacy engine, `fixtures/`); results in `research/android/adr-0093/locator-results.json` |
| Tests | JVM `SharedReaderProtocolTest`; emulator `SharedReaderEngineTest` (both pass); whole unit suite, both flavors, flag off and on, assemble OK |

## Decisions for the owner / the next sessions

1. **No locator disagreed** on the synthetic books, so no migration was needed. Real-book corpora, KEPUB and the MOBI family are unproven; the shared path is limited to EPUB, FB2 and PDF (`SharedReaderProtocol.EBOOK_FORMATS`). Whether to widen it needs fixtures first.
2. **Protocol extended (second increment)**: tap, search (+progress/done, cap via `max`), per-annotation colour/style, typography in `style`. Web check: `node scripts/web/reader-protocol/check.mjs`. Third step: `annotation-click` now carries `rect`; the web settings panel sends line spacing, alignment, hyphenation, columns, margins. Still missing: PDF search, and highlight colour/style persistence (server annotation `data` has no such fields; needs an additive API decision). `bridge.js` is the single source: change it in `apps/web/public/reader`, then `syncSharedReader`; never edit the Android copy.
3. A `goto` sent while a page-turn animation is settling was ignored by Foliate's paginator in the emulator. Chrome code that jumps straight after a turn (TOC, bookmark taps) should expect it, or the web bridge should serialize navigation.
4. WebView 154 failed `fetch` on HTTP 206 responses with a non-zero offset from `shouldInterceptRequest` (root cause not found), so ranges are plain 200 responses on a path (`/litara-book/<start>-<end>`).
5. Engine-profile refusal on Android (`LocatorPolicy`, `EditionProgress`) was not changed or wired to the shared copy's `ENGINE_PROFILE`; only the build-time check exists.
6. Fonts: the frame's `fonts` message works (`ReaderController.setFont`, bytes as base64 to the host page); the Android app bundles no font files yet (the emulator test copies Literata from `apps/web/node_modules` through Gradle `prepareTestFonts`, not committed).
7. Reading sessions (ADR-0092) from Android and the 3a decision are untouched.

## Not tested

No physical device. The flagged full screens were compiled, not driven (no server). Touch gestures, Room/API position saving, highlight/bookmark creation from the UI, Cast, Android Auto, the F-Droid flavor at runtime, lint, and offline behaviour were not exercised. Nothing was published or signed; no release workflow was run.
