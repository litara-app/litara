import { api } from './client';

export type AnnotationType =
  | 'HIGHLIGHT'
  | 'UNDERLINE'
  | 'STRIKETHROUGH'
  | 'BOOKMARK';

export interface Annotation {
  id: string;
  bookId: string;
  type: AnnotationType;
  location: string;
  text: string | null;
  note: string | null;
  color: string | null;
  createdAt: string;
  updatedAt: string;
  book: {
    id: string;
    title: string;
    coverData: string | null;
    updatedAt: string;
  };
}

export function getAnnotations(type?: AnnotationType): Promise<Annotation[]> {
  return api
    .get<Annotation[]>('/annotations', { params: type ? { type } : undefined })
    .then((r) => r.data);
}

export function getAudiobookBookmarks(bookId: string): Promise<Annotation[]> {
  return api
    .get<Annotation[]>(`/books/${bookId}/annotations`, {
      params: { type: 'BOOKMARK' },
    })
    .then((r) => r.data.filter((a) => a.location.startsWith('audiobook:')));
}

export function createAudiobookBookmark(
  bookId: string,
  timeSeconds: number,
  note?: string,
): Promise<Annotation> {
  return api
    .post<Annotation>(`/books/${bookId}/annotations`, {
      type: 'BOOKMARK',
      location: `audiobook:${timeSeconds}`,
      note: note ?? null,
    })
    .then((r) => r.data);
}

export function deleteAudiobookBookmark(
  bookId: string,
  annotationId: string,
): Promise<void> {
  return api
    .delete(`/books/${bookId}/annotations/${annotationId}`)
    .then(() => undefined);
}

/** Parse absolute time in seconds from an audiobook annotation location string. */
export function parseAudiobookLocation(location: string): number {
  const t = parseFloat(location.replace('audiobook:', ''));
  return isFinite(t) ? t : 0;
}
