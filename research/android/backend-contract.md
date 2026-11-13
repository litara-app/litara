# Backend contract extracted from the Android consumer

Source: `core/network/ApiService.kt` and its callers at `bookorbit-android@a55eaa1`. The contract was
inferred from what the client **sends, reads and relies on**, not from BookOrbit server docs.
Two parts: (A) an inventory of what Android uses today, and (B) the behaviour any backend must
provide to keep Cast, Auto and offline playback working, separated from BookOrbit naming.

Legend: **[Obs]** observation; **[Req]** behaviour the Android app depends on (candidate
requirement for the Litara API, not a decision); **[Inc]** incidental BookOrbit naming/shape that can
change freely; **[Q]** open question for the ADR discussion.

## A. Inventory (BookOrbit `/api/v1`, as consumed)

Base: `${serverUrl}/api/v1/` (serverUrl may contain a path prefix). Auth: `Authorization: Bearer <access>`
on all API calls, image fetches (`@ImageClient`), media streams (`PlayerModule` data source) and the
Cast proxy upstream. The refresh token travels as an HTTP-only cookie.

### A.1 Auth / identity

| Method + path | Request | Response fields read | Used by |
| --- | --- | --- | --- |
| `GET auth/setup-status` | — | `needsSetup` | Server probe during setup |
| `POST auth/login` | `{username, password}` | `accessToken`, `user{id, username, name, email, active, isSuperuser, isDefaultPassword, avatarUrl, provisioningMethod, permissions[]}` | Login |
| `POST auth/refresh` | empty body + refresh cookie | `accessToken` | `TokenRefresher` (single-flight on 401) |
| `POST auth/logout` | — | — | Logout (best-effort) |
| `GET auth/me` | — | `AuthUser` | Session check |
| `GET app-settings/oidc/providers/public` | — | `[{slug, displayName, enabled, iconUrl, clientId, scopes}]` | Login screen |
| `POST auth/oidc/{slug}/state` | — | `{state, authorizationEndpoint}` | AppAuth PKCE start |
| `POST auth/oidc/callback` | `{code, codeVerifier, redirectUri, nonce, state}` | `{mode, accessToken, user}` | Code exchange via server |
| `GET app-info` | — | version / update info | Settings |

### A.2 Catalog

| Method + path | Pagination | Notes |
| --- | --- | --- |
| `POST books/query`, `POST libraries/{id}/books`, `POST smart-scopes/{id}/books/query` | body `pagination{page (0-based), size}`; response `{items, total, page, size}` | `filter` is a BookOrbit rule/group JSON tree, `sort[{field,dir}]`, `q`. Android Auto scans **all** audio books with `formats ∈ AUDIO_FORMATS`, size ≤ 200, and copes with servers capping `size` (`AutoLibraryRepository.loadAll`). |
| `GET books/search?q&limit` | limit | Lean `{id, title, seriesName, authors[], libraryId, libraryName, formats[]}` |
| `GET books/{id}` | — | `BookDetail` (below). **The single most important read**: it drives player, downloads, reader choice and Auto. |
| `GET libraries`, `GET collections[?bookIds]`, `GET collections/{id}/books?page&size&q`, `POST/DELETE collections/{id}/books`, `GET smart-scopes`, `GET smart-scopes/{id}/books?page&size&q`, `GET authors?page&size&sort&order&q`, `GET authors/{id}/books`, `GET series…`, `GET series/{id}/books`, `GET metadata/{kind}?q`, `GET books/{id}/recommendations|author-books|series-books` | `page`/`size` (0-based) | UI only. Not media-critical. |
| `POST dashboard/widgets/batch`, `GET dashboard/scrollers/{type}?limit&smartScopeId`, `GET dashboard/widgets/reading-streak|reading-goal`, `GET user-statistics/*` | limit | `CONTINUE_LISTENING` scroller feeds Auto "Continue listening" and launch restore. The shape is `[BookCard]` or `{books:[BookCard]}` (changed in BookOrbit 3.0). |
| `PATCH books/{id}/status`, `POST books/bulk-set-rating` | — | Queued offline |
| `book-dock/*` (9 routes, 1-based `page`/`limit`) | — | BookOrbit ingest review. Out of scope for media. |

`BookDetail` fields read: `id, libraryId, libraryName, status, addedAt, title, subtitle, description,
isbn10/13, publisher, publishedYear, language, pageCount, seriesId/Name/Index, rating, coverSource,
providerIds, authors[{id,name,sortName}], genres, tags, readStatus, collections,
files[{id, format, role ("primary"|…), sizeBytes, durationSeconds, filename}],
audioMetadata{narrators[{id,name,sortName,displayOrder}], durationSeconds, abridged,
chapters[{title, startMs}]}`.

`BookCard` (list rows) adds `files[]`, `narrators[]`, `hasCover`, `readingProgress`.

### A.3 Bytes: covers, files, audio

| Method + path | Range | Response | Used by |
| --- | --- | --- | --- |
| `GET books/{id}/cover` | no | image | Download cover cache, Coil |
| `GET books/{id}/thumbnail` | no | image (must be `image/*`, ≤ 5 MiB) | Auto artwork provider, cards |
| `GET authors/{id}/thumbnail`, `GET book-dock/files/{id}/cover` | no | image | UI |
| `GET books/files/{fileId}/serve` | **yes** (`bytes=N-`) | 200 or 206 + `Content-Range` | Ebook/PDF/comic download, reader cache, legacy audio |
| `GET audiobooks/{bookId}/manifest` | — | `{revision, assets[{assetId, sequence, format, durationMs, sizeBytes}]}` | Maps files→assets. 404 ⇒ legacy server |
| `GET audiobooks/{bookId}/assets/{assetId}/content` | **yes** (arbitrary single ranges from ExoPlayer and Cast, `bytes=N-` from downloads, suffix `bytes=-N` from receivers) | 200/206/416, `Content-Range`, `Content-Type`, `Accept-Ranges` | Streaming (ExoPlayer), Cast proxy upstream, audio downloads |
| `GET cbz/files/{fileId}/pages` / `GET cbz/files/{fileId}/pages/{n}` | no | `{pageCount}` / image | CBR/CB7 reader (online only) |

### A.4 Progress, annotations, sessions

| Method + path | Body | Semantics relied on |
| --- | --- | --- |
| `GET audiobooks/{bookId}/playback-state` | — | `{assetId, positionMs, percentage, capturedAt, revision}` **or an empty / `null` 200** when there is none |
| `PUT audiobooks/{bookId}/playback-state` | `{assetId, positionMs, capturedAt (ISO), operationId (UUID), baseRevision, manifestRevision}` | Returns the new `revision`. **409** = stale `baseRevision`. **412** = manifest changed. 400/404 are treated as permanent. `positionMs` is clamped client-side to the asset duration |
| `GET/PATCH books/{id}/audio-progress` | `{currentFileId, positionSeconds, percentage}` | Legacy (pre-3.0) |
| `GET/POST books/files/{fileId}/progress` | `{cfi?, percentage (0–100), pageNumber?}` | Reader position per **file**. GET may return `null` |
| `GET/POST/DELETE books/{bookId}/bookmarks[/{id}]` | `{cfi, title}` | Ebook bookmarks |
| `GET/POST/DELETE audiobooks/{bookId}/bookmarks[/{bookmarkId}]` | `{clientId, positionMs, title}` | Audio bookmarks (string id, idempotent `clientId`) |
| `GET books/{bookId}/annotations`, `POST …` `{cfi, bookFileId, text, color, style, note?, chapterTitle?}`, `PATCH …/{id}` (raw JSON, explicit `null` clears note), `DELETE …/{id}` | — | Shared with web/KOReader/Kobo (`origin`, `positionStatus`) |
| `GET annotations?page(1-based)&pageSize&search&hasNote&status&sortBy&sortDir` | — | Notes hub |
| `POST books/files/{fileId}/sessions` | `{sessionId, startedAt, endedAt, durationSeconds, progressDelta?, endProgress?, sessionType, source}` | Re-sending the same `sessionId` supersedes it (idempotent upsert) |

## B. Behaviour the Android media stack depends on

### 1. Identity and stable ids

- **[Req]** A stable identifier for **each audio file of a recording/edition**, usable in all of: book
  detail, the stream URL, the download URL, the playback-position write and the manifest. Today the client
  has to reconcile `BookFileRef.id` (int) with `assetId` (string) using a size/format/sequence heuristic
  (`AudiobookAssets.match`). This is fragile with duplicate sizes and is the source of the `Legacy` vs
  `Assets` branching. One id removes both.
- **[Req]** A stable id for the playable unit Auto lists (today `book/<bookId>`). It must survive a
  reorder and must not encode page offsets (`AutoLibraryTree` already avoids offsets).
- **[Inc]** Integer vs string ids, and the names `bookId`/`fileId`/`assetId`.
- **[Q]** Under the accepted title → edition/recording → file model, what is the Auto playable unit,
  what does "Continue listening" return, and what does the Android `MediaItem` id carry? Options:
  recording id (with title for display), or title id with a resolved default recording.

### 2. Ordered multi-file recordings

- **[Req]** An explicit, server-defined **order** of audio files within a recording (BookOrbit:
  `sequence` in the manifest, "sorted by sortOrder/filename"). The client plays files as a
  queue in this order and computes book time as the sum of preceding durations (`PlaybackQueue`).
- **[Req]** **Per-file duration** (ms or s, ≥ 0) available *before* playback, in the same response as
  the file list. `BookAggregatingPlayer` reads it from `MediaItem` extras because Media3 does not know
  durations of unbuffered queue items (and Cast placeholders omit them). A missing duration is treated as 0,
  which breaks seeking across files.
- **[Req]** Per-file `sizeBytes` (needed for download resume `DownloadResume.plan` and skip-if-complete).
- **[Req]** Per-file `format`/MIME **independent of the URL** (stream URLs have no extension;
  `audioMimeType`; Cast's media item converter throws without a MIME type). m4b/m4a/mp4 → `audio/mp4`,
  mp3 → `audio/mpeg`, plus aac, flac, ogg/opus, wav.
- **[Req]** A recording **revision** or etag that changes whenever the file set or order changes, so
  queued progress written against an old layout can be detected (BookOrbit: `manifestRevision` → 412).

### 3. Chapters

- **[Req]** Chapters as `[{title, start}]` in **recording time** (whole recording across files), not
  per-file. The client normalises them (sorts, removes duplicates, drops starts ≥ total, snaps/creates
  an Intro at 0, and treats < 2 chapters as "chapterless": `PlaybackQueue.normalizeChapters`), so the
  server need not be perfect. But the time base must be recording-wide.
- **[Obs]** Embedded MP4 chapter tracks are deliberately **hidden from Cast receivers**
  (`Mp4ChapterFilter`), so the server's chapter list is the only one users see on Cast. **[Req]** Chapters
  must be served from metadata, not left to the container.
- **[Q]** Do chapters belong to the recording (edition) or to the title? They must be recording-specific
  (different narrations have different timings).

### 4. Streaming and Range

- **[Req]** Byte-exact single-range support on audio content: `Range: bytes=a-b`, `bytes=a-`, and suffix
  `bytes=-n`. Reply `206` with an exact `Content-Range: bytes a-b/total`, `Content-Length` and `Accept-Ranges:
  bytes`. Reply `416` with `Content-Range: bytes */total` when unsatisfiable. Reply `200` with the full body
  when Range is absent.
- **[Req]** **Identity encoding** (no gzip/br on audio). The Cast proxy refuses metadata probes unless the
  response is identity and `206` with the *exact* requested `Content-Range`
  (`CastProxyServer.readRemoteMetadata`). A server or reverse proxy that ignores Range forces a full-book read and
  disables the chapter filter (logged as a warning).
- **[Req]** Large offsets (> 4 GiB) must work. `CastProxyRangeTest` exercises an 8 GiB virtual source.
- **[Req]** Bearer-token auth on media GETs, honoured on every range request, with **401 → refresh →
  retry** working (the stream data source reads the token per request, and the Cast upstream client uses
  `TokenAuthenticator`). Signed URLs or cookies would also work for ExoPlayer but **not** for the Cast
  receiver, which only ever talks to the phone's proxy. **[Q]** If Litara adds short-lived signed media URLs,
  the proxy can keep using them upstream. This is a decision for the API/auth ADR.
- **[Req]** Stable `Content-Type` for audio (`audio/mpeg`, `audio/mp4`, …). The proxy forwards it.
- **[Req]** The same bytes and representation for streamed and downloaded files. The chapter overlay and
  progress offsets assume they are identical.
- **[Inc]** Path shape (`/audiobooks/{b}/assets/{a}/content` vs `/books/files/{f}/serve`).

### 5. Covers and artwork

- **[Req]** An authenticated image endpoint per playable unit returning `image/*`, small enough for a car
  (the client caps at 5 MiB and uses the "thumbnail" variant for Auto), and a full-size cover for
  downloads. Must not redirect (the Auto artwork client disables redirects).
- **[Q]** Cover per title or per edition/recording? Audiobook recordings often have square art that
  differs from the ebook cover.

### 6. Downloads (offline)

- **[Req]** A self-contained **metadata snapshot** a client can persist and use offline. Today the full
  `BookDetail` JSON is stored in `DownloadEntity.bookJson`, and player, Auto browse/search (title, authors,
  narrators, series, series index) and resume all work from it. Litara needs an equivalent "recording
  detail" document that includes ordered files, durations, sizes, formats, chapters, narrators/authors and
  series.
- **[Req]** Range-resumable file download (`bytes=N-`, 206 append). See §4.
- **[Req]** The download set rule: all audio files of the chosen recording, or for ebooks the primary file.
  **[Q]** Under editions, the user chooses the *recording/edition* to download. The API needs to expose the
  edition list and which one is "primary".

### 7. Playback position (audio)

Observed client algorithm (`AudioProgressRepository`, `AutoPlaybackResolver`):
local-first upsert with a dirty flag → immediate push → WorkManager retry while dirty. Resume uses whichever of
local/server has the newer capture timestamp. Pushes every 5 s while playing and on stop.

- **[Req]** Position expressed as **(file id, offset within file)**, with **recording-level percentage**
  derived from it. The client also needs to map back to (file, offset) from the server's response.
  **[Q]** Alternatively the API stores recording-time offset only. The client already has both conversions
  (`locateAbsolute`/`toAbsoluteSec`), so either works if file durations are authoritative. Pick one in the
  sync ADR. The file-anchored form survives a file being replaced.
- **[Req]** A **client capture time** (`capturedAt`) stored and returned, for last-writer-wins across
  devices. The server must not replace it with receive time. Queued offline writes can be hours old.
- **[Req]** **Idempotent writes** (`operationId`), so WorkManager retries do not double-apply.
- **[Req]** Optimistic concurrency or an equivalent rule: a stale write must not overwrite a newer
  position from another device. BookOrbit uses `baseRevision` (409 → re-read; overwrite only if local is
  newer) and `manifestRevision` (412 → remap and retry once). **[Q]** Litara could instead do the
  timestamp comparison server-side (accept iff `capturedAt` > stored). This is simpler for third-party
  clients. Either matches the client's semantics.
- **[Req]** "No position" must be an explicit, well-formed response (BookOrbit's empty 200 forced a
  raw-body workaround). For example, `404` with a typed error, or `200 {"position": null}`.
- **[Req]** Clear permanent-vs-retryable status semantics. The client drops queued writes on 4xx except
  401/408/429 (`isPermanentRejection`). Using 400/404 for "will never succeed" and 409/412 for
  "re-read" matters.
- **[Req]** A "recently listened" query (Continue Listening) returning unfinished recordings with their
  last capture time, ordered by recency (`RestoreCandidateFinder` compares server and local recency).
  BookOrbit's scroller order "isn't a timestamp", which forced N extra position lookups.
- **[Obs]** "Finished" is client-defined as ≥ `ResumeCandidates.FINISHED_PERCENT`. **[Q]** Should
  finished/read status be server-authoritative per recording?

### 8. Reader position, annotations, bookmarks (non-audio)

- **[Req]** Position per **file**: `{cfi?, percentage, page?}` + a capture time. **[Obs]** The client today
  resolves "dirty local wins, else server" with no timestamp comparison, and the server GET returns `updatedAt`
  but the client ignores it. **[Rec]** Add `capturedAt` here too for parity with audio.
- **[Req]** Annotations: create returns a server id (the client uses negative placeholder ids until then).
  A PATCH must distinguish "absent" from `null` (clearing a note). Delete of a missing id → 404 (dropped).
  **[Q]** Annotations should be addressed per **file** (exact locations belong to files). Today the URL is
  per book with `bookFileId` in the body.
- **[Req]** Reading/listening sessions: idempotent by client `sessionId`.

### 9. Pagination, search, errors

- **[Req]** One pagination convention. Android copes with three today (0-based `page/size` in a body,
  0-based query, and 1-based `page/limit`). Totals must be present so Auto can compute page counts.
  The server may cap `size`, and must say so in the response (the client reads back `size`).
- **[Req]** Server-side search over title/author/**narrator** restricted to audio, for Auto voice search
  (`AutoSearch` → `queryBooks(..., q)`). Accent-insensitive matching is done client-side offline, and
  would be nice server-side.
- **[Req]** A filter "has audio" / "media type = audio" usable with pagination (Auto browse).
- **[Req]** Typed, machine-readable errors. Auto maps failures to sign-in / network / no-results /
  unavailable (`AutoFailure`).

### 10. Authentication

- **[Req]** Bearer access token + a refresh mechanism that tolerates concurrent 401s (single-flight on the
  client). Refresh failure ⇒ sign-out, and network failure ⇒ keep the session.
- **[Req]** A way to identify the server and API version without auth (`setup-status` today).
  **[Rec]** A versioned discovery endpoint (e.g. `GET /api` → `{apiVersion, serverId}`). A stable
  **server id** would let the client scope local data by server id instead of a URL hash (`DataScope`),
  which survives URL changes.
- **[Req]** For third-party clients: **no app-attestation gate** on routes that open clients need
  (BookOrbit 3.8 is why this app was abandoned: `docs/server-3.8-compatibility.md`). This is consistent
  with the accepted constraint of a documented API accessible to third-party clients.
- **[Q]** Is OIDC kept with a server-side code exchange (`state` minted by the server, the client sends
  `code`+`codeVerifier`)? Does the refresh token stay a cookie, or move to the response body for native
  clients?

### 11. Account isolation (client-side constraint on the API)

- **[Obs]** The client isolates local data per server URL, not per user. Audio/reader progress rows and
  downloads have no user column, so a second account on the same server shares them on that device
  (see `media-preservation-matrix.md` L6). Auto artwork, the Auto catalog cache and pending
  annotation/session queues **are** user-scoped.
- **[Req]** The API must return the authenticated user id (for client-side scoping) and must reject
  writes to resources the user cannot see (403, permanent) rather than silently accepting them.

## C. Minimum media contract for the first integration slice

This is what one Android/Go slice would need to play one multi-file audiobook end to end
(see `adaptation-plan.md` §3):

1. Login → bearer + refresh.
2. List/search audio recordings (paginated, with total).
3. Recording detail: ordered files `{id, mime/format, sizeBytes, durationMs}`, chapters
   `{title, startMs}` in recording time, title/authors/narrators/series, revision.
4. File content endpoint with byte-exact Range, identity encoding, bearer auth.
5. Cover/thumbnail image endpoint.
6. GET/PUT playback position `{fileId, offsetMs, capturedAt, operationId, recordingRevision}`, with
   newer-wins semantics, idempotency and an explicit "none".
7. Recently-listened list with last capture time.
