## ADDED Requirements

---

### Requirement: User can save their personal SMTP configuration

The system SHALL allow any authenticated user to save a personal SMTP configuration including host, port, from address, username, password, and toggles for authentication and STARTTLS. The password SHALL be stored encrypted at rest using AES-256-GCM and SHALL never be returned to the frontend after it is saved.

#### Scenario: Save personal SMTP configuration

- **WHEN** an authenticated user submits a PUT request to `/api/v1/users/me/smtp` with valid host, port, fromAddress, username, password, enableAuth, and enableStartTls fields
- **THEN** the system stores the configuration (password encrypted) and returns 200 with all fields except password (password field is omitted from the response)

#### Scenario: Update personal SMTP without changing password

- **WHEN** an authenticated user submits a PUT request to `/api/v1/users/me/smtp` with a new host value and no password field
- **THEN** the system updates the host and retains the previously stored encrypted password

#### Scenario: Read personal SMTP configuration

- **WHEN** an authenticated user submits a GET request to `/api/v1/users/me/smtp` and a configuration exists
- **THEN** the system returns 200 with host, port, fromAddress, username, enableAuth, enableStartTls, and a masked password hint (last 3 characters only) — the plaintext password is NOT present

#### Scenario: Read when no personal SMTP configuration exists

- **WHEN** an authenticated user submits a GET request to `/api/v1/users/me/smtp` and they have not saved a configuration
- **THEN** the system returns 404 Not Found

#### Scenario: Delete personal SMTP configuration

- **WHEN** an authenticated user submits a DELETE request to `/api/v1/users/me/smtp`
- **THEN** the system removes the configuration and returns 204 No Content

#### Scenario: Unauthenticated request is rejected

- **WHEN** an unauthenticated request is made to any `/api/v1/users/me/smtp` endpoint
- **THEN** the system returns 401 Unauthorized

---

### Requirement: User can test their personal SMTP configuration

The system SHALL allow any authenticated user to test their SMTP settings by attempting a live connection without saving the configuration.

#### Scenario: Test personal SMTP — success

- **WHEN** an authenticated user submits a POST request to `/api/v1/users/me/smtp/test` with valid SMTP credentials
- **THEN** the system attempts an SMTP connection verify and returns 200 with `{ success: true }`

#### Scenario: Test personal SMTP — connection failure

- **WHEN** an authenticated user submits a POST request to `/api/v1/users/me/smtp/test` with credentials that fail to connect
- **THEN** the system returns 200 with `{ success: false, error: "<SMTP error message>" }` (not a 5xx, since the request itself succeeded — only the SMTP probe failed)

#### Scenario: Test personal SMTP — password omitted (use saved)

- **WHEN** an authenticated user submits a POST request to `/api/v1/users/me/smtp/test` without a password field and they have a saved personal SMTP config
- **THEN** the system uses the saved encrypted password for the test

#### Scenario: Test personal SMTP — password omitted, no saved config

- **WHEN** an authenticated user submits a POST request to `/api/v1/users/me/smtp/test` without a password field and they have no saved personal SMTP config
- **THEN** the system returns 422 Unprocessable Entity indicating no password is available

---

### Requirement: Admin can save server-level SMTP configuration

The system SHALL allow an admin to save a server-level SMTP configuration. This config acts as a shared fallback for users who have not configured personal SMTP. The password SHALL be stored encrypted at rest and SHALL never be returned to the frontend after it is saved.

#### Scenario: Save server SMTP configuration

- **WHEN** an admin submits a PUT request to `/api/v1/settings/smtp` with valid host, port, fromAddress, username, password, enableAuth, and enableStartTls fields
- **THEN** the system stores the configuration (password encrypted) and returns 200 with all fields except password

#### Scenario: Non-admin cannot save server SMTP configuration

- **WHEN** a non-admin authenticated user submits a PUT request to `/api/v1/settings/smtp`
- **THEN** the system returns 403 Forbidden

#### Scenario: Unauthenticated request is rejected

- **WHEN** an unauthenticated request is made to `PUT /api/v1/settings/smtp`
- **THEN** the system returns 401 Unauthorized

---

### Requirement: Admin can read server-level SMTP configuration

The system SHALL allow an admin to retrieve the current server SMTP configuration. The password field SHALL be omitted from the response. If no configuration has been saved, the system SHALL return a 404.

#### Scenario: Read saved server SMTP configuration

- **WHEN** an admin submits a GET request to `/api/v1/settings/smtp` and a configuration exists
- **THEN** the system returns 200 with host, port, fromAddress, username, enableAuth, enableStartTls, and a masked password hint — password is NOT present in the response

#### Scenario: Read when no server configuration exists

- **WHEN** an admin submits a GET request to `/api/v1/settings/smtp` and no configuration has been saved
- **THEN** the system returns 404 Not Found

#### Scenario: Non-admin cannot read server SMTP configuration

- **WHEN** a non-admin authenticated user submits a GET request to `/api/v1/settings/smtp`
- **THEN** the system returns 403 Forbidden

---

### Requirement: Password update is optional on subsequent saves (both user and server config)

The system SHALL treat an absent or empty password field on `PUT /api/v1/users/me/smtp` or `PUT /api/v1/settings/smtp` as "keep the existing password unchanged".

#### Scenario: Update host without changing password (server config)

- **WHEN** an admin submits a PUT request to `/api/v1/settings/smtp` with a new host value and no password field
- **THEN** the system updates the host and retains the previously stored encrypted password

---

### Requirement: Admin can test the server-level SMTP configuration

The system SHALL allow an admin to test the server SMTP settings by attempting a live connection without saving.

#### Scenario: Test server SMTP — success

- **WHEN** an admin submits a POST request to `/api/v1/settings/smtp/test` with valid SMTP credentials
- **THEN** the system returns 200 with `{ success: true }`

#### Scenario: Test server SMTP — connection failure

- **WHEN** an admin submits a POST request to `/api/v1/settings/smtp/test` with credentials that fail to connect
- **THEN** the system returns 200 with `{ success: false, error: "<SMTP error message>" }`

#### Scenario: Non-admin cannot test server SMTP

- **WHEN** a non-admin authenticated user submits a POST request to `/api/v1/settings/smtp/test`
- **THEN** the system returns 403 Forbidden
