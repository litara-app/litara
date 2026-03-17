# Litara

A self-hosted ebook library manager. Automatically scans a folder for ebook files, extracts metadata, and serves a clean web UI for browsing, reading progress, shelves, and annotations.

## Features

- Scans and indexes `.epub`, `.mobi`, `.azw`, `.azw3`, `.cbz`, and `.pdf` files
- Extracts cover art and metadata (title, authors, series, published date)
- Optional metadata enrichment via Google Books API
- JWT-authenticated multi-user support
- Shelves, smart shelves, reading progress, and annotations
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

| Variable                  | Default            | Description                                                          |
| ------------------------- | ------------------ | -------------------------------------------------------------------- |
| `DATABASE_URL`            | _(required)_       | PostgreSQL connection string                                         |
| `JWT_SECRET`              | _(required)_       | Secret for signing JWT tokens                                        |
| `EBOOK_LIBRARY_PATH`      | `../ebook-library` | Path to your ebook directory (mounted into the container)            |
| `PORT`                    | `3000`             | HTTP port the API listens on                                         |
| `METADATA_ENRICH_ON_SCAN` | `false`            | Set to `true` to auto-fetch external metadata when files are scanned |
| `GOOGLE_BOOKS_API_KEY`    | _(optional)_       | Raises Google Books rate limit from ~100/day to 1000/day             |

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
