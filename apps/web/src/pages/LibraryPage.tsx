import { Badge, Button, Card, Group, Menu, Pagination, Select, SimpleGrid, Stack, Text, TextInput, Title } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api, get, op, qs } from "../api/client";
import type { Library, Page, Shelf, Title as TitleT } from "../api/types";
import { Busy, ErrorBox } from "../ui/common";

const SIZE = 24;

export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const libraryId = params.get("libraryId") ?? "";
  const mediaKind = params.get("mediaKind") ?? "";
  const page = Number(params.get("page") ?? "0") || 0;
  const [text, setText] = useState(q);
  const [debounced] = useDebouncedValue(text, 300);
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== "page") n.delete("page");
    setParams(n, { replace: true });
  };
  useEffect(() => {
    if (debounced !== q) set("q", debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const libs = useQuery({ queryKey: ["libraries"], queryFn: () => get<Page<Library>>("/libraries?size=200") });
  const titles = useQuery({
    queryKey: ["titles", q, libraryId, mediaKind, page],
    queryFn: () => get<Page<TitleT>>(`/titles${qs({ q, libraryId, mediaKind, page, size: SIZE })}`),
    placeholderData: (p) => p,
  });
  const shelves = useQuery({ queryKey: ["shelves", "mine"], queryFn: () => get<Page<Shelf>>("/shelves?scope=mine&size=200") });
  const qc = useQueryClient();
  const add = useMutation({
    mutationFn: ({ shelf, title }: { shelf: Shelf; title: string }) => api<Shelf>("PUT", `/shelves/${shelf.id}/titles/${title}`, op(shelf.revision)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["shelves"] }),
  });
  const manual = (shelves.data?.items ?? []).filter((s) => !s.deleted && s.canEdit && s.data?.kind === "manual");

  return (
    <Stack>
      <Title order={2}>Library</Title>
      <Group align="flex-end">
        <TextInput label="Search" placeholder="Title, author or series" value={text} onChange={(e) => setText(e.currentTarget.value)} style={{ flex: 1, minWidth: 200 }} />
        <Select label="Library" clearable placeholder="All libraries" value={libraryId || null}
          data={(libs.data?.items ?? []).map((l) => ({ value: l.id, label: l.name }))} onChange={(v) => set("libraryId", v ?? "")} />
        <Select label="Type" clearable placeholder="Any" value={mediaKind || null}
          data={[{ value: "ebook", label: "Ebooks" }, { value: "audio", label: "Audiobooks" }]} onChange={(v) => set("mediaKind", v ?? "")} />
      </Group>
      <ErrorBox error={titles.error ?? add.error} />
      {titles.isPending ? (
        <Busy />
      ) : (
        <>
          <Text size="sm" c="dimmed" data-testid="total">{titles.data!.total} {titles.data!.total === 1 ? "title" : "titles"}</Text>
          {titles.data!.items.length === 0 && <Text>No titles match.</Text>}
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
            {titles.data!.items.map((t) => (
              <Card key={t.id} withBorder data-testid="title-card">
                <Text fw={600} component={Link} to={`/titles/${t.id}`} lineClamp={2}>{t.title || "(untitled)"}</Text>
                <Text size="sm" c="dimmed">{t.authors.join(", ") || "Unknown author"}</Text>
                {t.series.length > 0 && <Text size="xs" c="dimmed">{t.series.join(", ")}</Text>}
                <Group gap="xs" mt="xs" justify="space-between">
                  <Group gap="xs">
                    {t.editionCount > 0 && <Badge variant="light">{t.editionCount} ebook{t.editionCount > 1 ? "s" : ""}</Badge>}
                    {t.recordingCount > 0 && <Badge variant="light" color="grape">{t.recordingCount} audio</Badge>}
                  </Group>
                  {manual.length > 0 && (
                    <Menu>
                      <Menu.Target><Button size="compact-xs" variant="subtle">Add to shelf</Button></Menu.Target>
                      <Menu.Dropdown>
                        {manual.map((s) => <Menu.Item key={s.id} onClick={() => add.mutate({ shelf: s, title: t.id })}>{s.data!.name}</Menu.Item>)}
                      </Menu.Dropdown>
                    </Menu>
                  )}
                </Group>
              </Card>
            ))}
          </SimpleGrid>
          {titles.data!.total > SIZE && (
            <Pagination total={Math.ceil(titles.data!.total / SIZE)} value={page + 1} onChange={(p) => set("page", String(p - 1))}
              getControlProps={(c) => ({ "aria-label": { first: "First page", previous: "Previous page", next: "Next page", last: "Last page" }[c] })}
              getItemProps={(p) => ({ "aria-label": `Page ${p}` })} />
          )}
        </>
      )}
    </Stack>
  );
}
