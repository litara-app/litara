## ADDED Requirements

### Requirement: System polls RSS feeds on a per-subscription schedule

The system SHALL run a background scheduler that checks each subscription's `nextRefreshAt` timestamp every minute. When a subscription is due for refresh, the system SHALL fetch its RSS feed, parse new episodes, and enqueue them for download according to the subscription's `downloadPolicy`.

#### Scenario: Scheduled refresh creates new episode records

- **WHEN** the scheduler fires and a subscription's feed contains episodes not yet in the database
- **THEN** new `PodcastEpisode` records are created with `downloadStatus: pending` (if policy is not `manual`)

#### Scenario: Refresh updates subscription metadata

- **WHEN** the scheduler refreshes a feed
- **THEN** the `Podcast` record's `title`, `description`, `artworkUrl`, and `lastRefreshedAt` are updated from the feed

#### Scenario: Failed feed fetch is logged and retried next cycle

- **WHEN** the scheduler cannot reach a feed URL
- **THEN** the failure is logged, `nextRefreshAt` is advanced by the configured interval, and no episode records are modified

### Requirement: Episode download respects download policy

The system SHALL evaluate each subscription's `downloadPolicy` when deciding which episodes to download:

- `all`: download every new episode
- `latestN`: download only the N most recent episodes; older episodes remain as metadata-only
- `manual`: do not auto-download; user must manually trigger individual episode downloads

#### Scenario: All policy downloads every new episode

- **WHEN** a feed refresh produces 3 new episodes and policy is `all`
- **THEN** all 3 episodes are enqueued for download

#### Scenario: LatestN policy limits downloads

- **WHEN** a feed refresh produces 5 new episodes and policy is `latestN` with `keepLatestN = 2`
- **THEN** only the 2 most recent episodes are enqueued; the other 3 are saved as metadata-only

#### Scenario: Manual policy skips auto-download

- **WHEN** a feed refresh produces new episodes and policy is `manual`
- **THEN** episode metadata is saved but no files are downloaded automatically

### Requirement: Downloads are performed with concurrency control

The system SHALL limit simultaneous episode downloads to a configurable maximum (default 2). Downloads exceeding the concurrency limit SHALL be queued and processed in FIFO order.

#### Scenario: Concurrency limit respected

- **WHEN** 5 episodes are enqueued for download simultaneously
- **THEN** at most 2 download simultaneously; the remaining 3 wait in queue

### Requirement: Download state is tracked per episode

Each `PodcastEpisode` SHALL have a `downloadStatus` field with values: `not_downloaded`, `pending`, `downloading`, `downloaded`, `failed`. The `downloadPath` field stores the local file path when status is `downloaded`.

#### Scenario: Successful download updates status

- **WHEN** an episode file is fully downloaded to disk
- **THEN** `downloadStatus` is set to `downloaded` and `downloadPath` is set to the local file path

#### Scenario: Failed download marks episode

- **WHEN** a download fails (network error, timeout, 4xx/5xx response)
- **THEN** `downloadStatus` is set to `failed` and the error is logged; the episode can be retried manually

### Requirement: Retention policy enforces storage limits

After each refresh, the system SHALL apply the subscription's `retentionPolicy`:

- `keepAll`: no automatic deletion
- `deleteAfterListened`: delete the file (but keep metadata) after the user's playback position reaches 95% or more
- `keepLatestN`: keep only the N most recently published downloaded episodes; delete older downloaded files

#### Scenario: keepLatestN prunes old files

- **WHEN** a subscription with `retentionPolicy: keepLatestN` and `keepLatestN = 3` has 5 downloaded episodes after refresh
- **THEN** the 2 oldest downloaded files are deleted from disk and their `downloadStatus` is set to `not_downloaded`

#### Scenario: deleteAfterListened removes file on completion

- **WHEN** a user's playback progress for an episode reaches 95% and retention is `deleteAfterListened`
- **THEN** the audio file is deleted and `downloadStatus` is set to `not_downloaded`

### Requirement: User can manually trigger episode download

The system SHALL provide an API endpoint to manually request download of a specific episode, regardless of the subscription's `downloadPolicy`.

#### Scenario: Manual download enqueued

- **WHEN** a user requests a manual download for a specific episode
- **THEN** the episode's `downloadStatus` is set to `pending` and it is added to the download queue
