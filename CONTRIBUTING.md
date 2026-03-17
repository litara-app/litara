# Contributing to Litara

## Prerequisites

- **Node.js** 20+
- **npm** 10+ (comes with Node)
- **Docker** (for PostgreSQL in dev, and for local image testing)
- **Git**

---

## Development setup

```bash
# 1. Clone
git clone https://github.com/deranjer/litara.git
cd litara

# 2. Install all workspace dependencies
npm install

# 3. Start PostgreSQL (dev database only — no app container)
docker compose -f docker-compose.dev.yml up -d

# 4. Start all apps in watch mode
npm run dev
```

| Service            | URL                        |
| ------------------ | -------------------------- |
| Web UI             | http://localhost:5173      |
| API                | http://localhost:3000      |
| API docs (Swagger) | http://localhost:3000/docs |

The API automatically applies Prisma migrations on startup. No manual migration step is needed during development.

### Environment variables

Copy `apps/api/.env.example` if one exists, or set these directly in your shell / `.env`:

| Variable             | Dev default                                                        |
| -------------------- | ------------------------------------------------------------------ |
| `DATABASE_URL`       | `postgresql://postgres:postgres@localhost:5432/litara`             |
| `JWT_SECRET`         | any string, e.g. `dev-secret`                                      |
| `EBOOK_LIBRARY_PATH` | `/books` (default) — override to point at a local folder of ebooks |

---

## Project structure

```
litara/
├── apps/
│   ├── api/          # NestJS backend — REST API + library scanner
│   └── web/          # React + Vite frontend
└── packages/
    └── mobi-parser/  # Shared MOBI/AZW metadata extractor
```

See [CLAUDE.md](CLAUDE.md) for full architecture documentation.

---

## Common tasks

### Add a database migration

```bash
# Edit apps/api/prisma/schema.prisma, then:
cd apps/api
npx prisma migrate dev --name describe-your-change
```

### Run tests

```bash
# API unit tests
cd apps/api && npm test

# API end-to-end tests (requires Docker for testcontainers)
cd apps/api && npm run test:e2e
```

### Lint and format

```bash
npm run lint      # ESLint across all packages
npm run format    # Prettier across all packages
```

---

## Testing the Docker image locally

Before opening a PR that changes the Dockerfile or build process, verify the production image builds and runs correctly.

```bash
# Build the production image from local source
npm run docker:build

# Start the full stack (app + postgres) using the local image
npm run docker:up
```

Then open http://localhost:3000 and verify the app works.

```bash
# Tear down and remove volumes when done
npm run docker:down
```

`docker:up` uses `docker-compose.local.yml` which builds from the local `Dockerfile` and
spins up its own PostgreSQL container — completely isolated from the dev database.

---

## Commit conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/). A pre-commit hook enforces the format.

| Prefix                                  | Effect                       |
| --------------------------------------- | ---------------------------- |
| `feat:`                                 | Minor version bump + release |
| `fix:`                                  | Patch version bump + release |
| `BREAKING CHANGE`                       | Major version bump + release |
| `chore:`, `docs:`, `refactor:`, `test:` | No release                   |

Examples:

```
feat: add reading progress sync across devices
fix: cover art not loading for books with special characters in path
docs: add contributor setup guide
```

---

## Pull request checklist

- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] New API endpoints have a corresponding e2e test
- [ ] Migrations are included if the Prisma schema changed
- [ ] Docker image builds cleanly (`npm run docker:build`)
