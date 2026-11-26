import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useParams } from "react-router";
import { get, qs } from "../../api/client";
import type { TitleRow } from "../../api/types";
import {
  icons, AuthorCard, Busy, Button, CardGrid, CoverFan, CoverLink, EmptyState, ErrorBox, Grow, Heading, IconAction, MissingBook, OrderGrid, OrderItem, Page, PageHeader,
  Panel, Portrait, Row, SearchField, SegmentedField, SelectField, SeriesCard, Shelf, ShelfItem, Stack, Text, TextLink, Toolbar,
} from "../../ui";
import { useDebounced } from "../../ui/useDebounced";
import { useTitleActions } from "../useTitleActions";
import { authorPath, bookNumber, coverMedium, formatsLine, groupBySeries, missingNumbers, seriesPath, titlesBy } from "./directory";
import {
  rememberDirectory, useDirectory, useDirectoryNeighbours, type DirectoryAuthor, type DirectoryContext, type DirectoryPath, type DirectorySeries,
} from "./directoryList";

const books = (n: number) => `${n} ${n === 1 ? "book" : "books"}`;
/** Past this many gaps the series page names them in a sentence instead of drawing a place for each. */
const MAX_GAPS = 12;

/** A searchable, paged directory: the authors or the series of the titles the viewer can see (ADR-0100). */
function Directory<T extends { name: string }>({ path, title, description, placeholder, empty, sorts, kind, tile }: {
  path: DirectoryPath; title: string; description: string; placeholder: string; empty: string; kind: "authors" | "series";
  sorts?: { value: string; label: string }[]; tile: (item: T) => React.ReactNode;
}) {
  const [text, setText] = useState("");
  const [sort, setSort] = useState("name");
  const q = useDebounced(text, 300).trim().slice(0, 200);
  const ctx: DirectoryContext = { q, sort };
  const list = useDirectory<T>(path, ctx);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  return (
    <Page>
      <PageHeader title={title} description={description} />
      <Toolbar aria-label={`${title} search`}>
        <Grow><SearchField label={`Search ${title.toLowerCase()}`} placeholder={placeholder} value={text} onValue={setText} /></Grow>
        {sorts && <SelectField label="Sort" items={sorts} value={sort} onValue={(v) => setSort(v ?? "name")} />}
      </Toolbar>
      <ErrorBox error={list.error} />
      {list.isPending ? <Busy /> : (
        <Stack>
          <Text size="sm" tone="dim" data-testid="total">{total} {title.toLowerCase().replace(/s$/, total === 1 ? "" : "s")}</Text>
          {items.length === 0 && <EmptyState title={q ? "Nothing matches" : empty}>{q ? "Try another search." : "Titles appear here once a library you can open has them."}</EmptyState>}
          <div onClickCapture={() => rememberDirectory(path, ctx)}><CardGrid kind={kind}>{items.map(tile)}</CardGrid></div>
          {list.hasNextPage && <Button icon={icons.chevDown} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Show more</Button>}
        </Stack>
      )}
    </Page>
  );
}

export function AuthorsPage() {
  return (
    <Directory<DirectoryAuthor> path="/authors" kind="authors" title="Authors" placeholder="Author name" empty="No authors yet"
      description="Everyone who wrote a book you can open. Names that differ only in capital letters count as one author."
      tile={(a) => <AuthorCard key={a.name.toLowerCase()} testId="directory-item" to={authorPath(a.name)} name={a.name} books={a.titles}
        detail={a.seriesCount > 0 ? `${a.seriesCount} series` : "No series"} />} />
  );
}

export function SeriesListPage() {
  return (
    <Directory<DirectorySeries> path="/series" kind="series" title="Series" placeholder="Series name" empty="No series yet"
      description="Every series among the books you can open. Each opens in reading order."
      sorts={[{ value: "name", label: "Name, A to Z" }, { value: "titles", label: "Most books" }]}
      tile={(s) => <SeriesCard key={s.name.toLowerCase()} testId="directory-item" to={seriesPath(s.name)} name={s.name} books={s.titles}
        authors={s.authors.join(", ")} finished={s.finished} covers={s.covers} />} />
  );
}

function BookTile({ t, number }: { t: TitleRow; number?: boolean }) {
  const label = number && t.seriesIndex !== null ? `${bookNumber(t.seriesIndex)} ${t.title}` : t.title;
  const status = t.status === "finished" ? "Finished" : t.status === "reading" ? "Reading" : "";
  return <CoverLink testId="book-item" to={`/titles/${t.id}`} name={label || "(untitled)"} detail={[formatsLine(t), status].filter(Boolean).join(" · ")}
    title={t.title} author={t.authors[0]} titleId={t.id} medium={coverMedium(t)} />;
}

interface ContinueTarget { titleId: string | null; title: string | null; medium: "ebook" | "audio" | null; state: "reading" | "unread" | null }

/** Opens the unfinished book used most recently, or else the first unread one (ADR-0104). */
function ContinueButton({ by, name }: { by: "author" | "series"; name: string }) {
  const actions = useTitleActions();
  const next = useQuery({ queryKey: ["titles", "continue", by, name.toLowerCase()], queryFn: () => get<ContinueTarget>(`/continue-reading${qs({ by, name })}`) });
  if (next.error) return <ErrorBox error={next.error} />;
  const target = next.data;
  if (!target) return <Button block disabled icon={icons.bookOpen}>Continue reading</Button>;
  if (!target.titleId) return <Text size="sm" tone="dim" data-testid="all-finished">You have finished every book here.</Text>;
  const audio = target.medium === "audio";
  const verb = `${target.state === "reading" ? "Continue" : "Start"} ${audio ? "listening" : "reading"}`;
  const id = target.titleId;
  return (
    <Stack gap="xs">
      <Button variant="primary" block icon={audio ? icons.headphones : icons.bookOpen} onClick={() => void (audio ? actions.listen(id) : actions.read(id))}>{verb}</Button>
      <Text size="sm" tone="dim" data-testid="continue-title">{target.title}</Text>
    </Stack>
  );
}

/** The bar above an author or series page, laid out as on a title page: back on the left, previous and next on the right. */
function FolioBar({ path, back, name, pathTo }: { path: DirectoryPath; back: string; name: string; pathTo: (n: string) => string }) {
  const neighbours = useDirectoryNeighbours(path, name);
  return (
    <div className="lt-folio-bar">
      <Button variant="subtle" size="sm" to={path} icon={icons.arrowLeft}>{back}</Button>
      {neighbours && (
        <nav className="lt-folio-nav" aria-label={`Move between ${back.toLowerCase()}`}>
          <IconAction label="Previous" icon={icons.chevLeft} to={neighbours.prev ? pathTo(neighbours.prev) : undefined} disabled={!neighbours.prev} />
          <span className="lt-folio-count" data-testid="directory-position">{neighbours.position} / {neighbours.total}</span>
          <IconAction label="Next" icon={icons.chevRight} to={neighbours.next ? pathTo(neighbours.next) : undefined} disabled={!neighbours.next} />
        </nav>
      )}
    </div>
  );
}

/** An author's books on a shelf, grouped by series in reading order, with one filter per group. */
function AuthorShelf({ groups, total }: { groups: ReturnType<typeof groupBySeries>; total: number }) {
  const [filter, setFilter] = useState("all");
  const shelf = useRef<HTMLDivElement>(null);
  const keyOf = (s: string | null) => (s === null ? "none" : `series:${s.toLowerCase()}`);
  const shown = groups.filter((g) => filter === "all" || keyOf(g.series) === filter);
  const scroll = (way: number) => shelf.current?.scrollBy?.({ left: way * shelf.current.clientWidth * 0.8, behavior: "smooth" });
  return (
    <Panel title="On the shelf">
      <Stack gap="sm">
        <Row justify="between" wrap>
          <div className="lt-shelf-filter">
            {groups.length > 1 && (
              <SegmentedField label="Show" value={filter} onValue={(v) => { setFilter(v); shelf.current?.scrollTo?.({ left: 0 }); }}
                items={[{ value: "all", label: `All ${total}` }, ...groups.map((g) => ({ value: keyOf(g.series), label: g.series ?? "No series" }))]} />
            )}
          </div>
          <Row gap="xs">
            <IconAction label="Scroll the shelf left" icon={icons.chevLeft} onClick={() => scroll(-1)} />
            <IconAction label="Scroll the shelf right" icon={icons.chevRight} onClick={() => scroll(1)} />
          </Row>
        </Row>
        <Shelf label="Books" shelfRef={shelf}>
          {shown.flatMap((g) => g.titles.map((t) => <ShelfItem key={t.id}><BookTile t={t} number={!!g.series} /></ShelfItem>))}
        </Shelf>
      </Stack>
    </Panel>
  );
}

/** One author: portrait and what to read next, their works by series, and their books on a shelf. */
export function AuthorPage() {
  const name = useParams().name ?? "";
  const titles = useQuery({ queryKey: ["titles", "by-author", name.toLowerCase()], queryFn: () => titlesBy("author", name) });
  const rows = titles.data ?? [];
  const shown = rows.flatMap((t) => t.authors).find((a) => a.toLowerCase() === name.toLowerCase()) ?? name;
  const groups = groupBySeries(rows);
  return (
    <Page>
      <div className="lt-folio">
        <FolioBar path="/authors" back="Authors" name={name} pathTo={authorPath} />
        <div className="lt-folio-body">
          <aside className="lt-folio-side" aria-label="Portrait and actions">
            <Portrait name={shown} />
            {rows.length > 0 && <ContinueButton key={name.toLowerCase()} by="author" name={name} />}
          </aside>
          <div className="lt-folio-main">
            <header className="lt-folio-head">
              <Heading level={1} serif>{shown}</Heading>
              {titles.data && <Text tone="dim" size="lg">{books(rows.length)} you can open</Text>}
            </header>
            <ErrorBox error={titles.error} />
            {titles.isPending ? <Busy /> : rows.length === 0 ? <EmptyState title="No books by this author">None of the libraries you can open has a book by {name}.</EmptyState> : (
              <Panel title="Works">
                <ul className="lt-contents">
                  {groups.map((g) => (
                    <li key={g.series ?? "-"} data-testid="author-group">
                      {g.series ? <TextLink to={seriesPath(g.series)}>{g.series}</TextLink> : <span>No series</span>}
                      <i aria-hidden="true" />
                      <span>{books(g.titles.length)}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        </div>
        {rows.length > 0 && <div className="lt-folio-wide"><AuthorShelf key={name.toLowerCase()} groups={groups} total={rows.length} /></div>}
      </div>
    </Page>
  );
}

/** The reading order: the books as the server ordered them, with each missing whole number in its place. */
function orderOf(rows: TitleRow[], gaps: number[]): ({ gap: number } | { book: TitleRow })[] {
  const out: ({ gap: number } | { book: TitleRow })[] = [];
  const left = [...gaps];
  for (const t of rows) {
    while (left.length > 0 && (t.seriesIndex === null || left[0]! < t.seriesIndex)) out.push({ gap: left.shift()! });
    out.push({ book: t });
  }
  return out;
}

/** One series in reading order, with the whole numbers no book has. */
export function SeriesPage() {
  const name = useParams().name ?? "";
  const titles = useQuery({ queryKey: ["titles", "by-series", name.toLowerCase()], queryFn: () => titlesBy("series", name) });
  const rows = titles.data ?? [];
  const shown = rows[0]?.series[0] ?? name;
  const authors = [...new Map(rows.flatMap((t) => t.authors).map((a) => [a.toLowerCase(), a])).values()];
  const missing = missingNumbers(rows.map((t) => t.seriesIndex));
  const drawGaps = missing.length <= MAX_GAPS;
  const finished = rows.filter((t) => t.status === "finished").length;
  return (
    <Page>
      <div className="lt-folio">
        <FolioBar path="/series" back="Series" name={name} pathTo={seriesPath} />
        <div className="lt-folio-body">
          <aside className="lt-folio-side" aria-label="Covers and actions">
            <div className="lt-folio-fan">
              <CoverFan open author={authors[0]} covers={rows.slice(0, 5).map((t) => ({ titleId: t.id, title: t.title, medium: coverMedium(t) }))} />
            </div>
            {rows.length > 0 && <ContinueButton key={name.toLowerCase()} by="series" name={name} />}
          </aside>
          <div className="lt-folio-main">
            <header className="lt-folio-head">
              <Heading level={1} serif>{shown}</Heading>
              {authors.length > 0 && (
                <Text tone="dim" size="lg">by {authors.map((a, i) => <span key={a}>{i > 0 && ", "}<TextLink to={authorPath(a)}>{a}</TextLink></span>)}</Text>
              )}
            </header>
            <ErrorBox error={titles.error} />
            {titles.isPending ? <Busy /> : rows.length === 0 ? <EmptyState title="No books in this series">None of the libraries you can open has a book in {name}.</EmptyState> : (
              <Panel title="Progress">
                <Text data-testid="progress">{books(rows.length)} you can open, {finished} finished.</Text>
              </Panel>
            )}
          </div>
        </div>
        {rows.length > 0 && (
          <div className="lt-folio-wide">
            <Panel title="Reading order">
              <Stack gap="sm">
                {!drawGaps && <Text size="sm" tone="dim" data-testid="missing">Not in your libraries: books {missing.map((n) => `#${n}`).join(", ")}.</Text>}
                <OrderGrid>
                  {orderOf(rows, drawGaps ? missing : []).map((item) => "gap" in item
                    ? <OrderItem key={`gap-${item.gap}`} label={`Book ${item.gap}`}><MissingBook number={item.gap} /></OrderItem>
                    : <OrderItem key={item.book.id} label={item.book.seriesIndex === null ? "Unnumbered" : `Book ${item.book.seriesIndex}`}><BookTile t={item.book} /></OrderItem>)}
                </OrderGrid>
              </Stack>
            </Panel>
          </div>
        )}
      </div>
    </Page>
  );
}
