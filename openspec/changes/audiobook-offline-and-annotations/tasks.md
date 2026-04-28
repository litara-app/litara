## 1. Database Migration — Remove AudiobookBookmark

- [x] 1.1 Write a Prisma migration that copies all `AudiobookBookmark` rows into `Annotation` (`type=BOOKMARK`, `location="audiobook:<fileIndex>:<timestamp>"`, `note=note`, `text=NULL`, `color=NULL`) within a transaction
- [x] 1.2 Drop the `AudiobookBookmark` table in the same migration
- [x] 1.3 Run `npx prisma migrate dev` and verify the migration applies cleanly
- [x] 1.4 Regenerate Prisma client and verify TypeScript compilation passes (`tsc --noEmit`)

## 2. API — Remove Bookmark Endpoints

- [x] 2.1 Delete `apps/api/src/audiobook/dto/audiobook-bookmark.dto.ts`
- [x] 2.2 Remove the three bookmark handlers (`getBookmarks`, `createBookmark`, `deleteBookmark`) from `AudiobookController`
- [x] 2.3 Run `npm run build` in `apps/api` and confirm no compilation errors

## 3. Web Player — Migrate Bookmark Panel to Annotation API

- [x] 3.1 Update `apps/web/src/components/AudiobookPlayer.tsx`: replace the `AudiobookBookmark` interface and state with the shared `Annotation` type
- [x] 3.2 Replace `GET /audiobooks/:bookId/bookmarks` with `GET /books/:bookId/annotations?type=BOOKMARK`, filtering results to entries whose `location` starts with `audiobook:`
- [x] 3.3 Replace `POST /audiobooks/:bookId/bookmarks` with `POST /books/:bookId/annotations` sending `{ type: "BOOKMARK", location: "audiobook:<fileIndex>:<timestamp>", note }`
- [x] 3.4 Replace `DELETE /audiobooks/:bookId/bookmarks/:id` with `DELETE /books/:bookId/annotations/:id`
- [x] 3.5 Parse `audiobook:<fileIndex>:<timestamp>` from the annotation location when seeking to a bookmark

## 4. Mobile Player — Migrate Bookmark Button to Annotation API

- [x] 4.1 Add `getAudiobookBookmarks`, `createAudiobookBookmark`, and `deleteAudiobookBookmark` helpers to `apps/mobile/src/api/annotations.ts` (or a new file) using the annotation endpoints
- [x] 4.2 Update `AudiobookPlayerScreen.tsx`: replace existing bookmark API calls with the new annotation helpers
- [x] 4.3 Parse `audiobook:<fileIndex>:<timestamp>` from the annotation location when seeking to a saved bookmark

## 5. Mobile — Offline Download Manager

- [x] 5.1 Add `downloadAudiobookFile(bookId, fileIndex, token, destUri)` helper to `apps/mobile/src/api/audiobooks.ts` using `FileSystem.downloadAsync` with the JWT Authorization header
- [x] 5.2 Create `apps/mobile/src/hooks/useAudiobookDownload.ts` — exposes `downloadStatus` (`not-downloaded | downloading | downloaded`), `downloadProgress` (`{ currentFile, totalFiles, filePct }`), `startDownload()`, `cancelAndDelete()`, backed by AsyncStorage key `litara-audiobook-dl-<bookId>`
- [x] 5.3 On `startDownload`, iterate over `audiobookFiles` sequentially; after each successful file write the per-file completion flag to AsyncStorage before proceeding
- [x] 5.4 On hook mount, check AsyncStorage for an in-progress download (status=`downloading`) and resume from the first file whose completion flag is absent
- [x] 5.5 Add Download / Delete UI to `AudiobookPlayerScreen.tsx`: show "Download for offline" button when `not-downloaded`, progress bar when `downloading`, and "Downloaded · Delete" row when `downloaded`

## 6. Mobile — Offline Playback

- [x] 6.1 In `AudiobookPlayerScreen.tsx`, after fetching book detail, call `FileSystem.getInfoAsync` for each expected local file path; if all files exist set a `useLocalFiles` flag
- [x] 6.2 When `useLocalFiles` is true, build `file://` URI array and skip the stream-token fetch; pass URIs to `useAudioPlayer` as normal
- [x] 6.3 Confirm partial-download scenario falls back to streaming (any missing file → `useLocalFiles = false`)

## 7. Mobile — Offline Progress Sync

- [x] 7.1 Update the progress-save logic in `AudiobookPlayerScreen.tsx`: write position to AsyncStorage (`litara-audiobook-progress-pending-<bookId>`) before attempting `saveAudiobookProgress`
- [x] 7.2 On successful API PUT, delete the pending key from AsyncStorage
- [x] 7.3 Add an `AppState` `change→active` listener that checks for any `litara-audiobook-progress-pending-*` keys and flushes them via `saveAudiobookProgress`
- [x] 7.4 Add a `useNetInfo` (or `expo-network`) connectivity listener that flushes pending progress keys when `isConnected` transitions to `true`
- [x] 7.5 Guard against double-flush: delete the pending key from AsyncStorage before making the API call so a concurrent flush skips it

## 8. Testing & Validation

- [ ] 8.1 Write unit tests for the `useAudiobookDownload` hook: mock `FileSystem` and AsyncStorage, verify resume-from-incomplete-file logic
- [ ] 8.2 Write unit tests for the offline progress sync flush: mock `saveAudiobookProgress` to reject, verify pending key is written; mock `AppState` transition, verify flush fires
- [ ] 8.3 Manual test: download a multi-file audiobook, kill the app mid-download, reopen — verify resume
- [ ] 8.4 Manual test: listen offline for several minutes, reconnect — verify position syncs to server
- [ ] 8.5 Manual test: create a bookmark in the web player, verify it appears on the Annotations page
