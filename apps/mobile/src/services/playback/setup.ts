import TrackPlayer, { Capability } from 'react-native-track-player';

let setupPromise: Promise<void> | null = null;

export function ensurePlayerSetup(): Promise<void> {
  if (setupPromise) return setupPromise;

  setupPromise = (async () => {
    try {
      await TrackPlayer.setupPlayer({ autoHandleInterruptions: true });
    } catch (e) {
      const msg = (e as Error).message ?? '';
      // Already initialized — not an error
      if (!msg.includes('already')) {
        setupPromise = null;
        throw e;
      }
    }

    await TrackPlayer.updateOptions({
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SeekTo,
        Capability.JumpForward,
        Capability.JumpBackward,
      ],
      notificationCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SeekTo,
      ],
      progressUpdateEventInterval: 10,
    });
  })();

  return setupPromise;
}
