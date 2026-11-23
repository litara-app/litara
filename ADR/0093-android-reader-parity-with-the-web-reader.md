# ADR-0093: Bring the web reader's features to the Android reader

Status: Proposed
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

Proposed, not accepted. The owner asked for options.

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

### Recommendation

Do 3b first, then decide on 3a. 3b is the lowest-risk step, it removes the engine divergence that makes the two readers incompatible, and it does not depend on the chrome choice. The shared engine, locator fixtures and bundled fonts are needed under 3a as well. If rebuilding the chrome in Kotlin for each web feature proves too costly, move to 3a on top of the same bundle. Option 1 is not recommended, because it leaves the drift in place. Option 2 is not recommended, because it breaks offline reading.

## Alternatives

The options above are the alternatives. A mix is possible: 3b for ebooks and PDFs, and keep the native comic reader, which does not use Foliate.

## Consequences

Whichever option is chosen, the web reader's feature set becomes the reference, and Android's engine profile and locators must be verified against the shared fixtures before any switch (ADR-0027, ADR-0067). The Cast and Android Auto audio paths, the Cast-free F-Droid build and the AGPL licence are not touched. Reading sessions (ADR-0092) would also need to be sent from Android for it to show a complete history.

## Verification

Planned, not done: shared locator fixtures resolve identically in the bundled engine and in the current Android engine; existing Android positions and annotations open at the same place; the full and F-Droid builds still build; offline reading still works; the reader refuses to save under an engine profile mismatch.

## Open questions

- Which option: 1, 2, 3a or 3b, or 3b first with 3a later as recommended.
- What to do with locators from the current Android engine that do not resolve in pristine Foliate.
- Whether comics stay native.
- Whether Android sends reading sessions (ADR-0092).
