import { Badge, Card, Group, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { get } from "../api/client";
import type { Edition, Page, RecordingLink, TitleDetail } from "../api/types";
import { Busy, bytes, ErrorBox } from "../ui/common";

export function TitlePage() {
  const { titleId = "" } = useParams();
  const detail = useQuery({ queryKey: ["title", titleId], queryFn: () => get<TitleDetail>(`/titles/${titleId}`) });
  const editions = useQuery({ queryKey: ["title", titleId, "editions"], queryFn: () => get<Page<Edition>>(`/editions?titleId=${titleId}&size=200`) });
  const recordings = useQuery({ queryKey: ["title", titleId, "recordings"], queryFn: () => get<Page<RecordingLink>>(`/titles/${titleId}/recordings?size=200`) });

  if (detail.isPending) return <Busy />;
  if (detail.error) return <ErrorBox error={detail.error} />;
  const t = detail.data.title;
  return (
    <Stack>
      <Title order={2}>{t.title || "(untitled)"}</Title>
      <Text c="dimmed">{t.authors.join(", ") || "Unknown author"}{t.series.length > 0 ? ` · ${t.series.join(", ")}` : ""}</Text>
      {t.languages.length > 0 && <Group gap="xs">{t.languages.map((l) => <Badge key={l} variant="outline">{l}</Badge>)}</Group>}

      <Title order={3}>Ebooks and comics</Title>
      <ErrorBox error={editions.error} />
      {!editions.data ? <Busy /> : editions.data.items.length === 0 ? <Text c="dimmed">No ebook editions.</Text> : (
        editions.data.items.map((e) => (
          <Card key={e.id} withBorder data-testid="edition-card">
            <Group justify="space-between">
              <div>
                <Text fw={600} component={Link} to={`/editions/${e.id}`}>{e.label || e.file.format.toUpperCase()}</Text>
                <Text size="sm" c="dimmed">{e.file.format.toUpperCase()} · {bytes(e.file.sizeBytes)}{e.language ? ` · ${e.language}` : ""}</Text>
              </div>
              <Group gap="xs">
                {e.completion.finished && <Badge color="green">Finished</Badge>}
                <Badge color={e.readiness === "ready" ? "green" : e.readiness === "incomplete" ? "yellow" : "gray"} variant="light">{e.readiness}</Badge>
              </Group>
            </Group>
          </Card>
        ))
      )}

      <Title order={3}>Audiobook recordings</Title>
      <ErrorBox error={recordings.error} />
      {!recordings.data ? <Busy /> : recordings.data.items.length === 0 ? <Text c="dimmed">No audio recordings.</Text> : (
        recordings.data.items.map((r) => (
          <Card key={r.id} withBorder data-testid="recording-card">
            <Text fw={600}>{r.label || "Recording"}</Text>
            <Text size="sm" c="dimmed">Web playback arrives in a later milestone.</Text>
          </Card>
        ))
      )}
    </Stack>
  );
}
