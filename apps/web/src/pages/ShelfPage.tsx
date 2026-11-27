import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api, ApiError, get, op } from "../api/client";
import type { Page as Paged, Shelf, Title as TitleT } from "../api/types";
import { ShelfFilterCard } from "./filter/ShelfFilterCard";
import { icons, Alert, Badge, Busy, Button, Card, ConfirmDialog, EmptyState, ErrorBox, IconButton, Page, PageHeader, Row, Stack, Text, TextLink, Tip } from "../ui";

/** The most titles the server returns in one request. */
const SIZE = 200;
/** The most titles a new order can name (the API's limit for visibleTitleIds). */
const MAX_ORDER = 10_000;

export function ShelfPage() {
  const { shelfId = "" } = useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const shelf = useQuery({ queryKey: ["shelf", shelfId], queryFn: () => get<Shelf>(`/shelves/${shelfId}`) });
  // A refetch reloads every batch already shown, so an edit keeps the reader's place in a long shelf.
  const titles = useInfiniteQuery({
    queryKey: ["shelf", shelfId, "titles"], enabled: !!shelf.data && !shelf.data.deleted,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => get<Paged<TitleT>>(`/shelves/${shelfId}/titles?page=${pageParam}&size=${SIZE}`),
    getNextPageParam: (last, all) => (last.items.length > 0 && all.length * SIZE < last.total ? all.length : undefined),
  });
  // "Load all to reorder" asks for one batch after another. It stops on an error and when the reader leaves this shelf.
  const [loadingAll, setLoadingAll] = useState(false);
  const wanted = useRef("");
  useEffect(() => () => { wanted.current = ""; }, [shelfId]);
  const loadAll = async () => {
    wanted.current = shelfId;
    setLoadingAll(true);
    let more = true;
    while (more && wanted.current === shelfId) {
      const r = await titles.fetchNextPage({ cancelRefetch: false });
      more = r.hasNextPage && !r.isError;
    }
    setLoadingAll(false);
  };
  // Every mutation refetches afterwards, so a 409 shows the server state and the user retries from it. An edit stays
  // pending until the refetch ends, so a second move cannot be made from the old order.
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["shelf", shelfId] }), qc.invalidateQueries({ queryKey: ["shelves"] })]);
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
    onSuccess: () => { void refresh(); nav("/shelves"); },
  });

  if (shelf.isPending) return <Busy />;
  if (shelf.error) return <Page><ErrorBox error={shelf.error} /></Page>;
  const s = shelf.data;
  const data = s.data;
  if (!data) return <Page><Alert tone="neutral">This shelf was deleted.</Alert></Page>;
  // A title can arrive twice if the shelf changes between two requests; it is listed once.
  const items = [...new Map((titles.data?.pages.flatMap((p) => p.items) ?? []).map((t) => [t.id, t])).values()];
  const total = titles.data?.pages.at(-1)?.total ?? 0;
  const manualEdit = s.canEdit && data.kind === "manual";
  // The server takes a new order only as the complete list of titles the owner can see.
  const complete = !titles.hasNextPage && items.length === total;
  const canReorder = complete && total <= MAX_ORDER;
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
      {s.canEdit && data.kind === "smart" && data.filter && <ShelfFilterCard shelf={s} data={data} filter={data.filter} onSaved={refresh} />}
      {stale && <Alert tone="warning" role="alert">This shelf changed elsewhere, so the action was not applied. The list below is current; try again.</Alert>}
      {!stale && <ErrorBox error={err} />}
      <ErrorBox error={titles.error} />
      {manualEdit && titles.data && !canReorder && (total > MAX_ORDER
        ? <Text size="sm" tone="dim">A shelf with more than {MAX_ORDER.toLocaleString()} titles cannot be reordered.</Text>
        : titles.hasNextPage && (
          <Row justify="between">
            <Text size="sm" tone="dim">Changing the order needs every title loaded.</Text>
            <Button size="sm" loading={loadingAll} onClick={() => void loadAll()} icon={icons.list}>Load all to reorder</Button>
          </Row>
        ))}
      {titles.isPending ? <Busy /> : items.length === 0 ? (!titles.error && <EmptyState title="No visible titles" />) : (
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
                    <Tip label="Move up"><IconButton aria-label={`Move ${t.title} up`} disabled={!canReorder || i === 0 || reorder.isPending} onClick={() => move(i, -1)}>↑</IconButton></Tip>
                    <Tip label="Move down"><IconButton aria-label={`Move ${t.title} down`} disabled={!canReorder || i === items.length - 1 || reorder.isPending} onClick={() => move(i, 1)}>↓</IconButton></Tip>
                    <Button size="sm" loading={remove.isPending && remove.variables === t.id} onClick={() => remove.mutate(t.id)} icon={icons.trash}>Remove</Button>
                  </Row>
                )}
              </Row>
            </Card>
          ))}
          {titles.hasNextPage && (
            <>
              <Text size="sm" tone="dim" data-testid="shelf-shown">Showing {items.length} of {total} titles</Text>
              <Button icon={icons.chevDown} loading={titles.isFetchingNextPage} onClick={() => void titles.fetchNextPage()}>Show more</Button>
            </>
          )}
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
