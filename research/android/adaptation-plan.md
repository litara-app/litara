# Adaptation plan: BookOrbit Android → Litara `apps/android/`

This is a proposal, not a decision. It sequences reviewable increments that keep Cast, Auto and offline
playback working at every step. It deliberately avoids choosing unresolved architecture: where an
increment depends on an ADR outcome, the dependency is named (§4).

Legend: **[Rec]** recommendation; **[Q]** decision needed; **Gate** = what must pass before merging.

## 0. Prerequisites (before any code enters the Litara repo)

| ID | Prerequisite | Owner | Evidence needed |
| --- | --- | --- | --- |
| P0 | `AGENTS.md`, `ADR/README.md`, accepted ADRs, `ADR/RESEARCH.md` and `archive/litara-v1/` were **not present** in `E:\Programming\ebooker` when this audit ran (the folder is not a git repo). Re-check this plan against the accepted ADRs once they are available. | ADR session | ADR list |
| P1 | Rights confirmation for Jared-authored files (`source-provenance.md` §7 step 1) | Project owner | Written statement |
| P2 | Per-line authorship report at `a55eaa1` (`git blame`), and a file classification | Engineer | `research/android/authorship.csv` |
| P3 | Relicensing replies from `sharkusmanch`, `6801318d8d`, `kkucherenkov` (or a decision to reimplement their parts) | Project owner | Recorded replies |
| P4 | Reader assets decision: pristine foliate-js (MIT) + a rewritten bridge, or determine that `bridge.js` is Litara-first-party (§3.2 of provenance) | Project owner + engineer | Decision note |

**[Rec]** Only P0 and P1 block the *first* increment if it imports only sole-owner files. P2–P4 block
the increments that touch mixed or third-party files.

## 1. Guiding constraints

1. Media behaviour stays green: the M1–M20 automated tests (`media-preservation-matrix.md`) run on every
   increment for both flavours, plus a hardware checklist at milestones.
2. Media3 stays at 1.5.1 until a dedicated upgrade increment (L9).
3. Swap the **data edge** behind interfaces first. Change the player/Cast/Auto internals last, or never.
4. Every imported file arrives with an SPDX header and an authorship classification. Nothing third-party
   arrives without a grant.
5. BookOrbit-compatibility code (legacy routes, manifest heuristic, attestation workarounds) is deleted, not
   ported. Litara has no compatibility requirement.

## 2. Increments

| # | Increment | Content | Depends on | Gate |
| --- | --- | --- | --- | --- |
| 1 | **Skeleton + CI** | `apps/android/` Gradle project (same AGP/Kotlin/Media3 versions), `full`/`fdroid` flavours, new `applicationId` and name, `THIRD_PARTY_NOTICES`, CI job mirroring `android-build.yml` (lint + JVM tests + assemble, both flavours), and an emulator job for instrumentation | P0, P1; ADR: app id/name, repo layout | Builds; empty test suite passes; fdroid dex has no `gms/cast` |
| 2 | **Pure media core** | Import sole-owner pure-Kotlin units with their tests (if P3 is pending, the sharkusmanch-touched `PlaybackQueue`/`ChapterClock` are excluded or reimplemented): `AudioMimeType`, `Mp4ChapterFilter`, `parseRangeHeader`, `CastQueueTransfer`, `AutoSearch.normalize`, `AutoLibraryTree`, `AutoBrowseTree` ids/grouping | P2 (+P3 for mixed files) | Imported JVM tests pass unchanged |
| 3 | **Backend port interfaces** | Introduce `MediaCatalog` (list/search/detail of recordings), `MediaStreams` (URL + auth for a file), `PlaybackPositions` (get/put/recent), `ArtworkSource` and `DownloadSource`. A **BookOrbit adapter** is *not* built. Instead a `FakeMediaBackend` (MockWebServer) implements the draft Litara contract (`backend-contract.md` §C) for tests | ADR: API resource names (can be provisional behind the interface) | Interface compiles; fake passes contract tests |
| 4 | **Player + session + Cast + Auto on the fake** | Import `PlaybackService`, `BookAggregatingPlayer`, `BookQueueCommand`, `MediaLibraryCallback`, `CastProxyServer`, `CastHandoff` flavours, `AutoCatalog`/`AutoLibraryRepository`/`AutoPlaybackResolver`/`AutoArtwork*`, `PlayerManager`, `PlayerRepository`, rewired to the port interfaces. Port the instrumentation tests (`AutoMediaSessionTest`, `CastQueueReplacementTest`, `CastBookPositionTest`, `ChapterSessionRefreshTest`, `CastProxyRangeTest`, `AutoArtworkProviderTest`) to fake-backend fixtures | Increments 2–3; P3 for mixed files | All 20 migrated instrumentation tests plus JVM tests green, both flavours. **Hardware checkpoint A**: Chromecast + DHU against the fake (or a dev Go server) |
| 5 | **Go slice: first end-to-end** (§3) | Android `LitaraApi` adapter implementing the port interfaces against the Go server. Auth + list + detail + stream + position | Go server slice; ADRs: auth, ids, position model | Contract tests (shared fixtures) pass against both fake and Go; manual play of a multi-file recording; Cast + Auto smoke |
| 6 | **Offline + sync** | Import `DownloadWorker`/`DownloadResume`/`LocalRef`/naming, Room schema v1 (fresh, **user-scoped**: fixes L6), `SyncWorker`, `QueuedWriteRejection`. Persist the recording snapshot for offline | P3 for sharkusmanch/6801318d8d parts; ADR: sync model | M9, M10, M16, M17 tests green on new schema; new test for per-user isolation; airplane-mode hardware check |
| 7 | **Auth hardening** | OIDC (if adopted), user-CA trust, secure-storage recovery | ADR: auth/OIDC | `UserCaTrustTest`, `SecureStorageRecoveryTest` |
| 8 | **Reader** | Pristine foliate-js vendored with notice; new bridge; file-scoped positions/annotations; PDF reader import (if sole-owner) | P4; ADRs: editions/files, annotations | Reader tests; CFI round-trip with web client |
| 9 | **Catalog UI** | Rebuild library/title/edition browsing against the Litara model. Drop Book Dock, smart scopes, dashboard widgets unless ADRs adopt equivalents | ADRs: catalog, permissions | UI tests |
| 10 | **Media3 upgrade** (optional) | Bump Media3; re-evaluate the `BookQueueCommand` and source-queue workarounds | All above | M5–M7 + **hardware checkpoint B** |

Each increment is a separate reviewable PR. Increments 2–4 can be reviewed without any Go code.

## 3. First end-to-end Android/Go integration slice

**Goal:** a signed-in user plays one multi-file audiobook recording from a Go server on phone, Chromecast and
Android Auto, and resumes it on a second device, using the existing media stack unchanged above the
port interfaces.

Scope (Go side, minimum; names provisional):
1. Login → bearer access + refresh.
2. `GET` recordings list (audio only, paginated with total; `q` search over title/author/narrator).
3. `GET` recording detail: ordered files `{id, mime, sizeBytes, durationMs}`, chapters `{title, startMs}`
   (recording time), title/authors/narrators/series, `revision`.
4. `GET` file content with byte-exact single Range, identity encoding, bearer auth; HEAD supported.
5. `GET` recording artwork (thumbnail + full).
6. `GET`/`PUT` playback position `{fileId, offsetMs, capturedAt, operationId, recordingRevision}`;
   newer-`capturedAt` wins; idempotent `operationId`; explicit "none".
7. `GET` recently listened (unfinished, ordered by last `capturedAt`).

Android side: `LitaraApi` adapter + DTOs for exactly those calls. Everything else stays on the fake.

Acceptance (measurable):
- Contract test suite (shared JSON fixtures + Range cases: `bytes=0-`, `bytes=a-b`, `bytes=-8`, offset
  > 4 GiB on a sparse file, unsatisfiable → 416) passes against the Go server.
- `AutoMediaSessionTest`-equivalent passes against a Go test server in CI (emulator).
- Manual, recorded: Chromecast playback of a ≥ 3-file MP3 recording and a > 1 GB M4B with a chapter track,
  handoff both directions, queue replacement. DHU cold start + voice play. Device B resumes within 5 s of
  device A's last report.

## 4. Decisions still needed from the ADR discussion (proposed questions)

1. **Playable unit & ids.** Is the Android/Auto playable unit the *recording* (edition) or the *title*?
   Which id appears in media ids and positions? Are ids opaque strings? (`backend-contract.md` B.1)
2. **Position model.** Is the position stored as (file id, offset) or as a recording-time offset? Is concurrency
   handled by server-side `capturedAt` comparison or by revision/409? Is there a recording revision/412
   equivalent for file-set changes? (B.7)
3. **Chapters.** Are chapters recording-scoped, in recording time, and authoritative over embedded
   container chapters? (B.3)
4. **Media auth.** Bearer on media GETs, or short-lived signed URLs? Either works through the Cast proxy.
   Signed URLs must still honour Range and identity encoding. (B.4)
5. **Refresh transport for native clients.** HTTP-only cookie (current) or a body token with rotation? (B.10)
6. **Discovery/version endpoint and server id** for client-side data scoping. (B.10)
7. **Pagination convention** (one, with totals and declared caps). (B.9)
8. **Offline snapshot** document for a downloaded recording: shape and versioning. (B.6)
9. **Annotation/bookmark addressing** per file (vs per title) under "exact locations belong to files". (B.8)
10. **Finished/read state** per recording vs per title; who decides "finished". (B.7)
11. **Third-party access policy:** confirm no attestation or client-allowlist gate on the documented API. (B.10)
12. **Android identity:** `applicationId`, app name, OIDC redirect scheme, flavour policy (keep a Cast-free
    F-Droid flavour?).
13. **Licensing intake policy:** SPDX headers, `THIRD_PARTY_NOTICES`, and the bar for importing
    contributor code (written grant vs reimplementation).

## 5. Smallest useful next task

**Task:** *Produce the authorship classification for `bookorbit-android@a55eaa1`*. This is a read-only script
plus a committed CSV under `research/android/`. It classifies every source and asset file as
`sole-owner` / `mixed` / `third-party` / `generated-or-bot`, using `git blame -w -M -C --line-porcelain`
surviving-line counts per author, plus a manual override list for known external origins (Foliate assets,
`bridge.js`, Book Drop port).

Why first: it is the gate for every import (P2), needs no ADR decisions, and turns the provenance findings
into a mechanical, reviewable list. It touches no app code.

Prerequisites: the reference clone at `E:\Programming\_reference\bookorbit-android` (exists); git; the
override list from `source-provenance.md` §3–§4.

Acceptance criteria:
- 100% of tracked files under `app/`, `docs/`, `store-assets/`, `fastlane/`, `website/` appear exactly once in
  `research/android/authorship.csv` with columns `path, total_lines, lines_by_author…, class, override_reason`.
- Every file containing any surviving line by `sharkusmanch`, `6801318d8d` or `kkucherenkov` is classed
  `mixed` or `third-party`.
- All `app/src/main/assets/reader/**` files are classed `third-party` (override), with an origin noted.
- The script is committed beside the CSV and reproduces the CSV byte-for-byte when re-run at `a55eaa1`.
- The summary counts (files and lines per class) are added to `README.md`.

The next task after that is Increment 1 (skeleton + CI), once P0/P1 are satisfied.
