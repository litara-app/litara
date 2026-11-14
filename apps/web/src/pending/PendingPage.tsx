import { Alert, Badge, Button, Card, Group, Stack, Text, Title } from "@mantine/core";
import { useState } from "react";
import { api, ApiError } from "../api/client";
import { ErrorBox } from "../ui/common";
import { usePendingQueue, usePendingState } from "./PendingProvider";
import type { PendingOp } from "./store";

const color = { pending: "gray", conflict: "orange", blocked: "red", failed: "red" } as const;
const words = { pending: "waiting to send", conflict: "conflicts with a newer change", blocked: "access was removed", failed: "was rejected" } as const;

function contentVersionOf(op: PendingOp): string | null {
  const b = op.body as { anchor?: { contentVersion?: string }; data?: { anchor?: { contentVersion?: string } } };
  return b.anchor?.contentVersion ?? b.data?.anchor?.contentVersion ?? null;
}

function Row({ op }: { op: PendingOp }) {
  const queue = usePendingQueue();
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const problem = op.problem ?? {};
  const conflictId = typeof problem.conflictId === "string" ? problem.conflictId : null;

  async function resolve(choice: "keep_server" | "use_candidate") {
    setBusy(true);
    setErr(null);
    try {
      await api("POST", `/personal-conflicts/${conflictId}/resolve`, {
        operationId: crypto.randomUUID(), baseRevision: String(problem.currentRevision ?? "0"), choice,
        contentVersion: choice === "use_candidate" ? contentVersionOf(op) : null,
      });
      // The server settled the retained candidate; later queued writes to this resource were based on it.
      for (const o of queue.forKey(op.resourceKey)) await queue.discard(o.id);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card withBorder data-testid="pending-item">
      <Stack gap="xs">
        <Group justify="space-between">
          <Text fw={500}>{op.label}</Text>
          <Badge color={color[op.status]} variant="light">{words[op.status]}</Badge>
        </Group>
        <Text size="xs" c="dimmed">{new Date(op.createdAt).toLocaleString()} · {op.attempts} attempt{op.attempts === 1 ? "" : "s"}</Text>
        {op.error && op.status !== "pending" && <Text size="sm" c="red">{op.error}</Text>}
        <ErrorBox error={err instanceof ApiError ? err : err ? new Error(String(err)) : null} />
        <Group gap="xs">
          {op.status === "conflict" && conflictId && <>
            <Button size="compact-sm" variant="default" loading={busy} onClick={() => resolve("keep_server")}>Keep what is saved</Button>
            <Button size="compact-sm" loading={busy} onClick={() => resolve("use_candidate")}>Use my change</Button>
          </>}
          {(op.status === "pending" || op.status === "blocked" || op.status === "failed") && <Button size="compact-sm" variant="default" onClick={() => void queue.retry(op.id)}>Try again</Button>}
          {op.status !== "pending" && <Button size="compact-sm" color="red" variant="subtle"
            onClick={() => { if (confirm("Discard this change? It will be lost.")) void queue.discard(op.id); }}>Discard</Button>}
        </Group>
      </Stack>
    </Card>
  );
}

export function PendingPage() {
  const s = usePendingState();
  const queue = usePendingQueue();
  const attention = s.items.filter((o) => o.status !== "pending");
  const waiting = s.items.filter((o) => o.status === "pending");
  return (
    <Stack>
      <Title order={2}>Pending changes</Title>
      <Text size="sm" c="dimmed">
        Changes you made while the server could not be reached are kept on this device, under your account only, and are sent in order
        when it is back. Nothing here is shown as saved until the server accepted it. Changes belonging to other accounts on this
        browser stay locked and are never shown or sent from here.
      </Text>
      {!s.durable && <Alert color="yellow">This browser cannot store pending changes across a reload.</Alert>}
      {s.offline && <Alert color="yellow">The server cannot be reached right now; sending will be retried. <Button size="compact-xs" onClick={() => void queue.retry()}>Try now</Button></Alert>}
      {s.items.length === 0 && <Text c="dimmed" data-testid="pending-empty">Nothing is waiting.</Text>}
      {attention.length > 0 && <Title order={4}>Needs attention</Title>}
      {attention.map((o) => <Row key={o.id} op={o} />)}
      {waiting.length > 0 && <Title order={4}>Waiting to send</Title>}
      {waiting.map((o) => <Row key={o.id} op={o} />)}
    </Stack>
  );
}
