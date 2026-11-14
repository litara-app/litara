import { Alert, Anchor, Badge, Button, Card, Group, Stack, Text, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { api, get } from "../api/client";
import type { Edition } from "../api/types";
import { Busy, bytes, CapBadge, ErrorBox } from "../ui/common";

export function EditionPage() {
  const { editionId = "" } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["edition", editionId], queryFn: () => get<Edition>(`/editions/${editionId}`) });
  const finish = useMutation({
    mutationFn: (e: Edition) =>
      api("PUT", `/editions/${e.id}/completion`, {
        operationId: crypto.randomUUID(), baseRevision: e.completion.revision, capturedAt: new Date().toISOString(),
        fileId: e.file.id, contentVersion: e.file.contentVersion, event: e.completion.finished ? "manual_unfinish" : "manual_finish",
      }),
    // A stale revision or changed file produces a 409/412: refetch and show the server state.
    onSettled: () => qc.invalidateQueries({ queryKey: ["edition", editionId] }),
  });

  if (q.isPending) return <Busy />;
  if (q.error) return <ErrorBox error={q.error} />;
  const e = q.data;
  const caps = e.capabilities;
  return (
    <Stack>
      <Anchor component={Link} to={`/titles/${e.titleId}`}>Back to title</Anchor>
      <Title order={2}>{e.label || e.file.format.toUpperCase()}</Title>
      <Group gap="xs">
        <Badge>{e.file.format.toUpperCase()}</Badge>
        <Badge variant="light">{bytes(e.file.sizeBytes)}</Badge>
        <Badge variant="light" color={e.readiness === "ready" ? "green" : e.readiness === "incomplete" ? "yellow" : "gray"}>{e.readiness}</Badge>
        {e.completion.finished && <Badge color="green">Finished</Badge>}
      </Group>
      {e.issues.map((i) => <Alert key={i.code} color="yellow" title={i.code}>{i.detail}</Alert>)}

      <Card withBorder>
        <Stack gap="xs">
          <Text fw={600}>Capabilities</Text>
          <Group gap="xs">
            {(Object.keys(caps) as (keyof typeof caps)[]).map((k) => <CapBadge key={k} name={k} cap={caps[k]} />)}
          </Group>
        </Stack>
      </Card>

      <Group>
        <Button disabled title="The in-browser reader is wired in a later milestone">Read</Button>
        {e.file.contentPath && caps.download.state === "supported" && (
          <Button component="a" href={e.file.contentPath} download variant="default">Download original</Button>
        )}
        <Button variant="default" loading={finish.isPending} onClick={() => finish.mutate(e)}>
          {e.completion.finished ? "Mark unfinished" : "Mark finished"}
        </Button>
      </Group>
      <ErrorBox error={finish.error} />
    </Stack>
  );
}
