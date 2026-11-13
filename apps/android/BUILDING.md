# Building and checking the baseline

Run everything from `apps/android/`. No signing or publishing credentials are needed for any of this.

## Requirements

| Tool | Version |
| --- | --- |
| JDK | 21 (CI uses Temurin 21). JDK 17+ works for Gradle; the Kotlin/Java target is 17. Do not use JDK 25. |
| Android SDK | Platform 36, Build-Tools 35+ (AGP fetches missing pieces once licenses are accepted) |
| Gradle | 8.11.1 via the committed wrapper (`./gradlew`); nothing to install |
| AGP / Kotlin | 8.9.1 / 2.0.21 (pinned in `gradle/libs.versions.toml`; do not upgrade as part of unrelated work) |

Point Gradle at your SDK with `ANDROID_HOME`/`ANDROID_SDK_ROOT` or a git-ignored `local.properties`
containing `sdk.dir=...` (forward slashes). Never commit `local.properties`.

## Commands

```bash
./gradlew :app:lintFullDebug :app:lintFdroidDebug
```

```bash
./gradlew :app:testFullDebugUnitTest :app:testFdroidDebugUnitTest
```

```bash
./gradlew :app:assembleFullDebug :app:assembleFdroidDebug
```

Outputs (git-ignored): `app/build/outputs/apk/{full,fdroid}/debug/app-{full,fdroid}-debug.apk`.
Debug builds install as `com.litara.debug` (see the identity table in `UPSTREAM.md`).

## Instrumentation tests (emulator required)

Use a **disposable** emulator (for example `-read-only -no-snapshot-save`). `connected*AndroidTest`
reinstalls and then uninstalls `com.litara.debug`, destroying that app's data on the target, so pin the
device explicitly:

```bash
ANDROID_SERIAL=<disposable-emulator-serial> ./gradlew :app:connectedFullDebugAndroidTest :app:connectedFdroidDebugAndroidTest
```

These use fakes, a local proxy and MockWebServer. They are **not** a real Chromecast session or an
Android Auto head-unit test; those remain manual (`docs/testing/cast-handoff.md`,
`docs/testing/android-auto.md`).

## Verify the F-Droid flavor has no proprietary Cast components

```bash
./gradlew :app:dependencies --configuration fdroidReleaseRuntimeClasspath | grep -c "com.google.android.gms"
```

Expected: `0`. (`fullReleaseRuntimeClasspath` is expected to list `play-services-cast-framework`.)

## Release builds

Release builds are unsigned unless a developer supplies `app/keystore.properties`, and Play tasks
exist only if `app/play-service-account.json` is present. Neither is part of this baseline, and
nothing here should be published. Release configuration is unresolved (`UPSTREAM.md`).

## CI

`.github/workflows/android.yml` at the repository root runs lint, unit tests, debug assembly and
the F-Droid dependency check for both flavors with `working-directory: apps/android`.
