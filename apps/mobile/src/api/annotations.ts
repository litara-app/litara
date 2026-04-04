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
