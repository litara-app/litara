## Why

The mobile audiobook player uses `expo-audio`, which loads MP3 files one at a time into a single ExoPlayer instance via `player.replace({ uri })`. Because the Android `MediaSession` is built directly on this ExoPlayer (`AudioControlsService.kt:225`), the lock screen / notification tray progress bar only ever shows the current file's duration — not the full audiobook duration spanning all parts. There is no JS-only workaround: `AudioMetadata` exposes only `title`, `artist`, `albumTitle`, `artworkUrl` — no duration or position override. We also maintain ~100 lines of manual file-management code (auto-advance via `setTimeout`, `currentFileIndex` state, `pendingSeekRef`, file-offset math) that a queue-aware library handles natively.

## What Changes

- **BREAKING** Replace `expo-audio` with `react-native-track-player` (RNTP) for audiobook playback. The audiobook screen is the only consumer of `expo-audio` — there is no other audio in the app.
- Remove all manual queue management from `AudiobookPlayerScreen.tsx`: auto-advance `setTimeout`, `currentFileIndex` state, `pendingSeekRef`/`wasLoadedRef` plumbing, file-offset math for absolute time.
- Move audiobook playback into a singleton playback service registered via `TrackPlayer.registerPlaybackService` (RNTP requirement) so playback survives screen unmount and JS reloads.
- Load all audiobook files as a single RNTP queue at startup; total duration, queue progression, and lock-screen metadata flow from RNTP automatically.
- Map RNTP queue state (current track index, position) to absolute audiobook position for the slider, chapter highlighting, and progress save.
- Replace lock-screen seek-forward/back (currently 10s, baked into expo-audio) with RNTP's customizable jump-forward/back (30s to match in-app).
- Preserve all existing app behavior: chapter list, speed control, downloaded-vs-streamed source switching, progress save (every 10s + on pause + AppState foreground flush), offline pending-progress queue.
- Remove `expo-audio` from `apps/mobile/package.json` after the migration.

## Capabilities

### New Capabilities

- `audiobook-player`: Specifies the mobile audiobook playback experience — queue management, lock-screen integration, chapter navigation, speed control, progress persistence, and downloaded-vs-streamed source resolution. Captures behavior that previously lived implicitly inside the screen component.

### Modified Capabilities

<!-- None — no existing spec covers mobile audiobook playback. -->

## Impact

- **Code**:
  - `apps/mobile/src/screens/AudiobookPlayerScreen.tsx` — major rewrite around RNTP hooks (`useActiveTrack`, `useProgress`, `usePlaybackState`).
  - `apps/mobile/src/services/playback/` — new directory: `service.ts` (registered playback service with remote event handlers), `setup.ts` (one-time TrackPlayer setup), `queue.ts` (build RNTP `Track[]` from `AudiobookFileInfo[]`).
  - `apps/mobile/index.ts` (or expo-router entrypoint) — register playback service at module top-level (RNTP requirement; must run before React renders).
  - `apps/mobile/src/hooks/useAudiobookDownload.ts` — unchanged (file paths still resolved the same way).
- **Dependencies**:
  - Add `react-native-track-player` (current major: 4.x).
  - Remove `expo-audio` from `apps/mobile/package.json`.
- **Native build**:
  - RNTP 4.x is autolinked under Expo's prebuild flow; requires `npx expo prebuild` and a fresh dev-client / APK build. No manual `MainApplication` edits needed.
  - Android `AndroidManifest.xml` foreground-service permission and service entry are added by RNTP autolinking.
  - iOS `Info.plist` `UIBackgroundModes` already includes `audio` (set by `expo-audio`); verify after prebuild.
- **Behavioral**:
  - Playback now persists across screen navigation (queue lives in the service, not the component). The "back button crash" patch becomes obsolete — RNTP's player is a singleton not tied to component lifecycle.
  - Lock-screen progress bar now spans the full audiobook duration (the original bug).
  - Lock-screen seek buttons jump 30s instead of 10s.
- **Risk**: RNTP and `expo-audio` cannot coexist on iOS (both register an `AVAudioSession` category). The migration must remove `expo-audio` in the same PR.
