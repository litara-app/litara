## 1. Dependencies & Prisma Schema

- [x] 1.1 Add `nodemailer` and `@types/nodemailer` to `apps/api/package.json`
- [x] 1.2 Add `RecipientEmail` model to `apps/api/prisma/schema.prisma` (fields: id, userId, email, label, isDefault, createdAt; relation to User with cascade delete; unique constraint on userId+email)
- [x] 1.3 Add `UserSmtpConfig` model to `apps/api/prisma/schema.prisma` (fields: id, userId unique, host, port, fromAddress, username, encryptedPassword, enableAuth, enableStartTls, createdAt, updatedAt; one-to-one relation to User with cascade delete)
- [x] 1.4 Run `prisma migrate dev --name add-recipient-emails-and-user-smtp` to generate the migration

## 2. Mail Module Scaffold

- [x] 2.1 Create `apps/api/src/mail/mail.module.ts` exporting `SmtpConfigService` and `MailService`
- [x] 2.2 Create `apps/api/src/mail/smtp-config.service.ts` with methods:
  - `getServerConfig()` — reads from `ServerSettings`; returns config without password
  - `saveServerConfig(dto)` — encrypts password, stores as JSON blob in `ServerSettings`
  - `getUserConfig(userId)` — reads `UserSmtpConfig` for user; returns config without password
  - `saveUserConfig(userId, dto)` — encrypts password, upserts `UserSmtpConfig`
  - `deleteUserConfig(userId)` — deletes `UserSmtpConfig` for user
  - `resolveConfigForSending(userId)` — returns full config with decrypted password: tries user config first, falls back to server config, throws 503 if neither exists
  - `getPasswordHint(encryptedPassword)` — returns `•••••<last3chars>` for display
- [x] 2.3 Create `apps/api/src/mail/mail.service.ts` with:
  - `sendBookFile(smtpConfig, recipientEmail, bookFilePath, bookTitle, fromAddress)` — builds a nodemailer transporter and sends the file as an attachment
  - `testConnection(smtpConfig)` — builds a transporter and calls `verify()`; returns `{ success: true }` or `{ success: false, error: string }`
- [x] 2.4 Register `MailModule` in `AppModule`

## 3. Server SMTP Settings API (Admin)

- [x] 3.1 Create `apps/api/src/mail/dto/smtp-config.dto.ts` with `SmtpConfigDto` (host, port, fromAddress, username, password optional, enableAuth, enableStartTls) and `SmtpConfigResponseDto` (same but without password; includes passwordHint string)
- [x] 3.2 Create `apps/api/src/mail/smtp-settings.controller.ts` with:
  - `GET /api/v1/settings/smtp` — admin only; returns 404 if no config
  - `PUT /api/v1/settings/smtp` — admin only; stores config; returns response without password
  - `POST /api/v1/settings/smtp/test` — admin only; tests connection without saving; returns `{ success, error? }`
  - All endpoints guarded by `JwtAuthGuard` + `RolesGuard` (ADMIN)
- [x] 3.3 Add Swagger decorators (`@ApiBearerAuth`, `@ApiOperation`, `@ApiResponse`) to the controller
- [x] 3.4 Register `SmtpSettingsController` in `MailModule`

## 4. Per-User SMTP Settings API

- [x] 4.1 Create `apps/api/src/mail/user-smtp.controller.ts` with:
  - `GET /api/v1/users/me/smtp` — returns user's SMTP config without password; 404 if not set
  - `PUT /api/v1/users/me/smtp` — upserts user's SMTP config; omits password from response
  - `DELETE /api/v1/users/me/smtp` — removes user's SMTP config; returns 204
  - `POST /api/v1/users/me/smtp/test` — tests connection without saving; uses saved password if field omitted; returns `{ success, error? }`; returns 422 if no password available
  - All endpoints guarded by `JwtAuthGuard`
- [x] 4.2 Add Swagger decorators to the user SMTP controller
- [x] 4.3 Register `UserSmtpController` in `MailModule`

## 5. Recipient Emails API (Per-User)

- [x] 5.1 Create `apps/api/src/mail/dto/recipient-email.dto.ts` with `CreateRecipientEmailDto` (email, label optional) and `RecipientEmailResponseDto` (id, email, label, isDefault, createdAt)
- [x] 5.2 Create `apps/api/src/mail/recipient-email.service.ts` with methods:
  - `list(userId)` — ordered by createdAt asc
  - `create(userId, dto)` — auto-sets isDefault if first; 409 on duplicate email
  - `delete(userId, id)` — promotes earliest remaining to default if deleted was default; uses transaction
  - `setDefault(userId, id)` — atomic transaction: unset current default, set new default; idempotent if already default
- [x] 5.3 Create `apps/api/src/mail/recipient-email.controller.ts` with:
  - `GET /api/v1/users/me/recipient-emails`
  - `POST /api/v1/users/me/recipient-emails`
  - `DELETE /api/v1/users/me/recipient-emails/:id`
  - `PATCH /api/v1/users/me/recipient-emails/:id/default`
  - All guarded by `JwtAuthGuard`
- [x] 5.4 Add Swagger decorators to the recipient email controller
- [x] 5.5 Register `RecipientEmailController` and `RecipientEmailService` in `MailModule`

## 6. Send Book Endpoint

- [x] 6.1 Create `apps/api/src/mail/dto/send-book.dto.ts` with `SendBookDto` (recipientEmailId optional string, fileId optional string)
- [x] 6.2 Add `sendBook(userId, bookId, dto)` method to `MailService`:
  - Resolve recipient: use `recipientEmailId` if provided (must belong to user → 404 if not); else use user's default → 422 if none
  - Resolve file: use `fileId` if provided (must belong to book → 404 if not); else prefer EPUB `BookFile`; else first `BookFile`; 422 if no files
  - Resolve SMTP: call `resolveConfigForSending(userId)` (throws 503 if neither user nor server config exists)
  - Send via `MailService.sendBookFile`; surface SMTP errors as 502
- [x] 6.3 Add `POST /api/v1/books/:id/send` endpoint to `BooksController` (or a dedicated controller), guarded by `JwtAuthGuard`; accepts `SendBookDto` body; returns `{ message: 'Book sent successfully' }` on 200
- [x] 6.4 Add Swagger decorators to the send endpoint
- [x] 6.5 Ensure `MailModule` is imported wherever the send endpoint lives

## 7. Frontend — Server SMTP Settings (Admin)

- [x] 7.1 Add server SMTP settings form to the admin settings panel: inputs for host, port, fromAddress, username, password (write-only; show password hint if config exists), enableAuth checkbox, enableStartTls checkbox, and a **Test Connection** button
- [x] 7.2 Wire form to `GET /api/v1/settings/smtp` (populate non-password fields on load) and `PUT /api/v1/settings/smtp` (submit; only include password in payload if the field was changed)
- [x] 7.3 Wire **Test Connection** button to `POST /api/v1/settings/smtp/test`; show inline success/error result without saving

## 8. Frontend — Per-User SMTP Settings (User Settings)

- [x] 8.1 Add per-user SMTP settings form to the user settings page: same fields as admin form plus a **Test Connection** button
- [x] 8.2 Wire form to `GET /api/v1/users/me/smtp`, `PUT /api/v1/users/me/smtp`, and `DELETE /api/v1/users/me/smtp`
- [x] 8.3 Wire **Test Connection** button to `POST /api/v1/users/me/smtp/test`; show inline result

## 9. Frontend — Recipient Email Management (User Settings)

- [x] 9.1 Add recipient email list/management section to user settings: display list of saved addresses with default badge, add form (email + optional label), delete button per entry, "Set as default" button for non-default entries
- [x] 9.2 Wire to `GET`, `POST`, `DELETE`, and `PATCH .../default` recipient email endpoints

## 10. Frontend — Send Button (Book Detail Modal)

- [x] 10.1 Add a **Send** button to the book detail modal. If the book has multiple `BookFile` records, show a format dropdown (listing each file's format/extension) defaulting to EPUB if available.
- [x] 10.2 Before sending: check the selected `BookFile.size` against the threshold (25 MB). If exceeded, show an inline warning and require the user to click **Send anyway** to confirm. If `size` is absent, skip the check.
- [x] 10.3 Allow selecting a recipient from a dropdown (populated from `GET /users/me/recipient-emails`), defaulting to the default address.
- [x] 10.4 Wire send action to `POST /api/v1/books/:id/send` with `{ fileId, recipientEmailId }`; show success notification on 200; show error notification with the error message on failure.

## 11. Tests

- [x] 11.1 Write e2e tests for `GET/PUT /api/v1/settings/smtp` (admin-only, password omitted from response, sentinel pattern)
- [x] 11.2 Write e2e tests for `POST /api/v1/settings/smtp/test` (admin-only, success and failure cases)
- [x] 11.3 Write e2e tests for `GET/PUT/DELETE /api/v1/users/me/smtp` (any authenticated user, password omitted)
- [x] 11.4 Write e2e tests for `POST /api/v1/users/me/smtp/test` (password sentinel and missing-password cases)
- [x] 11.5 Write e2e tests for recipient email CRUD: list, create (auto-default on first), delete (promotes next default), set default (atomic swap, idempotent if already default)
- [x] 11.6 Write e2e tests for `POST /api/v1/books/:id/send`:
  - No SMTP config at all → 503
  - User SMTP used when present (server config also present — user takes precedence)
  - Server SMTP fallback when no user config
  - No default recipient → 422
  - Book not found → 404
  - Another user's `recipientEmailId` → 404
  - Invalid `fileId` (not belonging to book) → 404
  - EPUB preferred when multiple formats (no `fileId` provided)
  - Explicit `fileId` overrides EPUB preference

## 12. Documentation

- [x] 12.1 Update `apps/docs/docs/configuration.md` — add a note that rotating `JWT_SECRET` requires all users and the admin to re-enter their SMTP passwords
- [x] 12.2 Update `apps/api/.env.example` if any new optional env vars are added
