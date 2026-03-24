## ADDED Requirements

### Requirement: Screenshot Playwright project

The system SHALL have a dedicated `screenshots` project in `playwright.config.ts` that is separate from the main test project. The output directory SHALL be read from the `SCREENSHOTS_OUTPUT_DIR` environment variable, defaulting to `docs/screenshots/`. This allows the same test files to write to `docs/screenshots/` for Docusaurus updates or to `playwright-screenshots/` when invoked by CI.

#### Scenario: Screenshot project runs independently

- **WHEN** the developer runs `npx playwright test --project=screenshots`
- **THEN** only screenshot capture tests execute (no assertions that can fail the test suite)

#### Scenario: Default output goes to docs/screenshots/

- **WHEN** `SCREENSHOTS_OUTPUT_DIR` is not set and the developer runs the screenshots project
- **THEN** PNG files are written to `docs/screenshots/`

#### Scenario: CI overrides output path

- **WHEN** the CI job sets `SCREENSHOTS_OUTPUT_DIR=playwright-screenshots/` and runs the screenshots project
- **THEN** PNG files are written to `playwright-screenshots/` and NOT to `docs/screenshots/`

---

### Requirement: Key page screenshots

The system SHALL capture screenshots of the following application states: login page, dashboard (populated library), all-books page, book detail modal (open), and settings page.

#### Scenario: Login page screenshot

- **WHEN** the screenshot project visits `/login`
- **THEN** a full-page screenshot `login.png` is saved

#### Scenario: Dashboard screenshot with books

- **WHEN** the screenshot project authenticates and navigates to `/`
- **THEN** a screenshot `dashboard.png` is saved showing at least one book card

#### Scenario: Book detail modal screenshot

- **WHEN** the screenshot project opens a book's detail modal
- **THEN** a screenshot `book-detail.png` is saved with the modal visible

#### Scenario: Settings page screenshot

- **WHEN** the screenshot project navigates to `/settings`
- **THEN** a screenshot `settings.png` is saved

---

### Requirement: npm script for on-demand documentation screenshot generation

The `apps/web/package.json` SHALL include a `screenshots` script that runs the screenshot Playwright project with no `SCREENSHOTS_OUTPUT_DIR` override, writing to `docs/screenshots/`. This is the only mechanism by which `docs/screenshots/` is updated; it is never run automatically by CI.

#### Scenario: Developer regenerates documentation screenshots

- **WHEN** the developer runs `npm run screenshots --workspace=@litara/web`
- **THEN** the screenshot Playwright project runs and overwrites files in `docs/screenshots/`

#### Scenario: docs/screenshots/ is never written by CI automatically

- **WHEN** the CI e2e job runs on a PR
- **THEN** no files are written to `docs/screenshots/`; screenshots go to `playwright-screenshots/` and are uploaded as a GitHub Actions artifact
