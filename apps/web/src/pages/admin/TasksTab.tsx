import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Stack,
  Paper,
  Text,
  Badge,
  Group,
  ActionIcon,
  Skeleton,
  Progress,
} from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { api } from '../../utils/api';

type TaskStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

interface TaskRecord {
  id: string;
  status: TaskStatus;
  payload: {
    processed?: number;
    total?: number;
    currentBookTitle?: string;
  } | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  PENDING: 'yellow',
  PROCESSING: 'blue',
  COMPLETED: 'green',
  FAILED: 'red',
  CANCELLED: 'gray',
};

export function TasksTab() {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tasksJsonRef = useRef<string>('');

  const fetchTasks = useCallback(async (): Promise<boolean> => {
    const res = await api.get<TaskRecord[]>('/admin/metadata-match/tasks');
    const json = JSON.stringify(res.data);
    if (json !== tasksJsonRef.current) {
      tasksJsonRef.current = json;
      setTasks(res.data);
    }
    setLoading(false);

    const hasActive = res.data.some(
      (t) => t.status === 'PENDING' || t.status === 'PROCESSING',
    );
    if (!hasActive && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return hasActive;
  }, []);

  useEffect(() => {
    // fetchTasks calls setState inside a resolved promise — not synchronous in the effect body
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchTasks().then((hasActive) => {
      if (hasActive) {
        pollRef.current = setInterval(() => void fetchTasks(), 2000);
      }
    });
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchTasks]);

  async function handleCancel(taskId: string) {
    await api.post(`/admin/metadata-match/cancel/${taskId}`);
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: 'CANCELLED' } : t)),
    );
  }

  if (loading) {
    return (
      <Stack gap="xs">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} height={72} radius="sm" />
        ))}
      </Stack>
    );
  }

  if (tasks.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        No enrichment runs yet. Start one from the Metadata Matching tab.
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      {tasks.map((task) => {
        const p = task.payload;
        const total = p?.total ?? 0;
        const processed = p?.processed ?? 0;
        const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
        const isActive =
          task.status === 'PENDING' || task.status === 'PROCESSING';

        return (
          <Paper key={task.id} withBorder p="sm" radius="md">
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                <Group gap="xs">
                  <Badge
                    size="sm"
                    color={STATUS_COLORS[task.status]}
                    variant={isActive ? 'filled' : 'light'}
                  >
                    {task.status}
                  </Badge>
                  <Text size="xs" c="dimmed">
                    {new Date(task.createdAt).toLocaleString()}
                  </Text>
                </Group>

                {isActive && (
                  <>
                    <Progress value={pct} animated size="sm" />
                    <Text size="xs" c="dimmed">
                      {p?.currentBookTitle
                        ? `Processing: ${p.currentBookTitle}`
                        : 'Starting...'}
                      {'  '}
                      <Text span fw={500}>
                        {processed} / {total}
                      </Text>
                    </Text>
                  </>
                )}

                {task.status === 'COMPLETED' && (
                  <Text size="xs" c="dimmed">
                    Enriched {total} books
                  </Text>
                )}

                {task.status === 'FAILED' && task.errorMessage && (
                  <Text size="xs" c="red">
                    {task.errorMessage}
                  </Text>
                )}

                {task.status === 'CANCELLED' && (
                  <Text size="xs" c="dimmed">
                    Cancelled after {processed} / {total} books
                  </Text>
                )}
              </Stack>

              {isActive && (
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="red"
                  onClick={() => void handleCancel(task.id)}
                >
                  <IconX size={14} />
                </ActionIcon>
              )}
            </Group>
          </Paper>
        );
      })}
    </Stack>
  );
}
