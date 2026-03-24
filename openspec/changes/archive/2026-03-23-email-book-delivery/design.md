## Context

Litara users want to send ebooks to their Kindle (or any email-based reader) without leaving the UI. The Kindle delivery ecosystem is email-based: users add a sender address to their approved list, then email a book file as an attachment to their device's `@kindle.com` address.

The API already has a `ServerSettings` key-value store and a `User` model. The admin module handles server-level configuration. There is no existing email or notification infrastructure.

## Goals / Non-Goals

**Goals:**

- Allow each user to configure their own SMTP server for sending
- Allow an admin to configure a single server-level SMTP as a shared fallback for users without personal SMTP config
- Allow each user to manage their personal list of recipient email addresses with a default
- Allow any authenticated user to send a supported book file to a recipient address via SMTP
- Store SMTP passwords encrypted at rest; never return them to the frontend after saving
- Provide a "test connection" button for both user and admin SMTP forms
- Prefer EPUB format when multiple formats are available for quick send; allow format selection via dropdown
- Perform client-side file size checks before initiating a send

**Non-Goals:**

- Multiple SMTP configurations per user
- Delivery status tracking / read receipts
- Push notifications or webhooks on delivery failure
- Support for OAuth 2.0 / XOAUTH2 (Gmail modern auth) — app passwords cover that use case
- Bulk send to multiple recipients in one action
- On-the-fly file format conversion

## Decisions

### 1. SMTP config storage: JSON blob in `ServerSettings` for server config; dedicated `UserSmtpConfig` model for per-user config

Store the server-level SMTP config as a single JSON blob at `key = 'smtp_config'` in the existing `ServerSettings` table. Store per-user SMTP config in a new `UserSmtpConfig` model (one-to-one with `User`), with the same fields as the server config.

**Why:** The `ServerSettings` pattern is already established for server config. Per-user SMTP warrants a dedicated model for relational integrity (cascade delete when user is removed), indexed lookup, and clean type separation. A JSON column on `User` would conflate user identity data with mail settings.

**Alternative considered:** Storing per-user SMTP as a JSON column on the `User` model. Simpler schema but mixes concerns and makes the password encryption/omission logic harder to isolate.

### 2. Password encryption: AES-256-GCM with JWT_SECRET

Encrypt all SMTP passwords (both server and per-user) before writing to the database using AES-256-GCM. Derive the 32-byte key from `JWT_SECRET` via `crypto.scryptSync`. Store the iv + authTag + ciphertext as a single base64 string.

**Why:** No new environment variable needed for the minimal deployment case. AES-GCM provides authenticated encryption (detects tampering). `scrypt` key derivation is intentionally slow, making brute-force against a leaked `JWT_SECRET` harder.

**Alternative considered:** Separate `SMTP_ENCRYPTION_KEY` env var. Cleaner separation of concerns and allows rotating SMTP key independently of JWT sessions. However, it adds operational complexity for self-hosters. Noted as a possible future improvement.

**Security constraint:** The SMTP password field MUST be omitted from all GET responses. The frontend should display a placeholder (`•••••xyz`) showing only the last 3 characters, and only send a new password when the user has explicitly changed it (sentinel pattern: omitting the password field on PUT means "keep existing").

### 3. Recipient emails: dedicated `RecipientEmail` Prisma model

Add a `RecipientEmail` model scoped to `User` rather than storing recipient emails in `ServerSettings` or in a JSON column on `User`.

**Why:** Enables per-user CRUD with a default flag, indexed queries, and relational integrity (cascade delete when user is removed). Keeps user data separate from server config.

### 4. Email sending: nodemailer in a dedicated `MailModule`

Use `nodemailer` (the de-facto Node.js SMTP client) in a new `MailModule` containing `SmtpConfigService` (config persistence for both server and per-user) and `MailService` (sending). Expose config endpoints via the existing admin area (server) and via `/users/me/smtp` (per-user).

**Why:** nodemailer handles STARTTLS negotiation, auth variants (PLAIN, LOGIN, OAuth2), and connection pooling out of the box. A dedicated module keeps email concerns isolated and testable.

### 5. SMTP resolution order: user config → server config → 503

When sending a book, the system resolves SMTP config in this order:

1. The requesting user's personal `UserSmtpConfig` (if configured)
2. The server-level SMTP config from `ServerSettings`
3. If neither exists: return 503 Service Unavailable

**Why:** This matches the stated expectation that most users will configure their own SMTP (e.g., for Kindle's approved sender list), while the server config acts as a convenient shared fallback for deployments where the admin manages a single outbound mail account.

### 6. Book file selection: prefer EPUB for quick send; accept `fileId` for explicit selection

`POST /api/v1/books/:id/send` without a `fileId` body field will:

1. Select the EPUB file if one exists among the book's `BookFile` records
2. Fall back to the first `BookFile` by creation order if no EPUB is present

When a `fileId` is provided, that specific `BookFile` is used (must belong to the book and exist).

**Why:** EPUB is the most widely supported format for email-based delivery (Kindle, Kobo, etc.). The dropdown in the UI enables power users to select a different format (e.g., MOBI for older Kindles) without making the common case more complex.

### 7. Test connection: dedicated test endpoints, not a flag on PUT

`POST /api/v1/users/me/smtp/test` and `POST /api/v1/settings/smtp/test` accept the same fields as the PUT config endpoints. They attempt to open and verify an SMTP connection (nodemailer `verify()`) and return success or an error message — without saving anything.

**Why:** Separating test from save keeps the PUT idempotent and side-effect-free. Users can test draft settings before committing. Accepting the full config body (including optional password) means the test works both for unsaved configs and for re-testing saved ones (using the sentinel pattern for the password).

### 8. Client-side file size check: frontend responsibility, size exposed via BookFile

The frontend reads the `size` field from the `BookFile` record (already tracked in bytes) and warns the user before sending if the file exceeds a configurable threshold (default: 25 MB — the Gmail limit). No server-side enforcement in v1.

**Why:** The server cannot know the SMTP server's attachment limit ahead of time; each provider differs. A client-side check based on well-known limits (Gmail: 25 MB) prevents the most common failure case before a round-trip. If the SMTP server enforces a different limit, the 502 error response still surfaces the rejection message to the user.

### 9. Default recipient update: atomic transaction

`PATCH /users/me/recipient-emails/:id/default` unsets the current default and sets the new one in a single Prisma transaction.

**Why:** A sequential two-step update creates a window where either no address is the default or two addresses are. Transactions eliminate this race condition.

## Risks / Trade-offs

- **JWT_SECRET rotation invalidates SMTP passwords** — Rotating `JWT_SECRET` will corrupt all stored SMTP passwords (both server and per-user) because the decryption key changes. → Mitigation: document this in configuration docs; after rotation, all users and the admin must re-enter their SMTP passwords.
- **Per-user SMTP increases support complexity** — Each user managing their own SMTP credentials means more varied configurations and more potential failure modes. → Mitigation: the test connection button surfaces errors before users try to send a book.
- **nodemailer is a large dependency** — It pulls in several sub-packages. → Acceptable for a first-party email feature; no lighter alternative matches its feature set.
- **No send confirmation to user** — The API returns 200/202 on send but does not track whether the email was actually delivered. → Mitigation: surface the `nodemailer` rejection error in the API response so the user sees SMTP errors immediately.
- **Client-side size checks are advisory** — Large files may still fail at the SMTP layer. → Mitigation: the 502 error response includes the SMTP rejection message so the user understands why.

## Migration Plan

1. Add `RecipientEmail` and `UserSmtpConfig` models to `prisma/schema.prisma`.
2. Run `prisma migrate dev --name add-recipient-emails-and-user-smtp` to generate and apply the migration.
3. No data migration needed — `smtp_config` is written on first admin save; `RecipientEmail` and `UserSmtpConfig` rows are user-created.
4. Rollback: drop `RecipientEmail` and `UserSmtpConfig` tables; delete the `smtp_config` `ServerSettings` row.
