import TrackPlayer, { Capability } from 'react-native-track-player';

let setupPromise: Promise<void> | null = null;

export function ensurePlayerSetup(): Promise<void> {
  if (!setupPromise) {
    setupPromise = (async () => {
      await TrackPlayer.setupPlayer({
        waitForBuffer: true,
      });
      await TrackPlayer.updateOptions({
        capabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.JumpForward,
          Capability.JumpBackward,
          Capability.SeekTo,
        ],
        compactCapabilities: [Capability.Play, Capability.Pause],
        forwardJumpInterval: 30,
        backwardJumpInterval: 30,
        progressUpdateEventInterval: 1,
      });
    })().catch((err) => {
      setupPromise = null;
      throw err;
    });
  }
  return setupPromise;
}
