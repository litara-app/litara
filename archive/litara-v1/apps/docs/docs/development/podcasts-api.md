---
sidebar_position: 7
---

# Podcasts API

This page documents the `PodcastModule` endpoints under `/api/v1/podcasts` and the background scheduler service.

## Data models

### `Podcast`

| Column                   | Type              | Notes                                                |
| ------------------------ | ----------------- | ---------------------------------------------------- |
| `id`                     | `String`          | UUID primary key                                     |
| `feedUrl`                | `String`          | Unique — RSS feed URL                                |
| `title`                  | `String`          |                                                      |
| `description`            | `String?`         |                                                      |
| `artworkUrl`             | `String?`         |                                                      |
| `author`                 | `String?`         |                                                      |
| `websiteUrl`             | `String?`         |                                                      |
| `lastRefreshedAt`        | `DateTime?`       | When the feed was last successfully fetched          |
| `nextRefreshAt`          | `DateTime?`       | Computed by the scheduler                            |
| `refreshIntervalMinutes` | `Int`             | Default 60; minimum 15, maximum 10080 (1 wk)         |
| `downloadPolicy`         | `DownloadPolicy`  | `ALL \| LATEST_N \| MANUAL`                          |
| `keepLatestN`            | `Int?`            | Required when `downloadPolicy = LATEST_N`            |
| `retentionPolicy`        | `RetentionPolicy` | `KEEP_ALL \| DELETE_AFTER_LISTENED \| KEEP_LATEST_N` |
| `subscribed`             | `Boolean`         | `false` after unsubscribe (soft record)              |
| `createdAt`              | `DateTime`        |                                                      |
| `updatedAt`              | `DateTime`        |                                                      |

### `PodcastEpisode`

| Column           | Type                    | Notes                                                              |
| ---------------- | ----------------------- | ------------------------------------------------------------------ |
| `id`             | `String`                | UUID primary key                                                   |
| `podcastId`      | `String`                | FK → `Podcast`, cascade delete                                     |
| `guid`           | `String`                | RSS item GUID                                                      |
| `title`          | `String`                |                                                                    |
| `description`    | `String?`               |                                                                    |
| `publishedAt`    | `DateTime?`             |                                                                    |
| `duration`       | `Float?`                | Seconds, parsed from RSS `<itunes:duration>`                       |
| `audioUrl`       | `String`                | Original remote URL from the RSS feed                              |
| `downloadStatus` | `EpisodeDownloadStatus` | `NOT_DOWNLOADED \| PENDING \| DOWNLOADING \| DOWNLOADED \| FAILED` |
| `downloadPath`   | `String?`               | Absolute server path when downloaded                               |
| `fileSize`       | `BigInt?`               | Bytes                                                              |

Constraint: `@@unique([podcastId, guid])` — prevents duplicate episodes across feed refreshes.

### `PodcastEpisodeProgress`

| Column        | Type       | Notes                                 |
| ------------- | ---------- | ------------------------------------- |
| `id`          | `String`   | UUID primary key                      |
| `userId`      | `String`   | FK → `User`, cascade delete           |
| `episodeId`   | `String`   | FK → `PodcastEpisode`, cascade delete |
| `currentTime` | `Float`    | Playback position in seconds          |
| `updatedAt`   | `DateTime` |                                       |

Constraint: `@@unique([userId, episodeId])`

## Base path

```
/api/v1/podcasts
```

All endpoints except `GET /episodes/:id/stream` require a JWT (`Authorization: Bearer <token>`).

## Endpoints

### GET `/settings`

Returns whether the podcast feature is enabled. Admin only.

**Response:**

```json
{ "enabled": true }
```

---

### PATCH `/settings`

Enables or disables the podcast feature globally. Admin only.

**Request body:**

```json
{ "enabled": true }
```

---

### POST `/`

Subscribe to a podcast by RSS feed URL. Returns `409` if already subscribed, `403` if podcasts are disabled.

**Request body:**

```json
{ "feedUrl": "https://example.com/feed.rss" }
```

**Response** — `PodcastDto` (201 Created).

---

### GET `/`

Returns all subscribed podcasts for the authenticated user. Returns `403` if podcasts are disabled.

**Response** — array of `PodcastDto`.

---

### GET `/:id`

Returns a single podcast by ID including `episodeCount`.

**Response** — `PodcastDto`. Returns **404** if not found.

---

### PATCH `/:id`

Update per-podcast settings (refresh interval, download policy, retention policy).

**Request body** (`UpdatePodcastSettingsDto` — all fields optional):

```json
{
  "refreshIntervalMinutes": 120,
  "downloadPolicy": "LATEST_N",
  "keepLatestN": 5,
  "retentionPolicy": "KEEP_LATEST_N"
}
```

Returns **400** if `refreshIntervalMinutes` is outside [15, 10080].

---

### DELETE `/:id`

Unsubscribe from a podcast. The podcast record is soft-deleted (`subscribed = false`).

**Query params:**

| Param         | Values          | Description                                |
| ------------- | --------------- | ------------------------------------------ |
| `deleteFiles` | `true \| false` | Whether to delete downloaded episode files |

**Response:** `204 No Content`

---

### GET `/:id/episodes`

Returns paginated episodes for a podcast, joined with the requesting user's progress.

**Query params:** `page` (default 1), `pageSize` (default 50).

**Response:**

```json
{
  "episodes": [
    {
      "id": "uuid",
      "podcastId": "uuid",
      "title": "Episode 42",
      "publishedAt": "2026-03-01T00:00:00.000Z",
      "duration": 3600,
      "downloadStatus": "DOWNLOADED",
      "currentTime": 1234.5
    }
  ],
  "total": 120
}
```

`currentTime` is `null` when the user has no progress for that episode.

---

### PUT `/episodes/:id/progress`

Saves the playback position for an episode. Creates or updates the `PodcastEpisodeProgress` row. An episode is automatically marked listened when `currentTime / duration >= 0.95`.

**Request body:**

```json
{ "currentTime": 1234.5 }
```

**Response:** `204 No Content`

---

### POST `/episodes/:id/download`

Queues an episode for download. Returns immediately; the download runs in a background queue (max 3 concurrent).

**Response:**

```json
{ "status": "queued" }
```

Also returns `"already_downloaded"` or `"already_downloading"` without re-queuing.

---

### GET `/episodes/:id/stream`

Streams the downloaded episode audio file. Uses a short-lived stream token instead of a JWT (compatible with `<audio>` src and `react-native-track-player`).

**Auth:** Stream token via `?streamToken=<token>` (issued by `POST /stream-token`).

**Response:** Byte-range-capable audio stream (`206 Partial Content` for range requests).

---

### POST `/stream-token`

Issues a short-lived stream token for the authenticated user. Tokens are shared with the audiobook streaming system (`AudiobookStreamTokenService`).

**Response:**

```json
{ "token": "abc123", "expiresAt": "2026-05-03T12:05:00.000Z" }
```

---

### POST `/:id/refresh`

Fetches the RSS feed immediately and syncs new episodes. Returns the updated `PodcastDto`.

---

### POST `/scan-storage`

Scans `PODCAST_STORAGE_PATH` for `.mp3`/`.m4a`/`.m4b` files and links them to existing episode records by filename. Admin only.

---

### POST `/import-storage`

Like `scan-storage` but also creates missing `Podcast` and `PodcastEpisode` records for files that have no matching DB entry. Admin only.

---

## Scheduler service

`PodcastSchedulerService` runs a cron job every minute and refreshes any podcast whose `nextRefreshAt` is in the past.

After each successful refresh, `nextRefreshAt` is set to `now + refreshIntervalMinutes`. On failure, a shorter retry interval (`refreshIntervalMinutes / 4`, minimum 15 minutes) is used.

The scheduler creates a `Task` row (visible in **Admin → Tasks**) for manual refresh operations triggered via `POST /:id/refresh`.

## Download queue

`PodcastService` maintains an in-memory download queue with configurable concurrency (`maxConcurrentDownloads = 3`). `requestDownload` pushes an episode ID onto the queue; `processQueue` dequeues and calls `downloadEpisode` for each slot.

`downloadEpisode` streams the remote `audioUrl` to `PODCAST_STORAGE_PATH/<podcastId>/<episodeId>.<ext>`, writes the file size to the DB, and updates `downloadStatus` through `DOWNLOADING → DOWNLOADED` (or `FAILED` on error).

After a download completes, `applyRetentionPolicy` runs to enforce `KEEP_LATEST_N` or `DELETE_AFTER_LISTENED` rules for the parent podcast.
