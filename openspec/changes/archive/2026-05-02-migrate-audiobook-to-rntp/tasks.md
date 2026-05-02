## 1. Pre-flight & native build setup

- [x] 1.1 Verify whether `apps/mobile/android/` and `apps/mobile/ios/` are gitignored or checked in; document the prebuild model in the PR description (resolves design.md Open Question 1).
- [x] 1.2 Confirm the JS entrypoint expo-router resolves (likely `apps/mobile/index.ts` or expo's auto-resolved `expo-router/entry`) and identify where the playback service must be registered to run before React mounts (resolves design.md Open Question 2).
- [x] 1.3 Confirm `react-native-track-player` 4.x supports React Native 0.81 / Expo SDK 54 (check RNTP changelog and `peerDependencies` against `apps/mobile/package.json`); if not, pin to the latest compatible 4.x and note in the PR (resolves design.md Open Question 3).

## 2. Dependency swap

- [x] 2.1 In `apps/mobile`, remove `expo-audio` from `package.json` `dependencies`.
- [x] 2.2 In `apps/mobile`, add `react-native-track-player` (latest 4.x compatible — see task 1.3) to `package.json` `dependencies`.
- [x] 2.3 Run `npm install` from the monorepo root and verify the lockfile updates cleanly.
- [ ] 2.4 Run `npx expo prebuild --clean` inside `apps/mobile` to regenerate `android/` and `ios/` with RNTP autolinked. Verify the Android `AndroidManifest.xml` includes the RNTP `MusicService` entry and the `FOREGROUND_SERVICE_MEDIA_PLAYBACK` permission, and iOS `Info.plist` `UIBackgroundModes` still includes `audio`. _(manual build step)_

## 3. Playback service module

- [x] 3.1 Create `apps/mobile/src/services/playback/setup.ts` exporting an idempotent `ensurePlayerSetup(): Promise<void>` that calls `TrackPlayer.setupPlayer()` once (guarded by a module-level promise) and configures capabilities: `Capability.Play`, `Capability.Pause`, `Capability.JumpForward`, `Capability.JumpBackward`, with `forwardJumpInterval: 30` and `backwardJumpInterval: 30`.
- [x] 3.2 Create `apps/mobile/src/services/playback/queue.ts` exporting `buildAudiobookQueue(book, audiobookFiles, opts: { useLocal: boolean; streamToken: string | null; bookId: string }): Track[]` that maps each `AudiobookFileInfo` to an RNTP `Track` with `id` = `audiobook:<bookId>:<fileIndex>`, `url` resolved via `buildLocalFilePath` or `buildStreamUrl`, `duration`, `title` (book title), `artist` (joined authors), `artwork` (cover URL).
- [x] 3.3 Create `apps/mobile/src/services/playback/loadAudiobook.ts` exporting `loadAudiobook(args)` that: (a) checks if `TrackPlayer.getQueue()`'s first track id matches `audiobook:<bookId>:0` and short-circuits if so; (b) otherwise calls `TrackPlayer.reset()`, `TrackPlayer.add(tracks)`, `TrackPlayer.skip(savedFileIndex)`, `TrackPlayer.seekTo(savedTimeInFile)`; (c) applies the persisted playback rate via `TrackPlayer.setRate(rate)`.
- [x] 3.4 Create `apps/mobile/src/services/playback/progressSaver.ts` that owns the periodic save: subscribes to `Event.PlaybackProgressUpdated` (configured at 1s emission), debounces writes to once per 10s, and on each tick resolves the active `(trackIndex, position)` and calls the existing `saveAudiobookProgress` API. Exposes `setActiveAudiobook(bookId | null)` so the saver only fires for the currently-loaded audiobook.
- [x] 3.5 Create `apps/mobile/src/services/playback/service.ts` (the registered playback service): wires remote-event listeners (`RemotePlay`, `RemotePause`, `RemoteJumpForward`, `RemoteJumpBackward`, `RemoteSeek`, `RemoteDuck`) to TrackPlayer commands; subscribes to `Event.PlaybackQueueEnded` to fire a final progress save; subscribes to `Event.PlaybackState` to fire a save on transitions to paused/stopped.
- [x] 3.6 Register the playback service from the JS entrypoint identified in task 1.2: `TrackPlayer.registerPlaybackService(() => require('./src/services/playback/service'))`. Verify the registration runs before any React render by placing it at the top of the entry module.

## 4. AppState foreground flush integration

- [x] 4.1 Move the existing AsyncStorage pending-progress flush logic out of `AudiobookPlayerScreen.tsx` and into `apps/mobile/src/services/playback/pendingProgress.ts` (key format unchanged: `litara-audiobook-progress-pending-<bookId>`).
- [x] 4.2 In the playback service module (or a sibling module imported by the service), register an `AppState` listener that triggers the flush on `change → 'active'`. Confirm AppState listeners registered outside React render correctly receive events while the JS bundle is alive (RNTP keeps the bundle alive during background playback).

## 5. Screen rewrite — AudiobookPlayerScreen

- [x] 5.1 Remove all `expo-audio` imports and refs from `AudiobookPlayerScreen.tsx`: `useAudioPlayer`, `useAudioPlayerStatus`, `setAudioModeAsync`, `playerReady` state, `currentFileIndex` state, `pendingSeekRef`, `wasLoadedRef`, `advancingRef`, `playTimeoutRef`, `mountedRef`, `saveIntervalRef`, `loadFile`, the auto-advance effect, the seek-after-replace effect, the lock-screen-clear cleanup effect.
- [x] 5.2 Replace player state hooks with RNTP equivalents: `useActiveTrack()`, `useActiveTrackIndex()` (or `useTrackPlayerEvents` for index changes), `useProgress(250)`, `usePlaybackState()`.
- [x] 5.3 On mount, call `ensurePlayerSetup()` then `loadAudiobook({ bookId, audiobookFiles, ... })` once the book detail and audiobook files have loaded. The screen no longer owns "playerReady" — the loading indicator is driven by `useProgress().duration === 0` and the active track being `undefined`.
- [x] 5.4 Compute absolute time from `(fileStartOffsets[activeTrackIndex] ?? 0) + useProgress().position` for the in-app slider, time labels, and chapter highlight; keep the existing `fileStartOffsets` / `allChapters` memoization unchanged.
- [x] 5.5 Rewrite control handlers using RNTP commands:
  - `togglePlay` → `usePlaybackState()` + `TrackPlayer.play()` / `TrackPlayer.pause()`.
  - `seekRelative(±30)` → resolves to absolute target, then `TrackPlayer.seekTo(offsetInTrack)` if same track, else `TrackPlayer.skip(targetIndex)` + `TrackPlayer.seekTo(...)`.
  - `cycleSpeed` → `TrackPlayer.setRate(next)` + AsyncStorage write.
  - `seekToChapter` → same `skip` + `seekTo` pattern as cross-file slider drag (no `setTimeout` needed; RNTP awaits load internally).
  - `prevChapter` / `nextChapter` → unchanged JS logic; delegate the actual seek to `seekToChapter`.
  - `onSlidingComplete` → resolve absolute → `(targetIndex, offset)` → `TrackPlayer.skip` + `TrackPlayer.seekTo`. Drop the `wasPlaying` + `setTimeout(() => player.play(), 400)` workaround.
- [x] 5.6 Drop the screen-owned 10s save interval and the pause-driven save effect (now handled by the playback service per task 3.4 and 3.5). Drop the AppState listener (now in task 4.2).
- [x] 5.7 Verify the chapters-list `scrollToIndex` auto-scroll still triggers off the new active-chapter computation.

## 6. Cleanup

- [x] 6.1 Delete `apps/mobile/src/screens/AudiobookPlayerScreen.tsx` references to `setAudioModeAsync` and the audio-mode effect — RNTP handles audio session setup internally.
- [x] 6.2 Search `apps/mobile/src` for any remaining `expo-audio` imports or string references and remove them.
- [x] 6.3 Update `apps/mobile/package.json` and lockfile to confirm `expo-audio` is fully gone (no lingering transitive references).
- [x] 6.4 Update `apps/mobile/CLAUDE.md` if one exists, or add a short note to the root `CLAUDE.md` Mobile section documenting that audiobook playback uses `react-native-track-player` and lives under `apps/mobile/src/services/playback/`.

## 7. Verification

- [x] 7.1 `npm run lint` and `tsc --noEmit` pass in `apps/mobile`.
- [ ] 7.2 Build a debug APK via `npx expo run:android` and exercise the manual test plan: open a multi-file audiobook → verify lock screen shows total duration; press lock-screen seek-forward → verify in-app slider jumps 30s; navigate back from player while playing → verify playback continues; re-enter player → verify state matches; toggle speed → verify lock screen reflects rate; kill network → verify pending progress queues; foreground app with network → verify pending progress flushes.
- [ ] 7.3 Test single-file audiobook still works (lock screen shows that file's duration as total).
- [ ] 7.4 Test downloaded-only audiobook still works (no stream token requested; tracks resolve to local file URIs).
- [ ] 7.5 Test the previous back-button crash scenario (open player, press back immediately while loading) — confirm no crash and playback either continues from the queue if it was started or remains in a clean idle state.
- [ ] 7.6 Test on a physical iPhone (or simulator if no device available): verify lock-screen / Control Center shows total audiobook duration and the seek buttons work.
