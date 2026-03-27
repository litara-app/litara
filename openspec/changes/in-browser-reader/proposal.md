## Why

Users currently have no way to read ebooks from within Litara — they must download the file and open it in a separate application. Adding an in-browser reader closes this gap, making Litara a complete self-hosted reading experience rather than just a library manager.

## What Changes

- New **Reader page** (`/read/:bookId`) that loads and renders an ebook file directly in the browser using Foliate.js
- **Reading progress** is automatically saved (CFI position for EPUB, scroll percentage for other formats) and restored when the reader is re-opened
- A **"Read" button** is added to the book detail view to launch the reader
- The existing `ReadingProgress` model is used to persist progress per user per book
- A new API endpoint serves the raw ebook file bytes to the reader page (proxied through the API to enforce authentication)

## Capabilities

### New Capabilities

- `in-browser-reader`: Renders EPUB (and optionally MOBI/CBZ) ebook files in the browser using Foliate.js; supports navigation, font/theme settings, and CFI-based position tracking
- `reader-progress-sync`: Saves and restores reading position via the existing ReadingProgress API; auto-saves on page turn and restores on reader open

### Modified Capabilities

- `reading-progress`: Add `cfi` field to `ReadingProgress` for EPUB CFI position storage alongside the existing `progress` percentage

## Impact

- **Frontend**: New `ReaderPage` component, Foliate.js integration (loaded as a Web Component via CDN or bundled), reader toolbar with settings (font size, theme)
- **Backend**: New `GET /books/:id/file` endpoint to stream the ebook file (auth-protected); existing `ReadingProgress` PATCH endpoint reused for saves
- **Database**: `ReadingProgress` may need a `cfi` text field added if not already present
- **Dependencies**: `foliate-js` (or loaded via `<script>` tag as a module); `@types` if available
- **CSP**: The reader iframe/Web Component may require CSP relaxation for blob URLs
