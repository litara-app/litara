## Why

Litara users often listen to audiobooks and want a single self-hosted app for all long-form audio content. Adding podcast support allows users to subscribe to RSS feeds, automatically download episodes on a schedule, and play them back directly in the app — without relying on third-party podcast clients.

## What Changes

- New opt-in "Podcasts" feature toggle in server settings and initial setup wizard, hidden by default
- When enabled: podcast navigation appears in web sidebar and mobile tab bar
- Podcast subscription management (add by RSS URL, view/edit subscriptions, unsubscribe)
- Scheduled background job fetches new episodes per subscription and downloads audio files to a configurable storage path
- Episode library with playback on web (existing audio player) and mobile (react-native-track-player)
- Download queue with per-episode status (pending, downloading, downloaded, failed)
- Per-subscription settings: refresh interval, download policy (all, latest N, manual only), retention policy
- Admin panel section for podcast storage path, global refresh schedule, and feature enable/disable
- All podcast UI (navigation, pages, settings sections) is **completely hidden** when the feature is disabled

## Capabilities

### New Capabilities

- `podcast-feature-flag`: Opt-in toggle that controls visibility of all podcast UI globally; hidden in setup wizard and admin settings until admin explicitly enables it
- `podcast-subscriptions`: Subscribe to podcasts via RSS URL; list, edit, and remove subscriptions; per-subscription settings (refresh interval, download policy, retention)
- `podcast-episode-downloader`: Background scheduler that fetches RSS feeds and downloads new episodes to disk on a configurable schedule; tracks download queue status per episode
- `podcast-playback`: Episode library browser and audio playback on web and mobile (queue integration with react-native-track-player on mobile)

### Modified Capabilities

- `audiobook-player`: Mobile audiobook player queue may need shared integration points with podcast episode playback via react-native-track-player

## Impact

- **API**: New NestJS module `PodcastModule` with entities for `Podcast`, `PodcastEpisode`, `PodcastDownload`; new scheduled task using NestJS `@nestjs/schedule`; new REST endpoints under `/api/v1/podcasts`
- **Database**: New Prisma models; new migration
- **Web**: New route group `/podcasts`; conditional sidebar nav item; new admin settings section; feature flag read from server settings
- **Mobile**: New tab bar entry (conditional); episode list and playback screens; RNTP queue integration
- **Storage**: Podcast episode audio files stored in a configurable directory (similar to `EBOOK_LIBRARY_PATH`)
- **Dependencies**: `@nestjs/schedule` (likely already present or easy to add), RSS parsing library (e.g., `rss-parser`)
- **Feasibility note**: RSS/download infra is well-understood. The main complexity is the opt-in feature flag threading through web + mobile UI and the RNTP queue sharing between audiobooks and podcasts on mobile.
