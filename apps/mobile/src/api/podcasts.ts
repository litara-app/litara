import { api } from './client';

export interface PodcastSettings {
  enabled: boolean;
}

export interface Podcast {
  id: string;
  feedUrl: string;
  title: string;
  description: string | null;
  artworkUrl: string | null;
  author: string | null;
  lastRefreshedAt: string | null;
  episodeCount: number;
  refreshIntervalMinutes: number;
  downloadPolicy: 'ALL' | 'LATEST_N' | 'MANUAL';
  keepLatestN: number | null;
  retentionPolicy: 'KEEP_ALL' | 'DELETE_AFTER_LISTENED' | 'KEEP_LATEST_N';
  subscribed: boolean;
}

export interface PodcastEpisode {
  id: string;
  podcastId: string;
  guid: string;
  title: string;
  description: string | null;
  publishedAt: string | null;
  duration: number | null;
  audioUrl: string;
  downloadStatus:
    | 'NOT_DOWNLOADED'
    | 'PENDING'
    | 'DOWNLOADING'
    | 'DOWNLOADED'
    | 'FAILED';
  downloadPath: string | null;
  fileSize: string | null;
  currentTime: number | null;
}

export function getPodcastSettings(): Promise<PodcastSettings> {
  return api.get<PodcastSettings>('/podcasts/settings').then((r) => r.data);
}

export function listPodcasts(): Promise<Podcast[]> {
  return api.get<Podcast[]>('/podcasts').then((r) => r.data);
}

export function getPodcast(id: string): Promise<Podcast> {
  return api.get<Podcast>(`/podcasts/${id}`).then((r) => r.data);
}

export function getEpisodes(
  podcastId: string,
  page = 1,
): Promise<{ episodes: PodcastEpisode[]; total: number }> {
  return api
    .get<{ episodes: PodcastEpisode[]; total: number }>(
      `/podcasts/${podcastId}/episodes`,
      {
        params: { page, pageSize: 50 },
      },
    )
    .then((r) => r.data);
}

export function subscribePodcast(feedUrl: string): Promise<Podcast> {
  return api.post<Podcast>('/podcasts', { feedUrl }).then((r) => r.data);
}

export function unsubscribePodcast(
  id: string,
  deleteFiles: boolean,
): Promise<void> {
  return api
    .delete(`/podcasts/${id}`, {
      params: { deleteFiles: deleteFiles ? 'true' : 'false' },
    })
    .then(() => undefined);
}

export function requestEpisodeDownload(
  episodeId: string,
): Promise<{ status: string }> {
  return api
    .post<{ status: string }>(`/podcasts/episodes/${episodeId}/download`)
    .then((r) => r.data);
}

export function saveEpisodeProgress(
  episodeId: string,
  currentTime: number,
): Promise<void> {
  return api
    .put(`/podcasts/episodes/${episodeId}/progress`, { currentTime })
    .then(() => undefined);
}

export function refreshPodcast(id: string): Promise<Podcast> {
  return api.post<Podcast>(`/podcasts/${id}/refresh`).then((r) => r.data);
}
