## ADDED Requirements

### Requirement: Admin can enable or disable disk writes

The system SHALL expose an `allow_disk_writes` setting (stored in `ServerSettings` as key `allow_disk_writes`, value `'true'`/`'false'`). When absent the value SHALL be treated as `false`. Only users with the ADMIN role SHALL be able to read or change this setting.

#### Scenario: Read disk settings when allow_disk_writes is absent

- **WHEN** an admin calls `GET /api/v1/admin/settings/disk` and no `allow_disk_writes` key exists in `ServerSettings`
- **THEN** the response includes `{ "allowDiskWrites": false }`

#### Scenario: Admin enables disk writes

- **WHEN** an admin calls `PATCH /api/v1/admin/settings/disk` with `{ "allowDiskWrites": true }`
- **THEN** the `allow_disk_writes` key is upserted in `ServerSettings` with value `"true"` and the response includes `{ "allowDiskWrites": true }`

#### Scenario: Admin disables disk writes

- **WHEN** an admin calls `PATCH /api/v1/admin/settings/disk` with `{ "allowDiskWrites": false }`
- **THEN** the `allow_disk_writes` key is upserted with value `"false"` and the response includes `{ "allowDiskWrites": false }`

#### Scenario: Non-admin cannot read disk settings

- **WHEN** a non-admin user calls `GET /api/v1/admin/settings/disk`
- **THEN** the API returns 403 Forbidden

### Requirement: Disk write operations are blocked when writes are disabled

All endpoints that write to the filesystem SHALL check the `allow_disk_writes` setting before proceeding. If the setting is false, the endpoint SHALL return 403 Forbidden with a message indicating that disk writes are disabled in admin settings.

#### Scenario: Write sidecar blocked when disk writes disabled

- **WHEN** `allow_disk_writes` is `false` and a user calls `POST /api/v1/books/:id/sidecar/write`
- **THEN** the API returns 403 with `{ "message": "Disk writes are disabled. Enable them in Admin → Disk Settings." }`

#### Scenario: Bulk write blocked when disk writes disabled

- **WHEN** `allow_disk_writes` is `false` and an admin calls `POST /api/v1/admin/sidecar/bulk-write`
- **THEN** the API returns 403 with the same disabled message

### Requirement: API detects and reports read-only mount status

The `GET /admin/settings/disk` endpoint SHALL probe the library root directory by attempting to write and immediately delete a zero-byte temp file. The result SHALL be returned as `isReadOnlyMount: boolean` alongside the setting value. The probe SHALL run on every call to reflect current mount state.

#### Scenario: Library directory is writable

- **WHEN** an admin calls `GET /api/v1/admin/settings/disk` and the library directory allows file creation
- **THEN** the response includes `{ "isReadOnlyMount": false }`

#### Scenario: Library directory is read-only (e.g., EROFS, EACCES)

- **WHEN** an admin calls `GET /api/v1/admin/settings/disk` and writing a temp file to the library directory throws EROFS, EACCES, or EPERM
- **THEN** the response includes `{ "isReadOnlyMount": true }` and the endpoint still returns 200 (not an error)

#### Scenario: Probe file is cleaned up after detection

- **WHEN** the probe write succeeds
- **THEN** the temp file is deleted before the response is returned, leaving no artefacts in the library directory

### Requirement: Admin UI shows disk write settings panel

The Admin page SHALL display a "Disk Writes" settings panel containing: the `allow_disk_writes` toggle, a warning banner when `isReadOnlyMount` is true, and an explanatory note recommending Docker RO volume mounts for users who want a hard guarantee.

#### Scenario: RO mount warning displayed

- **WHEN** `GET /admin/settings/disk` returns `isReadOnlyMount: true`
- **THEN** the UI shows a yellow/orange alert explaining that the library directory appears to be mounted read-only and disk write operations will fail

#### Scenario: Disk writes disabled state shown in UI

- **WHEN** `allowDiskWrites` is `false`
- **THEN** the toggle is shown as off and write-related action buttons (Write to Disk, Write All Sidecars) are visually disabled or hidden with a tooltip explaining why
