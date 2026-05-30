import { useState, useEffect, useCallback } from 'react';
import {
  type AnnotationType,
  type AnnotationWithBook,
  listAllAnnotations,
  deleteAnnotation,
} from '../api/annotations';

export function useAllAnnotations() {
  const [annotations, setAnnotations] = useState<AnnotationWithBook[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<AnnotationType | undefined>(
    undefined,
  );
  const [search, setSearch] = useState('');
  const [libraryIds, setLibraryIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    listAllAnnotations(
      typeFilter,
      libraryIds.length > 0 ? libraryIds : undefined,
    )
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
  }, [typeFilter, libraryIds]);

  const filtered = annotations.filter((a) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (a.text ?? '').toLowerCase().includes(q) ||
      (a.note ?? '').toLowerCase().includes(q)
    );
  });

  const remove = useCallback(
    async (bookId: string, id: string): Promise<void> => {
      await deleteAnnotation(bookId, id);
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
    },
    [],
  );

  return {
    annotations: filtered,
    isLoading,
    typeFilter,
    setTypeFilter,
    search,
    setSearch,
    libraryIds,
    setLibraryIds,
    deleteAnnotation: remove,
  };
}
