import { AppState } from 'react-native';
import TrackPlayer, { Event, State } from 'react-native-track-player';
import { saveCurrentProgress, registerProgressListener } from './progressSaver';
import { flushPendingProgress } from './pendingProgress';
import { activeBookId } from './activeBook';

export async function PlaybackService() {
  registerProgressListener();

  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    void TrackPlayer.play();
  });

  TrackPlayer.addEventListener(Event.RemotePause, () => {
    void TrackPlayer.pause();
  });

  TrackPlayer.addEventListener(Event.RemoteJumpForward, async () => {
    const { position, duration } = await TrackPlayer.getProgress();
    await TrackPlayer.seekTo(Math.min(position + 30, duration));
  });

  TrackPlayer.addEventListener(Event.RemoteJumpBackward, async () => {
    const { position } = await TrackPlayer.getProgress();
    await TrackPlayer.seekTo(Math.max(0, position - 30));
  });

  TrackPlayer.addEventListener(Event.RemoteSeek, async ({ position }) => {
    await TrackPlayer.seekTo(position);
  });

  TrackPlayer.addEventListener(
    Event.RemoteDuck,
    async ({ paused, permanent }) => {
      if (permanent || paused) {
        await TrackPlayer.pause();
      } else {
        await TrackPlayer.play();
      }
    },
  );

  TrackPlayer.addEventListener(Event.PlaybackState, async ({ state }) => {
    if (
      state === State.Paused ||
      state === State.Stopped ||
      state === State.Ended
    ) {
      await saveCurrentProgress();
    }
  });

  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, async () => {
    await saveCurrentProgress();
  });

  // Flush pending progress when app returns to foreground
  AppState.addEventListener('change', (appState) => {
    if (appState !== 'active') return;
    const bookId = activeBookId();
    if (bookId) void flushPendingProgress(bookId);
  });
}
