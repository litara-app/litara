## Why

Litara is currently read-only with respect to the filesystem — metadata edits stay in the database and never flow back to disk. Users want portable, durable metadata that survives database resets and works alongside other ebook tools (Calibre, KOReader, Beets, etc.). Before embedding metadata directly into ebook files, the safer first step is sidecar files. But writing to disk also introduces risk: shared NFS mounts, Docker read-only volumes, and concurrent ebook managers mean we must gate all disk writes behind an explicit opt-in with clear feedback when writes aren't possible.

## What Changes

- **Disk write guard**: A new admin setting (`allow_disk_writes`, default **off**) gates all filesystem-write operations. The API returns 403 if disk writes are disabled. A companion probe detects whether the library directory is actually mounted read-only and surfaces that separately.
- **Write sidecar (single book)**: `POST /books/:id/sidecar/write` serialises the book's current DB metadata into a `.metadata.json` file beside the ebook, then links it in `Book.sidecarFile`. Writes are atomic (write-to-temp then rename) to be safe against concurrent readers/writers on NFS.
- **Bulk write sidecars (Admin)**: Admin page gains a "Write All Sidecars" action that queues a background write for every book that has at least one on-disk file, skipping books whose sidecar is already up-to-date. Results are reported back (written / skipped / failed counts).
- **"Write to Disk" button in SidecarTab**: Replaces the download-only "Export Sidecar" flow with an option to write directly to the filesystem. The tab refreshes after a successful write.
- **Disk settings panel in Admin**: Shows the `allow_disk_writes` toggle, the detected mount status (RO warning if applicable), and the bulk-write action.

## Capabilities

### New Capabilities

- `disk-write-guard`: Admin setting to enable/disable all filesystem writes, with read-only mount detection and API enforcement.
- `metadata-sidecar-write`: Write a single book's metadata from the database to a `.metadata.json` sidecar file on disk.
- `bulk-sidecar-write`: Admin action to write sidecar files for all books in the library in a background task.

### Modified Capabilities

- (none — existing sidecar read/scan/export/apply behaviour is unchanged)

## Impact

- **API**:
  - New `GET /admin/settings/disk` and `PATCH /admin/settings/disk` endpoints for the write guard + RO probe.
  - New `POST /admin/sidecar/bulk-write` endpoint for the bulk operation.
  - New `POST /books/:id/sidecar/write` endpoint.
  - A shared `DiskWriteGuardService` (or helper method in `AdminService`) performs the `allow_disk_writes` check; all write endpoints call it and throw `ForbiddenException` if disabled.
- **Frontend**: Admin `GeneralTab` (or a new `DiskTab`) gains the Disk Writes settings panel. `SidecarTab` gains a "Write to Disk" button.
- **Filesystem**: Sidecar files are written atomically using a temp-file + rename pattern. No ebook files are ever touched.
- **No new npm dependencies** required.
