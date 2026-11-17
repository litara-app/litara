# Android JDK 25 build-tool upgrade

User decision: 2026-11-17, "Lets move to 25 and note that in the docs". This is a build-tool maintenance change under the accepted native Android architecture (ADR-0005/0017/0023/0027), not a new reader, player or release policy. ADR-0064's CI hold remains in force.

## Ownership and source

The T007 worker had started on `codex/t007-integration`, commit `6f73398`, and reported a JDK 21 prerequisite blocker. The coordinator isolated this explicitly requested toolchain change in `.task-worktrees/android-jdk25`, branch `codex/android-jdk25`, based on that committed worker state. Do not edit the worker's live worktree or claim its baseline results as this upgrade's evidence. Integrate the final upgrade commit before resuming Android changes; all other T007 scope stays with its existing worker.

## Selected compatibility set

| Component | Previous | Selected |
| --- | --- | --- |
| Build/compiler/test JDK | 21 | 25 (local Temurin 25.0.3+9) |
| Gradle | 8.11.1 | 9.1.0, distribution SHA-256 pinned |
| Android Gradle Plugin | 8.9.1 | 8.13.2 |
| Kotlin/Compose/serialization compiler plugins | 2.0.21 | 2.3.21 |
| KSP | 2.0.21-1.0.28 | 2.3.9 |
| Hilt | 2.53.1 | 2.58 |
| Room runtime/compiler/testing | 2.6.1 | 2.8.5 (KSP2-compatible processor) |
| Java/Kotlin app bytecode | 17 | 17 |

Gradle 9.1 adds supported Java 25 execution. Kotlin 2.3.21's documented range includes Gradle 9.1 and AGP 8.13.2. AGP 8.13.2 supports compile SDK 36 without the former suppression. Hilt 2.59's AGP 9 requirement would broaden this maintenance change, so retain the last AGP 8 line, 2.58. Supporting KSP/processor compatibility is verified by actual builds, not inferred from version labels. Reader/media dependency pins remain unchanged.

The runtime and toolchain both require JDK 25. Kotlin uses typed `compilerOptions` while targeting JVM 17; Java source/target also remain 17. No API/SDK minimum, Cast proxy, reader origin or profile semantics are changed. The coordinator updates the inactive Android workflow's JDK selection to 25 alongside the local configuration; repository Actions settings, triggers, permissions and publishing behavior are unchanged, and no hosted run is launched.

## Primary documentation consulted

Context7 resolved Gradle, Android build and Kotlin documentation and retrieved Java runtime, plugin compatibility and typed compiler-option guidance. Additional official upstream release notes were inspected for processor requirements.

- https://docs.gradle.org/current/userguide/compatibility.html
- https://docs.gradle.org/9.1.0/release-notes.html
- https://developer.android.com/build/releases/agp-8-13-0-release-notes
- https://kotlinlang.org/docs/gradle-configure-project.html
- https://kotlinlang.org/docs/gradle-compiler-options.html
- https://github.com/google/ksp/releases/tag/2.3.9
- https://github.com/google/dagger/releases/tag/dagger-2.58
- https://github.com/google/dagger/releases/tag/dagger-2.59
- https://developer.android.com/jetpack/androidx/releases/room

The Gradle distribution checksum was fetched directly from `services.gradle.org/distributions/gradle-9.1.0-bin.zip.sha256` and is checked by the wrapper. This is a build-time fetch, not a runtime application dependency.

## Verification

Host: Windows 11, Temurin 25.0.3+9, local Android SDK platform 36. `JAVA_HOME` must explicitly select the installed JDK 25: the elevated command environment initially selected Android Studio's JBR 21 despite `java` on the normal PATH being 25. With explicit `JAVA_HOME`, wrapper output confirms both Launcher JVM and Daemon JVM use 25.0.3.

Commands from `apps/android`, with `JAVA_HOME` set to JDK 25 and `ANDROID_HOME` set to the local SDK:

```text
gradlew.bat --version
gradlew.bat help --no-watch-fs --no-parallel --max-workers=2 --console=plain
gradlew.bat wrapper --gradle-version=9.1.0 --distribution-type=bin --gradle-distribution-sha256-sum=a17ddd85a26b6a7f5ddb71ff8b05fc5104c0202c6e64782429790c933686c806 --no-watch-fs --no-parallel --max-workers=2 --console=plain
gradlew.bat :app:assembleFullDebug :app:assembleFdroidDebug :app:testFullDebugUnitTest :app:testFdroidDebugUnitTest :app:lintFullDebug :app:lintFdroidDebug --no-watch-fs --no-parallel --max-workers=2 --console=plain
gradlew.bat :app:assembleFullDebugAndroidTest :app:assembleFdroidDebugAndroidTest :app:assembleFullRelease :app:assembleFdroidRelease --no-watch-fs --no-parallel --max-workers=2 --console=plain
gradlew.bat -q :app:dependencies --configuration fdroidDebugRuntimeClasspath --no-watch-fs --max-workers=2 --console=plain
gradlew.bat -q :app:dependencies --configuration fdroidReleaseRuntimeClasspath --no-watch-fs --max-workers=2 --console=plain
gradlew.bat -q :app:dependencies --configuration fullReleaseRuntimeClasspath --no-watch-fs --max-workers=2 --console=plain
```

- Wrapper regeneration/configuration passed. The launcher JAR and both wrapper scripts are regenerated from checksum-verified Gradle 9.1.0, not just a changed URL.
- Both debug APKs build; both unit suites report 392 tests, **390 executed, two skipped, zero failures/errors** per flavor. The skipped cases are `LitaraServerE2ETest` and `ConflictResolutionE2ETest`; this isolated toolchain check did not start a real server or use the worker's test resources.
- Both debug lint tasks pass: zero errors/fatal issues and 75 warning entries per flavor.
- Both instrumentation-test APKs compile/package. Both local unsigned minified release APKs assemble successfully through the upgraded R8, with no release signing or publishing configuration present. This does not execute instrumentation tests or validate runtime migrations.
- F-Droid debug/release dependency graphs contain zero Google Play services, Media3 Cast or AndroidX mediarouter matches; the full release graph retains `play-services-cast-framework`. No dependency-resolution failures were reported.
- Running `help` with the earlier JBR 21 environment fails as intended with `Litara Android builds require JDK 25`; explicit JDK 25 succeeds. This checks the requirement is enforced rather than only stated in docs.
- Inspected generated `LitaraClient.class` in both flavors: class-file major version 61 (Java 17), while the build/test runtime is JDK 25.
- Room generates schema identity `f347e75d441f80d10efc92f04dd7f9f6`, matching both retained T003 baseline generated database implementations in the other worktree. Database version remains 8. This is static schema compatibility evidence, not a device migration/runtime test.
- The first compile with Room 2.6.1 failed in its KSP processor with `unexpected jvm signature V`; a stack trace identified Room's old processing implementation. Updating runtime/compiler/testing together to Room 2.8.5 fixes the failure; no application source or schema migration was changed to hide it.
- New Kotlin annotation-target/nullability/deprecation warnings and Gradle 10 deprecation warnings remain visible. Debug native-symbol stripping warnings and host SDK XML-version warning are not treated as failures. No unrelated source cleanup is bundled.

Local detailed logs are ignored under `.tmp/`: `jdk25-version.log`, `jdk25-build.log` (initial processor failure), `jdk25-ksp.log` (diagnosis), `jdk25-build-room.log` (successful both-flavor debug/test/lint), and `jdk25-packaging.log` (packaging checks). They contain machine paths and are not portable project dependencies.

Static T007 assignment integrity and diff whitespace checks pass. The dormant workflow change is limited to its setup step label and `java-version` (21 to 25); no triggers or permissions change. Current build instructions and root coordination guidance point to JDK 25; historical T002/T003 reports remain intact. No accepted ADR or application wire/schema semantics changed.

No emulator execution, real-server E2E, physical hardware, hosted CI or release is claimed. Unsigned local packaging checks do not publish or sign a release; no signing/publishing configuration is present in this isolated checkout. Actions remains paused. T007 retains native reader/runtime, Room/device and hardware acceptance after integrating this change.
