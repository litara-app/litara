## Context

The Litara web app is a React 19 + Mantine v8 SPA served by NestJS. It has pages for login, setup, dashboard, all-books, library, shelves, and settings. The API has a mature E2E test suite using Jest + Testcontainers, with a shared fixture library of 4 real ebook files in `apps/api/test/ebook-library/`. There are currently no frontend UI tests of any kind.

The existing API e2e tests own the ebook fixtures directory. Moving it to a shared location (`test/fixtures/ebook-library/`) lets the frontend Playwright tests point the API at the same real books, so the browser tests see a populated library without maintaining duplicate fixtures.

## Goals / Non-Goals

**Goals:**

- Install and configure Playwright in `apps/web` with tests in `apps/web/e2e/`
- Cover the critical user flows: login, setup wizard, library browsing, book detail modal, settings navigation, send-to-email
- Advisory-only CI job in GitHub Actions (non-blocking on PRs via `continue-on-error: true`)
- Screenshot capture command (`npm run screenshots`) that writes to `docs/screenshots/` for deliberate Docusaurus updates — run locally or on-demand, never automatically committed
- CI artifact screenshots (from the advisory PR job) write to `playwright-screenshots/` and are uploaded as a GitHub Actions artifact, never to `docs/screenshots/`
- Move ebook fixtures to `test/fixtures/ebook-library/` and update the one reference in `apps/api/test/setup/test-env.ts`

**Non-Goals:**

- Visual regression / pixel-diff testing (screenshot comparison) — screenshots are for docs only
- Component-level unit tests (that's Vitest territory)
- Replacing the API e2e tests with Playwright
- Mobile/responsive layout testing in the initial pass

## Decisions

### 1. Playwright over Cypress

Playwright is the right choice here because:

- First-class support for `page.screenshot()` with full-page capture, element-level clips, and mask support — which directly serves the documentation use case
- Faster, parallelisable across browsers, and ships its own test runner (`@playwright/test`) with no extra setup
- Docker-friendly: `mcr.microsoft.com/playwright` image is purpose-built for CI
- No per-seat licensing

**Alternatives considered:**

- Cypress: heavier Docker image, paid Dashboard for parallelism, screenshot API is less ergonomic for doc generation
- Vitest Browser Mode: great for component tests, but lacks the page-lifecycle control needed for multi-step flows against a real stack

### 2. Tests run against the full stack (docker-compose), not a mock

The existing API e2e tests use Testcontainers for a real Postgres. Playwright tests should run against the real NestJS API + Postgres to catch integration bugs in the UI ↔ API contract. In CI this means spinning up the stack via `docker compose up` before running Playwright.

**Alternatives considered:**

- Mock Service Worker (MSW): faster, no backend needed, but doesn't catch API shape regressions and is a significant maintenance burden (duplicating the API contract)
- Testcontainers inside Playwright globalSetup: possible but complex; docker-compose reuse is simpler and closer to how the app actually runs

### 3. Advisory-only via `continue-on-error: true` in GitHub Actions

GitHub Actions' `continue-on-error: true` at the job level marks a failing job with a yellow warning rather than blocking the PR merge. This satisfies "advisory but not blocking" without any third-party tooling. The status check is still visible in the PR checks panel.

**Alternatives considered:**

- Pre-commit hook (advisory): works locally but requires Playwright + a running stack to be available at commit time — too heavy for a pre-commit
- GitHub required status checks (blocking): explicitly ruled out by the user

### 4. Screenshot capture as a separate Playwright project with two output paths

Playwright supports multiple "projects" in one config. A `screenshots` project runs a dedicated capture script separate from test assertions.

Two distinct output paths serve two different purposes:

- **`docs/screenshots/`** — the Docusaurus source. Written only when a developer runs `npm run screenshots` explicitly and chooses to commit. Never written automatically by CI.
- **`playwright-screenshots/`** — CI-only ephemeral output. The advisory PR job runs the screenshot project pointing here, and uploads the folder as a GitHub Actions artifact. This lets reviewers visually inspect the current UI state on a PR without polluting the docs tree or requiring a commit.

The `screenshots` project reads `SCREENSHOTS_OUTPUT_DIR` (default: `docs/screenshots/`) so the same test files serve both purposes — the CI job overrides the env var to `playwright-screenshots/`.

### 5. Shared ebook fixtures at `test/fixtures/ebook-library/`

Moving to the monorepo root `test/fixtures/` establishes a clear pattern for shared test assets. The only change to existing code is one `path.resolve(...)` line in `apps/api/test/setup/test-env.ts`. The Playwright global setup will set `EBOOK_LIBRARY_PATH` to the same directory.

## Risks / Trade-offs

- **CI time**: Playwright tests against a real stack will add ~2–4 minutes to CI. Mitigated by running the job in parallel with lint/commitlint and keeping `continue-on-error: true` so it doesn't hold up merges.
- **Flakiness**: Full-stack E2E tests are inherently more flaky than unit tests. Mitigated by using Playwright's built-in `waitFor*` assertions (retry until timeout), avoiding fixed `sleep()` calls, and tagging flaky tests for investigation rather than disabling them.
- **Docker-in-Docker on GitHub Actions**: Spinning up docker-compose inside an `ubuntu-latest` runner is standard and well-supported; no risk here.
- **Ebook fixture path change**: Only one reference to update. Low risk, but must be caught before merging to keep the API e2e suite green.

## Migration Plan

1. Move `apps/api/test/ebook-library/` → `test/fixtures/ebook-library/`
2. Update `apps/api/test/setup/test-env.ts` path reference
3. Verify API e2e tests still pass locally
4. Add `apps/web/e2e/` with Playwright config and initial test files
5. Add `e2e` job to `.github/workflows/pr-checks.yml` with `continue-on-error: true`
6. Add `screenshot` npm script to `apps/web/package.json` for on-demand doc capture

Rollback: removing the `e2e` job from the workflow is sufficient to stop running the tests. The fixture move is the only change that could break API e2e — reverting `test-env.ts` restores the original path.

## Resolved Questions

- **Screenshot output**: `docs/screenshots/` is for deliberate Docusaurus updates (run `npm run screenshots`, review, commit). CI uses `playwright-screenshots/` as a transient artifact — never committed. The `SCREENSHOTS_OUTPUT_DIR` env var controls which path the screenshot project writes to.
- **Browser coverage**: Chromium only. No multi-browser expansion planned.
