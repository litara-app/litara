---
sidebar_position: 2
---

# Installation

The recommended way to run Litara is with Docker Compose. This starts the API, web frontend, and a PostgreSQL database together.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/) installed
- A directory on your host machine containing your ebook files

## Quick Start

### 1. Create a `docker-compose.yml`

```yaml
services:
  litara:
    image: ghcr.io/litara-app/litara:latest
    ports:
      - '3000:3000'
    environment:
      DATABASE_URL: postgresql://postgres:change-me@postgres:5432/litara
      JWT_SECRET: change-me-in-production
      #EBOOK_LIBRARY_PATH: /books   # Default is /books, change if you want
      BOOK_DROP_PATH: /book-drop # omit to disable the book drop feature
      # GOOGLE_BOOKS_API_KEY: your_key_here   # optional, raises rate limit
      # HARDCOVER_API_KEY: your_key_here      # optional, enables Hardcover metadata
    volumes:
      - /path/to/your/ebooks:/books:ro # remove ':ro' to allow Litara to write to your library
      - /path/to/book-drop:/book-drop # optional: files dropped here are queued for admin review
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: litara
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: change-me
    volumes:
      - db_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  db_data:
```

Replace `/path/to/your/ebooks` with the absolute path to your ebook directory on the host, and set a secure `JWT_SECRET` and Postgres password.

:::note Read-only vs. read-write mount

The `:ro` flag mounts your ebook directory as **read-only**. Litara will scan and index your files but will not modify them in any way — metadata write-back, sidecar file creation will only work as a download, and the book drop approval workflow (which copies new files into the library) will all be unavailable.

**Remove `:ro`** if you want Litara to manage your library on disk:

```yaml
- /path/to/your/ebooks:/books
- /path/to/book-drop:/book-drop
```

With a read-write mount you can enable disk writes in **Admin Settings → General** to allow Litara to write enriched metadata back to `.epub` files, create `.metadata.json` sidecar files, and move approved books from the book drop queue into the library.

:::

### 2. Start the services

```bash
docker compose up -d
```

### 3. Open the web UI

Navigate to [http://localhost:3000](http://localhost:3000) in your browser.

On first run, you will be redirected to the **Setup page**, where you create the initial admin account. Once submitted, the setup page is permanently disabled and the admin account is the only way to access the application.

:::warning Secure your instance before exposing it publicly

The setup page is open to anyone who can reach your server — no authentication is required. **Do not expose Litara to the public internet until you have completed setup and the admin account is created.**

More generally, Litara is designed for use on a trusted local network or behind a reverse proxy with appropriate access controls. If you do expose it publicly, ensure you are using HTTPS and a strong password for the admin account.

:::

## Updating

To update to the latest version:

```bash
docker compose pull
docker compose up -d
```

Database migrations run automatically on startup.
