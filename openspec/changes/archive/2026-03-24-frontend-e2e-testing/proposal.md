## Why

The Litara frontend has no automated UI tests, meaning button interactions, navigation flows, and layout correctness are only verified manually. Playwright provides browser-based E2E testing that can also generate screenshots, enabling both test coverage and living documentation of the application's UI.

## What Changes

- Add Playwright as a dev dependency in `apps/web`
- Create a Playwright test suite covering core UI interactions (login, library browsing, book actions, settings)
- Add a screenshot script/task that captures the application in key states for documentation purposes
- Add a GitHub Actions job to run E2E tests on PRs (requires a running stack)

## Capabilities

### New Capabilities

- `e2e-test-suite`: Browser-based end-to-end tests using Playwright covering navigation, button interactions, and critical user flows in the Litara web app
- `ui-screenshots`: Automated screenshot capture of key application states, usable for documentation, changelogs, and visual regression baseline

### Modified Capabilities

<!-- None — no existing spec-level requirements are changing -->

## Impact

- **New dependency**: `@playwright/test` (dev) in `apps/web`
- **New files**: `apps/web/e2e/` directory with test files and Playwright config
- **CI**: New `e2e` job in GitHub Actions (runs against `docker-compose` stack or a mocked API)
- **No production code changes** — tests and screenshot scripts are dev/CI-only
- **Screenshot output**: Captured images can be committed to `docs/screenshots/` or generated on-demand
