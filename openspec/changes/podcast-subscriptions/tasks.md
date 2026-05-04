## 1. Database & Backend Foundation

- [x] 1.1 Add `podcastsEnabled` (Boolean, default false) and `podcastStoragePath` (String, nullable) fields to `ServerSettings` Prisma model
- [x] 1.2 Create `Podcast` Prisma model (feedUrl, title, description, artworkUrl, author, websiteUrl, lastRefreshedAt, refreshIntervalMinutes, downloadPolicy, keepLatestN, retentionPolicy)
- [x] 1.3 Create `PodcastEpisode` Prisma model (podcastId, guid, title, description, publishedAt, duration, audioUrl, downloadStatus, downloadPath, fileSize)
- [x] 1.4 Run `prisma migrate dev --name add-podcast-support` and verify migration applies cleanly
- [x] 1.5 Add `rss-parser` npm package to `apps/api`

## 2. Podcast Module & Subscription API

- [x] 2.1 Scaffold `PodcastModule` in `apps/api/src/podcast/` with controller, service, and DTOs
- [x] 2.2 Implement `POST /api/v1/podcasts` — fetch and parse RSS feed, create `Podcast` record, validate no duplicates
- [x] 2.3 Implement `GET /api/v1/podcasts` — list all subscriptions with episode count and lastRefreshedAt
- [x] 2.4 Implement `GET /api/v1/podcasts/:id/episodes` — list episodes with downloadStatus, pagination
- [x] 2.5 Implement `PATCH /api/v1/podcasts/:id` — update per-subscription settings (refreshInterval, downloadPolicy, keepLatestN, retentionPolicy) with validation
- [x] 2.6 Implement `DELETE /api/v1/podcasts/:id` — cancel active downloads, delete files, remove records
- [x] 2.7 Add `@ApiBearerAuth()` and Swagger decorators to all podcast endpoints
- [x] 2.8 Guard all podcast endpoints: return 403 if `podcastsEnabled` is false in `ServerSettings`

## 3. Episode Downloader & Scheduler

- [x] 3.1 Add `@nestjs/schedule` to `apps/api` if not already present; register `ScheduleModule` in `AppModule`
- [x] 3.2 Create `PodcastSchedulerService` with a `@Cron(CronExpression.EVERY_MINUTE)` job that finds subscriptions due for refresh
- [x] 3.3 Implement RSS feed fetch + diff: parse feed, insert new `PodcastEpisode` records, update `Podcast` metadata
- [x] 3.4 Implement download queue with max-concurrency-2 limit; enqueue episodes based on `downloadPolicy`
- [x] 3.5 Implement file download: stream-to-disk with progress tracking, set `downloadStatus` to `downloading` → `downloaded` or `failed`
- [x] 3.6 Implement retention policy enforcement: `keepLatestN` prunes old files; `deleteAfterListened` hook deletes file when progress ≥ 95%
- [x] 3.7 Implement `POST /api/v1/podcasts/episodes/:id/download` — manual download trigger
- [x] 3.8 Implement `GET /api/v1/podcasts/episodes/:id/stream` — stream downloaded audio file with Range request support; return 404 if not downloaded

## 4. Server Settings: Feature Flag

- [x] 4.1 Extend `ServerSettingsService` to expose `podcastsEnabled` and `podcastStoragePath` via the existing settings API response
- [x] 4.2 Extend `PATCH /api/v1/settings` to accept `podcastsEnabled` and `podcastStoragePath`; validate that storage path is set when enabling
- [x] 4.3 Validate that `podcastStoragePath` directory is accessible on the server when it is saved

## 5. Web Frontend — Feature Flag & Navigation

- [x] 5.1 Add `podcastsEnabled` field to the server settings Jotai atom in `apps/web/src/store/atoms.ts`
- [x] 5.2 Conditionally render a "Podcasts" link in the web sidebar only when `podcastsEnabled` is true
- [x] 5.3 Add podcast-related fields to the admin Server Settings form (enable toggle, storage path input); hide the whole section when podcasts are not yet enabled
- [x] 5.4 Guard the `/podcasts` React Router route: redirect to home if `podcastsEnabled` is false

## 6. Web Frontend — Podcast Pages

- [x] 6.1 Create `/podcasts` page with subscription list (artwork, title, episode count, last refreshed)
- [x] 6.2 Create "Add Subscription" modal with RSS URL input and validation feedback
- [x] 6.3 Create `/podcasts/:id` page with episode list (title, date, duration, status badge, Play/Download actions)
- [x] 6.4 Create subscription settings drawer (edit refresh interval, download policy, retention policy)
- [x] 6.5 Wire "Play" button to load episode stream URL into the existing `AudioPlayer` component
- [x] 6.6 Wire "Download" button to call manual download endpoint; show progress state

## 7. Mobile — Feature Flag & Navigation

- [x] 7.1 Fetch `podcastsEnabled` from server settings on app launch; store in React context or Jotai atom
- [x] 7.2 Conditionally render "Podcasts" tab in the bottom tab bar based on the flag
- [x] 7.3 Guard podcast screens: redirect if flag is false

## 8. Mobile — Podcast Screens & Playback

- [x] 8.1 Create Podcasts screen with subscription list (artwork, title, episode count)
- [x] 8.2 Create Subscription detail screen with episode list (title, date, duration, status, Play/Download)
- [x] 8.3 Implement `playPodcastEpisode()` in `apps/mobile/src/services/playback/`: save audiobook progress, clear RNTP queue, load episode track with metadata
- [x] 8.4 Wire mobile Play button to `playPodcastEpisode()`; disable for non-downloaded episodes
- [x] 8.5 Save and restore playback progress for podcast episodes using the existing progress API

## 9. Testing & Validation

- [x] 9.1 Unit test `PodcastSchedulerService`: feed parse diff, download policy enforcement, retention pruning
- [x] 9.2 Unit test subscription CRUD endpoints (subscribe duplicate, invalid URL, unsubscribe with active download)
- [x] 9.3 Verify all podcast endpoints return 403 when `podcastsEnabled` is false
- [x] 9.4 Verify web sidebar shows/hides podcast link correctly when flag toggles
- [x] 9.5 Verify mobile tab shows/hides correctly when flag toggles
- [x] 9.6 Run `tsc --noEmit` across `apps/api` and `apps/web` to confirm no type errors
