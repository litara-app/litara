# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript monorepo (NestJS backend + React/Mantine frontend) managed with Turbo. Always verify TypeScript compilation (`tsc --noEmit`) after making changes to DTOs, API decorators, or shared types.

Litara is a self-hosted ebook library manager. It is a monorepo managed with **Turborepo** and **npm workspaces**, containing two apps and one package:

- `apps/api` — NestJS backend (REST API + library scanner)
- `apps/web` — React + Vite frontend
- `packages/mobi-parser` (`@litara/mobi-parser`) — Wraps `@lingo-reader/mobi-parser` to extract metadata from `.mobi`, `.azw`, and `.azw3` files. Exposes a single `extractMobiMetadata(filePath)` function.
- `packages/book-types` (`@litara/book-types`) — **Single source of truth for all enrichable book metadata fields.** Exports `BookMetadataFields` (canonical interface) and `MetadataResult` (extends it with `categories`). **All metadata field additions/renames must start here** and propagate to `MetadataResultDto` and `UpdatePendingBookDto` (both `implements BookMetadataFields`).

## Commands

### Monorepo (run from root)

```bash
npm run dev       # Start all apps in watch mode (via Turborepo)
npm run build     # Build all apps
npm run lint      # Lint all apps
npm run format    # Prettier format all TS/TSX/MD files
```

### API (`apps/api`)

```bash
npm run dev           # Watch mode (nest start --watch)
npm run build         # nest build → dist/
npm run start:prod    # node dist/main
npm run test          # Jest unit tests
npm run test:e2e      # Jest e2e tests (uses test/jest-e2e.json)
npm run test:watch    # Jest in watch mode
npm run lint          # ESLint with auto-fix
```

Run a single test file:

```bash
cd apps/api && npx jest src/path/to/file.spec.ts
```

### Web (`apps/web`)

```bash
npm run dev       # Vite dev server
npm run build     # tsc -b && vite build
npm run preview   # Preview production build
npm run lint      # ESLint
```

### Database

```bash
# Start PostgreSQL (required before running the API)
docker-compose up -d

# Create a new migration after editing prisma/schema.prisma
cd apps/api && npx prisma migrate dev --name <migration-name>

# Apply migrations (the API does this automatically on startup via execSync)
cd apps/api && npx prisma migrate deploy

# Open Prisma Studio
cd apps/api && npx prisma studio
```

## Architecture

### API (`apps/api`)

NestJS app with URI versioning (`/api/v1/...`). Swagger UI is served at `/docs`.

**Modules:**

- `DatabaseModule` — Wraps PrismaClient using the `@prisma/adapter-pg` driver (Prisma 7 driver adapters). Runs `prisma migrate deploy` automatically on startup.
- `AuthModule` — JWT + Passport local strategy. JWT tokens expire in 60 minutes. Secret read from `JWT_SECRET` env var.
- `UsersModule` — User management with bcrypt password hashing.
- `LibraryModule` — Contains `LibraryScannerService`, which on startup does a full scan of watched folders using `fast-glob`, then switches to continuous file watching with `chokidar`. Supported formats: `epub`, `mobi`, `azw`, `azw3`, `cbz`, `pdf`. EPUB metadata is extracted via `epub2`. Other formats fall back to filename-based metadata.

**Prisma schema** is in `apps/api/prisma/schema.prisma`. Key models: `User`, `Library`, `Book`, `Author`, `BookAuthor`, `BookFile`, `WatchedFolder`, `ReadingProgress`, `Annotation`, `Shelf`, `SmartShelfRule`, `Task`, `Log`, `ServerSettings`.

**Library scanning flow:**

1. On init, ensures a "Default Library" and a `WatchedFolder` exist (path from `EBOOK_LIBRARY_PATH` env var, or `ebook-library/` sibling directory).
2. Full scan with `fast-glob` to import existing files.
3. Chokidar watcher for incremental adds/removes.
4. Duplicate detection via SHA-256 file hash (`fileHash` on `BookFile`).

### Web (`apps/web`)

React 19 + Vite SPA using **Mantine** for UI components and **React Router v7** for routing.

- Auth is JWT-based; token stored in `localStorage`.
- All API calls go through a shared `axios` instance (`src/utils/api.ts`) with base URL `/api/v1` (relative; overridable via `VITE_API_URL` env var). The interceptor auto-attaches the Bearer token and redirects to `/login` on 401.
- Routes: `/login` (public), `/` (protected, Dashboard).

### Environment Variables

| Variable               | App | Description                                                                                                              |
| ---------------------- | --- | ------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`         | API | PostgreSQL connection string                                                                                             |
| `JWT_SECRET`           | API | Secret for signing JWT tokens                                                                                            |
| `EBOOK_LIBRARY_PATH`   | API | Path to ebook directory (optional, has default)                                                                          |
| `BOOK_DROP_PATH`       | API | Path to book drop folder; files placed here are auto-ingested for admin review (optional, drop folder disabled if unset) |
| `PORT`                 | API | HTTP port (default: 3000)                                                                                                |
| `GOOGLE_BOOKS_API_KEY` | API | Optional Google Books API key. Raises rate limit from ~100/day to 1000/day.                                              |
| `HARDCOVER_API_KEY`    | API | Optional Hardcover API key. Required for Hardcover metadata provider.                                                    |

Docker Compose provides a local PostgreSQL instance (`postgres:16-alpine`) on port 5432 with db `litara`, user/pass `postgres`.

### Code Guidelines

Whenever possible, don't use any types in typescript, create an interface instead.

### Security Notes

- Helmet is applied globally on the API.
- The web frontend should enforce Content Security Policy (CSP) to prevent malicious ebook content from executing JavaScript.

## Backend Conventions

After editing backend controllers or DTOs, always check: 1) `@ApiBearerAuth()` is present on protected endpoints, 2) Swagger decorators use correct types (not `'object'`), 3) Run `npm run build` to catch compilation errors before moving on.

## Frontend Conventions

This project uses Mantine v8. Do NOT use deprecated v7 APIs (e.g., creatable MultiSelect). Check Mantine docs for current component APIs before implementing UI changes.
'IconBookOpen' is not provided by tabler icons.

## Docker / CI

Docker builds use a specific dist output structure: `dist/apps/api/src/main`. Do not change the CMD path without verifying the actual build output with `ls dist/` first.

## Git Hooks & Linting

When fixing pre-commit hooks or lint configs, always verify that required packages are actually installed (check `node_modules`) before referencing binaries. Prefer `npx` over direct `node_modules/.bin` paths.

## Metadata fields

Metadata Fields

## Basic Information

Title
Subtitle
Publisher
Published

## Tags and Categories

Authors
Genres
Moods
Tags

## Description

Description

## Series Information

Series Name
Series Book Number
Series Total Books

## Book Details

language
ISBN-10
ISBN-13
Pages

## Provider Metadata

Google ID
ASIN
Goodreads ID
Goodreads Number
Goodreads Rating
Openlibrary ID (/works/<id>)
