## Why

Users want to send ebooks directly to their Kindle (or any email-based ebook receiver) from the Litara UI. The Kindle ecosystem's primary delivery mechanism is "Send to Kindle" via email, so supporting SMTP-based book delivery unlocks this workflow without requiring a separate tool.

## What Changes

- New **per-user SMTP settings**: each user can configure their own SMTP server (host, port, from address, username, password, auth toggle, STARTTLS toggle). Admin can additionally configure a server-level SMTP as a shared fallback for users who have not set up their own.
- New **recipient email management** per user: users can add/remove recipient email addresses, and designate one as the default.
- New **"Send" button** on the book detail modal: quick-sends the preferred format (EPUB if available, otherwise first file) to the user's default recipient. A format dropdown lets the user pick a specific file format before sending.
- New **test connection** button on SMTP settings forms (both user and admin) to verify credentials before saving.
- Client-side file size check before initiating a send, surfaced inline in the UI.
- New API endpoints: user SMTP config CRUD, server SMTP config CRUD (admin), test-connection actions, recipient email CRUD (per user), and a send-book action.

## Capabilities

### New Capabilities

- `smtp-config`: Per-user and server-level SMTP configuration. Users manage their own SMTP via `/users/me/smtp`; admins manage the server fallback via `/settings/smtp`. Passwords stored encrypted at rest using AES-256-GCM with a key derived from `JWT_SECRET`. Never returned to the frontend after saving.
- `recipient-emails`: Per-user list of recipient email addresses with a default flag. CRUD operations scoped to the authenticated user.
- `send-book`: Action that composes and sends an ebook file as an email attachment to a recipient address. Resolves SMTP config by checking the user's own config first, then falling back to the server config. Supports selecting a specific format/file; defaults to EPUB if available.

### Modified Capabilities

_(none)_

## Impact

- **New dependency**: `nodemailer` (Node.js SMTP client) in `apps/api`
- **Prisma schema**: new `RecipientEmail` model; new `UserSmtpConfig` model (one-to-one with `User`); `ServerSettings` model extended with SMTP fields
- **New migration** required
- **New API endpoints**:
  - `GET/PUT /api/v1/users/me/smtp` — per-user SMTP config
  - `POST /api/v1/users/me/smtp/test` — test user SMTP connection
  - `GET/PUT /api/v1/settings/smtp` — server-level SMTP config (admin only)
  - `POST /api/v1/settings/smtp/test` — test server SMTP connection (admin only)
  - `GET/POST/DELETE /api/v1/users/me/recipient-emails` — recipient email management
  - `PATCH /api/v1/users/me/recipient-emails/:id/default` — set default recipient
  - `POST /api/v1/books/:id/send` — send book to recipient
- **Frontend**: per-user SMTP settings form in user settings; admin SMTP settings form in admin panel; recipient email management in user settings; send button + format dropdown + file size check in book detail modal
- **Security**: SMTP passwords stored encrypted at rest; NEVER sent to frontend after entry; display only `•••••<last3chars>`
