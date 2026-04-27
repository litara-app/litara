## Why

Audiobook listeners need offline access — commutes and travel happen without reliable connectivity, and downloading ahead of time is table-stakes for any audio player. Additionally, audiobook bookmarks currently live in a separate `AudiobookBookmark` table with dedicated endpoints, creating a fragmented annotations experience; unifying them under the existing `Annotation` model lets the annotations page, filtering, and future annotation tooling work uniformly across both ebook and audiobook content.

## What Changes

- Mobile app (`apps/mobile`) gains a download manager: users can download all audiobook files for a book to device storage, track per-book download state, and play from local files when offline
- The existing `AudiobookBookmark` model and its dedicated API endpoints (`GET/POST/DELETE /api/v1/audiobooks/:bookId/bookmarks`) are replaced by `Annotation` records with `type: BOOKMARK` and an audiobook-specific location format encoding `fileIndex` and `timestamp`
- The web and mobile audiobook players are updated to use the annotation API for bookmark CRUD instead of the old bookmark endpoints
- **BREAKING**: `AudiobookBookmark` table and its three endpoints are removed after migration of existing records to `Annotation`

## Capabilities

### New Capabilities

- `audiobook-offline-download`: Mobile-only capability to download audiobook files to device storage, track download progress and status per book, delete cached downloads, and play locally when offline

### Modified Capabilities

- `annotation-api`: Audiobook BOOKMARK annotations use `type: BOOKMARK` with location encoded as `audiobook:<fileIndex>:<timestamp>` (e.g., `audiobook:0:432.5`); `text` stores the optional user note; existing ebook CFI locations are unaffected

## Impact

- **API**: Remove `AudiobookBookmark` Prisma model and the three bookmark endpoints; add a Prisma migration to move existing `AudiobookBookmark` rows into the `Annotation` table
- **Mobile** (`apps/mobile`): New download manager screen/UI; `AudiobookPlayerScreen` updated to resolve file URIs from local storage when available; new `downloads` API module using `expo-file-system`
- **Web** (`apps/web`): Audiobook player bookmark panel updated to call annotation endpoints instead of old bookmark endpoints
- **Dependencies (Mobile)**: `expo-file-system` (already available in Expo SDK), no new packages required
