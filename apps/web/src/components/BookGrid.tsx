import { Text, Skeleton } from '@mantine/core';
import { BookCard } from './BookCard';
import type { BookCardData } from './BookCard';

interface BookGridProps {
  books: BookCardData[];
  loading: boolean;
  minWidth: number;
  skeletonCount?: number;
  emptyMessage?: string;
  onBookClick: (id: string) => void;
  onBookSend?: (id: string) => void;
  onBookRatingChange?: (id: string, rating: number) => void;
}

export function BookGrid({
  books,
  loading,
  minWidth,
  skeletonCount = 8,
  emptyMessage = 'No books found.',
  onBookClick,
  onBookSend,
  onBookRatingChange,
}: BookGridProps) {
  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
    gap: '16px',
  };

  if (loading) {
    return (
      <div style={gridStyle}>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <Skeleton key={i} height={200} radius="md" />
        ))}
      </div>
    );
  }

  if (books.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        {emptyMessage}
      </Text>
    );
  }

  return (
    <div style={gridStyle}>
      {books.map((book) => (
        <BookCard
          key={book.id}
          {...book}
          onClick={() => onBookClick(book.id)}
          onSend={onBookSend ? () => onBookSend(book.id) : undefined}
          onRatingChange={
            onBookRatingChange
              ? (r) => onBookRatingChange(book.id, r)
              : undefined
          }
        />
      ))}
    </div>
  );
}
