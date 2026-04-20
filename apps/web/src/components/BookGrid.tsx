import { Text, Skeleton } from '@mantine/core';
import { useRef, useState, useEffect, useMemo } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { BookCard } from './BookCard';
import type { BookCardData } from './BookCard';

const GAP = 16;
const TEXT_AREA_HEIGHT = 64;

interface BookGridProps {
  books: BookCardData[];
  loading: boolean;
  minWidth: number;
  skeletonCount?: number;
  emptyMessage?: string;
  onBookClick: (id: string) => void;
  onBookSend?: (id: string) => void;
  onBookRatingChange?: (id: string, rating: number) => void;
  isSelectMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
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
  isSelectMode,
  selectedIds,
  onToggleSelect,
}: BookGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [scrollMargin, setScrollMargin] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setScrollMargin(el.offsetTop);
    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
      setScrollMargin(el.offsetTop);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const columnCount =
    containerWidth > 0
      ? Math.max(1, Math.floor((containerWidth + GAP) / (minWidth + GAP)))
      : 1;

  const columnWidth =
    containerWidth > 0
      ? (containerWidth - GAP * (columnCount - 1)) / columnCount
      : minWidth;

  const rowHeight = Math.round(columnWidth * 1.5) + TEXT_AREA_HEIGHT + GAP;

  const rows = useMemo(() => {
    const result: BookCardData[][] = [];
    for (let i = 0; i < books.length; i += columnCount) {
      result.push(books.slice(i, i + columnCount));
    }
    return result;
  }, [books, columnCount]);

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => rowHeight,
    overscan: 3,
    scrollMargin,
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div ref={containerRef}>
      {loading ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
            gap: GAP,
          }}
        >
          {Array.from({ length: skeletonCount }).map((_, i) => (
            <Skeleton key={i} height={200} radius="md" />
          ))}
        </div>
      ) : books.length === 0 ? (
        <Text c="dimmed" size="sm">
          {emptyMessage}
        </Text>
      ) : (
        <div
          style={{ position: 'relative', height: virtualizer.getTotalSize() }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${(virtualItems[0]?.start ?? 0) - virtualizer.options.scrollMargin}px)`,
            }}
          >
            {virtualItems.map((vRow) => {
              const rowBooks = rows[vRow.index];
              return (
                <div
                  key={vRow.key}
                  data-index={vRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${columnCount}, 1fr)`,
                    gap: GAP,
                    paddingBottom: GAP,
                  }}
                >
                  {rowBooks.map((book) => (
                    <BookCard
                      key={book.id}
                      {...book}
                      onClick={() => onBookClick(book.id)}
                      onSend={
                        onBookSend ? () => onBookSend(book.id) : undefined
                      }
                      onRatingChange={
                        onBookRatingChange
                          ? (r) => onBookRatingChange(book.id, r)
                          : undefined
                      }
                      isSelectMode={isSelectMode}
                      isSelected={selectedIds?.has(book.id)}
                      onToggleSelect={
                        onToggleSelect
                          ? () => onToggleSelect(book.id)
                          : undefined
                      }
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
