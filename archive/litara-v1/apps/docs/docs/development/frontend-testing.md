---
sidebar_position: 3
---

# Frontend E2E Testing

Litara's frontend tests use [Playwright](https://playwright.dev/) running against a real NestJS API and PostgreSQL instance. They cover login, library browsing, the book detail modal, navigation, and settings. A separate screenshot project captures the current UI state for documentation.

Tests run as an **advisory** check on PRs — failures are visible in the PR checks panel but never block a merge.

---

## Prerequisites

- Node.js 20+, npm, Docker (for PostgreSQL)
- Playwright browsers installed (one-time step):

```bash
cd apps/web
npx playwright install --with-deps chromium
```

---

## Running E2E tests

You have two options depending on whether you want to manage the dev stack yourself.

### Option A — Let Playwright start everything

If you haven't started any dev servers, just run the tests. Playwright will start the API (with the correct `EBOOK_LIBRARY_PATH`) and the Vite dev server automatically:

```bash
# 1. Start PostgreSQL (required — not managed by Playwright)
docker compose -f docker-compose.dev.yml up -d

# 2. Run all E2E tests (headless)
cd apps/web
npx playwright test

# Or open the interactive UI runner
npx playwright test --ui
```

### Option B — Start the dev stack yourself first

Use `npm run dev:e2e` instead of the regular `npm run dev`. This starts the same Turbo dev stack but with `EBOOK_LIBRARY_PATH` pre-set to the shared test fixtures:

```bash
# Terminal 1 — start PostgreSQL + dev stack
docker compose -f docker-compose.dev.yml up -d
npm run dev:e2e        # from the monorepo root

# Terminal 2 — run tests against the running stack
cd apps/web
npx playwright test --ui
```

:::caution Why `dev:e2e` and not `npm run dev`?
The E2E tests expect books to be present in the library. The test fixtures live at `test/fixtures/ebook-library/`. Regular `npm run dev` starts the API with whatever `EBOOK_LIBRARY_PATH` you have set in your `.env`, which may point elsewhere or not exist. `dev:e2e` overrides this to always use the shared fixtures.

If you run `npm run dev` first and then run tests, Playwright will reuse your running servers and the correct fixture path won't be applied — books won't load and library tests will fail.
:::

---

## npm scripts

All Playwright scripts run from `apps/web`:

| Script                                      | What it does                                                |
| ------------------------------------------- | ----------------------------------------------------------- |
| `npm run e2e`                               | Run all E2E tests headlessly                                |
| `npm run screenshots`                       | Capture UI screenshots into `apps/docs/static/screenshots/` |
| `npx playwright test --ui`                  | Open the interactive Playwright UI                          |
| `npx playwright test --project=e2e`         | Run only the main test suite                                |
| `npx playwright test --project=screenshots` | Run only the screenshot project                             |
| `npx playwright test e2e/auth.spec.ts`      | Run a single spec file                                      |

---

## Test structure

```
apps/web/e2e/
├── global-setup.ts          # Waits for API, creates test admin user, saves auth state
├── fixtures.ts              # Authenticated `test` fixture (pre-seeds localStorage with JWT)
├── auth.spec.ts             # Login success/failure, unauthenticated redirect
├── setup.spec.ts            # Setup wizard redirect behaviour
├── library.spec.ts          # Dashboard book cards, All Books page, header search
├── book-detail.spec.ts      # Modal open/close, Edit Metadata tab
├── navigation.spec.ts       # Sidebar links, logout
└── screenshots/
    └── capture.spec.ts      # Captures PNGs for documentation
```

### Authentication

`global-setup.ts` runs once before any test. It:

1. Waits for the API to respond at `http://localhost:3000`
2. Creates a test admin user (`e2e-admin@litara.test` / `E2eTestPassword1!`) via `POST /api/v1/setup`, or logs in if the user already exists
3. Writes the JWT and user object into `e2e/.auth.json` as a Playwright storage state

Tests that need an authenticated session import from `fixtures.ts` instead of `@playwright/test`. The fixture opens a new browser context pre-loaded with the saved storage state so no login form is filled.

Tests that test the login flow or unauthenticated behaviour import from `@playwright/test` directly, giving them a clean context with no token.

---

## Screenshots for documentation

The `screenshots` Playwright project captures the app in key states and writes PNGs used by this Docusaurus site.

### Regenerating docs screenshots

Run this locally with a `dev:e2e` stack running, then commit the updated files:

```bash
# from apps/web
npm run screenshots
```

Output goes to `apps/docs/static/screenshots/`. These files **are not updated automatically by CI** — only a deliberate local run followed by a commit updates them.

### How CI handles screenshots

The advisory PR job runs the screenshot project with a different output path and uploads the result as a GitHub Actions artifact named **`ui-screenshots`**. This lets you inspect the current UI state of any PR without committing anything.

To view them: open the PR → Actions tab → find the `e2e` workflow run → download the `ui-screenshots` artifact.

---

## CI behaviour

The `e2e` job in `.github/workflows/pr-checks.yml` runs on every PR with `continue-on-error: true`. This means:

- A green check appears if all tests pass
- A **yellow warning** (not red) appears if any test fails — the PR can still be merged
- `playwright-report/` is uploaded as an artifact whenever the job runs, so you can download the HTML report to see which tests failed and why
- `ui-screenshots/` is always uploaded so reviewers can see the current state of the UI

To make E2E failures block merges, remove `continue-on-error: true` from the job and add `e2e` to the branch protection required status checks in GitHub.

---

## Writing new tests

### Authenticated test

```ts
import { test, expect } from './fixtures.js';

test('my feature works', async ({ page }) => {
  await page.goto('/some-page');
  await expect(page.getByRole('heading', { name: 'My Page' })).toBeVisible();
});
```

### Unauthenticated test

```ts
import { test, expect } from '@playwright/test';

test('redirects when not logged in', async ({ page }) => {
  await page.goto('/protected');
  await expect(page).toHaveURL('/login');
});
```

### Finding elements

Prefer accessible selectors over CSS classes:

```ts
// Good
page.getByRole('button', { name: 'Sign in' });
page.getByLabel('Email');
page.getByRole('tab', { name: 'Edit Metadata' });

// Acceptable — book cards use a .book-card class specifically for testing
page.locator('.book-card').first();
```

### Waiting for async content

Always wait explicitly — never use fixed `sleep()` delays:

```ts
// Wait for books to load after navigation
await expect(page.locator('.book-card').first()).toBeVisible({
  timeout: 15_000,
});
```

---

## Environment variables

| Variable                 | Default                        | Purpose                                 |
| ------------------------ | ------------------------------ | --------------------------------------- |
| `PLAYWRIGHT_BASE_URL`    | `http://localhost:5173`        | SPA base URL                            |
| `PLAYWRIGHT_API_URL`     | `http://localhost:3000`        | API base URL (used by global setup)     |
| `SCREENSHOTS_OUTPUT_DIR` | `apps/docs/static/screenshots` | Output directory for screenshot project |
