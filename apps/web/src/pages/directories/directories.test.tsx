import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Title, TitleRow } from "../../api/types";
import { AuthorPage, AuthorsPage, SeriesPage } from "./DirectoryPages";
import { RelatedRows } from "./RelatedRows";
import { groupBySeries, missingNumbers } from "./directory";

const row = (id: string, title: string, series: string | null, index: number | null, authors = ["Ada Author"]): TitleRow => ({
  id, title, authors, series: series ? [series] : [], languages: [], editionCount: 1, recordingCount: 0,
  libraryIds: [], formats: ["epub"], addedAt: "", seriesIndex: index, publisher: null, published: null, pageCount: null, ratingHalves: null, status: "unread",
});
const SAGA = [row("1", "First", "The Saga", 1), row("4", "Fourth", "the saga", 4), row("2", "Second", "The Saga", 2)];
const LOOSE = [row("9", "Alone", null, null), row("5", "Bridge", "Other", 1)];

const api = vi.fn(async (_m: string, _p: string, body: { filter: { field: string; value: string[] } }): Promise<unknown> => {
  const items = body.filter.field === "series" ? SAGA : [...SAGA, ...LOOSE];
  return { items, total: items.length, page: 0, size: 200 };
});
const get = vi.fn(async (_p: string): Promise<unknown> => ({ items: [{ name: "Ada Author", titles: 5, coverTitleId: "1" }], total: 1, page: 0, size: 60 }));
vi.mock("../../api/client", async (orig) => ({
  ...(await orig<object>()), api: (m: string, p: string, b: never) => api(m, p, b), get: (p: string) => get(p),
}));
beforeEach(() => { api.mockClear(); get.mockClear(); });
afterEach(cleanup);

const at = (path: string, route: string, el: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={el} /></Routes></MemoryRouter></QueryClientProvider>,
);

test("series order, grouping and missing numbers follow ADR-0100", () => {
  expect(missingNumbers([1, 2, 4, null])).toEqual([3]);
  expect(missingNumbers([2.5, 1])).toEqual([]);
  expect(missingNumbers([null])).toEqual([]);
  const groups = groupBySeries([...SAGA, ...LOOSE]);
  expect(groups.map((g) => g.series)).toEqual(["Other", "The Saga", null]); // series by name, then books in no series
  expect(groups[1]!.titles.map((t) => t.title)).toEqual(["First", "Second", "Fourth"]); // one series despite the case
});

test("the authors directory links each author to their page", async () => {
  at("/authors", "/authors", <AuthorsPage />);
  const item = await screen.findByTestId("directory-item");
  expect(get).toHaveBeenCalledWith("/authors?page=0&size=60");
  expect(item.getAttribute("href")).toBe("/authors/Ada%20Author");
  expect(item.textContent).toContain("5 books");
});

test("an author page asks for that author and groups the books by series", async () => {
  at("/authors/Ada%20Author", "/authors/:name", <AuthorPage />);
  const groups = await screen.findAllByTestId("author-group");
  expect(api).toHaveBeenCalledWith("POST", "/titles/search", expect.objectContaining({ filter: { type: "rule", field: "author", operator: "is", value: ["Ada Author"] } }));
  expect(groups.map((g) => within(g).getByRole("heading").textContent)).toEqual(["Other", "The Saga", "Other books"]);
  expect(within(groups[1]!).getAllByTestId("book-item").map((b) => b.textContent)).toEqual(
    [expect.stringContaining("#1 First"), expect.stringContaining("#2 Second"), expect.stringContaining("#4 Fourth")]);
});

test("a series page is in reading order and names the missing books", async () => {
  at("/series/The%20Saga", "/series/:name", <SeriesPage />);
  const books = await screen.findAllByTestId("book-item");
  expect(api).toHaveBeenCalledWith("POST", "/titles/search", expect.objectContaining({ sort: "series_index", filter: expect.objectContaining({ field: "series", value: ["The Saga"] }) }));
  expect(books.map((b) => b.getAttribute("href"))).toEqual(["/titles/1", "/titles/4", "/titles/2"]); // the server's order is kept
  expect(screen.getByTestId("missing").textContent).toContain("#3");
});

test("the title page rows leave out the open title and hide when nothing else is there", async () => {
  const t: Title = { id: "2", title: "Second", authors: ["Ada Author"], series: ["The Saga"], languages: [], editionCount: 1, recordingCount: 0 };
  at("/titles/2", "/titles/:id", <RelatedRows title={t} />);
  const series = await screen.findByTestId("related-series");
  expect(within(series).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/titles/1", "/titles/4"]);
  const author = await screen.findByTestId("related-author");
  expect(within(author).queryByRole("link", { name: /Second/ })).toBeNull();
  cleanup();

  api.mockImplementation(async () => ({ items: [row("2", "Second", "The Saga", 2)], total: 1, page: 0, size: 200 }));
  at("/titles/2", "/titles/:id", <RelatedRows title={t} />);
  await vi.waitFor(() => expect(api).toHaveBeenCalled());
  expect(screen.queryByTestId("related-series")).toBeNull();
  expect(screen.queryByTestId("related-author")).toBeNull();
});
