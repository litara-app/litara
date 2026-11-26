import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, get } from "../../api/client";
import type { Edition, ListeningEvent, Page, ReadingEvent, ReadingSession, RecordingLink } from "../../api/types";
import { duration, icons, Busy, Button, Card, EmptyState, ErrorBox, Heading, Row, Stack, StatusPill, Text, Timeline, when } from "../../ui";

const EVENTS: Record<string, { title: string; tone: "success" | "info" | "neutral" | "warning" }> = {
  manual_finish: { title: "Marked finished", tone: "success" },
  manual_unfinish: { title: "Marked unfinished", tone: "warning" },
  auto_finish: { title: "Finished by reading to the end", tone: "success" },
  natural_end: { title: "Finished by listening to the end", tone: "success" },
  started: { title: "Started", tone: "info" },
};
const label = (e: string) => EVENTS[e] ?? { title: e.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), tone: "neutral" as const };

/** When this account finished or restarted each edition, and a way to change it. */
export function ReadingLogTab({ titleId, editions, recordings }: { titleId: string; editions: Edition[]; recordings: RecordingLink[] }) {
  const qc = useQueryClient();
  const log = useQuery({ queryKey: ["title", titleId, "reading-history"], queryFn: () => get<Page<ReadingEvent>>(`/titles/${titleId}/reading-history?size=100`) });
  // Ebook and audiobook completions are separate lists on the server; this tab shows one timeline (ADR-0022).
  const listening = useQuery({ queryKey: ["title", titleId, "listening-history"], queryFn: () => get<Page<ListeningEvent>>(`/titles/${titleId}/history?size=100`) });
  const sessions = useQuery({ queryKey: ["title", titleId, "reading-sessions"], queryFn: () => get<Page<ReadingSession>>(`/titles/${titleId}/reading-sessions?size=50`) });
  const toggle = useMutation({
    mutationFn: (e: Edition) =>
      api("PUT", `/editions/${e.id}/completion`, {
        operationId: crypto.randomUUID(), baseRevision: e.completion.revision, capturedAt: new Date().toISOString(),
        fileId: e.file.id, contentVersion: e.file.contentVersion, event: e.completion.finished ? "manual_unfinish" : "manual_finish",
      }),
    // A stale revision just refetches and shows what the server has.
    onSettled: () => { qc.invalidateQueries({ queryKey: ["title", titleId] }); qc.invalidateQueries({ queryKey: ["edition"] }); },
  });
  const editionName = (id: string) => {
    const e = editions.find((x) => x.id === id);
    return e ? e.label || e.file.format.toUpperCase() : "Edition";
  };
  const history = [
    ...(log.data?.items ?? []).map((ev) => ({ ...ev, name: editionName(ev.editionId) })),
    ...(listening.data?.items ?? []).map((ev) => ({ ...ev, name: recordings.find((r) => r.id === ev.recordingId)?.label || "Audiobook" })),
  ].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  const loading = log.isPending || listening.isPending;

  return (
    <Stack>
      {editions.map((e) => (
        <Card key={e.id}>
          <Row justify="between">
            <Stack gap="xs">
              <Heading level={3}>{e.label || e.file.format.toUpperCase()}</Heading>
              <Text size="sm" tone="dim">{e.completion.finished ? `Finished ${when(e.completion.changedAt)}` : "Not finished"}</Text>
            </Stack>
            <Row gap="xs">
              {e.completion.finished && <StatusPill state="finished" />}
              <Button size="sm" loading={toggle.isPending && toggle.variables?.id === e.id} onClick={() => toggle.mutate(e)} icon={icons.check}>
                {e.completion.finished ? "Mark unfinished" : "Mark finished"}
              </Button>
            </Row>
          </Row>
        </Card>
      ))}
      <ErrorBox error={toggle.error} />

      <Heading level={2}>Reading sessions</Heading>
      <ErrorBox error={sessions.error} />
      {sessions.isPending ? <Busy /> : sessions.data && sessions.data.items.length === 0 ? (
        <EmptyState level={3} title="No reading sessions yet">Each time you read, Litara records when and for how long, and where in the book you got to.</EmptyState>
      ) : sessions.data && (
        <Timeline label="Reading sessions" items={sessions.data.items.map((s) => ({
          key: s.id, title: `Read for ${duration(s.activeSeconds * 1000)}`, tone: "info" as const,
          meta: `${editions.find((x) => x.id === s.editionId)?.label || "Edition"} · ${when(s.startedAt)}${s.startFraction !== null && s.endFraction !== null ? ` · ${Math.round(s.startFraction * 100)}% to ${Math.round(s.endFraction * 100)}%` : ""}`,
        }))} />
      )}

      <Heading level={2}>History</Heading>
      <ErrorBox error={log.error ?? listening.error} />
      {loading ? <Busy /> : history.length > 0 ? (
        <Timeline label="Reading history" items={history.map((ev) => ({
          key: ev.id, title: label(ev.event).title, tone: label(ev.event).tone,
          meta: `${ev.name} · ${when(ev.capturedAt)}`,
        }))} />
      ) : log.data && listening.data && (
        <EmptyState level={3} title="Nothing logged yet">Finishing, or marking a book finished or unfinished, appears here with the date.</EmptyState>
      )}
    </Stack>
  );
}
