## Context

Litara is a self-hosted ebook/audiobook library manager (NestJS API + React web + React Native mobile). It already plays audiobooks via `react-native-track-player` on mobile and a custom HTML5 player on web. The backend uses Prisma + PostgreSQL, NestJS scheduled tasks (`@nestjs/schedule`), and file-based storage for library content.

Podcasts are a net-new vertical within the app. The primary complexity is threefold: (1) threading a feature flag through the full UI stack so all podcast surfaces are invisible until explicitly enabled; (2) scheduling reliable RSS polling + file downloads without blocking the API request cycle; (3) sharing the RNTP playback queue on mobile between audiobooks and podcasts without breaking existing audiobook playback.

## Goals / Non-Goals

**Goals:**

- Opt-in podcast feature that is 100% invisible (no nav items, no settings sections) when disabled
- Subscribe to any podcast via RSS 2.0 / Atom feed URL
- Scheduled background download of episodes to a configurable local path
- Per-subscription control: refresh interval, download policy, retention
- Web playback via the existing audio player component
- Mobile playback integrated into the existing RNTP queue

**Non-Goals:**

- Podcast discovery / search (no directory integration like iTunes Search API in v1)
- Video podcast support
- Playlist / smart shelf crossover between books and podcasts
- Push notifications for new episodes (can be added later)
- Transcription or chapter support in v1

## Decisions

### 1. Feature flag lives in `ServerSettings`

The existing `ServerSettings` Prisma model holds global config (SMTP, etc.). We add a `podcastsEnabled: Boolean @default(false)` field there.

- **Why**: Single source of truth already used for opt-in features. The frontend already fetches server settings on load.
- **Alternative**: Environment variable — rejected because it requires container restart to toggle and can't be changed from the UI.
- **Alternative**: Separate `FeatureFlags` table — overkill for one flag; revisit if more flags accumulate.

The web app reads this from the settings API on load and stores it in a Jotai atom. Mobile reads it on app launch and stores in context. All podcast routes/tabs gate on this value.

### 2. Separate `PodcastModule` with its own Prisma models

New models: `Podcast` (subscription), `PodcastEpisode`, `PodcastDownload` (per-file download state).

- **Why**: Clean separation, no risk of breaking existing library scanner or book models.
- **Alternative**: Reuse `Book`/`BookFile` models for episodes — rejected because the cardinality and lifecycle are fundamentally different (episodes don't belong to a library, have no authors in the book sense, need feed metadata).

### 3. RSS polling via `@nestjs/schedule` + `rss-parser`

A `PodcastSchedulerService` runs `@Cron` jobs. Each subscription stores its own `refreshIntervalMinutes`. A global cron fires every minute and enqueues feeds whose next-refresh time has passed.

- **Why**: `@nestjs/schedule` is the idiomatic NestJS solution. `rss-parser` is a well-maintained, zero-native-dep library for RSS 2.0 and Atom.
- **Alternative**: A separate worker process — unnecessary complexity for self-hosted single-instance deployment.
- **Risk**: If many subscriptions refresh simultaneously, download I/O could spike. Mitigation: serialize downloads via a simple in-memory queue with concurrency limit (default 2).

### 4. Downloads stored under a configurable `PODCAST_STORAGE_PATH`

Episode audio files are saved to `<PODCAST_STORAGE_PATH>/<podcast-slug>/<episode-guid>.<ext>`. Path is set in admin settings and stored in `ServerSettings`.

- **Why**: Mirrors the `EBOOK_LIBRARY_PATH` pattern; allows users to mount a separate volume for podcast storage.
- **Alternative**: Store alongside ebooks — rejected because podcast libraries can grow very large and users may want separate disks.

### 5. Mobile: podcasts use a separate RNTP queue track type, not mixed with audiobooks

On mobile, tapping a podcast episode calls a new `playPodcastEpisode()` action that clears the current RNTP queue and loads the episode (with `artist`, `album` mapped to podcast title/show). Audiobook playback is similarly isolated.

- **Why**: Mixing episode and chapter tracks in one queue creates confusing UX and complex state. Users expect clear context switching.
- **Alternative**: A unified queue with type discrimination — deferred to a future "unified media queue" feature.
- **Risk**: Switching from audiobook to podcast stops the audiobook. Mitigation: save audiobook progress before clearing queue (already done by `ProgressSaverService`).

### 6. Web playback reuses existing audio player component

The web reader already has an `<AudioPlayer>` component. Podcast episode playback will invoke the same component, passing the episode stream URL (served by the API) instead of a book file URL.

- **Why**: Zero new player code on web; consistent UX.
- **Alternative**: Embed a third-party podcast widget — rejected (external dep, no offline support).

## Risks / Trade-offs

- **RSS feed format variance** → Mitigation: `rss-parser` handles most quirks; log and skip malformed feeds rather than crashing the scheduler.
- **Large episode files + slow connections** → Mitigation: stream-to-disk downloads with resumable support (HTTP Range headers); mark episodes `failed` after timeout and retry on next poll.
- **Feature flag threading (web + mobile)** → Mitigation: centralize flag in a single atom/context provider; all podcast routes 404 when flag is false; test with flag off in CI.
- **RNTP queue collision on mobile** → Mitigation: always save progress before queue replacement; add guard in `playPodcastEpisode` and `playAudiobook` to check active queue type.
- **Storage growth** → Mitigation: per-subscription retention policy (`keepLatestN`, `keepAll`, `manual`); admin can also set a global storage cap warning threshold.

## Migration Plan

1. Add `podcastsEnabled` and `podcastStoragePath` fields to `ServerSettings` in Prisma schema with safe defaults (`false`, `null`).
2. Run migration — purely additive, no data loss.
3. Deploy API with new `PodcastModule` — no endpoints exposed until feature is enabled.
4. Deploy web/mobile — podcast nav items hidden behind flag; existing users see no change.
5. Admin explicitly enables podcasts in settings to begin using the feature.
6. Rollback: set `podcastsEnabled = false`; all UI disappears. No destructive cleanup needed.

## Open Questions

- Should the initial setup wizard include a "Enable Podcasts?" step, or is admin settings sufficient for v1? USER NOTE: I do want to include it on the initial step wizard, default disabled.
- What is the desired default retention policy per subscription? USER NOTE: Default to keep all, I do want this to be a podcast archive where users can keep their favorite podcast episodes forever even if they are pulled from the internet (Dan Carlin for example does not keep all his podcast files around forever)
- Should episode downloads be served via the API (streaming proxy) or direct file path (requires web server static file config)? The API proxy approach is safer and consistent with how book files are served. USER NOTE: Streaming proxy should serve episode downloads.
