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

| Variable                  | Default       | Description                                                                                                                                                |
| ------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `METADATA_ENRICH_ON_SCAN` | `false` (off) | Set to `true` to automatically fetch extended metadata from Google Books when a new file is scanned. Disabled by default to avoid hitting API rate limits. |
| `GOOGLE_BOOKS_API_KEY`    | _(none)_      | Optional Google Books API key. Without a key, requests are rate-limited to ~100/day. With a key, the limit increases to 1,000/day.                         |

## Notes

- **Never set `METADATA_ENRICH_ON_SCAN=true` on a large library without a `GOOGLE_BOOKS_API_KEY`** — scanning thousands of books without a key will exhaust the anonymous rate limit quickly.
- **`JWT_SECRET` must be kept secret.** Rotating it will invalidate all existing sessions and require all users to log in again.
- Database migrations run automatically on startup via `prisma migrate deploy`.
