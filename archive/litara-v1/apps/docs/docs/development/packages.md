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

| Package                         | Purpose                                                    |
| ------------------------------- | ---------------------------------------------------------- |
| `@nestjs/*`                     | Framework, JWT, Swagger, serve-static                      |
| `prisma` + `@prisma/adapter-pg` | Database ORM (Prisma 7 with pg driver adapter)             |
| `epub2`                         | EPUB metadata extraction                                   |
| `@litara/mobi-parser`           | MOBI/AZW metadata extraction (internal package)            |
| `@litara/cbz-parser`            | CBZ metadata and cover extraction (internal package, beta) |
| `chokidar`                      | File system watcher                                        |
| `fast-glob`                     | High-performance file globbing for initial library scan    |
| `helmet`                        | HTTP security headers                                      |
| `bcrypt`                        | Password hashing                                           |

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

### `packages/cbz-parser` — `@litara/cbz-parser` _(beta)_

A TypeScript CBZ (comic book archive) parser. CBZ files are ZIP archives containing images and an optional `ComicInfo.xml` metadata file (the [ComicRack](https://wiki.mobileread.com/wiki/ComicRack) standard). This package reads the ZIP with `adm-zip` and parses `ComicInfo.xml` with `fast-xml-parser`.

**Exports two functions:**

```ts
import { extractCbzMetadata, extractCbzCover } from '@litara/cbz-parser';

const metadata = extractCbzMetadata('/path/to/book.cbz');
// → { title, authors, description, publishedDate, publisher, language, subjects, series, seriesNumber, ids }

const cover = extractCbzCover('/path/to/book.cbz');
// → Buffer | undefined
```

**Metadata mapping from `ComicInfo.xml`:**

| ComicInfo field  | Mapped to                           |
| ---------------- | ----------------------------------- |
| `Title`          | `title`                             |
| `Writer`         | `authors` (split on `,`)            |
| `Publisher`      | `publisher`                         |
| `Summary`        | `description`                       |
| `LanguageISO`    | `language`                          |
| `Year/Month/Day` | `publishedDate`                     |
| `Genre`          | `subjects` (split on `,`)           |
| `Tags`           | `subjects` (appended, split on `,`) |
| `Series`         | `ids.series`                        |
| `Number`         | `ids.seriesNumber`                  |

If no `ComicInfo.xml` is present the title falls back to the filename. Cover extraction returns the image tagged as `FrontCover` in `<Pages>`, or the first alphabetically-sorted image in the archive.

> **Beta:** CBZ support is functional but not yet validated against a broad range of real-world CBZ files. Edge cases may exist for non-standard archives.

**Why a separate package?** Same reason as `mobi-parser` — ESM isolation from the NestJS CommonJS build. The Jest e2e suite uses a CJS stub (`test/mocks/cbz-parser.js`) that replicates the same logic using `adm-zip` and `fast-xml-parser` directly.

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
