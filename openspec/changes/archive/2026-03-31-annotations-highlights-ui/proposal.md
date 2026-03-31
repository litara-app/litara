## Why

Readers want to highlight passages, add personal notes, and bookmark pages as they read — but Litara has no UI for this despite the data model already being in place. The Annotation model (CFI location, text, note, color) exists in the schema but has zero API endpoints and zero frontend code, making it entirely unused.

## What Changes

- **New annotation API module** — CRUD endpoints for annotations (create, list by book, update, delete)
- **Reader text-selection UI** — selecting text in the reader shows a popover to highlight (with color/style choice) or add a note
- **Reader annotations sidebar** — a collapsible in-reader panel listing all highlights, notes, and bookmarks for the current book with jump-to navigation
- **Reader bookmark action** — a toolbar button to bookmark the current page/location
- **Book detail modal tab** — new "Annotations" tab showing all annotations for the book with search
- **Global annotations page** — new route `/annotations` with a page listing all annotations across all books, searchable and filterable; entries link back to the reader at that location
- **Navbar link** — new nav item "Annotations" linking to `/annotations`
- **Schema migration** — add `type` field to `Annotation` model (`HIGHLIGHT`, `UNDERLINE`, `STRIKETHROUGH`, `BOOKMARK`) since the current model has no way to distinguish annotation style from bookmarks

## Capabilities

### New Capabilities

- `annotation-api`: REST API module for creating, reading, updating, and deleting annotations; includes type field migration
- `reader-annotations`: In-reader UI for text selection → highlight/note/bookmark creation, rendering existing annotations, and an in-reader annotations sidebar
- `annotations-page`: Global `/annotations` page and navbar entry for browsing, searching, and jumping to all annotations across books
- `book-annotations-tab`: "Annotations" tab inside the BookDetailModal showing per-book annotations with search

### Modified Capabilities

- None

## Impact

- **Backend:** New `AnnotationsModule` (controller, service, DTOs). Prisma migration to add `type` enum to `Annotation` model.
- **Frontend:** New page `AnnotationsPage`, new hook `useAnnotations`, new components (`AnnotationsSidebar`, `HighlightPopover`, `BookAnnotationsTab`). Additions to `NavbarContent`, `BookDetailModal`, and `ReaderPage`.
- **Reader bridge:** `reader-init.js` and `ReaderPage.tsx` postMessage protocol extended for selection events, annotation rendering, and bookmark actions.
- **Routing:** New `/annotations` route added to `App.tsx`.
- **State:** Jotai atoms for annotation list (per-book in reader, global on annotations page).
