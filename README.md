# Litara

**Litara 2.0.0 is coming.** Litara is being rebuilt with a Go backend, a redesigned web application, and a native Android client. T001–T004 are now integrated into `main`, including accounts, Android recording playback, and library ingestion. The rebuild is still in development and is not ready for release.

**Existing installations will require an explicit migration to move to 2.0.** The rebuild uses a fresh database model and new client/API contracts; replacing the old server image will not perform an in-place upgrade. A verified personal-state migration path is required before 2.0.0 ships. It will prioritize metadata edits, shelves, completion state, annotations, and reading/listening progress, restoring supported data where conversion can be verified and retaining unsupported or ambiguous records in a recovery export/report. Exact source-version support and automatic-conversion coverage are still being defined.

Keep your existing database and book files backed up, and wait for the migration instructions before switching an existing installation. New installations will work without legacy data. See [the migration decision](ADR/0063-optional-legacy-data-import.md).

**Automated builds and releases are paused.** GitHub Actions is disabled repository-wide, including Android/server builds and publishing, until an explicit release-readiness decision. Merging development work does not publish 2.0.0.

- [Work register](TASKS.md): integrated packages, ownership and remaining acceptance work.
- [T005 readiness review](research/t005/readiness.md): decisions and contracts needed before web implementation can be assigned.
- [T003 API contract](contracts/t003/README.md) and [T004 ingestion contract](contracts/t004/README.md): versioned wire schemas, persistence models and verification coverage.
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
