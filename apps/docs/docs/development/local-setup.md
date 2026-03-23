---
sidebar_position: 1
---

# Running Locally

This guide covers running Litara from source for development. You'll need **Node.js 20+**, **npm**, and **Docker** (for PostgreSQL).

## 1. Clone the repo

```bash
git clone https://github.com/litara-app/litara.git
cd litara
```

## 2. Start PostgreSQL

A `docker-compose.dev.yml` is provided that starts a PostgreSQL 16 instance on port `5432` with default dev credentials:

```bash
docker compose -f docker-compose.dev.yml up -d
```

| Setting  | Value            |
| -------- | ---------------- |
| Host     | `localhost:5432` |
| Database | `litara`         |
| User     | `postgres`       |
| Password | `postgres`       |

## 3. Configure environment

Create a `.env` file in `apps/api/`:

```bash
cp apps/api/.env.example apps/api/.env
```

The defaults work with the dev Docker Compose above. At minimum you need:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/litara
JWT_SECRET=dev-secret-change-in-production
EBOOK_LIBRARY_PATH=/path/to/your/ebooks
```

`EBOOK_LIBRARY_PATH` can point to any directory — even an empty one. The scanner will watch it and import any supported ebook files it finds.

## 4. Install dependencies

```bash
npm install
```

This installs dependencies for all workspaces (`apps/api`, `apps/web`, `packages/mobi-parser`) via npm workspaces.

## 5. Start everything

```bash
npm run dev
```

Turborepo starts all apps in parallel watch mode:

| App        | URL                          | Notes                            |
| ---------- | ---------------------------- | -------------------------------- |
| API        | `http://localhost:3000`      | NestJS, auto-restarts on changes |
| Web        | `http://localhost:5173`      | Vite dev server with HMR         |
| Swagger UI | `http://localhost:3000/docs` | Auto-generated API reference     |

Database migrations run automatically when the API starts.

## Useful Commands

### API

```bash
# Run unit tests
cd apps/api && npm test

# Run e2e tests (requires Docker daemon running — Testcontainers handles the database)
cd apps/api && npm run test:e2e

# Open Prisma Studio (database browser)
cd apps/api && npx prisma studio

# Create a new migration after editing prisma/schema.prisma
cd apps/api && npx prisma migrate dev --name <migration-name>
```

### Root

```bash
npm run build    # Build all apps
npm run lint     # ESLint across all workspaces
npm run format   # Prettier format all TS/TSX/MD files
```

## Git hooks

Git hooks are managed by [prek](https://github.com/j178/prek) and configured in `.pre-commit-config.yaml`. They install automatically when you run `npm install` — no extra setup needed.

### What runs and when

| Stage          | Checks                                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **pre-commit** | Prettier (staged TS/TSX/MD files), ESLint, TypeScript type-check (`tsc --noEmit`), secret scanning (gitleaks), common file checks (merge conflicts, JSON/YAML syntax, trailing whitespace) |
| **commit-msg** | Commitlint — enforces [Conventional Commits](https://www.conventionalcommits.org/) format                                                                                                  |
| **pre-push**   | API e2e tests                                                                                                                                                                              |

### Pre-push heads up

The pre-push hook runs the full e2e test suite before every `git push`. The tests use [Testcontainers](https://testcontainers.com/) to spin up a temporary PostgreSQL instance automatically — no running dev database required. Docker just needs to be installed and the Docker daemon running.

You can skip hooks in an emergency with `git push --no-verify`, but PR merging will be blocked until tests pass.

### gitleaks

The secret scanner ([gitleaks](https://github.com/gitleaks/gitleaks)) runs on every commit to catch accidentally staged credentials. If a commit is blocked unexpectedly, check the output — it will identify which file and line triggered the scan.

## Stopping

```bash
# Stop the dev servers: Ctrl+C

# Stop and remove PostgreSQL
docker compose -f docker-compose.dev.yml down

# To also delete the database volume
docker compose -f docker-compose.dev.yml down -v
```
