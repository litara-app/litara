import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, get } from "../api/client";
import type { Credential, DigestBinding, KoConflict } from "../api/t006";
import type { Page } from "../api/types";
import { icons, Alert, Badge, Busy, Button, Card, Code, ErrorBox, Heading, Row, Stack, Table, TBody, TD, Text, TH, THead, TR } from "../ui";

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
    <Card data-testid="ko-conflict" tone={c.resolved ? undefined : "warning"}>
      <Stack gap="sm">
        <Row justify="between">
          <Text strong>{c.candidate.device} <Text as="span" size="sm" tone="dim">({deviceLabel})</Text></Text>
          <Badge tone={c.resolved ? "neutral" : "warning"}>{c.resolved ? "Resolved" : "Needs your decision"}</Badge>
        </Row>
        <Text size="sm">{reasonText[c.reason]}</Text>
        <Row>
          <Text as="span" size="sm">Position this device tried to save:</Text>
          <Code data-testid="ko-candidate-progress">{c.candidate.progress}</Code>
          <Badge>{(c.candidate.percentage * 100).toFixed(1)}%</Badge>
        </Row>
        <Text size="xs" tone="dim">
          This is a KOReader position. It is kept separate from your place in the Litara reader and never changes whether a book is marked finished.
        </Text>
        <ErrorBox error={resolve.error ?? reapply.error} />
        {!c.resolved ? (
          <Row>
            <Button size="sm" loading={resolve.isPending} onClick={() => resolve.mutate("keep_server")} icon={icons.check}>Keep the saved position</Button>
            <Button size="sm" variant="primary" loading={resolve.isPending} disabled={c.reason === "content_changed"} onClick={() => resolve.mutate("use_candidate")} icon={icons.check}>Use this device&rsquo;s position</Button>
          </Row>
        ) : (
          <Row>
            <Button size="sm" icon={icons.reset} loading={reapply.isPending} disabled={c.reason === "content_changed"} onClick={() => reapply.mutate()}
              title="Apply this position again as a new, deliberate change">Reapply this position…</Button>
            <Text size="xs" tone="dim">Reapplying records a new change on purpose; it is not a retry. The device reads the result on its next sync.</Text>
          </Row>
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
      <Text size="sm" tone="dim">
        KOReader keeps its own reading position in Litara, separate from the Litara reader and from finished status. When a device
        would overwrite a position saved by another device, Litara keeps its position here for you to decide instead.
      </Text>
      <ErrorBox error={conflicts.error ?? bindings.error} />
      <Heading level={2}>Waiting for your decision</Heading>
      {open.length === 0 ? <Text size="sm" tone="dim" data-testid="ko-none">Nothing is waiting.</Text> : open.map((c) => <Conflict key={c.id} c={c} deviceLabel={label(c.credentialId)} />)}
      {closed.length > 0 && <>
        <Heading level={2}>Resolved</Heading>
        {closed.map((c) => <Conflict key={c.id} c={c} deviceLabel={label(c.credentialId)} />)}
      </>}
      <Heading level={2}>Document bindings</Heading>
      <Alert tone="info">
        When two files have the same KOReader fingerprint, a device cannot tell which one it opened. Choose the right one from that book&rsquo;s page under
        &ldquo;KOReader&rdquo;. Existing bindings are listed here.
      </Alert>
      <ErrorBox error={unbind.error} />
      <Table label="Bindings table" data-testid="bindings-table">
        <THead><TR><TH>Device</TH><TH>Document</TH><TH><span className="lt-sr">Actions</span></TH></TR></THead>
        <TBody>
          {bindings.data?.items.length === 0 && <TR><TD colSpan={3}><Text size="sm" tone="dim">No bindings.</Text></TD></TR>}
          {bindings.data?.items.map((b) => (
            <TR key={b.id}>
              <TD>{label(b.credentialId)}</TD>
              <TD><Code>{b.document}</Code></TD>
              <TD><Row justify="end"><Button size="sm" loading={unbind.isPending} onClick={() => unbind.mutate(b)} icon={icons.trash}>Remove</Button></Row></TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Stack>
  );
}
