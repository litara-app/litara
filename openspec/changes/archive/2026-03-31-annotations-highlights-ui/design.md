## Context

The `Annotation` Prisma model already exists with fields `location` (EPUB CFI string), `text` (highlighted passage), `note` (user comment), and `color`. However, there is no `type` field, no API module, and no frontend code — the model is entirely dormant.

The reader is a sandboxed iframe running Foliate.js, communicating with the host `ReaderPage.tsx` via `postMessage`. Any annotation UI in the reader must go through this message bridge. Foliate.js exposes a `selections` observable and a `View` API for drawing highlights over the book content.

## Goals / Non-Goals

**Goals:**

- CRUD API for annotations with type support (HIGHLIGHT, UNDERLINE, STRIKETHROUGH, BOOKMARK)
- In-reader text selection flow: select → popover → choose style/color → save
- In-reader rendering of saved annotations at their CFI positions
- Bookmarking current page with one click
- In-reader sidebar listing and jumping to all annotations
- Global `/annotations` page (search, filter, jump-to)
- Per-book annotations tab in BookDetailModal

**Non-Goals:**

- PDF annotation support (Foliate.js PDF rendering differs significantly; deferred)
- Collaborative or shared annotations
- Annotation export (deferred)
- Annotation import from other tools

## Decisions

### 1. Annotation `type` enum via Prisma migration

The current model has no way to distinguish a bookmark from a highlight or a strikethrough. We add a `type` enum (`HIGHLIGHT`, `UNDERLINE`, `STRIKETHROUGH`, `BOOKMARK`) with `HIGHLIGHT` as the default so existing rows are unaffected.

**Alternative considered:** Use a `style` string column. Rejected — an enum is safer and self-documenting.

### 2. Highlight rendering via Foliate.js `addAnnotation` API

Foliate.js provides `view.addAnnotation(annotation)` and `view.removeAnnotation(annotation)` where annotation is `{ value: cfi, color }`. For underline and strikethrough we apply a CSS class approach: inject a custom stylesheet into the book's iframe targeting Foliate's highlight spans via `data-annotation` attributes.

**Alternative considered:** Re-implement highlights with `Range` and custom overlays. Rejected — too fragile across paginated and scrolled layouts; Foliate handles reflow automatically.

### 3. postMessage bridge extension

New message types added to the reader bridge:

| Direction       | Message type        | Purpose                                                               |
| --------------- | ------------------- | --------------------------------------------------------------------- |
| iframe → parent | `textSelected`      | User selected text; payload: `{ cfi, text }`                          |
| iframe → parent | `annotationClicked` | User clicked an existing annotation; payload: `{ annotationId, cfi }` |
| parent → iframe | `addAnnotation`     | Render a new annotation; payload: `{ id, cfi, type, color }`          |
| parent → iframe | `removeAnnotation`  | Remove rendered annotation; payload: `{ id }`                         |
| parent → iframe | `loadAnnotations`   | Bulk-load all annotations for the book; payload: `{ annotations[] }`  |
| parent → iframe | `getCurrentCfi`     | Request current page CFI (for bookmarking)                            |
| iframe → parent | `currentCfi`        | Response to `getCurrentCfi`; payload: `{ cfi }`                       |

### 4. Global annotations page as a new route

`/annotations` is added to `App.tsx` as a protected route under `AppLayout`, consistent with `/series`, `/shelf/:id`, etc. A Jotai atom `annotationsAtom` holds the paginated list. Filtering is client-side on loaded data for simplicity (annotations are not expected to be in the millions per user).

**Alternative considered:** Query-param driven server-side search. Deferred — overkill for initial release.

### 5. Annotation sidebar in reader as a slide-over panel

The reader sidebar (list of annotations) is rendered in `ReaderPage.tsx` as an absolutely-positioned panel that slides in from the right, overlapping the iframe. This keeps it outside the sandboxed iframe while still visible during reading.

**Alternative considered:** Render the sidebar inside the iframe. Rejected — would require injecting complex React UI into the sandboxed content world.

### 6. Note editor as a Mantine Popover/Modal

When a user selects text, a small Mantine `Popover` appears anchored near the selection offering color/style chips and an optional note textarea. On save, the annotation is POST'd to the API and then sent to the iframe via `addAnnotation`.

## Risks / Trade-offs

- **CFI fragility across book formats** → Foliate emits CFIs for EPUB; for MOBI/AZW the `location` string may be a Kindle-style location number. We store whatever Foliate provides and use it opaquely for jump-to. Risk is low since we never transform CFIs.
- **iframe postMessage race on load** → Annotations must be loaded after the book is ready. Mitigate by sending `loadAnnotations` only after receiving the `ready` message from the iframe.
- **Color/type combo complexity** → Bookmarks have no text selection, so `text` will be null and `color` irrelevant. The API must accept null text for BOOKMARK type. A DB constraint `CHECK (type = 'BOOKMARK' OR text IS NOT NULL)` is skipped for simplicity; enforced in the API DTO instead.
- **Foliate.js `addAnnotation` API surface** → Foliate's public API is not formally versioned. If the bundled version changes, highlight rendering may break. Mitigate by pinning the Foliate.js files in `public/foliate-js/`.

## Migration Plan

1. Add `AnnotationType` enum and `type` field (default `HIGHLIGHT`) to `prisma/schema.prisma`.
2. Run `npx prisma migrate dev --name add-annotation-type`.
3. Deploy API with the new `AnnotationsModule` before deploying the frontend (frontend gracefully handles empty annotation lists).
4. Deploy frontend — reader will start sending/receiving annotation messages once new `reader-init.js` is served.

**Rollback:** Drop the `type` column migration; disable the new API routes via feature flag if needed. Frontend degrades to no annotation UI.

## Open Questions

- Should BOOKMARK annotations show a visual indicator (ribbon icon) in the reader margins, or just appear in the sidebar list? (Assumed: sidebar list only for v1, margin icon deferred.)
- Should deleting a book cascade-delete its annotations? (Yes — already defined in Prisma schema with `onDelete: Cascade`.)
