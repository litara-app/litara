## ADDED Requirements

### Requirement: Admin can trigger a bulk sidecar write for all books

The system SHALL expose `POST /api/v1/admin/sidecar/bulk-write` which queues a background task that iterates every book with at least one non-missing on-disk file and writes a `.metadata.json` sidecar file for each. The endpoint SHALL check the disk-write guard before proceeding. The endpoint SHALL return immediately with `{ "taskId": "<id>" }` and the work SHALL proceed asynchronously.

#### Scenario: Bulk write queued successfully

- **WHEN** disk writes are enabled and an admin calls `POST /api/v1/admin/sidecar/bulk-write`
- **THEN** the API returns 200 with `{ "taskId": "<id>" }` and the background task begins

#### Scenario: Bulk write blocked when disk writes disabled

- **WHEN** `allow_disk_writes` is false
- **THEN** the API returns 403 before any files are written

#### Scenario: Non-admin cannot trigger bulk write

- **WHEN** a non-admin user calls `POST /api/v1/admin/sidecar/bulk-write`
- **THEN** the API returns 403 Forbidden

### Requirement: Bulk write task reports progress and results

The background task SHALL log progress to the `Task` record's output. On completion the task log SHALL include a summary line with counts: `Written: N, Skipped: N, Failed: N`. A book is "skipped" if it has no non-missing files. A book is "failed" if the individual write throws an error (the task SHALL continue to the next book rather than aborting).

#### Scenario: Task log includes per-book progress

- **WHEN** the bulk write task is running
- **THEN** each successfully written sidecar appends a log line `[write] <title> → <path>`

#### Scenario: Task log includes failures without aborting

- **WHEN** writing a sidecar for one book fails (e.g. permission error)
- **THEN** a `[error] <title>: <message>` line is appended and the task continues to the next book

#### Scenario: Task summary on completion

- **WHEN** the bulk write task finishes processing all books
- **THEN** the final log line is `Done. Written: N, Skipped: N, Failed: N` and the task status is set to `COMPLETED`

### Requirement: Bulk write runs with bounded concurrency

The bulk write task SHALL process books with a maximum concurrency of 10 parallel writes to avoid overwhelming NFS servers or slow network volumes.

#### Scenario: Concurrency cap respected

- **WHEN** the library has more than 10 books to write
- **THEN** at most 10 sidecar writes are in-flight simultaneously at any point during the task

### Requirement: Admin UI provides a bulk write trigger

The Admin "Disk Settings" panel SHALL include a "Write All Sidecars" button. The button SHALL be disabled when `allowDiskWrites` is false. After clicking, the UI SHALL show a loading/success state and display a link or summary directing the admin to the Tasks tab to monitor progress.

#### Scenario: Bulk write button triggers task and shows feedback

- **WHEN** an admin clicks "Write All Sidecars" and the API returns `{ "taskId": "..." }`
- **THEN** the button shows a success alert: "Bulk write started. Monitor progress in the Tasks tab."

#### Scenario: Bulk write button disabled when guard off

- **WHEN** `allowDiskWrites` is false
- **THEN** the "Write All Sidecars" button is disabled with a tooltip explaining disk writes must be enabled first
