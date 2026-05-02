## Context

The Litara mobile app (`apps/mobile`, Expo SDK 54 / React Native, expo-router) ships a single audiobook player screen (`AudiobookPlayerScreen.tsx`) backed by `expo-audio` 1.1.1. Audiobooks are delivered as one or more `BookFile` rows of MIME type `audio/*`, exposed via `book.audiobookFiles: AudiobookFileInfo[]` (already present in the API contract — `apps/mobile/src/api/audiobooks.ts`). Each file carries `duration`, `mimeType`, `fileIndex`, and an array of `chapters` with `startTime`/`endTime` relative to the file.

The current player calls `player.replace({ uri })` per file. ExoPlayer therefore only knows the duration of the currently-loaded file, and Android's `MediaSession` (built directly on `player.ref` inside `expo-audio`'s `AudioControlsService`) reports that single-file duration to the lock screen / notification tray. This is the root bug. A second class of bugs exists around component-lifecycle coupling: the player is owned by the screen, and async work (`init()`, deferred `player.play()` timeouts) crashes if the screen unmounts mid-flight (mitigated by the previous fix, but the architectural smell remains).

`expo-audio` is the only audio consumer in the app — searching for `useAudioPlayer` / `expo-audio` shows just `AudiobookPlayerScreen.tsx`. There is no shared playback infrastructure to preserve.

## Goals / Non-Goals

**Goals:**

- Lock-screen / notification progress bar reflects the **full audiobook duration** and absolute position, not the current file's.
- Playback is owned by a singleton service, not a React component. Navigating away from (or back to) the player does not stop, restart, or crash playback.
- Remove ~100 lines of bespoke queue management (`currentFileIndex`, `pendingSeekRef`, `wasLoadedRef`, `advancingRef`, the auto-advance `setTimeout`, file-offset math) in favor of a queue-aware library.
- Preserve every current user-visible behavior: 30s skip buttons, chapter list with auto-scroll, speed control with persistence, downloaded-vs-streamed source resolution, 10s progress autosave, offline pending-progress queue, AppState-foreground flush.
- Single PR / single APK build — no parallel coexistence of `expo-audio` and RNTP.

**Non-Goals:**

- Adding sleep timer, equalizer, bookmarks, or any new user-facing feature.
- Changing the API contract for `audiobookFiles`, stream tokens, or progress endpoints.
- Migrating any other audio path — there is none. This is mobile-only; web is unchanged.
- Supporting multi-book queues. The queue contains exactly one audiobook at a time.
- iOS-specific tuning beyond what RNTP provides out of the box.

## Decisions

### Decision 1: react-native-track-player 4.x over alternatives

RNTP 4.x is the only mature React Native library with native multi-track queue + MediaSession + lock-screen integration. Considered:

- **`expo-audio` patch-package**: Rejected. Requires shipping a custom `ForwardingPlayer` inside `node_modules/expo-audio` to override `getDuration()`/`getCurrentPosition()`, plus a new native bridge method to feed virtual position from JS. Fragile against expo-audio updates and still leaves the screen-coupled lifecycle bug.
- **Local Expo module wrapping ExoPlayer + AVPlayer directly**: Rejected. Re-implements what RNTP already does (Media3 queue, MediaSession, AVQueuePlayer, remote events) for a single feature. Maintenance cost dominates.
- **`react-native-video` audio mode**: Rejected. Designed for video; lock-screen integration is shallower and queue support is via prop arrays not a real queue API.

### Decision 2: Singleton playback service registered at module top-level

RNTP requires `TrackPlayer.registerPlaybackService(() => require('./service'))` to be called **before** React renders, in the JS entry point. This is non-negotiable — the registered service is what handles remote events (lock-screen play/pause/seek) when the JS bundle is woken up by the OS.

The service module exports a function that registers RNTP remote-event listeners (`Event.RemotePlay`, `Event.RemotePause`, `Event.RemoteJumpForward`, `Event.RemoteJumpBackward`, `Event.RemoteSeek`, `Event.PlaybackQueueEnded`). It does **not** import React. We will place it at `apps/mobile/src/services/playback/service.ts` and register it from `apps/mobile/index.ts` (or whatever expo-router's resolved entrypoint is — confirmed during implementation).

`TrackPlayer.setupPlayer()` is called once, lazily, the first time the audiobook screen mounts. It is idempotent-guarded by checking the current state.

### Decision 3: One RNTP queue per audiobook, replaced on book switch

Building the queue: each `AudiobookFileInfo` becomes one RNTP `Track` with `url` (local file path or signed stream URL), `duration` (seconds, from the API), `title` (book title — not file name, so the lock screen reads naturally), `artist` (joined authors), `artwork` (cover URL).

When the user opens an audiobook:

1. If RNTP's current queue's first track `id` matches `audiobook:<bookId>:0`, do nothing — keep playing.
2. Otherwise: `await TrackPlayer.reset()` then `await TrackPlayer.add(tracks)` then `await TrackPlayer.skip(savedFileIndex)` then `await TrackPlayer.seekTo(savedTimeInFile)`.

Track IDs are deterministic (`audiobook:<bookId>:<fileIndex>`) so the "is this the same audiobook?" check is a string compare.

### Decision 4: Total duration computed in JS, not from RNTP

RNTP's `useProgress()` returns `{ position, duration, buffered }` for the **current track**, same constraint as ExoPlayer. The lock-screen progress bar, however, comes from RNTP's MediaSession which uses the queue's timeline — it does show absolute progress correctly. So:

- Lock screen: handled by RNTP. No JS work needed. **This is the headline fix.**
- In-app slider / chapter highlight / "time remaining" labels: continue computing absolute time in JS using `fileStartOffsets[currentTrackIndex] + position`, exactly as today. The math survives unchanged; the inputs come from `useActiveTrack()` and `useProgress()` instead of `currentFileIndex` state and `status.currentTime`.

### Decision 5: Auto-advance handled by RNTP, manually-driven seeks use `skip` + `seekTo`

Auto-advance: deleted. RNTP plays the next track in the queue automatically. The `Event.PlaybackQueueEnded` listener marks the audiobook as "finished" (final progress save).

Cross-file chapter seek / slider drag across files: `await TrackPlayer.skip(targetIndex)` then `await TrackPlayer.seekTo(offsetInTarget)`. The current `setTimeout(() => player.play(), 400)` workaround is gone — RNTP awaits load internally.

### Decision 6: Progress save model unchanged

The server-side progress contract is `{ currentFileIndex, currentTime, totalDuration }`. We keep that. Source of truth on the client moves from local React state to `await TrackPlayer.getActiveTrackIndex()` + `useProgress().position`. The 10s save interval, the AsyncStorage pending-progress key, and the AppState foreground flush all stay.

### Decision 7: Speed control via `TrackPlayer.setRate(rate)`

Replaces `player.setPlaybackRate`. RNTP persists the rate across queue resets within a session but not across app restarts — same as today; we restore from `AsyncStorage[SPEED_KEY]` on setup.

## Risks / Trade-offs

- **[Risk] RNTP setup must complete before any queue mutation**: Calling `add()`/`skip()` before `setupPlayer()` resolves throws. → Mitigation: gate every TrackPlayer call behind a module-level `setupPromise` that's awaited on first access.
- **[Risk] expo-audio + RNTP cannot coexist on iOS**: Both register an `AVAudioSession` category at module init; whichever wins, the other misbehaves. → Mitigation: remove `expo-audio` from `package.json` in the same commit as RNTP install. No incremental rollout.
- **[Risk] Background playback survives screen unmount — by design — but means progress save must move out of the screen**: If the user kills the screen while playback continues from the lock screen, the screen-owned 10s save interval stops. → Mitigation: move the periodic save into the playback service (fires on `Event.PlaybackProgressUpdated` debounced to 10s) so saves happen as long as the service is alive. Screen-owned save effects are removed.
- **[Risk] Native rebuild required**: `npx expo prebuild` regenerates `android/` and `ios/` directories. Any manual edits there will be lost. → Mitigation: confirm `apps/mobile/android/` and `apps/mobile/ios/` are gitignored or fully managed by prebuild before merging. (Verify during implementation; if either directory is checked in with edits, document them as `expo-build-properties` config or a config plugin.)
- **[Risk] RNTP's `seekTo` precision under streaming**: Seeking to a position in a not-yet-buffered region pauses then resumes. Acceptable — same UX as today.
- **[Trade-off] Lock-screen seek buttons jump 30s instead of 10s**: Different from `expo-audio`'s baked-in 10s. Aligns with the in-app 30s skip buttons. We treat this as a fix, not a regression.
- **[Trade-off] RNTP adds ~2 MB to the APK** (Media3 + RNTP wrapper). Removing expo-audio claws back ~1 MB net new ~1 MB.

## Migration Plan

1. Land the change in a single PR. There is no feature flag — the audiobook screen either uses expo-audio or RNTP, not both.
2. After merge, anyone with the old APK keeps working (both libraries ship a self-contained MediaSession; old APKs simply never see the new code).
3. No server-side migration. Progress format unchanged.
4. **Rollback**: revert the PR and rebuild the APK. AsyncStorage keys (`litara-audiobook-speed`, `litara-audiobook-progress-pending-<bookId>`) are unchanged, so a rollback loses nothing.

## Open Questions

- Is `apps/mobile/android/` and `apps/mobile/ios/` checked in, or fully managed by prebuild? Determines whether the native install step touches tracked files. (Resolved during task 1.)
- Does expo-router's entry resolution allow registering the playback service at a top-level `index.ts`, or do we need a `register-playback.ts` imported from the layout? (Resolved during task 3.)
- Confirm RNTP 4.x is compatible with React Native 0.81 / Expo SDK 54. (RNTP 4.1+ supports RN 0.74+; 4.x latest is expected to work but verify against `expo` peer.)
