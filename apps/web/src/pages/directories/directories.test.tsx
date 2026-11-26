import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Title, TitleRow } from "../../api/types";
import { initials } from "../../ui/people";
import { AuthorPage, AuthorsPage, SeriesListPage, SeriesPage } from "./DirectoryPages";
import { RelatedRows } from "./RelatedRows";
import { groupBySeries, missingNumbers } from "./directory";

const row = (id: string, title: string, series: string | null, index: number | null, authors = ["Ada Author"]): TitleRow => ({
  id, title, authors, series: series ? [series] : [], languages: [], editionCount: 1, recordingCount: 0,
  libraryIds: [], formats: ["epub"], addedAt: "", seriesIndex: index, publisher: null, published: null, pageCount: null, ratingHalves: null, status: "unread",
});
const SAGA = [row("1", "First", "The Saga", 1), row("4", "Fourth", "the saga", 4), row("2", "Second", "The Saga", 2)];
const LOOSE = [row("9", "Alone", null, null), row("5", "Bridge", "Other", 1)];

const search = async (_m: string, _p: string, body: { filter: { field: string; value: string[] } }): Promise<unknown> => {
  const items = body.filter.field === "series" ? SAGA : [...SAGA, ...LOOSE];
  return { items, total: items.length, page: 0, size: 200 };
};
const api = vi.fn(search);
let next: unknown = { titleId: "2", title: "Second", medium: "ebook", state: "reading" };
const responses = async (p: string): Promise<unknown> => {
  if (p.startsWith("/continue-reading")) return next;
  if (p.startsWith("/series")) {
    return { items: [{ name: "The Saga", titles: 3, coverTitleId: "1", authors: ["Ada Author"], finished: 1, covers: [{ titleId: "1", title: "First", medium: "ebook" }, { titleId: "2", title: "Second", medium: "audio" }] }], total: 1, page: 0, size: 60 };
  }
  return { items: ["Ada Author", "Bo Writer", "Cy Panel"].map((name) => ({ name, titles: 5, coverTitleId: "1", seriesCount: name === "Cy Panel" ? 0 : 2 })), total: 3, page: 0, size: 60 };
};
const get = vi.fn(responses);
vi.mock("../../api/client", async (orig) => ({
  ...(await orig<object>()), api: (m: string, p: string, b: never) => api(m, p, b), get: (p: string) => get(p),
}));
const read = vi.fn(async (_id: string) => {});
const listen = vi.fn(async (_id: string) => {});
vi.mock("../useTitleActions", () => ({ useTitleActions: () => ({ read, listen, download: vi.fn() }) }));
beforeEach(() => {
  api.mockClear(); api.mockImplementation(search); get.mockClear(); read.mockClear(); listen.mockClear(); sessionStorage.clear();
  next = { titleId: "2", title: "Second", medium: "ebook", state: "reading" };
});
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

test("initials stand in for a photo", () => {
  expect(initials("R. T. Marlowe")).toBe("RTM");
  expect(initials("  ursula k. le guin ")).toBe("UKL");
  expect(initials("")).toBe("");
});

test("the authors directory shows a card per author with initials, books and series", async () => {
  at("/authors", "/authors", <AuthorsPage />);
  const items = await screen.findAllByTestId("directory-item");
  expect(get).toHaveBeenCalledWith("/authors?page=0&size=60");
  expect(items[0]!.getAttribute("href")).toBe("/authors/Ada%20Author");
  expect(items[0]!.textContent).toContain("AA");
  expect(items[0]!.textContent).toContain("5books"); // the ribbon
  expect(items[0]!.textContent).toContain("2 series");
  expect(items[2]!.textContent).toContain("No series");
});

test("the series directory stacks covers and shows progress", async () => {
  at("/series", "/series", <SeriesListPage />);
  const card = await screen.findByTestId("directory-item");
  expect(card.getAttribute("href")).toBe("/series/The%20Saga");
  expect(card.textContent).toContain("1 of 3 finished");
  expect([...card.querySelectorAll("img")].map((i) => i.getAttribute("src"))).toEqual(
    [expect.stringContaining("/titles/1/cover?medium=ebook"), expect.stringContaining("/titles/2/cover?medium=audio")]);
});

test("an author page lists works by series, shelves the books and continues the one in progress", async () => {
  at("/authors/Ada%20Author", "/authors/:name", <AuthorPage />);
  const groups = await screen.findAllByTestId("author-group");
  expect(api).toHaveBeenCalledWith("POST", "/titles/search", expect.objectContaining({ filter: { type: "rule", field: "author", operator: "is", value: ["Ada Author"] } }));
  expect(groups.map((g) => g.textContent)).toEqual(["Other1 book", "The Saga3 books", "No series1 book"]);
  expect(screen.getByRole("img", { name: "No photo of Ada Author" })).toBeTruthy();
  expect(screen.getAllByTestId("book-item").map((b) => b.getAttribute("href"))).toEqual(["/titles/5", "/titles/1", "/titles/2", "/titles/4", "/titles/9"]);

  fireEvent.click(screen.getByRole("radio", { name: "The Saga" }));
  expect(screen.getAllByTestId("book-item").map((b) => b.getAttribute("href"))).toEqual(["/titles/1", "/titles/2", "/titles/4"]);

  await screen.findByTestId("continue-title"); // until it arrives the button is a disabled placeholder
  fireEvent.click(screen.getByRole("button", { name: "Continue reading" }));
  expect(get).toHaveBeenCalledWith("/continue-reading?by=author&name=Ada+Author");
  expect(read).toHaveBeenCalledWith("2");
});

test("the previous and next buttons follow the directory", async () => {
  at("/authors/Bo%20Writer", "/authors/:name", <AuthorPage />);
  expect((await screen.findByTestId("directory-position")).textContent).toBe("2 / 3");
  expect(screen.getByRole("link", { name: "Previous" }).getAttribute("href")).toBe("/authors/Ada%20Author");
  expect(screen.getByRole("link", { name: "Next" }).getAttribute("href")).toBe("/authors/Cy%20Panel");
});

test("a series page is in reading order with a place for each missing book", async () => {
  next = { titleId: "4", title: "Fourth", medium: "audio", state: "unread" };
  at("/series/The%20Saga", "/series/:name", <SeriesPage />);
  const found = await screen.findAllByTestId("book-item");
  expect(api).toHaveBeenCalledWith("POST", "/titles/search", expect.objectContaining({ sort: "series_index", filter: expect.objectContaining({ field: "series", value: ["The Saga"] }) }));
  expect(found.map((b) => b.getAttribute("href"))).toEqual(["/titles/1", "/titles/4", "/titles/2"]); // the server's order is kept
  expect(screen.getByTestId("missing-book").textContent).toContain("Book 3 is not in your libraries");
  fireEvent.click(await screen.findByRole("button", { name: "Start listening" }));
  expect(listen).toHaveBeenCalledWith("4");
});

test("a series with very many gaps names them instead, and a finished one offers nothing to continue", async () => {
  next = { titleId: null, title: null, medium: null, state: null };
  api.mockImplementation(async () => ({ items: [row("1", "First", "Long", 1), row("30", "Thirtieth", "Long", 30)], total: 2, page: 0, size: 200 }));
  at("/series/Long", "/series/:name", <SeriesPage />);
  expect((await screen.findByTestId("missing")).textContent).toContain("#2, #3");
  expect(screen.queryByTestId("missing-book")).toBeNull();
  expect(await screen.findByTestId("all-finished")).toBeTruthy();
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
