## ADDED Requirements

### Requirement: Admin can configure library write settings

The system SHALL allow an admin to set `libraryWriteEnabled` (boolean) via `PUT /api/v1/settings/library`. This toggle controls whether Litara is permitted to write files to the library volume. The setting SHALL only take effect when the volume is not mounted `:ro`; if the volume is read-only, writes are blocked regardless of this toggle. The current read-only mount status SHALL be exposed as a read-only field in the response so the UI can inform the admin.

#### Scenario: Admin enables library writes

- **WHEN** an admin sends `PUT /api/v1/settings/library` with `{ "libraryWriteEnabled": true }` and the volume is writable
- **THEN** the system stores the setting and returns 200 with `{ libraryWriteEnabled: true, volumeReadOnly: false }`

#### Scenario: Admin enables library writes but volume is read-only

- **WHEN** an admin sends `PUT /api/v1/settings/library` with `{ "libraryWriteEnabled": true }` but the volume is mounted `:ro`
- **THEN** the system stores the setting but returns 200 with `{ libraryWriteEnabled: true, volumeReadOnly: true }` — the UI SHALL display a warning that writes remain blocked due to the read-only mount

#### Scenario: Non-admin cannot modify library write settings

- **WHEN** a non-admin sends `PUT /api/v1/settings/library`
- **THEN** the system returns 403 Forbidden

---

### Requirement: Admin can configure a Shelfmark URL from the settings page

The settings page SHALL include a Shelfmark section where an admin can enter and save a Shelfmark instance URL. No credentials are required or stored.

#### Scenario: Shelfmark section visible on settings page (web)

- **WHEN** an admin navigates to the server settings page
- **THEN** a Shelfmark section is visible with a URL input field and a Save button

#### Scenario: Shelfmark section hidden from non-admins

- **WHEN** a non-admin user views the settings page
- **THEN** the Shelfmark section is not rendered

#### Scenario: Library write section shows volume read-only warning

- **WHEN** an admin views the library settings section and the volume is mounted `:ro`
- **THEN** the page displays a notice "Library volume is mounted read-only — file writes are not available" and the write-enable toggle is shown as disabled/informational only
