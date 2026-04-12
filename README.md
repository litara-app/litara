<div align="center">
  <img src="./apps/docs/static/img/logo.svg" alt="Litara" width="80" />

  <h1>Litara</h1>

[![Docs](https://img.shields.io/badge/docs-litara--app.github.io-0284c7)](https://litara-app.github.io/litara/)
[![Latest release](https://img.shields.io/github/v/release/litara-app/litara?logo=github)](https://github.com/litara-app/litara/releases)
[![Docker image](https://img.shields.io/github/v/release/litara-app/litara?label=ghcr.io&logo=docker&logoColor=white&color=0ea5e9)](https://github.com/litara-app/litara/pkgs/container/litara)
[![CI](https://github.com/litara-app/litara/actions/workflows/release.yml/badge.svg)](https://github.com/litara-app/litara/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

</div>

A self-hosted ebook library manager. Automatically scans a folder for ebook files, extracts metadata, and serves a clean web UI for browsing, reading progress, shelves, and annotations.

![Litara dashboard](./apps/docs/static/screenshots/dashboard.png)

> **Mobile (Android):** A companion mobile app is in beta. See [mobile docs](https://litara-app.github.io/litara/mobile) for details.

<div align="center">
<img src="./apps/docs/static/screenshots/mobile/sign_in.png" width="200">
&nbsp;&nbsp;
<img src="./apps/docs/static/screenshots/mobile/all_books.png" width="200">
&nbsp;&nbsp;
<img src="./apps/docs/static/screenshots/mobile/book_details.png" width="200">
</div>

## Features

- Scans and indexes `.epub`, `.mobi`, `.azw`, `.azw3`, `.fb2` (beta), and `.cbz` files (beta)
- Extracts cover art and metadata (title, authors, series, published date)
- Metadata enrichment via Google Books, Open Library, Goodreads, and Hardcover
- Write enriched metadata back to `.epub` files; sidecar `.metadata.json` support for all formats
- Book drop folder and web upload — queue new books for admin review before writing to the library
- JWT-authenticated multi-user support
- Shelves, smart shelves, reading progress, and annotations
- OPDS catalog (v1.2 Atom + v2.0 JSON) for ebook reader apps
- Email delivery to e-readers via SMTP
- Docker-first deployment

## Quick Start

```bash
cp docker-compose.example.yml docker-compose.yml
docker compose up -d
```

Then open `http://localhost:3000`. On first run, create an account via the login page.

For configuration options, OPDS setup, and local development, see the **[documentation](https://litara-app.github.io/litara/)**.

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
