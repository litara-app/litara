## Context

Litara stores ebook files on disk and tracks `ReadingProgress` per user per book in the database (with `location: String` for CFI/position and `percentage: Float`), but has no reader UI. Foliate.js is a browser-native ebook rendering library that works as a set of ES modules with a custom `<foliate-view>` Web Component — it handles EPUB, CBZ, and FB2 natively in the browser without a server-side rendering step.

The existing `ReadingProgress` model is already designed for this: `location` stores a format-specific position string (EPUB CFI), and `percentage` tracks overall completion.

## Goals / Non-Goals

**Goals:**

- Render EPUB files in the browser using Foliate.js
- Save reading position (CFI + percentage) automatically on page turn
- Restore position when the reader is re-opened
- Minimal viable reader UI: prev/next navigation, font size adjustment, light/dark/sepia theme
- Auth-protected file serving endpoint so the reader can fetch the raw ebook bytes

**Non-Goals:**

- MOBI/AZW rendering (Foliate.js supports these but they require server-side conversion; defer to a later iteration)
- CBZ reading in the browser (Foliate.js supports it, but UX needs separate design)
- Annotation creation from within the reader (existing annotation model exists; defer)
- Offline/PWA support
- Mobile-optimised layout (functional on mobile but not specifically designed for it)

## Decisions

### 1. Foliate.js loading strategy: bundled npm package vs CDN script

**Decision:** Vendor Foliate.js by copying its ES module files into `apps/web/public/foliate-js/` and loading them via a `<script type="module">` tag injected into a sandboxed `<iframe>`.

**Rationale:** Foliate.js is not structured as a standard importable npm package — it uses dynamic `import()` calls with relative paths that assume a specific directory layout. The recommended approach (per their docs) is to serve the files from a known path. Bundling through Vite breaks these relative imports. Serving from `public/` keeps them as static assets with predictable URLs.

**Alternative considered:** Loading from a CDN (jsDelivr). Rejected because it requires an internet connection and creates a CSP `script-src` exception pointing at a third-party origin.

### 2. File serving: dedicated endpoint vs OPDS stream

**Decision:** Add `GET /api/v1/books/:id/file` to the existing books controller. It reads the `BookFile.filePath`, streams the file with `res.sendFile()`, and enforces JWT auth via the existing guard.

**Rationale:** The OPDS endpoints already do similar streaming but are unauthenticated (OPDS spec requirement). The reader must be auth-gated, so a separate endpoint is cleaner.

### 3. Reader architecture: full page vs modal

**Decision:** Full-page route `/read/:bookId` that replaces the main layout entirely — no navbar, no sidebar.

**Rationale:** Readers need maximum vertical space. A modal or panel inside the main layout wastes space with unnecessary chrome. An "exit reader" button returns the user to the previous page via `history.back()`.

### 4. Progress saving: debounced vs on-every-turn

**Decision:** Debounced PATCH to `ReadingProgress` on the `relocate` event from Foliate.js, with a 1-second debounce. Also save on reader unmount (beforeunload).

**Rationale:** The `relocate` event fires on every page turn. Debouncing prevents a flood of API calls when the user rapidly pages through. The `beforeunload` save catches the session-end case.

### 5. Iframe sandbox

**Decision:** Render Foliate.js inside a sandboxed `<iframe>` with `allow-scripts allow-same-origin`. The parent React page communicates with it via `postMessage`.

**Rationale:** Foliate.js requires a DOM to render into and uses dynamic imports. Running it in an iframe isolates ebook content (which may contain arbitrary HTML/JS) from the parent app, satisfying the existing CSP requirement from CLAUDE.md. `allow-same-origin` is required so the iframe can fetch the ebook file from the same origin.

## Risks / Trade-offs

- **Foliate.js API stability** → The library's API (events, methods) is still evolving. Pin a specific commit/release in `public/foliate-js/` and document the pinned version. Migration path: update the vendored files and test.
- **Large EPUB files** → `res.sendFile()` streams from disk and avoids buffering in memory, so even large files are fine. The browser loads the EPUB in chunks via Foliate.js's internal fetch logic.
- **CFI precision** → CFI strings are EPUB-specific. PDFs and CBZ files use a percentage position instead. The `location` field stores either; the reader page selects the save format based on the book's format.
- **CSP for iframe** → The `<iframe>` loads from the same origin so no CSP changes are needed for script execution. Ebook content is further sandboxed within Foliate.js's own iframe rendering.

## Open Questions

- Should the reader support EPUB books that have multiple `BookFile` records (e.g., EPUB + MOBI)? **Proposed:** always prefer the EPUB file if one exists; fall back to the first file.
- Font/theme preferences: per-book or global? **Proposed:** store in `localStorage` as a global preference (same as most e-readers).
