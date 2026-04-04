## Context

Litara's sidecar system is partially built. The `Book` model has a `sidecarFile` column. The app can already find, read, export, and apply sidecar files. The `ServerSettings` table stores feature flags as key/value pairs (e.g. `opds_enabled`). The `AdminService` follows a consistent pattern: `upsert` into `ServerSettings`, return the current state.

What doesn't exist yet:

1. Any mechanism to **write** a sidecar to disk.
2. A gate that prevents all disk writes unless explicitly enabled.
3. A way to detect if the library directory is mounted read-only.
4. A bulk write operation.

## Goals / Non-Goals

**Goals:**

- `allow_disk_writes` ServerSettings key (default absent = `false`) gates all write operations.
- Detect RO mount by probing the library directory; return status separately from the setting.
- `POST /books/:id/sidecar/write` writes a single book's metadata to disk atomically.
- `POST /admin/sidecar/bulk-write` iterates all books and writes sidecars in a background task.
- Admin UI panel for the setting, mount status, and bulk write trigger.
- `SidecarTab` "Write to Disk" button.

**Non-Goals:**

- Writing metadata into ebook files (future phase).
- Per-user disk write permissions (admin-only gate is sufficient for v1).
- Overwrite confirmation dialog (silent overwrite is fine for v1).
- Watching for external changes to sidecar files during a bulk write (chokidar handles this separately).

## Decisions

### 1. Default off — explicit opt-in

`allow_disk_writes` defaults to `false` when the key is absent from `ServerSettings`. Rationale: many users run Litara in Docker with the library volume mounted read-only or shared with other tools. An accidental write could corrupt a Calibre database or confuse a sync tool. The admin must consciously enable writes. The UI explains why and points to the Docker volume recommendation.

### 2. Separate the "setting" from the "capability"

The `allow_disk_writes` flag is an admin preference. The `isReadOnlyMount` flag is a runtime observation. These are returned together by `GET /admin/settings/disk` but stored/detected independently. An admin might have `allow_disk_writes = true` but the mount is RO — in that case the write will fail at the OS level, and the error is surfaced as a clear message, not a silent 403.

### 3. RO mount detection via probe write

On `GET /admin/settings/disk` (and on demand), the API attempts to write a zero-byte temp file (`litara-probe-<random>.tmp`) to the library root directory, then immediately deletes it. If the write throws EROFS/EACCES/EPERM, `isReadOnlyMount: true` is returned. This probe is cheap and always reflects current mount state. **The probe is run every time the endpoint is called** — mounts can change at runtime (NFS reconnect, Docker remount).

Alternative considered: read `/proc/mounts` or parse `mount` output. Rejected: not portable across Windows/Linux/macOS and doesn't account for per-directory ACLs.

### 4. Atomic sidecar write (write-to-temp then rename)

Write the JSON to `<path>.metadata.json.tmp`, then `fs.renameSync` to `<path>.metadata.json`. On POSIX (Linux/macOS NFS), rename is atomic within the same filesystem. On Windows, rename over an existing file requires unlinking first (handled with `fs.rmSync` + `fs.renameSync`). This ensures a concurrent reader never sees a half-written file.

**NFS / concurrent access notes:**

- NFS rename is not guaranteed atomic across all server implementations, but is atomic on Linux `nfsd`. This is the best we can do at the application layer without advisory file locking (which NFS doesn't reliably support).
- We do not hold any lock during the write — the window of inconsistency is the millisecond between temp write and rename, which is acceptable for metadata files.
- We explicitly do **not** use exclusive-open (`O_EXCL`) because overwriting an existing sidecar is intentional.

### 5. Bulk write: background task via existing Task infrastructure

`POST /admin/sidecar/bulk-write` queues a background `Task` (Litara already has a `Task` model and task-runner infrastructure). The endpoint returns the task ID immediately. Progress (written/skipped/failed) is appended to the task log. The Admin UI polls or shows the task in the Tasks tab.

Alternative considered: streaming SSE. Rejected: over-engineered for a one-shot admin action; the existing Task system is a better fit.

### 6. Guard implementation: a shared service method

A `DiskWriteGuardService` (injectable singleton) exposes a single `assertDiskWritesAllowed()` method that reads `ServerSettings` and throws `ForbiddenException` if disabled. All write endpoints call this first. This keeps the guard logic in one place rather than duplicating the settings read in every service.

### 7. File naming convention

Same as the existing `exportSidecar` logic: `<ebook-basename>.metadata.json`. The sidecar is placed in the **same directory as the first non-missing ebook file** (preferring EPUB when multiple formats exist). This matches what `findSidecar` already expects as Strategy 1.

### 8. Reuse `exportSidecar` serialisation

`writeSidecar` calls `exportSidecar` internally to get the `MetadataResult` JSON, then writes it to disk and updates `Book.sidecarFile`. This keeps the two outputs (download and disk write) in sync automatically.

## Risks / Trade-offs

- **NFS rename atomicity**: Non-atomic on some NFS setups → Mitigation: document the limitation; the window is sub-millisecond and only affects metadata files, not ebook content.
- **Mount state changes between check and write**: `isReadOnlyMount` from `GET` may be stale by the time the write occurs → Mitigation: catch EROFS/EACCES/EPERM on actual write and return a descriptive 500.
- **Bulk write performance**: A library with 10,000 books writing 10,000 files is slow → Mitigation: run in background task with concurrency limit (e.g. 10 parallel writes); report progress.
- **Bulk write + chokidar**: Each written sidecar triggers a `handleSidecarAdded` event, which is a DB upsert — harmless but creates N DB round-trips → Mitigation: chokidar debounces by default; the upsert is idempotent.
- **Windows rename over existing file**: `fs.renameSync` throws if target exists → Mitigation: detect platform and use `fs.rmSync` before rename, or use `fs.writeFileSync` directly (non-atomic but acceptable on Windows where NFS concerns are less common).

## Migration Plan

No database migration required — `Book.sidecarFile` and `ServerSettings` already exist.

Deploy:

1. Ship API with new endpoints and `DiskWriteGuardService`.
2. Ship frontend with new Admin panel and SidecarTab button.
3. `allow_disk_writes` is absent (= false) for all existing installations — no behaviour change on upgrade.
