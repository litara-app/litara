# Android architecture map

Source analysed: `deranjer/bookorbit-android` at `a55eaa13d8ba27cd143dda882836ed35a4dc923f`
("chore(main): release 0.9.0 (#113)", 2026-11-11). Reference clone:
`E:\Programming\_reference\bookorbit-android` (outside the active stack). All paths below are
relative to `app/src/` in that clone unless stated otherwise.

Legend: **[Obs]** observation from source; **[Rec]** recommendation; **[Q]** unresolved question.

## 1. Shape of the app

- **[Obs]** Single Gradle module `:app`, Kotlin 2.0.21, AGP 8.9.1, Gradle 8.11.1, compile/target
  SDK 36, min SDK 26, JVM target 17 (`app/build.gradle.kts`, `gradle/libs.versions.toml`).
- **[Obs]** About 27,450 lines of Kotlin across `main`, `full`, `fdroid`, `debug`, `test` and
  `androidTest`. There are 52 JVM test classes (335 tests) and 9 instrumentation test classes.
- **[Obs]** Stack: Jetpack Compose + Material 3, Hilt, Retrofit 2.11/OkHttp 4.12,
  kotlinx.serialization, Media3 1.5.1 (ExoPlayer, session, OkHttp data source, Cast), Room 2.6.1,
  DataStore, WorkManager 2.10, Paging 3, AppAuth 0.11.1, AndroidX WebKit (Foliate host), Coil 2.7.
- **[Obs]** Two product flavours in the `distribution` dimension: `full` (links
  `media3-cast`, `play-services-cast-framework` 21.5.0, `mediarouter`) and `fdroid` (no-op Cast
  stubs). Both share `applicationId = "com.bookorbit"`, and debug adds `.debug`.
  Flavour-specific code lives only in `full/java/.../feature/cast/` and
  `fdroid/java/.../feature/cast/`, so `PlaybackService` never references Cast SDK types.

```
app/src/main/java/com/bookorbit/
  app/            Activity, Application, root navigation gate (BookOrbitApp, AuthenticatedApp)
  core/auth/      SessionManager, SecureStorage (EncryptedSharedPreferences), DataScope
  core/network/   ApiService (Retrofit), interceptors, TokenRefresher/Authenticator, cookie jar,
                  AudiobookAssetResolver, ImageUrls, user-CA trust
  core/model/     Hand-written @Serializable mirrors of BookOrbit /api/v1 DTOs
  core/db/        Room DB (version 8): progress, downloads, pending-write queues, annotation cache
  core/sync/      SyncWorker + SyncScheduler (WorkManager flush of queued writes)
  core/storage/   LocalRef (file:// vs SAF content://), download file naming
  feature/player/ Media3 service, session callback, Auto browse tree, progress, queue math
  feature/cast/   CastProxyServer (LAN HTTP proxy), Mp4ChapterFilter  (+ flavour code)
  feature/downloads/ DownloadWorker, resume logic, repository, UI
  feature/reader/ Foliate WebView host, PDF reader (PdfRenderer), comic reader, annotations
  feature/*       Library/browse/search/series/authors/collections/scopes/dashboard/stats/
                  bookdrop/settings UI (BookOrbit-specific product surface)
app/src/main/assets/reader/  Foliate-js build + bridge.js + index.html (see source-provenance.md)
```

## 2. Subsystems

### 2.1 Authentication and session

| Concern | Implementation | Notes |
| --- | --- | --- |
| Server URL + base path | `core/network/Interceptors.kt:23` `BaseUrlInterceptor.intercept` rewrites every relative Retrofit path to `${server}/api/v1/...` | Retrofit's base is a throwaway `http://localhost/` (`core/di/NetworkModule.kt`). Supports a reverse-proxy subpath. |
| Bearer token | `Interceptors.kt:44` `AuthInterceptor` adds `Authorization: Bearer <access>` | Access token is cached in memory (volatile) and in `SecureStorage`. |
| Refresh | `TokenAuthenticator.kt:19` (OkHttp `Authenticator` on 401, at most one retry) → `TokenRefresher.kt:32` `refreshIfNeeded` (`@Synchronized` single-flight `POST /auth/refresh`, with the refresh token in an HTTP-only cookie via `PersistentCookieJar`) | A failed refresh response signs out. A network error does not. Separate `@RefreshClient` has no authenticator, which avoids recursion. |
| Login | `feature/auth/AuthRepository.kt` `login` → `POST /auth/login` → `SessionManager.signIn` | `GET /auth/setup-status` is used as a "is this a BookOrbit server" probe. |
| OIDC | `feature/auth/OidcManager.kt` (AppAuth + PKCE). Server-minted state (`POST /auth/oidc/{slug}/state`), code exchange done by server (`POST /auth/oidc/callback`) | Redirect `bookorbit://oauth2-callback` (manifest placeholder `appAuthRedirectScheme`). |
| Gate | `core/auth/SessionManager.kt` `SessionState` (Loading/NeedsServer/SignedOut/SignedIn) | `bootstrap()` line 52, `signIn` 102, `signOut` 118. |
| Server isolation | `core/auth/DataScope.kt:11` and `core/di/DatabaseModule.kt:30`. Each server URL gets its own Room file (`bookorbit-<sha12>.db`). Switching servers restarts the process (`AuthRepository.afterSignIn` → `ProcessRestarter`) | **[Obs]** Isolation is per **server**, not per **user**: `audio_progress`/`reader_progress`/`downloads` rows have no user column. Only `pending_annotation_ops` and `pending_reading_sessions` carry `userId` (MIGRATION_7_8). See limitation L6 in `media-preservation-matrix.md`. |
| Private CA | `core/network/UserCaTrust.kt`, `HostScopedTrustManager.kt` (opt-in, host-scoped trust of user-installed CAs), applied to every OkHttp client including the media stream client | Covered by `androidTest/.../UserCaTrustTest.kt`. |

**[Rec]** Keep the shape (single-flight refresh, a separate refresh client, a token read per request in
the media data source). Rebind the endpoints and the cookie-vs-body refresh-token transport to whatever
the Litara auth ADR decides.

### 2.2 API models and network surface

- **[Obs]** `core/network/ApiService.kt` has about 75 Retrofit methods that mirror BookOrbit `/api/v1` one-to-one
  (README "Cross-repo couplings"). There is no codegen. JSON is lenient (`ignoreUnknownKeys`,
  `explicitNulls = false`, `coerceInputValues`).
- **[Obs]** Models live in `core/model/*.kt`. Integer ids are used everywhere (`BookDetail.id`,
  `BookFileRef.id`). Audiobook assets use string `assetId`.
- **[Obs]** Server-version branching: `AudiobookAssetResolver` (`core/network/AudiobookAssetResolver.kt:42`)
  treats a 404 from `GET /audiobooks/{id}/manifest` as a "pre-3.0 server" and falls back to legacy
  routes. This is BookOrbit-history baggage and has no value against a fresh Litara API.
- **[Obs]** Raw-body workarounds: `getPlaybackState` returns `ResponseBody` because BookOrbit returns an
  empty 200 for "no position", and `getScroller` returns `JsonElement` because its shape changed in 3.0.
- See `backend-contract.md` for the endpoint-by-endpoint inventory.

### 2.3 Catalog browsing

- **[Obs]** Paging 3 sources: `core/paging/PagingSources.kt`. Book queries go through
  `POST /books/query` / `POST /libraries/{id}/books` with a `BookQuery {sort[], pagination{page,size},
  filter: JsonElement, q}`. The filter is a BookOrbit-specific rule/group tree built in
  `feature/library/filters/BuildBookQuery.kt`.
- **[Obs]** Other lists (authors, series, collections, smart scopes, Book Dock) use
  `page`/`size` (0-based) or `page`/`limit` (1-based, Book Dock) query params. Pagination conventions
  are inconsistent across the BookOrbit API.
- **[Obs]** The dashboard uses "scrollers" (`GET /dashboard/scrollers/{type}`) and a widgets batch. Continue
  Listening comes from `ScrollerType.CONTINUE_LISTENING` via `feature/browse/BrowseRepository.kt`.
- **[Obs]** Format routing: `core/model/BookFiles.kt` decides read/listen/open and what to download.
  `audioFiles` (line 40) filters by format in `AUDIO_FORMATS = m4b, mp3, m4a, opus, ogg, flac, aac,
  wav`. `readingTarget` (line 95) picks Foliate, then comic, then PDF. `downloadableFiles` (line 103)
  returns all audio files, or else the primary/first non-audio file.
- **[Rec]** The catalog UI (library hub, filters, smart scopes, Book Dock, dashboard widgets, stats)
  is the most BookOrbit-specific and least preservation-critical part. It should not block the media
  migration. Rebuild it against the Litara title/edition model later.

### 2.4 Reader assets and readers

| Reader | Files | Data path |
| --- | --- | --- |
| Foliate (EPUB/MOBI/AZW3/FB2/CBZ) | `feature/reader/ReaderWebView.kt`, `ReaderBridge.kt`, `ReaderViewModel.kt`, `assets/reader/{index.html,bridge.js,foliate/**}` | `ReaderSource.resolveFile` (`feature/reader/ReaderSource.kt:47`) uses the downloaded copy or caches `GET /books/files/{id}/serve` to disk (reused when the size matches). The host streams bytes into the WebView as base64 chunks (`bridge.js` begin/chunk/commit). The WebView never touches the network, and `WebViewAssetLoader` serves the assets. |
| PDF | `feature/reader/pdf/*` (Android `PdfRenderer`) | Same file resolution. Progress sends `pageNumber`. |
| Comics CBR/CB7 | `feature/reader/comic/*` | Server-rendered pages `GET /cbz/files/{id}/pages/{n}`, with the count from `GET /cbz/files/{id}/pages`. **Online only.** |
| Web handoff | `feature/reader/ServerReaderScreen.kt`, `ServerReaderPolicy.kt` | Opens the server's web reader. `ReaderProgressRepository.syncBeforeWeb` (`:49`) pushes a dirty local position first. |

- **[Obs]** Reading position is keyed by **server file id** (`ReaderProgressEntity.fileId`) and stored as
  `{cfi, percentage}` (plus `pageNumber` for PDF). This matches the accepted constraint that exact
  locations belong to files.
- **[Obs]** Annotations/bookmarks are addressed by **book id** in the URL (`/books/{bookId}/annotations`),
  and the create body carries `bookFileId`. CFI is the location.
- **[Obs]** `bridge.js` expects `window.ReactNativeWebView.postMessage`, which `index.html` shims onto
  `AndroidReaderBridge`. This shows the bridge was written for a React Native WebView host first
  (see `source-provenance.md`).

### 2.5 Downloads / offline storage

- **[Obs]** `feature/downloads/DownloadWorker.kt` (`doWork` :93) is a WorkManager `CoroutineWorker` run as a
  data-sync foreground service. It persists the full `BookDetail` JSON into `DownloadEntity.bookJson`
  so player, Auto and the downloads list work fully offline (`core/db/DownloadEntity.kt`).
- **[Obs]** Destinations: app-private internal storage, or a user-chosen SAF tree
  (`core/settings/DownloadLocationStore.kt`, `core/storage/LocalRef.kt`).
- **[Obs]** Resume: `DownloadResume.plan` (:25) and `writeMode` (:42). A matching 206 appends, a 200 overwrites,
  and a mismatched 206 or a 416 restarts. The expected size comes from `BookFileRef.sizeBytes`. Retries
  are capped. Audio uses `GET /audiobooks/{bookId}/assets/{assetId}/content`, everything else
  `GET /books/files/{fileId}/serve`, both with `Range: bytes=N-` (`activeNetworkCall` :263).
- **[Obs]** The cover is downloaded once to `cover.jpg` via `GET /books/{id}/cover`.

### 2.6 Playback

```
UI (PlayerScreen/MiniPlayer/BookDetail) ──► PlayerManager (singleton, MediaController)
                                                │  custom SessionCommand LOAD_BOOK_QUEUE
                                                ▼
PlaybackService (MediaLibraryService, foreground) ── MediaLibrarySession(player = BookAggregatingPlayer)
   │ owns ExoPlayer (local) + CastHandoff (full flavour)                      │
   │ swaps session player local ⇄ Cast                                       ├─► Android Auto / AVRCP / lock screen
   ▼                                                                          │
MediaLibraryCallback ── AutoBrowseTree / AutoCatalog / AutoLibraryRepository / AutoSearch / AutoPlaybackResolver
```

- **[Obs]** Queue model: one Media3 `MediaItem` per audio file. `PlayerRepository.resolve`
  (`feature/player/PlayerRepository.kt:42`) prefers the local download (`file://` or SAF `content://`).
  Otherwise it uses `${server}/api/v1/audiobooks/{bookId}/assets/{assetId}/content` (or the legacy
  `books/files/{id}/serve`). Per-file duration and book-wide chapter starts/titles are carried in
  `MediaMetadata.extras` (`BookAggregatingPlayer.EXTRA_*`). The MIME type comes from server format, then
  filename (`AudioMimeType.kt:4`), because stream URLs have no extension.
- **[Obs]** `BookAggregatingPlayer` (`ForwardingPlayer`) presents whole-book or chapter-relative
  position/duration to every session observer. It turns next/previous into chapter navigation
  (`ChapterClock`), promotes the service to the foreground before play on API 35+
  (`PlaybackService.ensureForegroundBeforePlay` :137), and exposes `bookPositionMs`/`seekToBookMs`
  for in-process code through `ActiveBookPlayer`.
- **[Obs]** Chapter math is pure: `PlaybackQueue` (`normalizeChapters` :84, `locateWithinDurations` :57)
  and `ChapterClock`. Chapters come from `BookDetail.audioMetadata.chapters[{title,startMs}]`, expressed in
  **whole-book** milliseconds across all files.
- **[Obs]** Phone loads go through an app-private custom command (`BookQueueCommand`,
  `MediaLibraryCallback.onCustomCommand` :82). This stops `MediaController` from optimistically
  masking a new timeline before a Cast receiver accepts it, which fixed a Media3 1.5.1 crash
  (`docs/testing/cast-handoff.md`, "Queue replacement crash follow-up").
- **[Obs]** Speed: a global default plus an optional per-book override in DataStore (`AudioSettingsStore`,
  `resolveSpeed`). Skip intervals (5–60 s), progress-bar mode (BOOK/CHAPTER) and previous-track action
  are all device-local.
- **[Obs]** Launch restore: `PlayerManager.restoreLastBook` (:216) via `RestoreCandidateFinder` merges local
  history with the server Continue Listening list, with time-boxed lookups (4 s / 8 s), and loads paused.
  The `loadGeneration` counter prevents a slow restore from overwriting a user or car load.

### 2.7 Progress reconciliation

| Store | Key | Local | Server (BookOrbit) | Conflict rule |
| --- | --- | --- | --- | --- |
| Audio position | bookId → (fileId, offsetSec, %) | `AudioProgressEntity` (dirty flag) | 3.0+: `PUT /audiobooks/{id}/playback-state {assetId, positionMs, capturedAt, operationId, baseRevision, manifestRevision}`; legacy `PATCH /books/{id}/audio-progress` | `AudioProgressRepository.resumePoint` (:76): newer timestamp wins (local `updatedAt` vs server `capturedAt`). On PUT: 409 re-read, overwrite only if local is newer. 412 re-resolves the manifest and retries once. 400/404 are dropped. Others stay dirty (`putPlaybackState` :104). |
| Reader position | fileId → (cfi, %) [+ page] | `ReaderProgressEntity` | `GET/POST /books/files/{id}/progress` | `resolveInitial` (:60): a dirty local row wins, else the server, else the start. No timestamp comparison. |
| Annotations | bookId → ops | `pending_annotation_ops` (coalesced create/update/delete, negative placeholder ids, `userId`) + `annotation_cache` | `/books/{id}/annotations` CRUD | Replayed in order by `SyncWorker`. Permanent 4xx (except 401/408/429) are dropped (`isPermanentRejection` `core/sync/QueuedWriteRejection.kt:10`). |
| Sessions | sessionId | `pending_reading_sessions` (+`userId`) | `POST /books/files/{id}/sessions` | Send once and drop. |
| Rating / read status | bookId | `pending_rating`, `pending_read_status` | `POST /books/bulk-set-rating`, `PATCH /books/{id}/status` | Last write. |

`SyncWorker.doWork` (`core/sync/SyncWorker.kt:34`) runs every flush without short-circuiting, sends
nothing while signed out, and retries with WorkManager backoff while anything is still dirty. The player
reports every 5 s while playing (`PlayerManager.report` :465) and on stop.

- **[Obs]** File↔asset mapping (`AudiobookAssets.match`, `core/model/Audiobook.kt:58`) is a **heuristic**
  that matches on format + size, then sequence order. It exists because BookOrbit's manifest keys
  assets by a `publicId` that book-detail does not expose. **[Rec]** The Litara API must expose one
  stable id per audio file, used for streaming, download, progress and the manifest. Then this
  heuristic and the `Legacy`/`Assets` branching disappear.

### 2.8 Chromecast (full flavour)

- **[Obs]** Default Media Receiver (`full/.../CastOptionsProvider.kt`), so no custom receiver app is needed.
- **[Obs]** `PlaybackService.switchToCast` (:164) starts `CastProxyServer`, rewrites the queue with
  `rewriteForCast` (`feature/cast/CastProxyServer.kt:119`), and loads index+position atomically
  (`transferQueueToCast`, `CastQueueTransfer.kt:10`). It then swaps the session player to a
  `BookAggregatingPlayer` around `CastPlayer`. `switchToLocal` (:192) restores the *requested* queue if
  the receiver still shows an old one (`castReturnPosition` :28, `matchesCurrentQueueItem` :41).
- **[Obs]** `CastProxyServer` is a hand-rolled socket HTTP/1.1 server on an ephemeral port, bound only
  while a Cast session exists. A per-queue random UUID token sits in the path. It supports
  GET/HEAD/OPTIONS, single `bytes=` ranges, 206/416 and CORS. Local files are read with
  `RandomAccessFile` (SAF `content://` returns 404, a known limitation). Remote requests are proxied
  with the app's bearer token (`@CastUpstreamClient`, `core/di/CastModule.kt`). Old transfers are
  cancelled on queue replacement.
- **[Obs]** `Mp4ChapterFilter.discover` (:26) rewrites the four-byte box types of referenced QuickTime
  chapter-text tracks to `free` with a same-length overlay. This stops the receiver from preloading
  hundreds of chapter samples (measured: 498 chapter reads made startup slow). It is bounded by 16 MiB
  moov, 16 top-level boxes and a 15 s budget, and remote metadata probes require an exact
  `206 Content-Range`.
- **[Rec]** Preserve the proxy unchanged in the first migration. It is the single most
  hardware-validated component, and its upstream needs from the backend are just "Range-correct bytes
  with a bearer token". See `backend-contract.md` §6.

### 2.9 Android Auto

- **[Obs]** `PlaybackService` is a `MediaLibraryService`, exported with `MediaBrowserService` +
  `MEDIA_PLAY_FROM_SEARCH` intent filters, and `automotive_app_desc.xml` declares `media`.
- **[Obs]** Browse tree (`AutoBrowseTree`): root → Continue Listening, Downloaded, Audiobooks (by
  title/author/series via `AutoLibraryTree`), plus "chapters of now playing". The media-id grammar is
  `book/<id>`, `chapter/<bookId>/<idx>`, `group/<parent>/<start>/<end>`, and
  `alphabet/<parent>/<first>/<last>` (URL-encoded). Shelves over 40 entries are split into range
  folders, so nothing relies on host pagination.
- **[Obs]** `AutoLibraryRepository.loadAll` (:82) scans the whole audio-filtered catalog with
  `POST /books/query` in pages of up to 200, 4 concurrent requests, a 10 s timeout and a 120 s
  snapshot cache scoped by `server|userId`. It falls back to downloads offline.
- **[Obs]** `AutoSearch.find` (:18) merges an offline match over downloads (accent/case-insensitive, all
  terms over title+authors+narrators) with online page 0 of the query, and ranks them (exact > prefix >
  contains, then the active book, then recency). An empty query means Continue Listening.
- **[Obs]** `AutoPlaybackResolver` (:28) bounds book resolution (8 s) and progress lookup (4 s, then local).
  If the saved file is gone it restarts at 0 and clamps the offset to the file duration.
- **[Obs]** Artwork (`AutoArtwork.open` :59 + non-exported `AutoArtworkProvider`): content URIs
  scoped by `sha256(server|userId)`. Read access is granted per connected controller package
  (`grantTo` :51). The app fetches `GET /books/{id}/thumbnail` (5 MiB cap, image MIME check) into a
  128-entry LRU cache, so no credentials ever reach the head unit.

## 3. Reusable modules vs BookOrbit-specific behaviour

| Area | Reuse potential | BookOrbit-specific coupling to remove |
| --- | --- | --- |
| `PlaybackQueue`, `ChapterClock`, `AudioSettings` math, `ResumeCandidates` | High. Pure Kotlin with dense tests | None (chapter source shape only) |
| `BookAggregatingPlayer`, `BookQueueCommand`, `CastQueueTransfer`, `ActiveBookPlayer`, `PlaybackService` | High. Media3-only | `com.bookorbit.*` action/extra names |
| `CastProxyServer`, `Mp4ChapterFilter` | High. Backend-agnostic | Upstream URL format only |
| `MediaLibraryCallback`, `AutoBrowseTree`, `AutoLibraryTree`, `AutoSearch`, `AutoPlaybackResolver`, `AutoArtwork*` | High logic reuse | Data sources: `queryBooks` filter DSL, scroller Continue Listening, `BookCard`/`BookDetail` shapes, `thumbnail` URL |
| `PlayerRepository`, `AudioProgressRepository`, `AudiobookAssetResolver` | Medium. Rewrite the network edge | Manifest/legacy split, publicId heuristic, revision/412 semantics |
| `DownloadWorker`, `DownloadResume`, `LocalRef`, `DownloadFileNaming` | High | `bookJson = BookDetail` persistence, endpoints |
| Session/auth, interceptors, user-CA trust | High (pattern) | Endpoints, cookie refresh transport, OIDC state flow |
| Room schema + sync queues | Medium. The pattern is reusable | Integer ids, per-server-not-per-user scoping, BookOrbit DTO JSON blobs |
| Foliate reader assets + `bridge.js` | **Blocked on rights**: see `source-provenance.md` | BookOrbit-modified Foliate fork, BookOrbit streaming loader, KOReader/Kobo hooks |
| Catalog/library/dashboard/stats/Book Dock/smart-scope UI | Low | Entire BookOrbit product model |
| Branding (`BookOrbit*` names, `ic_orbit`, store assets, `bookorbit://` scheme, `com.bookorbit` id) | None. Must be replaced | Trademark/identity |
