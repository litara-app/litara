import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { columnResizingFeature, columnSizingFeature, createColumnHelper, rowSortingFeature, tableFeatures, useTable, type SortingState } from "@tanstack/react-table";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { get } from "../api/client";
import type { Edition, Library, Page as Paged, Shelf, Title as TitleT, TitleRow } from "../api/types";
import {
  Badge, Busy, Button, Card, Cover, CoverTile, EmptyState, ErrorBox, formatLabel, Grow, Heading, icons, KeyValue, MenuButton, Page, PageHeader, Row,
  GridTable, IconAction, SearchField, SegmentedField, SelectField, SortHeader, Stack, TBody, TD, Text, TextLink, THead, Toolbar, TR,
  useColumnWidths, useVirtualRows, VirtualGrid, VirtualPad, when, type SortOrder,
} from "../ui";
import { useDebounced } from "../ui/useDebounced";
import { useTitleActions } from "./useTitleActions";
import { useShelfActions } from "./useShelves";
import { fetchListPage, LIST_SIZE, listKey, rememberList, type ListContext } from "./titleList";
import { FilterBuilder } from "./filter/FilterBuilder";
import { countWireRules, parseParam, stringifyParam, type WireFilter } from "./filter/filterTree";
import { useAuth } from "../auth/session";
import { coverMedium } from "./directories/directory";
import { AddPaperBook } from "./paper/AddPaperBook";

const SIZE = LIST_SIZE;
type TitleList = { shelves: Shelf[]; add: (shelf: Shelf, title: string) => void };

function counts(t: TitleT) {
  return (
    <Row gap="xs">
      {t.editionCount > 0 && <Badge>{t.editionCount} ebook{t.editionCount > 1 ? "s" : ""}</Badge>}
      {t.recordingCount > 0 && <Badge tone="audio">{t.recordingCount} audio</Badge>}
      {t.physicalCopyCount > 0 && <Badge tone="neutral">{t.physicalCopyCount} paper</Badge>}
    </Row>
  );
}

function AddToShelf({ t, shelves, add }: { t: TitleT } & TitleList) {
  if (shelves.length === 0) return null;
  return (
    <MenuButton label="Add to shelf" icon={icons.shelf} size="sm" variant="subtle" entries={shelves.map((s) => ({ value: s.id, label: s.data!.name }))}
      onAction={(id) => { const s = shelves.find((x) => x.id === id); if (s) add(s, t.id); }} />
  );
}

function Inspector({ t, list }: { t: TitleT; list: TitleList }) {
  return (
    <Card framed data-testid="inspector">
      <Stack>
        <div className="lt-inspector-cover"><Cover title={t.title || "(untitled)"} author={t.authors[0]} titleId={t.id} medium={coverMedium(t)} /></div>
        <Heading level={2} serif>{t.title || "(untitled)"}</Heading>
        <KeyValue items={[
          ["Authors", t.authors.join(", ") || "Unknown author"],
          ["Series", t.series.join(", ") || "None"],
          ["Languages", t.languages.join(", ") || "Unknown"],
          ["Content", counts(t)],
        ]} />
        <Row>
          <Button variant="primary" to={`/titles/${t.id}`} icon={icons.book}>Open title</Button>
          <AddToShelf t={t} {...list} />
        </Row>
      </Stack>
    </Card>
  );
}

/** One cover in the grid. Formats come from the title's editions (shared with the title page's cache). */
function LibraryTile({ t, list }: { t: TitleT; list: TitleList }) {
  const actions = useTitleActions();
  const eds = useQuery({ queryKey: ["title", t.id, "editions"], queryFn: () => get<Paged<Edition>>(`/editions?titleId=${t.id}&size=200`), staleTime: 60_000, enabled: t.editionCount > 0 });
  const menu = [
    ...(t.editionCount > 0 ? [{ value: "read", label: "Read" }] : []),
    ...(t.recordingCount > 0 ? [{ value: "listen", label: "Listen" }] : []),
    ...(t.editionCount > 0 || t.recordingCount > 0 ? [{ value: "download", label: "Download" }] : []),
    ...list.shelves.slice(0, 8).map((s) => ({ value: `shelf:${s.id}`, label: `Add to ${s.data!.name}` })),
  ];
  const onMenu = (v: string) => {
    if (v === "read") void actions.read(t.id);
    else if (v === "listen") void actions.listen(t.id);
    else if (v === "download") void actions.download(t.id);
    else { const s = list.shelves.find((x) => `shelf:${x.id}` === v); if (s) list.add(s, t.id); }
  };
  return (
    <CoverTile testId="title-item" titleId={t.id} medium={coverMedium(t)} to={`/titles/${t.id}`} title={t.title || "(untitled)"} author={t.authors.join(", ") || "Unknown author"}
      ebook={formatLabel((eds.data?.items ?? []).map((e) => e.file.format)) ?? (t.editionCount > 0 ? "EBOOK" : null)} audio={t.recordingCount > 0 ? "AUDIO" : null} paper={t.physicalCopyCount > 0}
      menu={menu} onMenu={onMenu} menuLabel={`More actions for ${t.title || "this title"}`} />
  );
}

/** Sort keys the server understands; a column with no key is not sortable. */
const COLUMN_SPECS: { id: string; label: string; width: number; sort?: string; num?: boolean }[] = [
  { id: "title", label: "Title", width: 300, sort: "title" },
  { id: "author", label: "Author", width: 180, sort: "author" },
  { id: "series", label: "Series", width: 170, sort: "series" },
  { id: "series_index", label: "#", width: 70, sort: "series_index", num: true },
  { id: "formats", label: "Formats", width: 140 },
  { id: "language", label: "Language", width: 110, sort: "language" },
  { id: "publisher", label: "Publisher", width: 160, sort: "publisher" },
  { id: "published", label: "Published", width: 120, sort: "published" },
  { id: "pages", label: "Pages", width: 90, sort: "pages", num: true },
  { id: "rating", label: "Rating", width: 130, sort: "rating", num: true },
  { id: "status", label: "Status", width: 130, sort: "status" },
  { id: "added", label: "Added", width: 130, sort: "added" },
  { id: "editions", label: "Content", width: 150, sort: "editions" },
  { id: "actions", label: "Actions", width: 70 },
];
/** Table rows are one fixed height so only the rows near the viewport need to be drawn (ADR-0084). */
const ROW_HEIGHT = 56;
const DEFAULT_WIDTHS = Object.fromEntries(COLUMN_SPECS.map((c) => [c.id, c.width]));
const NUMERIC = new Set(COLUMN_SPECS.filter((c) => c.num).map((c) => c.id));

// Behaviour comes from TanStack Table (ADR-0083). The server sorts and filters, so the table only reports state.
const features = tableFeatures({ rowSortingFeature, columnSizingFeature, columnResizingFeature });
const columnHelper = createColumnHelper<typeof features, TitleRow>();

const STATUS_LABEL = { unread: "Unread", reading: "Reading", finished: "Finished" } as const;

function cell(id: string, t: TitleRow, list: TitleList) {
  switch (id) {
    case "title":
      return (
        <Row>
          <span className="lt-thumb"><Cover tiny title={t.title || "(untitled)"} author={t.authors[0]} titleId={t.id} medium={coverMedium(t)} /></span>
          <TextLink to={`/titles/${t.id}`}>{t.title || "(untitled)"}</TextLink>
        </Row>
      );
    case "author": return t.authors.join(", ") || <Text as="span" tone="dim">Unknown</Text>;
    case "series": return t.series.join(", ") || <Text as="span" tone="dim">None</Text>;
    case "series_index": return t.seriesIndex ?? "";
    case "formats": return <Row gap="xs">{t.formats.map((f) => <Badge key={f} tone={f === "paper" ? "neutral" : undefined}>{f}</Badge>)}</Row>;
    case "language": return t.languages.join(", ");
    case "publisher": return t.publisher ?? "";
    case "published": return t.published ?? "";
    case "pages": return t.pageCount ?? "";
    case "rating": return t.ratingHalves ? `${(t.ratingHalves / 2).toFixed(1)} ★` : "";
    case "status": return <Badge tone={t.status === "finished" ? "success" : t.status === "reading" ? "warning" : "neutral"}>{STATUS_LABEL[t.status]}</Badge>;
    case "added": return when(t.addedAt);
    case "editions": return counts(t);
    case "actions": return <AddToShelf t={t} {...list} />;
    default: return "";
  }
}

export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const [addingPaper, setAddingPaper] = useState(false);
  const q = params.get("q") ?? "";
  const libraryId = params.get("libraryId") ?? "";
  const mediaKind = params.get("mediaKind") ?? "";
  const view = params.get("view") === "table" ? "table" : "grid";
  const sort = params.get("sort") ?? "title";
  const order: SortOrder = params.get("order") === "desc" ? "desc" : "asc";
  const applied = useMemo(() => parseParam(params.get("f")), [params]);
  const activeFilters = countWireRules(applied);
  const [showFilters, setShowFilters] = useState(activeFilters > 0);
  const { widths, setWidths, reset } = useColumnWidths("litara.library.columns", DEFAULT_WIDTHS);
  const [text, setText] = useState(q);
  const debounced = useDebounced(text, 300);
  const [selected, setSelected] = useState<string | null>(null);
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== "page" && k !== "view") n.delete("page");
    setParams(n, { replace: true });
  };
  const applyFilters = (w: WireFilter | null) => {
    const n = new URLSearchParams(params);
    if (w) n.set("f", stringifyParam(w));
    else n.delete("f");
    n.delete("page");
    setParams(n, { replace: true });
  };
  useEffect(() => {
    if (debounced !== q) set("q", debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  // The top bar search changes the URL; keep the field in step with it.
  useEffect(() => setText(q), [q]);

  const libs = useQuery({ queryKey: ["libraries"], queryFn: () => get<Paged<Library>>("/libraries?size=200") });
  const listCtx: ListContext = { q, libraryId, mediaKind, sort, order, applied: applied ?? null };
  useEffect(() => rememberList(listCtx)); // eslint-disable-line react-hooks/exhaustive-deps -- remembered so a title opened from here can step through this list
  const titles = useInfiniteQuery({
    queryKey: listKey(listCtx),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchListPage(listCtx, pageParam),
    getNextPageParam: (last, all) => (all.length * SIZE < last.total ? all.length : undefined),
  });
  // Endless scroll: fetch the next page when the marker below the list comes into view.
  const marker = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = titles;
  useEffect(() => {
    const el = marker.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage(); }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, titles.data]);
  const shelfActions = useShelfActions();
  const list: TitleList = { shelves: shelfActions.shelves, add: shelfActions.add };
  const items = titles.data?.pages.flatMap((p) => p.items) ?? [];
  const total = titles.data?.pages[0]?.total ?? 0;
  const current = items.find((t) => t.id === selected) ?? null;
  const columns = useMemo(() => columnHelper.columns(COLUMN_SPECS.map((c) => columnHelper.accessor((r) => r.id, { // the server does the sorting, so the accessor value is never compared
    id: c.id, header: c.label, size: c.width, minSize: 60, enableSorting: !!c.sort, enableResizing: c.id !== "actions",
    cell: (info) => cell(c.id, info.row.original, list),
  }))), [list]); // eslint-disable-line react-hooks/exhaustive-deps
  const sorting: SortingState = [{ id: sort, desc: order === "desc" }];
  const table = useTable({
    features, columns, data: items, getRowId: (r) => r.id,
    manualSorting: true, enableMultiSort: false, columnResizeMode: "onChange",
    state: { sorting, columnSizing: widths },
    onColumnSizingChange: setWidths,
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const n = new URLSearchParams(params);
      const head = next[0];
      // Clicking the sorted column again flips direction; there is no "unsorted" state.
      const spec = COLUMN_SPECS.find((c) => c.id === (head?.id ?? sort));
      n.set("sort", spec?.sort ?? "title");
      n.set("order", head ? (head.desc ? "desc" : "asc") : order === "asc" ? "desc" : "asc");
      n.delete("page");
      setParams(n, { replace: true });
    },
  });
  const rows = table.getRowModel().rows;
  const tableTop = useRef<HTMLDivElement>(null);
  const vrows = useVirtualRows(rows.length, ROW_HEIGHT, tableTop);
  const nudge = (id: string, delta: number) => setWidths((w) => ({ ...w, [id]: (w[id] ?? 120) + delta }));

  return (
    <Page>
      <PageHeader title="Library" actions={user?.isAdmin ? <><Button variant="subtle" icon={icons.files} to="/paper-imports">Import CSV</Button><Button icon={icons.plus} onClick={() => setAddingPaper(true)}>Add paper book</Button></> : undefined} />
      {addingPaper && <AddPaperBook libraryId={libraryId || undefined} onClose={() => setAddingPaper(false)} />}
      <Toolbar aria-label="Library filters">
        <Grow><SearchField label="Search" placeholder="Title, author or series" value={text} onValue={setText} /></Grow>
        <SelectField label="Library" clearable placeholder="All libraries" emptyText="No libraries yet" value={libraryId || null}
          items={(libs.data?.items ?? []).map((l) => ({ value: l.id, label: l.name }))} onValue={(v) => set("libraryId", v ?? "")} />
        <SelectField label="Type" clearable placeholder="Any" value={mediaKind || null}
          items={[{ value: "ebook", label: "Ebooks" }, { value: "audio", label: "Audiobooks" }]} onValue={(v) => set("mediaKind", v ?? "")} />
        <SegmentedField label="View" iconOnly value={view} onValue={(v) => set("view", v === "table" ? "table" : "")}
          items={[{ value: "grid", label: "Covers", icon: icons.grid }, { value: "table", label: "Table", icon: icons.table }]} />
        <Row gap="xs">
          <Button icon={icons.filter} aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>Filters</Button>
          {activeFilters > 0 && <Badge tone="warning">{activeFilters}</Badge>}
          {view === "table" && <IconAction label="Reset column widths" icon={icons.columns} onClick={reset} />}
        </Row>
      </Toolbar>
      {showFilters && <FilterBuilder applied={applied} libraries={libs.data?.items ?? []} onApply={applyFilters} />}
      <ErrorBox error={titles.error ?? shelfActions.error} />
      {titles.isPending ? <Busy /> : (
        <>
          <Text size="sm" tone="dim" data-testid="total">{total} {total === 1 ? "title" : "titles"}</Text>
          {items.length === 0 && <EmptyState title="No titles match">Change the filters, or add books to a library folder and run a scan.</EmptyState>}
          {(items.length > 0 || activeFilters > 0) && view === "table" && (
            <div className="lt-split" ref={tableTop}>
              <GridTable label="Titles" rowCount={total + 1} widths={Object.fromEntries(table.getAllLeafColumns().map((c) => [c.id, c.getSize()]))} order={table.getAllLeafColumns().map((c) => c.id)}>
                <THead>
                  {table.getHeaderGroups().map((hg) => (
                    <TR key={hg.id}>
                      {hg.headers.map((h) => (
                        <SortHeader key={h.id} label={String(h.column.columnDef.header)} num={NUMERIC.has(h.column.id)}
                          sorted={h.column.getIsSorted() || false}
                          onSort={h.column.getCanSort() ? (e) => h.column.getToggleSortingHandler()?.(e) : undefined}
                          onResizeStart={h.column.getCanResize() ? h.getResizeHandler() : undefined}
                          onResizeKey={h.column.getCanResize() ? (d) => nudge(h.column.id, d) : undefined} />
                      ))}
                    </TR>
                  ))}
                </THead>
                <TBody>
                  <VirtualPad height={vrows.top} columns={COLUMN_SPECS.length} />
                  {vrows.items.map((vi) => {
                    const row = rows[vi.index]!;
                    return (
                      <TR key={row.id} aria-rowindex={vi.index + 2} selected={row.original.id === selected} data-testid="title-item" onClick={() => setSelected(row.original.id)}>
                        {row.getAllCells().map((c) => <TD key={c.id} num={NUMERIC.has(c.column.id)}><table.FlexRender cell={c} /></TD>)}
                      </TR>
                    );
                  })}
                  <VirtualPad height={vrows.bottom} columns={COLUMN_SPECS.length} />
                </TBody>
              </GridTable>
              {current && <Inspector t={current} list={list} />}
            </div>
          )}
          {items.length > 0 && view === "grid" && (
            <VirtualGrid items={items} minWidth={150} getKey={(t) => t.id} render={(t) => <LibraryTile t={t} list={list} />} />
          )}
          <div ref={marker} data-testid="scroll-end">{isFetchingNextPage && <Busy />}</div>
        </>
      )}
    </Page>
  );
}
