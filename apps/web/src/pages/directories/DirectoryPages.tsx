import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { get, qs } from "../../api/client";
import type { Page as Paged, TitleRow } from "../../api/types";
import { icons, Busy, Button, CoverLink, EmptyState, ErrorBox, Grid, Grow, Heading, Page, PageHeader, SearchField, Stack, Text, TextLink, Toolbar } from "../../ui";
import { useDebounced } from "../../ui/useDebounced";
import { authorPath, bookNumber, coverMedium, formatsLine, groupBySeries, missingNumbers, seriesPath, titlesBy } from "./directory";

const SIZE = 60;
export interface DirectoryAuthor { name: string; titles: number; coverTitleId: string }
export interface DirectorySeries { name: string; titles: number; coverTitleId: string; authors: string[] }

const books = (n: number) => `${n} ${n === 1 ? "book" : "books"}`;

/** A searchable, paged directory: the authors or the series of the titles the viewer can see (ADR-0100). */
function Directory<T extends { name: string }>({ path, title, description, placeholder, empty, tile }: {
  path: "/authors" | "/series"; title: string; description: string; placeholder: string; empty: string; tile: (item: T) => React.ReactNode;
}) {
  const [text, setText] = useState("");
  const q = useDebounced(text, 300).trim().slice(0, 200);
  const list = useInfiniteQuery({
    queryKey: ["directory", path, q],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => get<Paged<T>>(`${path}${qs({ q, page: pageParam, size: SIZE })}`),
    getNextPageParam: (last, all) => (all.length * SIZE < last.total ? all.length : undefined),
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  return (
    <Page>
      <PageHeader title={title} description={description} />
      <Toolbar aria-label={`${title} search`}>
        <Grow><SearchField label={`Search ${title.toLowerCase()}`} placeholder={placeholder} value={text} onValue={setText} /></Grow>
      </Toolbar>
      <ErrorBox error={list.error} />
      {list.isPending ? <Busy /> : (
        <Stack>
          <Text size="sm" tone="dim" data-testid="total">{total} {title.toLowerCase().replace(/s$/, total === 1 ? "" : "s")}</Text>
          {items.length === 0 && <EmptyState title={q ? "Nothing matches" : empty}>{q ? "Try another search." : "Titles appear here once a library you can open has them."}</EmptyState>}
          <Grid min="sm" gap="md">{items.map(tile)}</Grid>
          {list.hasNextPage && <Button icon={icons.chevDown} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Show more</Button>}
        </Stack>
      )}
    </Page>
  );
}

export function AuthorsPage() {
  return (
    <Directory<DirectoryAuthor> path="/authors" title="Authors" placeholder="Author name" empty="No authors yet"
      description="Everyone who wrote a book you can open. Names that differ only in capital letters count as one author."
      tile={(a) => <CoverLink key={a.name.toLowerCase()} testId="directory-item" to={authorPath(a.name)} name={a.name} detail={books(a.titles)} title={a.name} author={a.name} titleId={a.coverTitleId} />} />
  );
}

export function SeriesListPage() {
  return (
    <Directory<DirectorySeries> path="/series" title="Series" placeholder="Series name" empty="No series yet"
      description="Every series among the books you can open. Each opens in reading order."
      tile={(s) => <CoverLink key={s.name.toLowerCase()} testId="directory-item" to={seriesPath(s.name)} name={s.name}
        detail={[books(s.titles), s.authors.join(", ")].filter(Boolean).join(" · ")} title={s.name} author={s.authors[0]} titleId={s.coverTitleId} />} />
  );
}

function BookTile({ t, number }: { t: TitleRow; number?: boolean }) {
  const label = number && t.seriesIndex !== null ? `${bookNumber(t.seriesIndex)} ${t.title}` : t.title;
  return <CoverLink testId="book-item" to={`/titles/${t.id}`} name={label || "(untitled)"} detail={formatsLine(t)} title={t.title} author={t.authors[0]} titleId={t.id} medium={coverMedium(t)} />;
}

/** One author's books, grouped by series in reading order, then the books in no series. */
export function AuthorPage() {
  const name = useParams().name ?? "";
  const titles = useQuery({ queryKey: ["titles", "by-author", name.toLowerCase()], queryFn: () => titlesBy("author", name) });
  const rows = titles.data ?? [];
  const shown = rows.flatMap((t) => t.authors).find((a) => a.toLowerCase() === name.toLowerCase()) ?? name;
  const groups = groupBySeries(rows);
  return (
    <Page>
      <PageHeader title={shown} description={titles.data ? `${books(rows.length)} you can open.` : undefined}
        actions={<Button icon={icons.arrowLeft} to="/authors" size="sm">All authors</Button>} />
      <ErrorBox error={titles.error} />
      {titles.isPending ? <Busy /> : rows.length === 0 ? <EmptyState title="No books by this author">None of the libraries you can open has a book by {name}.</EmptyState> : (
        <Stack gap="lg">
          {groups.map((g) => (
            <section key={g.series ?? "-"} aria-label={g.series ?? "Other books"} data-testid="author-group">
              <Stack gap="sm">
                <Heading level={2}>{g.series ? <TextLink to={seriesPath(g.series)}>{g.series}</TextLink> : groups.length > 1 ? "Other books" : "Books"}</Heading>
                <Grid min="sm" gap="md">{g.titles.map((t) => <BookTile key={t.id} t={t} number={!!g.series} />)}</Grid>
              </Stack>
            </section>
          ))}
        </Stack>
      )}
    </Page>
  );
}

/** One series in reading order, with the whole numbers no book has. */
export function SeriesPage() {
  const name = useParams().name ?? "";
  const titles = useQuery({ queryKey: ["titles", "by-series", name.toLowerCase()], queryFn: () => titlesBy("series", name) });
  const rows = titles.data ?? [];
  const shown = rows[0]?.series[0] ?? name;
  const authors = [...new Map(rows.flatMap((t) => t.authors).map((a) => [a.toLowerCase(), a])).values()];
  const missing = missingNumbers(rows.map((t) => t.seriesIndex));
  return (
    <Page>
      <PageHeader title={shown} description={titles.data ? `${books(rows.length)} you can open.` : undefined}
        actions={<Button icon={icons.arrowLeft} to="/series" size="sm">All series</Button>} />
      <ErrorBox error={titles.error} />
      {titles.isPending ? <Busy /> : rows.length === 0 ? <EmptyState title="No books in this series">None of the libraries you can open has a book in {name}.</EmptyState> : (
        <Stack>
          {authors.length > 0 && (
            <Text>By {authors.map((a, i) => <span key={a}>{i > 0 && ", "}<TextLink to={authorPath(a)}>{a}</TextLink></span>)}</Text>
          )}
          {missing.length > 0 && (
            <Text size="sm" tone="dim" data-testid="missing">
              Not in your libraries: {missing.length === 1 ? "book" : "books"} {missing.map((n) => `#${n}`).join(", ")}.
            </Text>
          )}
          <Grid min="sm" gap="md">{rows.map((t) => <BookTile key={t.id} t={t} number />)}</Grid>
        </Stack>
      )}
    </Page>
  );
}
