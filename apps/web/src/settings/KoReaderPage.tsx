import { Alert, Badge, Button, Card, Code, Group, Stack, Table, Text, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, get } from "../api/client";
import type { Credential, DigestBinding, KoConflict } from "../api/t006";
import type { Page } from "../api/types";
import { ScrollRegion } from "../ui/ScrollRegion";
import { Busy, ErrorBox } from "../ui/common";

export const reasonText: Record<KoConflict["reason"], string> = {
  baseline_required: "This device had not yet synced with the saved position before it tried to save progress.",
  stale_revision: "Another device saved progress after this device last synced.",
  content_changed: "The book file changed, so this position cannot be applied to the new file.",
  unresolved_candidate: "An earlier position from this device is still waiting for your decision.",
};

function Conflict({ c, deviceLabel }: { c: KoConflict; deviceLabel: string }) {
  const qc = useQueryClient();
  const done = () => { qc.invalidateQueries({ queryKey: ["ko-conflicts"] }); qc.invalidateQueries({ queryKey: ["ko-position"] }); };
  // Every action names the source revision the owner looked at; a newer one makes the server refuse it.
  const resolve = useMutation({
    mutationFn: (action: "keep_server" | "use_candidate") =>
      api("POST", `/koreader/conflicts/${c.id}/resolve`, { operationId: crypto.randomUUID(), baseRevision: c.currentRevision, action }),
    onSettled: done,
  });
  const reapply = useMutation({
    mutationFn: () => api("POST", `/koreader/conflicts/${c.id}/reapply`, { operationId: crypto.randomUUID(), baseRevision: c.currentRevision }),
    onSettled: done,
  });
  return (
    <Card withBorder data-testid="ko-conflict">
      <Stack gap="xs">
        <Group justify="space-between">
          <Text fw={600}>{c.candidate.device} <Text span size="sm" c="dimmed">({deviceLabel})</Text></Text>
          <Badge color={c.resolved ? "gray" : "orange"} variant="light">{c.resolved ? "Resolved" : "Needs your decision"}</Badge>
        </Group>
        <Text size="sm">{reasonText[c.reason]}</Text>
        <Group gap="xs">
          <Text size="sm">Position this device tried to save:</Text>
          <Code data-testid="ko-candidate-progress">{c.candidate.progress}</Code>
          <Badge variant="light">{(c.candidate.percentage * 100).toFixed(1)}%</Badge>
        </Group>
        <Text size="xs" c="dimmed">
          This is a KOReader position. It is kept separate from your place in the Litara reader and never changes whether a book is marked finished.
        </Text>
        <ErrorBox error={resolve.error ?? reapply.error} />
        {!c.resolved ? (
          <Group>
            <Button size="xs" variant="default" loading={resolve.isPending} onClick={() => resolve.mutate("keep_server")}>Keep the saved position</Button>
            <Button size="xs" loading={resolve.isPending} disabled={c.reason === "content_changed"} onClick={() => resolve.mutate("use_candidate")}>Use this device&rsquo;s position</Button>
          </Group>
        ) : (
          <Group>
            <Button size="xs" variant="default" loading={reapply.isPending} disabled={c.reason === "content_changed"} onClick={() => reapply.mutate()}
              title="Apply this position again as a new, deliberate change">Reapply this position…</Button>
            <Text size="xs" c="dimmed">Reapplying records a new change on purpose; it is not a retry. The device reads the result on its next sync.</Text>
          </Group>
        )}
      </Stack>
    </Card>
  );
}

export function KoReaderPage() {
  const qc = useQueryClient();
  const conflicts = useQuery({ queryKey: ["ko-conflicts"], queryFn: () => get<Page<KoConflict>>("/koreader/conflicts?size=200") });
  const bindings = useQuery({ queryKey: ["ko-bindings"], queryFn: () => get<Page<DigestBinding>>("/koreader/bindings?size=200") });
  const creds = useQuery({ queryKey: ["credentials"], queryFn: () => get<{ items: Credential[] }>("/integration-credentials") });
  const label = (id: string) => creds.data?.items.find((c) => c.id === id)?.label ?? "revoked or unknown device";
  const unbind = useMutation({
    mutationFn: (b: DigestBinding) => api("DELETE", `/koreader/bindings/${b.id}`, { operationId: crypto.randomUUID(), baseRevision: b.revision }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["ko-bindings"] }),
  });
  if (conflicts.isPending || bindings.isPending) return <Busy />;
  const open = conflicts.data?.items.filter((c) => !c.resolved) ?? [];
  const closed = conflicts.data?.items.filter((c) => c.resolved) ?? [];
  return (
    <Stack>
      <Text size="sm" c="dimmed">
        KOReader keeps its own reading position in Litara, separate from the Litara reader and from finished status. When a device
        would overwrite a position saved by another device, Litara keeps its position here for you to decide instead.
      </Text>
      <ErrorBox error={conflicts.error ?? bindings.error} />
      <Title order={4}>Waiting for your decision</Title>
      {open.length === 0 ? <Text size="sm" c="dimmed" data-testid="ko-none">Nothing is waiting.</Text> : open.map((c) => <Conflict key={c.id} c={c} deviceLabel={label(c.credentialId)} />)}
      {closed.length > 0 && <>
        <Title order={4}>Resolved</Title>
        {closed.map((c) => <Conflict key={c.id} c={c} deviceLabel={label(c.credentialId)} />)}
      </>}
      <Title order={4}>Document bindings</Title>
      <Alert color="blue" variant="light">
        When two files have the same KOReader fingerprint, a device cannot tell which one it opened. Choose the right one from that book&rsquo;s page under
        &ldquo;KOReader&rdquo;. Existing bindings are listed here.
      </Alert>
      <ErrorBox error={unbind.error} />
      <ScrollRegion label="Bindings table">
        <Table verticalSpacing="xs" data-testid="bindings-table">
          <Table.Thead><Table.Tr><Table.Th>Device</Table.Th><Table.Th>Document</Table.Th><Table.Th /></Table.Tr></Table.Thead>
          <Table.Tbody>
            {bindings.data?.items.length === 0 && <Table.Tr><Table.Td colSpan={3}><Text size="sm" c="dimmed">No bindings.</Text></Table.Td></Table.Tr>}
            {bindings.data?.items.map((b) => (
              <Table.Tr key={b.id}>
                <Table.Td>{label(b.credentialId)}</Table.Td>
                <Table.Td><Code>{b.document}</Code></Table.Td>
                <Table.Td><Group justify="flex-end"><Button size="compact-xs" variant="default" loading={unbind.isPending} onClick={() => unbind.mutate(b)}>Remove</Button></Group></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollRegion>
    </Stack>
  );
}
