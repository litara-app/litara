# Litara

Litara is being rebuilt with a Go backend. The Go backend foundation and native Android baseline are merged. The Android client is not yet connected to the replacement server; T003 is the next scoped integration assignment.

- [Work register](TASKS.md) and [T003 assignment](handoffs/T003-assignment.md): ownership, committed checkout instructions and acceptance checks.
- [T003 API contract](contracts/t003/README.md): versioned wire schemas, seeded persistence model and shared fixtures.
- [Backend setup and checks](research/backend/README.md).
- [Android build instructions](apps/android/BUILDING.md).
- [Architecture decisions](ADR/README.md): accepted decisions and proposals awaiting user input.
- [Research and comparison](ADR/RESEARCH.md): existing Litara, BookOrbit, and the Android starting point.
- [Archived Litara](archive/litara-v1/README.md): the previous stack, preserved for reference.
- [Contributor and agent rules](AGENTS.md): ADR acceptance and enforcement.

The rebuild starts with a fresh database and API. It will support existing book folders and optional managed imports, PostgreSQL, NAS book storage with local application state, and editions/recordings beneath a title. Android development starts from `deranjer/bookorbit-android`, preserving Chromecast and Android Auto.

First-party backend/web work remains MIT. The Android application retains AGPL so its existing media work and contributor code can be preserved under their current license. Third-party licenses and notices remain applicable. See [ADR-0017](ADR/0017-separate-android-agpl-license.md), which replaces the earlier all-MIT direction.

The seven [Android audit reports](research/android/README.md) are preserved from the separate audit workspace. Read the [reconciliation](research/android/adr-reconciliation.md) for decisions that supersede their recommendations.

The backend foundation is net/http + Huma, sqlc/pgx, Goose, and River. The web reader will use pristine Foliate and direct PDF.js. Media inspection will use bundled native ffprobe, with FFmpeg bundled for explicitly designed media operations under [ADR-0028](ADR/0028-bundle-native-ffmpeg-tools.md). The passing [Go/WASM prototype](research/media-inspection/README.md) remains available for deferred follow-up testing.

Validate decision records with:

```powershell
pwsh -NoProfile -File scripts/Validate-Adrs.ps1
```
