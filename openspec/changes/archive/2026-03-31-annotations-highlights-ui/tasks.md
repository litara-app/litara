## 1. Database Migration

- [x] 1.1 Add `AnnotationType` enum (`HIGHLIGHT`, `UNDERLINE`, `STRIKETHROUGH`, `BOOKMARK`) to `apps/api/prisma/schema.prisma`
- [x] 1.2 Add `type AnnotationType @default(HIGHLIGHT)` field to the `Annotation` model
- [x] 1.3 Run `npx prisma migrate dev --name add-annotation-type` and commit the migration file

## 2. Annotation API — Backend

- [x] 2.1 Create `apps/api/src/annotations/dto/create-annotation.dto.ts` with fields: `location`, `type`, `text?`, `note?`, `color?` with class-validator decorators
- [x] 2.2 Create `apps/api/src/annotations/dto/update-annotation.dto.ts` with fields: `note?`, `color?`, `type?`
- [x] 2.3 Create `apps/api/src/annotations/annotations.service.ts` with methods: `create`, `findAllByBook`, `findAllByUser`, `update`, `remove`; enforce user ownership on update/delete (return 404 if not owner)
- [x] 2.4 Create `apps/api/src/annotations/annotations.controller.ts` with routes: `POST /books/:bookId/annotations`, `GET /books/:bookId/annotations`, `PATCH /books/:bookId/annotations/:id`, `DELETE /books/:bookId/annotations/:id`, `GET /annotations`; add `@ApiBearerAuth()` and Swagger decorators on all endpoints; add `?type=` query param support on `GET /annotations`
- [x] 2.5 Create `apps/api/src/annotations/annotations.module.ts` and register in `AppModule`
- [x] 2.6 Run `npm run build` in `apps/api` and fix any TypeScript errors

## 3. Annotation API — Frontend Service

- [x] 3.1 Create `apps/web/src/api/annotations.ts` with typed functions: `createAnnotation`, `listBookAnnotations`, `listAllAnnotations` (accepts optional `type` filter), `updateAnnotation`, `deleteAnnotation`; use the shared axios instance from `src/utils/api.ts`
- [x] 3.2 Create `apps/web/src/hooks/useBookAnnotations.ts` — fetches annotations for a given `bookId`, exposes `annotations`, `createAnnotation`, `updateAnnotation`, `deleteAnnotation`, `isLoading`
- [x] 3.3 Create `apps/web/src/hooks/useAllAnnotations.ts` — fetches all annotations with optional type/search state, used by the global annotations page

## 4. Reader Bridge — postMessage Protocol Extension

- [x] 4.1 In `apps/web/public/reader-init.js`, add a `selectionchange` / `pointerup` listener on the book's document to detect text selection; when selection is non-empty, post `{ type: 'textSelected', cfi, text }` to the parent
- [x] 4.2 In `reader-init.js`, handle incoming `addAnnotation` messages by calling `view.addAnnotation({ value: cfi, color })` and attaching a `data-annotation-id` attribute for underline/strikethrough CSS targeting
- [x] 4.3 In `reader-init.js`, handle incoming `removeAnnotation` messages by calling `view.removeAnnotation({ value: cfi })`
- [x] 4.4 In `reader-init.js`, handle incoming `loadAnnotations` message by iterating the array and calling `addAnnotation` for each entry
- [x] 4.5 In `reader-init.js`, handle incoming `getCurrentCfi` message by posting back `{ type: 'currentCfi', cfi: currentCfi }` using the last-known relocate CFI
- [x] 4.6 In `reader-init.js`, add a click listener on annotated spans to post `{ type: 'annotationClicked', annotationId, cfi }` to the parent
- [x] 4.7 In `reader-init.js`, inject a `<style>` block for underline (`text-decoration: underline`) and strikethrough (`text-decoration: line-through`) CSS classes applied to annotated spans via Foliate's highlight span targeting

## 5. Reader Page — Annotation UI

- [x] 5.1 In `apps/web/src/pages/ReaderPage.tsx`, handle the `textSelected` message: store `pendingSelection = { cfi, text }` in state and show the `HighlightPopover`
- [x] 5.2 Create `apps/web/src/components/Reader/HighlightPopover.tsx` — a Mantine `Popover` component with color chips (yellow, green, blue, pink), style buttons (underline, strikethrough), an optional note textarea, and Save/Cancel actions; on save calls `createAnnotation` and sends `addAnnotation` to iframe
- [x] 5.3 In `ReaderPage.tsx`, handle the `annotationClicked` message: show `HighlightPopover` pre-populated with the existing annotation's data (note, color, type) with a Save and Delete action
- [x] 5.4 In `ReaderPage.tsx`, after the `ready` message, fetch all annotations via `useBookAnnotations` and send `loadAnnotations` to the iframe
- [x] 5.5 In `ReaderPage.tsx`, add a bookmark toolbar button; on click, send `getCurrentCfi` to iframe and on receiving `currentCfi`, check for an existing bookmark at that CFI — if none, create a BOOKMARK annotation; if one exists, delete it
- [x] 5.6 Update the bookmark button visual state (filled vs outline icon) based on whether the current CFI has an existing bookmark annotation

## 6. Reader Annotations Sidebar

- [x] 6.1 Create `apps/web/src/components/Reader/AnnotationsSidebar.tsx` — a slide-in panel positioned absolutely over the reader; lists all annotations grouped/ordered by CFI location; each row shows type badge, text snippet, note preview, and delete button
- [x] 6.2 In `ReaderPage.tsx`, add a sidebar toggle button to the reader toolbar; wire it to open/close `AnnotationsSidebar`
- [x] 6.3 In `AnnotationsSidebar`, handle clicking an annotation row: send `{ type: 'goto', cfi }` to the reader iframe
- [x] 6.4 In `AnnotationsSidebar`, handle delete: call `deleteAnnotation`, remove from local state, and send `removeAnnotation` to the iframe
- [x] 6.5 In `ReaderPage.tsx`, sync new/deleted annotations between the sidebar list and the iframe rendered annotations

## 7. Book Detail Modal — Annotations Tab

- [x] 7.1 Create `apps/web/src/components/BookDetailModal/BookAnnotationsTab.tsx` — displays annotation list items with type badge, text snippet, note, color swatch, date; includes a search input filtering by text/note; each row has a jump button and delete button
- [x] 7.2 In `BookDetailModal.tsx`, add the "Annotations" tab to the `Tabs` component (after the existing Sidecar tab); render `BookAnnotationsTab` as its content, passing `bookId`
- [x] 7.3 In `BookAnnotationsTab`, handle the jump button: close the modal and navigate to `/read/:bookId?cfi=<cfi>` (or use the existing reader navigation pattern)
- [x] 7.4 In `BookAnnotationsTab`, handle delete: call `deleteAnnotation` and remove from the list

## 8. Global Annotations Page

- [x] 8.1 Create `apps/web/src/pages/AnnotationsPage.tsx` — fetches all user annotations via `useAllAnnotations`; renders annotation cards with book cover thumbnail, book title, type badge, text snippet, note, date, jump button, and delete button
- [x] 8.2 Add search input and type filter (All / Highlights / Underlines / Strikethroughs / Bookmarks) chips/tabs to `AnnotationsPage`; filter is applied client-side
- [x] 8.3 Add empty state to `AnnotationsPage` when no annotations match
- [x] 8.4 In `apps/web/src/App.tsx`, add a protected route `<Route path="/annotations" element={<AnnotationsPage />} />` inside the AppLayout protected routes
- [x] 8.5 In `apps/web/src/components/AppLayout/NavbarContent.tsx`, add an "Annotations" nav item with `IconBookmarks` icon linking to `/annotations`, positioned after the "Series" item

## 9. Verification

- [x] 9.1 Run `npm run build` from the repo root and confirm zero TypeScript errors
- [ ] 9.2 Manually test: open a book → select text → apply a yellow highlight → verify it persists after closing and reopening the reader
- [ ] 9.3 Manually test: bookmark a page → verify it appears in the reader sidebar and on the global annotations page
- [ ] 9.4 Manually test: open BookDetailModal → Annotations tab → verify annotations listed, search works, jump navigates correctly
- [ ] 9.5 Verify that deleting an annotation in any location (reader sidebar, modal tab, annotations page) removes it everywhere
