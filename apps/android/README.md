# Litara Android (AGPL-3.0)

Native Kotlin / Jetpack Compose client with a Media3 audiobook player, Chromecast (`full` flavor),
Android Auto and offline downloads. This directory is the Android baseline imported under ADR-0005; read
[LITARA.md](LITARA.md) first for its current status, and [LICENSING.md](LICENSING.md) for the license boundary
(this directory is AGPL-3.0; the backend and web are MIT).

| Document | Purpose |
| --- | --- |
| [LITARA.md](LITARA.md) | Current status and limits of the baseline |
| [BUILDING.md](BUILDING.md) | Requirements, build/lint/test commands, emulator tests |
| [ADAPTATION.md](ADAPTATION.md) | Where the Litara API adapter replaces baseline code; ADR-required changes; known defects |
| [UPSTREAM.md](UPSTREAM.md) | Upstream repository, exact revision, exclusions, identity decisions |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | Bundled assets and dependency licenses |
| `docs/testing/` | Manual and hardware test procedures (Cast handoff, Android Auto, secure storage, user CA trust) |

## Project layout

```
app/src/main/
    assets/reader/            foliate.js + bridge.js + index.html (see THIRD_PARTY_NOTICES.md)
    assets/licenses/          license texts packaged into the APK
    java/com/litara/
      app/                    Application (Hilt), MainActivity, navigation
      core/
        auth/                 SessionManager, SecureStorage (EncryptedSharedPreferences)
        network/              Retrofit ApiService, interceptors, token refresh   (pending replacement)
        model/                hand-written @Serializable DTOs                     (pending replacement)
        db/                   Room: progress, downloads, pending-write queues
        sync/ storage/ di/ paging/
      feature/
        player/               Media3 service, Android Auto browse tree, progress, queue math
        cast/                 Cast proxy and MP4 chapter filter (+ flavor sources in src/full, src/fdroid)
        downloads/ reader/ auth/ library/ ...
      ui/                     shared Compose components and theme
app/src/full/                 Google Cast SDK integration (proprietary dependency; `full` flavor only)
app/src/fdroid/               Cast-free stubs
```

## Conventions

Kotlin + Compose (Material 3), MVVM with `ViewModel` + `StateFlow`, Hilt, Coroutines/Flow, Retrofit/OkHttp
with kotlinx.serialization, Coil, Media3/ExoPlayer, Room + DataStore, WorkManager. Use Material icons rather than
emoji. Dependency versions are pinned in `gradle/libs.versions.toml` and are not to be upgraded as part of
unrelated work. Keep both flavors building.
