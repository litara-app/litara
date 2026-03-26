---
sidebar_position: 3
---

# Configuration

Litara is configured via environment variables on the API container.

## Environment Variables

### Required

| Variable       | Description                                                                             |
| -------------- | --------------------------------------------------------------------------------------- |
| `DATABASE_URL` | PostgreSQL connection string. Example: `postgresql://postgres:postgres@db:5432/litara`  |
| `JWT_SECRET`   | Secret used to sign JWT authentication tokens. Use a long, random string in production. |

### Library

| Variable             | Default  | Description                                                                                                                                                                                                                |
| -------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EBOOK_LIBRARY_PATH` | `/books` | Absolute path to the directory containing your ebook files. The API watches this folder for new and removed files. Matches the standard Docker volume mount path — no override needed in the default Docker Compose setup. |

### Server

| Variable | Default | Description                   |
| -------- | ------- | ----------------------------- |
| `PORT`   | `3000`  | HTTP port the API listens on. |

### Metadata Enrichment

| Variable               | Default  | Description                                                                                                                                                                   |
| ---------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_BOOKS_API_KEY` | _(none)_ | Optional Google Books API key used when enriching book metadata manually. Without a key, requests are rate-limited to ~100/day. With a key, the limit increases to 1,000/day. |
| `HARDCOVER_API_KEY`    | _(none)_ | Optional [Hardcover](https://hardcover.app) API key. Required to use Hardcover as a metadata source. See below for setup notes.                                               |

#### Hardcover API Key

Litara uses the [Hardcover GraphQL API](https://hardcover.app) to search and enrich book metadata. To enable it:

1. Sign in to [hardcover.app](https://hardcover.app) and go to **Settings → API**.
2. Copy your personal API key.
3. Set it as `HARDCOVER_API_KEY` in your environment.

:::caution
Do **not** include the word `Bearer` in the value — just paste the raw key. Litara adds the `Bearer` prefix automatically.
:::

:::note
Hardcover API keys typically expire after approximately one year. If metadata lookups from Hardcover suddenly stop working, check whether your key has expired and generate a new one from your Hardcover account settings.
:::

## Notes

- **`JWT_SECRET` must be kept secret.** Rotating it will invalidate all existing sessions and require all users to log in again.
- **Rotating `JWT_SECRET` also invalidates stored SMTP passwords.** Litara encrypts all SMTP passwords (both the server-level config and each user's personal SMTP config) using a key derived from `JWT_SECRET`. If you rotate the secret, all stored SMTP passwords will become unreadable — the admin must re-enter the server SMTP password, and each user must re-enter their personal SMTP password.
- Database migrations run automatically on startup via `prisma migrate deploy`.
