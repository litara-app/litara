## 1. Disk Write Guard — API

- [x] 1.1 Add `DiskWriteGuardService` in `apps/api/src/common/` with `assertDiskWritesAllowed()` method that reads `allow_disk_writes` from `ServerSettings` and throws `ForbiddenException` if absent or `'false'`
- [x] 1.2 Add `probeLibraryWritable(libraryPath: string): Promise<boolean>` utility in `DiskWriteGuardService` that writes/deletes a zero-byte temp file and returns `false` on EROFS/EACCES/EPERM
- [x] 1.3 Add `GET /admin/settings/disk` endpoint returning `{ allowDiskWrites: boolean, isReadOnlyMount: boolean }` (runs probe on every call)
- [x] 1.4 Add `PATCH /admin/settings/disk` endpoint accepting `{ allowDiskWrites: boolean }` — upserts `allow_disk_writes` in `ServerSettings`
- [x] 1.5 Register `DiskWriteGuardService` in `AdminModule` (and export so `BooksModule` can inject it)

## 2. Single-Book Sidecar Write — API

- [x] 2.1 Add `writeSidecar(bookId: string): Promise<{ sidecarFile: string }>` to `BooksService`: resolves primary file path (EPUB preferred), builds JSON via existing `exportSidecar`, writes atomically (temp-then-rename), updates `Book.sidecarFile`
- [x] 2.2 Handle platform difference for rename-over-existing on Windows (`fs.rmSync` before `fs.renameSync`)
- [x] 2.3 Add `POST /books/:id/sidecar/write` endpoint to `BooksController` that calls `assertDiskWritesAllowed()` then `writeSidecar()`, returns `{ sidecarFile: string }`
- [x] 2.4 Add Swagger decorators to the new endpoint (`@ApiOkResponse`, `@ApiBearerAuth`)

## 3. Bulk Sidecar Write — API

- [x] 3.1 Add `bulkWriteSidecars(): Promise<{ taskId: string }>` to `AdminService` that creates a `Task` record then spawns a background async function
- [x] 3.2 Implement the background function: fetch all books with non-missing files, write sidecars with `p-limit` (concurrency 10), log `[write]`/`[error]` lines, append summary, set task `COMPLETED`
- [x] 3.3 Add `POST /admin/sidecar/bulk-write` endpoint to `AdminController` that calls `assertDiskWritesAllowed()` then `bulkWriteSidecars()`
- [x] 3.4 Inject `BooksService` (or extract sidecar write logic to a shared `SidecarService`) into `AdminService` to avoid code duplication

## 4. Disk Write Guard — Frontend

- [x] 4.1 Add `GET /admin/settings/disk` and `PATCH /admin/settings/disk` API calls to the web API layer (`src/api/` or inline in the component)
- [x] 4.2 Create `DiskSettingsSection` component in `apps/web/src/pages/admin/GeneralTab.tsx` (or a new `DiskTab.tsx`) with: allow-disk-writes `Switch`, RO-mount warning `Alert`, and "Write All Sidecars" `Button`
- [x] 4.3 "Write All Sidecars" button calls `POST /admin/sidecar/bulk-write` and shows a success alert pointing to the Tasks tab; disable button when `allowDiskWrites` is false
- [x] 4.4 RO-mount alert: show yellow `Alert` with icon when `isReadOnlyMount` is true, text: "The library directory appears to be mounted read-only. Disk write operations will fail. Consider removing the RO flag from your Docker volume mount."
- [x] 4.5 Add `DiskSettingsSection` to the `GeneralTab` render

## 5. SidecarTab — Write to Disk Button

- [x] 5.1 Fetch `allowDiskWrites` from `GET /admin/settings/disk` on mount (or accept as a prop from a parent that already fetches it)
- [x] 5.2 Add `handleWriteToDisk()` function that calls `POST /books/:id/sidecar/write` then reloads sidecar content (reuses existing `handleScan` + content fetch flow)
- [x] 5.3 Add "Write to Disk" `Button` with `IconDeviceFloppy` icon to: the empty-state action group (alongside "Scan for Sidecar") and the comparison-view action bar (alongside "Rescan" and "Export Sidecar")
- [x] 5.4 Disable "Write to Disk" button when `allowDiskWrites` is false; add `Tooltip` with message "Disk writes are disabled. See Admin → Disk Settings."

## 6. Verification

- [x] 6.1 Run `npm run build` from repo root to confirm no TypeScript errors
- [ ] 6.2 Manually test: enable disk writes in Admin, write a sidecar for a single book, verify the `.metadata.json` file appears on disk with correct content
- [ ] 6.3 Manually test: disable disk writes, confirm write attempts return 403 and the button is disabled in the UI
- [ ] 6.4 Manually test: trigger bulk write, open Tasks tab, verify task log shows progress and final summary
- [ ] 6.5 Manually test RO detection: if possible, mount a test directory as read-only and confirm the Admin panel shows the warning
