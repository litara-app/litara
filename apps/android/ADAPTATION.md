# Adaptation boundary: BookOrbit baseline → Litara

This documents where the future Litara API adapter replaces baseline code and which accepted ADRs
require changes. **Nothing here is implemented.** The baseline's BookOrbit networking is temporary and
**pending replacement**; no BookOrbit compatibility layer is to be built. Sources: ADR-0005,
ADR-0009, ADR-0013, ADR-0015, ADR-0017 to ADR-0023 and `../../research/android/`.

## 1. Where the Litara adapter replaces baseline code

Paths are under `app/src/main/java/com/litara/`.

| Area | Files (replace/rebind) | Notes |
| --- | --- | --- |
| Retrofit surface and base URL | `core/network/ApiService.kt` (about 73 methods mirroring BookOrbit `/api/v1`), `core/network/Interceptors.kt` (`BaseUrlInterceptor` prefixes `/api/v1`), `core/di/NetworkModule.kt` | Replace with a Litara API client. Keep the media-critical shape: bearer on every request, byte-exact ranges. |
| DTOs | `core/model/*.kt` (`Book`, `BookFiles`, `Audiobook`, `Auth`, `Query`, `BookDock`, `Library`, `Misc`, `Annotation`, `ReadingSession`) | Integer ids and BookOrbit-specific shapes. Replace with Litara title/edition/recording/file models. |
| Query DSL | `core/paging/PagingSources.kt`, `feature/library/filters/BuildBookQuery.kt` | BookOrbit-specific filter tree. |
| File↔asset heuristic and legacy routing | `core/network/AudiobookAssetResolver.kt`, `AudiobookAssets.match` in `core/model/Audiobook.kt` | Delete once the API exposes one stable id per audio file. |
| Auth/session | `core/auth/SessionManager.kt`, `feature/auth/AuthRepository.kt`, `core/network/TokenRefresher.kt`, `TokenAuthenticator.kt`, `PersistentCookieJar.kt`, `feature/auth/OidcManager.kt` | Cookie-based refresh; OIDC state flow and `bookorbit://` redirect. |
| Playback data edge | `feature/player/PlayerRepository.kt` (stream URL construction), `AudioProgressRepository.kt` (position PUT/PATCH), `RestoreCandidateFinder.kt` (Continue Listening source) | Rewire to recording/file identities. |
| Android Auto data sources | `feature/player/AutoLibraryRepository.kt` (`queryBooks`), `AutoCatalog.kt`, `AutoSearch.kt`, `AutoArtwork.kt` (`/books/{id}/thumbnail`) | Browse/search/playback logic reusable; sources change. |
| Downloads | `feature/downloads/DownloadWorker.kt`, `DownloadsRepository.kt` (endpoints, `bookJson` persistence of `BookDetail`) | `DownloadResume` and `LocalRef` logic is backend-agnostic. |
| Sync queues | `core/sync/SyncWorker.kt`, `core/db/Pending*`, `ReaderProgress*`, `AudioProgress*` | Endpoints and reconciliation. |
| Cast upstream | `core/di/CastModule.kt` (`@CastUpstreamClient`), `feature/cast/CastProxyServer.kt` (`rewriteForCast`) | Proxy logic is to be **preserved** (ADR-0020); only the upstream URL/credential source changes. |

Keep unchanged unless a defect forces it: `BookAggregatingPlayer`, `ChapterClock`, `PlaybackQueue`,
`BookQueueCommand`, `CastQueueTransfer`, `Mp4ChapterFilter`, `CastProxyServer` behavior, the `full`/`fdroid`
`feature/cast` flavor sources, `MediaLibraryCallback`, and the Auto browse tree.

## 2. Changes required by accepted ADRs (not implemented)

| ADR | Required change | Touches |
| --- | --- | --- |
| ADR-0018 stable media identities | Opaque stable recording and file ids plus explicit content versions in catalog, playback, download and position contracts. Remove size/format/order heuristics. Do not reuse an old download location only because a file id is unchanged. | DTOs, `PlayerRepository`, `DownloadWorker`, `AudiobookAssets.match`, Auto media-id grammar (`book/<id>`) becoming recording-based |
| ADR-0019 + ADR-0015 revision-aware progress | Audio position = file id/content version + millisecond offset; whole-recording time derived from the ordered manifest; detect layout changes; revision-aware conflicts rather than client-timestamp winners. Retain capture time as context only. Recoverable pending writes and conflict UI. | `AudioProgressRepository`, `AudioProgressEntity`, `SyncWorker`, `PlayerManager.report`, `AutoPlaybackResolver` (clamp-on-missing-file policy), `ReaderProgressRepository.resolveInitial` (currently "dirty local wins") |
| ADR-0020 bearer media + Cast proxy | Keep bearer upstream and the phone Cast proxy; server tokens never reach the receiver. Add refresh-then-retry for ranged media and revoked-access handling. | `Interceptors.kt`, media `OkHttp` data source, `CastModule`, `CastProxyServer` |
| ADR-0021 native refresh sessions | Rotating native refresh token in protected storage, per-device revocable sessions, no cookie transport, explicit concurrent-refresh/lost-response policy. | `TokenRefresher`, `TokenAuthenticator`, `PersistentCookieJar` (remove), `SecureStorage`, `SessionManager` |
| ADR-0022 completion per edition/recording | Completion belongs to editions/recordings with title history; positions remain separate. | read-status models/queues (`PendingReadStatus*`), Continue Listening and Auto lists |
| ADR-0013 account isolation (and reconciliation note) | Partition all local data by server **and** account (see §3). | `core/auth/DataScope.kt`, `core/di/DatabaseModule.kt`, all Room entities/DAOs, `SyncWorker`, `DownloadWorker` |
| ADR-0023 flavors | Keep `full` and `fdroid` build paths; F-Droid must stay free of Google Cast components; re-run both flavors on any library change. | `app/build.gradle.kts`, `feature/cast/` flavor sources |

Identity, signing, URI scheme, discovery/pagination/offline-snapshot/chapter-representation details
remain **open decisions** and are not selected here.

## 3. Known defect carried over: downloads and progress are per server, not per account (audit L6)

**This is a defect, not preserved behavior.** In the baseline, `core/di/DatabaseModule.kt` opens one Room
database per server URL (`litara-<sha12>.db`, derived by `core/auth/DataScope.kt`). The
`audio_progress`, `reader_progress` and `downloads` tables have **no user column**
(`core/db/AudioProgressEntity.kt`, `ReaderProgressEntity.kt`, `DownloadEntity.kt`). Only the pending
annotation and reading-session queues carry a `userId` (added by `MIGRATION_7_8`). Consequences the audit
reported:

- Two accounts on one server share local positions and downloaded content.
- `SyncWorker` may upload account A's dirty audio position while signed in as account B.

**Passing the existing unit and instrumentation tests does not show this is fixed**: the suite never
exercised it (`DataScopeTest` and Auto scope tests cover server/user keys for the Auto cache and artwork only).
The fix must partition downloads, progress, cached metadata, restore state and queued operations by
server **and** authenticated account, prevent a request begun under one scope from publishing into
another, and include a regression that dirty progress from account A is never uploaded as account B.
That test should be written to fail against this baseline first.

## 4. Other carried limitations (from the audit, unchanged here)

SAF-folder downloads cannot be cast (L1); asynchronous receiver failures are not caught (L2); the Cast
proxy is IPv4/HTTP/LAN only (L3); the real `CastPlayer` lifecycle has no automated test (L4); voice,
projected Auto UI, steering-wheel and head-unit artwork behavior are manual only (L5); Media3 is pinned
to 1.5.1 with Cast-specific workarounds (L9); CBR/CB7 comics are online only (L10).
