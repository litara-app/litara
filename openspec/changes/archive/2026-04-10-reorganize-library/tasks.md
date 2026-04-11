## 1. Backend — Service

- [x] 1.1 Add `runLibraryReorganize(taskId, files)` private method to `AdminService` that iterates `BookFile` records, computes canonical paths via `LibraryWriteService.computeTargetPath`, skips files already in place, moves files (rename → copy+delete fallback), updates `BookFile.filePath`, and streams progress to `Task.payload`
- [x] 1.2 Add `reorganizeLibrary()` public method to `AdminService` that guards writes via `DiskWriteGuardService`, creates a `LIBRARY_REORGANIZE` Task record, fires `runLibraryReorganize` in the background, and returns `{ taskId }`
- [x] 1.3 Handle per-file collision detection: skip and log `[collision]` when target exists with different content; update DB path only and log `[dedup]` when target hash matches source
- [x] 1.4 After each successful move attempt `fs.rmdirSync` on the vacated parent directory (ignore errors if non-empty)

## 2. Backend — API

- [x] 2.1 Add `POST /admin/library/reorganize` endpoint to `AdminController` returning `{ taskId }` with HTTP 202; guard with `JwtAuthGuard` + admin role check; add `@ApiBearerAuth()` and Swagger decorators
- [x] 2.2 Add `ReorganizeLibraryResponseDto` with `taskId: string` and `@ApiProperty()`

## 3. Frontend — Admin UI

- [x] 3.1 Add a "Reorganize Library" button to the Admin page (near the existing Bulk Sidecar Write action or in a Library section); fetch disk settings from `/admin/settings/disk` to determine enabled state
- [x] 3.2 Disable the button with tooltip `"Enable disk writes in settings to use this feature"` when `allowDiskWrites === false`, and `"Library volume is mounted read-only"` when `isReadOnlyMount === true`
- [x] 3.3 Show a confirmation modal before calling the endpoint, warning that files will be physically moved on disk
- [x] 3.4 On confirmation, call `POST /admin/library/reorganize`, then display the returned `taskId` in the existing task log viewer (or navigate to the tasks section)

## 4. Backup — Backend Service

- [x] 4.1 Add `getLibraryBackupSize()` method to `AdminService` that sums `BookFile.sizeBytes` for all non-missing files and returns `{ totalBytes: bigint, fileCount: number }`
- [x] 4.2 Add `streamLibraryBackup(res: Response)` method to `AdminService` that creates a `JSZip` instance, iterates all non-missing `BookFile` records, adds each file as a stream entry using `fs.createReadStream` (skipping files absent on disk), sets the response headers (`Content-Type: application/zip`, `Content-Disposition` with datestamped filename), and pipes `zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true })` to `res`
- [x] 4.3 Strip `ebookLibraryPath` prefix from each `BookFile.filePath` when computing the zip archive entry path so internal paths are relative (e.g. `Author/Title.epub`)

## 5. Backup — Backend API

- [x] 5.1 Add `GET /admin/library/backup/size` endpoint to `AdminController` returning `{ totalBytes, fileCount }` with HTTP 200; add `@ApiBearerAuth()` and Swagger `@ApiOkResponse`
- [x] 5.2 Add `GET /admin/library/backup/download` endpoint using `@Res()` raw response; call `streamLibraryBackup(res)`; guard with `JwtAuthGuard` + admin role
- [x] 5.3 Add `BackupSizeResponseDto` with `totalBytes: number` and `fileCount: number` and `@ApiProperty()`

## 6. Backup — Frontend Admin UI

- [x] 6.1 Add a "Download Backup" button to the Admin library section alongside the Reorganize button
- [x] 6.2 On button click, fetch `GET /admin/library/backup/size`; if `totalBytes >= 2 GiB` show a warning modal with the estimated size and require confirmation before proceeding; if size fetch fails, also show the warning modal
- [x] 6.3 Initiate the download by creating a temporary `<a>` element with the backup URL and the Authorization header (using `fetch` + `Blob` + `URL.createObjectURL`) so the JWT is sent correctly

## 7. Verification

- [x] 7.1 Run `npm run build` in `apps/api` to confirm no TypeScript errors
- [x] 7.2 Run `npm run build` in `apps/web` to confirm no TypeScript errors
- [x] 7.3 Manual smoke-test: trigger reorganize on a small library with flat structure, confirm files move to `Author/Title.ext` and `BookFile.filePath` is updated in DB
- [x] 7.4 Manual smoke-test: trigger backup download, confirm zip contains all book files at relative paths and is a valid archive
