## Why

Libraries ingested before Litara's structured path convention — or files added directly to the watched folder — often sit in a flat or inconsistent layout. There is currently no way to bring the entire library into the canonical `Author/Series/Title.ext` structure without re-importing every file by hand.

## What Changes

- Add a **"Reorganize Library"** admin action that moves every book file on disk into the canonical path structure (`Author/[Series/]Title.ext`).
- The action runs as a background Task (same pattern as Bulk Sidecar Write), streaming progress to the existing task log viewer.
- The action is gated behind the existing disk-write admin setting and read-only volume check — the button is disabled and shows an explanatory notice when either guard is not met.
- After each successful file move the `BookFile.filePath` record in the database is updated atomically so the library scanner does not re-import or orphan the file.
- Files that are already in the correct location are skipped (no-op).
- Failures on individual files are logged and counted but do not abort the whole run.
- Add a **"Download Backup"** admin action that streams the entire library as a zip file to the browser, preserving the `Author/[Series/]Title.ext` folder structure. Intended as a pre-reorganize safety net and general DR option.
- A size-estimate endpoint lets the UI warn users before initiating a large download (threshold: 2 GB).
- For future audiobook libraries (potentially tens of GB), the design documents an upgrade path to a background-task-based zip generation with a temp-file download link.

## Capabilities

### New Capabilities

- `library-reorganize`: Admin-triggered background task that moves all book files on disk into Litara's canonical `Author/[Series/]Title.ext` folder hierarchy and updates `BookFile.filePath` records accordingly.
- `library-backup`: Admin-triggered streaming zip download of the entire library, preserving the on-disk folder structure. Provides a safe "before" snapshot and reassures users that a reorganize can be undone by restoring the backup.

### Modified Capabilities

<!-- No existing spec-level behavior changes. -->

## Impact

- **API**: New `POST /admin/library/reorganize` endpoint returns `{ taskId }`. New `GET /admin/library/backup/download` streams a zip of all library files. New `GET /admin/library/backup/size` returns an estimated total size so the UI can warn before a large download.
- **Backend**: New methods on `AdminService` for reorganize (background task) and backup (streaming zip via `jszip` `generateNodeStream`). No new npm dependencies required.
- **Frontend (web)**: "Reorganize Library" button guarded by disk-write settings; "Download Backup" button with size estimate warning, both in the Admin library management section.
- **Constraints**: Reorganize requires `allowDiskWrites: true` and writable volume. Backup requires no disk-write permissions (read-only is fine) but warns the user when estimated size exceeds 2 GB.
