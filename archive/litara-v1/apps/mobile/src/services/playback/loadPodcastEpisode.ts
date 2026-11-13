import TrackPlayer, { Event } from 'react-native-track-player';
import { serverUrlStore } from '@/src/auth/serverUrlStore';
import { saveCurrentProgress } from './progressSaver';
import { ensurePlayerSetup } from './setup';
import { saveEpisodeProgress } from '@/src/api/podcasts';
import { issueStreamToken } from '@/src/api/audiobooks';

export interface PodcastEpisodeTrackArgs {
  podcastId: string;
  episodeId: string;
  episodeTitle: string;
  podcastTitle: string;
  artworkUrl: string | null;
  duration: number | null;
  initialPosition?: number;
}

let progressListener: { remove: () => void } | null = null;

export async function loadPodcastEpisode(
  args: PodcastEpisodeTrackArgs,
): Promise<void> {
  const {
    podcastId,
    episodeId,
    episodeTitle,
    podcastTitle,
    artworkUrl,
    duration,
    initialPosition,
  } = args;

  await ensurePlayerSetup();

  await saveCurrentProgress().catch(() => {});

  const base = serverUrlStore.get() ?? '';
  const { token: streamToken } = await issueStreamToken();
  const streamUrl = `${base}/api/v1/podcasts/episodes/${episodeId}/stream?streamToken=${encodeURIComponent(streamToken)}`;

  await TrackPlayer.reset();
  await TrackPlayer.add({
    id: `podcast:${podcastId}:${episodeId}`,
    url: streamUrl,
    title: episodeTitle,
    artist: podcastTitle,
    album: podcastTitle,
    artwork: artworkUrl ?? undefined,
    duration: duration ?? undefined,
  });

  if (initialPosition && initialPosition > 0) {
    await TrackPlayer.seekTo(initialPosition);
  }

  await TrackPlayer.play();

  // Prevent duplicate saves if called again while already playing
  progressListener?.remove();
  progressListener = TrackPlayer.addEventListener(
    Event.PlaybackProgressUpdated,
    () => {
      void TrackPlayer.getProgress().then(({ position }) => {
        if (isFinite(position) && position > 0) {
          void saveEpisodeProgress(episodeId, position).catch(() => {});
        }
      });
    },
  );
}
