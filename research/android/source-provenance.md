# Source provenance and licensing audit

Revision: `deranjer/bookorbit-android@a55eaa13d8ba27cd143dda882836ed35a4dc923f` (HEAD of `main`
on 2026-11-12; no commits after the inspected baseline). Upstream comparisons were made on
2026-11-12 against `johnfactotum/foliate-js` (clone at `E:\Programming\_reference\foliate-js`),
`bookorbit/bookorbit`, `booklore-app/booklore` and `grimmory-tools/grimmory` (individual files fetched
through the GitHub API into `E:\Programming\_reference\upstream-assets\`).

> This is an engineering evidence record, not legal advice. It identifies what needs a rights
> decision. It does not make one.

Legend: **[Obs]** evidence; **[Rec]** recommendation; **[Q]** unresolved.

## 1. Repository-level facts

| Fact | Evidence |
| --- | --- |
| Declared licence | `LICENSE` = GNU AGPL v3 full text. GitHub reports `AGPL-3.0` for the repo. No SPDX headers, `NOTICE`, `THIRD_PARTY` or `CONTRIBUTING`/CLA/DCO file exists. |
| Status | README: "No longer maintained" because BookOrbit server 3.8 added Android key attestation that accepts only the official `app.bookorbit.reader` package (`docs/server-3.8-compatibility.md`). The repository is not archived. |
| History | 231 commits, from 2026-06-18 (`0e4efa5 feat(mobile): add native Kotlin Android client`) to 2026-11-11. The first commit added 149 files at once, extracted from a pnpm monorepo ("isolated from the pnpm workspace", README "Cross-repo couplings"). `a2d2e70 chore: adapt project for standalone repository`. `1b2fa9b feat(bookdrop): port Book Drop inbox feature from bookorbit monorepo` (from branch `BO-mobile-book-drop`). |
| Contributors | Jared Swets 184 commits; `sharkusmanch` 18; `6801318d8d` 3; Kirill Kucherenkov (`kkucherenkov`) 1; github-actions bots 25 (release-please changelog/version bumps only). |
| AI co-authorship | 90 of 206 human commits carry `Co-Authored-By: Claude …` trailers. **[Q]** Counsel should confirm that this does not change ownership analysis for Jared's commits. It is noted, not assessed. |
| Upstream relationship | `bookorbit/bookorbit` (AGPL-3.0, created 2026-05-09, not a fork). `deranjer` has **no** commits in `bookorbit/bookorbit` (GitHub commit search, 2026-11-12), so BookOrbit-origin code in this repo is third-party to Jared. |

## 2. Contributor inventory (third-party code inside the app)

| Contributor | Commits / route | Files touched (main) | Δ lines | Area |
| --- | --- | --- | --- | --- |
| `sharkusmanch` | 18 commits on 2026-09-28, merged via `deranjer` PR #48 ("combine dashboard, player, and download fixes") | `BookAggregatingPlayer.kt`, `ChapterClock.kt`, `PlaybackQueue.kt`, `PlayerManager.kt`, `PlaybackService.kt`, `PlayerRepository.kt`, `MediaLibraryCallback.kt`, `AutoBrowseTree.kt`, `AudioProgressRepository.kt`, `AudioSettings.kt`, `LivePlaybackPrefs.kt`, `RestoreCandidateFinder.kt`, `ResumeCandidates.kt`, `ChapterListSheet.kt`, `DownloadWorker.kt`, `DownloadResume.kt`, `DownloadNotifications.kt`, Settings UI, plus tests incl. `ChapterSessionRefreshTest`, `ChapterClockTest`, `DownloadResumeTest`, `RestoreCandidateFinderTest` | +1842 / −264 | **Player core, chapter-relative session, Auto chapters, launch restore, resumable downloads** |
| `6801318d8d` | PRs #95–#97 (2026-11-07) | `BookOrbitDatabase.kt` (MIGRATION_7_8), `PendingAnnotationOpEntity.kt`, `PendingReadingSessionEntity.kt`, `DatabaseModule.kt`, `QueuedWriteRejection.kt`, `SyncWorker.kt`, `AuthRepository.kt`, `ReaderAnnotationRepository.kt`, `ReadingSessionTracker.kt` + tests | +649 / −95 | Offline sync queue, account-owned pending writes |
| `kkucherenkov` | PR #92 (2026-10-30) | `assets/reader/index.html` (groupBy polyfill) | +16 | Reader shim |

**[Obs]** No CLA or DCO exists. Inbound contributions therefore arrived under the repository's
AGPL-3.0 (inbound = outbound). **[Obs]** The `sharkusmanch` work sits in exactly the files Litara most wants to keep
(`BookAggregatingPlayer`, `ChapterClock`, `PlaybackQueue`, `DownloadResume`). Later commits by
Jared modified the same files, so the contributions cannot be cleanly separated by file.

## 3. Asset provenance: reader (`app/src/main/assets/reader/`)

README §"Cross-repo couplings" states the folder is "a verbatim copy of the web client's foliate.js build
(`client/public/assets/foliate/` in the server repo) plus `bridge.js`, `index.html`".

### 3.1 Foliate files

Method: each local file was normalised (semicolons, quote style and whitespace removed) and compared with
every upstream foliate-js revision of the same path. Identifiers present locally but absent from **all**
upstream revisions were then listed. Raw byte comparison was also done against current
`bookorbit/bookorbit`, `booklore-app/booklore` and `grimmory-tools/grimmory` copies.

| File | Closest foliate-js rev | Normalised diff lines / file lines | Identifiers absent from all foliate-js revisions | Assessment |
| --- | --- | --- | --- | --- |
| `text-walker.js` | 5ba02c7 (2026-04-09) | 10 / 37 | none | Reformatted foliate-js (MIT) |
| `progress.js` | 2a6012d | 24 / 99 | none | Reformatted foliate-js |
| `comic-book.js`, `overlayer.js`, `search.js`, `dict.js`, `tts.js`, `fixed-layout.js` | various 2023–2025 | 28–91 | none | Reformatted foliate-js, possibly older revisions |
| `mobi.js`, `fb2.js`, `epubcfi.js` | 6b11e17 / d4696ce / 34b9079 | 128–404 | none | Reformatted foliate-js |
| `epub.js` | bdae473 (2025-08-02) | 538 / 1022 | `getDirectUrl`, `shouldUseDirectUrl`, `replaceWithDirectUrl`, lazy font/image streaming | **Modified**. Streaming/direct-URL additions not in foliate-js |
| `paginator.js` | 9fd2209 | 318 / 1027 | continuous-scroll/autoAdvance guards | **Modified** |
| `view.js` | 916dfb1 | 511 / 807 | `makeStreamingBook`, `getKoreaderProgress`, `getKoreaderDocFragmentIndex`, `getKoboSpanValue`, kepubify helpers, XPath helpers; a comment mentions "Angular" | **Substantially modified** |
| `streaming-loader.js` | not in foliate-js | n/a | the whole file (`makeStreamingLoader`) | **Not foliate-js.** Present in BookOrbit (`client/public/assets/foliate/streaming-loader.js`, added `cb39364`, 2025-12-26, author "neon") and in Booklore/Grimmory (`booklore-ui/src/assets/foliate/streaming-loader.js`) |
| `vendor/fflate.js` | — | minified | — | fflate (MIT, 101arrowz). No licence header retained |
| `vendor/zip.js` | — | minified | — | zip.js (BSD-3-Clause, Gildas Lormeau). No licence header retained |

Byte-level `diff -w` line counts of the four modified files against current upstream copies (smaller means
closer):

| File | bookorbit/bookorbit | booklore | grimmory |
| --- | --- | --- | --- |
| `streaming-loader.js` | **28** | 70 | 70 |
| `view.js` | **208** | 487 | 487 |
| `epub.js` | **115** | 511 | 471 |
| `paginator.js` | **112** | 331 | 351 |

**[Obs]** The Android copy is closest to BookOrbit's (an earlier BookOrbit revision). BookOrbit's copy in turn
shares Booklore-lineage additions (streaming loader, KOReader progress). BookOrbit, Booklore and
Grimmory are all **AGPL-3.0**. `view.js` history in BookOrbit shows KOReader/Kobo sync work by
"neon" (`913dab0`, `e253f7f`, `80244ea`). **[Q]** Who first wrote `streaming-loader.js` and the
`view.js` streaming hooks, Booklore or BookOrbit, was not established. Both are AGPL either way.
**[Obs]** No foliate-js MIT copyright/permission notice is shipped in the Android repo. MIT requires
the notice to be retained, so even the pure foliate-js files are currently out of compliance as
distributed.

### 3.2 `bridge.js` and `index.html`

- **[Obs]** `bridge.js` header: "This is the Android analog of the web client's `useFoliate.ts` + `useReaderState.ts`". It also says
  "Ported verbatim from `client/src/features/reader/epub/constants/themes.ts`" (`THEMES`, line 38),
  "Ported from `useReaderState.generateCSS`" (line 74), "Ported from `useReaderState.applyToRenderer`"
  (line 111), and "Highlight drawing mirrors `client/src/features/reader/epub/composables/useFoliateAnnotations.ts`"
  (line 139). Those paths exist in `bookorbit/bookorbit` (themes.ts fetched, 2,836 bytes).
- **[Obs]** `bridge.js` posts to `window.ReactNativeWebView.postMessage`, and `index.html` says "bridge.js (kept verbatim)".
  This shows `bridge.js` was first written for a React Native WebView host. **[Q]** That host was not found in
  `bookorbit/bookorbit` (`mobile/`, `apps/mobile/`, `android/` are 404, and code search finds no
  `ReactNativeWebView`). It may be Litara's own former Expo app (`E:\Programming\ebooker\scripts\run-android.ps1`
  references `apps/mobile` + `expo run:android`) or an unpublished BookOrbit branch. Because
  `archive/litara-v1/` was not present in this checkout, this could not be checked. **This decides whether
  `bridge.js` is first-party.**
- **[Obs]** `index.html`: the WebView shim is Jared's, and the `Object.groupBy`/`Map.groupBy` polyfill is from `kkucherenkov` (PR #92).

### 3.3 Kotlin derived from BookOrbit client/server

- **[Obs]** `core/model/*`: hand-written DTOs mirroring BookOrbit server types (`BookDock.kt` cites
  `server/src/modules/book-dock`). `ReadStatusMeta.kt`: "Order/labels mirror the web client's
  STATUS_OPTIONS". `ReaderThemes.kt` duplicates the theme swatches.
- **[Obs]** `feature/bookdrop/*` was "ported" from a BookOrbit-monorepo branch (`1b2fa9b`). Whether that branch
  held only Jared-authored Kotlin is **[Q]**. The commit message describes it as a native Kotlin screen built
  before extraction, which suggests it is Jared-authored.
- **[Rec]** Treat interface-compatibility facts (endpoint paths, field names) as low copyright risk. They
  are being replaced anyway, so drop them rather than relicense them.

## 4. Player, Cast and Auto code

| Component | Origin evidence | Third-party input |
| --- | --- | --- |
| `CastProxyServer.kt`, `Mp4ChapterFilter.kt`, `CastQueueTransfer.kt`, `BookQueueCommand.kt`, `full/.../cast/*`, `fdroid/.../cast/*` | Introduced by Jared (`ce5790a feat(player): add Chromecast support`, later Cast fixes PR #84–86, #111). No external headers. Design notes in `docs/testing/cast-handoff.md` cite FFmpeg behaviour as **reference only** (no code). | `sharkusmanch` touched `PlaybackService.kt`, `PlayerManager.kt`, `BookAggregatingPlayer.kt` (cast/skip neutrality, `cb41080`) |
| `ChapterClock.kt` (+ `ChapterClockTest.kt`) | **Sole author `sharkusmanch`** (`git log --follow`: 1 commit, `8aba55f`) | **Entirely third-party** |
| `BookAggregatingPlayer.kt`, `PlaybackQueue.kt`, `LivePlaybackPrefs.kt` | Mixed: Jared + `sharkusmanch` (PlaybackQueue 2+2 commits; chapter normalisation `efb9244`, session chapter progress `1ab945f`) | **Yes, substantial** |
| `MediaLibraryCallback.kt`, `AutoBrowseTree.kt` | Jared, with Auto chapters from `sharkusmanch` (`e03232c`) | Yes |
| `AutoCatalog`, `AutoLibraryRepository`, `AutoLibraryTree`, `AutoSearch`, `AutoPlaybackResolver`, `AutoArtwork*`, `AutoFailure` | Jared only (per `git log --author`) | No |
| `AudioProgressRepository.kt` | Jared + `sharkusmanch` | Yes |
| `RestoreCandidateFinder.kt`, `ResumeCandidates.kt` | `sharkusmanch` (`861d05f`, `7263fc7`) + later Jared | Yes |
| `DownloadWorker.kt`, `DownloadResume.kt`, `DownloadNotifications.kt` | Jared + `sharkusmanch` (`f8c9585`) | Yes |
| Sync queue (`SyncWorker`, `QueuedWriteRejection`, pending entities, `ReaderAnnotationRepository`, `ReadingSessionTracker`) | Jared + `6801318d8d` | Yes |

**[Obs]** No code in player/Cast/Auto appears to be copied from Google samples (UAMP etc.) or other
projects: no foreign licence headers, package names or comment fingerprints were found. The search covered "ported", "copied
from", "adapted from", "verbatim", "mirrors", and upstream path strings. This is absence of evidence, not proof.

## 5. Dependencies

| Dependency | Licence | Flavour | Note |
| --- | --- | --- | --- |
| AndroidX (core, lifecycle, activity, compose, navigation, room, datastore, work, paging, webkit, security-crypto, documentfile, appcompat, mediarouter), Media3 (exoplayer, session, datasource-okhttp, common, cast) | Apache-2.0 | both (`media3-cast`, `mediarouter` full only) | MIT-compatible |
| Hilt/Dagger, Retrofit, OkHttp, kotlinx.serialization/coroutines, Coil, AppAuth-Android, Guava (transitive) | Apache-2.0 | both | MIT-compatible |
| `com.google.android.gms:play-services-cast-framework` 21.5.0 | Proprietary (Android SDK terms) | **full only** | Not redistributable as source. Fine as a binary dependency. Verified absent from fdroid APKs (see `baseline-verification.md`). |
| JUnit 4.13.2 (EPL-1.0), MockK, Turbine, MockWebServer, Espresso | test only | — | Not shipped |
| Gradle Play Publisher | build tool | — | Only active with `app/play-service-account.json` |

**[Obs]** No dependency forces AGPL. AGPL is a choice of this repository, so MIT reuse is limited by
**authorship**, not by dependencies.

## 6. Classification

### 6.1 Evidence supporting potential MIT reuse (subject to the owner's own grant)

- Files whose entire `git log --follow` history is Jared Swets (plus bots). Examples: `CastProxyServer.kt`,
  `Mp4ChapterFilter.kt`, `CastQueueTransfer.kt`, `BookQueueCommand.kt`, the Cast flavour files,
  `AutoCatalog.kt`, `AutoLibraryRepository.kt`, `AutoLibraryTree.kt`, `AutoSearch.kt`,
  `AutoPlaybackResolver.kt`, `AutoArtwork.kt`, `AutoArtworkProvider.kt`, `AutoFailure.kt`,
  `AudioMimeType.kt`, `core/network/*` (except DTO mirroring), `core/auth/*`, `UserCaTrust*`, and their
  tests. **[Rec]** Before import, regenerate this list mechanically (§7) rather than trusting this table.
- **[Q]** Is the Litara project owner the same person as the repository owner and sole copyright
  holder for those files (no employer/IP-assignment claim)? Repository control alone does not
  establish this. The project owner must confirm it in writing.
- foliate-js core files: MIT. Reusable with the notice restored, **but only from upstream foliate-js**,
  not from the BookOrbit-modified copies.
- fflate (MIT) and zip.js (BSD-3-Clause): reusable with notices, from upstream releases.

### 6.2 Material needing permission or replacement

| Material | Holder(s) | Options |
| --- | --- | --- |
| `sharkusmanch` portions of player/chapter/restore/download files | `sharkusmanch` | (a) written relicensing permission (MIT), or (b) clean reimplementation from behaviour specs and tests by someone who has not copied the code. The tests themselves are also partly theirs. |
| `6801318d8d` portions of sync queue | `6801318d8d` | Same |
| `kkucherenkov` polyfill (16 lines) | `kkucherenkov` | Permission, or rewrite (trivial, standard pattern) |
| BookOrbit-modified Foliate (`epub.js`, `view.js`, `paginator.js` modifications, `streaming-loader.js`) | BookOrbit contributors (AGPL-3.0), and possibly Booklore contributors | **Replace**: vendor pristine foliate-js at a pinned commit. Note the Android host does not use the streaming loader, because it feeds whole files via the bridge. |
| `bridge.js` portions ported from BookOrbit (`THEMES`, `generateCSS`, `applyToRenderer`, annotation drawing) | BookOrbit contributors (AGPL-3.0), unless §3.2 shows otherwise | Rewrite against a Litara-owned theme/CSS spec |
| BookOrbit names/branding (`BookOrbit*` classes, `ic_orbit`, store assets, fastlane metadata, `bookorbit://`, `com.bookorbit`) | BookOrbit project identity | Replace regardless of copyright |

### 6.3 Unresolved ownership

1. Origin of the React Native `bridge.js` (§3.2): Litara/Expo (first-party?) or BookOrbit?
2. Original author of `streaming-loader.js` / `view.js` streaming + KOReader hooks (BookOrbit vs Booklore). Moot if replaced.
3. Exact share of `sharkusmanch` lines that survive at HEAD (`git blame` per file is needed; this
   audit counted commits and diffstats, not surviving lines).
4. Whether the Book Drop branch code ported in `1b2fa9b` had any non-Jared authors.
5. Copyright position of AI-co-authored commits (§1).

## 7. Recommended procedure before any import (no code moved yet)

1. **[Rec]** The project owner confirms in writing that they are Jared Swets / the copyright holder of the
   Jared-authored commits, and that no third party (employer) holds rights.
2. **[Rec]** Generate a per-file, per-line authorship report at `a55eaa1`:
   `git blame -w -M -C --line-porcelain <file> | grep '^author-mail'`. Save it under
   `research/android/` as data, and classify each file as *sole-owner*, *mixed*, or *third-party*.
3. **[Rec]** Contact `sharkusmanch`, `6801318d8d` and `kkucherenkov` for written MIT relicensing permission
   for their contributions. Record the replies. Until then, treat their lines as AGPL.
4. **[Rec]** Replace `assets/reader/foliate/**` with pristine upstream foliate-js (MIT) at a recorded
   commit, with its `LICENSE` retained. Add fflate/zip.js notices. Rewrite `bridge.js` from a written
   behaviour spec unless (§3.2) it is shown to be first-party.
5. **[Rec]** Import into `apps/android/` only files classified *sole-owner* or *permission granted*.
   Add SPDX headers and a `THIRD_PARTY_NOTICES` file at import time.
