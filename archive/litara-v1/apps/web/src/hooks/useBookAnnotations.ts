import { useState, useEffect, useCallback } from 'react';
import {
  type Annotation,
  type CreateAnnotationPayload,
  type UpdateAnnotationPayload,
  createAnnotation,
  listBookAnnotations,
  updateAnnotation,
  deleteAnnotation,
} from '../api/annotations';

export function useBookAnnotations(bookId: string | undefined) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isLoading, setIsLoading] = useState(() => bookId !== undefined);

  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    listBookAnnotations(bookId)
      .then((data) => {
        if (!cancelled) {
          setAnnotations(data);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
      setIsLoading(true);
    };
  }, [bookId]);

  const create = useCallback(
    async (payload: CreateAnnotationPayload): Promise<Annotation> => {
      if (!bookId) throw new Error('No bookId');
      const annotation = await createAnnotation(bookId, payload);
      setAnnotations((prev) => [...prev, annotation]);
      return annotation;
    },
    [bookId],
  );

  const update = useCallback(
    async (
      id: string,
      payload: UpdateAnnotationPayload,
    ): Promise<Annotation> => {
      if (!bookId) throw new Error('No bookId');
      const updated = await updateAnnotation(bookId, id, payload);
      setAnnotations((prev) => prev.map((a) => (a.id === id ? updated : a)));
      return updated;
    },
    [bookId],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      if (!bookId) throw new Error('No bookId');
      await deleteAnnotation(bookId, id);
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
    },
    [bookId],
  );

  return {
    annotations,
    isLoading,
    createAnnotation: create,
    updateAnnotation: update,
    deleteAnnotation: remove,
  };
}
