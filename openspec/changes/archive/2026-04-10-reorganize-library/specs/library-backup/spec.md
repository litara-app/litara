## ADDED Requirements

### Requirement: Admin can download a full library backup as a zip

The system SHALL provide a `GET /api/v1/admin/library/backup/download` endpoint, accessible only to authenticated admins, that streams a zip archive of all non-missing book files to the HTTP response. The zip SHALL preserve the relative folder structure of each file within the library root (i.e. `Author/[Series/]Title.ext` paths inside the archive). The response Content-Disposition header SHALL suggest a filename of `litara-backup-<YYYY-MM-DD>.zip`.

#### Scenario: Successful backup download

- **WHEN** an admin requests `GET /admin/library/backup/download` and the library contains files
- **THEN** the server responds with `Content-Type: application/zip`, `Content-Disposition: attachment; filename="litara-backup-<date>.zip"`, and streams the zip body; the browser saves the file

#### Scenario: Empty library

- **WHEN** an admin requests `GET /admin/library/backup/download` and no non-missing BookFile records exist
- **THEN** the server returns a valid (empty) zip archive with HTTP 200

#### Scenario: Unauthenticated or non-admin request

- **WHEN** a request is made without a valid admin JWT
- **THEN** the server returns HTTP 401 or 403 and no zip data is sent

#### Scenario: A file is missing on disk during streaming

- **WHEN** a `BookFile` record exists but the file is absent from disk at stream time
- **THEN** the system skips that file and continues streaming; missing files are not included in the archive

---

### Requirement: Admin can check estimated backup size before downloading

The system SHALL provide a `GET /api/v1/admin/library/backup/size` endpoint that returns `{ totalBytes: number, fileCount: number }` by summing `BookFile.sizeBytes` for all non-missing files. This allows the UI to warn the user before initiating a potentially large download.

#### Scenario: Size estimate returned

- **WHEN** an admin requests `GET /admin/library/backup/size`
- **THEN** the server returns `{ totalBytes, fileCount }` with HTTP 200

#### Scenario: Size exceeds warning threshold

- **WHEN** `totalBytes` exceeds 2 147 483 648 (2 GiB)
- **THEN** the response still returns HTTP 200 with the actual numbers; it is the UI's responsibility to display the warning (the threshold is a UI concern, not enforced server-side)

---

### Requirement: Admin UI surfaces the backup action with size warning

The web admin page SHALL display a "Download Backup" button alongside the "Reorganize Library" button. Before initiating the download, the UI SHALL fetch the size estimate. If `totalBytes` exceeds 2 GiB, a warning SHALL be shown (e.g. "This backup is approximately X GB — large downloads may time out depending on your network and server configuration.") with an option to proceed or cancel.

#### Scenario: Small library — no warning

- **WHEN** the admin opens the backup section and `totalBytes` is below 2 GiB
- **THEN** clicking "Download Backup" initiates the download immediately with no interstitial warning

#### Scenario: Large library — warning shown

- **WHEN** the admin opens the backup section and `totalBytes` is 2 GiB or more
- **THEN** clicking "Download Backup" first shows a warning modal with the estimated size; the admin must confirm before the download starts

#### Scenario: Size fetch fails

- **WHEN** the size estimate request fails
- **THEN** the UI proceeds as if the library is large (shows the warning modal) to err on the side of caution

---

### Requirement: Backup does not require disk write permissions

The backup download SHALL be available regardless of the `allowDiskWrites` setting and regardless of whether the library volume is read-only. It is a read-only operation.

#### Scenario: Backup available when disk writes are disabled

- **WHEN** `allowDiskWrites` is `false` in server settings
- **THEN** the "Download Backup" button is still enabled and functional

#### Scenario: Backup available on read-only mount

- **WHEN** the library volume is mounted read-only
- **THEN** the "Download Backup" button is still enabled and functional
