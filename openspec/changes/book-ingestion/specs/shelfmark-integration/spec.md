## ADDED Requirements

### Requirement: Admin can configure an optional Shelfmark URL

The system SHALL allow an admin to save a Shelfmark instance URL via `PUT /api/v1/settings/shelfmark`. Only a URL string is stored — no credentials. `GET /api/v1/settings/shelfmark` returns the current value (or null if not set).

#### Scenario: Admin saves a Shelfmark URL

- **WHEN** an admin sends `PUT /api/v1/settings/shelfmark` with `{ "shelfmarkUrl": "https://shelfmark.example.com" }`
- **THEN** the system stores the URL in `ServerSettings` and returns 200 with `{ shelfmarkUrl: "https://shelfmark.example.com" }`

#### Scenario: Admin clears the Shelfmark URL

- **WHEN** an admin sends `PUT /api/v1/settings/shelfmark` with `{ "shelfmarkUrl": null }` or an empty string
- **THEN** the system clears the stored URL and returns 200 with `{ shelfmarkUrl: null }`

#### Scenario: Non-admin cannot configure Shelfmark URL

- **WHEN** a non-admin sends `PUT /api/v1/settings/shelfmark`
- **THEN** the system returns 403 Forbidden

#### Scenario: Unauthenticated request is rejected

- **WHEN** an unauthenticated request is made to `PUT /api/v1/settings/shelfmark`
- **THEN** the system returns 401 Unauthorized

---

### Requirement: Web navigation shows Shelfmark external link when configured

When a Shelfmark URL is configured, the web left navigation bar SHALL display a "Shelfmark" link with an external-link icon. Clicking it SHALL open the Shelfmark URL in a new browser tab. The link SHALL NOT appear when no URL is configured.

#### Scenario: Shelfmark URL is configured — link appears in nav

- **WHEN** a Shelfmark URL is saved in server settings and any authenticated user views the app
- **THEN** the left navigation bar shows a "Shelfmark" item with an external-link icon

#### Scenario: Clicking the nav link opens Shelfmark externally

- **WHEN** a user clicks the Shelfmark navigation item
- **THEN** the Shelfmark URL opens in a new browser tab and the user remains on the current Litara page

#### Scenario: No Shelfmark URL configured — link is absent

- **WHEN** no Shelfmark URL is saved in server settings
- **THEN** the Shelfmark navigation item does not appear

---

### Requirement: Mobile navigation shows Shelfmark external link when configured

When a Shelfmark URL is configured, the mobile app navigation SHALL display a "Shelfmark" item with an external-link icon. Tapping it SHALL open the URL in the device's default browser via `Linking.openURL`.

#### Scenario: Shelfmark link appears in mobile nav when configured

- **WHEN** a Shelfmark URL is configured and any authenticated user opens the mobile app
- **THEN** the navigation includes a "Shelfmark" item with an external-link icon

#### Scenario: Tapping the mobile Shelfmark link opens external browser

- **WHEN** a user taps the Shelfmark navigation item on mobile
- **THEN** the device's default browser opens the configured Shelfmark URL

#### Scenario: No Shelfmark URL configured — mobile link is absent

- **WHEN** no Shelfmark URL is saved in server settings
- **THEN** the Shelfmark navigation item does not appear in the mobile app
