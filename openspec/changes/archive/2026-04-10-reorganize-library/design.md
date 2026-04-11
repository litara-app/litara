## Context

Litara's canonical file layout is `<libraryRoot>/<Author>/[<Series>/]<Title>.<ext>`. This is enforced today only for new books arriving via the Book Drop flow (via `LibraryWriteService.computeTargetPath`). Books that were bulk-imported by the scanner from a pre-existing flat or arbitrary directory remain wherever they were found, and there is no way to normalize them without manual intervention.

The existing infrastructure has everything needed:

- `LibraryWriteService.computeTargetPath` computes the canonical path from author/series/title metadata.
- `DiskWriteGuardService` gates all on-disk mutations behind the `allowDiskWrites` admin toggle and a live writability probe.
- The Task table (`type`, `status`, `payload`) and the `BULK_SIDECAR_WRITE` flow in `AdminService` provide a proven pattern for long-running, progress-streaming admin operations.

## Goals / Non-Goals

**Goals:**

- Move every `BookFile` whose `filePath` differs from the canonical path to the canonical location and update the DB record in the same operation.
- Run as a background Task with per-file log lines so the admin can track progress in the existing task log viewer.
- Reuse `DiskWriteGuardService` so the action is blocked when disk writes are disabled or the volume is read-only.
- Surface the action in the web admin UI with appropriate guards and a link to the running task.

**Non-Goals:**

- Reorganizing files outside the configured `ebookLibraryPath` (watched-folder-scoped books only).
- Renaming or modifying file content / metadata.
- Mobile app UI (admin actions are web-only).
- Undoing / rolling back moves.

## Decisions

### Rename-then-fallback copy strategy

**Decision:** Use `fs.renameSync` as the primary move. If it throws (cross-device / cross-mount), fall back to `fs.copyFileSync` + `fs.rmSync`.

**Rationale:** `rename` is atomic and instant on same-filesystem moves, which covers the typical Docker-volume case. The fallback handles edge cases (e.g. library path on a different mount than the temp staging area) without requiring the caller to know the topology.

**Alternative considered:** Always copy+delete. Rejected because it is slower, not atomic, and risks partial writes if the container is killed mid-copy.

---

### DB update inside the per-file try/catch

**Decision:** Update `BookFile.filePath` immediately after a successful move, before moving to the next file. A failure on the DB update re-throws so the file's log line is marked `[error]` and the original file is left in place.

**Rationale:** Keeps the DB and filesystem in sync file-by-file. A crash mid-run leaves already-processed files correct; the task can be re-run to catch stragglers (idempotent: files already at canonical path are skipped).

---

### Collision handling: skip and log

**Decision:** If the canonical target path already exists and is a _different_ file, skip the move and log `[collision]`.

**Rationale:** Silently overwriting an existing file is destructive and hard to recover from. The admin can resolve collisions manually. Matching hash → treat as already-moved and update DB path only.

---

### Concurrency: sequential (no parallelism)

**Decision:** Process files one at a time.

**Rationale:** The bulk sidecar write uses a concurrency pool, but file moves are I/O-bound on the same volume and can cause race conditions if two moves target the same directory simultaneously (e.g. `mkdir -p` races). Sequential keeps the log readable and the risk surface small. Speed is not a concern for a one-time admin operation.

---

### Frontend gating

**Decision:** Disable the "Reorganize Library" button (with tooltip) when `allowDiskWrites === false` OR `isReadOnlyMount === true`. Reuse the existing `/admin/settings/disk` endpoint — no new API needed for the guard check.

## Risks / Trade-offs

- **Large libraries take a long time** → The task streams progress so the admin can monitor. No timeout risk since it's a background task.
- **Scanner picks up moved files as new additions before DB is updated** → Mitigated by updating `BookFile.filePath` immediately after each move. The scanner's duplicate detection (SHA-256 hash) will also prevent re-import even if there is a brief window.
- **Partial run leaves library in mixed state** → Acceptable; the task is idempotent. Re-running skips files already at canonical paths.
- **Author/title/series metadata missing** → Falls back to `unknown/<filename>` (same as `computeTargetPath` today). Admin should enrich metadata before running reorganize if a clean layout is desired.

## Migration Plan

No database migrations required. The `Task` table and `BookFile` table already have the needed columns. Deployment is a standard application update.

Rollback: since moves are not reversible automatically, advise admins to take a filesystem backup before running. The feature is opt-in and not run on startup.

---

## Backup: Alternatives Considered

### Why streaming zip (not background task) for now

Three approaches were evaluated for backup delivery:

| Approach                                           | Memory                   | UX                           | Audiobook-ready        | Complexity |
| -------------------------------------------------- | ------------------------ | ---------------------------- | ---------------------- | ---------- |
| **A. Streaming zip response** (chosen)             | Low — file-by-file       | Immediate browser download   | ⚠ Times out for 50+ GB | Low        |
| **B. Background task + temp file + download link** | Low                      | Two-step: wait then download | ✓ Any size             | Medium     |
| **C. jszip in-memory**                             | High — entire zip in RAM | Immediate browser download   | ✗ OOM risk             | Low        |

**Decision: Option A — streaming zip using `jszip` `generateNodeStream({ streamFiles: true })`.**

Rationale:

- `jszip` is already a project dependency; no new package required.
- `streamFiles: true` processes each file entry as it's read from disk and writes it to the response stream, keeping peak memory proportional to a single file rather than the whole library.
- For the current ebook-only use case (typical library: hundreds of MB to a few GB) this is entirely safe.
- The UX is the simplest possible: click → download starts.

**Upgrade path for large/audiobook libraries (Option B):**
When the library contains audio files (`.mp3`, `.m4b`, `.flac`) or the total library exceeds a configurable threshold, the right approach is a background Task that writes the zip to a temp directory (e.g. `os.tmpdir()`), returns a `taskId`, and exposes a `GET /admin/library/backup/download/:taskId` endpoint that streams the pre-built file. The temp file is deleted after the first download or after a 1-hour TTL. This change can be made without altering the API contract — the endpoint just changes from synchronous streaming to a two-step flow when conditions warrant.

---

### Zip internal path layout

**Decision:** Strip the `ebookLibraryPath` prefix from each file's path to form its archive entry path, so the zip contains relative paths like `Brandon Sanderson/Mistborn/The Final Empire.epub`.

**Rationale:** Portable archives that don't embed server-specific absolute paths. Restoring the backup to a different `ebookLibraryPath` is straightforward.

---

### Files missing on disk

**Decision:** Skip `BookFile` records where `missingAt IS NOT NULL` or where the file does not exist on disk at stream time. Log a warning per skipped file to the API logger; do not surface this to the client (the zip simply won't contain those files).

**Rationale:** A missing file would cause the stream to throw mid-zip, corrupting the archive. Silent skip is safer; the admin can identify missing files through the existing book management UI.

---

### No authentication on the zip stream body

**Decision:** Standard JWT Bearer auth on the endpoint. No separate download token.

**Rationale:** The backup endpoint is only available to admins. Since the download is initiated by an authenticated browser session (the admin UI calls it via fetch/anchor with the Authorization header), no additional token mechanism is needed. Direct URL access without a token returns 401.

## Open Questions

- Should the task be re-entrant (skip files already at canonical path and only process the remainder)? — Proposed answer: yes, always skip files already at canonical path so re-runs are safe. ✓ included in design.
- Should empty directories left behind after moves be cleaned up? — Proposed answer: yes, attempt `fs.rmdirSync` (non-recursive) on the parent after each move; ignore errors if non-empty.
