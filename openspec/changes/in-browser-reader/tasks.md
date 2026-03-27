## 1. Backend: File Serving Endpoint

- [x] 1.1 Add `GET /books/:id/file` to `BooksController` — stream the raw ebook file with `res.sendFile()`, preferring EPUB when multiple files exist
- [x] 1.2 Add `Content-Type` and `Content-Disposition: inline` headers based on file format
- [x] 1.3 Protect the endpoint with `JwtAuthGuard` and return 404 if the book or file is not found
- [x] 1.4 Add Swagger `@ApiOkResponse` decorator and `@ApiBearerAuth()` to the endpoint

## 2. Backend: Reading Progress API

- [x] 2.1 Create `reading-progress` module with service and controller under `src/reading-progress/`
- [x] 2.2 Implement `GET /books/:id/progress` — returns the current user's `ReadingProgress` or 404
- [x] 2.3 Implement `PATCH /books/:id/progress` — upserts `ReadingProgress` with `{ location, percentage }`
- [x] 2.4 Create `UpsertReadingProgressDto` with `location: string` and `percentage: number` fields and Swagger decorators
- [x] 2.5 Create `ReadingProgressResponseDto` with `location`, `percentage`, `lastSyncedAt` and Swagger decorators
- [x] 2.6 Register `ReadingProgressModule` in `AppModule`

## 3. Frontend: Foliate.js Setup

- [x] 3.1 Download the Foliate.js release assets (reader core files) into `apps/web/public/foliate-js/`
- [x] 3.2 Create the reader iframe HTML template at `apps/web/public/reader.html` — loads Foliate.js modules, initialises `<foliate-view>`, and listens for `postMessage` commands from the parent
- [x] 3.3 Implement `postMessage` protocol between parent React page and reader iframe: commands (`open`, `next`, `prev`, `goto`, `setTheme`, `setFontSize`) and events (`relocate`, `ready`, `error`)

## 4. Frontend: Reader Page

- [x] 4.1 Create `apps/web/src/pages/ReaderPage.tsx` as a full-page route (no AppLayout wrapper)
- [x] 4.2 On mount, fetch `GET /api/v1/books/:id/progress` to get saved position; if found pass it to the iframe `open` command
- [x] 4.3 Render the reader iframe pointing at `/reader.html` with `sandbox="allow-scripts allow-same-origin"`
- [x] 4.4 Implement toolbar with prev/next buttons, exit button, font size stepper, and theme selector (light/sepia/dark)
- [x] 4.5 Wire keyboard arrow-key navigation (left/right) to prev/next page commands
- [x] 4.6 Implement debounced progress save: on `relocate` event from iframe, PATCH `/api/v1/books/:id/progress` with a 1-second debounce
- [x] 4.7 Save progress on `beforeunload` (synchronous, use `navigator.sendBeacon` or sync XHR as fallback)
- [x] 4.8 Persist font size and theme preference to `localStorage`; restore on mount

## 5. Frontend: Integration

- [x] 5.1 Add route `/read/:bookId` to the React Router config, rendering `ReaderPage` outside the `AppLayout`
- [x] 5.2 Add a "Read" button to the book detail modal/page that navigates to `/read/:bookId` (only shown when the book has an EPUB file)
- [x] 5.3 Show a reading progress bar or percentage on book cards in the library where `ReadingProgress.percentage` is set

## 6. Wrap-up

- [x] 6.1 Run `tsc --noEmit` on `apps/api` and `apps/web` — fix any type errors
- [ ] 6.2 Verify the reader opens, navigates, and saves progress end-to-end with a real EPUB
- [x] 6.3 Add `@ApiBearerAuth()` and Swagger decorators on all new endpoints; run `npm run build` to confirm no compile errors
