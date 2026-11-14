import { ActionIcon, Alert, Badge, Button, Card, Group, Stack, Text, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { api, ApiError, get, op } from "../api/client";
import type { Page, Shelf, Title as TitleT } from "../api/types";
import { Busy, ErrorBox } from "../ui/common";

export function ShelfPage() {
  const { shelfId = "" } = useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const shelf = useQuery({ queryKey: ["shelf", shelfId], queryFn: () => get<Shelf>(`/shelves/${shelfId}`) });
  const titles = useQuery({
    queryKey: ["shelf", shelfId, "titles"], enabled: !!shelf.data && !shelf.data.deleted,
    queryFn: () => get<Page<TitleT>>(`/shelves/${shelfId}/titles?size=200`),
  });
  // Every mutation refetches afterwards, so a 409 shows the server state and the user retries from it.
  const refresh = () => { qc.invalidateQueries({ queryKey: ["shelf", shelfId] }); qc.invalidateQueries({ queryKey: ["shelves"] }); };
  const remove = useMutation({
    mutationFn: (titleId: string) => api("DELETE", `/shelves/${shelfId}/titles/${titleId}`, op(shelf.data!.revision)),
    onSettled: refresh,
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api("PUT", `/shelves/${shelfId}/order`, { ...op(shelf.data!.revision), visibleTitleIds: ids }),
    onSettled: refresh,
  });
  const del = useMutation({
    mutationFn: () => api("DELETE", `/shelves/${shelfId}`, op(shelf.data!.revision)),
    onSuccess: () => { refresh(); nav("/shelves"); },
  });

  if (shelf.isPending) return <Busy />;
  if (shelf.error) return <ErrorBox error={shelf.error} />;
  const s = shelf.data;
  const data = s.data;
  if (!data) return <Alert color="gray">This shelf was deleted.</Alert>;
  const items = titles.data?.items ?? [];
  const manualEdit = s.canEdit && data.kind === "manual";
  const move = (i: number, d: number) => {
    const ids = items.map((t) => t.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    reorder.mutate(ids);
  };
  const err = remove.error ?? reorder.error ?? del.error;
  const stale = err instanceof ApiError && (err.status === 409 || err.status === 412);
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{data.name}</Title>
        <Group gap="xs">
          <Badge variant="light">{data.kind}</Badge>
          <Badge variant="outline">{data.visibility}</Badge>
          <Badge color="gray">{s.visibleTitleCount} visible</Badge>
        </Group>
      </Group>
      {data.kind === "smart" && <Text size="sm" c="dimmed">Smart shelves are evaluated for whoever is viewing, using their own library access and reading state.</Text>}
      {stale && <Alert color="yellow" role="alert">This shelf changed elsewhere, so the action was not applied. The list below is current; try again.</Alert>}
      {!stale && <ErrorBox error={err} />}
      {titles.isPending ? <Busy /> : items.length === 0 ? <Text c="dimmed">No visible titles.</Text> : items.map((t, i) => (
        <Card key={t.id} withBorder data-testid="shelf-title">
          <Group justify="space-between">
            <div>
              <Text fw={600} component={Link} to={`/titles/${t.id}`}>{t.title}</Text>
              <Text size="sm" c="dimmed">{t.authors.join(", ")}</Text>
            </div>
            {manualEdit && (
              <Group gap="xs">
                <ActionIcon variant="default" aria-label={`Move ${t.title} up`} disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)}>↑</ActionIcon>
                <ActionIcon variant="default" aria-label={`Move ${t.title} down`} disabled={i === items.length - 1 || reorder.isPending} onClick={() => move(i, 1)}>↓</ActionIcon>
                <Button size="compact-sm" variant="default" loading={remove.isPending && remove.variables === t.id} onClick={() => remove.mutate(t.id)}>Remove</Button>
              </Group>
            )}
          </Group>
        </Card>
      ))}
      {s.canEdit && <Group><Button color="red" variant="outline" loading={del.isPending} onClick={() => { if (confirm("Delete this shelf?")) del.mutate(); }}>Delete shelf</Button></Group>}
    </Stack>
  );
}
