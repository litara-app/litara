## ADDED Requirements

### Requirement: Podcasts feature is disabled by default

The system SHALL store a `podcastsEnabled` boolean in `ServerSettings` that defaults to `false`. When `false`, no podcast-related UI elements (navigation items, settings sections, routes) SHALL be visible or accessible anywhere in the web or mobile apps.

#### Scenario: Fresh install has podcasts hidden

- **WHEN** a user installs Litara for the first time
- **THEN** no podcast navigation, settings sections, or routes are visible in the web or mobile app

#### Scenario: Podcast routes are inaccessible when disabled

- **WHEN** a user navigates directly to a podcast URL (e.g., `/podcasts`) while podcasts are disabled
- **THEN** the app redirects to the home page or returns a 404

### Requirement: Admin can enable podcasts from server settings

The system SHALL provide an "Enable Podcasts" toggle in the admin server settings panel. When toggled on, the admin MUST also be prompted to set a `podcastStoragePath` before podcasts become active.

#### Scenario: Admin enables podcasts

- **WHEN** the admin enables the podcasts toggle and saves settings
- **THEN** podcast navigation and features become immediately visible to all users on next page load or app refresh

#### Scenario: Admin disables podcasts

- **WHEN** the admin disables the podcasts toggle and saves settings
- **THEN** all podcast UI is hidden; existing subscription data and downloaded files are preserved but inaccessible until re-enabled

### Requirement: Feature flag is read on app load

The web app SHALL fetch the `podcastsEnabled` flag as part of the server settings API call on startup and store it in a global Jotai atom. The mobile app SHALL fetch it on launch and store it in a React context or equivalent global state.

#### Scenario: Web app loads with podcasts enabled

- **WHEN** the web app loads and server settings return `podcastsEnabled: true`
- **THEN** podcast navigation items are rendered in the sidebar

#### Scenario: Web app loads with podcasts disabled

- **WHEN** the web app loads and server settings return `podcastsEnabled: false`
- **THEN** no podcast navigation items are rendered

### Requirement: Podcast storage path is required when enabling podcasts

The system SHALL require a valid `podcastStoragePath` to be configured before the feature can be enabled. The API SHALL reject enabling podcasts if the storage path is not set.

#### Scenario: Enable podcasts without storage path

- **WHEN** the admin attempts to enable podcasts without setting a storage path
- **THEN** the API returns a validation error and podcasts remain disabled

#### Scenario: Enable podcasts with valid storage path

- **WHEN** the admin sets a valid storage path and enables podcasts
- **THEN** the API accepts the change and podcasts become active
