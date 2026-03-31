import { api } from '../utils/api';

export type AnnotationType =
  | 'HIGHLIGHT'
  | 'UNDERLINE'
  | 'STRIKETHROUGH'
  | 'BOOKMARK';

export interface Annotation {
  id: string;
  bookId: string;
  userId: string;
  type: AnnotationType;
  location: string;
  text: string | null;
  note: string | null;
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnnotationWithBook extends Annotation {
  book: {
    id: string;
    title: string;
    coverData: string | null;
    updatedAt: string;
  };
}

export interface CreateAnnotationPayload {
  location: string;
  type: AnnotationType;
  text?: string;
  note?: string;
  color?: string;
}

export interface UpdateAnnotationPayload {
  type?: AnnotationType;
  note?: string;
  color?: string;
}

export function createAnnotation(
  bookId: string,
  payload: CreateAnnotationPayload,
) {
  return api
    .post<Annotation>(`/books/${bookId}/annotations`, payload)
    .then((r) => r.data);
}

export function listBookAnnotations(bookId: string) {
  return api
    .get<Annotation[]>(`/books/${bookId}/annotations`)
    .then((r) => r.data);
}

export function listAllAnnotations(type?: AnnotationType) {
  return api
    .get<AnnotationWithBook[]>('/annotations', { params: type ? { type } : {} })
    .then((r) => r.data);
}

export function updateAnnotation(
  bookId: string,
  id: string,
  payload: UpdateAnnotationPayload,
) {
  return api
    .patch<Annotation>(`/books/${bookId}/annotations/${id}`, payload)
    .then((r) => r.data);
}

export function deleteAnnotation(bookId: string, id: string) {
  return api.delete(`/books/${bookId}/annotations/${id}`);
}
