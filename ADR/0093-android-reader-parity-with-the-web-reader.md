# ADR-0093: Bring the web reader's features to the Android reader

Status: Accepted
Date: 2026-11-22
Decision owner: Repository owner

## Context

The web reader gained features the Android reader does not have: an auto-hiding toolbar, a ribbon bookmark, a timeline that marks chapters, bookmarks, notes and highlights, bundled reading fonts (ADR-0091), a selection popup beside the text, a text-settings popover, and (ADR-0092) reading sessions. Each new web feature widens the gap.

What exists today, from the code:

- The web reader has two layers. The engine is a sandboxed frame (`apps/web/public/reader/bridge.js`, pristine MIT Foliate and PDF.js) that talks to the page over a message protocol (ADR-0067, ADR-0071). The chrome is React in the web app: toolbar, drawers, popovers, timeline, saving of positions and annotations.
- The Android reader (`apps/android/app/src/main/assets/reader/`) is its own copy: a 572-line `bridge.js` and AGPL-modified Foliate in a WebView, with the chrome in Kotlin (`feature/reader`, `feature/litara`, comics in `feature/reader/comic`). It saves through Room and the API.
- ADR-0027 kept the Android reader on purpose, to avoid replacing both engines at once. ADR-0017 keeps Android AGPL and the web and server MIT: MIT code may be used inside the AGPL app, but AGPL changes may not be copied into the MIT web source.
- Reading positions and highlights are stored as Foliate locators (CFIs). A different engine version can resolve them differently, which is why web positions carry an engine profile and the reader refuses to save when it does not match. Locators saved by the modified Android engine may not resolve identically in pristine Foliate.

## Decision

On 2026-11-23 the owner chose option 3b first: the web reader's engine is shared with Android and the Kotlin chrome stays. Whether to go on to option 3a later was not decided and is left until the cost of rebuilding chrome in Kotlin is known. The options below are kept as the context for that choice.

What the choice means, concretely:

- The web engine (`apps/web/public/reader/`: `bridge.js`, pristine Foliate, PDF.js and the message protocol) is the single source. Android gets it as a build output copied into its assets, not as a second hand-edited copy. A check fails the Android build when the bundled copy differs from the web source or when the engine profile differs from the server's.
- Android's modified Foliate and its own `bridge.js` are retired for ebooks and PDFs only after shared locator fixtures show that saved positions and annotations resolve at the same place. Where they do not, nothing is relabelled as compatible (see Open questions).
- The Kotlin chrome stays and is brought to the web layout one feature at a time against the same message protocol: auto-hiding toolbar, ribbon bookmark, timeline marks, fonts (the bundled font files travel over the same channel as on the web), selection popup, text settings.
- Web code is MIT and may be bundled into the AGPL app. Nothing from the AGPL Android reader is copied back into the web source (ADR-0017).

The options as proposed:

### Option 1: Port each feature into the Android reader

Keep two readers and implement every feature twice, in Kotlin and in the Android `bridge.js`.

- For: no change of engine, existing Android positions keep working, native feel.
- Against: the work is done twice for every feature and the two drift. The fonts need the WebView's own handling. Nothing keeps parity except effort.

### Option 2: The Android app loads the web reader from the server

A WebView opens the server's reader page.

- For: one codebase, new web features reach Android as soon as the server updates.
- Against: no offline reading, which conflicts with ADR-0032. Android uses bearer tokens and the web page uses cookie sessions, so sign-in has to be bridged. Behaviour changes without an app update, which F-Droid and store review treat badly. The server must be reachable and the same version family as the app.

### Option 3: Bundle the web reader inside the app

Build the web reader as a versioned package and ship it in the APK, loaded from a local virtual origin with the same isolation as the reader origin, talking to the API with the account's bearer token.

- 3a. Bundle the whole reader (engine and React chrome). One codebase and full parity. The reader would need an embeddable entry in the web build, an API base URL and bearer sign-in instead of same-origin cookies, and its offline queue would replace Android's own saving for ebooks, so positions and annotations would be written by one implementation only.
- 3b. Bundle only the engine (the frame and its message protocol) and keep the Kotlin chrome. Locators come from one engine on both platforms. Each chrome feature (timeline, popup, fonts menu) is still built twice, but the hard parts (rendering, selection, locating, fonts) are shared.
- For both: offline works, the reader updates with the app, and release is controlled. The cost is remembering to rebuild and ship the bundle whenever the web reader changes. A check that the bundled engine profile equals the server's can warn when they differ.
- Against: the first step needs locator fixtures to prove that existing Android positions and annotations still resolve with pristine Foliate. Where they do not, a migration or a fallback is needed.

### Recommendation (accepted for the first step)

Do 3b first, then decide on 3a. 3b is the lowest-risk step, it removes the engine divergence that makes the two readers incompatible, and it does not depend on the chrome choice. The shared engine, locator fixtures and bundled fonts are needed under 3a as well. If rebuilding the chrome in Kotlin for each web feature proves too costly, move to 3a on top of the same bundle. Option 1 is not recommended, because it leaves the drift in place. Option 2 is not recommended, because it breaks offline reading.

## Alternatives

The options above are the alternatives. A mix is possible: 3b for ebooks and PDFs, and keep the native comic reader, which does not use Foliate.

## Consequences

Whichever option is chosen, the web reader's feature set becomes the reference, and Android's engine profile and locators must be verified against the shared fixtures before any switch (ADR-0027, ADR-0067). The Cast and Android Auto audio paths, the Cast-free F-Droid build and the AGPL licence are not touched. Reading sessions (ADR-0092) would also need to be sent from Android for it to show a complete history.

## Verification

First increment of option 3b, done 2026-11-23 on branch `claude/adr-0093-shared-engine` (details and limits in `research/android/adr-0093/`).

Done:

- **Shared engine as a build output.** `apps/android/shared-reader.gradle.kts`: `./gradlew syncSharedReader` copies `apps/web/public/reader` into `apps/android/app/src/main/assets/reader-shared/` (checked in, never hand-edited) and writes `ENGINE_PROFILE`; `checkSharedReader` runs before every build and fails when any file differs from the web source or when the web app's engine profiles (`profile.ts`) differ from the server's (`catalog/editions.go`) or from the profile the copy was made for. Tried: clean pass, an edited copied file, a changed profile. The legacy modified reader stays in `assets/reader`; `-Plitara.sharedReader=true` (BuildConfig `SHARED_READER`, default off) selects the shared engine.
- **Locator fixtures** (`scripts/android/reader-locators`, desktop Chromium): positions, highlight ranges and bookmark points recorded by the legacy Android engine on synthetic EPUB and FB2 books, read back at a different layout in both engines. Every one resolved identically in the shared engine (EPUB 54 positions, 84 ranges, 84 points; FB2 18, 42, 42). PDF page identity (PDF.js, 7-page edge-case file) and the Android percentage round trip agree for all 7 pages. No locator disagreed, so no migration was written and nothing was relabelled. Synthetic books only; KEPUB, MOBI, AZW and AZW3 are not covered and stay on the legacy engine.
- **Android reading switched behind the flag**: EPUB and FB2 (`ReaderScreen`) and PDF (`PdfReaderScreen` delegating to `SharedPdfReaderScreen`) load the shared frame through `assets/reader-shared-host/index.html`; comics stay native. Cast, Android Auto and the Cast-free flavor were not touched; both flavors build with the flag off and on.
- **Emulator** (Pixel 9 Pro AVD, Android 17, WebView 154.0.8037.106; `SharedReaderEngineTest`, instrumentation): EPUB opens; a page turn advances; a position recorded by the legacy engine opens in the right chapter; reopening on the engine's own CFI restores the same place (within 1% of the book); a bookmark CFI jumps back; a highlight recorded by the legacy engine is located in the book and drawn; a text selection reaches Kotlin with a CFI and rectangle and clears; a font sent as bytes over the channel is declared in the book; a PDF opens on a saved page, turns and jumps.

Protocol gaps closed 2026-11-23 (second increment; web-side, additive, in `apps/web/public/reader/bridge.js` and `src/reader/host.ts`, then synced): `tap` events (x, y as fractions of the frame; ebook and PDF), in-book `search` / `clear-search` with `search-results`, `search-progress`, `search-done` (ebooks; PDF answers `unsupported`), optional per-annotation `color` (hex only) and `style` (highlight, underline, squiggly, strikethrough), and optional `style` fields `lineHeight`, `justify`, `hyphenate`, `maxColumns`, `gapPct`, `maxInlineSize`. Absent fields leave the web app's behaviour unchanged. Checked by `node scripts/web/reader-protocol/check.mjs` (16 checks in Chromium against the real frame, no server) and on the emulator (`SharedReaderEngineTest`: search finds hits, a real touch arrives as a tap, typography reaches the book, a green underline is drawn). The Android reader uses these instead of its native tap detector and search stub. Third step (same day): `annotation-click` carries `rect` (x, y, width, height in the frame's pixels, like a selection's) so a host can anchor a popup to a tapped highlight; Android passes it to its popup, and an emulator touch on a drawn highlight returns its id and a rectangle around the touch. The web text-settings panel now sends line spacing, alignment, hyphenation, columns and margins for ebooks ("The book's own" sends nothing), and a field left out withdraws an earlier column, gap or width value. Still missing: PDF search and text layer, and persistence of per-highlight colour and style (the server's annotation `data` has no such fields; adding them is an additive API change that needs its own decision, so the web app does not send them yet).

Not done, not tested:

- No physical device. The full reader screens (`ReaderScreen`, `SharedPdfReaderScreen`) with the flag on were compiled but not driven: opening a book from a server, position saving through Room and the API, highlight and bookmark creation from the UI and touch gestures (tap zones come from a native detector) were not exercised. The reader's refusal to save under an engine-profile mismatch is not wired on Android (only the build-time check exists).
- Remaining gaps against the legacy bridge: PDF loses the native text search, text layer and settings sheet in the shared path. No fonts are bundled in the Android app yet (the test used a font from the web app's dependencies).
- A jump issued while a page-turn animation settles was ignored in the emulator test, so the test waits; chrome that jumps right after a turn must expect this.
- Cast, Android Auto, offline downloads, the F-Droid flavor at runtime, and the 3a decision.

## Open questions

- Whether to move on to 3a later, after the first step.
- What to do with locators from the current Android engine that do not resolve in pristine Foliate.
- Whether comics stay native.
- Whether Android sends reading sessions (ADR-0092).
