## ADDED Requirements

### Requirement: Playwright test infrastructure

The system SHALL have Playwright installed as a dev dependency in `apps/web` with a configuration file at `apps/web/playwright.config.ts`. Tests SHALL live in `apps/web/e2e/`. The configuration SHALL target Chromium only for the initial pass and SHALL use the Vite preview server URL (or `PLAYWRIGHT_BASE_URL` env override) as the base URL.

#### Scenario: Playwright is installed and configured

- **WHEN** a developer runs `npx playwright test` from `apps/web`
- **THEN** Playwright discovers all `*.spec.ts` files under `apps/web/e2e/` and runs them against Chromium

#### Scenario: Base URL is configurable via environment

- **WHEN** `PLAYWRIGHT_BASE_URL` is set to a running Litara instance
- **THEN** all tests navigate relative to that base URL rather than localhost default

---

### Requirement: Login flow

The system SHALL have E2E tests covering the login page interactions.

#### Scenario: Successful login

- **WHEN** a user enters valid credentials and clicks "Sign in"
- **THEN** the browser redirects to the dashboard (`/`)

#### Scenario: Invalid credentials show error

- **WHEN** a user enters incorrect credentials and submits the form
- **THEN** an error alert is visible on the page

#### Scenario: Unauthenticated navigation redirects to login

- **WHEN** an unauthenticated user navigates to a protected route (e.g. `/`)
- **THEN** the browser redirects to `/login`

---

### Requirement: Setup wizard flow

The system SHALL have E2E tests covering the first-run setup wizard.

#### Scenario: Fresh instance redirects to setup

- **WHEN** the API reports `setupRequired: true`
- **THEN** the browser redirects to `/setup` instead of the login page

#### Scenario: Setup wizard completes and redirects to login

- **WHEN** a user completes all setup steps and submits
- **THEN** the browser navigates to `/login` and the setup route is no longer accessible

---

### Requirement: Library browsing

The system SHALL have E2E tests verifying that books loaded from the fixture library are visible and navigable.

#### Scenario: Dashboard shows imported books

- **WHEN** the app is seeded with the fixture ebook library and the user is logged in
- **THEN** the dashboard displays at least one book card

#### Scenario: All Books page lists books

- **WHEN** the user navigates to the All Books page
- **THEN** books imported from `test/fixtures/ebook-library/` are listed

#### Scenario: Search filters books

- **WHEN** the user types a book title into the search input
- **THEN** only books matching the query remain visible

---

### Requirement: Book detail modal

The system SHALL have E2E tests covering the book detail modal.

#### Scenario: Clicking a book card opens the modal

- **WHEN** the user clicks on a book card
- **THEN** the book detail modal opens and displays the book title

#### Scenario: Modal closes on dismiss

- **WHEN** the user presses Escape or clicks the close button
- **THEN** the book detail modal is no longer visible

#### Scenario: Edit Metadata tab is accessible

- **WHEN** the user opens a book modal and clicks the "Edit Metadata" tab
- **THEN** the metadata form fields are visible

---

### Requirement: Navigation links

The system SHALL have E2E tests verifying that all primary navigation links function correctly.

#### Scenario: Navigation to Settings

- **WHEN** the user clicks the Settings link in the sidebar
- **THEN** the URL changes to `/settings` and the settings page content is visible

#### Scenario: Navigation to Admin Settings (admin user)

- **WHEN** an admin user clicks the Admin Settings link
- **THEN** the URL changes to `/admin/settings` and the admin settings page is visible

#### Scenario: Logout clears session and redirects

- **WHEN** the user clicks the logout button
- **THEN** the JWT token is removed from localStorage and the browser navigates to `/login`

---

### Requirement: Shared ebook fixture library

The system SHALL use a single shared ebook fixture directory at `test/fixtures/ebook-library/` (monorepo root) referenced by both API e2e tests and Playwright global setup.

#### Scenario: API e2e tests use shared fixture path

- **WHEN** the API e2e suite runs
- **THEN** `EBOOK_LIBRARY_PATH` resolves to `<monorepo-root>/test/fixtures/ebook-library/`

#### Scenario: Playwright global setup points to shared fixtures

- **WHEN** Playwright global setup starts the API
- **THEN** `EBOOK_LIBRARY_PATH` is set to the same `test/fixtures/ebook-library/` directory
