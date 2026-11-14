# Cast / Android Auto / offline preservation matrix

Revision `bookorbit-android@a55eaa1`. Each row links a behaviour that must survive migration to the code
that implements it, the automated tests that guard it, and what still needs hardware. Test status is
from **this audit's own run** (`baseline-verification.md`): JVM tests 335/335 pass in both flavours,
and instrumentation 20/20 pass in both flavours on a Pixel Tablet AVD running Android 16.
**No physical-device, Chromecast or head-unit checks were performed in this audit.** Rows marked
"Physical: reported" cite the upstream repo's own test notes (`docs/testing/cast-handoff.md`, dated 2026-10-22,
Pixel 9 Pro / Android 17 + real Chromecast). This audit did not reproduce them.

Test paths: `T:` = `app/src/test/java/com/bookorbit/...` (JVM), `I:` = `app/src/androidTest/java/com/bookorbit/...`
(instrumented, emulator OK).

## 1. Matrix

| # | Behaviour | Implementation | Automated coverage | Hardware-only / manual |
| --- | --- | --- | --- | --- |
| M1 | **Large-offset seeking / ranges** (multi-GB M4B; tail reads for end-of-file `moov`) | `CastProxyServer.serveRemote/serveLocal`, `parseRangeHeader`; ExoPlayer via `OkHttpDataSource` | I: `feature/cast/CastProxyRangeTest.remoteTailRangePreservesLargeOffsetsAndTransfersOnlyRequestedBytes` (8 GiB virtual source, 8-byte tail, 206/Content-Range forwarding). T: `cast/Mp4ChapterFilterTest` "moov after an extended size 8 GiB mdat is found without reading media" | Physical: reported 648 MB M4A starts in seconds after the chapter filter |
| M2 | **MP3 / M4A / M4B MIME handling** for extensionless stream URLs and renamed downloads | `feature/player/AudioMimeType.kt`, `PlayerRepository.resolve` sets `setMimeType`; proxy fallback `mimeTypeFor` | T: `player/AudioMimeTypeTest` (3) | Physical: reported MP3→M4B→MP3 switching while connected works |
| M3 | **Embedded chapter-track filtering for Cast** (stops receiver chapter preloading) | `feature/cast/Mp4ChapterFilter.kt`, `CastProxyServer.chapterPatches` | T: `Mp4ChapterFilterTest` (4: only referenced chapter boxes patched; every 1-byte range sees the same view; unreferenced/fragmented pass through; malformed fails closed). I: `CastProxyRangeTest.chapterFilteringIsIdenticalForLocalRemoteAndPartialRangeResponses` | Startup-time improvement only measurable on a real receiver |
| M4 | **App chapter model** (normalisation, Intro, cross-file chapter ranges, chapter/book time) | `PlaybackQueue`, `ChapterClock`, `BookAggregatingPlayer` | T: `PlaybackQueueTest` (15), `ChapterClockTest` (10). I: `ChapterSessionRefreshTest.durationFollowsChapterOnSeekAndPlayback` | Steering-wheel / AVRCP next/previous on hardware |
| M5 | **Queue replacement while casting** (new book without disconnecting; 127-file → 1-file) | `BookQueueCommand` + `MediaLibraryCallback.onCustomCommand`/`routeQueue`, `CastProxyServer.rewriteForCast` (closes old transfers, new token) | I: `CastQueueReplacementTest.switchingFrom127FilesToOneSurvivesOldQueuePositionUpdates` (real controller/session, delayed receiver, stale index-41 update); I: `CastProxyRangeTest.replacingBookInvalidatesOldUrlsAndServesNewLocalRangesWithCors` | Physical: reported crash fixed (Media3 1.5.1 `mergePlayerInfo`) |
| M6 | **Local ⇄ Cast handoff** keeps position, play state, no double audio; failure keeps local playback | `PlaybackService.switchToCast/switchToLocal`, `transferQueueToCast`, `castReturnPosition`, `matchesCurrentQueueItem` | T: `CastQueueTransferTest` (6: playing/paused handoff, failed load restores play state, disconnect during replacement restores the new book, disconnect uses receiver index/offset, 127-item partial queue identity) | Real `CastPlayer`/Default Media Receiver session lifecycle is **not** exercised by any test (the full flavour's `CastHandoff` has no test). Hardware required |
| M7 | **Whole-book position across a partial Cast queue** (placeholder windows lack durations) | `BookAggregatingPlayer.currentSourceItems`, `CastProxyServer.sourceQueue` | I: `CastBookPositionTest.partialQueueRetainsBookTimeAcrossSeekPlaybackAndChapterMode` | Physical: reported multi-file MP3 progress fixed |
| M8 | **Saved speed** (global + per-book; applied on phone, Auto and Cast loads) | `AudioSettingsStore`, `resolveSpeed`, `PlayerManager.applyQueue`, `AutoPlaybackResolver`, `BookQueueCommand.apply` | T: `PlaybackSpeedTest` (5), `AutoPlaybackResolverTest` "car starts apply a book override then return to the global speed". I: `AutoMediaSessionTest` asserts speed 1.5 after voice play | **[Q]** Speed on the Default Media Receiver via `CastPlayer` is not asserted anywhere. Verify on hardware |
| M9 | **Multi-file resume** (correct file + offset; removed file restarts; offset clamped; bounded lookups) | `AudioProgressRepository.resumePoint`, `AutoPlaybackResolver.resolve`, `PlayerManager.applyQueue`/`refreshIfStale` | T: `AutoPlaybackResolverTest` (7), `AudioProgressRepositoryTest` (16), `PlaybackQueueTest` locate/abs tests. I: `AutoMediaSessionTest` (position ≥ 1.9 s on file 0; chapter spanning file boundary) | Cross-device resume against a live server |
| M10 | **Progress reconciliation** (local-first, dirty retry, newer-wins, 409/412 handling, idempotent op ids) | `AudioProgressRepository.report/flushPending/putPlaybackState`, `SyncWorker`, `QueuedWriteRejection` | T: `AudioProgressRepositoryTest` (16), `QueuedWriteRejectionTest` (3), `ReaderProgressRepositoryTest`, `ReaderAnnotationRepositoryTest`, `ReadingSessionTrackerTest` | — |
| M11 | **Cold-start Auto browsing** (service bound without the activity; Continue first; title/author/series; >40 range folders) | `PlaybackService` (MediaLibraryService), `MediaLibraryCallback.onGetLibraryRoot/onGetChildren/onSubscribe`, `AutoBrowseTree`, `AutoLibraryTree`, `AutoLibraryRepository` | I: `AutoMediaSessionTest.offlineSearchVoiceResumeChaptersAndLiveDownloads` (connects to the real service without an activity; root extras `SEARCH_SUPPORTED`; Continue first; modes; live Downloads refresh). T: `AutoBrowseTreeTest` (15), `AutoLibraryTreeTest` (6), `AutoLibraryRepositoryTest` (9), `AutoCatalogTest` (4) | Projected Auto UI / DHU / head unit; phone locked |
| M12 | **Auto search + voice** (`playFromSearch`, empty query ⇒ resume, accents, narrators, duplicates) | `MediaLibraryCallback.onSearch/onGetSearchResult/onSetMediaItems`, `AutoSearch` | T: `AutoSearchTest` (7), `AutoFailureTest` (2). I: `AutoMediaSessionTest` (search; legacy `playFromSearch` transport path; invalid selection error; empty-queue resumption) | Real Gemini/Assistant speech recognition |
| M13 | **Android 15+ foreground before audio focus** (cold background start) | `PlaybackService.ensureForegroundBeforePlay`, `BookAggregatingPlayer.play/setPlayWhenReady` hook | I: `AutoMediaSessionTest` (cold service playback on API 35+ images) | OEM-specific background limits |
| M14 | **Artwork for Auto/system** without credentials leaving the phone | `AutoArtwork`, `AutoArtworkProvider` (non-exported, prefix URI grants per controller, scope = sha256(server\|user)) | I: `AutoArtworkProviderTest` (3: downloaded cover readable; explicit grant required; writes and foreign scopes rejected) | Authenticated **streamed** cover on head unit (docs: manual) |
| M15 | **Account / server isolation** | `DataScope` + per-server Room file (`DatabaseModule`), scope checks in `AutoArtwork`, `AutoLibraryRepository`, `MediaLibraryCallback.dataScope`; pending ops `userId` | T: `DataScopeTest` (3), `AutoLibraryRepositoryTest` "account and server changes cannot reuse an earlier index", "scope changes during a request discard its response"; `AuthRepositoryTest`. I: `SecureStorageRecoveryTest` (3) | Switch account on a head unit. See L6 |
| M16 | **Offline operation** (downloaded books: play, browse, search, art, resume; signed-out browse) | `PlayerRepository` (download first), `DownloadEntity.bookJson`, `AutoCatalog` offline continue, `AutoLibraryRepository` signed-out path, `AutoSearch` offline match | T: `AutoCatalogTest` "offline continue keeps usable downloads", `AutoLibraryRepositoryTest` "signed out browsing uses downloads without network", "failed requests are retried and complete downloads remain browsable offline", `AutoSearchTest` offline cases. I: `AutoMediaSessionTest` ("offline…" fixture with downloaded files) | Airplane-mode run on device |
| M17 | **Resumable downloads** (Range append, 200 overwrite, mismatched 206 restart, background continuation) | `DownloadWorker`, `DownloadResume` | T: `DownloadResumeTest` (11), `DownloadFileNamingTest`, `LocalRefTest` | Process death / network handover on a device |
| M18 | **Launch restore** (mini-player reopens last unfinished book, paused) | `PlayerManager.restoreLastBook`, `RestoreCandidateFinder`, `ResumeCandidates` | T: `RestoreCandidateFinderTest` (6), `ResumeCandidatesTest` (5) | — |
| M19 | **Private CA / self-hosted TLS** applies to streaming and Cast upstream too | `UserCaTrust`, `HostScopedTrustManager`, applied in `PlayerModule`, `CastModule` | I: `UserCaTrustTest` (4). T: `HostScopedTrustManagerTest` | — |
| M20 | **fdroid flavour has no proprietary Cast** and still plays/Auto | `fdroid/.../cast/*` no-ops | Lint + JVM + instrumentation pass for fdroid. Built APKs: 0 `com/google/android/gms/cast` references in fdroid dex (this audit) | — |

## 2. Known limitations and gaps (observations)

| ID | Limitation | Evidence |
| --- | --- | --- |
| L1 | Downloads stored in a user-chosen **SAF folder (`content://`) cannot be Cast**. The proxy returns 404 because `RandomAccessFile` has no SAF equivalent | `CastProxyServer.targetFor` comment; `cast-handoff.md` step 4 |
| L2 | **Asynchronous receiver failures** (receiver cannot fetch the stream) are not caught by the synchronous handoff fallback | `cast-handoff.md` step 5 |
| L3 | Cast proxy requires an **IPv4** LAN address (`lanIpAddress` filters `Inet4Address`). It serves plain HTTP on the LAN, with an unguessable per-queue token in the path and `Access-Control-Allow-Origin: *` | `CastProxyServer.kt:448`, `:430` |
| L4 | The real `CastPlayer` session lifecycle (connect/resume/suspend) has **no automated test**. All Cast tests use fakes or the proxy | absence in `androidTest`, `full/` has no tests |
| L5 | Voice recognition, the projected Auto UI, steering-wheel buttons, phone-locked cold start and authenticated streamed artwork on a head unit are **manual only** | `docs/testing/android-auto.md` "Phone and head-unit checks still required" |
| L6 | **Local progress and downloads are per server, not per user**. `audio_progress`/`reader_progress`/`downloads` have no user column, so two accounts on one server share local positions, and `SyncWorker` may push account A's dirty audio position as account B | `core/db/AudioProgressEntity.kt`, `ReaderProgressEntity.kt`, `SyncWorker.kt`; contrast `MIGRATION_7_8` adding `userId` only to annotation/session queues |
| L7 | Reader position resolution has no timestamp comparison ("dirty local wins") | `ReaderProgressRepository.resolveInitial` |
| L8 | File↔asset mapping is heuristic (size+format, then order) | `AudiobookAssets.match`; `AudiobookAssetsTest` |
| L9 | Pinned to **Media3 1.5.1**. Two workarounds (custom load command; source-queue durations) target 1.5.1 Cast behaviour. Upgrading Media3 needs the M5–M7 tests plus a hardware retest | `cast-handoff.md` "Queue replacement crash follow-up" |
| L10 | CBR/CB7 comics are online-only (server-rendered pages) | `BookFiles.COMIC_SERVER_PAGED`, `ImageUrls.comicPage` |
| L11 | `CustomX509TrustManager`, `ExportedService`, `InsecureBaseConfiguration` lint warnings are by design (user-CA opt-in, Auto service) but should be re-reviewed on import | lint report (`baseline-verification.md`) |

## 3. Preservation rules for the migration (recommendations)

1. **[Rec]** Treat M1–M20's automated tests as the regression gate for every increment. They run without
   hardware (JVM + emulator) in about 5 minutes on this machine.
2. **[Rec]** Keep the Media3 version and the player/Cast/Auto classes byte-identical in the first increments.
   Change only the data edge (`PlayerRepository`, `AudioProgressRepository`, `AutoCatalog`,
   `AutoLibraryRepository`, `AutoArtwork` URL), behind interfaces.
3. **[Rec]** Add a **fake Litara backend** for instrumentation (MockWebServer serving recordings, Range and
   positions), so M9–M16 are re-proven against the new contract, not only against BookOrbit-shaped fixtures.
4. **[Rec]** Add the missing tests before or with the migration: a speed-on-Cast assertion (M8 [Q]), and a
   per-user isolation test that will fail today (L6). Record L4/L5 as an explicit hardware checklist per
   release.
5. **[Rec]** Hardware sign-off per milestone: Chromecast (MP3 multi-file, M4B > 1 GB with chapter track,
   queue replacement, disconnect mid-load), DHU or head unit (cold start locked, voice, >40 items, offline,
   account switch). Record device, OS, receiver, Auto version and server build with results, following
   the existing `docs/testing/*.md` format.
