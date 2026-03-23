---
sidebar_position: 2
---

# Packages & Apps

Litara is a Turborepo monorepo with two apps and one shared package.

## Apps

### `apps/api` — `@litara/api`

The NestJS backend. Serves the REST API, handles library scanning, and serves the built web frontend as static files in production.

**Key responsibilities:**

- REST API with URI versioning (`/api/v1/...`)
- JWT authentication (Passport local + JWT strategies)
- Library scanning via `fast-glob` (initial scan) and `chokidar` (file watching)
- Metadata extraction from ebook files
- Optional metadata enrichment via Google Books API
- OPDS v1 and v2 catalog endpoints
- Swagger UI at `/docs`
- Automatic Prisma migrations on startup

**Notable dependencies:**

| Package                         | Purpose                                                 |
| ------------------------------- | ------------------------------------------------------- |
| `@nestjs/*`                     | Framework, JWT, Swagger, serve-static                   |
| `prisma` + `@prisma/adapter-pg` | Database ORM (Prisma 7 with pg driver adapter)          |
| `epub2`                         | EPUB metadata extraction                                |
| `@litara/mobi-parser`           | MOBI/AZW metadata extraction (internal package)         |
| `chokidar`                      | File system watcher                                     |
| `fast-glob`                     | High-performance file globbing for initial library scan |
| `helmet`                        | HTTP security headers                                   |
| `bcrypt`                        | Password hashing                                        |

**Testing:** Jest for unit tests, Jest + Testcontainers for e2e tests (spins up a real PostgreSQL container — no mocking).

---

### `apps/web` — `@litara/web`

The React frontend. A single-page app served by Vite in development and by the NestJS static file server in production.

**Key responsibilities:**

- JWT-based auth (token stored in `localStorage`)
- All API calls through a shared Axios instance at `src/utils/api.ts` (`/api/v1` base URL, auto-attaches Bearer token, redirects to `/login` on 401)
- Library browsing, book detail pages, reading progress, shelves

**Notable dependencies:**

| Package                            | Purpose                                           |
| ---------------------------------- | ------------------------------------------------- |
| `react` 19 + `react-dom`           | UI framework                                      |
| `react-router-dom` v7              | Client-side routing                               |
| `@mantine/core` + `@mantine/hooks` | UI component library (v8)                         |
| `@tabler/icons-react`              | Icon set                                          |
| `axios`                            | HTTP client                                       |
| `jotai`                            | Lightweight atomic state management               |
| `dompurify`                        | Sanitises ebook description HTML before rendering |

**Dev tooling:** Vite + `@vitejs/plugin-react`, TypeScript, ESLint, PostCSS with `postcss-preset-mantine`.

---

## Packages

### `packages/mobi-parser` — `@litara/mobi-parser`

A custom TypeScript MOBI/AZW parser with no external runtime dependencies. It reads the binary PalmDB/MOBI/EXTH format directly and extracts metadata and cover art from `.mobi`, `.azw`, and `.azw3` files, including AZW3 (KF8) boundary handling.

**Exports two functions:**

```ts
import { extractMobiMetadata, extractMobiCover } from '@litara/mobi-parser';

const metadata = await extractMobiMetadata('/path/to/book.mobi');
// → { title, authors, description, publishedDate, publisher, isbn, asin }

const cover = await extractMobiCover('/path/to/book.mobi');
// → Buffer | undefined
```

**Why a separate package?** NestJS compiles to CommonJS but the package uses Node ESM (`"type": "module"`). Isolating it as a workspace package lets it build independently and be consumed by `apps/api` as a workspace dependency (`"@litara/mobi-parser": "*"`).

---

## Monorepo Tooling

| Tool                 | Role                                                         |
| -------------------- | ------------------------------------------------------------ |
| **Turborepo**        | Task orchestration and build caching across workspaces       |
| **npm workspaces**   | Dependency hoisting and cross-package linking                |
| **semantic-release** | Automated versioning and changelog from conventional commits |
| **commitlint**       | Enforces conventional commit format                          |
| **Prettier**         | Code formatting                                              |
| **prek**             | Git hooks runner (pre-commit, pre-push, commit-msg)          |
