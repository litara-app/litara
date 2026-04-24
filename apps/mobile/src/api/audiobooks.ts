import { api } from './client';
import { serverUrlStore } from '@/src/auth/serverUrlStore';

export interface AudiobookChapter {
  index: number;
  title: string;
  startTime: number;
  endTime: number | null;
}

export interface AudiobookFileInfo {
  id: string;
  fileIndex: number;
  duration: number;
  mimeType: string;
  narrator: string | null;
  fileSize: number;
  chapters: AudiobookChapter[];
}

export interface AudiobookProgress {
  id: string;
  bookId: string;
  currentFileIndex: number;
  currentTime: number;
  totalDuration: number;
  completedAt: string | null;
  updatedAt: string;
}

export async function issueStreamToken(): Promise<{
  token: string;
  expiresAt: string;
}> {
  const { data } = await api.post<{ token: string; expiresAt: string }>(
    '/audiobooks/stream-token',
  );
  return data;
}

export function buildStreamUrl(
  bookId: string,
  fileIndex: number,
  streamToken: string,
): string {
  const base = serverUrlStore.get() ?? '';
  return `${base}/api/v1/audiobooks/${bookId}/files/${fileIndex}/stream?streamToken=${encodeURIComponent(streamToken)}`;
}

export async function getAudiobookProgress(
  bookId: string,
): Promise<AudiobookProgress | null> {
  const { data } = await api.get<{ progress: AudiobookProgress | null }>(
    `/audiobooks/${bookId}/progress`,
  );
  return data.progress;
}

export async function saveAudiobookProgress(
  bookId: string,
  currentFileIndex: number,
  currentTime: number,
  totalDuration: number,
): Promise<void> {
  await api.put(`/audiobooks/${bookId}/progress`, {
    currentFileIndex,
    currentTime,
    totalDuration,
  });
}
