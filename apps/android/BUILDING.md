# Building and checking Android

Run everything from `apps/android/`. No signing or publishing credentials are needed for any of this.

## Requirements

| Tool | Version |
| --- | --- |
| JDK | **25** for Gradle and the compiler/test toolchain. Set `JAVA_HOME` and Android Studio's Gradle JDK to a JDK 25 installation. The app's Java/Kotlin bytecode target remains **17**. |
| Android SDK | Platform 36, Build-Tools 35+ (AGP fetches missing pieces once licenses are accepted) |
| Gradle | 9.1.0 via the checksum-pinned committed wrapper (`./gradlew`); nothing to install separately |
| AGP / Kotlin | 8.13.2 / 2.3.21 (pinned in `gradle/libs.versions.toml`) |
| KSP / Hilt | 2.3.9 / 2.58; compiler processors updated alongside the Kotlin/Gradle toolchain |
| Room | 2.8.5 runtime/compiler/testing, with a KSP2-compatible compiler |

Point Gradle at your SDK with `ANDROID_HOME`/`ANDROID_SDK_ROOT` or a git-ignored `local.properties`
containing `sdk.dir=...` (forward slashes). Never commit `local.properties`.

The user selected JDK 25 on 2026-11-17. Gradle 9.1 is the first Gradle release supporting
Java 25. AGP 8.13.2 supports the project's API 36 compile SDK, so the earlier unsupported-SDK
suppression is removed. Hilt stays on 2.58 because Hilt 2.59+ requires AGP 9; this upgrade
does not migrate the application to AGP 9's built-in Kotlin/DSL. Settings reject a different
Gradle runtime JDK with an actionable message, and Kotlin explicitly selects the JDK 25
toolchain with target 17. This changes build tools without raising the app's minimum Android
version or adopting Java 25 bytecode.

Run `./gradlew --version` and check **Launcher JVM / Daemon JVM** use JDK 25. A system
`java -version` showing 25 is insufficient when `JAVA_HOME` or Android Studio selects another JDK.
Earlier T002/T003 test reports used JDK 21 and remain historical evidence, not current requirements.
See [the upgrade verification](../../research/t007/jdk25-upgrade.md).

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

GitHub Actions remains disabled under ADR-0064. Local checks above are permitted. The retained
`.github/workflows/android.yml` now selects JDK 25 for a future user-approved reactivation;
its hosted execution has not been verified while Actions is paused. This upgrade does not
reactivate CI, change publishing configuration or authorize a release.
