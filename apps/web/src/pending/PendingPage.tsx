import { useState } from "react";
import { api, ApiError } from "../api/client";
import { icons, Alert, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Heading, Page, PageHeader, Row, Stack, Text, type Tone } from "../ui";
import { usePendingQueue, usePendingState } from "./PendingProvider";
import type { PendingOp } from "./store";

const tone: Record<PendingOp["status"], Tone> = { pending: "neutral", conflict: "warning", blocked: "danger", failed: "danger" };
const words = { pending: "waiting to send", conflict: "conflicts with a newer change", blocked: "access was removed", failed: "was rejected" } as const;

function contentVersionOf(op: PendingOp): string | null {
  const b = op.body as { anchor?: { contentVersion?: string }; data?: { anchor?: { contentVersion?: string } } };
  return b.anchor?.contentVersion ?? b.data?.anchor?.contentVersion ?? null;
}

function Item({ op }: { op: PendingOp }) {
  const queue = usePendingQueue();
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const problem = op.problem ?? {};
  const conflictId = typeof problem.conflictId === "string" ? problem.conflictId : null;

  async function resolve(choice: "keep_server" | "use_candidate") {
    setBusy(true);
    setErr(null);
    try {
      if (op.kind === "recording-position") {
        // Listening positions use the recording conflict protocol (layout revision, no explicit position).
        const current = problem.current as { revision?: string } | undefined;
        await api("POST", `/recordings/${op.editionId}/conflicts/${conflictId}/resolve`, {
          operationId: crypto.randomUUID(), baseRevision: String(current?.revision ?? "0"), layoutRevision: op.body.layoutRevision, choice, position: null,
        });
      } else {
        await api("POST", `/personal-conflicts/${conflictId}/resolve`, {
          operationId: crypto.randomUUID(), baseRevision: String(problem.currentRevision ?? "0"), choice,
          contentVersion: choice === "use_candidate" ? contentVersionOf(op) : null,
        });
      }
      // The server settled the retained candidate; later queued writes to this resource were based on it.
      for (const o of queue.forKey(op.resourceKey)) await queue.discard(o.id);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="pending-item" tone={op.status === "pending" ? undefined : op.status === "conflict" ? "warning" : "danger"}>
      <Stack gap="sm">
        <Row justify="between">
          <Text strong>{op.label}</Text>
          <Badge tone={tone[op.status]}>{words[op.status]}</Badge>
        </Row>
        <Text size="xs" tone="dim">{new Date(op.createdAt).toLocaleString()} · {op.attempts} attempt{op.attempts === 1 ? "" : "s"}</Text>
        {op.error && op.status !== "pending" && <Text size="sm" tone="danger">{op.error}</Text>}
        <ErrorBox error={err instanceof ApiError ? err : err ? new Error(String(err)) : null} />
        <Row>
          {op.status === "conflict" && conflictId && op.kind !== "recording-completion" && <>
            <Button size="sm" loading={busy} onClick={() => resolve("keep_server")} icon={icons.check}>Keep what is saved</Button>
            <Button size="sm" variant="primary" loading={busy} onClick={() => resolve("use_candidate")} icon={icons.check}>Use my change</Button>
          </>}
          {(op.status === "pending" || op.status === "blocked" || op.status === "failed") && <Button size="sm" onClick={() => void queue.retry(op.id)} icon={icons.reset}>Try again</Button>}
          {op.status !== "pending" && <Button size="sm" variant="danger" onClick={() => setConfirming(true)} icon={icons.trash}>Discard</Button>}
        </Row>
      </Stack>
      <ConfirmDialog open={confirming} title="Discard this change?" confirmLabel="Discard" danger
        onCancel={() => setConfirming(false)} onConfirm={() => { setConfirming(false); void queue.discard(op.id); }}>
        “{op.label}” will be lost. This cannot be undone.
      </ConfirmDialog>
    </Card>
  );
}

export function PendingPage() {
  const s = usePendingState();
  const queue = usePendingQueue();
  const attention = s.items.filter((o) => o.status !== "pending");
  const waiting = s.items.filter((o) => o.status === "pending");
  return (
    <Page>
      <PageHeader title="Pending changes"
        description="Changes you made while the server could not be reached are kept on this device, under your account only, and are sent in order when it is back. Nothing here is shown as saved until the server accepted it. Changes belonging to other accounts on this browser stay locked and are never shown or sent from here." />
      {!s.durable && <Alert tone="warning">This browser cannot store pending changes across a reload.</Alert>}
      {s.offline && (
        <Alert tone="warning">
          <Row>The server cannot be reached right now; sending will be retried. <Button size="sm" onClick={() => void queue.retry()} icon={icons.reset}>Try now</Button></Row>
        </Alert>
      )}
      {s.items.length === 0 && <div data-testid="pending-empty"><EmptyState title="Nothing is waiting">Changes that could not be sent appear here.</EmptyState></div>}
      {attention.length > 0 && <Heading level={2}>Needs attention</Heading>}
      {attention.map((o) => <Item key={o.id} op={o} />)}
      {waiting.length > 0 && <Heading level={2}>Waiting to send</Heading>}
      {waiting.map((o) => <Item key={o.id} op={o} />)}
    </Page>
  );
}
