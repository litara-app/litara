## 1. Database & Prisma Schema

- [x] 1.1 Add `AudiobookFile`, `AudiobookChapter`, `AudiobookProgress`, and `AudiobookBookmark` models to `apps/api/prisma/schema.prisma`
- [x] 1.2 Add `hasAudiobook Boolean @default(false)` field to `Book` model
- [x] 1.3 Run `npx prisma migrate dev` and commit migration
- [x] 1.4 Regenerate Prisma client and verify TypeScript compilation passes

## 2. API Dependencies & Module Scaffold

- [x] 2.1 Install API dependencies: `music-metadata`
- [x] 2.2 Create `apps/api/src/audiobook/audiobook.module.ts` with NestJS module scaffold
- [x] 2.3 Create `AudiobookController`, `AudiobookScannerService`, `AudiobookMetadataService`, and `AudiobookProgressService` stubs
- [x] 2.4 Register `AudiobookModule` in `AppModule`

## 3. Audiobook Metadata Extraction

- [x] 3.1 Implement `AudiobookMetadataService.extractFromFile(filePath)` using `music-metadata` to read tags (title, artist, narrator, duration, cover art, year)
- [x] 3.2 Implement embedded m4b chapter atom parsing (`common.chapter` from `music-metadata`) → `AudiobookChapter` records
- [x] 3.3 Implement `.cue` file parser: parse `TRACK` entries, convert MM:SS:FF timestamps to seconds
- [x] 3.4 Implement fallback title extraction from folder name (strip leading numeric prefixes and common suffixes)
- [x] 3.5 Implement `metadata.json` sidecar reader for ABS-compatible files (narrator fallback)

## 4. Audiobook Scanner

- [x] 4.1 Implement `AudiobookScannerService.isAudiobookFolder(folderPath)` using the heuristic: 1+ m4b/m4a OR 3+ mp3 OR single mp3/m4a >2700s
- [x] 4.2 Implement `AudiobookScannerService.scanFolder(folderPath)` to group audio files into one Book, determine `fileIndex` via numeric prefix parsing, and upsert `Book` + `AudiobookFile` records
- [x] 4.3 Implement filename numeric prefix parser (handles formats: `01`, `001`, `01.`, `01 `, `01-`, `1 -`, `01_`)
- [x] 4.4 Integrate `AudiobookScannerService` into `LibraryScannerService`: during folder scan, delegate audiobook folders to the new scanner
- [x] 4.5 Handle chokidar `add` events for new audio files: create/update `AudiobookFile` records
- [x] 4.6 Handle chokidar `unlink` events for removed audio files: delete `AudiobookFile` and cascade-delete `Book` if no files remain
- [x] 4.7 Update `Book.hasAudiobook` flag when `AudiobookFile` records are created or deleted

## 5. Audiobook API Endpoints

- [x] 5.1 `POST /api/v1/audiobooks/stream-token` — issue a short-lived stream token (JWT-authenticated)
- [x] 5.2 `GET /api/v1/audiobooks/:bookId/files/:fileIndex/stream?streamToken=<token>` — stream raw file with HTTP Range support
- [x] 5.3 `GET /api/v1/audiobooks/:bookId/files/:fileIndex/download` — download raw file (JWT-authenticated)
- [x] 5.4 `GET /api/v1/audiobooks/:bookId/progress` — return `AudiobookProgress` for current user or `null`
- [x] 5.5 `PUT /api/v1/audiobooks/:bookId/progress` — upsert `AudiobookProgress`; auto-set `completedAt` when within 30s of end
- [x] 5.6 `GET /api/v1/audiobooks/:bookId/bookmarks` — list bookmarks for current user
- [x] 5.7 `POST /api/v1/audiobooks/:bookId/bookmarks` — create a timestamped bookmark
- [x] 5.8 `DELETE /api/v1/audiobooks/:bookId/bookmarks/:id` — delete a bookmark
- [x] 5.9 Add `audiobookProgress` field to book list and book detail API responses
- [x] 5.10 Add Swagger decorators to all new endpoints

## 6. Web Player

- [x] 6.1 Create persistent `PersistentAudiobookPlayer` bottom bar component (88px, full-width, `AppShell.Footer`)
- [x] 6.2 Add `audiobookPlayerAtom` global Jotai atom; player activates via "Play Audiobook" button on book detail page
- [x] 6.3 Implement speed control UI: cycle button through [0.5, 1.0, 1.5, 2.0], persist in `localStorage`
- [x] 6.4 Implement seekable progress bar with elapsed/remaining time display
- [x] 6.5 Implement volume control: slider + mute toggle, persist in `localStorage`
- [x] 6.6 Implement chapter list panel (Portal, above bar): display all chapters with timestamps; highlight active; click to seek
- [x] 6.7 Implement timestamped bookmark panel (Portal, above bar): add note + save, list existing, click to seek, delete
- [x] 6.8 Implement keyboard shortcuts: Space (play/pause), ← → (±10s), Shift+← Shift+→ (prev/next chapter)
- [x] 6.9 Implement periodic progress auto-save every 10 seconds during playback, immediately on pause, and on player close
- [x] 6.10 Load saved progress on player mount and resume from `currentFileIndex` / `currentTime`

## 7. Mobile Player

- [x] 7.1 Install `react-native-track-player` in `apps/mobile` and add the RNTP plugin to `app.json`
- [x] 7.2 Create RNTP playback service and register it in the root layout; add audiobook fields to the mobile `BookDetail` type; create `apps/mobile/src/api/audiobooks.ts` with stream-token fetch and progress save helpers
- [x] 7.3 Create `app/audiobook/[id].tsx` (`AudiobookPlayerScreen`): fetch a stream token, populate RNTP queue with direct stream URLs
- [x] 7.4 Implement resume from saved progress on screen open
- [x] 7.5 Implement speed control, seek bar, and chapter list
- [x] 7.6 Implement lock screen / notification controls via RNTP capabilities
- [x] 7.7 Implement periodic progress auto-save; add "Listen" button to `app/book/[id].tsx`

## 8. Testing & Validation

- [x] 8.1 Write unit tests for `AudiobookMetadataService.extractFromFile` (mock `music-metadata`)
- [x] 8.2 Write unit tests for the filename numeric prefix parser
- [x] 8.3 Write unit tests for the `.cue` file parser
- [ ] 8.4 Write unit tests for `AudiobookScannerService.isAudiobookFolder` heuristic edge cases
- [ ] 8.5 Manual end-to-end test: scan a folder of mp3s, open web player, verify streaming, verify progress syncs across browser tabs
