# Android: what still depends on the BookOrbit client

Follow-up to finding C1 in `research/sweep-2026-11-25.md`. Read from source on `a03a956`; `apps/android` is identical on `origin/main` (`a208649`). Nothing was built or run, so every behaviour below is inferred from code. This is research, not a decision. Paths are relative to `apps/android/app/src/main/java/com/litara/`.

## Summary

- The app holds two clients. `LitaraApp.kt` shows `AuthenticatedApp` (BookOrbit) for a BookOrbit session, otherwise `LitaraShell` for a Litara session, otherwise the BookOrbit server setup. Litara sign-in is a secondary route from that screen.
- The Litara shell already covers: recordings list and playback, offline copies, EPUB-family, PDF and comic reading, completion and conflict handling.
- `ApiService` cannot simply be deleted. Phone playback, Android Auto, Cast, the Litara readers and background sync all compile against classes that use it.
- Android Auto and Cast do work through a Litara seam (`feature/player/LitaraSource.kt`), so the sweep's "Auto is probably not wired to Litara" is only partly right. Auto still calls BookOrbit first in several places.

## 1. Shared code that must be separated first

| Shared piece | Litara needs it for | BookOrbit ties to cut |
| --- | --- | --- |
| `PlayerRepository` | Building the queue (`resolveLitara`) | `BookDetailRepository`, `DownloadsRepository`, `AudiobookAssetResolver`, `SessionManager` |
| `AudioProgressRepository` | Local positions, routing to `litara.push` / `serverPosition` | `ApiService` playback-state and legacy progress routes |
| `AutoCatalog`, `AutoLibraryRepository` | Car shelves and library folders | `queryBooks`, `BrowseRepository.scroller`, `BookDetailRepository` |
| `AutoSearch` | Car and voice search | `DownloadsRepository`; `AutoCatalog.page` |
| `RestoreCandidateFinder` | Reopening the last book | `BrowseRepository.scroller` |
| `MediaLibraryCallback`, `AutoArtwork`, `PlaybackService` | Car session, artwork | `SessionManager`, `DownloadsRepository` |
| `PlayerManager` | All playback | `ReadingSessionTracker` (BookOrbit session upload) |
| `PlayerViewModel` | Player screen | `AudiobookBookmarkRepository` (BookOrbit only) |
| `core/di/CastModule`, `PlayerModule` | Cast proxy and streaming | `AuthInterceptor`, `TokenAuthenticator`, `SessionManager.accessToken` |
| `ImageUrls` | Covers by local handle | Every other URL it builds is BookOrbit |
| `SessionManager.dataScope` | Per-account Litara database and files | The rest of the class is the BookOrbit session. Keep the scope rules exactly (audit L6, `LegacyDataOwnershipTest`) |
| `core/model` (`BookDetail`, `BookCard`, `BookFileRef`, `AudioProgress`, annotation types) | Internal types for player, Auto and readers | Also BookOrbit wire types. Keep and trim; do not delete the package |
| `ReaderScreen`, `PdfReaderScreen`, `ComicReaderScreen` | Litara reading | Already behind `ReaderHost`, `PdfHost`, `ComicHost`, but each defaults to a BookOrbit view model, and the `UiState` types the Litara view models use are nested inside those view models |
| `core/db` (`LitaraDatabase`, version 8) | `AudioProgressDao` | Most other tables serve BookOrbit queues. The destructive fallback would wipe tables, so any removal needs a hand-written migration |

Handles: Litara UUIDs are mapped to local `Int` ids at or above 1,000,000,000 so the imported player, Auto and Cast code can stay unchanged. Keeping handles is the smallest path; replacing them is a separate refactor.

## 2. Problems a Litara-only user probably has today

These follow from the code and should be reproduced before or while fixing them. None requires deleting anything.

1. **Car "Continue listening" lists unstarted books.** `AutoCatalog.continueListening` adds every `litara.cards()` entry not finished in local history to the "online" list, then returns up to 80. It is meant to hold started books.
2. **Car search with no match likely reports a sign-in error.** `AutoCatalog.page` calls BookOrbit `queryBooks`. With no Litara match, or on page 1 and later, the failure is rethrown. `MediaLibraryCallback.error` maps an `IOException` with no BookOrbit token to "sign in".
3. **Listening sessions never reach Litara.** `PlayerManager` hands Litara handles to `ReadingSessionTracker`, which posts to BookOrbit's `books/files/{id}/sessions`. With only a Litara sign-in the upload cannot succeed, and rows queue with no owner. A Litara account normally has its own database scope, which a BookOrbit sign-in would not open, so I do not expect these rows to reach a BookOrbit server. The Litara readers record no sessions at all. The server accepts sessions for editions only (`PUT /editions/{id}/reading-sessions/{sessionId}`); I found no recording equivalent.
4. **Launch restore ignores other devices.** `RestoreCandidateFinder` gets server candidates from BookOrbit only, so Litara restore chooses among books already in this device's history.
5. **Private CA trust has no proper switch.** `LitaraRepository` honours `UserCaTrust`, but the toggle is only in BookOrbit server setup and BookOrbit settings. Server setup saves the consent before its BookOrbit probe fails, which is only an accidental workaround.
6. **Settings are unreachable.** Theme, dynamic color, download location and certificate trust live in `SettingsScreen`, which only the BookOrbit shell opens. Skip lengths are set there too; I did not check every control in the player sheets.
7. **Audio bookmarks are a dead control.** The player shows them; for Litara the list is empty and adding fails. The server has no audio bookmark endpoint.
8. **Stale text.** The `LitaraShell` doc comment says reading is not offered. It is.

### Status after the fixes on `claude/android-litara-only-fixes`

The list above describes the code before the fixes.

| Item | Change |
| --- | --- |
| 1 | The car shelf uses the server's `lastActivityAt`: started, unfinished recordings, plus this device's history and downloads. |
| 2 | With a Litara account signed in, a failed BookOrbit lookup is no longer an error in car browse or search. |
| 3 | Litara handles are no longer given to the BookOrbit session uploader, and previously queued ones are kept but not sent. **Listening and reading sessions still are not recorded on Litara.** |
| 4 | Launch restore also considers the three most recently used Litara recordings. |
| 5 | Litara sign-in has the per-host certificate switch for HTTPS addresses. |
| 6 | Account has a Settings screen with appearance, certificate trust (HTTPS only), image cache, playback and version. Correction to item 6: download location and Wi-Fi-only apply to BookOrbit downloads only, so they are not offered. **Litara downloads have neither option.** |
| 7 | The bookmark button is hidden for Litara recordings. **Audio bookmarks are still not available.** |
| 8 | The comment is corrected. The sign-in screen now also scrolls and stays clear of the system bars. |

Verified on 2026-11-26: JVM tests and debug builds for both flavors; instrumented tests for both flavors against a seeded local server on a headless Pixel Tablet emulator (29 each, 0 failures, 1 skipped: `opensACompletedDownloadWithTheNetworkOff`). On screen: the certificate switch with an HTTPS address, plain-HTTP sign-in, the settings screen, and the player without bookmarks. The car shelf, car search and launch restore changes are covered by JVM tests only, not by a car or a second device. Signing in with a private CA over TLS was not run.

Both Gradle runs used `-x checkSharedReader`: on this Windows checkout it fails because the web reader files have CRLF line endings (the content matches once they are ignored). Android lint crashes inside its own analysis of a build script, with or without these changes, so lint did not run.

**Update 2026-11-26:** [ADR-0109](../../ADR/0109-audiobook-listening-sessions.md) and [ADR-0110](../../ADR/0110-audiobook-bookmarks.md) added server routes for listening sessions and audiobook bookmarks. Android now records Litara listening and ebook reading, keeps unsent sessions, and offers audiobook bookmarks, which closes items 3 and 7. Listening is recorded for playback driven by the phone player; playback started only from a car without the phone player was not checked.

**Update 2026-11-26 (browsing):** the Litara phone app now has a Browse tab (title list with search, filters and sorting; author and series pages; shelves), a title page with the private rating, a stats page under Account, and a "Wi-Fi only" setting for downloads. All of it needs a connection. Filters are combined with AND; nested AND/OR rules, smart shelf rules, shelf reordering, and editing author or series details remain web-only. Litara downloads stay in phone storage, with no location setting ([ADR-0111](../../ADR/0111-android-download-location.md)). Notes across books, a dashboard and the other rows below are unchanged. The table describes the state before these changes.

**Update 2026-11-27 (emulator checks):** playback started only from a car-style media browser, with no phone screen opened, was recorded as a listening session (24 s for about 25 s played). Also checked on a phone-sized emulator: EPUB and PDF opening from the title page, saved author text and photo, a matched series' missing books (synthetic saved data, no provider was contacted), "Wi-Fi only" with Android itself reporting a metered network, and the audiobook bookmark screens. Not tested: a car or head unit, a physical phone, or a real mobile network.

## 3. BookOrbit-only features and what Litara's server offers

About 6,400 lines of screens and repositories are in feature folders used mainly by the BookOrbit shell (`auth`, `authors`, `bookdetail`, `bookdrop`, `browse`, `collections`, `dashboard`, `library`, `main`, `notes`, `scopes`, `search`, `series`, `stats`, `you`). Parts of `browse`, `bookdetail` and `downloads` are still imported by the player and Auto (section 1). Removing the shell loses these until they are rebuilt:

| Feature | Litara server today | Litara Android today |
| --- | --- | --- |
| Library search and filters | `/titles`, `POST /titles/search` | Text search of the audiobook and book lists, on the phone (`claude/android-library-search`); no filters or sorting |
| Authors, series | `/authors`, `/series` | None |
| Title detail, rating, read status | `/titles/{id}`, `/titles/{id}/personal`, completion | Finish/unfinish only; no rating |
| Collections, smart scopes | `/shelves` (including smart shelves) | None |
| Notes across books | `/annotations` | Per book only |
| Reading stats | `/stats/reading` | None |
| Continue reading, dashboard, recommendations | `/continue-reading` is per author or series only; no dashboard or recommendations found | None |
| Reading goal and streak widgets | Not checked beyond `/stats/reading` | None |
| Book Dock (staged import) | Admin import routes with a different model | None |
| Audio bookmarks | None found | None |
| OIDC sign-in | Deferred (ADR-0013) | Not applicable |
| "Server web" reader (`ServerReaderScreen`) | Targets the BookOrbit web app. Showing Litara's web reader would be ADR-0093 option 3a, still undecided | Not applicable |

The Litara PDF reader also has no highlights or notes (stated in the app's `litara_audio_only` text).

## 4. Proposed order

Each step keeps both flavors building and keeps Cast, Auto and offline playback.

1. **Fix the Litara-only gaps** (section 2, items 1, 2, 4, 5, 6, 7, 8) and stop sending Litara sessions to the BookOrbit tracker (item 3). Recording them on Litara needs a server API decision and, for recordings, new endpoints.
2. **Cut the seams** (section 1): the player, Auto, Cast and readers depend on Litara or neutral interfaces; shared state types move out of the BookOrbit view models.
3. **Make Litara the only entry:** the first screen is Litara sign-in; retire `LitaraActivity`.
4. **Delete the BookOrbit code:** `ApiService`, Retrofit and its interceptors, cookie jar, token refresher, OIDC and AppAuth (including the manifest redirect receiver), the BookOrbit screens and queues, and their tests. Migrate Room explicitly. Do not delete downloaded files on users' devices without a separate decision.
5. **Rebuild chosen features** against Litara's API.

The legacy reader assets and the `litara.sharedReader` flag (ADR-0093) are separate from this work.

## 5. Tests affected

About 18 JVM test files reference BookOrbit classes or the shared `SessionManager`, including player and Auto tests (`AudioProgressRepositoryTest`, `AudioProgressLitaraRoutingTest`, `AutoCatalogTest`, `AutoLibraryRepositoryTest`, `RestoreCandidateFinderTest`). Those need rewriting against the new seams, not deleting. `LitaraAutoCastTest` (instrumented) also matches. I matched by class name and did not read each test. Physical Auto and Cast acceptance is still deferred (T007 release gates), so emulator results cannot close it.

## 6. Decisions for the owner

ADR-0009 already selects adapting Android to the Litara API without BookOrbit compatibility, and ADR-0013 defers OIDC. Neither says which Android features may disappear in the meantime.

1. **Which section 3 features must work on Litara before the BookOrbit shell is removed?** Recommendation: none block removal, because the old screens cannot work against a Litara server. Rebuild library search first, then authors/series and shelves. This assumes nobody still uses this build with a BookOrbit server; keeping that mode would need a new ADR.
2. **Old on-device BookOrbit downloads and queued changes:** recommendation: leave the files in place, stop reading them, and say so in release notes.
3. **Listening sessions and audio bookmarks:** both need server API design before Android can offer them.
