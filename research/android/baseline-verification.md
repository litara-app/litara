# Reproducible baseline verification

Run on 2026-11-12 (20:08 to about 20:40 EST) by this audit, in an isolated reference clone. Nothing was
published, no signing secrets were present or used, and **no physical device was used**.

## 1. Inputs

| Item | Value |
| --- | --- |
| Repository | `https://github.com/deranjer/bookorbit-android` |
| Revision | `a55eaa13d8ba27cd143dda882836ed35a4dc923f` (= `main` HEAD at clone time; `git log a55eaa1..HEAD` is empty, so there are no later changes) |
| Working tree | clean (`git status --short` empty after the build; build outputs are git-ignored) |
| Clone location | `E:\Programming\_reference\bookorbit-android`: outside the Litara stack, not under `apps/android/` |
| Upstream comparison clones | `E:\Programming\_reference\foliate-js` (johnfactotum/foliate-js, 299 commits), `E:\Programming\_reference\upstream-assets\` (single files via the GitHub API) |
| Logs | `E:\Programming\_reference\logs\` (`summary.txt`, one log per step, `deps-full.txt`, `deps-fdroid.txt`, `connected-device.txt`) |

## 2. Environment

| Item | Value |
| --- | --- |
| Host OS | Windows 11 Pro 10.0.26300, Git Bash |
| JDK | JetBrains Runtime 21.0.9 (`E:\Android Studio\jbr`). The system default is Temurin 25, which is **not** used. CI uses Temurin 21. |
| Gradle | 8.11.1 via wrapper (Kotlin DSL runtime 2.0.20) |
| AGP / Kotlin | 8.9.1 / 2.0.21 (from `gradle/libs.versions.toml`) |
| Android SDK | `%LOCALAPPDATA%\Android\Sdk`. Platforms 36, 36.1, 37.0. Build-tools 35.0.0–37.0.0 |
| Signing | Debug only: the pre-existing `~/.android/debug.keystore` (dated 2026-06-17, a standard AGP debug key). `app/keystore.properties` and `app/play-service-account.json` are absent, so release builds are **unsigned** and Play publishing tasks are not configured. |
| Emulator | AVD `Pixel_Tablet`, `system-images/android-36/google_apis_playstore_tablet/x86_64`, `ro.build.version.release=16`. Started `-read-only -no-snapshot-save -no-window` on port 5580, and killed afterwards. |

**[Obs]** Another emulator (`emulator-5554`, AVD `Pixel_9_Pro`, Android 17) was already running with
`com.bookorbit.debug` installed. This audit did not start it. It was **not used**, because
`connectedAndroidTest` reinstalls and uninstalls the app, which would destroy its data. All instrumented
runs were pinned with `ANDROID_SERIAL=emulator-5580`.

## 3. Commands and results

All commands were run from the clone root with
`JAVA_HOME="E:/Android Studio/jbr"` and `--continue`. They mirror `.github/workflows/android-build.yml`
plus release and instrumentation steps.

| # | Command | Result | Time |
| --- | --- | --- | --- |
| 1 | `./gradlew :app:lintFullDebug :app:lintFdroidDebug` | **PASS** (exit 0). 0 errors. 147 warnings per flavour: GradleDependency 114, UseKtx 12, UnusedResources 8, AndroidGradlePluginVersion 3, DefaultLocale 2, PrivateResource 2, ObsoleteSdkInt 2, PluralsCandidate 1, CustomX509TrustManager 1, ExportedService 1, InsecureBaseConfiguration 1 | 176 s |
| 2 | `./gradlew :app:testFullDebugUnitTest :app:testFdroidDebugUnitTest` | **PASS**. full: 52 classes / 335 tests / 0 failures / 0 skipped. fdroid: 52 / 335 / 0 / 0 | 57 s |
| 3 | `./gradlew :app:assembleFullDebug :app:assembleFdroidDebug` | **PASS**. `app-full-debug.apk` 28,742,412 B, `app-fdroid-debug.apk` 26,695,945 B | 39 s |
| 4 | `./gradlew :app:assembleFullDebugAndroidTest` | **PASS** (test APK 1,152,263 B) | 11 s |
| 5 | `./gradlew :app:assembleFullRelease :app:assembleFdroidRelease` | **PASS**, R8-minified, **unsigned**. `app-full-release-unsigned.apk` 6,052,122 B, `app-fdroid-release-unsigned.apk` 4,632,140 B | 202 s |
| 6 | `ANDROID_SERIAL=emulator-5580 ./gradlew :app:connectedFullDebugAndroidTest` | **PASS** 20/20 (list below) | 69 s |
| 7 | `ANDROID_SERIAL=emulator-5580 ./gradlew :app:connectedFdroidDebugAndroidTest` | **PASS** 20/20 | 55 s |
| 8 | `./gradlew :app:dependencies --configuration {full,fdroid}ReleaseRuntimeClasspath` | full: `play-services-cast-framework` 21.5.0, `play-services-cast` 21.5.0, `-base`, `-basement`, `-tasks`, `-flags`. fdroid: **no** `com.google.android.gms` artifacts | — |
| 9 | Dex scan: `unzip -p <apk> 'classes*.dex' \| grep -a -c "Lcom/google/android/gms/cast"` | full release 2, full debug 9 matching chunks. **fdroid release 0, fdroid debug 0** | — |

Instrumented tests (both flavours, all passed):
`SecureStorageRecoveryTest` ×3, `UserCaTrustTest` ×4, `CastProxyRangeTest` ×3, `AutoArtworkProviderTest` ×3,
`AutoMediaSessionTest` ×1 (multi-phase: browse, search, `playFromSearch`, saved speed, cross-file chapter,
live Downloads refresh, error, empty-queue resumption), `CastBookPositionTest` ×1,
`CastQueueReplacementTest` ×1, `ChapterSessionRefreshTest` ×1, `SettingsRowLayoutTest` ×3.

**[Obs]** The Cast instrumentation tests also pass in the **fdroid** flavour, because they exercise
`CastProxyServer` and fake/forwarding players, not the Cast SDK. They prove proxy and queue logic, **not**
Chromecast integration (see `media-preservation-matrix.md` L4).

## 4. Not performed (and why)

| Check | Status |
| --- | --- |
| Physical phone, real Chromecast, Android Auto DHU or head unit | **Not performed.** No hardware session in this audit. The repo's own physical results (Pixel 9 Pro / Android 17, 2026-10-22) are cited in the matrix as "reported". |
| Signed release / AAB (`bundleFullRelease`) | Not performed. It needs `RELEASE_KEYSTORE_*` secrets, which were deliberately not accessed. |
| Play publish / F-Droid metadata build | Not performed (out of scope; publishing is prohibited by the task). |
| Tests against a live BookOrbit server | Not performed. Tests use fixtures/MockWebServer only. |
| Android Auto on the `Automotive_Portrait` AVD (Android Automotive OS) | Not performed. AAOS is a different integration from projected Android Auto, and the app declares `automotiveApp` media for projection only. |

## 5. Reproduce

```bash
git clone https://github.com/deranjer/bookorbit-android.git
```

```bash
git -C bookorbit-android checkout a55eaa13d8ba27cd143dda882836ed35a4dc923f
```

```bash
cd bookorbit-android && JAVA_HOME="<JDK 21>" ./gradlew :app:lintFullDebug :app:lintFdroidDebug :app:testFullDebugUnitTest :app:testFdroidDebugUnitTest :app:assembleFullDebug :app:assembleFdroidDebug :app:assembleFullRelease :app:assembleFdroidRelease
```

```bash
ANDROID_SERIAL=<disposable-emulator-serial> ./gradlew :app:connectedFullDebugAndroidTest :app:connectedFdroidDebugAndroidTest
```

Use a disposable or `-read-only` emulator. `connected*AndroidTest` uninstalls `com.bookorbit.debug`
from the target afterwards.
