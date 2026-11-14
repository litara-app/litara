import { File, Directory, Paths } from 'expo-file-system';
import { api } from './client';
import { serverUrlStore } from '@/src/auth/serverUrlStore';
import { tokenStore } from '@/src/auth/tokenStore';

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

export function buildLocalAudiobookDir(bookId: string): string {
  return new Directory(Paths.document, `audiobooks/${bookId}`).uri;
}

export function buildLocalFilePath(
  bookId: string,
  fileIndex: number,
  mimeType: string,
): string {
  const ext =
    mimeType.includes('mp4') || mimeType.includes('m4') ? 'm4b' : 'mp3';
  return new File(Paths.document, `audiobooks/${bookId}/${fileIndex}.${ext}`)
    .uri;
}

export async function downloadAudiobookFile(
  bookId: string,
  fileIndex: number,
  mimeType: string,
): Promise<string> {
  const base = serverUrlStore.get() ?? '';
  const url = `${base}/api/v1/audiobooks/${bookId}/files/${fileIndex}/download`;
  const token = tokenStore.get();

  const dir = new Directory(Paths.document, `audiobooks/${bookId}`);
  if (!dir.exists) {
    dir.create({ intermediates: true });
  }

  const ext =
    mimeType.includes('mp4') || mimeType.includes('m4') ? 'm4b' : 'mp3';
  const file = new File(dir, `${fileIndex}.${ext}`);
  const downloaded = await File.downloadFileAsync(url, file, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    idempotent: true,
  });
  return downloaded.uri;
}
