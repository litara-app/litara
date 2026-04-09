## Why

KOReader is a popular open-source e-reader application used on Kindle, Kobo, and Android devices. It supports syncing reading progress via the KOReader Sync Server protocol, but currently requires a separate server. Implementing this protocol natively in Litara allows users to use Litara as their single self-hosted backend — eliminating the need to run a separate sync service and keeping reading progress in sync across all their KOReader devices.

## What Changes

- New KOReader-compatible sync API mounted at `/1/` (the versioned prefix KOReader expects)
- New sync credentials system: KOReader uses its own username/password (MD5-hashed key) separate from Litara's JWT auth, linked to a Litara user account
- Reading progress stored per-document (identified by MD5 hash of the book file) per user
- New `KoReaderSyncModule` in the API exposing 5 endpoints matching the KOReader sync protocol exactly
- The `ReadingProgress` model extended (or a new `KoReaderProgress` model added) to store KOReader-specific progress fields (`progress` string, `device`, `device_id`, `timestamp`)
- Admin UI setting to enable/disable new user registration via the KOReader sync endpoint

## Capabilities

### New Capabilities

- `koreader-sync-api`: KOReader-compatible REST API (`/1/users/create`, `/1/users/auth`, `/1/syncs/progress`) with the exact request/response contract that KOReader devices expect
- `koreader-sync-credentials`: Per-user KOReader sync credentials (username + MD5 key) stored and managed independently of Litara's JWT auth system

### Modified Capabilities

- `reading-progress`: The existing reading progress tracking will be extended to also store KOReader progress data (CFI/page string, device name, device_id, unix timestamp) so that progress synced from KOReader is visible in the Litara UI

## Impact

- **API**: New `KoReaderSyncModule` with controller + service; new route prefix `/1/` (does not conflict with existing `/api/v1/`)
- **Database**: New `KoReaderCredential` model (username, MD5 key, linked userId) and new fields on `ReadingProgress` or a new `KoReaderProgress` table
- **Frontend**: Minor — a settings page entry to show the user their KOReader sync URL and credentials
- **Dependencies**: No new packages required (MD5 hashing via built-in `crypto`, existing Prisma/NestJS stack)
