import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { API, get } from "../../api/client";
import type { AnnotationHubItem, AnnotationHubTitle, Page as Paged } from "../../api/types";
import { icons, Busy, Button, EmptyState, ErrorBox, Grow, MenuButton, Page, PageHeader, SearchField, SegmentedField, SelectField, Stack, Text, Toolbar } from "../../ui";
import { useDebounced } from "../../ui/useDebounced";
import { AnnotationCard, useAnnotationEditing } from "./annotationEditing";

const SIZE = 50;
type Kind = "" | "highlight" | "note" | "bookmark";
const KINDS: { value: Kind; label: string }[] = [
  { value: "", label: "All" }, { value: "highlight", label: "Highlights" }, { value: "note", label: "Notes" }, { value: "bookmark", label: "Bookmarks" },
];

/** The filters as a query string, shared by the list and the export so a download holds what the page shows. */
export function hubQuery(q: string, kind: Kind, titleId: string): string {
  const p = new URLSearchParams();
  if (q.trim()) p.set("q", q.trim());
  if (kind) p.set("kind", kind);
  if (titleId) p.set("titleId", titleId);
  return p.toString();
}

/** A same-origin download: the browser session cookie authorizes it and the server names the file. */
function download(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Every highlight, note and bookmark the person has, across books, with search, filters and export (ADR-0099). */
export function AnnotationsPage() {
  const [text, setText] = useState("");
  const q = useDebounced(text, 300).slice(0, 200);
  const [kind, setKind] = useState<Kind>("");
  const [titleId, setTitleId] = useState("");
  const query = hubQuery(q, kind, titleId);
  const editing = useAnnotationEditing();

  const titles = useQuery({ queryKey: ["annotations", "hub", "titles"], queryFn: () => get<{ items: AnnotationHubTitle[] }>("/annotations/titles") });
  const list = useInfiniteQuery({
    queryKey: ["annotations", "hub", query],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => get<Paged<AnnotationHubItem>>(`/annotations?${query}${query ? "&" : ""}page=${pageParam}&size=${SIZE}`),
    getNextPageParam: (last, all) => (all.length * SIZE < last.total ? all.length : undefined),
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  const filtered = query !== "";
  const nothingAtAll = !filtered && total === 0;

  return (
    <Page>
      <PageHeader title="Annotations" description="Your highlights, notes and bookmarks from every book you can open. Only you can see them." />
      <Toolbar aria-label="Annotation filters">
        <Grow><SearchField label="Search annotations" placeholder="Note, quote, title or author" value={text} onValue={setText} /></Grow>
        <SelectField label="Book" clearable placeholder="All books" emptyText="No annotated books" value={titleId || null}
          items={(titles.data?.items ?? []).map((t) => ({ value: t.titleId, label: `${t.title} (${t.annotations})` }))} onValue={(v) => setTitleId(v ?? "")} />
        <SegmentedField label="Kind" value={kind || "all"} onValue={(v) => setKind(v === "all" ? "" : (v as Kind))}
          items={KINDS.map((k) => ({ value: k.value || "all", label: k.label }))} />
        <MenuButton label="Export" icon={icons.download}
          entries={[{ value: "markdown", label: "Markdown (.md)" }, { value: "csv", label: "CSV (.csv)" }, { value: "json", label: "JSON (.json)" }]}
          onAction={(format) => download(`${API}/annotations/export?${query}${query ? "&" : ""}format=${format}`)} />
      </Toolbar>
      <ErrorBox error={list.error ?? titles.error} />
      {list.isPending ? <Busy /> : (
        <Stack>
          <Text size="sm" tone="dim" data-testid="total">{total} {total === 1 ? "entry" : "entries"}{filtered ? (total === 1 ? " matches" : " match") : ""}</Text>
          {items.length === 0 && (nothingAtAll
            ? <EmptyState title="No annotations yet">Select text while reading to highlight it or add a note. Bookmarks appear here too.</EmptyState>
            : <EmptyState title="Nothing matches">Change the search or the filters.</EmptyState>)}
          {items.map((it) => (
            <AnnotationCard key={it.annotation.id} editing={editing} a={it.annotation} source={it.editionLabel || it.format.toUpperCase()}
              book={{ title: it.title, to: `/titles/${it.titleId}`, authors: it.authors }} readerTo={`/read/${it.annotation.editionId}`}
              onEdit={() => editing.edit(it.annotation)} onRemove={() => editing.remove(it.annotation)} />
          ))}
          {list.hasNextPage && (
            <Button icon={icons.chevDown} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Show more</Button>
          )}
        </Stack>
      )}
      {editing.dialogs}
    </Page>
  );
}
