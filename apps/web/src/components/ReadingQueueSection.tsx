import { useState } from 'react';
import { Text, Alert, CloseButton, Group, Skeleton } from '@mantine/core';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  DragOverlay,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { IconInfoCircle } from '@tabler/icons-react';
import { BookCard } from './BookCard';
import { ReadingQueueCard } from './ReadingQueueCard';
import type { ReadingQueueItem } from '../store/atoms';

const HINT_KEY = 'readingQueueHintDismissed';

interface ReadingQueueSectionProps {
  queue: ReadingQueueItem[];
  loading: boolean;
  minWidth: number;
  onReorder: (activeId: string, overId: string) => Promise<void>;
  onRemove: (bookId: string) => Promise<void>;
  onBookClick: (bookId: string) => void;
}

export function ReadingQueueSection({
  queue,
  loading,
  minWidth,
  onReorder,
  onBookClick,
}: ReadingQueueSectionProps) {
  const [hintDismissed, setHintDismissed] = useState(
    () => localStorage.getItem(HINT_KEY) === 'true',
  );
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function dismissHint() {
    localStorage.setItem(HINT_KEY, 'true');
    setHintDismissed(true);
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    void onReorder(active.id as string, over.id as string);
  }

  function handleMoveLeft(index: number) {
    if (index === 0) return;
    void onReorder(queue[index].bookId, queue[index - 1].bookId);
  }

  function handleMoveRight(index: number) {
    if (index === queue.length - 1) return;
    void onReorder(queue[index].bookId, queue[index + 1].bookId);
  }

  const activeItem = activeId
    ? queue.find((item) => item.bookId === activeId)
    : null;

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
    gap: '16px',
  };

  if (loading) {
    return (
      <div style={gridStyle}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height={200} radius="md" />
        ))}
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        Your reading queue is empty. Open a book and click &ldquo;Add to
        Queue&rdquo; to get started.
      </Text>
    );
  }

  return (
    <>
      {!hintDismissed && (
        <Alert
          icon={<IconInfoCircle size={16} />}
          color="blue"
          variant="light"
          p="xs"
          mb="sm"
          styles={{ message: { fontSize: 'var(--mantine-font-size-xs)' } }}
        >
          <Group justify="space-between" gap={0}>
            <span>Drag cards to reorder on desktop · Use arrows on mobile</span>
            <CloseButton size="xs" onClick={dismissHint} aria-label="Dismiss" />
          </Group>
        </Alert>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={queue.map((item) => item.bookId)}
          strategy={rectSortingStrategy}
        >
          <div style={gridStyle}>
            {queue.map((item, index) => (
              <ReadingQueueCard
                key={item.bookId}
                item={item}
                index={index}
                isFirst={index === 0}
                isLast={index === queue.length - 1}
                onMoveLeft={() => handleMoveLeft(index)}
                onMoveRight={() => handleMoveRight(index)}
                onRemove={() => {}}
                onBookClick={onBookClick}
              />
            ))}
          </div>
        </SortableContext>

        <DragOverlay>
          {activeItem ? (
            <BookCard
              id={activeItem.bookId}
              title={activeItem.title}
              authors={activeItem.authors}
              hasCover={activeItem.hasCover}
              coverUpdatedAt={activeItem.coverUpdatedAt}
              formats={activeItem.formats}
              hasFileMissing={activeItem.hasFileMissing}
              readStatus={null}
              rating={null}
              genres={[]}
              tags={[]}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}
