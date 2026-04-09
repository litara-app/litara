## Context

KOReader is the most widely used open-source e-reader application for Kindle, Kobo, and Android. It has built-in support for a "KOReader Sync Server" — a small Lua/OpenResty service that syncs reading position across devices. The protocol is simple: 5 REST endpoints, custom header-based auth, and progress keyed by an MD5 hash of the book file.

Litara already tracks reading progress (`ReadingProgress` model with `location` and `percentage`) and stores a SHA-256 file hash on `BookFile` for duplicate detection. This change adds a compatible sync API so Litara can act as the sync server, eliminating the need for a separate service.

Current state:

- `ReadingProgress` stores `location` (string CFI/page), `percentage`, `lastSyncedAt`
- `BookFile` stores `fileHash` (SHA-256), `filePath`, `format`
- Auth is JWT-based; no per-user API key mechanism exists

## Goals / Non-Goals

**Goals:**

- Implement the 5 KOReader sync endpoints with 100% protocol compatibility
- Bridge KOReader's MD5 document identifier to Litara's book records
- Store KOReader credentials (username + MD5 key) independently from Litara JWT auth
- Surface synced progress in Litara's existing reading progress system
- Allow admins to enable/disable KOReader user registration

**Non-Goals:**

- OAuth or SSO between KOReader and Litara accounts (users manage KOReader credentials separately)
- Two-way push (Litara → KOReader) — the KOReader client initiates all syncs
- Syncing annotations, bookmarks, or highlights (only reading position)
- Supporting multiple KOReader credentials per Litara user

## Decisions

### 1. URL prefix: `/1/` not `/api/v1/koreader/`

KOReader hardcodes the URL structure it expects: `POST <base_url>/1/users/create`, `PUT <base_url>/1/syncs/progress`, etc. The versioned prefix is `1`, not a path segment.

**Decision**: Mount the KOReader module at global prefix `/1/` using a dedicated NestJS module that bypasses the `/api/v1/` prefix used by the rest of the app. This is done by setting `path: '1'` in the module's controller and excluding it from the global prefix via NestJS's `app.setGlobalPrefix('api/v1', { exclude: ['/1/(.*)'] })` pattern.

**Alternative considered**: A passthrough route at `/api/v1/koreader/` with a redirect. Rejected — KOReader does not follow redirects.

### 2. Document identification: store MD5 hash on BookFile

KOReader identifies documents by an MD5 hash of the file. Litara currently stores SHA-256 hashes (`fileHash`) for duplicate detection.

**Decision**: Add a `koReaderHash` column (MD5, nullable) to `BookFile`. This is computed during the library scan alongside the existing SHA-256. When a KOReader progress update arrives with a document hash, we look up the matching `BookFile` to find the associated `Book` and `userId`, then store progress against the correct book.

**Alternative considered**: Compute MD5 on-the-fly at sync time by reading the file. Rejected — file I/O on every sync request is slow and the file may not be on the API server in all deployment scenarios.

### 3. KOReader credentials: always created through Litara profile, never via KOReader API

KOReader auth uses `x-auth-user` (a username chosen by the user) and `x-auth-key` (an MD5-hashed password). These are independent from Litara's JWT credentials.

**Decision**: Users create their KOReader credentials exclusively through the Litara profile page. `KoReaderCredential` has a non-nullable `userId` FK — every credential is always linked to a real Litara user. `POST /1/users/create` always returns "registration disabled" (error 2005).

**KOReader setup flow note**: KOReader's initial setup calls `POST /1/users/create` automatically and will show a registration error. This is cosmetic — KOReader still saves the credentials and uses them for sync. Setup instructions should tell users to create their credentials in Litara first, then enter them in KOReader.

**Why not allow KOReader API registration**: Allowing open registration via the sync API creates unlinked credential records with no Litara user, resulting in orphaned progress that is invisible in the UI. Requiring Litara-profile creation ensures every credential is tied to a user account from the start, eliminating all orphaned-record complexity.

### 4. Progress storage: extend ReadingProgress, don't create separate table

KOReader progress has extra fields not in `ReadingProgress`: `progress` (string, KOReader internal format like page number or node CFI), `device`, `device_id`, `timestamp`.

**Decision**: Add nullable columns to `ReadingProgress`: `koReaderProgress` (String?), `koReaderDevice` (String?), `koReaderDeviceId` (String?), `koReaderTimestamp` (Int?). When KOReader syncs, it upserts the `ReadingProgress` row (updating `location` = `progress`, `percentage`, and the new KO-specific fields). This keeps progress in one table and makes KOReader-synced progress visible in Litara's UI automatically.

**Alternative considered**: Separate `KoReaderProgress` table. Rejected — adds join complexity and creates two sources of truth for reading position.

### 5. KOReader feature toggle: setup stepper + server setting

The original sync server uses an environment variable to toggle registration. Litara has a `ServerSettings` model and a setup stepper for first-run configuration.

**Decision**: Add a `koReaderEnabled` boolean to `ServerSettings` (default: `false`). When `false`, all `/1/` endpoints return 503. Toggled via the existing admin settings API. A 4th step is added to the setup stepper so admins can enable/disable KOReader sync during initial setup. User registration via the sync API is always disabled regardless of this toggle — credentials are always created via the Litara profile page.

## Risks / Trade-offs

- **MD5 collision risk** → MD5 is used by KOReader for document identity, not security. Collisions are theoretically possible but negligible for a personal library. No mitigation needed.
- **Hash computation cost during scan** → Computing MD5 in addition to SHA-256 doubles hashing time. Mitigation: compute both in a single file read pass.
- **KOReader registration error on first setup** → KOReader will show a "registration disabled" error when the user first configures the sync server. Mitigation: clear setup instructions telling users to create credentials in Litara first.
- **Plaintext MD5 stored as password** → KOReader sends MD5(password) as the auth key. We store this MD5 directly. It is not reversible to plaintext, but MD5 is weak. Mitigation: document this limitation; out of scope to change the KOReader protocol.
- **No HTTPS enforcement** → The KOReader app can be configured to use HTTP. The Litara deployment docs should recommend HTTPS. Out of scope for this change.

## Migration Plan

1. Add Prisma migration: `koReaderHash` on `BookFile`, new `KoReaderCredential` model, new columns on `ReadingProgress`, `koReaderRegistrationEnabled` on `ServerSettings`
2. Backfill script: compute MD5 hashes for all existing `BookFile` records (run as a one-time task on first startup after migration)
3. New `KoReaderSyncModule` deployed alongside existing modules — no existing routes change
4. **Rollback**: remove the module and revert the migration (new columns are nullable, so rollback is non-destructive)

## Open Questions

All open questions resolved:

- **Credential management**: Users manage their own KOReader credentials via the Litara profile page. Admin does not need to be involved.
- **Book `lastSyncedAt`**: KOReader progress updates SHALL trigger a `lastSyncedAt` update on the `Book` record for correct "last read" sorting.
