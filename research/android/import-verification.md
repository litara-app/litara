# Android baseline import verification

Date: 2026-11-12. Task: import `deranjer/bookorbit-android@a55eaa13d8ba27cd143dda882836ed35a4dc923f`
into `apps/android/` as a reproducible AGPL baseline. The import itself made **no** backend connection,
architectural decision, dependency upgrade or release action. ADRs were not edited. Sections written
before the rename describe the pre-rename state; the user later authorized a mechanical identity
rename (`com.litara`), and the final state is described under "Identity". Import commit: 92ca5e3c1a8cc70f15532faa9513b9b0cff2bc36 (gradlew mode 100755). The hash is recorded in a follow-up
commit, so it is not part of the commit it names.

Legend: **PASS** = ran and passed here. **NOT RUN** = unavailable or out of scope, stated explicitly.

## 1. Where the work lives

| Item | Value |
| --- | --- |
| Repository | `G:\Programming\ebooker` (the active repo; `E:\Programming\ebooker` is a separate, non-Git folder and was not used) |
| Worktree / branch | `G:\Programming\ebooker-android-import`, orphan branch `android/import-baseline` |
| State | Files are **uncommitted** in that worktree (nothing was committed or pushed) |
| Why an orphan branch | The main worktree on `js/mobile-apksigner-glob` has ~850 uncommitted entries (old tree deleted; `ADR/`, `AGENTS.md`, `research/` untracked). A worktree cut from `HEAD` would carry the old BookOrbit tree and none of the ADRs. An orphan branch holds only this increment and cannot disturb that state. Integrating it is a separate step. |
| Source clone | `E:\Programming\_reference\bookorbit-android`, `git rev-parse HEAD` = `a55eaa13d8ba27cd143dda882836ed35a4dc923f`, `git status` clean. Revision verified before use. |

## 2. Environment

| Item | Value |
| --- | --- |
| OS / shell | Windows 11 Pro 10.0.26300, Git Bash |
| JDK | JetBrains Runtime 21 (`E:\Android Studio\jbr`). CI uses Temurin 21. System default (Temurin 25) not used. |
| Gradle / AGP / Kotlin | 8.11.1 (wrapper) / 8.9.1 / 2.0.21, unchanged |
| Android SDK | `ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk` (env var only; no `local.properties` created) |
| Emulator | AVD `Pixel_Tablet` (`android-36 google_apis_playstore_tablet x86_64`, Android 16), started `-read-only -no-snapshot-save -no-window -no-audio -port 5580`, then killed. Every run pinned with `ANDROID_SERIAL=emulator-5580`. |
| Not touched | A pre-existing emulator `emulator-5554` was running; it was **not** used because `connected*AndroidTest` uninstalls the app. |
| Signing | None. Debug builds use AGP's auto-generated debug key. No release/publishing credential was read, created or required. |

## 3. Commands and results

Run from `apps/android/` with `JAVA_HOME`/`ANDROID_HOME` set.

| # | Command | Result |
| --- | --- | --- |
| 1 | `./gradlew --continue :app:lintFullDebug :app:lintFdroidDebug :app:testFullDebugUnitTest :app:testFdroidDebugUnitTest :app:assembleFullDebug :app:assembleFdroidDebug` | **PASS**. The first run reused the Gradle build cache from the earlier audit (70 of 119 tasks from cache), so it was repeated uncached (#2). |
| 2 | Same tasks plus `:app:assembleFullDebugAndroidTest :app:assembleFdroidDebugAndroidTest`, with `--no-build-cache --rerun-tasks` | **PASS**, 179 of 179 tasks executed, 2 m 26 s |
| 3 | JVM unit tests (from the XML results of #2) | **PASS** full: 52 classes, 335 tests, 0 failures/errors/skipped. fdroid: 52 classes, 335 tests, 0 failures/errors/skipped. Test sources unmodified; no assertion weakened. |
| 4 | Lint (from the XML results of #2) | **PASS**, 0 errors, 147 warnings per flavor, identical to the audit: GradleDependency 114, UseKtx 12, UnusedResources 8, AndroidGradlePluginVersion 3, DefaultLocale 2, PrivateResource 2, ObsoleteSdkInt 2, PluralsCandidate 1, CustomX509TrustManager 1, ExportedService 1, InsecureBaseConfiguration 1. No lint baseline was added. |
| 5 | Debug APKs | `app-full-debug.apk` 28,744,944 B; `app-fdroid-debug.apk` 26,698,473 B (androidTest APKs 1,152,263 B full / 1,152,271 B fdroid) |
| 6 | `ANDROID_SERIAL=emulator-5580 ./gradlew :app:connectedFullDebugAndroidTest :app:connectedFdroidDebugAndroidTest --no-build-cache` | **PASS**, 20/20 per flavor, 0 failed/skipped (1 m 2 s). Classes: `SecureStorageRecoveryTest` 3, `UserCaTrustTest` 4, `CastProxyRangeTest` 3, `AutoArtworkProviderTest` 3, `AutoMediaSessionTest` 1, `CastBookPositionTest` 1, `CastQueueReplacementTest` 1, `ChapterSessionRefreshTest` 1, `SettingsRowLayoutTest` 3. |
| 7 | `./gradlew :app:dependencies --configuration <c>` for `{full,fdroid}{Debug,Release}RuntimeClasspath` | full: `play-services-cast-framework` 21.5.0 plus `play-services-cast/-base/-basement/-tasks`, `media3-cast` 1.5.1, `mediarouter` 1.7.0 (15 `com.google.android.gms` lines). fdroid (debug and release): **0** `com.google.android.gms`, `play-services`, `media3-cast` or `mediarouter` lines. |
| 8 | Dex scan `unzip -p <apk> 'classes*.dex' \| grep -a -c 'Lcom/google/android/gms/cast'` | full debug: 9 matching chunks. **fdroid debug: 0.** (Release APKs were not built in this increment.) |
| 9 | Notices packaged | `assets/licenses/{foliate-js,fflate,zip.js}.LICENSE.txt` are present in **both** debug APKs (`unzip -l`). |
| 10 | Import fidelity: `diff -r` vs the reference clone, excluding the documented exclusions | Differences are exactly: the six Litara docs, `app/src/main/assets/licenses/`, the extended `.gitignore`, and the removed `app/upload_certificate.pem`. |
| 11 | Hygiene: `git add -A -n` listing, `find -name .git`, `git status --ignored` | 352 files staged-able; no `.jks/.keystore/.pem/.p12/.apk/.aab/.log`, `local.properties`, `keystore.properties`, `build/`, `.gradle/` or `.kotlin/`; no nested `.git`. Build outputs show as ignored. |
| 12 | CI step logic simulated locally against the dependency dumps | fdroid debug/release classpaths clean; full contains Cast (sanity check passes). The workflow YAML parses. |

Emulator observation: `com.bookorbit.debug` (the old identifier) was already listed on the fresh read-only AVD
before the run. The AVD ran read-only and was killed, so the run did not persist anything. The
instrumentation tests passed regardless. Pass/fail does not depend on it.

## 4. Exclusions

See `apps/android/UPSTREAM.md` for the full table: nested `.git`; all five upstream workflows; release-please files;
`app/upload_certificate.pem` (Play upload *public* certificate); `website/`; `fastlane/` and `store-assets/`;
build outputs, caches, IDE and SDK files (never tracked). No credentials were present in the tracked
upstream tree (search for private keys and tokens found none); keystore/Play-service-account paths remain git-ignored
and the build still tolerates their absence.

## 5. Known gaps and non-claims

- **Hardware not verified.** No physical device, real Chromecast or Android Auto head unit/DHU was used.
  The Cast instrumentation tests exercise the phone proxy, fake players and queue logic (they also pass
  on `fdroid`); they are not a Cast SDK session. Voice, projected Auto UI, steering-wheel and head-unit
  artwork remain manual (`apps/android/docs/testing/`). Cast and Auto behavior is claimed preserved
  by code (no source file edited) and emulator tests only.
- **Emulator caveat:** one emulator image (Android 16 tablet). Automotive AVD and Android 17 not run.
- **Not run:** release builds (`assemble*Release`, R8), signed release/AAB, Play/F-Droid publication, any
  test against a live server (including BookOrbit or Litara). F-Droid eligibility is not established.
- **CI workflow not executed on GitHub.** It was validated by YAML parse and by running its commands locally.
  It does not run the emulator suite (an emulator job would need a pinned third-party action).
- **Gradle cache note:** the audit's earlier run shared this machine's Gradle build cache; verification
  #2 and #6 bypassed it. The `~/.gradle` dependency cache was warm, so network availability of
  dependencies from a cold cache was not re-proven here.
- **Licensing:** notices inventory is evidence-based, not legal advice. Bundled fflate/zip.js versions and
  foliate-js revisions are unidentified (minified, no headers); license texts come from current upstream
  files (foliate-js commit `78914ae`; fflate and zip.js `master`). No machine-generated transitive license report
  was produced. No SPDX headers were added. The authorship CSV was not produced (optional).
- **Root documents untouched.** The main worktree's `.gitignore`, `README.md` and `.github/workflows/adr.yml`
  are not modified. Android ignore rules are in `apps/android/.gitignore`. The root README must not call
  the whole monorepo uniformly MIT; that edit is left to the owner of those uncommitted files.

## 6. Defect not resolved by passing tests (audit L6)

Local downloads (`downloads`), audio progress (`audio_progress`) and reader progress (`reader_progress`) are
partitioned per **server** (one Room file per server URL) and carry no user column; two accounts on one
server share them, and `SyncWorker` can upload account A's dirty position while signed in as B. The 335
unit and 20 instrumentation tests above pass with this defect present. Details and the required fix are in
`apps/android/ADAPTATION.md` §3. It must be fixed during adaptation, with a regression test written to
fail on this baseline first.

## 7. Adaptation entry points

Full list in `apps/android/ADAPTATION.md`. The Litara API adapter replaces: `core/network/ApiService.kt` and
`Interceptors.kt` (base URL and routes); `core/model/*` DTOs; `AudiobookAssetResolver`/`AudiobookAssets.match`;
`SessionManager`/`TokenRefresher`/`PersistentCookieJar`/`OidcManager` (auth, cookie refresh); `PlayerRepository`,
`AudioProgressRepository`, `RestoreCandidateFinder` (playback data edge); `AutoLibraryRepository`/`AutoArtwork`
(Auto data sources); `DownloadWorker`/`DownloadsRepository`; `SyncWorker` and the Room entities. Media logic
(`BookAggregatingPlayer`, `ChapterClock`, `PlaybackQueue`, `CastProxyServer`, `Mp4ChapterFilter`,
`CastQueueTransfer`, flavor `feature/cast` sources, Auto browse tree) is to be preserved.

ADR-driven changes (stable file identities/versions, revision-aware progress, native refresh tokens,
recording-level playback, account-isolated local data) are listed in `ADAPTATION.md` §2 and are **not**
implemented.

## 8. Identity update (applied after the sections above were first verified)

The repository owner then selected: `applicationId`/package `com.litara`, OIDC redirect `litara://oauth2-callback`,
a full identifier/name rename, and to keep signing and Play wiring inert. A mechanical rename was applied to
`apps/android/` (details and exclusions in `apps/android/UPSTREAM.md`, "Identity"). No dependency, version,
logic or test assertion changed; sources moved `com/bookorbit` to `com/litara` and `BookOrbit*` identifiers
became `Litara*`. ADRs were not edited, so ADR-0023's open questions still read as open; the ADR owner should record these choices.

Re-verification after the rename (all uncached, `--rerun-tasks`/`--no-build-cache`):

| Check | Result |
| --- | --- |
| lint, unit tests, debug assembly, androidTest assembly, both flavors (`gradle-rename2`, 2 m 31 s) | **PASS**. 335 unit tests per flavor, 0 failures/skipped; lint 0 errors, 147 warnings per flavor (unchanged). |
| Built APK metadata (`aapt2`) | package `com.litara.debug`, label `Litara Debug`; merged manifest contains intent-filter scheme `litara` |
| Instrumentation on a fresh disposable Pixel_Tablet emulator (Android 16, port 5580) | **PASS**, 20/20 per flavor |
| Hygiene | 351 files staged-able; no keystores, certs, APKs, logs, `local.properties` or build dirs |

Mistake caught during the rename: a first pass excluded every directory named `reader` and therefore missed
`feature/reader/` sources; the first rebuild failed in KSP and was fixed before the passing runs above.
Sections 3 and 5 above describe the pre-rename run; the numbers did not change.

Still unresolved: launcher/brand artwork (`ic_orbit`, BookOrbit's mark), `versionCode 900`/`versionName 0.9.0`,
real signing and publishing, upgrade strategy (the app is now a different identity from the BookOrbit app, with no
shared data), and whether `com.litara` is available on Google Play or F-Droid (not checked). Signing and Play wiring
(`keystore.properties`, `play-service-account.json`, `com.github.triplet.play`) are unchanged and inert.

### Branding and leftover-name pass (third verification)

At the owner's request the remaining BookOrbit names were also removed: all app strings, comments, tests and tooling
(including the server-URL placeholder, the manifest-schema fixture string, the stats-source key and `docs/testing`);
the in-app "No longer maintained" notice and its upstream-README link; upstream `README.md`, `ROADMAP.md`,
`CHANGELOG.md` and `docs/server-3.8-compatibility.md` (replaced by a Litara `README.md`; recoverable upstream);
the BookOrbit "Orbit" artwork, replaced everywhere (launcher foreground/monochrome, notification small icon,
in-app `BrandLogo`) by `design/brand/logo.svg` converted to Android vector drawables (path data copied verbatim;
launcher background changed to white); and `versionCode`/`versionName` reset from `900`/`0.9.0` to `1`/`0.1.0`.
The debug variant keeps its upstream orange debug background and "D" badge so debug and release icons are distinguishable.

Re-verified uncached: lint 0 errors / 147 warnings per flavor, 335 unit tests per flavor all passing, both debug
and androidTest APKs assembled, 20/20 instrumentation tests per flavor on a fresh disposable emulator.
Visual check on that emulator: the app drawer shows "Litara Debug" with the bookmark mark, and the first-run screen
shows the Litara name and `https://your-litara-server.com` placeholder. Not checked visually: the notification icon, the
themed (monochrome) icon, dark mode, and the in-app `BrandLogo` on the login screen (not reached without a server).

Caveat: strings, fixtures and docs now say Litara while the networking layer still speaks the BookOrbit-shaped API;
nothing exists server-side yet. The renamed schema fixture string is only a unit-test input. This is a naming change,
not evidence that a Litara server contract exists.

## 9. Reproduce

```bash
cd apps/android
./gradlew --continue :app:lintFullDebug :app:lintFdroidDebug :app:testFullDebugUnitTest :app:testFdroidDebugUnitTest :app:assembleFullDebug :app:assembleFdroidDebug
```

```bash
ANDROID_SERIAL=<disposable-emulator-serial> ./gradlew :app:connectedFullDebugAndroidTest :app:connectedFdroidDebugAndroidTest
```

Never run `connected*AndroidTest` against a device or emulator whose BookOrbit data you want to keep.
