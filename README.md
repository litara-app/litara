# Litara

A self-hosted ebook library manager. Automatically scans a folder for ebook files, extracts metadata, and serves a clean web UI for browsing, reading progress, shelves, and annotations.

## Features

- Scans and indexes `.epub`, `.mobi`, `.azw`, `.azw3`, `.cbz`, and `.pdf` files
- Extracts cover art and metadata (title, authors, series, published date)
- Optional metadata enrichment via Google Books API
- JWT-authenticated multi-user support
- Shelves, smart shelves, reading progress, and annotations
- OPDS catalog (v1.2 Atom + v2.0 JSON) for ebook reader apps
- Docker-first deployment

## Quick Start

```bash
# Copy and edit the example compose file
cp docker-compose.example.yml docker-compose.yml

# Start
docker compose up -d
```

Then open `http://localhost:3000`. On first run, create an account via the login page.

## Configuration

| Variable                  | Default      | Description                                                          |
| ------------------------- | ------------ | -------------------------------------------------------------------- |
| `DATABASE_URL`            | _(required)_ | PostgreSQL connection string                                         |
| `JWT_SECRET`              | _(required)_ | Secret for signing JWT tokens                                        |
| `EBOOK_LIBRARY_PATH`      | `ebooks`     | Path to your ebook directory (mounted into the container)            |
| `PORT`                    | `3000`       | HTTP port the API listens on                                         |
| `METADATA_ENRICH_ON_SCAN` | `false`      | Set to `true` to auto-fetch external metadata when files are scanned |
| `GOOGLE_BOOKS_API_KEY`    | _(optional)_ | Raises Google Books rate limit from ~100/day to 1000/day             |

## OPDS Catalog

Litara exposes an OPDS catalog so ebook reader apps can browse and download books directly. OPDS is disabled by default — enable it in **Settings → OPDS Catalog**.

| Version                   | URL                          | Format   | Compatible apps                    |
| ------------------------- | ---------------------------- | -------- | ---------------------------------- |
| OPDS 1.2                  | `http://<host>:3000/opds/v1` | Atom XML | KOReader, Pocketbook, Moon+ Reader |
| OPDS 2.0 _(experimental)_ | `http://<host>:3000/opds/v2` | JSON     | Thorium Reader                     |

### Authentication

OPDS uses dedicated OPDS credentials — **not** your Litara account login. Create OPDS users in **Settings → OPDS Catalog → Add User**. These accounts can only access the OPDS catalog and cannot log into the Litara web UI.

### KOReader setup

1. Open **OPDS catalog** → **Add catalog**
2. Enter `http://<host>:3000/opds/v1`
3. Enter your OPDS username and password when prompted

### Thorium Reader setup

1. Open **Catalogs** → **Add an OPDS feed**
2. Enter `http://<host>:3000/opds/v2`
3. Enter your OPDS username and password when prompted

> **Note:** OPDS v2.0 support is experimental. Client compatibility varies. Please [open an issue](https://github.com/litara-app/litara/issues) if you encounter problems.

### Available feeds (v1)

| Endpoint                            | Description                    |
| ----------------------------------- | ------------------------------ |
| `/opds/v1`                          | Root navigation                |
| `/opds/v1/catalog`                  | All books (paginated, 20/page) |
| `/opds/v1/new`                      | New arrivals                   |
| `/opds/v1/search/results?q=…`       | Search by title or author      |
| `/opds/v1/authors`                  | Browse by author               |
| `/opds/v1/series`                   | Browse by series               |
| `/opds/v1/genres`                   | Browse by genre                |
| `/opds/v1/download/:bookId/:fileId` | Download a file                |

## Development

Requirements: Node 20+, Docker (for PostgreSQL)

```bash
# Install dependencies
npm install

# Start PostgreSQL
docker compose up -d

# Start all apps in watch mode
npm run dev
```

The API runs at `http://localhost:3000`, the web UI at `http://localhost:5173`.

See [CLAUDE.md](CLAUDE.md) for full architecture documentation.

## Commits

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Releases are automated — pushing to `main` triggers semantic versioning and a GitHub release based on commit types.

| Prefix                                            | Effect                      |
| ------------------------------------------------- | --------------------------- |
| `feat:`                                           | Minor version bump, release |
| `fix:`                                            | Patch version bump, release |
| `BREAKING CHANGE`                                 | Major version bump, release |
| `chore:`, `docs:`, `style:`, `refactor:`, `test:` | No release                  |

## License

MIT
