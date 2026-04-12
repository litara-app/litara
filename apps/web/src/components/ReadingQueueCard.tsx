import { Group, ActionIcon } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { BookCard } from './BookCard';
import type { ReadingQueueItem } from '../store/atoms';

interface ReadingQueueCardProps {
  item: ReadingQueueItem;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  isDragOverlay?: boolean;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onRemove: () => void;
  onBookClick: (bookId: string) => void;
}

export function ReadingQueueCard({
  item,
  isFirst,
  isLast,
  isDragOverlay = false,
  onMoveLeft,
  onMoveRight,
  onBookClick,
}: ReadingQueueCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.bookId, disabled: isDragOverlay });

  const bookCardData = {
    id: item.bookId,
    title: item.title,
    authors: item.authors,
    hasCover: item.hasCover,
    coverUpdatedAt: item.coverUpdatedAt,
    formats: item.formats,
    hasFileMissing: item.hasFileMissing,
    readStatus: null,
    rating: null,
    genres: [],
    tags: [],
  };

  return (
    <div
      style={{
        opacity: isDragging ? 0.4 : 1,
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      {/* Draggable area — just the card itself */}
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        style={{ cursor: isDragOverlay ? 'grabbing' : 'grab' }}
      >
        <BookCard {...bookCardData} onClick={() => onBookClick(item.bookId)} />
      </div>

      {/* Position arrows — outside the drag target so they don't interfere */}
      {!isDragOverlay && (
        <Group justify="center" gap={4} mt={6}>
          <ActionIcon
            size="sm"
            variant="subtle"
            color="gray"
            disabled={isFirst}
            onClick={onMoveLeft}
            aria-label="Move left"
          >
            <IconChevronLeft size={14} />
          </ActionIcon>
          <ActionIcon
            size="sm"
            variant="subtle"
            color="gray"
            disabled={isLast}
            onClick={onMoveRight}
            aria-label="Move right"
          >
            <IconChevronRight size={14} />
          </ActionIcon>
        </Group>
      )}
    </div>
  );
}
