import { Box, Text, ActionIcon, Tooltip } from '@mantine/core';
import { IconChevronLeft, IconLock } from '@tabler/icons-react';

export interface ComparisonRow {
  label: string;
  field: string;
  current: string | null | undefined;
  proposed: string | null | undefined;
  isImage?: boolean;
}

interface MetadataComparisonTableProps {
  rows: ComparisonRow[];
  lockedFields: Set<string>;
  selectedFields: Set<string>;
  onToggleField: (field: string) => void;
  sourceLabel: string;
}

const COL = '120px 1fr 44px 1fr';
const BORDER = '1px solid var(--mantine-color-gray-3)';
const BORDER_LIGHT = '1px solid var(--mantine-color-gray-2)';
const HEADER_BG = 'var(--mantine-color-gray-1)';

export function MetadataComparisonTable({
  rows,
  lockedFields,
  selectedFields,
  onToggleField,
  sourceLabel,
}: MetadataComparisonTableProps) {
  return (
    <Box style={{ border: BORDER, borderRadius: 8, overflow: 'hidden' }}>
      {/* Header */}
      <Box
        style={{
          display: 'grid',
          gridTemplateColumns: COL,
          background: HEADER_BG,
          borderBottom: BORDER,
        }}
      >
        <Box style={{ padding: '6px 10px' }}>
          <Text size="xs" fw={700} c="dimmed">
            Field
          </Text>
        </Box>
        <Box style={{ padding: '6px 10px', borderLeft: BORDER }}>
          <Text size="xs" fw={700} c="dimmed">
            Current
          </Text>
        </Box>
        <Box style={{ borderLeft: BORDER }} />
        <Box style={{ padding: '6px 10px', borderLeft: BORDER }}>
          <Text size="xs" fw={700} c="dimmed">
            From {sourceLabel}
          </Text>
        </Box>
      </Box>

      {/* Rows */}
      {rows.map(({ label, field, current, proposed, isImage }, i) => {
        const locked = lockedFields.has(field);
        const selected = selectedFields.has(field);
        const hasProposed = !!proposed;
        const isSame = !isImage && hasProposed && proposed === current;
        const canToggle = hasProposed && !locked && !isSame;
        const isLast = i === rows.length - 1;
        const rowBorderBottom = isLast ? undefined : BORDER_LIGHT;

        return (
          <Box
            key={field}
            style={{
              display: 'grid',
              gridTemplateColumns: COL,
              borderBottom: rowBorderBottom,
            }}
          >
            {/* Field label */}
            <Box
              style={{
                padding: '8px 10px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 4,
              }}
            >
              {locked && (
                <IconLock
                  size={14}
                  color="var(--mantine-color-yellow-6)"
                  style={{ marginTop: 1, flexShrink: 0 }}
                />
              )}
              <Text size="xs" c="dimmed" fw={500}>
                {label}
              </Text>
            </Box>

            {/* Current value — shows proposed when staged */}
            <Box
              style={{
                padding: '8px 10px',
                borderLeft: BORDER,
                background: selected
                  ? 'var(--mantine-color-teal-0)'
                  : undefined,
                transition: 'background 0.15s',
              }}
            >
              {isImage ? (
                (selected ? proposed : current) ? (
                  <img
                    src={selected ? proposed! : current!}
                    alt={label}
                    style={{
                      height: 80,
                      objectFit: 'contain',
                      borderRadius: 4,
                      display: 'block',
                    }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <Text size="xs" c="dimmed">
                    —
                  </Text>
                )
              ) : (
                <Text
                  size="xs"
                  style={{ wordBreak: 'break-word' }}
                  c={selected ? 'teal.7' : undefined}
                >
                  {selected ? proposed || '—' : current || '—'}
                </Text>
              )}
            </Box>

            {/* Arrow toggle button */}
            <Box
              style={{
                borderLeft: BORDER,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: HEADER_BG,
              }}
            >
              {locked ? (
                <Tooltip label="Locked — won't be overwritten" withArrow>
                  <Box style={{ display: 'flex' }}>
                    <IconLock size={16} color="var(--mantine-color-yellow-5)" />
                  </Box>
                </Tooltip>
              ) : (
                <Tooltip
                  label={
                    selected
                      ? 'Undo'
                      : isSame
                        ? 'Already matches'
                        : hasProposed
                          ? `Apply ${label}`
                          : 'No value to apply'
                  }
                  withArrow
                >
                  <ActionIcon
                    size="sm"
                    variant={
                      selected ? 'filled' : canToggle ? 'light' : 'subtle'
                    }
                    color={selected ? 'teal' : canToggle ? 'green' : 'gray'}
                    disabled={!canToggle && !selected}
                    onClick={() =>
                      (canToggle || selected) && onToggleField(field)
                    }
                  >
                    <IconChevronLeft size={16} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Box>

            {/* Proposed value */}
            <Box
              style={{
                padding: '8px 10px',
                borderLeft: BORDER,
                opacity: locked ? 0.4 : 1,
              }}
            >
              {isImage ? (
                proposed ? (
                  <img
                    src={proposed}
                    alt={label}
                    style={{
                      height: 80,
                      objectFit: 'contain',
                      borderRadius: 4,
                      display: 'block',
                      filter: locked ? 'grayscale(1)' : undefined,
                    }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <Text size="xs" c="dimmed">
                    —
                  </Text>
                )
              ) : (
                <Text
                  size="xs"
                  style={{
                    wordBreak: 'break-word',
                    textDecoration: locked ? 'line-through' : undefined,
                  }}
                >
                  {proposed || '—'}
                </Text>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
