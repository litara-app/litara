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
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: litara
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: change-me
    volumes:
      - db_data:/var/lib/postgresql/data

  api:
    image: ghcr.io/litara-app/litara:latest
    ports:
      - '3000:3000'
    environment:
      DATABASE_URL: postgresql://postgres:change-me@db:5432/litara
      JWT_SECRET: change-me-in-production
    volumes:
      - /path/to/your/ebooks:/books:ro
    depends_on:
      - db

volumes:
  db_data:
```

Replace `/path/to/your/ebooks` with the absolute path to your ebook directory on the host. Ensure you have secure postgres password.

### 2. Start the services

```bash
docker compose up -d
```

### 3. Open the web UI

Navigate to [http://localhost:3000](http://localhost:3000) in your browser.

On first run, create an account and Litara will begin scanning your library.

## Updating

To update to the latest version:

```bash
docker compose pull
docker compose up -d
```

Database migrations run automatically on startup.
