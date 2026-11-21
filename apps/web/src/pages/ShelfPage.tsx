import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api, ApiError, get, op } from "../api/client";
import type { Page as Paged, Shelf, Title as TitleT } from "../api/types";
import { icons, Alert, Badge, Busy, Button, Card, ConfirmDialog, EmptyState, ErrorBox, IconButton, Page, PageHeader, Row, Stack, Text, TextLink, Tip } from "../ui";

export function ShelfPage() {
  const { shelfId = "" } = useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const shelf = useQuery({ queryKey: ["shelf", shelfId], queryFn: () => get<Shelf>(`/shelves/${shelfId}`) });
  const titles = useQuery({
    queryKey: ["shelf", shelfId, "titles"], enabled: !!shelf.data && !shelf.data.deleted,
    queryFn: () => get<Paged<TitleT>>(`/shelves/${shelfId}/titles?size=200`),
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
  if (shelf.error) return <Page><ErrorBox error={shelf.error} /></Page>;
  const s = shelf.data;
  const data = s.data;
  if (!data) return <Page><Alert tone="neutral">This shelf was deleted.</Alert></Page>;
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
    <Page>
      <PageHeader title={data.name}
        actions={<><Badge>{data.kind}</Badge><Badge outline tone="neutral">{data.visibility}</Badge><Badge tone="neutral">{s.visibleTitleCount} visible</Badge></>} />
      {data.kind === "smart" && <Text size="sm" tone="dim">Smart shelves are evaluated for whoever is viewing, using their own library access and reading state.</Text>}
      {stale && <Alert tone="warning" role="alert">This shelf changed elsewhere, so the action was not applied. The list below is current; try again.</Alert>}
      {!stale && <ErrorBox error={err} />}
      {titles.isPending ? <Busy /> : items.length === 0 ? <EmptyState title="No visible titles" /> : (
        <Stack gap="sm">
          {items.map((t, i) => (
            <Card key={t.id} data-testid="shelf-title" pad="sm">
              <Row justify="between">
                <Stack gap="xs">
                  <TextLink to={`/titles/${t.id}`}>{t.title}</TextLink>
                  <Text size="sm" tone="dim">{t.authors.join(", ")}</Text>
                </Stack>
                {manualEdit && (
                  <Row>
                    <Tip label="Move up"><IconButton aria-label={`Move ${t.title} up`} disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)}>↑</IconButton></Tip>
                    <Tip label="Move down"><IconButton aria-label={`Move ${t.title} down`} disabled={i === items.length - 1 || reorder.isPending} onClick={() => move(i, 1)}>↓</IconButton></Tip>
                    <Button size="sm" loading={remove.isPending && remove.variables === t.id} onClick={() => remove.mutate(t.id)} icon={icons.trash}>Remove</Button>
                  </Row>
                )}
              </Row>
            </Card>
          ))}
        </Stack>
      )}
      {s.canEdit && <Row><Button variant="danger" loading={del.isPending} onClick={() => setConfirming(true)} icon={icons.trash}>Delete shelf</Button></Row>}
      <ConfirmDialog open={confirming} title="Delete this shelf?" confirmLabel="Delete shelf" danger loading={del.isPending}
        onCancel={() => setConfirming(false)} onConfirm={() => { setConfirming(false); del.mutate(); }}>
        “{data.name}” will be deleted. The titles on it stay in your library. This cannot be undone.
      </ConfirmDialog>
    </Page>
  );
}
