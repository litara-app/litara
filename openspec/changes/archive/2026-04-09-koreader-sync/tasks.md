## 1. Database Schema

- [x] 1.1 Add `koReaderHash` (String?, MD5) column to `BookFile` model in `prisma/schema.prisma`
- [x] 1.2 Add `koReaderProgress`, `koReaderDevice`, `koReaderDeviceId` (String?), `koReaderTimestamp` (Int?) columns to `ReadingProgress` model
- [x] 1.3 Add `KoReaderCredential` model with `id`, `username` (unique), `passwordHash`, `userId` (FK to User, non-nullable), `createdAt`; add `@@unique([userId])` to enforce one credential per user
- [x] 1.4 Add `koReaderEnabled` (Boolean, default false) to `ServerSettings` model (implemented as key-value `koreader_enabled` following the `opds_enabled` pattern)
- [x] 1.5 Create and run Prisma migration: `npx prisma migrate dev --name add-koreader-sync`

## 2. MD5 Hash Infrastructure

- [x] 2.1 Add MD5 hash computation to `apps/api/src/library/library-scanner.service.ts` using `crypto.createHash('md5')`; read the file once and compute both MD5 and SHA-256 in a single pass
- [x] 2.2 Update `LibraryScannerService` to compute and persist `koReaderHash` when adding/updating a `BookFile`
- [x] 2.3 Add a startup backfill task in `LibraryScannerService.onModuleInit()` that computes `koReaderHash` for all `BookFile` records where it is null

## 3. KOReader Sync Module (API)

- [x] 3.1 Create `apps/api/src/koreader-sync/` with `koreader-sync.module.ts`, `koreader-sync.controller.ts`, `koreader-sync.service.ts`
- [x] 3.2 Implement `KoReaderSyncService` with methods: `authorizeUser`, `updateProgress`, `getProgress`
- [x] 3.3 Implement `KoReaderSyncController` at `@Controller('1')`:
  - `POST /users/create` → always returns `{ code: 2005, message: "User registration is disabled." }` (HTTP 403)
  - `GET /users/auth` → `authUser`
  - `PUT /syncs/progress` → `updateProgress`
  - `GET /syncs/progress/:document` → `getProgress`
  - `GET /healthcheck` → `{ state: "OK" }`
- [x] 3.4 Implement `KoReaderAuthGuard` that reads `x-auth-user` and `x-auth-key` headers and validates against `KoReaderCredential`
- [x] 3.5 Implement `KoReaderEnabledGuard` that checks `ServerSettings.koReaderEnabled`; returns HTTP 503 if false; apply globally to all `/1/` routes except `/healthcheck`
- [x] 3.6 Exclude `/1/(.*)` from the global `/api/v1` prefix in `apps/api/src/main.ts`
- [x] 3.7 Register `KoReaderSyncModule` in `AppModule`

## 4. Progress Sync Logic

- [x] 4.1 In `updateProgress`: look up `BookFile` by `koReaderHash` to find `bookId`; upsert `ReadingProgress` with `location`, `percentage`, and all KOReader fields (`koReaderProgress`, `koReaderDevice`, `koReaderDeviceId`, `koReaderTimestamp`)
- [x] 4.2 In `updateProgress`: update `Book.lastSyncedAt` (or equivalent timestamp) when progress is saved
- [x] 4.3 In `getProgress`: query `ReadingProgress` for the credential's linked `userId` + document hash; return `{}` if not found
- [x] 4.4 If document hash matches no known `BookFile`, skip `ReadingProgress` upsert and return a valid response (no orphaned records needed)

## 5. Server Settings Integration

- [x] 5.1 Add `koReaderEnabled` to `ServerSettingsDto` and `UpdateServerSettingsDto` in the admin module
- [x] 5.2 Return `koReaderEnabled` from `GET /api/v1/server/settings`
- [x] 5.3 Add step 4 to the setup stepper component in the frontend with a toggle for enabling KOReader sync

## 6. User Credentials API (Litara profile endpoints)

- [x] 6.1 Add `GET /api/v1/users/me/koreader-credentials` — returns the logged-in user's KOReader username (or null) and the sync server base URL
- [x] 6.2 Add `POST /api/v1/users/me/koreader-credentials` — creates a `KoReaderCredential` for the logged-in user (username + MD5 of provided password); returns 409 if credential already exists
- [x] 6.3 Add `DELETE /api/v1/users/me/koreader-credentials` — removes the logged-in user's `KoReaderCredential`

## 7. Frontend — KOReader Profile Section

- [x] 7.1 Add a "KOReader Sync" card to the user profile/settings page
- [x] 7.2 Show the sync server URL and current KOReader username if credentials exist
- [x] 7.3 Show a "Set up KOReader credentials" form (username + password fields) if no credentials exist
- [x] 7.4 Add a "Remove credentials" button that calls `DELETE /api/v1/users/me/koreader-credentials`

## 8. Tests

- [x] 8.1 Write unit tests for `KoReaderSyncService` covering auth, progress update, progress get, and disabled-feature guard
- [x] 8.2 Write e2e tests: registration endpoint always returns 2005, auth check, update progress, get progress, healthcheck
- [x] 8.3 Write unit test for MD5 backfill logic
