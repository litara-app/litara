---
slug: /
sidebar_position: 1
---

# Introduction

Litara is a self-hosted ebook library manager. It lets you organize, read, and manage your personal ebook collection from a web browser — no cloud subscription required.

## Features

- **Library scanning** — Automatically imports ebooks from a watched folder. Supports `.epub`, `.mobi`, `.azw`, `.azw3`, and `.pdf` formats. `.cbz` (comic book archives) is also supported in beta — metadata is read from `ComicInfo.xml` if present.
- **Metadata extraction** — Pulls title, author, cover art, and other metadata directly from ebook files.
- **Metadata enrichment** — Manually fetch extended metadata (description, genres, ratings) from Google Books, Open Library, Goodreads, and Hardcover for any book.
- **Write metadata to disk** — Write enriched metadata back to `.epub` files directly, keeping your files in sync with the library database. Sidecar `.metadata.json` files are also supported for any format.
- **Book drop & review** — Drop ebook files into a watched folder (or upload via the web UI) to queue them for admin review before they are written to the library. Admins can enrich metadata and approve or reject each book.
- **Email delivery** — Send books directly to an e-reader via SMTP (e.g. Kindle email).
- **OPDS support** — Exposes your library via OPDS v1 and v2 catalogs for compatible reading apps.
- **Reading progress** — Tracks your reading progress and annotations per book.
- **Shelves** — Organize books into custom shelves and smart shelves with auto-matching rules.
- **Multi-user** — JWT-based authentication supports multiple independent user accounts.

![Book detail modal](@site/static/screenshots/book-detail.png)

## Architecture

Litara is composed of three apps and two packages:

| Component              | Description                                          |
| ---------------------- | ---------------------------------------------------- |
| `apps/api`             | NestJS REST API and library scanner                  |
| `apps/web`             | React + Vite web frontend                            |
| `apps/mobile`          | React Native mobile apps for ios/android             |
| `packages/mobi-parser` | Metadata extractor for `.mobi` / `.azw` files        |
| `packages/cbz-parser`  | Metadata and cover extractor for `.cbz` files (beta) |

The API stores all data in PostgreSQL and exposes a Swagger UI at `/docs` when running.

## Next Steps

- [Installation](./installation) — Get Litara running with Docker Compose
- [Configuration](./configuration) — Environment variables and settings reference
- [Email Delivery](./email-delivery) — Send books to your e-reader via SMTP
